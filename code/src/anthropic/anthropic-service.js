/**
 * Anthropic API Service
 * Direct API access with custom endpoint support
 */

import { getApiUrl, buildHeaders, resolveModelAlias, ANTHROPIC_TIMEOUT } from './constants.js';

/**
 * Parse rate limit headers from Anthropic response
 * @param {Headers} headers - Response headers
 * @returns {object|null} Rate limits object
 */
export function parseRateLimits(headers) {
    const rateLimits = {};
    let hasData = false;

    // Request limits
    const requestsLimit = headers.get('anthropic-ratelimit-requests-limit');
    const requestsRemaining = headers.get('anthropic-ratelimit-requests-remaining');
    const requestsReset = headers.get('anthropic-ratelimit-requests-reset');

    if (requestsLimit || requestsRemaining) {
        rateLimits.requests = {
            limit: requestsLimit ? parseInt(requestsLimit, 10) : null,
            remaining: requestsRemaining ? parseInt(requestsRemaining, 10) : null,
            reset: requestsReset || null
        };
        hasData = true;
    }

    // Token limits
    const tokensLimit = headers.get('anthropic-ratelimit-tokens-limit');
    const tokensRemaining = headers.get('anthropic-ratelimit-tokens-remaining');
    const tokensReset = headers.get('anthropic-ratelimit-tokens-reset');

    if (tokensLimit || tokensRemaining) {
        rateLimits.tokens = {
            limit: tokensLimit ? parseInt(tokensLimit, 10) : null,
            remaining: tokensRemaining ? parseInt(tokensRemaining, 10) : null,
            reset: tokensReset || null
        };
        hasData = true;
    }

    // Input token limits
    const inputLimit = headers.get('anthropic-ratelimit-input-tokens-limit');
    const inputRemaining = headers.get('anthropic-ratelimit-input-tokens-remaining');

    if (inputLimit || inputRemaining) {
        rateLimits.inputTokens = {
            limit: inputLimit ? parseInt(inputLimit, 10) : null,
            remaining: inputRemaining ? parseInt(inputRemaining, 10) : null
        };
        hasData = true;
    }

    // Output token limits
    const outputLimit = headers.get('anthropic-ratelimit-output-tokens-limit');
    const outputRemaining = headers.get('anthropic-ratelimit-output-tokens-remaining');

    if (outputLimit || outputRemaining) {
        rateLimits.outputTokens = {
            limit: outputLimit ? parseInt(outputLimit, 10) : null,
            remaining: outputRemaining ? parseInt(outputRemaining, 10) : null
        };
        hasData = true;
    }

    return hasData ? { ...rateLimits, lastUpdated: Date.now() } : null;
}

/**
 * Send message to Anthropic API (non-streaming)
 * @param {object} request - Request body
 * @param {object} account - Account with accessToken and optional apiBaseUrl
 * @returns {Promise<object>} Response with data and rateLimits
 */
export async function sendMessage(request, account) {
    const apiUrl = getApiUrl(account);
    const headers = buildHeaders(account.accessToken);

    // Resolve model alias
    if (request.model) {
        request.model = resolveModelAlias(request.model);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT);

    try {
        console.log(`[Anthropic] Sending message to ${request.model} via ${apiUrl}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const rateLimits = parseRateLimits(response.headers);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(errorData.error?.message || `HTTP ${response.status}`);
            error.status = response.status;
            error.data = errorData;
            error.rateLimits = rateLimits;
            throw error;
        }

        const data = await response.json();

        return {
            data,
            rateLimits
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            error.message = 'Request timeout';
            error.status = 408;
        }
        throw error;
    }
}

/**
 * Send message to Anthropic API (streaming)
 * @param {object} request - Request body
 * @param {object} account - Account with accessToken and optional apiBaseUrl
 * @returns {AsyncGenerator} Stream of events
 */
export async function* sendMessageStream(request, account) {
    const apiUrl = getApiUrl(account);
    const headers = buildHeaders(account.accessToken);

    // Ensure streaming is enabled
    request.stream = true;

    // Resolve model alias
    if (request.model) {
        request.model = resolveModelAlias(request.model);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT);

    try {
        console.log(`[Anthropic] Streaming message to ${request.model} via ${apiUrl}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const rateLimits = parseRateLimits(response.headers);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(errorData.error?.message || `HTTP ${response.status}`);
            error.status = response.status;
            error.data = errorData;
            error.rateLimits = rateLimits;
            throw error;
        }

        // Yield rate limits first
        if (rateLimits) {
            yield { type: 'rate_limits', rateLimits };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        return;
                    }
                    try {
                        const event = JSON.parse(data);
                        yield event;
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        }
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            error.message = 'Request timeout';
            error.status = 408;
        }
        throw error;
    }
}

/**
 * Verify Anthropic API credentials
 * @param {string} accessToken - API key
 * @param {string} apiBaseUrl - Custom API URL (optional)
 * @returns {Promise<object>} Verification result
 */
export async function verifyCredentials(accessToken, apiBaseUrl = null) {
    const account = { accessToken, apiBaseUrl };
    const apiUrl = getApiUrl(account);
    const headers = buildHeaders(accessToken);

    try {
        console.log(`[Anthropic] Verifying credentials via ${apiUrl}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 10,
                messages: [{ role: 'user', content: 'hi' }]
            })
        });

        const rateLimits = parseRateLimits(response.headers);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return {
                valid: false,
                error: errorData.error?.message || `HTTP ${response.status}`,
                status: response.status,
                rateLimits
            };
        }

        const data = await response.json();

        return {
            valid: true,
            model: data.model,
            rateLimits
        };
    } catch (error) {
        return {
            valid: false,
            error: error.message,
            status: error.status || 500
        };
    }
}
