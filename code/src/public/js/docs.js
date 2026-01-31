/**
 * docs.js - Integration Tutorial Page Script
 */

// Integration type switch
function initIntegrationTabs() {
    document.querySelectorAll('.integration-card').forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.type;

            // Update card state
            document.querySelectorAll('.integration-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            // Update content display
            document.querySelectorAll('.integration-content').forEach(c => c.classList.remove('active'));
            document.getElementById('content-' + type).classList.add('active');
        });
    });
}

// Tab switch
function initTabSwitcher() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            const container = btn.closest('.tab-container');

            // Update button state
            container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content display
            container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            container.querySelector('#tab-' + tabId).classList.add('active');
        });
    });
}

// Copy code
function copyCode(btn) {
    const codeBlock = btn.parentElement;
    const code = codeBlock.querySelector('pre').textContent;

    navigator.clipboard.writeText(code).then(() => {
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

// Load site settings
async function loadSiteSettings() {
    const logoIcon = document.getElementById('logo-icon');
    const logoText = document.getElementById('logo-text');

    // Load from cache first (to avoid flicker)
    const cached = localStorage.getItem('siteSettings');
    if (cached) {
        try {
            const settings = JSON.parse(cached);
            if (logoIcon) logoIcon.textContent = settings.siteLogo || 'K';
            if (logoText) logoText.textContent = `${settings.siteName || 'Kiro'} API`;
            document.title = `Integration Tutorial - ${settings.siteName || 'Kiro'} API`;
        } catch (e) {
            console.error('Parse cached settings error:', e);
        }
    }

    // Then fetch latest from server
    try {
        const res = await fetch('/api/site-settings');
        const data = await res.json();
        if (data.success && data.data) {
            const settings = data.data;
            localStorage.setItem('siteSettings', JSON.stringify(settings));
            if (logoIcon) logoIcon.textContent = settings.siteLogo || 'K';
            if (logoText) logoText.textContent = `${settings.siteName || 'Kiro'} API`;
            document.title = `Integration Tutorial - ${settings.siteName || 'Kiro'} API`;
        }
    } catch (e) {
        console.error('Load site settings error:', e);
    }
}

// Page initialization
document.addEventListener('DOMContentLoaded', () => {
    initIntegrationTabs();
    initTabSwitcher();
    loadSiteSettings();
});
