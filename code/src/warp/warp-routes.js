/**
 * Warp API Routes
 */
import crypto from 'crypto';
import https from 'https';
import { WarpService, WARP_MODELS, refreshAccessToken, isTokenExpired, getEmailFromToken, parseJwtToken, mapModelToWarp } from './warp-service.js';
import { ApiLogStore } from '../db.js';
import { WarpMultiAgentService } from './warp-multi-agent.js';
import { WarpProxy } from './warp-proxy.js';

// Import new protobuf module
import { loadProtos, encodeRequest, decodeResponseEvent, responseEventToObject } from './warp-proto.js';
import { buildWarpRequest, parseWarpResponseEvent, convertToClaudeSSE, buildClaudeResponse, createSSEState, createMessageStartSSE } from './warp-message-converter.js';
import { warpToolCallToClaudeToolUse } from './warp-tool-mapper.js';

// Simple token estimation function (by character count)
function estimateTokens(text) {
    if (!text) return 0;
    // Rough estimate: Chinese ~1.5 chars/token, English ~4 chars/token
    // Using average of ~2.5 chars/token
    return Math.ceil(text.length / 2.5);
}

// Generate request ID
function generateRequestId() {
    return `warp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// 429 error retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,           // Maximum retry attempts
    retryDelay: 1000,        // Retry delay (milliseconds)
    excludeCredentialIds: new Set()  // Temporarily excluded credential IDs (quota exhausted)
};

// Clear expired excluded credentials (reset every hour)
setInterval(() => {
    RETRY_CONFIG.excludeCredentialIds.clear();
    console.log('[Warp] Quota exhausted credential exclusion list has been reset');
}, 3600000);

export async function setupWarpRoutes(app, warpStore, warpService, apiKeyStore) {
    // Initialize log storage
    const apiLogStore = await ApiLogStore.create();
    
    // Initialize multi-agent service
    const multiAgentService = new WarpMultiAgentService(warpStore, {
        maxIterations: 10
    });
    
    // WarpProxy instance cache (by credential ID)
    const warpProxies = new Map();
    
    /**
     * Warp request with 429 retry
     * Automatically switch to other credentials when encountering 429 error
     */
    async function sendWarpRequestWithRetry(query, warpModel, warpReqOptions = {}) {
        const { sendWarpRequest } = await import('./warp-service.js');
        let lastError = null;
        let triedCredentialIds = new Set();
        
        for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
            // Get available credentials (exclude tried ones and quota exhausted ones)
            const allCredentials = await warpStore.getAllActive();
            const availableCredentials = allCredentials.filter(c => 
                !triedCredentialIds.has(c.id) && 
                !RETRY_CONFIG.excludeCredentialIds.has(c.id)
            );
            
            if (availableCredentials.length === 0) {
                // No more available credentials
                if (lastError) throw lastError;
                throw new Error('No available Warp accounts (all account quotas exhausted)');
            }
            
            // Randomly select a credential
            const credential = availableCredentials[Math.floor(Math.random() * availableCredentials.length)];
            triedCredentialIds.add(credential.id);
            
            try {
                const accessToken = await warpService.getValidAccessToken(credential);
                console.log(`  -> [attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}] using credential #${credential.id} (${credential.name || credential.email})`);
                
                const warpResponse = await sendWarpRequest(query, accessToken, warpModel, warpReqOptions);
                await warpStore.incrementUseCount(credential.id);
                
                return { response: warpResponse, credentialId: credential.id };
            } catch (error) {
                lastError = error;
                
                // Check if this is a 429 quota exhausted error
                if (error.message && error.message.includes('429')) {
                    console.log(`  <- [429] credential #${credential.id} quota exhausted, trying next...`);
                    RETRY_CONFIG.excludeCredentialIds.add(credential.id);
                    
                    // Mark credential quota exhausted
                    await warpStore.markQuotaExhausted(credential.id).catch(() => {});
                    
                    // Retry after brief delay
                    await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.retryDelay));
                    continue;
                }
                
                // Throw other errors directly
                throw error;
            }
        }
        
        // All retries failed
        throw lastError || new Error('All retries failed');
    }
    
    /**
     * Get WarpProxy instance
     */
    async function getWarpProxy(credentialId = null) {
        const credential = credentialId 
            ? await warpStore.getById(credentialId)
            : await warpStore.getRandomActive();
            
        if (!credential) {
            throw new Error('No available Warp credentials');
        }
        
        // Check cache
        if (warpProxies.has(credential.id)) {
            const proxy = warpProxies.get(credential.id);
            // Check if token is expired
            if (!isTokenExpired(proxy.accessToken)) {
                return { proxy, credential };
            }
        }
        
        // Refresh token
        let accessToken = credential.accessToken;
        if (!accessToken || isTokenExpired(accessToken)) {
            const result = await refreshAccessToken(credential.refreshToken);
            accessToken = result.accessToken;
            await warpStore.updateToken(credential.id, accessToken, new Date(Date.now() + result.expiresIn * 1000));
        }
        
        // Create new proxy
        const proxy = new WarpProxy({ 
            accessToken,
            maxIterations: 20,
            autoExecuteTools: true
        });
        warpProxies.set(credential.id, proxy);
        
        return { proxy, credential };
    }
    
    /**
     * Verify API key middleware
     */
    async function verifyWarpApiKey(req, res, next) {
        // Get key from Authorization header or X-API-Key
        const authHeader = req.headers.authorization;
        const xApiKey = req.headers['x-api-key'];
        
        let apiKey = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7);
        } else if (xApiKey) {
            apiKey = xApiKey;
        }
        
        if (!apiKey) {
            return res.status(401).json({
                error: {
                    message: 'Missing API key. Please include your API key in the Authorization header as "Bearer YOUR_API_KEY" or in the X-API-Key header.',
                    type: 'authentication_error',
                    code: 'missing_api_key'
                }
            });
        }
        
        // Verify key
        const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const keyRecord = await apiKeyStore.getByKeyHash(hash);
        
        if (!keyRecord) {
            return res.status(401).json({
                error: {
                    message: 'Invalid API key provided.',
                    type: 'authentication_error',
                    code: 'invalid_api_key'
                }
            });
        }
        
        if (!keyRecord.isActive) {
            return res.status(401).json({
                error: {
                    message: 'API key is disabled.',
                    type: 'authentication_error',
                    code: 'disabled_api_key'
                }
            });
        }
        
        // Attach key info to request object
        req.apiKey = keyRecord;
        
        // Update last used time
        await apiKeyStore.updateLastUsed(keyRecord.id);
        
        next();
    }

    // Warp API configuration
    const WARP_CONFIG = {
        host: 'app.warp.dev',
        path: '/ai/multi-agent',
        headers: {
            'x-warp-client-id': 'warp-app',
            'x-warp-client-version': 'v0.2026.01.14.08.15.stable_02',
            'x-warp-os-category': 'macOS',
            'x-warp-os-name': 'macOS',
            'x-warp-os-version': '15.7.2',
            'content-type': 'application/x-protobuf',
            'accept': 'text/event-stream',
            'accept-encoding': 'identity',
        }
    };

    /**
     * Send Warp request using protobufjs
     * @param {Object} claudeRequest - Claude API format request
     * @param {string} accessToken - Warp access token
     * @param {Object} context - Context information
     * @returns {Promise<Object>} Response result
     */
    async function sendProtobufRequest(claudeRequest, accessToken, context = {}) {
        // Ensure proto is loaded
        await loadProtos();

        // Build Warp request
        const warpRequest = buildWarpRequest(claudeRequest, context);

        // Encode to protobuf
        const requestBuffer = encodeRequest(warpRequest);

        return new Promise((resolve, reject) => {
            const options = {
                hostname: WARP_CONFIG.host,
                port: 443,
                path: WARP_CONFIG.path,
                method: 'POST',
                headers: {
                    ...WARP_CONFIG.headers,
                    'authorization': `Bearer ${accessToken}`,
                    'content-length': requestBuffer.length
                }
            };

            const req = https.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let errorData = '';
                    res.on('data', chunk => errorData += chunk);
                    res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errorData}`)));
                    return;
                }

                const state = createSSEState(`msg_${Date.now()}`, claudeRequest.model || 'auto', 0);
                let buffer = '';

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            const eventData = line.substring(5).trim();
                            if (eventData) {
                                try {
                                    const decoded = Buffer.from(eventData, 'base64');
                                    const responseEvent = decodeResponseEvent(decoded);
                                    const eventObj = responseEventToObject(responseEvent);
                                    const events = parseWarpResponseEvent(eventObj);

                                    for (const event of events) {
                                        if (event.type === 'text_delta' || event.type === 'agent_output') {
                                            state.fullText = (state.fullText || '') + (event.text || '');
                                        } else if (event.type === 'tool_use') {
                                            state.toolCalls = state.toolCalls || [];
                                            state.toolCalls.push(event.toolUse);
                                        } else if (event.type === 'stream_finished') {
                                            state.finished = true;
                                            state.usage = event.usage;
                                            state.stopReason = event.reason;
                                        }
                                    }
                                } catch (e) {
                                    // Decode failed, ignore
                                    if (process.env.WARP_DEBUG === 'true') {
                                        console.log(`  [PROTO DEBUG] decode error: ${e.message}`);
                                    }
                                }
                            }
                        }
                    }
                });

                res.on('end', () => {
                    // Process remaining buffer
                    if (buffer.startsWith('data:')) {
                        const eventData = buffer.substring(5).trim();
                        if (eventData) {
                            try {
                                const decoded = Buffer.from(eventData, 'base64');
                                const responseEvent = decodeResponseEvent(decoded);
                                const eventObj = responseEventToObject(responseEvent);
                                const events = parseWarpResponseEvent(eventObj);

                                for (const event of events) {
                                    if (event.type === 'text_delta' || event.type === 'agent_output') {
                                        state.fullText = (state.fullText || '') + (event.text || '');
                                    } else if (event.type === 'tool_use') {
                                        state.toolCalls = state.toolCalls || [];
                                        state.toolCalls.push(event.toolUse);
                                    }
                                }
                            } catch (e) { }
                        }
                    }

                    resolve({
                        text: state.fullText || '',
                        toolCalls: state.toolCalls || [],
                        usage: state.usage || { input_tokens: 0, output_tokens: 0 },
                        stopReason: state.stopReason || 'end_turn'
                    });
                });

                res.on('error', reject);
            });

            req.on('error', reject);
            req.write(requestBuffer);
            req.end();
        });
    }

    /**
     * Send streaming Warp request using protobufjs
     * @param {Object} claudeRequest - Claude API format request
     * @param {string} accessToken - Warp access token
     * @param {Object} context - Context information
     * @param {Function} onEvent - Event callback
     * @returns {Promise<void>}
     */
    async function sendProtobufStreamRequest(claudeRequest, accessToken, context, onEvent) {
        // Ensure proto is loaded
        await loadProtos();

        // Build Warp request
        const warpRequest = buildWarpRequest(claudeRequest, context);

        // Encode to protobuf
        const requestBuffer = encodeRequest(warpRequest);

        return new Promise((resolve, reject) => {
            const options = {
                hostname: WARP_CONFIG.host,
                port: 443,
                path: WARP_CONFIG.path,
                method: 'POST',
                headers: {
                    ...WARP_CONFIG.headers,
                    'authorization': `Bearer ${accessToken}`,
                    'content-length': requestBuffer.length
                }
            };

            const req = https.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let errorData = '';
                    res.on('data', chunk => errorData += chunk);
                    res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errorData}`)));
                    return;
                }

                let buffer = '';

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            const eventData = line.substring(5).trim();
                            if (eventData) {
                                try {
                                    const decoded = Buffer.from(eventData, 'base64');
                                    const responseEvent = decodeResponseEvent(decoded);
                                    const eventObj = responseEventToObject(responseEvent);
                                    const events = parseWarpResponseEvent(eventObj);

                                    for (const event of events) {
                                        onEvent(event);
                                    }
                                } catch (e) {
                                    if (process.env.WARP_DEBUG === 'true') {
                                        console.log(`  [PROTO DEBUG] decode error: ${e.message}`);
                                    }
                                }
                            }
                        }
                    }
                });

                res.on('end', () => {
                    // Process remaining buffer
                    if (buffer.startsWith('data:')) {
                        const eventData = buffer.substring(5).trim();
                        if (eventData) {
                            try {
                                const decoded = Buffer.from(eventData, 'base64');
                                const responseEvent = decodeResponseEvent(decoded);
                                const eventObj = responseEventToObject(responseEvent);
                                const events = parseWarpResponseEvent(eventObj);

                                for (const event of events) {
                                    onEvent(event);
                                }
                            } catch (e) { }
                        }
                    }
                    resolve();
                });

                res.on('error', reject);
            });

            req.on('error', reject);
            req.write(requestBuffer);
            req.end();
        });
    }

    /**
     * Protobuf request with retry
     */
    async function sendProtobufRequestWithRetry(claudeRequest, context = {}) {
        let lastError = null;
        let triedCredentialIds = new Set();

        for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
            const allCredentials = await warpStore.getAllActive();
            const availableCredentials = allCredentials.filter(c =>
                !triedCredentialIds.has(c.id) &&
                !RETRY_CONFIG.excludeCredentialIds.has(c.id)
            );

            if (availableCredentials.length === 0) {
                if (lastError) throw lastError;
                throw new Error('No available Warp accounts (all account quotas exhausted)');
            }

            const credential = availableCredentials[Math.floor(Math.random() * availableCredentials.length)];
            triedCredentialIds.add(credential.id);

            try {
                const accessToken = await warpService.getValidAccessToken(credential);
                console.log(`  -> [protobuf attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}] using credential #${credential.id}`);

                const response = await sendProtobufRequest(claudeRequest, accessToken, context);
                await warpStore.incrementUseCount(credential.id);

                return { response, credentialId: credential.id };
            } catch (error) {
                lastError = error;

                if (error.message && error.message.includes('429')) {
                    console.log(`  <- [429] credential #${credential.id} quota exhausted, trying next...`);
                    RETRY_CONFIG.excludeCredentialIds.add(credential.id);
                    await warpStore.markQuotaExhausted(credential.id).catch(() => { });
                    await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.retryDelay));
                    continue;
                }

                throw error;
            }
        }

        throw lastError || new Error('All retries failed');
    }

    // ============ Test endpoints (no API Key required) ============
    
    // Test /w/v1/messages endpoint functionality (no verification)
    app.post('/api/warp/test/messages', async (req, res) => {
        const startTime = Date.now();
        const requestId = generateRequestId();
        
        try {
            const { model, messages, system, metadata } = req.body;
            const workingDir = metadata?.working_dir || '/tmp';

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({
                    type: 'error',
                    error: { type: 'invalid_request_error', message: 'messages is required' }
                });
            }

            // Build query
            let query = '';
            if (system) query += `[System] ${system}\n\n`;
            
            for (const m of messages) {
                if (m.role === 'user') {
                    if (typeof m.content === 'string') {
                        query += m.content + '\n\n';
                    } else if (Array.isArray(m.content)) {
                        for (const block of m.content) {
                            if (block.type === 'text') query += block.text + '\n\n';
                            else if (block.type === 'tool_result') {
                                query += `[Tool execution result]\nCommand ID: ${block.tool_use_id}\nOutput:\n${block.content}\n\n`;
                            }
                        }
                    }
                } else if (m.role === 'assistant') {
                    if (typeof m.content === 'string') query += `[Assistant] ${m.content}\n\n`;
                }
            }

            const warpModel = mapModelToWarp(model || 'claude-4.1-opus');
            
            // Get credentials
            const credential = await warpStore.getRandomActive();
            if (!credential) {
                return res.status(503).json({ type: 'error', error: { message: 'No available Warp accounts' } });
            }
            
            const accessToken = await warpService.getValidAccessToken(credential);
            const { sendWarpRequest } = await import('./warp-service.js');
            const warpResponse = await sendWarpRequest(query, accessToken, warpModel);
            await warpStore.incrementUseCount(credential.id);
            
            const toolCalls = warpResponse.toolCalls || [];
            const contentBlocks = [];
            
            if (warpResponse.text) {
                contentBlocks.push({ type: 'text', text: warpResponse.text });
            }
            
            if (toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    contentBlocks.push({
                        type: 'tool_use',
                        id: tc.callId || `toolu_${Date.now()}`,
                        name: 'Bash',
                        input: { command: tc.command }
                    });
                }
            }
            
            if (contentBlocks.length === 0) {
                contentBlocks.push({ type: 'text', text: 'How can I help you?' });
            }

            res.json({
                id: `msg_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: contentBlocks,
                model: warpModel,
                stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
                usage: { input_tokens: query.length, output_tokens: (warpResponse.text || '').length }
            });
        } catch (error) {
            res.status(500).json({ type: 'error', error: { message: error.message } });
        }
    });

    // ============ Warp Credential Management ============

    // Get all Warp credentials
    app.get('/api/warp/credentials', async (req, res) => {
        try {
            const credentials = await warpStore.getAll();
            // Hide sensitive information
            const safeCredentials = credentials.map(c => ({
                ...c,
                refreshToken: c.refreshToken ? `${c.refreshToken.substring(0, 20)}...` : null,
                accessToken: c.accessToken ? `${c.accessToken.substring(0, 20)}...` : null
            }));
            res.json({ success: true, data: safeCredentials });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get Warp statistics
    app.get('/api/warp/statistics', async (req, res) => {
        try {
            const stats = await warpStore.getStatistics();
            res.json({ success: true, data: stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get single Warp credential
    app.get('/api/warp/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await warpStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential does not exist' });
            }
            // Hide sensitive information
            const safeCredential = {
                ...credential,
                refreshToken: credential.refreshToken ? `${credential.refreshToken.substring(0, 20)}...` : null,
                accessToken: credential.accessToken ? `${credential.accessToken.substring(0, 20)}...` : null
            };
            res.json({ success: true, data: safeCredential });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Add Warp credential
    app.post('/api/warp/credentials', async (req, res) => {
        try {
            const { name, refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({ success: false, error: 'refreshToken is required' });
            }

            // Try refreshing token to verify
            let accessToken = null;
            let email = null;
            let tokenExpiresAt = null;

            try {
                const result = await refreshAccessToken(refreshToken);
                accessToken = result.accessToken;
                tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
                email = getEmailFromToken(accessToken);
            } catch (e) {
                return res.status(400).json({ success: false, error: `Token verification failed: ${e.message}` });
            }

            // Generate name
            const credName = name || email || `warp-${Date.now()}`;

            // Check if already exists
            const existing = await warpStore.getByName(credName);
            if (existing) {
                return res.status(400).json({ success: false, error: 'Credential name already exists' });
            }

            const id = await warpStore.add({
                name: credName,
                email,
                refreshToken,
                accessToken,
                tokenExpiresAt
            });

            res.json({ success: true, data: { id, name: credName, email } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Batch import Warp credentials
    app.post('/api/warp/credentials/batch-import', async (req, res) => {
        try {
            const { accounts } = req.body;

            if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
                return res.status(400).json({ success: false, error: 'Please provide an account array' });
            }

            const results = {
                success: 0,
                failed: 0,
                errors: []
            };

            for (const account of accounts) {
                try {
                    // Support multiple field names
                    const refreshToken = account.refreshToken || account.refresh_token || account.token;
                    const name = account.name || account.email;

                    if (!refreshToken) {
                        results.failed++;
                        results.errors.push({ name, error: 'Missing refreshToken' });
                        continue;
                    }

                    // Try refreshing token to verify
                    let accessToken = null;
                    let email = null;
                    let tokenExpiresAt = null;

                    try {
                        const result = await refreshAccessToken(refreshToken);
                        accessToken = result.accessToken;
                        tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
                        email = getEmailFromToken(accessToken);
                    } catch (e) {
                        results.failed++;
                        results.errors.push({ name, error: `Token verification failed: ${e.message}` });
                        continue;
                    }

                    // Generate name
                    const credName = name || email || `warp-${Date.now()}-${results.success}`;

                    // Check if already exists
                    const existing = await warpStore.getByName(credName);
                    if (existing) {
                        // Update existing credential
                        await warpStore.update(existing.id, {
                            refreshToken,
                            accessToken,
                            tokenExpiresAt,
                            email
                        });
                        results.success++;
                        continue;
                    }

                    await warpStore.add({
                        name: credName,
                        email,
                        refreshToken,
                        accessToken,
                        tokenExpiresAt
                    });

                    results.success++;
                } catch (e) {
                    results.failed++;
                    results.errors.push({ name: account.name || account.email, error: e.message });
                }
            }

            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Update Warp credential
    app.put('/api/warp/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { name, isActive } = req.body;

            const credential = await warpStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential does not exist' });
            }

            await warpStore.update(id, { name, isActive });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete Warp credential
    app.delete('/api/warp/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await warpStore.delete(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Refresh single credential Token
    app.post('/api/warp/credentials/:id/refresh', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await warpStore.getById(id);

            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential does not exist' });
            }

            const result = await refreshAccessToken(credential.refreshToken);
            const tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);

            await warpStore.updateToken(id, result.accessToken, tokenExpiresAt);

            res.json({
                success: true,
                data: {
                    expiresAt: tokenExpiresAt,
                    expiresIn: result.expiresIn
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Batch refresh all Tokens
    app.post('/api/warp/credentials/refresh-all', async (req, res) => {
        try {
            const results = await warpService.refreshAllTokens();
            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Health check
    app.get('/api/warp/health', async (req, res) => {
        try {
            const health = await warpService.healthCheck();
            res.json({ success: true, data: health });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get Warp model list
    app.get('/api/warp/models', async (req, res) => {
        res.json({ success: true, data: WARP_MODELS });
    });

    // ============ Error Credential Management ============

    // Get all error credentials
    app.get('/api/warp/errors', async (req, res) => {
        try {
            const errors = await warpStore.getAllErrors();
            res.json({ success: true, data: errors });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Restore error credential
    app.post('/api/warp/errors/:id/restore', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { refreshToken } = req.body;

            const newId = await warpStore.restoreFromError(id, refreshToken);
            if (!newId) {
                return res.status(404).json({ success: false, error: 'Error credential does not exist' });
            }

            res.json({ success: true, data: { id: newId } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete error credential
    app.delete('/api/warp/errors/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await warpStore.deleteError(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ Warp Conversation API ============

    // Simple conversation interface (supports specified account)
    app.post('/api/warp/chat', async (req, res) => {
        try {
            const { query, model, credentialId } = req.body;

            if (!query) {
                return res.status(400).json({ success: false, error: 'Please provide query' });
            }

            let result;
            if (credentialId) {
                // Use specified account
                const credential = await warpStore.getById(credentialId);
                if (!credential) {
                    return res.status(404).json({ success: false, error: 'Account does not exist' });
                }
                const accessToken = await warpService.getValidAccessToken(credential);
                const { sendWarpRequest } = await import('./warp-service.js');
                const warpResponse = await sendWarpRequest(query, accessToken, model || 'claude-4.1-opus');
                await warpStore.incrementUseCount(credentialId);
                result = { response: warpResponse.text, credentialId, credentialName: credential.name };
            } else {
                // Auto select account
                result = await warpService.chat(query, model || 'claude-4.1-opus');
            }
            
            res.json({
                success: true,
                data: {
                    response: result.response,
                    credentialName: result.credentialName
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Multi-agent conversation interface (supports tool call loop)
    app.post('/api/warp/agent', async (req, res) => {
        try {
            const { query, model, workingDir, sessionId } = req.body;

            if (!query) {
                return res.status(400).json({ success: false, error: 'Please provide query' });
            }

            // Use multi-agent service to process request
            const result = await multiAgentService.chat(query, {
                model: model || 'claude-4.1-opus',
                workingDir: workingDir || process.cwd(),
                sessionId
            });
            
            res.json({
                success: true,
                data: {
                    response: result.response,
                    toolCalls: result.toolCalls
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Multi-agent streaming conversation interface
    app.post('/api/warp/agent/stream', async (req, res) => {
        const { query, model, workingDir, sessionId } = req.body;

        if (!query) {
            return res.status(400).json({ success: false, error: 'Please provide query' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
            for await (const event of multiAgentService.processQuery(query, {
                model: model || 'claude-4.1-opus',
                workingDir: workingDir || process.cwd(),
                sessionId
            })) {
                res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
            res.end();
        } catch (error) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    });

    // ============ Interactive Tool Call API ============
    // Session storage (in memory, Redis should be used in production)
    const agentSessions = new Map();

    // Start conversation - Return AI response and tool call request (requires user confirmation)
    app.post('/api/warp/agent/start', async (req, res) => {
        try {
            const { query, model, workingDir } = req.body;

            if (!query) {
                return res.status(400).json({ success: false, error: 'Please provide query' });
            }

            // Get credentials
            const credential = await warpStore.getRandomActive();
            if (!credential) {
                return res.status(503).json({ success: false, error: 'No available Warp accounts' });
            }

            const accessToken = await warpService.getValidAccessToken(credential);
            const { sendWarpRequest } = await import('./warp-service.js');
            
            // Send request
            const warpResponse = await sendWarpRequest(query, accessToken, model || 'claude-4.1-opus');
            await warpStore.incrementUseCount(credential.id);

            // Generate session ID
            const sessionId = crypto.randomUUID();
            
            // Save session state
            agentSessions.set(sessionId, {
                credentialId: credential.id,
                credentialName: credential.name,
                query,
                model: model || 'claude-4.1-opus',
                workingDir: workingDir || '/tmp',
                toolCalls: warpResponse.toolCalls || [],
                history: [{ role: 'user', content: query }, { role: 'assistant', content: warpResponse.text }],
                createdAt: Date.now()
            });

            // Clean up expired sessions (30 minutes)
            for (const [id, session] of agentSessions) {
                if (Date.now() - session.createdAt > 30 * 60 * 1000) {
                    agentSessions.delete(id);
                }
            }

            res.json({
                success: true,
                data: {
                    sessionId,
                    response: warpResponse.text,
                    toolCalls: warpResponse.toolCalls || [],
                    needsConfirmation: (warpResponse.toolCalls || []).length > 0,
                    credentialName: credential.name
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Execute command - Execute bash command after user confirmation
    app.post('/api/warp/agent/execute', async (req, res) => {
        try {
            const { sessionId, command, workingDir } = req.body;

            if (!command) {
                return res.status(400).json({ success: false, error: 'Please provide command' });
            }

            const session = sessionId ? agentSessions.get(sessionId) : null;
            const cwd = workingDir || (session ? session.workingDir : '/tmp');

            // Execute command
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            let result;
            try {
                const { stdout, stderr } = await execAsync(command, { 
                    cwd, 
                    timeout: 30000,
                    maxBuffer: 1024 * 1024 
                });
                result = {
                    success: true,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    command,
                    cwd
                };
            } catch (execError) {
                result = {
                    success: false,
                    error: execError.message,
                    stdout: execError.stdout?.trim() || '',
                    stderr: execError.stderr?.trim() || '',
                    command,
                    cwd
                };
            }

            // Update session
            if (session) {
                session.lastToolResult = result;
                session.history.push({ role: 'tool', content: result.stdout || result.stderr || result.error });
            }

            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Continue conversation - Send tool result back to Warp
    app.post('/api/warp/agent/continue', async (req, res) => {
        try {
            const { sessionId, toolResult } = req.body;

            if (!sessionId) {
                return res.status(400).json({ success: false, error: 'Please provide sessionId' });
            }

            const session = agentSessions.get(sessionId);
            if (!session) {
                return res.status(404).json({ success: false, error: 'Session does not exist or has expired' });
            }

            // Get credentials
            const credential = await warpStore.getById(session.credentialId);
            if (!credential) {
                return res.status(503).json({ success: false, error: 'Account not available' });
            }

            const accessToken = await warpService.getValidAccessToken(credential);
            const { sendWarpRequest } = await import('./warp-service.js');

            // Build query containing tool results
            const result = toolResult || session.lastToolResult;
            const continueQuery = `${session.query}\n\n[Tool execution result]\nCommand: ${result.command}\nOutput:\n${result.stdout || result.stderr || result.error}`;

            // Send request
            const warpResponse = await sendWarpRequest(continueQuery, accessToken, session.model);
            await warpStore.incrementUseCount(credential.id);

            // Update session
            session.history.push({ role: 'assistant', content: warpResponse.text });
            session.toolCalls = warpResponse.toolCalls || [];

            res.json({
                success: true,
                data: {
                    sessionId,
                    response: warpResponse.text,
                    toolCalls: warpResponse.toolCalls || [],
                    needsConfirmation: (warpResponse.toolCalls || []).length > 0,
                    credentialName: session.credentialName
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get session state
    app.get('/api/warp/agent/session/:sessionId', async (req, res) => {
        const session = agentSessions.get(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session does not exist or has expired' });
        }
        res.json({
            success: true,
            data: {
                sessionId: req.params.sessionId,
                query: session.query,
                model: session.model,
                workingDir: session.workingDir,
                toolCalls: session.toolCalls,
                historyLength: session.history.length,
                createdAt: session.createdAt
            }
        });
    });

    // ============ OpenAI Compatible Endpoints (API Key verification required) ============

    // Warp OpenAI compatible - /w/v1/chat/completions
    app.post('/w/v1/chat/completions', verifyWarpApiKey, async (req, res) => {
        const startTime = Date.now();
        const apiKeyId = req.apiKey?.id || null;
        const requestId = generateRequestId();
        
        // Print request details
        console.log('\n' + '='.repeat(80));
        console.log(`[${new Date().toISOString()}] /w/v1/chat/completions Request`);
        console.log('='.repeat(80));
        console.log(`Request ID: ${requestId}`);
        console.log(`API Key: ${req.apiKey?.keyPrefix || 'unknown'}***`);
        console.log(`IP: ${req.ip || req.connection?.remoteAddress}`);
        console.log(`User-Agent: ${req.headers['user-agent']}`);
        console.log('-'.repeat(40));
        console.log('Request body:');
        console.log(JSON.stringify(req.body, null, 2));
        console.log('='.repeat(80));
        
        try {
            const { model, messages, stream } = req.body;

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({
                    error: {
                        message: 'messages is required',
                        type: 'invalid_request_error'
                    }
                });
            }

            // Convert messages to single query
            const query = messages.map(m => {
                if (m.role === 'system') return `[System] ${m.content}`;
                if (m.role === 'user') return m.content;
                if (m.role === 'assistant') return `[Assistant] ${m.content}`;
                return m.content;
            }).join('\n\n');

            // Convert external model name to Warp supported model name
            const warpModel = mapModelToWarp(model);
            const inputTokens = estimateTokens(query);

            if (stream) {
                // Streaming response
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const responseId = `chatcmpl-${Date.now()}`;
                let fullContent = '';
                let usedCredentialId = null;

                warpService.chatStream(
                    query,
                    warpModel,
                    (content, credentialId) => {
                        fullContent += content;
                        if (credentialId) usedCredentialId = credentialId;
                        const chunk = {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: warpModel,
                            choices: [{
                                index: 0,
                                delta: { content },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    },
                    async (credentialId) => {
                        if (credentialId) usedCredentialId = credentialId;
                        // Send end marker
                        const endChunk = {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: warpModel,
                            choices: [{
                                index: 0,
                                delta: {},
                                finish_reason: 'stop'
                            }]
                        };
                        res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
                        res.write('data: [DONE]\n\n');
                        res.end();
                        
                        // Record statistics to api_logs (do not record message content)
                        const outputTokens = estimateTokens(fullContent);
                        await apiLogStore.create({
                            requestId: generateRequestId(),
                            apiKeyId,
                            apiKeyPrefix: req.apiKey?.keyPrefix || null,
                            credentialId: usedCredentialId || null,
                            ipAddress: req.ip || req.connection?.remoteAddress,
                            userAgent: req.headers['user-agent'],
                            method: 'POST',
                            path: '/w/v1/chat/completions',
                            model: warpModel,
                            stream: true,
                            inputTokens,
                            outputTokens,
                            requestMessages: null,
                            responseContent: null,
                            statusCode: 200,
                            durationMs: Date.now() - startTime
                        });
                    },
                    async (error) => {
                        const errorChunk = {
                            error: {
                                message: error.message,
                                type: 'server_error'
                            }
                        };
                        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
                        res.end();
                        
                        // Record error statistics to api_logs
                        await apiLogStore.create({
                            requestId: generateRequestId(),
                            apiKeyId,
                            apiKeyPrefix: req.apiKey?.keyPrefix || null,
                            credentialId: usedCredentialId || null,
                            ipAddress: req.ip || req.connection?.remoteAddress,
                            userAgent: req.headers['user-agent'],
                            method: 'POST',
                            path: '/w/v1/chat/completions',
                            model: warpModel,
                            stream: true,
                            inputTokens,
                            outputTokens: 0,
                            requestMessages: null,
                            responseContent: null,
                            statusCode: 500,
                            errorMessage: error.message,
                            durationMs: Date.now() - startTime
                        });
                    }
                );
            } else {
                // Non-streaming response
                const result = await warpService.chat(query, warpModel);
                const outputTokens = estimateTokens(result.response);

                // Print non-streaming response details
                const durationMs = Date.now() - startTime;
                console.log('\n' + '-'.repeat(80));
                console.log(`[${new Date().toISOString()}] /w/v1/chat/completions Non-streaming response`);
                console.log('-'.repeat(80));
                console.log(`Request ID: ${requestId}`);
                console.log(`Model: ${warpModel}`);
                console.log(`Credential ID: ${result.credentialId || 'unknown'}`);
                console.log(`Input tokens: ${inputTokens}, Output tokens: ${outputTokens}`);
                console.log(`Duration: ${durationMs}ms`);
                console.log('-'.repeat(40));
                console.log('Response content:');
                console.log(result.response);
                console.log('='.repeat(80) + '\n');

                // Record statistics to api_logs (do not record message content)
                await apiLogStore.create({
                    requestId,
                    apiKeyId,
                    apiKeyPrefix: req.apiKey?.keyPrefix || null,
                    credentialId: result.credentialId || null,
                    ipAddress: req.ip || req.connection?.remoteAddress,
                    userAgent: req.headers['user-agent'],
                    method: 'POST',
                    path: '/w/v1/chat/completions',
                    model: warpModel,
                    stream: false,
                    inputTokens,
                    outputTokens,
                    requestMessages: null,
                    responseContent: null,
                    statusCode: 200,
                    durationMs
                });

                res.json({
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: warpModel,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: result.response
                        },
                        finish_reason: 'stop'
                    }],
                    usage: {
                        prompt_tokens: inputTokens,
                        completion_tokens: outputTokens,
                        total_tokens: inputTokens + outputTokens
                    }
                });
            }
        } catch (error) {
            // Record error statistics to api_logs
            await apiLogStore.create({
                requestId: generateRequestId(),
                apiKeyId,
                apiKeyPrefix: req.apiKey?.keyPrefix || null,
                credentialId: null,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: 'POST',
                path: '/w/v1/chat/completions',
                model: req.body?.model || 'unknown',
                stream: req.body?.stream || false,
                inputTokens: 0,
                outputTokens: 0,
                requestMessages: null,
                responseContent: null,
                statusCode: 500,
                errorMessage: error.message,
                durationMs: Date.now() - startTime
            });
            
            res.status(500).json({
                error: {
                    message: error.message,
                    type: 'server_error'
                }
            });
        }
    });

    // Warp Model list - /w/v1/models
    app.get('/w/v1/models', async (req, res) => {
        const models = WARP_MODELS.map(m => ({
            id: m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'warp'
        }));

        res.json({
            object: 'list',
            data: models
        });
    });

    // ============ Claude Format Endpoints ============

    // Session storage (for continuous conversation with tool calls)
    const messagesSessions = new Map();

    // Warp Claude format (Protobuf version) - /w/v1/messages/proto
    // Use protobufjs for encoding/decoding, supports full tool mapping
    app.post('/w/v1/messages/proto', verifyWarpApiKey, async (req, res) => {
        const startTime = Date.now();
        const apiKeyId = req.apiKey?.id || null;
        const requestId = generateRequestId();

        try {
            const { model, messages, max_tokens, stream, system, metadata, tools } = req.body;
            const workingDir = metadata?.working_dir || '/tmp';

            console.log(`\n[${new Date().toISOString()}] /w/v1/messages/proto | id=${requestId} | key=${req.apiKey?.keyPrefix || '?'}***`);
            console.log(`  stream=${Boolean(stream)} model=${model || '?'} msgs=${Array.isArray(messages) ? messages.length : 0} tools=${Array.isArray(tools) ? tools.length : 0} working_dir=${workingDir}`);

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({
                    type: 'error',
                    error: { type: 'invalid_request_error', message: 'messages is required' }
                });
            }

            // Build Claude request object
            const claudeRequest = { model, messages, system, tools, metadata };
            const context = { workingDir, homeDir: process.env.HOME || '/root' };

            // Convert external model name to Warp supported model name
            const warpModel = mapModelToWarp(model);
            const inputTokens = estimateTokens(JSON.stringify(messages));

            if (stream) {
                // Streaming response
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const messageId = `msg_${Date.now()}`;
                const state = createSSEState(messageId, warpModel, inputTokens);
                let usedCredentialId = null;

                // Send message_start
                const startEvent = createMessageStartSSE(state);
                res.write(`event: ${startEvent.event}\ndata: ${JSON.stringify(startEvent.data)}\n\n`);

                try {
                    // Get credentials
                    const allCredentials = await warpStore.getAllActive();
                    const availableCredentials = allCredentials.filter(c =>
                        !RETRY_CONFIG.excludeCredentialIds.has(c.id)
                    );

                    if (availableCredentials.length === 0) {
                        throw new Error('No available Warp accounts');
                    }

                    const credential = availableCredentials[Math.floor(Math.random() * availableCredentials.length)];
                    usedCredentialId = credential.id;
                    const accessToken = await warpService.getValidAccessToken(credential);

                    console.log(`  -> [protobuf stream] using credential #${credential.id}`);

                    // Send streaming request
                    await sendProtobufStreamRequest(claudeRequest, accessToken, context, (event) => {
                        const sseEvents = convertToClaudeSSE([event], state);
                        for (const sse of sseEvents) {
                            res.write(`event: ${sse.event}\ndata: ${JSON.stringify(sse.data)}\n\n`);
                        }
                    });

                    // Ensure end events are sent
                    if (!state.finished) {
                        // End text block
                        if (state.textBlockStarted) {
                            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: state.blockIndex })}\n\n`);
                        }

                        const stopReason = (state.toolCalls && state.toolCalls.length > 0) ? 'tool_use' : 'end_turn';
                        res.write(`event: message_delta\ndata: ${JSON.stringify({
                            type: 'message_delta',
                            delta: { stop_reason: stopReason, stop_sequence: null },
                            usage: { output_tokens: estimateTokens(state.fullText || '') }
                        })}\n\n`);

                        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                    }

                    await warpStore.incrementUseCount(credential.id);
                    res.end();

                    // Log
                    const durationMs = Date.now() - startTime;
                    await apiLogStore.create({
                        requestId,
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId: usedCredentialId,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w/v1/messages/proto',
                        model: warpModel,
                        stream: true,
                        inputTokens,
                        outputTokens: estimateTokens(state.fullText || ''),
                        statusCode: 200,
                        durationMs
                    });

                } catch (error) {
                    console.error(`  [ERROR] ${error.message}`);
                    res.write(`event: error\ndata: ${JSON.stringify({
                        type: 'error',
                        error: { type: 'server_error', message: error.message }
                    })}\n\n`);
                    res.end();
                }

            } else {
                // Non-streaming response
                try {
                    const { response, credentialId } = await sendProtobufRequestWithRetry(claudeRequest, context);

                    console.log(`  <- [protobuf] text=${(response.text || '').length}c toolCalls=${(response.toolCalls || []).length}`);

                    // Build Response content
                    const contentBlocks = [];

                    if (response.text) {
                        contentBlocks.push({ type: 'text', text: response.text });
                    }

                    if (response.toolCalls && response.toolCalls.length > 0) {
                        for (const toolUse of response.toolCalls) {
                            contentBlocks.push(toolUse);
                        }
                    }

                    if (contentBlocks.length === 0) {
                        contentBlocks.push({ type: 'text', text: '' });
                    }

                    const outputTokens = estimateTokens(response.text || '');
                    const stopReason = (response.toolCalls && response.toolCalls.length > 0) ? 'tool_use' : 'end_turn';

                    // Log
                    const durationMs = Date.now() - startTime;
                    await apiLogStore.create({
                        requestId,
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w/v1/messages/proto',
                        model: warpModel,
                        stream: false,
                        inputTokens,
                        outputTokens,
                        statusCode: 200,
                        durationMs
                    });

                    res.json({
                        id: `msg_${Date.now()}`,
                        type: 'message',
                        role: 'assistant',
                        content: contentBlocks,
                        model: warpModel,
                        stop_reason: stopReason,
                        stop_sequence: null,
                        usage: {
                            input_tokens: inputTokens,
                            output_tokens: outputTokens
                        }
                    });

                } catch (error) {
                    console.error(`  [ERROR] ${error.message}`);

                    const durationMs = Date.now() - startTime;
                    await apiLogStore.create({
                        requestId,
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId: null,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w/v1/messages/proto',
                        model: warpModel,
                        stream: false,
                        inputTokens,
                        outputTokens: 0,
                        statusCode: 500,
                        errorMessage: error.message,
                        durationMs
                    });

                    res.status(500).json({
                        type: 'error',
                        error: { type: 'server_error', message: error.message }
                    });
                }
            }

        } catch (error) {
            console.error(`  [ERROR] ${error.message}`);
            res.status(500).json({
                type: 'error',
                error: { type: 'server_error', message: error.message }
            });
        }
    });

    // Warp Claude format - /w/v1/messages
    // Supports tool calls, user confirmation, continuous conversation
    app.post('/w/v1/messages', verifyWarpApiKey, async (req, res) => {
        const startTime = Date.now();
        const apiKeyId = req.apiKey?.id || null;
        const requestId = generateRequestId();
        
        try {
            const { model, messages, max_tokens, stream, system, metadata, tools } = req.body;
            const workingDir = metadata?.working_dir || '/tmp';
            const authHeader = req.headers.authorization;
            const hasBearer = Boolean(authHeader && authHeader.startsWith('Bearer '));
            const hasXApiKey = Boolean(req.headers['x-api-key']);

            // Concise log (do not print full req.body)
            const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '?';
            console.log(`[${new Date().toISOString()}] /w/v1/messages | ip=${clientIp} | key=${req.apiKey?.keyPrefix || '?'}*** | model=${model || '?'} | stream=${Boolean(stream)}`);

            if (Array.isArray(tools) && tools.length > 0) {
                const toolNames = tools.map(t => t.name).join(', ');
                console.log(`  tools: ${toolNames}`);
            }

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({
                    type: 'error',
                    error: {
                        type: 'invalid_request_error',
                        message: 'messages is required'
                    }
                });
            }

            // Check if there is a tool_result message (result after user confirms execution)
            const lastMessage = messages[messages.length - 1];
            let toolResultContent = null;
            let toolCommand = null;
            let sessionId = metadata?.session_id;
            
            if (lastMessage.role === 'user' && Array.isArray(lastMessage.content)) {
                for (const block of lastMessage.content) {
                    if (block.type === 'tool_result') {
                        toolResultContent = block;
                        // Find corresponding tool_use from previous assistant message to get command
                        for (let i = messages.length - 2; i >= 0; i--) {
                            const m = messages[i];
                            if (m.role === 'assistant' && Array.isArray(m.content)) {
                                for (const b of m.content) {
                                    if (b.type === 'tool_use' && b.id === block.tool_use_id) {
                                        toolCommand = b.input?.command || 'bash';
                                        break;
                                    }
                                }
                            }
                            if (toolCommand) break;
                        }
                        break;
                    }
                }
            }

            // Print extra log only when there is tool_result
            if (toolResultContent) {
                console.log(`  tool_result: id=${toolResultContent.tool_use_id || '?'} cmd=${toolCommand || '?'} len=${(toolResultContent.content || '').length}`);
            }

            // Build query
            let query = '';
            if (system) {
                // system may be string or array
                if (typeof system === 'string') {
                    query += `[System] ${system}\n\n`;
                } else if (Array.isArray(system)) {
                    for (const s of system) {
                        if (typeof s === 'string') {
                            query += `[System] ${s}\n\n`;
                        } else if (s.text) {
                            query += `[System] ${s.text}\n\n`;
                        }
                    }
                }
            }
            
            // Process messages, including tool calls and results
            for (const m of messages) {
                if (m.role === 'user') {
                    if (typeof m.content === 'string') {
                        query += m.content + '\n\n';
                    } else if (Array.isArray(m.content)) {
                        for (const block of m.content) {
                            if (block.type === 'text') {
                                query += block.text + '\n\n';
                            } else if (block.type === 'tool_result') {
                                // Tool execution result
                                query += `[Tool execution result]\nCommand ID: ${block.tool_use_id}\nOutput:\n${block.content}\n\n`;
                            }
                        }
                    }
                } else if (m.role === 'assistant') {
                    if (typeof m.content === 'string') {
                        query += `[Assistant] ${m.content}\n\n`;
                    } else if (Array.isArray(m.content)) {
                        for (const block of m.content) {
                            if (block.type === 'text') {
                                query += `[Assistant] ${block.text}\n\n`;
                            } else if (block.type === 'tool_use') {
                                query += `[Assistant requests tool execution] ${block.name}: ${JSON.stringify(block.input)}\n\n`;
                            }
                        }
                    }
                }
            }

            // Convert external model name to Warp supported model name
            const warpModel = mapModelToWarp(model);
            const inputTokens = estimateTokens(query);

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const messageId = `msg_${Date.now()}`;
                let fullContent = '';
                let usedCredentialId = null;

                res.write(`event: message_start\ndata: ${JSON.stringify({
                    type: 'message_start',
                    message: {
                        id: messageId,
                        type: 'message',
                        role: 'assistant',
                        content: [],
                        model: warpModel,
                        stop_reason: null,
                        stop_sequence: null,
                        usage: { input_tokens: inputTokens, output_tokens: 0 }
                    }
                })}\n\n`);

                try {
                    // Build request options
                    const warpReqOptions = { workingDir };
                    if (toolResultContent) {
                        warpReqOptions.toolResult = {
                            callId: toolResultContent.tool_use_id,
                            command: toolCommand || 'bash',
                            output: toolResultContent.content || ''
                        };
                        console.log(`  -> calling Warp API with tool_result:`);
                        console.log(`     callId: ${warpReqOptions.toolResult.callId}`);
                        console.log(`     command: ${warpReqOptions.toolResult.command}`);
                        console.log(`     output: "${warpReqOptions.toolResult.output.substring(0, 80)}..."`);
                        console.log(`     query: "${query.substring(0, 100)}..."`);
                    } else {
                        console.log(`  -> calling Warp API (query len=${query.length})...`);
                    }
                    
                    // Use request function with 429 retry
                    const { response: warpResponse, credentialId } = await sendWarpRequestWithRetry(query, warpModel, warpReqOptions);
                    usedCredentialId = credentialId;
                    console.log(`  <- Warp response: text=${(warpResponse.text || '').length}c toolCalls=${(warpResponse.toolCalls || []).length}`);

                    let toolCalls = warpResponse.toolCalls || [];
                    const text = warpResponse.text || '';
                    fullContent = text;
                    
                    // Debug: print actual Response content
                    if (text) {
                        console.log(`  [SSE] sending text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
                    }
                    if (toolCalls.length > 0) {
                        console.log(`  [SSE] sending ${toolCalls.length} tool_use blocks`);
                    }

                    res.write(`event: content_block_start\ndata: ${JSON.stringify({
                        type: 'content_block_start',
                        index: 0,
                        content_block: { type: 'text', text: '' }
                    })}\n\n`);

                    if (text) {
                        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                            type: 'content_block_delta',
                            index: 0,
                            delta: { type: 'text_delta', text }
                        })}\n\n`);
                    }

                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                        type: 'content_block_stop',
                        index: 0
                    })}\n\n`);

                    let blockIndex = 1;
                    if (toolCalls.length > 0) {
                        for (const tc of toolCalls) {
                            const toolUseId = tc.callId || `toolu_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                            
                            // Select correct tool name and input format based on tool type
                            let toolName = 'Bash';
                            let input = { command: tc.command };
                            
                            if (tc.toolName === 'Write' || tc.command === 'create_documents') {
                                toolName = 'Write';

                                // Debug: print original tool call info
                                console.log(`  [TOOL DEBUG] Original tool call:`, {
                                    toolName: tc.toolName,
                                    command: tc.command,
                                    filePath: tc.filePath,
                                    file_path: tc.file_path,
                                    path: tc.path,
                                    content: tc.content?.substring(0, 100) + '...',
                                    input: tc.input
                                });

                                // Smarter file path extraction
                                let filePath = tc.filePath || tc.file_path || tc.path ||
                                              (tc.input && tc.input.file_path) ||
                                              (tc.input && tc.input.path);

                                // If no explicit file path, infer from content
                                if (!filePath) {
                                    const contentToCheck = tc.content || text || '';
                                    if (contentToCheck.includes('<!doctype html') || contentToCheck.includes('<html')) {
                                        filePath = 'login.html';
                                    } else if (contentToCheck.includes('function ') || contentToCheck.includes('const ') || contentToCheck.includes('import ')) {
                                        filePath = 'script.js';
                                    } else if (contentToCheck.includes('{') && contentToCheck.includes('}') && contentToCheck.includes(':')) {
                                        filePath = 'data.json';
                                    } else {
                                        filePath = 'output.md';
                                    }
                                    console.log(`  [TOOL] Inferred file type: ${filePath}`);
                                }

                                // More complete content extraction - key fix: prioritize text content
                                let writeContent = '';

                                // 1. First try content from tool call
                                if (tc.content && tc.content.trim()) {
                                    writeContent = tc.content;
                                } else if (tc.input && tc.input.content && tc.input.content.trim()) {
                                    writeContent = tc.input.content;
                                }
                                // 2. If tool call content is empty or just description, use response text
                                else if (text && text.trim() && text.length > 100) {
                                    writeContent = text;
                                    console.log(`  [TOOL FIX] Using response text as Write content (${text.length} chars)`);
                                }
                                // 3. Final fallback
                                else {
                                    writeContent = tc.content || text || '';
                                }

                                // Parameter validation
                                if (!writeContent || writeContent.length < 10) {
                                    console.warn(`  [TOOL WARN] Write tool has insufficient content (${writeContent.length} chars)`);
                                }

                                input = {
                                    file_path: filePath,
                                    content: writeContent
                                };

                                console.log(`  [TOOL] Write: file_path=${input.file_path}, content.length=${writeContent.length}`);
                                console.log(`  [TOOL DEBUG] Processed input:`, {
                                    file_path: input.file_path,
                                    content_length: input.content?.length || 0,
                                    content_preview: input.content?.substring(0, 100) + '...'
                                });
                            }
                            
                            // Ensure only necessary fields are passed, remove extra fields
                            const cleanInput = {};
                            if (toolName === 'Write') {
                                // Parameter validation and fix
                                if (!input.file_path || input.file_path === 'undefined') {
                                    console.warn(`  [TOOL WARN] Invalid file_path: ${input.file_path}, using default`);
                                    input.file_path = 'output.md';
                                }
                                if (!input.content) {
                                    console.warn(`  [TOOL WARN] Empty content for Write tool`);
                                    input.content = '';
                                }

                                cleanInput.file_path = input.file_path;
                                cleanInput.content = input.content;

                                console.log(`  [TOOL FINAL] Write params: file_path="${cleanInput.file_path}", content_length=${cleanInput.content.length}`);
                            } else {
                                cleanInput.command = input.command;
                            }
                            const inputJson = JSON.stringify(cleanInput);

                            res.write(`event: content_block_start\ndata: ${JSON.stringify({
                                type: 'content_block_start',
                                index: blockIndex,
                                content_block: { type: 'tool_use', id: toolUseId, name: toolName, input: {} }
                            })}\n\n`);

                            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                type: 'content_block_delta',
                                index: blockIndex,
                                delta: { type: 'input_json_delta', partial_json: inputJson }
                            })}\n\n`);

                            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                type: 'content_block_stop',
                                index: blockIndex
                            })}\n\n`);

                            blockIndex++;
                        }
                    }

                    const outputTokens = estimateTokens(fullContent);
                    const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';

                    res.write(`event: message_delta\ndata: ${JSON.stringify({
                        type: 'message_delta',
                        delta: { stop_reason: stopReason, stop_sequence: null },
                        usage: { output_tokens: outputTokens }
                    })}\n\n`);

                    res.write(`event: message_stop\ndata: ${JSON.stringify({
                        type: 'message_stop'
                    })}\n\n`);

                    res.end();

                    const durationMs = Date.now() - startTime;
                    console.log(`  ✓ ${durationMs}ms | in=${inputTokens} out=${outputTokens}`);

                    await apiLogStore.create({
                        requestId,
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId: usedCredentialId || null,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w/v1/messages',
                        model: warpModel,
                        stream: true,
                        inputTokens,
                        outputTokens,
                        requestMessages: null,
                        responseContent: null,
                        statusCode: 200,
                        durationMs
                    });
                } catch (error) {
                    const durationMs = Date.now() - startTime;
                    console.error(`  ✗ ${durationMs}ms | error: ${error.message}`);

                    res.write(`event: error\ndata: ${JSON.stringify({
                        type: 'error',
                        error: { type: 'server_error', message: error.message }
                    })}\n\n`);
                    res.end();

                    await apiLogStore.create({
                        requestId,
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId: usedCredentialId || null,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w/v1/messages',
                        model: warpModel,
                        stream: true,
                        inputTokens,
                        outputTokens: 0,
                        requestMessages: null,
                        responseContent: null,
                        statusCode: 500,
                        errorMessage: error.message,
                        durationMs
                    });
                }
            } else {
                // Non-streaming response - supports tool calls
                // Build request options (same logic as streaming branch)
                const warpReqOptions = { workingDir };
                if (toolResultContent) {
                    warpReqOptions.toolResult = {
                        callId: toolResultContent.tool_use_id,
                        command: toolCommand || 'bash',
                        output: toolResultContent.content || ''
                    };
                }
                
                // Use request function with 429 retry
                const { response: warpResponse, credentialId: usedCredId } = await sendWarpRequestWithRetry(query, warpModel, warpReqOptions);
                
                let finalResponse = warpResponse.text || '';
                const toolCalls = warpResponse.toolCalls || [];
                
                // Build Response content
                const contentBlocks = [];
                
                // Add text content
                if (finalResponse) {
                    contentBlocks.push({
                        type: 'text',
                        text: finalResponse
                    });
                }
                
                // If there are tool calls, add tool_use blocks
                if (toolCalls.length > 0) {
                    for (const tc of toolCalls) {
                        const toolUseId = tc.callId || `toolu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        
                        // Select correct tool name and input format based on tool type
                        let toolName = 'Bash';
                        let input = { command: tc.command };
                        
                        if (tc.toolName === 'Write' || tc.command === 'create_documents') {
                            toolName = 'Write';

                            // Debug: print original tool call info
                            console.log(`  [TOOL DEBUG] Original tool call (non-stream):`, {
                                toolName: tc.toolName,
                                command: tc.command,
                                filePath: tc.filePath,
                                file_path: tc.file_path,
                                path: tc.path,
                                content: tc.content?.substring(0, 100) + '...',
                                input: tc.input
                            });

                            // Smarter file path extraction
                            let filePath = tc.filePath || tc.file_path || tc.path ||
                                          (tc.input && tc.input.file_path) ||
                                          (tc.input && tc.input.path);

                            // If no explicit file path, infer from content
                            if (!filePath) {
                                const contentToCheck = tc.content || finalResponse || '';
                                if (contentToCheck.includes('<!doctype html') || contentToCheck.includes('<html')) {
                                    filePath = 'login.html';
                                } else if (contentToCheck.includes('function ') || contentToCheck.includes('const ') || contentToCheck.includes('import ')) {
                                    filePath = 'script.js';
                                } else if (contentToCheck.includes('{') && contentToCheck.includes('}') && contentToCheck.includes(':')) {
                                    filePath = 'data.json';
                                } else {
                                    filePath = 'output.md';
                                }
                                console.log(`  [TOOL] Inferred file type (non-stream): ${filePath}`);
                            }

                            // More complete content extraction - key fix: prioritize finalResponse content
                            let writeContent = '';

                            // 1. First try content from tool call
                            if (tc.content && tc.content.trim()) {
                                writeContent = tc.content;
                            } else if (tc.input && tc.input.content && tc.input.content.trim()) {
                                writeContent = tc.input.content;
                            }
                            // 2. If tool call content is empty or just description, use response text
                            else if (finalResponse && finalResponse.trim() && finalResponse.length > 100) {
                                writeContent = finalResponse;
                                console.log(`  [TOOL FIX] Using response text as Write content (${finalResponse.length} chars)`);
                            }
                            // 3. Final fallback
                            else {
                                writeContent = tc.content || finalResponse || '';
                            }

                            // Parameter validation
                            if (!writeContent || writeContent.length < 10) {
                                console.warn(`  [TOOL WARN] Write tool has insufficient content (${writeContent.length} chars)`);
                            }

                            input = {
                                file_path: filePath,
                                content: writeContent
                            };

                            console.log(`  [TOOL] Write: file_path=${input.file_path}, content.length=${writeContent.length}`);
                            console.log(`  [TOOL DEBUG] Processed input (non-stream):`, {
                                file_path: input.file_path,
                                content_length: input.content?.length || 0,
                                content_preview: input.content?.substring(0, 100) + '...'
                            });
                        }
                        
                        // Ensure only necessary fields are passed, remove extra fields like description
                        const cleanInput = {};
                        if (toolName === 'Write') {
                            // Parameter validation and fix
                            if (!input.file_path || input.file_path === 'undefined') {
                                console.warn(`  [TOOL WARN] Invalid file_path: ${input.file_path}, using default`);
                                input.file_path = 'output.md';
                            }
                            if (!input.content) {
                                console.warn(`  [TOOL WARN] Empty content for Write tool`);
                                input.content = '';
                            }

                            cleanInput.file_path = input.file_path;
                            cleanInput.content = input.content;

                            console.log(`  [TOOL FINAL] Write params (non-stream): file_path="${cleanInput.file_path}", content_length=${cleanInput.content.length}`);
                        } else {
                            cleanInput.command = input.command;
                        }
                        
                        contentBlocks.push({
                            type: 'tool_use',
                            id: toolUseId,
                            name: toolName,
                            input: cleanInput
                        });
                    }
                }
                
                // If no content, add default prompt
                if (contentBlocks.length === 0) {
                    contentBlocks.push({
                        type: 'text',
                        text: 'How can I help you?'
                    });
                }

                const outputTokens = estimateTokens(finalResponse);
                const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';

                const durationMs = Date.now() - startTime;
                console.log(`  ✓ ${durationMs}ms | in=${inputTokens} out=${outputTokens}`);

                // Log statistics to api_logs
                await apiLogStore.create({
                    requestId,
                    apiKeyId,
                    apiKeyPrefix: req.apiKey?.keyPrefix || null,
                    credentialId: usedCredId,
                    ipAddress: req.ip || req.connection?.remoteAddress,
                    userAgent: req.headers['user-agent'],
                    method: 'POST',
                    path: '/w/v1/messages',
                    model: warpModel,
                    stream: false,
                    inputTokens,
                    outputTokens,
                    requestMessages: null,
                    responseContent: null,
                    statusCode: 200,
                    durationMs
                });

                // Generate session ID for continuous conversation
                const newSessionId = crypto.randomUUID();
                messagesSessions.set(newSessionId, {
                    credentialId: usedCredId,
                    query,
                    model: warpModel,
                    workingDir,
                    toolCalls,
                    createdAt: Date.now()
                });
                
                // Clean up expired sessions
                for (const [id, session] of messagesSessions) {
                    if (Date.now() - session.createdAt > 30 * 60 * 1000) {
                        messagesSessions.delete(id);
                    }
                }

                res.json({
                    id: `msg_${Date.now()}`,
                    type: 'message',
                    role: 'assistant',
                    content: contentBlocks,
                    model: warpModel,
                    stop_reason: stopReason,
                    stop_sequence: null,
                    usage: {
                        input_tokens: inputTokens,
                        output_tokens: outputTokens
                    },
                    // Extended field: session ID for continuous conversation
                    metadata: {
                        session_id: newSessionId,
                        has_tool_calls: toolCalls.length > 0
                    }
                });
            }
        } catch (error) {
            const durationMs = Date.now() - startTime;
            console.error(`  ✗ ${durationMs}ms | error: ${error.message}`);

            // Record error statistics to api_logs
            await apiLogStore.create({
                requestId,
                apiKeyId,
                apiKeyPrefix: req.apiKey?.keyPrefix || null,
                credentialId: null,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: 'POST',
                path: '/w/v1/messages',
                model: req.body?.model || 'unknown',
                stream: req.body?.stream || false,
                inputTokens: 0,
                outputTokens: 0,
                requestMessages: null,
                responseContent: null,
                statusCode: 500,
                errorMessage: error.message,
                durationMs
            });

            res.status(500).json({
                type: 'error',
                error: {
                    type: 'server_error',
                    message: error.message
                }
            });
        }
    });

    // Tool execution endpoint - execute bash command after user confirmation
    // Used together with tool_use return from /w/v1/messages
    app.post('/w/v1/tools/execute', verifyWarpApiKey, async (req, res) => {
        try {
            const { tool_use_id, command, working_dir } = req.body;

            console.log('\n' + '-'.repeat(80));
            console.log(`[${new Date().toISOString()}] /w/v1/tools/execute request`);
            console.log('-'.repeat(80));
            console.log(`API Key: ${req.apiKey?.keyPrefix || 'unknown'}***`);
            console.log(`IP: ${req.ip || req.connection?.remoteAddress}`);
            console.log(`User-Agent: ${req.headers['user-agent']}`);
            console.log(`tool_use_id: ${tool_use_id || 'unknown'}`);
            console.log(`command: ${command || 'unknown'}`);
            console.log(`working_dir: ${working_dir || '/tmp'}`);
            console.log('-'.repeat(80));

            if (!command) {
                return res.status(400).json({
                    type: 'error',
                    error: { type: 'invalid_request_error', message: 'Please provide command' }
                });
            }

            const cwd = working_dir || '/tmp';

            // Execute command
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            let result;
            try {
                const { stdout, stderr } = await execAsync(command, { 
                    cwd, 
                    timeout: 60000,
                    maxBuffer: 5 * 1024 * 1024 
                });
                result = {
                    success: true,
                    tool_use_id: tool_use_id || `toolu_${Date.now()}`,
                    output: stdout.trim() || stderr.trim() || 'Command executed successfully (no output)',
                    command,
                    working_dir: cwd
                };
            } catch (execError) {
                result = {
                    success: false,
                    tool_use_id: tool_use_id || `toolu_${Date.now()}`,
                    output: execError.stderr?.trim() || execError.stdout?.trim() || execError.message,
                    error: execError.message,
                    command,
                    working_dir: cwd
                };
            }

            console.log(`[${new Date().toISOString()}] /w/v1/tools/execute: ${command} -> ${result.success ? 'success' : 'error'}`);

            res.json({
                type: 'tool_result',
                ...result
            });
        } catch (error) {
            res.status(500).json({
                type: 'error',
                error: { type: 'server_error', message: error.message }
            });
        }
    });

    // ============ W2 Claude Format Endpoints (Full Multi-turn Tool Calls) ============
    
    // Warp Claude Format V2 - /w2/v1/messages
    // Supports full multi-turn conversation and automatic tool execution
    app.post('/w2/v1/messages', verifyWarpApiKey, async (req, res) => {
        const startTime = Date.now();
        const apiKeyId = req.apiKey?.id || null;
        const requestId = generateRequestId();
        
        console.log('\n' + '='.repeat(80));
        console.log(`[${new Date().toISOString()}] /w2/v1/messages request (multi-turn tool mode)`);
        console.log('='.repeat(80));
        console.log(`Request ID: ${requestId}`);
        console.log(`API Key: ${req.apiKey?.keyPrefix || 'unknown'}***`);
        console.log('-'.repeat(40));
        
        try {
            const { model, messages, max_tokens, stream, system } = req.body;
            
            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({
                    type: 'error',
                    error: {
                        type: 'invalid_request_error',
                        message: 'messages is required'
                    }
                });
            }
            
            // Get WarpProxy instance
            const { proxy, credential } = await getWarpProxy();
            
            // Build query
            let query = '';
            if (system) {
                query += `[System] ${system}\n\n`;
            }
            query += messages.map(m => {
                if (m.role === 'user') {
                    if (typeof m.content === 'string') return m.content;
                    if (Array.isArray(m.content)) {
                        return m.content.map(c => c.type === 'text' ? c.text : '').join('');
                    }
                    return '';
                }
                if (m.role === 'assistant') {
                    if (typeof m.content === 'string') return `[Assistant] ${m.content}`;
                    if (Array.isArray(m.content)) {
                        return `[Assistant] ${m.content.map(c => c.type === 'text' ? c.text : '').join('')}`;
                    }
                    return '';
                }
                return '';
            }).join('\n\n');
            
            const warpModel = mapModelToWarp(model);
            const inputTokens = estimateTokens(query);
            
            // Get or create sessionId from request
            const sessionId = req.headers['x-session-id'] || `session-${Date.now()}`;
            
            // Set context
            const context = {
                workingDir: req.headers['x-working-dir'] || process.cwd(),
                homeDir: process.env.HOME || '/tmp',
                shell: 'zsh',
                shellVersion: '5.9',
                repoName: req.headers['x-repo-name'] || '',
                gitBranch: req.headers['x-git-branch'] || 'master'
            };
            
            if (stream) {
                // Streaming response
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Session-Id', sessionId);
                
                const messageId = `msg_${Date.now()}`;
                let fullContent = '';
                let totalToolCalls = [];
                
                // Send message_start
                res.write(`event: message_start\ndata: ${JSON.stringify({
                    type: 'message_start',
                    message: {
                        id: messageId,
                        type: 'message',
                        role: 'assistant',
                        content: [],
                        model: warpModel,
                        stop_reason: null,
                        stop_sequence: null,
                        usage: { input_tokens: inputTokens, output_tokens: 0 }
                    }
                })}\n\n`);
                
                // Send content_block_start
                res.write(`event: content_block_start\ndata: ${JSON.stringify({
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'text', text: '' }
                })}\n\n`);
                
                try {
                    // Use WarpProxy streaming interface
                    for await (const event of proxy.chatStream(sessionId, query, { model: warpModel, context })) {
                        if (event.type === 'text') {
                            fullContent += event.content;
                            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                type: 'content_block_delta',
                                index: 0,
                                delta: { type: 'text_delta', text: event.content }
                            })}\n\n`);
                        } else if (event.type === 'tool_call') {
                            // Send tool call info (as text)
                            const toolInfo = `\n[Executing tool: ${event.command}]\n`;
                            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                type: 'content_block_delta',
                                index: 0,
                                delta: { type: 'text_delta', text: toolInfo }
                            })}\n\n`);
                        } else if (event.type === 'tool_result') {
                            totalToolCalls.push(event);
                            // Send tool result (summary version)
                            const resultInfo = `[Result: ${event.result?.output?.substring(0, 200) || ''}...]\n`;
                            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                type: 'content_block_delta',
                                index: 0,
                                delta: { type: 'text_delta', text: resultInfo }
                            })}\n\n`);
                        } else if (event.type === 'iteration_start') {
                            console.log(`[Iteration ${event.iteration}] Starting...`);
                        }
                    }
                    
                    const outputTokens = estimateTokens(fullContent);
                    
                    // content_block_stop
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                        type: 'content_block_stop',
                        index: 0
                    })}\n\n`);
                    
                    // message_delta
                    res.write(`event: message_delta\ndata: ${JSON.stringify({
                        type: 'message_delta',
                        delta: { stop_reason: 'end_turn', stop_sequence: null },
                        usage: { output_tokens: outputTokens }
                    })}\n\n`);
                    
                    // message_stop
                    res.write(`event: message_stop\ndata: ${JSON.stringify({
                        type: 'message_stop'
                    })}\n\n`);
                    
                    res.end();
                    
                    // Log
                    const durationMs = Date.now() - startTime;
                    console.log(`[${new Date().toISOString()}] /w2/v1/messages completed`);
                    console.log(`Duration: ${durationMs}ms, tool calls: ${totalToolCalls.length}`);
                    console.log('='.repeat(80) + '\n');
                    
                    await apiLogStore.create({
                        requestId,
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId: credential.id,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w2/v1/messages',
                        model: warpModel,
                        stream: true,
                        inputTokens,
                        outputTokens,
                        requestMessages: null,
                        responseContent: null,
                        statusCode: 200,
                        durationMs
                    });
                    
                    await warpStore.incrementUseCount(credential.id);
                    
                } catch (streamError) {
                    res.write(`event: error\ndata: ${JSON.stringify({
                        type: 'error',
                        error: { type: 'server_error', message: streamError.message }
                    })}\n\n`);
                    res.end();
                }
                
            } else {
                // Non-streaming response
                const result = await proxy.chat(sessionId, query, { model: warpModel, context });
                
                const finalResponse = result.response || '';
                const outputTokens = estimateTokens(finalResponse);
                
                const durationMs = Date.now() - startTime;
                console.log(`[${new Date().toISOString()}] /w2/v1/messages completed`);
                console.log(`Duration: ${durationMs}ms, tool calls: ${result.toolCalls?.length || 0}, iterations: ${result.iterations}`);
                console.log('='.repeat(80) + '\n');
                
                await apiLogStore.create({
                    requestId,
                    apiKeyId,
                    apiKeyPrefix: req.apiKey?.keyPrefix || null,
                    credentialId: credential.id,
                    ipAddress: req.ip || req.connection?.remoteAddress,
                    userAgent: req.headers['user-agent'],
                    method: 'POST',
                    path: '/w2/v1/messages',
                    model: warpModel,
                    stream: false,
                    inputTokens,
                    outputTokens,
                    requestMessages: null,
                    responseContent: null,
                    statusCode: 200,
                    durationMs
                });
                
                await warpStore.incrementUseCount(credential.id);
                
                res.setHeader('X-Session-Id', result.sessionId);
                res.setHeader('X-Tool-Calls', result.toolCalls?.length || 0);
                res.setHeader('X-Iterations', result.iterations);
                
                res.json({
                    id: `msg_${Date.now()}`,
                    type: 'message',
                    role: 'assistant',
                    content: [{
                        type: 'text',
                        text: finalResponse
                    }],
                    model: warpModel,
                    stop_reason: 'end_turn',
                    stop_sequence: null,
                    usage: {
                        input_tokens: inputTokens,
                        output_tokens: outputTokens
                    }
                });
            }
            
        } catch (error) {
            const durationMs = Date.now() - startTime;
            console.log(`[${new Date().toISOString()}] /w2/v1/messages error: ${error.message}`);
            console.log('='.repeat(80) + '\n');
            
            await apiLogStore.create({
                requestId,
                apiKeyId,
                apiKeyPrefix: req.apiKey?.keyPrefix || null,
                credentialId: null,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: 'POST',
                path: '/w2/v1/messages',
                model: req.body?.model || 'unknown',
                stream: req.body?.stream || false,
                inputTokens: 0,
                outputTokens: 0,
                requestMessages: null,
                responseContent: null,
                statusCode: 500,
                errorMessage: error.message,
                durationMs
            });
            
            res.status(500).json({
                type: 'error',
                error: {
                    type: 'server_error',
                    message: error.message
                }
            });
        }
    });

    // ============ Gemini Format Endpoints ============

    // Warp Gemini Format - /w/v1beta/models/:model:generateContent
    app.post('/w/v1beta/models/:model\\:generateContent', verifyWarpApiKey, async (req, res) => {
        const startTime = Date.now();
        const apiKeyId = req.apiKey?.id || null;
        
        try {
            const { contents, systemInstruction } = req.body;
            const model = req.params.model || 'claude-4.1-opus';

            if (!contents || !Array.isArray(contents) || contents.length === 0) {
                return res.status(400).json({
                    error: {
                        code: 400,
                        message: 'contents is required',
                        status: 'INVALID_ARGUMENT'
                    }
                });
            }

            // Build query
            let query = '';
            if (systemInstruction && systemInstruction.parts) {
                query += `[System] ${systemInstruction.parts.map(p => p.text).join('')}\n\n`;
            }
            query += contents.map(c => {
                const text = c.parts ? c.parts.map(p => p.text).join('') : '';
                if (c.role === 'user') return text;
                if (c.role === 'model') return `[Assistant] ${text}`;
                return text;
            }).join('\n\n');

            // Convert external model name to Warp supported model name
            const warpModel = mapModelToWarp(model);
            const inputTokens = estimateTokens(query);
            const result = await warpService.chat(query, warpModel);
            const outputTokens = estimateTokens(result.response);

            // Record statistics to api_logs (do not record message content)
            await apiLogStore.create({
                requestId: generateRequestId(),
                apiKeyId,
                apiKeyPrefix: req.apiKey?.keyPrefix || null,
                credentialId: result.credentialId || null,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: 'POST',
                path: '/w/v1beta/generateContent',
                model: warpModel,
                stream: false,
                inputTokens,
                outputTokens,
                requestMessages: null,
                responseContent: null,
                statusCode: 200,
                durationMs: Date.now() - startTime
            });

            res.json({
                candidates: [{
                    content: {
                        parts: [{ text: result.response }],
                        role: 'model'
                    },
                    finishReason: 'STOP',
                    index: 0
                }],
                usageMetadata: {
                    promptTokenCount: inputTokens,
                    candidatesTokenCount: outputTokens,
                    totalTokenCount: inputTokens + outputTokens
                }
            });
        } catch (error) {
            // Record error statistics to api_logs
            await apiLogStore.create({
                requestId: generateRequestId(),
                apiKeyId,
                apiKeyPrefix: req.apiKey?.keyPrefix || null,
                credentialId: null,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: 'POST',
                path: '/w/v1beta/generateContent',
                model: req.params?.model || 'unknown',
                stream: false,
                inputTokens: 0,
                outputTokens: 0,
                requestMessages: null,
                responseContent: null,
                statusCode: 500,
                errorMessage: error.message,
                durationMs: Date.now() - startTime
            });
            
            res.status(500).json({
                error: {
                    code: 500,
                    message: error.message,
                    status: 'INTERNAL'
                }
            });
        }
    });

    // Warp Gemini Streaming - /w/v1beta/models/:model:streamGenerateContent
    app.post('/w/v1beta/models/:model\\:streamGenerateContent', verifyWarpApiKey, async (req, res) => {
        const startTime = Date.now();
        const apiKeyId = req.apiKey?.id || null;
        
        try {
            const { contents, systemInstruction } = req.body;

            if (!contents || !Array.isArray(contents) || contents.length === 0) {
                return res.status(400).json({
                    error: {
                        code: 400,
                        message: 'contents is required',
                        status: 'INVALID_ARGUMENT'
                    }
                });
            }

            // Build query
            let query = '';
            if (systemInstruction && systemInstruction.parts) {
                query += `[System] ${systemInstruction.parts.map(p => p.text).join('')}\n\n`;
            }
            query += contents.map(c => {
                const text = c.parts ? c.parts.map(p => p.text).join('') : '';
                if (c.role === 'user') return text;
                if (c.role === 'model') return `[Assistant] ${text}`;
                return text;
            }).join('\n\n');

            // Convert external model name to Warp supported model name
            const warpModel = mapModelToWarp(req.params.model);
            const inputTokens = estimateTokens(query);
            let fullContent = '';
            let usedCredentialId = null;

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            warpService.chatStream(
                query,
                warpModel,
                (content, credentialId) => {
                    fullContent += content;
                    if (credentialId) usedCredentialId = credentialId;
                    const chunk = {
                        candidates: [{
                            content: {
                                parts: [{ text: content }],
                                role: 'model'
                            },
                            index: 0
                        }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                },
                async (credentialId) => {
                    if (credentialId) usedCredentialId = credentialId;
                    const outputTokens = estimateTokens(fullContent);
                    
                    const endChunk = {
                        candidates: [{
                            content: {
                                parts: [{ text: '' }],
                                role: 'model'
                            },
                            finishReason: 'STOP',
                            index: 0
                        }],
                        usageMetadata: {
                            promptTokenCount: inputTokens,
                            candidatesTokenCount: outputTokens,
                            totalTokenCount: inputTokens + outputTokens
                        }
                    };
                    res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
                    res.end();
                    
                    // Record statistics to api_logs (do not record message content)
                    await apiLogStore.create({
                        requestId: generateRequestId(),
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId: usedCredentialId || null,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w/v1beta/streamGenerateContent',
                        model: warpModel,
                        stream: true,
                        inputTokens,
                        outputTokens,
                        requestMessages: null,
                        responseContent: null,
                        statusCode: 200,
                        durationMs: Date.now() - startTime
                    });
                },
                async (error, credentialId) => {
                    res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
                    res.end();
                    
                    // Record error statistics to api_logs
                    await apiLogStore.create({
                        requestId: generateRequestId(),
                        apiKeyId,
                        apiKeyPrefix: req.apiKey?.keyPrefix || null,
                        credentialId: credentialId || null,
                        ipAddress: req.ip || req.connection?.remoteAddress,
                        userAgent: req.headers['user-agent'],
                        method: 'POST',
                        path: '/w/v1beta/streamGenerateContent',
                        model: warpModel,
                        stream: true,
                        inputTokens,
                        outputTokens: 0,
                        requestMessages: null,
                        responseContent: null,
                        statusCode: 500,
                        errorMessage: error.message,
                        durationMs: Date.now() - startTime
                    });
                }
            );
        } catch (error) {
            // Record error statistics to api_logs
            await apiLogStore.create({
                requestId: generateRequestId(),
                apiKeyId,
                apiKeyPrefix: req.apiKey?.keyPrefix || null,
                credentialId: null,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: 'POST',
                path: '/w/v1beta/streamGenerateContent',
                model: req.params?.model || 'unknown',
                stream: true,
                inputTokens: 0,
                outputTokens: 0,
                requestMessages: null,
                responseContent: null,
                statusCode: 500,
                errorMessage: error.message,
                durationMs: Date.now() - startTime
            });
            
            res.status(500).json({
                error: {
                    code: 500,
                    message: error.message,
                    status: 'INTERNAL'
                }
            });
        }
    });

    // ============ Usage Query Endpoints ============

    // Query single account usage (and save to database)
    app.get('/w/api/quota', async (req, res) => {
        try {
            const { credentialId } = req.query;
            const quota = await warpService.getQuota(credentialId);
            
            // Save usage to database
            if (quota.credentialId && !quota.error) {
                await warpStore.updateQuota(quota.credentialId, quota.requestLimit, quota.requestsUsed);
            }
            
            res.json({ success: true, data: quota });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Query all accounts usage (and save to database)
    app.get('/w/api/quotas', async (req, res) => {
        try {
            const quotas = await warpService.getAllQuotas();
            
            // Calculate summary info and save usage to database
            const summary = {
                totalAccounts: quotas.length,
                totalLimit: 0,
                totalUsed: 0,
                totalRemaining: 0,
                unlimitedAccounts: 0,
                errorAccounts: 0
            };
            
            for (const q of quotas) {
                if (q.error) {
                    summary.errorAccounts++;
                } else if (q.isUnlimited) {
                    summary.unlimitedAccounts++;
                    // Save usage to database
                    await warpStore.updateQuota(q.credentialId, -1, 0);
                } else {
                    summary.totalLimit += q.requestLimit;
                    summary.totalUsed += q.requestsUsed;
                    summary.totalRemaining += q.requestsRemaining;
                    // Save usage to database
                    await warpStore.updateQuota(q.credentialId, q.requestLimit, q.requestsUsed);
                }
            }
            
            res.json({ 
                success: true, 
                data: {
                    summary,
                    accounts: quotas
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    console.log('[Warp] Routes configured');
    console.log('[Warp] Supported endpoints:');
    console.log('[Warp]   OpenAI format: /w/v1/chat/completions');
    console.log('[Warp]   Claude format: /w/v1/messages');
    console.log('[Warp]   Gemini format: /w/v1beta/models/{model}:generateContent');
    console.log('[Warp]   Model list:    /w/v1/models');
    console.log('[Warp]   Usage query:   /w/api/quota, /w/api/quotas');
}
