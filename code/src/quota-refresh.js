/**
 * Unified Background Quota Refresh Module
 * Periodically refreshes quota information for all vendors (Kiro, Gemini, Orchids, Warp, Anthropic)
 */

import { KiroClient } from './kiro/client.js';
import { AntigravityApiService } from './gemini/antigravity-core.js';
import { OrchidsAPI } from './orchids/orchids-service.js';
import { WarpService, getRequestLimit } from './warp/warp-service.js';
import { verifyCredentials as verifyAnthropicCredentials } from './anthropic/anthropic-service.js';

// Configuration
const QUOTA_REFRESH_INTERVAL = 5 * 60 * 1000;   // 5 minutes
const INITIAL_DELAY = 60 * 1000;                 // 1 minute
const DELAY_BETWEEN_CREDENTIALS = 2000;          // 2 seconds
const DELAY_BETWEEN_VENDORS = 5000;              // 5 seconds

/**
 * Get current timestamp string
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Refresh quotas for all Kiro credentials
 * @param {Object} store - Kiro credential store
 * @returns {Promise<{success: number, failed: number}>}
 */
async function refreshKiroQuotas(store) {
    const result = { success: 0, failed: 0 };

    try {
        const credentials = await store.getAll();
        if (credentials.length === 0) {
            return result;
        }

        for (const cred of credentials) {
            try {
                const client = new KiroClient({
                    accessToken: cred.accessToken,
                    refreshToken: cred.refreshToken,
                    profileArn: cred.profileArn,
                    authMethod: cred.authMethod,
                    region: cred.region || 'us-east-1',
                    clientId: cred.clientId,
                    clientSecret: cred.clientSecret,
                    expiresAt: cred.expiresAt
                });

                const usage = await client.getUsageLimits();
                await store.updateUsage(cred.id, usage);
                result.success++;

                // Log low quota warnings
                if (usage && usage.percentage !== undefined) {
                    const remaining = 100 - usage.percentage;
                    if (remaining <= 5) {
                        console.warn(`[${getTimestamp()}] [Quota] CRITICAL: ${cred.name} (Kiro): ${remaining}% remaining`);
                    } else if (remaining <= 20) {
                        console.log(`[${getTimestamp()}] [Quota] LOW: ${cred.name} (Kiro): ${remaining}% remaining`);
                    }
                }
            } catch (error) {
                result.failed++;
                console.error(`[${getTimestamp()}] [Quota Refresh] Kiro ${cred.name}: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CREDENTIALS));
        }
    } catch (error) {
        console.error(`[${getTimestamp()}] [Quota Refresh] Kiro task error: ${error.message}`);
    }

    return result;
}

/**
 * Refresh quotas for all Gemini credentials
 * @param {Object} store - Gemini credential store
 * @returns {Promise<{success: number, failed: number}>}
 */
async function refreshGeminiQuotas(store) {
    const result = { success: 0, failed: 0 };

    try {
        const credentials = await store.getAllActive();
        if (credentials.length === 0) {
            return result;
        }

        for (const cred of credentials) {
            try {
                const service = new AntigravityApiService({
                    oauthCredsFilePath: null,
                    projectId: cred.projectId
                });

                service.authClient.setCredentials({
                    access_token: cred.accessToken,
                    refresh_token: cred.refreshToken,
                    expiry_date: cred.expiresAt ? new Date(cred.expiresAt).getTime() : null
                });

                service.projectId = cred.projectId;
                service.isInitialized = true;

                const quotaResult = await service.getModelsWithQuotas();

                const quotaData = {};
                for (const [modelId, modelInfo] of Object.entries(quotaResult.models)) {
                    quotaData[modelId] = {
                        remainingFraction: modelInfo.remaining,
                        resetTime: modelInfo.resetTime
                    };

                    // Log low quota warnings
                    const remaining = modelInfo.remaining;
                    if (remaining !== null && remaining !== undefined) {
                        const remainingPercent = Math.round(remaining * 100);
                        if (remainingPercent <= 5) {
                            console.warn(`[${getTimestamp()}] [Quota] CRITICAL: ${cred.name} - ${modelId}: ${remainingPercent}% remaining`);
                        } else if (remainingPercent <= 20) {
                            console.log(`[${getTimestamp()}] [Quota] LOW: ${cred.name} - ${modelId}: ${remainingPercent}% remaining`);
                        }
                    }
                }

                await store.updateQuota(cred.id, quotaData);
                result.success++;
            } catch (error) {
                result.failed++;
                console.error(`[${getTimestamp()}] [Quota Refresh] Gemini ${cred.name}: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CREDENTIALS));
        }
    } catch (error) {
        console.error(`[${getTimestamp()}] [Quota Refresh] Gemini task error: ${error.message}`);
    }

    return result;
}

/**
 * Refresh quotas for all Orchids credentials
 * @param {Object} store - Orchids credential store
 * @returns {Promise<{success: number, failed: number}>}
 */
async function refreshOrchidsQuotas(store) {
    const result = { success: 0, failed: 0 };

    try {
        const credentials = await store.getAllActive();
        if (credentials.length === 0) {
            return result;
        }

        for (const cred of credentials) {
            try {
                const usageResult = await OrchidsAPI.getAccountUsage(cred.clientJwt);
                if (usageResult.success) {
                    await store.updateUsage(cred.id, usageResult.usage);
                    result.success++;

                    // Log low quota warnings
                    const usage = usageResult.usage;
                    if (usage && usage.percentage !== undefined) {
                        const remaining = 100 - usage.percentage;
                        if (remaining <= 5) {
                            console.warn(`[${getTimestamp()}] [Quota] CRITICAL: ${cred.name || cred.email} (Orchids): ${remaining}% remaining`);
                        } else if (remaining <= 20) {
                            console.log(`[${getTimestamp()}] [Quota] LOW: ${cred.name || cred.email} (Orchids): ${remaining}% remaining`);
                        }
                    }
                } else {
                    result.failed++;
                    console.error(`[${getTimestamp()}] [Quota Refresh] Orchids ${cred.name || cred.email}: ${usageResult.error}`);
                }
            } catch (error) {
                result.failed++;
                console.error(`[${getTimestamp()}] [Quota Refresh] Orchids ${cred.name || cred.email}: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CREDENTIALS));
        }
    } catch (error) {
        console.error(`[${getTimestamp()}] [Quota Refresh] Orchids task error: ${error.message}`);
    }

    return result;
}

/**
 * Refresh quotas for all Warp credentials
 * @param {Object} store - Warp credential store
 * @returns {Promise<{success: number, failed: number}>}
 */
async function refreshWarpQuotas(store) {
    const result = { success: 0, failed: 0 };

    try {
        const credentials = await store.getAllActive();
        if (credentials.length === 0) {
            return result;
        }

        const warpService = new WarpService(store);

        for (const cred of credentials) {
            try {
                const accessToken = await warpService.getValidAccessToken(cred);
                const quota = await getRequestLimit(accessToken);

                if (!quota.error) {
                    const quotaLimit = quota.isUnlimited ? -1 : quota.requestLimit;
                    const quotaUsed = quota.requestsUsed || 0;
                    await store.updateQuota(cred.id, quotaLimit, quotaUsed);
                    result.success++;

                    // Log low quota warnings
                    if (!quota.isUnlimited && quota.requestLimit > 0) {
                        const remaining = Math.round(((quota.requestLimit - quotaUsed) / quota.requestLimit) * 100);
                        if (remaining <= 5) {
                            console.warn(`[${getTimestamp()}] [Quota] CRITICAL: ${cred.name} (Warp): ${remaining}% remaining`);
                        } else if (remaining <= 20) {
                            console.log(`[${getTimestamp()}] [Quota] LOW: ${cred.name} (Warp): ${remaining}% remaining`);
                        }
                    }
                } else {
                    result.failed++;
                    console.error(`[${getTimestamp()}] [Quota Refresh] Warp ${cred.name}: ${quota.error}`);
                }
            } catch (error) {
                result.failed++;
                console.error(`[${getTimestamp()}] [Quota Refresh] Warp ${cred.name}: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CREDENTIALS));
        }
    } catch (error) {
        console.error(`[${getTimestamp()}] [Quota Refresh] Warp task error: ${error.message}`);
    }

    return result;
}

/**
 * Refresh rate limits for all Anthropic credentials
 * Sends a minimal test message to Haiku and captures rate limit headers
 * @param {Object} store - Anthropic credential store
 * @returns {Promise<{success: number, failed: number}>}
 */
async function refreshAnthropicQuotas(store) {
    const result = { success: 0, failed: 0 };

    try {
        const credentials = await store.getActive();
        if (credentials.length === 0) {
            return result;
        }

        for (const cred of credentials) {
            try {
                const verification = await verifyAnthropicCredentials(cred.accessToken, cred.apiBaseUrl);

                if (verification.rateLimits) {
                    await store.updateRateLimits(cred.id, verification.rateLimits);
                    result.success++;

                    // Log low quota warnings for OAuth unified limits
                    const limits = verification.rateLimits;
                    if (limits.unified5h?.utilization !== null && limits.unified5h?.utilization !== undefined) {
                        const remaining = Math.round((1 - limits.unified5h.utilization) * 100);
                        if (remaining <= 5) {
                            console.warn(`[${getTimestamp()}] [Quota] CRITICAL: ${cred.name} (Anthropic 5h): ${remaining}% remaining`);
                        } else if (remaining <= 20) {
                            console.log(`[${getTimestamp()}] [Quota] LOW: ${cred.name} (Anthropic 5h): ${remaining}% remaining`);
                        }
                    }
                } else if (!verification.valid) {
                    result.failed++;
                    console.error(`[${getTimestamp()}] [Quota Refresh] Anthropic ${cred.name}: ${verification.error}`);
                } else {
                    // Valid but no rate limits returned
                    result.success++;
                }
            } catch (error) {
                result.failed++;
                console.error(`[${getTimestamp()}] [Quota Refresh] Anthropic ${cred.name}: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CREDENTIALS));
        }
    } catch (error) {
        console.error(`[${getTimestamp()}] [Quota Refresh] Anthropic task error: ${error.message}`);
    }

    return result;
}

/**
 * Refresh quotas for all vendors
 * @param {Object} stores - Object containing all vendor stores
 * @returns {Promise<void>}
 */
async function refreshAllQuotas(stores) {
    const results = {
        kiro: { success: 0, failed: 0 },
        gemini: { success: 0, failed: 0 },
        orchids: { success: 0, failed: 0 },
        warp: { success: 0, failed: 0 },
        anthropic: { success: 0, failed: 0 }
    };

    // Kiro
    if (stores.kiro) {
        results.kiro = await refreshKiroQuotas(stores.kiro);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VENDORS));
    }

    // Gemini
    if (stores.gemini) {
        results.gemini = await refreshGeminiQuotas(stores.gemini);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VENDORS));
    }

    // Orchids
    if (stores.orchids) {
        results.orchids = await refreshOrchidsQuotas(stores.orchids);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VENDORS));
    }

    // Warp
    if (stores.warp) {
        results.warp = await refreshWarpQuotas(stores.warp);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VENDORS));
    }

    // Anthropic
    if (stores.anthropic) {
        results.anthropic = await refreshAnthropicQuotas(stores.anthropic);
    }

    // Log summary
    const hasActivity = Object.values(results).some(r => r.success > 0 || r.failed > 0);
    if (hasActivity) {
        const summary = Object.entries(results)
            .filter(([, r]) => r.success > 0 || r.failed > 0)
            .map(([vendor, r]) => `${vendor.charAt(0).toUpperCase() + vendor.slice(1)}(${r.success}/${r.success + r.failed})`)
            .join(' ');
        console.log(`[${getTimestamp()}] [Quota Refresh] Complete: ${summary}`);
    }
}

/**
 * Start the unified quota refresh task
 * @param {Object} stores - Object containing all vendor stores { kiro, gemini, orchids, warp }
 */
export function startUnifiedQuotaRefreshTask(stores) {
    console.log(`[${getTimestamp()}] [Quota Refresh] Unified task started, interval: ${QUOTA_REFRESH_INTERVAL / 60000} minutes`);

    // Execute initial refresh after INITIAL_DELAY
    setTimeout(async () => {
        await refreshAllQuotas(stores);
    }, INITIAL_DELAY);

    // Execute on schedule
    setInterval(async () => {
        await refreshAllQuotas(stores);
    }, QUOTA_REFRESH_INTERVAL);
}

export {
    refreshKiroQuotas,
    refreshGeminiQuotas,
    refreshOrchidsQuotas,
    refreshWarpQuotas,
    refreshAnthropicQuotas,
    refreshAllQuotas
};
