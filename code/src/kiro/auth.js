import crypto from 'crypto';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { KIRO_OAUTH_CONFIG, KIRO_CONSTANTS } from '../constants.js';

/**
 * Generate PKCE code verifier
 */
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate PKCE code challenge
 */
function generateCodeChallenge(codeVerifier) {
    const hash = crypto.createHash('sha256');
    hash.update(codeVerifier);
    return hash.digest('base64url');
}

/**
 * Generate HTML response page
 */
function generateResponsePage(isSuccess, message) {
    const title = isSuccess ? 'Authorization Successful!' : 'Authorization Failed';
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;
               background: ${isSuccess ? '#f0fdf4' : '#fef2f2'}; }
        .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: ${isSuccess ? '#16a34a' : '#dc2626'}; margin-bottom: 16px; }
        p { color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${title}</h1>
        <p>${message}</p>
    </div>
</body>
</html>`;
}

/**
 * Kiro OAuth Authentication Class
 * Supports two authentication methods:
 * 1. Social Auth (Google/GitHub) - Uses HTTP localhost callback
 * 2. Builder ID - Uses Device Code Flow
 */
export class KiroAuth {
    constructor(options = {}) {
        this.region = options.region || KIRO_CONSTANTS.DEFAULT_REGION;
        this.credentialsDir = options.credentialsDir || path.join(os.homedir(), KIRO_OAUTH_CONFIG.credentialsDir);
        this.credentialsFile = options.credentialsFile || KIRO_OAUTH_CONFIG.credentialsFile;
        this.saveToConfigs = options.saveToConfigs || false; // Whether to save to project configs directory
        this.saveToFile = options.saveToFile !== false; // Whether to save to file, default true
        this.onSuccess = options.onSuccess || null; // Authentication success callback function
        this.server = null;
        this.pollingTask = null;
        this._lastCredentialsPath = null; // Record the last saved credentials path
        this._lastCredentials = null; // Record the last obtained credentials
    }

    /**
     * Get credentials file path
     * @param {boolean} forConfigs - Whether to get configs directory path
     */
    getCredentialsPath(forConfigs = false) {
        if (forConfigs || this.saveToConfigs) {
            // Return project configs directory path
            const timestamp = Date.now();
            const folderName = `${timestamp}_kiro-auth-token`;
            return path.join(process.cwd(), 'configs', 'kiro', folderName, `${folderName}.json`);
        }
        return path.join(this.credentialsDir, this.credentialsFile);
    }

    /**
     * Get the last saved credentials path
     */
    getLastCredentialsPath() {
        return this._lastCredentialsPath;
    }

    /**
     * Get the last obtained credentials
     */
    getLastCredentials() {
        return this._lastCredentials;
    }

    /**
     * Save credentials to file
     * @param {object} credentials - Credentials object
     * @param {object} options - Options
     * @param {boolean} options.saveToConfigs - Whether to save to configs directory (overrides constructor setting)
     */
    async saveCredentials(credentials, options = {}) {
        const saveToConfigs = options.saveToConfigs !== undefined ? options.saveToConfigs : this.saveToConfigs;
        const credPath = this.getCredentialsPath(saveToConfigs);

        await fs.mkdir(path.dirname(credPath), { recursive: true });
        await fs.writeFile(credPath, JSON.stringify(credentials, null, 2));

        this._lastCredentialsPath = credPath;
        console.log(`[Kiro Auth] Credentials saved to: ${credPath}`);

        return credPath;
    }

    /**
     * Load credentials
     * @param {string} credPath - Optional, specify credentials file path
     */
    async loadCredentials(credPath = null) {
        try {
            const filePath = credPath || path.join(this.credentialsDir, this.credentialsFile);
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    /**
     * Load all credentials files from configs directory
     * @returns {Promise<Array<{path: string, credentials: object}>>}
     */
    async loadAllConfigCredentials() {
        const configsDir = path.join(process.cwd(), 'configs', 'kiro');
        const results = [];

        try {
            const entries = await fs.readdir(configsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.includes('kiro-auth-token')) {
                    const folderPath = path.join(configsDir, entry.name);
                    const files = await fs.readdir(folderPath);
                    const jsonFile = files.find(f => f.endsWith('.json'));

                    if (jsonFile) {
                        const filePath = path.join(folderPath, jsonFile);
                        try {
                            const content = await fs.readFile(filePath, 'utf8');
                            results.push({
                                path: filePath,
                                relativePath: path.relative(process.cwd(), filePath),
                                credentials: JSON.parse(content)
                            });
                        } catch (e) {
                            console.error(`[Kiro Auth] Failed to read credentials file: ${filePath}`, e.message);
                        }
                    }
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        return results;
    }

    /**
     * Start Social Auth (Google/GitHub)
     * @param {string} provider - 'Google' or 'Github'
     * @returns {Promise<{authUrl: string, port: number}>}
     */
    async startSocialAuth(provider = 'Google') {
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = crypto.randomBytes(16).toString('base64url');

        // Start local callback server
        const port = await this._startCallbackServer(codeVerifier, state);
        const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

        // Build authorization URL
        const authUrl = `${KIRO_OAUTH_CONFIG.authServiceEndpoint}/login?` +
            `idp=${provider}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `code_challenge=${codeChallenge}&` +
            `code_challenge_method=S256&` +
            `state=${state}&` +
            `prompt=select_account`;

        console.log(`[Kiro Auth] Please open the following link in your browser to authorize:`);
        console.log(authUrl);

        return { authUrl, port };
    }

    /**
     * Start Builder ID Device Code Flow
     * @returns {Promise<{verificationUri: string, userCode: string}>}
     */
    async startBuilderIDAuth() {
        // 1. Register OIDC client
        const regResponse = await fetch(`${KIRO_OAUTH_CONFIG.ssoOIDCEndpoint}/client/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': KIRO_CONSTANTS.USER_AGENT
            },
            body: JSON.stringify({
                clientName: 'Kiro IDE',
                clientType: 'public',
                scopes: KIRO_OAUTH_CONFIG.scopes,
                grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']
            })
        });

        if (!regResponse.ok) {
            throw new Error(`Client registration failed: ${regResponse.status}`);
        }

        const regData = await regResponse.json();

        // 2. Start device authorization
        const authResponse = await fetch(`${KIRO_OAUTH_CONFIG.ssoOIDCEndpoint}/device_authorization`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': KIRO_CONSTANTS.USER_AGENT
            },
            body: JSON.stringify({
                clientId: regData.clientId,
                clientSecret: regData.clientSecret,
                startUrl: KIRO_OAUTH_CONFIG.builderIDStartURL
            })
        });

        if (!authResponse.ok) {
            throw new Error(`Device authorization failed: ${authResponse.status}`);
        }

        const deviceAuth = await authResponse.json();

        console.log(`[Kiro Auth] Please open the following link in your browser:`);
        console.log(deviceAuth.verificationUriComplete);
        console.log(`[Kiro Auth] Or visit ${deviceAuth.verificationUri} and enter code: ${deviceAuth.userCode}`);

        // 3. Start background polling
        this._pollBuilderIDToken(regData.clientId, regData.clientSecret, deviceAuth.deviceCode);

        return {
            verificationUri: deviceAuth.verificationUri,
            verificationUriComplete: deviceAuth.verificationUriComplete,
            userCode: deviceAuth.userCode,
            expiresIn: deviceAuth.expiresIn
        };
    }

    /**
     * Start local callback server
     */
    async _startCallbackServer(codeVerifier, expectedState) {
        const portStart = KIRO_OAUTH_CONFIG.callbackPortStart;
        const portEnd = KIRO_OAUTH_CONFIG.callbackPortEnd;

        for (let port = portStart; port <= portEnd; port++) {
            try {
                await this._createServer(port, codeVerifier, expectedState);
                return port;
            } catch (err) {
                if (err.code !== 'EADDRINUSE') throw err;
                console.log(`[Kiro Auth] Port ${port} is in use, trying next...`);
            }
        }
        throw new Error('All ports are in use');
    }

    /**
     * Create HTTP callback server
     */
    _createServer(port, codeVerifier, expectedState) {
        const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

        return new Promise((resolve, reject) => {
            this.server = http.createServer(async (req, res) => {
                try {
                    const url = new URL(req.url, `http://127.0.0.1:${port}`);

                    if (url.pathname === '/oauth/callback') {
                        const code = url.searchParams.get('code');
                        const state = url.searchParams.get('state');
                        const errorParam = url.searchParams.get('error');

                        if (errorParam) {
                            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(generateResponsePage(false, `Authorization failed: ${errorParam}`));
                            return;
                        }

                        if (state !== expectedState) {
                            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(generateResponsePage(false, 'State validation failed'));
                            return;
                        }

                        // Exchange Code for Token
                        const tokenResponse = await fetch(`${KIRO_OAUTH_CONFIG.authServiceEndpoint}/oauth/token`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': KIRO_CONSTANTS.USER_AGENT
                            },
                            body: JSON.stringify({
                                code,
                      code_verifier: codeVerifier,
                                redirect_uri: redirectUri
                            })
                        });

                        if (!tokenResponse.ok) {
                            const errorText = await tokenResponse.text();
                            console.error(`[Kiro Auth] Token exchange failed:`, errorText);
                            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(generateResponsePage(false, `Failed to get token: ${tokenResponse.status}`));
                            return;
                        }

                        const tokenData = await tokenResponse.json();

                        // Build credentials object
                        const credentials = {
                            accessToken: tokenData.accessToken,
                            refreshToken: tokenData.refreshToken,
                            profileArn: tokenData.profileArn,
                            expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
                            authMethod: KIRO_CONSTANTS.AUTH_METHOD_SOCIAL,
                            region: this.region
                        };

                        // Save credentials
                        this._lastCredentials = credentials;
                        if (this.saveToFile) {
                            await this.saveCredentials(credentials);
                        }

                        // Call success callback
                        if (this.onSuccess) {
                            try {
                                await this.onSuccess(credentials);
                            } catch (callbackError) {
                                console.error(`[Kiro Auth] Callback execution failed:`, callbackError);
                            }
                        }

                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(generateResponsePage(true, 'Authorization successful! You can close this page'));

                        // Close server
                        this.server.close();
                        this.server = null;
                    } else {
                        res.writeHead(204);
                        res.end();
                    }
                } catch (error) {
                    console.error(`[Kiro Auth] Error processing callback:`, error);
                    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(generateResponsePage(false, `Server error: ${error.message}`));
                }
            });

            this.server.on('error', reject);
            this.server.listen(port, '127.0.0.1', () => resolve());

            // Auto-close on timeout
            setTimeout(() => {
                if (this.server && this.server.listening) {
                    this.server.close();
                    this.server = null;
                }
            }, KIRO_OAUTH_CONFIG.authTimeout);
        });
    }

    /**
     * Poll to obtain Builder ID Token
     */
    async _pollBuilderIDToken(clientId, clientSecret, deviceCode) {
        const interval = 5;
        const maxAttempts = 60; // 5 minutes
        let attempts = 0;

        const poll = async () => {
            if (attempts >= maxAttempts) {
                throw new Error('Authorization timeout');
            }

            attempts++;

            try {
                const response = await fetch(`${KIRO_OAUTH_CONFIG.ssoOIDCEndpoint}/token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': KIRO_CONSTANTS.USER_AGENT
                    },
                    body: JSON.stringify({
                        clientId,
                        clientSecret,
                        deviceCode,
                        grantType: 'urn:ietf:params:oauth:grant-type:device_code'
                    })
                });

                const data = await response.json();

                if (response.ok && data.accessToken) {
                    console.log(`[Kiro Auth] Successfully obtained token`);

                    const credentials = {
                        accessToken: data.accessToken,
                        refreshToken: data.refreshToken,
                        expiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString(),
                        authMethod: KIRO_CONSTANTS.AUTH_METHOD_BUILDER_ID,
                        clientId,
                        clientSecret,
                        region: this.region
                    };

                    // Save credentials
                    this._lastCredentials = credentials;
                    if (this.saveToFile) {
                        await this.saveCredentials(credentials);
                    }

                    // Call success callback
                    if (this.onSuccess) {
                        try {
                            await this.onSuccess(credentials);
                        } catch (callbackError) {
                            console.error(`[Kiro Auth] Callback execution failed:`, callbackError);
                        }
                    }

                    return credentials;
                }

                if (data.error === 'authorization_pending') {
                    console.log(`[Kiro Auth] Waiting for user authorization... (${attempts}/${maxAttempts})`);
                    await new Promise(resolve => setTimeout(resolve, interval * 1000));
                    return poll();
                } else if (data.error === 'slow_down') {
                    await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000));
                    return poll();
                } else {
                    throw new Error(`Authorization failed: ${data.error || 'unknown error'}`);
                }
            } catch (error) {
                if (error.message.includes('Authorization') || error.message.includes('timeout')) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, interval * 1000));
                return poll();
            }
        };

        return poll();
    }

    /**
     * Close server
     */
    close() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}

export default KiroAuth;
