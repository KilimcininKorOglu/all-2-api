/**
 * Kiro API Unified Service
 * Provides unified methods for Token refresh, chat, and usage retrieval
 */
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import crypto from 'crypto';
import { KIRO_CONSTANTS, MODEL_MAPPING, KIRO_MODELS, buildCodeWhispererUrl } from '../constants.js';
import { logger } from '../logger.js';

const log = logger.api;

/**
 * Generate unique machine ID based on credentials
 */
function generateMachineId(credential) {
    const uniqueKey = credential.profileArn || credential.clientId || 'KIRO_DEFAULT';
    return crypto.createHash('sha256').update(uniqueKey).digest('hex');
}

/**
 * Get system runtime information
 */
function getSystemInfo() {
    const platform = os.platform();
    const release = os.release();
    const nodeVersion = process.version.replace('v', '');

    let osName = platform;
    if (platform === 'win32') osName = `windows#${release}`;
    else if (platform === 'darwin') osName = `macos#${release}`;
    else osName = `${platform}#${release}`;

    return { osName, nodeVersion };
}

/**
 * Create axios instance
 */
function createAxiosInstance(credential) {
    const machineId = generateMachineId(credential);
    const { osName, nodeVersion } = getSystemInfo();
    const kiroVersion = KIRO_CONSTANTS.KIRO_VERSION;

    return axios.create({
        timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
        headers: {
            'Content-Type': 'application/json',
            'Accept': KIRO_CONSTANTS.ACCEPT_JSON,
            'amz-sdk-request': 'attempt=1; max=1',
            'x-amzn-kiro-agent-mode': KIRO_CONSTANTS.AGENT_MODE || 'vibe',
            'x-amzn-codewhisperer-optout': 'true',
            'x-amz-user-agent': `aws-sdk-js/1.0.27 KiroIDE-${kiroVersion}-${machineId}`,
            'user-agent': `aws-sdk-js/1.0.27 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererstreaming#1.0.27 m/E KiroIDE-${kiroVersion}-${machineId}`,
            'Connection': 'close'
        }
    });
}

/**
 * Unified Kiro API Service Class
 */
export class KiroAPI {
    /**
     * Unified Token Refresh
     * @param {Object} credential - Credential object
     * @param {string} credential.refreshToken - Refresh token
     * @param {string} credential.authMethod - Authentication method (social/builder-id/IdC)
     * @param {string} credential.region - Region
     * @param {string} credential.clientId - Client ID (required for builder-id/IdC)
     * @param {string} credential.clientSecret - Client secret (required for builder-id/IdC)
     * @returns {Promise<Object>} Refresh result {success, accessToken, refreshToken, expiresAt, error}
     */
    static async refreshToken(credential) {
        const {
            refreshToken,
            authMethod = KIRO_CONSTANTS.AUTH_METHOD_SOCIAL,
            region = KIRO_CONSTANTS.DEFAULT_REGION,
            clientId,
            clientSecret
        } = credential;

        if (!refreshToken) {
            return { success: false, error: 'Missing refreshToken' };
        }

        log.info(`Refreshing Token, auth method: ${authMethod}`);

        try {
            let response;
            let newAccessToken, newRefreshToken, expiresAt;

            if (authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
                // Social authentication method (Google/GitHub)
                const url = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', region);
                const requestBody = { refreshToken };
                const requestHeaders = { 'Content-Type': 'application/json' };
                log.request('POST', url);
                log.curl('POST', url, requestHeaders, requestBody);

                response = await axios.post(url, requestBody, {
                    headers: requestHeaders,
                    timeout: 30000
                });

                newAccessToken = response.data.accessToken;
                newRefreshToken = response.data.refreshToken || refreshToken;
                expiresAt = response.data.expiresAt || null;

            } else if (authMethod === KIRO_CONSTANTS.AUTH_METHOD_BUILDER_ID || authMethod === KIRO_CONSTANTS.AUTH_METHOD_IDC) {
                // Builder ID / IdC authentication method (OIDC)
                if (!clientId || !clientSecret) {
                    log.error(`${authMethod} missing required parameters: clientId=${clientId ? 'present' : 'empty'}, clientSecret=${clientSecret ? 'present' : 'empty'}`);
                    return { success: false, error: `${authMethod} authentication requires clientId and clientSecret` };
                }

                // IdC and builder-id both use oidc endpoint (consistent with kiro2api)
                const url = KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', region);
                log.request('POST', url);

                // Debug log: print request parameters (sanitized)
                log.info(`Refresh parameters: clientId=${clientId.substring(0, 10)}..., clientSecret=${clientSecret.substring(0, 10)}..., refreshToken=${refreshToken.substring(0, 20)}...`);

                // Send request in JSON format (consistent with AIClient)
                const requestBody = {
                    refreshToken: refreshToken,
                    clientId: clientId,
                    clientSecret: clientSecret,
                    grantType: 'refresh_token'
                };
                const requestHeaders = { 'Content-Type': 'application/json' };
                log.curl('POST', url, requestHeaders, requestBody);

                response = await axios.post(url, requestBody, {
                    headers: requestHeaders,
                    timeout: 30000
                });

                // Response fields use camelCase (consistent with social auth)
                newAccessToken = response.data.accessToken || response.data.access_token;
                newRefreshToken = response.data.refreshToken || response.data.refresh_token || refreshToken;
                expiresAt = response.data.expiresAt
                    || (response.data.expiresIn
                        ? new Date(Date.now() + response.data.expiresIn * 1000).toISOString()
                        : null)
                    || (response.data.expires_in
                        ? new Date(Date.now() + response.data.expires_in * 1000).toISOString()
                        : null);

            } else {
                return { success: false, error: `Unsupported authentication method: ${authMethod}` };
            }

            log.success('Token refresh successful');
            log.info(`New Token: ${newAccessToken.substring(0, 20)}...`);
            log.info(`Expiration time: ${expiresAt || 'unknown'}`);

            return {
                success: true,
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
                expiresAt
            };

        } catch (error) {
            // Print full error response for debugging
            if (error.response?.data) {
                log.error(`AWS response details: ${JSON.stringify(error.response.data)}`);
            }

            const errorMsg = error.response?.data?.message
                || error.response?.data?.error_description
                || error.response?.data?.error
                || error.message;
            const statusCode = error.response?.status;

            log.fail(`Token refresh failed: ${errorMsg}`, statusCode);

            return {
                success: false,
                error: errorMsg,
                statusCode
            };
        }
    }

    /**
     * Batch Token Refresh
     * @param {Array} credentials - Credentials array
     * @param {Object} options - Options
     * @param {number} options.delay - Delay in milliseconds between each request (default 2000)
     * @param {Function} options.onProgress - Progress callback (index, total, result)
     * @returns {Promise<Object>} Batch refresh result {success, failed, results}
     */
    static async batchRefreshToken(credentials, options = {}) {
        const { delay = 2000, onProgress } = options;
        const results = {
            success: 0,
            failed: 0,
            results: []
        };

        for (let i = 0; i < credentials.length; i++) {
            const credential = credentials[i];
            const result = await this.refreshToken(credential);

            results.results.push({
                id: credential.id,
                name: credential.name,
                ...result
            });

            if (result.success) {
                results.success++;
            } else {
                results.failed++;
            }

            if (onProgress) {
                onProgress(i + 1, credentials.length, result);
            }

            // Delay to avoid too frequent requests
            if (i < credentials.length - 1 && delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return results;
    }

    /**
     * Check if Token is about to expire
     * @param {string} expiresAt - Expiration time ISO string
     * @param {number} minutes - How many minutes ahead to consider as expiring soon (default 10)
     * @returns {boolean}
     */
    static isTokenExpiringSoon(expiresAt, minutes = 10) {
        if (!expiresAt) return false;
        try {
            const expirationTime = new Date(expiresAt);
            const thresholdTime = new Date(Date.now() + minutes * 60 * 1000);
            return expirationTime.getTime() <= thresholdTime.getTime();
        } catch {
            return false;
        }
    }

    /**
     * Get Token refresh endpoint URL
     * @param {string} authMethod - Authentication method
     * @param {string} region - Region
     * @returns {string}
     */
    static getRefreshEndpoint(authMethod, region = KIRO_CONSTANTS.DEFAULT_REGION) {
        switch (authMethod) {
            case KIRO_CONSTANTS.AUTH_METHOD_SOCIAL:
                return KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', region);
            case KIRO_CONSTANTS.AUTH_METHOD_IDC:
                return KIRO_CONSTANTS.REFRESH_SSO_OIDC_URL.replace('{{region}}', region);
            case KIRO_CONSTANTS.AUTH_METHOD_BUILDER_ID:
            default:
                return KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', region);
        }
    }

    /**
     * Get display name for authentication method
     * @param {string} authMethod - Authentication method
     * @returns {string}
     */
    static getAuthMethodName(authMethod) {
        switch (authMethod) {
            case KIRO_CONSTANTS.AUTH_METHOD_SOCIAL:
                return 'Social (Google/GitHub)';
            case KIRO_CONSTANTS.AUTH_METHOD_BUILDER_ID:
                return 'AWS Builder ID';
            case KIRO_CONSTANTS.AUTH_METHOD_IDC:
                return 'AWS IAM Identity Center';
            default:
                return authMethod;
        }
    }

    // ==================== Chat Related Methods ====================

    /**
     * Get message text content
     * @private
     */
    static _getContentText(message) {
        if (!message) return '';
        if (typeof message === 'string') return message;
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.content)) {
            return message.content
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text)
                .join('');
        }
        return String(message.content || message);
    }

    /**
     * Merge adjacent messages with the same role
     * @private
     */
    static _mergeAdjacentMessages(messages) {
        const merged = [];
        for (const msg of messages) {
            if (merged.length === 0) {
                merged.push({ ...msg });
            } else {
                const last = merged[merged.length - 1];
                if (msg.role === last.role) {
                    const lastContent = this._getContentText(last);
                    const currentContent = this._getContentText(msg);
                    last.content = `${lastContent}\n${currentContent}`;
                } else {
                    merged.push({ ...msg });
                }
            }
        }
        return merged;
    }

    /**
     * Build chat request body
     * @private
     */
    static _buildChatRequest(messages, model, credential, options = {}) {
        const conversationId = uuidv4();
        const codewhispererModel = MODEL_MAPPING[model] || MODEL_MAPPING[KIRO_CONSTANTS.DEFAULT_MODEL_NAME] || model;

        // Merge adjacent messages with the same role
        const mergedMessages = this._mergeAdjacentMessages(messages);

        // Process message history
        const history = [];
        const processedMessages = [...mergedMessages];

        // Process system prompt
        let systemPrompt = options.system || '';

        if (systemPrompt && processedMessages.length > 0 && processedMessages[0].role === 'user') {
            const firstContent = this._getContentText(processedMessages[0]);
            history.push({
                userInputMessage: {
                    content: `${systemPrompt}\n\n${firstContent}`,
                    modelId: codewhispererModel,
                    origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
                }
            });
            processedMessages.shift();
        } else if (systemPrompt) {
            history.push({
                userInputMessage: {
                    content: systemPrompt,
                    modelId: codewhispererModel,
                    origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
                }
            });
        }

        // Process history messages (except the last one)
        for (let i = 0; i < processedMessages.length - 1; i++) {
            const msg = processedMessages[i];
            if (msg.role === 'user') {
                history.push({
                    userInputMessage: {
                        content: this._getContentText(msg),
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
                    }
                });
            } else if (msg.role === 'assistant') {
                history.push({
                    assistantResponseMessage: {
                        content: this._getContentText(msg)
                    }
                });
            }
        }

        // Current message
        const currentMsg = processedMessages[processedMessages.length - 1];
        let currentContent = '';

        if (currentMsg && currentMsg.role === 'assistant') {
            history.push({
                assistantResponseMessage: {
                    content: this._getContentText(currentMsg)
                }
            });
            currentContent = 'Continue';
        } else {
            currentContent = this._getContentText(currentMsg) || 'Continue';

            if (history.length > 0 && !history[history.length - 1].assistantResponseMessage) {
                history.push({
                    assistantResponseMessage: { content: 'Continue' }
                });
            }
        }

        const request = {
            conversationState: {
                chatTriggerType: KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL,
                conversationId,
                currentMessage: {
                    userInputMessage: {
                        content: currentContent,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
                    }
                }
            }
        };

        if (history.length > 0) {
            request.conversationState.history = history;
        }

        if (credential.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL && credential.profileArn) {
            request.profileArn = credential.profileArn;
        }

        return request;
    }

    /**
     * Parse AWS Event Stream buffer
     * @private
     */
    static _parseEventStreamBuffer(buffer) {
        const events = [];
        let remaining = buffer;
        let searchStart = 0;

        while (true) {
            const contentStart = remaining.indexOf('{"content":', searchStart);
            const followupStart = remaining.indexOf('{"followupPrompt":', searchStart);

            const candidates = [contentStart, followupStart].filter(pos => pos >= 0);
            if (candidates.length === 0) break;

            const jsonStart = Math.min(...candidates);
            if (jsonStart < 0) break;

            let braceCount = 0;
            let jsonEnd = -1;
            let inString = false;
            let escapeNext = false;

            for (let i = jsonStart; i < remaining.length; i++) {
                const char = remaining[i];

                if (escapeNext) {
                    escapeNext = false;
                    continue;
                }

                if (char === '\\') {
                    escapeNext = true;
                    continue;
                }

                if (char === '"') {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{') {
                        braceCount++;
                    } else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            jsonEnd = i;
                            break;
                        }
                    }
                }
            }

            if (jsonEnd < 0) {
                remaining = remaining.substring(jsonStart);
                break;
            }

            const jsonStr = remaining.substring(jsonStart, jsonEnd + 1);
            try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.content !== undefined && !parsed.followupPrompt) {
                    events.push({ type: 'content', data: parsed.content });
                }
            } catch (e) {
                // JSON parse failed, skip
            }

            searchStart = jsonEnd + 1;
            if (searchStart >= remaining.length) {
                remaining = '';
                break;
            }
        }

        if (searchStart > 0 && remaining.length > 0) {
            remaining = remaining.substring(searchStart);
        }

        return { events, remaining };
    }

    /**
     * Parse response (non-streaming)
     * @private
     */
    static _parseResponse(rawData) {
        const rawStr = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData);
        let fullContent = '';

        const { events } = this._parseEventStreamBuffer(rawStr);
        for (const event of events) {
            if (event.type === 'content') {
                fullContent += event.data;
            }
        }

        return fullContent;
    }

    /**
     * Check if error is a retryable ValidationException
     * @private
     */
    static _isRetryableValidationException(error) {
        const errorType = error.response?.headers?.['x-amzn-errortype'] || '';
        const responseData = error.response?.data;
        return errorType.includes('ValidationException') ||
            (typeof responseData === 'string' && responseData.includes('ValidationException')) ||
            (responseData?.error?.message?.includes('ValidationException'));
    }

    /**
     * API call with retry
     * @private
     */
    static async _callWithRetry(requestFn, maxRetries = 3, baseDelay = 1000, retryCount = 0) {
        try {
            return await requestFn();
        } catch (error) {
            const status = error.response?.status;

            if (status === 429 && retryCount < maxRetries) {
              const delay = baseDelay * Math.pow(2, retryCount);
                log.warn(`Received 429, retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._callWithRetry(requestFn, maxRetries, baseDelay, retryCount + 1);
            }

            // 400 ValidationException - retry (AWS temporary validation error)
            if (status === 400 && retryCount < maxRetries && this._isRetryableValidationException(error)) {
                const delay = baseDelay * Math.pow(2, retryCount);
                log.warn(`Received 400 ValidationException, retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._callWithRetry(requestFn, maxRetries, baseDelay, retryCount + 1);
            }

            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                log.warn(`Received ${status}, retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._callWithRetry(requestFn, maxRetries, baseDelay, retryCount + 1);
            }

            // Convert to custom error, mask original AWS error details
            const customError = new Error(this._getCustomErrorMessage(error));
            customError.status = status;
            customError.isRetryable = status === 429 || status >= 500 || (status === 400 && this._isRetryableValidationException(error));
            throw customError;
        }
    }

    /**
     * Get custom error message, mask original AWS error details
     * @private
     */
    static _getCustomErrorMessage(error) {
        const status = error.response?.status;

        // Log original error
        const originalError = error.response?.data?.message || error.response?.data?.error?.message || error.message;
        log.error(`Original error: ${status} - ${originalError}`);

        // Return custom error message
        if (status === 400) {
            if (this._isRetryableValidationException(error)) {
                return 'Service temporarily unavailable, please try again later';
            }
            return 'Request parameter error';
        }
        if (status === 401) return 'Authentication failed, please login again';
        if (status === 403) return 'Access denied, Token may have expired';
        if (status === 429) return 'Too many requests, please try again later';
        if (status >= 500) return 'Server error, please try again later';

        return 'Request failed, please try again later';
    }

    /**
     * Unified Chat Interface (non-streaming)
     * @param {Object} credential - Credential object
     * @param {string} credential.accessToken - Access token
     * @param {string} credential.profileArn - Profile ARN (required for social auth)
     * @param {string} credential.authMethod - Authentication method
     * @param {string} credential.region - Region
     * @param {Array} messages - Message array [{role: 'user'|'assistant', content: string}]
     * @param {string} model - Model name
     * @param {Object} options - Options
     * @param {string} options.system - System prompt
     * @param {number} options.maxRetries - Maximum retry count
     * @returns {Promise<Object>} {success, content, error}
     */
    static async chat(credential, messages, model = KIRO_CONSTANTS.DEFAULT_MODEL_NAME, options = {}) {
        const { accessToken, region = KIRO_CONSTANTS.DEFAULT_REGION } = credential;

        if (!accessToken) {
            return { success: false, error: 'Missing accessToken' };
        }

        const axiosInstance = createAxiosInstance(credential);
        const requestData = this._buildChatRequest(messages, model, credential, options);
        const baseUrl = buildCodeWhispererUrl(KIRO_CONSTANTS.BASE_URL, region);

        const requestHeaders = {
            ...axiosInstance.defaults.headers,
            'Authorization': `Bearer ${accessToken}`,
            'amz-sdk-invocation-id': uuidv4()
        };
        log.curl('POST', baseUrl, requestHeaders, requestData);

        try {
            const response = await this._callWithRetry(async () => {
                return await axiosInstance.post(baseUrl, requestData, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'amz-sdk-invocation-id': uuidv4()
                    }
                });
            }, options.maxRetries || 3);

            const content = this._parseResponse(response.data);
            return { success: true, content };

        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            log.fail(`Chat request failed: ${errorMsg}`, error.response?.status);
            return {
                success: false,
                error: errorMsg,
                statusCode: error.response?.status
            };
        }
    }

    /**
     * Unified Chat Interface (streaming)
     * @param {Object} credential - Credential object
     * @param {Array} messages - Message array
     * @param {string} model - Model name
     * @param {Object} options - Options
     * @yields {string} Streaming content chunks
     */
    static async *chatStream(credential, messages, model = KIRO_CONSTANTS.DEFAULT_MODEL_NAME, options = {}) {
        const { accessToken, region = KIRO_CONSTANTS.DEFAULT_REGION } = credential;

        if (!accessToken) {
            throw new Error('Missing accessToken');
        }

        const axiosInstance = createAxiosInstance(credential);
        const requestData = this._buildChatRequest(messages, model, credential, options);
        const baseUrl = buildCodeWhispererUrl(KIRO_CONSTANTS.BASE_URL, region);

        const requestHeaders = {
            ...axiosInstance.defaults.headers,
            'Authorization': `Bearer ${accessToken}`,
            'amz-sdk-invocation-id': uuidv4()
        };
        log.curl('POST', baseUrl, requestHeaders, requestData);

        const response = await this._callWithRetry(async () => {
            return await axiosInstance.post(baseUrl, requestData, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'amz-sdk-invocation-id': uuidv4()
                },
                responseType: 'stream'
            });
        }, options.maxRetries || 3);

        let buffer = '';
        let lastContent = null;

        for await (const chunk of response.data) {
            buffer += chunk.toString();

            const { events, remaining } = this._parseEventStreamBuffer(buffer);
            buffer = remaining;

            for (const event of events) {
                if (event.type === 'content' && event.data) {
                    if (lastContent === event.data) continue;
                    lastContent = event.data;
                    yield event.data;
                }
            }
        }
    }

    // ==================== Usage and Model Related Methods ====================

    /**
     * Get usage limits
     * @param {Object} credential - Credential object
     * @returns {Promise<Object>} {success, data, error}
     */
    static async getUsageLimits(credential) {
        const { accessToken, profileArn, authMethod, region = KIRO_CONSTANTS.DEFAULT_REGION } = credential;

        if (!accessToken) {
            return { success: false, error: 'Missing accessToken' };
        }

        const axiosInstance = createAxiosInstance(credential);
        // USAGE_LIMITS_URL is hardcoded to us-east-1 (only working region for CodeWhisperer)
        const url = KIRO_CONSTANTS.USAGE_LIMITS_URL;

        const params = new URLSearchParams({
            isEmailRequired: 'true',
            origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
            resourceType: 'AGENTIC_REQUEST'
        });

        if (authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL && profileArn) {
            params.append('profileArn', profileArn);
        }

        try {
            const fullUrl = `${url}?${params.toString()}`;
            const requestHeaders = {
                ...axiosInstance.defaults.headers,
                'Authorization': `Bearer ${accessToken}`,
                'amz-sdk-invocation-id': uuidv4()
            };
            log.curl('GET', fullUrl, requestHeaders, null);

            const response = await this._callWithRetry(async () => {
                return await axiosInstance.get(fullUrl, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'amz-sdk-invocation-id': uuidv4()
                    }
                });
            });

            return { success: true, data: response.data };

        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            log.fail(`Failed to get usage: ${errorMsg}`, error.response?.status);
            return {
                success: false,
                error: errorMsg,
                statusCode: error.response?.status
            };
        }
    }

    /**
     * Get available model list
     * @param {Object} credential - Credential object
     * @returns {Promise<Object>} {success, data, error}
     */
    static async listModels(credential) {
        const { accessToken, region = KIRO_CONSTANTS.DEFAULT_REGION } = credential;

        if (!accessToken) {
            return { success: false, error: 'Missing accessToken' };
        }

        const axiosInstance = createAxiosInstance(credential);
        // LIST_MODELS_URL is hardcoded to us-east-1 (only working region for CodeWhisperer)
        const url = KIRO_CONSTANTS.LIST_MODELS_URL;

        try {
            const fullUrl = `${url}?origin=${KIRO_CONSTANTS.ORIGIN_AI_EDITOR}`;
            const requestHeaders = {
                ...axiosInstance.defaults.headers,
                'Authorization': `Bearer ${accessToken}`,
                'amz-sdk-invocation-id': uuidv4()
            };
            log.curl('GET', fullUrl, requestHeaders, null);

            const response = await this._callWithRetry(async () => {
                return await axiosInstance.get(url, {
                    params: { origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR },
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'amz-sdk-invocation-id': uuidv4()
                    }
                });
            });

            return { success: true, data: response.data };

        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            log.fail(`Failed to get model list: ${errorMsg}`, error.response?.status);
            return {
                success: false,
                error: errorMsg,
                statusCode: error.response?.status
            };
        }
    }

    /**
     * Get locally supported model list
     * @returns {Array}
     */
    static getLocalModels() {
        return KIRO_MODELS;
    }

    /**
     * Get model mapping table
     * @returns {Object}
     */
    static getModelMapping() {
        return MODEL_MAPPING;
    }
}

export default KiroAPI;
