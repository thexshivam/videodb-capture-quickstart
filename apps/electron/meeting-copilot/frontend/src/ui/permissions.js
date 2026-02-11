import { permissionUtil } from '../utils/permissions.js';

export async function initPermissionsFlow() {
    const modal = document.getElementById('permissionModal');
    const btnMic = document.getElementById('btn-grant-mic');
    const btnScreen = document.getElementById('btn-grant-screen');
    const btnAccessibility = document.getElementById('btn-grant-accessibility');
    const errorMsg = document.getElementById('permissionError');

    // Return a promise that resolves only when all permissions are granted
    return new Promise(async (resolve) => {
        // Helper to update UI state
        // Returns true if all granted
        const updateUI = async () => {
            const micStatus = await permissionUtil.check('mic');
            const screenStatus = await permissionUtil.check('screen');
            const accessibilityStatus = await permissionUtil.check('accessibility');

            updateItemUI(btnMic, micStatus.granted);
            updateItemUI(btnScreen, screenStatus.granted);
            updateItemUI(btnAccessibility, accessibilityStatus.granted);

            const allGranted = micStatus.granted && screenStatus.granted && accessibilityStatus.granted;

            if (allGranted) {
                modal.classList.remove('visible');
                resolve(true); // Resolve the main promise
                return true;
            } else {
                modal.classList.add('visible');
                return false;
            }
        };

        const updateItemUI = (btn, granted) => {
            if (granted) {
                btn.textContent = 'Granted';
                btn.classList.add('granted');
                btn.disabled = true;
            } else {
                btn.textContent = 'Grant Access';
                btn.classList.remove('granted');
                btn.disabled = false;
            }
        };

        // Event Listeners
        btnMic.addEventListener('click', async () => {
            if (btnMic.textContent === 'Open Settings') {
                const result = await window.recorderAPI.openSystemSettings('mic');
                if (!result || !result.success) {
                    errorMsg.textContent = 'Go to System Settings -> Privacy & Security -> Microphone to enable access.';
                }
                return;
            }

            try {
                btnMic.disabled = true;
                btnMic.textContent = 'Requesting...';
                errorMsg.textContent = '';

                await permissionUtil.request('mic');
                const done = await updateUI();

                if (!done) {
                    btnMic.disabled = false;
                    btnMic.textContent = 'Open Settings';
                    btnMic.classList.remove('granted');

                    errorMsg.textContent = 'Permission denied. Opening System Settings...';
                    const result = await window.recorderAPI.openSystemSettings('mic');
                    if (!result || !result.success) {
                        errorMsg.textContent = 'Go to System Settings -> Privacy & Security -> Microphone to enable access.';
                    }
                }
            } catch (e) {
                btnMic.disabled = false;
                btnMic.textContent = 'Open Settings';
                errorMsg.textContent = 'Error: ' + e.message;
            }
        });

        btnScreen.addEventListener('click', async () => {
            if (btnScreen.textContent === 'Open Settings') {
                const result = await window.recorderAPI.openSystemSettings('screen');
                if (!result || !result.success) {
                    errorMsg.textContent = 'Go to System Settings -> Privacy & Security -> Screen Recording to enable access.';
                }
                return;
            }

            try {
                btnScreen.disabled = true;
                btnScreen.textContent = 'Requesting...';
                errorMsg.textContent = '';

                await permissionUtil.request('screen');
                const done = await updateUI();

                if (!done) {
                    btnScreen.disabled = false;
                    btnScreen.textContent = 'Open Settings';
                    btnScreen.classList.remove('granted');

                    errorMsg.textContent = 'Permission denied. Opening System Settings...';
                    const result = await window.recorderAPI.openSystemSettings('screen');
                    if (!result || !result.success) {
                        errorMsg.textContent = 'Go to System Settings -> Privacy & Security -> Screen Recording to enable access.';
                    }
                }
            } catch (e) {
                btnScreen.disabled = false;
                btnScreen.textContent = 'Open Settings';
                errorMsg.textContent = 'Error: ' + e.message;
            }
        });

        btnAccessibility.addEventListener('click', async () => {
            if (btnAccessibility.textContent === 'Open Settings') {
                const result = await window.recorderAPI.openSystemSettings('accessibility');
                if (!result || !result.success) {
                    errorMsg.textContent = 'Go to System Settings -> Privacy & Security -> Accessibility to enable access.';
                }
                return;
            }

            try {
                btnAccessibility.disabled = true;
                btnAccessibility.textContent = 'Requesting...';
                errorMsg.textContent = '';

                await permissionUtil.request('accessibility');
                const done = await updateUI();

                if (!done) {
                    btnAccessibility.disabled = false;
                    btnAccessibility.textContent = 'Open Settings';
                    btnAccessibility.classList.remove('granted');

                    errorMsg.textContent = 'Opening System Settings...';
                    const result = await window.recorderAPI.openSystemSettings('accessibility');
                    if (!result || !result.success) {
                        errorMsg.textContent = 'Go to System Settings -> Privacy & Security -> Accessibility to enable access.';
                    }
                }
            } catch (e) {
                btnAccessibility.disabled = false;
                btnAccessibility.textContent = 'Open Settings';
                errorMsg.textContent = 'Error: ' + e.message;
            }
        });

        // Initial check
        const allGranted = await updateUI();

        // Start polling if not granted (to catch system setting changes)
        // Only resolve if allGranted is true initially
        // If not, the resolution happens inside updateUI called by poller or buttons
        if (!allGranted) {
            const poller = setInterval(async () => {
                if (document.hidden) return; // Don't poll if window hidden

                // If updateUI returns true, it also resolves the promise
                const done = await updateUI();
                if (done) clearInterval(poller);
            }, 1000); // Check every second
        }
    });
}
