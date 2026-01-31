/**
 * GCP Vertex AI Client
 * Access Gemini models via GCP Vertex AI
 */
import axios from 'axios';
import fs from 'fs/promises';
import { logger } from '../logger.js';
import { getAxiosProxyConfig } from '../proxy.js';

const log = logger.api;

/**
 * Gemini Model Mapping Table (Vertex AI)
 * Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions
 */
export const VERTEX_GEMINI_MODEL_MAPPING = {
    // Gemini 3 series (latest)
    'gemini-3-pro': 'gemini-3-pro-preview',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-3-flash-preview': 'gemini-3-flash-preview',
    // Gemini 1.5 series
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
    'gemini-1.5-pro-latest': 'gemini-1.5-pro',
    'gemini-1.5-flash-latest': 'gemini-1.5-flash',
    // Gemini 2.0 series
    'gemini-2.0-flash': 'gemini-2.0-flash-001',
    'gemini-2.0-flash-exp': 'gemini-2.0-flash-exp',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite-001',
    // Gemini 2.5 series (experimental)
    'gemini-2.5-pro': 'gemini-2.5-pro-exp-03-25',
    'gemini-2.5-flash': 'gemini-2.5-flash-preview-04-17',
    'gemini-2.5-pro-exp': 'gemini-2.5-pro-exp-03-25',
    'gemini-2.5-flash-preview': 'gemini-2.5-flash-preview-04-17',
    // Direct model names (no mapping)
    'gemini-1.5-pro-001': 'gemini-1.5-pro-001',
    'gemini-1.5-pro-002': 'gemini-1.5-pro-002',
    'gemini-1.5-flash-001': 'gemini-1.5-flash-001',
    'gemini-1.5-flash-002': 'gemini-1.5-flash-002',
    'gemini-2.0-flash-001': 'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite-001': 'gemini-2.0-flash-lite-001'
};

/**
 * Default model
 */
export const VERTEX_DEFAULT_MODEL = 'gemini-1.5-flash';

/**
 * Vertex AI supported regions
 */
export const VERTEX_REGIONS = [
    'global',
    'us-central1',
    'us-east5',
    'europe-west1',
    'europe-west4',
    'asia-southeast1'
];

/**
 * GCP Vertex AI Client Class
 */
export class VertexClient {
    /**
     * @param {Object} options - Configuration options
     * @param {string} options.projectId - GCP project ID
     * @param {string} options.region - GCP region (default global)
     * @param {Object} options.credentials - GCP service account credentials object
     * @param {string} options.keyFilePath - GCP service account key file path
     * @param {boolean} options.sslVerify - Whether to verify SSL (default true)
     */
    constructor(options = {}) {
        this.projectId = options.projectId;
        this.region = options.region || 'global';
        this.credentials = options.credentials;
        this.keyFilePath = options.keyFilePath;
        this.sslVerify = options.sslVerify !== false;
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    /**
     * Create client from key file
     */
    static async fromKeyFile(keyFilePath, region = 'global') {
        const content = await fs.readFile(keyFilePath, 'utf8');
        const credentials = JSON.parse(content);

        return new VertexClient({
            projectId: credentials.project_id,
            region,
            credentials
        });
    }

    /**
     * Create client from credentials object
     */
    static fromCredentials(credentials, region = 'global') {
        return new VertexClient({
            projectId: credentials.project_id,
            region,
            credentials
        });
    }

    /**
     * Get access token
     */
    async getAccessToken() {
        // Check if existing token is valid
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
            console.log('[Vertex] Using cached access token');
            return this.accessToken;
        }

        if (!this.credentials) {
            throw new Error('Missing GCP credentials');
        }

        console.log('[Vertex] Need to get new access token');
        console.log(`[Vertex] client_email: ${this.credentials.client_email}`);

        const now = Math.floor(Date.now() / 1000);
        const expiry = now + 3600;

        // Build JWT
        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };

        const payload = {
            iss: this.credentials.client_email,
            sub: this.credentials.client_email,
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: expiry,
            scope: 'https://www.googleapis.com/auth/cloud-platform'
        };

        console.log('[Vertex] Signing JWT...');
        const jwt = await this._signJWT(header, payload, this.credentials.private_key);
        console.log('[Vertex] JWT signing completed');

        // Exchange JWT for access token
        const proxyConfig = getAxiosProxyConfig();
        console.log(`[Vertex] Proxy config: ${proxyConfig.httpsAgent ? 'enabled' : 'disabled'}`);
        console.log('[Vertex] Requesting oauth2.googleapis.com/token ...');

        const response = await axios.post('https://oauth2.googleapis.com/token', {
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            ...proxyConfig
        });

        console.log('[Vertex] oauth2 token obtained successfully');
        this.accessToken = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

        log.info(`Vertex AI Token obtained successfully, expires at: ${new Date(this.tokenExpiry).toISOString()}`);
        return this.accessToken;
    }

    /**
     * Sign JWT
     */
    async _signJWT(header, payload, privateKey) {
        const crypto = await import('crypto');

        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signatureInput = `${encodedHeader}.${encodedPayload}`;

        const sign = crypto.createSign('RSA-SHA256');
        sign.update(signatureInput);
        const signature = sign.sign(privateKey, 'base64url');

        return `${signatureInput}.${signature}`;
    }

    /**
     * Get Vertex AI Gemini API URL
     */
    _getGeminiApiUrl(model, stream = false) {
        const vertexModel = VERTEX_GEMINI_MODEL_MAPPING[model] || model;
        const action = stream ? 'streamGenerateContent' : 'generateContent';

        // Gemini uses global or specified region
        return `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/global/publishers/google/models/${vertexModel}:${action}`;
    }

    /**
     * Get supported Gemini model list
     */
    getModels() {
        return Object.keys(VERTEX_GEMINI_MODEL_MAPPING);
    }

    /**
     * Get Gemini model mapping
     */
    getModelMapping() {
        return VERTEX_GEMINI_MODEL_MAPPING;
    }

    /**
     * Convert Claude format messages to Gemini format
     */
    _convertToGeminiMessages(messages) {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
        }));
    }

    /**
     * Convert request to Gemini format
     */
    _convertGeminiRequest(messages, model, options = {}) {
        const contents = this._convertToGeminiMessages(messages);

        const request = {
            contents
        };

        // Add system prompt
        if (options.system) {
            const systemText = typeof options.system === 'string'
                ? options.system
                : (Array.isArray(options.system) ? options.system.map(s => s.text || s).join('\n') : String(options.system));
            request.systemInstruction = { parts: [{ text: systemText }] };
        }

        // Add generation config
        const generationConfig = {};
        if (options.max_tokens) {
            generationConfig.maxOutputTokens = options.max_tokens;
        }
        if (options.temperature !== undefined) {
            generationConfig.temperature = options.temperature;
        }
        if (options.top_p !== undefined) {
            generationConfig.topP = options.top_p;
        }
        if (options.top_k !== undefined) {
            generationConfig.topK = options.top_k;
        }
        if (Object.keys(generationConfig).length > 0) {
            request.generationConfig = generationConfig;
        }

        return request;
    }

    /**
     * Convert Gemini response to Claude format
     */
    _convertGeminiResponse(response, model) {
        const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);

        let text = '';
        if (response.candidates && response.candidates[0]?.content?.parts) {
            text = response.candidates[0].content.parts.map(p => p.text || '').join('');
        }

        const inputTokens = response.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;

        return {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text }],
            model,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens
            }
        };
    }

    /**
     * Gemini chat (non-streaming)
     */
    async geminiChat(messages, model = 'gemini-1.5-flash', options = {}) {
        console.log('[Vertex/Gemini] chat() started');
        console.log('[Vertex/Gemini] Getting access token...');
        const accessToken = await this.getAccessToken();
        console.log('[Vertex/Gemini] Access token obtained successfully');

        const url = this._getGeminiApiUrl(model, false);
        console.log(`[Vertex/Gemini] API URL: ${url}`);

        const requestData = this._convertGeminiRequest(messages, model, options);

        log.info(`Vertex AI Gemini request: ${url}`);
        log.debug(`Request data: ${JSON.stringify(requestData).substring(0, 500)}...`);

        const proxyConfig = getAxiosProxyConfig();
        console.log(`[Vertex/Gemini] Proxy config: ${proxyConfig.httpsAgent ? 'enabled' : 'disabled'}`);
        console.log('[Vertex/Gemini] Sending request to Vertex AI...');

        try {
            const requestConfig = {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 300000,
                ...proxyConfig
            };

            if (!this.sslVerify && !proxyConfig.httpsAgent) {
                requestConfig.httpsAgent = new (await import('https')).Agent({ rejectUnauthorized: false });
            }

            const response = await axios.post(url, requestData, requestConfig);

            console.log('[Vertex/Gemini] Request successful');
            return this._convertGeminiResponse(response.data, model);
        } catch (error) {
            console.error('[Vertex/Gemini] Request failed:', error.message);
            if (error.response) {
                console.error('[Vertex/Gemini] Response status:', error.response.status);
                console.error('[Vertex/Gemini] Response data:', JSON.stringify(error.response.data));
            }
            throw error;
        }
    }

    /**
     * Gemini chat (streaming)
     */
    async *geminiChatStream(messages, model = 'gemini-1.5-flash', options = {}) {
        console.log('[Vertex/Gemini] chatStream() started');
        const accessToken = await this.getAccessToken();
        const url = this._getGeminiApiUrl(model, true) + '?alt=sse';
        console.log(`[Vertex/Gemini] Stream URL: ${url}`);

        const requestData = this._convertGeminiRequest(messages, model, options);

        const proxyConfig = getAxiosProxyConfig();

        const requestConfig = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 300000,
            responseType: 'stream',
            ...proxyConfig
        };

        if (!this.sslVerify && !proxyConfig.httpsAgent) {
            requestConfig.httpsAgent = new (await import('https')).Agent({ rejectUnauthorized: false });
        }

        const response = await axios.post(url, requestData, requestConfig);

        let buffer = '';

        for await (const chunk of response.data) {
            buffer += chunk.toString();

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data && data !== '[DONE]') {
                        try {
                            const parsed = JSON.parse(data);
                            // Extract text
                            if (parsed.candidates && parsed.candidates[0]?.content?.parts) {
                                for (const part of parsed.candidates[0].content.parts) {
                                    if (part.text) {
                                        yield {
                                            type: 'content_block_delta',
                                            delta: { type: 'text_delta', text: part.text }
                                        };
                                    }
                                }
                            }
                            // Extract usage
                            if (parsed.usageMetadata) {
                                yield {
                                    type: 'usage',
                                    usage: {
                                        input_tokens: parsed.usageMetadata.promptTokenCount || 0,
                                        output_tokens: parsed.usageMetadata.candidatesTokenCount || 0
                                    }
                                };
                            }
                        } catch (e) {
                            // Ignore parse errors
                        }
                    }
                }
            }
        }
    }
}

/**
 * Vertex AI API Service Class (stateless) - Gemini only
 */
export class VertexAPI {
    /**
     * Refresh/get access token from credentials
     */
    static async getAccessToken(credentials) {
        const client = VertexClient.fromCredentials(credentials);
        return await client.getAccessToken();
    }

    /**
     * Gemini chat (non-streaming)
     */
    static async chat(credentials, messages, model = 'gemini-1.5-flash', options = {}) {
        const client = VertexClient.fromCredentials(credentials, options.region);
        return await client.geminiChat(messages, model, options);
    }

    /**
     * Gemini chat (streaming)
     */
    static async *chatStream(credentials, messages, model = 'gemini-1.5-flash', options = {}) {
        const client = VertexClient.fromCredentials(credentials, options.region);
        yield* client.geminiChatStream(messages, model, options);
    }

    /**
     * Get Gemini model list
     */
    static getModels() {
        return Object.keys(VERTEX_GEMINI_MODEL_MAPPING);
    }

    /**
     * Get Gemini model mapping
     */
    static getModelMapping() {
        return VERTEX_GEMINI_MODEL_MAPPING;
    }

    /**
     * Get supported regions
     */
    static getRegions() {
        return VERTEX_REGIONS;
    }
}

export default VertexClient;
