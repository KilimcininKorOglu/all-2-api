// ============ Account Detail Page JS ============

let currentCredential = null;
let accountId = null;
let tokenVisible = { access: false, refresh: false };

// Page initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    if (!await checkAuth()) return;

    // Inject sidebar
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('accounts');
        updateSidebarStats();
    }

    // Get account ID from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    accountId = urlParams.get('id');

    if (!accountId) {
        showToast('Account ID not specified', 'error');
        setTimeout(() => goBack(), 1500);
        return;
    }

    // Load account details
    await loadAccountDetail();
});

// Go back to list
function goBack() {
    window.location.href = '/pages/accounts.html';
}

// Load account details
async function loadAccountDetail() {
    try {
        const res = await fetch(`/api/credentials/${accountId}?full=true`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || 'Loading failed', 'error');
            setTimeout(() => goBack(), 1500);
            return;
        }

        currentCredential = result.data;
        renderAccountDetail();

    } catch (error) {
        showToast('Failed to load account details: ' + error.message, 'error');
        setTimeout(() => goBack(), 1500);
    }
}

// Render account details
function renderAccountDetail() {
    const cred = currentCredential;

    // Hide loading state, show content
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('detail-content').style.display = 'block';

    // Update page title
    document.getElementById('account-subtitle').textContent = cred.email || cred.name || 'Account Details';

    // Basic information
    document.getElementById('detail-name').textContent = cred.name || '-';
    document.getElementById('detail-email').textContent = cred.email || '-';

    // Provider
    const providerEl = document.getElementById('detail-provider');
    const provider = cred.provider || 'Unknown';
    providerEl.innerHTML = `<span class="pder-badge ${provider.toLowerCase()}">${provider}</span>`;

    // Auth method
    const authMethodMap = {
        'social': 'Social (Google/GitHub)',
        'builder-id': 'AWS Builder ID',
        'IdC': 'IAM Identity Center'
    };
    document.getElementById('detail-auth-method').textContent = authMethodMap[cred.authMethod] || cred.authMethod || '-';

    // Region
    document.getElementById('detail-region').textContent = cred.region || 'us-east-1';

    // Status
    const statusEl = document.getElementById('detail-status');
    const statusClass = cred.status === 'error' ? 'error' : cred.status === 'warning' ? 'warning' : 'normal';
    const statusText = statusClass === 'normal' ? 'Normal' : statusClass === 'warning' ? 'Warning' : 'Error';
    statusEl.innerHTML = `<span class="status-badge ${statusClass}">${statusText}</span>`;
    if (cred.isActive) {
        statusEl.innerHTML += ` <span class="status-badge active">Active</span>`;
    }

    // Time
    document.getElementById('detail-created').textContent = formatDateTime(cred.createdAt);
    document.getElementById('detail-expires').textContent = formatExpireTime(cred.expiresAt);

    // Token info (hidden by default)
    document.getElementById('detail-accken').textContent = maskToken(cred.accessToken);
    document.getElementById('detail-access-token').dataset.token = cred.accessToken || '';

    document.getElementById('detail-refresh-token').textContent = maskToken(cred.refreshToken);
    document.getElementById('detail-refresh-token').dataset.token = cred.refreshToken || '';

    // Profile ARN (only shown for Social Auth)
    if (cred.profileArn) {
        document.getElementById('profile-arn-section').style.display = 'block';
        document.getElementById('detail-profile-arn').textContent = cred.profileArn;
    }
}

// Format expiration time
function formatExpireTime(dateStr) {
    if (!dateStr) re
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date - now;

    if (diff < 0) {
        return `Expired (${formatDateTime(dateStr)})`;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours < 1) {
        return `Expires in ${minutes} minutes`;
    } else if (hours < 24) {
        return `Expires in ${hours} hours ${minutes} minutes`;
    } else {
        const days = Math.floor(hours / 24);
        return `Expires in ${days} days (${formatDateTime(dateStr)})`;
    }
}

// Mask Token
function maskToken(token) {
    if (!token) return '-';
    if (token.length <= 20) return '••••••••••••••••';
    return token.substring(0, 10) + '••••••••••••••••' + token.substring(token.length - 10);
}

// Toggle Token visibility
function toggleToken(type) {
    tokenVisible[type] = !tokenVisible[type];
    const el = document.getElementById(`detail-${type}-token`);
    const token = el.dataset.token;

    if (tokenVisible[type]) {
        el.textContent = token || '-';
    } else {
        el.textContent = maskToken(token);
    }
}

// Copy Token
function copyToken(type) {
    const el = document.getElementById(`detail-${type}-token`);
    const ken = el.dataset.token;
    if (token) {
        copyToClipboard(token);
    } else {
        showToast('Token is empty', 'warning');
    }
}

// Copy Profile ARN
function copyProfileArn() {
    const arn = document.getElementById('detail-profile-arn').textContent;
    if (arn && arn !== '-') {
        copyToClipboard(arn);
    }
}

// Refresh Token
async function refreshToken() {
    showToast('Refreshing Token...', 'warning');

    try {
        const res = await fetch(`/api/credentials/${accountId}/refresh`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('Token refreshed successfully', 'success');
            await loadAccountDetail();
        } else {
            showToast('Token refresh failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Token refresh failed: ' + error.message, 'error');
    }
}

// Test connection
async function testConnection() {
    showToast('Testing connection...', 'warning');

    try {
        const res = await fetch(`/api/credentials/${accountId}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('Connection test successful', 'success');
        } else {
            showToast('Connection test failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Connection test failed: ' + error.message, 'error');
    }
}

// Refresh usage
async function refreshUsage() {
    const usageContent = document.getElementById('usage-content');
    usageContent.innerHTML = '<p style="color: var(--text-muted);">Loading...</p>';

    try {
        const res = await fetch(`/api/credentials/${accountId}/usage`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success && result.data) {
            renderUsage(result.data);
        } else {
            usageContent.innerHTML = `<p style="color: var(--accent-danger);">Failed to get usage: ${result.error || 'Unknown error'}</p>`;
        }
    } catch (error) {
        usageContent.innerHTML = `<p style="color: var(--accent-danger);">Failed to get usage: ${error.message}</p>`;
    }
}

// Render usage info
function renderUsage(usage) {
    const usageContent = document.getElementById('usage-content');

    if (!usage.usageBreakdownList || usage.usageBreakdownList.length === 0) {
        usageContent.innerHTML = '<p style="color: var(--text-muted);">No usage data available</p>';
        return;
    }

    let html = '';

    usage.usageBreakdownList.forEach(breakdown => {
        const displayName = breakdown.displayNamePlural || breakdown.displayName || 'Credits';
        let usedCount = 0;
        let totalCount = 0;
        let isFreeTrialActive = false;

        if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
            isFreeTrialActive = true;
            usedCo breakdown.freeTrialInfo.currentUsageWithPrecision || breakdown.freeTrialInfo.currentUsage || 0;
            totalCount = breakdown.freeTrialInfo.usageLimitWithPrecision || breakdown.freeTrialInfo.usageLimit || 500;
        } else {
            usedCount = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
            totalCount = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;
        }

        const usagePercent = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;
        const barClass = usagePercent > 80 ? 'danger' : usagePercent > 50 ? 'warning' : '';

        let resetText = '';
        if (breakdown.nextDateReset) {
            const resetDate = new Date(breakdown.nextDateReset * 1000);
            resetText = `Reset time: ${formatDateTime(resetDate.toISOString())}`;
        }

        const trialBadge = isFreeTrialActive ? '<span style="background: var(--accent-success-bg); color: var(--accent-success); padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">Trial</span>' : '';

        html += `
            <div class="usage-section">
                <div style="display: flex; align-items: center; justify-content: space-between;">
           <span style="font-weight: 500; color: var(--text-primary);">${displayName}${trialBadge}</span>
                    <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${usagePercent}%</span>
                </div>
                <div class="usage-bar-container">
                    <div class="usage-bar">
                        <div class="usage-bar-fill ${barClass}" style="width: ${Math.min(usagePercent, 100)}%"></div>
                    </div>
                    <div class="usage-stats">
                        <span>Used ${usedCount.toFixed(2)} / ${totalCount}</span>
                        <span>${resetText || 'Remaining ' + (totalCount - usedCount).toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `;
    });

    usageContent.innerHTML = html;
}

// Start chat
function startChat() {
    window.location.href = `/pages/chat.html?account=${accountId}`;
}

// Delete account
async function deleteAccount() {
    if (!confirm('Are you sure you want to delete this account? This action cannot be undone.')) {
        return;
    }

    try {
        const res = await fetch(`/api/credentials/${accountId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('Account deleted', 'success');
            setTimeout(() => goBack(), 1000);
        } else {
            showToast('Delete failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Delete failed: ' + error.message, 'error');
    }
}
