// ============ Warp Account Management Page JS ============

// State
let credentials = [];
let selectedIds = new Set();
let searchQuery = '';
let currentDetailId = null;

// DOM Elements
const DOM = {};

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    initDOMReferences();
    setupEventListeners();
    await loadCredentials();
    await loadStatistics();
});

function initDOMReferences() {
    DOM.cardsGrid = document.getElementById('cards-grid');
    DOM.emptyState = document.getElementById('empty-state');
    DOM.searchInput = document.getElementById('search-input');
    DOM.addModal = document.getElementById('add-modal');
    DOM.batchModal = document.getElementById('batch-import-modal');
    DOM.detailModal = document.getElementById('detail-modal');
    DOM.editModal = document.getElementById('edit-modal');
    DOM.contextMenu = document.getElementById('context-menu');
}

function setupEventListeners() {
    // Header buttons
    document.getElementById('add-account-btn')?.addEventListener('click', openAddModal);
    document.getElementById('batch-import-btn')?.addEventListener('click', openBatchModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);
    document.getElementById('refresh-tokens-btn')?.addEventListener('click', refreshAllTokens);
    document.getElementById('refresh-quotas-btn')?.addEventListener('click', refreshAllQuotas);

    // Search
    DOM.searchInput?.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderCredentials();
    });

    // Add modal
    document.getElementById('add-modal-close')?.addEventListener('click', closeAddModal);
    document.getElementById('add-modal-cancel')?.addEventListener('click', closeAddModal);
    document.getElementById('add-modal-submit')?.addEventListener('click', handleAddAccount);

    // Batch modal
    document.getElementById('batch-modal-close')?.addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-cancel')?.addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-submit')?.addEventListener('click', handleBatchImport);

    // Detail modal
    document.getElementById('detail-modal-close')?.addEventListener('click', closeDetailModal);
    document.getElementById('detail-close-btn')?.addEventListener('click', closeDetailModal);
    document.getElementById('detail-delete-btn')?.addEventListener('click', handleDeleteFromDetail);
    document.getElementById('detail-edit-btn')?.addEventListener('click', handleEditFromDetail);

    // Edit modal
    document.getElementById('edit-modal-close')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-cancel')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-submit')?.addEventListener('click', handleEditSubmit);

    // Outside click for modals
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            if (e.target.id === 'add-modal') closeAddModal();
            if (e.target.id === 'batch-import-modal') closeBatchModal();
            if (e.target.id === 'detail-modal') closeDetailModal();
            if (e.target.id === 'edit-modal') closeEditModal();
        }
        hideContextMenu();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAddModal();
            closeBatchModal();
            closeDetailModal();
            closeEditModal();
            hideContextMenu();
        }
    });

    // Context menu
    document.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', handleContextMenuAction);
    });
}

// API Functions
async function loadCredentials() {
    try {
        const res = await fetch('/api/warp/credentials');
        const data = await res.json();
        if (data.success) {
            credentials = data.data;
            renderCredentials();
        }
    } catch (e) {
        showToast('Load failed: ' + e.message, 'error');
    }
}

async function loadStatistics() {
    try {
        const res = await fetch('/api/warp/statistics');
        const data = await res.json();
        if (data.success) {
            document.getElementById('stat-total-accounts').textContent = data.data.total || 0;
            document.getElementById('stat-healthy-accounts').textContent = data.data.healthy || 0;
            document.getElementById('stat-error-accounts').textContent = data.data.errors || 0;
            document.getElementById('stat-total-usage').textContent = data.data.totalUseCount || 0;
        }
    } catch (e) {
        console.error('Failed to load statistics:', e);
    }
}

// Rendering
function renderCredentials() {
    const filtered = credentials.filter(cred => {
        if (!searchQuery) return true;
        return (cred.name && cred.name.toLowerCase().includes(searchQuery)) ||
               (cred.email && cred.email.toLowerCase().includes(searchQuery));
    });

    document.getElementById('displayed-count').textContent = filtered.length;

    if (filtered.length === 0) {
        DOM.emptyState.style.display = 'block';
        DOM.cardsGrid.style.display = 'none';
        return;
    }

    DOM.emptyState.style.display = 'none';
    DOM.cardsGrid.style.display = 'grid';
    DOM.cardsGrid.innerHTML = filtered.map(createCardHTML).join('');
}

function createCardHTML(cred) {
    const initial = (cred.name || cred.email || 'W')[0].toUpperCase();
    const statusClass = cred.errorCount >= 3 ? 'error' : (cred.isActive ? 'healthy' : 'disabled');
    const statusText = cred.errorCount >= 3 ? 'Error' : (cred.isActive ? 'Normal' : 'Disabled');
    const expiresAt = cred.tokenExpiresAt ? new Date(cred.tokenExpiresAt).toLocaleString() : 'Unknown';

    // Quota display
    let quotaText = 'Click to refresh';
    let quotaClass = '';
    if (cred.quotaLimit === -1) {
        quotaText = 'Unlimited';
        quotaClass = 'success';
    } else if (cred.quotaLimit > 0) {
        const remaining = cred.quotaLimit - (cred.quotaUsed || 0);
        quotaText = `${cred.quotaUsed || 0}/${cred.quotaLimit}`;
        quotaClass = remaining < 50 ? 'error' : (remaining < 100 ? 'warning' : 'success');
    }

    return `
        <div class="account-card ${statusClass}" data-id="${cred.id}" onclick="openDetailModal(${cred.id})" oncontextmenu="showContextMenu(event, ${cred.id})">
            <div class="card-header">
                <div class="card-avatar">${initial}</div>
                <div class="card-info">
                    <div class="card-name">${cred.name || 'Unnamed'}</div>
                    <div class="card-email">${cred.email || 'No email'}</div>
                </div>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="card-body">
                <div class="card-row">
                    <span class="card-label">Use Count</span>
                    <span class="card-value">${cred.useCount || 0}</span>
                </div>
                <div class="card-row">
                    <span class="card-label">Quota</span>
                    <span class="card-value ${quotaClass}">${quotaText}</span>
                </div>
                <div class="card-row">
                    <span class="card-label">Token Expires</span>
                    <span class="card-value">${expiresAt}</span>
                </div>
            </div>
        </div>
    `;
}

// Modal Functions
function openAddModal() {
    DOM.addModal.classList.add('active');
    document.getElementById('add-name').value = '';
    document.getElementById('add-refresh-token').value = '';
}

function closeAddModal() {
    DOM.addModal.classList.remove('active');
}

function openBatchModal() {
    DOM.batchModal.classList.add('active');
    document.getElementById('batch-data').value = '';
}

function closeBatchModal() {
    DOM.batchModal.classList.remove('active');
}

function openDetailModal(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    currentDetailId = id;
    const statusClass = cred.errorCount >= 3 ? 'error' : (cred.isActive ? 'success' : 'warning');
    const statusText = cred.errorCount >= 3 ? 'Error' : (cred.isActive ? 'Normal' : 'Disabled');

    let quotaText = 'Not checked';
    if (cred.quotaLimit === -1) {
        quotaText = 'Unlimited';
    } else if (cred.quotaLimit > 0) {
        quotaText = `${cred.quotaUsed || 0} / ${cred.quotaLimit}`;
    }

    document.getElementById('detail-modal-body').innerHTML = `
        <div class="detail-grid">
            <div class="detail-row">
                <span class="detail-label">ID</span>
                <span class="detail-value">${cred.id}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Name</span>
                <span class="detail-value">${cred.name || '-'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Email</span>
                <span class="detail-value">${cred.email || '-'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="detail-value ${statusClass}">${statusText}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Use Count</span>
                <span class="detail-value">${cred.useCount || 0}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Error Count</span>
                <span class="detail-value">${cred.errorCount || 0}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Quota</span>
                <span class="detail-value">${quotaText}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Token Expires</span>
                <span class="detail-value">${cred.tokenExpiresAt ? new Date(cred.tokenExpiresAt).toLocaleString() : '-'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Created At</span>
                <span class="detail-value">${cred.createdAt ? new Date(cred.createdAt).toLocaleString() : '-'}</span>
            </div>
        </div>
    `;

    DOM.detailModal.classList.add('active');
}

function closeDetailModal() {
    DOM.detailModal.classList.remove('active');
    currentDetailId = null;
}

function openEditModal(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    document.getElementById('edit-account-id').value = cred.id;
    document.getElementById('edit-account-name').value = cred.name || '';
    document.getElementById('edit-is-active').checked = cred.isActive;

    DOM.editModal.classList.add('active');
}

function closeEditModal() {
    DOM.editModal.classList.remove('active');
}

// Context Menu
function showContextMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    currentDetailId = id;

    const menu = DOM.contextMenu;
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.classList.add('active');
}

function hideContextMenu() {
    DOM.contextMenu.classList.remove('active');
}

function handleContextMenuAction(e) {
    const action = e.currentTarget.dataset.action;
    const id = currentDetailId;

    hideContextMenu();

    switch (action) {
        case 'details':
            openDetailModal(id);
            break;
        case 'refresh':
            refreshToken(id);
            break;
        case 'quota':
            refreshQuota(id);
            break;
        case 'delete':
            deleteCredential(id);
            break;
    }
}

// Action Handlers
async function handleAddAccount() {
    const name = document.getElementById('add-name').value.trim();
    const refreshToken = document.getElementById('add-refresh-token').value.trim();

    if (!refreshToken) {
        showToast('Please enter Refresh Token', 'error');
        return;
    }

    try {
        const res = await fetch('/api/warp/credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, refreshToken })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Added successfully', 'success');
            closeAddModal();
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast('Add failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Add failed: ' + e.message, 'error');
    }
}

async function handleBatchImport() {
    const dataStr = document.getElementById('batch-data').value.trim();
    if (!dataStr) {
        showToast('Please enter account data', 'error');
        return;
    }

    let accounts;
    if (dataStr.startsWith('[') || dataStr.startsWith('{')) {
        try {
            accounts = JSON.parse(dataStr);
            if (!Array.isArray(accounts)) accounts = [accounts];
        } catch (e) {
            showToast('JSON format error', 'error');
            return;
        }
    } else {
        accounts = parseTextFormat(dataStr);
        if (accounts.length === 0) {
            showToast('No valid tokens found', 'error');
            return;
        }
    }

    try {
        const res = await fetch('/api/warp/credentials/batch-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accounts })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`Import complete: ${data.data.success} success, ${data.data.failed} failed`, 'success');
            closeBatchModal();
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast('Import failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Import failed: ' + e.message, 'error');
    }
}

function parseTextFormat(text) {
    const accounts = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let currentName = null;
    for (const line of lines) {
        const nameMatch = line.match(/^Account\s*(\d+)$/i);
        if (nameMatch) {
            currentName = `Account${nameMatch[1]}`;
            continue;
        }
        if (line.startsWith('AMf-') || line.length > 100) {
            accounts.push({
                refreshToken: line,
                name: currentName || `Account${accounts.length + 1}`
            });
            currentName = null;
        }
    }
    return accounts;
}

function handleDeleteFromDetail() {
    if (currentDetailId) {
        const id = currentDetailId;
        closeDetailModal();
        deleteCredential(id);
    }
}

function handleEditFromDetail() {
    if (currentDetailId) {
        const id = currentDetailId;
        closeDetailModal();
        openEditModal(id);
    }
}

async function handleEditSubmit() {
    const id = parseInt(document.getElementById('edit-account-id').value);
    const name = document.getElementById('edit-account-name').value.trim();
    const isActive = document.getElementById('edit-is-active').checked;

    if (!name) {
        showToast('Name is required', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/warp/credentials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, isActive })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Updated successfully', 'success');
            closeEditModal();
            await loadCredentials();
        } else {
            showToast('Update failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Update failed: ' + e.message, 'error');
    }
}

async function refreshToken(id) {
    try {
        showToast('Refreshing token...', 'info');
        const res = await fetch(`/api/warp/credentials/${id}/refresh`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Token refreshed successfully', 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast('Refresh failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Refresh failed: ' + e.message, 'error');
    }
}

async function refreshQuota(id) {
    try {
        showToast('Checking quota...', 'info');
        const res = await fetch(`/w/api/quota?credentialId=${id}`);
        const data = await res.json();
        if (data.success) {
            const q = data.data;
            const cred = credentials.find(c => c.id === id);
            if (cred) {
                cred.quotaLimit = q.isUnlimited ? -1 : q.requestLimit;
                cred.quotaUsed = q.requestsUsed;
                renderCredentials();
            }
            showToast(`Quota: ${q.requestsUsed}/${q.requestLimit}`, 'success');
        } else {
            showToast('Query failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Query failed: ' + e.message, 'error');
    }
}

async function deleteCredential(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;
    if (!confirm(`Are you sure you want to delete "${cred.name || 'this account'}"?`)) return;

    try {
        const res = await fetch(`/api/warp/credentials/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('Deleted successfully', 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast('Delete failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
    }
}

async function refreshAllTokens() {
    if (!confirm('Refresh all account tokens?')) return;

    try {
        showToast('Refreshing all tokens...', 'info');
        const res = await fetch('/api/warp/credentials/refresh-all', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            const success = data.data.filter(r => r.success).length;
            const failed = data.data.filter(r => !r.success).length;
            showToast(`Refresh complete: ${success} success, ${failed} failed`, 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast('Refresh failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Refresh failed: ' + e.message, 'error');
    }
}

async function refreshAllQuotas() {
    try {
        showToast('Checking all quotas...', 'info');
        const res = await fetch('/w/api/quotas');
        const data = await res.json();
        if (data.success) {
            const { summary, accounts } = data.data;
            for (const q of accounts) {
                if (!q.error) {
                    const cred = credentials.find(c => c.id === q.credentialId);
                    if (cred) {
                        cred.quotaLimit = q.isUnlimited ? -1 : q.requestLimit;
                        cred.quotaUsed = q.requestsUsed;
                    }
                }
            }
            renderCredentials();
            showToast(`Quota summary: limit ${summary.totalLimit}, used ${summary.totalUsed}`, 'success');
        } else {
            showToast('Query failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Query failed: ' + e.message, 'error');
    }
}
