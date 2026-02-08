export async function initOnboarding() {
    const modal = document.getElementById('onboardingModal');
    const nameInput = document.getElementById('nameInput');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const toggleApiKeyBtn = document.getElementById('toggleApiKey');
    const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
    const advancedSection = document.getElementById('advancedSection');
    const advancedArrow = document.getElementById('advancedArrow');
    const connectBtn = document.getElementById('connectBtn');
    const errorMsg = document.getElementById('onboardingError');

    // Input fields for advanced connection
    const modalBackendUrl = document.getElementById('modal-backend-url');
    // Name input is assumed to be present in HTML or we add it? 
    const modalCallbackUrl = document.getElementById('modal-callback-url');

    // Load current settings
    const currentSettings = await window.configAPI.getConfig();

    // Pre-fill Advanced Settings (Read Only or Informational)
    if (currentSettings) {
        modalBackendUrl.value = currentSettings.backendBaseUrl || '';
        // If runtime config hasn't loaded yet (rare race condition), it might be empty.
        // But main.js handles the source of truth.
        modalCallbackUrl.value = currentSettings.callbackUrl || '';
    }

    // Check if we need to show onboarding
    // If we have an accessToken, we are "Connected"
    if (!currentSettings.accessToken) {
        modal.classList.add('visible');
    } else {
        // Already onboarded
        return true;
    }

    // Event Listeners
    toggleApiKeyBtn.addEventListener('click', () => {
        const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
        apiKeyInput.setAttribute('type', type);
        toggleApiKeyBtn.textContent = type === 'password' ? '👁️' : '🔒';
    });

    toggleAdvancedBtn.addEventListener('click', () => {
        advancedSection.classList.toggle('visible');
        const isVisible = advancedSection.classList.contains('visible');
        advancedArrow.textContent = isVisible ? '▲' : '▼';
    });

    connectBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        if (!name) {
            errorMsg.textContent = 'Please enter your name.';
            return;
        }
        if (!apiKey) {
            errorMsg.textContent = 'Please enter a valid API Key.';
            return;
        }

        connectBtn.textContent = 'Connecting...';
        connectBtn.disabled = true;
        errorMsg.textContent = '';

        // Register with Backend
        try {
            const apiPort = 8001; // We should probably fetch this dynamic port or standardise on 8001/8000
            // Ideally main.js exposes a "register" IPC, but we can also do fetch here if nodeIntegration is false (it is false).
            // But we don't know the port here easily unless we ask main process.
            // Let's use window.configAPI.register() which is cleaner.

            // Register with Backend
            // We NO LONGER pass the override URLs. Strict use of runtime.json
            const result = await window.configAPI.register({
                name,
                apiKey
            });

            if (result.success) {
                modal.classList.remove('visible');
                // Update user name header immediately
                const tooltip = document.getElementById('userNameTooltip');
                const menuName = document.getElementById('menuUserName');
                if (result.userName) {
                    if (tooltip) tooltip.textContent = result.userName;
                    if (menuName) menuName.textContent = result.userName;
                }
            } else {
                errorMsg.textContent = result.error || 'Failed to save settings.';
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect & Start';
            }
        } catch (err) {
            console.error(err);
            errorMsg.textContent = 'An unexpected error occurred.';
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect & Start';
        }
    });
}
