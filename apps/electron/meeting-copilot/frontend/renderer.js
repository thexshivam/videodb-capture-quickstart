/**
 * renderer.js - Lifecycle-based Renderer (Copilot)
 *
 * STAGES (in order):
 * 1. AUTH - Check connection, show modal if needed
 * 2. CONFIG - Check permissions (wizard)
 * 3. READY - User can start session
 * 4. SESSION - Recording active
 */

import { addLog } from './src/utils/logger.js';
import { initSidebar, setSessionActive, setSessionLoading, resetSessionUI } from './src/ui/sidebar.js';
import { handleTranscriptionEvent } from './src/ui/transcription.js';
import { permissionUtil } from './src/utils/permissions.js';
import { initTabs } from './src/ui/tabs.js';
import { initHistoryLogic } from './src/ui/history.js';
import { initPlayerUI, startStream, stopStream } from './src/ui/live-player.js';

// =============================================================================
// STATE
// =============================================================================

let sessionStartTime = null;
let sessionTimerInterval = null;
let livePreviewEnabled = true; // Enable live preview by default

// =============================================================================
// STAGE 5: EVENT HANDLER
// =============================================================================

if (!window.hasRegisteredRecorderEvents) {
  window.hasRegisteredRecorderEvents = true;

  window.recorderAPI.onRecorderEvent(async (eventData) => {
    const { event, data } = eventData;
    console.log('[Recorder Event]', event, data);

    switch (event) {
      // New SDK event names (colon-separated)
      case 'transcript':
        console.log('[DEBUG] Renderer received transcript event:', data);
        handleTranscriptionEvent(data);
        break;
      case 'recording:started':
        addLog(`Recording started: ${data.sessionId}`, 'success');
        setSessionActive(data.sessionId);
        startTimer();
        // Try to start live preview
        await handleRecordingStarted(data);
        break;
      case 'recording:stopped':
        addLog(`Recording stopped: ${data.sessionId}`, 'info');
        stopTimer();
        resetSessionUI();
        // Stop the live stream
        await stopStream();
        break;
      case 'recording:error':
        addLog(`Recording error: ${data.error || data.message || 'Unknown error'}`, 'error');
        stopTimer();
        resetSessionUI();
        await stopStream();
        break;
      case 'upload:progress':
        console.log(`Upload progress: ${data.channelId} - ${Math.round((data.progress || 0) * 100)}%`);
        break;
      case 'upload:complete':
        addLog(`Upload complete`, 'success');
        break;
      case 'error':
        addLog(`Error: ${data.message || 'Unknown error'}`, 'error');
        break;
      default:
        break;
    }
  });
}

/**
 * Handle recording started - extract RTSP URL and start live preview.
 */
async function handleRecordingStarted(data) {
  // Extract RTSP URL from streams array (prefer screen channel for video preview)
  let rtspUrl = null;

  if (data.streams && Array.isArray(data.streams)) {
    // Look for the screen channel first (video preview)
    const screenChannel = data.streams.find(c => c.channel === 'screen');
    if (screenChannel && screenChannel.rtspUrl) {
      rtspUrl = screenChannel.rtspUrl;
    }
    // Fallback to any channel with an RTSP URL
    if (!rtspUrl) {
      const anyChannel = data.streams.find(c => c.rtspUrl);
      if (anyChannel) {
        rtspUrl = anyChannel.rtspUrl;
      }
    }
  }

  // Also check legacy top-level properties
  if (!rtspUrl) {
    rtspUrl = data.rtspUrl || data.rtsp_url || data.streamUrl || data.stream_url;
  }

  if (!rtspUrl) {
    console.log('[LivePlayer] No RTSP URL in recording-started event. Streams:', data.streams);
    return;
  }

  console.log('[LivePlayer] RTSP URL:', rtspUrl);

  // Start live preview
  if (livePreviewEnabled) {
    addLog('🎬 Starting live preview...', 'info');
    const result = await startStream(rtspUrl);
    if (result.success) {
      addLog('📺 Live preview active', 'success');
    } else {
      addLog(`⚠️ Preview failed: ${result.error}`, 'warning');
    }
  }
}

// Listen for notification action to start session
window.recorderAPI.onStartFromNotification(() => {
  console.log('Received: Start session from notification');
  startSessionFlow();
});

// =============================================================================
// TIMER
// =============================================================================

function startTimer() {
  stopTimer();
  sessionStartTime = Date.now();
  updateTimerDisplay();
  sessionTimerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
  sessionStartTime = null;
  const el = document.getElementById('recordingTimer');
  if (el) {
    el.textContent = '00:00:00';
    el.classList.remove('active');
  }
}

function updateTimerDisplay() {
  if (!sessionStartTime) return;
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
  const mins = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');

  const el = document.getElementById('recordingTimer');
  if (el) {
    el.textContent = `${hours}:${mins}:${secs}`;
    el.classList.add('active');
  }
}

// =============================================================================
// SESSION FLOW
// =============================================================================

async function startSessionFlow() {
  const sessionId = 'session-' + Date.now();
  addLog('Starting session...', 'info');
  setSessionLoading();

  try {
    const result = await window.recorderAPI.startSession(sessionId, {
      transcription: { enabled: true }
    });

    if (!result.success) {
      addLog(`Error: ${result.error}`, 'error');
      resetSessionUI();
    }
  } catch (e) {
    addLog(`Start error: ${e.message}`, 'error');
    resetSessionUI();
  }
}

// =============================================================================
// LIFECYCLE STAGES
// =============================================================================

async function checkAuth() {
  const config = await window.configAPI.getConfig();

  // If locally considered connected, verify with backend
  if (config.isConnected) {
    const verify = await window.configAPI.verifyConnection();
    if (!verify.success && verify.error === 'UNAUTHORIZED') {
      addLog('⚠️ Session expired or invalid. Please re-login.', 'warning');
      // Treat as unconnected
      config.isConnected = false;
      // Optionally update local config to reflect disconnection?
      // window.configAPI.logout(); // This might reload the page, loop?
      // Let's just fall through to showAuthModal
    }
  }

  if (!config.isConnected) {
    addLog('🔑 Connecting to VideoDB...', 'warning');
    const { showAuthModal } = await import('./src/ui/auth-modal.js');
    const authResult = await showAuthModal();
    if (!authResult) {
      addLog('❌ Authentication Failed', 'error');
      return false;
    }
    addLog('✅ Connected', 'success');
  }
  return true;
}

async function checkPermissions() {
  // Check mic
  const micStatus = await permissionUtil.check('mic');
  if (!micStatus.granted) {
    addLog('🎤 Permission needed', 'warning');
    const { initWizard } = await import('./src/ui/wizard.js');
    await initWizard();
  }
  // Check screen
  const screenStatus = await permissionUtil.check('screen');
  if (!screenStatus.granted) {
    addLog('🖥️ Permission needed', 'warning');
    const { initWizard } = await import('./src/ui/wizard.js');
    await initWizard();
  }
  return true;
}

// =============================================================================
// MAIN ENTRY
// =============================================================================

(async () => {
  try {
    addLog('Copilot initializing...');

    // 1. Init UI Components
    initTabs();
    initHistoryLogic();
    initPlayerUI();

    // 2. Auth
    const authOk = await checkAuth();
    if (!authOk) return;

    // 3. Permissions
    await checkPermissions();

    // 4. Init Sidebar (Ready)
    await initSidebar(startSessionFlow);

    addLog('Copilot Ready', 'success');

  } catch (error) {
    console.error('Init failed:', error);
    addLog(`Init Error: ${error.message}`, 'error');
  }
})();

