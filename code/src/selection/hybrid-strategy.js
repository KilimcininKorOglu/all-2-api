/**
 * Hybrid Strategy for Account Selection
 * Combines health, token bucket, quota, and LRU scoring
 * with 5-level fallback cascade
 */
import { BaseStrategy } from './base-strategy.js';
import { HealthTracker } from './health-tracker.js';
import { TokenBucket } from './token-bucket.js';
import { QuotaTracker } from './quota-tracker.js';

export class HybridStrategy extends BaseStrategy {
    static FALLBACK_LEVELS = {
        normal: 0,        // Healthy + tokens + quota > critical
        lowQuota: 1,      // Healthy + tokens (allow low quota)
        critical: 2,      // Healthy + tokens (allow critical quota)
        emergency: 3,     // Bypass health check
        lastResort: 4     // Bypass health + token check
    };

    constructor(config = {}) {
        super(config);

        // Initialize trackers
        this.healthTracker = new HealthTracker(config.healthStore);
        this.tokenBucket = new TokenBucket(config.tokenStore, {
            maxTokens: config.tokenBucketMax ?? 50,
            regenPerMinute: config.tokenRegenPerMinute ?? 6
        });
        this.quotaTracker = new QuotaTracker({
            lowThreshold: config.quotaLowThreshold ?? 0.10,
            criticalThreshold: config.quotaCriticalThreshold ?? 0.05
        });

        // Scoring weights
        this.weights = {
            health: config.healthWeight ?? 2,
            tokens: config.tokenWeight ?? 5,
            quota: config.quotaWeight ?? 3,
            lru: config.lruWeight ?? 0.1
        };

        this.minHealthThreshold = config.minHealthThreshold ?? 50;

        // LRU tracking (in-memory)
        this.lastUsed = new Map();
    }

    /**
     * Select the best credential using scoring algorithm
     */
    async select(credentials, context = {}) {
        if (!credentials || credentials.length === 0) {
            return { credential: null, waitMs: 0 };
        }

        const provider = context.provider || 'unknown';
        const modelId = context.model || context.modelId;
        const excludeIds = context.excludeIds || [];

        // Filter usable credentials
        let available = credentials.filter(c =>
            this.isUsable(c) && !excludeIds.includes(c.id)
        );

        if (available.length === 0) {
            // Reset exclude list if all excluded
            available = credentials.filter(c => this.isUsable(c));
        }

        if (available.length === 0) {
            return { credential: null, waitMs: 0 };
        }

        // Try each fallback level
        for (let level = 0; level <= HybridStrategy.FALLBACK_LEVELS.lastResort; level++) {
            const result = await this.selectAtLevel(available, provider, modelId, level);
            if (result.credential) {
                // Consume token (unless last resort level)
                if (level !== HybridStrategy.FALLBACK_LEVELS.lastResort) {
                    await this.tokenBucket.consume(provider, result.credential.id);
                }

                // Update LRU
                this.lastUsed.set(result.credential.id, Date.now());

                return {
                    credential: result.credential,
                    waitMs: result.waitMs || 0,
                    fallbackLevel: level
                };
            }
        }

        return { credential: null, waitMs: 0 };
    }

    /**
     * Select at a specific fallback level
     */
    async selectAtLevel(credentials, provider, modelId, level) {
        const candidates = await this.getCandidatesAtLevel(credentials, provider, modelId, level);

        if (candidates.length === 0) {
            return { credential: null };
        }

        // Score and sort candidates
        const scored = await Promise.all(
            candidates.map(c => this.scoreCredential(c, provider, modelId, level))
        );
        scored.sort((a, b) => b.score - a.score);

        return { credential: scored[0].credential, waitMs: 0 };
    }

    /**
     * Get candidates at a specific fallback level
     */
    async getCandidatesAtLevel(credentials, provider, modelId, level) {
        const candidates = [];

        for (const credential of credentials) {
            const healthScore = await this.healthTracker.getScore(provider, credential.id);
            const hasTokens = await this.tokenBucket.hasTokens(provider, credential.id);
            const quotaFraction = this.quotaTracker.getQuotaFraction(credential, modelId);
            const quotaStatus = this.quotaTracker.getStatus(quotaFraction);

            const isHealthy = healthScore >= this.minHealthThreshold;
            const isCriticalQuota = quotaStatus === 'critical';
            const isLowQuota = quotaStatus === 'low';

            let include = false;

            switch (level) {
                case HybridStrategy.FALLBACK_LEVELS.normal:
                    // Healthy + tokens + quota not critical
                    include = isHealthy && hasTokens && !isCriticalQuota;
                    break;

                case HybridStrategy.FALLBACK_LEVELS.lowQuota:
                    // Healthy + tokens (allow low quota)
                    include = isHealthy && hasTokens && !isCriticalQuota;
                    if (!include && isHealthy && hasTokens && isLowQuota) {
                        include = true;
                    }
                    break;

                case HybridStrategy.FALLBACK_LEVELS.critical:
                    // Healthy + tokens (allow critical quota)
                    include = isHealthy && hasTokens;
                    break;

                case HybridStrategy.FALLBACK_LEVELS.emergency:
                    // Bypass health check (still need tokens)
                    include = hasTokens;
                    break;

                case HybridStrategy.FALLBACK_LEVELS.lastResort:
                    // Bypass all checks
                    include = true;
                    break;
            }

            if (include) {
                candidates.push({
                    credential,
                    healthScore,
                    hasTokens,
                    quotaFraction,
                    quotaStatus
                });
            }
        }

        return candidates;
    }

    /**
     * Calculate composite score for a credential
     */
    async scoreCredential(candidateData, provider, modelId, level) {
        const { credential, healthScore, quotaFraction } = candidateData;

        // Get token count for scoring
        const tokens = await this.tokenBucket.getTokens(provider, credential.id);

        // Normalize scores to 0-100
        const normalizedHealth = healthScore; // Already 0-100
        const normalizedTokens = (tokens / this.tokenBucket.maxTokens) * 100;
        const normalizedQuota = this.quotaTracker.getScore(quotaFraction);

        // LRU score (lower = more recently used = lower priority)
        const lastUsedTime = this.lastUsed.get(credential.id) || 0;
        const timeSinceUse = Date.now() - lastUsedTime;
        const normalizedLru = Math.min(100, timeSinceUse / 60000); // Max 100 after 100 minutes

        // Calculate weighted score
        // Score = (health * 2) + (tokens * 5) + (quota * 3) + (lru * 0.1)
        const score =
            (normalizedHealth * this.weights.health) +
            (normalizedTokens * this.weights.tokens) +
            (normalizedQuota * this.weights.quota) +
            (normalizedLru * this.weights.lru);

        return {
            credential,
            score,
            healthScore,
            tokens,
            quotaFraction,
            lastUsedTime
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
        // Refund the token since the request failed
        await this.tokenBucket.refund(provider, credentialId);
    }

    /**
     * Handle rate limit
     */
    async onRateLimit(provider, credentialId, resetMs) {
        await this.healthTracker.recordRateLimit(provider, credentialId);
        // Refund the token since we hit rate limit
        await this.tokenBucket.refund(provider, credentialId);
    }
}

export default HybridStrategy;
