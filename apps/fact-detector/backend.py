"""Fact Detector Backend.

Flask server that orchestrates:
1. VideoDB Capture session management
2. Real-time transcript ingestion via WebSocket
3. Periodic fact-checking via Gemini
4. Terminal display and file logging of results
"""

import os
import sys
import logging
import threading
import queue
import asyncio
import traceback
import time
import json
from datetime import datetime, timezone

from flask import Flask, request, jsonify
from pycloudflared import try_cloudflare
from dotenv import load_dotenv
import videodb
from videodb._constants import RTStreamChannelType

from fact_checker import FactChecker

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv()

VIDEO_DB_API_KEY = os.getenv("VIDEO_DB_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
PORT = int(os.getenv("PORT", "5002"))

# How often (seconds) to send accumulated transcript to Gemini
FACT_CHECK_INTERVAL = int(os.getenv("FACT_CHECK_INTERVAL", "20"))

# Minimum word count before triggering a fact-check
MIN_WORDS_FOR_CHECK = int(os.getenv("MIN_WORDS_FOR_CHECK", "15"))

LOG_DIR = "logs"

if not VIDEO_DB_API_KEY:
    print("[ERROR] VIDEO_DB_API_KEY environment variable not set")
    sys.exit(1)

if not GEMINI_API_KEY:
    print("[ERROR] GEMINI_API_KEY environment variable not set")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("fact-detector")

os.makedirs(LOG_DIR, exist_ok=True)
log_filename = os.path.join(
    LOG_DIR, f"fact_check_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
)

# ---------------------------------------------------------------------------
# Flask App
# ---------------------------------------------------------------------------

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Shared State
# ---------------------------------------------------------------------------

conn = None
public_url = None
checker = None

# Thread-safe transcript buffer
transcript_buffer = []
buffer_lock = threading.Lock()

# Session-level statistics
session_stats = {
    "total_claims": 0,
    "true": 0,
    "false": 0,
    "uncertain": 0,
    "chunks_analyzed": 0,
}
stats_lock = threading.Lock()


# ---------------------------------------------------------------------------
# File Logging
# ---------------------------------------------------------------------------

def log_to_file(entry):
    """Append a JSON-lines entry to the log file."""
    try:
        with open(log_filename, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError as e:
        logger.error("Failed to write log entry: %s", e)


def log_claims(claims, transcript_chunk):
    """Write fact-check results as a structured log entry."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": "fact_check",
        "transcript_chunk": transcript_chunk,
        "claims": claims,
        "summary": {
            "total": len(claims),
            "true": sum(1 for c in claims if c["verdict"] == "TRUE"),
            "false": sum(1 for c in claims if c["verdict"] == "FALSE"),
            "uncertain": sum(1 for c in claims if c["verdict"] == "UNCERTAIN"),
        },
    }
    log_to_file(entry)


# ---------------------------------------------------------------------------
# Terminal Display
# ---------------------------------------------------------------------------

VERDICT_LABELS = {
    "TRUE": "[FACT CHECK -- TRUE]",
    "FALSE": "[FACT CHECK !! FALSE]",
    "UNCERTAIN": "[FACT CHECK ?? UNCERTAIN]",
}


def display_claims(claims):
    """Print fact-check results to the terminal."""
    if not claims:
        return

    print("\n" + "=" * 60)
    print(f"  FACT CHECK RESULTS  ({len(claims)} claim(s) detected)")
    print("=" * 60)

    for claim in claims:
        verdict = claim["verdict"]
        label = VERDICT_LABELS.get(verdict, f"[{verdict}]")
        print(f"\n{label}")
        print(f'  Claim: "{claim["claim"]}"')
        if claim.get("explanation"):
            if verdict == "FALSE":
                print(f'  Correction: "{claim["explanation"]}"')
            else:
                print(f'  Note: "{claim["explanation"]}"')

    print("\n" + "-" * 60)

    # Update and display running stats
    with stats_lock:
        for claim in claims:
            session_stats["total_claims"] += 1
            key = claim["verdict"].lower()
            if key in session_stats:
                session_stats[key] += 1
        session_stats["chunks_analyzed"] += 1

        print(
            f"  Session totals: {session_stats['total_claims']} claims | "
            f"TRUE: {session_stats['true']} | "
            f"FALSE: {session_stats['false']} | "
            f"UNCERTAIN: {session_stats['uncertain']}"
        )
    print("-" * 60)
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Fact-Check Runner (background thread)
# ---------------------------------------------------------------------------

def run_fact_check_loop():
    """Periodically drain the transcript buffer and fact-check its contents."""
    logger.info(
        "Fact-check loop started (interval=%ds, min_words=%d)",
        FACT_CHECK_INTERVAL,
        MIN_WORDS_FOR_CHECK,
    )

    while True:
        time.sleep(FACT_CHECK_INTERVAL)

        # Drain the buffer
        with buffer_lock:
            if not transcript_buffer:
                continue
            chunk = " ".join(transcript_buffer)
            transcript_buffer.clear()

        word_count = len(chunk.split())
        if word_count < MIN_WORDS_FOR_CHECK:
            logger.debug(
                "Chunk too short (%d words), carrying over to next cycle",
                word_count,
            )
            with buffer_lock:
                transcript_buffer.insert(0, chunk)
            continue

        logger.info("Analyzing chunk (%d words)...", word_count)
        print(f"\n[ANALYZING] Processing {word_count} words of transcript...")

        claims = checker.check(chunk)
        display_claims(claims)
        log_claims(claims, chunk)


# ---------------------------------------------------------------------------
# WebSocket Listener
# ---------------------------------------------------------------------------

def start_ws_listener(result_queue, name="FactDetectorWS"):
    """Start a background thread that listens for real-time transcript events."""

    def run():
        async def listen():
            try:
                logger.info("[%s] Connecting to WebSocket...", name)
                ws_wrapper = conn.connect_websocket()
                ws = await ws_wrapper.connect()
                ws_id = ws.connection_id
                logger.info("[%s] Connected (ID: %s)", name, ws_id)

                # Send the connection ID back so the caller can bind streams
                result_queue.put(ws_id)

                async for msg in ws.receive():
                    channel = msg.get("channel")
                    data = msg.get("data", {})

                    if channel == "transcript":
                        text = data.get("text", "").strip()
                        is_final = data.get("is_final", False)
                        # Only buffer final transcripts from the WebSocket.
                        # Webhook callbacks also deliver transcripts; both
                        # sources feed the same buffer so duplicates are
                        # possible but harmless for fact-checking accuracy.
                        if text and is_final:
                            with buffer_lock:
                                transcript_buffer.append(text)

            except Exception as e:
                logger.error("[%s] WebSocket error: %s", name, e)
                traceback.print_exc()

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(listen())

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


# ---------------------------------------------------------------------------
# Flask Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok", "tunnel": public_url})


@app.route("/init-session", methods=["POST"])
def init_session():
    """Create a VideoDB capture session and return credentials."""
    try:
        callback_url = f"{public_url}/callback"
        logger.info("Creating session with callback: %s", callback_url)

        session = conn.create_capture_session(
            end_user_id="user_fact_detector",
            collection_id="default",
            callback_url=callback_url,
            metadata={"app": "fact-detector"},
        )

        token = conn.generate_client_token()

        return jsonify({
            "session_id": session.id,
            "token": token,
            "callback_url": callback_url,
        })
    except Exception as e:
        logger.error("Error creating session: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/callback", methods=["POST"])
def callback():
    """Handle VideoDB capture session lifecycle webhooks."""
    data = request.json
    event = data.get("event")

    # Transcripts can arrive as webhook callbacks with "type" instead of "event"
    if event is None:
        cb_type = data.get("type")
        if cb_type == "transcript":
            text = data.get("text", "").strip()
            is_final = data.get("is_final", False)
            if text and is_final:
                print(f"  [TRANSCRIPT] {text}")
                with buffer_lock:
                    transcript_buffer.append(text)
        return jsonify({"received": True})

    logger.info("[WEBHOOK] Event: %s", event)

    if event == "capture_session.active":
        cap_id = data.get("capture_session_id")
        logger.info("Capture session active: %s", cap_id)

        try:
            cap = conn.get_capture_session(cap_id)

            system_audios = cap.get_rtstream(RTStreamChannelType.system_audio)
            mics = cap.get_rtstream(RTStreamChannelType.mic)

            logger.info(
                "Streams found -- System Audio: %d, Mics: %d",
                len(system_audios),
                len(mics),
            )

            # Prefer system audio (captures video playback / meeting audio)
            audio_stream = None
            if system_audios:
                audio_stream = system_audios[0]
                logger.info("Using system audio stream: %s", audio_stream.id)
            elif mics:
                audio_stream = mics[0]
                logger.info("Falling back to microphone stream: %s", audio_stream.id)

            if audio_stream:
                q = queue.Queue()
                start_ws_listener(q, name="FactDetectorWS")
                ws_id = q.get(timeout=10)

                audio_stream.start_transcript(ws_connection_id=ws_id)
                logger.info("Transcription started on WebSocket: %s", ws_id)

                print("\n" + "=" * 60)
                print("  FACT DETECTOR ACTIVE")
                print("  Listening for audio and checking facts in real-time...")
                print(f"  Check interval: {FACT_CHECK_INTERVAL}s")
                print(f"  Log file: {log_filename}")
                print("=" * 60 + "\n")
            else:
                logger.warning("No audio streams available for fact-checking")

        except Exception as e:
            logger.error("Error starting fact-check pipeline: %s", e)
            traceback.print_exc()

    elif event == "capture_session.stopping":
        logger.info("Session stopping...")

    elif event == "capture_session.stopped":
        logger.info("Session stopped.")

        # Flush any remaining transcript in the buffer
        with buffer_lock:
            if transcript_buffer:
                remaining = " ".join(transcript_buffer)
                transcript_buffer.clear()
                if len(remaining.split()) >= MIN_WORDS_FOR_CHECK:
                    logger.info("Checking remaining buffered transcript...")
                    claims = checker.check(remaining)
                    display_claims(claims)
                    log_claims(claims, remaining)

        # Log final session summary
        with stats_lock:
            summary_entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "type": "session_summary",
                "stats": dict(session_stats),
            }
            log_to_file(summary_entry)

            print("\n" + "=" * 60)
            print("  SESSION SUMMARY")
            print(f"  Total claims checked: {session_stats['total_claims']}")
            print(f"  TRUE: {session_stats['true']}")
            print(f"  FALSE: {session_stats['false']}")
            print(f"  UNCERTAIN: {session_stats['uncertain']}")
            print(f"  Chunks analyzed: {session_stats['chunks_analyzed']}")
            print(f"  Full log: {log_filename}")
            print("=" * 60)

    elif event == "capture_session.exported":
        video_id = data.get("data", {}).get("exported_video_id")
        logger.info("Recording exported. Video ID: %s", video_id)
        print(f"\n[EXPORTED] Video ID: {video_id}")
        print(f"  View at: https://console.videodb.io/player?video={video_id}")

    return jsonify({"received": True})


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------

def init_app():
    """Initialize VideoDB connection, Gemini checker, tunnel, and background tasks."""
    global conn, public_url, checker

    print("=" * 60)
    print("  FACT DETECTOR - Real-time Fact Checking")
    print("  Powered by VideoDB Capture + Gemini")
    print("=" * 60)

    # 1. Connect to VideoDB
    print("\n[INIT] Connecting to VideoDB...")
    conn = videodb.connect(api_key=VIDEO_DB_API_KEY)
    print("[INIT] VideoDB connected.")

    # 2. Initialize Gemini fact-checker
    print("[INIT] Initializing Gemini fact-checker...")
    checker = FactChecker(api_key=GEMINI_API_KEY)
    print("[INIT] Fact-checker ready.")

    # 3. Start Cloudflare tunnel for webhooks
    print(f"[INIT] Starting Cloudflare tunnel on port {PORT}...")
    tunnel = try_cloudflare(port=PORT)
    public_url = tunnel.tunnel
    print(f"[INIT] Tunnel active: {public_url}")

    # 4. Start the background fact-check loop
    fact_thread = threading.Thread(target=run_fact_check_loop, daemon=True)
    fact_thread.start()
    print("[INIT] Fact-check loop started.")

    print(f"[INIT] Log file: {log_filename}")
    print(f"\n[READY] Backend running on http://localhost:{PORT}")
    print("[READY] Now start the client:  python client.py\n")


if __name__ == "__main__":
    init_app()
    app.run(port=PORT)
