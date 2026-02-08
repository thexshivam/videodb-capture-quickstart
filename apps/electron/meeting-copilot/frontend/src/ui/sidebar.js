/**
 * Sidebar Logic: Permissions, Session Control, Stream Toggles, Settings
 */
import { addLog } from '../utils/logger.js';

// DOM Elements
const elements = {
    // Session Control
    btnStart: document.getElementById('btn-start-session'),
    btnStop: document.getElementById('btn-stop-session'),

    // Status
    connectionStatus: document.getElementById('connectionStatus'),
    statusText: document.getElementById('statusText'),
    healthDot: document.getElementById('healthDot'),

    // Toggles
    toggleMic: document.getElementById('toggle-mic'),
    toggleScreen: document.getElementById('toggle-screen'),
    toggleAudio: document.getElementById('toggle-audio'),

    // Permission Indicators - Deprecated/Removed from UI

    // Settings & Profile (Same IDs as before)
    settingsBtns: document.querySelectorAll('.btn-settings'),
    // Modals
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    // Inputs
    backendUrl: document.getElementById('settings-backend-url'),
    callbackUrl: document.getElementById('settings-callback-url'),
    // Profile
    profileContainer: document.getElementById('userProfileContainer'),
    profileMenu: document.getElementById('profileMenu'),
    menuLogoutBtn: document.getElementById('menuLogoutBtn')
};

// State
let activeSessionId = null;

// --- Initialization ---
export async function initSidebar(onStartSessionCallback) {
    // 1. Initial Config & Profile Load
    loadConfigToUI();
    initSettingsLogic();
    initProfileLogic();
    resetToggles(); // Initialize toggles to checked state

    // 2. Bind Session Controls
    if (elements.btnStart) {
        elements.btnStart.addEventListener('click', async () => {
            // Disable button prevents double-click
            if (elements.btnStart.disabled) return;
            onStartSessionCallback(); // Trigger start in renderer
        });
    }

    if (elements.btnStop) {
        elements.btnStop.addEventListener('click', async () => {
            if (!activeSessionId) return;
            await stopSession();
        });
    }

    // 3. Bind Stream Toggles
    bindToggleEvents();
}

// --- Session State Management ---

export function setSessionActive(sessionId) {
    activeSessionId = sessionId;

    // Create recording entry in backend
    window.recorderAPI.startRecording(sessionId).then(result => {
        if (result.error) {
            console.error('[Recording] Failed to create entry:', result.error);
        } else {
            addLog('📝 Recording entry created', 'info');
        }
    }).catch(e => console.error('[Recording] startRecording failed:', e));

    // UI Updates
    if (elements.btnStart) {
        elements.btnStart.disabled = false; // Reset loading state if any
        elements.btnStart.style.display = 'none';
    }
    if (elements.btnStop) {
        elements.btnStop.style.display = 'flex';
    }

    updateStatus('Live', '#f44336');
    // Add blink effect to dot
    if (elements.healthDot) elements.healthDot.classList.add('blink');

    // Enable Toggles
    enableToggles(true);
    // Ensure they show as ON (since SDK starts with streams active)
    resetToggles();

    // Start Timer
    startTimer();
}

export function setSessionLoading() {
    if (elements.btnStart) {
        elements.btnStart.disabled = true;
        elements.btnStart.innerHTML = '<span class="material-icons spin" style="font-size: 16px;">sync</span> Starting...';
    }
    updateStatus('Starting...', '#ff9800');
    if (elements.healthDot) elements.healthDot.classList.remove('blink');
}

export function resetSessionUI() {
    activeSessionId = null;

    // UI Updates
    if (elements.btnStart) {
        elements.btnStart.style.display = 'flex';
        elements.btnStart.disabled = false;
        elements.btnStart.innerHTML = '<span>▶</span> Start Session';
    }
    if (elements.btnStop) {
        elements.btnStop.style.display = 'none';
    }

    updateStatus('Ready', '#4CAF50');
    if (elements.healthDot) elements.healthDot.classList.remove('blink');

    // Reset/Disable Toggles
    enableToggles(false);
    resetToggles();

    // Stop Timer
    stopTimer();
}

async function stopSession() {
    if (!activeSessionId) return;

    const sessionIdToStop = activeSessionId;
    updateStatus('Stopping...', '#ff9800');

    try {
        const result = await window.recorderAPI.stopSession(sessionIdToStop);
        if (result.success) {
            addLog('✅ Session stopped', 'success');

            // Update recording status to 'processing'
            window.recorderAPI.stopRecording(sessionIdToStop).then(res => {
                if (res.error) {
                    console.error('[Recording] Failed to update status:', res.error);
                } else {
                    addLog('⏳ Recording now processing...', 'info');
                }
            }).catch(e => console.error('[Recording] stopRecording failed:', e));

            resetSessionUI();
        } else {
            addLog(`❌ Failed to stop: ${result.error}`, 'error');
            resetSessionUI();
        }
    } catch (error) {
        addLog(`❌ Stop error: ${error.message}`, 'error');
        resetSessionUI();
    }
}

function updateStatus(text, color) {
    if (elements.statusText) elements.statusText.textContent = text;
    if (elements.healthDot) elements.healthDot.style.background = color;
}

// --- Timer Logic ---
let timerInterval = null;
let startTime = 0;

function startTimer() {
    const timerDisplay = document.getElementById('recordingTimer');
    if (!timerDisplay) return;

    startTime = Date.now();
    timerDisplay.textContent = '00:00:00';
    timerDisplay.classList.add('active');

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        timerDisplay.textContent = formatTime(elapsed);
    }, 1000);
}

function stopTimer() {
    const timerDisplay = document.getElementById('recordingTimer');
    if (timerDisplay) {
        timerDisplay.classList.remove('active');
        timerDisplay.textContent = '00:00:00';
    }
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// --- Stream Toggles ---

function bindToggleEvents() {
    // Mic
    if (elements.toggleMic) {
        elements.toggleMic.addEventListener('change', (e) => handleToggle('mic', e.target.checked));
    }
    // Screen
    if (elements.toggleScreen) {
        elements.toggleScreen.addEventListener('change', (e) => handleToggle('screen', e.target.checked));
    }
    // System Audio (mapped to 'system_audio' track name usually, check binary spec)
    // Binary spec calls it "system_audio" for track name in session, but commands take list of strings.
    // Assuming "system_audio" is the string.
    if (elements.toggleAudio) {
        elements.toggleAudio.addEventListener('change', (e) => handleToggle('system_audio', e.target.checked));
    }
}

async function handleToggle(trackName, isChecked) {
    // If Checked (ON) -> Resume
    // If Unchecked (OFF) -> Pause
    try {
        if (isChecked) {
            addLog(`Resuming ${trackName}...`);
            await window.recorderAPI.resumeTracks(activeSessionId, [trackName]);
        } else {
            addLog(`Pausing ${trackName}...`);
            await window.recorderAPI.pauseTracks(activeSessionId, [trackName]);
        }
    } catch (error) {
        addLog(`❌ Failed to toggle ${trackName}: ${error.message}`, 'error');
        // Revert toggle state on error?
    }
}

function enableToggles(enabled) {
    const toggles = [elements.toggleMic, elements.toggleScreen, elements.toggleAudio];
    toggles.forEach(t => {
        if (t) t.disabled = !enabled;
    });
}

function resetToggles() {
    // Reset to "Checked" (assuming default is ON) or whatever default state
    // Actually default state is usually ON.
    const toggles = [elements.toggleMic, elements.toggleScreen, elements.toggleAudio];
    toggles.forEach(t => {
        if (t) t.checked = true;
    });
}

// --- Permissions ---
// (Permissions are now handled by global permission modal on startup)


// --- Settings & Profile (Copied/Adapted from config.js) ---

function initSettingsLogic() {
    elements.settingsBtns.forEach(btn => {
        btn.addEventListener('click', openSettingsModal);
    });
    if (elements.closeSettingsBtn) elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    if (elements.saveSettingsBtn) elements.saveSettingsBtn.addEventListener('click', saveSettings);

    if (elements.settingsModal) {
        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) closeSettingsModal();
        });
    }
}

function openSettingsModal() {
    // Close history modal if open
    const historyModal = document.getElementById('historyModal');
    if (historyModal) historyModal.classList.remove('visible');

    if (elements.settingsModal) elements.settingsModal.classList.add('visible');
    loadConfigToUI();
}

function closeSettingsModal() {
    if (elements.settingsModal) elements.settingsModal.classList.remove('visible');
}

async function saveSettings() {
    const btn = elements.saveSettingsBtn;
    if (btn) {
        btn.textContent = 'Saving...';
        btn.disabled = true;
    }

    try {
        const newConfig = {
            backendBaseUrl: elements.backendUrl.value,
            callbackUrl: elements.callbackUrl.value
        };
        await window.configAPI.updateConfig(newConfig);
        addLog('✅ Settings saved', 'success');
        closeSettingsModal();
    } catch (error) {
        addLog(`❌ Failed to save settings: ${error.message}`, 'error');
    } finally {
        if (btn) {
            btn.textContent = 'Save Changes';
            btn.disabled = false;
        }
    }
}

async function loadConfigToUI() {
    try {
        const config = await window.configAPI.getConfig();
        if (elements.backendUrl) elements.backendUrl.value = config.backendBaseUrl || '';
        if (elements.callbackUrl) elements.callbackUrl.value = config.callbackUrl || '';

        // Update Profile Name
        let displayName = "VideoDB User";
        if (config.userName) {
            displayName = config.userName;
        }

        const tooltip = document.getElementById('userNameTooltip');
        const menuName = document.getElementById('menuUserName');
        if (tooltip) tooltip.textContent = displayName;
        if (menuName) menuName.textContent = displayName;

    } catch (err) {
        console.error("Failed to load config", err);
    }
}

function initProfileLogic() {
    const { profileContainer, profileMenu, menuLogoutBtn } = elements;

    if (profileContainer && profileMenu) {
        profileContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = profileMenu.classList.toggle('visible');
            if (isVisible) profileContainer.classList.add('menu-open');
            else profileContainer.classList.remove('menu-open');
        });

        document.addEventListener('click', () => {
            profileMenu.classList.remove('visible');
            profileContainer.classList.remove('menu-open');
        });

        profileMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    if (menuLogoutBtn) {
        menuLogoutBtn.addEventListener('click', async () => {
            if (profileMenu) profileMenu.classList.remove('visible');
            if (confirm('Are you sure you want to log out?')) {
                await window.configAPI.logout();
                window.location.reload();
            }
        });
    }
}
