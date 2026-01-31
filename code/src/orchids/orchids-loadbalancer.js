/**
 * Orchids Load Balancer
 * Based on orchids-api-main's loadbalancer.go implementation
 * Provides weighted random selection and failover functionality
 */
import { logger } from '../logger.js';

const log = logger.api;

// Account cache refresh interval (30 seconds)
const ACCOUNTS_CACHE_TTL = 30 * 1000;
// Request count batch update interval (10 seconds)
const COUNT_UPDATE_INTERVAL = 10 * 1000;

/**
 * Orchids Load Balancer class
 */
export class OrchidsLoadBalancer {
    constructor(store) {
        this.store = store;
        
        // Account cache
        this.accounts = [];
        this.lastRefresh = 0;

        // Async request count updates
        this.pendingUpdates = new Map();  // accountId -> requestCount
        this.pendingSuccess = new Map();  // accountId -> successCount
        this.pendingFailure = new Map();  // accountId -> failureCount

        // Accounts in use (prevent concurrent requests using same account)
        this.inUseAccounts = new Set();   // accountId set
        this.inUseTimeout = 120000;       // 120 second timeout auto release
        this.inUseTimers = new Map();     // accountId -> timeout timer

        // Timers
        this.refreshTimer = null;
        this.updateTimer = null;

        // Initialize
        this._init();
    }

    /**
     * Initialize load balancer
     */
    async _init() {
        // Immediately load account list
        await this.refreshAccounts();

        // Start background tasks
        this.refreshTimer = setInterval(() => this.refreshAccounts(), ACCOUNTS_CACHE_TTL);
        this.updateTimer = setInterval(() => this.flushPendingUpdates(), COUNT_UPDATE_INTERVAL);

        log.info(`[LoadBalancer] Started, account cache TTL=${ACCOUNTS_CACHE_TTL}ms, count update interval=${COUNT_UPDATE_INTERVAL}ms`);
    }

    /**
     * Close load balancer
     */
    async close() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        // Final flush of counts
        await this.flushPendingUpdates();
        log.info('[LoadBalancer] Closed');
    }

    /**
     * Refresh account cache
     */
    async refreshAccounts() {
        try {
            const accounts = await this.store.getEnabledAccounts();
            this.accounts = accounts;
            this.lastRefresh = Date.now();
            log.info(`[LoadBalancer] Account cache refreshed: ${accounts.length} available accounts`);
        } catch (error) {
            log.error(`[LoadBalancer] Failed to refresh accounts: ${error.message}`);
        }
    }

    /**
     * Force refresh account cache
     */
    async forceRefresh() {
        await this.refreshAccounts();
    }

    /**
     * Write pending request counts to database
     */
    async flushPendingUpdates() {
        if (this.pendingUpdates.size === 0 && 
            this.pendingSuccess.size === 0 && 
            this.pendingFailure.size === 0) {
            return;
        }

        // Copy and clear pending update queue
        const updates = new Map(this.pendingUpdates);
        const successUpdates = new Map(this.pendingSuccess);
        const failureUpdates = new Map(this.pendingFailure);
        this.pendingUpdates.clear();
        this.pendingSuccess.clear();
        this.pendingFailure.clear();

        // Update request counts
        for (const [accountId, count] of updates) {
            try {
                await this.store.addRequestCount(accountId, count);
            } catch (error) {
                log.error(`[LoadBalancer] Failed to update request count: accountId=${accountId}, count=${count}, err=${error.message}`);
            }
        }

        // Update success counts
        for (const [accountId, count] of successUpdates) {
            try {
                await this.store.addSuccessCount(accountId, count);
            } catch (error) {
                log.error(`[LoadBalancer] Failed to update success count: accountId=${accountId}, count=${count}, err=${error.message}`);
            }
        }

        // Update failure counts
        for (const [accountId, count] of failureUpdates) {
            try {
                await this.store.addFailureCount(accountId, count);
            } catch (error) {
                log.error(`[LoadBalancer] Failed to update failure count: accountId=${accountId}, count=${count}, err=${error.message}`);
            }
        }
    }

    /**
     * Schedule request count update (async)
     */
    scheduleCountUpdate(accountId) {
        const current = this.pendingUpdates.get(accountId) || 0;
        this.pendingUpdates.set(accountId, current + 1);
    }

    /**
     * Schedule success count update (async)
     */
    scheduleSuccessCount(accountId) {
        const current = this.pendingSuccess.get(accountId) || 0;
        this.pendingSuccess.set(accountId, current + 1);
    }

    /**
     * Schedule failure count update (async)
     */
    scheduleFailureCount(accountId) {
        const current = this.pendingFailure.get(accountId) || 0;
        this.pendingFailure.set(accountId, current + 1);
    }

    /**
     * Get cached account list (refresh if cache expired)
     */
    async getCachedAccounts() {
        // If cache is empty or expired, sync refresh
        if (this.accounts.length === 0 || Date.now() - this.lastRefresh > ACCOUNTS_CACHE_TTL * 2) {
            await this.refreshAccounts();
        }
        return this.accounts;
    }

    /**
     * Get next account
     */
    async getNextAccount() {
        return this.getNextAccountExcluding([]);
    }

    /**
     * Get next account (excluding specified accounts)
     * @param {number[]} excludeIds - List of account IDs to exclude
     */
    async getNextAccountExcluding(excludeIds = []) {
        // Get account list from cache
        let accounts = await this.getCachedAccounts();

        // Filter excluded accounts
        if (excludeIds.length > 0) {
            const excludeSet = new Set(excludeIds);
            accounts = accounts.filter(acc => !excludeSet.has(acc.id));
        }

        // Filter accounts in use (prevent concurrent requests using same account)
        const availableAccounts = accounts.filter(acc => !this.inUseAccounts.has(acc.id));

        if (availableAccounts.length === 0) {
            // If no available accounts, log warning and try to use excluded accounts
            if (accounts.length > 0) {
                console.warn(`[LoadBalancer] All ${accounts.length} accounts are in use, forcing reuse (may cause conflicts)`);
                const account = this._selectAccount(accounts);
                this.scheduleCountUpdate(account.id);
                this.lockAccount(account.id);
                return account;
            }
            console.error(`[LoadBalancer] No available accounts`);
            return null;
        }

        console.log(`[LoadBalancer] Selecting account | Available: ${availableAccounts.length}/${accounts.length} | Locked: ${this.inUseAccounts.size}`);

        // Select account
        const account = this._selectAccount(availableAccounts);

        // Async update request count (don't block request processing)
        this.scheduleCountUpdate(account.id);

        // Lock account
        this.lockAccount(account.id);

        return account;
    }
    
    /**
     * Lock account (mark as in use)
     */
    lockAccount(accountId) {
        this.inUseAccounts.add(accountId);

        // Set timeout for auto release (prevent permanent lock due to exceptions)
        if (this.inUseTimers.has(accountId)) {
            clearTimeout(this.inUseTimers.get(accountId));
        }
        const timer = setTimeout(() => {
            this.unlockAccount(accountId);
            console.warn(`[LoadBalancer] Account ${accountId} auto released (timeout)`);
        }, this.inUseTimeout);
        this.inUseTimers.set(accountId, timer);

        console.log(`[LoadBalancer] Locked account ${accountId} | Currently in use: ${this.inUseAccounts.size} | Locked: [${Array.from(this.inUseAccounts).join(', ')}]`);
    }
    
    /**
     * Unlock account (mark as available)
     */
    unlockAccount(accountId) {
        const wasLocked = this.inUseAccounts.has(accountId);
        this.inUseAccounts.delete(accountId);

        if (this.inUseTimers.has(accountId)) {
            clearTimeout(this.inUseTimers.get(accountId));
            this.inUseTimers.delete(accountId);
        }

        if (wasLocked) {
            console.log(`[LoadBalancer] Released account ${accountId} | Currently in use: ${this.inUseAccounts.size}`);
        }
    }

    /**
     * Select account using weighted random algorithm
     * @param {Array} accounts - Account list
     */
    _selectAccount(accounts) {
        if (accounts.length === 1) {
            return accounts[0];
        }

        // Build prefix sum array
        const prefixSum = [0];
        for (const acc of accounts) {
            prefixSum.push(prefixSum[prefixSum.length - 1] + (acc.weight || 1));
        }

        const totalWeight = prefixSum[prefixSum.length - 1];
        if (totalWeight === 0) {
            return accounts[0];
        }

        const randomWeight = Math.floor(Math.random() * totalWeight);

        // Binary search: find first i where prefixSum[i+1] > randomWeight
        let left = 0;
        let right = accounts.length - 1;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (prefixSum[mid + 1] > randomWeight) {
                right = mid;
            } else {
                left = mid + 1;
            }
        }

        return accounts[left];
    }

    /**
     * Mark account as active (called after successful request)
     */
    async markAccountActive(accountId) {
        try {
            await this.store.resetErrorCount(accountId);
        } catch (error) {
            log.warn(`[LoadBalancer] Failed to mark account as active: ${error.message}`);
        }
    }

    /**
     * Mark account as failed
     */
    async markAccountFailed(accountId, errorMessage) {
        try {
            await this.store.incrementErrorCount(accountId, errorMessage);
        } catch (error) {
            log.warn(`[LoadBalancer] Error marking account as failed: ${error.message}`);
        }
    }

    /**
     * Get account count
     */
    getAccountCount() {
        return this.accounts.length;
    }

    /**
     * Get all cached accounts
     */
    getAllAccounts() {
        return [...this.accounts];
    }
}

// Global load balancer instance
let globalLoadBalancer = null;

/**
 * Get global load balancer instance
 * @param {OrchidsCredentialStore} store - Credential store
 */
export async function getOrchidsLoadBalancer(store) {
    if (!globalLoadBalancer && store) {
        globalLoadBalancer = new OrchidsLoadBalancer(store);
        // Wait for initialization to complete
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return globalLoadBalancer;
}

/**
 * Close global load balancer
 */
export async function closeOrchidsLoadBalancer() {
    if (globalLoadBalancer) {
        await globalLoadBalancer.close();
        globalLoadBalancer = null;
    }
}

export default OrchidsLoadBalancer;
