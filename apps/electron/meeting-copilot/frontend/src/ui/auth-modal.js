/**
 * Auth Modal UI Module
 * Stage 2: Authentication
 */

let resolveAuthPromise = null;

export function showAuthModal(errorMessage = null) {
    const modal = document.getElementById('authModal');
    const errorDiv = document.getElementById('authError');
    const subtitle = document.getElementById('authModalSubtitle');

    if (!modal) {
        console.error('Auth modal not found in DOM');
        return Promise.resolve(false);
    }

    // Setup UI
    if (errorMessage) {
        subtitle.textContent = 'The provided API Key was invalid. Please try again.';
        subtitle.style.color = '#f44336';
    } else {
        subtitle.textContent = 'Please enter your VideoDB API Key to continue.';
        subtitle.style.color = '#666';
    }
    errorDiv.style.display = 'none';

    // Setup button handler
    const btn = document.getElementById('authConnectBtn');
    const input = document.getElementById('authApiKeyInput');

    const handleConnect = async () => {
        const apiKey = input.value.trim();
        if (!apiKey) {
            errorDiv.textContent = 'API Key is required';
            errorDiv.style.display = 'block';
            return;
        }

        btn.textContent = 'Connecting...';
        btn.disabled = true;
        errorDiv.style.display = 'none';

        try {
            const res = await window.configAPI.register({ name: 'Guest', apiKey });

            if (res.success) {
                modal.classList.remove('visible');
                btn.textContent = 'Connect';
                btn.disabled = false;

                if (resolveAuthPromise) {
                    resolveAuthPromise(true);
                    resolveAuthPromise = null;
                }
            } else {
                errorDiv.textContent = res.error || 'Connection failed';
                errorDiv.style.display = 'block';
                btn.textContent = 'Connect';
                btn.disabled = false;
            }
        } catch (e) {
            errorDiv.textContent = e.message;
            errorDiv.style.display = 'block';
            btn.textContent = 'Connect';
            btn.disabled = false;
        }
    };

    // Remove old listener, add new
    btn.onclick = handleConnect;

    // Show modal
    modal.classList.add('visible');

    // Return promise that resolves when connected
    return new Promise((resolve) => {
        resolveAuthPromise = resolve;
    });
}

export function hideAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('visible');
}
