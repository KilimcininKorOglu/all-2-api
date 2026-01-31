/**
 * Orchids API Service
 * Provides Orchids account management and Token validation features
 * Integrated from orchids-api-main functionality
 */
import axios from 'axios';
import { logger } from '../logger.js';
import { getAxiosProxyConfig } from '../proxy.js';

const log = logger.api;

/**
 * Orchids constants configuration
 */
export const ORCHIDS_CONSTANTS = {
    CLERK_CLIENT_URL: 'https://clerk.orchids.app/v1/client',
    CLERK_CLIENT_URL_V2: 'https://clerk.orchids.app/v1/client?__clerk_api_version=2025-11-10&_clerk_js_version=5.117.0',
    CLERK_TOKEN_URL: 'https://clerk.orchids.app/v1/client/sessions/{sessionId}/tokens',
    CLERK_JS_VERSION: '5.117.0',
    USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Orchids/0.0.57 Chrome/138.0.7204.251 Electron/37.10.3 Safari/537.36',
    ORIGIN: 'https://www.orchids.app',
    DEFAULT_TIMEOUT: 30000,
    DEFAULT_PROJECT_ID: '280b7bae-cd29-41e4-a0a6-7f603c43b607',
    // Orchids API server address
    ORCHIDS_API_BASE: 'https://orchids-server.calmstone-6964e08a.westeurope.azurecontainerapps.io',
    // Plan quota mapping (credits/month)
    PLAN_QUOTAS: {
        'free': 150000,
        'pro': 2000000,
        'premium': 4000000,
        'ultra': 12000000,
        'max': 30000000
    }
};

/**
 * Orchids API Service class
 */
export class OrchidsAPI {
    /**
     * Get full account info from clientJwt (including email)
     * Based on orchids-api-main's clerk.go implementation
     * @param {string} clientJwt - Clerk client JWT token (__client cookie value)
     * @returns {Promise<Object>} {success, sessionId, userId, email, wsToken, expiresAt, clientUat, projectId, error}
     */
    static async getFullAccountInfo(clientJwt) {
        if (!clientJwt) {
            return { success: false, error: 'Missing clientJwt' };
        }

        log.info('Getting full account info from Clerk API');

        try {
            const proxyConfig = getAxiosProxyConfig();
            const response = await axios.get(ORCHIDS_CONSTANTS.CLERK_CLIENT_URL_V2, {
                headers: {
                    'Cookie': `__client=${clientJwt}`,
                    'Origin': ORCHIDS_CONSTANTS.ORIGIN,
                    'User-Agent': ORCHIDS_CONSTANTS.USER_AGENT,
                    'Accept-Language': 'zh-CN',
                },
                timeout: ORCHIDS_CONSTANTS.DEFAULT_TIMEOUT,
                ...proxyConfig
            });

            if (response.status !== 200) {
                log.error(`Clerk API returned status code: ${response.status}`);
                return { success: false, error: `Clerk API returned ${response.status}` };
            }

            const data = response.data;
            const responseData = data.response || {};
            const sessions = responseData.sessions || [];

            if (sessions.length === 0) {
                log.error('No active session found');
                return { success: false, error: 'No active session found' };
            }

            const session = sessions[0];
            const sessionId = responseData.last_active_session_id || session.id;
            const userId = session.user?.id;
            const wsToken = session.last_active_token?.jwt;
            
            // Get email - extract from email_addresses array
            let email = null;
            if (session.user?.email_addresses && session.user.email_addresses.length > 0) {
                email = session.user.email_addresses[0].email_address;
            }

            if (!sessionId || !wsToken) {
                log.error('Session data invalid');
                return { success: false, error: 'Session data invalid' };
            }

            // Parse JWT expiration time
            const expiresAt = this._parseJwtExpiry(wsToken);

            log.success('Successfully obtained full account info');
            log.info(`Session ID: ${sessionId}`);
            log.info(`User ID: ${userId || 'unknown'}`);
            log.info(`Email: ${email || 'unknown'}`);
            log.info(`Token expires at: ${expiresAt || 'unknown'}`);

            return {
                success: true,
                sessionId,
                userId,
                email,
                wsToken,
                expiresAt,
                clientUat: Math.floor(Date.now() / 1000).toString(),
                projectId: ORCHIDS_CONSTANTS.DEFAULT_PROJECT_ID
            };

        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            log.fail(`Failed to get account info: ${errorMsg}`, error.response?.status);
            return {
                success: false,
                error: errorMsg,
                statusCode: error.response?.status
            };
        }
    }

    /**
     * Get session info from clientJwt (legacy compatible)
     * @param {string} clientJwt - Clerk client JWT token
     * @returns {Promise<Object>} {success, sessionId, userId, wsToken, expiresAt, email, error}
     */
    static async getSessionFromClerk(clientJwt) {
        // Use new complete method to get info
        const result = await this.getFullAccountInfo(clientJwt);
        if (!result.success) {
            return result;
        }
        
        return {
            success: true,
            sessionId: result.sessionId,
            userId: result.userId,
            wsToken: result.wsToken,
            expiresAt: result.expiresAt,
            email: result.email
        };
    }

    /**
     * Validate if clientJwt is valid
     * @param {string} clientJwt - Clerk client JWT token
     * @returns {Promise<Object>} {success, valid, email, userId, expiresAt, error}
     */
    static async validateToken(clientJwt) {
        const result = await this.getSessionFromClerk(clientJwt);

        if (!result.success) {
            return {
                success: true,
                valid: false,
                error: result.error
            };
        }

        return {
            success: true,
            valid: true,
            userId: result.userId,
            sessionId: result.sessionId,
            expiresAt: result.expiresAt
        };
    }

    /**
     * Extract clientJwt from cookies string
     * @param {string} cookies - Cookies string
     * @returns {string|null} clientJwt
     */
    static extractClientJwtFromCookies(cookies) {
        if (!cookies) return null;

        const match = cookies.match(/__client=([^;]+)/);
        if (match && match[1]) {
            const jwt = match[1].trim();
            // Validate if it's a valid JWT format (three parts, separated by .)
            if (jwt.split('.').length === 3) {
                return jwt;
            }
        }

        return null;
    }

    /**
     * Parse JWT expiration time
     * @private
     * @param {string} jwt - JWT token
     * @returns {string|null} ISO formatted expiration time
     */
    static _parseJwtExpiry(jwt) {
        if (!jwt) return null;

        try {
            const parts = jwt.split('.');
            if (parts.length !== 3) return null;

            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));

            if (payload.exp) {
                const expiryDate = new Date(payload.exp * 1000);
                return expiryDate.toISOString();
            }

            return null;
        } catch (error) {
            log.warn(`Failed to parse JWT expiration time: ${error.message}`);
            return null;
        }
    }

    /**
     * Check if Token is about to expire
     * @param {string} expiresAt - Expiration time ISO string
     * @param {number} minutes - How many minutes ahead to determine as expiring soon (default 10)
     * @returns {boolean}
     */
    static isTokenExpiringSoon(expiresAt, minutes = 10) {
        if (!expiresAt) return false;
        try {
            const expirationTime = new Date(expiresAt);
            const thresholdTime = new Date(Date.now() + minutes * 60 * 1000);
            return expirationTime.getTime() <= thresholdTime.getTime();
        } catch {
            return false;
        }
    }

    /**
     * Batch import Orchids accounts
     * @param {Array} accounts - Account array [{email, clientJwt}]
     * @param {Object} options - Options
     * @param {number} options.delay - Delay in milliseconds between requests (default 1000)
     * @param {Function} options.onProgress - Progress callback (index, total, result)
     * @returns {Promise<Object>} Batch import result {success, failed, results}
     */
    static async batchImport(accounts, options = {}) {
        const { delay = 1000, onProgress } = options;
        const results = {
            success: 0,
            failed: 0,
            results: []
        };

        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            const result = await this.validateToken(account.clientJwt);

            results.results.push({
                email: account.email,
                ...result
            });

            if (result.success && result.valid) {
                results.success++;
            } else {
                results.failed++;
            }

            if (onProgress) {
                onProgress(i + 1, accounts.length, result);
            }

            // Delay to avoid too frequent requests
            if (i < accounts.length - 1 && delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return results;
    }

    /**
     * Test account activation status
     * Send a simple test request to verify if account is available
     * @param {string} clientJwt - Clerk client JWT token
     * @returns {Promise<Object>} {success, isHealthy, durationMs, response, error}
     */
    static async testAccountHealth(clientJwt) {
        const startTime = Date.now();
        
        try {
            const result = await this.getFullAccountInfo(clientJwt);
            const durationMs = Date.now() - startTime;
            
            if (!result.success) {
                return {
                    success: false,
                    isHealthy: false,
                    durationMs,
                    error: result.error
                };
            }
            
            return {
                success: true,
                isHealthy: true,
                durationMs,
                response: `Session: ${result.sessionId}, Email: ${result.email || 'N/A'}`,
                data: result
            };
        } catch (error) {
            const durationMs = Date.now() - startTime;
            return {
                success: false,
                isHealthy: false,
                durationMs,
                error: error.message
            };
        }
    }

    /**
     * Batch check account health status
     * @param {Array} credentials - Credential array [{id, clientJwt}]
     * @returns {Promise<Object>} {accounts: [{accountId, isHealthy}]}
     */
    static async batchHealthCheck(credentials) {
        const results = {
            accounts: []
        };

        for (const cred of credentials) {
            try {
                const health = await this.testAccountHealth(cred.clientJwt);
                results.accounts.push({
                    account_id: cred.id,
                    is_healthy: health.isHealthy
                });
            } catch {
                results.accounts.push({
                    account_id: cred.id,
                    is_healthy: false
                });
            }
        }

        return results;
    }

    /**
     * Refresh single account info
     * @param {string} clientJwt - Clerk client JWT token
     * @returns {Promise<Object>} Refreshed full account info
     */
    static async refreshAccountInfo(clientJwt) {
        return await this.getFullAccountInfo(clientJwt);
    }

    /**
     * Get account usage info (from Clerk user metadata and Orchids API)
     * @param {string} clientJwt - Clerk client JWT token
     * @returns {Promise<Object>} {success, usage: {used, limit, remaining, plan, resetDate, percentage}, error}
     */
    static async getAccountUsage(clientJwt) {
        if (!clientJwt) {
            return { success: false, error: 'Missing clientJwt' };
        }

        log.info('Getting Orchids account usage info');

        try {
            const proxyConfig = getAxiosProxyConfig();
            
            // First get user info from Clerk API (may contain metadata)
            const clerkResponse = await axios.get(ORCHIDS_CONSTANTS.CLERK_CLIENT_URL_V2, {
                headers: {
                    'Cookie': `__client=${clientJwt}`,
                    'Origin': ORCHIDS_CONSTANTS.ORIGIN,
                    'User-Agent': ORCHIDS_CONSTANTS.USER_AGENT,
                    'Accept-Language': 'zh-CN',
                },
                timeout: ORCHIDS_CONSTANTS.DEFAULT_TIMEOUT,
                ...proxyConfig
            });

            if (clerkResponse.status !== 200) {
                return { success: false, error: `Clerk API returned ${clerkResponse.status}` };
            }

            const clerkData = clerkResponse.data;
            const responseData = clerkData.response || {};
            const sessions = responseData.sessions || [];

            if (sessions.length === 0) {
                return { success: false, error: 'No active session found' };
            }

            const session = sessions[0];
            const user = session.user || {};
            const wsToken = session.last_active_token?.jwt;
            
            // Try to get usage info from user metadata
            const publicMetadata = user.public_metadata || {};
            const privateMetadata = user.private_metadata || {};
            const unsafeMetadata = user.unsafe_metadata || {};

            // Orchids may store usage info in metadata
            let usageData = null;

            // Check various possible metadata locations
            if (publicMetadata.usage || publicMetadata.credits) {
                usageData = publicMetadata.usage || publicMetadata;
            } else if (privateMetadata.usage || privateMetadata.credits) {
                usageData = privateMetadata.usage || privateMetadata;
            } else if (unsafeMetadata.usage || unsafeMetadata.credits) {
                usageData = unsafeMetadata.usage || unsafeMetadata;
            }

            // Try to get usage from Orchids API
            if (!usageData) {
                try {
                    usageData = await this._getUsageFromOrchidsAPI(clientJwt, wsToken);
                } catch (e) {
                    log.warn(`Failed to get usage from Orchids API: ${e.message}`);
                }
            }

            // If still no usage data, try to infer from user plan
            const plan = publicMetadata.plan || privateMetadata.plan || 
                         unsafeMetadata.plan || user.plan || 'free';
            const planQuota = ORCHIDS_CONSTANTS.PLAN_QUOTAS[plan.toLowerCase()] || 
                             ORCHIDS_CONSTANTS.PLAN_QUOTAS['free'];

            if (usageData && (usageData.used !== undefined || usageData.credits_used !== undefined)) {
                const used = usageData.used || usageData.credits_used || 0;
                const limit = usageData.limit || usageData.credits_limit || planQuota;
                const remaining = Math.max(0, limit - used);
                const percentage = Math.round((used / limit) * 100);
                
                // Calculate reset date (usually 1st of next month)
                const now = new Date();
                const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

                log.success(`Successfully got usage: ${used}/${limit} (${percentage}%)`);

                return {
                    success: true,
                    usage: {
                        used,
                        limit,
                        remaining,
                        plan: plan.charAt(0).toUpperCase() + plan.slice(1),
                        resetDate: resetDate.toISOString(),
                        percentage,
                        source: 'api'
                    }
                };
            }

            // If no specific usage data, return plan default value
            log.info(`No specific usage data, using plan default: ${plan}`);
            
            return {
                success: true,
                usage: {
                    used: 0,
                    limit: planQuota,
                    remaining: planQuota,
                    plan: plan.charAt(0).toUpperCase() + plan.slice(1),
                    resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
                    percentage: 0,
                    source: 'estimated'
                }
            };

        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            log.fail(`Failed to get usage info: ${errorMsg}`, error.response?.status);
            return {
                success: false,
                error: errorMsg,
                statusCode: error.response?.status
            };
        }
    }

    /**
     * Get usage info from Orchids API
     * @private
     * @param {string} clientJwt - Clerk client JWT token
     * @param {string} wsToken - WebSocket/API token
     * @returns {Promise<Object|null>} Usage data
     */
    static async _getUsageFromOrchidsAPI(clientJwt, wsToken) {
        const proxyConfig = getAxiosProxyConfig();
        
        // Try multiple possible usage API endpoints
        const possibleEndpoints = [
            `${ORCHIDS_CONSTANTS.ORCHIDS_API_BASE}/api/usage`,
            `${ORCHIDS_CONSTANTS.ORCHIDS_API_BASE}/api/user/usage`,
            `${ORCHIDS_CONSTANTS.ORCHIDS_API_BASE}/api/credits`,
            `${ORCHIDS_CONSTANTS.ORCHIDS_API_BASE}/api/billing/usage`,
            'https://www.orchids.app/api/usage',
            'https://www.orchids.app/api/user/credits',
        ];

        const headers = {
            'Cookie': `__client=${clientJwt}`,
            'Origin': ORCHIDS_CONSTANTS.ORIGIN,
            'User-Agent': ORCHIDS_CONSTANTS.USER_AGENT,
            'Accept': 'application/json',
        };

        if (wsToken) {
            headers['Authorization'] = `Bearer ${wsToken}`;
        }

        for (const endpoint of possibleEndpoints) {
            try {
                const response = await axios.get(endpoint, {
                    headers,
                    timeout: 10000,
                    ...proxyConfig
                });

                if (response.status === 200 && response.data) {
                    const data = response.data;
                    // Check if response contains usage info
                    if (data.used !== undefined || data.credits_used !== undefined ||
                        data.usage !== undefined || data.credits !== undefined) {
                        log.success(`Got usage data from ${endpoint}`);
                        return data.usage || data;
                    }
                }
            } catch (e) {
                // Continue trying next endpoint
                continue;
            }
        }

        return null;
    }

    /**
     * Batch get all accounts usage info
     * @param {Array} credentials - Credential array [{id, clientJwt}]
     * @returns {Promise<Object>} {accounts: [{id, usage}], totalUsed, totalLimit}
     */
    static async batchGetUsage(credentials) {
        const results = {
            accounts: [],
            totalUsed: 0,
            totalLimit: 0,
            successCount: 0,
            failCount: 0
        };

        for (const cred of credentials) {
            try {
                const usageResult = await this.getAccountUsage(cred.clientJwt);
                if (usageResult.success) {
                    results.accounts.push({
                        id: cred.id,
                        name: cred.name,
                        email: cred.email,
                        usage: usageResult.usage
                    });
                    results.totalUsed += usageResult.usage.used;
                    results.totalLimit += usageResult.usage.limit;
                    results.successCount++;
                } else {
                    results.accounts.push({
                        id: cred.id,
                        name: cred.name,
                        email: cred.email,
                        usage: null,
                        error: usageResult.error
                    });
                    results.failCount++;
                }
            } catch (error) {
                results.accounts.push({
                    id: cred.id,
                    name: cred.name,
                    email: cred.email,
                    usage: null,
                    error: error.message
                });
                results.failCount++;
            }
            
            // Add small delay to avoid too frequent requests
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return results;
    }
}

export default OrchidsAPI;
