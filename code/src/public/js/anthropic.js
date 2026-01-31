// Anthropic Account Management Page JS

let credentials = [];
let filteredCredentials = [];
let selectedIds = new Set();
let contextMenuTarget = null;
let supportedModels = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Check login status
    if (!authToken) {
        window.location.href = '/login.html';
        return;
    }

    // Initialize sidebar
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('anthropic');
    updateSidebarStats();

    // Load data
    await Promise.all([
        loadCredentials(),
        loadModels()
    ]);

    // Bind events
    bindEvents();
});

// ============ Data Loading ============
async function loadCredentials() {
    try {
        const response = await fetch('/api/anthropic/credentials', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await response.json();

        if (result.success) {
            credentials = result.data;
            filteredCredentials = [...credentials];
            renderCards();
            updateCounts();
        } else {
            showToast('Load failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Load failed: ' + error.message, 'error');
    }
}

async function loadModels() {
    try {
        const response = await fetch('/api/anthropic/models', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await response.json();

        if (result.success) {
            supportedModels = result.data || [];
            document.getElementById('stat-total-models').textContent = supportedModels.length;
        }
    } catch (error) {
        console.error('Failed to load models:', error);
    }
}

// ============ Render Cards ============
function renderCards() {
    const grid = document.getElementById('cards-grid');
    const emptyState = document.getElementById('empty-state');

    if (filteredCredentials.length === 0) {
        grid.innerHTML = '';
        emptyState.style.display = 'flex';
        return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = filteredCredentials.map(cred => createCardHTML(cred)).join('');

    // Bind card events
    grid.querySelectorAll('.account-card').forEach(card => {
        card.addEventListener('contextmenu', handleContextMenu);
        const id = parseInt(card.dataset.id);

        // Checkbox events
        const checkbox = card.querySelector('.card-checkbox input');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                if (e.target.checked) {
                    selectedIds.add(id);
                    card.classList.add('selected');
                } else {
                    selectedIds.delete(id);
                    card.classList.remove('selected');
                }
                updateSelectionUI();
            });
        }
    });
}

function createCardHTML(cred) {
    const isSelected = selectedIds.has(cred.id);
    const displayName = cred.name || 'Unknown';
    const maskedKey = maskApiKey(cred.accessToken);

    return `
        <div class="account-card anthropic-card ${isSelected ? 'selected' : ''} ${!cred.isActive ? 'inactive' : ''}" data-id="${cred.id}">
            <div class="card-header">
                <div class="card-checkbox">
                    <input type="checkbox" class="checkbox-custom card-checkbox" ${isSelected ? 'checked' : ''}>
                </div>
                <div class="card-title">
                    <span class="card-email" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                    ${cred.isActive ? '<span class="pro-badge">Active</span>' : '<span class="pro-badge inactive">Inactive</span>'}
                </div>
            </div>
            <div class="card-info">
                <div class="info-row">
                    <span class="info-label">API Key:</span>
                    <span class="info-value monospace">${maskedKey}</span>
                </div>
                ${cred.apiBaseUrl ? `
                <div class="info-row">
                    <span class="info-label">Base URL:</span>
                    <span class="info-value" title="${escapeHtml(cred.apiBaseUrl)}">${truncateUrl(cred.apiBaseUrl)}</span>
                </div>
                ` : ''}
                ${cred.email ? `
                <div class="info-row">
                    <span class="info-label">Email:</span>
                    <span class="info-value">${escapeHtml(cred.email)}</span>
                </div>
                ` : ''}
                ${cred.rateLimits?.unified5h ? `
                <div class="info-row">
                    <span class="info-label">5h Quota:</span>
                    <span class="info-value ${getQuotaClass(cred.rateLimits.unified5h.utilization)}">${formatQuota(cred.rateLimits.unified5h.utilization)}</span>
                </div>
                ` : ''}
                ${cred.rateLimits?.unified7d ? `
                <div class="info-row">
                    <span class="info-label">7d Quota:</span>
                    <span class="info-value ${getQuotaClass(cred.rateLimits.unified7d.utilization)}">${formatQuota(cred.rateLimits.unified7d.utilization)}</span>
                </div>
                ` : ''}
            </div>
            <div class="card-footer">
                <span class="card-date">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${formatDateShort(cred.createdAt)}
                </span>
                <div class="card-actions">
                    <button class="action-btn" title="Details" onclick="event.stopPropagation(); showCredentialDetail(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 16v-4"/>
                            <path d="M12 8h.01"/>
                        </svg>
                    </button>
                    <button class="action-btn" title="Test Connection" onclick="event.stopPropagation(); testCredential(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                        </svg>
                    </button>
                    <button class="action-btn" title="Edit" onclick="event.stopPropagation(); editCredential(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn ${cred.isActive ? 'active' : ''}" title="${cred.isActive ? 'Currently Active' : 'Set Active'}" onclick="event.stopPropagation(); toggleActive(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </button>
                    <button class="action-btn danger" title="Delete" onclick="event.stopPropagation(); deleteCredential(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============ Helper Functions ============
function maskApiKey(key) {
    if (!key) return '***';
    if (key.length <= 12) return '***';
    return key.substring(0, 10) + '...' + key.substring(key.length - 4);
}

function truncateUrl(url) {
    if (!url) return '';
    if (url.length <= 35) return url;
    return url.substring(0, 32) + '...';
}

function updateCounts() {
    const total = credentials.length;
    const active = credentials.filter(c => c.isActive).length;
    const error = credentials.filter(c => c.errorCount > 0).length;

    document.getElementById('stat-total-accounts').textContent = total;
    document.getElementById('stat-active-accounts').textContent = active;
    document.getElementById('stat-error-accounts').textContent = error;
    document.getElementById('displayed-count').textContent = filteredCredentials.length;
}

function updateSelectionUI() {
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    const selectAllCheckbox = document.getElementById('select-all');

    if (selectedIds.size > 0) {
        batchDeleteBtn.style.display = 'flex';
    } else {
        batchDeleteBtn.style.display = 'none';
    }

    selectAllCheckbox.checked = selectedIds.size === filteredCredentials.length && filteredCredentials.length > 0;
    selectAllCheckbox.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredCredentials.length;
}

// ============ Event Binding ============
function bindEvents() {
    // Add account button
    document.getElementById('add-account-btn').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn').addEventListener('click', openAddModal);

    // Modal events
    document.getElementById('modal-close').addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel').addEventListener('click', closeAddModal);
    document.getElementById('modal-submit').addEventListener('click', submitAddForm);

    // Edit modal events
    document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-submit').addEventListener('click', submitEditForm);

    // Detail modal events
    document.getElementById('detail-modal-close').addEventListener('click', closeDetailModal);
    document.getElementById('detail-modal-close-btn').addEventListener('click', closeDetailModal);

    // Search
    document.getElementById('search-input').addEventListener('input', handleSearch);

    // Select all
    document.getElementById('select-all').addEventListener('change', handleSelectAll);

    // Batch operations
    document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);
    document.getElementById('test-all-btn').addEventListener('click', testAllCredentials);

    // Context menu
    document.addEventListener('click', () => hideContextMenu());

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });
}

// ============ Modal Functions ============
function openAddModal() {
    document.getElementById('add-modal').classList.add('active');
    document.getElementById('account-name').focus();
}

function closeAddModal() {
    document.getElementById('add-modal').classList.remove('active');
    document.getElementById('add-account-form').reset();
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active');
    document.getElementById('edit-account-form').reset();
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('active');
}

async function submitAddForm() {
    const name = document.getElementById('account-name').value.trim();
    const email = document.getElementById('account-email').value.trim();
    const accessToken = document.getElementById('api-key').value.trim();
    const apiBaseUrl = document.getElementById('api-base-url').value.trim();

    if (!name || !accessToken) {
        showToast('Name and API Key are required', 'error');
        return;
    }

    if (!accessToken.startsWith('sk-ant-')) {
        showToast('Invalid API key format (must start with sk-ant-)', 'error');
        return;
    }

    try {
        const response = await fetch('/api/anthropic/credentials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, email, accessToken, apiBaseUrl: apiBaseUrl || null })
        });

        const result = await response.json();

        if (result.success) {
            showToast('Account added successfully', 'success');
            closeAddModal();
            await loadCredentials();
        } else {
            showToast('Failed to add: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Failed to add: ' + error.message, 'error');
    }
}

async function submitEditForm() {
    const id = parseInt(document.getElementById('edit-account-id').value);
    const name = document.getElementById('edit-account-name').value.trim();
    const email = document.getElementById('edit-account-email').value.trim();
    const accessToken = document.getElementById('edit-api-key').value.trim();
    const apiBaseUrl = document.getElementById('edit-api-base-url').value.trim();
    const isActive = document.getElementById('edit-is-active').checked;

    if (!name) {
        showToast('Name is required', 'error');
        return;
    }

    const updateData = { name, email, apiBaseUrl: apiBaseUrl || null, isActive };
    if (accessToken) {
        if (!accessToken.startsWith('sk-ant-')) {
            showToast('Invalid API key format (must start with sk-ant-)', 'error');
            return;
        }
        updateData.accessToken = accessToken;
    }

    try {
        const response = await fetch(`/api/anthropic/credentials/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(updateData)
        });

        const result = await response.json();

        if (result.success) {
            showToast('Account updated successfully', 'success');
            closeEditModal();
            await loadCredentials();
        } else {
            showToast('Failed to update: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Failed to update: ' + error.message, 'error');
    }
}

// ============ CRUD Operations ============
async function testCredential(id) {
    showToast('Testing connection...', 'info');

    try {
        const response = await fetch(`/api/anthropic/credentials/${id}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await response.json();

        if (result.success && result.data.valid) {
            showToast('Connection successful!', 'success');
            await loadCredentials();
        } else {
            showToast('Connection failed: ' + (result.data?.error || result.error), 'error');
        }
    } catch (error) {
        showToast('Test failed: ' + error.message, 'error');
    }
}

async function testAllCredentials() {
    showToast('Testing all credentials...', 'info');

    let successCount = 0;
    let failCount = 0;

    for (const cred of credentials) {
        try {
            const response = await fetch(`/api/anthropic/credentials/${cred.id}/test`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const result = await response.json();

            if (result.success && result.data.valid) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            failCount++;
        }
    }

    showToast(`Test complete: ${successCount} success, ${failCount} failed`, successCount > 0 ? 'success' : 'error');
    await loadCredentials();
}

function editCredential(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    document.getElementById('edit-account-id').value = cred.id;
    document.getElementById('edit-account-name').value = cred.name || '';
    document.getElementById('edit-account-email').value = cred.email || '';
    document.getElementById('edit-api-key').value = '';
    document.getElementById('edit-api-base-url').value = cred.apiBaseUrl || '';
    document.getElementById('edit-is-active').checked = cred.isActive;

    document.getElementById('edit-modal').classList.add('active');
}

async function toggleActive(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    try {
        const response = await fetch(`/api/anthropic/credentials/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ isActive: !cred.isActive })
        });

        const result = await response.json();

        if (result.success) {
            showToast(cred.isActive ? 'Account deactivated' : 'Account activated', 'success');
            await loadCredentials();
        } else {
            showToast('Failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Failed: ' + error.message, 'error');
    }
}

async function deleteCredential(id) {
    if (!confirm('Are you sure you want to delete this account?')) return;

    try {
        const response = await fetch(`/api/anthropic/credentials/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await response.json();

        if (result.success) {
            showToast('Account deleted successfully', 'success');
            selectedIds.delete(id);
            await loadCredentials();
        } else {
            showToast('Failed to delete: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Failed to delete: ' + error.message, 'error');
    }
}

async function batchDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} account(s)?`)) return;

    let successCount = 0;
    let failCount = 0;

    for (const id of selectedIds) {
        try {
            const response = await fetch(`/api/anthropic/credentials/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const result = await response.json();
            if (result.success) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            failCount++;
        }
    }

    selectedIds.clear();
    showToast(`Deleted: ${successCount} success, ${failCount} failed`, successCount > 0 ? 'success' : 'error');
    await loadCredentials();
    updateSelectionUI();
}

// ============ Search & Select ============
function handleSearch(e) {
    const query = e.target.value.toLowerCase().trim();

    if (!query) {
        filteredCredentials = [...credentials];
    } else {
        filteredCredentials = credentials.filter(cred =>
            (cred.name && cred.name.toLowerCase().includes(query)) ||
            (cred.email && cred.email.toLowerCase().includes(query)) ||
            (cred.apiBaseUrl && cred.apiBaseUrl.toLowerCase().includes(query))
        );
    }

    renderCards();
    updateCounts();
}

function handleSelectAll(e) {
    if (e.target.checked) {
        filteredCredentials.forEach(cred => selectedIds.add(cred.id));
    } else {
        selectedIds.clear();
    }
    renderCards();
    updateSelectionUI();
}

// ============ Context Menu ============
function handleContextMenu(e) {
    e.preventDefault();
    const card = e.currentTarget;
    contextMenuTarget = parseInt(card.dataset.id);

    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;

    // Bind context menu actions
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.onclick = () => {
            const action = item.dataset.action;
            handleContextAction(action, contextMenuTarget);
            hideContextMenu();
        };
    });
}

function hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
}

function handleContextAction(action, id) {
    switch (action) {
        case 'test':
            testCredential(id);
            break;
        case 'edit':
            editCredential(id);
            break;
        case 'activate':
            toggleActive(id);
            break;
        case 'delete':
            deleteCredential(id);
            break;
    }
}

// ============ Detail View ============
function showCredentialDetail(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    const body = document.getElementById('detail-modal-body');
    body.innerHTML = `
        <div class="detail-grid">
            <div class="detail-row">
                <span class="detail-label">ID</span>
                <span class="detail-value">${cred.id}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Name</span>
                <span class="detail-value">${escapeHtml(cred.name || '-')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Email</span>
                <span class="detail-value">${escapeHtml(cred.email || '-')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">API Key</span>
                <span class="detail-value monospace">${maskApiKey(cred.accessToken)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">API Base URL</span>
                <span class="detail-value">${escapeHtml(cred.apiBaseUrl || 'Default (api.anthropic.com)')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="detail-value">${cred.isActive ? '<span class="status-badge success">Active</span>' : '<span class="status-badge">Inactive</span>'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">5h Quota Usage</span>
                <span class="detail-value ${getQuotaClass(cred.rateLimits?.unified5h?.utilization)}">${formatQuota(cred.rateLimits?.unified5h?.utilization)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">5h Quota Reset</span>
                <span class="detail-value">${formatResetTime(cred.rateLimits?.unified5h?.reset)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">7d Quota Usage</span>
                <span class="detail-value ${getQuotaClass(cred.rateLimits?.unified7d?.utilization)}">${formatQuota(cred.rateLimits?.unified7d?.utilization)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">7d Quota Reset</span>
                <span class="detail-value">${formatResetTime(cred.rateLimits?.unified7d?.reset)}</span>
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
                <span class="detail-label">Last Error</span>
                <span class="detail-value">${escapeHtml(cred.lastError || '-')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Created At</span>
                <span class="detail-value">${formatDate(cred.createdAt)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Updated At</span>
                <span class="detail-value">${formatDate(cred.updatedAt)}</span>
            </div>
        </div>
    `;

    document.getElementById('detail-modal').classList.add('active');
}

// ============ Utility Functions ============
function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
}

function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatQuota(utilization) {
    if (utilization === null || utilization === undefined) return '-';
    const percent = (utilization * 100).toFixed(1);
    return `${percent}%`;
}

function getQuotaClass(utilization) {
    if (utilization === null || utilization === undefined) return '';
    if (utilization >= 0.9) return 'quota-critical';
    if (utilization >= 0.7) return 'quota-warning';
    return 'quota-ok';
}

function formatResetTime(timestamp) {
    if (!timestamp) return '-';
    const resetDate = new Date(parseInt(timestamp) * 1000);
    const now = new Date();
    const diff = resetDate - now;

    if (diff <= 0) return 'Now';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
}
