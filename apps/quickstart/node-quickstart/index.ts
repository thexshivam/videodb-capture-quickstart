import 'dotenv/config';
import {
  connect,
  type ChannelConfig,
  type WebSocketMessage,
} from 'videodb';
import { CaptureClient } from 'videodb/capture';

const API_KEY = process.env.VIDEODB_API_KEY;
const COLLECTION_ID = process.env.VIDEODB_COLLECTION_ID || 'default';
const BASE_URL = process.env.VIDEODB_BASE_URL || 'https://api.videodb.io';
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!API_KEY) {
  throw new Error('VIDEODB_API_KEY is required. Set it in your .env file.');
}

if (!WEBHOOK_URL) {
  console.warn('\x1b[33m⚠ WEBHOOK_URL not set. Alerts will not be created.\x1b[0m');
}

const timestamp = () => new Date().toISOString().split('T')[1].split('.')[0];
const log = (prefix: string, msg: string, data?: unknown) => {
  const ts = `\x1b[90m[${timestamp()}]\x1b[0m`;
  if (data) {
    console.log(`${ts} ${prefix} ${msg}`, data);
  } else {
    console.log(`${ts} ${prefix} ${msg}`);
  }
};

const info = (msg: string, data?: unknown) => log('\x1b[36mℹ\x1b[0m', msg, data);
const success = (msg: string, data?: unknown) => log('\x1b[32m✓\x1b[0m', msg, data);
const warn = (msg: string, data?: unknown) => log('\x1b[33m⚠\x1b[0m', msg, data);
const error = (msg: string, data?: unknown) => log('\x1b[31m✗\x1b[0m', msg, data);

const eventColors: Record<string, string> = {
  transcript: '\x1b[35m',
  scene_index: '\x1b[34m',
  spoken_index: '\x1b[33m',
  capture_session: '\x1b[32m',
  alert: '\x1b[31m',
  default: '\x1b[37m',
};

const appIcons: Record<string, string> = {
  vscode: '💻',
  'visual studio': '💻',
  intellij: '💻',
  terminal: '🖥️',
  iterm: '🖥️',
  chrome: '🌐',
  firefox: '🌐',
  safari: '🌐',
  browser: '🌐',
  slack: '💬',
  discord: '💬',
  default: '🎬',
};

function getAppIcon(text: string): string {
  const lower = text.toLowerCase();
  for (const [app, icon] of Object.entries(appIcons)) {
    if (lower.includes(app)) return icon;
  }
  return appIcons.default;
}

function formatEvent(msg: WebSocketMessage): string {
  const channel = (msg.channel || msg.type || msg.event_type || 'event') as string;
  const color = eventColors[channel] || eventColors.default;
  const reset = '\x1b[0m';
  
  let output = `${color}[${channel.toUpperCase()}]${reset}`;
  
  if (channel === 'transcript' || msg.text) {
    const text = msg.text || (msg.data as Record<string, unknown>)?.text;
    const isFinal = msg.is_final ?? msg.isFinal ?? (msg.data as Record<string, unknown>)?.is_final;
    output += ` ${isFinal ? '📝' : '🎤'} "${text}"`;
  } else if (channel === 'scene_index') {
    const data = msg.data as Record<string, unknown>;
    const desc = data?.text as string;
    const icon = getAppIcon(desc || '');
    output += ` ${icon} ${desc}`;
    
    const summary = msg.summary || (msg.data as Record<string, unknown>)?.summary;
    if (summary) {
      output += `\n       └─ 📋 Summary: ${summary}`;
    }
  } else if (channel === 'spoken_index') {
    const summary = msg.summary || (msg.data as Record<string, unknown>)?.summary;
    output += ` 💬 ${summary}`;
  } else if (channel === 'alert') {
    const label = (msg.label || (msg.data as Record<string, unknown>)?.label) as string;
    const eventName = (msg.event_name || (msg.data as Record<string, unknown>)?.event_name) as string;
    
    if (eventName?.includes('ide') || label?.toLowerCase().includes('vscode')) {
      output += ` 💻 IDE Detected: ${label}`;
    } else if (eventName?.includes('terminal') || label?.toLowerCase().includes('terminal')) {
      output += ` 🖥️ Terminal Detected: ${label}`;
    } else if (eventName?.includes('browser') || label?.toLowerCase().includes('browser')) {
      output += ` 🌐 Browser Detected: ${label}`;
    } else {
      output += ` 🚨 Alert: ${label}`;
    }
  } else {
    const { connection_id, ...rest } = msg;
    output += ` ${JSON.stringify(rest)}`;
  }
  
  return output;
}

async function main() {
  console.log('\n\x1b[1m╔════════════════════════════════════════════════════════════╗');
  console.log('║   VideoDB CaptureSession Live Demo                         ║');
  console.log('║   Press Ctrl+C to stop                                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\x1b[0m\n');

  info('Connecting to VideoDB...');
  const conn = connect({ apiKey: API_KEY, baseUrl: BASE_URL });
  
  const usage = await conn.checkUsage();
  const userId = (usage.userId as string) || 'demo-user';
  success(`Connected as user: ${userId}`);

  const coll = await conn.getCollection(COLLECTION_ID);
  success(`Using collection: ${coll.id}`);

  info('Connecting WebSocket for real-time events...');

  const ws = await conn.connectWebsocket(COLLECTION_ID);
  await ws.connect();
  success(`WebSocket connected: ${ws.connectionId}`);


  info('Creating capture session...');
  const session = await coll.createCaptureSession({
    endUserId: userId,
    ...(WEBHOOK_URL && { callbackUrl: WEBHOOK_URL }),
    wsConnectionId: ws.connectionId,
    metadata: { demo: true, startedAt: Date.now() },
  });
  success(`Capture session created: ${session.id}`);

  const token = await conn.generateClientToken(3600);
  success('Client token generated (1 hour expiry)');

  info('Initializing CaptureClient...');
  // Note: CaptureClient currently doesn't support passing baseUrl to the binary
  // The binary uses its hardcoded default (https://api.dev.videodb.io)
  // TODO: Update SDK to support baseUrl parameter once available
  const client = new CaptureClient({ sessionToken: token });

  client.on('recording:started', (payload) => {
    success('Recording started', payload);
  });

  client.on('recording:stopped', (payload) => {
    warn('Recording stopped', payload);
  });

  client.on('recording:error', (payload) => {
    error('Recording error', payload);
  });

  client.on('transcript', (payload) => {
    const { text, isFinal } = payload as { text: string; isFinal: boolean };
    log(isFinal ? '\x1b[35m📝\x1b[0m' : '\x1b[35m🎤\x1b[0m', `Transcript: "${text}"`);
  });

  client.on('upload:progress', (payload) => {
    const { channelId, progress } = payload as { channelId: string; progress: number };
    info(`Upload progress [${channelId}]: ${Math.round(progress * 100)}%`);
  });

  client.on('upload:complete', (payload) => {
    success('Upload complete', payload);
  });

  info('Requesting permissions...');
  try {
    const micPerm = await client.requestPermission('microphone');
    success(`Microphone permission: ${micPerm}`);
  } catch (e) {
    warn('Microphone permission request failed (binary may not be running)');
  }

  try {
    const screenPerm = await client.requestPermission('screen-capture');
    success(`Screen capture permission: ${screenPerm}`);
  } catch (e) {
    warn('Screen capture permission request failed');
  }

  info('Listing available channels...');
  let channels: Array<{ channelId: string; type: 'audio' | 'video'; name: string }> = [];
  try {
    channels = await client.listChannels();
    console.log('\n  Available channels:');
    for (const ch of channels) {
      console.log(`    • ${ch.channelId} (${ch.type}): ${ch.name}`);
    }
    console.log('');
  } catch (e) {
    warn('Could not list channels (binary may not be running)');
  }

  const captureChannels: ChannelConfig[] = [];
  const micChannel = channels.find(ch => ch.type === 'audio' && ch.channelId.startsWith('mic:'));
  const displayChannel = channels.find(ch => ch.type === 'video');

  if (micChannel) {
    captureChannels.push({
      channelId: micChannel.channelId,
      type: 'audio',
      record: true,
      transcript: true,
    });
  }
  if (displayChannel) {
    captureChannels.push({
      channelId: displayChannel.channelId,
      type: 'video',
      record: true,
    });
  }

  if (captureChannels.length > 0) {
    info(`Starting capture with channels: ${captureChannels.map(c => c.channelId).join(', ')}`);
    try {
      const capturePromise = client.startCaptureSession({
        sessionId: session.id,
        channels: captureChannels,
      });

      await capturePromise;
      success('Capture session started!');

      info('Waiting for session to become active...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      await session.refresh();
      success(`Session status: ${session.status}`);
      success(`RTStreams available: ${session.rtstreams.length}`);

      const audioStream = session.rtstreams.find(rts => 
        rts.mediaTypes?.includes('audio') || rts.channelId?.includes('mic')
      );
      const videoStream = session.rtstreams.find(rts => 
        rts.mediaTypes?.includes('video') || rts.channelId?.includes('display')
      );

      if (audioStream) {
        info(`Setting up index spoken words for audio stream: ${audioStream.id}`);
        try {
          const spokenIndex = await audioStream.indexAudio({
            batchConfig: { type: 'word', value: 15 },
            prompt: 'Summarize what is being said, identify key topics and action items',
            socketId: ws.connectionId,
          });
          if (spokenIndex) {
            success(`Spoken word indexing started: ${spokenIndex.rtstreamIndexId}`);
          }
        } catch (e) {
          error('Failed to start transcript', e);
        }
      }

      if (videoStream) {
        info(`Setting up visual indexing for video stream: ${videoStream.id}`);
        try {
          const sceneIndex = await videoStream.indexVisuals({
            batchConfig: { type: 'time', value: 3, frameCount: 3 },
            prompt: `Analyze the screen and provide a summary. Always identify:
- Application in use (VSCode, Terminal, Browser, Slack, etc.)
- What the user is doing (coding, browsing, chatting, etc.)
- Key visible content (file names, URLs, code snippets, etc.)
Format: "[APP_NAME] - [ACTION] - [DETAILS]"`,
            socketId: ws.connectionId,
          });
          if (sceneIndex) {
            success(`Visual indexing started: ${sceneIndex.rtstreamIndexId}`);

            if (WEBHOOK_URL) {
              try {
                const ideEventId = await conn.createEvent(
                  'Detect when VSCode, Visual Studio, IntelliJ, or any code editor/IDE is visible on screen',
                  'ide_detected'
                );
                if (ideEventId) {
                  await sceneIndex.createAlert(ideEventId, WEBHOOK_URL);
                  success(`Alert created for IDE detection (eventId: ${ideEventId})`);
                } else {
                  warn('Failed to create IDE event - no eventId returned');
                }

                const terminalEventId = await conn.createEvent(
                  'Detect when Terminal, iTerm, Command Prompt, or any shell/console is visible',
                  'terminal_detected'
                );
                if (terminalEventId) {
                  await sceneIndex.createAlert(terminalEventId, WEBHOOK_URL);
                  success(`Alert created for Terminal detection (eventId: ${terminalEventId})`);
                } else {
                  warn('Failed to create Terminal event - no eventId returned');
                }

                const browserEventId = await conn.createEvent(
                  'Detect when Chrome, Firefox, Safari, or any web browser is visible',
                  'browser_detected'
                );
                if (browserEventId) {
                  await sceneIndex.createAlert(browserEventId, WEBHOOK_URL);
                  success(`Alert created for Browser detection (eventId: ${browserEventId})`);
                } else {
                  warn('Failed to create Browser event - no eventId returned');
                }
              } catch (e) {
                warn('Could not create detection events', e);
              }
            }
          }
        } catch (e) {
          error('Failed to start visual indexing', e);
        }
      }

    } catch (e) {
      error('Failed to start capture', e);
      if (e instanceof Error && e.message.includes('timed out')) {
        error('Capture session timed out. Exiting.');
        process.exit(1);
      }
    }
  } else {
    warn('No channels available - running in WebSocket-only mode');
    warn('Make sure the native binary is running for full functionality');
  }

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log('\n');
    info('Shutting down...');
    
    try {
      await client.stopCaptureSession();
      success('Capture stopped');
    } catch (e) {}

    try {
      await client.shutdown();
      success('Client shutdown');
    } catch (e) {}

    try {
      await ws.close();
      success('WebSocket closed');
    } catch (e) {}

    console.log('\n\x1b[1m✨ Demo complete!\x1b[0m\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log('\x1b[1m  📡 Streaming real-time events (Ctrl+C to stop)\x1b[0m');
  console.log('\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

  try {
    for await (const msg of ws.receive()) {
      if (isShuttingDown) break;
      
      const formatted = formatEvent(msg);
      console.log(`\x1b[90m[WEBSOCKETSTREAM:${timestamp()}]\x1b[0m ${formatted}`);
    }
  } catch (e) {
    if (!isShuttingDown) {
      error('WebSocket stream error', e);
    }
  }

  if (!isShuttingDown) {
    warn('WebSocket connection closed unexpectedly');
    await shutdown();
  }
}

main().catch(e => {
  error('Fatal error', e);
  process.exit(1);
});
