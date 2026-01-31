/**
 * Amazon Bedrock API Routes
 */
import express from 'express';
import { BedrockCredentialStore } from '../db.js';
import { BedrockClient, BedrockAPI } from './bedrock.js';
import { BEDROCK_CONSTANTS, BEDROCK_MODELS, BEDROCK_MODEL_MAPPING } from '../constants.js';
import { logger } from '../logger.js';

const log = logger.api;
const router = express.Router();

// ==================== Credential Management API ====================

/**
 * Get all Bedrock credentials
 */
router.get('/credentials', async (req, res) => {
    try {
        const store = await BedrockCredentialStore.create();
        const credentials = await store.getAll();
        
        // Hide sensitive information
        const safeCredentials = credentials.map(cred => ({
            ...cred,
            accessKeyId: cred.accessKeyId ? cred.accessKeyId.substring(0, 8) + '****' : null,
            secretAccessKey: '********',
            sessionToken: cred.sessionToken ? '****' : null
        }));
        
        res.json({ success: true, data: safeCredentials });
    } catch (error) {
        log.error(`Failed to get Bedrock credentials list: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get a single Bedrock credential
 */
router.get('/credentials/:id', async (req, res) => {
    try {
        const store = await BedrockCredentialStore.create();
        const credential = await store.getById(parseInt(req.params.id));
        
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        
        // Hide sensitive information
        const safeCredential = {
            ...credential,
            accessKeyId: credential.accessKeyId ? credential.accessKeyId.substring(0, 8) + '****' : null,
            secretAccessKey: '********',
            sessionToken: credential.sessionToken ? '****' : null
        };
        
        res.json({ success: true, data: safeCredential });
    } catch (error) {
        log.error(`Failed to get Bedrock credential: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Add Bedrock credential
 */
router.post('/credentials', async (req, res) => {
    try {
        const { name, accessKeyId, secretAccessKey, sessionToken, region } = req.body;
        
        if (!name || !accessKeyId || !secretAccessKey) {
            return res.status(400).json({ success: false, error: 'Missing required parameters: name, accessKeyId, secretAccessKey' });
        }
        
        const store = await BedrockCredentialStore.create();
        
        // Check if name already exists
        const existing = await store.getByName(name);
        if (existing) {
            return res.status(400).json({ success: false, error: `Name "${name}" already exists` });
        }
        
        const id = await store.add({
            name,
            accessKeyId,
            secretAccessKey,
            sessionToken,
            region: region || BEDROCK_CONSTANTS.DEFAULT_REGION
        });
        
        log.info(`Successfully added Bedrock credential: ${name} (ID: ${id})`);
        res.json({ success: true, data: { id, name } });
    } catch (error) {
        log.error(`Failed to add Bedrock credential: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Update Bedrock credential
 */
router.put('/credentials/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        
        const existing = await store.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        
        const updates = {};
        if (req.body.name !== undefined) updates.name = req.body.name;
        if (req.body.accessKeyId !== undefined) updates.accessKeyId = req.body.accessKeyId;
        if (req.body.secretAccessKey !== undefined) updates.secretAccessKey = req.body.secretAccessKey;
        if (req.body.sessionToken !== undefined) updates.sessionToken = req.body.sessionToken;
        if (req.body.region !== undefined) updates.region = req.body.region;
        if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
        
        await store.update(id, updates);
        
        log.info(`Successfully updated Bedrock credential: ID ${id}`);
        res.json({ success: true });
    } catch (error) {
        log.error(`Failed to update Bedrock credential: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Delete Bedrock credential
 */
router.delete('/credentials/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        
        const existing = await store.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        
        await store.delete(id);
        
        log.info(`Successfully deleted Bedrock credential: ${existing.name} (ID: ${id})`);
        res.json({ success: true });
    } catch (error) {
        log.error(`Failed to delete Bedrock credential: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Toggle Bedrock credential active status (enable/disable in pool)
 */
router.post('/credentials/:id/toggle-active', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();

        const existing = await store.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }

        const isActive = await store.toggleActive(id);

        log.info(`Successfully ${isActive ? 'enabled' : 'disabled'} Bedrock credential: ${existing.name} (ID: ${id})`);
        res.json({ success: true, data: { isActive } });
    } catch (error) {
        log.error(`Failed to toggle Bedrock credential: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Test Bedrock credential
 */
router.post('/credentials/:id/test', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        
        const credential = await store.getById(id);
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        
        // Test with simple message
        const client = BedrockClient.fromCredentials(credential);
        const response = await client.chat(
            [{ role: 'user', content: 'Hi, respond with just "OK".' }],
            'claude-3-haiku-20240307',
            { max_tokens: 10 }
        );
        
        // Reset error count
        await store.resetErrorCount(id);
        
        log.info(`Successfully tested Bedrock credential: ${credential.name} (ID: ${id})`);
        res.json({
            success: true,
            data: {
                response: response.content?.[0]?.text || 'OK',
                usage: response.usage
            }
        });
    } catch (error) {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        await store.incrementErrorCount(id, error.message);
        
        log.error(`Failed to test Bedrock credential: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get Bedrock credential statistics
 */
router.get('/statistics', async (req, res) => {
    try {
        const store = await BedrockCredentialStore.create();
        const stats = await store.getStatistics();
        res.json({ success: true, data: stats });
    } catch (error) {
        log.error(`Failed to get Bedrock statistics: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== Model and Region Information ====================

/**
 * Get supported model list
 */
router.get('/models', (req, res) => {
    res.json({
        success: true,
        data: BEDROCK_MODELS,
        mapping: BEDROCK_MODEL_MAPPING
    });
});

/**
 * Get supported region list
 */
router.get('/regions', (req, res) => {
    res.json({
        success: true,
        data: BEDROCK_CONSTANTS.SUPPORTED_REGIONS
    });
});

// ==================== Chat API ====================

/**
 * Chat endpoint (non-streaming) - Using specified credential
 */
router.post('/chat/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { messages, model, system, max_tokens, temperature, tools } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'Missing messages parameter' });
        }
        
        const store = await BedrockCredentialStore.create();
        const credential = await store.getById(id);
        
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        
        if (!credential.isActive) {
            return res.status(400).json({ success: false, error: 'Credential is deactivated' });
        }
        
        const client = BedrockClient.fromCredentials(credential);
        const response = await client.chat(messages, model || BEDROCK_CONSTANTS.DEFAULT_MODEL, {
            system,
            max_tokens,
            temperature,
            tools
        });
        
        // Update usage count
        await store.incrementUseCount(id);
        
        res.json(response);
    } catch (error) {
        log.error(`Bedrock chat failed: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Chat endpoint (streaming) - Using specified credential
 */
router.post('/chat/:id/stream', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { messages, model, system, max_tokens, temperature, tools } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'Missing messages parameter' });
        }
        
        const store = await BedrockCredentialStore.create();
        const credential = await store.getById(id);
        
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        
        if (!credential.isActive) {
            return res.status(400).json({ success: false, error: 'Credential is deactivated' });
        }
        
        // Set SSE response headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        
        const client = BedrockClient.fromCredentials(credential);
        
        for await (const event of client.chatStream(messages, model || BEDROCK_CONSTANTS.DEFAULT_MODEL, {
            system,
            max_tokens,
            temperature,
            tools
        })) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        
        // Update usage count
        await store.incrementUseCount(id);
        
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        log.error(`Bedrock streaming chat failed: ${error.message}`);
        
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

/**
 * Chat using random active credential (non-streaming)
 */
router.post('/chat', async (req, res) => {
    try {
        const { messages, model, system, max_tokens, temperature, tools } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'Missing messages parameter' });
        }
        
        const store = await BedrockCredentialStore.create();
        const credential = await store.getRandomActive();
        
        if (!credential) {
            return res.status(400).json({ success: false, error: 'No available Bedrock credentials' });
        }
        
        const client = BedrockClient.fromCredentials(credential);
        const response = await client.chat(messages, model || BEDROCK_CONSTANTS.DEFAULT_MODEL, {
            system,
            max_tokens,
            temperature,
            tools
        });
        
        // Update usage count
        await store.incrementUseCount(credential.id);
        
        res.json(response);
    } catch (error) {
        log.error(`Bedrock chat failed: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Chat using random active credential (streaming)
 */
router.post('/chat/stream', async (req, res) => {
    try {
        const { messages, model, system, max_tokens, temperature, tools } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'Missing messages parameter' });
        }
        
        const store = await BedrockCredentialStore.create();
        const credential = await store.getRandomActive();
        
        if (!credential) {
            return res.status(400).json({ success: false, error: 'No available Bedrock credentials' });
        }
        
        // Set SSE response headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        
        const client = BedrockClient.fromCredentials(credential);
        
        for await (const event of client.chatStream(messages, model || BEDROCK_CONSTANTS.DEFAULT_MODEL, {
            system,
            max_tokens,
            temperature,
            tools
        })) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        
        // Update usage count
        await store.incrementUseCount(credential.id);
        
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        log.error(`Bedrock streaming chat failed: ${error.message}`);
        
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

export default router;
