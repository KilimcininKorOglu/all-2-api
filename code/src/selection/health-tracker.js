/**
 * Health Tracker for Account Selection
 * Manages health scores with passive recovery
 */
export class HealthTracker {
    static CONFIG = {
        initialScore: 70,
        maxScore: 100,
        minUsable: 50,
        successBonus: 1,
        rateLimitPenalty: 10,
        failurePenalty: 20,
        recoveryPerHour: 10
    };

    constructor(store) {
        this.store = store;
        // In-memory cache for fast reads
        this.cache = new Map();
    }

    /**
     * Get cache key
     */
    getCacheKey(provider, credentialId) {
        return `${provider}:${credentialId}`;
    }

    /**
     * Get health score with passive recovery applied
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @returns {Promise<number>} Health score (0-100)
     */
    async getScore(provider, credentialId) {
        const cacheKey = this.getCacheKey(provider, credentialId);

        // Try cache first
        const cached = this.cache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < 60000) {
            return this.applyRecovery(cached.score, cached.lastFailureAt);
        }

        // Get from database
        const record = await this.store.get(provider, credentialId);
        if (!record) {
            return HealthTracker.CONFIG.initialScore;
        }

        // Apply passive recovery
        const score = this.applyRecovery(record.healthScore, record.lastFailureAt);

        // Update cache
        this.cache.set(cacheKey, {
            score: record.healthScore,
            lastFailureAt: record.lastFailureAt,
            timestamp: Date.now()
        });

        return score;
    }

    /**
     * Apply passive recovery based on time since last failure
     * @param {number} baseScore - Base health score
     * @param {Date|string|null} lastFailureAt - Last failure timestamp
     * @returns {number} Recovered health score
     */
    applyRecovery(baseScore, lastFailureAt) {
        if (!lastFailureAt) return baseScore;

        const lastFailure = new Date(lastFailureAt).getTime();
        const hoursSinceFailure = (Date.now() - lastFailure) / (60 * 60 * 1000);
        const recoveredPoints = Math.floor(hoursSinceFailure * HealthTracker.CONFIG.recoveryPerHour);

        return Math.min(HealthTracker.CONFIG.maxScore, baseScore + recoveredPoints);
    }

    /**
     * Record a successful request
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     */
    async recordSuccess(provider, credentialId) {
        await this.store.recordSuccess(provider, credentialId, HealthTracker.CONFIG.successBonus);

        // Invalidate cache
        this.cache.delete(this.getCacheKey(provider, credentialId));
    }

    /**
     * Record a rate limit error
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     */
    async recordRateLimit(provider, credentialId) {
        await this.store.recordRateLimit(provider, credentialId, HealthTracker.CONFIG.rateLimitPenalty);

        // Invalidate cache
        this.cache.delete(this.getCacheKey(provider, credentialId));
    }

    /**
     * Record a failure
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @param {string} errorMessage - Error message
     */
    async recordFailure(provider, credentialId, errorMessage) {
        await this.store.recordFailure(provider, credentialId, errorMessage, HealthTracker.CONFIG.failurePenalty);

        // Invalidate cache
        this.cache.delete(this.getCacheKey(provider, credentialId));
    }

    /**
     * Check if a credential is usable based on health score
     * @param {number} score - Health score
     * @returns {boolean}
     */
    isUsable(score) {
        return score >= HealthTracker.CONFIG.minUsable;
    }

    /**
     * Get health scores for all credentials of a provider
     * @param {string} provider - Provider name
     * @returns {Promise<Map<number, number>>} Map of credentialId -> healthScore
     */
    async getScoresByProvider(provider) {
        const records = await this.store.getByProvider(provider);
        const scores = new Map();

        for (const record of records) {
            const score = this.applyRecovery(record.healthScore, record.lastFailureAt);
            scores.set(record.credentialId, score);
        }

        return scores;
    }

    /**
     * Clear cache for a provider
     * @param {string} provider - Provider name
     */
    clearCache(provider) {
        for (const key of this.cache.keys()) {
            if (key.startsWith(`${provider}:`)) {
                this.cache.delete(key);
            }
        }
    }
}

export default HealthTracker;
