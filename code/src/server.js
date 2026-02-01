import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { CredentialStore, UserStore, ApiKeyStore, ApiLogStore, GeminiCredentialStore, OrchidsCredentialStore, WarpCredentialStore, SiteSettingsStore, VertexCredentialStore, BedrockCredentialStore, ModelPricingStore, AnthropicCredentialStore, AccountHealthStore, TokenBucketStore, SelectionConfigStore, ThinkingSignatureCacheStore, SessionStore, ModelAliasStore, initDatabase } from './db.js';
import { StrategyFactory, getStrategyManager, ThinkingBlocksParser } from './selection/index.js';
import { KiroClient } from './kiro/client.js';
import { KiroService } from './kiro/kiro-service.js';
import { KiroAPI } from './kiro/api.js';
import { KiroAuth, generateCodeVerifier, generateCodeChallenge, generateSocialAuthUrl, exchangeSocialAuthCode } from './kiro/auth.js';
import { OrchidsAPI } from './orchids/orchids-service.js';
import { OrchidsChatService, ORCHIDS_MODELS } from './orchids/orchids-chat-service.js';
import { setupOrchidsRoutes } from './orchids/orchids-routes.js';
import { OrchidsLoadBalancer, getOrchidsLoadBalancer, closeOrchidsLoadBalancer } from './orchids/orchids-loadbalancer.js';
import { WarpService, WARP_MODELS, refreshAccessToken, isTokenExpired, getEmailFromToken, parseJwtToken } from './warp/warp-service.js';
import { setupWarpRoutes } from './warp/warp-routes.js';
import { setupWarpMultiAgentRoutes } from './warp/warp-multi-agent.js';
import { setupWarpProxyRoutes } from './warp/warp-proxy.js';
import { KIRO_CONSTANTS, MODEL_MAPPING, KIRO_MODELS, MODEL_PRICING, calculateTokenCost, setDynamicPricing, initializeRemotePricing, getPricingInfo, setRemotePricingStore, SELECTION_CONFIG } from './constants.js';
import {
    AntigravityApiService,
    GEMINI_MODELS,
    refreshGeminiToken,
    claudeToGeminiMessages,
    geminiToClaudeResponse,
    generateAuthUrl as generateGeminiAuthUrl,
    getTokenFromCode as getGeminiTokenFromCode,
    startOAuthFlow as startGeminiOAuthFlow
} from './gemini/antigravity-core.js';
import { setupGeminiRoutes } from './gemini/gemini-routes.js';
import { setupVertexRoutes } from './vertex/vertex-routes.js';
import bedrockRoutes from './bedrock/bedrock-routes.js';
import { ANTHROPIC_MODELS, isAnthropicModel, sendMessage as sendAnthropicMessage, sendMessageStream as sendAnthropicMessageStream, verifyCredentials as verifyAnthropicCredentials } from './anthropic/index.js';
import { startUnifiedQuotaRefreshTask } from './quota-refresh.js';
import { updateLoggerSettings } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Format date as local time string (YYYY-MM-DD HH:mm:ss)
function formatLocalDateTime(date) {
    if (!date) return null;
    const d = new Date(date);
    // Convert to Beijing time (UTC+8)
    const beijingOffset = 8 * 60; // Beijing time offset in minutes
    const utcTime = d.getTime() + d.getTimezoneOffset() * 60 * 1000;
    const beijingTime = new Date(utcTime + beijingOffset * 60 * 1000);

    const year = beijingTime.getFullYear();
    const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getDate()).padStart(2, '0');
    const hours = String(beijingTime.getHours()).padStart(2, '0');
    const minutes = String(beijingTime.getMinutes()).padStart(2, '0');
    const seconds = String(beijingTime.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Homepage - redirect to usage query page (must be before static file middleware)
app.get('/', (req, res) => {
    res.redirect('/pages/usage-query.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// Trust proxy to correctly get client IP
app.set('trust proxy', true);

// ============ CORS Configuration ============

// CORS middleware
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Model-Provider, anthropic-version');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

let store = null;
let userStore = null;
let apiKeyStore = null;
let apiLogStore = null;
let geminiStore = null;
let orchidsStore = null;
let orchidsLoadBalancer = null;
let warpStore = null;
let warpService = null;
let siteSettingsStore = null;
let pricingStore = null;
let anthropicStore = null;

// Selection module stores
let accountHealthStore = null;
let tokenBucketStore = null;
let selectionConfigStore = null;
let thinkingSignatureCacheStore = null;
let sessionStore = null;
let thinkingBlocksParser = null;
let modelAliasStore = null;

// Credential 403 error counter
const credential403Counter = new Map();

// API key + IP concurrent request tracker (key: `${apiKeyId}:${ip}`)
const apiKeyIpConcurrentRequests = new Map();

// API key rate limit tracker (requests per minute)
const apiKeyRateLimiter = new Map();

// ============ Credential Health Status Management (Reference: AIClient-2-API) ============
// Credential health status: { isHealthy, errorCount, lastErrorTime, lastErrorMessage, lastUsed, usageCount }
const credentialHealthStatus = new Map();

// Health status configuration
const CREDENTIAL_HEALTH_CONFIG = {
    maxErrorCount: 3,           // Mark as unhealthy when consecutive errors reach this value
    recoveryTimeMs: 5 * 60 * 1000,  // Try recovery after 5 minutes
    healthCheckIntervalMs: 10 * 60 * 1000  // 10 minute health check interval
};

/**
 * Get credential health status
 */
function getCredentialHealth(credentialId) {
    if (!credentialHealthStatus.has(credentialId)) {
        credentialHealthStatus.set(credentialId, {
            isHealthy: true,
            errorCount: 0,
            lastErrorTime: null,
            lastErrorMessage: null,
            lastUsed: null,
            usageCount: 0
        });
    }
    return credentialHealthStatus.get(credentialId);
}

/**
 * Mark credential as healthy
 */
function markCredentialHealthy(credentialId) {
    const health = getCredentialHealth(credentialId);
    health.isHealthy = true;
    health.errorCount = 0;
    health.lastErrorTime = null;
    health.lastErrorMessage = null;
}

/**
 * Mark credential as unhealthy
 */
function markCredentialUnhealthy(credentialId, errorMessage) {
    const health = getCredentialHealth(credentialId);
    health.errorCount++;
    health.lastErrorTime = Date.now();
    health.lastErrorMessage = errorMessage;

    if (health.errorCount >= CREDENTIAL_HEALTH_CONFIG.maxErrorCount) {
        health.isHealthy = false;
        // console.log(`[${getTimestamp()}] [Credential Health] Credential ${credentialId} marked as unhealthy (${health.errorCount} consecutive errors)`);
    }
}

/**
 * Update credential usage record (for LRU selection)
 */
function updateCredentialUsage(credentialId) {
    const health = getCredentialHealth(credentialId);
    health.lastUsed = Date.now();
    health.usageCount++;
}

/**
 * Check if credential can attempt recovery
 */
function canAttemptRecovery(credentialId) {
    const health = getCredentialHealth(credentialId);
    if (health.isHealthy) return true;
    if (!health.lastErrorTime) return true;

    const timeSinceError = Date.now() - health.lastErrorTime;
    return timeSinceError >= CREDENTIAL_HEALTH_CONFIG.recoveryTimeMs;
}

// ============ Credential Token Refresh Lock ============
// Prevent concurrent token refresh for the same credential
// Single source of truth for refresh operations - using promises map only
const credentialRefreshPromises = new Map();

/**
 * Token refresh with lock, ensuring only one refresh operation at a time for the same credential
 * Uses promise-based locking to prevent race conditions
 * @returns {Promise<{success: boolean, credential?: object, error?: string}>}
 */
async function refreshTokenWithLock(credential, store) {
    const credentialId = credential.id;

    // Check if refresh is already in progress - single atomic check
    const existingPromise = credentialRefreshPromises.get(credentialId);
    if (existingPromise) {
        // console.log(`[${getTimestamp()}] [Token Refresh] Credential ${credentialId} is refreshing, waiting...`);
        return existingPromise;
    }

    // Create refresh Promise and store it immediately (before any async operations)
    // This prevents race condition where two calls could both pass the check above
    const refreshPromise = (async () => {
        try {
            const refreshResult = await KiroAPI.refreshToken(credential);
            if (refreshResult.success) {
                await store.update(credentialId, {
                    accessToken: refreshResult.accessToken,
                    refreshToken: refreshResult.refreshToken,
                    expiresAt: refreshResult.expiresAt
                });
                const updatedCredential = await store.getById(credentialId);
                // console.log(`[${getTimestamp()}] [Token Refresh] Credential ${credentialId} refresh succeeded`);
                return { success: true, credential: updatedCredential };
            } else {
                // console.log(`[${getTimestamp()}] [Token Refresh] Credential ${credentialId} refresh failed: ${refreshResult.error}`);
                return { success: false, error: refreshResult.error };
            }
        } catch (error) {
            // console.log(`[${getTimestamp()}] [Token Refresh] Credential ${credentialId} refresh exception: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            // Release lock by removing promise
            credentialRefreshPromises.delete(credentialId);
        }
    })();

    // Store promise immediately after creation (synchronous operation)
    credentialRefreshPromises.set(credentialId, refreshPromise);
    return refreshPromise;
}

// ============ Credential-Level Concurrency Control ============
// Each credential allows max 1 concurrent request, subsequent requests queue and execute serially

// Credential lock state: true means in use
const credentialLocks = new Map();

// Credential request queue: one queue per credential
const credentialQueues = new Map();

// Dynamic system settings (loaded from DB, initialized from env)
let systemSettings = {
    disableCredentialLock: process.env.DISABLE_CREDENTIAL_LOCK === 'true',
    warpDebug: process.env.WARP_DEBUG === 'true',
    orchidsDebug: process.env.ORCHIDS_DEBUG === 'true',
    tokenRefreshInterval: 30,   // minutes
    tokenRefreshThreshold: 10,  // minutes
    quotaRefreshInterval: 5,    // minutes
    selectionStrategy: 'hybrid', // hybrid, sticky, round-robin
    defaultProvider: 'kiro',
    enabledProviders: ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'],
    providerPriority: ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock']
};

// Check if credential lock is disabled (dynamic)
function isCredentialLockDisabled() {
    return systemSettings.disableCredentialLock;
}

// Get token refresh settings (dynamic)
function getTokenRefreshInterval() {
    return systemSettings.tokenRefreshInterval * 60 * 1000; // convert to ms
}

function getTokenRefreshThreshold() {
    return systemSettings.tokenRefreshThreshold;
}

// Get quota refresh interval (dynamic)
function getQuotaRefreshInterval() {
    return systemSettings.quotaRefreshInterval * 60 * 1000; // convert to ms
}

// Get selection strategy (dynamic)
function getSelectionStrategy() {
    return systemSettings.selectionStrategy;
}

// Check if provider is enabled
function isProviderEnabled(provider) {
    return systemSettings.enabledProviders.includes(provider);
}

// Get provider based on header or default settings (header-only routing)
function getProviderForModel(model, headerProvider) {
    // 1. If header explicitly specifies a provider, use it (if enabled)
    if (headerProvider) {
        const normalizedHeader = headerProvider.toLowerCase();
        if (isProviderEnabled(normalizedHeader)) {
            return normalizedHeader;
        }
    }

    // 2. Return default provider if enabled
    if (isProviderEnabled(systemSettings.defaultProvider)) {
        return systemSettings.defaultProvider;
    }

    // 3. Fallback to first enabled provider
    return systemSettings.enabledProviders[0] || 'kiro';
}

// Model alias cache (refreshed periodically)
let modelAliasCache = {};
let modelAliasCacheTime = 0;
const MODEL_ALIAS_CACHE_TTL = 60000; // 1 minute

/**
 * Load model aliases from database into cache
 */
async function refreshModelAliasCache() {
    try {
        if (!modelAliasStore) return;
        modelAliasCache = await modelAliasStore.getAliasMap();
        modelAliasCacheTime = Date.now();
    } catch (error) {
        console.error(`[${getTimestamp()}] [ModelAlias] Failed to refresh cache: ${error.message}`);
    }
}

/**
 * Resolve model alias to actual model name
 * Priority: Database aliases > Hardcoded mappings > Original model name
 * @param {string} model - Input model name
 * @param {string} provider - Target provider (optional, for provider-specific aliases)
 * @returns {string} Resolved model name
 */
async function resolveModelAlias(model, provider = null) {
    if (!model) return model;

    // Refresh cache if stale
    if (Date.now() - modelAliasCacheTime > MODEL_ALIAS_CACHE_TTL) {
        await refreshModelAliasCache();
    }

    // 1. Check database aliases (provider-specific first, then global)
    if (provider && modelAliasCache[provider] && modelAliasCache[provider][model]) {
        return modelAliasCache[provider][model];
    }

    // Check all providers for this alias
    for (const [p, aliases] of Object.entries(modelAliasCache)) {
        if (aliases[model]) {
            return aliases[model];
        }
    }

    // 2. Return original model name (hardcoded mappings are handled in each provider's service)
    return model;
}

/**
 * Load and apply system settings from database
 */
async function loadSystemSettings() {
    try {
        const settings = await siteSettingsStore.get();

        // Apply to systemSettings
        systemSettings.disableCredentialLock = settings.disableCredentialLock;
        systemSettings.warpDebug = settings.warpDebug;
        systemSettings.orchidsDebug = settings.orchidsDebug;
        systemSettings.tokenRefreshInterval = settings.tokenRefreshInterval || 30;
        systemSettings.tokenRefreshThreshold = settings.tokenRefreshThreshold || 10;
        systemSettings.quotaRefreshInterval = settings.quotaRefreshInterval || 5;
        systemSettings.selectionStrategy = settings.selectionStrategy || 'hybrid';
        systemSettings.defaultProvider = settings.defaultProvider || 'kiro';
        systemSettings.enabledProviders = settings.enabledProviders || ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'];
        systemSettings.providerPriority = settings.providerPriority || ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'];

        // Apply to logger
        updateLoggerSettings({
            logLevel: settings.logLevel,
            logEnabled: settings.logEnabled,
            logConsole: settings.logConsole
        });

        console.log(`[${getTimestamp()}] [Settings] Loaded from DB: strategy=${settings.selectionStrategy}, defaultProvider=${settings.defaultProvider}, quotaRefresh=${settings.quotaRefreshInterval}min`);
    } catch (error) {
        console.error(`[${getTimestamp()}] [Settings] Failed to load from DB: ${error.message}`);
    }
}

/**
 * Get the request queue for a credential
 */
function getCredentialQueue(credentialId) {
    if (!credentialQueues.has(credentialId)) {
        credentialQueues.set(credentialId, []);
    }
    return credentialQueues.get(credentialId);
}

/**
 * Acquire credential lock
 * @returns {Promise} Resolves when lock is acquired
 */
function acquireCredentialLock(credentialId) {
    return new Promise((resolve) => {
        // If credential lock is disabled, proceed immediately
        if (isCredentialLockDisabled()) {
            resolve();
            return;
        }
        
        if (!credentialLocks.get(credentialId)) {
            // Credential is idle, acquire lock immediately
            credentialLocks.set(credentialId, true);
            resolve();
        } else {
            // Credential in use, add to queue and wait
            const queue = getCredentialQueue(credentialId);
            queue.push(resolve);
            // console.log(`[${getTimestamp()}] [Credential Queue] Credential ${credentialId} in use, request queued (queue length: ${queue.length})`);
        }
    });
}

/**
 * Release credential lock
 */
function releaseCredentialLock(credentialId) {
    // If credential lock is disabled, return immediately
    if (isCredentialLockDisabled()) {
        return;
    }
    
    const queue = getCredentialQueue(credentialId);
    if (queue.length > 0) {
        // Queue has waiting requests, process the next one
        const nextResolve = queue.shift();
        // console.log(`[${getTimestamp()}] [Credential Queue] Credential ${credentialId} processing next queued request (remaining queue: ${queue.length})`);
        nextResolve();
    } else {
        // No waiting requests, release lock
        credentialLocks.set(credentialId, false);
    }
}

/**
 * Get current credential status
 */
function getCredentialQueueStatus(credentialId) {
    const isLocked = credentialLocks.get(credentialId) || false;
    const queueLength = getCredentialQueue(credentialId).length;
    return { isLocked, queueLength };
}

/**
 * Advanced credential selection using configurable strategies
 * Supports health tracking, token bucket rate limiting, and quota-aware selection
 * @param {Array} credentials - Credential list
 * @param {Array} excludeIds - Credential IDs to exclude (for fallback)
 * @param {Object} context - Selection context (provider, model, etc.)
 * @returns {Promise<Object|null>} Selected credential
 */
async function selectBestCredential(credentials, excludeIds = [], context = {}) {
    if (!credentials || credentials.length === 0) return null;

    try {
        const strategyManager = getStrategyManager();
        const provider = context.provider || 'kiro';
        const strategy = await strategyManager.getStrategy(provider);

        const result = await strategy.select(credentials, {
            ...context,
            provider,
            excludeIds
        });

        if (result.credential) {
            // Update in-memory health tracking for backwards compatibility
            updateCredentialUsage(result.credential.id);
        }

        return result.credential;
    } catch (error) {
        // Fallback to legacy selection on error
        console.log(`[${getTimestamp()}] [Selection] Strategy error, falling back to legacy: ${error.message}`);
        return selectBestCredentialLegacy(credentials, excludeIds);
    }
}

/**
 * Legacy LRU credential selection (fallback)
 * Priority: healthy > recoverable > idle > least recently used > shortest queue
 * @param {Array} credentials - Credential list
 * @param {Array} excludeIds - Credential IDs to exclude (for fallback)
 * @returns {Object|null} Selected credential
 */
function selectBestCredentialLegacy(credentials, excludeIds = []) {
    if (credentials.length === 0) return null;

    // Filter out excluded credentials
    let availableCredentials = credentials.filter(c => !excludeIds.includes(c.id));
    if (availableCredentials.length === 0) {
        // If all credentials are excluded, use the original list
        availableCredentials = credentials;
    }

    if (availableCredentials.length === 1) return availableCredentials[0];

    // Get comprehensive status for each credential
    const credentialsWithStatus = availableCredentials.map(c => {
        const health = getCredentialHealth(c.id);
        const queueStatus = getCredentialQueueStatus(c.id);
        return {
            credential: c,
            isHealthy: health.isHealthy,
            canRecover: canAttemptRecovery(c.id),
            errorCount: health.errorCount,
            lastUsed: health.lastUsed || 0,
            usageCount: health.usageCount || 0,
            isLocked: queueStatus.isLocked,
            queueLength: queueStatus.queueLength
        };
    });

    // Separate healthy and unhealthy credentials
    const healthyCredentials = credentialsWithStatus.filter(c => c.isHealthy);
    const recoverableCredentials = credentialsWithStatus.filter(c => !c.isHealthy && c.canRecover);

    // Prefer healthy credentials, then recoverable ones
    let candidates = healthyCredentials.length > 0 ? healthyCredentials : recoverableCredentials;
    if (candidates.length === 0) {
        // If no healthy or recoverable credentials, use all credentials
        candidates = credentialsWithStatus;
    }

    // LRU sorting: prefer idle ones, then least recently used
    candidates.sort((a, b) => {
        // 1. Prefer unlocked (idle) ones
        if (!a.isLocked && b.isLocked) return -1;
        if (a.isLocked && !b.isLocked) return 1;

        // 2. If all idle or all locked, select least recently used (LRU)
        if (a.lastUsed !== b.lastUsed) {
            return a.lastUsed - b.lastUsed;  // Smaller timestamp (used earlier) comes first
        }

        // 3. If last used time is the same, select the one with fewer usage count
        if (a.usageCount !== b.usageCount) {
            return a.usageCount - b.usageCount;
        }

        // 4. If all locked, select the one with shortest queue
        return a.queueLength - b.queueLength;
    });

    return candidates[0].credential;
}

/**
 * Record credential selection success (updates health tracking)
 * @param {string} provider - Provider name
 * @param {number} credentialId - Credential ID
 */
async function recordSelectionSuccess(provider, credentialId) {
    try {
        const strategyManager = getStrategyManager();
        const strategy = await strategyManager.getStrategy(provider);
        await strategy.onSuccess(provider, credentialId);

        // Also update legacy tracking
        markCredentialHealthy(credentialId);
    } catch (error) {
        // Silently ignore errors in success tracking
    }
}

/**
 * Record credential selection failure (updates health tracking)
 * @param {string} provider - Provider name
 * @param {number} credentialId - Credential ID
 * @param {string} errorType - Error type
 */
async function recordSelectionFailure(provider, credentialId, errorType) {
    try {
        const strategyManager = getStrategyManager();
        const strategy = await strategyManager.getStrategy(provider);
        await strategy.onFailure(provider, credentialId, errorType);

        // Also update legacy tracking
        markCredentialUnhealthy(credentialId, errorType);
    } catch (error) {
        // Silently ignore errors in failure tracking
    }
}

/**
 * Record rate limit for credential (updates health tracking)
 * @param {string} provider - Provider name
 * @param {number} credentialId - Credential ID
 * @param {number} resetMs - Time until rate limit resets
 */
async function recordSelectionRateLimit(provider, credentialId, resetMs = 0) {
    try {
        const strategyManager = getStrategyManager();
        const strategy = await strategyManager.getStrategy(provider);
        await strategy.onRateLimit(provider, credentialId, resetMs);

        // Also update legacy tracking
        markCredentialUnhealthy(credentialId, 'rate_limit');
    } catch (error) {
        // Silently ignore errors in rate limit tracking
    }
}

/**
 * Generate combined key of API Key + IP
 */
function getConcurrentKey(apiKeyId, clientIp) {
    return `${apiKeyId}:${clientIp || 'unknown'}`;
}

/**
 * Try to acquire concurrent slot (atomic operation: check + increment)
 * @returns {Object} { success: boolean, current: number }
 */
function tryAcquireConcurrentSlot(apiKeyId, clientIp, limit) {
    const key = getConcurrentKey(apiKeyId, clientIp);
    const current = apiKeyIpConcurrentRequests.get(key) || 0;
    if (limit > 0 && current >= limit) {
        return { success: false, current };
    }
    apiKeyIpConcurrentRequests.set(key, current + 1);
    return { success: true, current: current + 1 };
}

/**
 * Increment concurrent count for API Key + IP
 */
function incrementConcurrent(apiKeyId, clientIp) {
    const key = getConcurrentKey(apiKeyId, clientIp);
    const current = apiKeyIpConcurrentRequests.get(key) || 0;
    apiKeyIpConcurrentRequests.set(key, current + 1);
    return current + 1;
}

/**
 * Decrement concurrent count for API Key + IP
 */
function decrementConcurrent(apiKeyId, clientIp) {
    const key = getConcurrentKey(apiKeyId, clientIp);
    const current = apiKeyIpConcurrentRequests.get(key) || 0;
    if (current > 0) {
        apiKeyIpConcurrentRequests.set(key, current - 1);
    }
}

/**
 * Get current concurrent count for API Key + IP
 */
function getConcurrentCount(apiKeyId, clientIp) {
    const key = getConcurrentKey(apiKeyId, clientIp);
    return apiKeyIpConcurrentRequests.get(key) || 0;
}

/**
 * Get total concurrent count for API Key (sum of all IPs)
 */
function getTotalConcurrentCount(apiKeyId) {
    let total = 0;
    const prefix = `${apiKeyId}:`;
    for (const [key, count] of apiKeyIpConcurrentRequests.entries()) {
        if (key.startsWith(prefix)) {
            total += count;
        }
    }
    return total;
}

/**
 * Check and record rate limit
 * @returns {boolean} true if within limit, false if exceeded
 */
function checkRateLimit(apiKeyId, rateLimit) {
    if (!rateLimit || rateLimit <= 0) return true;

    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    let requests = apiKeyRateLimiter.get(apiKeyId) || [];
    // Clean up expired request records
    requests = requests.filter(timestamp => timestamp > windowStart);

    if (requests.length >= rateLimit) {
        apiKeyRateLimiter.set(apiKeyId, requests);
        return false;
    }

    requests.push(now);
    apiKeyRateLimiter.set(apiKeyId, requests);
    return true;
}

/**
 * Check API key usage limits
 * @param {Object} keyRecord - API key record
 * @param {string} clientIp - Client IP address
 * @returns {Object} { allowed: boolean, reason?: string }
 */
async function checkUsageLimits(keyRecord, clientIp) {
    const { id, dailyLimit, monthlyLimit, totalLimit, concurrentLimit, rateLimit, dailyCostLimit, monthlyCostLimit, totalCostLimit, expiresInDays, createdAt } = keyRecord;

    // Check validity period
    if (expiresInDays > 0 && createdAt) {
        // createdAt is a Beijing time string stored in database "YYYY-MM-DD HH:mm:ss"
        // Parse as Beijing time (UTC+8)
        const createDateStr = createdAt.replace(' ', 'T') + '+08:00';
        const createDate = new Date(createDateStr);
        const expireDate = new Date(createDate.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
        const now = new Date();
        // console.log(`[API Key Expiry Check] createdAt: ${createdAt}, createDate: ${createDate.toISOString()}, expireDate: ${expireDate.toISOString()}, now: ${now.toISOString()}, expired: ${now > expireDate}`);
        if (now > expireDate) {
            return { allowed: false, reason: `Key expired (validity period ${expiresInDays} days)` };
        }
    }

    // Check concurrent limit (based on API Key + IP) - using atomic operation
    if (concurrentLimit > 0) {
        const result = tryAcquireConcurrentSlot(id, clientIp, concurrentLimit);
        // console.log(`[${getTimestamp()}] [Concurrent Check] API Key ${id} | IP: ${clientIp} | Current: ${result.current} | Limit: ${concurrentLimit} | Result: ${result.success ? 'Pass' : 'Reject'}`);
        if (!result.success) {
            return { allowed: false, reason: `Concurrent request limit reached (${concurrentLimit})`, concurrentAcquired: false };
        }
        // Mark that concurrent slot was acquired, no need to call incrementConcurrent later
        return { allowed: true, concurrentAcquired: true };
    }

    // Check rate limit
    if (rateLimit > 0 && !checkRateLimit(id, rateLimit)) {
        return { allowed: false, reason: `Rate limit exceeded (${rateLimit}/minute)` };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Check usage limits
    if (dailyLimit > 0 || monthlyLimit > 0 || totalLimit > 0) {
        // Get daily usage
        if (dailyLimit > 0) {
            const dailyStats = await apiLogStore.getStatsForApiKey(id, { startDate: todayStart });
            if (dailyStats.requestCount >= dailyLimit) {
                return { allowed: false, reason: `Daily request limit reached (${dailyLimit})` };
            }
        }

        // Get monthly usage
        if (monthlyLimit > 0) {
            const monthlyStats = await apiLogStore.getStatsForApiKey(id, { startDate: monthStart });
            if (monthlyStats.requestCount >= monthlyLimit) {
                return { allowed: false, reason: `Monthly request limit reached (${monthlyLimit})` };
            }
        }

        // Get total usage
        if (totalLimit > 0) {
            const totalStats = await apiLogStore.getStatsForApiKey(id, {});
            if (totalStats.requestCount >= totalLimit) {
                return { allowed: false, reason: `Total request limit reached (${totalLimit})` };
            }
        }
    }

    // Check cost limits
    if (dailyCostLimit > 0 || monthlyCostLimit > 0 || totalCostLimit > 0) {
        // Get daily cost
        if (dailyCostLimit > 0) {
            const dailyCost = await calculateApiKeyCost(id, { startDate: todayStart });
            if (dailyCost >= dailyCostLimit) {
                return { allowed: false, reason: `Daily cost limit reached ($${dailyCostLimit.toFixed(2)})` };
            }
        }

        // Get monthly cost
        if (monthlyCostLimit > 0) {
            const monthlyCost = await calculateApiKeyCost(id, { startDate: monthStart });
            if (monthlyCost >= monthlyCostLimit) {
                return { allowed: false, reason: `Monthly cost limit reached ($${monthlyCostLimit.toFixed(2)})` };
            }
        }

        // Get total cost
        if (totalCostLimit > 0) {
            const totalCost = await calculateApiKeyCost(id, {});
            if (totalCost >= totalCostLimit) {
                return { allowed: false, reason: `Total cost limit reached ($${totalCostLimit.toFixed(2)})` };
            }
        }
    }

    return { allowed: true };
}

/**
 * Calculate API key cost
 */
async function calculateApiKeyCost(apiKeyId, options = {}) {
    const modelStats = await apiLogStore.getStatsByModel(apiKeyId, options);
    let totalCost = 0;
    for (const stat of modelStats) {
        const cost = calculateTokenCost(stat.model, stat.inputTokens, stat.outputTokens);
        totalCost += cost.totalCost;
    }
    return totalCost;
}

/**
 * Record credential 403 error, move to error table after 2 consecutive errors
 */
async function recordCredential403Error(credentialId, errorMessage) {
    const count = (credential403Counter.get(credentialId) || 0) + 1;
    credential403Counter.set(credentialId, count);

    // console.log(`[${getTimestamp()}] [Credential Monitor] Credential ${credentialId} 403 error #${count}`);

    if (count >= 2) {
        try {
            await store.moveToError(credentialId, `${count} consecutive 403 errors: ${errorMessage}`);
            credential403Counter.delete(credentialId);
            // console.log(`[${getTimestamp()}] [Credential Monitor] Credential ${credentialId} moved to error table`);
        } catch (e) {
            console.error(`[${getTimestamp()}] [Credential Monitor] Failed to move credential: ${e.message}`);
        }
    }
}

/**
 * Clear credential 403 error count (called on successful request)
 */
function clearCredential403Counter(credentialId) {
    if (credential403Counter.has(credentialId)) {
        credential403Counter.delete(credentialId);
    }
}

// ============ Utility Functions ============

/**
 * Get client's real IP address
 */
function getClientIp(req) {
    let ip = null;

    // First try X-Forwarded-For (proxy scenario)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // X-Forwarded-For may contain multiple IPs, take the first one
        ip = forwarded.split(',')[0].trim();
    }
    // Then try X-Real-IP (Nginx and similar proxies)
    else if (req.headers['x-real-ip']) {
        ip = req.headers['x-real-ip'];
    }
    // Finally use socket connection IP
    else {
        ip = req.ip || req.socket?.remoteAddress || 'unknown';
    }

    // Handle IPv4 addresses in IPv6 format (::ffff:192.168.1.1 -> 192.168.1.1)
    if (ip && ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    return ip || 'unknown';
}

/**
 * Generate password hash using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Bcrypt hash
 */
const BCRYPT_SALT_ROUNDS = 12;

async function hashPassword(password) {
    return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Verify password against hash
 * Supports both bcrypt and legacy SHA256 hashes for backward compatibility
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @param {number} userId - User ID for hash migration
 * @returns {Promise<boolean>} - True if password matches
 */
async function verifyPassword(password, hash, userId = null) {
    // Check if it's a bcrypt hash (starts with $2b$ or $2a$)
    if (hash.startsWith('$2b$') || hash.startsWith('$2a$')) {
        return await bcrypt.compare(password, hash);
    }

    // Legacy SHA256 hash (64 hex characters)
    if (hash.length === 64 && /^[a-f0-9]+$/i.test(hash)) {
        const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
        if (sha256Hash === hash) {
            // Migrate to bcrypt if userId is provided
            if (userId && userStore) {
                const newHash = await hashPassword(password);
                await userStore.updatePassword(userId, newHash);
            }
            return true;
        }
    }

    return false;
}

/**
 * Generate API key
 * @param {string} customKey - Optional custom key
 */
function generateApiKey(customKey = null) {
    let key;
    if (customKey && customKey.trim()) {
        // Use custom key, auto-add sk- prefix if not present
        key = customKey.trim();
        if (!key.startsWith('sk-')) {
            key = 'sk-' + key;
        }
    } else {
        // Auto-generate key
        key = 'sk-' + crypto.randomBytes(32).toString('hex');
    }
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const prefix = key.substring(0, 10) + '...';
    return { key, hash, prefix };
}

/**
 * Verify API key
 */
async function verifyApiKey(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return await apiKeyStore.getByKeyHash(hash);
}

/**
 * Session management (database-backed for persistence across restarts)
 */
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Clean up expired sessions
 */
async function cleanupExpiredSessions() {
    if (!sessionStore) return;
    try {
        const cleaned = await sessionStore.cleanup();
        if (cleaned > 0) {
            console.log(`[Session] Cleaned up ${cleaned} expired sessions`);
        }
    } catch (error) {
        console.error('[Session] Cleanup error:', error.message);
    }
}

// Run cleanup periodically
setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);

async function createSession(userId, userAgent = null, ipAddress = null) {
    return await sessionStore.create(userId, userAgent, ipAddress);
}

async function getSession(token) {
    return await sessionStore.get(token);
}

async function deleteSession(token) {
    await sessionStore.delete(token);
}

/**
 * Authentication middleware
 */
async function authMiddleware(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ success: false, error: 'Not logged in' });
    }
    const session = await getSession(token);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Login expired' });
    }
    req.userId = session.userId;
    req.user = await userStore.getById(session.userId);
    next();
}

// ============ Public API Endpoints (No Authentication Required) ============

// Health check endpoint (based on AIClient-2-API)
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        provider: 'claude-kiro-oauth',
        version: '1.0.0'
    });
});

// Get client IP (for status page)
app.get('/api/client-ip', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               req.socket.remoteAddress ||
               '127.0.0.1';
    res.json({ ip });
});

// Load balancer status (single node mode)
app.get('/lb/status', (req, res) => {
    const port = process.env.PORT || 13004;
    res.json({
        balancer: { port: 13003, mode: 'single' },
        summary: { total: 1, healthy: 1, unhealthy: 0 },
        backends: [{
            host: '127.0.0.1',
            port: parseInt(port),
            healthy: true,
            reachable: true,
            latency: '1ms',
            error: null,
            lastCheck: new Date().toISOString()
        }],
        cache: { size: 0 },
        timestamp: new Date().toISOString()
    });
});

// Model list endpoint - OpenAI format (all providers)
app.get('/v1/models', (req, res) => {
    const timestamp = Math.floor(Date.now() / 1000);

    // Kiro (Claude) models
    const kiroModels = KIRO_MODELS.map(id => ({
        id,
        object: 'model',
        created: timestamp,
        owned_by: 'anthropic',
        permission: [],
        root: id,
        parent: null
    }));

    // Gemini Antigravity models
    const geminiModels = GEMINI_MODELS.map(id => ({
        id,
        object: 'model',
        created: timestamp,
        owned_by: 'google',
        permission: [],
        root: id,
        parent: null
    }));

    // Warp models
    const warpModels = WARP_MODELS.map(m => ({
        id: m.id,
        object: 'model',
        created: timestamp,
        owned_by: 'warp',
        permission: [],
        root: m.id,
        parent: null
    }));

    // Orchids models
    const orchidsModels = ORCHIDS_MODELS.map(id => ({
        id,
        object: 'model',
        created: timestamp,
        owned_by: 'orchids',
        permission: [],
        root: id,
        parent: null
    }));

    res.json({
        object: 'list',
        data: [...kiroModels, ...geminiModels, ...warpModels, ...orchidsModels]
    });
});

// ============ Authentication API ============

// Check if initialization is needed (whether users exist)
app.get('/api/auth/status', async (req, res) => {
    try {
        const hasUsers = await userStore.hasUsers();
        res.json({ success: true, data: { needsSetup: !hasUsers } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Initialize admin account
app.post('/api/auth/setup', async (req, res) => {
    try {
        if (await userStore.hasUsers()) {
            return res.status(400).json({ success: false, error: 'System already initialized' });
        }
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }
        const passwordHash = await hashPassword(password);
        const userId = await userStore.create(username, passwordHash, true);
        const userAgent = req.headers['user-agent'] || null;
        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || null;
        const token = await createSession(userId, userAgent, ipAddress);
        res.json({ success: true, data: { token, userId, username, isAdmin: true } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password are required' });
        }
        const user = await userStore.getByUsername(username);
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid username or password' });
        }
        const isValid = await verifyPassword(password, user.passwordHash, user.id);
        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Invalid username or password' });
        }
        const userAgent = req.headers['user-agent'] || null;
        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || null;
        const token = await createSession(user.id, userAgent, ipAddress);
        res.json({ success: true, data: { token, userId: user.id, username: user.username, isAdmin: user.isAdmin } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (token) {
        await deleteSession(token);
    }
    res.json({ success: true });
});

// Get current user info
app.get('/api/auth/me', authMiddleware, async (req, res) => {
    res.json({
        success: true,
        data: {
            userId: req.user.id,
            username: req.user.username,
            isAdmin: req.user.isAdmin
        }
    });
});

// Change password
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'Please provide old and new password' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
        }

        // Verify old password
        const user = await userStore.getById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User does not exist' });
        }

        const isOldPasswordValid = await verifyPassword(oldPassword, user.passwordHash);
        if (!isOldPasswordValid) {
            return res.status(400).json({ success: false, error: 'Old password is incorrect' });
        }

        // Update password
        const newPasswordHash = await hashPassword(newPassword);
        await userStore.updatePassword(req.user.id, newPasswordHash);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Site Settings API ============

// Get site settings (public interface, no login required)
app.get('/api/site-settings', async (req, res) => {
    try {
        const settings = await siteSettingsStore.get();
        res.json({ success: true, data: settings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update site settings (admin interface)
app.put('/api/site-settings', authMiddleware, async (req, res) => {
    try {
        const {
            siteName, siteLogo, siteSubtitle,
            logLevel, logEnabled, logConsole,
            disableCredentialLock, warpDebug, orchidsDebug,
            tokenRefreshInterval, tokenRefreshThreshold,
            quotaRefreshInterval, selectionStrategy
        } = req.body;

        // Validate siteLogo length
        if (siteLogo && siteLogo.length > 10) {
            return res.status(400).json({ success: false, error: 'Logo text maximum 10 characters' });
        }

        // Validate logLevel
        const validLogLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        if (logLevel && !validLogLevels.includes(logLevel.toUpperCase())) {
            return res.status(400).json({ success: false, error: 'Invalid log level' });
        }

        // Validate token refresh settings
        if (tokenRefreshInterval !== undefined && (tokenRefreshInterval < 1 || tokenRefreshInterval > 1440)) {
            return res.status(400).json({ success: false, error: 'Token refresh interval must be between 1 and 1440 minutes' });
        }
        if (tokenRefreshThreshold !== undefined && (tokenRefreshThreshold < 1 || tokenRefreshThreshold > 60)) {
            return res.status(400).json({ success: false, error: 'Token refresh threshold must be between 1 and 60 minutes' });
        }

        // Validate quota refresh interval
        if (quotaRefreshInterval !== undefined && (quotaRefreshInterval < 1 || quotaRefreshInterval > 60)) {
            return res.status(400).json({ success: false, error: 'Quota refresh interval must be between 1 and 60 minutes' });
        }

        // Validate selection strategy
        const validStrategies = ['hybrid', 'sticky', 'round-robin'];
        if (selectionStrategy && !validStrategies.includes(selectionStrategy)) {
            return res.status(400).json({ success: false, error: 'Invalid selection strategy' });
        }

        // Build update object (only include provided fields)
        const updateData = {};
        if (siteName !== undefined) updateData.siteName = siteName || 'Hermes';
        if (siteLogo !== undefined) updateData.siteLogo = siteLogo || 'H';
        if (siteSubtitle !== undefined) updateData.siteSubtitle = siteSubtitle || 'Account Manager';
        if (logLevel !== undefined) updateData.logLevel = logLevel.toUpperCase();
        if (logEnabled !== undefined) updateData.logEnabled = logEnabled;
        if (logConsole !== undefined) updateData.logConsole = logConsole;
        if (disableCredentialLock !== undefined) updateData.disableCredentialLock = disableCredentialLock;
        if (warpDebug !== undefined) updateData.warpDebug = warpDebug;
        if (orchidsDebug !== undefined) updateData.orchidsDebug = orchidsDebug;
        if (tokenRefreshInterval !== undefined) updateData.tokenRefreshInterval = tokenRefreshInterval;
        if (tokenRefreshThreshold !== undefined) updateData.tokenRefreshThreshold = tokenRefreshThreshold;
        if (quotaRefreshInterval !== undefined) updateData.quotaRefreshInterval = quotaRefreshInterval;
        if (selectionStrategy !== undefined) updateData.selectionStrategy = selectionStrategy;

        const settings = await siteSettingsStore.update(updateData);

        // Apply system settings dynamically
        systemSettings.disableCredentialLock = settings.disableCredentialLock;
        systemSettings.warpDebug = settings.warpDebug;
        systemSettings.orchidsDebug = settings.orchidsDebug;
        systemSettings.tokenRefreshInterval = settings.tokenRefreshInterval;
        systemSettings.tokenRefreshThreshold = settings.tokenRefreshThreshold;
        systemSettings.quotaRefreshInterval = settings.quotaRefreshInterval;
        systemSettings.selectionStrategy = settings.selectionStrategy;

        // Apply logger settings dynamically
        updateLoggerSettings({
            logLevel: settings.logLevel,
            logEnabled: settings.logEnabled,
            logConsole: settings.logConsole
        });

        res.json({ success: true, data: settings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Provider Settings ============

const ALL_PROVIDERS = ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'];

// Get provider settings
app.get('/api/provider-settings', authMiddleware, async (req, res) => {
    try {
        const settings = await siteSettingsStore.get();
        res.json({
            success: true,
            data: {
                defaultProvider: settings.defaultProvider,
                enabledProviders: settings.enabledProviders,
                providerPriority: settings.providerPriority
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update provider settings
app.put('/api/provider-settings', authMiddleware, async (req, res) => {
    try {
        const { defaultProvider, enabledProviders, providerPriority } = req.body;

        // Validate defaultProvider
        if (defaultProvider && !ALL_PROVIDERS.includes(defaultProvider)) {
            return res.status(400).json({ success: false, error: 'Invalid default provider' });
        }

        // Validate enabledProviders
        if (enabledProviders) {
            if (!Array.isArray(enabledProviders)) {
                return res.status(400).json({ success: false, error: 'enabledProviders must be an array' });
            }
            for (const p of enabledProviders) {
                if (!ALL_PROVIDERS.includes(p)) {
                    return res.status(400).json({ success: false, error: `Invalid provider: ${p}` });
                }
            }
        }

        // Validate providerPriority
        if (providerPriority) {
            if (!Array.isArray(providerPriority)) {
                return res.status(400).json({ success: false, error: 'providerPriority must be an array' });
            }
            for (const p of providerPriority) {
                if (!ALL_PROVIDERS.includes(p)) {
                    return res.status(400).json({ success: false, error: `Invalid provider in priority: ${p}` });
                }
            }
        }

        const updateData = {};
        if (defaultProvider !== undefined) updateData.defaultProvider = defaultProvider;
        if (enabledProviders !== undefined) updateData.enabledProviders = enabledProviders;
        if (providerPriority !== undefined) updateData.providerPriority = providerPriority;

        const settings = await siteSettingsStore.update(updateData);

        // Update system settings cache
        systemSettings.defaultProvider = settings.defaultProvider;
        systemSettings.enabledProviders = settings.enabledProviders;
        systemSettings.providerPriority = settings.providerPriority;

        res.json({
            success: true,
            data: {
                defaultProvider: settings.defaultProvider,
                enabledProviders: settings.enabledProviders,
                providerPriority: settings.providerPriority
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Model Aliases ============

const VALID_PROVIDERS = ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'];

// Get all model aliases
app.get('/api/model-aliases', authMiddleware, async (req, res) => {
    try {
        const { provider } = req.query;
        let aliases;

        if (provider) {
            aliases = await modelAliasStore.getByProvider(provider);
        } else {
            aliases = await modelAliasStore.getAll();
        }

        res.json({ success: true, data: aliases });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get alias map (for quick lookup)
app.get('/api/model-aliases/map', authMiddleware, async (req, res) => {
    try {
        const { provider } = req.query;
        const map = await modelAliasStore.getAliasMap(provider || null);
        res.json({ success: true, data: map });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new model alias
app.post('/api/model-aliases', authMiddleware, async (req, res) => {
    try {
        const { alias, provider, targetModel, description, priority } = req.body;

        if (!alias || !provider || !targetModel) {
            return res.status(400).json({ success: false, error: 'alias, provider, and targetModel are required' });
        }

        if (!VALID_PROVIDERS.includes(provider)) {
            return res.status(400).json({ success: false, error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
        }

        const id = await modelAliasStore.create({
            alias: alias.trim(),
            provider,
            targetModel: targetModel.trim(),
            description: description?.trim() || null,
            priority: priority || 0
        });

        const created = await modelAliasStore.getById(id);
        res.json({ success: true, data: created });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, error: 'This alias already exists for the specified provider' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update model alias
app.put('/api/model-aliases/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { alias, provider, targetModel, description, isActive, priority } = req.body;

        const existing = await modelAliasStore.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Alias not found' });
        }

        if (provider && !VALID_PROVIDERS.includes(provider)) {
            return res.status(400).json({ success: false, error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
        }

        await modelAliasStore.update(id, {
            alias: alias?.trim(),
            provider,
            targetModel: targetModel?.trim(),
            description: description?.trim(),
            isActive,
            priority
        });

        const updated = await modelAliasStore.getById(id);
        res.json({ success: true, data: updated });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, error: 'This alias already exists for the specified provider' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete model alias
app.delete('/api/model-aliases/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await modelAliasStore.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Alias not found' });
        }

        await modelAliasStore.delete(id);
        res.json({ success: true, message: 'Alias deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle alias active status
app.post('/api/model-aliases/:id/toggle', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await modelAliasStore.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Alias not found' });
        }

        const isActive = await modelAliasStore.toggleActive(id);
        res.json({ success: true, data: { id: parseInt(id), isActive } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bulk import aliases
app.post('/api/model-aliases/bulk', authMiddleware, async (req, res) => {
    try {
        const { aliases } = req.body;

        if (!Array.isArray(aliases) || aliases.length === 0) {
            return res.status(400).json({ success: false, error: 'aliases array is required' });
        }

        // Validate all aliases
        for (const alias of aliases) {
            if (!alias.alias || !alias.provider || !alias.targetModel) {
                return res.status(400).json({ success: false, error: 'Each alias must have alias, provider, and targetModel' });
            }
            if (!VALID_PROVIDERS.includes(alias.provider)) {
                return res.status(400).json({ success: false, error: `Invalid provider: ${alias.provider}` });
            }
        }

        const result = await modelAliasStore.bulkCreate(aliases);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ API Key Management ============

// Get current user's API key list
app.get('/api/keys', authMiddleware, async (req, res) => {
    try {
        const keys = req.user.isAdmin ? await apiKeyStore.getAll() : await apiKeyStore.getByUserId(req.userId);
        // Include keyValue for copy functionality
        const safeKeys = keys.map(k => ({
            id: k.id,
            userId: k.userId,
            username: k.username,
            name: k.name,
            keyValue: k.keyValue,
            keyPrefix: k.keyPrefix,
            isActive: k.isActive,
            lastUsedAt: k.lastUsedAt,
            createdAt: k.createdAt
        }));
        res.json({ success: true, data: safeKeys });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create API key
app.post('/api/keys', authMiddleware, async (req, res) => {
    try {
        const { name, customKey } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, error: 'Key name is required' });
        }
        const { key, hash, prefix } = generateApiKey(customKey);

        // Check if key already exists
        const existingKey = await apiKeyStore.getByKeyHash(hash);
        if (existingKey) {
            return res.status(400).json({ success: false, error: 'This key already exists' });
        }

        const id = await apiKeyStore.create(req.userId, name, key, hash, prefix);
        // Only return full key on creation
        res.json({
            success: true,
            data: {
                id,
                name,
                key, // Full key, shown only once
                keyPrefix: prefix,
                createdAt: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete API key
app.delete('/api/keys/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const keys = await apiKeyStore.getByUserId(req.userId);
        const key = keys.find(k => k.id === id);
        if (!key && !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'No permission to delete this key' });
        }
        await apiKeyStore.delete(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Disable/Enable API key
app.post('/api/keys/:id/toggle', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const keys = await apiKeyStore.getByUserId(req.userId);
        const key = keys.find(k => k.id === id);
        if (!key && !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'No permission to operate this key' });
        }
        // Get current status
        const allKeys = await apiKeyStore.getAll();
        const targetKey = allKeys.find(k => k.id === id);
        if (targetKey.isActive) {
            await apiKeyStore.disable(id);
        } else {
            await apiKeyStore.enable(id);
        }
        res.json({ success: true, data: { isActive: !targetKey.isActive } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single API key details (including limit configuration)
app.get('/api/keys/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const key = await apiKeyStore.getById(id);
        if (!key) {
            return res.status(404).json({ success: false, error: 'Key does not exist' });
        }
        // Check permissions
        if (key.userId !== req.userId && !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'No permission to view this key' });
        }
        res.json({ success: true, data: key });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update API key limit configuration
app.put('/api/keys/:id/limits', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const key = await apiKeyStore.getById(id);
        if (!key) {
            return res.status(404).json({ success: false, error: 'Key does not exist' });
        }
        // Check permissions (only admin can modify limits)
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Only administrators can modify limit settings' });
        }

        const { dailyLimit, monthlyLimit, totalLimit, concurrentLimit, rateLimit, dailyCostLimit, monthlyCostLimit, totalCostLimit, expiresInDays } = req.body;

        // Validate parameters
        const limits = {};
        if (dailyLimit !== undefined) {
            limits.dailyLimit = Math.max(0, parseInt(dailyLimit) || 0);
        }
        if (monthlyLimit !== undefined) {
            limits.monthlyLimit = Math.max(0, parseInt(monthlyLimit) || 0);
        }
        if (totalLimit !== undefined) {
            limits.totalLimit = Math.max(0, parseInt(totalLimit) || 0);
        }
        if (concurrentLimit !== undefined) {
            limits.concurrentLimit = Math.max(0, parseInt(concurrentLimit) || 0);
        }
        if (rateLimit !== undefined) {
            limits.rateLimit = Math.max(0, parseInt(rateLimit) || 0);
        }
        // Cost limits
        if (dailyCostLimit !== undefined) {
            limits.dailyCostLimit = Math.max(0, parseFloat(dailyCostLimit) || 0);
        }
        if (monthlyCostLimit !== undefined) {
            limits.monthlyCostLimit = Math.max(0, parseFloat(monthlyCostLimit) || 0);
        }
        if (totalCostLimit !== undefined) {
            limits.totalCostLimit = Math.max(0, parseFloat(totalCostLimit) || 0);
        }
        // Validity period
        if (expiresInDays !== undefined) {
            limits.expiresInDays = Math.max(0, parseInt(expiresInDays) || 0);
        }

        await apiKeyStore.updateLimits(id, limits);

        // Return updated key info
        const updatedKey = await apiKeyStore.getById(id);
        res.json({ success: true, data: updatedKey });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Renew API key (add validity days)
app.post('/api/keys/:id/renew', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const key = await apiKeyStore.getById(id);
        if (!key) {
            return res.status(404).json({ success: false, error: 'Key does not exist' });
        }
        // Check permissions (only admin can renew)
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Only administrators can renew' });
        }

        const { days } = req.body;
        if (!days || days <= 0) {
            return res.status(400).json({ success: false, error: 'Renewal days must be greater than 0' });
        }

        const result = await apiKeyStore.renew(id, parseInt(days));
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get API key current usage statistics (including limit comparison)
app.get('/api/keys/:id/limits-status', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const key = await apiKeyStore.getById(id);
        if (!key) {
            return res.status(404).json({ success: false, error: 'Key does not exist' });
        }
        // Check permissions
        if (key.userId !== req.userId && !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'No permission to view this key' });
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        // Get usage for each time period
        const dailyStats = await apiLogStore.getStatsForApiKey(id, { startDate: todayStart });
        const monthlyStats = await apiLogStore.getStatsForApiKey(id, { startDate: monthStart });
        const totalStats = await apiLogStore.getStatsForApiKey(id, {});

        // Get current concurrent count (sum of all IPs)
        const currentConcurrent = getTotalConcurrentCount(id);

        // Calculate cost
        const dailyCost = calculateApiKeyCost(id, { startDate: todayStart });
        const monthlyCost = calculateApiKeyCost(id, { startDate: monthStart });
        const totalCost = calculateApiKeyCost(id, {});

        // Calculate remaining validity days
        let remainingDays = null;
        let expireDate = null;
        if (key.expiresInDays > 0 && key.createdAt) {
            // createdAt is a Beijing time string stored in database "YYYY-MM-DD HH:mm:ss"
            // Parse as Beijing time (UTC+8)
            const createDateStr = key.createdAt.replace(' ', 'T') + '+08:00';
            const createDate = new Date(createDateStr);
            // Add days
            expireDate = new Date(createDate.getTime() + key.expiresInDays * 24 * 60 * 60 * 1000);
            remainingDays = Math.max(0, Math.ceil((expireDate - now) / (24 * 60 * 60 * 1000)));
        }

        res.json({
            success: true,
            data: {
                limits: {
                    dailyLimit: key.dailyLimit,
                    monthlyLimit: key.monthlyLimit,
                    totalLimit: key.totalLimit,
                    concurrentLimit: key.concurrentLimit,
        rateLimit: key.rateLimit,
                    dailyCostLimit: key.dailyCostLimit,
                    monthlyCostLimit: key.monthlyCostLimit,
                    totalCostLimit: key.totalCostLimit,
                    expiresInDays: key.expiresInDays
                },
                usage: {
                    daily: dailyStats.requestCount,
                    monthly: monthlyStats.requestCount,
                    total: totalStats.requestCount,
                    currentConcurrent,
                    dailyCost,
                    monthlyCost,
                    totalCost
                },
                remaining: {
                    daily: key.dailyLimit > 0 ? Math.max(0, key.dailyLimit - dailyStats.requestCount) : null,
                    monthly: key.monthlyLimit > 0 ? Math.max(0, key.monthlyLimit - monthlyStats.requestCount) : null,
                    total: key.totalLimit > 0 ? Math.max(0, key.totalLimit - totalStats.requestCount) : null,
                    concurrent: key.concurrentLimit > 0 ? Math.max(0, key.concurrentLimit - currentConcurrent) : null,
                    dailyCost: key.dailyCostLimit > 0 ? Math.max(0, key.dailyCostLimit - dailyCost) : null,
                    monthlyCost: key.monthlyCostLimit > 0 ? Math.max(0, key.monthlyCostLimit - monthlyCost) : null,
                    totalCost: key.totalCostLimit > 0 ? Math.max(0, key.totalCostLimit - totalCost) : null,
                    days: remainingDays
                },
                expireDate: formatLocalDateTime(expireDate)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ External API Forwarding (via API Key Authentication) ============

/**
 * Execute API request with fallback (based on AIClient-2-API's handleStreamRequest)
 * @param {Object} options - Request options
 * @returns {Promise<Object>} Response result
 */
async function executeWithFallback(options) {
    const {
        credentials,
        requestModel,
        requestBody,
        maxRetries = 2,  // Maximum number of credentials to try
        excludeIds = [],
        stream = false
    } = options;

    let lastError = null;
    const triedCredentialIds = [...excludeIds];

    for (let attempt = 0; attempt < maxRetries && attempt < credentials.length; attempt++) {
        // Select credential (excluding already tried ones)
        const credential = await selectBestCredential(credentials, triedCredentialIds);
        if (!credential) {
            break;
        }

        triedCredentialIds.push(credential.id);

        try {
            // Acquire credential lock
            await acquireCredentialLock(credential.id);

            // Check and refresh token
            let activeCredential = credential;
            if (credential.refreshToken && isTokenExpiringSoon(credential)) {
                // console.log(`[${getTimestamp()}] [Fallback] Credential ${credential.id} token expiring soon, refreshing first...`);
                const refreshResult = await refreshTokenWithLock(credential, store);
                if (refreshResult.success && refreshResult.credential) {
                    activeCredential = refreshResult.credential;
                }
            }

            // Update usage record
            updateCredentialUsage(credential.id);

            // Create service and execute request
            const service = new KiroService(activeCredential);

            if (stream) {
                // Streaming request - return generator
                return {
                    success: true,
                    credential: activeCredential,
                    generator: service.generateContentStream(requestModel, requestBody)
                };
            } else {
                // Non-streaming request
                const response = await service.generateContent(requestModel, requestBody);

                // Request successful, mark credential as healthy
                markCredentialHealthy(credential.id);
                releaseCredentialLock(credential.id);

                return {
                    success: true,
                    credential: activeCredential,
                    response
                };
            }
        } catch (error) {
            // Release credential lock
            releaseCredentialLock(credential.id);

            const errorStatus = error.status || error.response?.status;
            lastError = error;

            // console.log(`[${getTimestamp()}] [Fallback] Credential ${credential.id} request failed (${errorStatus}): ${error.message}`);

            // Decide whether to mark as unhealthy based on error type
            if (errorStatus === 401 || errorStatus === 403) {
                // Authentication error - mark as unhealthy, try next credential
                markCredentialUnhealthy(credential.id, error.message);
                // console.log(`[${getTimestamp()}] [Fallback] Trying next credential... (tried ${attempt + 1}/${maxRetries})`);
                continue;
            } else if (errorStatus === 429) {
                // Rate limit - mark as unhealthy, try next credential
                markCredentialUnhealthy(credential.id, 'Rate limited');
                // console.log(`[${getTimestamp()}] [Fallback] Credential ${credential.id} rate limited, trying next credential...`);
                continue;
            } else if (errorStatus >= 500) {
                // Server error - don't mark as unhealthy (may be temporary), but try next credential
                // console.log(`[${getTimestamp()}] [Fallback] Server error ${errorStatus}, trying next credential...`);
                continue;
            } else {
                // Other errors (e.g., request format error) - no retry, return error directly
                throw error;
            }
        }
    }

    // All credentials failed
    throw lastError || new Error('All credentials failed');
}

// Claude API compatible interface
app.post('/v1/messages', async (req, res) => {
    const startTime = Date.now();
    const requestId = 'req_' + Date.now() + Math.random().toString(36).substring(2, 8);
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Log data
    let logData = {
        requestId,
        ipAddress: clientIp,
        userAgent,
        method: 'POST',
        path: '/v1/messages',
        stream: false,
        inputTokens: 0,
        outputTokens: 0,
        statusCode: 200
    };

    try {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        const keyPrefix = apiKey ? apiKey.substring(0, 8) : '?';
        const reqModel = req.body?.model;
        const reqStream = req.body?.stream;

        // Print request log
        console.log(`[${getTimestamp()}] /v1/messages | ip=${clientIp} | key=${keyPrefix}*** | model=${reqModel || '?'} | stream=${Boolean(reqStream)}`);

        if (!apiKey) {
            logData.statusCode = 401;
            logData.errorMessage = 'Missing API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            console.error(`  ✗ ${Date.now() - startTime}ms | error: Missing API key`);
            return res.status(401).json({ error: { type: 'authentication_error', message: 'Missing API key' } });
        }

        const keyRecord = await verifyApiKey(apiKey);
        if (!keyRecord) {
            logData.statusCode = 401;
            logData.errorMessage = 'Invalid API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            console.error(`  ✗ ${Date.now() - startTime}ms | error: Invalid API key`);
            return res.status(401).json({ error: { type: 'authentication_error', message: 'Invalid API key' } });
        }

        // Record API key info
        logData.apiKeyId = keyRecord.id;
        logData.apiKeyPrefix = keyRecord.keyPrefix;

        // Check usage limits (including concurrent limit check, based on API Key + IP)
        const limitCheck = await checkUsageLimits(keyRecord, clientIp);
        if (!limitCheck.allowed) {
            logData.statusCode = 429;
            logData.errorMessage = limitCheck.reason;
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            console.error(`  ✗ ${Date.now() - startTime}ms | error: ${limitCheck.reason}`);
            return res.status(429).json({ error: { type: 'rate_limit_error', message: limitCheck.reason } });
        }

        // If concurrent slot wasn't acquired during limit check, manually increment concurrent count
        if (!limitCheck.concurrentAcquired) {
            incrementConcurrent(keyRecord.id, clientIp);
        }

        // Update last used time
        await apiKeyStore.updateLastUsed(keyRecord.id);

        // ============ Model-Provider Routing Support (based on AIClient-2-API) ============
        // Specify provider via Model-Provider header or model name prefix
        const modelProvider = req.headers['model-provider'] || req.headers['x-model-provider'] || '';
        const { model } = req.body;

        // Check if routing to Gemini is needed
        const isGeminiProvider = modelProvider.toLowerCase() === 'gemini' ||
                                 modelProvider.toLowerCase() === 'gemini-antigravity' ||
                                 (model && model.toLowerCase().startsWith('gemini'));

        if (isGeminiProvider) {
            // Route to Gemini Antigravity handler
            // console.log(`[${getTimestamp()}] [API] Request ${requestId} routed to Gemini Provider | Model: ${model}`);
            logData.path = '/v1/messages (gemini)';

            // Release concurrent slot (Gemini handler will re-acquire)
            decrementConcurrent(keyRecord.id, clientIp);

            // Call Gemini handler
            return handleGeminiAntigravityRequest(req, res);
        }

        // Check if routing to Orchids is needed
        const isOrchidsProvider = modelProvider.toLowerCase() === 'orchids' ||
                                  (model && ORCHIDS_MODELS.includes(model));
        
        // Detailed routing log
        console.log(`[${getTimestamp()}] [Routing] model=${model || 'none'} | provider=${modelProvider || 'none'} | isOrchids=${isOrchidsProvider} | ORCHIDS_MODELS=${ORCHIDS_MODELS.join(',')}`);

        if (isOrchidsProvider) {
            // Route to Orchids handler
            console.log(`[${getTimestamp()}] [API] Request routed to Orchids Provider | Model: ${model}`);
            logData.path = '/v1/messages (orchids)';

            const { messages, max_tokens, stream, system } = req.body;

            // Use load balancer to get Orchids credential (with locking mechanism)
            let orchidsCredential = null;
            if (orchidsLoadBalancer) {
                orchidsCredential = await orchidsLoadBalancer.getNextAccountExcluding([]);
            }
            
            // Fallback: if load balancer not initialized, use traditional method
            if (!orchidsCredential) {
                const orchidsCredentials = await orchidsStore.getAll();
                if (orchidsCredentials.length === 0) {
                    decrementConcurrent(keyRecord.id, clientIp);
                    logData.statusCode = 503;
                    logData.errorMessage = 'No available Orchids credentials';
                    await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                    return res.status(503).json({ error: { type: 'service_error', message: 'No available Orchids credentials' } });
                }
                orchidsCredential = orchidsCredentials.find(c => c.isActive) || orchidsCredentials[0];
            }
            
            console.log(`[${getTimestamp()}] [Orchids] /v1/messages Using account: ${orchidsCredential.name} (${orchidsCredential.email || 'N/A'})`);
            logData.credentialId = orchidsCredential.id;
            logData.credentialName = orchidsCredential.name;
            logData.model = model || 'claude-sonnet-4-5';
            logData.stream = !!stream;

            try {
                const orchidsService = new OrchidsChatService(orchidsCredential);
                const requestBody = { messages, system, max_tokens };

                if (stream) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    res.setHeader('X-Accel-Buffering', 'no');

                    let outputTokens = 0;
                    try {
                        for await (const event of orchidsService.generateContentStream(model, requestBody)) {
                            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                            if (event.usage?.output_tokens) {
                                outputTokens = event.usage.output_tokens;
                            }
                        }
                        logData.outputTokens = outputTokens;
                        logData.statusCode = 200;
                        // Record success
                        if (orchidsLoadBalancer) {
                            orchidsLoadBalancer.scheduleSuccessCount(orchidsCredential.id);
                        }
                    } catch (streamError) {
                        const errorEvent = {
                            type: 'error',
                            error: { type: 'api_error', message: streamError.message }
                        };
                        res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
                        logData.statusCode = 500;
                        logData.errorMessage = streamError.message;
                        // Record failure
                        if (orchidsLoadBalancer) {
                            orchidsLoadBalancer.scheduleFailureCount(orchidsCredential.id);
                        }
                    }
                    res.end();
                } else {
                    const response = await orchidsService.generateContent(model, requestBody);
                    logData.outputTokens = response.usage?.output_tokens || 0;
                    logData.statusCode = 200;
                    res.json(response);
                    // Record success
                    if (orchidsLoadBalancer) {
                        orchidsLoadBalancer.scheduleSuccessCount(orchidsCredential.id);
                    }
                }
            } catch (error) {
                logData.statusCode = 500;
                logData.errorMessage = error.message;
                res.status(500).json({ error: { type: 'api_error', message: error.message } });
                // Record failure
                if (orchidsLoadBalancer) {
                    orchidsLoadBalancer.scheduleFailureCount(orchidsCredential.id);
                }
            } finally {
                // Release account lock
                if (orchidsLoadBalancer && orchidsCredential) {
                    orchidsLoadBalancer.unlockAccount(orchidsCredential.id);
                }
                decrementConcurrent(keyRecord.id, clientIp);
                await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            }
            return;
        }

        // ============ Check if routing to Anthropic is needed (header-only) ============
        const isAnthropicProvider = modelProvider.toLowerCase() === 'anthropic';

        if (isAnthropicProvider) {
            console.log(`[${getTimestamp()}] [API] Request routed to Anthropic Provider | Model: ${model}`);
            logData.path = '/v1/messages (anthropic)';

            const { messages, max_tokens, stream, system, tools, thinking } = req.body;

            // Get Anthropic credentials
            const anthropicCredentials = await anthropicStore.getActive();
            if (anthropicCredentials.length === 0) {
                decrementConcurrent(keyRecord.id, clientIp);
                logData.statusCode = 503;
                logData.errorMessage = 'No available Anthropic credentials';
                await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(503).json({ error: { type: 'service_error', message: 'No available Anthropic credentials' } });
            }

            // Select credential (round-robin or least-used)
            const anthropicCredential = anthropicCredentials.reduce((a, b) =>
                (a.useCount || 0) <= (b.useCount || 0) ? a : b
            );

            console.log(`[${getTimestamp()}] [Anthropic] Using account: ${anthropicCredential.name}`);
            logData.credentialId = anthropicCredential.id;
            logData.credentialName = anthropicCredential.name;
            logData.model = model || 'claude-sonnet-4-20250514';
            logData.stream = !!stream;

            // Build request body
            const anthropicRequest = {
                model: model || 'claude-sonnet-4-20250514',
                messages,
                max_tokens: max_tokens || 4096
            };
            if (system) anthropicRequest.system = system;
            if (tools) anthropicRequest.tools = tools;
            if (thinking) anthropicRequest.thinking = thinking;

            try {
                if (stream) {
                    // Streaming response
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    res.setHeader('X-Accel-Buffering', 'no');

                    let outputTokens = 0;
                    try {
                        for await (const event of sendAnthropicMessageStream(anthropicRequest, anthropicCredential)) {
                            if (event.type === 'rate_limits') {
                                // Update rate limits in DB
                                if (event.rateLimits) {
                                    await anthropicStore.updateRateLimits(anthropicCredential.id, event.rateLimits);
                                }
                                continue;
                            }
                            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                            if (event.type === 'message_delta' && event.usage?.output_tokens) {
                                outputTokens = event.usage.output_tokens;
                            }
                        }
                        logData.outputTokens = outputTokens;
                        logData.statusCode = 200;
                        await anthropicStore.recordUsage(anthropicCredential.id);
                    } catch (streamError) {
                        console.error(`[${getTimestamp()}] [Anthropic] Stream error:`, streamError.message);
                        const errorEvent = {
                            type: 'error',
                            error: { type: 'api_error', message: streamError.message }
                        };
                        res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
                        logData.statusCode = streamError.status || 500;
                        logData.errorMessage = streamError.message;
                        await anthropicStore.recordError(anthropicCredential.id, streamError.message);
                    }
                    res.end();
                } else {
                    // Non-streaming response
                    const result = await sendAnthropicMessage(anthropicRequest, anthropicCredential);
                    logData.outputTokens = result.data?.usage?.output_tokens || 0;
                    logData.statusCode = 200;
                    await anthropicStore.recordUsage(anthropicCredential.id);

                    // Update rate limits
                    if (result.rateLimits) {
                        await anthropicStore.updateRateLimits(anthropicCredential.id, result.rateLimits);
                    }

                    res.json(result.data);
                }
            } catch (error) {
                console.error(`[${getTimestamp()}] [Anthropic] Error:`, error.message);
                logData.statusCode = error.status || 500;
                logData.errorMessage = error.message;
                await anthropicStore.recordError(anthropicCredential.id, error.message);
                res.status(error.status || 500).json({
                    error: { type: 'api_error', message: error.message }
                });
            } finally {
                decrementConcurrent(keyRecord.id, clientIp);
                await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            }
            return;
        }

        // ============ Default to Kiro/Claude Provider ============
        const { messages, max_tokens, stream, system, tools, thinking } = req.body;

        // Record request info
        logData.model = model || 'claude-sonnet-4-20250514';
        logData.stream = !!stream;

        // Get all active credentials (in pool)
        const credentials = await store.getAllActive();
        if (credentials.length === 0) {
            decrementConcurrent(keyRecord.id, clientIp);
            logData.statusCode = 503;
            logData.errorMessage = 'No active credentials';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(503).json({ error: { type: 'service_error', message: 'No active credentials' } });
        }

        // Build request body
        const requestBody = { messages, system, tools };
        const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const requestModel = model || 'claude-sonnet-4-20250514';

        // Roughly estimate input token count
        const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);
        logData.inputTokens = inputTokens;

        // Print request log
        // console.log(`[${getTimestamp()}] [API] Request ${requestId} | IP: ${clientIp} | Key: ${keyRecord.keyPrefix} | Model: ${requestModel} | Stream: ${!!stream} | Available credentials: ${credentials.length}`);

        if (stream) {
            // ============ Streaming Response (with Fallback) ============
            await apiLogStore.create({ ...logData, durationMs: 0 });

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            let credential = null;
            let fullText = '';
            let outputTokens = 0;
            const toolCalls = [];
            let hasToolUse = false;
            let streamStarted = false;

            try {
                // Use fallback mechanism to get credential and generator
                const result = await executeWithFallback({
                    credentials,
                    requestModel,
                    requestBody,
                    maxRetries: Math.min(3, credentials.length),
                    stream: true
                });

                credential = result.credential;
                logData.credentialId = credential.id;
                logData.credentialName = credential.name;

                console.log(`[${getTimestamp()}] [API] Using account: ${credential.name}`);

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

                streamStarted = true;

                // Process streaming response
                for await (const event of result.generator) {
                    if (event.type === 'content_block_delta' && event.delta?.text) {
                        fullText += event.delta.text;
                        outputTokens += Math.ceil(event.delta.text.length / 4);
                        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                            type: 'content_block_delta',
                            index: 0,
                            delta: { type: 'text_delta', text: event.delta.text }
                        })}\n\n`);
             } else if (event.type === 'tool_use' && event.toolUse) {
                        hasToolUse = true;
                        toolCalls.push(event.toolUse);
                    }
                }

                // Streaming response successful, mark credential as healthy
                markCredentialHealthy(credential.id);
                // Record selection success
                recordSelectionSuccess('kiro', credential.id).catch(() => {});

                // Send content_block_stop event
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                    type: 'content_block_stop',
                    index: 0
                })}\n\n`);

                // Handle tool calls
                if (toolCalls.length > 0) {
                    for (let i = 0; i < toolCalls.length; i++) {
                        const tc = toolCalls[i];
                        const blockIndex = i + 1;

                        res.write(`event: content_block_start\ndata: ${JSON.stringify({
                            type: 'content_block_start',
                            index: blockIndex,
                            content_block: { type: 'tool_use', id: tc.toolUseId, name: tc.name, input: {} }
                        })}\n\n`);

                        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                            type: 'content_block_delta',
                            index: blockIndex,
                            delta: { type: 'input_json_delta', partial_json: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input || {}) }
                        })}\n\n`);

                        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`);

                        outputTokens += Math.ceil(JSON.stringify(tc.input || {}).length / 4);
                    }
                }

                // Send message_delta and message_stop events
                res.write(`event: message_delta\ndata: ${JSON.stringify({
                    type: 'message_delta',
                    delta: { stop_reason: hasToolUse ? 'tool_use' : 'end_turn', stop_sequence: null },
                    usage: { output_tokens: outputTokens }
                })}\n\n`);

                res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                res.end();

                // Update log
                const durationMs = Date.now() - startTime;
                console.log(`  ✓ ${durationMs}ms | in=${inputTokens} out=${outputTokens}`);
                await apiLogStore.update(requestId, { outputTokens, statusCode: 200, durationMs });

                // Release credential lock
                releaseCredentialLock(credential.id);
                decrementConcurrent(keyRecord.id, clientIp);

            } catch (streamError) {
                // Release resources
                if (credential) {
                    releaseCredentialLock(credential.id);
                    markCredentialUnhealthy(credential.id, streamError.message);
                    // Record selection failure
                    const errorStatus = streamError.status || streamError.response?.status || 500;
                    if (errorStatus === 429) {
                        recordSelectionRateLimit('kiro', credential.id).catch(() => {});
                    } else {
                        recordSelectionFailure('kiro', credential.id, streamError.message).catch(() => {});
                    }
                }
                decrementConcurrent(keyRecord.id, clientIp);

                const durationMs = Date.now() - startTime;
                const errorStatus = streamError.status || streamError.response?.status || 500;

                console.error(`  ✗ ${durationMs}ms | error: ${streamError.message}`);

                await apiLogStore.update(requestId, {
                    outputTokens,
                    statusCode: errorStatus,
                    errorMessage: streamError.message,
                    durationMs
                });

                // Mask specific error messages, return user-friendly message
                let userFriendlyMessage = streamError.message;
                if (errorStatus === 403 && (
                    streamError.message.includes('AccessDeniedException') ||
                    streamError.message.includes('Please run /login') ||
                    streamError.message.includes('Service processing error')
                )) {
                    userFriendlyMessage = 'Service temporarily unavailable, please try again later';
                } else if (errorStatus === 400 && streamError.message.includes('ValidationException')) {
                    userFriendlyMessage = 'Context limit exceeded, or too many tool parameters. Please close the window and restart the conversation.';
                }

                if (streamStarted) {
                    res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: userFriendlyMessage } })}\n\n`);
                    res.end();
                } else {
                    res.status(errorStatus).json({ error: { type: 'api_error', message: userFriendlyMessage } });
                }
            }
        } else {
            // ============ Non-streaming Response (with Fallback) ============
            let credential = null;

            try {
                const result = await executeWithFallback({
                    credentials,
                    requestModel,
                    requestBody,
                    maxRetries: Math.min(3, credentials.length),
                    stream: false
                });

                credential = result.credential;
                logData.credentialId = credential.id;
                logData.credentialName = credential.name;

                console.log(`[${getTimestamp()}] [API] Using account: ${credential.name}`);

                const response = result.response;

                // Build response content
                const content = [];
                let outputTokens = 0;
                let stopReason = 'end_turn';
                let responseText = '';

                if (response.content) {
                    content.push({ type: 'text', text: response.content });
                    outputTokens += Math.ceil(response.content.length / 4);
                }

                if (response.toolCalls && response.toolCalls.length > 0) {
                    stopReason = 'tool_use';
                    for (const tc of response.toolCalls) {
                        content.push({ type: 'tool_use', id: tc.toolUseId, name: tc.name, input: tc.input });
                        outputTokens += Math.ceil(JSON.stringify(tc.input || {}).length / 4);
                    }
                }

                const durationMs = Date.now() - startTime;
                console.log(`  ✓ ${durationMs}ms | in=${inputTokens} out=${outputTokens}`);

                await apiLogStore.create({ ...logData, outputTokens, durationMs });

                // Record selection success
                recordSelectionSuccess('kiro', credential.id).catch(() => {});

                decrementConcurrent(keyRecord.id, clientIp);

                res.json({
                    id: messageId,
                    type: 'message',
                    role: 'assistant',
                    content,
                    model: requestModel,
                    stop_reason: stopReason,
                    stop_sequence: null,
                    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
                });

            } catch (error) {
                if (credential) {
                    markCredentialUnhealthy(credential.id, error.message);
                }
                decrementConcurrent(keyRecord.id, clientIp);

                const durationMs = Date.now() - startTime;
                const errorStatus = error.status || error.response?.status || 500;

                console.error(`  ✗ ${durationMs}ms | error: ${error.message}`);

                logData.statusCode = errorStatus;
                logData.errorMessage = error.message;
                await apiLogStore.create({ ...logData, durationMs });

                // Mask specific error messages, return user-friendly message
                let userFriendlyMessage = error.message;
                if (errorStatus === 403 && (
                    error.message.includes('AccessDeniedException') ||
                    error.message.includes('Please run /login') ||
                    error.message.includes('Service processing error')
                )) {
                    userFriendlyMessage = 'Service temporarily unavailable, please try again later';
                } else if (errorStatus === 400 && error.message.includes('ValidationException')) {
                    userFriendlyMessage = 'Request parameter validation failed, please check input';
                }

                res.status(errorStatus).json({ error: { type: 'api_error', message: userFriendlyMessage } });
            }
        }
    } catch (error) {
        // Decrement concurrent count (if previously incremented)
        if (logData.apiKeyId) {
            decrementConcurrent(logData.apiKeyId, clientIp);
        }

        const durationMs = Date.now() - startTime;
        const outerErrorStatus = error.response?.status || error.status || 500;
        logData.statusCode = outerErrorStatus;
        logData.errorMessage = error.message;
        logData.durationMs = durationMs;

        console.error(`  ✗ ${durationMs}ms | error: ${error.message}`);

        // Record error log
        if (!logData.apiKeyId) {
            await apiLogStore.create(logData);
        }

        // Mask specific error messages, return user-friendly message
        let userFriendlyMessage = error.message;
        if (outerErrorStatus === 403 && (
            error.message.includes('AccessDeniedException') ||
            error.message.includes('Please run /login') ||
            error.message.includes('Service processing error')
        )) {
            userFriendlyMessage = 'Service temporarily unavailable, please try again later';
        } else if (outerErrorStatus === 400 && error.message.includes('ValidationException')) {
            userFriendlyMessage = 'Request parameter validation failed, please check input';
        }

        if (!res.headersSent) {
            res.status(outerErrorStatus).json({ error: { type: 'api_error', message: userFriendlyMessage } });
        } else {
            try {
                res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: userFriendlyMessage } })}\n\n`);
                res.end();
            } catch (e) {
                // Ignore write errors
            }
        }
    }
});


// ============ Gemini Antigravity API Endpoints ============

// Gemini credential pool selection - uses configurable strategies
async function selectGeminiCredential(requestedModel = null, excludeIds = [], sessionId = null) {
    const allCredentials = await geminiStore.getAllActive();
    if (allCredentials.length === 0) return null;

    try {
        const strategyManager = getStrategyManager();
        const strategy = await strategyManager.getStrategy('gemini');

        // Filter credentials that have projectId (required for Gemini)
        const validCredentials = allCredentials.filter(c => c.projectId);
        if (validCredentials.length === 0) {
            // If none have projectId, use all (will trigger onboarding)
            return allCredentials[0];
        }

        const result = await strategy.select(validCredentials, {
            provider: 'gemini',
            model: requestedModel,
            sessionId,
            excludeIds
        });

        return result.credential;
    } catch (error) {
        // Fallback to legacy selection
        console.log(`[${getTimestamp()}] [Gemini Selection] Strategy error, falling back: ${error.message}`);
        return selectGeminiCredentialLegacy(requestedModel, excludeIds);
    }
}

// Legacy Gemini credential selection (fallback)
function selectGeminiCredentialLegacy(requestedModel = null, excludeIds = []) {
    return (async () => {
        const allCredentials = await geminiStore.getAllActive();
        if (allCredentials.length === 0) return null;

        // Filter out excluded credentials
        let availableCredentials = allCredentials.filter(c => !excludeIds.includes(c.id));
        if (availableCredentials.length === 0) {
            availableCredentials = allCredentials;
        }

        // Filter healthy credentials (error count below threshold and projectId not empty)
        const maxErrorCount = 5;
        let healthyCredentials = availableCredentials.filter(c =>
            (c.errorCount || 0) < maxErrorCount && c.projectId
        );

        if (healthyCredentials.length === 0) {
            healthyCredentials = availableCredentials.filter(c => c.projectId);
        }

        if (healthyCredentials.length === 0) {
            healthyCredentials = availableCredentials;
        }

        // LRU strategy: sort by last used time, prefer least recently used
        healthyCredentials.sort((a, b) => {
            const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            if (timeA !== timeB) return timeA - timeB;
            return (a.errorCount || 0) - (b.errorCount || 0);
        });

        return healthyCredentials[0];
    })();
}

// Gemini Token expiry check (refresh 50 minutes early)
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

// Gemini Token refresh (with lock)
const geminiRefreshLocks = new Map();
const geminiRefreshPromises = new Map();

async function refreshGeminiTokenWithLock(credential) {
    const credentialId = credential.id;

    if (geminiRefreshLocks.get(credentialId)) {
        const existingPromise = geminiRefreshPromises.get(credentialId);
        if (existingPromise) return existingPromise;
    }

    geminiRefreshLocks.set(credentialId, true);

    const refreshPromise = (async () => {
        try {
            if (!credential.refreshToken) {
                return { success: false, error: 'No refresh token' };
            }

            // console.log(`[${getTimestamp()}] [Gemini Token] Refreshing credential ${credentialId} (${credential.name})...`);
            const result = await refreshGeminiToken(credential.refreshToken);

            await geminiStore.update(credentialId, {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresAt: result.expiresAt
            });
            await geminiStore.resetErrorCount(credentialId);

            const updatedCredential = await geminiStore.getById(credentialId);
            // console.log(`[${getTimestamp()}] [Gemini Token] Credential ${credentialId} refresh succeeded`);
            return { success: true, credential: updatedCredential };
        } catch (error) {
            // console.log(`[${getTimestamp()}] [Gemini Token] Credential ${credentialId} refresh failed: ${error.message}`);
            await geminiStore.incrementErrorCount(credentialId, error.message);
            return { success: false, error: error.message };
        } finally {
            geminiRefreshLocks.set(credentialId, false);
            geminiRefreshPromises.delete(credentialId);
        }
    })();

    geminiRefreshPromises.set(credentialId, refreshPromise);
    return refreshPromise;
}

// Gemini API - Claude format compatible (/gemini-antigravity/v1/messages)
app.post('/gemini-antigravity/v1/messages', handleGeminiAntigravityRequest);
app.post('/v1/gemini/messages', handleGeminiAntigravityRequest);  // Legacy path compatible

// Orchids API - Claude format compatible (/orchids/v1/messages)
app.post('/orchids/v1/messages', handleOrchidsRequest);
app.post('/v1/orchids/messages', handleOrchidsRequest);  // Legacy path compatible

/**
 * Orchids API request handler function
 * Supports load balancing and failover (based on orchids-api-main's handler.go)
 */
async function handleOrchidsRequest(req, res) {
    const startTime = Date.now();
    const requestId = 'orchids_' + Date.now() + Math.random().toString(36).substring(2, 8);
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Retry configuration
    const MAX_RETRY_COUNT = 3;
    const BASE_RETRY_DELAY = 100; // ms

    let logData = {
        requestId,
        ipAddress: clientIp,
        userAgent,
        method: 'POST',
        path: req.path,
        stream: false,
        inputTokens: 0,
        outputTokens: 0,
        statusCode: 200
    };

    let keyRecord = null;
    let retryCount = 0;
    let failedAccountIds = [];
    let currentCredential = null;

    try {
        // API Key authentication
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        if (!apiKey) {
            logData.statusCode = 401;
            logData.errorMessage = 'Missing API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(401).json({ error: { type: 'authentication_error', message: 'Missing API key' } });
        }

        keyRecord = await verifyApiKey(apiKey);
        if (!keyRecord) {
            logData.statusCode = 401;
            logData.errorMessage = 'Invalid API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(401).json({ error: { type: 'authentication_error', message: 'Invalid API key' } });
        }

        logData.apiKeyId = keyRecord.id;
        logData.apiKeyPrefix = keyRecord.keyPrefix;

        // Check usage limits
        const limitCheck = await checkUsageLimits(keyRecord, clientIp);
        if (!limitCheck.allowed) {
            logData.statusCode = 429;
            logData.errorMessage = limitCheck.reason;
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(429).json({ error: { type: 'rate_limit_error', message: limitCheck.reason } });
        }

        if (!limitCheck.concurrentAcquired) {
            incrementConcurrent(keyRecord.id, clientIp);
        }

        await apiKeyStore.updateLastUsed(keyRecord.id);

        const { model, messages, max_tokens, stream, system } = req.body;

        // Use load balancer to select account
        const selectAccount = async () => {
            if (orchidsLoadBalancer) {
                const credential = await orchidsLoadBalancer.getNextAccountExcluding(failedAccountIds);
                if (credential) {
                    console.log(`[${getTimestamp()}] [Orchids] Using account: ${credential.name} (${credential.email || 'N/A'})`);
                    return credential;
                }
            }
            // Fallback to traditional method
            const orchidsCredentials = await orchidsStore.getAll();
            if (orchidsCredentials.length === 0) return null;
            return orchidsCredentials.find(c => c.isActive && !failedAccountIds.includes(c.id)) 
                || orchidsCredentials.find(c => !failedAccountIds.includes(c.id))
                || orchidsCredentials[0];
        };

        currentCredential = await selectAccount();
        if (!currentCredential) {
            decrementConcurrent(keyRecord.id, clientIp);
            logData.statusCode = 503;
            logData.errorMessage = 'No available Orchids credentials';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(503).json({ error: { type: 'service_error', message: 'No available Orchids credentials' } });
        }

        logData.credentialId = currentCredential.id;
        logData.credentialName = currentCredential.name;
        logData.model = model || 'claude-sonnet-4-5';
        logData.stream = !!stream;

        // Roughly estimate input token count
        const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);
        logData.inputTokens = inputTokens;

        const requestBody = { messages, system, max_tokens };

        // Execute request (with retry logic)
        const executeRequest = async (credential) => {
            const orchidsService = new OrchidsChatService(credential);
            
            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');

                let outputTokens = 0;
                for await (const event of orchidsService.generateContentStream(model, requestBody)) {
                    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                    if (event.usage?.output_tokens) {
                        outputTokens = event.usage.output_tokens;
                    }
                }
                logData.outputTokens = outputTokens;
                logData.statusCode = 200;
                res.end();
                return { success: true };
            } else {
                const response = await orchidsService.generateContent(model, requestBody);
                logData.outputTokens = response.usage?.output_tokens || 0;
                logData.statusCode = 200;
                res.json(response);
                return { success: true };
            }
        };

        // Main request loop (with failover)
        let lastError = null;
        while (retryCount <= MAX_RETRY_COUNT) {
            try {
                const result = await executeRequest(currentCredential);
                if (result.success) {
                    // Request successful, record success count
                    if (orchidsLoadBalancer) {
                        orchidsLoadBalancer.scheduleSuccessCount(currentCredential.id);
                        await orchidsLoadBalancer.markAccountActive(currentCredential.id);
                    }
                    break;
                }
            } catch (error) {
                lastError = error;
                console.error(`[${getTimestamp()}] [Orchids] Account ${currentCredential.name} request failed: ${error.message}`);

                // Record failure
                if (orchidsLoadBalancer) {
                    orchidsLoadBalancer.scheduleFailureCount(currentCredential.id);
                }
                failedAccountIds.push(currentCredential.id);
                retryCount++;

                // Check if max retry count exceeded
                if (retryCount >= MAX_RETRY_COUNT) {
                    console.log(`[${getTimestamp()}] [Orchids] Reached max retry count (${MAX_RETRY_COUNT}), stopping retry`);
                    break;
                }

                console.log(`[${getTimestamp()}] [Orchids] Attempting to switch account (retry ${retryCount}/${MAX_RETRY_COUNT}, excluded ${failedAccountIds.length})`);

                // Exponential backoff
                const backoff = Math.pow(2, retryCount - 1) * BASE_RETRY_DELAY;
                await new Promise(resolve => setTimeout(resolve, backoff));

                // Select new account
                const newCredential = await selectAccount();
                if (!newCredential || failedAccountIds.includes(newCredential.id)) {
                    console.log(`[${getTimestamp()}] [Orchids] No more available accounts`);
                    break;
                }
                currentCredential = newCredential;
                logData.credentialId = currentCredential.id;
                logData.credentialName = currentCredential.name;
                console.log(`[${getTimestamp()}] [Orchids] Switched to account: ${currentCredential.name}`);
            }
        }

        // If all retries failed
        if (lastError && !res.headersSent) {
            const errorEvent = {
                type: 'error',
                error: { type: 'api_error', message: lastError.message }
            };
            if (stream) {
                res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
                res.end();
            } else {
                res.status(500).json({ error: { type: 'api_error', message: lastError.message } });
            }
            logData.statusCode = 500;
            logData.errorMessage = lastError.message;
        }

        console.log(`[${getTimestamp()}] [Orchids] ${requestId} | Complete | retries=${retryCount} | duration=${Date.now() - startTime}ms`);

    } catch (error) {
        logData.statusCode = 500;
        logData.errorMessage = error.message;
        if (!res.headersSent) {
            res.status(500).json({ error: { type: 'api_error', message: error.message } });
        }
    } finally {
        // Release all used accounts
        if (orchidsLoadBalancer) {
            if (currentCredential) {
                orchidsLoadBalancer.unlockAccount(currentCredential.id);
            }
            // Release failed accounts
            for (const failedId of failedAccountIds) {
                if (failedId !== currentCredential?.id) {
                    orchidsLoadBalancer.unlockAccount(failedId);
                }
            }
        }
        if (keyRecord) {
            decrementConcurrent(keyRecord.id, clientIp);
        }
        await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
    }
}

async function handleGeminiAntigravityRequest(req, res) {
    const startTime = Date.now();
    const requestId = 'gemini_' + Date.now() + Math.random().toString(36).substring(2, 8);
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    let logData = {
        requestId,
        ipAddress: clientIp,
        userAgent,
        method: 'POST',
        path: req.path,
        stream: false, inputTokens: 0,
        outputTokens: 0,
        statusCode: 200
    };

    let credential = null;
    let keyRecord = null;
    const maxRetries = 3;  // Maximum retry count
    const triedCredentialIds = [];  // Tried credential IDs

    try {
        // API Key authentication
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        if (!apiKey) {
            logData.statusCode = 401;
            logData.errorMessage = 'Missing API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(401).json({ error: { type: 'authentication_error', message: 'Missing API key' } });
        }

        keyRecord = await verifyApiKey(apiKey);
        if (!keyRecord) {
            logData.statusCode = 401;
            logData.errorMessage = 'Invalid API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(401).json({ error: { type: 'authentication_error', message: 'Invalid API key' } });
        }

        logData.apiKeyId = keyRecord.id;
        logData.apiKeyPrefix = keyRecord.keyPrefix;

        // Check usage limits
        const limitCheck = await checkUsageLimits(keyRecord, clientIp);
        if (!limitCheck.allowed) {
            logData.statusCode = 429;
            logData.errorMessage = limitCheck.reason;
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(429).json({ error: { type: 'rate_limit_error', message: limitCheck.reason } });
        }

        if (!limitCheck.concurrentAcquired) {
            incrementConcurrent(keyRecord.id, clientIp);
        }

        await apiKeyStore.updateLastUsed(keyRecord.id);

        const { model, messages, stream, system, max_tokens } = req.body;
        const requestModel = model || 'gemini-3-preview';

        logData.model = requestModel;
        logData.stream = !!stream;

        // Convert Claude format messages to Gemini format (only need to convert once)
        const contents = claudeToGeminiMessages(messages);
        const requestBody = { contents };

        // Add system prompt
        if (system) {
            const systemText = typeof system === 'string' ? system : (Array.isArray(system) ? system.map(s => s.text || s).join('\n') : String(system));
            requestBody.systemInstruction = { parts: [{ text: systemText }] };
        }

        // Add generation config
        if (max_tokens) {
            requestBody.generationConfig = { maxOutputTokens: max_tokens };
        }

        const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);
        logData.inputTokens = inputTokens;

        // 429 retry loop
        let lastError = null;
        for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
            // Select Gemini credential (excluding already tried ones)
            credential = await selectGeminiCredential(requestModel, triedCredentialIds);
            if (!credential) {
                if (triedCredentialIds.length > 0) {
                    // All credentials tried, throw error
                    decrementConcurrent(keyRecord.id, clientIp);
                    logData.statusCode = 429;
                    logData.errorMessage = 'All Gemini credentials rate limited';
                    await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                    return res.status(429).json({ error: { type: 'rate_limit_error', message: 'All Gemini credentials are rate limited, please try again later' } });
                }
                decrementConcurrent(keyRecord.id, clientIp);
                logData.statusCode = 503;
                logData.errorMessage = 'No available Gemini credentials';
                await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(503).json({ error: { type: 'service_error', message: 'No available Gemini credentials' } });
            }

            triedCredentialIds.push(credential.id);
            logData.credentialId = credential.id;
            logData.credentialName = credential.name;

            // console.log(`[${getTimestamp()}] [Gemini API] Request ${requestId} | IP: ${clientIp} | Key: ${keyRecord.keyPrefix} | Cred: ${credential.name} | Model: ${requestModel} | Stream: ${!!stream} | Retry: ${retryCount}`);

            // Check and refresh Token (if expiring soon)
            if (credential.refreshToken && isGeminiTokenExpiringSoon(credential)) {
                // console.log(`[${getTimestamp()}] [Gemini API] Credential ${credential.id} Token expiring soon, refreshing first...`);
                const refreshResult = await refreshGeminiTokenWithLock(credential);
                if (refreshResult.success && refreshResult.credential) {
                    credential = refreshResult.credential;
                }
            }

            // Create Antigravity service
            const service = AntigravityApiService.fromCredentials(credential);

            try {
                if (stream) {
                    // ============ Streaming Response ============
                    await apiLogStore.create({ ...logData, durationMs: 0 });

                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');

                    const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);

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

                    // Track thinking and text block states
                    let thinkingBlockStarted = false;
                    let textBlockStarted = false;
                    let blockIndex = 0;
                    let fullText = '';
                    let fullThinking = '';
                    let outputTokens = 0;

                    // Check if model supports thinking blocks
                    const isThinkingModel = thinkingBlocksParser.isThinkingModel(requestModel);

                    for await (const chunk of service.generateContentStream(requestModel, requestBody)) {
                        if (chunk && chunk.candidates && chunk.candidates[0]?.content?.parts) {
                            for (const part of chunk.candidates[0].content.parts) {
                                // Handle thinking blocks
                                if (part.thought === true && part.text) {
                                    if (!thinkingBlockStarted) {
                                        // Start thinking block
                                        res.write(`event: content_block_start\ndata: ${JSON.stringify({
                                            type: 'content_block_start',
                                            index: blockIndex,
                                            content_block: { type: 'thinking', thinking: '' }
                                        })}\n\n`);
                                        thinkingBlockStarted = true;
                                    }
                                    fullThinking += part.text;
                                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                        type: 'content_block_delta',
                                        index: blockIndex,
                                        delta: { type: 'thinking_delta', thinking: part.text }
                                    })}\n\n`);

                                    // Cache signature if present
                                    if (part.thoughtSignature) {
                                        thinkingBlocksParser.cacheSignature(part.thoughtSignature, 'gemini').catch(() => {});
                                    }
                                } else if (part.text) {
                                    // Handle text blocks
                                    if (thinkingBlockStarted && !textBlockStarted) {
                                        // End thinking block and start text block
                                        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`);
                                        blockIndex++;
                                    }
                                    if (!textBlockStarted) {
                                        // Start text block
                                        res.write(`event: content_block_start\ndata: ${JSON.stringify({
                                            type: 'content_block_start',
                                            index: blockIndex,
                                            content_block: { type: 'text', text: '' }
                                        })}\n\n`);
                                        textBlockStarted = true;
                                    }
                                    fullText += part.text;
                                    outputTokens += Math.ceil(part.text.length / 4);
                                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                        type: 'content_block_delta',
                                        index: blockIndex,
                                        delta: { type: 'text_delta', text: part.text }
                                    })}\n\n`);
                                }
                            }
                        }

                        // Extract usageMetadata
                        if (chunk?.usageMetadata) {
                            if (chunk.usageMetadata.candidatesTokenCount) {
                                outputTokens = chunk.usageMetadata.candidatesTokenCount;
                            }
                        }
                    }

                    // Handle case where no blocks were sent
                    if (!thinkingBlockStarted && !textBlockStarted) {
                        // Send empty text block for compatibility
                        res.write(`event: content_block_start\ndata: ${JSON.stringify({
                            type: 'content_block_start',
                            index: 0,
                            content_block: { type: 'text', text: '' }
                        })}\n\n`);
                    }

                    // Send end events
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`);
                    res.write(`event: message_delta\ndata: ${JSON.stringify({
                        type: 'message_delta',
                        delta: { stop_reason: 'end_turn', stop_sequence: null },
                        usage: { output_tokens: outputTokens }
                    })}\n\n`);
                    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                    res.end();

                    // Update log and credential status
                    await apiLogStore.update(requestId, {
                        outputTokens,
                        durationMs: Date.now() - startTime
                    });
                    await geminiStore.resetErrorCount(credential.id);

                    // Record selection success
                    recordSelectionSuccess('gemini', credential.id).catch(() => {});

                    // console.log(`[${getTimestamp()}] [Gemini] ${requestId} | ${keyRecord.keyPrefix} | ${clientIp} | ${Date.now() - startTime}ms | in:${inputTokens} out:${outputTokens}`);
                    decrementConcurrent(keyRecord.id, clientIp);
                    return;  // Success, exit

                } else {
                    // ============ Non-streaming Response ============
                    const response = await service.generateContent(requestModel, requestBody);
                    const claudeResponse = geminiToClaudeResponse(response, requestModel);

                    // Update token statistics
                    const outputTokens = claudeResponse.usage?.output_tokens || 0;
                    logData.outputTokens = outputTokens;
                    logData.durationMs = Date.now() - startTime;

                    await apiLogStore.create(logData);
                    await geminiStore.resetErrorCount(credential.id);

                    // Record selection success
                    recordSelectionSuccess('gemini', credential.id).catch(() => {});

                    decrementConcurrent(keyRecord.id, clientIp);

                    // console.log(`[${getTimestamp()}] [Gemini] ${requestId} | ${keyRecord.keyPrefix} | ${clientIp} | ${Date.now() - startTime}ms | in:${inputTokens} out:${outputTokens}`);

                    return res.json(claudeResponse);  // Success, exit
                }

            } catch (apiError) {
                lastError = apiError;
                const errorStatus = apiError.response?.status || apiError.status;
                const errorMessage = apiError.message || 'Unknown error';

                console.error(`[${getTimestamp()}] [Gemini API] Credential ${credential.name} error: ${errorMessage} (status: ${errorStatus})`);

                // Increment error count
                await geminiStore.incrementErrorCount(credential.id, errorMessage);

                // If 429 error, try next credential
                if (errorStatus === 429) {
                    // Record rate limit
                    recordSelectionRateLimit('gemini', credential.id).catch(() => {});
                    // console.log(`[${getTimestamp()}] [Gemini API] Credential ${credential.name} triggered 429, trying to switch account...`);
                    // Brief delay before retry
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;  // Continue to next iteration, try other credentials
                }

                // Record selection failure for other errors
                recordSelectionFailure('gemini', credential.id, errorMessage).catch(() => {});

                // Other errors throw directly
                throw apiError;
            }
        }

        // All retries failed
        throw lastError || new Error('All retries failed');

    } catch (error) {
        logData.statusCode = error.response?.status || 500;
        logData.errorMessage = error.message;
        logData.durationMs = Date.now() - startTime;

        if (!logData.apiKeyId) {
            await apiLogStore.create(logData);
        }

        console.error(`[${getTimestamp()}] [Gemini API] Error ${requestId} | ${error.message}`);

        if (keyRecord) {
            decrementConcurrent(keyRecord.id, clientIp);
        }

        if (!res.headersSent) {
            res.status(500).json({ error: { type: 'api_error', message: error.message } });
        }
    }
}

// OpenAI API compatible interface
app.post('/v1/chat/completions', async (req, res) => {
    const startTime = Date.now();
    const requestId = 'chatcmpl-' + Date.now() + Math.random().toString(36).substring(2, 8);
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    let logData = {
        requestId,
        ipAddress: clientIp,
        userAgent,
        method: 'POST',
        path: '/v1/chat/completions',
        stream: false,
        inputTokens: 0,
        outputTokens: 0,
        statusCode: 200
    };

    try {
        const apiKey = req.headers['authorization']?.replace('Bearer ', '');
        if (!apiKey) {
            logData.statusCode = 401;
            logData.errorMessage = 'Missing API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(401).json({ error: { message: 'Missing API key', type: 'invalid_request_error', code: 'invalid_api_key' } });
        }

        const keyRecord = await verifyApiKey(apiKey);
        if (!keyRecord) {
            logData.statusCode = 401;
            logData.errorMessage = 'Invalid API key';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(401).json({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } });
        }

        logData.apiKeyId = keyRecord.id;
        logData.apiKeyPrefix = keyRecord.keyPrefix;

        // Check usage limits (including concurrent limit check, based on API Key + IP)
        const limitCheck = await checkUsageLimits(keyRecord, clientIp);
        if (!limitCheck.allowed) {
            logData.statusCode = 429;
            logData.errorMessage = limitCheck.reason;
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(429).json({ error: { message: limitCheck.reason, type: 'rate_limit_error' } });
        }

        // If concurrent slot wasn't acquired during limit check, manually increment concurrent count
        if (!limitCheck.concurrentAcquired) {
            incrementConcurrent(keyRecord.id, clientIp);
        }

        await apiKeyStore.updateLastUsed(keyRecord.id);

        const { model, messages, max_tokens, stream, temperature, top_p, tools, tool_choice } = req.body;

        // ============ Model-Provider Routing Support ============
        const modelProvider = req.headers['model-provider'] || req.headers['x-model-provider'] || '';

        // Check if routing to Anthropic is needed (header-only)
        const isAnthropicProvider = modelProvider.toLowerCase() === 'anthropic';

        if (isAnthropicProvider) {
            console.log(`[${getTimestamp()}] [OpenAI API] Request routed to Anthropic Provider | Model: ${model}`);
            logData.path = '/v1/chat/completions (anthropic)';

            // Get Anthropic credentials
            const anthropicCredentials = await anthropicStore.getActive();
            if (anthropicCredentials.length === 0) {
                decrementConcurrent(keyRecord.id, clientIp);
                logData.statusCode = 503;
                logData.errorMessage = 'No available Anthropic credentials';
                await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(503).json({ error: { message: 'No available Anthropic credentials', type: 'service_error' } });
            }

            // Select credential (least-used)
            const anthropicCredential = anthropicCredentials.reduce((a, b) =>
                (a.useCount || 0) <= (b.useCount || 0) ? a : b
            );

            console.log(`[${getTimestamp()}] [Anthropic] Using account: ${anthropicCredential.name}`);
            logData.credentialId = anthropicCredential.id;
            logData.credentialName = anthropicCredential.name;
            logData.model = model || 'claude-sonnet-4-20250514';
            logData.stream = !!stream;

            // Convert OpenAI messages to Claude format
            let systemPrompt = '';
            const convertedMsgs = [];
            for (const msg of messages) {
                if (msg.role === 'system') {
                    systemPrompt += (systemPrompt ? '\n' : '') + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
                } else if (msg.role === 'user' || msg.role === 'assistant') {
                    convertedMsgs.push({ role: msg.role, content: msg.content });
                }
            }

            // Build Anthropic request
            const anthropicRequest = {
                model: model || 'claude-sonnet-4-20250514',
                messages: convertedMsgs,
                max_tokens: max_tokens || 4096
            };
            if (systemPrompt) anthropicRequest.system = systemPrompt;
            if (tools) {
                anthropicRequest.tools = tools.map(t => ({
                    name: t.function?.name || t.name,
                    description: t.function?.description || t.description || '',
                    input_schema: t.function?.parameters || t.input_schema || {}
                }));
            }

            // Calculate input tokens for logging
            logData.inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

            try {
                if (stream) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');

                    let fullText = '';
                    let outputTokens = 0;

                    for await (const event of sendAnthropicMessageStream(anthropicRequest, anthropicCredential)) {
                        if (event.type === 'rate_limits') {
                            if (event.rateLimits) await anthropicStore.updateRateLimits(anthropicCredential.id, event.rateLimits);
                            continue;
                        }
                        // Convert to OpenAI SSE format
                        if (event.type === 'content_block_delta' && event.delta?.text) {
                            fullText += event.delta.text;
                            const openAIChunk = {
                                id: requestId,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: model,
                                choices: [{
                                    index: 0,
                                    delta: { content: event.delta.text },
                                    finish_reason: null
                                }]
                            };
                            res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
                        } else if (event.type === 'message_delta' && event.usage) {
                            outputTokens = event.usage.output_tokens || 0;
                        } else if (event.type === 'message_stop') {
                            const finalChunk = {
                                id: requestId,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: model,
                                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                            };
                            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                        }
                    }
                    res.write('data: [DONE]\n\n');
                    res.end();

                    logData.outputTokens = outputTokens;
                    logData.statusCode = 200;
                    await anthropicStore.recordUsage(anthropicCredential.id);
                } else {
                    const result = await sendAnthropicMessage(anthropicRequest, anthropicCredential);
                    if (result.rateLimits) await anthropicStore.updateRateLimits(anthropicCredential.id, result.rateLimits);

                    // Convert to OpenAI format
                    const content = result.data.content?.map(c => c.text).join('') || '';
                    const openAIResponse = {
                        id: requestId,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: model,
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content },
                            finish_reason: result.data.stop_reason === 'end_turn' ? 'stop' : result.data.stop_reason
                        }],
                        usage: {
                            prompt_tokens: result.data.usage?.input_tokens || 0,
                            completion_tokens: result.data.usage?.output_tokens || 0,
                            total_tokens: (result.data.usage?.input_tokens || 0) + (result.data.usage?.output_tokens || 0)
                        }
                    };

                    logData.inputTokens = result.data.usage?.input_tokens || logData.inputTokens;
                    logData.outputTokens = result.data.usage?.output_tokens || 0;
                    logData.statusCode = 200;
                    await anthropicStore.recordUsage(anthropicCredential.id);
                    res.json(openAIResponse);
                }
            } catch (error) {
                console.error(`[${getTimestamp()}] [Anthropic] Error:`, error.message);
                logData.statusCode = error.status || 500;
                logData.errorMessage = error.message;
                await anthropicStore.recordError(anthropicCredential.id, error.message);
                res.status(error.status || 500).json({ error: { message: error.message, type: 'api_error' } });
            } finally {
                decrementConcurrent(keyRecord.id, clientIp);
                await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            }
            return;
        }

        // Convert OpenAI message format to Claude format
        let systemPrompt = '';
        const convertedMessages = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
            } else if (msg.role === 'user' || msg.role === 'assistant') {
                let content = msg.content;
                if (Array.isArray(content)) {
                    content = content.map(c => c.type === 'text' ? c.text : '').join('');
                }
                convertedMessages.push({ role: msg.role, content });
            } else if (msg.role === 'tool') {
                convertedMessages.push({
                    role: 'user',
                    content: `Tool result for ${msg.tool_call_id}: ${msg.content}`
                });
            }
        }

        logData.model = model || 'gpt-4';
        logData.stream = !!stream;

        const credentials = await store.getAllActive();
        if (credentials.length === 0) {
            logData.statusCode = 503;
            logData.errorMessage = 'No active credentials';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(503).json({ error: { message: 'No active credentials', type: 'server_error' } });
        }

        // Smart credential selection (prefer idle ones, if all busy select shortest queue)
        let credential = await selectBestCredential(credentials);
        console.log(`[${getTimestamp()}] [OpenAI API] Using Kiro account: ${credential.id} - ${credential.name}`);
        logData.credentialId = credential.id;
        logData.credentialName = credential.name;

        // Acquire credential lock (if credential in use, will queue and wait)
        await acquireCredentialLock(credential.id);

        // Check and refresh token (if expiring soon) - must execute after acquiring lock
        if (credential.refreshToken && isTokenExpiringSoon(credential)) {
            // console.log(`[${getTimestamp()}] [OpenAI API] Credential ${credential.id} token expiring soon, refreshing first...`);
            const refreshResult = await refreshTokenWithLock(credential, store);
            if (refreshResult.success && refreshResult.credential) {
                credential = refreshResult.credential;
            }
        }

        // Use KiroService (consistent with /v1/messages)
        const service = new KiroService(credential);

        // OpenAI model mapping to Claude model
        const modelMapping = {
            'gpt-4': 'claude-sonnet-4-20250514',
            'gpt-4-turbo': 'claude-sonnet-4-20250514',
            'gpt-4-turbo-preview': 'claude-sonnet-4-20250514',
            'gpt-4o': 'claude-sonnet-4-20250514',
            'gpt-4o-mini': 'claude-3-5-haiku-20241022',
            'gpt-3.5-turbo': 'claude-3-5-haiku-20241022',
            'o1': 'claude-opus-4-5-20251101',
            'o1-preview': 'claude-opus-4-5-20251101'
        };
        const claudeModel = modelMapping[model] || model || 'claude-sonnet-4-20250514';

        // Convert OpenAI tool format to Claude format
        let claudeTools = null;
        if (tools && Array.isArray(tools) && tools.length > 0) {
            claudeTools = tools.map(tool => ({
                name: tool.function.name,
                description: tool.function.description || '',
                input_schema: tool.function.parameters || {}
            }));
        }

        // Build Claude request body
        const requestBody = {
            messages: convertedMessages,
            system: systemPrompt || undefined,
            tools: claudeTools || undefined
        };

        const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);
        logData.inputTokens = inputTokens;

        // console.log(`[${getTimestamp()}] [OpenAI API] Request ${requestId} | IP: ${clientIp} | Key: ${keyRecord.keyPrefix} | Model: ${model} -> ${claudeModel} | Stream: ${!!stream}`);

        if (stream) {
            await apiLogStore.create({ ...logData, durationMs: 0 });

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            let fullText = '';
            let outputTokens = 0;
            const toolCalls = [];

            try {
                for await (const event of service.generateContentStream(claudeModel, requestBody)) {
                    if (event.type === 'content_block_delta' && event.delta?.text) {
                        fullText += event.delta.text;
                        outputTokens += Math.ceil(event.delta.text.length / 4);

                        const chunk = {
                            id: requestId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: model || 'gpt-4',
                            choices: [{
                                index: 0,
                                delta: { content: event.delta.text },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    } else if (event.type === 'tool_use' && event.toolUse) {
                        toolCalls.push(event.toolUse);
                    }
                }

                // Send tool calls (if any)
                if (toolCalls.length > 0) {
                    const toolCallsChunk = {
                        id: requestId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model || 'gpt-4',
                        choices: [{
                            index: 0,
                            delta: {
                                tool_calls: toolCalls.map((tc, idx) => ({
                                    index: idx,
                                    id: tc.toolUseId,
                                    type: 'function',
                                    function: {
                                        name: tc.name,
                                        arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input || {})
                                    }
                                }))
                            },
                            finish_reason: null
                        }]
                    };
                    res.write(`data: ${JSON.stringify(toolCallsChunk)}\n\n`);
                }

                const finalChunk = {
                    id: requestId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model || 'gpt-4',
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
                    }]
                };
                res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();

                const durationMs = Date.now() - startTime;
                await apiLogStore.update(requestId, { outputTokens, statusCode: 200, durationMs });

                // Decrement concurrent count
                decrementConcurrent(keyRecord.id, clientIp);

                // Release credential lock
                releaseCredentialLock(credential.id);

                // Increment use count
                await store.incrementUseCount(credential.id);

                // console.log(`[${getTimestamp()}] [OpenAI] ${requestId} | ${keyRecord.keyPrefix} | ${clientIp} | ${durationMs}ms | in:${inputTokens} out:${outputTokens}`);

            } catch (streamError) {
                // Decrement concurrent count
                decrementConcurrent(keyRecord.id, clientIp);

                // Release credential lock
                releaseCredentialLock(credential.id);

                const durationMs = Date.now() - startTime;
                await apiLogStore.update(requestId, { statusCode: 500, errorMessage: streamError.message, durationMs });
                // console.error(`[${getTimestamp()}] [OpenAI API] Error ${requestId} | ${streamError.message}`);
                res.write(`data: ${JSON.stringify({ error: { message: streamError.message, type: 'server_error' } })}\n\n`);
                res.end();
            }
        } else {
            // Non-streaming response
            const response = await service.generateContent(claudeModel, requestBody);

            let outputTokens = 0;
            let responseText = response.content || '';
            outputTokens += Math.ceil(responseText.length / 4);

            const durationMs = Date.now() - startTime;

            await apiLogStore.create({ ...logData, outputTokens, durationMs });

            // Decrement concurrent count
            decrementConcurrent(keyRecord.id, clientIp);

            // Release credential lock
            releaseCredentialLock(credential.id);

            // Increment use count
            await store.incrementUseCount(credential.id);

            // console.log(`[${getTimestamp()}] [OpenAI] ${requestId} | ${keyRecord.keyPrefix} | ${clientIp} | ${durationMs}ms | in:${inputTokens} out:${outputTokens}`);

            // Build response
            const message = {
                role: 'assistant',
                content: responseText
            };

            // Add tool calls (if any)
            if (response.toolCalls && response.toolCalls.length > 0) {
                message.tool_calls = response.toolCalls.map((tc, idx) => ({
                    id: tc.toolUseId,
                    type: 'function',
                    function: {
                        name: tc.name,
                        arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input || {})
                    }
                }));
            }

            res.json({
                id: requestId,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model || 'gpt-4',
                choices: [{
                    index: 0,
                    message,
                    finish_reason: response.toolCalls && response.toolCalls.length > 0 ? 'tool_calls' : 'stop'
                }],
                usage: {
                    prompt_tokens: inputTokens,
                    completion_tokens: outputTokens,
                    total_tokens: inputTokens + outputTokens
                }
            });
        }
    } catch (error) {
        // Decrement concurrent count (if previously incremented)
        if (logData.apiKeyId) {
            decrementConcurrent(logData.apiKeyId, clientIp);
        }

        // Release credential lock (if previously acquired)
        if (logData.credentialId) {
            releaseCredentialLock(logData.credentialId);
        }

        const durationMs = Date.now() - startTime;
        logData.statusCode = 500;
        logData.errorMessage = error.message;
        logData.durationMs = durationMs;
        await apiLogStore.create(logData);
        console.error(`[${getTimestamp()}] [OpenAI API] Error ${requestId} | ${error.message}`);

        if (!res.headersSent) {
            res.status(500).json({ error: { message: error.message, type: 'server_error' } });
        } else {
            res.write(`data: ${JSON.stringify({ error: { message: error.message, type: 'server_error' } })}\n\n`);
            res.end();
        }
    }
});

// ============ API Routes ============

// Get credentials list
app.get('/api/credentials', authMiddleware, async (req, res) => {
    try {
        const credentials = await store.getAll();
        // Hide sensitive info
        const safeCredentials = credentials.map(c => ({
            ...c,
            accessToken: c.accessToken ? '***' + c.accessToken.slice(-8) : null,
            refreshToken: c.refreshToken ? '***' : null,
            clientSecret: c.clientSecret ? '***' : null
        }));
        res.json({ success: true, data: safeCredentials });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single credential
app.get('/api/credentials/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const showFull = req.query.full === 'true';
        const credential = await store.getById(id);
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential does not exist' });
        }

        // Decide whether to hide sensitive info based on parameters
        let responseData;
        if (showFull) {
            // Detail page needs full info
            responseData = credential;
        } else {
            // List page hides sensitive info
            responseData = {
                ...credential,
                accessToken: credential.accessToken ? '***' + credential.accessToken.slice(-8) : null,
                refreshToken: credential.refreshToken ? '***' : null,
                clientSecret: credential.clientSecret ? '***' : null
            };
        }
        res.json({ success: true, data: responseData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add credential
app.post('/api/credentials', authMiddleware, async (req, res) => {
    try {
        const { email, region, provider, refreshToken, authMethod, clientId, clientSecret } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json({ success: false, error: 'refreshToken is required' });
        }
        
        // IdC authentication requires clientId and clientSecret
        if (authMethod === 'IdC' || authMethod === 'builder-id') {
            if (!clientId || !clientSecret) {
                return res.status(400).json({ success: false, error: 'IdC/builder-id authentication requires clientId and clientSecret' });
            }
        }
        
        // Refresh token first to get accessToken
        const refreshResult = await KiroAPI.refreshToken({
            refreshToken,
            authMethod: authMethod || 'social',
            region: region || 'us-east-1',
            clientId,
            clientSecret
        });
        
        if (!refreshResult.success) {
            return res.status(400).json({ success: false, error: `Token refresh failed: ${refreshResult.error}` });
        }
        
        // Generate name
        const name = email || `account_${Date.now()}`;
        
        // Save to database
        const id = await store.add({
            name,
            accessToken: refreshResult.accessToken,
            refreshToken: refreshResult.refreshToken || refreshToken,
            authMethod: authMethod || 'social',
            provider: provider || 'Google',
            region: region || 'us-east-1',
            clientId: clientId || null,
            clientSecret: clientSecret || null,
            expiresAt: refreshResult.expiresAt
        });
        
        // console.log(`[${getTimestamp()}] Credential added successfully: id=${id}, name=${name}, authMethod=${authMethod || 'social'}`);
        res.json({ success: true, id, name });
    } catch (error) {
        console.error(`[${getTimestamp()}] Failed to add credential:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete credential
app.delete('/api/credentials/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await store.delete(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update credential
app.put('/api/credentials/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, region, isActive } = req.body;

        const credential = await store.getById(id);
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (region !== undefined) updateData.region = region;
        if (isActive !== undefined) updateData.isActive = isActive;

        await store.update(id, updateData);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle credential active status (enable/disable in pool)
app.post('/api/credentials/:id/toggle-active', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const isActive = await store.toggleActive(id);
        res.json({ success: true, data: { isActive } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Import credential from file
app.post('/api/credentials/import', authMiddleware, async (req, res) => {
    try {
        const { filePath, name } = req.body;

        if (!filePath) {
            return res.status(400).json({ success: false, error: 'File path is required' });
        }

        const id = await store.importFromFile(filePath, name);
        res.json({ success: true, data: { id } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Batch import Google/Social accounts
app.post('/api/credentials/batch-import', authMiddleware, async (req, res) => {
    try {
        const { accounts, region } = req.body;

        if (!accounts || !Array.isArray(accounts)) {
            return res.status(400).json({ success: false, error: 'accounts must be an array' });
        }

        if (accounts.length === 0) {
            return res.status(400).json({ success: false, error: 'accounts array cannot be empty' });
        }

        const results = await store.batchImportSocialAccounts(accounts, region || 'us-east-1');
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== OAuth Login API ====================

// Store active OAuth authentication instances (for Builder ID polling)
const activeOAuthSessions = new Map();

// Store pending Kiro Social OAuth sessions (state -> session info)
const pendingKiroSocialSessions = new Map();

// Clean up expired Kiro Social sessions (older than 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [state, session] of pendingKiroSocialSessions) {
        if (now - session.createdAt > 10 * 60 * 1000) {
            pendingKiroSocialSessions.delete(state);
        }
    }
}, 60 * 1000);

/**
 * Generate credential name
 */
function generateCredentialName(provider) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${provider}-${timestamp}`;
}

// Start OAuth login (Builder ID)
app.post('/api/oauth/builder-id/start', async (req, res) => {
    try {
        const {
            saveToConfigs = false,
            saveToDatabase = true,  // Default to save directly to database
            saveToFile = false,     // Default to not save to file
            name,                   // Optional credential name
            region = 'us-east-1'
        } = req.body;

        const sessionId = crypto.randomBytes(16).toString('hex');
        let credentialId = null;

        // Create success callback to save to database
        const onSuccess = saveToDatabase ? async (credentials) => {
            // Try to fetch user info to get email for credential name
            let finalName = name || generateCredentialName('BuilderID');
            let usageData = null;
            try {
                const usageResult = await KiroAPI.getUsageLimits(credentials);
                if (usageResult.success && usageResult.data) {
                    usageData = usageResult.data;
                    // Use email as credential name if not provided by user
                    if (!name && usageData.userInfo?.email) {
                        finalName = usageData.userInfo.email;
                    }
                }
            } catch (usageError) {
                console.warn(`[Builder ID OAuth] Failed to fetch user info: ${usageError.message}`);
            }

            credentialId = await store.add({
                name: finalName,
                ...credentials,
                usageData
            });
            console.log(`[Builder ID OAuth] Credential saved to database, ID: ${credentialId}, Name: ${finalName}`);
        } : null;

        const auth = new KiroAuth({
            saveToConfigs,
            saveToFile: saveToFile || saveToConfigs,
            region,
            onSuccess
        });

        const result = await auth.startBuilderIDAuth();

        // Store session
        activeOAuthSessions.set(sessionId, {
            auth,
            provider: 'BuilderID',
            saveToConfigs,
            saveToDatabase,
            getCredentialId: () => credentialId,
            startTime: Date.now()
        });

        // Auto cleanup session after 5 minutes
        setTimeout(() => {
            const session = activeOAuthSessions.get(sessionId);
            if (session) {
                session.auth.close();
                activeOAuthSessions.delete(sessionId);
            }
        }, 5 * 60 * 1000);

        res.json({
            success: true,
            data: {
                sessionId,
                verificationUri: result.verificationUri,
                verificationUriComplete: result.verificationUriComplete,
                userCode: result.userCode,
                expiresIn: result.expiresIn,
                saveToDatabase
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start OAuth login (IAM Identity Center) - PKCE Flow
app.post('/api/oauth/idc/start', async (req, res) => {
    try {
        const {
            name,
            startUrl,
            region = 'us-east-1'
        } = req.body;

        // Validate startUrl
        if (!startUrl) {
            return res.status(400).json({ success: false, error: 'Start URL is required' });
        }

        // Validate URL format (must be AWS Apps URL)
        if (!startUrl.match(/^https:\/\/[a-zA-Z0-9-]+\.awsapps\.com\/start\/?$/)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid IAM Identity Center URL format. Expected: https://d-xxxxxxxx.awsapps.com/start'
            });
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        const credName = name || generateCredentialName('IdC');

        const auth = new KiroAuth({ region });

        // Start IdC Device Code flow - returns verification URI and user code
        const authData = await auth.startIdCAuth(startUrl, region);

        // Store session
        activeOAuthSessions.set(sessionId, {
            auth,
            provider: 'IdC',
            type: 'idc-device-code',
            name: credName,
            startUrl,
            region,
            authData,
            startTime: Date.now()
        });

        // Start background polling for token
        pollIdCToken(sessionId, auth, authData, credName).then(result => {
            console.log(`[IdC OAuth] Authorization completed for session ${sessionId}`);
        }).catch(err => {
            console.error(`[IdC OAuth] Authorization failed:`, err.message);
            const session = activeOAuthSessions.get(sessionId);
            if (session) {
                session.error = err.message;
            }
        });

        // Auto cleanup session after 10 minutes
        setTimeout(() => {
            activeOAuthSessions.delete(sessionId);
        }, 10 * 60 * 1000);

        res.json({
            success: true,
            data: {
                sessionId,
                verificationUri: authData.verificationUri,
                verificationUriComplete: authData.verificationUriComplete,
                authUrl: authData.verificationUriComplete,  // Alias for backwards compatibility
                userCode: authData.userCode,
                expiresIn: authData.expiresIn
            }
        });
    } catch (error) {
        console.error(`[IdC OAuth] Start error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Poll for IAM Identity Center token (Device Code Flow)
 */
async function pollIdCToken(sessionId, auth, authData, credName) {
    try {
        const credentials = await auth.pollIdCToken(authData);

        // Try to fetch user info to get email for credential name
        let finalName = credName;
        let usageData = null;
        try {
            const usageResult = await KiroAPI.getUsageLimits(credentials);
            if (usageResult.success && usageResult.data) {
                usageData = usageResult.data;
                // Use email as credential name if available
                if (usageData.userInfo?.email) {
                    finalName = usageData.userInfo.email;
                }
            }
        } catch (usageError) {
            console.warn(`[IdC OAuth] Failed to fetch user info: ${usageError.message}`);
        }

        // Save credential to database
        const credentialId = await store.add({
            name: finalName,
            ...credentials,
            usageData  // Include usage data if fetched
        });

        console.log(`[IdC OAuth] Credential saved to database, ID: ${credentialId}, Name: ${finalName}`);

        // Update session
        const session = activeOAuthSessions.get(sessionId);
        if (session) {
            session.completed = true;
            session.credentialId = credentialId;
        }

        return { credentialId, credentials };
    } catch (error) {
        console.error(`[IdC OAuth] Token poll error:`, error.message);
        throw error;
    }
}

// Start OAuth login (Social Auth - Google/GitHub)
app.post('/api/oauth/social/start', async (req, res) => {
    try {
        const {
            provider = 'Google',  // 'Google' or 'Github'
            saveToDatabase = true,
            name,
            region = 'us-east-1'
        } = req.body;

        // Generate PKCE parameters
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = crypto.randomBytes(32).toString('hex');

        // Get server's base URL from request
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const redirectUri = `${protocol}://${host}/api/oauth/social/callback`;

        // Generate auth URL
        const authUrl = generateSocialAuthUrl(provider, redirectUri, codeChallenge, state, region);

        // Store pending session
        pendingKiroSocialSessions.set(state, {
            provider,
            codeVerifier,
            redirectUri,
            region,
            saveToDatabase,
            credentialName: name || generateCredentialName(provider),
            createdAt: Date.now()
        });

        res.json({
            success: true,
            data: {
                authUrl,
                provider,
                saveToDatabase
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Kiro Social OAuth callback handler
app.get('/api/oauth/social/callback', async (req, res) => {
    try {
        const { code, state, error: oauthError } = req.query;

        if (oauthError) {
            console.error(`[Kiro OAuth] Authorization failed:`, oauthError);
            return res.status(400).send(generateKiroOAuthErrorPage(oauthError));
        }

        if (!code || !state) {
            return res.status(400).send(generateKiroOAuthErrorPage('Missing code or state parameter'));
        }

        // Find pending session
        const session = pendingKiroSocialSessions.get(state);
        if (!session) {
            return res.status(400).send(generateKiroOAuthErrorPage('Invalid or expired OAuth session'));
        }

        // Remove pending session
        pendingKiroSocialSessions.delete(state);

        console.log(`[Kiro OAuth] Received authorization callback for ${session.provider}`);

        // Exchange code for tokens
        const credentials = await exchangeSocialAuthCode(
            code,
            session.codeVerifier,
            session.redirectUri,
            session.region
        );

        // Save to database if requested
        let credentialId = null;
        if (session.saveToDatabase) {
            credentialId = await store.add({
                name: session.credentialName,
                provider: session.provider,
                ...credentials
            });
            console.log(`[Kiro OAuth] Credential saved to database, ID: ${credentialId}, Name: ${session.credentialName}`);
        }

        res.send(generateKiroOAuthSuccessPage(session.provider, credentialId));
    } catch (error) {
        console.error(`[Kiro OAuth] Callback error:`, error.message);
        res.status(500).send(generateKiroOAuthErrorPage(error.message));
    }
});

/**
 * Generate Kiro OAuth success page HTML
 */
function generateKiroOAuthSuccessPage(provider, credentialId) {
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
        .info { font-size: 14px; color: #9ca3af; }
        .close-hint { font-size: 14px; color: #9ca3af; margin-top: 20px; }
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
        <p>Kiro ${provider} credential has been added successfully.</p>
        ${credentialId ? `<p class="info">Credential ID: ${credentialId}</p>` : ''}
        <p class="close-hint">You can close this window now.</p>
    </div>
    <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`;
}

/**
 * Generate Kiro OAuth error page HTML
 */
function generateKiroOAuthErrorPage(errorMessage) {
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

// Check OAuth session status
app.get('/api/oauth/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = activeOAuthSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session does not exist or has expired' });
    }

    const credPath = session.auth?.getLastCredentialsPath?.() || null;
    const credentials = session.auth?.getLastCredentials?.() || null;
    // Check both session.completed flag and credentials for completion status
    const isCompleted = session.completed || !!credentials;
    const credentialId = session.credentialId || (session.getCredentialId ? session.getCredentialId() : null);

    res.json({
        success: true,
        data: {
            provider: session.provider,
            saveToConfigs: session.saveToConfigs,
            saveToDatabase: session.saveToDatabase,
            startTime: session.startTime,
            completed: isCompleted,
            credentialsPath: credPath,
            credentialId: credentialId
        }
    });
});

// Close OAuth session
app.delete('/api/oauth/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = activeOAuthSessions.get(sessionId);

    if (session) {
        session.auth.close();
        activeOAuthSessions.delete(sessionId);
    }

    res.json({ success: true });
});

// Load all credentials from configs directory
app.get('/api/oauth/configs', async (req, res) => {
    try {
        const auth = new KiroAuth();
        const credentials = await auth.loadAllConfigCredentials();
        res.json({ success: true, data: credentials });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Import credentials from configs directory to database
app.post('/api/oauth/configs/import', async (req, res) => {
    try {
        const { credPath, name } = req.body;

        if (!credPath) {
            return res.status(400).json({ success: false, error: 'Credential path is required' });
        }

        const id = await store.importFromFile(credPath, name);
        res.json({ success: true, data: { id } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Batch import all credentials from configs directory
app.post('/api/oauth/configs/import-all', async (req, res) => {
    try {
        const auth = new KiroAuth();
        const allCreds = await auth.loadAllConfigCredentials();

        const results = {
            total: allCreds.length,
            imported: 0,
            failed: 0,
            details: []
        };

        for (const item of allCreds) {
            try {
                const id = await store.importFromFile(item.path);
                results.imported++;
                results.details.push({ path: item.relativePath, id, success: true });
            } catch (error) {
                results.failed++;
                results.details.push({ path: item.relativePath, success: false, error: error.message });
            }
        }

        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== Credential Test ====================

// Test credential
app.post('/api/credentials/:id/test', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const credential = await store.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential does not exist' });
        }

        const client = new KiroClient({
            accessToken: credential.accessToken,
            refreshToken: credential.refreshToken,
            profileArn: credential.profileArn,
            region: credential.region,
            authMethod: credential.authMethod,
            clientId: credential.clientId,
            clientSecret: credential.clientSecret,
            expiresAt: credential.expiresAt
        });

        const response = await client.chat([
            { role: 'user', content: 'Please reply "Test successful"' }
        ]);

        res.json({
            success: true,
            data: {
                message: 'Credential is valid',
                response: response.content.substring(0, 100)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Credential test failed: ${error.message}`
        });
    }
});

// Get available models list
app.get('/api/models', async (req, res) => {
    try {
        // Prefer active credential
        const activeCredential = await store.getActive();
        if (!activeCredential) {
            return res.status(400).json({ success: false, error: 'No active credential, please activate one first' });
        }

        const client = new KiroClient({
            accessToken: activeCredential.accessToken,
            refreshToken: activeCredential.refreshToken,
            profileArn: activeCredential.profileArn,
            region: activeCredential.region,
            authMethod: activeCredential.authMethod,
            clientId: activeCredential.clientId,
            clientSecret: activeCredential.clientSecret,
            expiresAt: activeCredential.expiresAt
        });

        const models = await client.listAvailableModels();
        res.json({ success: true, data: models });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to get model list: ${error.message}`
        });
    }
});

// Get available models list for specified credential
app.get('/api/credentials/:id/models', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const credential = await store.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential does not exist' });
        }

        const client = new KiroClient({
            accessToken: credential.accessToken,
            refreshToken: credential.refreshToken,
            profileArn: credential.profileArn,
            region: credential.region,
            authMethod: credential.authMethod,
            clientId: credential.clientId,
            clientSecret: credential.clientSecret,
            expiresAt: credential.expiresAt
        });

        const models = await client.listAvailableModels();
        res.json({ success: true, data: models });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to get model list: ${error.message}`
        });
    }
});

// Get usage limits
app.get('/api/usage', async (req, res) => {
    try {
        const activeCredential = await store.getActive();
        if (!activeCredential) {
            return res.status(400).json({ success: false, error: 'No active credential, please activate one first' });
        }

        const client = new KiroClient({
            accessToken: activeCredential.accessToken,
            refreshToken: activeCredential.refreshToken,
            profileArn: activeCredential.profileArn,
            region: activeCredential.region,
            authMethod: activeCredential.authMethod,
            clientId: activeCredential.clientId,
            clientSecret: activeCredential.clientSecret,
            expiresAt: activeCredential.expiresAt
        });

        const usage = await client.getUsageLimits();
        res.json({ success: true, data: usage });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to get usage limits: ${error.message}`
        });
    }
});

// Get usage limits for specified credential
app.get('/api/credentials/:id/usage', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let credential = await store.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential does not exist' });
        }

        // Function to try to get usage
        const tryGetUsage = async (cred) => {
            const client = new KiroClient({
                accessToken: cred.accessToken,
                refreshToken: cred.refreshToken,
                profileArn: cred.profileArn,
                region: cred.region,
                authMethod: cred.authMethod,
                clientId: cred.clientId,
                clientSecret: cred.clientSecret,
                expiresAt: cred.expiresAt
            });
            return await client.getUsageLimits();
        };

        try {
            const usage = await tryGetUsage(credential);
            // Save usage to database
            await store.updateUsage(id, usage);
            res.json({ success: true, data: usage });
        } catch (error) {
            const status = error.response?.status;
            // On 403 error, try to refresh Token and retry
            if (status === 403 && credential.refreshToken) {
                // console.log(`[${getTimestamp()}] Credential ${id} get usage returned 403, trying to refresh Token...`);

                const refreshResult = await KiroAPI.refreshToken(credential);

                if (refreshResult.success) {
                    // Update credential in database
                    await store.update(id, {
                        accessToken: refreshResult.accessToken,
                        refreshToken: refreshResult.refreshToken,
                        expiresAt: refreshResult.expiresAt
                    });

                    // Re-fetch credential and retry
                    credential = await store.getById(id);
                    try {
                        const usage = await tryGetUsage(credential);
                        // Save usage to database
                        await store.updateUsage(id, usage);
                        res.json({ success: true, data: usage });
                    } catch (retryError) {
                        // Still failed after refresh, move to error table
                        await store.moveToError(id, `Still failed to get usage after refresh: ${retryError.message}`);
                        // console.log(`[${getTimestamp()}] Credential ${id} still failed to get usage after refresh, moved to error table`);
                        res.status(500).json({
                            success: false,
                            error: `Failed to get usage limits: ${retryError.message}`
                        });
                    }
                } else {
                    // Refresh failed, move to error table
                    await store.moveToError(id, refreshResult.error);
                    res.status(403).json({
                        success: false,
                        error: `Token refresh failed: ${refreshResult.error}`
                    });
                }
            } else {
                throw error;
            }
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to get usage limits: ${error.message}`
        });
    }
});

// Refresh Token
app.post('/api/credentials/:id/refresh', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const credential = await store.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential does not exist' });
        }

        if (!credential.refreshToken) {
            return res.status(400).json({ success: false, error: 'This credential has no refreshToken, cannot refresh' });
        }

        // Use unified KiroAPI to refresh Token
        const result = await KiroAPI.refreshToken(credential);

        if (!result.success) {
            // Move failed credential to error table
            try {
                await store.moveToError(id, result.error);
                // console.log(`Credential ${id} refresh failed, moved to error table: ${result.error}`);
            } catch (moveError) {
                console.error(`Failed to move credential to error table: ${moveError.message}`);
            }

            return res.status(500).json({
                success: false,
                error: `Token refresh failed: ${result.error}`,
                movedToError: true
            });
        }

        // Update credential in database
        await store.update(id, {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt
        });

        res.json({
            success: true,
            data: {
                message: 'Token refresh successful',
                expiresAt: result.expiresAt
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Token refresh failed: ${error.message}`
        });
    }
});

// Get error credentials list
app.get('/api/error-credentials', async (req, res) => {
    try {
        const errors = await store.getAllErrors();
        // Hide sensitive info
        const safeErrors = errors.map(c => ({
            ...c,
            accessToken: c.accessToken ? '***' + c.accessToken.slice(-8) : null,
            refreshToken: c.refreshToken ? '***' : null,
            clientSecret: c.clientSecret ? '***' : null
        }));
        res.json({ success: true, data: safeErrors });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refresh error credential's Token
app.post('/api/error-credentials/:id/refresh', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const errorCred = await store.getErrorById(id);

        if (!errorCred) {
            return res.status(404).json({ success: false, error: 'Error credential does not exist' });
        }

        if (!errorCred.refreshToken) {
            return res.status(400).json({ success: false, error: 'This credential has no refreshToken, cannot refresh' });
        }

        // Use unified KiroAPI to refresh Token
        const result = await KiroAPI.refreshToken(errorCred);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: `Token refresh failed: ${result.error}`
            });
        }

        // Refresh successful, restore to normal table
        const newId = await store.restoreFromError(id, result.accessToken, result.refreshToken, result.expiresAt);
        // console.log(`Error credential ${id} refresh successful, restored to normal table, new ID: ${newId}`);

        res.json({
            success: true,
            data: {
                message: 'Token refresh successful, credential restored',
                newId,
                expiresAt: result.expiresAt
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Token refresh failed: ${error.message}`
        });
    }
});

// Delete error credential
app.delete('/api/error-credentials/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await store.deleteError(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Manually restore error credential (without refreshing token)
app.post('/api/error-credentials/:id/restore', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const errorCred = await store.getErrorById(id);

        if (!errorCred) {
            return res.status(404).json({ success: false, error: 'Error credential does not exist' });
        }

        const newId = await store.restoreFromError(id);
        res.json({
            success: true,
            data: { message: 'Credential restored', newId }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refresh error credential's usage (restore to normal table if successful)
app.get('/api/error-credentials/:id/usage', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const errorCred = await store.getErrorById(id);

        if (!errorCred) {
            return res.status(404).json({ success: false, error: 'Error credential does not exist' });
        }

        // Create temporary client to get usage
        const client = new KiroClient({
            accessToken: errorCred.accessToken,
            refreshToken: errorCred.refreshToken,
            profileArn: errorCred.profileArn,
            region: errorCred.region || 'us-east-1'
        });

        const usage = await client.getUsageLimits();

        // Usage fetch successful, account is normal, restore to normal table
        const newId = await store.restoreFromError(id);
        // console.log(`[${getTimestamp()}] Error credential ${id} usage fetch successful, restored to normal table, new ID: ${newId}`);

        res.json({
            success: true,
            data: usage,
            restored: true,
            newId: newId,
            message: 'Usage fetch successful, account restored to normal list'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to get usage: ${error.message}`
        });
    }
});

// ============ Gemini Antigravity Credential Management ============
// Routes extracted to gemini/gemini-routes.js, initialized in start()

// ============ Model Pricing Management ============

// Get pricing info and statistics
app.get('/api/pricing/info', authMiddleware, async (req, res) => {
    try {
        const pricingInfo = await getPricingInfo();
        res.json({ success: true, data: pricingInfo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all pricing configurations
app.get('/api/pricing', authMiddleware, async (req, res) => {
    try {
        const pricing = await pricingStore.getAll();
        res.json({ success: true, data: pricing });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single pricing configuration
app.get('/api/pricing/:id', authMiddleware, async (req, res) => {
    try {
        const pricing = await pricingStore.getById(parseInt(req.params.id));
        if (!pricing) {
            return res.status(404).json({ success: false, error: 'Pricing configuration does not exist' });
        }
        res.json({ success: true, data: pricing });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add pricing configuration
app.post('/api/pricing', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }
        
        const { modelName, displayName, provider, inputPrice, outputPrice, isActive, sortOrder } = req.body;
        
        if (!modelName || inputPrice === undefined || outputPrice === undefined) {
            return res.status(400).json({ success: false, error: 'Model name, input price and output price are required' });
        }
        
        const id = await pricingStore.add({
            modelName,
            displayName,
            provider,
            inputPrice: parseFloat(inputPrice),
            outputPrice: parseFloat(outputPrice),
            isActive,
            sortOrder
        });
        
        // Refresh dynamic pricing cache
        const pricingMap = await pricingStore.getPricingMap();
        setDynamicPricing(pricingMap);
        
        res.json({ success: true, data: { id } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update pricing configuration
app.put('/api/pricing/:id', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }
        
        const id = parseInt(req.params.id);
        const pricing = await pricingStore.getById(id);
        if (!pricing) {
            return res.status(404).json({ success: false, error: 'Pricing configuration does not exist' });
        }
        
        const { modelName, displayName, provider, inputPrice, outputPrice, isActive, sortOrder } = req.body;
        
        await pricingStore.update(id, {
            modelName,
            displayName,
            provider,
            inputPrice: inputPrice !== undefined ? parseFloat(inputPrice) : undefined,
            outputPrice: outputPrice !== undefined ? parseFloat(outputPrice) : undefined,
            isActive,
            sortOrder
        });
        
        // Refresh dynamic pricing cache
        const pricingMap = await pricingStore.getPricingMap();
        setDynamicPricing(pricingMap);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete pricing configuration
app.delete('/api/pricing/:id', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }
        
        const id = parseInt(req.params.id);
        await pricingStore.delete(id);
        
        // Refresh dynamic pricing cache
        const pricingMap = await pricingStore.getPricingMap();
        setDynamicPricing(pricingMap);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Batch import pricing configurations
app.post('/api/pricing/batch-import', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }
        
        const { pricing } = req.body;
        if (!pricing || !Array.isArray(pricing)) {
            return res.status(400).json({ success: false, error: 'Please provide pricing configuration array' });
        }
        
        const results = await pricingStore.batchImport(pricing);
        
        // Refresh dynamic pricing cache
        const pricingMap = await pricingStore.getPricingMap();
        setDynamicPricing(pricingMap);
        
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset to default pricing configuration
app.post('/api/pricing/reset-default', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }
        
        const results = await pricingStore.initDefaultPricing();
        
        // Refresh dynamic pricing cache
        const pricingMap = await pricingStore.getPricingMap();
        setDynamicPricing(pricingMap);
        
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sync pricing from OpenRouter API
app.post('/api/pricing/sync-remote', authMiddleware, async (req, res) => {
    try {
        if (!pricingStore) {
            return res.status(500).json({ success: false, error: 'Pricing store not initialized' });
        }

        // Fetch and import remote pricing
        const { fetchRemotePricing } = await import('./constants.js');
        const result = await fetchRemotePricing(pricingStore);

        // Refresh dynamic pricing cache
        const pricingMap = await pricingStore.getPricingMap();
        setDynamicPricing(pricingMap);

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get remote pricing statistics
app.get('/api/pricing/remote-stats', authMiddleware, async (req, res) => {
    try {
        if (!pricingStore) {
            return res.status(500).json({ success: false, error: 'Pricing store not initialized' });
        }

        const stats = await pricingStore.getRemoteStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Anthropic API Credentials Management ============

// Get all Anthropic credentials
app.get('/api/anthropic/credentials', authMiddleware, async (req, res) => {
    try {
        const credentials = await anthropicStore.getAll();
        res.json({ success: true, data: credentials });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single Anthropic credential
app.get('/api/anthropic/credentials/:id', authMiddleware, async (req, res) => {
    try {
        const credential = await anthropicStore.getById(parseInt(req.params.id));
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        res.json({ success: true, data: credential });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add Anthropic credential
app.post('/api/anthropic/credentials', authMiddleware, async (req, res) => {
    try {
        const { name, email, accessToken, apiBaseUrl } = req.body;

        if (!name || !accessToken) {
            return res.status(400).json({ success: false, error: 'Name and access token are required' });
        }

        // Verify credentials by calling API
        const verification = await verifyAnthropicCredentials(accessToken, apiBaseUrl);
        if (!verification.valid) {
            return res.status(400).json({
                success: false,
                error: `Credential verification failed: ${verification.error}`
            });
        }

        const id = await anthropicStore.add({
            name,
            email,
            accessToken,
            apiBaseUrl: apiBaseUrl || null
        });

        // Save rate limits if available
        if (verification.rateLimits) {
            await anthropicStore.updateRateLimits(id, verification.rateLimits);
        }

        res.json({ success: true, data: { id, rateLimits: verification.rateLimits } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, error: 'Credential with this name already exists' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Anthropic credential
app.put('/api/anthropic/credentials/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, email, accessToken, apiBaseUrl, isActive } = req.body;

        const credential = await anthropicStore.getById(id);
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }

        await anthropicStore.update(id, { name, email, accessToken, apiBaseUrl, isActive });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Anthropic credential API base URL
app.put('/api/anthropic/credentials/:id/api-url', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { apiBaseUrl } = req.body;

        const credential = await anthropicStore.getById(id);
        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }

        // Validate URL if provided
        if (apiBaseUrl) {
            try {
                new URL(apiBaseUrl);
            } catch (e) {
                return res.status(400).json({ success: false, error: 'Invalid URL format' });
            }
        }

        await anthropicStore.updateApiBaseUrl(id, apiBaseUrl);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete Anthropic credential
app.delete('/api/anthropic/credentials/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const deleted = await anthropicStore.delete(id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test Anthropic credential
app.post('/api/anthropic/credentials/:id/test', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const credential = await anthropicStore.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }

        const verification = await verifyAnthropicCredentials(credential.accessToken, credential.apiBaseUrl);

        if (verification.valid && verification.rateLimits) {
            await anthropicStore.updateRateLimits(id, verification.rateLimits);
        }

        res.json({ success: true, data: verification });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Anthropic error credentials
app.get('/api/anthropic/error-credentials', authMiddleware, async (req, res) => {
    try {
        const credentials = await anthropicStore.getErrorCredentials();
        res.json({ success: true, data: credentials });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Recover Anthropic error credential
app.post('/api/anthropic/error-credentials/:id/recover', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const newId = await anthropicStore.recoverFromError(id);
        if (!newId) {
            return res.status(404).json({ success: false, error: 'Error credential not found' });
        }
        res.json({ success: true, data: { newId } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete Anthropic error credential
app.delete('/api/anthropic/error-credentials/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const deleted = await anthropicStore.deleteErrorCredential(id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Error credential not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Anthropic supported models
app.get('/api/anthropic/models', authMiddleware, async (req, res) => {
    try {
        res.json({ success: true, data: ANTHROPIC_MODELS });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Gemini Quota Management ============

// Get all Gemini credentials with quota info
app.get('/api/gemini/quotas', authMiddleware, async (req, res) => {
    try {
        const credentials = await geminiStore.getAll();
        const quotaData = credentials.map(cred => ({
            id: cred.id,
            name: cred.name,
            email: cred.email,
            isActive: cred.isActive,
            quotaData: cred.quotaData,
            quotaUpdatedAt: cred.quotaUpdatedAt,
            errorCount: cred.errorCount
        }));
        res.json({ success: true, data: quotaData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get quota for a specific credential
app.get('/api/gemini/credentials/:id/quota', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const credential = await geminiStore.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }

        res.json({
            success: true,
            data: {
                id: credential.id,
                name: credential.name,
                quotaData: credential.quotaData,
                quotaUpdatedAt: credential.quotaUpdatedAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refresh quota for a specific credential
app.post('/api/gemini/credentials/:id/refresh-quota', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let credential = await geminiStore.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential not found' });
        }

        // Create Antigravity service instance
        const service = new AntigravityApiService({
            oauthCredsFilePath: null,
            projectId: credential.projectId
        });

        // Load credentials
        service.authClient.setCredentials({
            access_token: credential.accessToken,
            refresh_token: credential.refreshToken,
            expiry_date: credential.expiresAt ? new Date(credential.expiresAt).getTime() : null
        });

        service.projectId = credential.projectId;
        service.isInitialized = true;

        // Refresh token if expired or about to expire
        const expiryDate = credential.expiresAt ? new Date(credential.expiresAt).getTime() : 0;
        const now = Date.now();
        if (!expiryDate || expiryDate < now + 5 * 60 * 1000) {
            console.log(`[Quota] Token expired or expiring soon for credential ${id}, refreshing...`);
            const newTokens = await service.refreshToken();
            if (newTokens) {
                await geminiStore.update(id, {
                    accessToken: newTokens.accessToken,
                    refreshToken: newTokens.refreshToken,
                    expiresAt: newTokens.expiresAt
                });
                credential = await geminiStore.getById(id);
            }
        }

        // Fetch quotas
        const quotaResult = await service.getModelsWithQuotas();

        // Transform to quota data format
        const quotaData = {};
        for (const [modelId, modelInfo] of Object.entries(quotaResult.models)) {
            quotaData[modelId] = {
                remainingFraction: modelInfo.remaining,
                resetTime: modelInfo.resetTime
            };
        }

        // Update in database
        await geminiStore.updateQuota(id, quotaData);

        res.json({
            success: true,
            data: {
                quotaData,
                lastUpdated: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error(`[Quota] Failed to refresh quota for credential ${req.params.id}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Refresh quotas for all active credentials
app.post('/api/gemini/refresh-all-quotas', authMiddleware, async (req, res) => {
    try {
        const credentials = await geminiStore.getAllActive();
        const results = [];

        for (const credential of credentials) {
            try {
                const service = new AntigravityApiService({
                    oauthCredsFilePath: null,
                    projectId: credential.projectId
                });

                service.authClient.setCredentials({
                    access_token: credential.accessToken,
                    refresh_token: credential.refreshToken,
                    expiry_date: credential.expiresAt ? new Date(credential.expiresAt).getTime() : null
                });

                service.projectId = credential.projectId;
                service.isInitialized = true;

                const quotaResult = await service.getModelsWithQuotas();

                const quotaData = {};
                for (const [modelId, modelInfo] of Object.entries(quotaResult.models)) {
                    quotaData[modelId] = {
                        remainingFraction: modelInfo.remaining,
                        resetTime: modelInfo.resetTime
                    };
                }

                await geminiStore.updateQuota(credential.id, quotaData);

                results.push({
                    id: credential.id,
                    name: credential.name,
                    success: true,
                    models: Object.keys(quotaData).length
                });
            } catch (error) {
                results.push({
                    id: credential.id,
                    name: credential.name,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            data: {
                total: credentials.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get account limits summary (quota overview)
app.get('/api/gemini/account-limits', authMiddleware, async (req, res) => {
    try {
        const { modelId } = req.query;
        const credentials = await geminiStore.getAllActive();

        const limits = credentials.map(cred => {
            const quotaInfo = cred.quotaData || {};
            let modelQuota = null;

            if (modelId && quotaInfo[modelId]) {
                modelQuota = quotaInfo[modelId];
            }

            return {
                id: cred.id,
                name: cred.name,
                email: cred.email,
                isActive: cred.isActive,
                errorCount: cred.errorCount,
                quotaUpdatedAt: cred.quotaUpdatedAt,
                models: Object.keys(quotaInfo).map(model => ({
                    model,
                    remainingFraction: quotaInfo[model]?.remainingFraction,
                    remainingPercent: quotaInfo[model]?.remainingFraction != null
                        ? Math.round(quotaInfo[model].remainingFraction * 100)
                        : null,
                    resetTime: quotaInfo[model]?.resetTime
                })),
                selectedModelQuota: modelQuota
            };
        });

        res.json({ success: true, data: limits });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ API Log Management ============

// Get error log list (status code >= 400)
app.get('/api/error-logs', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { page = 1, pageSize = 50, startDate, endDate } = req.query;

        const result = await apiLogStore.getErrorLogs({
            page: parseInt(page),
            pageSize: parseInt(pageSize),
            startDate,
            endDate
        });

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get log list (paginated)
app.get('/api/logs', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { page = 1, pageSize = 50, apiKeyId, ipAddress, startDate, endDate } = req.query;

        const result = await apiLogStore.getAll({
            page: parseInt(page),
            pageSize: parseInt(pageSize),
            apiKeyId: apiKeyId ? parseInt(apiKeyId) : undefined,
            ipAddress,
            startDate,
            endDate
        });

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single log details
app.get('/api/logs/:requestId', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const log = await apiLogStore.getByRequestId(req.params.requestId);
        if (!log) {
            return res.status(404).json({ success: false, error: 'Log does not exist' });
        }

        res.json({ success: true, data: log });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get log statistics
app.get('/api/logs-stats', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { startDate, endDate, apiKeyId } = req.query;

        const stats = await apiLogStore.getStats({
            startDate,
            endDate,
            apiKeyId: apiKeyId ? parseInt(apiKeyId) : undefined
        });

        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Statistics by IP
app.get('/api/logs-stats/by-ip', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { startDate, endDate, limit = 20 } = req.query;

        const stats = await apiLogStore.getStatsByIp({
            startDate,
            endDate,
            limit: parseInt(limit)
        });

        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Manually clean old logs
app.post('/api/logs/cleanup', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { daysToKeep = 30 } = req.body;
        await apiLogStore.cleanOldLogs(parseInt(daysToKeep));

        res.json({ success: true, data: { message: `Cleaned logs older than ${daysToKeep} days` } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete single log entry
app.delete('/api/logs/:id', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const id = parseInt(req.params.id);
        await apiLogStore.delete(id);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get usage statistics for all API Keys
app.get('/api/logs-stats/by-api-key', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { startDate, endDate } = req.query;

        const stats = await apiLogStore.getStatsByApiKey({
            startDate,
            endDate
        });

        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get API Key cost statistics (grouped by model)
app.get('/api/keys/:id/cost', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { startDate, endDate } = req.query;

        // Check permission: admin or key owner
        const keys = await apiKeyStore.getByUserId(req.userId);
        const key = keys.find(k => k.id === id);
        if (!key && !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'No permission to view this key cost' });
        }

        // Get statistics grouped by model
        const modelStats = await apiLogStore.getStatsByModel(id, { startDate, endDate });

        // Calculate cost for each model
        let totalInputCost = 0;
        let totalOutputCost = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        const modelCosts = modelStats.map(stat => {
            const cost = calculateTokenCost(stat.model, stat.inputTokens, stat.outputTokens);
            totalInputCost += cost.inputCost;
            totalOutputCost += cost.outputCost;
            totalInputTokens += stat.inputTokens;
            totalOutputTokens += stat.outputTokens;

            return {
                model: stat.model,
                requestCount: stat.requestCount,
                inputTokens: stat.inputTokens,
                outputTokens: stat.outputTokens,
                inputCost: cost.inputCost,
                outputCost: cost.outputCost,
                totalCost: cost.totalCost
            };
        });

        res.json({
            success: true,
            data: {
                models: modelCosts,
                summary: {
                    totalRequests: modelCosts.reduce((sum, m) => sum + m.requestCount, 0),
                    totalInputTokens,
                    totalOutputTokens,
                    totalInputCost,
                    totalOutputCost,
                    totalCost: totalInputCost + totalOutputCost
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get cost statistics summary for all API Keys
app.get('/api/logs-stats/cost', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { startDate, endDate } = req.query;

        // Get all logs grouped by model
        const modelStats = await apiLogStore.getAllStatsByModel({ startDate, endDate });

        // Calculate cost
        let totalInputCost = 0;
        let totalOutputCost = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        const modelCosts = modelStats.map(stat => {
            const cost = calculateTokenCost(stat.model, stat.inputTokens, stat.outputTokens);
            totalInputCost += cost.inputCost;
            totalOutputCost += cost.outputCost;
            totalInputTokens += stat.inputTokens;
            totalOutputTokens += stat.outputTokens;

            return {
                model: stat.model,
                requestCount: stat.requestCount,
                inputTokens: stat.inputTokens,
                outputTokens: stat.outputTokens,
                inputCost: cost.inputCost,
                outputCost: cost.outputCost,
                totalCost: cost.totalCost
            };
        });

        // Statistics by API Key
        const keyStats = await apiLogStore.getCostByApiKey({ startDate, endDate });
        const keyCosts = [];
        for (const stat of keyStats) {
            const keyModelStats = await apiLogStore.getStatsByModel(stat.apiKeyId, { startDate, endDate });
            let keyCost = 0;
            keyModelStats.forEach(ms => {
                keyCost += calculateTokenCost(ms.model, ms.inputTokens, ms.outputTokens).totalCost;
            });

            keyCosts.push({
                apiKeyId: stat.apiKeyId,
                apiKeyPrefix: stat.apiKeyPrefix,
                apiKeyName: stat.apiKeyName,
                requestCount: stat.requestCount,
                inputTokens: stat.inputTokens,
                outputTokens: stat.outputTokens,
                totalCost: keyCost
            });
        }

        res.json({
            success: true,
            data: {
                byModel: modelCosts,
                byApiKey: keyCosts,
                summary: {
                    totalRequests: modelCosts.reduce((sum, m) => sum + m.requestCount, 0),
                    totalInputTokens,
                    totalOutputTokens,
                    totalInputCost,
                    totalOutputCost,
                    totalCost: totalInputCost + totalOutputCost
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get usage statistics for a single API Key
app.get('/api/keys/:id/usage', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { startDate, endDate } = req.query;

        // Check permission: admin or key owner
        const keys = await apiKeyStore.getByUserId(req.userId);
        const key = keys.find(k => k.id === id);
        if (!key && !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'No permission to view this key usage' });
        }

        const stats = await apiLogStore.getStatsForApiKey(id, {
            startDate,
            endDate
        });

        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get usage statistics by date (for charts)
app.get('/api/logs-stats/by-date', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { startDate, endDate, apiKeyId } = req.query;

        const stats = await apiLogStore.getStatsByDate({
            startDate,
            endDate,
            apiKeyId: apiKeyId ? parseInt(apiKeyId) : undefined
        });

        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get usage statistics by time interval (default 20 minutes)
app.get('/api/logs-stats/by-interval', authMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin permission required' });
        }

        const { startDate, endDate, apiKeyId, interval } = req.query;

        const stats = await apiLogStore.getStatsByTimeInterval({
            startDate,
            endDate,
            apiKeyId: apiKeyId ? parseInt(apiKeyId) : undefined,
            intervalMinutes: interval ? parseInt(interval) : 20
        });

        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Streaming conversation
app.post('/api/chat/:id', async (req, res) => {
    const credentialId = parseInt(req.params.id);
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const selectedModel = req.body.model || 'claude-sonnet-4-20250514';

    // Log data for API logging
    const logData = {
        requestId,
        endpoint: '/api/chat/:id',
        method: 'POST',
        model: selectedModel,
        provider: 'kiro',
        clientIp: req.ip || req.connection.remoteAddress,
        statusCode: 200,
        isStream: true,
        source: 'chat-page'
    };

    let outputContent = '';

    try {
        const credential = await store.getById(credentialId);

        if (!credential) {
            logData.statusCode = 404;
            logData.errorMessage = 'Credential does not exist';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(404).json({ success: false, error: 'Credential does not exist' });
        }

        logData.credentialId = credential.id;
        logData.credentialName = credential.name || credential.email;

        const { message, model, history, skipTokenRefresh } = req.body;

        if (!message) {
            logData.statusCode = 400;
            logData.errorMessage = 'Message content is required';
            await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            return res.status(400).json({ success: false, error: 'Message content is required' });
        }

        // Estimate input tokens
        const inputText = (history || []).map(m => m.content).join('') + message;
        logData.inputTokens = Math.ceil(inputText.length / 4);

        // Acquire credential lock (if credential in use, will queue and wait)
        await acquireCredentialLock(credentialId);

        const client = new KiroClient({
            accessToken: credential.accessToken,
            refreshToken: credential.refreshToken,
            profileArn: credential.profileArn,
            region: credential.region,
            authMethod: credential.authMethod,
            clientId: credential.clientId,
            clientSecret: credential.clientSecret,
            expiresAt: credential.expiresAt
        });

        // Build message array
        const messages = [];
        if (history && Array.isArray(history)) {
            messages.push(...history);
        }
        messages.push({ role: 'user', content: message });

        // Set SSE response headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Stream output
        for await (const event of client.chatStream(messages, selectedModel, { skipTokenRefresh: skipTokenRefresh !== false })) {
            if (event.type === 'content') {
                outputContent += event.content;
                res.write(`data: ${JSON.stringify({ content: event.content })}\n\n`);
            }
        }

        // Release credential lock
        releaseCredentialLock(credentialId);

        // Estimate output tokens and log
        logData.outputTokens = Math.ceil(outputContent.length / 4);
        logData.durationMs = Date.now() - startTime;
        await apiLogStore.create(logData);

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    } catch (error) {
        // Release credential lock
        releaseCredentialLock(credentialId);

        logData.statusCode = 500;
        logData.errorMessage = error.message;
        logData.durationMs = Date.now() - startTime;
        await apiLogStore.create(logData);

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: `Conversation failed: ${error.message}`
            });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

// Non-streaming conversation
app.post('/api/chat/:id/sync', async (req, res) => {
    const credentialId = parseInt(req.params.id);

    try {
        const credential = await store.getById(credentialId);

        if (!credential) {
            return res.status(404).json({ success: false, error: 'Credential does not exist' });
        }

        const { message, model, history, skipTokenRefresh } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, error: 'Message content is required' });
        }

        // Acquire credential lock (if credential in use, will queue and wait)
        await acquireCredentialLock(credentialId);

        const client = new KiroClient({
            accessToken: credential.accessToken,
            refreshToken: credential.refreshToken,
            profileArn: credential.profileArn,
            region: credential.region,
            authMethod: credential.authMethod,
            clientId: credential.clientId,
            clientSecret: credential.clientSecret,
            expiresAt: credential.expiresAt
        });

        // Build message array
        const messages = [];
        if (history && Array.isArray(history)) {
            messages.push(...history);
        }
        messages.push({ role: 'user', content: message });

        const response = await client.chat(messages, model || 'claude-sonnet-4-20250514', { skipTokenRefresh: skipTokenRefresh !== false });

        // Release credential lock
        releaseCredentialLock(credentialId);

        res.json({
            success: true,
            data: { response }
        });
    } catch (error) {
        // Release credential lock
        releaseCredentialLock(credentialId);

        res.status(500).json({
            success: false,
            error: `Conversation failed: ${error.message}`
        });
    }
});

// ============ Public API (no login required) ============

// Public API Key usage query
app.post('/api/public/usage', async (req, res) => {
    try {
        const { apiKey } = req.body;

        if (!apiKey) {
            return res.status(400).json({ success: false, error: 'Please provide API key' });
        }

        // Validate API key
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const keyRecord = await apiKeyStore.getByKeyHash(keyHash);

        if (!keyRecord) {
            return res.status(404).json({ success: false, error: 'API key does not exist or is disabled' });
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        // Get usage for each time period
        const dailyStats = await apiLogStore.getStatsForApiKey(keyRecord.id, { startDate: todayStart });
        const monthlyStats = await apiLogStore.getStatsForApiKey(keyRecord.id, { startDate: monthStart });
        const totalStats = await apiLogStore.getStatsForApiKey(keyRecord.id, {});

        // Calculate cost
        const dailyCost = await calculateApiKeyCost(keyRecord.id, { startDate: todayStart });
        const monthlyCost = await calculateApiKeyCost(keyRecord.id, { startDate: monthStart });
        const totalCost = await calculateApiKeyCost(keyRecord.id, {});

        // Get statistics grouped by model
        const modelStats = await apiLogStore.getStatsByModel(keyRecord.id, {});
        const modelCosts = modelStats.map(stat => {
            const cost = calculateTokenCost(stat.model, stat.inputTokens, stat.outputTokens);
            return {
                model: stat.model,
                requestCount: stat.requestCount,
                inputTokens: stat.inputTokens,
                outputTokens: stat.outputTokens,
                inputCost: cost.inputCost,
                outputCost: cost.outputCost,
                totalCost: cost.totalCost
            };
        });

        // Calculate remaining days until expiration and expiration date
        let remainingDays = null;
        let expireDate = null;
        if (keyRecord.expiresInDays > 0 && keyRecord.createdAt) {
            const createDate = new Date(keyRecord.createdAt);
            expireDate = new Date(createDate.getTime() + keyRecord.expiresInDays * 24 * 60 * 60 * 1000);
            remainingDays = Math.max(0, Math.ceil((expireDate - now) / (24 * 60 * 60 * 1000)));
        }

        res.json({
            success: true,
            data: {
                keyInfo: {
                    keyPrefix: keyRecord.keyPrefix,
                    name: keyRecord.name,
                    isActive: keyRecord.isActive,
                    createdAt: keyRecord.createdAt,
                    lastUsedAt: keyRecord.lastUsedAt
                },
                usage: {
                    daily: dailyStats.requestCount,
                    monthly: monthlyStats.requestCount,
                    total: totalStats.requestCount,
                    dailyCost,
                    monthlyCost,
                    totalCost
                },
                cost: {
                    models: modelCosts,
                    summary: {
                        totalRequests: totalStats.requestCount,
                        totalInputTokens: totalStats.totalInputTokens,
                        totalOutputTokens: totalStats.totalOutputTokens,
                        totalCost
                    }
                },
                limits: {
                    dailyLimit: keyRecord.dailyLimit,
                    monthlyLimit: keyRecord.monthlyLimit,
                    totalLimit: keyRecord.totalLimit,
                    dailyCostLimit: keyRecord.dailyCostLimit,
                    monthlyCostLimit: keyRecord.monthlyCostLimit,
                    totalCostLimit: keyRecord.totalCostLimit,
                    expiresInDays: keyRecord.expiresInDays,
                    remainingDays,
                    expireDate: formatLocalDateTime(expireDate)
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Default admin account configuration
const DEFAULT_ADMIN = {
    username: 'admin',
    password: 'admin123'
};

// Start server
async function start() {
    // Initialize database
    await initDatabase();
    store = await CredentialStore.create();
    userStore = await UserStore.create();
    apiKeyStore = await ApiKeyStore.create();
    apiLogStore = await ApiLogStore.create();
    geminiStore = await GeminiCredentialStore.create();
    orchidsStore = await OrchidsCredentialStore.create();
    orchidsLoadBalancer = await getOrchidsLoadBalancer(orchidsStore);
    warpStore = await WarpCredentialStore.create();
    warpService = new WarpService(warpStore);
    siteSettingsStore = await SiteSettingsStore.create();

    // Load system settings from database
    await loadSystemSettings();

    pricingStore = await ModelPricingStore.create();
    anthropicStore = await AnthropicCredentialStore.create();
    modelAliasStore = await ModelAliasStore.create();

    // Initialize selection module stores
    accountHealthStore = await AccountHealthStore.create();
    tokenBucketStore = await TokenBucketStore.create();
    selectionConfigStore = await SelectionConfigStore.create();
    thinkingSignatureCacheStore = await ThinkingSignatureCacheStore.create();
    sessionStore = await SessionStore.create();
    thinkingBlocksParser = new ThinkingBlocksParser(thinkingSignatureCacheStore, SELECTION_CONFIG.thinking);

    // Initialize strategy manager with stores
    const strategyManager = getStrategyManager();
    strategyManager.initialize({
        healthStore: accountHealthStore,
        tokenStore: tokenBucketStore,
        configStore: selectionConfigStore
    });

    console.log(`[${getTimestamp()}] Selection module initialized (strategy: ${SELECTION_CONFIG.defaultStrategy})`);

    // Load dynamic pricing configuration
    try {
        const pricingMap = await pricingStore.getPricingMap();
        if (Object.keys(pricingMap).length > 0) {
            setDynamicPricing(pricingMap);
            console.log(`[${getTimestamp()}] Loaded ${Object.keys(pricingMap).length} model pricing configurations`);
        } else {
            // If no configuration, initialize default pricing
            console.log(`[${getTimestamp()}] Initializing default model pricing configuration...`);
            await pricingStore.initDefaultPricing();
            const newPricingMap = await pricingStore.getPricingMap();
            setDynamicPricing(newPricingMap);
            console.log(`[${getTimestamp()}] Initialized ${Object.keys(newPricingMap).length} default pricing configurations`);
        }
    } catch (err) {
        console.error(`[${getTimestamp()}] Failed to load pricing configuration:`, err.message);
    }

    // Set pricing store for remote pricing sync (uses unified model_pricing table)
    setRemotePricingStore(pricingStore);

    // Initialize remote pricing (non-blocking, syncs remote prices to model_pricing table)
    initializeRemotePricing().then(async () => {
        const stats = await pricingStore.getRemoteStats();
        console.log(`[${getTimestamp()}] Pricing: ${stats.total} models (remote: ${stats.remote}, default: ${stats.default}, custom: ${stats.custom})`);
    }).catch(() => {
        console.log(`[${getTimestamp()}] Using database/static pricing only`);
    });

    // Auto-create default admin account (if no users exist)
    if (!await userStore.hasUsers()) {
        const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
        await userStore.create(DEFAULT_ADMIN.username, passwordHash, true);
        // console.log(`[${getTimestamp()}] Created default admin account`);
        // console.log(`[${getTimestamp()}] Username: ${DEFAULT_ADMIN.username}`);
        // console.log(`[${getTimestamp()}] Password: ${DEFAULT_ADMIN.password}`);
        // console.log(`[${getTimestamp()}] Please change the password after login!`);
    }

    // Setup Orchids routes
    setupOrchidsRoutes(app, orchidsStore);

    // Setup Warp routes
    await setupWarpRoutes(app, warpStore, warpService, apiKeyStore);

    // Setup Warp multi-agent routes
    const warpMultiAgentService = setupWarpMultiAgentRoutes(app, warpStore);
    // console.log(`[${getTimestamp()}] Warp multi-agent service started`);

    // Setup Warp proxy routes (one-to-one forwarding)
    setupWarpProxyRoutes(app, warpStore);
    // console.log(`[${getTimestamp()}] Warp proxy service started`);

    // Setup Gemini routes
    setupGeminiRoutes(app, geminiStore, getTimestamp, apiLogStore);

    // Setup Vertex AI routes
    await setupVertexRoutes(app);

    // Setup Bedrock routes
    app.use('/api/bedrock', bedrockRoutes);
    console.log(`[${getTimestamp()}] Bedrock service started`);

    // Start scheduled refresh tasks
    startUnifiedTokenRefreshTask(); // All providers token refresh
    startUnifiedQuotaRefreshTask({
        kiro: store,
        gemini: geminiStore,
        orchids: orchidsStore,
        warp: warpStore,
        anthropic: anthropicStore
    }, getQuotaRefreshInterval); // Dynamic interval from settings

    // Start log cleanup task (clean logs older than 30 days daily)
    startLogCleanupTask();

    const PORT = process.env.PORT || 13004;
    app.listen(PORT, () => {
        console.log(`[${getTimestamp()}] Kiro API Server started | http://localhost:${PORT}`);
        console.log('[API] Supported endpoints:');
        console.log('[API]   Claude format:  /v1/messages');
        console.log('[API]   OpenAI format:  /v1/chat/completions');
        console.log('[API]   Gemini format:  /gemini-antigravity/v1/messages');
        console.log('[API]   Orchids format: /orchids/v1/messages');
        console.log('[API]   Warp format:    /w/v1/messages');
        console.log('[API]   Vertex format:  /vertex/v1/messages');
        console.log('[API]   Bedrock format: /api/bedrock/chat');
        console.log('[API]   Model list:     /v1/models');
    });
}

/**
 * Start log cleanup task
 */
function startLogCleanupTask() {
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Execute every 24 hours
    const DAYS_TO_KEEP = 30; // Keep 30 days of logs

    // console.log(`[${getTimestamp()}] [Log Cleanup] Task started, cleaning logs older than ${DAYS_TO_KEEP} days every 24 hours`);

    setInterval(async () => {
        try {
            await apiLogStore.cleanOldLogs(DAYS_TO_KEEP);
            // console.log(`[${getTimestamp()}] [Log Cleanup] Cleaned logs older than ${DAYS_TO_KEEP} days`);
        } catch (error) {
            console.error(`[${getTimestamp()}] [Log Cleanup] Cleanup failed: ${error.message}`);
        }
    }, CLEANUP_INTERVAL);
}

/**
 * Get current timestamp string
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// ============ Unified Token Refresh Task (All Providers) ============

/**
 * Check if token is expiring soon (uses dynamic threshold from settings)
 */
function isTokenExpiringSoon(expiresAt, minutes = null) {
    const threshold = minutes !== null ? minutes : getTokenRefreshThreshold();
    if (!expiresAt) return false;
    try {
        const expirationTime = new Date(expiresAt);
        const currentTime = new Date();
        const thresholdTime = new Date(currentTime.getTime() + threshold * 60 * 1000);
        return expirationTime.getTime() <= thresholdTime.getTime();
    } catch {
        return false;
    }
}

/**
 * Refresh Kiro credential token
 */
async function refreshKiroCredential(credential) {
    const region = credential.region || KIRO_CONSTANTS.DEFAULT_REGION;

    try {
        let newAccessToken, newRefreshToken, expiresAt;

        if (credential.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
            const refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', region);
            const response = await axios.post(refreshUrl, {
                refreshToken: credential.refreshToken
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            newAccessToken = response.data.accessToken;
            newRefreshToken = response.data.refreshToken || credential.refreshToken;
            expiresAt = response.data.expiresAt || null;
        } else if (credential.authMethod === KIRO_CONSTANTS.AUTH_METHOD_BUILDER_ID || credential.authMethod === KIRO_CONSTANTS.AUTH_METHOD_IDC) {
            if (!credential.clientId || !credential.clientSecret) {
                return false;
            }

            const refreshUrl = KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', region);
            const response = await axios.post(refreshUrl, {
                refreshToken: credential.refreshToken,
                clientId: credential.clientId,
                clientSecret: credential.clientSecret,
                grantType: 'refresh_token'
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            newAccessToken = response.data.accessToken;
            newRefreshToken = response.data.refreshToken || credential.refreshToken;
            expiresAt = response.data.expiresIn
                ? new Date(Date.now() + response.data.expiresIn * 1000).toISOString()
                : null;
        }

        await store.update(credential.id, {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresAt
        });

        return true;
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
        try {
            await store.moveToError(credential.id, errorMsg);
        } catch { /* ignore */ }
        return false;
    }
}

/**
 * Refresh Kiro error credential token
 */
async function refreshKiroErrorCredential(errorCred) {
    const region = errorCred.region || KIRO_CONSTANTS.DEFAULT_REGION;

    try {
        let newAccessToken, newRefreshToken, expiresAt;

        if (errorCred.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
            const refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', region);
            const response = await axios.post(refreshUrl, {
                refreshToken: errorCred.refreshToken
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            newAccessToken = response.data.accessToken;
            newRefreshToken = response.data.refreshToken || errorCred.refreshToken;
            expiresAt = response.data.expiresAt || null;
        } else {
            if (!errorCred.clientId || !errorCred.clientSecret) {
                return false;
            }

            const refreshUrl = errorCred.authMethod === KIRO_CONSTANTS.AUTH_METHOD_IDC
                ? KIRO_CONSTANTS.REFRESH_SSO_OIDC_URL.replace('{{region}}', region)
                : KIRO_CONSTANTS.REFRESH_IDC_URL.replace('{{region}}', region);

            const response = await axios.post(refreshUrl, {
                refreshToken: errorCred.refreshToken,
                clientId: errorCred.clientId,
                clientSecret: errorCred.clientSecret,
                grantType: 'refresh_token'
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            newAccessToken = response.data.accessToken;
            newRefreshToken = response.data.refreshToken || errorCred.refreshToken;
            expiresAt = response.data.expiresIn
                ? new Date(Date.now() + response.data.expiresIn * 1000).toISOString()
                : null;
        }

        // Verify usage endpoint
        const usageResult = await KiroAPI.getUsageLimits({
            accessToken: newAccessToken,
            profileArn: errorCred.profileArn,
            authMethod: errorCred.authMethod,
            region: region
        });

        if (!usageResult.success) {
            store.updateErrorToken(errorCred.id, newAccessToken, newRefreshToken, expiresAt);
            return false;
        }

        await store.restoreFromError(errorCred.id, newAccessToken, newRefreshToken, expiresAt);
        return true;
    } catch {
        return false;
    }
}

/**
 * Refresh Gemini credential token
 */
async function refreshGeminiCredential(credential) {
    try {
        const result = await refreshGeminiToken(credential.refreshToken);
        if (result.accessToken) {
            await geminiStore.update(credential.id, {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken || credential.refreshToken,
                expiresAt: result.expiresAt
            });
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Refresh Warp credential token
 */
async function refreshWarpCredential(credential) {
    try {
        const result = await refreshAccessToken(credential.refreshToken);
        if (result.success && result.accessToken) {
            await warpStore.updateToken(credential.id, result.accessToken, result.expiresAt);
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Run unified token refresh for all providers
 */
async function runUnifiedTokenRefresh() {
    const stats = { kiro: { refreshed: 0, total: 0 }, kiroError: { refreshed: 0, total: 0 }, gemini: { refreshed: 0, total: 0 }, warp: { refreshed: 0, total: 0 } };
    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // 1. Refresh Kiro normal credentials
    try {
        const kiroCredentials = await store.getAll();
        for (const cred of kiroCredentials) {
            if (cred.refreshToken && isTokenExpiringSoon(cred.expiresAt)) {
                stats.kiro.total++;
                if (await refreshKiroCredential(cred)) {
                    stats.kiro.refreshed++;
                }
                await delay(1000);
            }
        }
    } catch { /* ignore */ }

    // 2. Refresh Kiro error credentials
    try {
        const errorCredentials = await store.getAllErrors();
        for (const errorCred of errorCredentials) {
            if (errorCred.refreshToken) {
                stats.kiroError.total++;
                if (await refreshKiroErrorCredential(errorCred)) {
                    stats.kiroError.refreshed++;
                }
                await delay(1000);
            }
        }
    } catch { /* ignore */ }

    // 3. Refresh Gemini credentials
    try {
        const geminiCredentials = await geminiStore.getAll();
        for (const cred of geminiCredentials) {
            if (cred.refreshToken && isTokenExpiringSoon(cred.expiresAt)) {
                stats.gemini.total++;
                if (await refreshGeminiCredential(cred)) {
                    stats.gemini.refreshed++;
                }
                await delay(1000);
            }
        }
    } catch { /* ignore */ }

    // 4. Refresh Warp credentials
    try {
        const warpCredentials = await warpStore.getAll();
        for (const cred of warpCredentials) {
            if (cred.refreshToken && cred.accessToken && isTokenExpired(cred.accessToken, getTokenRefreshThreshold())) {
                stats.warp.total++;
                if (await refreshWarpCredential(cred)) {
                    stats.warp.refreshed++;
                }
                await delay(1000);
            }
        }
    } catch { /* ignore */ }

    // Log summary if any refreshes happened
    const totalRefreshed = stats.kiro.refreshed + stats.kiroError.refreshed + stats.gemini.refreshed + stats.warp.refreshed;
    const totalAttempted = stats.kiro.total + stats.kiroError.total + stats.gemini.total + stats.warp.total;

    if (totalAttempted > 0) {
        const parts = [];
        if (stats.kiro.total > 0) parts.push(`Kiro: ${stats.kiro.refreshed}/${stats.kiro.total}`);
        if (stats.kiroError.total > 0) parts.push(`KiroError: ${stats.kiroError.refreshed}/${stats.kiroError.total}`);
        if (stats.gemini.total > 0) parts.push(`Gemini: ${stats.gemini.refreshed}/${stats.gemini.total}`);
        if (stats.warp.total > 0) parts.push(`Warp: ${stats.warp.refreshed}/${stats.warp.total}`);
        console.log(`[${getTimestamp()}] [Token Refresh] ${parts.join(', ')}`);
    }
}

/**
 * Start unified token refresh task (uses dynamic interval from settings)
 */
function startUnifiedTokenRefreshTask() {
    const interval = systemSettings.tokenRefreshInterval;
    const threshold = systemSettings.tokenRefreshThreshold;
    console.log(`[${getTimestamp()}] [Token Refresh] Task started (interval: ${interval}min, threshold: ${threshold}min)`);

    // Run immediately on startup (after 5 seconds)
    setTimeout(() => runUnifiedTokenRefresh(), 5000);

    // Schedule next run using dynamic interval (re-reads interval each time)
    const scheduleNext = () => {
        setTimeout(async () => {
            await runUnifiedTokenRefresh();
            scheduleNext();
        }, getTokenRefreshInterval());
    };
    scheduleNext();
}

start();

export default app;
