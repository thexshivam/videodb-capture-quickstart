# Meeting Copilot

A meeting recording app with real-time transcription, built with Electron and the VideoDB Capture SDK.

## Features

- Screen, microphone, and system audio capture
- Real-time transcription via WebSocket
- AI-powered meeting insights
- Recording history with playback

## Quick Start

```bash
# Install dependencies and configure API key
npm install
npm run setup -- --api-key YOUR_VIDEODB_API_KEY

# Start the app (backend + Electron)
npm start
```

## Project Structure

```
meeting-copilot/
├── frontend/     # Electron app (UI, IPC handlers)
├── server/       # FastAPI backend (auth, webhooks, VideoDB)
└── scripts/      # Setup and startup scripts
```

## Permissions (macOS)

Grant in **System Settings → Privacy & Security**:
- Microphone
- Screen Recording

## Reset

```bash
rm -rf server/venv node_modules users.db runtime.json
npm run setup -- --api-key YOUR_API_KEY
```

## License

MIT
