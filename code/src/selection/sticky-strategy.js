/**
 * Sticky Strategy for Account Selection
 * Maintains session continuity by preferring previously used credentials
 * Falls back to hybrid selection when session credential is unavailable
 */
import { BaseStrategy } from './base-strategy.js';
import { HybridStrategy } from './hybrid-strategy.js';

export class StickyStrategy extends BaseStrategy {
    constructor(config = {}) {
        super(config);

        // Session to credential mapping
        this.sessionCredentials = new Map();

        // Fallback to hybrid strategy for new sessions
        this.hybridStrategy = new HybridStrategy(config);

        // Session TTL (default 30 minutes)
        this.sessionTtl = config.sessionTtl ?? 30 * 60 * 1000;

        // Cleanup interval
        this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 60000);
    }

    /**
     * Select credential with session affinity
     */
    async select(credentials, context = {}) {
        if (!credentials || credentials.length === 0) {
            return { credential: null, waitMs: 0 };
        }

        const sessionId = context.sessionId || context.conversationId;
        const provider = context.provider || 'unknown';
        const excludeIds = context.excludeIds || [];

        // Check for existing session binding
        if (sessionId) {
            const sessionKey = `${provider}:${sessionId}`;
            const sessionData = this.sessionCredentials.get(sessionKey);

            if (sessionData) {
                const { credentialId, timestamp } = sessionData;

                // Check if session is still valid
                if (Date.now() - timestamp < this.sessionTtl) {
                    // Find the bound credential
                    const boundCredential = credentials.find(c =>
                        c.id === credentialId &&
                        this.isUsable(c) &&
                        !excludeIds.includes(c.id)
                    );

                    if (boundCredential) {
                        // Verify credential is still healthy
                        const healthScore = await this.hybridStrategy.healthTracker.getScore(provider, credentialId);
                        const hasTokens = await this.hybridStrategy.tokenBucket.hasTokens(provider, credentialId);

                        if (healthScore >= this.hybridStrategy.minHealthThreshold && hasTokens) {
                            // Update session timestamp
                            this.sessionCredentials.set(sessionKey, {
                                credentialId,
                                timestamp: Date.now()
                            });

                            // Consume token
                            await this.hybridStrategy.tokenBucket.consume(provider, credentialId);

                            return {
                                credential: boundCredential,
                                waitMs: 0,
                                sticky: true
                            };
                        }
                    }

                    // Credential no longer available, remove session binding
                    this.sessionCredentials.delete(sessionKey);
                }
            }
        }

        // No valid session binding, use hybrid selection
        const result = await this.hybridStrategy.select(credentials, context);

        // Bind new credential to session
        if (sessionId && result.credential) {
            const sessionKey = `${provider}:${sessionId}`;
            this.sessionCredentials.set(sessionKey, {
                credentialId: result.credential.id,
                timestamp: Date.now()
            });
        }

        return {
            ...result,
            sticky: false
        };
    }

    /**
     * Handle successful request
     */
    async onSuccess(provider, credentialId) {
        await this.hybridStrategy.onSuccess(provider, credentialId);
    }

    /**
     * Handle failed request
     */
    async onFailure(provider, credentialId, errorType) {
        await this.hybridStrategy.onFailure(provider, credentialId, errorType);

        // Invalidate all sessions using this credential
        for (const [key, data] of this.sessionCredentials.entries()) {
            if (key.startsWith(`${provider}:`) && data.credentialId === credentialId) {
                this.sessionCredentials.delete(key);
            }
        }
    }

    /**
     * Handle rate limit
     */
    async onRateLimit(provider, credentialId, resetMs) {
        await this.hybridStrategy.onRateLimit(provider, credentialId, resetMs);
    }

    /**
     * Clean up stale sessions
     */
    cleanupStaleSessions() {
        const now = Date.now();
        for (const [key, data] of this.sessionCredentials.entries()) {
            if (now - data.timestamp > this.sessionTtl) {
                this.sessionCredentials.delete(key);
            }
        }
    }

    /**
     * Bind a session to a specific credential
     */
    bindSession(provider, sessionId, credentialId) {
        const sessionKey = `${provider}:${sessionId}`;
        this.sessionCredentials.set(sessionKey, {
            credentialId,
            timestamp: Date.now()
        });
    }

    /**
     * Unbind a session
     */
    unbindSession(provider, sessionId) {
        const sessionKey = `${provider}:${sessionId}`;
        this.sessionCredentials.delete(sessionKey);
    }

    /**
     * Get session binding
     */
    getSessionBinding(provider, sessionId) {
        const sessionKey = `${provider}:${sessionId}`;
        return this.sessionCredentials.get(sessionKey);
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.sessionCredentials.clear();
    }
}

export default StickyStrategy;
