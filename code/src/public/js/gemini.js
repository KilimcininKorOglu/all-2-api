// Gemini Account Management Page JS

let credentials = [];
let filteredCredentials = [];
let selectedIds = new Set();
let contextMenuTarget = null;
let usageCache = {}; // Usage cache

document.addEventListener('DOMContentLoaded', async () => {
    // Check login status
    if (!authToken) {
        window.location.href = '/login.html';
        return;
    }

    // Initialize sidebar
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('gemini');
    updateSidebarStats();

    // Load data
    await loadCredentials();

    // Bind events
    bindEvents();

    // Don't auto-load usage, switch to manual refresh
    // loadAllUsage();
});

// ============ Data Loading ============
async function loadCredentials() {
    try {
        const response = await fetch('/api/gemini/credentials', {
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

        // Refresh quota button event
        const refreshUsageBtn = card.querySelector('.btn-refresh-usage');
        if (refreshUsageBtn) {
            refreshUsageBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                refreshSingleUsage(id);
            });
        }

        // Refresh models button event
        const refreshModelsBtn = card.querySelector('.btn-refresh-models');
        if (refreshModelsBtn) {
            refreshModelsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                refreshSingleUsage(id);
            });
        }
    });
}

function createCardHTML(cred) {
    const isSelected = selectedIds.has(cred.id);
    const usage = usageCache[cred.id];
    const displayName = cred.email || cred.name || 'Unknown';

    // Truncate display name
    const truncateName = (name, maxLen) => {
        if (name.length <= maxLen) return name;
        const atIndex = name.indexOf('@');
        if (atIndex === -1) return name.substring(0, maxLen - 3) + '...';
        const prefix = name.substring(0, atIndex);
        const domain = name.substring(atIndex);
        if (domain.length >= maxLen - 3) {
            return prefix.substring(0, 3) + '...' + domain.substring(0, maxLen - 6);
        }
        const availableLen = maxLen - domain.length - 3;
        if (availableLen <= 0) return name.substring(0, maxLen - 3) + '...';
        return prefix.substring(0, availableLen) + '...' + domain;
    };
    const shortName = truncateName(displayName, 28);

    return `
        <div class="account-card gemini-card ${isSelected ? 'selected' : ''}" data-id="${cred.id}">
            <div class="card-header">
                <div class="card-checkbox">
                    <input type="checkbox" class="checkbox-custom card-checkbox" ${isSelected ? 'checked' : ''}>
                </div>
                <div class="card-title">
                    <span class="card-email" title="${escapeHtml(displayName)}">${escapeHtml(shortName)}</span>
                    ${cred.isActive ? '<span class="pro-badge">Active</span>' : ''}
                </div>
            </div>
            <div class="card-models" data-id="${cred.id}">
                ${generateModelTagsHTML(usage)}
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
                    <button class="action-btn" title="Chat" onclick="event.stopPropagation(); openChat(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                    </button>
                    <button class="action-btn" title="Refresh Token" onclick="event.stopPropagation(); refreshToken(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                    </button>
                    <button class="action-btn ${cred.isActive ? 'active' : ''}" title="${cred.isActive ? 'Currently Active' : 'Set Active'}" onclick="event.stopPropagation(); activateCredential(${cred.id})">
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

// Generate model tags grid HTML
function generateModelTagsHTML(usage) {
    if (!usage || !usage.models || Object.keys(usage.models).length === 0) {
        return `<div class="model-tags-empty">
            <span class="empty-text">Click refresh to view model quota</span>
            <button class="btn-refresh-models" onclick="event.stopPropagation();">Refresh</button>
        </div>`;
    }

    const models = usage.models;
    const modelNames = Object.keys(models);

    let tagsHTML = '<div class="model-tags-grid">';
    for (const modelName of modelNames) {
        const modelInfo = models[modelName];
        const remaining = modelInfo.remaining || 0;
        const remainingPercent = Math.round(remaining * 100);
        const statusClass = remainingPercent < 20 ? 'danger' : remainingPercent < 50 ? 'warning' : 'success';

        // Simplify model name
        let shortName = modelName
            .replace('gemini-', 'G')
            .replace('-preview', '')
            .replace('-latest', '')
            .replace('2.0-flash-exp', '2 Fla...')
            .replace('2.0-pro-exp', '2 Pro')
            .replace('1.5-pro', '1.5 Pro')
            .replace('1.5-flash', '1.5 Fla...')
            .replace('-thinking-exp', ' Think')
            .replace('exp-', '')
            .replace('imagen-3.0-generate-002', 'G3 Ima...')
            .replace('claude-3-5-sonnet', 'Claude...');

        if (shortName.length > 10) {
            shortName = shortName.substring(0, 8) + '...';
        }

        // Format reset time
        let resetText = '';
        if (modelInfo.resetTime) {
            const resetDate = new Date(modelInfo.resetTime);
            const now = new Date();
            const diffMs = resetDate - now;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            if (diffMs < 0) {
                resetText = 'Reset';
            } else if (diffDays > 0) {
                resetText = diffDays + 'd ' + diffHours + 'h';
            } else if (diffHours > 0) {
                resetText = diffHours + 'h ' + diffMins + 'm';
            } else {
                resetText = diffMins + 'm';
            }
        }

        tagsHTML += `
            <div class="model-tag ${statusClass}" title="${modelName}">
                <span class="model-name">${shortName}</span>
                <span class="model-reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${resetText}</span>
                <span class="model-percent">${remainingPercent}%</span>
            </div>
        `;
    }
    tagsHTML += '</div>';

    return tagsHTML;
}

// Show credential details
function showCredentialDetail(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    // TODO: Implement details popup
    showToast('Details feature in development', 'info');
}

// Format date (short format)
function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).replace(/\//g, '/');
}

// ============ Event Binding ============
function bindEvents() {
    // Add account button
    document.getElementById('add-account-btn').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

    // Batch import button
    document.getElementById('batch-import-btn')?.addEventListener('click', openBatchImportModal);

    // Add account modal
    document.getElementById('modal-close').addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel').addEventListener('click', closeAddModal);
    document.getElementById('modal-submit').addEventListener('click', submitAddForm);

    // Batch import modal
    document.getElementById('batch-modal-close')?.addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-modal-cancel')?.addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-modal-submit')?.addEventListener('click', submitBatchImport);

    // Batch refresh
    document.getElementById('refresh-all-btn').addEventListener('click', refreshAllTokens);

    // Select all
    document.getElementById('select-all')?.addEventListener('change', handleSelectAll);

    // Batch delete
    document.getElementById('batch-delete-btn')?.addEventListener('click', batchDelete);

    // Search
    document.getElementById('search-input').addEventListener('input', handleSearch);

    // Context menu
    document.addEventListener('click', () => {
        document.getElementById('context-menu').style.display = 'none';
    });

    document.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', handleContextMenuAction);
    });

    // ESC closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAddModal();
            closeBatchImportModal();
        }
    });
}

// ============ Modals ============
function openAddModal() {
    document.getElementById('add-modal').classList.add('active');
    document.getElementById('add-account-form').reset();
}

function closeAddModal() {
    document.getElementById('add-modal').classList.remove('active');
}

function openBatchImportModal() {
    const modal = document.getElementById('batch-import-modal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('batch-json').value = '';
    }
}

function closeBatchImportModal() {
    const modal = document.getElementById('batch-import-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function submitAddForm() {
    const name = document.getElementById('account-name').value.trim();
    const email = document.getElementById('account-email').value.trim();
    const accessToken = document.getElementById('access-token').value.trim();
    const refreshToken = document.getElementById('refresh-token').value.trim();
    const projectId = document.getElementById('project-id').value.trim();

    if (!name || !accessToken) {
        showToast('Please fill in name and Access Token', 'error');
        return;
    }

    const submitBtn = document.getElementById('modal-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner"></span> Adding...';

    try {
        const response = await fetch('/api/gemini/credentials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, email, accessToken, refreshToken, projectId })
        });

        const result = await response.json();
        if (result.success) {
            showToast('Added successfully', 'success');
            closeAddModal();
            await loadCredentials();
            updateSidebarStats();
        } else {
            showToast('Add failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Add failed: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            Add Account
        `;
    }
}

async function submitBatchImport() {
    const jsonText = document.getElementById('batch-json').value.trim();

    if (!jsonText) {
        showToast('Please enter account data', 'error');
        return;
    }

    let accounts = [];
    try {
        // Try to parse as JSON
        if (jsonText.startsWith('[')) {
            accounts = JSON.parse(jsonText);
        } else {
            // Text format parsing: one account per line, format "name email accessToken refreshToken projectId"
            const lines = jsonText.split('\n').filter(line => line.trim());
            accounts = lines.map(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    return {
                        name: parts[0],
                        email: parts[0].includes('@') ? parts[0] : '',
                        accessToken: parts[1],
                        refreshToken: parts[2] || '',
                        projectId: parts[3] || ''
                    };
                }
                return null;
            }).filter(Boolean);
        }
    } catch (e) {
        showToast('Data format error: ' + e.message, 'error');
        return;
    }

    if (accounts.length === 0) {
        showToast('No valid account data', 'error');
        return;
    }

    const submitBtn = document.getElementById('batch-modal-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner"></span> Importing...';

    let success = 0, failed = 0;
    for (const account of accounts) {
        try {
            const response = await fetch('/api/gemini/credentials', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(account)
            });
            const result = await response.json();
            if (result.success) success++;
            else failed++;
        } catch {
            failed++;
        }
    }

    showToast(`Import complete: ${success} succeeded, ${failed} failed`, success > 0 ? 'success' : 'error');
    closeBatchImportModal();
    await loadCredentials();
    updateSidebarStats();

    submitBtn.disabled = false;
    submitBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Import
    `;
}

// ============ Action Functions ============
function openChat(id) {
    window.location.href = '/pages/chat.html?gemini=' + id;
}

async function refreshToken(id) {
    showToast('Refreshing Token...', 'info');
    try {
        const response = await fetch(`/api/gemini/credentials/${id}/refresh`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await response.json();
        if (result.success) {
            showToast('Token refresh successful', 'success');
            await loadCredentials();
        } else {
            showToast('Refresh failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Refresh failed: ' + error.message, 'error');
    }
}

async function testCredential(id) {
    showToast('Testing connection...', 'info');
    try {
        const response = await fetch(`/api/gemini/credentials/${id}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await response.json();
        if (result.success) {
            const modelCount = result.data?.models?.length || 0;
            showToast(`Test successful${modelCount > 0 ? `, supports ${modelCount} models` : ''}`, 'success');
            await loadCredentials();
        } else {
            showToast('Test failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Test failed: ' + error.message, 'error');
    }
}

async function deleteCredential(id) {
    if (!confirm('Are you sure you want to delete this account?')) return;

    try {
        const response = await fetch(`/api/gemini/credentials/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await response.json();
        if (result.success) {
            showToast('Deleted successfully', 'success');
            selectedIds.delete(id);
            await loadCredentials();
            updateSidebarStats();
        } else {
            showToast('Delete failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Delete failed: ' + error.message, 'error');
    }
}

async function activateCredential(id) {
    try {
        const response = await fetch(`/api/gemini/credentials/${id}/activate`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await response.json();
        if (result.success) {
            showToast('Set as active', 'success');
            await loadCredentials();
        } else {
            showToast('Operation failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Operation failed: ' + error.message, 'error');
    }
}

async function refreshAllTokens() {
    if (credentials.length === 0) {
        showToast('No accounts to refresh', 'warning');
        return;
    }

    const btn = document.getElementById('refresh-all-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Refreshing...';

    showToast(`Refreshing ${credentials.length} accounts...`, 'info');

    let success = 0, failed = 0;
    for (const cred of credentials) {
        try {
            const response = await fetch(`/api/gemini/credentials/${cred.id}/refresh`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const result = await response.json();
            if (result.success) success++;
            else failed++;
        } catch {
            failed++;
        }
    }

    showToast(`Refresh complete: ${success} succeeded, ${failed} failed`, success > 0 ? 'success' : 'error');
    await loadCredentials();

    btn.disabled = false;
    btn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Batch Refresh Token
    `;
}

// ============ Selection Functions ============
function handleSelectAll(e) {
    const isChecked = e.target.checked;
    if (isChecked) {
        filteredCredentials.forEach(c => selectedIds.add(c.id));
    } else {
        selectedIds.clear();
    }
    renderCards();
    updateSelectionUI();
}

function updateSelectionUI() {
    const selectAllCheckbox = document.getElementById('select-all');
    const batchDeleteBtn = document.getElementById('batch-delete-btn');

    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedIds.size > 0 && selectedIds.size === filteredCredentials.length;
        selectAllCheckbox.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredCredentials.length;
    }

    if (batchDeleteBtn) {
        batchDeleteBtn.style.display = selectedIds.size > 0 ? 'inline-flex' : 'none';
    }
}

async function batchDelete() {
    if (selectedIds.size === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedIds.size} selected accounts?`)) return;

    const btn = document.getElementById('batch-delete-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Deleting...';

    let success = 0, failed = 0;
    for (const id of selectedIds) {
        try {
            const response = await fetch(`/api/gemini/credentials/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const result = await response.json();
            if (result.success) success++;
            else failed++;
        } catch {
            failed++;
        }
    }

    showToast(`Delete complete: ${success} succeeded, ${failed} failed`, success > 0 ? 'success' : 'error');
    selectedIds.clear();
    await loadCredentials();
    updateSidebarStats();
    updateSelectionUI();

    btn.disabled = false;
    btn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        Batch Delete
    `;
}

// ============ Search ============
function handleSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
        filteredCredentials = [...credentials];
    } else {
        filteredCredentials = credentials.filter(c =>
            c.name.toLowerCase().includes(query) ||
            (c.email && c.email.toLowerCase().includes(query)) ||
            (c.projectId && c.projectId.toLowerCase().includes(query))
        );
    }
    renderCards();
    updateCounts();
}

// ============ Context Menu ============
function handleContextMenu(e) {
    e.preventDefault();
    const card = e.currentTarget;
    contextMenuTarget = parseInt(card.dataset.id);

    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';

    // Ensure menu does not exceed viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function handleContextMenuAction(e) {
    const action = e.currentTarget.dataset.action;
    if (!contextMenuTarget) return;

    switch (action) {
        case 'chat':
            openChat(contextMenuTarget);
            break;
        case 'activate':
            activateCredential(contextMenuTarget);
            break;
        case 'refresh':
            refreshToken(contextMenuTarget);
            break;
        case 'test':
            testCredential(contextMenuTarget);
            break;
        case 'delete':
            deleteCredential(contextMenuTarget);
            break;
    }

    document.getElementById('context-menu').style.display = 'none';
    contextMenuTarget = null;
}

// ============ Utility Functions ============
function updateCounts() {
    document.getElementById('displayed-count').textContent = filteredCredentials.length;
    updateStatsCards();
}

// Update stats cards
function updateStatsCards() {
    const totalAccounts = credentials.length;
    const activeAccounts = credentials.filter(c => c.isActive).length;

    // Count available models and average quota
    let totalModels = new Set();
    let totalQuotaPercent = 0;
    let accountsWithUsage = 0;

    for (const cred of credentials) {
        const usage = usageCache[cred.id];
        if (usage && usage.models) {
            const models = Object.keys(usage.models);
            models.forEach(m => totalModels.add(m));

            // Calculate average quota
            let avgRemaining = 0;
            models.forEach(m => {
                avgRemaining += (usage.models[m].remaining || 0);
            });
            if (models.length > 0) {
                totalQuotaPercent += (avgRemaining / models.length) * 100;
                accountsWithUsage++;
            }
        }
    }

    const avgQuota = accountsWithUsage > 0 ? Math.round(totalQuotaPercent / accountsWithUsage) : 0;

    document.getElementById('stat-total-accounts').textContent = totalAccounts;
    document.getElementById('stat-active-accounts').textContent = activeAccounts;
    document.getElementById('stat-total-models').textContent = totalModels.size;
    document.getElementById('stat-avg-quota').textContent = accountsWithUsage > 0 ? avgQuota + '%' : '-';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function isExpiringSoon(dateStr) {
    if (!dateStr) return false;
    const expiresAt = new Date(dateStr);
    const now = new Date();
    const hoursDiff = (expiresAt - now) / (1000 * 60 * 60);
    return hoursDiff < 24 && hoursDiff > 0;
}

// ============ Quota Display Functions ============

// Generate quota display HTML
function generateUsageHTML(usage) {
    if (!usage) {
        return `<div class="usage-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="usage-label">Model Quota</span>
            <button class="btn-refresh-usage" style="background: none; border: none; color: var(--accent-primary); cursor: pointer; font-size: 12px; padding: 2px 8px;">Click to view</button>
        </div>`;
    }

    // Gemini returns models object containing remaining for each model
    const models = usage.models || {};
    const modelNames = Object.keys(models);

    if (modelNames.length === 0) {
        return `<div class="usage-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="usage-label">Model Quota</span>
            <button class="btn-refresh-usage" style="background: none; border: none; color: var(--accent-primary); cursor: pointer; font-size: 12px; padding: 2px 8px;">Click to view</button>
        </div>`;
    }

    // Generate quota display for each model
    let modelsHTML = '';
    for (const modelName of modelNames) {
        const modelInfo = models[modelName];
        const remaining = modelInfo.remaining || 0;
        const remainingPercent = Math.round(remaining * 100);
        const usedPercent = 100 - remainingPercent;
        const usageClass = usedPercent > 80 ? 'danger' : usedPercent > 50 ? 'warning' : '';

        // Simplify model name display
        const shortName = modelName.replace('gemini-', '').replace('-preview', '');

        // Format reset time
        let resetText = '';
        if (modelInfo.resetTime) {
            const resetDate = new Date(modelInfo.resetTime);
            const now = new Date();
            const diffMs = resetDate - now;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            if (diffMs < 0) {
                resetText = 'Reset';
            } else if (diffDays > 0) {
                resetText = 'In ' + diffDays + ' days';
            } else {
                resetText = 'In ' + diffHours + ' hours';
            }
        }

        modelsHTML += '<div class="model-usage-item" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px;">' +
            '<span class="model-name" style="flex: 0 0 160px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + modelName + '">' + shortName + '</span>' +
            '<div class="usage-bar" style="flex: 1; height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">' +
            '<div class="usage-bar-fill ' + usageClass + '" style="width: ' + usedPercent + '%; height: 100%;"></div>' +
            '</div>' +
            '<span class="model-remaining ' + usageClass + '" style="flex: 0 0 40px; text-align: right;">' + remainingPercent + '%</span>' +
            '<span class="model-reset" style="flex: 0 0 50px; text-align: right; color: var(--text-muted); font-size: 11px;">' + resetText + '</span>' +
            '</div>';
    }

    return '<div class="usage-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
        '<span class="usage-label">Model Quota (' + modelNames.length + ')</span>' +
        '<button class="btn-refresh-usage" style="background: none; border: none; color: var(--accent-primary); cursor: pointer; font-size: 12px; padding: 2px 8px;">Refresh</button>' +
        '</div>' +
        '<div class="models-usage-list">' + modelsHTML + '</div>';
}

// Async load all account quota
async function loadAllUsage() {
    for (const cred of credentials) {
        refreshSingleUsage(cred.id, false);
    }
}

// Refresh single account quota
async function refreshSingleUsage(id, showToastMsg = true) {
    const modelsSection = document.querySelector(`.card-models[data-id="${id}"]`);
    if (modelsSection) {
        modelsSection.innerHTML = `<div class="model-tags-empty">
            <span class="empty-text">Loading...</span>
        </div>`;
    }

    try {
        const response = await fetch(`/api/gemini/credentials/${id}/usage`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await response.json();

        if (result.success && result.data) {
            usageCache[id] = result.data;
            // Update card display
            if (modelsSection) {
                modelsSection.innerHTML = generateModelTagsHTML(result.data);
                // Rebind refresh button event
                const refreshBtn = modelsSection.querySelector('.btn-refresh-models');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        refreshSingleUsage(id);
                    });
                }
            }
            updateStatsCards();
            if (showToastMsg) showToast('Quota refresh successful', 'success');
        } else {
            if (modelsSection) {
                modelsSection.innerHTML = `<div class="model-tags-empty">
                    <span class="empty-text" style="color: var(--accent-danger);">Failed to get</span>
                    <button class="btn-refresh-models">Retry</button>
                </div>`;
                const refreshBtn = modelsSection.querySelector('.btn-refresh-models');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        refreshSingleUsage(id);
                    });
                }
            }
            if (showToastMsg) showToast('Quota refresh failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        if (modelsSection) {
            modelsSection.innerHTML = `<div class="model-tags-empty">
                <span class="empty-text" style="color: var(--accent-danger);">Failed to get</span>
                <button class="btn-refresh-models">Retry</button>
            </div>`;
            const refreshBtn = modelsSection.querySelector('.btn-refresh-models');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    refreshSingleUsage(id);
                });
            }
        }
        if (showToastMsg) showToast('Quota refresh failed: ' + error.message, 'error');
    }
}
