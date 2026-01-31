/**
 * Vertex AI Routes
 * Provides Vertex AI credential management and chat API
 * Only supports Gemini models (via GCP Vertex AI)
 */
import { VertexClient, VERTEX_GEMINI_MODEL_MAPPING, VERTEX_REGIONS } from './vertex.js';
import { VertexCredentialStore, GeminiCredentialStore } from '../db.js';
import {
    AntigravityApiService,
    GEMINI_MODELS,
    claudeToGeminiMessages,
    geminiToClaudeResponse,
    refreshGeminiToken
} from '../gemini/antigravity-core.js';

let vertexStore = null;
let geminiStore = null;

/**
 * Detect if model is a Gemini model
 */
function isGeminiModel(model) {
    if (!model) return false;
    return model.startsWith('gemini') || GEMINI_MODELS.includes(model) || VERTEX_GEMINI_MODEL_MAPPING[model];
}

/**
 * Check if Gemini Token is expiring soon (refresh 50 minutes in advance)
 */
function isGeminiTokenExpiringSoon(credential, minutes = 50) {
    if (!credential.expiresAt) return false;
    try {
        const expirationTime = new Date(credential.expiresAt).getTime();
        const currentTime = Date.now();
        const thresholdTime = currentTime + minutes * 60 * 1000;
        return expirationTime <= thresholdTime;
    } catch {
        return false;
    }
}

/**
 * Select an available Gemini credential (LRU strategy)
 */
async function selectGeminiCredential() {
    const allCredentials = await geminiStore.getAllActive();
    if (allCredentials.length === 0) return null;

    // Filter healthy credentials (error count below threshold and projectId is not empty)
    const maxErrorCount = 5;
    let healthyCredentials = allCredentials.filter(c =>
        (c.errorCount || 0) < maxErrorCount && c.projectId
    );

    // If no healthy credentials, try filtering only those with non-empty projectId
    if (healthyCredentials.length === 0) {
        healthyCredentials = allCredentials.filter(c => c.projectId);
    }

    // If still none available, use all credentials (will trigger onboarding)
    if (healthyCredentials.length === 0) {
        healthyCredentials = allCredentials;
    }

    // LRU strategy: sort by last used time, prioritize least recently used
    healthyCredentials.sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        if (timeA !== timeB) return timeA - timeB;
        return (a.errorCount || 0) - (b.errorCount || 0);
    });

    return healthyCredentials[0];
}

/**
 * Setup Vertex AI routes
 */
export async function setupVertexRoutes(app) {
    vertexStore = await VertexCredentialStore.create();
    geminiStore = await GeminiCredentialStore.create();

    // ============ Credential Management API ============

    // Get all Vertex credentials
    app.get('/api/vertex/credentials', async (req, res) => {
        try {
            const credentials = await vertexStore.getAll();
            // Hide private key
            const safeCredentials = credentials.map(c => ({
                ...c,
                privateKey: c.privateKey ? '******' : null
            }));
            res.json(safeCredentials);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get single Vertex credential
    app.get('/api/vertex/credentials/:id', async (req, res) => {
        try {
            const credential = await vertexStore.getById(parseInt(req.params.id));
            if (!credential) {
                return res.status(404).json({ error: 'Credential not found' });
            }
            // Hide private key
            res.json({
                ...credential,
                privateKey: credential.privateKey ? '******' : null
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Add Vertex credential
    app.post('/api/vertex/credentials', async (req, res) => {
        try {
            const { name, projectId, clientEmail, privateKey, region } = req.body;

            if (!name || !projectId || !clientEmail || !privateKey) {
                return res.status(400).json({ error: 'Missing required fields: name, projectId, clientEmail, privateKey' });
            }

            // Check if name already exists
            const existing = await vertexStore.getByName(name);
            if (existing) {
                return res.status(400).json({ error: 'Credential name already exists' });
            }

            const id = await vertexStore.add({
                name,
                projectId,
                clientEmail,
                privateKey,
                region: region || 'global'
            });

            res.json({ success: true, id, message: 'Credential added successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Import credentials from JSON file
    app.post('/api/vertex/credentials/import', async (req, res) => {
        try {
            const { name, keyJson, region } = req.body;

            if (!name || !keyJson) {
                return res.status(400).json({ error: 'Missing required fields: name, keyJson' });
            }

            let keyData;
            try {
                keyData = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON format' });
            }

            if (!keyData.project_id || !keyData.client_email || !keyData.private_key) {
                return res.status(400).json({ error: 'JSON missing required fields: project_id, client_email, private_key' });
            }

            // Check if name already exists
            const existing = await vertexStore.getByName(name);
            if (existing) {
                return res.status(400).json({ error: 'Credential name already exists' });
            }

            const id = await vertexStore.add({
                name,
                projectId: keyData.project_id,
                clientEmail: keyData.client_email,
                privateKey: keyData.private_key,
                region: region || 'global'
            });

            res.json({ success: true, id, message: 'Credential imported successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Update Vertex credential
    app.put('/api/vertex/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await vertexStore.getById(id);
            if (!credential) {
                return res.status(404).json({ error: 'Credential not found' });
            }

            const updateData = {};
            if (req.body.name !== undefined) updateData.name = req.body.name;
            if (req.body.projectId !== undefined) updateData.projectId = req.body.projectId;
            if (req.body.clientEmail !== undefined) updateData.clientEmail = req.body.clientEmail;
            if (req.body.privateKey !== undefined && req.body.privateKey !== '******') {
                updateData.privateKey = req.body.privateKey;
            }
            if (req.body.region !== undefined) updateData.region = req.body.region;
            if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;

            await vertexStore.update(id, updateData);
            res.json({ success: true, message: 'Credential updated successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Delete Vertex credential
    app.delete('/api/vertex/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await vertexStore.delete(id);
            res.json({ success: true, message: 'Credential deleted successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Activate Vertex credential
    app.post('/api/vertex/credentials/:id/activate', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await vertexStore.setActive(id);
            res.json({ success: true, message: 'Credential activated' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Test Vertex credential
    app.post('/api/vertex/credentials/:id/test', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await vertexStore.getById(id);
            if (!credential) {
                return res.status(404).json({ error: 'Credential not found' });
            }

            const gcpCredentials = vertexStore.toGcpCredentials(credential);
            const client = VertexClient.fromCredentials(gcpCredentials, credential.region);

            // Try to get access token to test credentials
            await client.getAccessToken();

            await vertexStore.resetErrorCount(id);
            res.json({ success: true, message: 'Credential test successful' });
        } catch (error) {
            await vertexStore.incrementErrorCount(id, error.message);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    // Get Vertex statistics
    app.get('/api/vertex/statistics', async (req, res) => {
        try {
            const stats = await vertexStore.getStatistics();
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get supported model list
    app.get('/api/vertex/models', (req, res) => {
        res.json({
            models: Object.keys(VERTEX_GEMINI_MODEL_MAPPING),
            mapping: VERTEX_GEMINI_MODEL_MAPPING
        });
    });

    // Get supported region list
    app.get('/api/vertex/regions', (req, res) => {
        res.json({ regions: VERTEX_REGIONS });
    });

    // ============ Chat API (Gemini only) ============

    // Non-streaming chat (Gemini)
    app.post('/api/vertex/chat/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await vertexStore.getById(id);
            if (!credential) {
                return res.status(404).json({ error: 'Credential not found' });
            }

            const { messages, model, system, max_tokens, temperature, top_p, top_k } = req.body;

            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ error: 'Missing messages parameter' });
            }

            const gcpCredentials = vertexStore.toGcpCredentials(credential);
            const client = VertexClient.fromCredentials(gcpCredentials, credential.region);

            const response = await client.geminiChat(messages, model || 'gemini-1.5-flash', {
                system,
                max_tokens,
                temperature,
                top_p,
                top_k
            });

            await vertexStore.incrementUseCount(id);
            await vertexStore.resetErrorCount(id);

            res.json(response);
        } catch (error) {
            const id = parseInt(req.params.id);
            await vertexStore.incrementErrorCount(id, error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // Streaming chat (Gemini)
    app.post('/api/vertex/chat/:id/stream', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await vertexStore.getById(id);
            if (!credential) {
                return res.status(404).json({ error: 'Credential not found' });
            }

            const { messages, model, system, max_tokens, temperature, top_p, top_k } = req.body;

            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ error: 'Missing messages parameter' });
            }

            const gcpCredentials = vertexStore.toGcpCredentials(credential);
            const client = VertexClient.fromCredentials(gcpCredentials, credential.region);

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);
            const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

            // Send message_start event
            res.write(`event: message_start\ndata: ${JSON.stringify({
                type: 'message_start',
                message: {
                    id: messageId,
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model: model || 'gemini-1.5-flash',
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: inputTokens, output_tokens: 0 }
                }
            })}\n\n`);

            // Send content_block_start event
            res.write(`event: content_block_start\ndata: ${JSON.stringify({
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' }
            })}\n\n`);

            let outputTokens = 0;

            for await (const event of client.geminiChatStream(messages, model || 'gemini-1.5-flash', {
                system,
                max_tokens,
                temperature,
                top_p,
                top_k
            })) {
                if (event.type === 'content_block_delta' && event.delta?.text) {
                    outputTokens += Math.ceil(event.delta.text.length / 4);
                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                        type: 'content_block_delta',
                        index: 0,
                        delta: { type: 'text_delta', text: event.delta.text }
                    })}\n\n`);
                }
                if (event.type === 'usage' && event.usage) {
                    outputTokens = event.usage.output_tokens || outputTokens;
                }
            }

            // Send end events
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
            res.write(`event: message_delta\ndata: ${JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: 'end_turn', stop_sequence: null },
                usage: { output_tokens: outputTokens }
            })}\n\n`);
            res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
            res.end();

            await vertexStore.incrementUseCount(id);
            await vertexStore.resetErrorCount(id);
        } catch (error) {
            const id = parseInt(req.params.id);
            await vertexStore.incrementErrorCount(id, error.message);

            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            } else {
                res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: error.message } })}\n\n`);
                res.end();
            }
        }
    });

    // ============ Claude API Compatible Endpoints ============

    // /vertex/v1/messages - Claude API format (Gemini models only)
    app.post('/vertex/v1/messages', async (req, res) => {
        const { messages, model, system, max_tokens, temperature, top_p, top_k, stream } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Missing messages parameter' });
        }

        // Detect if model is Gemini
        if (isGeminiModel(model)) {
            // ============ Gemini Model Processing ============
            // Prioritize Vertex AI (GCP JSON credentials), fallback to Antigravity if unavailable
            const vertexCredential = await vertexStore.getRandomActive();

            if (vertexCredential) {
                // ============ Call Gemini via Vertex AI ============
                console.log(`[Vertex/Gemini] Request received | model=${model} | stream=${stream}`);
                console.log(`[Vertex/Gemini] Using Vertex AI credential: ${vertexCredential.name}`);

                try {
                    const gcpCredentials = vertexStore.toGcpCredentials(vertexCredential);
                    const client = VertexClient.fromCredentials(gcpCredentials, vertexCredential.region);

                    const requestModel = model || 'gemini-1.5-flash';

                    if (stream) {
                        // Streaming response
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');

                        const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);
                        const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

                        // Send message_start event
                        res.write(`event: message_start\ndata: ${JSON.stringify({
                            type: 'message_start',
                            message: {
                                id: messageId,
                                type: 'message',
                                role: 'assistant',
                                content: [],
                                model: requestModel,
                                stop_reason: null,
                                stop_sequence: null,
                                usage: { input_tokens: inputTokens, output_tokens: 0 }
                            }
                        })}\n\n`);

                        // Send content_block_start event
                        res.write(`event: content_block_start\ndata: ${JSON.stringify({
                            type: 'content_block_start',
                            index: 0,
                            content_block: { type: 'text', text: '' }
                        })}\n\n`);

                        let outputTokens = 0;

                        for await (const event of client.geminiChatStream(messages, requestModel, {
                            system,
                            max_tokens: max_tokens || 8192,
                            temperature,
                            top_p,
                            top_k
                        })) {
                            if (event.type === 'content_block_delta' && event.delta?.text) {
                                outputTokens += Math.ceil(event.delta.text.length / 4);
                                res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                    type: 'content_block_delta',
                                    index: 0,
                                    delta: { type: 'text_delta', text: event.delta.text }
                                })}\n\n`);
                            }
                            if (event.type === 'usage' && event.usage) {
                                outputTokens = event.usage.output_tokens || outputTokens;
                            }
                        }

                        // Send end events
                        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
                        res.write(`event: message_delta\ndata: ${JSON.stringify({
                            type: 'message_delta',
                            delta: { stop_reason: 'end_turn', stop_sequence: null },
                            usage: { output_tokens: outputTokens }
                        })}\n\n`);
                        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                        res.end();

                        console.log('[Vertex/Gemini] Streaming request completed');
                    } else {
                        // Non-streaming response
                        const response = await client.geminiChat(messages, requestModel, {
                            system,
                            max_tokens: max_tokens || 8192,
                            temperature,
                            top_p,
                            top_k
                        });

                        console.log('[Vertex/Gemini] Request successful');
                        res.json(response);
                    }

                    await vertexStore.incrementUseCount(vertexCredential.id);
                    await vertexStore.resetErrorCount(vertexCredential.id);
                } catch (error) {
                    console.error(`[Vertex/Gemini] Error: ${error.message}`);
                    if (!res.headersSent) {
                        res.status(500).json({ error: error.message });
                    } else {
                        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: error.message } })}\n\n`);
                        res.end();
                    }
                }
            } else {
                // ============ Fallback to Antigravity (OAuth credentials) ============
                console.log('[Vertex/Gemini] No Vertex AI credentials, falling back to Antigravity');
                try {
                    let credential = await selectGeminiCredential();
                    if (!credential) {
                        return res.status(503).json({ error: 'No available Gemini credentials' });
                    }

                    // Check and refresh Token (if expiring soon)
                    if (credential.refreshToken && isGeminiTokenExpiringSoon(credential)) {
                        try {
                            const result = await refreshGeminiToken(credential.refreshToken);
                            await geminiStore.update(credential.id, {
                                accessToken: result.accessToken,
                                refreshToken: result.refreshToken,
                                expiresAt: result.expiresAt
                            });
                            credential = await geminiStore.getById(credential.id);
                        } catch (refreshError) {
                            console.error(`[Vertex/Gemini] Token refresh failed: ${refreshError.message}`);
                        }
                    }

                    // Create Antigravity service
                    const service = AntigravityApiService.fromCredentials(credential);

                    // Convert message format
                    const contents = claudeToGeminiMessages(messages);
                    const requestBody = { contents };

                    // Add system prompt
                    if (system) {
                        const systemText = typeof system === 'string'
                            ? system
                            : (Array.isArray(system) ? system.map(s => s.text || s).join('\n') : String(system));
                        requestBody.systemInstruction = { parts: [{ text: systemText }] };
                    }

                    // Add generation config
                    if (max_tokens) {
                        requestBody.generationConfig = { maxOutputTokens: max_tokens };
                    }

                    const requestModel = model || 'gemini-3-flash-preview';

                    if (stream) {
                        // Streaming response
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');

                        const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);
                        const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

                        // Send message_start event
                        res.write(`event: message_start\ndata: ${JSON.stringify({
                            type: 'message_start',
                            message: {
                                id: messageId,
                                type: 'message',
                                role: 'assistant',
                                content: [],
                                model: requestModel,
                                stop_reason: null,
                                stop_sequence: null,
                                usage: { input_tokens: inputTokens, output_tokens: 0 }
                            }
                        })}\n\n`);

                        // Send content_block_start event
                        res.write(`event: content_block_start\ndata: ${JSON.stringify({
                            type: 'content_block_start',
                            index: 0,
                            content_block: { type: 'text', text: '' }
                        })}\n\n`);

                        let outputTokens = 0;

                        for await (const chunk of service.generateContentStream(requestModel, requestBody)) {
                            if (chunk && chunk.candidates && chunk.candidates[0]?.content?.parts) {
                                for (const part of chunk.candidates[0].content.parts) {
                                    if (part.text) {
                                        outputTokens += Math.ceil(part.text.length / 4);
                                        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                            type: 'content_block_delta',
                                            index: 0,
                                            delta: { type: 'text_delta', text: part.text }
                                        })}\n\n`);
                                    }
                                }
                            }
                            if (chunk?.usageMetadata?.candidatesTokenCount) {
                                outputTokens = chunk.usageMetadata.candidatesTokenCount;
                            }
                        }

                        // Send end events
                        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
                        res.write(`event: message_delta\ndata: ${JSON.stringify({
                            type: 'message_delta',
                            delta: { stop_reason: 'end_turn', stop_sequence: null },
                            usage: { output_tokens: outputTokens }
                        })}\n\n`);
                        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                        res.end();

                        await geminiStore.resetErrorCount(credential.id);
                    } else {
                        // Non-streaming response
                        const response = await service.generateContent(requestModel, requestBody);
                        const claudeResponse = geminiToClaudeResponse(response, requestModel);

                        await geminiStore.resetErrorCount(credential.id);
                        res.json(claudeResponse);
                    }
                } catch (error) {
                    console.error(`[Vertex/Gemini/Antigravity] Error: ${error.message}`);
                    if (!res.headersSent) {
                        res.status(500).json({ error: error.message });
                    } else {
                        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: error.message } })}\n\n`);
                        res.end();
                    }
                }
            }
        } else {
            // Non-Gemini models not supported
            return res.status(400).json({
                error: `Unsupported model: ${model}. Vertex endpoint only supports Gemini models.`
            });
        }
    });

    // /vertex/v1/models - Model list (Gemini only)
    app.get('/vertex/v1/models', (req, res) => {
        // Gemini models
        const geminiModels = [
            ...Object.keys(VERTEX_GEMINI_MODEL_MAPPING),
            ...GEMINI_MODELS.filter(m => !VERTEX_GEMINI_MODEL_MAPPING[m])
        ].map(id => ({
            id,
            object: 'model',
            created: Date.now(),
            owned_by: 'google'
        }));

        res.json({ object: 'list', data: geminiModels });
    });

    console.log('[Vertex] Routes configured');
    return vertexStore;
}

export { vertexStore };
