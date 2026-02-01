/**
 * Kiro API Service - Reference implementation from AIClient-2-API
 */
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { KIRO_CONSTANTS, MODEL_MAPPING, KIRO_MODELS, buildCodeWhispererUrl, buildFallbackUrl } from '../constants.js';
import { logger } from '../logger.js';

const log = logger.client;

/**
 * LRU Cache for tool call/result tracking (Session Recovery)
 * Stores tool_use_id -> tool_result mapping for recovery from tool_result_missing errors
 */
class ToolResultCache {
    constructor(maxSize = 200) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    set(toolUseId, result) {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(toolUseId, result);
    }

    get(toolUseId) {
        if (!this.cache.has(toolUseId)) return null;
        const value = this.cache.get(toolUseId);
        // Move to end (LRU)
        this.cache.delete(toolUseId);
        this.cache.set(toolUseId, value);
        return value;
    }

    has(toolUseId) {
        return this.cache.has(toolUseId);
    }

    clear() {
        this.cache.clear();
    }
}

// Global tool result cache (shared across requests for session continuity)
const globalToolResultCache = new ToolResultCache(500);

function generateMachineId(credential) {
    const uniqueKey = credential.profileArn || credential.clientId || 'KIRO_DEFAULT';
    return crypto.createHash('sha256').update(uniqueKey).digest('hex');
}

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

export class KiroService {
    constructor(credential) {
        this.credential = credential;
        this.accessToken = credential.accessToken;
        this.refreshToken = credential.refreshToken;
        this.profileArn = credential.profileArn;
        this.clientId = credential.clientId;
        this.clientSecret = credential.clientSecret;
        this.authMethod = credential.authMethod || KIRO_CONSTANTS.AUTH_METHOD_SOCIAL;
        this.region = credential.region || KIRO_CONSTANTS.DEFAULT_REGION;
        this.expiresAt = credential.expiresAt;

        const httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
        });
        const httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
        });

        const machineId = generateMachineId(credential);
        const { osName, nodeVersion } = getSystemInfo();
        const kiroVersion = KIRO_CONSTANTS.KIRO_VERSION;

        const axiosConfig = {
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
            httpAgent,
            httpsAgent,
            headers: {
                'Content-Type': 'application/json',
                'Accept': KIRO_CONSTANTS.ACCEPT_JSON,
                'amz-sdk-request': 'attempt=1; max=1',
                'x-amzn-kiro-agent-mode': KIRO_CONSTANTS.AGENT_MODE || 'vibe',
                'x-amzn-codewhisperer-optout': 'true',
                'x-amz-user-agent': `aws-sdk-js/1.0.27 KiroIDE-${kiroVersion}-${machineId}`,
                'user-agent': `aws-sdk-js/1.0.27 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererstreaming#1.0.27 m/E KiroIDE-${kiroVersion}-${machineId}`,
                'Connection': 'close'
            },
        };

        this.axiosInstance = axios.create(axiosConfig);
        this.baseUrl = buildCodeWhispererUrl(KIRO_CONSTANTS.BASE_URL, this.region);
        this.fallbackUrl = buildFallbackUrl();
    }

    getContentText(message) {
        if (!message) return '';
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) {
            return message.filter(part => part.type === 'text' && part.text).map(part => part.text).join('');
        }
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.content)) {
            return message.content.filter(part => part.type === 'text' && part.text).map(part => part.text).join('');
        }
        return String(message.content || message);
    }

    /**
     * Compress message context (for 400 ValidationException retry)
     */
    _compressMessages(messages, compressionLevel = 1) {
        if (!messages || messages.length <= 3) {
            return messages;
        }

        const keepRecent = Math.max(2, 6 - compressionLevel * 2);
        const maxContentLength = Math.max(500, 2000 - compressionLevel * 500);

        log.warn(`[Context Compression] Level ${compressionLevel} | Original message count: ${messages.length} | Keeping recent: ${keepRecent}`);

        const firstMessage = messages[0];
        const recentMessages = messages.slice(-keepRecent);

        if (messages.length <= keepRecent + 1) {
            return this._truncateMessageContent(messages, maxContentLength);
        }

        const middleMessages = messages.slice(1, -keepRecent);
        let summaryText = `[Chat history compressed, total ${middleMessages.length} messages]`;

        if (compressionLevel === 1 && middleMessages.length > 0) {
            const summaries = middleMessages.slice(0, 3).map(msg => {
                const content = this.getContentText(msg);
                const truncated = content.length > 100 ? content.substring(0, 100) + '...' : content;
                return `[${msg.role}]: ${truncated}`;
            });
            if (middleMessages.length > 3) {
                summaries.push(`... omitted ${middleMessages.length - 3} messages ...`);
            }
            summaryText = summaries.join('\n');
        }

        const compressed = [
            firstMessage,
            { role: 'user', content: summaryText },
            { role: 'assistant', content: 'OK, I understand the previous conversation context.' },
            ...recentMessages
        ];

        const result = this._truncateMessageContent(compressed, maxContentLength);
        log.warn(`[Context Compression] Compressed message count: ${result.length}`);
        return result;
    }

    /**
     * Truncate message content
     */
    _truncateMessageContent(messages, maxLength) {
        return messages.map(msg => {
            const content = this.getContentText(msg);
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
     * Check if error is ValidationException
     */
    _isValidationException(error) {
        const errorType = error.response?.headers?.['x-amzn-errortype'] || '';
        return errorType.includes('ValidationException');
    }

    buildRequest(messages, model, options = {}) {
        const conversationId = uuidv4();
        const codewhispererModel = MODEL_MAPPING[model] || MODEL_MAPPING[KIRO_CONSTANTS.DEFAULT_MODEL_NAME] || model;

        let systemPrompt = '';
        if (options.system) {
            if (typeof options.system === 'string') {
                systemPrompt = options.system;
            } else if (Array.isArray(options.system)) {
                systemPrompt = options.system.map(item => typeof item === 'string' ? item : item.text).join('\n');
            }
        }

        // Merge adjacent messages with the same role
        const mergedMessages = [];
        for (const msg of messages) {
            if (mergedMessages.length === 0) {
                mergedMessages.push({ ...msg });
            } else {
                const lastMsg = mergedMessages[mergedMessages.length - 1];
                if (msg.role === lastMsg.role) {
                    if (Array.isArray(lastMsg.content) && Array.isArray(msg.content)) {
                        lastMsg.content.push(...msg.content);
                    } else if (typeof lastMsg.content === 'string' && typeof msg.content === 'string') {
                        lastMsg.content += '\n' + msg.content;
                    } else {
                        mergedMessages.push({ ...msg });
                    }
                } else {
                    mergedMessages.push({ ...msg });
                }
            }
        }

        let toolsContext = {};
        let toolDocumentation = '';
        if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
            // Filter out Bash tool
            const filteredTools = options.tools.filter(tool => tool.name !== 'Bash');
            if (filteredTools.length > 0) {
                const maxDescLength = KIRO_CONSTANTS.TOOL_DESCRIPTION_MAX_LENGTH || 10000;
                const processedTools = [];

                for (const tool of filteredTools) {
                    const description = tool.description || "";
                    // Ensure input_schema is a valid object with required fields
                    let inputSchema = tool.input_schema;
                    if (!inputSchema || typeof inputSchema !== 'object') {
                        inputSchema = { type: 'object', properties: {} };
                    }

                    if (description.length > maxDescLength) {
                        // Move long description to system prompt
                        toolDocumentation += `\n\n---\n## Tool: ${tool.name}\n\n${description}`;
                        processedTools.push({
                            toolSpecification: {
                                name: tool.name,
                                description: `[Full documentation in system prompt under '## Tool: ${tool.name}']`,
                                inputSchema: { json: inputSchema }
                            }
                        });
                        log.info(`[KiroService] Tool '${tool.name}' description too long (${description.length} > ${maxDescLength}), moved to system prompt`);
                    } else {
                        processedTools.push({
                            toolSpecification: {
                                name: tool.name,
                                description: description,
                                inputSchema: { json: inputSchema }
                            }
                        });
                    }
                }

                toolsContext = { tools: processedTools };
            }
        }

        // Append tool documentation to system prompt if any
        if (toolDocumentation) {
            const docHeader = "\n\n---\n# Tool Documentation\nThe following tools have detailed documentation that couldn't fit in the tool definition.";
            systemPrompt = systemPrompt + docHeader + toolDocumentation;
        }

        const history = [];
        let startIndex = 0;

        if (systemPrompt) {
            if (mergedMessages[0]?.role === 'user') {
                const firstUserContent = this.getContentText(mergedMessages[0]);
                history.push({
                    userInputMessage: {
                        content: `${systemPrompt}\n\n${firstUserContent}`,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    }
                });
                startIndex = 1;
            } else {
                history.push({
                    userInputMessage: {
                        content: systemPrompt,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    }
                });
            }
        }

        for (let i = startIndex; i < mergedMessages.length - 1; i++) {
            const message = mergedMessages[i];
            if (message.role === 'user') {
                history.push({ userInputMessage: this._buildUserInputMessage(message, codewhispererModel) });
            } else if (message.role === 'assistant') {
                history.push({ assistantResponseMessage: this._buildAssistantResponseMessage(message) });
            }
        }

        let currentMessage = mergedMessages[mergedMessages.length - 1];
        let currentContent = '';
        let currentToolResults = [];
        let currentImages = [];

        if (currentMessage?.role === 'assistant') {
            history.push({ assistantResponseMessage: this._buildAssistantResponseMessage(currentMessage) });
            currentContent = 'Continue';
        } else if (currentMessage) {
            if (history.length > 0 && !history[history.length - 1].assistantResponseMessage) {
                history.push({ assistantResponseMessage: { content: 'Continue' } });
            }

            if (Array.isArray(currentMessage.content)) {
                for (const part of currentMessage.content) {
                    if (part.type === 'text') {
                        currentContent += part.text;
                    } else if (part.type === 'tool_result') {
                        const toolResult = {
                            content: [{ text: this.getContentText(part.content) }],
                            status: part.is_error ? 'error' : 'success',
                            toolUseId: part.tool_use_id
                        };
                        currentToolResults.push(toolResult);
                        // Cache tool result for session recovery
                        if (part.tool_use_id) {
                            globalToolResultCache.set(part.tool_use_id, {
                                type: 'tool_result',
                                tool_use_id: part.tool_use_id,
                                content: part.content,
                                is_error: part.is_error
                            });
                        }
                    } else if (part.type === 'image') {
                        currentImages.push({
                            format: part.source.media_type.split('/')[1],
                            source: { bytes: part.source.data }
                        });
                    }
                }
            } else {
                currentContent = this.getContentText(currentMessage);
            }

            if (!currentContent) {
                currentContent = currentToolResults.length > 0 ? 'Tool results provided.' : 'Continue';
            }
        } else {
            currentContent = 'Continue';
        }

        const userInputMessage = {
            content: currentContent,
            modelId: codewhispererModel,
            origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
        };

        if (currentImages.length > 0) {
            userInputMessage.images = currentImages;
        }

        const userInputMessageContext = {};
        if (currentToolResults.length > 0) {
            const uniqueToolResults = [];
            const seenIds = new Set();
            for (const tr of currentToolResults) {
                if (!seenIds.has(tr.toolUseId)) {
                    seenIds.add(tr.toolUseId);
                    uniqueToolResults.push(tr);
                }
            }
            userInputMessageContext.toolResults = uniqueToolResults;
        }
        if (toolsContext.tools) {
            userInputMessageContext.tools = toolsContext.tools;
        }

        if (Object.keys(userInputMessageContext).length > 0) {
            userInputMessage.userInputMessageContext = userInputMessageContext;
        }

        const request = {
            conversationState: {
                chatTriggerType: KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL,
                conversationId,
                currentMessage: { userInputMessage }
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

    _buildUserInputMessage(msg, codewhispererModel) {
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
                    userInputMessage.content += part.text;
                } else if (part.type === 'tool_result') {
                    toolResults.push({
                        content: [{ text: this.getContentText(part.content) }],
                        status: part.is_error ? 'error' : 'success',
                        toolUseId: part.tool_use_id
                    });
                } else if (part.type === 'image') {
                    images.push({
                        format: part.source.media_type.split('/')[1],
                        source: { bytes: part.source.data }
                    });
                }
            }
        } else {
            userInputMessage.content = this.getContentText(msg);
        }

        if (!userInputMessage.content) {
            userInputMessage.content = toolResults.length > 0 ? 'Tool results provided.' : 'Continue';
        }

        if (images.length > 0) {
            userInputMessage.images = images;
        }
        if (toolResults.length > 0) {
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

    _buildAssistantResponseMessage(msg) {
        const assistantResponseMessage = { content: '' };
        let toolUses = [];

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text') {
                    assistantResponseMessage.content += part.text;
                } else if (part.type === 'tool_use') {
                    toolUses.push({
                        input: part.input,
                        name: part.name,
                        toolUseId: part.id
                    });
                }
            }
        } else {
            assistantResponseMessage.content = this.getContentText(msg);
        }

        if (toolUses.length > 0) {
            assistantResponseMessage.toolUses = toolUses;
        }

        return assistantResponseMessage;
    }

    parseEventStreamBuffer(buffer) {
        const events = [];
        let remaining = buffer;
        let searchStart = 0;

        while (true) {
            const contentStart = remaining.indexOf('{"content":', searchStart);
            const nameStart = remaining.indexOf('{"name":', searchStart);
            const followupStart = remaining.indexOf('{"followupPrompt":', searchStart);
            const inputStart = remaining.indexOf('{"input":', searchStart);
            const stopStart = remaining.indexOf('{"stop":', searchStart);
            const usageStart = remaining.indexOf('{"usage":', searchStart);

            const candidates = [contentStart, nameStart, followupStart, inputStart, stopStart, usageStart].filter(pos => pos >= 0);
            if (candidates.length === 0) break;

            const jsonStart = Math.min(...candidates);
            if (jsonStart < 0) break;

            let braceCount = 0;
            let jsonEnd = -1;
            let inString = false;
            let escapeNext = false;

            for (let i = jsonStart; i < remaining.length; i++) {
                const char = remaining[i];
                if (escapeNext) { escapeNext = false; continue; }
                if (char === '\\') { escapeNext = true; continue; }
                if (char === '"') { inString = !inString; continue; }
                if (!inString) {
                    if (char === '{') braceCount++;
                    else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) { jsonEnd = i; break; }
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
                } else if (parsed.name && parsed.toolUseId) {
                    events.push({
                        type: 'toolUse',
                        data: { name: parsed.name, toolUseId: parsed.toolUseId, input: parsed.input || '', stop: parsed.stop || false }
                    });
                } else if (parsed.input !== undefined && !parsed.name) {
                    events.push({ type: 'toolUseInput', data: { input: parsed.input } });
                } else if (parsed.stop !== undefined) {
                    events.push({ type: 'toolUseStop', data: { stop: parsed.stop } });
                } else if (parsed.usage !== undefined) {
                    events.push({ type: 'usage', data: parsed.usage });
                }
            } catch (e) { }

            searchStart = jsonEnd + 1;
            if (searchStart >= remaining.length) { remaining = ''; break; }
        }

        if (searchStart > 0 && remaining.length > 0) {
            remaining = remaining.substring(searchStart);
        }

        return { events, remaining };
    }

    async *generateContentStream(model, requestBody, compressionLevel = 0) {
        // If compression needed, compress messages first
        let messages = requestBody.messages;
        if (compressionLevel > 0) {
            messages = this._compressMessages(requestBody.messages, compressionLevel);
        }

        const requestData = this.buildRequest(messages, model, {
            system: requestBody.system,
            tools: requestBody.tools
        });

        const headers = {
            ...this.axiosInstance.defaults.headers.common,
            'Authorization': `Bearer ${this.accessToken}`,
            'amz-sdk-invocation-id': uuidv4(),
        };
        log.curl('POST', this.baseUrl, headers, requestData);

        let stream = null;
        let retryCount = 0;
        const maxRetries = 3;
        const baseDelay = 1000;
        let currentUrl = this.baseUrl;
        let usedFallback = false;

        while (retryCount <= maxRetries) {
            try {
                const response = await this.axiosInstance.post(currentUrl, requestData, {
                    headers,
                    responseType: 'stream'
                });

                stream = response.data;
                let buffer = '';
                let lastContentEvent = null;
                let currentToolCall = null;

                for await (const chunk of stream) {
                    buffer += chunk.toString();
                    const { events, remaining } = this.parseEventStreamBuffer(buffer);
                    buffer = remaining;

                    for (const event of events) {
                        if (event.type === 'content' && event.data) {
                            if (lastContentEvent === event.data) continue;
                            lastContentEvent = event.data;
                            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: event.data } };
                        } else if (event.type === 'toolUse') {
                            const tc = event.data;
                            if (tc.name && tc.toolUseId) {
                                if (currentToolCall && currentToolCall.toolUseId === tc.toolUseId) {
                                    currentToolCall.input += tc.input || '';
                                } else {
                                    if (currentToolCall) {
                                        yield { type: 'tool_use', toolUse: this._finalizeToolCall(currentToolCall) };
                                    }
                                    currentToolCall = { toolUseId: tc.toolUseId, name: tc.name, input: tc.input || '' };
                                }
                                if (tc.stop) {
                                    yield { type: 'tool_use', toolUse: this._finalizeToolCall(currentToolCall) };
                                    currentToolCall = null;
                                }
                            }
                        } else if (event.type === 'toolUseInput') {
                            if (currentToolCall) currentToolCall.input += event.data.input || '';
                        } else if (event.type === 'toolUseStop') {
                            if (currentToolCall && event.data.stop) {
                                yield { type: 'tool_use', toolUse: this._finalizeToolCall(currentToolCall) };
                                currentToolCall = null;
                            }
                        } else if (event.type === 'usage') {
                            yield { type: 'usage', usage: event.data };
                        }
                    }
                }

                if (currentToolCall) {
                    yield { type: 'tool_use', toolUse: this._finalizeToolCall(currentToolCall) };
                }
                return;

            } catch (error) {
                if (stream && typeof stream.destroy === 'function') stream.destroy();

                const status = error.response?.status;
                const errorData = error.response?.data;
                const errorStr = typeof errorData === 'string' ? errorData : JSON.stringify(errorData || '');

                // Session Recovery: Handle tool_result_missing error
                if (status === 400 && errorStr.includes('tool_result_missing')) {
                    const missingToolId = this._extractMissingToolId(errorStr);
                    if (missingToolId) {
                        log.warn(`[KiroService] Session recovery: tool_result_missing for ${missingToolId}`);
                        const cachedResult = globalToolResultCache.get(missingToolId);
                        const recoveryMessages = this._injectToolResult(requestBody.messages, missingToolId, cachedResult);
                        if (recoveryMessages) {
                            log.info(`[KiroService] Retrying with recovered tool_result for ${missingToolId}`);
                            const recoveredRequestBody = { ...requestBody, messages: recoveryMessages };
                            yield* this.generateContentStream(model, recoveredRequestBody, compressionLevel);
                            return;
                        }
                    }
                }

                // 400 ValidationException - Try compressing context and retry
                if (status === 400 && this._isValidationException(error) && compressionLevel < 3) {
                    const newLevel = compressionLevel + 1;
                    log.warn(`[KiroService] Streaming request received 400 ValidationException, compressing context (level ${newLevel}) and retry...`);
                    yield* this.generateContentStream(model, requestBody, newLevel);
                    return;
                }

                if ((status === 429 || (status >= 500 && status < 600)) && retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    console.log(`[KiroService] Received ${status}, retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    retryCount++;
                    continue;
                }

                // Try fallback to CodeWhisperer endpoint if Q endpoint fails with 5xx or connection error
                if (!usedFallback && (status >= 500 || !status)) {
                    console.log(`[KiroService] Q endpoint failed (${status || 'connection error'}), trying CodeWhisperer fallback...`);
                    currentUrl = this.fallbackUrl;
                    usedFallback = true;
                    retryCount = 0;
                    continue;
                }

                let errorMessage = error.message;
                if (error.response) {
                    errorMessage = `Request failed with status code ${status}`;
                    const errorType = error.response.headers?.['x-amzn-errortype'];
                    const requestId = error.response.headers?.['x-amzn-requestid'];
                    if (errorType) errorMessage += ` | ErrorType: ${errorType}`;
                    if (requestId) errorMessage += ` | RequestId: ${requestId}`;
                }

                const enhancedError = new Error(errorMessage);
                enhancedError.status = status;
                throw enhancedError;
            } finally {
                if (stream && typeof stream.destroy === 'function') stream.destroy();
            }
        }
    }

    async generateContent(model, requestBody, compressionLevel = 0) {
        // If compression needed, compress messages first
        let messages = requestBody.messages;
        if (compressionLevel > 0) {
            messages = this._compressMessages(requestBody.messages, compressionLevel);
        }

        const requestData = this.buildRequest(messages, model, {
            system: requestBody.system,
            tools: requestBody.tools
        });

        const headers = {
            'Authorization': `Bearer ${this.accessToken}`,
            'amz-sdk-invocation-id': uuidv4(),
        };

        let retryCount = 0;
        const maxRetries = 3;
        const baseDelay = 1000;
        let currentUrl = this.baseUrl;
        let usedFallback = false;

        while (retryCount <= maxRetries) {
            try {
                const response = await this.axiosInstance.post(currentUrl, requestData, { headers });
                const rawStr = Buffer.isBuffer(response.data) ? response.data.toString('utf8') : String(response.data);

                let fullContent = '';
                const toolCalls = [];
                let currentToolCall = null;
                let usage = null;

                const { events } = this.parseEventStreamBuffer(rawStr);
                for (const event of events) {
                    if (event.type === 'content') {
                        fullContent += event.data;
                    } else if (event.type === 'toolUse') {
                        const tc = event.data;
                        if (tc.name && tc.toolUseId) {
                            if (currentToolCall && currentToolCall.toolUseId === tc.toolUseId) {
                                currentToolCall.input += tc.input || '';
                            } else {
                                if (currentToolCall) toolCalls.push(this._finalizeToolCall(currentToolCall));
                                currentToolCall = { toolUseId: tc.toolUseId, name: tc.name, input: tc.input || '' };
                            }
                            if (tc.stop) {
                                toolCalls.push(this._finalizeToolCall(currentToolCall));
                                currentToolCall = null;
                            }
                        }
                    } else if (event.type === 'toolUseInput') {
                        if (currentToolCall) currentToolCall.input += event.data.input || '';
                    } else if (event.type === 'toolUseStop') {
                        if (currentToolCall && event.data.stop) {
                            toolCalls.push(this._finalizeToolCall(currentToolCall));
                            currentToolCall = null;
                        }
                    } else if (event.type === 'usage') {
                        usage = event.data;
                    }
                }

                if (currentToolCall) toolCalls.push(this._finalizeToolCall(currentToolCall));
                return { content: fullContent, toolCalls, usage };

            } catch (error) {
                const status = error.response?.status;
                const errorData = error.response?.data;
                const errorStr = typeof errorData === 'string' ? errorData : JSON.stringify(errorData || '');

                // Session Recovery: Handle tool_result_missing error
                if (status === 400 && errorStr.includes('tool_result_missing')) {
                    const missingToolId = this._extractMissingToolId(errorStr);
                    if (missingToolId) {
                        log.warn(`[KiroService] Session recovery (non-stream): tool_result_missing for ${missingToolId}`);
                        const cachedResult = globalToolResultCache.get(missingToolId);
                        const recoveryMessages = this._injectToolResult(requestBody.messages, missingToolId, cachedResult);
                        if (recoveryMessages) {
                            log.info(`[KiroService] Retrying with recovered tool_result for ${missingToolId}`);
                            const recoveredRequestBody = { ...requestBody, messages: recoveryMessages };
                            return this.generateContent(model, recoveredRequestBody, compressionLevel);
                        }
                    }
                }

                // 400 ValidationException - Try compressing context and retry
                if (status === 400 && this._isValidationException(error) && compressionLevel < 3) {
                    const newLevel = compressionLevel + 1;
                    log.warn(`[KiroService] Non-streaming request received 400 ValidationException, compressing context (level ${newLevel}) and retry...`);
                    return this.generateContent(model, requestBody, newLevel);
                }

                if ((status === 429 || (status >= 500 && status < 600)) && retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    console.log(`[KiroService] Received ${status}, retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    retryCount++;
                    continue;
                }

                // Try fallback to CodeWhisperer endpoint if Q endpoint fails with 5xx or connection error
                if (!usedFallback && (status >= 500 || !status)) {
                    console.log(`[KiroService] Q endpoint failed (${status || 'connection error'}), trying CodeWhisperer fallback...`);
                    currentUrl = this.fallbackUrl;
                    usedFallback = true;
                    retryCount = 0;
                    continue;
                }

                let errorMessage = error.message;
                if (error.response) {
                    errorMessage = `Request failed with status code ${status}`;
                    const errorType = error.response.headers?.['x-amzn-errortype'];
                    const requestId = error.response.headers?.['x-amzn-requestid'];
                    if (errorType) errorMessage += ` | ErrorType: ${errorType}`;
                    if (requestId) errorMessage += ` | RequestId: ${requestId}`;
                }

                const enhancedError = new Error(errorMessage);
                enhancedError.status = status;
                throw enhancedError;
            }
        }
    }

    _finalizeToolCall(toolCall) {
        let input = toolCall.input;
        try { input = JSON.parse(toolCall.input); } catch (e) { }

        // Check for Write/Create tool truncation (content field missing or empty)
        if (this._isWriteToolTruncated(toolCall.name, input)) {
            return this._createTruncatedWriteError(toolCall, input);
        }

        return { toolUseId: toolCall.toolUseId, name: toolCall.name, input };
    }

    /**
     * Check if Write/Create tool input was truncated by Kiro API
     * This happens when file content is too large to transmit
     */
    _isWriteToolTruncated(toolName, input) {
        const writeTools = ['Write', 'write', 'Create', 'create', 'write_file', 'create_file'];
        if (!writeTools.includes(toolName)) return false;

        // Check for truncation scenarios:
        // 1. Empty input (no input transmitted at all)
        if (!input || (typeof input === 'string' && input.trim() === '')) {
            return true;
        }

        // 2. Object with file_path but no content field
        if (typeof input === 'object') {
            const hasPath = input.file_path || input.path || input.filename;
            const hasContent = input.content !== undefined && input.content !== null && input.content !== '';
            if (hasPath && !hasContent) {
                return true;
            }
        }

        return false;
    }

    /**
     * Create a Bash tool that echoes error message for truncated Write tool
     * This allows Claude Code to see the error and retry with smaller chunks
     */
    _createTruncatedWriteError(toolCall, input) {
        const filePath = typeof input === 'object' ? (input.file_path || input.path || input.filename || '') : '';

        let errorMsg;
        if (filePath) {
            errorMsg = `echo '[WRITE TOOL ERROR] The file content for "${filePath}" is too large to be transmitted by the upstream API. You MUST retry by writing the file in smaller chunks: First use Write to create the file with the first 700 lines, then use multiple Edit operations to append the remaining content in chunks of ~700 lines each.'`;
        } else {
            errorMsg = `echo '[WRITE TOOL ERROR] The file content is too large to be transmitted by the upstream API. The Write tool input was truncated. You MUST retry by writing the file in smaller chunks: First use Write to create the file with the first 700 lines, then use multiple Edit operations to append the remaining content in chunks of ~700 lines each.'`;
        }

        log.warn(`[KiroService] Write tool truncated for file: ${filePath || 'unknown'}, converting to Bash error`);

        return {
            toolUseId: toolCall.toolUseId,
            name: 'Bash',
            input: { command: errorMsg }
        };
    }

    listModels() {
        return { models: KIRO_MODELS.map(id => ({ name: id })) };
    }

    /**
     * Extract missing tool_use_id from error message
     * Error format: "tool_result_missing: expected tool_result for tool_use_id 'toolu_xxx'"
     */
    _extractMissingToolId(errorMessage) {
        // Try various patterns
        const patterns = [
            /tool_use_id['":\s]+['"]?([a-zA-Z0-9_-]+)['"]?/i,
            /tool_result_missing.*?(['"])(toolu_[a-zA-Z0-9_-]+)\1/i,
            /(toolu_[a-zA-Z0-9_-]+)/i
        ];

        for (const pattern of patterns) {
            const match = errorMessage.match(pattern);
            if (match) {
                return match[2] || match[1];
            }
        }
        return null;
    }

    /**
     * Inject a tool_result for the missing tool_use_id into messages
     * Uses cached result if available, otherwise creates a placeholder
     */
    _injectToolResult(messages, toolUseId, cachedResult) {
        if (!messages || !Array.isArray(messages)) return null;

        // Deep clone messages
        const newMessages = JSON.parse(JSON.stringify(messages));

        // Find the assistant message with the tool_use
        let toolUseFound = false;
        let insertIndex = -1;

        for (let i = 0; i < newMessages.length; i++) {
            const msg = newMessages[i];
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    if (block.type === 'tool_use' && block.id === toolUseId) {
                        toolUseFound = true;
                        insertIndex = i + 1;
                        break;
                    }
                }
            }
            if (toolUseFound) break;
        }

        if (!toolUseFound) {
            // Tool use not found in history, append result at appropriate position
            insertIndex = newMessages.length;
        }

        // Create tool_result
        const toolResult = cachedResult ? {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: cachedResult.content || '[Result recovered from cache]',
            is_error: cachedResult.is_error || false
        } : {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: '[Tool result unavailable - context was compacted. Please proceed with available information.]',
            is_error: false
        };

        // Check if there's already a user message at insertIndex
        if (insertIndex < newMessages.length && newMessages[insertIndex]?.role === 'user') {
            // Prepend tool_result to existing user message
            const userMsg = newMessages[insertIndex];
            if (Array.isArray(userMsg.content)) {
                userMsg.content.unshift(toolResult);
            } else {
                userMsg.content = [toolResult, { type: 'text', text: userMsg.content || '' }];
            }
        } else {
            // Insert new user message with tool_result
            newMessages.splice(insertIndex, 0, {
                role: 'user',
                content: [toolResult]
            });
        }

        log.debug(`[KiroService] Injected tool_result for ${toolUseId} at index ${insertIndex}, cached: ${!!cachedResult}`);
        return newMessages;
    }
}

// Export cache for external access (e.g., clearing on session end)
export { globalToolResultCache };

export default KiroService;
