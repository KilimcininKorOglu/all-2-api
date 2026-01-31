// ============ Account Management Page JS ============

// State variables
let credentials = [];
let selectedIds = new Set();
let currentFilter = 'all';
let searchQuery = '';
let contextMenuTarget = null;

// DOM Elements
let cardsGrid, emptyState, addModal, batchImportModal, contextMenu, searchInput;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Get DOM elements
    cardsGrid = document.getElementById('cards-grid');
    emptyState = document.getElementById('empty-state');
    addModal = document.getElementById('add-modal');
    batchImportModal = document.getElementById('batch-import-modal');
    contextMenu = document.getElementById('context-menu');
    searchInput = document.getElementById('search-input');

    // Load site settings first
    await loadSiteSettings();

    // Inject sidebar
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('accounts');

    // Update page title and subtitle
    const settings = window.siteSettings;
    document.title = `Account Management - ${settings.siteName} ${settings.siteSubtitle}`;
    const pageSubtitle = document.querySelector('.page-subtitle');
    if (pageSubtitle) {
        pageSubtitle.textContent = `Manage your ${settings.siteName} API credentials`;
    }

    if (!await checkAuth()) return;

    await loadCredentials();
    setupEventListeners();
    updateSidebarStats();
});

// Event Listeners
function setupEventListeners() {
    // Add account button
    document.getElementById('add-account-btn').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

    // Batch import button
    document.getElementById('batch-import-btn').addEventListener('click', openBatchImportModal);
    document.getElementById('batch-modal-close').addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-modal-cancel').addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-modal-submit').addEventListener('click', handleBatchImport);
    batchImportModal.addEventListener('click', (e) => {
        if (e.target === batchImportModal) closeBatchImportModal();
    });

    // Modal controls
    document.getElementById('modal-close').addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel').addEventListener('click', closeAddModal);
    document.getElementById('modal-submit').addEventListener('click', handleAddAccount);
    addModal.addEventListener('click', (e) => {
        if (e.target === addModal) closeAddModal();
    });

    // Auth method switch
    document.getElementById('auth-method').addEventListener('change', (e) => {
        const clientCreds = document.getElementById('client-credentials');
        clientCreds.style.display = ['builder-id', 'IdC'].includes(e.target.value) ? 'block' : 'none';
    });

    // Search
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderCards();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
        }
        if (e.key === 'Escape') {
            closeAddModal();
            closeBatchImportModal();
            hideContextMenu();
        }
    });

    // Filter tabs
    document.querySelectorAll('.header-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.header-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderCards();
        });
    });

    // Select all
    document.getElementById('select-all').addEventListener('change', (e) => {
        const filtered = getFilteredCredentials();
        if (e.target.checked) {
            filtered.forEach(c => selectedIds.add(c.id));
        } else {
            selectedIds.clear();
        }
        renderCards();
        updateBatchDeleteBtn();
    });

    // Batch refresh quota
    document.getElementById('refresh-usage-btn').addEventListener('click', batchRefreshUsage);

    // Batch refresh Token
    document.getElementById('refresh-all-btn').addEventListener('click', refreshAllCredentials);

    // Batch delete
    document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);

    // Context menu
    document.addEventListener('click', hideContextMenu);
    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => handleContextAction(item.dataset.action));
    });
}

// API Functions
async function loadCredentials() {
    try {
        const res = await fetch('/api/credentials', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        credentials = Array.isArray(result) ? result : (result.data || []);
        updateCounts();
        renderCards();
    } catch (err) {
        console.error('Load credentials error:', err);
        showToast('Failed to load accounts', 'error');
    }
}

// Batch refresh quota
async function batchRefreshUsage() {
    showToast('Batch refreshing quota...', 'warning');
    let successCount = 0;
    let failCount = 0;

    for (const cred of credentials) {
        try {
            const res = await fetch('/api/credentials/' + cred.id + '/usage', {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const result = await res.json();
            if (result.success && result.data) {
                cred.usage = result.data;
                updateCardUsage(cred.id, result.data);
                successCount++;
            } else {
                updateCardUsageError(cred.id, result.error || 'Failed to get');
                failCount++;
            }
        } catch (err) {
            updateCardUsageError(cred.id, err.message);
            failCount++;
        }
    }

    if (failCount > 0) {
        showToast('Refresh complete: ' + successCount + ' succeeded, ' + failCount + ' failed', 'warning');
    } else {
        showToast('Refresh complete: ' + successCount + ' accounts', 'success');
    }

    // Update stats cards
    updateStatsCards();
}

// Refresh single account quota
async function refreshSingleUsage(id) {
    const card = document.querySelector('.account-card[data-id="' + id + '"]');
    const usageValue = card?.querySelector('.usage-value');
    if (usageValue) usageValue.textContent = 'Loading...';

    try {
        const res = await fetch('/api/credentials/' + id + '/usage', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success && result.data) {
            const cred = credentials.find(c => c.id === id);
            if (cred) {
                cred.usage = result.data;
                cred.usageData = result.data;
            }
            showToast('Quota refresh successful', 'success');
            renderCards();
        } else {
            showToast('Quota refresh failed: ' + (result.error || 'Failed to get'), 'error');
            // Refresh failure may mean account was moved to error table, reload list
            await loadCredentials();
            updateSidebarStats();
        }
    } catch (err) {
        showToast('Quota refresh failed: ' + err.message, 'error');
        // Refresh failure may mean account was moved to error table, reload list
        await loadCredentials();
        updateSidebarStats();
    }
}

// Refresh single account Token
async function refreshSingleToken(id) {
    showToast('Refreshing Token...', 'warning');
    try {
        const res = await fetch('/api/credentials/' + id + '/refresh', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('Token refresh successful', 'success');
            await loadCredentials();
        } else {
            showToast('Token refresh failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        showToast('Token refresh failed: ' + err.message, 'error');
    }
}

// Show quota loading error
function updateCardUsageError(id, errorMsg) {
    const card = document.querySelector('.account-card[data-id="' + id + '"]');
    if (!card) return;
    const usageValue = card.querySelector('.usage-value');
    if (usageValue) {
        usageValue.textContent = 'Failed to get';
        usageValue.style.color = 'var(--accent-danger)';
        usageValue.title = errorMsg;
    }
}

// Update card usage display
function updateCardUsage(id, usage) {
    const card = document.querySelector('.account-card[data-id="' + id + '"]');
    if (!card) return;

    const usageSection = card.querySelector('.card-usage');
    if (!usageSection || !usage) return;

    let usagePercent = 0;
    let usedCount = 0;
    let totalCount = 0;
    let displayName = 'Credits';
    let isFreeTrialActive = false;
    let nextReset = null;

    if (usage.usageBreakdownList && usage.usageBreakdownList.length > 0) {
        const breakdown = usage.usageBreakdownList[0];
        displayName = breakdown.displayNamePlural || breakdown.displayName || 'Credits';

        if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
            isFreeTrialActive = true;
            usedCount = breakdown.freeTrialInfo.currentUsageWithPrecision || breakdown.freeTrialInfo.currentUsage || 0;
            totalCount = breakdown.freeTrialInfo.usageLimitWithPrecision || breakdown.freeTrialInfo.usageLimit || 500;
        } else {
            usedCount = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
            totalCount = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;
        }

        if (breakdown.nextDateReset) {
            nextReset = new Date(breakdown.nextDateReset * 1000);
        }

        usagePercent = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;
    }

    const usageClass = usagePercent > 80 ? 'danger' : usagePercent > 50 ? 'warning' : '';
    const resetText = nextReset ? formatResetDate(nextReset) : '';
    const trialBadge = isFreeTrialActive ? '<span style="background: var(--accent-success-bg); color: var(--accent-success); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px;">Trial</span>' : '';

    usageSection.innerHTML = '<div class="usage-header">' +
        '<span class="usage-label">' + displayName + trialBadge + '</span>' +
        '<span class="usage-value ' + usageClass + '">' + usagePercent + '%</span>' +
        '</div>' +
        '<div class="usage-bar">' +
        '<div class="usage-bar-fill ' + usageClass + '" style="width: ' + Math.min(usagePercent, 100) + '%"></div>' +
        '</div>' +
        '<div class="usage-details">' +
        '<span class="usage-used">Used ' + usedCount.toFixed(2) + ' / ' + totalCount + '</span>' +
        '<span class="usage-remaining">' + (resetText ? 'Reset: ' + resetText : 'Remaining ' + (totalCount - usedCount).toFixed(2)) + '</span>' +
        '</div>';
}

function formatResetDate(date) {
    const now = new Date();
    const diff = date - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days < 0) return 'Reset';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return 'In ' + days + ' days';
}

async function handleAddAccount(e) {
    e.preventDefault();
    const authMethod = document.getElementById('auth-method').value;
    const email = document.getElementById('account-email').value;
    const region = document.getElementById('account-region').value;
    const provider = document.getElementById('account-provider').value;
    const refreshToken = document.getElementById('refresh-token').value;

    const data = { email: email, region: region, provider: provider, refreshToken: refreshToken, authMethod: authMethod };

    if (['builder-id', 'IdC'].includes(authMethod)) {
        data.clientId = document.getElementById('client-id').value;
        data.clientSecret = document.getElementById('client-secret').value;
    }

    try {
        const res = await fetch('/api/credentials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            const result = await res.json();
            showToast('Account added successfully', 'success');
            closeAddModal();
            await loadCredentials();
            updateSidebarStats();

            // Auto-fetch quota for the new credential
            if (result.data?.id) {
                refreshSingleUsage(result.data.id);
            }
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to add', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

async function refreshAllCredentials() {
    showToast('Refreshing all accounts...', 'warning');
    for (const cred of credentials) {
        try {
            await fetch('/api/credentials/' + cred.id + '/refresh', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
        } catch (err) {}
    }
    await loadCredentials();
    showToast('Refresh complete', 'success');
}

async function batchDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm('Are you sure you want to delete ' + selectedIds.size + ' selected accounts?')) return;

    for (const id of selectedIds) {
        try {
            await fetch('/api/credentials/' + id, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
        } catch (err) {}
    }
    selectedIds.clear();
    await loadCredentials();
    showToast('Batch delete complete', 'success');
    updateBatchDeleteBtn();
    updateSidebarStats();
}

// Context menu actions
async function handleContextAction(action) {
    if (!contextMenuTarget) return;
    const id = contextMenuTarget;

    switch (action) {
        case 'activate':
            const activateRes = await fetch('/api/credentials/' + id + '/activate', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const activateData = await activateRes.json();
            if (activateData.success) {
                showToast('Set as active account', 'success');
            } else {
                showToast('Failed to activate: ' + (activateData.error || 'Unknown error'), 'error');
            }
            break;
        case 'refresh':
            showToast('Refreshing token...', 'warning');
            await fetch('/api/credentials/' + id + '/refresh', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            showToast('Token refresh successful', 'success');
            break;
        case 'test':
            showToast('Testing connection...', 'warning');
            const testRes = await fetch('/api/credentials/' + id + '/test', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const testData = await testRes.json();
            showToast(testData.success ? 'Connection test successful' : 'Connection test failed', testData.success ? 'success' : 'error');

            // Auto-refresh quota after successful test
            if (testData.success) {
                refreshSingleUsage(id);
            }
            break;
        case 'usage':
            const usageRes = await fetch('/api/credentials/' + id + '/usage', {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const usage = await usageRes.json();
            alert(JSON.stringify(usage, null, 2));
            break;
        case 'delete':
            if (confirm('Are you sure you want to delete this account?')) {
                await fetch('/api/credentials/' + id, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                showToast('Account deleted', 'success');
                updateSidebarStats();
            }
            break;
        case 'chat':
            window.location.href = '/pages/chat.html?account=' + id;
            break;
        case 'details':
            window.location.href = '/pages/account-detail.html?id=' + id;
            break;
    }
    await loadCredentials();
    hideContextMenu();
}

// Rendering functions
function getFilteredCredentials() {
    return credentials.filter(function(c) {
        const matchesFilter = currentFilter === 'all' ||
            (c.provider && c.provider.toLowerCase() === currentFilter);
        const matchesSearch = !searchQuery ||
            (c.email && c.email.toLowerCase().includes(searchQuery)) ||
            (c.provider && c.provider.toLowerCase().includes(searchQuery));
        return matchesFilter && matchesSearch;
    });
}

function renderCards() {
    const filtered = getFilteredCredentials();
    document.getElementById('displayed-count').textContent = filtered.length;

    if (filtered.length === 0) {
        cardsGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    cardsGrid.style.display = 'grid';
    emptyState.style.display = 'none';

    cardsGrid.innerHTML = filtered.map(function(cred) { return createCardHTML(cred); }).join('');

    // Add event listeners
    cardsGrid.querySelectorAll('.account-card').forEach(function(card) {
        const id = parseInt(card.dataset.id);

        card.querySelector('.card-checkbox input').addEventListener('change', function(e) {
            e.stopPropagation();
            if (e.target.checked) {
                selectedIds.add(id);
                card.classList.add('selected');
            } else {
                selectedIds.delete(id);
                card.classList.remove('selected');
            }
            updateBatchDeleteBtn();
        });

        card.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showContextMenu(e, id);
        });

        card.querySelectorAll('.card-action-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                contextMenuTarget = id;
                handleContextAction(btn.dataset.action);
            });
        });

        const copyBtn = card.querySelector('.copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const cred = credentials.find(function(c) { return c.id === id; });
                if (cred && cred.email) copyToClipboard(cred.email);
            });
        }

        const refreshUsageBtn = card.querySelector('.btn-refresh-usage');
        if (refreshUsageBtn) {
            refreshUsageBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                refreshSingleUsage(id);
            });
        }

        const refreshTokenBtn = card.querySelector('.btn-refresh-token');
        if (refreshTokenBtn) {
            refreshTokenBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                refreshSingleToken(id);
            });
        }
    });
}

// Generate usage display HTML
function generateUsageHTML(usage) {
    if (!usage) {
        return '<div class="usage-header"><span class="usage-label">Quota</span><span class="usage-value" style="color: var(--text-muted);">Click to refresh</span></div>' +
            '<div class="usage-bar"><div class="usage-bar-fill" style="width: 0%"></div></div>' +
            '<div class="usage-details"><span class="usage-used">--</span>' +
            '<span class="usage-remaining">' +
            '<button class="btn-refresh-usage" style="background: none; border: none; color: var(--accent-primary); cursor: pointer; font-size: 12px; padding: 2px 6px;">Refresh Quota</button>' +
            '<button class="btn-refresh-token" style="background: none; border: none; color: var(--accent-warning); cursor: pointer; font-size: 12px; padding: 2px 6px;">Refresh Token</button>' +
            '</span></div>';
    }

    let usagePercent = 0;
    let usedCount = 0;
    let totalCount = 0;
    let displayName = 'Credits';
    let isFreeTrialActive = false;
    let nextReset = null;

    if (usage.usageBreakdownList && usage.usageBreakdownList.length > 0) {
        const breakdown = usage.usageBreakdownList[0];
        displayName = breakdown.displayNamePlural || breakdown.displayName || 'Credits';

        if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
            isFreeTrialActive = true;
            usedCount = breakdown.freeTrialInfo.currentUsageWithPrecision || breakdown.freeTrialInfo.currentUsage || 0;
            totalCount = breakdown.freeTrialInfo.usageLimitWithPrecision || breakdown.freeTrialInfo.usageLimit || 500;
        } else {
            usedCount = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
            totalCount = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;
        }

        if (breakdown.nextDateReset) {
            nextReset = new Date(breakdown.nextDateReset * 1000);
        }

        usagePercent = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;
    }

    const usageClass = usagePercent > 80 ? 'danger' : usagePercent > 50 ? 'warning' : '';
    const resetText = nextReset ? formatResetDate(nextReset) : '';
    const trialBadge = isFreeTrialActive ? '<span style="background: var(--accent-success-bg); color: var(--accent-success); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px;">Trial</span>' : '';

    return '<div class="usage-header">' +
        '<span class="usage-label">' + displayName + trialBadge + '</span>' +
        '<span class="usage-value ' + usageClass + '">' + usagePercent + '%</span>' +
        '</div>' +
        '<div class="usage-bar">' +
        '<div class="usage-bar-fill ' + usageClass + '" style="width: ' + Math.min(usagePercent, 100) + '%"></div>' +
        '</div>' +
        '<div class="usage-details">' +
        '<span class="usage-used">Used ' + usedCount.toFixed(2) + ' / ' + totalCount + '</span>' +
        '<span class="usage-remaining">' + (resetText ? 'Reset: ' + resetText : 'Remaining ' + (totalCount - usedCount).toFixed(2)) + '</span>' +
        '</div>';
}

function createCardHTML(cred) {
    const isSelected = selectedIds.has(cred.id);
    const email = cred.email || cred.name || 'Unknown';
    const statusClass = cred.status === 'error' ? 'error' : cred.status === 'warning' ? 'warning' : 'normal';
    const statusText = statusClass === 'normal' ? 'Normal' : statusClass === 'warning' ? 'Warning' : 'Error';

    // Get subscription title from usage data
    const subscriptionTitle = cred.usageData?.subscriptionInfo?.subscriptionTitle || '';

    // Truncate email display (keep prefix and domain)
    const truncateEmail = function(email, maxLen) {
        if (email.length <= maxLen) return email;
        const atIndex = email.indexOf('@');
        if (atIndex === -1) return email.substring(0, maxLen - 3) + '...';
        const prefix = email.substring(0, atIndex);
        const domain = email.substring(atIndex);
        if (domain.length >= maxLen - 3) {
            return prefix.substring(0, 3) + '...' + domain.substring(0, maxLen - 6);
        }
        const availableLen = maxLen - domain.length - 3;
        if (availableLen <= 0) return email.substring(0, maxLen - 3) + '...';
        return prefix.substring(0, availableLen) + '...' + domain;
    };
    const displayEmail = truncateEmail(email, 28);

    let html = '<div class="account-card' + (isSelected ? ' selected' : '') + '" data-id="' + cred.id + '">';
    html += '<div class="card-status">';
    html += '<span class="status-badge ' + statusClass + '">' + statusText + '</span>';
    if (subscriptionTitle) {
        html += '<span class="subscription-badge">' + subscriptionTitle + '</span>';
    }
    html += '</div>';

    html += '<div class="card-header">';
    html += '<div class="card-checkbox"><input type="checkbox" class="checkbox-custom"' + (isSelected ? ' checked' : '') + '></div>';
    html += '<div class="card-info">';
    html += '<div class="card-email" title="' + email + '"><span>' + displayEmail + '</span>';
    html += '<button class="copy-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>';
    html += '<div class="card-meta"><span>' + (cred.authMethod || 'social') + '</span><span class="card-meta-divider"></span><span>' + (cred.region || 'us-east-1') + '</span></div>';
    html += '</div></div>';

    html += '<div class="card-usage">';
    html += generateUsageHTML(cred.usageData);
    html += '</div>';

    html += '<div class="card-footer">';
    html += '<div class="card-dates"><div class="date-item">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    html += '<span class="date-value">' + formatExpireDate(cred.expiresAt) + '</span></div></div>';

    html += '<div class="card-actions">';
    html += '<button class="card-action-btn' + (cred.isActive ? ' active' : '') + '" data-action="activate" title="' + (cred.isActive ? 'Active' : 'Set Active') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>';
    html += '<button class="card-action-btn" data-action="test" title="Test"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>';
    html += '<button class="card-action-btn" data-action="chat" title="Chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>';
    html += '<button class="card-action-btn" data-action="details" title="Details"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>';
    html += '<button class="card-action-btn danger" data-action="delete" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    html += '</div></div></div>';

    return html;
}

// Helper functions
function updateCounts() {
    const total = credentials.length;
    const google = credentials.filter(function(c) { return c.provider && c.provider.toLowerCase() === 'google'; }).length;
    const github = credentials.filter(function(c) { return c.provider && c.provider.toLowerCase() === 'github'; }).length;

    document.getElementById('tab-count-all').textContent = total;
    document.getElementById('tab-count-google').textContent = google;
    document.getElementById('tab-count-github').textContent = github;

    // Update stats cards
    updateStatsCards();
}

// Update stats cards
function updateStatsCards() {
    let totalQuota = 0;
    let totalUsed = 0;
    let accountsWithUsage = 0;

    credentials.forEach(function(cred) {
        const usage = cred.usageData;
        if (usage && usage.usageBreakdownList && usage.usageBreakdownList.length > 0) {
            const breakdown = usage.usageBreakdownList[0];
            let usedCount = 0;
            let quotaCount = 0;

            if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
                usedCount = breakdown.freeTrialInfo.currentUsageWithPrecision || breakdown.freeTrialInfo.currentUsage || 0;
                quotaCount = breakdown.freeTrialInfo.usageLimitWithPrecision || breakdown.freeTrialInfo.usageLimit || 500;
            } else {
                usedCount = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
                quotaCount = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;
            }

            totalUsed += usedCount;
            totalQuota += quotaCount;
            accountsWithUsage++;
        }
    });

    const totalRemaining = totalQuota - totalUsed;
    const avgUsage = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0;

    document.getElementById('stat-total-accounts').textContent = credentials.length;
    document.getElementById('stat-total-quota').textContent = totalQuota.toFixed(2);
    document.getElementById('stat-total-used').textContent = totalUsed.toFixed(2);
    document.getElementById('stat-total-remaining').textContent = totalRemaining.toFixed(2);
    document.getElementById('stat-avg-usage').textContent = avgUsage + '%';

    // Set color based on usage rate
    const avgUsageEl = document.getElementById('stat-avg-usage');
    avgUsageEl.className = 'stat-value';
    if (avgUsage > 80) {
        avgUsageEl.classList.add('danger');
    } else if (avgUsage > 50) {
        avgUsageEl.classList.add('warning');
    }
}

function updateBatchDeleteBtn() {
    const btn = document.getElementById('batch-delete-btn');
    btn.style.display = selectedIds.size > 0 ? 'inline-flex' : 'none';
}

function formatExpireDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 0) return 'Expired';
    if (hours < 24) return 'In ' + hours + ' hours';
    return 'In ' + Math.floor(hours / 24) + ' days';
}

// Modal functions
function openAddModal() {
    addModal.classList.add('active');
    document.getElementById('add-account-form').reset();
    document.getElementById('client-credentials').style.display = 'none';
}

function closeAddModal() {
    addModal.classList.remove('active');
}

function openBatchImportModal() {
    batchImportModal.classList.add('active');
    document.getElementById('batch-json').value = '';
}

function closeBatchImportModal() {
    batchImportModal.classList.remove('active');
}

async function handleBatchImport() {
    const inputText = document.getElementById('batch-json').value.trim();
    const region = document.getElementById('batch-region').value;
    const provider = document.getElementById('batch-provider').value;

    if (!inputText) {
        showToast('Please enter account data', 'error');
        return;
    }

    let accounts;

    if (inputText.startsWith('[')) {
        try {
            accounts = JSON.parse(inputText);
        } catch (err) {
            showToast('JSON format error: ' + err.message, 'error');
            return;
        }
    } else {
        accounts = [];
        const lines = inputText.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const spaceIndex = line.indexOf(' ');
            if (spaceIndex === -1) {
                showToast('Line ' + (i + 1) + ' format error', 'error');
                return;
            }

            const email = line.substring(0, spaceIndex).trim();
            const refreshToken = line.substring(spaceIndex + 1).trim();

            if (!email || !refreshToken) {
                showToast('Line ' + (i + 1) + ' data incomplete', 'error');
                return;
            }

            accounts.push({ email: email, refreshToken: refreshToken });
        }
    }

    accounts = accounts.map(function(acc) {
        return Object.assign({}, acc, { provider: provider });
    });

    showToast('Importing ' + accounts.length + ' accounts...', 'warning');

    try {
        const res = await fetch('/api/credentials/batch-import', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ accounts: accounts, region: region })
        });

        const result = await res.json();
        if (result.success) {
            showToast('Import complete: ' + result.data.success + ' succeeded, ' + result.data.failed + ' failed', 'success');
            closeBatchImportModal();
            loadCredentials();
            updateSidebarStats();
        } else {
            showToast(result.error || 'Import failed', 'error');
        }
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    }
}

// Context menu functions
function showContextMenu(e, id) {
    contextMenuTarget = id;
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.add('active');
}

function hideContextMenu() {
    contextMenu.classList.remove('active');
    contextMenuTarget = null;
}
