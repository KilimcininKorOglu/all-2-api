/**
 * Strategy Factory for Account Selection
 * Creates strategy instances based on configuration
 */
import { HybridStrategy } from './hybrid-strategy.js';
import { StickyStrategy } from './sticky-strategy.js';
import { RoundRobinStrategy } from './round-robin-strategy.js';

export class StrategyFactory {
    static STRATEGIES = {
        hybrid: HybridStrategy,
        sticky: StickyStrategy,
        'round-robin': RoundRobinStrategy
    };

    /**
     * Create a strategy instance
     * @param {string} provider - Provider name (kiro, gemini, etc.)
     * @param {Object} config - Configuration object
     * @returns {Promise<BaseStrategy>} Strategy instance
     */
    static async create(provider, config = {}) {
        // Load configuration from database if configStore provided
        let dbConfig = {};
        if (config.configStore) {
            try {
                dbConfig = await config.configStore.getByProvider(provider) || {};
            } catch (error) {
                console.log(`[StrategyFactory] Failed to load config for ${provider}: ${error.message}`);
            }
        }

        // Merge configurations: defaults -> db config -> passed config
        const mergedConfig = {
            // Default configuration
            strategy: 'hybrid',
            healthWeight: 2,
            tokenWeight: 5,
            quotaWeight: 3,
            lruWeight: 0.1,
            minHealthThreshold: 50,
            tokenBucketMax: 50,
            tokenRegenPerMinute: 6,
            quotaLowThreshold: 0.10,
            quotaCriticalThreshold: 0.05,
            // Database configuration
            ...dbConfig,
            // Passed configuration (highest priority)
            ...config
        };

        const strategyName = mergedConfig.strategy || 'hybrid';
        const StrategyClass = StrategyFactory.STRATEGIES[strategyName];

        if (!StrategyClass) {
            console.warn(`[StrategyFactory] Unknown strategy '${strategyName}', falling back to hybrid`);
            return new HybridStrategy(mergedConfig);
        }

        return new StrategyClass(mergedConfig);
    }

    /**
     * Get available strategy names
     * @returns {string[]}
     */
    static getAvailableStrategies() {
        return Object.keys(StrategyFactory.STRATEGIES);
    }

    /**
     * Check if a strategy exists
     * @param {string} name - Strategy name
     * @returns {boolean}
     */
    static hasStrategy(name) {
        return name in StrategyFactory.STRATEGIES;
    }

    /**
     * Register a custom strategy
     * @param {string} name - Strategy name
     * @param {Function} strategyClass - Strategy class (must extend BaseStrategy)
     */
    static registerStrategy(name, strategyClass) {
        StrategyFactory.STRATEGIES[name] = strategyClass;
    }
}

/**
 * Strategy Manager - Singleton for managing strategy instances
 * Caches strategy instances per provider
 */
export class StrategyManager {
    constructor() {
        this.strategies = new Map();
        this.stores = null;
    }

    /**
     * Initialize the manager with stores
     * @param {Object} stores - Store instances
     */
    initialize(stores) {
        this.stores = stores;
    }

    /**
     * Get or create a strategy for a provider
     * @param {string} provider - Provider name
     * @param {Object} extraConfig - Extra configuration
     * @returns {Promise<BaseStrategy>}
     */
    async getStrategy(provider, extraConfig = {}) {
        const cacheKey = provider;

        // Check cache
        if (this.strategies.has(cacheKey)) {
            return this.strategies.get(cacheKey);
        }

        // Create new strategy
        const config = {
            ...this.stores,
            ...extraConfig
        };

        const strategy = await StrategyFactory.create(provider, config);
        this.strategies.set(cacheKey, strategy);

        return strategy;
    }

    /**
     * Invalidate cached strategy for a provider
     * @param {string} provider - Provider name
     */
    invalidate(provider) {
        this.strategies.delete(provider);
    }

    /**
     * Invalidate all cached strategies
     */
    invalidateAll() {
        this.strategies.clear();
    }

    /**
     * Get all cached strategies
     * @returns {Map<string, BaseStrategy>}
     */
    getCachedStrategies() {
        return this.strategies;
    }
}

// Singleton instance
let managerInstance = null;

/**
 * Get the singleton StrategyManager instance
 * @returns {StrategyManager}
 */
export function getStrategyManager() {
    if (!managerInstance) {
        managerInstance = new StrategyManager();
    }
    return managerInstance;
}

export default StrategyFactory;
