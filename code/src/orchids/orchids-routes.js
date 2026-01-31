/**
 * Orchids API Routes
 * Integrated from orchids-api-main functionality
 */
import { OrchidsAPI } from './orchids-service.js';
import { OrchidsChatService, ORCHIDS_MODELS } from './orchids-chat-service.js';
import { getOrchidsLoadBalancer } from './orchids-loadbalancer.js';
import { startRegisterTask, getRegisterTask, getAllRegisterTasks, cancelRegisterTask } from './orchids-register.js';

export function setupOrchidsRoutes(app, orchidsStore) {
    
    // ============ Auto Registration Feature ============

    // Start registration task
    app.post('/api/orchids/register/start', async (req, res) => {
        try {
            const { count = 1 } = req.body;
            
            if (count < 1 || count > 50) {
                return res.status(400).json({ success: false, error: 'Registration count must be between 1-50' });
            }

            // Get current server address
            const protocol = req.protocol;
            const host = req.get('host');
            const serverUrl = `${protocol}://${host}`;

            const taskId = await startRegisterTask(count, orchidsStore, serverUrl);
            
            res.json({
                success: true,
                taskId,
                message: `Registration task started, target: ${count} accounts`
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get registration task status
    app.get('/api/orchids/register/task/:taskId', async (req, res) => {
        try {
            const { taskId } = req.params;
            const task = getRegisterTask(taskId);

            if (!task) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            
            res.json({ success: true, data: task.toJSON() });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get all registration tasks
    app.get('/api/orchids/register/tasks', async (req, res) => {
        try {
            const tasks = getAllRegisterTasks();
            res.json({ success: true, data: tasks });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Cancel registration task
    app.post('/api/orchids/register/cancel/:taskId', async (req, res) => {
        try {
            const { taskId } = req.params;
            const cancelled = cancelRegisterTask(taskId);

            if (!cancelled) {
                return res.status(404).json({ success: false, error: 'Task not found or already finished' });
            }

            res.json({ success: true, message: 'Task cancelled' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // SSE real-time log stream
    app.get('/api/orchids/register/stream/:taskId', async (req, res) => {
        const { taskId } = req.params;
        const task = getRegisterTask(taskId);

        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        let lastLogIndex = 0;

        const sendUpdate = () => {
            const data = task.toJSON();
            
            // Only send new logs
            const newLogs = data.logs.slice(lastLogIndex);
            lastLogIndex = data.logs.length;
            
            res.write(`data: ${JSON.stringify({ ...data, newLogs })}\n\n`);
        };

        // Immediately send current status
        sendUpdate();

        // Periodically send updates
        const interval = setInterval(() => {
            if (task.status === 'completed' || task.status === 'error' || task.status === 'cancelled') {
                sendUpdate();
                clearInterval(interval);
                res.end();
                return;
            }
            sendUpdate();
        }, 1000);

        // Client disconnected
        req.on('close', () => {
            clearInterval(interval);
        });
    });

    // ============ Statistics API ============

    // Get Orchids statistics summary
    app.get('/api/orchids/stats', async (req, res) => {
        try {
            const stats = await orchidsStore.getStats();
            res.json({ success: true, data: stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ Usage Info API ============

    // Get single account usage info
    app.get('/api/orchids/credentials/:id/usage', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await orchidsStore.getById(id);

            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const usageResult = await OrchidsAPI.getAccountUsage(credential.clientJwt);

            if (usageResult.success) {
                // Update usage info in database
                await orchidsStore.updateUsage(id, usageResult.usage);
                
                res.json({
                    success: true,
                    data: {
                        id: credential.id,
                        name: credential.name,
                        email: credential.email,
                        usage: usageResult.usage
                    }
                });
            } else {
                res.json({
                    success: false,
                    error: usageResult.error,
                    data: {
                        id: credential.id,
                        name: credential.name,
                        usage: credential.usageData || null
                    }
                });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get all accounts usage info summary
    app.get('/api/orchids/usage', async (req, res) => {
        try {
            const credentials = await orchidsStore.getAll();

            // Default quota (Free plan 150K credits/month)
            const DEFAULT_QUOTA = 150000;

            // Calculate usage for each account (if no usageData, use default quota)
            const accountsWithUsage = credentials.map(cred => {
                // If there's cached usage data, use it
                if (cred.usageData && cred.usageData.limit) {
                    return {
                        id: cred.id,
                        name: cred.name,
                        email: cred.email,
                        isActive: cred.isActive,
                        usage: cred.usageData,
                        usageUpdatedAt: cred.usageUpdatedAt
                    };
                }
                
                // Otherwise, use default free plan quota
                // Estimate usage: can be estimated based on local request statistics
                // Assume each request consumes 500 credits on average
                const estimatedUsed = (cred.requestCount || 0) * 500;
                const remaining = Math.max(0, DEFAULT_QUOTA - estimatedUsed);
                
                return {
                    id: cred.id,
                    name: cred.name,
                    email: cred.email,
                    isActive: cred.isActive,
                    usage: {
                        used: estimatedUsed,
                        limit: DEFAULT_QUOTA,
                        remaining: remaining,
                        plan: 'Free',
                        percentage: Math.min(100, Math.round((estimatedUsed / DEFAULT_QUOTA) * 100)),
                        source: 'estimated'
                    },
                    usageUpdatedAt: null
                };
            });
            
            // Only count active accounts
            const activeAccounts = accountsWithUsage.filter(a => a.isActive);
            
            const usageData = {
                accounts: accountsWithUsage,
                summary: {
                    totalAccounts: credentials.length,
                    activeAccounts: activeAccounts.length,
                    accountsWithUsage: credentials.filter(c => c.usageData && c.usageData.limit).length,
                    totalUsed: activeAccounts.reduce((sum, a) => sum + (a.usage?.used || 0), 0),
                    totalLimit: activeAccounts.reduce((sum, a) => sum + (a.usage?.limit || 0), 0)
                }
            };

            // Calculate total remaining
            usageData.summary.totalRemaining = Math.max(0, usageData.summary.totalLimit - usageData.summary.totalUsed);
            usageData.summary.totalPercentage = usageData.summary.totalLimit > 0 
                ? Math.round((usageData.summary.totalUsed / usageData.summary.totalLimit) * 100) 
                : 0;

            res.json({ success: true, data: usageData });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Refresh all accounts usage info
    app.post('/api/orchids/usage/refresh', async (req, res) => {
        try {
            const credentials = await orchidsStore.getAll();

            res.json({
                success: true,
                message: `Refreshing usage info for ${credentials.length} accounts...`,
                total: credentials.length
            });

            // Async execute refresh
            (async () => {
                for (const cred of credentials) {
                    try {
                        const usageResult = await OrchidsAPI.getAccountUsage(cred.clientJwt);
                        if (usageResult.success) {
                            await orchidsStore.updateUsage(cred.id, usageResult.usage);
                        }
                    } catch (err) {
                        console.error(`Failed to refresh account ${cred.id} usage:`, err.message);
                    }
                    // Delay to avoid too frequent requests
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                console.log('All accounts usage refresh completed');
            })();
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // SSE streaming refresh usage (real-time progress feedback)
    app.get('/api/orchids/usage/refresh/stream', async (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        try {
            const credentials = await orchidsStore.getAll();
            const total = credentials.length;
            let current = 0;
            let success = 0;
            let failed = 0;

            // Send start event
            res.write(`data: ${JSON.stringify({ type: 'start', total })}\n\n`);

            for (const cred of credentials) {
                current++;
                try {
                    const usageResult = await OrchidsAPI.getAccountUsage(cred.clientJwt);
                    if (usageResult.success) {
                        await orchidsStore.updateUsage(cred.id, usageResult.usage);
                        success++;
                        res.write(`data: ${JSON.stringify({ 
                            type: 'progress', 
                            current, 
                            total, 
                            success, 
                            failed,
                            account: {
                                id: cred.id,
                                name: cred.name,
                                usage: usageResult.usage
                            }
                        })}\n\n`);
                    } else {
                        failed++;
                        res.write(`data: ${JSON.stringify({ 
                            type: 'progress', 
                            current, 
                            total, 
                            success, 
                            failed,
                            account: {
                                id: cred.id,
                                name: cred.name,
                                error: usageResult.error
                            }
                        })}\n\n`);
                    }
                } catch (err) {
                    failed++;
                    res.write(`data: ${JSON.stringify({ 
                        type: 'progress', 
                        current, 
                        total, 
                        success, 
                        failed,
                        account: {
                            id: cred.id,
                            name: cred.name,
                            error: err.message
                        }
                    })}\n\n`);
                }
                // Delay to avoid too frequent requests
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            // Send complete event
            res.write(`data: ${JSON.stringify({ type: 'complete', total, success, failed })}\n\n`);
            res.end();
        } catch (error) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
            res.end();
        }
    });

    // Force refresh load balancer cache
    app.post('/api/orchids/loadbalancer/refresh', async (req, res) => {
        try {
            const lb = await getOrchidsLoadBalancer(orchidsStore);
            if (lb) {
                await lb.forceRefresh();
                res.json({ success: true, message: 'Load balancer cache refreshed' });
            } else {
                res.json({ success: false, error: 'Load balancer not initialized' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    // ============ Orchids Credential Management ============

    // Get all Orchids credentials
    app.get('/api/orchids/credentials', async (req, res) => {
        try {
            const credentials = await orchidsStore.getAll();
            res.json({ success: true, data: credentials });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get single Orchids credential
    app.get('/api/orchids/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await orchidsStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }
            res.json({ success: true, data: credential });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get all accounts health status
    app.get('/api/orchids/credentials/health', async (req, res) => {
        try {
            const credentials = await orchidsStore.getAll();
            const healthData = await OrchidsAPI.batchHealthCheck(credentials);
            res.json(healthData);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Add Orchids credential - only need clientJwt, auto-fetch other info
    app.post('/api/orchids/credentials', async (req, res) => {
        try {
            let { name, email, clientJwt, client_cookie, weight, enabled } = req.body;

            // Compatible with orchids-api-main field names
            const token = clientJwt || client_cookie;

            if (!token) {
                return res.status(400).json({ success: false, error: 'clientJwt or client_cookie is required' });
            }

            // Use enhanced method to get full account info (including email)
            const accountInfo = await OrchidsAPI.getFullAccountInfo(token);
            if (!accountInfo.success) {
                return res.status(400).json({ success: false, error: `Token validation failed: ${accountInfo.error}` });
            }

            // If name not provided, use email or generate one
            const finalName = name || accountInfo.email || `orchids-${Date.now()}`;
            // Prefer email from API response
            const finalEmail = accountInfo.email || email;

            // Check if name already exists
            const existing = await orchidsStore.getByName(finalName);
            if (existing) {
                return res.status(400).json({ success: false, error: 'Credential name already exists' });
            }

            const id = await orchidsStore.add({
                name: finalName,
                email: finalEmail,
                clientJwt: token,
                clerkSessionId: accountInfo.sessionId,
                userId: accountInfo.userId,
                expiresAt: accountInfo.expiresAt,
                weight: weight || 1,
                isActive: enabled !== false
            });

            // Refresh load balancer cache
            const lb = await getOrchidsLoadBalancer(orchidsStore);
            if (lb) await lb.forceRefresh();

            res.json({ 
                success: true, 
                data: { 
                    id,
                    name: finalName,
                    email: finalEmail,
                    userId: accountInfo.userId,
                    sessionId: accountInfo.sessionId,
                    expiresAt: accountInfo.expiresAt,
                    weight: weight || 1
                } 
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Batch import Orchids credentials
    app.post('/api/orchids/credentials/batch-import', async (req, res) => {
        try {
          const { accounts } = req.body;

            if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
                return res.status(400).json({ success: false, error: 'Please provide accounts array' });
            }

            const results = {
                success: 0,
                failed: 0,
                errors: []
            };

            for (const account of accounts) {
                try {
                    const { email, clientJwt, client_jwt, refreshToken, refresh_token } = account;
                    // Support multiple field names: clientJwt, client_jwt, refreshToken, refresh_token
                    const token = clientJwt || client_jwt || refreshToken || refresh_token;

                    if (!token) {
                        results.failed++;
                        results.errors.push({ email, error: 'Missing clientJwt/refreshToken' });
                        continue;
                    }

                    // Check if already exists
                    const name = email || `orchids-${Date.now()}`;
                    const existing = await orchidsStore.getByName(name);
                    if (existing) {
                        results.failed++;
                        results.errors.push({ email, error: 'Credential already exists' });
                        continue;
                    }

                    // Validate token info
                    const sessionResult = await OrchidsAPI.getSessionFromClerk(token);
                    if (!sessionResult.success) {
                        results.failed++;
                        results.errors.push({ email, error: `Token validation failed: ${sessionResult.error}` });
                        continue;
                    }

                    // Add credential
                    await orchidsStore.add({
                        name,
                        email,
                        clientJwt: token,
                        clerkSessionId: sessionResult.sessionId,
                        userId: sessionResult.userId,
                        expiresAt: sessionResult.expiresAt
                    });

                    results.success++;
                } catch (err) {
                    results.failed++;
                    results.errors.push({ email: account.email, error: err.message });
                }
            }

            res.json({
                success: true,
                data: results,
                message: `Successfully imported ${results.success} accounts, ${results.failed} failed`
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Update Orchids credential
    app.put('/api/orchids/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { name, email, clientJwt, weight, enabled } = req.body;
            
            const updateData = { name, email, clientJwt };
            if (weight !== undefined) {
                await orchidsStore.updateWeight(id, weight);
            }
            if (enabled !== undefined) {
                updateData.isActive = enabled;
            }
            
            await orchidsStore.update(id, updateData);
            
            // Refresh load balancer cache
            const lb = await getOrchidsLoadBalancer(orchidsStore);
            if (lb) await lb.forceRefresh();
            
            res.json({ success: true, message: 'Credential updated successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Update account weight
    app.put('/api/orchids/credentials/:id/weight', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { weight } = req.body;

            if (weight === undefined || weight < 0) {
                return res.status(400).json({ success: false, error: 'Weight must be a non-negative integer' });
            }
            
            await orchidsStore.updateWeight(id, weight);
            
            // Refresh load balancer cache
            const lb = await getOrchidsLoadBalancer(orchidsStore);
            if (lb) await lb.forceRefresh();
            
            res.json({ success: true, message: 'Weight updated successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Reset account statistics counts
    app.post('/api/orchids/credentials/:id/reset-counts', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await orchidsStore.resetCounts(id);
            res.json({ success: true, message: 'Statistics counts reset' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete Orchids credential
    app.delete('/api/orchids/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await orchidsStore.delete(id);
            res.json({ success: true, message: 'Credential deleted successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Toggle Orchids credential active status (enable/disable in pool)
    app.post('/api/orchids/credentials/:id/toggle-active', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const isActive = await orchidsStore.toggleActive(id);
            res.json({ success: true, data: { isActive } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Test Orchids credential
    app.post('/api/orchids/credentials/:id/test', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await orchidsStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            // Validate token
            const result = await OrchidsAPI.validateToken(credential.clientJwt);

            if (result.success && result.valid) {
                // Update credential info
                await orchidsStore.update(id, {
                    expiresAt: result.expiresAt
                });
                await orchidsStore.resetErrorCount(id);

                res.json({
                    success: true,
                    valid: true,
                    data: {
                        userId: result.userId,
                        sessionId: result.sessionId,
                        expiresAt: result.expiresAt
                    },
                    message: 'Token valid'
                });
            } else {
                await orchidsStore.incrementErrorCount(id, result.error || 'Token invalid');
                res.json({
                    success: true,
                    valid: false,
                    error: result.error,
                    message: 'Token invalid'
                });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get Orchids error credentials list
    app.get('/api/orchids/error-credentials', async (req, res) => {
        try {
            const errors = await orchidsStore.getAllErrors();
            res.json({ success: true, data: errors });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    // Delete Orchids error credential
    app.delete('/api/orchids/error-credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            await orchidsStore.deleteError(id);
            res.json({ success: true, message: 'Error credential deleted' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Refresh Orchids error credential and restore
    app.post('/api/orchids/error-credentials/:id/refresh', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { clientJwt } = req.body;

            const errorCred = await orchidsStore.getErrorById(id);
            if (!errorCred) {
                return res.status(404).json({ success: false, error: 'Error credential not found' });
            }

            const tokenToUse = clientJwt || errorCred.clientJwt;

            // Validate new token
            const sessionResult = await OrchidsAPI.getSessionFromClerk(tokenToUse);
            if (!sessionResult.success) {
                return res.status(400).json({ success: false, error: `Token validation failed: ${sessionResult.error}` });
            }

            const newId = await orchidsStore.restoreFromError(id, tokenToUse, sessionResult.expiresAt);

            res.json({
                success: true,
                data: { newId, expiresAt: sessionResult.expiresAt },
                message: 'Token validation successful, credential restored'
            });
        } catch (error) {
            res.status(500).json({ success: false, error: `Token validation failed: ${error.message}` });
        }
    });

    // ============ Export/Import Feature (integrated from orchids-api-main) ============

    // Export all account data (JSON)
    app.get('/api/orchids/export', async (req, res) => {
        try {
            const credentials = await orchidsStore.getAll();
            
            // Format as export format
            const exportData = credentials.map(cred => ({
                name: cred.name,
                email: cred.email,
                client_cookie: cred.clientJwt,
                user_id: cred.userId,
                session_id: cred.clerkSessionId,
                weight: cred.weight || 1,
                enabled: cred.isActive !== false
            }));

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=orchids_accounts_${Date.now()}.json`);
            res.json(exportData);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Import account data (JSON)
    app.post('/api/orchids/import', async (req, res) => {
        try {
            const accounts = req.body;

            if (!Array.isArray(accounts)) {
                return res.status(400).json({ success: false, error: 'Please provide accounts array' });
            }

            let imported = 0;
            let skipped = 0;

            for (const account of accounts) {
                try {
                    const token = account.client_cookie || account.clientJwt || account.client_jwt;
                    if (!token) {
                        skipped++;
                        continue;
                    }

                    // Check if already exists
                    const name = account.name || account.email || `orchids-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    const existing = await orchidsStore.getByName(name);
                    if (existing) {
                        skipped++;
                        continue;
                    }

                    // Validate and get full info
                    const accountInfo = await OrchidsAPI.getFullAccountInfo(token);
                    if (!accountInfo.success) {
                        skipped++;
                        continue;
                    }

                    await orchidsStore.add({
                        name,
                        email: accountInfo.email || account.email,
                        clientJwt: token,
                        clerkSessionId: accountInfo.sessionId,
                        userId: accountInfo.userId,
                        expiresAt: accountInfo.expiresAt
                    });

                    imported++;
                } catch {
                    skipped++;
                }
            }

            res.json({ success: true, imported, skipped });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // One-click refresh all accounts
    app.post('/api/orchids/refresh-all', async (req, res) => {
        try {
            const credentials = await orchidsStore.getAll();

            res.json({ success: true, message: 'Refresh task started' });

            // Async execute refresh
            (async () => {
                for (const cred of credentials) {
                    try {
                        const accountInfo = await OrchidsAPI.getFullAccountInfo(cred.clientJwt);
                        if (accountInfo.success) {
                            await orchidsStore.update(cred.id, {
                                email: accountInfo.email,
                                clerkSessionId: accountInfo.sessionId,
                                userId: accountInfo.userId,
                                expiresAt: accountInfo.expiresAt
                            });
                            await orchidsStore.resetErrorCount(cred.id);
                        } else {
                            await orchidsStore.incrementErrorCount(cred.id, accountInfo.error);
                        }
                    } catch (err) {
                        await orchidsStore.incrementErrorCount(cred.id, err.message);
                    }
                }
            })();
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Batch delete accounts
    app.post('/api/orchids/batch-delete', async (req, res) => {
        try {
            const { ids } = req.body;

            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ success: false, error: 'Please provide account IDs array to delete' });
            }

            let deleted = 0;
            let failed = 0;

            for (const id of ids) {
                try {
                    await orchidsStore.delete(id);
                    deleted++;
                } catch {
                    failed++;
                }
            }

            res.json({ success: true, deleted, failed });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Test single account activation status
    app.post('/api/orchids/credentials/:id/activate-test', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await orchidsStore.getById(id);

            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const healthResult = await OrchidsAPI.testAccountHealth(credential.clientJwt);

            if (healthResult.isHealthy) {
                // Update credential info
                if (healthResult.data) {
                    await orchidsStore.update(id, {
                        email: healthResult.data.email,
                        clerkSessionId: healthResult.data.sessionId,
                        userId: healthResult.data.userId,
                        expiresAt: healthResult.data.expiresAt
                    });
                }
                await orchidsStore.resetErrorCount(id);
            }

            res.json({
                success: healthResult.success,
                duration_ms: healthResult.durationMs,
                response: healthResult.response,
                message: healthResult.error
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ Orchids Chat API ============

    // Get Orchids supported models list
    app.get('/api/orchids/models', async (req, res) => {
        try {
            res.json({
                success: true,
                data: ORCHIDS_MODELS.map(id => ({ id, name: id }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Orchids chat endpoint - streaming SSE (using specified credential)
    app.post('/api/orchids/chat/:id', async (req, res) => {
        const id = parseInt(req.params.id);

        try {
            const credential = await orchidsStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const { messages, model, system, max_tokens, stream = true } = req.body;

            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ success: false, error: 'Missing messages parameter' });
            }

            const service = new OrchidsChatService(credential);
            const requestBody = { messages, system, max_tokens };

            if (stream) {
                // Streaming response
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');

                try {
                    for await (const event of service.generateContentStream(model, requestBody)) {
                        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                    }
                    res.end();
                } catch (streamError) {
                    const errorEvent = {
                        type: 'error',
                        error: { type: 'api_error', message: streamError.message }
                    };
                    res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
                    res.end();
                }
            } else {
                // Non-streaming response
                const response = await service.generateContent(model, requestBody);
                res.json(response);
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Orchids chat endpoint - non-streaming (using specified credential)
    app.post('/api/orchids/chat/:id/sync', async (req, res) => {
        const id = parseInt(req.params.id);

        try {
            const credential = await orchidsStore.getById(id);
            if (!credential) {
                return res.status(404).json({ success: false, error: 'Credential not found' });
            }

            const { messages, model, system, max_tokens } = req.body;

            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ success: false, error: 'Missing messages parameter' });
            }

            const service = new OrchidsChatService(credential);
            const requestBody = { messages, system, max_tokens };
            const response = await service.generateContent(model, requestBody);

            res.json(response);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Orchids chat endpoint - using active credential
    app.post('/api/orchids/chat', async (req, res) => {
        try {
            // Get active credential
            const credentials = await orchidsStore.getAll();
            const activeCredential = credentials.find(c => c.isActive) || credentials[0];

            if (!activeCredential) {
                return res.status(400).json({ success: false, error: 'No available Orchids credential' });
            }

            const { messages, model, system, max_tokens, stream = true } = req.body;

            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ success: false, error: 'Missing messages parameter' });
            }

            const service = new OrchidsChatService(activeCredential);
            const requestBody = { messages, system, max_tokens };

            if (stream) {
                // Streaming response
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');

                try {
                    for await (const event of service.generateContentStream(model, requestBody)) {
                        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                    }
                    res.end();
                } catch (streamError) {
                    const errorEvent = {
                        type: 'error',
                        error: { type: 'api_error', message: streamError.message }
                    };
                    res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
                    res.end();
                }
            } else {
                // Non-streaming response
                const response = await service.generateContent(model, requestBody);
                res.json(response);
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
}
