// ============ Public Usage Query Page JS ============

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('query-form');
    const apiKeyInput = document.getElementById('api-key');
    const queryBtn = document.getElementById('query-btn');
    const errorMessage = document.getElementById('error-message');
    const resultsSection = document.getElementById('results-section');
    const loading = document.getElementById('loading');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const apiKey = apiKeyInput.value.trim();

        if (!apiKey) {
            showError('Please enter an API key');
            return;
        }

        if (!apiKey.startsWith('sk-')) {
            showError('Invalid API key format, should start with sk-');
            return;
        }

        await queryUsage(apiKey);
    });

    async function queryUsage(apiKey) {
        showLoading(true);
        hideError();
        resultsSection.classList.remove('active');

        try {
            const response = await fetch('/api/public/usage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ apiKey })
            });

            const result = await response.json();

            if (!result.success) {
                showError(result.error || 'Query failed');
                return;
            }

            displayResults(result.data);
        } catch (err) {
            showError('Query failed: ' + err.message);
        } finally {
            showLoading(false);
        }
    }

    function displayResults(data) {
        const { keyInfo, usage, cost, limits } = data;

        // Display key info
        document.getElementById('key-prefix').textContent = keyInfo.keyPrefix;
        const statusEl = document.getElementById('key-status');
        statusEl.textContent = keyInfo.isActive ? 'Enabled' : 'Disabled';
        statusEl.className = 'key-status ' + (keyInfo.isActive ? 'active' : 'inactive');

        // Display statistics
        document.getElementById('total-cost').textContent = '$' + cost.summary.totalCost.toFixed(4);
        document.getElementById('total-requests').textContent = formatNumber(cost.summary.totalRequests);
        document.getElementById('total-input-tokens').textContent = formatNumber(cost.summary.totalInputTokens);
        document.getElementById('total-output-tokens').textContent = formatNumber(cost.summary.totalOutputTokens);

        // Display by model statistics
        const modelStatsBody = document.getElementById('model-stats-body');
        if (cost.models && cost.models.length > 0) {
            modelStatsBody.innerHTML = cost.models.map(m => `
                <tr>
                    <td>${m.model || 'unknown'}</td>
                    <td>${formatNumber(m.requestCount)}</td>
                    <td class="token-value">${formatNumber(m.inputTokens)}</td>
                    <td class="token-value">${formatNumber(m.outputTokens)}</td>
                    <td class="cost-value">$${m.inputCost.toFixed(4)}</td>
                    <td class="cost-value">$${m.outputCost.toFixed(4)}</td>
                    <td class="cost-value">$${m.totalCost.toFixed(4)}</td>
                </tr>
            `).join('');
        } else {
            modelStatsBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No data</td></tr>';
        }

        // Display today/monthly usage
        const periodStatsBody = document.getElementById('period-stats-body');
        periodStatsBody.innerHTML = `
            <tr>
                <td>Today</td>
                <td>${formatNumber(usage.daily)}</td>
                <td class="cost-value">$${usage.dailyCost.toFixed(4)}</td>
            </tr>
            <tr>
       <td>This Month</td>
                <td>${formatNumber(usage.monthly)}</td>
                <td class="cost-value">$${usage.monthlyCost.toFixed(4)}</td>
            </tr>
            <tr>
                <td>Total</td>
                <td>${formatNumber(usage.total)}</td>
                <td class="cost-value">$${usage.totalCost.toFixed(4)}</td>
            </tr>
        `;

        // Display quota limits
        const limitsInfo = document.getElementById('limits-info');
        const limitsGrid = document.getElementById('limits-grid');

        if (limits && hasAnyLimit(limits)) {
            let limitsHtml = '';

            if (limits.dailyLimit > 0) {
                const percent = (usage.daily / limits.dailyLimit) * 100;
                limitsHtml += `
                    <div class="limit-item">
                        <span class="limit-label">Daily Requests</span>
                        <span class="limit-value ${percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : ''}">${usage.daily} / ${limits.dailyLimit}</span>
                    </div>
                `;
            }

            if (limits.monthlyLimit > 0) {
                const percent = (usage.monthly / limits.monthlyLimit) * 100;
                limitsHtml += `
                    <div class="limit-item">
                        <span class="limit-label">Monthly Requests</span>
                        <span class="limit-value ${percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : ''}">${usage.monthly} / ${limits.monthlyLimit}</span>
                    </div>
                `;
            }

            if (limits.totalLimit > 0) {
                const percent = (usage.total / limits.totalLimit) * 100;
                limitsHtml += `
                    <div class="limit-item">
                        <span class="limit-label">Total Requests</span>
                        <span class="limit-value ${percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : ''}">${usage.total} / ${limits.totalLimit}</span>
                    </div>
                `;
            }

            if (limits.dailyCostLimit > 0) {
                const percent = (usage.dailyCost / limits.dailyCostLimit) * 100;
                limitsHtml += `
                    <div class="limit-item">
                        <span class="limit-label">Daily Cost</span>
                        <span class="limit-value ${percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : ''}">$${usage.dailyCost.toFixed(2)} / $${limits.dailyCostLimit.toFixed(2)}</span>
                    </div>
                `;
            }

            if (limits.monthlyCostLimit > 0) {
                const percent = (usage.monthlyCost / limits.monthlyCostLimit) * 100;
                limitsHtml += `
                    <div class="limit-item">
                        <span class="limit-label">Monthly Cost</span>
                        <span class="limit-value ${percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : ''}">$${usage.monthlyCost.toFixed(2)} / $${limits.monthlyCostLimit.toFixed(2)}</span>
                    </div>
                `;
            }

            if (limits.totalCostLimit > 0) {
                const percent = (usage.totalCost / limits.totalCostLimit) * 100;
                limitsHtml += `
                    <div class="limit-item">
                        <span class="limit-label">Total Cost</span>
                        <span class="limit-value ${percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : ''}">$${usage.totalCost.toFixed(2)} / $${limits.totalCostLimit.toFixed(2)}</span>
                    </div>
                `;
            }

            if (limits.expiresInDays > 0 && limits.expireDate) {
                // Display original time string without timezone conversion
                let expireDateStr = limits.expireDate;
                // If ISO format (2026-01-21T14:40:20.000Z), convert to local format for display
                if (expireDateStr.includes('T')) {
                    expireDateStr = expireDateStr.replace('T', ' ').replace(/\.\d{3}Z$/, '');
                }
                // Format as YYYY/MM/DD HH:mm:ss
                expireDateStr = expireDateStr.replace(/-/g, '/');

                const expDate = new Date(limits.expireDate);
                const now = new Date();
                const isExpired = expDate < now;
                const remainingDays = limits.remainingDays !== null ? limits.remainingDays : 0;

                limitsHtml += `
                    <div class="limit-item">
                        <span class="limit-label">Expiration Time</span>
                        <span class="limit-value ${isExpired ? 'danger' : remainingDays <= 7 ? 'danger' : remainingDays <= 30 ? 'warning' : ''}">${isExpired ? 'Expired' : expireDateStr}</span>
                    </div>
                    <div class="limit-item">
                        <span class="limit-label">Remaining Days</span>
                        <span class="limit-value ${isExpired ? 'danger' : remainingDays <= 7 ? 'danger' : remainingDays <= 30 ? 'warning' : ''}">${isExpired ? '0' : remainingDays} days</span>
                    </div>
                `;
            }

            limitsGrid.innerHTML = limitsHtml;
            limitsInfo.style.display = 'block';
        } else {
            limitsInfo.style.display = 'none';
        }

        resultsSection.classList.add('active');
    }

    function hasAnyLimit(limits) {
        return limits.dailyLimit > 0 ||
               limits.monthlyLimit > 0 ||
               limits.totalLimit > 0 ||
               limits.dailyCostLimit > 0 ||
               limits.monthlyCostLimit > 0 ||
               limits.totalCostLimit > 0 ||
               limits.expiresInDays > 0;
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return num.toLocaleString();
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('active');
    }

    function hideError() {
        errorMessage.classList.remove('active');
    }

    function showLoading(show) {
        if (show) {
            loading.classList.add('active');
            queryBtn.disabled = true;
        } else {
            loading.classList.remove('active');
            queryBtn.disabled = false;
        }
    }
});
