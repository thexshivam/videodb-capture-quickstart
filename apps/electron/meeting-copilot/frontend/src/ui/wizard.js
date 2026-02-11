import { permissionUtil } from '../utils/permissions.js';

export function initWizard() {
    return new Promise(async (resolve, reject) => {
        const wizardModal = document.getElementById('startupWizard');

        // standard elements
        const elVideo = wizardModal.querySelector('.wizard-video');
        const contentDiv = wizardModal.querySelector('.wizard-content');
        const headerDiv = wizardModal.querySelector('.wizard-header');
        const elTitle = wizardModal.querySelector('.wizard-header h2');
        const elDesc = wizardModal.querySelector('.wizard-header p');
        const btnGrant = document.getElementById('btn-wizard-grant');
        const btnSettings = document.getElementById('btn-wizard-settings');
        const statusDiv = document.getElementById('wizard-status');

        // State
        let currentStep = null;
        let checkInterval = null;

        // --- Renderers ---
        const renderStandard = (config) => {
            // Restore standard layout if needed
            elVideo.style.display = 'block';
            headerDiv.style.display = 'block';
            btnGrant.style.display = 'block';

            // Clean custom elements
            const existingGrid = contentDiv.querySelector('.wizard-choice-grid');
            if (existingGrid) existingGrid.remove();
            const existingForm = contentDiv.querySelector('.ngrok-form');
            if (existingForm) existingForm.remove();
            const existingLoading = contentDiv.querySelector('.wizard-loading');
            if (existingLoading) existingLoading.remove();

            elTitle.textContent = config.title;
            elDesc.textContent = config.desc;
            elVideo.src = config.video;
            btnGrant.textContent = config.btnText;

            btnGrant.disabled = false;
            btnGrant.classList.add('pulse-btn');
            btnSettings.style.display = 'none';
            statusDiv.style.display = 'none';

            // Ensure click handler is standard
            btnGrant.onclick = handleGrantClick;
        };

        const renderLoading = (message) => {
            headerDiv.style.display = 'none';

            let loading = contentDiv.querySelector('.wizard-loading');
            if (!loading) {
                loading = document.createElement('div');
                loading.className = 'wizard-loading';
                contentDiv.appendChild(loading);
            }

            loading.innerHTML = `
                <div class="spinner"></div>
                <p style="color: #ccc; font-size: 14px;">${message}</p>
             `;
        };

        // Steps Configuration
        const STEPS = {
            mic: {
                title: 'Setup Microphone',
                desc: 'VideoDB needs access to your microphone to record audio.',
                video: 'img/tutorial_mic.webp',
                permissionKey: 'mic',
                btnText: 'Grant Microphone',
                render: renderStandard
            },
            screen: {
                title: 'Setup Screen Recording',
                desc: 'To capture your screen, we need permission.',
                video: 'img/tutorial_screen.webp',
                permissionKey: 'screen',
                btnText: 'Grant Screen Access',
                render: renderStandard
            }
        };

        const showWizard = () => {
            wizardModal.style.display = 'flex';
            requestAnimationFrame(() => wizardModal.classList.add('visible'));
        };

        const hideWizard = () => {
            if (checkInterval) clearInterval(checkInterval);
            wizardModal.classList.remove('visible');
            wizardModal.style.display = 'none';
        };

        const setStep = (stepKey) => {
            currentStep = stepKey;
            const config = STEPS[stepKey];

            if (config.render) {
                config.render(config);
            } else {
                renderStandard(config);
            }

            console.log(`Wizard: Switched to step [${stepKey}]`);
        };

        // --- Logic ---

        const handleInstantSelection = async () => {
            renderLoading('Starting LocalTunnel...');
            try {
                // Start tunnel
                const result = await window.configAPI.startLocaltunnel();
                if (result.success) {
                    // Save preference
                    await window.configAPI.saveTunnelConfig({ provider: 'localtunnel' });
                    finish();
                } else {
                    throw new Error('Failed to start tunnel');
                }
            } catch (e) {
                console.error(e);
                alert('LocalTunnel Failed: ' + e.message + '. Please try Ngrok.');
                setStep('tunnel_choice');
            }
        };

        const checkCurrentPermission = async () => {
            if (!currentStep || !STEPS[currentStep].permissionKey) return false;
            const status = await permissionUtil.check(STEPS[currentStep].permissionKey);
            return status.granted;
        };

        const handleGrantClick = async () => {
            if (!currentStep) return;

            btnGrant.disabled = true;
            btnGrant.textContent = 'Requesting...';
            btnGrant.classList.remove('pulse-btn');

            try {
                const key = STEPS[currentStep].permissionKey;
                await permissionUtil.request(key);

                // Wait and Check
                setTimeout(async () => {
                    const granted = await checkCurrentPermission();
                    if (granted) {
                        nextStep();
                    } else {
                        // Denied
                        btnGrant.style.display = 'none';
                        btnSettings.style.display = 'block';
                        statusDiv.style.display = 'flex';

                        if (!checkInterval) {
                            checkInterval = setInterval(async () => {
                                const isGranted = await checkCurrentPermission();
                                if (isGranted) nextStep();
                            }, 1000);
                        }
                    }
                }, 1500);

            } catch (e) {
                console.error('Wizard Error:', e);
                btnGrant.textContent = 'Error - Retry';
                btnGrant.disabled = false;
            }
        };

        const nextStep = async () => {
            if (checkInterval) {
                clearInterval(checkInterval);
                checkInterval = null;
            }

            if (currentStep === 'mic') {
                const screenStatus = await permissionUtil.check('screen');
                if (screenStatus.granted) {
                    finish();
                } else {
                    setStep('screen');
                }
            } else if (currentStep === 'screen') {
                finish();
            }
        };

        const finish = () => {
            console.log('Wizard: All steps completed.');

            // Critical Cleanup: Ensure polling interval is stopped
            if (checkInterval) {
                console.log('Wizard: Cleaning up permission poll interval');
                clearInterval(checkInterval);
                checkInterval = null;
            }

            hideWizard();
            resolve(true);
        };

        // --- Event Listeners ---
        btnGrant.onclick = handleGrantClick;
        btnSettings.onclick = async () => {
            const key = STEPS[currentStep].permissionKey;
            await window.recorderAPI.openSystemSettings(key);
        };

        // --- Initialization Flow ---
        console.log('Wizard: Initializing...');

        // 1. Check Permissions first
        const micStatus = await permissionUtil.check('mic');
        if (!micStatus.granted) {
            showWizard(); // Ensure visible
            setStep('mic');
            return;
        }

        const screenStatus = await permissionUtil.check('screen');
        if (!screenStatus.granted) {
            showWizard(); // Ensure visible
            setStep('screen');
            return;
        }

        // 3. Resolve if already clean
        if (micStatus.granted && screenStatus.granted) {
            resolve(true);
        }
    });
}
