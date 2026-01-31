/**
 * Kiro Token Refresh Tool
 * Get accessToken via refreshToken and convert to specified format
 *
 * Usage:
 *   node src/kiro-token-refresh.js <refreshToken> [region]
 *
 * Parameters:
 *   refreshToken - Kiro refresh token
 *   region - AWS region (optional, default: us-east-1)
 *
 * Output format:
 * {
 *   "accessToken": "aoaAAAAAGlfTyA8C4c",
 *   "refreshToken": "aorA",
 *   "profileArn": "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
 *   "expiresAt": "2026-01-08T06:30:59.065Z",
 *   "authMethod": "social",
 *   "provider": "Google"
 * }
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current script directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KIRO_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    CONTENT_TYPE_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    DEFAULT_PROVIDER: 'Google',
    AXIOS_TIMEOUT: 30000, // 30 seconds timeout
};

/**
 * Get accessToken via refreshToken
 * @param {string} refreshToken - Kiro refresh token
 * @param {string} region - AWS region (default: us-east-1)
 * @returns {Promise<Object>} Object containing accessToken and other info
 */

async function refreshKiroToken(refreshToken, region = 'us-east-1') {
    const refreshUrl = KIRO_CONSTANTS.REFRESH_URL.replace('{{region}}', region);
    
    const requestBody = {
        refreshToken: refreshToken,
    };

    const axiosConfig = {
        timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
        headers: {
            'Content-Type': KIRO_CONSTANTS.CONTENT_TYPE_JSON,
        },
    };

    try {
        console.log(`[Kiro Token Refresh] Requesting: ${refreshUrl}`);
        const response = await axios.post(refreshUrl, requestBody, axiosConfig);
        
        if (response.data && response.data.accessToken) {
            const expiresIn = response.data.expiresIn;
            const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
            
            const result = {
                accessToken: response.data.accessToken,
                refreshToken: response.data.refreshToken || refreshToken,
                profileArn: response.data.profileArn || '',
                expiresAt: expiresAt,
                authMethod: KIRO_CONSTANTS.AUTH_METHOD_SOCIAL,
                provider: KIRO_CONSTANTS.DEFAULT_PROVIDER,
            };
            
            // If response contains region info, add to result
            if (region) {
                result.region = region;
            }
            
            return result;
        } else {
            throw new Error('Invalid refresh response: Missing accessToken');
        }
    } catch (error) {
        if (error.response) {
            console.error(`[Kiro Token Refresh] Request failed: HTTP ${error.response.status}`);
            console.error(`[Kiro Token Refresh] Response content:`, error.response.data);
        } else if (error.request) {
            console.error(`[Kiro Token Refresh] Request failed: No response`);
        } else {
            console.error(`[Kiro Token Refresh] Request failed:`, error.message);
        }
        throw error;
    }
}

/**
 * Main function - Command line entry
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Kiro Token Refresh Tool');
        console.log('========================');
        console.log('');
        console.log('Usage:');
        console.log('  node src/kiro-token-refresh.js <refreshToken> [region]');
        console.log('');
        console.log('Parameters:');
        console.log('  refreshToken - Kiro refresh token (required)');
        console.log('  region       - AWS region (optional, default: us-east-1)');
        console.log('');
        console.log('Examples:');
        console.log('  node src/kiro-token-refresh.js aorAxxxxxxxx');
        console.log('  node src/kiro-token-refresh.js aorAxxxxxxxx us-west-2');
        console.log('');
        console.log('Output format:');
        console.log(JSON.stringify({
            accessToken: "aoaAAAAAGlfTyA8C4c...",
            refreshToken: "aorA...",
            profileArn: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
            expiresAt: "2026-01-08T06:30:59.065Z",
            authMethod: "social",
            provider: "Google"
        }, null, 2));
        process.exit(0);
    }
    
    const refreshToken = args[0];
    const region = args[1] || 'us-east-1';

    if (!refreshToken) {
        console.error('Error: Please provide refreshToken');
        process.exit(1);
    }

    try {
        console.log(`[Kiro Token Refresh] Starting token refresh...`);
        console.log(`[Kiro Token Refresh] Region: ${region}`);

        const result = await refreshKiroToken(refreshToken, region);

        console.log('');
        console.log('=== Token Refresh Successful ===');
        console.log('');
        console.log(JSON.stringify(result, null, 2));

        // Output expiration time info
        const expiresDate = new Date(result.expiresAt);
        const now = new Date();
        const diffMs = expiresDate - now;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);

        console.log('');
        console.log(`[Kiro Token Refresh] Token will expire in ${diffHours} hours ${diffMins % 60} minutes`);
        console.log(`[Kiro Token Refresh] Expiration time: ${result.expiresAt}`);

        // Write JSON file to script execution directory
        const timestamp = Date.now();
        const outputFileName = `kiro-token-${timestamp}.json`;
        const outputFilePath = path.join(__dirname, outputFileName);

        fs.writeFileSync(outputFilePath, JSON.stringify(result, null, 2), 'utf-8');

        console.log('');
        console.log(`[Kiro Token Refresh] Token saved to file: ${outputFilePath}`);

    } catch (error) {
        console.error('');
        console.error('=== Token Refresh Failed ===');
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Export function for use by other modules
export { refreshKiroToken };

// If this script is run directly, execute main function
main();