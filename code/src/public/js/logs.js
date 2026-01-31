// ============ API Logs Page JS ============

let currentLogsPage = 1;
const logsPageSize = 50;
let currentLogData = null;

// DOM elements
let logDetailModal, cleanupModal;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('logs');

    // Get modal elements
    logDetailModal = document.getElementById('log-detail-modal');
    cleanupModal = document.getElementById('cleanup-modal');

    if (!await checkAuth()) return;

    loadLogs();
    loadLogsStats();
    setupEventListeners();
    updateSidebarStats();
});

function setupEventListeners() {
    // Search button
    document.getElementById('logs-search-btn').addEventListener('click', function() {
        currentLogsPage = 1;
        loadLogs();
    });

    // Reset button
    document.getElementById('logs-reset-btn').addEventListener('click', resetLogsFilter);

    // Cleanup button - open modal
    document.getElementById('logs-cleanup-btn').addEventListener('click', openCleanupModal);

    // Pagination buttons
    document.getElementById('logs-prev-btn').addEventListener('click', function() {
        if (currentLogsPage > 1) {
            currentLogsPage--;
            loadLogs();
        }
    });
    document.getElementById('logs-next-btn').addEventListener('click', function() {
        currentLogsPage++;
        loadLogs();
    });

    // Log detail modal
    document.getElementById('log-detail-close').addEventListener('click', closeLogDetailModal);
    document.getElementById('log-detail-close-btn').addEventListener('click', closeLogDetailModal);
    document.getElementById('log-detail-copy').addEventListener('click', copyLogJson);
    logDetailModal.addEventListener('click', function(e) {
        if (e.target === logDetailModal) closeLogDetailModal();
    });

    // Cleanup modal
    document.getElementById('cleanup-modal-close').addEventListener('click', closeCleanupModal);
    document.getElementById('cleanup-cancel').addEventListener('click', closeCleanupModal);
    document.getElementById('cleanup-confirm').addEventListener('click', confirmCleanup);
    cleanupModal.addEventListener('click', function(e) {
        if (e.target === cleanupModal) closeCleanupModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeLogDetailModal();
            closeCleanupModal();
        }
    });

    // Enter to search
    var filterInputs = document.querySelectorAll('.logs-filter-input');
    filterInputs.forEach(function(input) {
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                currentLogsPage = 1;
                loadLogs();
            }
        });
    });
}

async function loadLogs() {
    var ipFilter = document.getElementById('logs-filter-ip').value.trim();
    var modelFilter = document.getElementById('logs-filter-model').value;
    var statusFilter = document.getElementById('logs-filter-status').value;
    var apiKeyFilter = document.getElementById('logs-filter-apikey').value.trim();
    var startDate = document.getElementById('logs-filter-start').value;
    var endDate = document.getElementById('logs-filter-end').value;

    var url = '/api/logs?page=' + currentLogsPage + '&pageSize=' + logsPageSize;
    if (ipFilter) url += '&ipAddress=' + encodeURIComponent(ipFilter);
    if (modelFilter) url += '&model=' + encodeURIComponent(modelFilter);
    if (statusFilter) url += '&statusCode=' + encodeURIComponent(statusFilter);
    if (apiKeyFilter) url += '&apiKeyPrefix=' + encodeURIComponent(apiKeyFilter);
    if (startDate) url += '&startDate=' + startDate;
    if (endDate) url += '&endDate=' + endDate;

    try {
        var res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        var result = await res.json();
        if (result.success) {
            renderLogs(result.data);
        } else {
            showToast(result.error || 'Failed to load logs', 'error');
        }
    } catch (err) {
        console.error('Load logs error:', err);
        showToast('Failed to load logs', 'error');
    }
}

async function loadLogsStats() {
    try {
        var res = await fetch('/api/logs-stats', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        var result = await res.json();
        if (result.success && result.data) {
            var stats = result.data;
            document.getElementById('logs-total-requests').textContent = stats.totalRequests || 0;
            document.getElementById('logs-total-input-tokens').textContent = formatNumber(stats.totalInputTokens || 0);
            document.getElementById('logs-total-output-tokens').textContent = formatNumber(stats.totalOutputTokens || 0);
            document.getElementById('logs-avg-duration').textContent = Math.round(stats.avgDuration || 0) + 'ms';
            document.getElementById('logs-error-count').textContent = stats.errorCount || 0;
        }
    } catch (err) {
        console.error('Load logs stats error:', err);
    }
}

function renderLogs(data) {
    var list = document.getElementById('logs-list');
    var logs = data.logs || [];
    var total = data.total || 0;
    var totalPages = data.totalPages || 1;

    document.getElementById('logs-total').textContent = total;
    document.getElementById('logs-current-page').textContent = currentLogsPage;
    document.getElementById('logs-total-pages').textContent = totalPages;

    var start = (currentLogsPage - 1) * logsPageSize + 1;
    var end = Math.min(currentLogsPage * logsPageSize, total);
    document.getElementById('logs-showing-start').textContent = total > 0 ? start : 0;
    document.getElementById('logs-showing-end').textContent = end;

    document.getElementById('logs-prev-btn').disabled = currentLogsPage <= 1;
    document.getElementById('logs-next-btn').disabled = currentLogsPage >= totalPages;

    if (logs.length === 0) {
        list.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">No log records</td></tr>';
        return;
    }

    list.innerHTML = logs.map(function(log) {
        var statusClass = log.statusCode >= 400 ? 'error' : 'success';
        var typeClass = log.stream ? 'stream' : 'sync';
        var typeText = log.stream ? 'Stream' : 'Sync';

        return '<tr>' +
            '<td>' + formatDateTime(log.createdAt) + '</td>' +
            '<td class="logs-ip-cell">' + (log.ipAddress || '-') + '</td>' +
            '<td><span class="logs-key-cell">' + (log.apiKeyPrefix || '-') + '</span></td>' +
            '<td class="logs-model-cell">' + formatModelName(log.model) + '</td>' +
            '<td><span class="logs-type-badge ' + typeClass + '">' + typeText + '</span></td>' +
            '<td class="logs-tokens-cell">' + (log.inputTokens || 0) + ' / ' + (log.outputTokens || 0) + '</td>' +
            '<td class="logs-duration-cell">' + (log.durationMs || 0) + 'ms</td>' +
            '<td><span class="logs-status-badge ' + statusClass + '">' + (log.statusCode || 200) + '</span></td>' +
            '<td>' +
            '<button class="logs-action-btn" data-request-id="' + log.requestId + '" title="View details">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
            '</button>' +
            '</td>' +
            '</tr>';
    }).join('');

    // Bind view details button events
    list.querySelectorAll('.logs-action-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            viewLogDetail(btn.dataset.requestId);
        });
    });
}

function formatModelName(model) {
    if (!model) return '-';
    var modelMap = {
        'claude-sonnet-4-20250514': 'sonnet-4',
        'claude-opus-4-5-20251101': 'opus-4.5',
        'claude-3-5-sonnet-20241022': '3.5-sonnet',
        'claude-3-5-haiku-20241022': '3.5-haiku',
        'claude-3-opus-20240229': '3-opus',
        'claude-3-sonnet-20240229': '3-sonnet',
        'claude-3-haiku-20240307': '3-haiku'
    };
    return modelMap[model] || model.replace('claude-', '').substring(0, 12);
}

function resetLogsFilter() {
    document.getElementById('logs-filter-ip').value = '';
    document.getElementById('logs-filter-model').value = '';
    document.getElementById('logs-filter-status').value = '';
    document.getElementById('logs-filter-apikey').value = '';
    document.getElementById('logs-filter-start').value = '';
    document.getElementById('logs-filter-end').value = '';
    currentLogsPage = 1;
    loadLogs();
}

// ============ Log Detail Modal ============

async function viewLogDetail(requestId) {
    try {
        var res = await fetch('/api/logs/' + requestId, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        var result = await res.json();
        if (result.success && result.data) {
            currentLogData = result.data;
            renderLogDetail(result.data);
            logDetailModal.classList.add('active');
        } else {
            showToast('Failed to get log details', 'error');
        }
    } catch (err) {
        showToast('Failed to get log details: ' + err.message, 'error');
    }
}

function renderLogDetail(log) {
    var content = document.getElementById('log-detail-content');
    var statusClass = log.statusCode >= 400 ? 'error' : 'success';

    var html = '<div class="log-detail-grid">';

    // Basic info
    html += '<div class="log-detail-section">';
    html += '<h4 class="log-detail-section-title">Basic Info</h4>';
    html += '<div class="log-detail-items">';
    html += createDetailItem('Request ID', log.requestId || '-');
    html += createDetailItem('Time', formatDateTime(log.createdAt));
    html += createDetailItem('IP Address', log.ipAddress || '-');
    html += createDetailItem('API Key', log.apiKeyPrefix || '-');
    html += '</div></div>';

    // Request info
    html += '<div class="log-detail-section">';
    html += '<h4 class="log-detail-section-title">Request Info</h4>';
    html += '<div class="log-detail-items">';
    html += createDetailItem('Model', log.model || '-');
    html += createDetailItem('Type', log.stream ? 'Stream' : 'Sync');
    html += createDetailItem('Status Code', '<span class="logs-status-badge ' + statusClass + '">' + (log.statusCode || 200) + '</span>');
    html += createDetailItem('Duration', (log.durationMs || 0) + 'ms');
    html += '</div></div>';

    // Token statistics
    html += '<div class="log-detail-section">';
    html += '<h4 class="log-detail-section-title">Token Statistics</h4>';
    html += '<div class="log-detail-items">';
    html += createDetailItem('Input Tokens', log.inputTokens || 0);
    html += createDetailItem('Output Tokens', log.outputTokens || 0);
    html += createDetailItem('Total Tokens', (log.inputTokens || 0) + (log.outputTokens || 0));
    html += '</div></div>';

    // Error message (if any)
    if (log.errorMessage) {
        html += '<div class="log-detail-section log-detail-error">';
        html += '<h4 class="log-detail-section-title">Error Message</h4>';
        html += '<div class="log-detail-error-content">' + escapeHtml(log.errorMessage) + '</div>';
        html += '</div>';
    }

    // Request/response data (if any)
    if (log.requestBody || log.responseBody) {
        html += '<div class="log-detail-section">';
        html += '<h4 class="log-detail-section-title">Request/Response Data</h4>';
        if (log.requestBody) {
            html += '<div class="log-detail-code-label">Request Body:</div>';
            html += '<pre class="log-detail-code">' + formatJsonString(log.requestBody) + '</pre>';
        }
        if (log.responseBody) {
            html += '<div class="log-detail-code-label">Response Body:</div>';
            html += '<pre class="log-detail-code">' + formatJsonString(log.responseBody) + '</pre>';
        }
        html += '</div>';
    }

    html += '</div>';
    content.innerHTML = html;
}

function createDetailItem(label, value) {
    return '<div class="log-detail-item">' +
        '<span class="log-detail-label">' + label + '</span>' +
        '<span class="log-detail-value">' + value + '</span>' +
        '</div>';
}

function formatJsonString(str) {
    if (!str) return '';
    try {
        var obj = typeof str === 'string' ? JSON.parse(str) : str;
        return escapeHtml(JSON.stringify(obj, null, 2));
    } catch (e) {
        return escapeHtml(str);
    }
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

function closeLogDetailModal() {
    logDetailModal.classList.remove('active');
    currentLogData = null;
}

function copyLogJson() {
    if (!currentLogData) return;
    var jsonStr = JSON.stringify(currentLogData, null, 2);
    copyToClipboard(jsonStr);
    showToast('Copied to clipboard', 'success');
}

// ============ Cleanup Modal ============

function openCleanupModal() {
    document.getElementById('cleanup-days').value = '30';
    cleanupModal.classList.add('active');
}

function closeCleanupModal() {
    cleanupModal.classList.remove('active');
}

async function confirmCleanup() {
    var daysInput = document.getElementById('cleanup-days');
    var days = parseInt(daysInput.value);

    if (isNaN(days) || days < 1 || days > 365) {
        showToast('Please enter a number between 1 and 365', 'error');
        return;
    }

    try {
        var res = await fetch('/api/logs/cleanup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ daysToKeep: days })
        });
        var result = await res.json();
        if (result.success) {
            showToast('Log cleanup completed', 'success');
            closeCleanupModal();
            loadLogs();
            loadLogsStats();
        } else {
            showToast(result.error || 'Cleanup failed', 'error');
        }
    } catch (err) {
        showToast('Cleanup failed: ' + err.message, 'error');
    }
}

// ============ Helper Functions ============

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}
