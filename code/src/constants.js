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
 * @returns {object} { inputCost, outputCost, totalCost }
 */
export function calculateTokenCost(model, inputTokens, outputTokens) {
    // Prefer dynamic pricing (database configuration)
    let pricing = null;
    if (dynamicPricingCache && dynamicPricingCache[model]) {
        pricing = dynamicPricingCache[model];
    } else {
        // Fallback to static configuration
        pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
    }
    
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    return {
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost
    };
}
