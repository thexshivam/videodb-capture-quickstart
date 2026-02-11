const { app, BrowserWindow, Tray, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// Load .env from the fact-detector directory
const FACT_DETECTOR_DIR = path.resolve(__dirname, '..', '..', '..', 'fact-detector');
require('dotenv').config({ path: path.join(FACT_DETECTOR_DIR, '.env') });

// Also load local .env (overrides)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BACKEND_PORT = process.env.PORT || 5002;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

// State
let backendProcess = null;
let clientProcess = null;
let sseRequest = null;
let tray = null;
let popupWindow = null;

// SSE backoff state
let sseReconnectTimer = null;
let sseBackoffDelay = 2000;
const SSE_BACKOFF_INITIAL = 2000;
const SSE_BACKOFF_MULTIPLIER = 1.5;
const SSE_BACKOFF_MAX = 30000;

// ---------------------------------------------------------------------------
// Python process management
// ---------------------------------------------------------------------------

function getPythonPath() {
  const venvPython = path.join(FACT_DETECTOR_DIR, 'venv', 'bin', 'python');
  return venvPython;
}

function sendErrorToRenderer(title, detail) {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('error-message', { title, detail });
  }
}

function startBackend() {
  return new Promise((resolve, reject) => {
    if (backendProcess) {
      resolve();
      return;
    }

    const pythonPath = getPythonPath();
    console.log(`[BACKEND] Starting: ${pythonPath} backend.py`);

    backendProcess = spawn(pythonPath, ['backend.py'], {
      cwd: FACT_DETECTOR_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    backendProcess.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(`[BACKEND] ${text}`);
      if (!resolved && text.includes('[READY] Backend running')) {
        resolved = true;
        resolve();
      }
    });

    backendProcess.stderr.on('data', (data) => {
      process.stderr.write(`[BACKEND:ERR] ${data.toString()}`);
    });

    backendProcess.once('close', (code) => {
      console.log(`[BACKEND] Exited with code ${code}`);
      backendProcess = null;
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.webContents.send('backend-status', 'stopped');
      }
      // Cascade: kill client and disconnect SSE
      stopClient();
      disconnectSSE();
      sendErrorToRenderer('Backend crashed', `Backend process exited with code ${code}`);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Backend exited with code ${code}`));
      }
    });

    // Timeout after 60s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Backend failed to start within 60 seconds'));
      }
    }, 60000);
  });
}

function startClient(sourceType, target) {
  return new Promise((resolve, reject) => {
    if (clientProcess) {
      reject(new Error('Client already running'));
      return;
    }

    const choiceMap = { youtube: '1', meet: '2', local: '3', stream: '4' };
    const choice = choiceMap[sourceType];
    if (!choice) {
      reject(new Error(`Unknown source type: ${sourceType}`));
      return;
    }

    const pythonPath = getPythonPath();
    console.log(`[CLIENT] Starting: ${pythonPath} -u client.py (source=${sourceType})`);

    clientProcess = spawn(pythonPath, ['-u', 'client.py'], {
      cwd: FACT_DETECTOR_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resolved = false;

    // Automate the interactive menu (sanitize target to prevent stdin injection)
    const safeTarget = target.replace(/[\r\n]/g, '');
    try {
      clientProcess.stdin.write(`${choice}\n`);
      clientProcess.stdin.write(`${safeTarget}\n`);
      clientProcess.stdin.end();
    } catch (e) {
      console.error('[CLIENT] stdin write error:', e.message);
    }

    clientProcess.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(`[CLIENT] ${text}`);
      if (!resolved && text.includes('[CAPTURE] Recording')) {
        resolved = true;
        resolve();
      }
    });

    clientProcess.stderr.on('data', (data) => {
      process.stderr.write(`[CLIENT:ERR] ${data.toString()}`);
    });

    clientProcess.once('close', (code) => {
      console.log(`[CLIENT] Exited with code ${code}`);
      clientProcess = null;
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.webContents.send('session-status', 'stopped');
      }
      // Disconnect SSE on client crash
      disconnectSSE();
      if (code !== 0 && code !== null) {
        sendErrorToRenderer('Client crashed', `Client process exited with code ${code}`);
      }
      if (!resolved) {
        resolved = true;
        resolve(); // resolve even on failure so UI can update
      }
    });

    // Timeout after 120s (client waits up to ~30s for session active before capture starts)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 120000);
  });
}

function stopClient() {
  return new Promise((resolve) => {
    const proc = clientProcess;
    if (!proc) {
      resolve();
      return;
    }
    // Clear reference immediately to prevent double-stop
    clientProcess = null;
    console.log('[CLIENT] Sending SIGINT...');

    const timeout = setTimeout(() => {
      console.log('[CLIENT] Force killing...');
      try { proc.kill('SIGTERM'); } catch (e) { /* already dead */ }
      resolve();
    }, 10000);

    proc.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });

    proc.kill('SIGINT');
  });
}

function stopBackend() {
  return new Promise((resolve) => {
    const proc = backendProcess;
    if (!proc) {
      resolve();
      return;
    }
    // Clear reference immediately to prevent double-stop
    backendProcess = null;
    console.log('[BACKEND] Sending SIGTERM...');

    const timeout = setTimeout(() => {
      console.log('[BACKEND] Force killing...');
      try { proc.kill('SIGKILL'); } catch (e) { /* already dead */ }
      resolve();
    }, 5000);

    proc.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });

    proc.kill('SIGTERM');
  });
}

// ---------------------------------------------------------------------------
// SSE relay (main process -> renderer)
// ---------------------------------------------------------------------------

function connectSSE(lastId = 0) {
  disconnectSSE();

  const url = `${BACKEND_URL}/events`;
  console.log(`[SSE] Connecting to ${url} (last-id=${lastId})...`);

  const options = {
    headers: { 'Last-Event-ID': String(lastId) },
  };

  sseRequest = http.get(url, options, (res) => {
    if (res.statusCode !== 200) {
      console.error(`[SSE] Bad status: ${res.statusCode}`);
      sendErrorToRenderer('SSE connection failed', `Backend returned status ${res.statusCode}`);
      scheduleSSEReconnect(lastId);
      return;
    }

    console.log('[SSE] Connected.');
    // Reset backoff on successful connection
    sseBackoffDelay = SSE_BACKOFF_INITIAL;

    let buffer = '';
    let currentLastId = lastId;

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const messages = buffer.split('\n\n');
      buffer = messages.pop(); // keep incomplete message

      for (const msg of messages) {
        if (!msg.trim()) continue;

        let eventId = null;
        let eventData = null;

        for (const line of msg.split('\n')) {
          // Skip SSE comment lines (heartbeats)
          if (line.startsWith(':')) continue;

          if (line.startsWith('id: ')) {
            eventId = parseInt(line.slice(4), 10);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);
          }
        }

        if (eventData) {
          try {
            const parsed = JSON.parse(eventData);
            if (eventId) currentLastId = eventId;
            if (popupWindow && !popupWindow.isDestroyed()) {
              popupWindow.webContents.send('fact-check-alert', parsed);
            }
          } catch (e) {
            console.error('[SSE] Parse error:', e.message);
          }
        }
      }
    });

    res.on('end', () => {
      console.log('[SSE] Stream ended.');
      scheduleSSEReconnect(currentLastId);
    });

    res.on('error', (err) => {
      console.error('[SSE] Stream error:', err.message);
      scheduleSSEReconnect(currentLastId);
    });
  });

  sseRequest.on('error', (err) => {
    console.error('[SSE] Connection error:', err.message);
    scheduleSSEReconnect(lastId);
  });
}

function scheduleSSEReconnect(lastId) {
  if (sseReconnectTimer) return;
  console.log(`[SSE] Reconnecting in ${sseBackoffDelay}ms...`);
  sseReconnectTimer = setTimeout(() => {
    sseReconnectTimer = null;
    connectSSE(lastId);
  }, sseBackoffDelay);
  // Increase backoff for next failure
  sseBackoffDelay = Math.min(sseBackoffDelay * SSE_BACKOFF_MULTIPLIER, SSE_BACKOFF_MAX);
}

function disconnectSSE() {
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
  if (sseRequest) {
    sseRequest.destroy();
    sseRequest = null;
  }
  // Reset backoff on manual disconnect
  sseBackoffDelay = SSE_BACKOFF_INITIAL;
}

// ---------------------------------------------------------------------------
// Tray + Popover window
// ---------------------------------------------------------------------------

function createTray() {
  const iconPath = path.join(__dirname, 'img', 'trayTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.warn('[TRAY] Icon file empty, using fallback');
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhElEQVQ4T2NkoBAwUqifAacBf/78+c/AwMDIyMj4n5GR8T8jI+N/BgYGRkZGxv+MjIz/mf7+/f+fkZHxPwMDA+N/RkbG/4yMjIxMTEyM/xkZGf8zMjL+Z2Rk/M/IxMT0n5GR8T8jIyMjExMTIyMjIyMjIyPjfyYmpv+MjIyMjIyMjFQJQwD6vBkR2dNn9AAAAABJRU5ErkJggg=='
    );
  }
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Fact Detector');

  tray.on('click', () => {
    togglePopup();
  });
}

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 400,
    height: 580,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: true,
    backgroundColor: '#1e1e1e',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popupWindow.loadFile(path.join(__dirname, 'index.html'));
  popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // No blur-to-hide since the window is draggable/movable.
  // Users close via X button, Quit, or tray icon toggle.
}

function togglePopup() {
  if (!popupWindow) {
    console.log('[TRAY] No popup window');
    return;
  }

  if (popupWindow.isVisible()) {
    popupWindow.hide();
    return;
  }

  // Position below the tray icon
  const bounds = tray.getBounds();
  const windowBounds = popupWindow.getBounds();

  let x, y;
  if (bounds && bounds.x > 0) {
    x = Math.round(bounds.x + bounds.width / 2 - windowBounds.width / 2);
    y = bounds.y + bounds.height + 4;
  } else {
    const display = screen.getPrimaryDisplay();
    x = display.workArea.x + display.workArea.width - windowBounds.width - 10;
    y = display.workArea.y + 4;
  }

  popupWindow.setPosition(x, y, false);
  popupWindow.show();
  popupWindow.focus();
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('start-session', async (_event, { sourceType, target }) => {
  try {
    await startBackend();
    if (!sseRequest) {
      connectSSE();
    }
    await startClient(sourceType, target);
    return { success: true };
  } catch (err) {
    console.error('[IPC] start-session error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-session', async () => {
  try {
    disconnectSSE();
    await stopClient();
    return { success: true };
  } catch (err) {
    console.error('[IPC] stop-session error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-stats', async () => {
  try {
    return await fetchJSON(`${BACKEND_URL}/stats`);
  } catch (err) {
    return null;
  }
});

ipcMain.handle('check-health', async () => {
  try {
    return await fetchJSON(`${BACKEND_URL}/health`);
  } catch (err) {
    return null;
  }
});

ipcMain.handle('get-session-state', () => {
  return {
    backendRunning: backendProcess !== null,
    clientRunning: clientProcess !== null,
    sseConnected: sseRequest !== null,
  };
});

ipcMain.on('hide-window', () => {
  app.quit();
});

ipcMain.on('quit-app', () => {
  app.quit();
});

ipcMain.on('open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    const { shell } = require('electron');
    shell.openExternal(url);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); // drain response
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // Hide dock icon (tray-only app)
  if (app.dock) {
    app.dock.hide();
  }

  createTray();
  createPopupWindow();

  console.log('[APP] Fact Detector tray app ready. Click the tray icon to open.');
});

app.on('window-all-closed', (e) => {
  // No-op: tray-only app, don't quit
  e.preventDefault();
});

app.on('before-quit', async () => {
  console.log('[APP] Shutting down...');
  disconnectSSE();

  if (clientProcess) {
    await stopClient();
  }

  if (backendProcess) {
    // Give backend time to flush before stopping
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await stopBackend();
  }

  if (tray) {
    tray.destroy();
    tray = null;
  }
});
