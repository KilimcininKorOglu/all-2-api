// ============ OAuth Page JS ============

let currentSessionId = null;
let pollInterval = null;
let currentProvider = null;

// Page initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    if (!await checkAuth()) return;

    // Inject sidebar
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('oauth');
        updateSidebarStats();
    }

    // Load recently added accounts
    loadRecentAccounts();
});

// Get login options
function getOAuthOptions() {
    return {
        name: document.getElementById('credential-name').value.trim() || undefined,
        region: document.getElementById('region-select').value
    };
}

// Start Social Auth (Google/GitHub)
async function startSocialAuth(provider) {
    if (currentSessionId) {
        showToast('A login is already in progress, please cancel first', 'warning');
        return;
    }

    const options = getOAuthOptions();
    currentProvider = provider;

    try {
        const res = await fetch('/api/oauth/social/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                provider: provider,
                ...options
            })
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || 'Failed to start login', 'error');
            return;
        }

        currentSessionId = result.data.sessionId;

        // Show status area
        showSocialAuthStatus(result.data);

        // Automatically open authorization link
        window.open(result.data.authUrl, '_blank');

        // Start polling status
        startPolling();

        showToast(`Started ${provider} login, please complete authorization in the new window`, 'info');

    } catch (error) {
        showToast('Failed to start login: ' + error.message, 'error');
    }
}

// Show Social Auth status
function showSocialAuthStatus(data) {
    const statusEl = document.getElementById('oauth-status');
    statusEl.classList.add('active');

    document.getElementById('status-badge').innerHTML = '<span class="spinner"></span> Waiting for authorization';
    document.getElementById('status-badge').className = 'status-badge pending';

    // Show authorization link
    const authUrlItem = document.getElementById('auth-url-item');
    authUrlItem.style.display = 'flex';
    document.getElementById('auth-url').href = data.authUrl;
    document.getElementById('auth-url').textContent = 'Click to open authorization page';

    // Hide user code (not needed for Social Auth)
    document.getElementById('user-code-item').style.display = 'none';
    document.getElementById('credential-id-item').style.display = 'none';
}

// Start Builder ID OAuth
async function startBuilderID() {
    if (currentSessionId) {
        showToast('A login is already in progress, please cancel first', 'warning');
        return;
    }

    const options = getOAuthOptions();

    try {
        const res = await fetch('/api/oauth/builder-id/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(options)
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || 'Failed to start login', 'error');
            return;
        }

        currentSessionId = result.data.sessionId;

        // Show status area
        showBuilderIDStatus(result.data);

        // Automatically open authorization link
        window.open(result.data.verificationUriComplete, '_blank');

        // Start polling status
        startPolling();

        showToast('Started Builder ID login, please complete authorization in the new window', 'info');

    } catch (error) {
        showToast('Failed to start login: ' + error.message, 'error');
    }
}

// Start Gemini Antigravity OAuth
async function startGeminiAuth() {
    const options = getOAuthOptions();

    try {
        const res = await fetch('/api/gemini/oauth/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name: options.name })
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || 'Failed to start Gemini login', 'error');
            return;
        }

        // Open authorization page
        window.open(result.authUrl, '_blank', 'width=600,height=700');

        showToast('Started Gemini login, please complete authorization in the new window', 'info');

    } catch (error) {
        showToast('Failed to start Gemini login: ' + error.message, 'error');
    }
}

// Listen for Gemini OAuth callback message
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'gemini-oauth-success') {
        showToast(`Gemini credential "${event.data.name}" has been added`, 'success');
        loadRecentAccounts();
        updateSidebarStats();
    }
});

// Show Builder ID status
function showBuilderIDStatus(data) {
    const statusEl = document.getElementById('oauth-status');
    statusEl.classList.add('active');

    document.getElementById('status-badge').innerHTML = '<span class="spinner"></span> Waiting for authorization';
    document.getElementById('status-badge').className = 'status-badge pending';

    // Show authorization link
    const authUrlItem = document.getElementById('auth-url-item');
    authUrlItem.style.display = 'flex';
    document.getElementById('auth-url').href = data.verificationUriComplete;
    document.getElementById('auth-url').textContent = 'Click to open authorization page';

    // Show user code
    const userCodeItem = document.getElementById('user-code-item');
    userCodeItem.style.display = 'flex';
    document.getElementById('user-code').textContent = data.userCode;

    document.getElementById('credential-id-item').style.display = 'none';
}

// Start polling status
function startPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
    }

    pollInterval = setInterval(async () => {
        if (!currentSessionId) {
            clearInterval(pollInterval);
            return;
        }

        try {
            const res = await fetch(`/api/oauth/session/${currentSessionId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            const result = await res.json();

            if (!result.success) {
                // Session does not exist or has expired
                clearInterval(pollInterval);
                currentSessionId = null;
                document.getElementById('status-badge').innerHTML = 'Session expired';
                document.getElementById('status-badge').className = 'status-badge error';
                return;
            }

            if (result.data.completed) {
                // Login successful
                clearInterval(pollInterval);

                document.getElementById('status-badge').innerHTML = '✓ Login successful';
                document.getElementById('status-badge').className = 'status-badge success';

                if (result.data.credentialId) {
                    document.getElementById('credential-id-item').style.display = 'flex';
                    document.getElementById('credential-id').textContent = result.data.credentialId;
                }

                showToast('Login successful! Credentials saved to database', 'success');

                // Refresh recent accounts list
                loadRecentAccounts();

                // Update sidebar stats
                updateSidebarStats();

                // Reset status after 3 seconds
                setTimeout(() => {
                    resetStatus();
                }, 3000);
            }

        } catch (error) {
            console.error('Poll error:', error);
        }
    }, 2000); // Poll every 2 seconds
}

// Cancel OAuth
async function cancelOAuth() {
    if (currentSessionId) {
        try {
            await fetch(`/api/oauth/session/${currentSessionId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
        } catch (e) {
            console.error('Cancel error:', e);
        }
    }

    resetStatus();
    showToast('Login cancelled', 'info');
}

// Reset status
function resetStatus() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    currentSessionId = null;

    const statusEl = document.getElementById('oauth-status');
    statusEl.classList.remove('active');
}

// Copy authorization link
function copyAuthUrl() {
    const url = document.getElementById('auth-url').href;
    copyToClipboard(url);
}

// Load recently added accounts
async function loadRecentAccounts() {
    try {
        const res = await fetch('/api/credentials', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (!result.success) {
            return;
        }

        const accounts = result.data || [];

        // Sort by creation time, take the 5 most recent
        const recentAccounts = accounts
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5);

        renderRecentAccounts(recentAccounts);

    } catch (error) {
        console.error('Load recent accounts error:', error);
    }
}

// Render recent accounts list
function renderRecentAccounts(accounts) {
    const listEl = document.getElementById('history-list');

    if (accounts.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p>No recently added accounts</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = accounts.map(account => {
        const providerName = getProviderName(account.authMethod);

        return `
            <div class="history-item">
                <div class="history-info">
                    <div class="history-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                    </div>
                    <div class="history-details">
                        <h5>${escapeHtml(account.name)}</h5>
                        <span>${providerName} · ${formatDateTime(account.createdAt)}</span>
                    </div>
                </div>
                <div class="history-actions">
                    <button class="btn btn-secondary btn-sm" onclick="viewAccount(${account.id})">
                        View
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="testAccount(${account.id})">
                        Test
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Get provider name
function getProviderName(authMethod) {
    if (authMethod === 'builder-id') {
        return 'Builder ID';
    }
    if (authMethod === 'IdC') {
        return 'IAM Identity Center';
    }
    return 'Social';
}

// View account
function viewAccount(id) {
    window.location.href = `/pages/accounts.html?id=${id}`;
}

// Test account
async function testAccount(id) {
    showToast('Testing account...', 'info');

    try {
        const res = await fetch(`/api/credentials/${id}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('Account test successful!', 'success');
        } else {
            showToast('Account test failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Test failed: ' + error.message, 'error');
    }
}

// Show IAM Identity Center options
function showIdCOptions() {
    const idcOptions = document.getElementById('idc-options');
    idcOptions.style.display = 'block';
    document.getElementById('idc-start-url').focus();
}

// Show IdC Auth status (PKCE flow)
function showIdCAuthStatus(data) {
    const statusEl = document.getElementById('oauth-status');
    statusEl.classList.add('active');

    document.getElementById('status-badge').innerHTML = '<span class="spinner"></span> Waiting for authorization';
    document.getElementById('status-badge').className = 'status-badge pending';

    // Show authorization link
    const authUrlItem = document.getElementById('auth-url-item');
    authUrlItem.style.display = 'flex';
    document.getElementById('auth-url').href = data.authUrl;
    document.getElementById('auth-url').textContent = 'Click to open IAM Identity Center login';

    // Hide user code (not needed for PKCE flow)
    document.getElementById('user-code-item').style.display = 'none';
    document.getElementById('credential-id-item').style.display = 'none';
}

// Hide IAM Identity Center options
function hideIdCOptions() {
    const idcOptions = document.getElementById('idc-options');
    idcOptions.style.display = 'none';
    document.getElementById('idc-start-url').value = '';
}

// Start IAM Identity Center OAuth (PKCE Flow)
async function startIAMIdentityCenter() {
    if (currentSessionId) {
        showToast('A login is already in progress, please cancel first', 'warning');
        return;
    }

    const startUrl = document.getElementById('idc-start-url').value.trim();
    const options = getOAuthOptions();

    if (!startUrl) {
        showToast('Start URL is required', 'error');
        document.getElementById('idc-start-url').focus();
        return;
    }

    // Validate URL format
    if (!startUrl.match(/^https:\/\/[a-zA-Z0-9-]+\.awsapps\.com\/start\/?$/)) {
        showToast('Invalid IAM Identity Center URL format. Expected: https://d-xxxxxxxx.awsapps.com/start', 'error');
        return;
    }

    try {
        const res = await fetch('/api/oauth/idc/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                startUrl: startUrl,
                ...options
            })
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || 'Failed to start IAM Identity Center login', 'error');
            return;
        }

        currentSessionId = result.data.sessionId;

        // Hide IdC options
        hideIdCOptions();

        // Show status area (PKCE flow - similar to Social Auth)
        showIdCAuthStatus(result.data);

        // Automatically open authorization link
        window.open(result.data.authUrl, '_blank');

        // Start polling status
        startPolling();

        showToast('Started IAM Identity Center login, please complete authorization in the new window', 'info');

    } catch (error) {
        showToast('Failed to start IAM Identity Center login: ' + error.message, 'error');
    }
}

// HTML escape
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
