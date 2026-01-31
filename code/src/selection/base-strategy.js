/**
 * Base Strategy Interface for Account Selection
 * All selection strategies should extend this class
 */
export class BaseStrategy {
    constructor(config = {}) {
        this.config = config;
        this.healthStore = config.healthStore;
        this.tokenStore = config.tokenStore;
        this.configStore = config.configStore;
    }

    /**
     * Select the best credential from the pool
     * @param {Array} credentials - List of available credentials
     * @param {Object} context - Selection context (provider, model, sessionId, etc.)
     * @returns {Promise<{credential: Object|null, waitMs: number}>}
     */
    async select(credentials, context = {}) {
        throw new Error('select() must be implemented by subclass');
    }

    /**
     * Called when a request succeeds with a credential
     * @param {string} provider - Provider name (kiro, gemini, etc.)
     * @param {number} credentialId - Credential ID
     */
    async onSuccess(provider, credentialId) {
        // Default: no-op, subclasses can override
    }

    /**
     * Called when a request fails with a credential
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @param {string} errorType - Type of error (api_error, auth_error, etc.)
     */
    async onFailure(provider, credentialId, errorType) {
        // Default: no-op, subclasses can override
    }

    /**
     * Called when a rate limit (429) is encountered
     * @param {string} provider - Provider name
     * @param {number} credentialId - Credential ID
     * @param {number} resetMs - Time until rate limit resets (milliseconds)
     */
    async onRateLimit(provider, credentialId, resetMs) {
        // Default: no-op, subclasses can override
    }

    /**
     * Check if a credential is usable (active and valid)
     * @param {Object} credential - Credential object
     * @returns {boolean}
     */
    isUsable(credential) {
        if (!credential) return false;
        // Check common usability criteria
        if (credential.isActive === false) return false;
        if (credential.isInvalid === true) return false;
        return true;
    }

    /**
     * Get strategy name
     * @returns {string}
     */
    getName() {
        return this.constructor.name;
    }
}

export default BaseStrategy;
