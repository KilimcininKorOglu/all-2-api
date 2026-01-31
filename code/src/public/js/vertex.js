/**
 * Vertex AI Account Management Page JavaScript
 */

let credentials = [];
let selectedIds = new Set();
let currentContextId = null;
let currentEditId = null;
let parsedJsonData = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize sidebar
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('vertex');
        updateSidebarStats();
    }

    await loadCredentials();
    await loadStatistics();
    await loadModels();
    setupEventListeners();
    setupDropZone();
    setupRegionSelector();
});

// Load credentials list
async function loadCredentials() {
    try {
        const response = await fetch('/api/vertex/credentials');
        credentials = await response.json();
        renderCards();
    } catch (error) {
        showToast('Failed to load credentials: ' + error.message, 'error');
    }
}

// Load statistics
async function loadStatistics() {
    try {
        const response = await fetch('/api/vertex/statistics');
        const stats = await response.json();
        document.getElementById('stat-total').textContent = stats.total || 0;
        document.getElementById('stat-active').textContent = stats.active || 0;
        document.getElementById('stat-healthy').textContent = stats.healthy || 0;
        document.getElementById('stat-usage').textContent = stats.totalUseCount || 0;
    } catch (error) {
        console.error('Failed to load statistics:', error);
    }
}

// Load supported models list
async function loadModels() {
    try {
        const response = await fetch('/api/vertex/models');
        const data = await response.json();
        renderModels(data.models, data.mapping);
    } catch (error) {
        console.error('Failed to load models list:', error);
    }
}

// Render models list
function renderModels(models, mapping) {
    const grid = document.getElementById('models-grid');
    if (!grid) return;

    // Sort by version: 4.5 > 4 > 3.7 > 3.5 > 3
    const sortedModels = models.sort((a, b) => {
        const getVersion = (name) => {
            if (name.includes('4-5') || name.includes('4.5')) return 5;
            if (name.includes('sonnet-4') || name.includes('4-sonnet')) return 4;
            if (name.includes('3-7') || name.includes('3.7')) return 3.7;
            if (name.includes('3-5') || name.includes('3.5')) return 3.5;
            return 3;
        };
        return getVersion(b) - getVersion(a);
    });

    grid.innerHTML = sortedModels.map(model => {
        const vertexModel = mapping[model];
        const isV4Plus = model.includes('4-5') || model.includes('4.5') || model.includes('sonnet-4') || model.includes('4-sonnet');
        const badgeClass = isV4Plus ? 'claude-4' : 'claude-3';
        const badgeText = isV4Plus ? 'Latest' : 'v3';

        return `
            <div class="model-card" data-model="${escapeHtml(model)}" onclick="copyModelName('${escapeHtml(model)}', this)">
                ${isV4Plus ? `<span class="model-card-badge ${badgeClass}">${badgeText}</span>` : ''}
                <div class="model-card-name">${escapeHtml(model)}</div>
                <div class="model-card-mapping">→ ${escapeHtml(vertexModel)}</div>
                <div class="model-card-copy-hint">Click to copy model name</div>
            </div>
        `;
    }).join('');
}

// Copy model name
function copyModelName(modelName, element) {
    navigator.clipboard.writeText(modelName).then(() => {
        element.classList.add('copied');
        showToast(`Copied: ${modelName}`, 'success');
        setTimeout(() => {
            element.classList.remove('copied');
        }, 1500);
    }).catch(() => {
        // Fallback copy method
        const textArea = document.createElement('textarea');
        textArea.value = modelName;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            element.classList.add('copied');
            showToast(`Copied: ${modelName}`, 'success');
            setTimeout(() => {
                element.classList.remove('copied');
            }, 1500);
        } catch (e) {
            showToast('Copy failed', 'error');
        }
        document.body.removeChild(textArea);
    });
}

// Render cards
function renderCards() {
    const grid = document.getElementById('cards-grid');
    const emptyState = document.getElementById('empty-state');
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    // Filter
    const filtered = credentials.filter(c =>
        c.name.toLowerCase().includes(searchTerm) ||
        (c.projectId && c.projectId.toLowerCase().includes(searchTerm)) ||
        (c.clientEmail && c.clientEmail.toLowerCase().includes(searchTerm))
    );

    document.getElementById('displayed-count').textContent = filtered.length;

    if (filtered.length === 0) {
        grid.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }

    grid.style.display = 'grid';
    emptyState.style.display = 'none';

    grid.innerHTML = filtered.map(c => createCard(c)).join('');
    updateSelectAllCheckbox();
}

// Create card HTML
function createCard(credential) {
    const isSelected = selectedIds.has(credential.id);
    const displayName = credential.name || credential.projectId || 'Unnamed';
    const statusBadge = credential.errorCount > 0 ? '<span class="pro-badge inactive">Error</span>' :
                        (credential.isActive ? '<span class="pro-badge">Active</span>' : '<span class="pro-badge inactive">Inactive</span>');

    return `
        <div class="account-card vertex-card ${isSelected ? 'selected' : ''}" data-id="${credential.id}" onclick="showCredentialDetail(${credential.id})" oncontextmenu="event.preventDefault(); showContextMenu(event, ${credential.id})">
            <div class="card-header">
                <div class="card-checkbox">
                    <input type="checkbox" class="checkbox-custom" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${credential.id}, this.checked)">
                </div>
                <div class="card-title">
                    <span class="card-email" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                    ${statusBadge}
                </div>
            </div>
            <div class="card-usage">
                <div class="usage-header">
                    <span class="usage-label">Project</span>
                    <span class="usage-value">${escapeHtml(credential.projectId || '-')}</span>
                </div>
                <div class="usage-details">
                    <span class="usage-used">Region: ${escapeHtml(credential.region || 'global')}</span>
                    <span class="usage-remaining">Usage: ${credential.useCount || 0}</span>
                </div>
            </div>
            <div class="card-footer">
                <span class="card-date">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${formatDateShort(credential.createdAt)}
                </span>
                <div class="card-actions">
                    <button class="action-btn ${credential.isActive ? 'active' : ''}" title="${credential.isActive ? 'Active' : 'Set Active'}" onclick="event.stopPropagation(); toggleActiveCredential(${credential.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </button>
                    <button class="action-btn" title="Test" onclick="event.stopPropagation(); testCredential(${credential.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                    </button>
                    <button class="action-btn danger" title="Delete" onclick="event.stopPropagation(); deleteCredential(${credential.id})">
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

// Toggle select
function toggleSelect(id, checked) {
    if (checked) {
        selectedIds.add(id);
    } else {
        selectedIds.delete(id);
    }
    updateBatchButtons();
    updateSelectAllCheckbox();
}

// Update select all checkbox state
function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedIds.size > 0 && selectedIds.size === credentials.length;
        selectAllCheckbox.indeterminate = selectedIds.size > 0 && selectedIds.size < credentials.length;
    }
}

// Format date short
function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Setup event listeners
function setupEventListeners() {
    // Search
    document.getElementById('search-input')?.addEventListener('input', () => {
        renderCards();
    });

    // Add account button
    document.getElementById('add-account-btn')?.addEventListener('click', showAddModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', showAddModal);

    // Import JSON button
    document.getElementById('import-json-btn')?.addEventListener('click', showImportModal);

    // Add modal
    document.getElementById('modal-close')?.addEventListener('click', hideAddModal);
    document.getElementById('modal-cancel')?.addEventListener('click', hideAddModal);
    document.getElementById('modal-submit')?.addEventListener('click', submitAddForm);

    // Import modal
    document.getElementById('import-modal-close')?.addEventListener('click', hideImportModal);
    document.getElementById('import-modal-cancel')?.addEventListener('click', hideImportModal);
    document.getElementById('import-modal-submit')?.addEventListener('click', submitImportForm);

    // Edit modal
    document.getElementById('edit-modal-close')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-cancel')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-submit')?.addEventListener('click', submitEditForm);
    document.getElementById('edit-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'edit-modal') closeEditModal();
    });

    // Select all
    document.getElementById('select-all')?.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            credentials.forEach(c => selectedIds.add(c.id));
        } else {
            selectedIds.clear();
        }
        renderCards();
        updateBatchButtons();
    });

    // Batch delete
    document.getElementById('batch-delete-btn')?.addEventListener('click', batchDelete);

    // Context menu
    document.addEventListener('click', hideContextMenu);

    // Context menu items
    document.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            handleContextAction(action, currentContextId);
            hideContextMenu();
        });
    });

    // Close modal when clicking outside
    document.getElementById('add-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'add-modal') hideAddModal();
    });
    document.getElementById('import-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'import-modal') hideImportModal();
    });
}

// Show add modal
function showAddModal() {
    currentEditId = null;
    document.getElementById('add-modal').classList.add('active');
    document.getElementById('account-name').value = '';
    document.getElementById('project-id').value = '';
    document.getElementById('client-email').value = '';
    document.getElementById('private-key').value = '';
    document.getElementById('private-key').placeholder = '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----';
    document.getElementById('region').value = 'global';

    // Reset modal title and button
    const modalTitle = document.querySelector('#add-modal .modal-title');
    if (modalTitle) modalTitle.textContent = 'Add Vertex AI Account';

    const submitBtn = document.getElementById('modal-submit');
    submitBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
        </svg>
        Add Account
    `;
}

// Hide add modal
function hideAddModal() {
    document.getElementById('add-modal').classList.remove('active');
    resetAddModal();
}

// Submit add form (handles both add and edit)
async function submitAddForm() {
    // If in edit mode
    if (currentEditId) {
        await submitEditForm(currentEditId);
        return;
    }

    const name = document.getElementById('account-name').value.trim();
    const projectId = document.getElementById('project-id').value.trim();
    const clientEmail = document.getElementById('client-email').value.trim();
    const privateKey = document.getElementById('private-key').value.trim();
    const region = document.getElementById('region').value;

    if (!name || !projectId || !clientEmail || !privateKey) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        const response = await fetch('/api/vertex/credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, projectId, clientEmail, privateKey, region })
        });

        const result = await response.json();
        if (response.ok) {
            showToast('Account added successfully', 'success');
            hideAddModal();
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast(result.error || 'Failed to add', 'error');
        }
    } catch (error) {
        showToast('Failed to add: ' + error.message, 'error');
    }
}

// Show import modal
function showImportModal() {
    document.getElementById('import-modal').classList.add('active');
    document.getElementById('import-name').value = '';
    document.getElementById('import-region').value = 'global';
    document.getElementById('import-json').value = '';
    parsedJsonData = null;

    // Reset region selector
    document.querySelectorAll('#import-region-selector .region-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.value === 'global') {
            opt.classList.add('selected');
        }
    });

    // Hide preview
    document.getElementById('import-preview')?.classList.remove('show');
}

// Hide import modal
function hideImportModal() {
    document.getElementById('import-modal').classList.remove('active');
    parsedJsonData = null;
}

// Submit import form
async function submitImportForm() {
    const nameInput = document.getElementById('import-name');
    const region = document.getElementById('import-region').value;
    const jsonStr = document.getElementById('import-json').value.trim();

    // Try to parse JSON
    let keyJson;
    try {
        keyJson = JSON.parse(jsonStr);
    } catch (e) {
        showToast('Invalid JSON format', 'error');
        return;
    }

    // If name is empty, use project_id
    let name = nameInput.value.trim();
    if (!name && keyJson.project_id) {
        name = keyJson.project_id;
    }

    if (!name) {
        showToast('Please enter account name', 'error');
        return;
    }

    try {
        const response = await fetch('/api/vertex/credentials/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, region, keyJson })
        });

        const result = await response.json();
        if (response.ok) {
            showToast('Import successful', 'success');
            hideImportModal();
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast(result.error || 'Import failed', 'error');
        }
    } catch (error) {
        showToast('Import failed: ' + error.message, 'error');
    }
}

// Setup drag and drop upload zone
function setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const jsonTextarea = document.getElementById('import-json');

    if (!dropZone || !fileInput) return;

    // Click to upload
    dropZone.addEventListener('click', () => fileInput.click());

    // File selection
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    // Drag events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // Parse when JSON textarea changes
    jsonTextarea?.addEventListener('input', debounce(() => {
        parseJsonContent(jsonTextarea.value);
    }, 500));
}

// Handle uploaded file
function handleFile(file) {
    if (!file.name.endsWith('.json')) {
        showToast('Please upload a JSON file', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        document.getElementById('import-json').value = content;
        parseJsonContent(content);
    };
    reader.onerror = () => {
        showToast('Failed to read file', 'error');
    };
    reader.readAsText(file);
}

// Parse JSON content
function parseJsonContent(content) {
    const preview = document.getElementById('import-preview');
    const previewProject = document.getElementById('preview-project');
    const previewEmail = document.getElementById('preview-email');
    const nameInput = document.getElementById('import-name');

    if (!content.trim()) {
        preview?.classList.remove('show');
        parsedJsonData = null;
        return;
    }

    try {
        const json = JSON.parse(content);

        // Validate required fields
        if (!json.project_id || !json.client_email || !json.private_key) {
            preview?.classList.remove('show');
            parsedJsonData = null;
            return;
        }

        parsedJsonData = json;

        // Show preview
        if (previewProject) previewProject.textContent = json.project_id;
        if (previewEmail) previewEmail.textContent = json.client_email;
        preview?.classList.add('show');

        // Auto-fill name (if empty)
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = json.project_id;
        }
    } catch (e) {
        preview?.classList.remove('show');
        parsedJsonData = null;
    }
}

// Setup region selector
function setupRegionSelector() {
    const selector = document.getElementById('import-region-selector');
    const hiddenInput = document.getElementById('import-region');

    if (!selector) return;

    selector.querySelectorAll('.region-option').forEach(option => {
        option.addEventListener('click', () => {
            // Remove other selected states
            selector.querySelectorAll('.region-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            // Add selected state
            option.classList.add('selected');
            // Update hidden input
            if (hiddenInput) {
                hiddenInput.value = option.dataset.value;
            }
        });
    });
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Show context menu
function showContextMenu(e, id) {
    currentContextId = id;
    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';

    const x = e.clientX || e.pageX;
    const y = e.clientY || e.pageY;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Ensure menu doesn't exceed viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${y - rect.height}px`;
    }
}

// Hide context menu
function hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
    currentContextId = null;
}

// Handle context menu action
async function handleContextAction(action, id) {
    switch (action) {
        case 'activate':
            await toggleActiveCredential(id);
            break;
        case 'test':
            await testCredential(id);
            break;
        case 'edit':
            showEditModal(id);
            break;
        case 'delete':
            await deleteCredential(id);
            break;
    }
}

// Toggle credential active status
async function toggleActiveCredential(id) {
    try {
        const response = await fetch(`/api/vertex/credentials/${id}/toggle-active`, {
            method: 'POST'
        });
        const result = await response.json();
        if (result.success) {
            const statusText = result.data.isActive ? 'enabled' : 'disabled';
            showToast('Account ' + statusText, 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast(result.error || 'Operation failed', 'error');
        }
    } catch (error) {
        showToast('Operation failed: ' + error.message, 'error');
    }
}

// Test credential
async function testCredential(id) {
    showToast('Testing connection...', 'info');
    try {
        const response = await fetch(`/api/vertex/credentials/${id}/test`, {
            method: 'POST'
        });
        const result = await response.json();
        if (response.ok) {
            showToast('Connection test successful', 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast('Test failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Test failed: ' + error.message, 'error');
    }
}

// Show credential detail
let currentDetailId = null;

function showCredentialDetail(id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    currentDetailId = id;
    const body = document.getElementById('detail-modal-body');

    // Format private key display
    const formatPrivateKey = (key) => {
        if (!key) return '-';
        return 'Available (hidden)';
    };

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
                <span class="detail-label">Status</span>
                <span class="detail-value">${cred.isActive ? '<span class="status-badge success">Active</span>' : '<span class="status-badge">Inactive</span>'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Project ID</span>
                <span class="detail-value monospace">${escapeHtml(cred.projectId || '-')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Client Email</span>
                <span class="detail-value monospace">${escapeHtml(cred.clientEmail || '-')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Private Key</span>
                <span class="detail-value">${formatPrivateKey(cred.privateKey)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Region</span>
                <span class="detail-value">${escapeHtml(cred.region || 'global')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Error Count</span>
                <span class="detail-value">${cred.errorCount || 0}</span>
            </div>
            ${cred.lastError ? `
            <div class="detail-row">
                <span class="detail-label">Last Error</span>
                <span class="detail-value" style="color: var(--error-color);">${escapeHtml(cred.lastError)}</span>
            </div>
            ` : ''}
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

    // Setup edit button
    const editBtn = document.getElementById('detail-edit-btn');
    if (editBtn) {
        editBtn.onclick = function() {
            const id = currentDetailId;
            closeDetailModal();
            showEditModal(id);
        };
    }

    document.getElementById('detail-modal').classList.add('active');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('active');
    currentDetailId = null;
}

// Open edit modal
function openEditModal(id) {
    const credential = credentials.find(c => c.id === id);
    if (!credential) return;

    document.getElementById('edit-account-id').value = credential.id;
    document.getElementById('edit-account-name').value = credential.name || '';
    document.getElementById('edit-project-id').value = credential.projectId || '';
    document.getElementById('edit-account-region').value = credential.region || 'us-central1';
    document.getElementById('edit-is-active').checked = credential.isActive;

    document.getElementById('edit-modal').classList.add('active');
}

// Close edit modal
function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

// Submit edit form
async function submitEditForm() {
    const id = parseInt(document.getElementById('edit-account-id').value);
    const name = document.getElementById('edit-account-name').value.trim();
    const projectId = document.getElementById('edit-project-id').value.trim();
    const region = document.getElementById('edit-account-region').value;
    const isActive = document.getElementById('edit-is-active').checked;

    if (!name) {
        showToast('Name is required', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/vertex/credentials/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ name, projectId, region, isActive })
        });

        const result = await response.json();
        if (result.success) {
            showToast('Account updated successfully', 'success');
            closeEditModal();
            await loadCredentials();
        } else {
            showToast('Update failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Update failed: ' + error.message, 'error');
    }
}

// Show edit modal (legacy - redirects to new edit modal)
function showEditModal(id) {
    openEditModal(id);
}

// Reset add modal
function resetAddModal() {
    currentEditId = null;
    const modalTitle = document.querySelector('#add-modal .modal-title');
    if (modalTitle) modalTitle.textContent = 'Add Vertex AI Account';

    const submitBtn = document.getElementById('modal-submit');
    submitBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
        </svg>
        Add Account
    `;
    document.getElementById('private-key').placeholder = '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----';
}

// Submit edit form
async function submitEditForm(id) {
    const name = document.getElementById('account-name').value.trim();
    const projectId = document.getElementById('project-id').value.trim();
    const clientEmail = document.getElementById('client-email').value.trim();
    const privateKey = document.getElementById('private-key').value.trim();
    const region = document.getElementById('region').value;

    if (!name) {
        showToast('Please enter account name', 'error');
        return;
    }

    const data = { name, projectId, clientEmail, region };
    if (privateKey) {
        data.privateKey = privateKey;
    }

    try {
        const response = await fetch(`/api/vertex/credentials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (response.ok) {
            showToast('Changes saved successfully', 'success');
            hideAddModal();
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast(result.error || 'Failed to save changes', 'error');
        }
    } catch (error) {
        showToast('Failed to save changes: ' + error.message, 'error');
    }
}

// Delete credential
async function deleteCredential(id) {
    if (!confirm('Are you sure you want to delete this credential?')) return;

    try {
        const response = await fetch(`/api/vertex/credentials/${id}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            showToast('Deleted successfully', 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            const result = await response.json();
            showToast(result.error || 'Failed to delete', 'error');
        }
    } catch (error) {
        showToast('Failed to delete: ' + error.message, 'error');
    }
}

// Batch delete
async function batchDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete the selected ${selectedIds.size} credentials?`)) return;

    let success = 0;
    let failed = 0;
    for (const id of selectedIds) {
        try {
            const response = await fetch(`/api/vertex/credentials/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                success++;
            } else {
                failed++;
            }
        } catch {
            failed++;
        }
    }

    selectedIds.clear();
    updateBatchButtons();
    await loadCredentials();
    await loadStatistics();

    showToast(`Deletion complete: ${success} succeeded, ${failed} failed`, success > 0 ? 'success' : 'error');
}

// Update batch operation buttons
function updateBatchButtons() {
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    if (batchDeleteBtn) {
        batchDeleteBtn.style.display = selectedIds.size > 0 ? 'flex' : 'none';
    }
}

// Utility functions
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
