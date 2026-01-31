/**
 * Gemini Antigravity Credential Management Routes
 */
import crypto from 'crypto';
import {
    AntigravityApiService,
    GEMINI_MODELS,
    refreshGeminiToken,
    generateAuthUrl as generateGeminiAuthUrl,
    getTokenFromCode as getGeminiTokenFromCode
} from './antigravity-core.js';

// Pending OAuth sessions (state -> session info)
const pendingOAuthSessions = new Map();

// Clean up expired sessions (older than 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [state, session] of pendingOAuthSessions) {
        if (now - session.createdAt > 10 * 60 * 1000) {
            pendingOAuthSessions.delete(state);
        }
    }
}, 60 * 1000);

/**
 * Fetch and save quota data for a credential (async, non-blocking)
 * @param {number} credentialId - Credential ID
 * @param {object} geminiStore - GeminiCredentialStore instance
 * @param {function} getTimestamp - Timestamp function for logging
 */
async function fetchAndSaveQuota(credentialId, geminiStore, getTimestamp) {
    try {
        const credential = await geminiStore.getById(credentialId);
        if (!credential) return;

        const service = AntigravityApiService.fromCredentials({
            accessToken: credential.accessToken,
            refreshToken: credential.refreshToken,
            projectId: credential.projectId,
            expiresAt: credential.expiresAt
        });

        const usage = await service.getUsageLimits();

        // Update projectId if changed during initialization
        if (service.projectId && service.projectId !== credential.projectId) {
            await geminiStore.update(credentialId, { projectId: service.projectId });
        }

        // Save quota data
        if (usage && usage.models) {
            const quotaData = {};
            for (const [modelId, modelUsage] of Object.entries(usage.models)) {
                quotaData[modelId] = {
                    remainingFraction: modelUsage.remainingFraction,
                    resetTime: modelUsage.resetTime
                };
            }
            await geminiStore.updateQuota(credentialId, quotaData);
            console.log(`[${getTimestamp()}] [Gemini] Auto quota fetch completed for ID ${credentialId}`);
        }
    } catch (error) {
        console.error(`[${getTimestamp()}] [Gemini] Auto quota fetch failed for ID ${credentialId}:`, error.message);
    }
}

export function setupGeminiRoutes(app, geminiStore, getTimestamp) {
    // Gemini OAuth start authorization
    app.post('/api/gemini/oauth/start', async (req, res) => {
        try {
            const { name } = req.body;
            const credentialName = name || `Gemini-${Date.now()}`;

            // Generate unique state for this OAuth session
            const state = crypto.randomBytes(32).toString('hex');

            // Get server's base URL from request
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const redirectUri = `${protocol}://${host}/api/gemini/oauth/callback`;

            // Generate auth URL
            const authUrl = generateGeminiAuthUrl(redirectUri, state);

            // Store pending session
            pendingOAuthSessions.set(state, {
                credentialName,
                redirectUri,
                createdAt: Date.now()
            });

            res.json({ success: true, authUrl });
        } catch (error) {
            console.error(`[${getTimestamp()}] [Gemini OAuth] Startup failed:`, error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Gemini OAuth callback handler
    app.get('/api/gemini/oauth/callback', async (req, res) => {
        try {
            const { code, state, error: oauthError } = req.query;

            if (oauthError) {
                console.error(`[${getTimestamp()}] [Gemini OAuth] Authorization failed:`, oauthError);
                return res.status(400).send(generateErrorPage(oauthError));
            }

            if (!code || !state) {
                return res.status(400).send(generateErrorPage('Missing code or state parameter'));
            }

            // Find pending session
            const session = pendingOAuthSessions.get(state);
            if (!session) {
                return res.status(400).send(generateErrorPage('Invalid or expired OAuth session'));
            }

            // Remove pending session
            pendingOAuthSessions.delete(state);

            console.log(`[${getTimestamp()}] [Gemini OAuth] Received authorization callback`);

            // Exchange code for tokens
            const tokens = await getGeminiTokenFromCode(code, session.redirectUri);

            // Save to database
            const id = await geminiStore.add({
                name: session.credentialName,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt
            });

            console.log(`[${getTimestamp()}] [Gemini OAuth] New credential added: ${session.credentialName} (ID: ${id})`);

            // Auto fetch quota in background (non-blocking)
            fetchAndSaveQuota(id, geminiStore, getTimestamp).catch(() => {});

            res.send(generateSuccessPage());
        } catch (error) {
            console.error(`[${getTimestamp()}] [Gemini OAuth] Callback error:`, error.message);
            res.status(500).send(generateErrorPage(error.message));
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

            // Auto fetch quota in background (non-blocking)
            fetchAndSaveQuota(id, geminiStore, getTimestamp).catch(() => {});

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
                    const newId = await geminiStore.add({
                        name,
                        email,
                        accessToken,
                        refreshToken: token,
                        projectId: null,
                        expiresAt
                    });

                    // Auto fetch quota in background (non-blocking)
                    fetchAndSaveQuota(newId, geminiStore, getTimestamp).catch(() => {});

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

/**
 * Generate success page HTML
 */
function generateSuccessPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authorization Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            padding: 40px 60px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
        }
        .icon {
            width: 80px;
            height: 80px;
            background: #10b981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
        }
        .icon svg {
            width: 40px;
            height: 40px;
            color: white;
        }
        h1 { color: #1f2937; margin-bottom: 10px; }
        p { color: #6b7280; margin-bottom: 20px; }
        .close-hint { font-size: 14px; color: #9ca3af; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
        </div>
        <h1>Authorization Successful!</h1>
        <p>Gemini credential has been added successfully.</p>
        <p class="close-hint">You can close this window now.</p>
    </div>
    <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`;
}

/**
 * Generate error page HTML
 */
function generateErrorPage(errorMessage) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authorization Failed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        }
        .container {
            background: white;
            padding: 40px 60px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
        }
        .icon {
            width: 80px;
            height: 80px;
            background: #ef4444;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
        }
        .icon svg {
            width: 40px;
            height: 40px;
            color: white;
        }
        h1 { color: #1f2937; margin-bottom: 10px; }
        p { color: #6b7280; margin-bottom: 10px; }
        .error-detail {
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 8px;
            padding: 12px;
            color: #dc2626;
            font-size: 14px;
            word-break: break-word;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </div>
        <h1>Authorization Failed</h1>
        <p>An error occurred during authorization:</p>
        <div class="error-detail">${errorMessage}</div>
    </div>
</body>
</html>`;
}
