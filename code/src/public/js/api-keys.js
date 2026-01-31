// ============ API Keys Page JS ============

let apiKeys = [];
let createKeyModal;
let limitsModal;
let batchCreateModal;
let renewModal;
let batchGeneratedKeys = [];

document.addEventListener('DOMContentLoaded', async () => {
    createKeyModal = document.getElementById('create-key-modal');
    limitsModal = document.getElementById('limits-modal');
    batchCreateModal = document.getElementById('batch-create-modal');
    renewModal = document.getElementById('renew-modal');

    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('api-keys');

    if (!await checkAuth()) return;

    loadApiKeys();
    setupEventListeners();
    updateSidebarStats();
});

function setupEventListeners() {
    document.getElementById('create-key-btn').addEventListener('click', openCreateModal);
    document.getElementById('modal-close').addEventListener('click', closeCreateModal);
    document.getElementById('modal-cancel').addEventListener('click', closeCreateModal);
    document.getElementById('modal-submit').addEventListener('click', createApiKey);
    createKeyModal.addEventListener('click', function(e) {
        if (e.target === createKeyModal) closeCreateModal();
    });

    // Limits configuration modal events
    document.getElementById('limits-modal-close').addEventListener('click', closeLimitsModal);
    document.getElementById('limits-modal-cancel').addEventListener('click', closeLimitsModal);
    document.getElementById('limits-modal-submit').addEventListener('click', saveLimits);
    limitsModal.addEventListener('click', function(e) {
        if (e.target === limitsModal) closeLimitsModal();
    });

    // Batch create modal events
    document.getElementById('batch-create-btn').addEventListener('click', openBatchCreateModal);
    document.getElementById('batch-modal-close').addEventListener('click', closeBatchCreateModal);
    document.getElementById('batch-modal-cancel').addEventListener('click', closeBatchCreateModal);
    document.getElementById('batch-modal-submit').addEventListener('click', startBatchCreate);
    document.getElementById('batch-copy-all').addEventListener('click', copyAllBatchKeys);
    batchCreateModal.addEventListener('click', function(e) {
        if (e.target === batchCreateModal) closeBatchCreateModal();
    });

    // Renew modal events
    document.getElementById('renew-modal-close').addEventListener('click', closeRenewModal);
    document.getElementById('renew-modal-cancel').addEventListener('click', closeRenewModal);
    document.getElementById('renew-modal-submit').addEventListener('click', submitRenew);
    renewModal.addEventListener('click', function(e) {
        if (e.target === renewModal) closeRenewModal();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeCreateModal();
            closeLimitsModal();
            closeBatchCreateModal();
            closeRenewModal();
        }
    });
}

async function loadApiKeys() {
    try {
        const res = await fetch('/api/keys', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        apiKeys = result.success ? result.data : [];
        renderApiKeys();
    } catch (err) {
        console.error('Load API keys error:', err);
        showToast('Failed to load API keys', 'error');
    }
}

function renderApiKeys() {
    const list = document.getElementById('api-keys-list');
    const emptyState = document.getElementById('empty-state');
    const countEl = document.getElementById('api-keys-count');

    countEl.textContent = 'Total ' + apiKeys.length + ' keys';

    if (apiKeys.length === 0) {
        list.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    // Sort by last used time, newest on top (unused at bottom)
    const sortedKeys = [...apiKeys].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return 0;
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
    });

    emptyState.style.display = 'none';
    list.innerHTML = sortedKeys.map(function(key) {
        const statusClass = key.isActive ? 'success' : 'error';
        const statusText = key.isActive ? 'Enabled' : 'Disabled';
        const keyDisplay = key.keyValue || key.keyPrefix || '***';
        // Escape special characters to prevent XSS and syntax errors
        const escapedKey = keyDisplay.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');

        // Build limits display
        let limitsDisplay = '<span class="usage-loading">-</span>';

        return '<tr data-key-value="' + escapedKey + '">' +
            '<td class="api-key-name-cell">' + key.name + '</td>' +
            '<td>' +
            '<div class="api-key-value-cell">' +
            '<span class="api-key-value" style="font-size: 12px;">' + keyDisplay + '</span>' +
            '<button class="api-key-copy-btn" data-key-id="' + key.id + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
            '</svg></button>' +
            '</div>' +
            '</td>' +
            '<td><span class="logs-status-badge ' + statusClass + '">' + statusText + '</span></td>' +
            '<td class="api-key-limits" data-key-id="' + key.id + '">' + limitsDisplay + '</td>' +
            '<td class="api-key-expire" data-key-id="' + key.id + '">-</td>' +
            '<td>' + formatDateTime(key.createdAt) + '</td>' +
            '<td>' + (key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'Never used') + '</td>' +
            '<td>' +
            '<div class="api-key-actions-cell">' +
            '<button class="btn btn-secondary btn-sm" onclick="openLimitsModal(' + key.id + ')" title="Configure limits">Limits</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="openRenewModal(' + key.id + ')" title="Renew">Renew</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="toggleApiKey(' + key.id + ')">' + (key.isActive ? 'Disable' : 'Enable') + '</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteApiKey(' + key.id + ')">Delete</button>' +
            '</div>' +
            '</td>' +
            '</tr>';
    }).join('');

    // Bind copy button events
    document.querySelectorAll('.api-key-copy-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const row = btn.closest('tr');
            const keyValue = row.dataset.keyValue.replace(/&quot;/g, '"');
            copyApiKey(keyValue);
        });
    });

    // Load usage statistics
    sortedKeys.forEach(function(key) {
        loadKeyLimitsStatus(key.id);
    });
}

async function loadKeyUsage(keyId) {
    try {
        const res = await fetch('/api/keys/' + keyId + '/usage', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success && result.data) {
            const row = document.querySelector('tr:has(button[onclick*="toggleApiKey(' + keyId + ')"])');
            if (row) {
                const usageCell = row.querySelector('.api-key-usage');
                if (usageCell) {
                    usageCell.innerHTML = '<div class="usage-stats-mini">' +
                        '<div class="usage-stat-item">' + (result.data.totalRequests || 0) + ' requests</div>' +
                        '</div>';
                }
            }
        }
    } catch (err) {
        console.error('Load key usage error:', err);
    }
}

function openCreateModal() {
    document.getElementById('key-name').value = '';
    document.getElementById('custom-key').value = '';
    createKeyModal.classList.add('active');
}

function closeCreateModal() {
    createKeyModal.classList.remove('active');
}

async function createApiKey() {
    const name = document.getElementById('key-name').value.trim();
    const customKey = document.getElementById('custom-key').value.trim();

    if (!name) {
        showToast('Please enter key name', 'error');
        return;
    }

    try {
        const res = await fetch('/api/keys', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ name: name, customKey: customKey || undefined })
        });

        const result = await res.json();
        if (result.success) {
            showToast('API key created successfully', 'success');
            if (result.data.key) {
                alert('Please save your API key (shown only once):\n\n' + result.data.key);
            }
            closeCreateModal();
            loadApiKeys();
        } else {
            showToast(result.error || 'Create failed', 'error');
        }
    } catch (err) {
        showToast('Create failed: ' + err.message, 'error');
    }
}

async function toggleApiKey(id) {
    try {
        const res = await fetch('/api/keys/' + id + '/toggle', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('Status updated', 'success');
            loadApiKeys();
        } else {
            showToast(result.error || 'Operation failed', 'error');
        }
    } catch (err) {
        showToast('Operation failed: ' + err.message, 'error');
    }
}

async function deleteApiKey(id) {
    if (!confirm('Are you sure you want to delete this API key?')) return;

    try {
        await fetch('/api/keys/' + id, {
            method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        showToast('API key deleted', 'success');
        loadApiKeys();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    }
}

function copyApiKey(key) {
    copyToClipboard(key);
}

// ============ Limits Configuration Functions ============

async function loadKeyLimitsStatus(keyId) {
    try {
        const res = await fetch('/api/keys/' + keyId + '/limits-status', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success && result.data) {
            const { limits, usage, remaining, expireDate } = result.data;
            const cell = document.querySelector('.api-key-limits[data-key-id="' + keyId + '"]');
            const expireCell = document.querySelector('.api-key-expire[data-key-id="' + keyId + '"]');

            if (cell) {
                let html = '<div class="limits-mini">';

                // Display daily usage
                if (limits.dailyLimit > 0) {
                    const percent = Math.min(100, (usage.daily / limits.dailyLimit) * 100);
                    html += '<div class="limit-item" title="Daily: ' + usage.daily + '/' + limits.dailyLimit + '">' +
                        '<span class="limit-label">Daily</span>' +
                        '<span class="limit-value ' + (percent >= 90 ? 'warning' : '') + '">' + usage.daily + '/' + limits.dailyLimit + '</span>' +
                        '</div>';
                }

                // Display monthly usage
                if (limits.monthlyLimit > 0) {
                    const percent = Math.min(100, (usage.monthly / limits.monthlyLimit) * 100);
                    html += '<div class="limit-item" title="Monthly: ' + usage.monthly + '/' + limits.monthlyLimit + '">' +
                        '<span class="limit-label">Monthly</span>' +
                        '<span class="limit-value ' + (percent >= 90 ? 'warning' : '') + '">' + usage.monthly + '/' + limits.monthlyLimit + '</span>' +
                        '</div>';
                }

                // Display concurrent limit
                if (limits.concurrentLimit > 0) {
                    html += '<div class="limit-item" title="Concurrent: ' + usage.currentConcurrent + '/' + limits.concurrentLimit + '">' +
                        '<span class="limit-label">Concurrent</span>' +
                        '<span class="limit-value">' + usage.currentConcurrent + '/' + limits.concurrentLimit + '</span>' +
                        '</div>';
                }

                // If no limits set, show total requests
                if (limits.dailyLimit === 0 && limits.monthlyLimit === 0 && limits.concurrentLimit === 0) {
                    html += '<div class="limit-item">' +
                        '<span class="limit-value">' + usage.total + ' requests</span>' +
                        '</div>';
                }

                html += '</div>';
                cell.innerHTML = html;
            }

            // Display expiration time in separate column
            if (expireCell) {
                if (expireDate) {
                    const daysLeft = remaining.days;

                    let expireClass = '';
                    // expireDate is already a formatted local time string from backend "YYYY-MM-DD HH:mm:ss"
                    // Extract for display directly, avoid using new Date() to prevent timezone issues
                    let expireDateStr = expireDate;
                    // Format as MM/DD HH:mm
                    const parts = expireDate.split(' ');
                    if (parts.length === 2) {
                        const dateParts = parts[0].split('-');
                        const timeParts = parts[1].split(':');
                        if (dateParts.length === 3 && timeParts.length >= 2) {
                            expireDateStr = dateParts[1] + '/' + dateParts[2] + ' ' + timeParts[0] + ':' + timeParts[1];
                        }
                    }

                    // Determine if expired using remaining days
                    const isExpired = daysLeft <= 0;

                    if (isExpired) {
                        expireClass = 'danger';
                    } else if (daysLeft <= 3) {
                        expireClass = 'danger';
                    } else if (daysLeft <= 7) {
                        expireClass = 'warning';
                    }

                    expireCell.innerHTML = '<span class="limit-value ' + expireClass + '" title="' + daysLeft + ' days remaining">' +
                        (isExpired ? 'Expired' : expireDateStr) + '</span>';
                } else {
                    expireCell.innerHTML = '<span class="limit-value" style="color: var(--text-muted);">Permanent</span>';
                }
            }
        }
    } catch (err) {
        console.error('Load key limits status error:', err);
    }
}

async function openLimitsModal(keyId) {
    try {
        // Get key details
        const res = await fetch('/api/keys/' + keyId, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (!result.success) {
            showToast(result.error || 'Failed to get key info', 'error');
            return;
        }

        const key = result.data;
        document.getElementById('limits-key-id').value = keyId;
        document.getElementById('limits-key-name').textContent = key.name;
        document.getElementById('daily-limit').value = key.dailyLimit || 0;
        document.getElementById('monthly-limit').value = key.monthlyLimit || 0;
        document.getElementById('total-limit').value = key.totalLimit || 0;
        document.getElementById('concurrent-limit').value = key.concurrentLimit || 0;
        // Cost limits
        document.getElementById('daily-cost-limit').value = key.dailyCostLimit || 0;
        document.getElementById('monthly-cost-limit').value = key.monthlyCostLimit || 0;
        document.getElementById('total-cost-limit').value = key.totalCostLimit || 0;
        // Expiration
        document.getElementById('expires-in-days').value = key.expiresInDays || 0;

        // Load current usage status
        loadLimitsStatusInModal(keyId);

        limitsModal.classList.add('active');
    } catch (err) {
        showToast('Failed to get key info: ' + err.message, 'error');
    }
}

async function loadLimitsStatusInModal(keyId) {
    try {
        const res = await fetch('/api/keys/' + keyId + '/limits-status', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success && result.data) {
            const { usage, remaining } = result.data;
            const statusDiv = document.getElementById('limits-status');
            const gridDiv = document.getElementById('usage-grid');

            let html = '<div class="usage-item"><span class="usage-label">Daily Requests</span><span class="usage-value">' + usage.daily + '</span></div>' +
                '<div class="usage-item"><span class="usage-label">Monthly Requests</span><span class="usage-value">' + usage.monthly + '</span></div>' +
                '<div class="usage-item"><span class="usage-label">Total Requests</span><span class="usage-value">' + usage.total + '</span></div>' +
                '<div class="usage-item"><span class="usage-label">Daily Cost</span><span class="usage-value">$' + (usage.dailyCost || 0).toFixed(4) + '</span></div>' +
                '<div class="usage-item"><span class="usage-label">Monthly Cost</span><span class="usage-value">$' + (usage.monthlyCost || 0).toFixed(4) + '</span></div>' +
                '<div class="usage-item"><span class="usage-label">Total Cost</span><span class="usage-value">$' + (usage.totalCost || 0).toFixed(4) + '</span></div>';

            if (remaining.days !== null) {
                html += '<div class="usage-item"><span class="usage-label">Days Remaining</span><span class="usage-value">' + remaining.days + ' days</span></div>';
            }

            gridDiv.innerHTML = html;
            statusDiv.style.display = 'block';
        }
    } catch (err) {
        console.error('Load limits status error:', err);
    }
}

function closeLimitsModal() {
    limitsModal.classList.remove('active');
    document.getElementById('limits-status').style.display = 'none';
}

async function saveLimits() {
    const keyId = document.getElementById('limits-key-id').value;
    const dailyLimit = parseInt(document.getElementById('daily-limit').value) || 0;
    const monthlyLimit = parseInt(document.getElementById('monthly-limit').value) || 0;
    const totalLimit = parseInt(document.getElementById('total-limit').value) || 0;
    const concurrentLimit = parseInt(document.getElementById('concurrent-limit').value) || 0;
    // Cost limits
    const dailyCostLimit = parseFloat(document.getElementById('daily-cost-limit').value) || 0;
    const monthlyCostLimit = parseFloat(document.getElementById('monthly-cost-limit').value) || 0;
    const totalCostLimit = parseFloat(document.getElementById('total-cost-limit').value) || 0;
    // Expiration
    const expiresInDays = parseInt(document.getElementById('expires-in-days').value) || 0;

    try {
        const res = await fetch('/api/keys/' + keyId + '/limits', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({
                dailyLimit,
                monthlyLimit,
                totalLimit,
                concurrentLimit,
                dailyCostLimit,
                monthlyCostLimit,
                totalCostLimit,
                expiresInDays
            })
        });

        const result = await res.json();
        if (result.success) {
            showToast('Limits configuration saved', 'success');
            closeLimitsModal();
            loadApiKeys();
        } else {
            showToast(result.error || 'Save failed', 'error');
        }
    } catch (err) {
        showToast('Save failed: ' + err.message, 'error');
    }
}

// ============ Batch Create Functions ============

function openBatchCreateModal() {
    document.getElementById('batch-name-prefix').value = '';
    document.getElementById('batch-count').value = '10';
    document.getElementById('batch-progress').style.display = 'none';
    document.getElementById('batch-results').innerHTML = '';
    document.getElementById('batch-modal-submit').style.display = 'inline-flex';
    document.getElementById('batch-modal-submit').disabled = false;
    document.getElementById('batch-copy-all').style.display = 'none';
    batchGeneratedKeys = [];
    batchCreateModal.classList.add('active');
}

function closeBatchCreateModal() {
    batchCreateModal.classList.remove('active');
}

async function startBatchCreate() {
    const prefix = document.getElementById('batch-name-prefix').value.trim();
    const count = parseInt(document.getElementById('batch-count').value) || 0;

    if (!prefix) {
        showToast('Please enter name prefix', 'error');
        return;
    }

    if (count < 1 || count > 100) {
        showToast('Count must be between 1-100', 'error');
        return;
    }

    // Show progress bar
    document.getElementById('batch-progress').style.display = 'block';
    document.getElementById('batch-modal-submit').disabled = true;
    document.getElementById('batch-results').innerHTML = '';
    batchGeneratedKeys = [];

    const progressBar = document.getElementById('batch-progress-bar');
    const progressText = document.getElementById('batch-progress-text');
    const resultsDiv = document.getElementById('batch-results');

    let successCount = 0;
    let failCount = 0;

    for (let i = 1; i <= count; i++) {
        const keyName = prefix + '_' + i;
        progressText.textContent = i + '/' + count;
        progressBar.style.width = ((i / count) * 100) + '%';

        try {
            const res = await fetch('/api/keys', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({ name: keyName })
            });

            const result = await res.json();
            if (result.success && result.data.key) {
                successCount++;
                batchGeneratedKeys.push({ name: keyName, key: result.data.key });
                const escapedKey = result.data.key.replace(/'/g, "\\'");
                resultsDiv.innerHTML += '<div class="batch-result-item success">' +
                    '<span class="batch-result-name">' + keyName + '</span>' +
                    '<span class="batch-result-key">' + result.data.key + '</span>' +
                    '<button class="btn btn-sm" onclick="copyToClipboard(\'' + escapedKey + '\')">Copy</button>' +
                    '</div>';
            } else {
                failCount++;
                resultsDiv.innerHTML += '<div class="batch-result-item error">' +
                    '<span class="batch-result-name">' + keyName + '</span>' +
                    '<span class="batch-result-error">' + (result.error || 'Create failed') + '</span>' +
                    '</div>';
            }
        } catch (err) {
            failCount++;
            resultsDiv.innerHTML += '<div class="batch-result-item error">' +
                '<span class="batch-result-name">' + keyName + '</span>' +
                '<span class="batch-result-error">' + err.message + '</span>' +
                '</div>';
        }

        // Scroll to bottom
        resultsDiv.scrollTop = resultsDiv.scrollHeight;
    }

    // Complete
    document.getElementById('batch-modal-submit').style.display = 'none';
    if (batchGeneratedKeys.length > 0) {
        document.getElementById('batch-copy-all').style.display = 'inline-flex';
    }

    showToast('Batch create complete: ' + successCount + ' succeeded, ' + failCount + ' failed',
        failCount === 0 ? 'success' : 'warning');

    // Refresh list
    loadApiKeys();
}

function copyAllBatchKeys() {
    if (batchGeneratedKeys.length === 0) {
        showToast('No keys to copy', 'error');
        return;
    }

    const text = batchGeneratedKeys.map(function(item) {
        return item.name + ': ' + item.key;
    }).join('\n');

    copyToClipboard(text);
}

// ============ Renew Functions ============

function setRenewDays(days) {
    document.getElementById('renew-days').value = days;
}

async function openRenewModal(keyId) {
    try {
        // Get key details
        const res = await fetch('/api/keys/' + keyId, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (!result.success) {
            showToast(result.error || 'Failed to get key info', 'error');
            return;
        }

        const key = result.data;
        document.getElementById('renew-key-id').value = keyId;
        document.getElementById('renew-key-name').textContent = key.name;
        document.getElementById('renew-days').value = 30;

        // Get current status
        const statusRes = await fetch('/api/keys/' + keyId + '/limits-status', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const statusResult = await statusRes.json();

        if (statusResult.success && statusResult.data) {
            const { expireDate, remaining } = statusResult.data;
            if (expireDate) {
                const expDate = new Date(expireDate);
                const now = new Date();
                const isExpired = expDate < now;
                const daysLeft = remaining.days;

                document.getElementById('renew-current-status').innerHTML = isExpired
                    ? '<span style="color: var(--danger-color);">Expired</span>'
                    : '<span style="color: var(--success-color);">Valid</span>';
                document.getElementById('renew-remaining-days').innerHTML = isExpired
                    ? '<span style="color: var(--danger-color);">Expired</span>'
                    : '<span>' + daysLeft + ' days</span>';
            } else {
                document.getElementById('renew-current-status').innerHTML = '<span style="color: var(--text-muted);">Permanent</span>';
                document.getElementById('renew-remaining-days').innerHTML = '<span style="color: var(--text-muted);">Unlimited</span>';
            }
        }

        renewModal.classList.add('active');
    } catch (err) {
        showToast('Failed to get key info: ' + err.message, 'error');
    }
}

function closeRenewModal() {
    renewModal.classList.remove('active');
}

async function submitRenew() {
    const keyId = document.getElementById('renew-key-id').value;
    const days = parseInt(document.getElementById('renew-days').value) || 0;

    if (days <= 0) {
        showToast('Renewal days must be greater than 0', 'error');
        return;
    }

    try {
        const res = await fetch('/api/keys/' + keyId + '/renew', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ days: days })
        });

        const result = await res.json();
        if (result.success) {
            showToast('Renewal successful, added ' + result.data.addedDays + ' days, ' + result.data.remainingDays + ' days remaining', 'success');
            closeRenewModal();
            loadApiKeys();
        } else {
            showToast(result.error || 'Renewal failed', 'error');
        }
    } catch (err) {
        showToast('Renewal failed: ' + err.message, 'error');
    }
}
