/**
 * History View Logic
 */
import { addLog } from "../utils/logger.js";

// HLS player instance
let hlsInstance = null;
// Track currently active recording ID to highlight in list
let activeRecordingId = null;

export function initHistoryLogic() {
    console.log('[History] Initializing View Logic...');

    const historyBtns = document.querySelectorAll(".btn-history");
    const backBtn = document.getElementById("backToWorkspaceBtn");

    // View Containers
    const mainApp = document.getElementById("mainApp");
    const historyView = document.getElementById("historyView");

    // Nav: Go to History
    historyBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            // Close settings if open
            const settingsModal = document.getElementById("settingsModal");
            if (settingsModal) settingsModal.classList.remove("visible");

            // Switch Views
            if (mainApp) mainApp.classList.remove("active");
            if (historyView) {
                historyView.classList.add("active");
                // Reset player state
                resetPlayer();
                // Load list
                loadHistoryList();
            }
        });
    });

    // Nav: Back to Workspace
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            // Stop playback
            resetPlayer();

            // Switch Views
            if (historyView) historyView.classList.remove("active");
            if (mainApp) mainApp.classList.add("active");
        });
    }
}

function resetPlayer() {
    const video = document.getElementById("historyVideoPlayer");

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (video) {
        video.pause();
        video.src = "";
        video.load();
    }

    activeRecordingId = null;
    updateActiveItemStyle();
}

async function loadHistoryList() {
    const listContainer = document.getElementById("historyListContainer");
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-state"><div class="status-dot starting"></div> Loading...</div>';

    try {
        const recordings = await window.recorderAPI.getRecordings();

        if (!recordings || recordings.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No recordings found.</div>';
            return;
        }

        // Sort descending
        recordings.sort((a, b) => b.id - a.id);

        listContainer.innerHTML = "";

        // Grouping Logic
        const grouped = bucketRecordings(recordings);

        for (const [groupName, items] of Object.entries(grouped)) {
            if (items.length === 0) continue;

            const header = document.createElement("div");
            header.className = "history-group-header";
            header.innerText = groupName;
            listContainer.appendChild(header);

            items.forEach((rec) => {
                const item = createHistoryListItem(rec);
                listContainer.appendChild(item);
            });
        }

        // Auto-play the most recent one
        if (recordings.length > 0) {
            loadVideo(recordings[0]);
            updateInsightsPanel(recordings[0]);
        }

    } catch (error) {
        console.error('[History] Fetch error:', error);
        listContainer.innerHTML = `<div class="empty-state" style="color:#f44336">Failed to load: ${error.message}</div>`;
    }
}

function bucketRecordings(recordings) {
    const buckets = {
        "Today": [],
        "Yesterday": [],
        "Earlier": []
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    recordings.forEach(rec => {
        // If no created_at, assume Today for recent IDs or Earlier? 
        // Let's rely on created_at or fallback to Earlier
        if (!rec.created_at) {
            buckets["Earlier"].push(rec);
            return;
        }

        const date = new Date(rec.created_at);
        const dateNoTime = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (dateNoTime.getTime() === today.getTime()) {
            buckets["Today"].push(rec);
        } else if (dateNoTime.getTime() === yesterday.getTime()) {
            buckets["Yesterday"].push(rec);
        } else {
            // For older, we group into Earlier or specific buckets if needed.
            // Copilot simplified: Just "Earlier" or Date string
            const dateStr = dateNoTime.toLocaleDateString();
            // Simple "Earlier" bucket or dynamic keys? 
            // Let's stick to simple "Earlier" for now as per minimal requirment, 
            // or dynamic date keys if user wants async-recorder style exactness.
            // Async recorder uses dynamic keys. Let's do that.
            if (!buckets[dateStr]) buckets[dateStr] = [];
            buckets[dateStr].push(rec);
        }
    });

    return buckets;
}

function createHistoryListItem(recording) {
    const div = document.createElement("div");
    div.className = "history-item";
    div.dataset.id = recording.id;

    const timeDisplay = recording.duration ? formatDuration(recording.duration) : "—";

    // Format Time (e.g. 10:30 AM)
    let timeStr = "";
    if (recording.created_at) {
        const dateObj = new Date(recording.created_at);
        timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const title = `Session: ${recording.session_id || 'Unknown'}`;

    // Status Badge - prioritize lifecycle status, then insights status
    let statusBadge = '';
    const status = recording.status || 'recording';

    if (status === 'recording') {
        // Active recording
        statusBadge = '<span class="material-icons blink" style="font-size:14px; color:#f44336;">fiber_manual_record</span>';
    } else if (status === 'processing') {
        // Waiting for webhook
        statusBadge = '<span class="material-icons spin" style="font-size:14px; color:#ff9800;">hourglass_empty</span>';
    } else if (status === 'available') {
        // Available - show insights status
        if (recording.insights_status === 'processing') {
            statusBadge = '<span class="material-icons spin" style="font-size:14px; color:#2196F3;">sync</span>';
        } else if (recording.insights_status === 'ready') {
            statusBadge = '<span class="material-icons" style="font-size:14px; color:#4CAF50;">check_circle</span>';
        } else if (recording.insights_status === 'failed') {
            statusBadge = '<span class="material-icons" style="font-size:14px; color:#f44336;">error</span>';
        } else {
            statusBadge = '<span class="material-icons" style="font-size:14px; color:#4CAF50;">cloud_done</span>';
        }
    }

    div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="flex:1;">
             <div style="font-size:13px; font-weight:500; color:#fff; margin-bottom:4px;">${title}</div>
             <div style="font-size:11px; color:#888;">
                <span style="color:#ccc;">${timeStr}</span>${timeStr && timeDisplay ? ' • ' : ''}${timeDisplay}
             </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
            ${statusBadge}
        </div>
    </div>
    `;

    div.addEventListener("click", () => {
        loadVideo(recording);
        updateInsightsPanel(recording);
    });

    return div;
}

function loadVideo(recording) {
    const video = document.getElementById("historyVideoPlayer");
    if (!video) return;

    // Update active state in list
    activeRecordingId = recording.id;
    updateActiveItemStyle();

    if (!recording.stream_url) {
        addLog("⚠️ No stream URL for selected recording.", "error");
        return;
    }

    // Initialize HLS
    if (Hls.isSupported()) {
        if (hlsInstance) {
            hlsInstance.destroy();
        }
        hlsInstance = new Hls();
        hlsInstance.loadSource(recording.stream_url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(e => console.log("Auto-play prevented:", e));
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = recording.stream_url;
        video.addEventListener('loadedmetadata', () => {
            video.play().catch(e => console.log("Auto-play prevented:", e));
        });
    }
}

function updateInsightsPanel(recording) {
    const insightsContent = document.getElementById("insightsContent");
    if (!insightsContent) return;

    // Clear existing
    insightsContent.innerHTML = '';

    if (recording.insights_status === 'processing') {
        insightsContent.innerHTML = `
            <div class="insight-card">
                <div class="insight-title">
                    <span class="material-icons spin" style="font-size: 18px;">sync</span>
                    Generating Insights...
                </div>
                <p style="font-size: 13px; color: #888;">
                    AI is analyzing the meeting transcript. This may take a moment.
                </p>
            </div>
        `;
        return;
    }

    if (recording.insights_status === 'failed') {
        insightsContent.innerHTML = `
            <div class="insight-card">
                <div class="insight-title" style="color: #f44336;">
                    <span class="material-icons" style="font-size: 18px;">error</span>
                    Insight Generation Failed
                </div>
                <p style="font-size: 13px; color: #888;">
                    Unable to generate insights for this recording.
                </p>
            </div>
        `;
        return;
    }

    if (recording.insights && recording.insights.length > 0) {
        // Use first insight as full markdown content (new format)
        const markdownContent = recording.insights[0];

        // Parse markdown using marked.js
        let renderedHtml = '';
        if (typeof marked !== 'undefined') {
            renderedHtml = marked.parse(markdownContent);
        } else {
            // Fallback: show as preformatted text
            renderedHtml = `<pre style="white-space: pre-wrap; font-family: inherit;">${markdownContent}</pre>`;
        }

        insightsContent.innerHTML = `
            <div class="insight-card markdown-content">
                ${renderedHtml}
            </div>
        `;
    } else if (recording.insights_status === 'ready') {
        // Ready but no bullets (Index Only mode)
        insightsContent.innerHTML = `
            <div class="insight-card">
                <div class="insight-title" style="color: #4CAF50;">
                    <span class="material-icons" style="font-size: 18px;">check_circle</span>
                    Video Indexed
                </div>
                <p style="font-size: 13px; color: #ccc; line-height: 1.6;">
                    This recording has been successfully indexed by VideoDB.
                    It is now optimized for semantic search and retrieval.
                </p>
                <div style="margin-top: 10px;">
                    <span class="tech-pill">Searchable</span>
                    <span class="tech-pill">Processed</span>
                </div>
            </div>
        `;
    } else {
        insightsContent.innerHTML = `
            <div class="insight-card">
                <div class="insight-title">
                    <span class="material-icons" style="font-size: 18px;">pending</span>
                    Insights Pending
                </div>
                <p style="font-size: 13px; color: #888;">
                    Insights will be available once processing completes.
                </p>
            </div>
        `;
    }
}

function updateActiveItemStyle() {
    const items = document.querySelectorAll(".history-item");
    items.forEach(item => {
        if (Number(item.dataset.id) === activeRecordingId) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

