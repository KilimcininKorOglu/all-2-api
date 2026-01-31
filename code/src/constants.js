/**
 * Kiro API Constants Configuration
 */
export const KIRO_CONSTANTS = {
    // Token refresh endpoints
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    REFRESH_SSO_OIDC_URL: 'https://sso-oidc.{{region}}.amazonaws.com/token',

    // API endpoints
    BASE_URL: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
    AMAZON_Q_URL: 'https://codewhisperer.{{region}}.amazonaws.com/SendMessageStreaming',
    USAGE_LIMITS_URL: 'https://codewhisperer.{{region}}.amazonaws.com/getUsageLimits',
    LIST_MODELS_URL: 'https://codewhisperer.{{region}}.amazonaws.com/ListAvailableModels',

    // Default configuration
    DEFAULT_MODEL_NAME: 'claude-sonnet-4-20250514',
    DEFAULT_REGION: 'us-east-1',
    AXIOS_TIMEOUT: 300000, // 5 minute timeout

    // CodeWhisperer API actually supported regions
    CODEWHISPERER_SUPPORTED_REGIONS: [
        'us-east-1'  // Currently only us-east-1 is confirmed to work
    ],

    // Region mapping: map all regions to us-east-1 (the only confirmed working region)
    REGION_MAPPING: {
        'us-east-1': 'us-east-1',
        'us-west-1': 'us-east-1',  // Map to us-east-1
        'us-west-2': 'us-east-1',  // Map to us-east-1
        'eu-west-1': 'us-east-1'   // Map to us-east-1
    },

    // Request headers
    USER_AGENT: 'KiroIDE',
    KIRO_VERSION: '0.7.5',
    CONTENT_TYPE_JSON: 'application/json',
    ACCEPT_JSON: 'application/json',

    // Authentication methods
    AUTH_METHOD_SOCIAL: 'social',
    AUTH_METHOD_BUILDER_ID: 'builder-id',
    AUTH_METHOD_IDC: 'IdC',

    // Request parameters
    CHAT_TRIGGER_TYPE_MANUAL: 'MANUAL',
    ORIGIN_AI_EDITOR: 'AI_EDITOR',
};

/**
 * Get CodeWhisperer API supported region
 * If the user-selected region is not supported, return the mapped region
 * @param {string} userRegion - User-selected region
 * @returns {string} CodeWhisperer API supported region
 */
export function getCodeWhispererRegion(userRegion) {
    if (!userRegion) {
        return KIRO_CONSTANTS.DEFAULT_REGION;
    }

    // If directly supported, return original region
    if (KIRO_CONSTANTS.CODEWHISPERER_SUPPORTED_REGIONS.includes(userRegion)) {
        return userRegion;
    }

    // Use mapping table
    const mappedRegion = KIRO_CONSTANTS.REGION_MAPPING[userRegion];
    if (mappedRegion) {
        console.log(`[REGION] Mapping region: ${userRegion} -> ${mappedRegion}`);
        return mappedRegion;
    }

    // Fallback to default region
    console.warn(`[REGION] Unsupported region ${userRegion}, using default region ${KIRO_CONSTANTS.DEFAULT_REGION}`);
    return KIRO_CONSTANTS.DEFAULT_REGION;
}

/**
 * Build CodeWhisperer API URL
 * @param {string} baseUrl - Base URL template (containing {{region}} placeholder)
 * @param {string} userRegion - User-selected region
 * @returns {string} Complete API URL
 */
export function buildCodeWhispererUrl(baseUrl, userRegion) {
    const actualRegion = getCodeWhispererRegion(userRegion);
    return baseUrl.replace('{{region}}', actualRegion);
}
export const KIRO_MODELS = [
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-3-7-sonnet-20250219',
    'claude-opus-4-5-20251101',
    'claude-haiku-4-5'
];

/**
 * Model mapping table - maps model names to internal names used by Kiro API
 */
export const MODEL_MAPPING = {
    // Sonnet series (consistent with kiro2api)
    'claude-sonnet-4-5': 'CLAUDE_SONNET_4_5_20250929_V1_0',
    'claude-sonnet-4-5-20250929': 'CLAUDE_SONNET_4_5_20250929_V1_0',
    'claude-sonnet-4-20250514': 'CLAUDE_SONNET_4_20250514_V1_0',
    'claude-3-7-sonnet-20250219': 'CLAUDE_3_7_SONNET_20250219_V1_0',
    // Haiku series (consistent with kiro2api, using auto)
    'claude-3-5-haiku-20241022': 'auto',
    'claude-haiku-4-5-20251001': 'auto',
    'claude-haiku-4-5': 'auto',
    // Opus series
    'claude-opus-4-5': 'claude-opus-4.5',
    'claude-opus-4-5-20251101': 'claude-opus-4.5'
};

/**
 * OAuth Configuration
 */
export const KIRO_OAUTH_CONFIG = {
    // Kiro Auth Service endpoint (for Social Auth) - multi-region support
    authServiceEndpoint: 'https://prod.{{region}}.auth.desktop.kiro.dev',

    // AWS SSO OIDC endpoint (for Builder ID) - multi-region support
    ssoOIDCEndpoint: 'https://oidc.{{region}}.amazonaws.com',

    // AWS Builder ID start URL
    builderIDStartURL: 'https://view.awsapps.com/start',

    // Local callback port range
    callbackPortStart: 19876,
    callbackPortEnd: 19880,

    // Timeout configuration
    authTimeout: 10 * 60 * 1000,  // 10 minutes
    pollInterval: 5000,           // 5 seconds

    // CodeWhisperer Scopes
    scopes: [
        'codewhisperer:completions',
        'codewhisperer:analysis',
        'codewhisperer:conversations',
        'codewhisperer:transformations',
        'codewhisperer:taskassist'
    ],

    // Credential storage
    credentialsDir: '.kiro',
    credentialsFile: 'oauth_creds.json',

    // Supported regions list
    supportedRegions: [
        'us-east-1',
        'us-west-1',
        'us-west-2',
        'eu-west-1'
    ]
};

/**
 * Amazon Bedrock Constants Configuration
 */
export const BEDROCK_CONSTANTS = {
    // API endpoint templates
    RUNTIME_ENDPOINT: 'https://bedrock-runtime.{{region}}.amazonaws.com',
    INVOKE_MODEL_PATH: '/model/{{modelId}}/invoke',
    CONVERSE_PATH: '/model/{{modelId}}/converse',
    CONVERSE_STREAM_PATH: '/model/{{modelId}}/converse-stream',

    // Default configuration
    DEFAULT_REGION: 'us-east-1',
    DEFAULT_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    AXIOS_TIMEOUT: 300000, // 5 minute timeout

    // Supported regions
    SUPPORTED_REGIONS: [
        'us-east-1',
        'us-west-2',
        'eu-west-1',
        'eu-west-3',
        'ap-northeast-1',
        'ap-southeast-2'
    ],

    // Service name (for AWS Signature)
    SERVICE_NAME: 'bedrock'
};

/**
 * Bedrock Claude Model Mapping
 */
export const BEDROCK_MODEL_MAPPING = {
    // Claude 4.5 Opus
    'claude-opus-4-5': 'anthropic.claude-opus-4-5-20251101-v1:0',
    'claude-opus-4-5-20251101': 'anthropic.claude-opus-4-5-20251101-v1:0',
    // Claude Sonnet 4.5
    'claude-sonnet-4-5': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    'claude-sonnet-4-5-20250929': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    // Claude Sonnet 4
    'claude-sonnet-4': 'anthropic.claude-sonnet-4-20250514-v1:0',
    'claude-sonnet-4-20250514': 'anthropic.claude-sonnet-4-20250514-v1:0',
    // Claude 3.7 Sonnet
    'claude-3-7-sonnet': 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    'claude-3-7-sonnet-20250219': 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    // Claude 3.5 Sonnet v2
    'claude-3-5-sonnet-v2': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'claude-3-5-sonnet-20241022': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    // Claude 3.5 Sonnet v1
    'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    'claude-3-5-sonnet-20240620': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    // Claude 3.5 Haiku
    'claude-3-5-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
    'claude-3-5-haiku-20241022': 'anthropic.claude-3-5-haiku-20241022-v1:0',
    // Claude 3 Opus
    'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',
    'claude-3-opus-20240229': 'anthropic.claude-3-opus-20240229-v1:0',
    // Claude 3 Sonnet
    'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
    'claude-3-sonnet-20240229': 'anthropic.claude-3-sonnet-20240229-v1:0',
    // Claude 3 Haiku
    'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
    'claude-3-haiku-20240307': 'anthropic.claude-3-haiku-20240307-v1:0'
};

/**
 * Bedrock Supported Models List
 */
export const BEDROCK_MODELS = [
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307'
];

/**
 * Model Pricing Configuration (USD per million tokens)
 */
export const MODEL_PRICING = {
    // Claude Opus 4.5
    'claude-opus-4-5-20251101': { input: 15, output: 75 },
    'claude-opus-4.5': { input: 15, output: 75 },

    // Claude Sonnet 4
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
    'CLAUDE_SONNET_4_20250514_V1_0': { input: 3, output: 15 },

    // Claude Sonnet 4.5
    'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
    'CLAUDE_SONNET_4_5_20250929_V1_0': { input: 3, output: 15 },

    // Claude 3.7 Sonnet
    'claude-3-7-sonnet-20250219': { input: 3, output: 15 },
    'CLAUDE_3_7_SONNET_20250219_V1_0': { input: 3, output: 15 },

    // Claude 3.5 Sonnet
    'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
    'claude-3-5-sonnet-20240620': { input: 3, output: 15 },

    // Claude Haiku 4.5
    'claude-haiku-4-5': { input: 0.80, output: 4 },
    'claude-haiku-4.5': { input: 0.80, output: 4 },

    // Claude 3.5 Haiku
    'claude-3-5-haiku-20241022': { input: 0.80, output: 4 },

    // Claude 3 Opus
    'claude-3-opus-20240229': { input: 15, output: 75 },

    // Claude 3 Sonnet
    'claude-3-sonnet-20240229': { input: 3, output: 15 },

    // Claude 3 Haiku
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

    // Gemini model pricing
    'gemini-2.5-computer-use-preview-10-2025': { input: 1.25, output: 5 },
    'gemini-3-pro-image-preview': { input: 1.25, output: 5 },
    'gemini-3-pro-preview': { input: 1.25, output: 5 },
    'gemini-3-flash-preview': { input: 0.075, output: 0.30 },
    'gemini-2.5-flash-preview': { input: 0.075, output: 0.30 },
    'gemini-claude-sonnet-4-5': { input: 3, output: 15 },
    'gemini-claude-sonnet-4-5-thinking': { input: 3, output: 15 },
    'gemini-claude-opus-4-5-thinking': { input: 15, output: 75 },

    // Default pricing (calculated based on Sonnet)
    'default': { input: 3, output: 15 }
};

// Dynamic pricing cache (loaded from database)
let dynamicPricingCache = null;
let dynamicPricingCacheTime = null;
const PRICING_CACHE_TTL = 60000; // 60 second cache

// Remote pricing configuration
const LLM_PRICES_URL = 'https://www.llm-prices.com/current-v1.json';
const REMOTE_PRICING_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache
const REMOTE_PRICING_TIMEOUT = 10000; // 10 seconds

// Remote pricing cache (in-memory cache loaded from database)
let remotePricingCache = {};
let remotePricingLastFetch = 0;
let remotePricingPromise = null;

// Remote pricing database store (set from server.js)
let remotePricingStore = null;

/**
 * Set dynamic pricing cache
 * @param {object} pricingMap - Pricing mapping table { modelName: { input, output } }
 */
export function setDynamicPricing(pricingMap) {
    dynamicPricingCache = pricingMap;
    dynamicPricingCacheTime = Date.now();
}

/**
 * Get dynamic pricing
 */
export function getDynamicPricing() {
    return dynamicPricingCache;
}

/**
 * Check if dynamic pricing cache is valid
 */
export function isDynamicPricingValid() {
    if (!dynamicPricingCache || !dynamicPricingCacheTime) return false;
    return (Date.now() - dynamicPricingCacheTime) < PRICING_CACHE_TTL;
}

/**
 * Calculate token cost (USD)
 * @param {string} model - Model name
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {number} cacheReadTokens - Number of cache read tokens (optional)
 * @returns {object} { inputCost, outputCost, cacheCost, totalCost }
 */
export function calculateTokenCost(model, inputTokens, outputTokens, cacheReadTokens = 0) {
    const modelLower = model ? model.toLowerCase() : '';

    // Priority: dynamicPricing (db) > remotePricing > MODEL_PRICING > default
    let pricing = null;

    // 1. Check dynamic pricing (database)
    if (dynamicPricingCache && dynamicPricingCache[model]) {
        pricing = dynamicPricingCache[model];
    }
    // 2. Check remote pricing
    else if (remotePricingCache[modelLower]) {
        pricing = remotePricingCache[modelLower];
    }
    // 3. Check static pricing
    else if (MODEL_PRICING[model]) {
        pricing = MODEL_PRICING[model];
    }
    // 4. Try partial match in remote pricing
    else {
        for (const [key, price] of Object.entries(remotePricingCache)) {
            if (modelLower.includes(key) || key.includes(modelLower)) {
                pricing = price;
                break;
            }
        }
    }

    // 5. Default fallback
    if (!pricing) {
        pricing = MODEL_PRICING['default'];
    }

    // Cache read tokens are 90% cheaper
    const cacheDiscount = 0.1;

    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    const cacheCost = (cacheReadTokens / 1000000) * pricing.input * cacheDiscount;

    return {
        inputCost,
        outputCost,
        cacheCost,
        totalCost: inputCost + outputCost + cacheCost
    };
}

/**
 * Set remote pricing store (call from server.js)
 * @param {object} store - RemotePricingCacheStore instance
 */
export function setRemotePricingStore(store) {
    remotePricingStore = store;
}

/**
 * Load remote pricing from database into memory cache
 * @returns {Promise<object>} Remote pricing map
 */
async function loadRemotePricingFromDb() {
    if (!remotePricingStore) return {};

    try {
        const pricingMap = await remotePricingStore.getPricingMap();
        if (Object.keys(pricingMap).length > 0) {
            remotePricingCache = pricingMap;
            const lastFetch = await remotePricingStore.getLastFetchTime();
            remotePricingLastFetch = lastFetch ? lastFetch.getTime() : 0;
        }
        return pricingMap;
    } catch (error) {
        console.log(`[Pricing] Failed to load from database: ${error.message}`);
        return {};
    }
}

/**
 * Fetch remote pricing from llm-prices.com and save to database
 * @returns {Promise<object>} Remote pricing map
 */
export async function fetchRemotePricing() {
    // Check if database cache is still valid
    if (remotePricingStore) {
        try {
            const isValid = await remotePricingStore.isCacheValid();
            if (isValid && Object.keys(remotePricingCache).length === 0) {
                // Load from database if memory cache is empty but db cache is valid
                await loadRemotePricingFromDb();
            }
            if (isValid && Object.keys(remotePricingCache).length > 0) {
                return remotePricingCache;
            }
        } catch (error) {
            console.log(`[Pricing] Database check failed: ${error.message}`);
        }
    }

    // Return existing promise if fetch in progress
    if (remotePricingPromise) {
        return remotePricingPromise;
    }

    remotePricingPromise = (async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REMOTE_PRICING_TIMEOUT);

            const response = await fetch(LLM_PRICES_URL, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const pricing = {};

            // Parse llm-prices.com format
            if (data.prices && Array.isArray(data.prices)) {
                for (const item of data.prices) {
                    if (item.id && item.input != null && item.output != null) {
                        pricing[item.id.toLowerCase()] = {
                            input: parseFloat(item.input),
                            output: parseFloat(item.output),
                            vendor: item.vendor || 'unknown'
                        };
                    }
                }
            }

            if (Object.keys(pricing).length > 0) {
                // Save to database
                if (remotePricingStore) {
                    try {
                        const result = await remotePricingStore.updateCache(pricing);
                        console.log(`[Pricing] Saved to database: ${result.inserted} inserted, ${result.updated} updated`);
                    } catch (dbError) {
                        console.log(`[Pricing] Failed to save to database: ${dbError.message}`);
                    }
                }

                // Update memory cache
                remotePricingCache = pricing;
                remotePricingLastFetch = Date.now();
                console.log(`[Pricing] Fetched remote pricing for ${Object.keys(pricing).length} models`);
                return pricing;
            }

            throw new Error('No valid pricing data');
        } catch (error) {
            console.log(`[Pricing] Remote fetch failed: ${error.message}, using cached/static pricing`);
            // Try to load from database as fallback
            if (remotePricingStore && Object.keys(remotePricingCache).length === 0) {
                await loadRemotePricingFromDb();
            }
            return remotePricingCache;
        } finally {
            remotePricingPromise = null;
        }
    })();

    return remotePricingPromise;
}

/**
 * Initialize remote pricing (call at server startup)
 * First loads from database, then fetches from remote if needed
 * @returns {Promise<void>}
 */
export async function initializeRemotePricing() {
    try {
        // First try to load from database
        if (remotePricingStore) {
            await loadRemotePricingFromDb();
            const isValid = await remotePricingStore.isCacheValid();
            if (isValid && Object.keys(remotePricingCache).length > 0) {
                console.log(`[Pricing] Loaded ${Object.keys(remotePricingCache).length} models from database cache`);
                return;
            }
        }

        // Fetch from remote if database cache is invalid or empty
        await fetchRemotePricing();
    } catch (error) {
        console.log(`[Pricing] Failed to initialize remote pricing: ${error.message}`);
    }
}

/**
 * Get pricing info for diagnostics
 * @returns {Promise<object>} Pricing statistics
 */
export async function getPricingInfo() {
    const staticCount = Object.keys(MODEL_PRICING).length - 1; // Exclude 'default'
    const remoteCount = Object.keys(remotePricingCache).length;
    const dynamicCount = dynamicPricingCache ? Object.keys(dynamicPricingCache).length : 0;

    let source = 'static';
    if (dynamicCount > 0 && remoteCount > 0) {
        source = 'database+remote+static';
    } else if (dynamicCount > 0) {
        source = 'database+static';
    } else if (remoteCount > 0) {
        source = 'remote+static';
    }

    // Get database stats if available
    let dbStats = null;
    if (remotePricingStore) {
        try {
            dbStats = await remotePricingStore.getStats();
        } catch (error) {
            // Ignore
        }
    }

    const cacheAge = remotePricingLastFetch > 0
        ? Math.round((Date.now() - remotePricingLastFetch) / 60000) + 'm'
        : 'never';

    return {
        staticModels: staticCount,
        remoteModels: remoteCount,
        databaseModels: dynamicCount,
        totalModels: staticCount + remoteCount + dynamicCount,
        lastFetch: remotePricingLastFetch > 0 ? new Date(remotePricingLastFetch).toISOString() : null,
        cacheAge,
        source,
        dbCache: dbStats
    };
}

/**
 * Get remote pricing cache
 * @returns {object} Remote pricing cache
 */
export function getRemotePricing() {
    return remotePricingCache;
}
