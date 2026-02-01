/**
 * Kiro API Constants Configuration
 */
export const KIRO_CONSTANTS = {
    // Token refresh endpoints
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    // Note: Both Builder ID and IAM Identity Center use the same oidc endpoint
    REFRESH_SSO_OIDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',

    // API endpoints - Q endpoint is primary (works in all regions)
    BASE_URL: 'https://q.{{region}}.amazonaws.com/generateAssistantResponse',
    // Fallback endpoint (legacy, only works in us-east-1)
    CODEWHISPERER_URL: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
    USAGE_LIMITS_URL: 'https://codewhisperer.{{region}}.amazonaws.com/getUsageLimits',
    LIST_MODELS_URL: 'https://codewhisperer.{{region}}.amazonaws.com/ListAvailableModels',

    // Agent mode for Kiro requests
    AGENT_MODE: 'vibe',

    // Default configuration
    DEFAULT_MODEL_NAME: 'claude-sonnet-4-20250514',
    DEFAULT_REGION: 'us-east-1',
    AXIOS_TIMEOUT: 300000, // 5 minute timeout

    // Q API (q.{region}.amazonaws.com) supported regions
    // Q endpoint works in all AWS regions, unlike CodeWhisperer which only works in us-east-1
    Q_SUPPORTED_REGIONS: [
        // US
        'us-east-1',
        'us-east-2',
        'us-west-1',
        'us-west-2',
        // Europe
        'eu-west-1',
        'eu-west-2',
        'eu-west-3',
        'eu-central-1',
        'eu-central-2',
        'eu-north-1',
        'eu-south-1',
        'eu-south-2',
        // Asia Pacific
        'ap-northeast-1',
        'ap-northeast-2',
        'ap-northeast-3',
        'ap-southeast-1',
        'ap-southeast-2',
        'ap-southeast-3',
        'ap-south-1',
        'ap-south-2',
        'ap-east-1',
        // Middle East
        'me-south-1',
        'me-central-1',
        // Africa
        'af-south-1',
        // South America
        'sa-east-1',
        // Canada
        'ca-central-1',
        'ca-west-1'
    ],

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

    // Tool description max length (characters)
    // Descriptions longer than this are moved to system prompt
    // to avoid Kiro API 400 errors
    TOOL_DESCRIPTION_MAX_LENGTH: 10000,

    // MCP API endpoint for web search
    MCP_URL: 'https://q.{{region}}.amazonaws.com/mcp',
};

/**
 * Get Q API supported region
 * Q endpoint (q.{region}.amazonaws.com) works in all AWS regions
 * @param {string} userRegion - User-selected region
 * @returns {string} Q API supported region
 */
export function getCodeWhispererRegion(userRegion) {
    if (!userRegion) {
        return KIRO_CONSTANTS.DEFAULT_REGION;
    }

    // Q endpoint supports all AWS regions
    if (KIRO_CONSTANTS.Q_SUPPORTED_REGIONS.includes(userRegion)) {
        return userRegion;
    }

    // For unknown regions, fallback to default but allow the request
    // Q endpoint may work in regions not explicitly listed
    console.warn(`[REGION] Region ${userRegion} not in known list, using as-is (Q endpoint supports all regions)`);
    return userRegion;
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
    // Opus 4.5
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
    'claude-opus-4-5-thinking',
    'claude-opus-4-5-20251101-thinking',
    // Sonnet 4.5
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-5-thinking',
    'claude-sonnet-4-5-20250929-thinking',
    // Haiku 4.5
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    // Opus 4.1
    'claude-opus-4-1',
    'claude-opus-4-1-20250805',
    'claude-opus-4-1-thinking',
    'claude-opus-4-1-20250805-thinking',
    // Opus 4
    'claude-opus-4',
    'claude-opus-4-20250514',
    'claude-opus-4-thinking',
    'claude-opus-4-20250514-thinking',
    // Sonnet 4
    'claude-sonnet-4',
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-thinking',
    'claude-sonnet-4-20250514-thinking',
    // Claude 3.7
    'claude-3-7-sonnet',
    'claude-3-7-sonnet-20250219',
    // Claude 3.5
    'claude-3-5-sonnet',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku',
    'claude-3-5-haiku-20241022'
];

/**
 * Model mapping table - maps model names to internal names used by Kiro API
 */
export const MODEL_MAPPING = {
    // Opus 4.5 series
    'claude-opus-4-5': 'CLAUDE_OPUS_4_5_V1_0',
    'claude-opus-4-5-20251101': 'CLAUDE_OPUS_4_5_20251101_V1_0',
    'claude-opus-4-5-thinking': 'CLAUDE_OPUS_4_5_THINKING_V1_0',
    'claude-opus-4-5-20251101-thinking': 'CLAUDE_OPUS_4_5_20251101_THINKING_V1_0',

    // Sonnet 4.5 series
    'claude-sonnet-4-5': 'CLAUDE_SONNET_4_5_V1_0',
    'claude-sonnet-4-5-20250929': 'CLAUDE_SONNET_4_5_20250929_V1_0',
    'claude-sonnet-4-5-thinking': 'CLAUDE_SONNET_4_5_THINKING_V1_0',
    'claude-sonnet-4-5-20250929-thinking': 'CLAUDE_SONNET_4_5_20250929_THINKING_V1_0',

    // Haiku 4.5 series
    'claude-haiku-4-5': 'CLAUDE_HAIKU_4_5_V1_0',
    'claude-haiku-4-5-20251001': 'CLAUDE_HAIKU_4_5_20251001_V1_0',

    // Opus 4.1 series
    'claude-opus-4-1': 'CLAUDE_OPUS_4_1_V1_0',
    'claude-opus-4-1-20250805': 'CLAUDE_OPUS_4_1_20250805_V1_0',
    'claude-opus-4-1-thinking': 'CLAUDE_OPUS_4_1_THINKING_V1_0',
    'claude-opus-4-1-20250805-thinking': 'CLAUDE_OPUS_4_1_20250805_THINKING_V1_0',

    // Opus 4 series
    'claude-opus-4': 'CLAUDE_OPUS_4_V1_0',
    'claude-opus-4-20250514': 'CLAUDE_OPUS_4_20250514_V1_0',
    'claude-opus-4-thinking': 'CLAUDE_OPUS_4_THINKING_V1_0',
    'claude-opus-4-20250514-thinking': 'CLAUDE_OPUS_4_20250514_THINKING_V1_0',

    // Sonnet 4 series
    'claude-sonnet-4': 'CLAUDE_SONNET_4_V1_0',
    'claude-sonnet-4-20250514': 'CLAUDE_SONNET_4_20250514_V1_0',
    'claude-sonnet-4-thinking': 'CLAUDE_SONNET_4_THINKING_V1_0',
    'claude-sonnet-4-20250514-thinking': 'CLAUDE_SONNET_4_20250514_THINKING_V1_0',

    // Claude 3.7 Sonnet
    'claude-3-7-sonnet': 'CLAUDE_3_7_SONNET_V1_0',
    'claude-3-7-sonnet-20250219': 'CLAUDE_3_7_SONNET_20250219_V1_0',

    // Claude 3.5 series
    'claude-3-5-sonnet': 'CLAUDE_3_5_SONNET_V1_0',
    'claude-3-5-sonnet-20241022': 'CLAUDE_3_5_SONNET_20241022_V1_0',
    'claude-3-5-haiku': 'CLAUDE_3_5_HAIKU_V1_0',
    'claude-3-5-haiku-20241022': 'CLAUDE_3_5_HAIKU_20241022_V1_0',

    // Aliases (dot notation)
    'claude-4.5-opus': 'CLAUDE_OPUS_4_5_V1_0',
    'claude-4.5-sonnet': 'CLAUDE_SONNET_4_5_V1_0',
    'claude-4.5-haiku': 'CLAUDE_HAIKU_4_5_V1_0',
    'claude-4-opus': 'CLAUDE_OPUS_4_V1_0',
    'claude-4-sonnet': 'CLAUDE_SONNET_4_V1_0',
    'claude-3.5-sonnet': 'CLAUDE_3_5_SONNET_V1_0',
    'claude-3.5-haiku': 'CLAUDE_3_5_HAIKU_V1_0'
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
        // US
        'us-east-1',
        'us-east-2',
        'us-west-1',
        'us-west-2',
        // Europe
        'eu-west-1',
        'eu-west-2',
        'eu-west-3',
        'eu-central-1',
        'eu-north-1',
        // Asia Pacific
        'ap-northeast-1',
        'ap-northeast-2',
        'ap-southeast-1',
        'ap-southeast-2',
        'ap-south-1',
        // Other
        'ca-central-1',
        'sa-east-1'
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
 * @param {number} cacheCreationTokens - Number of cache creation/write tokens (optional)
 * @param {number} cacheReadTokens - Number of cache read tokens (optional)
 * @returns {object} { inputCost, outputCost, cacheWriteCost, cacheReadCost, totalCost }
 */
export function calculateTokenCost(model, inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0) {
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

    // Cache pricing:
    // - Cache write (creation) is 25% more expensive than input
    // - Cache read is 90% cheaper than input
    const cacheWriteMultiplier = 1.25;
    const cacheReadMultiplier = 0.1;

    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    const cacheWriteCost = (cacheCreationTokens / 1000000) * pricing.input * cacheWriteMultiplier;
    const cacheReadCost = (cacheReadTokens / 1000000) * pricing.input * cacheReadMultiplier;

    return {
        inputCost,
        outputCost,
        cacheWriteCost,
        cacheReadCost,
        totalCost: inputCost + outputCost + cacheWriteCost + cacheReadCost
    };
}

/**
 * Set pricing store (call from server.js)
 * @param {object} store - ModelPricingStore instance
 */
export function setRemotePricingStore(store) {
    remotePricingStore = store;
}

/**
 * Load pricing from database into memory cache (includes remote prices)
 * @returns {Promise<object>} Pricing map
 */
async function loadPricingFromDb() {
    if (!remotePricingStore) return {};

    try {
        const pricingMap = await remotePricingStore.getPricingMap();
        if (Object.keys(pricingMap).length > 0) {
            // Store in remote cache for backward compatibility
            remotePricingCache = pricingMap;
            remotePricingLastFetch = Date.now();
        }
        return pricingMap;
    } catch (error) {
        console.log(`[Pricing] Failed to load from database: ${error.message}`);
        return {};
    }
}

/**
 * Fetch remote pricing from llm-prices.com and save to model_pricing table
 * Only updates non-custom entries
 * @returns {Promise<object>} Remote pricing map
 */
export async function fetchRemotePricing() {
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
                let syncResult = { added: 0, updated: 0, skipped: 0 };

                // Save to model_pricing table (only updates non-custom entries)
                if (remotePricingStore) {
                    try {
                        syncResult = await remotePricingStore.importRemotePricing(pricing);
                        console.log(`[Pricing] Remote sync: ${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.skipped} skipped (custom)`);
                    } catch (dbError) {
                        console.log(`[Pricing] Failed to save to database: ${dbError.message}`);
                    }
                }

                // Reload from database to get merged pricing
                await loadPricingFromDb();
                console.log(`[Pricing] Fetched remote pricing for ${Object.keys(pricing).length} models`);
                return syncResult;
            }

            throw new Error('No valid pricing data');
        } catch (error) {
            console.log(`[Pricing] Remote fetch failed: ${error.message}, using database/static pricing`);
            // Load from database as fallback
            if (remotePricingStore && Object.keys(remotePricingCache).length === 0) {
                await loadPricingFromDb();
            }
            return { added: 0, updated: 0, skipped: 0, error: error.message };
        } finally {
            remotePricingPromise = null;
        }
    })();

    return remotePricingPromise;
}

/**
 * Initialize pricing (call at server startup)
 * Loads from database, then fetches remote updates in background
 * @returns {Promise<void>}
 */
export async function initializeRemotePricing() {
    try {
        // First load existing pricing from database
        if (remotePricingStore) {
            await loadPricingFromDb();
            if (Object.keys(remotePricingCache).length > 0) {
                console.log(`[Pricing] Loaded ${Object.keys(remotePricingCache).length} models from database`);
            }
        }

        // Fetch remote updates (non-blocking, updates in background)
        fetchRemotePricing().catch(err => {
            console.log(`[Pricing] Background remote fetch failed: ${err.message}`);
        });
    } catch (error) {
        console.log(`[Pricing] Failed to initialize pricing: ${error.message}`);
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

// ============ Quota Configuration ============

/**
 * Quota threshold configuration
 */
export const QUOTA_CONFIG = {
    // Quota remaining thresholds (fraction 0-1)
    LOW_THRESHOLD: 0.20,        // 20% - reserve account when others available
    CRITICAL_THRESHOLD: 0.05,   // 5% - exclude from selection

    // Cache freshness
    STALE_MS: 5 * 60 * 1000,    // 5 minutes - max age to trust quota data

    // Refresh interval
    REFRESH_INTERVAL_MS: 30 * 60 * 1000,  // 30 minutes - periodic quota refresh

    // Backoff tiers for quota exhausted errors (ms)
    EXHAUSTED_BACKOFF_TIERS: [60000, 300000, 1800000, 7200000]  // 1min, 5min, 30min, 2hr
};

/**
 * Check if quota is critically low
 * @param {number} remainingFraction - Remaining quota fraction (0-1)
 * @returns {boolean}
 */
export function isQuotaCritical(remainingFraction) {
    if (remainingFraction === null || remainingFraction === undefined) return false;
    return remainingFraction <= QUOTA_CONFIG.CRITICAL_THRESHOLD;
}

/**
 * Check if quota is low (but not critical)
 * @param {number} remainingFraction - Remaining quota fraction (0-1)
 * @returns {boolean}
 */
export function isQuotaLow(remainingFraction) {
    if (remainingFraction === null || remainingFraction === undefined) return false;
    return remainingFraction <= QUOTA_CONFIG.LOW_THRESHOLD && remainingFraction > QUOTA_CONFIG.CRITICAL_THRESHOLD;
}

/**
 * Calculate quota score for account selection (0-100)
 * @param {number|null} remainingFraction - Remaining quota fraction (0-1)
 * @param {boolean} isFresh - Whether quota data is fresh
 * @returns {number}
 */
export function calculateQuotaScore(remainingFraction, isFresh = true) {
    // Unknown quota gets middle score
    if (remainingFraction === null || remainingFraction === undefined) {
        return 50;
    }

    // Calculate base score
    let score = remainingFraction * 100;

    // Apply penalty for stale data
    if (!isFresh) {
        score *= 0.9;  // 10% penalty
    }

    return Math.round(score);
}

// ============ Selection Configuration ============

/**
 * Account selection strategy configuration
 */
export const SELECTION_CONFIG = {
    // Available strategies
    strategies: ['hybrid', 'sticky', 'round-robin'],
    defaultStrategy: 'hybrid',

    // Scoring weights (used by hybrid strategy)
    weights: {
        health: 2,      // Health score weight
        tokens: 5,      // Token bucket weight
        quota: 3,       // Quota weight
        lru: 0.1        // LRU (least recently used) weight
    },

    // Health tracking configuration
    health: {
        initialScore: 70,           // Starting health score
        maxScore: 100,              // Maximum health score
        minUsable: 50,              // Minimum score to be usable
        successBonus: 1,            // Points added on success
        rateLimitPenalty: 10,       // Points removed on rate limit
        failurePenalty: 20,         // Points removed on failure
        recoveryPerHour: 10         // Points recovered per hour
    },

    // Token bucket rate limiting configuration
    tokenBucket: {
        maxTokens: 50,              // Maximum tokens per bucket
        regenPerMinute: 6           // Tokens regenerated per minute
    },

    // Quota thresholds (override QUOTA_CONFIG if needed)
    quota: {
        lowThreshold: 0.10,         // 10% - reserve when low
        criticalThreshold: 0.05    // 5% - exclude from selection
    },

    // Thinking blocks configuration
    thinking: {
        signatureCacheTtlHours: 2,  // Signature cache TTL
        minSignatureLength: 50      // Minimum signature length to cache
    },

    // Sticky strategy configuration
    sticky: {
        sessionTtlMs: 30 * 60 * 1000  // 30 minutes session TTL
    }
};
