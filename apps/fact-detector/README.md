# Fact Detector

Real-time fact-checking that listens to any audio on your Mac and tells you what's true, misleading, or needs more context -- powered by VideoDB Capture and Gemini AI.

Play a YouTube video, join a Google Meet, or stream a podcast. Fact Detector captures the audio, transcribes it live, and generates community-style notes on every factual claim it hears.

## What You'll Need

Before you start, make sure you have:

- **macOS** (required for system audio capture)
- **Node.js 18+** -- [download here](https://nodejs.org) if you don't have it
- **A VideoDB API key** -- sign up free at [console.videodb.io](https://console.videodb.io)
- **A Gemini API key** -- get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

Check if Node.js is installed by running:

```bash
node --version
```

If you see a version number (e.g. `v20.11.0`), you're good.

## Quick Start (Desktop App)

This is the recommended way to run Fact Detector. Everything runs from a single icon in your menu bar.

### Step 1: Go to the Electron app folder

```bash
cd apps/electron/fact-detector
```

### Step 2: Run the setup (first time only)

```bash
npm run setup
```

This will:
1. Ask for your VideoDB and Gemini API keys
2. Install all dependencies (Node.js + Python)
3. Create a Python virtual environment automatically

You only need to do this once.

### Step 3: Start the app

```bash
npm start
```

That's it — this single command starts everything. You do **not** need to start the backend or any server manually. The app handles it all behind the scenes.

A small icon appears in your macOS menu bar (top-right of your screen). Click it to open the popup.

> **Note:** If port 5002 is already in use from a previous run, free it first:
> ```bash
> lsof -ti:5002 | xargs kill -9
> ```

### Step 4: Start fact-checking

1. Pick a source from the dropdown (YouTube, Google Meet, local file, or live stream)
2. Paste the URL or file path
3. Click **Start Fact-Checking**
4. Play the video/audio in your browser

When you click Start, the app automatically:
- Starts the backend server on port 5002
- Launches the capture client
- Connects to the live transcription stream
- Begins fact-checking every 20 seconds

Alerts start appearing after 30-60 seconds.

### Step 5: Stop

Click **Stop Fact-Checking** in the popup to end the session. To quit the app entirely, click the **X** button or **Quit** at the bottom.

## How It Works

```
 Your Audio (YouTube, Meet, etc.)
        |
        v
 VideoDB Capture (records system audio)
        |
        v
 Real-time Transcription (WebSocket)
        |
        v
 Transcript Buffer (collects ~20 seconds of text)
        |
        v
 Gemini AI (extracts claims, checks facts, scores confidence)
        |
        v
 Alerts (displayed in the tray app + saved to log files)
```

Every 20 seconds, the system:
1. Collects all transcribed text
2. Sends it to Gemini AI for fact-checking
3. Labels each claim as **Verified**, **Misleading**, or **Needs Context**
4. Shows high-confidence results in the app

## Alert Types

| Color | Label | Meaning |
|-------|-------|---------|
| Green | Verified | The claim is factually accurate |
| Red | Misleading | The claim contains inaccuracies |
| Orange | Needs Context | The claim is partially true but missing important context |

## Desktop App Features

- **Activity indicators** -- see live status for audio capture, transcription, and fact-checking
- **Copy to clipboard** -- hover over any alert and click the copy icon
- **Stats footer** -- running totals for verified, misleading, and needs-context notes
- **Auto-reconnect** -- if the connection drops, the app reconnects automatically
- **Session recovery** -- reopen the popup anytime without losing your session

## CLI Usage (Alternative)

If you prefer the terminal over the desktop app, you can run the backend and client separately. This requires **two terminal windows**.

### Step 1: Install dependencies

```bash
cd apps/fact-detector
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt \
  --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/
```

> **Note:** The `videodb[capture]` package is hosted on TestPyPI, which is why the extra index flags are needed.

### Step 2: Set up your API keys

```bash
cp .env.example .env
```

Open `.env` in any text editor and add your keys:

```
VIDEO_DB_API_KEY=your_videodb_key_here
GEMINI_API_KEY=your_gemini_key_here
```

### Step 3: Start the backend (Terminal 1)

```bash
cd apps/fact-detector
source venv/bin/activate
python backend.py
```

Wait until you see this message:

```
[READY] Backend running on http://localhost:5002
[READY] Now start the client:  python client.py
```

**Do not close this terminal.** The backend must stay running.

### Step 4: Start the client (Terminal 2)

Open a **new** terminal window:

```bash
cd apps/fact-detector
source venv/bin/activate
python client.py
```

You'll see a menu:

```
What do you want to fact-check?

  1. YouTube / YouTube Live
  2. Google Meet call
  3. Local video file
  4. Live stream (any URL)

Enter choice (1/2/3/4):
```

Pick a source, paste the URL, and the video opens automatically. Make sure to play the video.

### Step 5: Stop

Press `Ctrl+C` in the client terminal (Terminal 2). The backend will finish processing and print a summary.

## Example Output

```
============================================================
  COMMUNITY NOTES  (2 note(s) from latest check)
============================================================

  [MISLEADING] "The Great Wall of China is visible from space"
  Note: The Great Wall is not visible to the naked eye from low
        Earth orbit. This is a common misconception.
  Sources: NASA.gov
  Confidence: high

  [VERIFIED] "India's population surpassed China's in 2023"
  Note: UN data confirms India became the most populous country
        in April 2023.
  Confidence: high

------------------------------------------------------------
  Session: 2 notes | Verified: 1 | Misleading: 1
------------------------------------------------------------
```

## Configuration

All settings go in the `.env` file. Only the API keys are required -- everything else has sensible defaults.

| Setting | Default | What it does |
|---------|---------|--------------|
| `VIDEO_DB_API_KEY` | *(required)* | Your VideoDB API key |
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key |
| `PORT` | `5002` | Port for the backend server |
| `FACT_CHECK_INTERVAL` | `20` | How often to check facts (in seconds) |
| `MIN_WORDS_FOR_CHECK` | `15` | Minimum words needed before running a check |
| `CONFIDENCE_THRESHOLD` | `high` | Only show alerts at this confidence level or above |
| `CONTEXT_WINDOW_WORDS` | `150` | How many words of previous context to carry forward |
| `ALERT_COOLDOWN_SECONDS` | `30` | Minimum gap between alerts for similar claims |

## Project Structure

```
apps/fact-detector/
  backend.py          # Backend server (Flask) -- handles sessions, transcription, fact-checking
  client.py           # Capture client -- records system audio and streams it
  config.py           # All configuration settings
  pipeline/           # Fact-checking pipeline modules
    __init__.py       #   Orchestrator: preprocess -> verify -> generate -> filter
    claim_detector.py #   Cleans transcript, manages context window
    verifier.py       #   Gemini API: extracts and verifies claims
    note_generator.py #   Formats results into community notes
    alert_manager.py  #   Confidence filtering, dedup, throttling
  logs/               # JSON log files (one per check cycle)

apps/electron/fact-detector/
  frontend/
    main.js           # Electron main process: tray, window, process management
    preload.js        # Secure bridge between Electron and the UI
    index.html        # The popup UI (HTML + CSS + JS in one file)
  scripts/
    setup.sh          # First-time setup script
    start.sh          # Launch script (checks deps, starts Electron)
  package.json        # Node.js project config and scripts
```

## API Endpoints

The backend runs on `http://localhost:5002` and exposes these endpoints:

| Endpoint | Method | What it does |
|----------|--------|--------------|
| `/health` | GET | Check if the backend is running |
| `/status` | GET | Backend readiness + tunnel URL |
| `/stats` | GET | Session statistics (note counts) |
| `/events` | GET | Live alert stream (Server-Sent Events) |
| `/init-session` | POST | Create a new capture session |
| `/callback` | POST | Webhook receiver for VideoDB events |

Test the live alert stream:

```bash
curl -N http://localhost:5002/events
```

## Troubleshooting

### "No alerts yet" after starting

This is normal for the first 30-60 seconds. The system needs time to:
1. Start audio capture
2. Accumulate enough transcript (at least 15 words)
3. Send it to Gemini for analysis

Make sure your video is **actually playing with audio**.

### Port 5002 is already in use

Another process is using the port. Kill it first:

```bash
lsof -ti:5002 | xargs kill -9
```

Then start the app again.

### macOS blocks the capture binary

The capture binary is installed via the `videodb-capture-bin` pip package. If macOS blocks it, find and unquarantine it:

```bash
RECORDER=$(python -c "import videodb_capture_bin; print(videodb_capture_bin.get_binary_path())")
xattr -d com.apple.quarantine "$RECORDER"
```

### WebSocket keeps disconnecting

The app automatically retries up to 5 times. If it still fails:
- Check your internet connection
- Verify your `VIDEO_DB_API_KEY` is valid
- Restart the app

### Backend won't start

Make sure both API keys are set in `.env`:
```
VIDEO_DB_API_KEY=...
GEMINI_API_KEY=...
```

The backend exits immediately if either key is missing.

## Built With

- [VideoDB Capture](https://github.com/video-db/videodb-capture-quickstart) -- System audio capture and real-time transcription
- [Gemini AI](https://ai.google.dev/gemini-api/docs/libraries) -- Claim extraction, verification, and confidence scoring
- [Flask](https://flask.palletsprojects.com) -- Backend server
- [Electron](https://www.electronjs.org) -- Desktop tray app
- [pycloudflared](https://github.com/6abd/pycloudflared) -- Webhook tunneling
