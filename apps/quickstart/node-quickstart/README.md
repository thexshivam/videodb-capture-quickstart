# VideoDB CaptureSession Demo

Real-time screen capture and indexing demo using VideoDB SDK. Captures audio/video streams, performs live transcription, visual scene indexing, and triggers webhook alerts for detected applications.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
VIDEODB_API_KEY=sk-your-api-key-here
VIDEODB_COLLECTION_ID=default
VIDEODB_BASE_URL=https://api.videodb.io
# WEBHOOK_URL=https://your-webhook-url.com/webhook
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VIDEODB_API_KEY` | ✅ Yes | Your VideoDB API key |
| `VIDEODB_COLLECTION_ID` | No | Collection ID (defaults to `default`) |
| `VIDEODB_BASE_URL` | No | API endpoint for SDK (defaults to `https://api.videodb.io`) |
| `WEBHOOK_URL` | No | Webhook for alert notifications. If not set, alerts are disabled |

> **Note:** The native capture binary currently uses a hardcoded API URL (`https://api.dev.videodb.io`) and cannot be configured to use production. The SDK will be updated in a future release to support passing the base URL to the binary.

### 3. Run the App

```bash
npm run dev
```

Press `Ctrl+C` to stop.

## What This Script Does

1. **Connects to VideoDB** — Authenticates using your API key and connects to the specified collection.

2. **Establishes WebSocket** — Opens a real-time WebSocket connection for streaming events.

3. **Creates Capture Session** — Initializes a capture session with optional webhook callback for notifications.

4. **Requests Permissions** — Prompts for microphone and screen capture permissions via the native binary.

5. **Starts Recording** — Captures audio (microphone) and video (screen) streams.

6. **Real-time Indexing**:
   - **Audio Indexing** — Transcribes speech and summarizes spoken content in batches of 15 words.
   - **Visual Indexing** — Analyzes screen content every 3 seconds, identifying applications and user activity.

7. **Alert Detection** (requires `WEBHOOK_URL`):
   - Detects when IDEs (VSCode, IntelliJ, etc.) are visible
   - Detects terminal/console applications
   - Detects web browsers (Chrome, Firefox, Safari)
   - Sends webhook notifications when detected

8. **Streams Events** — Displays all real-time events (transcripts, scene descriptions, alerts) in the terminal.

## Requirements

- Node.js 18+
- Valid VideoDB API key
