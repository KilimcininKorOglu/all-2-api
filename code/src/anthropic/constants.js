/**
 * Anthropic API Constants
 */

// Default Anthropic API URL
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_URL_BETA = 'https://api.anthropic.com/v1/messages?beta=true';

// API Version
export const ANTHROPIC_VERSION = '2023-06-01';

// Beta features
export const ANTHROPIC_BETA = 'interleaved-thinking-2025-05-14,output-128k-2025-02-19';
export const ANTHROPIC_BETA_OAUTH = 'oauth-2025-04-20,interleaved-thinking-2025-05-14';

// OAuth token prefix
export const OAUTH_TOKEN_PREFIX = 'sk-ant-oat';

// Required system prompt for OAuth tokens
export const CLAUDE_CODE_SYSTEM_PROMPT = [
    {
        type: 'text',
        text: "You are Claude Code, Anthropic's official CLI for Claude."
    }
];

// Request timeout
export const ANTHROPIC_TIMEOUT = 300000; // 5 minutes

// Supported models
export const ANTHROPIC_MODELS = [
    'claude-opus-4-5-20250514',
    'claude-opus-4-5',
    'claude-sonnet-4-5-20250514',
    'claude-sonnet-4-5',
    'claude-sonnet-4-20250514',
    'claude-sonnet-4',
    'claude-haiku-4-5',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307'
];

// Model aliases
export const MODEL_ALIASES = {
    'claude-opus-4.5': 'claude-opus-4-5-20250514',
    'claude-sonnet-4.5': 'claude-sonnet-4-5-20250514',
    'claude-sonnet-4': 'claude-sonnet-4-20250514',
    'claude-haiku-4.5': 'claude-haiku-4-5'
};

/**
 * Get API URL for an account (custom or default)
 * @param {object} account - Account with optional apiBaseUrl
 * @returns {string} API URL
 */
export function getApiUrl(account) {
    if (account?.apiBaseUrl) {
        let url = account.apiBaseUrl.replace(/\/+$/, ''); // Remove trailing slash
        if (!url.includes('/v1/messages')) {
            url += '/v1/messages';
        }
        if (!url.includes('beta=true')) {
            url += (url.includes('?') ? '&' : '?') + 'beta=true';
        }
        return url;
    }
    return ANTHROPIC_API_URL_BETA;
}

/**
 * Check if token is OAuth format
 * @param {string} token - Access token
 * @returns {boolean}
 */
export function isOAuthToken(token) {
    return token && token.startsWith(OAUTH_TOKEN_PREFIX);
}

/**
 * Build request headers
 * @param {string} accessToken - API key or OAuth token
 * @returns {object} Headers
 */
export function buildHeaders(accessToken) {
    const isOAuth = isOAuthToken(accessToken);
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': isOAuth ? ANTHROPIC_BETA_OAUTH : ANTHROPIC_BETA,
        'User-Agent': 'claude-cli/2.1.2 (external, cli)'
    };
}

/**
 * Check if model is supported
 * @param {string} model - Model name
 * @returns {boolean}
 */
export function isAnthropicModel(model) {
    if (!model) return false;
    const modelLower = model.toLowerCase();
    return ANTHROPIC_MODELS.some(m => m.toLowerCase() === modelLower) ||
           Object.keys(MODEL_ALIASES).some(a => a.toLowerCase() === modelLower);
}

/**
 * Resolve model alias to actual model name
 * @param {string} model - Model name or alias
 * @returns {string} Actual model name
 */
export function resolveModelAlias(model) {
    return MODEL_ALIASES[model] || model;
}
