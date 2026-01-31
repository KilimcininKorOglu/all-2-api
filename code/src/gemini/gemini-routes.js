/**
 * Gemini Antigravity Credential Management Routes
 */
import {
    AntigravityApiService,
    GEMINI_MODELS,
    refreshGeminiToken,
    startOAuthFlow as startGeminiOAuthFlow
} from './antigravity-core.js';

export function setupGeminiRoutes(app, geminiStore, getTimestamp) {
    // Gemini OAuth start authorization (using independent callback server, port 8086)
    app.post('/api/gemini/oauth/start', async (req, res) => {
        try {
            const { name } = req.body;
            const credentialName = name || `Gemini-${Date.now()}`;

            // Start independent OAuth callback server (port 8086)
            const { authUrl, port } = await startGeminiOAuthFlow({
                port: 8086,
                onSuccess: async (tokens) => {
                    try {
                        // Save to database
                        const id = await geminiStore.add({
                            name: credentialName,
                            accessToken: tokens.accessToken,
                            refreshToken: tokens.refreshToken,
                            expiresAt: tokens.expiresAt
                        });
                        // console.log(`[${getTimestamp()}] [Gemini OAuth] New credential added: ${credentialName} (ID: ${id})`);
                    } catch (err) {
                        console.error(`[${getTimestamp()}] [Gemini OAuth] Failed to save credentials:`, err.message);
                    }
                },
                onError: (error) => {
                    console.error(`[${getTimestamp()}] [Gemini OAuth] Authorization failed:`, error.message);
                }
            });

            // console.log(`[${getTimestamp()}] [Gemini OAuth] Callback server started on port ${port}`);
            res.json({ success: true, authUrl });
        } catch (error) {
            console.error(`[${getTimestamp()}] [Gemini OAuth] Startup failed:`, error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get all Gemini credentials
    app.get('/api/gemini/credentials', async (req, res) => {
        try {
            const credentials = await geminiStore.getAll();
            res.json({
                success: true,
                data: credentials.map(c => ({
                    ...c,
                    accessToken: c.accessToken ? '***' : null,
                    refreshToken: c.refreshToken ? '***' : null
                }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get single Gemini credential
    app.get('/api/gemini/credentials/:id', async (req, res) => {
        try {
            const credential = await geminiStore.getById(parseInt(req.params.id));
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }
            res.json({
                success: true,
                data: {
                    ...credential,
                    accessToken: credential.accessToken ? '***' : null,
                    refreshToken: credential.refreshToken ? '***' : null
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Add Gemini credential
    app.post('/api/gemini/credentials', async (req, res) => {
        try {
            const { name, email, accessToken, refreshToken, projectId, expiresAt } = req.body;

            if (!name || !accessToken) {
                return res.status(400).json({ success: false, error: 'Name and accessToken are required' });
            }

            const existing = await geminiStore.getByName(name);
            if (existing) {
                return res.status(400).json({ success: false, error: 'Credential name already exists' });
            }

            const id = await geminiStore.add({
                name,
                email,
                accessToken,
                refreshToken,
                projectId,
                expiresAt
            });

            res.json({ success: true, data: { id } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Batch import Gemini credentials
    app.post('/api/gemini/credentials/batch-import', async (req, res) => {
        try {
            const { accounts } = req.body;

            if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
                return res.status(400).json({ success: false, error: 'Please provide an accounts array' });
            }

            const results = {
                success: 0,
                failed: 0,
                errors: []
            };

            for (const account of accounts) {
                try {
                    const { email, refresh_token, refreshToken } = account;
                    const token = refresh_token || refreshToken;

                    if (!token) {
                        results.failed++;
                        results.errors.push({ email, error: 'Missing refresh_token' });
                        continue;
                    }

                    // Check if already exists
                    const name = email || `gemini-${Date.now()}`;
                    const existing = await geminiStore.getByName(name);
                    if (existing) {
                        results.failed++;
                        results.errors.push({ email, error: 'Credential already exists' });
                        continue;
                    }

                    // Use refresh_token to get access_token
                    let accessToken = '';
                    let expiresAt = null;

                    try {
                        const tokenResult = await refreshGeminiToken(token);
                        accessToken = tokenResult.accessToken;
                        expiresAt = tokenResult.expiresAt;
                    } catch (tokenError) {
                        results.failed++;
                        results.errors.push({ email, error: `Token refresh failed: ${tokenError.message}` });
                        continue;
                    }

                    // Add credential
                    await geminiStore.add({
                        name,
                        email,
                        accessToken,
                        refreshToken: token,
                        projectId: null,
                        expiresAt
                    });

                    results.success++;
                } catch (err) {
                    results.failed++;
                    results.errors.push({ email: account.email, error: err.message });
                }
            }

            res.json({
                success: true,
                data: results
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Update Gemini credential
    app.put('/api/gemini/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await geminiStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            await geminiStore.update(id, req.body);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete Gemini credential
    app.delete('/api/gemini/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await geminiStore.delete(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Activate Gemini credential
    app.post('/api/gemini/credentials/:id/activate', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await geminiStore.setActive(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Refresh Gemini credential Token
    app.post('/api/gemini/credentials/:id/refresh', async (req, res) => {
        const id = parseInt(req.params.id);
        try {
            const credential = await geminiStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            if (!credential.refreshToken) {
                return res.status(400).json({ success: false, error: 'Credential has no refreshToken' });
            }

            const result = await refreshGeminiToken(credential.refreshToken);
            await geminiStore.update(id, {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresAt: result.expiresAt
            });
            await geminiStore.resetErrorCount(id);

            res.json({ success: true, data: { expiresAt: result.expiresAt } });
        } catch (error) {
            await geminiStore.incrementErrorCount(id, error.message);
            res.status(500).json({ success: false, error: `Token refresh failed: ${error.message}` });
        }
    });

    // Test Gemini credential
    app.post('/api/gemini/credentials/:id/test', async (req, res) => {
        const id = parseInt(req.params.id);
        try {
            const credential = await geminiStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const service = AntigravityApiService.fromCredentials(credential);
            await service.initialize(); // Ensure initialization (will auto onboard)

            // If projectId changed, save to database
            if (service.projectId && service.projectId !== credential.projectId) {
                await geminiStore.update(id, { projectId: service.projectId });
            }

            const models = await service.listModels();

            await geminiStore.resetErrorCount(id);
            res.json({ success: true, data: { models, projectId: service.projectId } });
        } catch (error) {
            await geminiStore.incrementErrorCount(id, error.message);
            res.status(500).json({ success: false, error: `Test failed: ${error.message}` });
        }
    });

    // Get Gemini available models list
    app.get('/api/gemini/models', async (req, res) => {
        try {
            res.json({ success: true, data: GEMINI_MODELS });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get Gemini credential usage
    app.get('/api/gemini/credentials/:id/usage', async (req, res) => {
        const id = parseInt(req.params.id);
        try {
            const credential = await geminiStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const service = AntigravityApiService.fromCredentials({
                accessToken: credential.accessToken,
                refreshToken: credential.refreshToken,
                projectId: credential.projectId,
                expiresAt: credential.expiresAt
            });

            // getUsageLimits will call initialize internally
            const usage = await service.getUsageLimits();

            // If projectId changed, save to database
            if (service.projectId && service.projectId !== credential.projectId) {
                await geminiStore.update(id, { projectId: service.projectId });
            }

            res.json({ success: true, data: usage });
        } catch (error) {
            res.status(500).json({ success: false, error: `Failed to get usage: ${error.message}` });
        }
    });

    // Gemini streaming chat
    app.post('/api/gemini/chat/:id', async (req, res) => {
        const credentialId = parseInt(req.params.id);

        try {
            const credential = await geminiStore.getById(credentialId);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const { message, model, history } = req.body;
            if (!message) {
                return res.status(400).json({ success: false, error: 'Message content is required' });
            }

            const service = AntigravityApiService.fromCredentials({
                accessToken: credential.accessToken,
                refreshToken: credential.refreshToken,
                projectId: credential.projectId,
                expiresAt: credential.expiresAt
            });

            // Ensure initialization (will auto onboard if needed)
            await service.initialize();

            // If projectId changed, save to database
            if (service.projectId && service.projectId !== credential.projectId) {
                await geminiStore.update(credentialId, { projectId: service.projectId });
            }

            // Build Gemini format messages
            const contents = [];
            if (history && Array.isArray(history)) {
                for (const msg of history) {
                    contents.push({
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: msg.content }]
                    });
                }
            }
            contents.push({ role: 'user', parts: [{ text: message }] });

            // Set SSE response headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const selectedModel = model || 'gemini-3-flash-preview';

            // Streaming output
            for await (const chunk of service.generateContentStream(selectedModel, { contents })) {
                if (chunk && chunk.candidates && chunk.candidates[0]) {
                    const candidate = chunk.candidates[0];
                    if (candidate.content && candidate.content.parts) {
                        for (const part of candidate.content.parts) {
                            if (part.text) {
                              res.write(`data: ${JSON.stringify({ content: part.text })}\n\n`);
                            }
                        }
                    }
                }
            }

            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
        } catch (error) {
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: `Chat failed: ${error.message}` });
            } else {
                res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
                res.end();
            }
        }
    });

    // Gemini non-streaming chat
    app.post('/api/gemini/chat/:id/sync', async (req, res) => {
        const credentialId = parseInt(req.params.id);

        try {
            const credential = await geminiStore.getById(credentialId);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const { message, model, history } = req.body;
            if (!message) {
                return res.status(400).json({ success: false, error: 'Message content is required' });
            }

            const service = AntigravityApiService.fromCredentials({
                accessToken: credential.accessToken,
                refreshToken: credential.refreshToken,
                projectId: credential.projectId,
                expiresAt: credential.expiresAt
            });

            // Ensure initialization (will auto onboard if needed)
            await service.initialize();

            // If projectId changed, save to database
            if (service.projectId && service.projectId !== credential.projectId) {
                await geminiStore.update(credentialId, { projectId: service.projectId });
            }

            // Build Gemini format messages
            const contents = [];
            if (history && Array.isArray(history)) {
                for (const msg of history) {
                    contents.push({
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: msg.content }]
                    });
                }
            }
            contents.push({ role: 'user', parts: [{ text: message }] });

            const selectedModel = model || 'gemini-3-flash-preview';
            const response = await service.generateContent(selectedModel, { contents });

            // Extract response text
            let responseText = '';
            if (response && response.candidates && response.candidates[0]) {
                const candidate = response.candidates[0];
                if (candidate.content && candidate.content.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.text) {
                            responseText += part.text;
                        }
                    }
                }
            }

            res.json({
                success: true,
                data: {
                    response: responseText,
                    usage: response?.usageMetadata || {}
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: `Chat failed: ${error.message}` });
        }
    });

    // Get Gemini error credentials list
    app.get('/api/gemini/error-credentials', async (req, res) => {
        try {
            const credentials = await geminiStore.getAllErrors();
            res.json({
                success: true,
                data: credentials.map(c => ({
                    ...c,
                    accessToken: c.accessToken ? '***' : null,
                    refreshToken: c.refreshToken ? '***' : null
                }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete Gemini error credential
    app.delete('/api/gemini/error-credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await geminiStore.deleteError(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Refresh Gemini error credential and restore
    app.post('/api/gemini/error-credentials/:id/refresh', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const errorCred = await geminiStore.getErrorById(id);
            if (!errorCred) {
                return res.status(404).json({ success: false, error: 'Error credential not found' });
            }

            if (!errorCred.refreshToken) {
                return res.status(400).json({ success: false, error: 'Credential has no refreshToken' });
            }

            const result = await refreshGeminiToken(errorCred.refreshToken);

            // Restore to normal credentials table
            await geminiStore.restoreFromError(id, {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresAt: result.expiresAt
            });

            res.json({ success: true, data: { expiresAt: result.expiresAt } });
        } catch (error) {
            res.status(500).json({ success: false, error: `Restore failed: ${error.message}` });
        }
    });
}
