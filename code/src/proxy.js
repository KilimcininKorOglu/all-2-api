/**
 * Proxy Configuration Module
 * Supports HTTP/HTTPS/SOCKS5 proxies
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import { getDatabase } from './db.js';

let proxyConfig = null;
let proxyAgent = null;

/**
 * Parse proxy configuration string
 * Supported formats:
 * - host:port:username:password (ISP format)
 * - http://username:password@host:port
 * - http://host:port
 */
export function parseProxyString(proxyStr) {
    if (!proxyStr || proxyStr.trim() === '') {
        return null;
    }

    proxyStr = proxyStr.trim();

    // If already in URL format
    if (proxyStr.startsWith('http://') || proxyStr.startsWith('https://')) {
        return proxyStr;
    }

    // ISP format: host:port:username:password
    const parts = proxyStr.split(':');
    if (parts.length === 4) {
        const [host, port, username, password] = parts;
        return `http://${username}:${password}@${host}:${port}`;
    } else if (parts.length === 2) {
        const [host, port] = parts;
        return `http://${host}:${port}`;
    }

    // Cannot parse, return original string
    return proxyStr;
}

/**
 * Create proxy Agent
 */
export function createProxyAgent(proxyUrl) {
    if (!proxyUrl) {
        return null;
    }
    return new HttpsProxyAgent(proxyUrl);
}

/**
 * Initialize proxy configuration (load from database)
 */
export async function initProxyConfig() {
    try {
        const db = await getDatabase();

        // Ensure settings table exists
        await db.execute(`
            CREATE TABLE IF NOT EXISTS settings (
                \`key\` VARCHAR(255) PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const [rows] = await db.execute('SELECT * FROM settings WHERE `key` = ?', ['proxy_config']);

        if (rows.length > 0) {
            const configStr = rows[0].value;

            if (configStr) {
                proxyConfig = JSON.parse(configStr);
                if (proxyConfig.enabled && proxyConfig.proxyUrl) {
                    const proxyUrl = parseProxyString(proxyConfig.proxyUrl);
                    proxyAgent = createProxyAgent(proxyUrl);
                    console.log('[Proxy] Proxy configuration loaded:', proxyConfig.proxyUrl);
                }
            }
        }
    } catch (error) {
        console.error('Failed to load proxy configuration:', error.message);
    }

    return proxyConfig;
}

/**
 * Get current proxy configuration
 */
export function getProxyConfig() {
    return proxyConfig;
}

/**
 * Get proxy Agent (for axios requests)
 */
export function getProxyAgent() {
    if (!proxyConfig || !proxyConfig.enabled) {
        return null;
    }
    return proxyAgent;
}

/**
 * Save proxy configuration to database
 */
export async function saveProxyConfig(config) {
    const db = await getDatabase();

    // Ensure settings table exists
    await db.execute(`
        CREATE TABLE IF NOT EXISTS settings (
            \`key\` VARCHAR(255) PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const configStr = JSON.stringify(config);

    // Use REPLACE to insert or update
    await db.execute(`
        REPLACE INTO settings (\`key\`, value, updated_at)
        VALUES (?, ?, NOW())
    `, ['proxy_config', configStr]);

    // Update in-memory configuration
    proxyConfig = config;

    if (config.enabled && config.proxyUrl) {
        const proxyUrl = parseProxyString(config.proxyUrl);
        proxyAgent = createProxyAgent(proxyUrl);
        console.log('[Proxy] Proxy configuration saved and enabled:', config.proxyUrl);
    } else {
        proxyAgent = null;
        console.log('[Proxy] Proxy disabled');
    }

    return config;
}

/**
 * Get axios request configuration (including proxy)
 * Prioritize database configuration, fallback to environment variable proxy if not enabled
 */
export function getAxiosProxyConfig() {
    // Prioritize database configured proxy
    const agent = getProxyAgent();
    if (agent) {
        return {
            httpAgent: agent,
            httpsAgent: agent,
            proxy: false  // Disable axios built-in proxy, use agent
        };
    }

    // If database proxy not enabled, try environment variable proxy
    const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
                     process.env.HTTP_PROXY || process.env.http_proxy;
    if (envProxy) {
        const envAgent = createProxyAgent(envProxy);
        if (envAgent) {
            return {
                httpAgent: envAgent,
                httpsAgent: envAgent,
                proxy: false
            };
        }
    }

    return {};
}

/**
 * Test proxy connection
 */
export async function testProxyConnection(proxyUrl) {
    const axios = (await import('axios')).default;
    const testUrl = 'https://httpbin.org/ip';

    try {
        const parsedUrl = parseProxyString(proxyUrl);
        const agent = createProxyAgent(parsedUrl);

        const response = await axios.get(testUrl, {
            httpsAgent: agent,
            proxy: false,
            timeout: 10000
        });

        return {
            success: true,
            ip: response.data.origin,
            message: `Proxy connection successful, exit IP: ${response.data.origin}`
        };
    } catch (error) {
        return {
            success: false,
            message: `Proxy connection failed: ${error.message}`
        };
    }
}

export default {
    parseProxyString,
    createProxyAgent,
    initProxyConfig,
    getProxyConfig,
    getProxyAgent,
    saveProxyConfig,
    getAxiosProxyConfig,
    testProxyConnection
};
