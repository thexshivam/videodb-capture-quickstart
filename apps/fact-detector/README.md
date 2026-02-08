# Fact Detector

Real-time fact-checking agent that captures system audio, transcribes it live, and verifies factual claims using Gemini AI.

Works with any audio playing on your system: YouTube videos, local media, Google Meet calls, podcasts, webinars, etc.

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

- Python 3.10+
- [VideoDB API key](https://console.videodb.io)
- [Gemini API key](https://aistudio.google.com/apikey)

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

### Capture Binary (macOS)

The capture binary (`recorder`) is included in the `amd_mx/` directory. After creating your virtual environment, register it with the SDK:

```bash
# Create the shim package so the SDK can find the binary
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

If macOS blocks the binary ("Apple could not verify..."), remove the quarantine flag:

```bash
xattr -d com.apple.quarantine amd_mx/recorder
xattr -d com.apple.quarantine amd_mx/librecorder.dylib
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

The client will show an interactive menu to select your audio source:

```
What do you want to fact-check?

  1. YouTube video
  2. Google Meet call
  3. Local video file

Enter choice (1/2/3): 1
Enter YouTube URL: https://www.youtube.com/watch?v=example
[OPEN] Opening https://www.youtube.com/watch?v=example in your browser...
```

After you make your selection, the content opens automatically and capture begins. The client will then request microphone and screen capture permissions.

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

- [VideoDB Capture](https://github.com/video-db/videodb-capture-quickstart) - System audio capture and real-time transcription
- [Gemini AI](https://ai.google.dev/gemini-api/docs/libraries) (`google-genai` SDK) - Claim extraction and fact verification
- [Flask](https://flask.palletsprojects.com) - Backend server
- [pycloudflared](https://github.com/6abd/pycloudflared) - Webhook tunneling
