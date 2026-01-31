/**
 * Token Bucket Rate Limiter for Account Selection
 * Client-side rate limiting with automatic token regeneration
 */
export class TokenBucket {
    static CONFIG = {
        maxTokens: 50,
        regenPerMinute: 6
    };

    constructor(store, config = {}) {
        this.store = store;
        this.maxTokens = config.maxTokens ?? TokenBucket.CONFIG.maxTokens;
        this.regenPerMinute = config.regenPerMinute ?? TokenBucket.CONFIG.regenPerMinute;
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
     * Get current token count with regeneration applied
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @returns {Promise<number>} Current token count
     */
    async getTokens(provider, credentialId) {
        const cacheKey = this.getCacheKey(provider, credentialId);

        // Check cache first
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return this.calculateTokens(cached.tokens, cached.lastUpdated);
        }

        // Get from store with regeneration
        const tokens = await this.store.getTokens(
            provider,
            credentialId,
            this.maxTokens,
            this.regenPerMinute
        );

        // Update cache
        this.cache.set(cacheKey, {
            tokens,
            lastUpdated: Date.now()
        });

        return tokens;
    }

    /**
     * Calculate tokens with regeneration
     */
    calculateTokens(baseTokens, lastUpdated) {
        const now = Date.now();
        const minutesElapsed = (now - lastUpdated) / 60000;
        const regenerated = minutesElapsed * this.regenPerMinute;
        return Math.min(this.maxTokens, baseTokens + regenerated);
    }

    /**
     * Check if credential has available tokens
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @returns {Promise<boolean>}
     */
    async hasTokens(provider, credentialId) {
        const tokens = await this.getTokens(provider, credentialId);
        return tokens >= 1;
    }

    /**
     * Consume a token from the bucket
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @param {number} amount - Amount to consume (default 1)
     * @returns {Promise<{success: boolean, tokens: number}>}
     */
    async consume(provider, credentialId, amount = 1) {
        const result = await this.store.consume(
            provider,
            credentialId,
            amount,
            this.maxTokens,
            this.regenPerMinute
        );

        // Update cache
        const cacheKey = this.getCacheKey(provider, credentialId);
        this.cache.set(cacheKey, {
            tokens: result.tokens,
            lastUpdated: Date.now()
        });

        return result;
    }

    /**
     * Refund a token to the bucket (e.g., on failure before actual request)
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @param {number} amount - Amount to refund (default 1)
     * @returns {Promise<number>} New token count
     */
    async refund(provider, credentialId, amount = 1) {
        const newTokens = await this.store.refund(
            provider,
            credentialId,
            amount,
            this.maxTokens
        );

        // Update cache
        const cacheKey = this.getCacheKey(provider, credentialId);
        this.cache.set(cacheKey, {
            tokens: newTokens,
            lastUpdated: Date.now()
        });

        return newTokens;
    }

    /**
     * Get token counts for all credentials of a provider
     * @param {string} provider - Provider name
     * @returns {Promise<Map<number, number>>} Map of credentialId -> tokenCount
     */
    async getTokensByProvider(provider) {
        const records = await this.store.getByProvider(provider);
        const tokens = new Map();

        for (const record of records) {
            const currentTokens = this.calculateTokens(record.tokens, new Date(record.lastUpdated).getTime());
            tokens.set(record.credentialId, currentTokens);
        }

        return tokens;
    }

    /**
     * Calculate time until next token regenerates
     * @param {number} currentTokens - Current token count
     * @returns {number} Milliseconds until next token
     */
    getTimeUntilNextToken(currentTokens) {
        if (currentTokens >= 1) return 0;
        const tokensNeeded = 1 - currentTokens;
        const minutesNeeded = tokensNeeded / this.regenPerMinute;
        return Math.ceil(minutesNeeded * 60000);
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

export default TokenBucket;
