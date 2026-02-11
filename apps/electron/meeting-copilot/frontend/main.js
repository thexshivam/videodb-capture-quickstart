/**
 * main.js - Lifecycle-based Architecture (Migrated to new SDK)
 *
 * STAGES:
 * 1. INIT - Load configs, register event listeners
 * 2. AUTH - Handled by renderer (auth modal)
 * 3. CONFIG - Handled by renderer (wizard, tunnel)
 * 4. READY - Idle, user can start session
 * 5. SESSION - Recording active, NO I/O allowed
 * 6. STOP - Cleanup
 */

const { app, BrowserWindow, ipcMain, shell, systemPreferences, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { CaptureClient } = require('videodb/capture');
const { connect } = require('videodb');
const express = require('express');
const http = require('http');
require('dotenv').config();

// =============================================================================
// VIDEODB WEBSOCKET (Client-side for real-time transcripts)
// =============================================================================

let videodbConnection = null;
let micWebSocket = null;
let sysAudioWebSocket = null;
let transcriptListenerActive = false;

/**
 * Setup WebSocket connections for real-time transcripts.
 * Returns: { micWsId, sysAudioWsId } or null if failed
 */
async function setupTranscriptWebSockets() {
  try {
    const sessionToken = await getSessionToken();
    if (!sessionToken) {
      console.warn('[WS] No session token');
      return null;
    }

    // Only pass baseUrl if explicitly set, otherwise SDK uses its default
    const connectOptions = { sessionToken };
    if (process.env.VIDEODB_API_URL) {
      connectOptions.baseUrl = process.env.VIDEODB_API_URL;
    }
    videodbConnection = connect(connectOptions);

    const [micWsResult, sysWsResult] = await Promise.all([
      (async () => {
        try {
          const wsConnection = await videodbConnection.connectWebsocket();
          micWebSocket = await wsConnection.connect();
          console.log('[WS] Mic WebSocket connected:', micWebSocket.connectionId);
          return { ws: micWebSocket, id: micWebSocket.connectionId };
        } catch (err) {
          console.error('[WS] Failed to create mic WebSocket:', err.message);
          return { ws: null, id: null };
        }
      })(),
      (async () => {
        try {
          const wsConnection = await videodbConnection.connectWebsocket();
          sysAudioWebSocket = await wsConnection.connect();
          console.log('[WS] SysAudio WebSocket connected:', sysAudioWebSocket.connectionId);
          return { ws: sysAudioWebSocket, id: sysAudioWebSocket.connectionId };
        } catch (err) {
          console.error('[WS] Failed to create sys_audio WebSocket:', err.message);
          return { ws: null, id: null };
        }
      })()
    ]);

    if (!micWsResult.id && !sysWsResult.id) {
      console.error('[WS] Failed to create any WebSocket connections');
      return null;
    }

    transcriptListenerActive = true;
    if (micWsResult.ws) listenForMessages(micWsResult.ws, 'mic');
    if (sysWsResult.ws) listenForMessages(sysWsResult.ws, 'system_audio');

    return { micWsId: micWsResult.id, sysAudioWsId: sysWsResult.id };
  } catch (err) {
    console.error('[WS] Error setting up WebSockets:', err);
    return null;
  }
}

/**
 * Listen for messages on a WebSocket and forward transcripts to renderer.
 */
async function listenForMessages(ws, source) {
  try {
    for await (const msg of ws.receive()) {
      if (!transcriptListenerActive) break;

      const channel = msg.channel || msg.type || msg.event_type || 'event';
      console.log(`[WS:${source}] ${channel.toUpperCase()} - ${JSON.stringify(msg).substring(0, 300)}`);

      if (channel === 'transcript' || msg.text) {
        const text = msg.text || msg.data?.text || '';
        const isFinal = msg.is_final ?? msg.isFinal ?? msg.data?.is_final ?? false;
        const transcriptSource = msg.source || msg.data?.source || source;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recorder-event', {
            event: 'transcript',
            data: { text, is_final: isFinal, source: transcriptSource }
          });
        }
      }
    }
  } catch (err) {
    if (transcriptListenerActive) {
      console.error(`[WS] Error in ${source} listener:`, err.message);
    }
  }
}

async function cleanupTranscriptWebSockets() {
  transcriptListenerActive = false;

  if (micWebSocket) {
    try { await micWebSocket.close(); } catch (e) { }
    micWebSocket = null;
  }

  if (sysAudioWebSocket) {
    try { await sysAudioWebSocket.close(); } catch (e) { }
    sysAudioWebSocket = null;
  }

  videodbConnection = null;
}

// =============================================================================
// RTSP RELAY (Low-Latency WebSocket Streaming)
// =============================================================================

let rtspRelayServer = null;
let rtspRelayPort = 9999;

async function startRtspRelay(rtspUrl) {
  if (rtspRelayServer) {
    console.log('RTSP relay already running');
    return { success: true, wsUrl: `ws://localhost:${rtspRelayPort}` };
  }

  try {
    const expressApp = express();
    const server = http.createServer(expressApp);

    const { proxy } = require('rtsp-relay')(expressApp, server);

    const handler = proxy({
      url: rtspUrl,
      verbose: false,
      transport: 'tcp'
    });

    expressApp.ws('/stream', handler);

    return new Promise((resolve, reject) => {
      server.listen(rtspRelayPort, () => {
        rtspRelayServer = server;
        console.log(`RTSP relay started on ws://localhost:${rtspRelayPort}/stream`);
        resolve({ success: true, wsUrl: `ws://localhost:${rtspRelayPort}/stream` });
      });

      server.on('error', (err) => {
        console.error('RTSP relay error:', err.message);
        reject({ success: false, error: err.message });
      });
    });
  } catch (err) {
    console.error('Failed to start RTSP relay:', err.message);
    return { success: false, error: err.message };
  }
}

function stopRtspRelay() {
  if (rtspRelayServer) {
    rtspRelayServer.close();
    rtspRelayServer = null;
    console.log('RTSP relay stopped');
  }
}

let mainWindow;

// CaptureClient instance (created per session)
let captureClient = null;

// =============================================================================
// CONFIGURATION (Loaded ONCE at Stage 1)
// =============================================================================

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const RUNTIME_FILE = path.join(__dirname, '..', 'runtime.json');
const AUTH_CONFIG_FILE = path.join(__dirname, '..', 'auth_config.json');

let appConfig = {
  accessToken: null,
  userName: null
};

let runtimeConfig = {
  backendBaseUrl: null,
  callbackUrl: null
};

// Session token cache
let cachedSessionToken = null;
let tokenExpiresAt = null;

// =============================================================================
// STAGE 1: CONFIG LOADING (Sync, ONE TIME)
// =============================================================================

function loadUserConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      appConfig = { ...appConfig, ...saved };
      console.log('User config loaded');
    }
  } catch (e) {
    console.error('Config load error:', e.message);
  }
}

function saveUserConfig(newConfig) {
  appConfig = { ...appConfig, ...newConfig };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2));
    return true;
  } catch (e) {
    console.error('Config save error:', e.message);
    return false;
  }
}

function loadRuntimeConfig() {
  try {
    if (fs.existsSync(RUNTIME_FILE)) {
      const data = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
      if (data.api_url) runtimeConfig.backendBaseUrl = data.api_url;
      if (data.webhook_url) runtimeConfig.callbackUrl = data.webhook_url;
      console.log('Runtime config loaded:', runtimeConfig.backendBaseUrl);
    }
  } catch (e) {
    console.error('Runtime config error:', e.message);
  }
}

// =============================================================================
// STAGE 1: AUTO-REGISTRATION (from auth_config.json)
// =============================================================================

async function autoRegisterFromConfig() {
  if (!fs.existsSync(AUTH_CONFIG_FILE)) return false;

  try {
    console.log('Found auth_config.json...');
    const authConfig = JSON.parse(fs.readFileSync(AUTH_CONFIG_FILE, 'utf8'));

    if (!authConfig.apiKey) {
      console.error('Missing apiKey in auth_config.json');
      return false;
    }

    const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
    const response = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: authConfig.name || 'Guest',
        api_key: authConfig.apiKey
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Auto-reg failed:', err.detail);
      return false;
    }

    const result = await response.json();
    // Store API key locally for client-side WebSocket connection
    saveUserConfig({ accessToken: result.access_token, userName: result.name, apiKey: authConfig.apiKey });

    // Cleanup
    fs.unlinkSync(AUTH_CONFIG_FILE);
    console.log('Auto-registration complete');
    return true;
  } catch (e) {
    console.error('Auto-reg error:', e.message);
    return false;
  }
}

// =============================================================================
// STAGE 1: SDK INITIALIZATION
// =============================================================================

async function initializeSDK() {
  try {
    console.log('VideoDB SDK Configuration:');
    console.log('- AUTH_STATUS:', appConfig.accessToken ? 'Connected' : 'Needs Connection');
    console.log('- BACKEND_BASE_URL:', runtimeConfig.backendBaseUrl);

    // CaptureClient is now created per-session when starting recording
    console.log('SDK ready (CaptureClient will be created per session)');
  } catch (e) {
    console.error('SDK init failed:', e.message);
  }
}

// Setup event listeners on the CaptureClient instance
function setupCaptureClientEvents(client) {
  client.on('recording:started', (data) => {
    console.log('SDK Event: recording:started', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'recording:started', data });
    }
  });

  client.on('recording:stopped', (data) => {
    console.log('SDK Event: recording:stopped', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'recording:stopped', data });
    }
  });

  client.on('recording:error', (data) => {
    console.log('SDK Event: recording:error', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'recording:error', data });
    }
  });

  client.on('transcript', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'transcript', data });
    }
  });

  client.on('upload:progress', (data) => {
    console.log('SDK Event: upload:progress', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'upload:progress', data });
    }
  });

  client.on('upload:complete', (data) => {
    console.log('SDK Event: upload:complete', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'upload:complete', data });
    }
  });

  client.on('error', (data) => {
    console.log('SDK Event: error', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'error', data });
    }
  });
}

// =============================================================================
// SESSION HANDLERS
// =============================================================================

async function getSessionToken() {
  if (cachedSessionToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedSessionToken;
  }

  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  if (!appConfig.accessToken) return null;

  try {
    const response = await fetch(`${baseUrl}/api/token`, {
      method: 'POST',
      headers: {
        'x-access-token': appConfig.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ user_id: 'electron-user' })
    });

    if (!response.ok) {
      if (response.status === 401) {
        mainWindow?.webContents.send('auth-required', { error: 'Session expired' });
      }
      return null;
    }

    const data = await response.json();
    if (data.session_token) {
      cachedSessionToken = data.session_token;
      tokenExpiresAt = Date.now() + ((data.expires_in || 3600) * 1000) - (5 * 60 * 1000);
      return cachedSessionToken;
    }
  } catch (e) {
    console.error('Token fetch error:', e.message);
  }
  return null;
}

ipcMain.handle('recorder-start-recording', async (_event, clientSessionId, config) => {
  try {
    console.log(`Starting recording: ${clientSessionId}`);

    const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
    const accessToken = appConfig.accessToken;

    if (!accessToken) {
      return { success: false, error: 'Not authenticated. Please register first.' };
    }

    const transcriptEnabled = config?.transcription?.enabled ?? true;

    // Create WebSocket connections for real-time transcripts
    let wsConnectionIds = null;
    if (transcriptEnabled) {
      wsConnectionIds = await setupTranscriptWebSockets();
      if (wsConnectionIds) {
        console.log(`[WS] IDs: mic=${wsConnectionIds.micWsId}, sysAudio=${wsConnectionIds.sysAudioWsId}`);
      }
    }

    // Create capture session on the server
    let captureSessionId;
    try {
      const createSessionResp = await fetch(`${baseUrl}/api/capture-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-token': accessToken },
        body: JSON.stringify({
          callback_url: runtimeConfig.callbackUrl,
          metadata: { clientSessionId, startedAt: Date.now() }
        })
      });

      if (!createSessionResp.ok) {
        const errText = await createSessionResp.text();
        console.error(`Failed to create capture session: ${createSessionResp.status} ${errText}`);
        return { success: false, error: 'Failed to create capture session on server' };
      }

      const sessionData = await createSessionResp.json();
      captureSessionId = sessionData.session_id;
      console.log(`Capture session: ${captureSessionId}`);
    } catch (err) {
      console.error('Error creating capture session:', err);
      return { success: false, error: 'Failed to create capture session: ' + err.message };
    }

    // Get session token and create CaptureClient
    const sessionToken = await getSessionToken();
    if (!sessionToken) {
      return { success: false, error: 'Failed to get session token. Please register first.' };
    }

    // Only pass apiUrl if explicitly set, otherwise SDK uses its default
    const captureOptions = { sessionToken };
    if (process.env.VIDEODB_API_URL) {
      captureOptions.apiUrl = process.env.VIDEODB_API_URL;
    }
    captureClient = new CaptureClient(captureOptions);
    setupCaptureClientEvents(captureClient);

    // List and select channels
    let channels = [];
    try {
      channels = await captureClient.listChannels();
    } catch (err) {
      console.error('Failed to list channels:', err);
      return { success: false, error: 'Failed to list capture channels' };
    }

    const captureChannels = [];

    const micChannel = channels.find(ch => ch.type === 'audio' && ch.channelId.startsWith('mic:'));
    if (micChannel) {
      captureChannels.push({
        channelId: micChannel.channelId,
        type: 'audio',
        record: true,
        transcript: transcriptEnabled,
      });
    }

    const systemAudioChannel = channels.find(ch => ch.type === 'audio' && ch.channelId.startsWith('system_audio:'));
    if (systemAudioChannel) {
      captureChannels.push({
        channelId: systemAudioChannel.channelId,
        type: 'audio',
        record: true,
        transcript: transcriptEnabled,
      });
    }

    const displayChannel = channels.find(ch => ch.type === 'video');
    if (displayChannel) {
      captureChannels.push({
        channelId: displayChannel.channelId,
        type: 'video',
        record: true,
      });
    }

    if (captureChannels.length === 0) {
      return { success: false, error: 'No capture channels available. Check permissions.' };
    }

    // Start capture session
    await captureClient.startCaptureSession({ sessionId: captureSessionId, channels: captureChannels });
    console.log('Capture session started');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'recording:started',
        data: { sessionId: captureSessionId }
      });
    }

    // 8. Call backend to start transcription with WebSocket IDs
    // Backend will poll for RTStreams and call start_transcript with ws_connection_ids
    if (transcriptEnabled && wsConnectionIds) {
      console.log('[WS] Calling backend /api/start-transcription...');
      fetch(`${baseUrl}/api/start-transcription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken
        },
        body: JSON.stringify({
          session_id: captureSessionId,
          mic_ws_connection_id: wsConnectionIds.micWsId || null,
          sys_audio_ws_connection_id: wsConnectionIds.sysAudioWsId || null
        })
      })
        .then(resp => resp.json())
        .then(result => console.log('[WS] ✅ Backend accepted transcription request:', result.status))
        .catch(err => console.error('[WS] Failed to call backend:', err.message));
    }

    return { success: true, sessionId: captureSessionId };
  } catch (e) {
    console.error('Start error:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('recorder-stop-recording', async (_event, sessionId) => {
  try {
    console.log(`Stopping recording for session: ${sessionId}`);

    if (captureClient) {
      await captureClient.stopCaptureSession();
      console.log('Capture session stopped');

      // Shutdown the capture client to release the binary
      try {
        await captureClient.shutdown();
        console.log('CaptureClient shutdown complete');
      } catch (shutdownErr) {
        console.warn('CaptureClient shutdown warning:', shutdownErr.message);
      }
      captureClient = null;

      // Manually emit recording:stopped event to update UI
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recorder-event', {
          event: 'recording:stopped',
          data: { sessionId }
        });
      }
    } else {
      console.warn('No active capture client to stop');
    }

    // Cleanup transcript WebSockets
    await cleanupTranscriptWebSockets();

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('recorder-pause-tracks', async (_event, _sessionId, tracks) => {
  try {
    console.log(`Pausing tracks:`, tracks);

    if (captureClient) {
      await captureClient.pauseTracks(tracks);
    } else {
      throw new Error('No active capture client');
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('recorder-resume-tracks', async (_event, _sessionId, tracks) => {
  try {
    console.log(`Resuming tracks:`, tracks);

    if (captureClient) {
      await captureClient.resumeTracks(tracks);
    } else {
      throw new Error('No active capture client');
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// =============================================================================
// PERMISSIONS
// =============================================================================

ipcMain.handle('recorder-request-permission', async (_event, type) => {
  try {
    console.log(`Requesting permission: ${type}`);

    const permissionMap = {
      'microphone': 'microphone',
      'screen': 'screen-capture',
      'screen-capture': 'screen-capture',
      'accessibility': 'accessibility'
    };

    const sdkPermission = permissionMap[type] || type;

    if (!captureClient) {
      const sessionToken = await getSessionToken();
      if (sessionToken) {
        // Only pass apiUrl if explicitly set, otherwise SDK uses its default
        const tempOptions = { sessionToken };
        if (process.env.VIDEODB_API_URL) {
          tempOptions.apiUrl = process.env.VIDEODB_API_URL;
        }
        const tempClient = new CaptureClient(tempOptions);
        const result = await tempClient.requestPermission(sdkPermission);
        await tempClient.shutdown();
        return { success: true, status: result };
      }
      return { success: true, status: 'undetermined' };
    }

    const result = await captureClient.requestPermission(sdkPermission);
    return { success: true, status: result };
  } catch (error) {
    console.error('Error requesting permission:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-mic-permission', () => systemPreferences.getMediaAccessStatus('microphone'));
ipcMain.handle('check-screen-permission', () => systemPreferences.getMediaAccessStatus('screen'));
ipcMain.handle('check-accessibility-permission', () => systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied');

ipcMain.handle('request-mic-permission', async () => {
  const granted = await systemPreferences.askForMediaAccess('microphone');
  return { granted, status: granted ? 'granted' : 'denied' };
});

ipcMain.handle('open-system-settings', async (_event, type) => {
  const urls = {
    mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  };
  if (urls[type]) await shell.openExternal(urls[type]);
});

// =============================================================================
// CONFIG & TUNNEL
// =============================================================================

ipcMain.handle('get-settings', () => ({
  ...appConfig,
  ...runtimeConfig,
  isConnected: !!appConfig.accessToken
}));

ipcMain.handle('register', async (_event, { name, apiKey }) => {
  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  try {
    const response = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, api_key: apiKey })
    });

    if (!response.ok) {
      const err = await response.json();
      return { success: false, error: err.detail || 'Failed' };
    }

    const result = await response.json();
    // Store API key locally for client-side WebSocket connection
    saveUserConfig({ accessToken: result.access_token, userName: result.name, apiKey });
    return { success: true, userName: result.name };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('check-tunnel-status', async () => {
  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  try {
    const resp = await fetch(`${baseUrl}/api/tunnel/status`);
    return await resp.json();
  } catch (e) {
    return { active: false, webhook_url: null };
  }
});

// Verify connection/auth token logic
ipcMain.handle('verify-connection', async () => {
  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  try {
    const resp = await fetch(`${baseUrl}/api/config`, {
      headers: { 'x-access-token': appConfig.accessToken || '' }
    });

    if (resp.status === 401) {
      return { success: false, error: 'UNAUTHORIZED' };
    }

    if (!resp.ok) {
      return { success: false, error: 'API_ERROR' };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});


// =============================================================================
// MISC HANDLERS
// =============================================================================

ipcMain.handle('recorder-logout', async () => {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  appConfig = { accessToken: null, userName: null };
  cachedSessionToken = null;
  tokenExpiresAt = null;

  // Cleanup capture client
  if (captureClient) {
    try {
      await captureClient.shutdown();
    } catch (e) { }
    captureClient = null;
  }

  return { success: true };
});

ipcMain.handle('get-recordings', async () => {
  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  try {
    const resp = await fetch(`${baseUrl}/api/recordings`, {
      headers: { 'x-access-token': appConfig.accessToken || '' }
    });
    return await resp.json();
  } catch (e) {
    return [];
  }
});

// Recording Lifecycle Handlers
ipcMain.handle('start-recording', async (_event, sessionId) => {
  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  try {
    const resp = await fetch(`${baseUrl}/api/recordings/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': appConfig.accessToken || ''
      },
      body: JSON.stringify({ session_id: sessionId })
    });
    return await resp.json();
  } catch (e) {
    console.error('[Recording] Start failed:', e);
    return { error: e.message };
  }
});

ipcMain.handle('stop-recording', async (_event, sessionId) => {
  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  try {
    const resp = await fetch(`${baseUrl}/api/recordings/${sessionId}/stop`, {
      method: 'POST',
      headers: { 'x-access-token': appConfig.accessToken || '' }
    });
    return await resp.json();
  } catch (e) {
    console.error('[Recording] Stop failed:', e);
    return { error: e.message };
  }
});


ipcMain.handle('show-meeting-notification', async () => {
  const notification = new Notification({
    title: 'Meeting Detected',
    body: 'Would you like to start recording?',
    actions: [{ type: 'button', text: 'Start Recording' }]
  });
  notification.on('action', (_, index) => {
    if (index === 0 && mainWindow) mainWindow.webContents.send('start-session-from-notification');
  });
  notification.show();
  return { success: true };
});

ipcMain.handle('open-player-window', async (_event, streamUrl) => {
  const win = new BrowserWindow({
    width: 900, height: 600, title: 'Video Player',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'player.html'), { query: { url: streamUrl } });
  return { success: true };
});

ipcMain.handle('open-external-link', async (_event, url) => {
  await shell.openExternal(url);
});

// RTSP Relay IPC handlers
ipcMain.handle('start-rtsp-relay', async (_event, rtspUrl) => {
  return await startRtspRelay(rtspUrl);
});

ipcMain.handle('stop-rtsp-relay', async () => {
  stopRtspRelay();
  return { success: true };
});

// =============================================================================
// LIFECYCLE
// =============================================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080, height: 820, minWidth: 700, minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  // 1. Load configs (SYNC)
  loadUserConfig();
  loadRuntimeConfig();

  // 2. Auto-register (Prioritize if auth_config.json exists)
  await autoRegisterFromConfig();

  // 3. Init SDK
  await initializeSDK();

  // 4. Create Window
  createWindow();
});

let isShuttingDown = false;

async function shutdownApp() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('Shutting down...');

  try {
    if (captureClient) {
      await captureClient.shutdown();
      captureClient = null;
      console.log('CaptureClient shutdown complete');
    }
  } catch (e) {
    console.error('Error during SDK shutdown:', e);
  }
}

app.on('window-all-closed', async () => {
  await shutdownApp();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    await shutdownApp();
    app.exit(0);
  }
});

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT (Ctrl+C)');
  await shutdownApp();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM');
  await shutdownApp();
  process.exit(0);
});
