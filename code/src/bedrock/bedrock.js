/**
 * Amazon Bedrock Client
 * Access Claude models through AWS Bedrock
 */
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../logger.js';
import { BEDROCK_CONSTANTS, BEDROCK_MODEL_MAPPING, BEDROCK_MODELS } from '../constants.js';

const log = logger.api;

/**
 * AWS Signature V4 Signing Utility
 */
class AwsSignatureV4 {
    constructor(options) {
        this.accessKeyId = options.accessKeyId;
        this.secretAccessKey = options.secretAccessKey;
        this.sessionToken = options.sessionToken;
        this.region = options.region || 'us-east-1';
        this.service = options.service || 'bedrock';
    }

    /**
     * Sign request
     */
    sign(request) {
        const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
        const date = datetime.slice(0, 8);

        // Prepare request headers
        const headers = {
            ...request.headers,
            'host': new URL(request.url).host,
            'x-amz-date': datetime
        };

        // If session token exists, add to request headers
        if (this.sessionToken) {
            headers['x-amz-security-token'] = this.sessionToken;
        }

        // Calculate payload hash
        const payloadHash = this._hash(request.body || '');
        headers['x-amz-content-sha256'] = payloadHash;

        // Create canonical request
        const canonicalRequest = this._createCanonicalRequest(request.method, request.url, headers, payloadHash);

        // Create string to sign
        const credentialScope = `${date}/${this.region}/${this.service}/aws4_request`;
        const stringToSign = this._createStringToSign(datetime, credentialScope, canonicalRequest);

        // Calculate signature
        const signingKey = this._getSignatureKey(date);
        const signature = this._hmac(signingKey, stringToSign).toString('hex');

        // Build authorization header
        const signedHeaders = Object.keys(headers)
            .map(k => k.toLowerCase())
            .sort()
            .join(';');

        const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        return {
            ...headers,
            'Authorization': authorizationHeader
        };
    }

    _createCanonicalRequest(method, url, headers, payloadHash) {
        const parsedUrl = new URL(url);
        const canonicalUri = parsedUrl.pathname || '/';
        const canonicalQuerystring = parsedUrl.searchParams.toString();

        // Normalize headers
        const sortedHeaders = Object.keys(headers)
            .map(k => k.toLowerCase())
            .sort();

        const canonicalHeaders = sortedHeaders
            .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)].trim()}`)
            .join('\n') + '\n';

        const signedHeaders = sortedHeaders.join(';');

        return [
            method,
            canonicalUri,
            canonicalQuerystring,
            canonicalHeaders,
            signedHeaders,
            payloadHash
        ].join('\n');
    }

    _createStringToSign(datetime, credentialScope, canonicalRequest) {
        return [
            'AWS4-HMAC-SHA256',
            datetime,
            credentialScope,
            this._hash(canonicalRequest)
        ].join('\n');
    }

    _getSignatureKey(date) {
        const kDate = this._hmac(`AWS4${this.secretAccessKey}`, date);
        const kRegion = this._hmac(kDate, this.region);
        const kService = this._hmac(kRegion, this.service);
        const kSigning = this._hmac(kService, 'aws4_request');
        return kSigning;
    }

    _hash(data) {
        return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
    }

    _hmac(key, data) {
        return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
    }
}

/**
 * Amazon Bedrock Client Class
 */
export class BedrockClient {
    /**
     * @param {Object} options - Configuration options
     * @param {string} options.accessKeyId - AWS Access Key ID
     * @param {string} options.secretAccessKey - AWS Secret Access Key
     * @param {string} options.sessionToken - AWS Session Token (optional)
     * @param {string} options.region - AWS Region (default us-east-1)
     */
    constructor(options = {}) {
        if (!options.accessKeyId || !options.secretAccessKey) {
            throw new Error('accessKeyId and secretAccessKey are required');
        }

        this.accessKeyId = options.accessKeyId;
        this.secretAccessKey = options.secretAccessKey;
        this.sessionToken = options.sessionToken;
        this.region = options.region || BEDROCK_CONSTANTS.DEFAULT_REGION;

        this.signer = new AwsSignatureV4({
            accessKeyId: this.accessKeyId,
            secretAccessKey: this.secretAccessKey,
            sessionToken: this.sessionToken,
            region: this.region,
            service: 'bedrock'
        });

        this.axiosInstance = axios.create({
            timeout: BEDROCK_CONSTANTS.AXIOS_TIMEOUT
        });
    }

    /**
     * Create client from credentials object
     */
    static fromCredentials(credentials, region) {
        return new BedrockClient({
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
            region: region || credentials.region
        });
    }

    /**
     * Get Bedrock Runtime API URL
     */
    _getApiUrl(modelId, stream = false) {
        const bedrockModel = BEDROCK_MODEL_MAPPING[modelId] || modelId;
        const baseUrl = BEDROCK_CONSTANTS.RUNTIME_ENDPOINT.replace('{{region}}', this.region);
        const path = stream
            ? BEDROCK_CONSTANTS.CONVERSE_STREAM_PATH.replace('{{modelId}}', encodeURIComponent(bedrockModel))
            : BEDROCK_CONSTANTS.CONVERSE_PATH.replace('{{modelId}}', encodeURIComponent(bedrockModel));
        return `${baseUrl}${path}`;
    }

    /**
     * Get supported model list
     */
    getModels() {
        return BEDROCK_MODELS;
    }

    /**
     * Get model mapping
     */
    getModelMapping() {
        return BEDROCK_MODEL_MAPPING;
    }

    /**
     * Convert Claude API format messages to Bedrock Converse format
     */
    _convertToBedrockMessages(messages) {
        return messages.map(msg => {
            const content = [];

            if (typeof msg.content === 'string') {
                content.push({ text: msg.content });
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        content.push({ text: part.text });
                    } else if (part.type === 'image') {
                        // Handle image
                        if (part.source?.type === 'base64') {
                            content.push({
                                image: {
                                    format: part.source.media_type?.split('/')[1] || 'png',
                                    source: {
                                        bytes: part.source.data
                                    }
                                }
                            });
                        }
                    } else if (part.type === 'tool_use') {
                        content.push({
                            toolUse: {
                                toolUseId: part.id,
                                name: part.name,
                                input: part.input
                            }
                        });
                    } else if (part.type === 'tool_result') {
                        content.push({
                            toolResult: {
                                toolUseId: part.tool_use_id,
                                content: [{ text: typeof part.content === 'string' ? part.content : JSON.stringify(part.content) }],
                                status: part.is_error ? 'error' : 'success'
                            }
                        });
                    }
                }
            }

            return {
                role: msg.role,
                content
            };
        });
    }

    /**
     * Convert request to Bedrock Converse format
     */
    _convertRequest(messages, model, options = {}) {
        const bedrockMessages = this._convertToBedrockMessages(messages);

        const request = {
            messages: bedrockMessages
        };

        // Add system prompt
        if (options.system) {
            const systemText = typeof options.system === 'string'
                ? options.system
                : (Array.isArray(options.system) ? options.system.map(s => s.text || s).join('\n') : String(options.system));
            request.system = [{ text: systemText }];
        }

        // Add inference configuration
        const inferenceConfig = {};
        if (options.max_tokens) {
            inferenceConfig.maxTokens = options.max_tokens;
        }
        if (options.temperature !== undefined) {
            inferenceConfig.temperature = options.temperature;
        }
        if (options.top_p !== undefined) {
            inferenceConfig.topP = options.top_p;
        }
        if (options.stop_sequences) {
            inferenceConfig.stopSequences = options.stop_sequences;
        }
        if (Object.keys(inferenceConfig).length > 0) {
            request.inferenceConfig = inferenceConfig;
        }

        // Add tool definitions
        if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
            request.toolConfig = {
                tools: options.tools.map(tool => ({
                    toolSpec: {
                        name: tool.name,
                        description: tool.description || '',
                        inputSchema: {
                            json: tool.input_schema || { type: 'object', properties: {} }
                        }
                    }
                }))
            };
        }

        return request;
    }

    /**
     * Convert Bedrock response to Claude API format
     */
    _convertResponse(response, model) {
        const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);

        const content = [];
        if (response.output?.message?.content) {
            for (const part of response.output.message.content) {
                if (part.text) {
                    content.push({ type: 'text', text: part.text });
                } else if (part.toolUse) {
                    content.push({
                        type: 'tool_use',
                        id: part.toolUse.toolUseId,
                        name: part.toolUse.name,
                        input: part.toolUse.input
                    });
                }
            }
        }

        const inputTokens = response.usage?.inputTokens || 0;
        const outputTokens = response.usage?.outputTokens || 0;

        // Convert stop reason
        let stopReason = 'end_turn';
        if (response.stopReason) {
            if (response.stopReason === 'tool_use') stopReason = 'tool_use';
            else if (response.stopReason === 'max_tokens') stopReason = 'max_tokens';
            else if (response.stopReason === 'stop_sequence') stopReason = 'stop_sequence';
        }

        return {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content,
            model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens
            }
        };
    }

    /**
     * Send signed request
     */
    async _sendSignedRequest(url, body, stream = false) {
        const bodyStr = JSON.stringify(body);

        const signedHeaders = this.signer.sign({
            method: 'POST',
            url,
            headers: {
                'Content-Type': 'application/json',
                'Accept': stream ? 'application/vnd.amazon.eventstream' : 'application/json'
            },
            body: bodyStr
        });

        const config = {
            headers: signedHeaders
        };

        if (stream) {
            config.responseType = 'stream';
        }

        return await this.axiosInstance.post(url, body, config);
    }

    /**
     * Chat (non-streaming)
     */
    async chat(messages, model = BEDROCK_CONSTANTS.DEFAULT_MODEL, options = {}) {
        const url = this._getApiUrl(model, false);
        const requestData = this._convertRequest(messages, model, options);

        log.info(`Bedrock request: ${url}`);
        log.debug(`Request data: ${JSON.stringify(requestData).substring(0, 500)}...`);

        try {
            const response = await this._sendSignedRequest(url, requestData, false);
            return this._convertResponse(response.data, model);
        } catch (error) {
            log.error(`Bedrock request failed: ${error.message}`);
            if (error.response) {
                log.error(`Response status: ${error.response.status}`);
                log.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    /**
     * Chat (streaming)
     */
    async *chatStream(messages, model = BEDROCK_CONSTANTS.DEFAULT_MODEL, options = {}) {
        const url = this._getApiUrl(model, true);
        const requestData = this._convertRequest(messages, model, options);

        log.info(`Bedrock streaming request: ${url}`);
        log.debug(`Request data: ${JSON.stringify(requestData).substring(0, 500)}...`);

        const response = await this._sendSignedRequest(url, requestData, true);

        let buffer = Buffer.alloc(0);

        for await (const chunk of response.data) {
            buffer = Buffer.concat([buffer, chunk]);

            // Parse AWS Event Stream format
            while (buffer.length >= 16) {
                // Read message length (first 4 bytes)
                const totalLength = buffer.readUInt32BE(0);
                
                if (buffer.length < totalLength) {
                    break; // Wait for more data
                }

                // Extract complete message
                const messageBuffer = buffer.slice(0, totalLength);
                buffer = buffer.slice(totalLength);

                // Parse message
                const event = this._parseEventStreamMessage(messageBuffer);
                if (event) {
                    yield event;
                }
            }
        }
    }

    /**
     * Parse AWS Event Stream message
     */
    _parseEventStreamMessage(buffer) {
        try {
            // AWS Event Stream format:
            // 4 bytes: total length
            // 4 bytes: headers length
            // 4 bytes: prelude CRC
            // variable: headers
            // variable: payload
            // 4 bytes: message CRC

            const headersLength = buffer.readUInt32BE(4);
            const headersStart = 12;
            const payloadStart = headersStart + headersLength;
            const payloadEnd = buffer.length - 4;

            if (payloadStart >= payloadEnd) {
                return null;
            }

            const payload = buffer.slice(payloadStart, payloadEnd).toString('utf8');
            
            if (!payload) {
                return null;
            }

            try {
                const parsed = JSON.parse(payload);
                
                // Handle different event types
                if (parsed.contentBlockDelta?.delta?.text) {
                    return {
                        type: 'content_block_delta',
                        delta: { type: 'text_delta', text: parsed.contentBlockDelta.delta.text }
                    };
                }
                
                if (parsed.contentBlockStart?.contentBlock?.toolUse) {
                    return {
                        type: 'content_block_start',
                        content_block: {
                            type: 'tool_use',
                            id: parsed.contentBlockStart.contentBlock.toolUse.toolUseId,
                            name: parsed.contentBlockStart.contentBlock.toolUse.name,
                            input: ''
                        }
                    };
                }

                if (parsed.contentBlockDelta?.delta?.toolUse) {
                    return {
                        type: 'content_block_delta',
                        delta: {
                            type: 'input_json_delta',
                            partial_json: parsed.contentBlockDelta.delta.toolUse.input || ''
                        }
                    };
                }
                
                if (parsed.metadata?.usage) {
                    return {
                        type: 'message_delta',
                        usage: {
                            input_tokens: parsed.metadata.usage.inputTokens || 0,
                            output_tokens: parsed.metadata.usage.outputTokens || 0
                        }
                    };
                }

                if (parsed.messageStop) {
                    return {
                        type: 'message_stop',
                        stop_reason: parsed.messageStop.stopReason || 'end_turn'
                    };
                }

                return null;
            } catch (e) {
                // Ignore JSON parsing errors
                return null;
            }
        } catch (e) {
            log.error(`Failed to parse Event Stream message: ${e.message}`);
            return null;
        }
    }
}

/**
 * Bedrock API Service Class (stateless)
 */
export class BedrockAPI {
    /**
     * Chat (non-streaming)
     */
    static async chat(credentials, messages, model = BEDROCK_CONSTANTS.DEFAULT_MODEL, options = {}) {
        const client = BedrockClient.fromCredentials(credentials, options.region);
        return await client.chat(messages, model, options);
    }

    /**
     * Chat (streaming)
     */
    static async *chatStream(credentials, messages, model = BEDROCK_CONSTANTS.DEFAULT_MODEL, options = {}) {
        const client = BedrockClient.fromCredentials(credentials, options.region);
        yield* client.chatStream(messages, model, options);
    }

    /**
     * Get model list
     */
    static getModels() {
        return BEDROCK_MODELS;
    }

    /**
     * Get model mapping
     */
    static getModelMapping() {
        return BEDROCK_MODEL_MAPPING;
    }

    /**
     * Get supported regions
     */
    static getRegions() {
        return BEDROCK_CONSTANTS.SUPPORTED_REGIONS;
    }
}

export default BedrockClient;
