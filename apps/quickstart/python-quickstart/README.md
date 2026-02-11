# Python Capture Quickstart

A complete example showing real-time media capture, indexing, and transcription.

## Overview
This app consists of two parts running locally:
1.  **Backend (`backend.py`)**: Creates capture sessions, acts as a webhook receiver, and runs AI pipelines.
2.  **Desktop Client (`client.py`)**: Captures screen and audio, streaming it to VideoDB.

## Prerequisites

1.  **Python 3.8+**
2.  **uv** (Optional but recommended): For fast package management. [Install uv](https://docs.astral.sh/uv/getting-started/installation/).
3.  **VideoDB API Key**: Get one from [console.videodb.io](https://console.videodb.io).

## Setup

1.  **Create and Activate Virtual Environment**:
    ```bash
    # Using uv (Recommended)
    uv venv
    source .venv/bin/activate

    # OR using standard venv
    python -m venv .venv
    source .venv/bin/activate  # On Windows: .venv\Scripts\activate
    ```

2.  **Install Dependencies**:
    ```bash
    # Using pip (with test PyPI)
    pip install --no-cache-dir \
      --index-url https://test.pypi.org/simple/ \
      --extra-index-url https://pypi.org/simple/ \
      -r requirements.txt

    # OR using uv
    uv pip install --no-cache-dir \
      --index-url https://test.pypi.org/simple/ \
      --extra-index-url https://pypi.org/simple/ \
      --index-strategy unsafe-best-match \
      -r requirements.txt
    ```

    > **Note**: The `--no-cache-dir` flag ensures you get the latest version from TestPyPI instead of a potentially outdated cached version.

3.  **Configure Environment**:
    Copy `.env.example` to `.env` and add your API key:
    ```bash
    cp .env.example .env
    # Edit .env and set VIDEO_DB_API_KEY
    ```

## Running the App

### Step 1: Start the Backend
The backend initializes the session and starts a **Cloudflare Tunnel** for webhooks.

```bash
python backend.py
```
*Wait for the "✅ Cloudflare Tunnel Started" message. The `cloudflared` binary will be downloaded automatically on the first run.*

### Step 2: Start the Client
Open a new terminal and run the client.

```bash
python client.py
```

### Step 3: Watch the Magic
1.  The client will ask for permissions (Screen/Mic).
2.  It will start streaming media.
3.  Switch to the **Backend Terminal** to see real-time transcripts and indexing events flowing in!

## What's Happening?

- `client.py` captures media and sends it to VideoDB.
- VideoDB processes the stream and sends webhooks to your `backend.py`.
- `backend.py` receives the `capture_session.active` webhook and starts **transcription** and **visual indexing** on the streams.
- Real-time results are printed to the console via WebSocket!

## Expected Output

### Backend Terminal
You'll see:
```
🔌 Connecting to VideoDB...
🚇 Starting Cloudflare Tunnel...
✅ Cloudflare Tunnel Started: https://xxx.trycloudflare.com

🔔 [WEBHOOK] Event: capture_session.active
⚡️ Capture Session Active! Starting AI pipelines...
📄 Retrieved Session: session_id
   🎤 Mics: 1 | 🔊 System Audio: 1 | 📺 Displays: 1
   🔊 Indexing system audio: stream_id
   ✅ System Audio indexing started (socket: ws_id)
   📺 Indexing display: stream_id
   ✅ Visual indexing started (socket: ws_id)

[AudioWatcher] 📝 Transcript: [Real-time transcription of audio]
[AudioWatcher] 🧠 Audio Index: [Key decisions and action items]
[VisualWatcher] 👁️ Scene Index: [Description of screen activity]
```

### Client Terminal
```
🚀 VideoDB Capture Client - Python Quickstart
============================================================
📡 Connecting to backend at http://localhost:5002...
✅ Session created successfully
   🔑 Token: xxxxxxxxxx...
   📋 Session ID: session_id

🎥 --- Starting Capture Client ---
🔒 Requesting Permissions...
📡 Discovering Channels...

🔴 Starting Recording with 3 channel(s):
   • mic: channel_id
   • screen: channel_id
   • system_audio: channel_id

⏳ Recording... Press Ctrl+C to stop.
```

## Troubleshooting

### Backend won't start
- **Error: `VIDEO_DB_API_KEY environment variable not set`**
  - Make sure you've created a `.env` file and set your API key

- **Cloudflare tunnel issues**
  - The `cloudflared` binary downloads automatically on first run
  - If it fails, check your internet connection and firewall settings

### Client won't connect
- **Error: `Cannot connect to backend`**
  - Make sure the backend is running first (`python backend.py`)
  - Check that both are using the same port (default: 5002)

### No AI results appearing
- Make sure you're generating audio or visual activity to be indexed
- Check that the WebSocket connections show "Connected!" messages
- Verify your VideoDB API key has the necessary permissions

## Stopping the Recording

When you press **Ctrl+C** to stop:

1. The client will initiate graceful shutdown
2. It will attempt to send a stop signal to the server
3. Wait 5-10 seconds for cleanup to complete
4. Check the **backend terminal** for these webhooks:
   - `capture_session.stopping` - Shutdown initiated
   - `capture_session.stopped` - Session finalized
   - `capture_session.exported` - Video ready (includes Video ID)

**Note**: The native capture binary receives the Ctrl+C signal directly from the terminal and may exit before the Python cleanup code runs. The client includes retry logic and timeout handling to ensure the server receives the stop command. If you see timeout warnings, the server will still detect the disconnect and clean up the session automatically (may take 10-30 seconds).
