// ============ Error Accounts Page JS ============

let errorAccounts = [];

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('error-accounts');

    if (!await checkAuth()) return;

    loadErrorAccounts();
    setupEventListeners();
    updateSidebarStats();
});

function setupEventListeners() {
    document.getElementById('refresh-all-btn').addEventListener('click', refreshAllErrorAccounts);
    document.getElementById('delete-all-btn').addEventListener('click', deleteAllErrorAccounts);
}

async function loadErrorAccounts() {
    try {
        const res = await fetch('/api/error-credentials', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        errorAccounts = result.success ? result.data : [];
        renderErrorAccounts();
    } catch (err) {
        console.error('Load error accounts error:', err);
        showToast('Failed to load error accounts', 'error');
    }
}

function renderErrorAccounts() {
    const list = document.getElementById('error-accounts-list');
    const emptyState = document.getElementById('empty-state');

    if (errorAccounts.length === 0) {
        list.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    list.innerHTML = errorAccounts.map(function(acc) {
        return '<tr>' +
            '<td>' + (acc.email || acc.name || 'Unknown') + '</td>' +
            '<td>' + (acc.authMethod || 'social') + '</td>' +
            '<td>' + (acc.region || 'us-east-1') + '</td>' +
            '<td>' + formatDateTime(acc.errorAt || acc.updatedAt) + '</td>' +
            '<td style="color: var(--accent-danger);">' + (acc.errorMessage || 'Unknown error') + '</td>' +
            '<td>' +
            '<div style="display: flex; gap: 4px;">' +
            '<button class="btn btn-primary btn-sm" onclick="refreshErrorAccountUsage(' + acc.id + ')">Refresh Usage</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="refreshErrorAccount(' + acc.id + ')">Refresh Token</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="restoreErrorAccount(' + acc.id + ')">Restore</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteErrorAccount(' + acc.id + ')">Delete</button>' +
            '</div>' +
            '</td>' +
            '</tr>';
    }).join('');
}

async function refreshErrorAccount(id) {
    showToast('Refreshing Token...', 'warning');
    try {
        const res = await fetch('/api/error-credentials/' + id + '/refresh', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('Token refreshed successfully, account restored', 'success');
            loadErrorAccounts();
            updateSidebarStats();
        } else {
            showToast('Token refresh failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        showToast('Token refresh failed: ' + err.message, 'error');
    }
}

async function refreshErrorAccountUsage(id) {
    showToast('Refreshing usage...', 'warning');
    try {
        const res = await fetch('/api/error-credentials/' + id + '/usage', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            if (result.restored) {
                showToast('Usage retrieved successfully, account restored to normal list', 'success');
                loadErrorAccounts();
                updateSidebarStats();
            } else {
                showToast('Usage retrieved successfully', 'success');
            }
        } else {
            showToast('Failed to get usage: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        showToast('Failed to get usage: ' + err.message, 'error');
    }
}

async function restoreErrorAccount(id) {
    if (!confirm('Are you sure you want to restore this account? (Token will not be refreshed)')) return;
    try {
        const res = await fetch('/api/error-credentials/' + id + '/restore', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('Account restored', 'success');
            loadErrorAccounts();
            updateSidebarStats();
        } else {
            showToast('Restore failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        showToast('Restore failed: ' + err.message, 'error');
    }
}

async function deleteErrorAccount(id) {
    if (!confirm('Are you sure you want to delete this account?')) return;
    try {
        await fetch('/api/error-credentials/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        showToast('Account deleted', 'success');
        loadErrorAccounts();
        updateSidebarStats();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    }
}

async function refreshAllErrorAccounts() {
    if (errorAccounts.length === 0) {
        showToast('No accounts to refresh', 'warning');
        return;
    }
    showToast('Batch refreshing...', 'warning');
    let successCount = 0;
    let failCount = 0;

    for (const acc of errorAccounts) {
        try {
            const res = await fetch('/api/error-credentials/' + acc.id + '/refresh', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const result = await res.json();
            if (result.success) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (err) {
            failCount++;
        }
    }

    showToast('Refresh complete: ' + successCount + ' succeeded, ' + failCount + ' failed', successCount > 0 ? 'success' : 'warning');
    loadErrorAccounts();
    updateSidebarStats();
}

async function deleteAllErrorAccounts() {
    if (errorAccounts.length === 0) {
        showToast('No accounts to delete', 'warning');
        return;
    }
    if (!confirm('Are you sure you want to delete all ' + errorAccounts.length + ' error accounts?')) return;

    for (const acc of errorAccounts) {
        try {
            await fetch('/api/error-credentials/' + acc.id, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
        } catch (err) {}
    }

    showToast('All error accounts cleared', 'success');
    loadErrorAccounts();
    updateSidebarStats();
}
