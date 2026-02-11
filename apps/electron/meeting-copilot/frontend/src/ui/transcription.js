/**
 * Real-time Transcription Handler
 * Updated to work with split-view layout (player + scrolling transcription)
 */

let currentTranscriptElement = null;

export function handleTranscriptionEvent(data) {
    if (!data.text) return;

    // Get the list container for appending items
    const listContainer = document.getElementById('transcriptionList');
    // Get the scroll container for scrolling
    const scrollContainer = document.getElementById('transcription-container');

    if (!listContainer || !scrollContainer) return;

    // Remove empty state if it exists
    const emptyState = listContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    // Handle transcription based on is_final flag
    const isFinal = data.is_final === true;

    if (isFinal) {
        handleFinalTranscript(listContainer, scrollContainer, data);
    } else {
        handleIntermediateTranscript(listContainer, scrollContainer, data);
    }
}

function handleFinalTranscript(listContainer, scrollContainer, data) {
    if (currentTranscriptElement) {
        // Update the current element to be final
        currentTranscriptElement.style.opacity = '1';
        currentTranscriptElement.style.fontStyle = 'normal';
        currentTranscriptElement.classList.remove('current-transcript');

        const textDiv = currentTranscriptElement.querySelector('.transcription-text');
        if (textDiv) {
            const speakerHtml = getSpeakerHTML(data);
            textDiv.innerHTML = `${speakerHtml} ${data.text}`;
        }
        currentTranscriptElement = null;
    } else {
        // No current element, add directly
        addTranscriptionItem(listContainer, data.text, new Date(), getSpeakerHTML(data));
    }

    scrollToBottom(scrollContainer);
}

function handleIntermediateTranscript(listContainer, scrollContainer, data) {
    if (!currentTranscriptElement) {
        // Create new current transcript element
        currentTranscriptElement = document.createElement('div');
        currentTranscriptElement.className = 'transcription-item current-transcript';
        currentTranscriptElement.style.opacity = '0.7';

        const timeDiv = document.createElement('div');
        timeDiv.className = 'transcription-timestamp';
        // Use data timestamp if available, otherwise now
        const ts = data.timestamp ? new Date(data.timestamp * 1000) : new Date();
        timeDiv.textContent = ts.toLocaleTimeString();

        const textDiv = document.createElement('div');
        textDiv.className = 'transcription-text';

        currentTranscriptElement.appendChild(timeDiv);
        currentTranscriptElement.appendChild(textDiv);
        listContainer.appendChild(currentTranscriptElement);
    }

    // Update text
    const textDiv = currentTranscriptElement.querySelector('.transcription-text');
    if (textDiv) {
        const speakerHtml = getSpeakerHTML(data);
        textDiv.innerHTML = `${speakerHtml} ${data.text}`;
    }

    scrollToBottom(scrollContainer);
}

function addTranscriptionItem(container, text, timestamp, speaker) {
    const item = document.createElement('div');
    item.className = 'transcription-item';

    const timeDiv = document.createElement('div');
    timeDiv.className = 'transcription-timestamp';
    timeDiv.textContent = timestamp.toLocaleTimeString();

    const textDiv = document.createElement('div');
    textDiv.className = 'transcription-text';
    textDiv.innerHTML = speaker ? `${speaker} ${text}` : text;

    item.appendChild(timeDiv);
    item.appendChild(textDiv);
    container.appendChild(item);
}

// Smart Scrolling with Debounce
let scrollTimeout = null;
let isUserScrolling = false;

function scrollToBottom(element) {
    if (scrollTimeout) return; // Drop duplicates

    scrollTimeout = requestAnimationFrame(() => {
        // Only scroll if we were already near the bottom (within 100px)
        const threshold = 100;
        const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < threshold;

        if (isNearBottom && !isUserScrolling) {
            element.scrollTop = element.scrollHeight;
        }
        scrollTimeout = null;
    });
}

// Attach listener once to detect user scrolling interaction
const scrollContainer = document.getElementById('transcription-container');
if (scrollContainer) {
    let userScrollTimeout;
    scrollContainer.addEventListener('scroll', () => {
        const threshold = 100;
        const isNearBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < threshold;

        // If user scrolls up, mark as user scrolling
        if (!isNearBottom) {
            isUserScrolling = true;
            clearTimeout(userScrollTimeout);
            // Reset after 3 seconds of no activity so auto-scroll can resume if they stop scrolling
            userScrollTimeout = setTimeout(() => {
                isUserScrolling = false;
            }, 3000);
        } else {
            // They scrolled to bottom, re-enable auto-scroll immediately
            isUserScrolling = false;
        }
    });
}

function getSpeakerHTML(data) {
    if (data.speaker) return `<span style="opacity: 0.7; font-weight: bold;">[${data.speaker}]:</span>`;

    // Icons for system/mic
    if (data.type === 'transcript_system_audio') {
        return `<img src="img/speaker.png" alt="System" title="System Audio" style="width: 14px; height: 14px; opacity: 0.7; vertical-align: middle; margin-right: 6px;">`;
    }
    if (data.type === 'transcript_mic') {
        return `<img src="img/mic.png" alt="Mic" title="Microphone" style="width: 14px; height: 14px; opacity: 0.7; vertical-align: middle; margin-right: 6px;">`;
    }

    return '<span style="opacity: 0.7;">[Unknown]:</span>';
}
