/**
 * Logger utility for the renderer process
 */

// Format timestamp
function getTimestamp() {
    return new Date().toLocaleTimeString();
}

/**
 * Add a log entry to the logs panel
 * @param {string} message - The message to log
 * @param {string} type - 'info', 'error', 'success', 'api'
 */
export function addLog(message, type = 'info') {
    // Also log to console
    console.log(`[${type.toUpperCase()}] ${message}`);
}
