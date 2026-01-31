// State
const OrchidsState = {
    credentials: [],
    selectedIds: new Set(),
    searchQuery: '',
    currentView: 'grid',
    contextMenuTarget: null,
    detailTarget: null,
    importTab: 'json',
    isLoading: false,
    healthStatus: {}, // Account health status: { accountId: boolean }
    registerTaskId: null,
    registerEventSource: null,
    usageData: null // Usage data
};

// DOM Elements
const DOM = {
    // Containers
    cardsGrid: null,
    listView: null,
    emptyState: null,
    loadingState: null,

    // Modals
    addModal: null,
    batchImportModal: null,
    detailModal: null,
    registerModal: null,

    // Form Elements
    searchInput: null
};

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Generate and insert sidebar
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer && typeof getSidebarHTML === 'function') {
        sidebarContainer.innerHTML = getSidebarHTML();
    }

    // Initialize sidebar navigation
    if (typeof initSidebar === 'function') {
        initSidebar('orchids');
    }

    initDOMReferences();
    setupEventListeners();
    await loadCredentials();

    // Update sidebar stats
    if (typeof updateSidebarStats === 'function') {
        updateSidebarStats();
    }
});

function initDOMReferences() {
    DOM.cardsGrid = document.getElementById('cards-grid');
    DOM.listView = document.getElementById('list-view');
    DOM.emptyState = document.getElementById('empty-state');
    DOM.loadingState = document.getElementById('loading-state');

    DOM.addModal = document.getElementById('add-modal');
    DOM.batchImportModal = document.getElementById('batch-import-modal');
    DOM.detailModal = document.getElementById('detail-modal');
    DOM.registerModal = document.getElementById('register-modal');

    DOM.searchInput = document.getElementById('search-input');
}

// Auth check (using common.js checkAuth)
async function checkAuthAndRedirect() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

function setupEventListeners() {
    // Header Actions
    document.getElementById('add-account-btn')?.addEventListener('click', openAddModal);
    document.getElementById('batch-import-btn')?.addEventListener('click', openBatchImportModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);
    document.getElementById('refresh-all-btn')?.addEventListener('click', handleRefreshAll);
    document.getElementById('export-btn')?.addEventListener('click', handleExport);
    document.getElementById('auto-register-btn')?.addEventListener('click', openRegisterModal);
    document.getElementById('refresh-usage-btn')?.addEventListener('click', handleRefreshUsage);

    // Search
    DOM.searchInput?.addEventListener('input', (e) => {
        OrchidsState.searchQuery = e.target.value.trim().toLowerCase();
        renderCredentials();
    });

    // View Toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            OrchidsState.currentView = view;
            
            if (view === 'grid') {
                DOM.cardsGrid.style.display = 'grid';
                DOM.listView.style.display = 'none';
            } else {
                DOM.cardsGrid.style.display = 'none';
                DOM.listView.style.display = 'block';
            }
        });
    });

    // Modals
    document.getElementById('modal-close')?.addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeAddModal);
    document.getElementById('add-account-form')?.addEventListener('submit', handleAddAccount);

    document.getElementById('batch-modal-close')?.addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-cancel')?.addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-import-form')?.addEventListener('submit', handleBatchImport);

    document.getElementById('detail-modal-close')?.addEventListener('click', closeDetailModal);
    document.getElementById('detail-delete-btn')?.addEventListener('click', handleDeleteAccount);
    document.getElementById('detail-edit-weight-btn')?.addEventListener('click', handleEditWeight);
    document.getElementById('detail-reset-stats-btn')?.addEventListener('click', handleResetStats);

    // Register Modal
    document.getElementById('register-modal-close')?.addEventListener('click', closeRegisterModal);
    document.getElementById('register-modal-cancel')?.addEventListener('click', closeRegisterModal);
    document.getElementById('register-start-btn')?.addEventListener('click', startRegister);
    document.getElementById('register-cancel-btn')?.addEventListener('click', cancelRegister);

    // Outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            if (e.target.id === 'add-modal') closeAddModal();
            if (e.target.id === 'batch-import-modal') closeBatchImportModal();
            if (e.target.id === 'detail-modal') closeDetailModal();
            if (e.target.id === 'register-modal' && !OrchidsState.registerTaskId) closeRegisterModal();
        }
    });

    // Paste JWT
    document.getElementById('paste-jwt-btn')?.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            document.getElementById('client-jwt').value = text;
        } catch (err) {
            showToast('Unable to read clipboard', 'error');
        }
    });

    // Import Tabs
    document.querySelectorAll('.import-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            OrchidsState.importTab = tab.dataset.tab;
            
            document.getElementById('json-panel').classList.toggle('active', tab.dataset.tab === 'json');
            document.getElementById('text-panel').classList.toggle('active', tab.dataset.tab === 'text');
        });
    });
}

// Data Loading
async function loadCredentials() {
    setLoading(true);
    try {
        const response = await fetch('/api/orchids/credentials', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });

        if (!response.ok) throw new Error('Load failed');

        const data = await response.json();
        // Compatible with different return formats
        OrchidsState.credentials = Array.isArray(data) ? data : (data.data || []);

        // Load usage data and health status in parallel
        await Promise.all([loadUsageData(), fetchHealthStatus()]);
        renderCredentials();
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setLoading(false);
    }
}

// Rendering
function renderCredentials() {
    const query = OrchidsState.searchQuery;
    const filtered = OrchidsState.credentials.filter(cred => {
        if (!query) return true;
        return (cred.name && cred.name.toLowerCase().includes(query)) || 
               (cred.email && cred.email.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        DOM.emptyState.style.display = 'block';
        DOM.cardsGrid.style.display = 'none';
        DOM.listView.style.display = 'none';
        return;
    }

    DOM.emptyState.style.display = 'none';
    
    // Grid View
    DOM.cardsGrid.innerHTML = filtered.map(createCardHTML).join('');
    
    // List View
    DOM.listView.innerHTML = filtered.map(createListItemHTML).join('');

    if (OrchidsState.currentView === 'grid') {
        DOM.cardsGrid.style.display = 'grid';
        DOM.listView.style.display = 'none';
    } else {
        DOM.cardsGrid.style.display = 'none';
        DOM.listView.style.display = 'block';
    }
}

function createCardHTML(cred) {
    const isHealthy = OrchidsState.healthStatus[cred.id] !== false;
    const statusClass = !cred.isActive ? 'disabled' : (isHealthy ? 'healthy' : 'error');
    const statusText = !cred.isActive ? 'Disabled' : (isHealthy ? 'Normal' : 'Error');

    // Get usage data
    const usageInfo = OrchidsState.usageData?.accounts?.find(a => a.id === cred.id);
    const usage = usageInfo?.usage || { used: 0, limit: 150000, percentage: 0 };
    const usagePercent = usage.percentage || 0;
    const progressClass = usagePercent >= 90 ? 'danger' : (usagePercent >= 70 ? 'warning' : '');

    // Truncate email display
    const email = cred.email || cred.name || 'Unknown';
    const displayEmail = email.length > 28 ? email.substring(0, 25) + '...' : email;

    return `
        <div class="account-card orchids-account-card ${statusClass}" data-id="${cred.id}" onclick="openDetailModal(${cred.id})">
            <div class="card-status">
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="card-header">
                <div class="card-info">
                    <div class="card-email" title="${escapeHtml(email)}">
                        <span>${escapeHtml(displayEmail)}</span>
                    </div>
                    <div class="card-meta">
                        <span>Free</span>
                        <span class="card-meta-divider"></span>
                        <span>Weight: ${cred.weight || 1}</span>
                    </div>
                </div>
            </div>
            <div class="card-usage">
                <div class="usage-header">
                    <span class="usage-label">Credits</span>
                    <span class="usage-value">${formatCredits(usage.used)} / ${formatCredits(usage.limit)}</span>
                </div>
                <div class="usage-progress">
                    <div class="usage-progress-bar ${progressClass}" style="width: ${usagePercent}%"></div>
                </div>
                <div class="usage-details">
                    <span class="usage-used">Used ${usagePercent}%</span>
                    <span class="usage-remaining">Remaining ${formatCredits(usage.remaining || (usage.limit - usage.used))}</span>
                </div>
            </div>
            <div class="card-footer">
                <div class="card-dates">
                    <div class="date-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <span class="date-value">${formatDate(cred.expiresAt)}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="card-action-btn ${cred.isActive ? 'active' : ''}" data-action="activate" title="${cred.isActive ? 'Active' : 'Set Active'}" onclick="event.stopPropagation(); activateAccount(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </button>
                    <button class="card-action-btn" data-action="test" title="Test" onclick="event.stopPropagation(); testAccount(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                    </button>
                    <button class="card-action-btn" data-action="details" title="Details" onclick="event.stopPropagation(); showAccountDetail(${cred.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    <button class="card-action-btn danger" data-action="delete" title="Delete" onclick="event.stopPropagation(); deleteAccount(${cred.id})">
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

function createListItemHTML(cred) {
    return createCardHTML(cred); 
}

// Helper function: open chat
function openChat(id) {
    window.location.href = `/pages/chat.html?type=orchids&id=${id}`;
}

// Helper function: test account
async function testAccount(id) {
    showToast('Testing account...', 'info');
    try {
        const res = await fetch(`/api/orchids/credentials/${id}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        if (data.valid) {
            showToast('Account test passed', 'success');
        } else {
            showToast('Account test failed: ' + (data.error || 'Unknown error'), 'error');
        }
        await loadCredentials();
    } catch (e) {
        showToast('Test failed: ' + e.message, 'error');
    }
}

// Helper function: activate account
async function activateAccount(id) {
    try {
        const res = await fetch(`/api/orchids/credentials/${id}/activate`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        const data = await res.json();
        if (data.success) {
            showToast('Account activated', 'success');
        } else {
            showToast('Activation failed: ' + (data.error || 'Unknown error'), 'error');
        }
        await loadCredentials();
    } catch (e) {
        showToast('Activation failed: ' + e.message, 'error');
    }
}

// Helper function: show account detail
function showAccountDetail(id) {
    window.location.href = `/pages/orchids-detail.html?id=${id}`;
}

// Helper function: delete account
async function deleteAccount(id) {
    const cred = OrchidsState.credentials.find(c => c.id === id);
    if (!cred) return;
    if (!confirm(`Are you sure you want to delete account "${cred.name}"?`)) return;

    try {
        await fetch(`/api/orchids/credentials/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        showToast('Deleted successfully', 'success');
        await loadCredentials();
        await loadUsageData();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Modal Functions
function openAddModal() { DOM.addModal.classList.add('active'); }
function closeAddModal() {
    DOM.addModal.classList.remove('active'); 
    document.getElementById('add-account-form').reset();
}

function openBatchImportModal() { DOM.batchImportModal.classList.add('active'); }
function closeBatchImportModal() { DOM.batchImportModal.classList.remove('active'); }

function openDetailModal(id) {
    const cred = OrchidsState.credentials.find(c => c.id === id);
    if (!cred) return;

    OrchidsState.detailTarget = cred;
    
    document.getElementById('detail-name').textContent = cred.name;
    document.getElementById('detail-email').textContent = cred.email || '-';
    document.getElementById('detail-weight').textContent = cred.weight || 1;
    document.getElementById('detail-request-count').textContent = cred.requestCount || 0;
    document.getElementById('detail-success-count').textContent = cred.successCount || 0;
    document.getElementById('detail-failure-count').textContent = cred.failureCount || 0;
    
    const isHealthy = OrchidsState.healthStatus[cred.id] !== false;
    const statusText = !cred.isActive ? 'Disabled' : (isHealthy ? 'Normal' : 'Error');
    const statusClass = !cred.isActive ? 'disabled' : (isHealthy ? 'success' : 'error');
    
    const statusEl = document.getElementById('detail-status');
    statusEl.textContent = statusText;
    statusEl.className = `detail-value ${statusClass}`;

    DOM.detailModal.classList.add('active');
}

function closeDetailModal() {
    DOM.detailModal.classList.remove('active');
    OrchidsState.detailTarget = null;
}

// API Actions
async function handleAddAccount(e) {
    e.preventDefault();
    const jwt = document.getElementById('client-jwt').value.trim();
    const name = document.getElementById('account-name').value.trim();
    const weight = parseInt(document.getElementById('account-weight').value) || 1;

    if (!jwt) return showToast('Please enter Client Cookie', 'error');

    setLoading(true);
    try {
        const response = await fetch('/api/orchids/credentials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ client_cookie: jwt, name, weight })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Add failed');

        showToast('Account added successfully', 'success');
        closeAddModal();
        await loadCredentials();
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setLoading(false);
    }
}

async function handleDeleteAccount() {
    if (!OrchidsState.detailTarget) return;
    if (!confirm(`Are you sure you want to delete account "${OrchidsState.detailTarget.name}"?`)) return;

    try {
        await fetch(`/api/orchids/credentials/${OrchidsState.detailTarget.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        showToast('Deleted successfully', 'success');
        closeDetailModal();
        await loadCredentials();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function handleEditWeight() {
    if (!OrchidsState.detailTarget) return;
    const newWeight = prompt(`Enter new weight (current: ${OrchidsState.detailTarget.weight}):`, OrchidsState.detailTarget.weight);
    if (newWeight === null) return;

    const weight = parseInt(newWeight);
    if (isNaN(weight) || weight < 1) return showToast('Invalid weight', 'error');

    try {
        await fetch(`/api/orchids/credentials/${OrchidsState.detailTarget.id}/weight`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ weight })
        });
        showToast('Weight updated successfully', 'success');
        closeDetailModal();
        await loadCredentials();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function handleResetStats() {
    if (!OrchidsState.detailTarget) return;
    if (!confirm('Are you sure you want to reset statistics?')) return;

    try {
        await fetch(`/api/orchids/credentials/${OrchidsState.detailTarget.id}/reset-stats`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        showToast('Statistics reset', 'success');
        closeDetailModal();
        await loadCredentials();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function handleBatchImport(e) {
    e.preventDefault();
    const type = OrchidsState.importTab;
    const content = type === 'json'
        ? document.getElementById('batch-import-json').value
        : document.getElementById('batch-import-text').value;

    if (!content.trim()) return showToast('Please enter data to import', 'error');

    let accounts = [];
    try {
        if (type === 'json') {
            accounts = JSON.parse(content);
            if (!Array.isArray(accounts)) throw new Error('JSON must be in array format');
        } else {
            accounts = content.split('\n')
                .filter(line => line.trim())
        .map(line => {
                    const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                return { email: parts[0], clientJwt: parts[1] };
            }
            return null;
        })
        .filter(Boolean);
        }
    } catch (err) {
        return showToast('Data format error: ' + err.message, 'error');
}

    setLoading(true);
    try {
        const response = await fetch('/api/orchids/credentials/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ accounts })
        });

        const result = await response.json();
        if (result.success) {
            showToast(`Successfully imported ${result.count} accounts`, 'success');
            closeBatchImportModal();
            await loadCredentials();
        } else {
            showToast(result.error || 'Import failed', 'error');
        }
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setLoading(false);
    }
}

function handleRefreshAll() {
    if(!confirm('Are you sure you want to refresh all accounts?')) return;
    fetch('/api/orchids/refresh-all', {
        method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    }).then(() => {
        showToast('Refresh task started', 'success');
        setTimeout(loadCredentials, 2000);
    }).catch(e => showToast(e.message, 'error'));
}

function handleExport() {
    window.location.href = `/api/orchids/export?token=${localStorage.getItem('authToken')}`;
}

// Usage Data
async function loadUsageData() {
    try {
        const response = await fetch('/api/orchids/usage', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });

        if (!response.ok) throw new Error('Failed to load usage');

        const result = await response.json();
        if (result.success) {
            OrchidsState.usageData = result.data;
            updateUsageDisplay();
        }
    } catch (error) {
        console.error('Failed to load usage data:', error);
    }
}

function updateUsageDisplay() {
    const data = OrchidsState.usageData;
    if (!data || !data.summary) return;

    const { totalUsed, totalLimit, totalRemaining, totalPercentage, activeAccounts } = data.summary;

    // Update display
    const totalLimitEl = document.getElementById('usage-total-limit');
    const totalUsedEl = document.getElementById('usage-total-used');
    const totalRemainingEl = document.getElementById('usage-total-remaining');
    const usedDisplayEl = document.getElementById('usage-used-display');
    const remainingDisplayEl = document.getElementById('usage-remaining-display');
    const percentageEl = document.getElementById('usage-percentage');
    const progressBarEl = document.getElementById('usage-total-bar');
    const accountsCountEl = document.getElementById('usage-accounts-count');

    if (totalLimitEl) totalLimitEl.textContent = formatCredits(totalLimit);
    if (totalUsedEl) totalUsedEl.textContent = formatCredits(totalUsed);
    if (totalRemainingEl) totalRemainingEl.textContent = formatCredits(totalRemaining);
    if (usedDisplayEl) usedDisplayEl.textContent = formatCredits(totalUsed);
    if (remainingDisplayEl) remainingDisplayEl.textContent = formatCredits(totalRemaining);
    if (percentageEl) {
        percentageEl.textContent = `${totalPercentage}%`;
        percentageEl.className = 'usage-percentage' + 
            (totalPercentage >= 90 ? ' danger' : (totalPercentage >= 70 ? ' warning' : ''));
    }
    if (progressBarEl) {
        progressBarEl.style.width = `${Math.min(totalPercentage, 100)}%`;
        progressBarEl.className = 'usage-progress-bar' + 
            (totalPercentage >= 90 ? ' danger' : (totalPercentage >= 70 ? ' warning' : ''));
    }
    if (accountsCountEl) accountsCountEl.textContent = activeAccounts || 0;
}

function formatCredits(num) {
    if (num === undefined || num === null || isNaN(num)) return '--';
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

async function handleRefreshUsage() {
    const btn = document.getElementById('refresh-usage-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="btn-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            Refreshing...
        `;
    }

    try {
        // Use SSE streaming refresh
        const eventSource = new EventSource('/api/orchids/usage/refresh/stream');

        eventSource.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'progress') {
                    // Real-time display update
                    const progressText = `${data.current}/${data.total}`;
                    if (btn) btn.innerHTML = `
                        <svg class="btn-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                        ${progressText}
                    `;
                } else if (data.type === 'complete') {
                    eventSource.close();
                    showToast(`Usage refresh complete: ${data.success} succeeded, ${data.failed} failed`, 'success');
                    await loadUsageData();
                    resetRefreshButton();
                } else if (data.type === 'error') {
                    eventSource.close();
                    showToast('Refresh failed: ' + data.error, 'error');
                    resetRefreshButton();
                }
            } catch (e) {
                console.error('Failed to parse SSE message:', e);
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            resetRefreshButton();
        };

    } catch (error) {
        showToast('Usage refresh failed: ' + error.message, 'error');
        resetRefreshButton();
    }

    function resetRefreshButton() {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                Refresh Usage
            `;
        }
    }
}

// Get health status (for card rendering)
async function fetchHealthStatus() {
    try {
        const res = await fetch('/api/orchids/credentials/health', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (res.ok) {
            const healthData = await res.json();
            OrchidsState.healthStatus = {};
            healthData.accounts?.forEach(h => OrchidsState.healthStatus[h.account_id] = h.is_healthy);
        }
    } catch (e) {
        console.error('Failed to get health status:', e);
    }
}

// Utils
function setLoading(show) {
    if (DOM.loadingState) DOM.loadingState.style.display = show ? 'flex' : 'none';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
}

// Auto Register (Retained)
function openRegisterModal() {
    document.getElementById('register-count').value = '1';
    document.getElementById('register-config').style.display = 'block';
    document.getElementById('register-progress').style.display = 'none';
    document.getElementById('register-start-btn').style.display = 'inline-flex';
    document.getElementById('register-cancel-btn').style.display = 'none';
    document.getElementById('register-logs').innerHTML = '';
    DOM.registerModal?.classList.add('active');
}

function closeRegisterModal() {
    if (OrchidsState.registerTaskId && !confirm('Are you sure you want to close?')) return;
    if (OrchidsState.registerEventSource) {
        OrchidsState.registerEventSource.close();
        OrchidsState.registerEventSource = null;
    }
    DOM.registerModal?.classList.remove('active');
    OrchidsState.registerTaskId = null;
}

async function startRegister() {
    const count = parseInt(document.getElementById('register-count').value) || 1;
    try {
        const res = await fetch('/api/orchids/register/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ count })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        OrchidsState.registerTaskId = data.taskId;
        document.getElementById('register-config').style.display = 'none';
        document.getElementById('register-progress').style.display = 'block';
        document.getElementById('register-start-btn').style.display = 'none';
        document.getElementById('register-cancel-btn').style.display = 'inline-flex';
        
        startRegisterStream(data.taskId);
    } catch (e) { showToast(e.message, 'error'); }
}

function startRegisterStream(taskId) {
    const logsContainer = document.getElementById('register-logs');
    OrchidsState.registerEventSource = new EventSource(`/api/orchids/register/stream/${taskId}`);
    
    OrchidsState.registerEventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            document.getElementById('progress-current').textContent = data.progress;
            document.getElementById('progress-success').textContent = data.success;
            document.getElementById('progress-failed').textContent = data.failed;
            
            const percent = data.count > 0 ? Math.round((data.progress / data.count) * 100) : 0;
            document.getElementById('progress-bar').style.width = `${percent}%`;
            document.getElementById('progress-status').textContent = data.status;
            
            if (data.newLogs) {
                data.newLogs.forEach(log => {
                    const div = document.createElement('div');
                    div.className = `register-log ${log.level.toLowerCase()}`;
                    div.innerHTML = `<span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span> ${log.message}`;
                    logsContainer.appendChild(div);
                });
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
            
            if (['completed', 'error', 'cancelled'].includes(data.status)) {
                OrchidsState.registerEventSource.close();
                document.getElementById('register-cancel-btn').style.display = 'none';
                if (data.status === 'completed') loadCredentials();
            }
        } catch (e) { console.error(e); }
    };
}

async function cancelRegister() {
    if (!OrchidsState.registerTaskId) return;
    try {
        await fetch(`/api/orchids/register/cancel/${OrchidsState.registerTaskId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
    } catch (e) { showToast(e.message, 'error'); }
}
