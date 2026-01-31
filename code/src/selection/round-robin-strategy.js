/**
 * Round-Robin Strategy for Account Selection
 * Sequential rotation through available credentials
 * with health and token checks
 */
import { BaseStrategy } from './base-strategy.js';
import { HealthTracker } from './health-tracker.js';
import { TokenBucket } from './token-bucket.js';

export class RoundRobinStrategy extends BaseStrategy {
    constructor(config = {}) {
        super(config);

        // Initialize trackers
        this.healthTracker = new HealthTracker(config.healthStore);
        this.tokenBucket = new TokenBucket(config.tokenStore, {
            maxTokens: config.tokenBucketMax ?? 50,
            regenPerMinute: config.tokenRegenPerMinute ?? 6
        });

        this.minHealthThreshold = config.minHealthThreshold ?? 50;

        // Round-robin index per provider
        this.providerIndex = new Map();
    }

    /**
     * Select credential using round-robin rotation
     */
    async select(credentials, context = {}) {
        if (!credentials || credentials.length === 0) {
            return { credential: null, waitMs: 0 };
        }

        const provider = context.provider || 'unknown';
        const excludeIds = context.excludeIds || [];

        // Filter usable credentials
        const available = credentials.filter(c =>
            this.isUsable(c) && !excludeIds.includes(c.id)
        );

        if (available.length === 0) {
            return { credential: null, waitMs: 0 };
        }

        // Sort by ID for consistent ordering
        available.sort((a, b) => a.id - b.id);

        // Get current index
        let currentIndex = this.providerIndex.get(provider) || 0;

        // Try each credential in round-robin order
        const startIndex = currentIndex;
        let attempts = 0;
        const maxAttempts = available.length;

        while (attempts < maxAttempts) {
            const index = currentIndex % available.length;
            const credential = available[index];

            // Check health and tokens
            const healthScore = await this.healthTracker.getScore(provider, credential.id);
            const hasTokens = await this.tokenBucket.hasTokens(provider, credential.id);

            if (healthScore >= this.minHealthThreshold && hasTokens) {
                // Found a valid credential
                await this.tokenBucket.consume(provider, credential.id);

                // Update index for next selection
                this.providerIndex.set(provider, (index + 1) % available.length);

                return {
                    credential,
                    waitMs: 0,
                    index
                };
            }

            currentIndex++;
            attempts++;
        }

        // No healthy credentials with tokens, fall back to any available
        // Use the original round-robin position
        const fallbackIndex = startIndex % available.length;
        const fallbackCredential = available[fallbackIndex];

        // Update index for next selection
        this.providerIndex.set(provider, (fallbackIndex + 1) % available.length);

        return {
            credential: fallbackCredential,
            waitMs: 0,
            index: fallbackIndex,
            fallback: true
        };
    }

    /**
     * Handle successful request
     */
    async onSuccess(provider, credentialId) {
        await this.healthTracker.recordSuccess(provider, credentialId);
    }

    /**
     * Handle failed request
     */
    async onFailure(provider, credentialId, errorType) {
        await this.healthTracker.recordFailure(provider, credentialId, errorType);
        await this.tokenBucket.refund(provider, credentialId);
    }

    /**
     * Handle rate limit
     */
    async onRateLimit(provider, credentialId, resetMs) {
        await this.healthTracker.recordRateLimit(provider, credentialId);
        await this.tokenBucket.refund(provider, credentialId);
    }

    /**
     * Reset the round-robin index for a provider
     */
    resetIndex(provider) {
        this.providerIndex.delete(provider);
    }

    /**
     * Get current index for a provider
     */
    getIndex(provider) {
        return this.providerIndex.get(provider) || 0;
    }

    /**
     * Set index for a provider (useful for testing)
     */
    setIndex(provider, index) {
        this.providerIndex.set(provider, index);
    }
}

export default RoundRobinStrategy;
