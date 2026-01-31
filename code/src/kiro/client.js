import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { KIRO_CONSTANTS, MODEL_MAPPING, KIRO_MODELS, KIRO_OAUTH_CONFIG, buildCodeWhispererUrl } from '../constants.js';
import { CredentialStore } from '../db.js';
import { logger } from '../logger.js';
import { getAxiosProxyConfig } from '../proxy.js';

const log = logger.client;
const logToken = logger.token;

/**
 * Generate unique machine ID based on credentials
 */
function generateMachineId(credentials) {
    const uniqueKey = credentials.profileArn || credentials.clientId || 'KIRO_DEFAULT';
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
 * Kiro API Client
 * Access Claude models via AWS CodeWhisperer
 */
export class KiroClient {
    /**
     * @param {Object} options - Configuration options
     * @param {string} options.accessToken - Access token (required)
     * @param {string} options.profileArn - Profile ARN (optional)
     * @param {string} options.region - Region (default us-east-1)
     * @param {number} options.maxRetries - Maximum retry count (default 3)
     * @param {number} options.baseDelay - Base delay in milliseconds for retry (default 1000)
     */
    constructor(options = {}) {
        if (!options.accessToken) {
            throw new Error('accessToken is required');
        }

        this.region = options.region || KIRO_CONSTANTS.DEFAULT_REGION;
        this.accessToken = options.accessToken;
        this.refreshToken = options.refreshToken;
        this.profileArn = options.profileArn;
        this.clientId = options.clientId;
        this.clientSecret = options.clientSecret;
        this.authMethod = options.authMethod || KIRO_CONSTANTS.AUTH_METHOD_SOCIAL;
        this.expiresAt = options.expiresAt;

        // Retry configuration
        this.maxRetries = options.maxRetries || 3;
        this.baseDelay = options.baseDelay || 1000;

        // Create axios instance
        const machineId = generateMachineId({
            profileArn: this.profileArn,
            clientId: options.clientId
        });
        const { osName, nodeVersion } = getSystemInfo();
        const kiroVersion = KIRO_CONSTANTS.KIRO_VERSION;

        this.axiosInstance = axios.create({
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
            ...getAxiosProxyConfig(),
            headers: {
                'Content-Type': KIRO_CONSTANTS.CONTENT_TYPE_JSON,
                'Accept': KIRO_CONSTANTS.ACCEPT_JSON,
                'amz-sdk-request': 'attempt=1; max=1',
                'x-amzn-kiro-agent-mode': 'spec',
                'x-amz-user-agent': `aws-sdk-js/1.0.0 KiroIDE-${kiroVersion}-${machineId}`,
                'user-agent': `aws-sdk-js/1.0.0 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererruntime#1.0.0 m/E KiroIDE-${kiroVersion}-${machineId}`,
                'Connection': 'close'
            }
        });
    }

    /**
     * Create client from credentials file
     */
    static async fromCredentialsFile(credentialsPath) {
        const filePath = credentialsPath ||
            path.join(os.homedir(), KIRO_OAUTH_CONFIG.credentialsDir, KIRO_OAUTH_CONFIG.credentialsFile);

        const content = await fs.readFile(filePath, 'utf8');
        const creds = JSON.parse(content);

        return new KiroClient({
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            profileArn: creds.profileArn,
            region: creds.region,
            authMethod: creds.authMethod,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            expiresAt: creds.expiresAt
        });
    }

    /**
     * Create client from database (using active credentials)
     */
    static async fromDatabase() {
        const store = await CredentialStore.create();
        const creds = await store.getActive();

        if (!creds) {
            throw new Error('No active credentials in database, please add credentials first');
        }

        return new KiroClient({
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            profileArn: creds.profileArn,
            region: creds.region,
            authMethod: creds.authMethod,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            expiresAt: creds.expiresAt
        });
    }

    /**
     * Create client from database by ID
     */
    static async fromDatabaseById(id) {
        const store = await CredentialStore.create();
        const creds = await store.getById(id);

        if (!creds) {
            throw new Error(`Credentials with ID ${id} not found`);
        }

        return new KiroClient({
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            profileArn: creds.profileArn,
            region: creds.region,
            authMethod: creds.authMethod,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            expiresAt: creds.expiresAt
        });
    }

    /**
     * Create client from database by name
     */
    static async fromDatabaseByName(name) {
        const store = await CredentialStore.create();
        const creds = await store.getByName(name);

        if (!creds) {
            throw new Error(`Credentials with name "${name}" not found`);
        }

        return new KiroClient({
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            profileArn: creds.profileArn,
            region: creds.region,
            authMethod: creds.authMethod,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            expiresAt: creds.expiresAt
        });
    }

    /**
     * Check if Token is about to expire (within 10 minutes)
     */
    isTokenExpiringSoon(minutes = 10) {
        if (!this.expiresAt) return false;
        try {
            const expirationTime = new Date(this.expiresAt);
            const currentTime = new Date();
            const thresholdTime = new Date(currentTime.getTime() + minutes * 60 * 1000);
            return expirationTime.getTime() <= thresholdTime.getTime();
        } catch (error) {
            log.error(`Failed to check expiration time: ${error.message}`);
            return false;
        }
    }

    /**
     * Refresh Token
     * @returns {Promise<boolean>} Whether refresh was successful
     */
    async refreshAccessToken() {
        if (!this.refreshToken) {
            logToken.warn('No refreshToken, cannot refresh');
            return false;
        }

        logToken.info('Starting Token refresh...');
        logToken.info(`Auth method: ${this.authMethod}`);

        try {
            let newAccessToken, newRefreshToken, expiresAt;

            if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
                // Social authentication method
                const refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', this.region);
                const requestBody = { refreshToken: this.refreshToken };
                const requestHeaders = { 'Content-Type': 'application/json' };
                logToken.request('POST', refreshUrl);
                logToken.curl('POST', refreshUrl, requestHeaders, requestBody);

                const response = await axios.post(refreshUrl, requestBody, {
                    headers: requestHeaders,
                    timeout: 30000,
                    ...getAxiosProxyConfig()
                });

                newAccessToken = response.data.accessToken;
                newRefreshToken = response.data.refreshToken || this.refreshToken;
                expiresAt = response.data.expiresAt || null;
            } else {
                // Builder ID / IdC authentication method (OIDC)
                if (!this.clientId || !this.clientSecret) {
                    logToken.warn('Builder ID/IdC authentication requires clientId and clientSecret');
                    return false;
                }

                // IdC uses sso-oidc endpoint, builder-id uses oidc endpoint
                const refreshUrl = this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_IDC
                    ? KIRO_CONSTANTS.REFRESH_SSO_OIDC_URL.replace('{{region}}', this.region)
                    : KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', this.region);
                logToken.request('POST', refreshUrl);

                // Send request in JSON format (consistent with AIClient)
                const requestBody = {
                    refreshToken: this.refreshToken,
                    clientId: this.clientId,
                    clientSecret: this.clientSecret,
                    grantType: 'refresh_token'
                };
                const requestHeaders = { 'Content-Type': 'application/json' };
                logToken.curl('POST', refreshUrl, requestHeaders, requestBody);

                const response = await axios.post(refreshUrl, requestBody, {
                    headers: requestHeaders,
                    timeout: 30000,
                    ...getAxiosProxyConfig()
                });

                // Response fields use camelCase (consistent with social auth)
                newAccessToken = response.data.accessToken || response.data.access_token;
                newRefreshToken = response.data.refreshToken || response.data.refresh_token || this.refreshToken;
                expiresAt = response.data.expiresAt
                    || (response.data.expiresIn
                        ? new Date(Date.now() + response.data.expiresIn * 1000).toISOString()
                        : null)
                    || (response.data.expires_in
                        ? new Date(Date.now() + response.data.expires_in * 1000).toISOString()
                        : null);
            }

            // Update instance properties
            this.accessToken = newAccessToken;
            this.refreshToken = newRefreshToken;
            this.expiresAt = expiresAt;

            logToken.success('Token refresh successful!');
            logToken.info(`New Token prefix: ${newAccessToken.substring(0, 20)}...`);
            logToken.info(`Expiration time: ${expiresAt || 'unknown'}`);

            return true;
        } catch (error) {
            const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
            logToken.fail(`Token refresh failed: ${errorMsg}`, error.response?.status);
            return false;
        }
    }

    /**
     * Ensure Token is valid (auto-refresh if about to expire)
     * @param {number} minutes - How many minutes ahead to refresh (default 10 minutes)
     * @returns {Promise<boolean>} Whether Token is valid
     */
    async ensureValidToken(minutes = 10) {
        if (this.isTokenExpiringSoon(minutes)) {
            logToken.info(`Token about to expire within ${minutes} minutes, auto-refreshing...`);
            return await this.refreshAccessToken();
        }
        return true;
    }

    /**
     * Merge adjacent messages with the same role
     */
    _mergeAdjacentMessages(messages) {
        const merged = [];
        for (const msg of messages) {
            if (merged.length === 0) {
                merged.push({ ...msg });
            } else {
                const last = merged[merged.length - 1];
                if (msg.role === last.role) {
                    // Merge content
                    const lastContent = this._getContentText(last);
                    const currentContent = this._getContentText(msg);
                    last.content = `${lastContent}\n${currentContent}`;
                    log.debug(`Merged adjacent ${msg.role} messages`);
                } else {
                    merged.push({ ...msg });
                }
            }
        }
        return merged;
    }

    /**
     * Compress message context (for 400 ValidationException retry)
     * Strategy: Keep first and last few messages, remove middle ones
     * @param {Array} messages - Original message array
     * @param {number} compressionLevel - Compression level (1-3)
     * @returns {Array} Compressed message array
     */
    _compressMessages(messages, compressionLevel = 1) {
        if (!messages || messages.length <= 3) {
            return messages;
        }

        const keepRecent = Math.max(2, 6 - compressionLevel * 2); // Level 1 keeps 4, level 2 keeps 2, level 3 keeps 2
        const maxContentLength = Math.max(500, 2000 - compressionLevel * 500); // Gradually reduce content length

        log.warn(`[Context Compression] Level ${compressionLevel} | Original message count: ${messages.length} | Keeping recent: ${keepRecent}`);

        // Separate first message (usually system or important user message) and last few
        const firstMessage = messages[0];
        const recentMessages = messages.slice(-keepRecent);

        // If first message is in recent, return recent directly
        if (messages.length <= keepRecent + 1) {
            return this._truncateMessageContent(messages, maxContentLength);
        }

        // Generate summary for middle messages
        const middleMessages = messages.slice(1, -keepRecent);
        let summaryText = `[Chat history compressed, total ${middleMessages.length} messages]`;

        // If compression level is low, keep summary of some middle messages
        if (compressionLevel === 1 && middleMessages.length > 0) {
            const summaries = middleMessages.slice(0, 3).map(msg => {
                const content = this._getContentText(msg);
                const truncated = content.length > 100 ? content.substring(0, 100) + '...' : content;
                return `[${msg.role}]: ${truncated}`;
            });
            if (middleMessages.length > 3) {
                summaries.push(`... omitted ${middleMessages.length - 3} messages ...`);
            }
            summaryText = summaries.join('\n');
        }

        // Build compressed message array
        const compressed = [
            firstMessage,
            { role: 'user', content: summaryText },
            { role: 'assistant', content: 'OK, I understand the previous conversation context.' },
            ...recentMessages
        ];

        // Truncate overly long content
        const result = this._truncateMessageContent(compressed, maxContentLength);

        log.warn(`[Context Compression] Compressed message count: ${result.length}`);
        return result;
    }

    /**
     * Truncate message content
     */
    _truncateMessageContent(messages, maxLength) {
        return messages.map(msg => {
            const content = this._getContentText(msg);
            if (content.length > maxLength) {
                return {
                    ...msg,
                    content: content.substring(0, maxLength) + `\n[Content truncated, original length: ${content.length}]`
                };
            }
            return msg;
        });
    }

    /**
     * Build request body
     */
    _buildRequest(messages, model, options = {}) {
        const conversationId = uuidv4();
        const codewhispererModel = MODEL_MAPPING[model] || MODEL_MAPPING[KIRO_CONSTANTS.DEFAULT_MODEL_NAME] || model;

        // Merge adjacent messages with the same role
        const mergedMessages = this._mergeAdjacentMessages(messages);

        // Process message history
        const history = [];
        const processedMessages = [...mergedMessages];

        // Process system prompt
        let systemPrompt = options.system || '';

        // Process tools (validate format, avoid ValidationException)
        let toolsContext = {};
        if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
            const validTools = options.tools
                .filter(tool => tool && tool.name) // Ensure name exists
                .map(tool => {
                    // Ensure input_schema is a valid object
                    let inputSchema = tool.input_schema;
                    if (!inputSchema || typeof inputSchema !== 'object') {
                        inputSchema = { type: 'object', properties: {} };
                    }
                    
                    return {
                        toolSpecification: {
                            name: tool.name,
                            description: tool.description || '',
                            inputSchema: { json: inputSchema }
                        }
                    };
                });
            
            if (validTools.length > 0) {
                toolsContext = { tools: validTools };
            }
        }

        // If first message is user, merge system prompt into it
        if (systemPrompt && processedMessages.length > 0 && processedMessages[0].role === 'user') {
            const firstUserMsg = processedMessages[0];
            const userInputMessage = this._buildUserInputMessage(firstUserMsg, codewhispererModel, systemPrompt);
            history.push({ userInputMessage });
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
                const userInputMessage = this._buildUserInputMessage(msg, codewhispererModel);
                history.push({ userInputMessage });
            } else if (msg.role === 'assistant') {
                const assistantResponseMessage = this._buildAssistantResponseMessage(msg);
                history.push({ assistantResponseMessage });
            }
        }

        // Current message
        const currentMsg = processedMessages[processedMessages.length - 1];
        let currentUserInputMessage;

        // If no messages, create a default Continue message
        if (!currentMsg) {
            currentUserInputMessage = {
                content: 'Continue',
                modelId: codewhispererModel,
                origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
            };
        } else if (currentMsg.role === 'assistant') {
            // If last message is assistant, move to history and create Continue
            const assistantResponseMessage = this._buildAssistantResponseMessage(currentMsg);
            history.push({ assistantResponseMessage });
            currentUserInputMessage = {
                content: 'Continue',
                modelId: codewhispererModel,
                origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
            };
        } else {
            currentUserInputMessage = this._buildUserInputMessage(currentMsg, codewhispererModel);

            // Ensure history ends with assistant message
            if (history.length > 0 && !history[history.length - 1].assistantResponseMessage) {
                history.push({
                    assistantResponseMessage: { content: 'Continue' }
                });
            }
        }

        // Add tools to currentMessage's userInputMessageContext
        if (Object.keys(toolsContext).length > 0 && toolsContext.tools) {
            if (!currentUserInputMessage.userInputMessageContext) {
                currentUserInputMessage.userInputMessageContext = {};
            }
            currentUserInputMessage.userInputMessageContext.tools = toolsContext.tools;
        }

        const request = {
            conversationState: {
                chatTriggerType: KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL,
                conversationId,
                currentMessage: {
                    userInputMessage: currentUserInputMessage
                }
            }
        };

        if (history.length > 0) {
            request.conversationState.history = history;
        }

        if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL && this.profileArn) {
            request.profileArn = this.profileArn;
        }

        return request;
    }

    /**
     * Build userInputMessage
     */
    _buildUserInputMessage(msg, codewhispererModel, systemPromptPrefix = '') {
        const userInputMessage = {
            content: '',
            modelId: codewhispererModel,
            origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
        };

        let images = [];
        let toolResults = [];

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text') {
                    userInputMessage.content += part.text || '';
                } else if (part.type === 'tool_result') {
                    // Validate required fields, avoid ValidationException
                    const toolUseId = part.tool_use_id;
                    if (!toolUseId) {
                        log.warn('tool_result missing tool_use_id, skipping');
                        continue;
                    }
                    
                    // Ensure content is valid text
                    let resultContent = this._getContentText(part.content);
                    if (!resultContent) {
                        resultContent = part.is_error ? 'Error occurred' : 'Success';
                    }
                    
                    toolResults.push({
                        content: [{ text: resultContent }],
                        status: part.is_error ? 'error' : 'success',
                        toolUseId
                    });
                } else if (part.type === 'image') {
                    // Validate image data
                    if (part.source?.media_type && part.source?.data) {
                        images.push({
                            format: part.source.media_type.split('/')[1] || 'png',
                            source: {
                                bytes: part.source.data
                            }
                        });
                    }
                }
            }
        } else {
            userInputMessage.content = this._getContentText(msg);
        }

        // Add system prompt prefix
        if (systemPromptPrefix) {
            userInputMessage.content = `${systemPromptPrefix}\n\n${userInputMessage.content}`;
        }

        // Kiro API requires content to be non-empty
        if (!userInputMessage.content) {
            userInputMessage.content = toolResults.length > 0 ? 'Tool results provided.' : 'Continue';
        }

        // Only add non-empty fields
        if (images.length > 0) {
            userInputMessage.images = images;
        }
        if (toolResults.length > 0) {
            // Deduplicate toolResults
            const uniqueToolResults = [];
            const seenIds = new Set();
            for (const tr of toolResults) {
                if (!seenIds.has(tr.toolUseId)) {
                    seenIds.add(tr.toolUseId);
                    uniqueToolResults.push(tr);
                }
            }
            userInputMessage.userInputMessageContext = { toolResults: uniqueToolResults };
        }

        return userInputMessage;
    }

    /**
     * Build assistantResponseMessage
     */
    _buildAssistantResponseMessage(msg) {
        const assistantResponseMessage = {
            content: ''
        };
        let toolUses = [];

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text') {
                    assistantResponseMessage.content += part.text || '';
                } else if (part.type === 'tool_use') {
                    // Validate required fields, avoid ValidationException
                    const toolUseId = part.id || `tool_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                    const name = part.name || 'unknown_tool';
                    
                    // Ensure input is a valid object
                    let input = part.input;
                    if (input === undefined || input === null) {
                        input = {};
                    } else if (typeof input === 'string') {
                        try {
                            input = JSON.parse(input);
                        } catch {
                            input = { raw: input };
                        }
                    } else if (typeof input !== 'object') {
                        input = { value: input };
                    }
                    
                    toolUses.push({
                        input,
                        name,
                        toolUseId
                    });
                }
            }
        } else {
            assistantResponseMessage.content = this._getContentText(msg);
        }

        // Kiro API requires content to be non-empty
        if (!assistantResponseMessage.content) {
            assistantResponseMessage.content = toolUses.length > 0 ? 'Tool calls executed.' : 'Continue';
        }

        // Only add non-empty fields
        if (toolUses.length > 0) {
            assistantResponseMessage.toolUses = toolUses;
        }

        return assistantResponseMessage;
    }

    /**
     * Get message text content
     */
    _getContentText(message) {
        if (!message) return '';
        if (typeof message === 'string') return message;
        // Handle case where array is passed directly (e.g., tool_result content)
        if (Array.isArray(message)) {
            return message
                .map(part => {
                    if (typeof part === 'string') return part;
                    if (part.type === 'text' && part.text) return part.text;
                    if (typeof part.text === 'string') return part.text;
                    return '';
                })
                .filter(Boolean)
                .join('');
        }
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.content)) {
            return message.content
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text)
                .join('');
        }
        // Avoid returning [object Object]
        if (typeof message === 'object') {
            if (message.text) return message.text;
            try {
                return JSON.stringify(message);
            } catch {
                return '';
            }
        }
        return String(message.content || message);
    }

    /**
     * Parse AWS Event Stream buffer
     */
    _parseEventStreamBuffer(buffer) {
        const events = [];
        let remaining = buffer;
        let searchStart = 0;

        while (true) {
            // Search for all possible JSON payload start patterns
            const contentStart = remaining.indexOf('{"content":', searchStart);
            const followupStart = remaining.indexOf('{"followupPrompt":', searchStart);
            const nameStart = remaining.indexOf('{"name":', searchStart);
            const inputStart = remaining.indexOf('{"input":', searchStart);
            const stopStart = remaining.indexOf('{"stop":', searchStart);

            const candidates = [contentStart, followupStart, nameStart, inputStart, stopStart].filter(pos => pos >= 0);
            if (candidates.length === 0) break;

            const jsonStart = Math.min(...candidates);
            if (jsonStart < 0) break;

            // Use bracket counting to find complete JSON
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
                // Handle content event
                if (parsed.content !== undefined && !parsed.followupPrompt) {
                    events.push({ type: 'content', data: parsed.content });
                }
                // Handle structured tool call event - start event (contains name and toolUseId)
                else if (parsed.name && parsed.toolUseId) {
                    events.push({
                        type: 'toolUse',
                        data: {
                            name: parsed.name,
                            toolUseId: parsed.toolUseId,
                            input: parsed.input || '',
                            stop: parsed.stop || false
                        }
                    });
                }
                // Handle tool call input continuation event (only input field)
                else if (parsed.input !== undefined && !parsed.name) {
                    events.push({
                        type: 'toolUseInput',
                        data: { input: parsed.input }
                    });
                }
                // Handle tool call end event (only stop field)
                else if (parsed.stop !== undefined) {
                    events.push({
                        type: 'toolUseStop',
                        data: { stop: parsed.stop }
                    });
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
     * Parse response (non-streaming) - returns content and tool calls
     */
    _parseResponse(rawData) {
        const rawStr = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData);
        let fullContent = '';
        const toolCalls = [];
        let currentToolCall = null;

        const { events } = this._parseEventStreamBuffer(rawStr);
        for (const event of events) {
            if (event.type === 'content') {
                fullContent += event.data;
            } else if (event.type === 'toolUse') {
                const tc = event.data;
                if (tc.name && tc.toolUseId) {
                    if (currentToolCall && currentToolCall.toolUseId === tc.toolUseId) {
                        currentToolCall.input += tc.input || '';
                    } else {
                        if (currentToolCall) {
                            this._finalizeToolCall(currentToolCall, toolCalls);
                        }
                        currentToolCall = {
                            toolUseId: tc.toolUseId,
                            name: tc.name,
                            input: tc.input || ''
                        };
                    }
                    if (tc.stop) {
                        this._finalizeToolCall(currentToolCall, toolCalls);
                        currentToolCall = null;
                    }
         }
            } else if (event.type === 'toolUseInput') {
                if (currentToolCall) {
                    currentToolCall.input += event.data.input || '';
                }
            } else if (event.type === 'toolUseStop') {
                if (currentToolCall && event.data.stop) {
                    this._finalizeToolCall(currentToolCall, toolCalls);
                    currentToolCall = null;
                }
            }
        }

        // Handle incomplete tool calls
        if (currentToolCall) {
            this._finalizeToolCall(currentToolCall, toolCalls);
        }

        return { content: fullContent, toolCalls };
    }

    /**
     * Finalize tool call parsing
     */
    _finalizeToolCall(toolCall, toolCalls) {
        try {
            toolCall.input = JSON.parse(toolCall.input);
        } catch (e) {
            // input is not valid JSON, keep as is
        }
        toolCalls.push(toolCall);
    }

    /**
     * Check if error is ValidationException
     * @private
     */
    _isValidationException(error) {
        // Check error type in header
        const errorType = error.response?.headers?.['x-amzn-errortype'] || '';
        if (errorType.includes('ValidationException')) {
            return true;
        }

        // Check error.message
        if (error.message && error.message.includes('ValidationException')) {
            return true;
        }

        // Check response.data
        const responseData = error.response?.data;
        if (responseData) {
            if (typeof responseData === 'string' && responseData.includes('ValidationException')) {
                return true;
            }
            if (Buffer.isBuffer(responseData) && responseData.toString('utf8').includes('ValidationException')) {
                return true;
            }
            if (typeof responseData === 'object') {
                try {
                    const dataStr = JSON.stringify(responseData);
                    if (dataStr.includes('ValidationException')) {
                        return true;
                    }
                } catch {
                    // Ignore serialization error
                }
                // Check nested error object
                if (responseData.error?.message?.includes('ValidationException')) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Check if error is context limit ValidationException (should not retry)
     * @private
     */
    _isContextLimitException(error) {
        if (!this._isValidationException(error)) {
            return false;
        }
        // ValidationException is usually caused by context limit, should not retry
        return true;
    }

    /**
     * Get custom error message, mask original AWS error details
     * @private
     */
    _getCustomErrorMessage(error) {
        const status = error.response?.status;

        // Log original error
        const responseData = error.response?.data;
        let originalError = error.message;
        if (responseData) {
            if (typeof responseData === 'string') {
                originalError = responseData.substring(0, 500);
            } else if (Buffer.isBuffer(responseData)) {
                originalError = responseData.toString('utf8').substring(0, 500);
            } else if (typeof responseData === 'object') {
                try {
                    originalError = JSON.stringify(responseData).substring(0, 500);
                } catch (e) {
                    originalError = '[Unable to serialize response]';
                }
            }
        }

        // ValidationException uses debug level, not output to console
        if (this._isValidationException(error)) {
            log.debug(`Original error: ${status} - ${originalError}`);
        } else {
            log.error(`Original error: ${status} - ${originalError}`);
        }

        // Return custom error message
        if (status === 400) {
            if (this._isContextLimitException(error)) {
                return 'Context limit exceeded, please restore conversation and retry, or reopen conversation';
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
     * API call with retry
     */
    async _callWithRetry(requestFn, retryCount = 0, hasRefreshed = false) {
        try {
            return await requestFn();
        } catch (error) {
            const status = error.response?.status;

            // 403 Forbidden - Try refreshing Token and retry
            if (status === 403 && !hasRefreshed) {
                log.warn('Received 403, trying to refresh Token and retry...');
                const refreshed = await this.refreshAccessToken();
                if (refreshed) {
                    return this._callWithRetry(requestFn, retryCount, true);
                }
            }

            // 429 Too Many Requests - Exponential backoff retry
            if (status === 429 && retryCount < this.maxRetries) {
                const delay = this.baseDelay * Math.pow(2, retryCount);
                log.warn(`Received 429, retrying in ${delay}ms... (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._callWithRetry(requestFn, retryCount + 1, hasRefreshed);
            }

            // 5xx Server error - Retry
            if (status >= 500 && status < 600 && retryCount < this.maxRetries) {
                const delay = this.baseDelay * Math.pow(2, retryCount);
                log.warn(`Received ${status}, retrying in ${delay}ms... (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._callWithRetry(requestFn, retryCount + 1, hasRefreshed);
            }

            // Return custom error message, mask original AWS error details
            const customMessage = this._getCustomErrorMessage(error);
            const customError = new Error(customMessage);
            customError.status = status;

            throw customError;
        }
    }

    /**
     * Send chat request
     * @param {Array} messages - Message array
     * @param {string} model - Model name
     * @param {Object} options - Options
     * @param {boolean} options.skipTokenRefresh - Skip token auto-refresh
     */
    async chat(messages, model = KIRO_CONSTANTS.DEFAULT_MODEL_NAME, options = {}) {
        // Auto-refresh Token (unless explicitly skipped)
        // if (!options.skipTokenRefresh) {
        //     await this.ensureValidToken();
        // }

        const compressionLevel = options._compressionLevel || 0;
        const currentMessages = compressionLevel > 0 ? this._compressMessages(messages, compressionLevel) : messages;

        const requestData = this._buildRequest(currentMessages, model, options);
        const baseUrl = buildCodeWhispererUrl(KIRO_CONSTANTS.BASE_URL, this.region);

        const requestHeaders = {
            ...this.axiosInstance.defaults.headers,
            'Authorization': `Bearer ${this.accessToken}`,
            'amz-sdk-invocation-id': uuidv4()
        };
        log.curl('POST', baseUrl, requestHeaders, requestData);

        try {
            const response = await this._callWithRetry(async () => {
                return await this.axiosInstance.post(baseUrl, requestData, {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'amz-sdk-invocation-id': uuidv4()
                    }
                });
            });

            return this._parseResponse(response.data);
        } catch (error) {
            // 400 ValidationException - Try compressing context and retry
            if (error.status === 400 && compressionLevel < 3) {
                const newCompressionLevel = compressionLevel + 1;
                log.warn(`Non-streaming request received 400, trying to compress context (level ${newCompressionLevel}) and retry...`);

                const compressedMessages = this._compressMessages(messages, newCompressionLevel);

                // If compressed message count unchanged, cannot compress further, throw error
                if (compressedMessages.length >= messages.length && newCompressionLevel > 1) {
                    log.error('Context cannot be compressed further, giving up retry');
                    throw error;
                }
                
                return this.chat(messages, model, { ...options, _compressionLevel: newCompressionLevel });
            }
            
            throw error;
        }
    }

    /**
     * Streaming chat request - Returns complete Claude format events
     * @param {Array} messages - Message array
     * @param {string} model - Model name
     * @param {Object} options - Options
     * @param {boolean} options.skipTokenRefresh - Skip token auto-refresh
     */
    async *chatStream(messages, model = KIRO_CONSTANTS.DEFAULT_MODEL_NAME, options = {}, retryCount = 0) {
        // Auto-refresh Token (unless explicitly skipped)
        // if (!options.skipTokenRefresh) {
        //     await this.ensureValidToken();
        // }

        const requestData = this._buildRequest(messages, model, options);
        const baseUrl = buildCodeWhispererUrl(KIRO_CONSTANTS.BASE_URL, this.region);

        const requestHeaders = {
            ...this.axiosInstance.defaults.headers,
            'Authorization': `Bearer ${this.accessToken}`,
            'amz-sdk-invocation-id': uuidv4()
        };
        log.curl('POST', baseUrl, requestHeaders, requestData);

        let stream = null;
        try {
            const response = await this.axiosInstance.post(baseUrl, requestData, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'amz-sdk-invocation-id': uuidv4()
                },
                responseType: 'stream'
            });

            stream = response.data;
            let buffer = '';
            let lastContent = null;
            let currentToolCall = null;
            const toolCalls = [];

            for await (const chunk of stream) {
                buffer += chunk.toString();

                const { events, remaining } = this._parseEventStreamBuffer(buffer);
                buffer = remaining;

                for (const event of events) {
                    if (event.type === 'content' && event.data) {
                        // Filter duplicate content
                        if (lastContent === event.data) continue;
                        lastContent = event.data;
                        yield { type: 'content', content: event.data };
                    } else if (event.type === 'toolUse') {
                        const tc = event.data;
                        if (tc.name && tc.toolUseId) {
                            if (currentToolCall && currentToolCall.toolUseId === tc.toolUseId) {
                                currentToolCall.input += tc.input || '';
                            } else {
                                if (currentToolCall) {
                                    this._finalizeToolCall(currentToolCall, toolCalls);
                                }
                                currentToolCall = {
                                    toolUseId: tc.toolUseId,
                                    name: tc.name,
                                    input: tc.input || ''
                                };
                            }
                            if (tc.stop) {
                       this._finalizeToolCall(currentToolCall, toolCalls);
                                yield { type: 'toolUse', toolUse: currentToolCall };
                                currentToolCall = null;
                            }
                        }
                    } else if (event.type === 'toolUseInput') {
                        if (currentToolCall) {
                            currentToolCall.input += event.data.input || '';
                        }
                    } else if (event.type === 'toolUseStop') {
                        if (currentToolCall && event.data.stop) {
                            this._finalizeToolCall(currentToolCall, toolCalls);
                            yield { type: 'toolUse', toolUse: currentToolCall };
                            currentToolCall = null;
                        }
                    }
                }
            }

            // Handle incomplete tool calls
            if (currentToolCall) {
                this._finalizeToolCall(currentToolCall, toolCalls);
                yield { type: 'toolUse', toolUse: currentToolCall };
            }
        } catch (error) {
            // Ensure stream is closed on error
            if (stream && typeof stream.destroy === 'function') {
                stream.destroy();
            }

            const status = error.response?.status;

            // 403 error - Try refreshing Token and retry (only when refresh not skipped)
            if (status === 403 && !options.skipTokenRefresh && retryCount === 0) {
                log.warn('Streaming request received 403, trying to refresh Token and retry...');
                const refreshed = await this.refreshAccessToken();
                if (refreshed) {
                    yield* this.chatStream(messages, model, options, retryCount + 1);
                    return;
                }
            }

            // 400 ValidationException - Try compressing context and retry
            const compressionLevel = options._compressionLevel || 0;
            if (status === 400 && this._isValidationException(error) && compressionLevel < 3) {
                const newCompressionLevel = compressionLevel + 1;
                log.warn(`Streaming request received 400 ValidationException, trying to compress context (level ${newCompressionLevel}) and retry...`);

                const compressedMessages = this._compressMessages(messages, newCompressionLevel);

                // If compressed message count unchanged, cannot compress further, throw error
                if (compressedMessages.length >= messages.length && newCompressionLevel > 1) {
                    log.error('Context cannot be compressed further, giving up retry');
                } else {
                    yield* this.chatStream(compressedMessages, model, { ...options, _compressionLevel: newCompressionLevel }, 0);
                    return;
                }
            }

            // 429 Too Many Requests - Exponential backoff retry
            if (status === 429 && retryCount < this.maxRetries) {
                const delay = this.baseDelay * Math.pow(2, retryCount);
                log.warn(`Streaming request received 429, retrying in ${delay}ms... (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.chatStream(messages, model, options, retryCount + 1);
                return;
            }

            // 5xx Server error - Retry
            if (status >= 500 && status < 600 && retryCount < this.maxRetries) {
                const delay = this.baseDelay * Math.pow(2, retryCount);
                log.warn(`Streaming request received ${status}, retrying in ${delay}ms... (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.chatStream(messages, model, options, retryCount + 1);
                return;
            }

            // Return custom error message, mask original AWS error details
            const customMessage = this._getCustomErrorMessage(error);
            const customError = new Error(customMessage);
            customError.status = status;
            throw customError;
        } finally {
            // Ensure stream is closed
            if (stream && typeof stream.destroy === 'function') {
                stream.destroy();
            }
        }
    }

    /**
     * Simplified streaming chat - Returns text content only (backward compatible)
     */
    async *chatStreamText(messages, model = KIRO_CONSTANTS.DEFAULT_MODEL_NAME, options = {}) {
        for await (const event of this.chatStream(messages, model, options)) {
            if (event.type === 'content') {
                yield event.content;
            }
        }
    }

    /**
     * Get supported model list
     */
    getModels() {
        return KIRO_MODELS;
    }

    /**
     * Get available model list from API
     */
    async listAvailableModels() {
        const url = buildCodeWhispererUrl(KIRO_CONSTANTS.LIST_MODELS_URL, this.region);

        const requestHeaders = {
            ...this.axiosInstance.defaults.headers,
            'Authorization': `Bearer ${this.accessToken}`,
            'amz-sdk-invocation-id': uuidv4()
        };
        const fullUrl = `${url}?origin=${KIRO_CONSTANTS.ORIGIN_AI_EDITOR}`;
        log.curl('GET', fullUrl, requestHeaders, null);

        const response = await this._callWithRetry(async () => {
            return await this.axiosInstance.get(url, {
                params: { origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR },
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'amz-sdk-invocation-id': uuidv4()
                }
            });
        });

        return response.data;
    }

    /**
     * Get usage limits
     */
    async getUsageLimits() {
        const url = buildCodeWhispererUrl(KIRO_CONSTANTS.USAGE_LIMITS_URL, this.region);

        // Build query parameters (reference AIClient-2-API)
        const params = new URLSearchParams({
            isEmailRequired: 'true',
            origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
            resourceType: 'AGENTIC_REQUEST'
        });

        if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL && this.profileArn) {
            params.append('profileArn', this.profileArn);
        }

        const requestHeaders = {
            ...this.axiosInstance.defaults.headers,
            'Authorization': `Bearer ${this.accessToken}`,
            'amz-sdk-invocation-id': uuidv4()
        };
        const fullUrl = `${url}?${params.toString()}`;
        log.curl('GET', fullUrl, requestHeaders, null);

        const response = await this._callWithRetry(async () => {
            return await this.axiosInstance.get(fullUrl, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'amz-sdk-invocation-id': uuidv4()
                }
            });
        });

        return response.data;
    }
}

export default KiroClient;
