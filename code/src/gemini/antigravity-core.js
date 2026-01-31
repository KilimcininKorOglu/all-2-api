/**
 * Gemini Antigravity API Core Module
 * Reference implementation based on AIClient-2-API
 */

import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { logger } from '../logger.js';

// Active callback server
let activeCallbackServer = null;

const log = logger.api;

// ============ Constants Configuration ============

// Credentials storage directory
const CREDENTIALS_DIR = '.antigravity';
const CREDENTIALS_FILE = 'oauth_creds.json';

// Base URLs - in fallback order (Sandbox -> Daily -> Prod)
// Prefer Sandbox/Daily environments to avoid 429 errors in Prod
const ANTIGRAVITY_BASE_URLS = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://daily-cloudcode-pa.googleapis.com',
    'https://cloudcode-pa.googleapis.com'
];

const ANTIGRAVITY_API_VERSION = 'v1internal';

// OAuth configuration
const OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const OAUTH_SCOPE = ['https://www.googleapis.com/auth/cloud-platform'];
const OAUTH_CALLBACK_PORT = 8086;

// Default configuration
const FALLBACK_VERSION = '1.15.8';
const VERSION_FETCH_URL = 'https://antigravity-auto-updater-837917073086.us-central1.run.app/app-updater/latest';
const VERSION_FETCH_TIMEOUT = 3000; // 3 seconds
const REFRESH_SKEW = 3000; // 3000 seconds (50 minutes) early token refresh
const REQUEST_TIMEOUT = 120000; // 2 minutes

// Cached version info
let cachedVersion = null;
let versionFetchPromise = null;

/**
 * Fetch the latest Antigravity version from auto-updater endpoint
 * @returns {Promise<string>} The latest version string
 */
async function fetchLatestAntigravityVersion() {
    // Return cached version if available
    if (cachedVersion) {
        return cachedVersion;
    }

    // If fetch is already in progress, wait for it
    if (versionFetchPromise) {
        return versionFetchPromise;
    }

    versionFetchPromise = (async () => {
        try {
            const axios = (await import('axios')).default;
            const response = await axios.get(VERSION_FETCH_URL, {
                timeout: VERSION_FETCH_TIMEOUT,
                headers: {
                    'Accept': 'text/plain'
                }
            });

            const versionMatch = String(response.data).match(/\d+\.\d+\.\d+/);
            if (versionMatch) {
                cachedVersion = versionMatch[0];
                console.log(`[Antigravity] Fetched latest version: ${cachedVersion}`);
                return cachedVersion;
            }
        } catch (error) {
            console.log(`[Antigravity] Failed to fetch latest version: ${error.message}, using fallback ${FALLBACK_VERSION}`);
        }

        cachedVersion = FALLBACK_VERSION;
        return cachedVersion;
    })();

    return versionFetchPromise;
}

/**
 * Get the User-Agent string with dynamic version
 * @returns {Promise<string>} The User-Agent string
 */
async function getAntigravityUserAgent() {
    const version = await fetchLatestAntigravityVersion();
    return `antigravity/${version} windows/amd64`;
}

/**
 * Get the User-Agent string synchronously (uses cached or fallback)
 * @returns {string} The User-Agent string
 */
function getAntigravityUserAgentSync() {
    const version = cachedVersion || FALLBACK_VERSION;
    return `antigravity/${version} windows/amd64`;
}

// ============ Model Configuration ============

// Supported models list
export const GEMINI_MODELS = [
    'gemini-2.5-computer-use-preview-10-2025',
    'gemini-3-pro-image-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash-preview',
    'gemini-claude-sonnet-4-5',
    'gemini-claude-sonnet-4-5-thinking',
    'gemini-claude-opus-4-5-thinking'
];

// Alias -> Actual model name
const MODEL_ALIAS_MAP = {
    'gemini-2.5-computer-use-preview-10-2025': 'rev19-uic3-1p',
    'gemini-3-pro-image-preview': 'gemini-3-pro-image',
    'gemini-3-pro-preview': 'gemini-3-pro-high',
    'gemini-3-flash-preview': 'gemini-3-flash',
    'gemini-2.5-flash-preview': 'gemini-2.5-flash',
    'gemini-claude-sonnet-4-5': 'claude-sonnet-4-5',
    'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
    'gemini-claude-opus-4-5-thinking': 'claude-opus-4-5-thinking'
};

// Actual model name -> Alias
const MODEL_NAME_MAP = {
    'rev19-uic3-1p': 'gemini-2.5-computer-use-preview-10-2025',
    'gemini-3-pro-image': 'gemini-3-pro-image-preview',
    'gemini-3-pro-high': 'gemini-3-pro-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-2.5-flash': 'gemini-2.5-flash-preview',
    'claude-sonnet-4-5': 'gemini-claude-sonnet-4-5',
    'claude-sonnet-4-5-thinking': 'gemini-claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking': 'gemini-claude-opus-4-5-thinking'
};

// ============ Utility Functions ============

/**
 * Convert alias to actual model name
 */
export function alias2ModelName(alias) {
    return MODEL_ALIAS_MAP[alias] || alias;
}

/**
 * Convert actual model name to alias
 */
export function modelName2Alias(modelName) {
    return MODEL_NAME_MAP[modelName] || modelName;
}

/**
 * Check if the model is a Claude model
 */
export function isClaude(modelName) {
    return modelName.toLowerCase().includes('claude');
}

/**
 * Generate project ID
 */
function generateProjectID() {
    return `antigravity-${Date.now()}`;
}

/**
 * Generate request ID
 */
function generateRequestID() {
    return crypto.randomUUID();
}

/**
 * Generate stable session ID
 */
function generateStableSessionID(template) {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(template.request?.contents || []));
    return hash.digest('hex').substring(0, 32);
}

/**
 * Ensure message content has correct role
 */
function ensureRolesInContents(requestBody) {
    if (!requestBody.contents) return requestBody;

    requestBody.contents = requestBody.contents.map((content, index) => {
        if (!content.role) {
            content.role = index % 2 === 0 ? 'user' : 'model';
        }
        return content;
    });

    return requestBody;
}

/**
 * Handle Thinking configuration
 */
function normalizeAntigravityThinking(modelName, template, isClaudeModel) {
    const modelLower = modelName.toLowerCase();

    // Check if this is a Gemini 3 thinking model
    const isGemini3Thinking = modelLower.includes('gemini-3') &&
        (modelLower.endsWith('-high') || modelLower.endsWith('-low') || modelLower.includes('-pro'));

    // Check if this is a Claude thinking model
    const isClaudeThinking = isClaudeModel && modelLower.includes('thinking');

    // Gemini 3 Pro (high/low) or Claude thinking models require thinkingConfig
    if (isGemini3Thinking || isClaudeThinking) {
        if (!template.request.generationConfig) {
            template.request.generationConfig = {};
        }
        template.request.generationConfig.thinkingConfig = {
            includeThoughts: true,
            thinkingBudget: 32000
        };
    }
    // Gemini 3 Flash model thinking configuration
    else if (modelLower.startsWith('gemini-3-flash')) {
        if (!template.request.generationConfig) {
            template.request.generationConfig = {};
        }
        if (!template.request.generationConfig.thinkingConfig) {
            template.request.generationConfig.thinkingConfig = {
                thinkingBudget: 0
            };
        }
    }

    return template;
}

/**
 * Convert Gemini format to Antigravity format
 */
function geminiToAntigravity(modelName, payload, projectId) {
    let template = JSON.parse(JSON.stringify(payload));
    const isClaudeModel = isClaude(modelName);

    // Set basic fields
    template.model = modelName;
    template.userAgent = 'antigravity';
    template.project = projectId || generateProjectID();
    template.requestId = `agent-${generateRequestID()}`; // Use agent- prefix
    template.requestType = 'agent'; // Critical field!

    // Set session ID
    template.request.sessionId = generateStableSessionID(template);

    // Remove safety settings
    if (template.request.safetySettings) {
        delete template.request.safetySettings;
    }

    // Claude models are not allowed to use tools
    if (isClaudeModel) {
        delete template.request.tools;
        delete template.request.toolConfig;
    }

    // Handle Thinking configuration
    template = normalizeAntigravityThinking(modelName, template, isClaudeModel);

    // Inject systemInstruction (if not present)
    if (!template.request.systemInstruction) {
        template.request.systemInstruction = {
            role: 'user',
            parts: [{ text: 'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team.' }]
        };
    }

    return template;
}

/**
 * Convert Antigravity response to Gemini API format
 */
function toGeminiApiResponse(response) {
    if (!response) return null;

    return {
        candidates: response.candidates || [],
        usageMetadata: response.usageMetadata || {},
        modelVersion: response.modelVersion
    };
}

/**
 * Convert Claude format messages to Gemini format
 */
export function claudeToGeminiMessages(messages) {
    const contents = [];

    for (const msg of messages) {
        const role = msg.role === 'assistant' ? 'model' : 'user';

        if (typeof msg.content === 'string') {
            contents.push({
                role,
                parts: [{ text: msg.content }]
            });
        } else if (Array.isArray(msg.content)) {
            const parts = [];
            for (const part of msg.content) {
                if (part.type === 'text') {
                    parts.push({ text: part.text });
                } else if (part.type === 'image' && part.source) {
                    parts.push({
                        inlineData: {
                            mimeType: part.source.media_type,
                            data: part.source.data
                        }
                    });
                }
            }
            contents.push({ role, parts });
        }
    }

    return contents;
}

/**
 * Convert Gemini response to Claude format
 */
export function geminiToClaudeResponse(geminiResponse, model) {
    if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) {
        return {
            id: `msg_${generateRequestID()}`,
            type: 'message',
            role: 'assistant',
            content: [],
            model,
            stop_reason: 'end_turn',
            usage: { input_tokens: 0, output_tokens: 0 }
        };
    }

    const candidate = geminiResponse.candidates[0];
    const content = [];

    if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
            if (part.text) {
                content.push({ type: 'text', text: part.text });
            }
        }
    }

    const usage = geminiResponse.usageMetadata || {};

    return {
        id: `msg_${generateRequestID()}`,
        type: 'message',
        role: 'assistant',
        content,
        model,
        stop_reason: candidate.finishReason === 'STOP' ? 'end_turn' : candidate.finishReason?.toLowerCase() || 'end_turn',
        usage: {
            input_tokens: usage.promptTokenCount || 0,
            output_tokens: usage.candidatesTokenCount || 0
        }
    };
}

// ============ Antigravity API Service ============

export class AntigravityApiService {
    constructor(config = {}) {
        this.config = config;
        this.oauthCredsFilePath = config.oauthCredsFilePath;
        this.projectId = config.projectId;
        this.userAgent = config.userAgent || getAntigravityUserAgentSync();
        this.baseURLs = config.baseURLs || ANTIGRAVITY_BASE_URLS;
        this.availableModels = GEMINI_MODELS;
        this.isInitialized = false;

        // Create OAuth2 client
        const authClientOptions = {
            clientId: OAUTH_CLIENT_ID,
            clientSecret: OAUTH_CLIENT_SECRET
        };

        this.authClient = new OAuth2Client(authClientOptions);
    }

    /**
     * Initialize from credentials object
     */
    static fromCredentials(credentials) {
        const service = new AntigravityApiService({
            projectId: credentials.projectId
        });

        service.authClient.setCredentials({
            access_token: credentials.accessToken,
            refresh_token: credentials.refreshToken,
            expiry_date: credentials.expiresAt ? new Date(credentials.expiresAt).getTime() : null
        });

        return service;
    }

    /**
     * Complete initialization process
     */
    async initialize() {
        if (this.isInitialized) return;
        console.log('[Antigravity] Initializing Antigravity API Service...');

        // Fetch latest version and update User-Agent
        if (!this.config.userAgent) {
            this.userAgent = await getAntigravityUserAgent();
        }

        // Check if token needs refresh
        if (this.isTokenExpiringSoon()) {
            console.log('[Antigravity] Token expiring soon, refreshing...');
            await this.refreshToken();
        }

        // Discover Project ID
        if (!this.projectId) {
            this.projectId = await this.discoverProjectAndModels();
        } else {
            console.log(`[Antigravity] Using provided Project ID: ${this.projectId}`);
            await this.fetchAvailableModels();
        }

        this.isInitialized = true;
        console.log(`[Antigravity] Initialization complete. Project ID: ${this.projectId}`);
    }

    /**
     * Discover Project ID and available models
     */
    async discoverProjectAndModels() {
        if (this.projectId) {
            console.log(`[Antigravity] Using pre-configured Project ID: ${this.projectId}`);
            return this.projectId;
        }

        console.log('[Antigravity] Discovering Project ID...');
        try {
            const initialProjectId = "";
            const clientMetadata = {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
                duetProject: initialProjectId,
            };

            const loadRequest = {
                cloudaicompanionProject: initialProjectId,
                metadata: clientMetadata,
            };

            const loadResponse = await this.callApi('loadCodeAssist', loadRequest);
            console.log('[Antigravity] loadCodeAssist response:', JSON.stringify(loadResponse, null, 2));

            // Check if project already exists (could be string or object)
            const existingProject = loadResponse.cloudaicompanionProject;
            if (existingProject) {
                const projectId = typeof existingProject === 'object' ? existingProject.id : existingProject;
                if (projectId) {
                    console.log(`[Antigravity] Discovered existing Project ID: ${projectId}`);
                    await this.fetchAvailableModels();
                    return projectId;
                }
            }

            // If no existing project, need to onboard
            console.log('[Antigravity] No existing project, starting onboard process...');
            const defaultTier = loadResponse.allowedTiers?.find(tier => tier.isDefault);
            const tierId = defaultTier?.id || 'free-tier';
            console.log(`[Antigravity] Using tier: ${tierId}`);

            const onboardRequest = {
                tierId: tierId,
                cloudaicompanionProject: initialProjectId,
                metadata: clientMetadata,
            };

            const lroResponse = await this.callApi('onboardUser', onboardRequest);
            console.log('[Antigravity] onboardUser response:', JSON.stringify(lroResponse, null, 2));

            // Check if completed immediately
            if (lroResponse.done) {
                const projectInfo = lroResponse.response?.cloudaicompanionProject;
                const discoveredProjectId = projectInfo?.id || projectInfo?.name;
                if (discoveredProjectId) {
                    console.log(`[Antigravity] Onboarded successfully! Project ID: ${discoveredProjectId}`);
                    await this.fetchAvailableModels();
                    return discoveredProjectId;
                }
            }

            // If operation name is returned, need to poll
            if (lroResponse.name && !lroResponse.done) {
                console.log(`[Antigravity] Onboard operation started: ${lroResponse.name}, polling...`);
                const MAX_RETRIES = 30;
                let retryCount = 0;
                let pollResponse = lroResponse;

                while (!pollResponse.done && retryCount < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    // Re-call onboardUser to check status
                    pollResponse = await this.callApi('onboardUser', onboardRequest);
                    retryCount++;
                    console.log(`[Antigravity] Polling attempt ${retryCount}, done: ${pollResponse.done}`);
                }

                if (pollResponse.done) {
                    const projectInfo = pollResponse.response?.cloudaicompanionProject;
                    const discoveredProjectId = projectInfo?.id || projectInfo?.name;
                    if (discoveredProjectId) {
                        console.log(`[Antigravity] Onboarded successfully! Project ID: ${discoveredProjectId}`);
                        await this.fetchAvailableModels();
                        return discoveredProjectId;
                    }
                }

                throw new Error('Onboarding timeout or failed to get project ID');
            }

            throw new Error('Onboarding failed: unexpected response');
        } catch (error) {
            console.error('[Antigravity] Failed to discover Project ID:', error.response?.data || error.message);
            throw error; // No fallback, throw error for caller to handle
        }
    }

    /**
     * Fetch available models list
     */
    async fetchAvailableModels() {
        console.log('[Antigravity] Fetching available models...');
        const axios = (await import('axios')).default;

        for (const baseURL of this.baseURLs) {
            try {
                const modelsURL = `${baseURL}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`;

                const axiosConfig = {
                    method: 'POST',
                    url: modelsURL,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': this.userAgent,
                        'Authorization': `Bearer ${this.authClient.credentials.access_token}`
                    },
                    data: { project: this.projectId },
                    timeout: REQUEST_TIMEOUT
                };

                const res = await axios(axiosConfig);
                if (res.data && res.data.models) {
                    const models = Object.keys(res.data.models);
                    this.availableModels = models
                        .map(modelName2Alias)
                        .filter(alias => alias && GEMINI_MODELS.includes(alias));

                    console.log(`[Antigravity] Available models: [${this.availableModels.join(', ')}]`);
                    return;
                }
            } catch (error) {
                console.error(`[Antigravity] Failed to fetch models from ${baseURL}:`, error.message);
            }
        }

        console.warn('[Antigravity] Failed to fetch models from all endpoints. Using default models.');
        this.availableModels = GEMINI_MODELS;
    }

    /**
     * Check if Token is expiring soon
     */
    isTokenExpiringSoon() {
        if (!this.authClient.credentials.expiry_date) {
            return false;
        }
        const currentTime = Date.now();
        const expiryTime = this.authClient.credentials.expiry_date;
        const refreshSkewMs = REFRESH_SKEW * 1000;
        return expiryTime <= (currentTime + refreshSkewMs);
    }

    /**
     * Initialize authentication
     */
    async initializeAuth(forceRefresh = false) {
        const needsRefresh = forceRefresh || this.isTokenExpiringSoon();

        if (this.authClient.credentials.access_token && !needsRefresh) {
            return;
        }

        const credPath = this.oauthCredsFilePath || path.join(os.homedir(), CREDENTIALS_DIR, CREDENTIALS_FILE);

        try {
            const data = await fs.readFile(credPath, 'utf8');
            const credentials = JSON.parse(data);
            this.authClient.setCredentials(credentials);

            if (needsRefresh) {
                console.log('[Antigravity Auth] Token expiring soon or force refresh requested. Refreshing token...');
                const { credentials: newCredentials } = await this.authClient.refreshAccessToken();
                this.authClient.setCredentials(newCredentials);
                await fs.writeFile(credPath, JSON.stringify(newCredentials, null, 2));
                console.log(`[Antigravity Auth] Token refreshed and saved to ${credPath}`);
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`OAuth credentials file not found: ${credPath}`);
            }
            throw error;
        }
    }

    /**
     * Refresh Token
     */
    async refreshToken() {
        try {
            const { credentials: newCredentials } = await this.authClient.refreshAccessToken();
            this.authClient.setCredentials(newCredentials);
            return {
                accessToken: newCredentials.access_token,
                refreshToken: newCredentials.refresh_token,
                expiresAt: newCredentials.expiry_date ? new Date(newCredentials.expiry_date).toISOString() : null
            };
        } catch (error) {
            throw new Error(`Token refresh failed: ${error.message}`);
        }
    }

    /**
     * Call API
     */
    async callApi(method, body, isRetry = false, retryCount = 0, baseURLIndex = 0) {
        const maxRetries = this.config.maxRetries || 3;
        const baseDelay = this.config.baseDelay || 1000;
        const axios = (await import('axios')).default;

        if (baseURLIndex >= this.baseURLs.length) {
            throw new Error('All Antigravity base URLs failed');
        }

        const baseURL = this.baseURLs[baseURLIndex];
        const url = `${baseURL}/${ANTIGRAVITY_API_VERSION}:${method}`;

        try {
            const requestHeaders = {
                'Content-Type': 'application/json',
                'User-Agent': this.userAgent,
                'Authorization': `Bearer ${this.authClient.credentials.access_token}`
            };

            // Print curl command
            log.curl('POST', url, requestHeaders, body);

            const axiosConfig = {
                method: 'POST',
                url,
                headers: requestHeaders,
                data: body,
                timeout: REQUEST_TIMEOUT
            };

            const res = await axios(axiosConfig);
            return res.data;
        } catch (error) {
            const status = error.response?.status;

            // 401/400/403 error: refresh authentication and retry
            if ((status === 400 || status === 401 || status === 403) && !isRetry) {
                console.log(`[Antigravity] Received ${status} error, attempting token refresh and retry...`);
                await this.initializeAuth(true);
                return this.callApi(method, body, true, retryCount, baseURLIndex);
            }

            // 429 error: try next Base URL or exponential backoff retry
            if (status === 429) {
                if (baseURLIndex + 1 < this.baseURLs.length) {
                    return this.callApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                } else if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.callApi(method, body, isRetry, retryCount + 1, 0);
                }
            }

            throw error;
        }
    }

    /**
     * Streaming API call
     */
    async *streamApi(method, body, isRetry = false) {
        const axios = (await import('axios')).default;

        for (let baseURLIndex = 0; baseURLIndex < this.baseURLs.length; baseURLIndex++) {
            const baseURL = this.baseURLs[baseURLIndex];

            try {
                const url = `${baseURL}/${ANTIGRAVITY_API_VERSION}:${method}?alt=sse`;
                const accessToken = this.authClient.credentials.access_token;

                // Print request body for debugging
                console.log('[Antigravity Stream] Request body:', JSON.stringify(body, null, 2));

                const requestHeaders = {
                    'Content-Type': 'application/json',
                    'User-Agent': this.userAgent,
                    'Authorization': `Bearer ${accessToken}`
                };

                // Print curl command
                log.curl('POST', url, requestHeaders, body);

                // Build axios request configuration
                const axiosConfig = {
                    method: 'POST',
                    url,
                    headers: requestHeaders,
                    data: body,
                    responseType: 'stream',
                    timeout: REQUEST_TIMEOUT
                };

                const response = await axios(axiosConfig);

                console.log(`[Antigravity Stream] Response status: ${response.status} ${response.statusText} from ${baseURL}`);

                // Handle streaming response
                const stream = response.data;
                let buffer = '';

                for await (const chunk of stream) {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();
                            if (data && data !== '[DONE]') {
                                try {
                                    yield JSON.parse(data);
                                } catch (e) {
                                    // Ignore parsing errors
                                }
                            }
                        }
                    }
                }

                return; // Successfully completed, exit
            } catch (error) {
                const status = error.response?.status;
                console.log(`[Antigravity Stream] Error from ${baseURL}: ${error.message}, status: ${status}`);

                // Try to read error response body
                if (error.response?.data) {
                    let errorBody = '';
                    try {
                        if (typeof error.response.data === 'string') {
                            errorBody = error.response.data;
                        } else if (error.response.data.pipe) {
                            // It's a stream, read it
                            const chunks = [];
                            for await (const chunk of error.response.data) {
                                chunks.push(chunk);
                            }
                            errorBody = Buffer.concat(chunks).toString();
                        } else {
                            errorBody = JSON.stringify(error.response.data);
                        }
                        console.log(`[Antigravity Stream] Error response body: ${errorBody}`);
                    } catch (e) {}
                }

                // 429 error: try next Base URL
                if (status === 429 && baseURLIndex + 1 < this.baseURLs.length) {
                    console.log(`[Antigravity Stream] 429 error, trying next URL...`);
                    continue;
                }

                // 400/401 error: refresh Token and retry (403 does not retry, may be permission issue)
                if ((status === 400 || status === 401) && !isRetry) {
                    console.log(`[Antigravity Stream] Received ${status} error, attempting token refresh and retry...`);
                    await this.initializeAuth(true);
                    // Recursive call, marked as retry
                    yield* this.streamApi(method, body, true);
                    return;
                }

                if (baseURLIndex + 1 >= this.baseURLs.length) {
                    throw error;
                }
                // Try next URL
            }
        }
    }

    /**
     * Generate content (non-streaming)
     */
    async generateContent(model, requestBody) {
        // Ensure initialized
        if (!this.isInitialized) {
            await this.initialize();
        }

        let selectedModel = model;
        if (!this.availableModels.includes(model)) {
            console.warn(`[Antigravity] Model '${model}' not available. Using: '${this.availableModels[0]}'`);
            selectedModel = this.availableModels[0];
        }

        const processedRequestBody = ensureRolesInContents(JSON.parse(JSON.stringify(requestBody)));
        const actualModelName = alias2ModelName(selectedModel);
        const isClaudeModel = isClaude(actualModelName);

        const payload = geminiToAntigravity(actualModelName, { request: processedRequestBody }, this.projectId);
        payload.model = actualModelName;

        // Claude models use streaming request then convert to non-streaming response
        if (isClaudeModel) {
            return await this.executeClaudeNonStream(payload);
        }

        const response = await this.callApi('generateContent', payload);
        return toGeminiApiResponse(response.response);
    }

    /**
     * Claude model non-streaming execution
     */
    async executeClaudeNonStream(payload) {
        let fullResponse = null;
        let textContent = '';

        for await (const chunk of this.streamApi('streamGenerateContent', payload)) {
            if (chunk.response) {
                fullResponse = chunk.response;
                if (chunk.response.candidates?.[0]?.content?.parts) {
                    for (const part of chunk.response.candidates[0].content.parts) {
                        if (part.text) {
                            textContent += part.text;
                        }
                    }
                }
            }
        }

        if (fullResponse && fullResponse.candidates?.[0]) {
            fullResponse.candidates[0].content = {
                parts: [{ text: textContent }],
                role: 'model'
            };
        }

        return toGeminiApiResponse(fullResponse);
    }

    /**
     * Generate content (streaming)
     */
    async *generateContentStream(model, requestBody) {
        // Ensure initialized
        if (!this.isInitialized) {
            await this.initialize();
        }

        let selectedModel = model;
        if (!this.availableModels.includes(model)) {
            console.warn(`[Antigravity] Model '${model}' not available. Using: '${this.availableModels[0]}'`);
            selectedModel = this.availableModels[0];
        }

        const processedRequestBody = ensureRolesInContents(JSON.parse(JSON.stringify(requestBody)));
        const actualModelName = alias2ModelName(selectedModel);

        const payload = geminiToAntigravity(actualModelName, { request: processedRequestBody }, this.projectId);
        payload.model = actualModelName;

        for await (const chunk of this.streamApi('streamGenerateContent', payload)) {
            yield toGeminiApiResponse(chunk.response);
        }
    }

    /**
     * Get usage limits (with quota information)
     */
    async getUsageLimits() {
        // Ensure initialized
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Check if token is expiring soon
        if (this.isTokenExpiringSoon()) {
            console.log('[Antigravity] Token is near expiry, refreshing before getUsageLimits...');
            await this.refreshToken();
        }

        try {
            return await this.getModelsWithQuotas();
        } catch (error) {
            console.error('[Antigravity] Failed to get usage limits:', error.message);
            throw error;
        }
    }

    /**
     * Get models list with quota information
     */
    async getModelsWithQuotas() {
        const result = {
            lastUpdated: Date.now(),
            models: {}
        };

        const axios = (await import('axios')).default;

        for (const baseURL of this.baseURLs) {
            try {
                const modelsURL = `${baseURL}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`;

                const axiosConfig = {
                    method: 'POST',
                    url: modelsURL,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': this.userAgent,
                        'Authorization': `Bearer ${this.authClient.credentials.access_token}`
                    },
                    data: { project: this.projectId },
                    timeout: REQUEST_TIMEOUT
                };

                const res = await axios(axiosConfig);
                console.log(`[Antigravity] fetchAvailableModels success`);
                // Print full response for debugging
                console.log(`[Antigravity] Models response:`, JSON.stringify(res.data, null, 2));

                if (res.data && res.data.models) {
                    const modelsData = res.data.models;

                    for (const [modelId, modelData] of Object.entries(modelsData)) {
                        const aliasName = modelName2Alias(modelId);
                        if (!aliasName || !GEMINI_MODELS.includes(aliasName)) continue;

                        const modelInfo = {
                            remaining: 0,
                            resetTime: null,
                            resetTimeRaw: null
                        };

                        if (modelData.quotaInfo) {
                            modelInfo.remaining = modelData.quotaInfo.remainingFraction || modelData.quotaInfo.remaining || 0;
                            modelInfo.resetTime = modelData.quotaInfo.resetTime || null;
                            modelInfo.resetTimeRaw = modelData.quotaInfo.resetTime;
                        }

                        result.models[aliasName] = modelInfo;
                    }

                    // Sort by name
                    const sortedModels = {};
                    Object.keys(result.models).sort().forEach(key => {
                        sortedModels[key] = result.models[key];
                    });
                    result.models = sortedModels;

                    console.log(`[Antigravity] Successfully fetched quotas for ${Object.keys(result.models).length} models`);
                    break;
                }
            } catch (error) {
                console.error(`[Antigravity] Failed to fetch models with quotas from ${baseURL}:`, error.message);
            }
        }

        return result;
    }

    /**
     * List available models
     */
    async listModels() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        return this.availableModels;
    }
}

// ============ OAuth Authentication ============

export const GEMINI_OAUTH_CONFIG = {
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
    scope: OAUTH_SCOPE,
    port: OAUTH_CALLBACK_PORT,
    credentialsDir: CREDENTIALS_DIR,
    credentialsFile: CREDENTIALS_FILE
};

/**
 * Generate OAuth authentication URL
 */
export function generateAuthUrl(redirectUri, state) {
    const authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    authClient.redirectUri = redirectUri;

    const options = {
        access_type: 'offline',
        prompt: 'select_account',
        scope: OAUTH_SCOPE
    };

    if (state) {
        options.state = state;
    }

    return authClient.generateAuthUrl(options);
}

/**
 * Get Token using authorization code
 */
export async function getTokenFromCode(code, redirectUri) {
    const authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    authClient.redirectUri = redirectUri;

    const { tokens } = await authClient.getToken(code);
    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        tokenType: tokens.token_type,
        scope: tokens.scope
    };
}

/**
 * Refresh Token
 */
export async function refreshGeminiToken(refreshToken) {
    const authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    authClient.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await authClient.refreshAccessToken();
    return {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || refreshToken,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null
    };
}

/**
 * Close active callback server
 */
export async function closeCallbackServer() {
    if (activeCallbackServer) {
        return new Promise((resolve) => {
            activeCallbackServer.close(() => {
                console.log('[Gemini OAuth] Callback server closed');
                activeCallbackServer = null;
                resolve();
            });
        });
    }
}

/**
 * Start OAuth callback server
 * @param {Object} options - Configuration options
 * @param {number} options.port - Listen port, default 8086
 * @param {Function} options.onSuccess - Success callback (tokens) => void
 * @param {Function} options.onError - Error callback (error) => void
 * @returns {Promise<{authUrl: string, server: http.Server}>}
 */
export async function startOAuthFlow(options = {}) {
    const port = options.port || OAUTH_CALLBACK_PORT;
    const host = 'localhost';
    const redirectUri = `http://${host}:${port}`;

    // Close previous server
    await closeCallbackServer();

    const authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    authClient.redirectUri = redirectUri;

    // Generate authorization URL
    const authUrl = authClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'select_account',
        scope: OAUTH_SCOPE
    });

    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url, redirectUri);
                const code = url.searchParams.get('code');
                const errorParam = url.searchParams.get('error');

                if (code) {
                    console.log('[Gemini OAuth] Received authorization callback, code:', code.substring(0, 20) + '...');

                    try {
                        console.log('[Gemini OAuth] Getting Token...');

                        // Directly use axios to request token, bypassing OAuth2Client
                        const axios = (await import('axios')).default;
                        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
                            code: code,
                            client_id: OAUTH_CLIENT_ID,
                            client_secret: OAUTH_CLIENT_SECRET,
                            redirect_uri: redirectUri,
                            grant_type: 'authorization_code'
                        }, {
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            timeout: 30000
                        });

                        const tokens = tokenResponse.data;
                        console.log('[Gemini OAuth] Token obtained successfully');

                        const tokenData = {
                            accessToken: tokens.access_token,
                            refreshToken: tokens.refresh_token,
                            expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
                            tokenType: tokens.token_type,
                            scope: tokens.scope
                        };

                        // Return success page
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateSuccessPage());

                        // Call success callback
                        if (options.onSuccess) {
                            options.onSuccess(tokenData);
                        }
                    } catch (tokenError) {
                        console.error('[Gemini OAuth] Failed to get Token:', tokenError.message);
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateErrorPage(tokenError.message));

                        if (options.onError) {
                            options.onError(tokenError);
                        }
                    } finally {
                        // Close server
                        server.close(() => {
                            activeCallbackServer = null;
                        });
                    }
                } else if (errorParam) {
                    console.error('[Gemini OAuth] Authorization failed:', errorParam);
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(generateErrorPage(errorParam));

                    if (options.onError) {
                        options.onError(new Error(errorParam));
                    }

                    server.close(() => {
                        activeCallbackServer = null;
                    });
                } else {
                    // Ignore other requests (like favicon)
                    res.writeHead(204);
                    res.end();
                }
            } catch (error) {
                console.error('[Gemini OAuth] Error processing callback:', error);
                res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(generateErrorPage(error.message));
            }
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                reject(new Error(`Port ${port} is already in use`));
            } else {
                reject(err);
            }
        });

        server.listen(port, host, () => {
            console.log(`[Gemini OAuth] Callback server started at ${host}:${port}`);
            activeCallbackServer = server;
            resolve({ authUrl, server, port, redirectUri });
        });

        // Auto close after 10 minutes timeout
        setTimeout(() => {
            if (server.listening) {
                console.log('[Gemini OAuth] Callback server timeout, auto closing');
                server.close(() => {
                    activeCallbackServer = null;
                });
            }
        }, 10 * 60 * 1000);
    });
}

/**
 * Generate success page HTML
 */
function generateSuccessPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authorization Successful</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
        .container { text-align: center; }
        h1 { color: #4ade80; margin-bottom: 16px; }
        p { color: #a0a0a0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Authorization Successful</h1>
        <p>You can close this page</p>
    </div>
    <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`;
}

/**
 * Generate error page HTML
 */
function generateErrorPage(message) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authorization Failed</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
        .container { text-align: center; }
        h1 { color: #f87171; margin-bottom: 16px; }
        p { color: #a0a0a0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Authorization Failed</h1>
        <p>${message}</p>
    </div>
</body>
</html>`;
}

export default AntigravityApiService;
