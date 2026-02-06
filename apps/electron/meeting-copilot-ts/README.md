# Meeting Copilot - TypeScript

A state-of-the-art Electron desktop app for recording meetings with real-time transcription and AI-powered insights, built with TypeScript.

## Features

- **Screen & Audio Recording** - Capture screen, microphone, and system audio
- **Real-time Transcription** - Live speech-to-text as you record
- **AI Insights** - Automatic meeting summaries and action items
- **Modern UI** - Built with React, Tailwind CSS, and shadcn/ui
- **Type-safe API** - End-to-end type safety with tRPC
- **Local Database** - SQLite with Drizzle ORM for offline-first storage

## Tech Stack

- **Electron 34** - Desktop application shell
- **TypeScript 5.8** - Full type coverage
- **React 19** - Modern UI framework
- **Tailwind CSS** - Utility-first styling
- **shadcn/ui** - High-quality component primitives
- **tRPC 11** - Type-safe API layer
- **Hono** - Fast HTTP server
- **Drizzle ORM** - Type-safe database operations
- **Zustand** - Lightweight state management
- **Vite** - Fast frontend bundling

## Prerequisites

- Node.js 20+
- npm 10+
- macOS 12+ (for screen recording permissions)
- [VideoDB](https://videodb.io) API key

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development mode:**
   ```bash
   npm run dev
   ```

3. **Open the app and register with your VideoDB API key**

## Development

### Available Scripts

- `npm run dev` - Start development mode (main + renderer)
- `npm run build` - Build for production
- `npm run dist` - Build and package as .dmg
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Run ESLint

### Project Structure

```
src/
├── main/                   # Electron Main Process
│   ├── server/            # HTTP server (Hono + tRPC)
│   ├── services/          # Business logic
│   ├── db/                # Database layer (Drizzle)
│   ├── ipc/               # IPC handlers
│   └── lib/               # Utilities
├── preload/               # Preload scripts
├── renderer/              # React Frontend
│   ├── components/        # UI components
│   ├── stores/            # Zustand stores
│   ├── hooks/             # Custom hooks
│   └── api/               # tRPC client
└── shared/                # Shared types & schemas
    ├── schemas/           # Zod validation schemas
    └── types/             # TypeScript types
```

## Building for Distribution

```bash
npm run dist:mac
```

This creates a `.dmg` file in the `release/` directory.

## Permissions

On macOS, the app requires:
- **Microphone Access** - For voice recording
- **Screen Recording** - For screen capture
- **Accessibility** - For system audio capture

Grant these in System Preferences > Privacy & Security.

## Architecture

### API Layer (tRPC + Hono)

The embedded HTTP server uses Hono for the web framework and tRPC for type-safe API endpoints:

- `/api/trpc/*` - tRPC endpoints for app operations
- `/api/webhook` - Raw Hono route for VideoDB webhooks

### State Management

- **Zustand** stores for client-side state (session, config, transcription)
- **React Query** for server state caching via tRPC

### IPC Communication

Type-safe IPC between renderer and main process:
- `window.electronAPI.capture.*` - Recording controls
- `window.electronAPI.permissions.*` - Permission management
- `window.electronAPI.app.*` - App utilities

## License

MIT
