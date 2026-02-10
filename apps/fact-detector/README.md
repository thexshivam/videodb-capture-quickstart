# Fact Detector

Real-time fact-checking agent that captures system audio, transcribes it live, and generates community-style notes on factual claims using Gemini AI.

Works with any audio playing on your system: YouTube videos, YouTube Live streams, local media, Google Meet calls, podcasts, webinars, or any browser-based live stream.

## Features

- **Community Notes output** -- claims are labeled as Verified, Misleading, or Needs Context with neutral explanations.
- **Confidence scoring** -- every claim gets a high/medium/low confidence rating; only high-confidence notes are shown in the terminal to keep output clean.
- **Sliding context window** -- carries the last ~150 words between check cycles so claims that span chunk boundaries are handled correctly
- **Deduplication and throttling** -- repeated claims within a cooldown window are suppressed to prevent alert spam during long streams
- **Structured JSON logging** -- every check cycle writes a log file with the transcript chunk, context used, notes with alerted/suppressed status, and summary counts
- **Live stream support** -- menu includes YouTube Live, Google Meet, local files, and any generic stream URL

## Architecture

```
+-------------------+     +-------------------+     +------------------+
|  System Audio     | --> | VideoDB Capture   | --> | Real-time        |
|  (YouTube, Meet,  |     | (audio stream)    |     | Transcription    |
|   live streams)   |     +-------------------+     | (WebSocket)      |
+-------------------+                               +--------+---------+
                                                             |
                                                             v
                                                    +--------+---------+
                                                    | Transcript       |
                                                    | Buffer (deduped) |
                                                    +--------+---------+
                                                             |
                                                     every ~20 seconds
                                                             |
                                                             v
                                                    +--------+---------+
                                                    | Pipeline         |
                                                    |  1. Preprocess   |
                                                    |  2. Verify       |
                                                    |  3. Generate     |
                                                    |  4. Filter       |
                                                    +--------+---------+
                                                             |
                                                    +--------+---------+
                                                    |                  |
                                                    v                  v
                                            +-----------+    +----------------+
                                            | Terminal   |    | Log File       |
                                            | Alerts     |    | (JSON)         |
                                            +-----------+    +----------------+
```

### Components

| Component | File | Role |
|-----------|------|------|
| Backend | `backend.py` | Flask server, VideoDB sessions, webhooks, transcript buffering, pipeline orchestration |
| Client | `client.py` | Capture client, system audio streaming, permissions, shutdown |
| Config | `config.py` | Centralized configuration for all components |
| Pipeline | `pipeline/` | Modular fact-checking pipeline (see below) |

### Pipeline Modules

| Module | Purpose |
|--------|---------|
| `pipeline/__init__.py` | Orchestrates the full pipeline: preprocess -> verify -> generate -> filter |
| `pipeline/claim_detector.py` | Cleans transcript, manages sliding context window |
| `pipeline/verifier.py` | Gemini API call -- extracts claims, verifies, scores confidence |
| `pipeline/note_generator.py` | Formats raw output into community notes (enforces length, neutral tone) |
| `pipeline/alert_manager.py` | Confidence gating, deduplication, throttling |

## Setup

### Prerequisites

- Python 3.10+
- macOS (for system audio capture)
- [VideoDB API key](https://console.videodb.io)
- [Gemini API key](https://aistudio.google.com/apikey)
- `cloudflared` for webhook tunneling:
  ```bash
  brew install cloudflared
  ```

### Installation

```bash
cd apps/fact-detector

python3 -m venv venv
source venv/bin/activate

pip install -r requirements.txt
```

### Capture Binary (macOS)

The capture binary is included in the `amd_mx/` directory. After creating your virtual environment, register it with the SDK:

```bash
SITE_PACKAGES=$(python -c "import site; print(site.getsitepackages()[0])")
mkdir -p "$SITE_PACKAGES/videodb_capture_bin"
cat > "$SITE_PACKAGES/videodb_capture_bin/__init__.py" << 'EOF'
import os
_BINARY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "..", "amd_mx")
_BINARY_DIR = os.path.normpath(_BINARY_DIR)
def get_binary_path():
    return os.path.join(_BINARY_DIR, "recorder")
EOF
```

If macOS blocks the binary, remove the quarantine flag:

```bash
xattr -d com.apple.quarantine amd_mx/recorder
xattr -d com.apple.quarantine amd_mx/librecorder.dylib
```

### Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```
VIDEO_DB_API_KEY=your_videodb_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

See [Configuration](#configuration) for optional settings.

## How to Run

You need two terminal windows.

### Terminal 1: Start the backend

```bash
cd apps/fact-detector
source venv/bin/activate
python backend.py
```

Wait until you see `[READY] Now start the client`.

### Terminal 2: Start the capture client

```bash
cd apps/fact-detector
source venv/bin/activate
python client.py
```

The client shows an interactive menu:

```
What do you want to fact-check?

  1. YouTube / YouTube Live
  2. Google Meet call
  3. Local video file
  4. Live stream (any URL)

Enter choice (1/2/3/4):
```

After you select a source, the content opens automatically and capture begins. The client will request microphone and screen capture permissions.

### Stop

Press `Ctrl+C` in the client terminal. The backend will flush remaining transcript, run a final check, and print a session summary.

## Example Output

```
  [TRANSCRIPT] the great wall of china is visible from space with the naked eye
  [TRANSCRIPT] india's population surpassed china's in 2023

[ANALYZING] Processing 42 words of transcript...

============================================================
  COMMUNITY NOTES  (2 note(s) from latest check)
============================================================

  [MISLEADING] "The Great Wall of China is visible from space"
  Note: The Great Wall is not visible to the naked eye from low Earth
        orbit. This is a common misconception.
  Sources: NASA.gov
  Confidence: high

  [VERIFIED] "India's population surpassed China's in 2023"
  Note: UN data confirms India became the most populous country
        in April 2023.
  Confidence: high

------------------------------------------------------------
  Session: 2 notes | Verified: 1 | Misleading: 1 | Needs Context: 0
------------------------------------------------------------
```

Notes with medium or low confidence are logged to `logs/` but not displayed in the terminal.

## Log Files

Each fact-check cycle writes a JSON file to `logs/`:

```json
{
  "timestamp": "2025-01-15T10:03:34.510282+00:00",
  "type": "fact_check",
  "transcript_chunk": "...",
  "context_used": "...",
  "notes": [
    {
      "claim": "...",
      "label": "misleading",
      "confidence": "high",
      "note": "...",
      "sources": ["..."],
      "alerted": true
    }
  ],
  "summary": {
    "total": 2,
    "alerted": 1,
    "verified": 1,
    "misleading": 1,
    "needs_context": 0
  }
}
```

A session summary file is written when the session stops, with aggregate statistics including suppressed note counts.

## Configuration

Set these in `.env` or as environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `VIDEO_DB_API_KEY` | (required) | VideoDB API key |
| `GEMINI_API_KEY` | (required) | Gemini API key |
| `PORT` | `5002` | Backend server port |
| `FACT_CHECK_INTERVAL` | `20` | Seconds between fact-check cycles |
| `MIN_WORDS_FOR_CHECK` | `15` | Minimum words before triggering a check |
| `CONFIDENCE_THRESHOLD` | `high` | Minimum confidence to show as terminal alert |
| `CONTEXT_WINDOW_WORDS` | `150` | Words of prior transcript carried as context |
| `ALERT_COOLDOWN_SECONDS` | `30` | Seconds between alerts for similar claims |

## Built With

- [VideoDB Capture](https://github.com/video-db/videodb-capture-quickstart) -- System audio capture and real-time transcription
- [Gemini AI](https://ai.google.dev/gemini-api/docs/libraries) (`google-genai` SDK) -- Claim extraction, verification, and confidence scoring
- [Flask](https://flask.palletsprojects.com) -- Backend server
- [pycloudflared](https://github.com/6abd/pycloudflared) -- Webhook tunneling
