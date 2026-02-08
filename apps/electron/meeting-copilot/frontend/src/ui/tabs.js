/**
 * Generic Tab Switching Logic with Animated Glider
 */

let gliderInitialized = false;

export function initTabs() {
    const glider = document.querySelector('.tab-glider');
    const buttons = document.querySelectorAll('.tab-btn');

    // Initialize glider position on first tab
    if (glider && !gliderInitialized) {
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab) {
            updateGlider(activeTab, glider);
            gliderInitialized = true;
        }

        // Update glider on window resize
        window.addEventListener('resize', () => {
            const currentActive = document.querySelector('.tab-btn.active');
            if (currentActive && glider) {
                updateGlider(currentActive, glider);
            }
        });
    }

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');

            // Reset all tabs
            buttons.forEach(btn => {
                btn.classList.remove('active');
                btn.style.color = '#888';
            });

            // Reset all content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                content.style.display = 'none';
            });

            // Activate clicked tab
            button.classList.add('active');
            button.style.color = '#4CAF50';

            // Animate glider
            if (glider) {
                updateGlider(button, glider);
            }

            // Show target content
            const targetContent = document.getElementById(targetTab);
            if (targetContent) {
                targetContent.classList.add('active');
                targetContent.style.display = ''; // Clear inline 'none' so CSS class takes over
            }
        });
    });
}

/**
 * Update glider position and width to match the active tab
 */
function updateGlider(activeTab, glider) {
    const tabRect = activeTab.getBoundingClientRect();
    const containerRect = activeTab.parentElement.getBoundingClientRect();

    // Calculate offset from container's left edge
    const offsetLeft = tabRect.left - containerRect.left;
    const width = tabRect.width;

    // Add visual padding (8px on each side = 16px total)
    const visualPadding = 8;
    const totalWidth = width + (visualPadding * 2);
    const totalOffsetLeft = offsetLeft - visualPadding;

    glider.style.width = `${totalWidth}px`;
    glider.style.transform = `translateX(${totalOffsetLeft}px)`;
}
