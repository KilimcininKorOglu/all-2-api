/**
 * Quota Tracker for Account Selection
 * Tracks and evaluates quota levels for credential selection
 */
export class QuotaTracker {
    static THRESHOLDS = {
        low: 0.10,      // 10% - Reserve when <= 10%
        critical: 0.05  // 5% - Exclude when <= 5%
    };

    constructor(config = {}) {
        this.lowThreshold = config.lowThreshold ?? QuotaTracker.THRESHOLDS.low;
        this.criticalThreshold = config.criticalThreshold ?? QuotaTracker.THRESHOLDS.critical;
    }

    /**
     * Get quota fraction for a credential and model
     * @param {Object} credential - Credential object with quota_data
     * @param {string} modelId - Model identifier
     * @returns {number|null} Remaining quota as fraction (0-1), null if unknown
     */
    getQuotaFraction(credential, modelId) {
        if (!credential) return null;

        // Check quota_data JSON field
        const quotaData = credential.quotaData || credential.quota_data;
        if (quotaData && typeof quotaData === 'object') {
            // Try exact model match
            if (quotaData[modelId] && quotaData[modelId].remainingFraction !== undefined) {
                return quotaData[modelId].remainingFraction;
            }

            // Try model family match (e.g., "claude-sonnet" matches "claude-sonnet-4")
            for (const [key, value] of Object.entries(quotaData)) {
                if (modelId && modelId.includes(key) && value.remainingFraction !== undefined) {
                    return value.remainingFraction;
                }
            }

            // Try default quota
            if (quotaData.default && quotaData.default.remainingFraction !== undefined) {
                return quotaData.default.remainingFraction;
            }
        }

        // For Warp credentials, check quota_limit and quota_used
        if (credential.quotaLimit !== undefined && credential.quotaUsed !== undefined) {
            if (credential.quotaLimit > 0) {
                return (credential.quotaLimit - credential.quotaUsed) / credential.quotaLimit;
            }
        }

        return null;
    }

    /**
     * Check if quota is low (below low threshold but above critical)
     * @param {number|null} fraction - Remaining quota fraction
     * @returns {boolean}
     */
    isLow(fraction) {
        if (fraction === null || fraction === undefined) return false;
        return fraction <= this.lowThreshold && fraction > this.criticalThreshold;
    }

    /**
     * Check if quota is critical (at or below critical threshold)
     * @param {number|null} fraction - Remaining quota fraction
     * @returns {boolean}
     */
    isCritical(fraction) {
        if (fraction === null || fraction === undefined) return false;
        return fraction <= this.criticalThreshold;
    }

    /**
     * Check if quota is healthy (above low threshold)
     * @param {number|null} fraction - Remaining quota fraction
     * @returns {boolean}
     */
    isHealthy(fraction) {
        if (fraction === null || fraction === undefined) return true; // Unknown is treated as healthy
        return fraction > this.lowThreshold;
    }

    /**
     * Calculate quota score for selection (0-100)
     * @param {number|null} fraction - Remaining quota fraction
     * @returns {number}
     */
    getScore(fraction) {
        if (fraction === null || fraction === undefined) {
            return 50; // Unknown quota gets middle score
        }
        return Math.round(fraction * 100);
    }

    /**
     * Get quota status string
     * @param {number|null} fraction - Remaining quota fraction
     * @returns {string} 'healthy' | 'low' | 'critical' | 'unknown'
     */
    getStatus(fraction) {
        if (fraction === null || fraction === undefined) return 'unknown';
        if (this.isCritical(fraction)) return 'critical';
        if (this.isLow(fraction)) return 'low';
        return 'healthy';
    }

    /**
     * Check if quota data is fresh
     * @param {Date|string|null} updatedAt - Last quota update timestamp
     * @param {number} staleMs - Staleness threshold in milliseconds (default 5 minutes)
     * @returns {boolean}
     */
    isFresh(updatedAt, staleMs = 5 * 60 * 1000) {
        if (!updatedAt) return false;
        const lastUpdate = new Date(updatedAt).getTime();
        return (Date.now() - lastUpdate) < staleMs;
    }

    /**
     * Filter credentials by quota status
     * @param {Array} credentials - List of credentials
     * @param {string} modelId - Model identifier
     * @param {string} minStatus - Minimum status ('healthy', 'low', 'critical')
     * @returns {Array} Filtered credentials
     */
    filterByStatus(credentials, modelId, minStatus = 'healthy') {
        const statusPriority = { healthy: 0, low: 1, critical: 2, unknown: 1 };
        const minPriority = statusPriority[minStatus] ?? 0;

        return credentials.filter(c => {
            const fraction = this.getQuotaFraction(c, modelId);
            const status = this.getStatus(fraction);
            return statusPriority[status] <= minPriority;
        });
    }

    /**
     * Sort credentials by quota (highest first)
     * @param {Array} credentials - List of credentials
     * @param {string} modelId - Model identifier
     * @returns {Array} Sorted credentials
     */
    sortByQuota(credentials, modelId) {
        return [...credentials].sort((a, b) => {
            const quotaA = this.getQuotaFraction(a, modelId) ?? 0.5;
            const quotaB = this.getQuotaFraction(b, modelId) ?? 0.5;
            return quotaB - quotaA;
        });
    }
}

export default QuotaTracker;
