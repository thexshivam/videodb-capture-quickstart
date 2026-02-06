# Fact Detector

Real-time fact-checking agent that captures system audio, transcribes it live, and verifies factual claims using Gemini AI.

Works with any audio playing on your Mac: YouTube videos, local media, Google Meet calls, podcasts, webinars, etc.

## Why It Matters

Misinformation spreads fast. Whether you're watching a news clip, sitting in a meeting, or reviewing a recorded presentation, having an automated fact-checker running in the background gives you immediate feedback on claims being made. No more taking things at face value.

## Architecture

```
+-------------------+     +-------------------+     +------------------+
|  System Audio     | --> | VideoDB Capture   | --> | Real-time        |
|  (YouTube, Meet,  |     | (audio stream)    |     | Transcription    |
|   local video)    |     +-------------------+     | (WebSocket)      |
+-------------------+                               +--------+---------+
                                                             |
                                                             v
                                                    +--------+---------+
                                                    | Transcript       |
                                                    | Buffer           |
                                                    | (rolling chunks) |
                                                    +--------+---------+
                                                             |
                                                     every ~20 seconds
                                                             |
                                                             v
                                                    +--------+---------+
                                                    | Gemini AI        |
                                                    | (claim extraction|
                                                    |  + fact-check)   |
                                                    +--------+---------+
                                                             |
                                                    +--------+---------+
                                                    |                  |
                                                    v                  v
                                            +-----------+    +----------------+
                                            | Terminal   |    | Log File       |
                                            | Alerts     |    | (JSONL)        |
                                            +-----------+    +----------------+
```

**Components:**

| Component | File | Role |
|-----------|------|------|
| Backend | `backend.py` | Flask server, VideoDB sessions, webhooks, transcript buffering, fact-check orchestration |
| Client | `client.py` | Capture client, system audio streaming, permissions, shutdown |
| Fact Checker | `fact_checker.py` | Gemini API integration, claim extraction, verdict classification |

## Setup

### Prerequisites

- macOS (tested on MacBook Air M2)
- Python 3.10+
- [VideoDB API key](https://console.videodb.io)
- [Gemini API key](https://aistudio.google.com/apikey)

### Capture Binary

The VideoDB capture binary (`recorder`) must be available. If you have a custom binary distribution (e.g., `amd_mx/`), create a shim package so the SDK can find it:

```bash
# Create the shim in your venv's site-packages
mkdir -p venv/lib/python3.*/site-packages/videodb_capture_bin
cat > venv/lib/python3.*/site-packages/videodb_capture_bin/__init__.py << 'EOF'
import os
_BINARY_DIR = "/path/to/your/binary/directory"  # e.g., ~/Downloads/amd_mx
def get_binary_path():
    return os.path.join(_BINARY_DIR, "recorder")
EOF
```

If macOS blocks the binary ("Apple could not verify..."), remove the quarantine flag:

```bash
xattr -d com.apple.quarantine /path/to/recorder
xattr -d com.apple.quarantine /path/to/librecorder.dylib
```

### Installation

```bash
# Navigate to the fact-detector app
cd apps/fact-detector

# Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Environment Variables

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```
VIDEO_DB_API_KEY=your_videodb_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

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

The client will request microphone and screen capture permissions (macOS will prompt you). Once capture starts, play any video or join a meeting.

### Stop

Press `Ctrl+C` in the client terminal. The backend will flush remaining transcript and print a session summary.

## Example Output

```
  [TRANSCRIPT] the great wall of china is visible from space with the naked eye
  [TRANSCRIPT] mars has exactly two moons named phobos and deimos
  [TRANSCRIPT] humans use only ten percent of their brains
  [TRANSCRIPT] the speed of light is approximately three hundred thousand kilometers per second

[ANALYZING] Processing 80 words of transcript...

============================================================
  FACT CHECK RESULTS  (4 claim(s) detected)
============================================================

[FACT CHECK !! FALSE]
  Claim: "The Great Wall of China is visible from space with the naked eye."
  Correction: "The Great Wall of China is not visible from space with the naked eye."

[FACT CHECK -- TRUE]
  Claim: "Mars has exactly two moons named Phobos and Deimos."
  Note: "Mars has two moons, and their names are Phobos and Deimos."

[FACT CHECK !! FALSE]
  Claim: "Humans use only ten percent of their brains."
  Correction: "This is a common myth; humans use all parts of their brains."

[FACT CHECK -- TRUE]
  Claim: "The speed of light is approximately 300,000 kilometers per second."
  Note: "The speed of light in a vacuum is approximately 299,792 km/s."

------------------------------------------------------------
  Session totals: 4 claims | TRUE: 2 | FALSE: 2 | UNCERTAIN: 0
------------------------------------------------------------
```

## Log Files

Structured logs are written to the `logs/` directory as JSONL files (one JSON object per line). Each entry contains:

- Timestamp
- Transcript chunk analyzed
- List of claims with verdicts
- Summary counts

The final entry is a session summary with aggregate statistics.

## Configuration

These can be set as environment variables or adjusted in `backend.py`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5002` | Backend server port |
| `FACT_CHECK_INTERVAL` | `20` | Seconds between fact-check cycles |
| `MIN_WORDS_FOR_CHECK` | `15` | Minimum words before triggering a check |

## Built With

- [VideoDB Capture](https://videodb.io) - System audio capture and real-time transcription
- [Gemini AI](https://ai.google.dev) (`google-genai` SDK) - Claim extraction and fact verification
- [Flask](https://flask.palletsprojects.com) - Backend server
- [pycloudflared](https://github.com/6abd/pycloudflared) - Webhook tunneling
