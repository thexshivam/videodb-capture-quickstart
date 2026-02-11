/**
 * Live Player Manager - Handles RTSP stream preview.
 * 
 * This module manages:
 * - Low-latency streaming via rtsp-relay + jsmpeg (primary)
 * - HLS.js fallback for compatibility
 * - Player UI (expand/collapse)
 */

let hlsInstance = null;
let jsmpegPlayer = null;
let currentRtspUrl = null;
let isPlayerExpanded = true;


/**
 * Start streaming RTSP via rtsp-relay.
 */
export async function startStream(rtspUrl) {
    try {
        currentRtspUrl = rtspUrl;
        const overlay = document.getElementById('player-overlay');
        if (overlay) overlay.textContent = 'Connecting...';

        // Use rtsp-relay for low-latency streaming
        if (window.recorderAPI && window.recorderAPI.startRtspRelay) {
            console.log('Starting rtsp-relay for low-latency streaming...');
            const result = await window.recorderAPI.startRtspRelay(rtspUrl);

            if (result.success && result.wsUrl) {
                initJsmpegPlayer(result.wsUrl);
                showPlayer();
                return { success: true, mode: 'rtsp-relay' };
            } else {
                const error = result.error || 'Failed to start rtsp-relay';
                console.error('rtsp-relay failed:', error);
                if (overlay) overlay.textContent = 'Stream error: ' + error;
                return { success: false, error };
            }
        } else {
            const error = 'rtsp-relay not available';
            console.error(error);
            if (overlay) overlay.textContent = error;
            return { success: false, error };
        }
    } catch (e) {
        console.error('Stream start failed:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Stop the current stream.
 */
export async function stopStream() {
    try {
        // Stop rtsp-relay if running
        if (window.recorderAPI && window.recorderAPI.stopRtspRelay) {
            await window.recorderAPI.stopRtspRelay();
        }

        destroyPlayer();
        hidePlayer();
        currentRtspUrl = null;

        return { success: true };
    } catch (e) {
        console.error('Stream stop failed:', e);
        return { success: false, error: e.message };
    }
}

/**
 * Initialize jsmpeg player for low-latency WebSocket streaming.
 */
function initJsmpegPlayer(wsUrl) {
    const canvas = document.getElementById('live-player-canvas');
    const video = document.getElementById('live-player');
    const overlay = document.getElementById('player-overlay');

    if (!canvas) {
        console.error('Canvas element not found, falling back to HLS');
        return false;
    }

    // Destroy existing instances
    destroyPlayer();

    // Hide video, show canvas
    if (video) video.style.display = 'none';
    canvas.style.display = 'block';

    if (overlay) overlay.textContent = 'Connecting...';

    try {
        jsmpegPlayer = new JSMpeg.Player(wsUrl, {
            canvas: canvas,
            autoplay: true,
            audio: false, // RTSP relay typically doesn't transcode audio
            loop: false,
            onPlay: () => {
                console.log('JSMpeg playing');
                if (overlay) overlay.style.display = 'none';
            },
            onSourceEstablished: () => {
                console.log('JSMpeg source established');
                if (overlay) overlay.style.display = 'none';
            }
        });
        console.log('JSMpeg player initialized');
        return true;
    } catch (e) {
        console.error('JSMpeg init failed:', e);
        return false;
    }
}

/**
 * Initialize HLS.js player (fallback).
 */
function initHlsPlayer(hlsUrl) {
    const video = document.getElementById('live-player');
    const overlay = document.getElementById('player-overlay');

    if (!video) return;

    // Destroy existing instance
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (overlay) overlay.textContent = 'Loading...';

    if (Hls.isSupported()) {
        hlsInstance = new Hls({
            lowLatencyMode: true,
            backBufferLength: 0,
            maxBufferLength: 10, // Increased buffer
            maxMaxBufferLength: 20,
            liveSyncDurationCount: 2, // Less aggressive sync (smoother)
            liveMaxLatencyDurationCount: 5
        });

        hlsInstance.loadSource(hlsUrl);
        hlsInstance.attachMedia(video);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (overlay) overlay.style.display = 'none';
            video.play().catch(e => console.log('Autoplay blocked:', e));
        });

        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            console.warn('HLS Error:', data.type, data.details);

            // Handle non-fatal buffer stalls (common in live streams)
            if (!data.fatal) {
                if (data.details === 'bufferStalledError') {
                    console.log('Buffer stall detected, attempting recovery...');
                    hlsInstance.recoverMediaError();
                    // Force resume playback after recovery
                    setTimeout(() => {
                        if (video.paused) {
                            console.log('Resuming playback after stall...');
                            video.play().catch(e => console.warn('Resume failed:', e));
                        }
                    }, 500);
                }
                return; // Non-fatal, let HLS.js handle it
            }

            // Fatal error - show UI feedback and retry
            if (overlay) {
                overlay.style.display = 'block';
                overlay.textContent = 'Stream error. Retrying...';
            }

            // Recovery based on error type
            if (data.type === 'mediaError') {
                hlsInstance.recoverMediaError();
            } else if (data.type === 'networkError') {
                // Network issue - wait and reload source
                setTimeout(() => {
                    if (hlsInstance) {
                        hlsInstance.loadSource(hlsUrl);
                    }
                }, 3000);
            } else {
                // Unknown fatal - full reload
                setTimeout(() => {
                    if (hlsInstance) {
                        hlsInstance.loadSource(hlsUrl);
                    }
                }, 3000);
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari)
        video.src = hlsUrl;
        video.addEventListener('loadedmetadata', () => {
            if (overlay) overlay.style.display = 'none';
            video.play().catch(e => console.log('Autoplay blocked:', e));
        });
    } else {
        if (overlay) overlay.textContent = 'HLS not supported';
    }
}

/**
 * Destroy all player instances.
 */
function destroyPlayer() {
    // Destroy jsmpeg player
    if (jsmpegPlayer) {
        jsmpegPlayer.destroy();
        jsmpegPlayer = null;
    }

    // Destroy HLS instance
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    // Reset video element
    const video = document.getElementById('live-player');
    if (video) {
        video.pause();
        video.src = '';
        video.style.display = 'none';
    }

    // Hide canvas
    const canvas = document.getElementById('live-player-canvas');
    if (canvas) {
        canvas.style.display = 'none';
    }
}

/**
 * Show the player section.
 */
function showPlayer() {
    const section = document.getElementById('live-player-section');

    if (section) section.style.display = 'block';
    updateToggleIcon(true);
}

/**
 * Hide the player section.
 */
function hidePlayer() {
    const subheader = document.getElementById('player-subheader');
    const section = document.getElementById('live-player-section');
    const overlay = document.getElementById('player-overlay');

    if (subheader) subheader.style.display = 'none';
    if (section) section.style.display = 'none';
    if (overlay) {
        overlay.style.display = 'block';
        overlay.textContent = 'Connecting...';
    }
}

/**
 * Toggle player expand/collapse.
 */
export function togglePlayer() {
    const section = document.getElementById('live-player-section');
    if (!section) return;

    const isExpanded = section.style.display !== 'none';
    section.style.display = isExpanded ? 'none' : 'block';
    updateToggleIcon(!isExpanded);
}

/**
 * Update the toggle icon based on player state.
 */
function updateToggleIcon(isExpanded) {
    const toggleBtn = document.getElementById('toggle-player-btn');
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('.material-icons');
        if (icon) {
            icon.textContent = isExpanded ? 'expand_less' : 'expand_more';
        }
    }
}

/**
 * Copy RTSP URL to clipboard.
 */
export function copyRtspUrl() {
    if (!currentRtspUrl) {
        console.warn('No RTSP URL available');
        return false;
    }

    navigator.clipboard.writeText(currentRtspUrl);

    // Visual feedback
    const btn = document.getElementById('copy-rtsp-btn');
    if (btn) {
        const icon = btn.querySelector('.material-icons');
        if (icon) {
            const original = icon.textContent;
            icon.textContent = 'check';
            icon.style.color = '#4CAF50';
            setTimeout(() => {
                icon.textContent = original;
                icon.style.color = '';
            }, 1500);
        }
    }

    return true;
}

/**
 * Initialize player UI event listeners.
 */
export function initPlayerUI() {
    // Toggle button in subheader
    const toggleBtn = document.getElementById('toggle-player-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayer();
        });
    }

    // Make entire subheader clickable
    const subheader = document.getElementById('player-subheader');
    if (subheader) {
        subheader.addEventListener('click', togglePlayer);
    }

    // Copy RTSP button
    const copyBtn = document.getElementById('copy-rtsp-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyRtspUrl);
    }


}
