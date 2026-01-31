/**
 * Warp API Service
 * Provides token refresh and AI conversation functionality
 */

import https from 'https';
import axios from 'axios';

// Firebase API Key
const FIREBASE_API_KEY = 'AIzaSyBdy3O3S9hrdayLJxJ7mriBR4qgUaUygAs';

// Warp API Configuration
const WARP_CONFIG = {
    host: 'app.warp.dev',
    path: '/ai/multi-agent',
    headers: {
        'x-warp-client-id': 'warp-app',
        'x-warp-client-version': 'v0.2026.01.14.08.15.stable_02',
        'x-warp-os-category': 'macOS',
        'x-warp-os-name': 'macOS',
        'x-warp-os-version': '15.7.2',
        'content-type': 'application/x-protobuf',
        'accept': 'text/event-stream',
        'accept-encoding': 'identity',
    }
};

// Warp natively supported models
export const WARP_MODELS = [
    { id: 'claude-4.1-opus', name: 'Claude 4.1 Opus', provider: 'warp' },
    { id: 'claude-4-opus', name: 'Claude 4 Opus', provider: 'warp' },
    { id: 'claude-4-5-opus', name: 'Claude 4.5 Opus', provider: 'warp' },
    { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', provider: 'warp' },
    { id: 'claude-4-5-sonnet', name: 'Claude 4.5 Sonnet', provider: 'warp' },
    { id: 'gpt-5', name: 'GPT-5', provider: 'warp' },
    { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'warp' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'warp' },
    { id: 'o3', name: 'O3', provider: 'warp' },
    { id: 'o4-mini', name: 'O4 Mini', provider: 'warp' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'warp' },
];

// Model name mapping: external model name -> Warp model name
const MODEL_MAPPING = {
    // Anthropic model mapping
    'claude-opus-4-5-20251101': 'claude-4-5-opus',
    'claude-haiku-4-5-20251001': 'claude-4-5-sonnet',  // haiku maps to sonnet
    'claude-sonnet-4-20250514': 'claude-4-sonnet',
    'claude-3-5-sonnet-20241022': 'claude-4-sonnet',
    'claude-3-opus-20240229': 'claude-4-opus',
    'claude-3-sonnet-20240229': 'claude-4-sonnet',
    'claude-3-haiku-20240307': 'claude-4-sonnet',
    
    // Gemini model mapping
    'gemini-2.5-flash': 'gemini-2.5-pro',
    'gemini-2.5-flash-lite': 'gemini-2.5-pro',
    'gemini-2.5-flash-thinking': 'gemini-2.5-pro',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-3-flash': 'gemini-2.5-pro',
    'gemini-3-pro': 'gemini-3-pro',
    'gemini-3-pro-high': 'gemini-3-pro',
    'gemini-3-pro-low': 'gemini-2.5-pro',
    
    // OpenAI model mapping
    'gpt-4-turbo': 'gpt-4.1',
    'gpt-4-turbo-preview': 'gpt-4.1',
    'gpt-4': 'gpt-4.1',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4.1',
    'o1': 'o3',
    'o1-mini': 'o4-mini',
    'o1-preview': 'o3',
};

/**
 * Convert external model name to Warp supported model name
 */
export function mapModelToWarp(modelName) {
    if (!modelName) return 'claude-4.1-opus';
    
    const lowerModel = modelName.toLowerCase().trim();
    
    // Direct mapping table match
    if (MODEL_MAPPING[lowerModel]) {
        return MODEL_MAPPING[lowerModel];
    }
    
    // Check if it's a Warp natively supported model
    const warpModel = WARP_MODELS.find(m => m.id.toLowerCase() === lowerModel);
    if (warpModel) {
        return warpModel.id;
    }
    
    // Fuzzy matching
    if (lowerModel.includes('opus')) {
        if (lowerModel.includes('4.5') || lowerModel.includes('4-5')) return 'claude-4-5-opus';
        if (lowerModel.includes('4.1')) return 'claude-4.1-opus';
        return 'claude-4-opus';
    }
    if (lowerModel.includes('sonnet')) {
        if (lowerModel.includes('4.5') || lowerModel.includes('4-5')) return 'claude-4-5-sonnet';
        return 'claude-4-sonnet';
    }
    if (lowerModel.includes('haiku')) return 'claude-4-sonnet';
    if (lowerModel.includes('claude')) return 'claude-4.1-opus';
    if (lowerModel.includes('gemini')) return 'gemini-2.5-pro';
    if (lowerModel.includes('gpt')) return 'gpt-4.1';
    
    // Default return claude-4.1-opus
    return 'claude-4.1-opus';
}

// ==================== Token Utilities ====================

/**
 * Parse JWT Token
 */
export function parseJwtToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        let payload = parts[1];
        payload += '='.repeat((4 - payload.length % 4) % 4);

        const decoded = Buffer.from(payload, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch (e) {
        return null;
    }
}

/**
 * Check if Token is expired
 */
export function isTokenExpired(token, bufferMinutes = 5) {
    const payload = parseJwtToken(token);
    if (!payload || !payload.exp) return true;

    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = bufferMinutes * 60;

    return (payload.exp - now) <= bufferSeconds;
}

/**
 * Get Token expiration time
 */
export function getTokenExpiresAt(token) {
    const payload = parseJwtToken(token);
    if (!payload || !payload.exp) return null;
    return new Date(payload.exp * 1000);
}

/**
 * Extract email from Token
 */
export function getEmailFromToken(token) {
    const payload = parseJwtToken(token);
    return payload?.email || null;
}

// ==================== Token Refresh ====================

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken) {
    const url = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

    const axiosConfig = {
        method: 'POST',
        url,
        headers: {
            'Content-Type': 'application/json'
        },
        data: {
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        },
        timeout: 30000
    };

    try {
        const response = await axios(axiosConfig);
        const json = response.data;

        if (json.error) {
            throw new Error(`Refresh failed: ${json.error.message}`);
        }

        return {
            accessToken: json.id_token,
            refreshToken: json.refresh_token,
            expiresIn: parseInt(json.expires_in)
        };
    } catch (e) {
        if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED') {
            throw new Error('Refresh failed: connection timeout, please check network or proxy settings');
        }
        throw e;
    }
}

// ==================== Protobuf Encoding ====================

function encodeVarint(value) {
    const bytes = [];
    let v = value;
    while (v > 127) {
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    bytes.push(v);
    return Buffer.from(bytes);
}

function encodeField(fieldNum, wireType, data) {
    const tag = (fieldNum << 3) | wireType;
    return Buffer.concat([encodeVarint(tag), data]);
}

function encodeString(fieldNum, str) {
    const strBytes = Buffer.from(str, 'utf8');
    return encodeField(fieldNum, 2, Buffer.concat([encodeVarint(strBytes.length), strBytes]));
}

function encodeBytes(fieldNum, buf) {
    return encodeField(fieldNum, 2, Buffer.concat([encodeVarint(buf.length), buf]));
}

function encodeMessage(fieldNum, msgBytes) {
    return encodeField(fieldNum, 2, Buffer.concat([encodeVarint(msgBytes.length), msgBytes]));
}

function encodeVarintField(fieldNum, value) {
    return encodeField(fieldNum, 0, encodeVarint(value));
}

function encodeFixed32(fieldNum, value) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value, 0);
    return encodeField(fieldNum, 5, buf);
}

/**
 * Build Warp request body
 * @param {string} query - User query
 * @param {string} model - Model name
 * @param {Object} options - Optional parameters
 * @param {Object} options.toolResult - Tool result { callId, command, output }
 * @param {string} options.workingDir - Working directory
 */
function buildRequestBody(query, model = 'claude-4.1-opus', options = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nanos = (Date.now() % 1000) * 1000000;
    const workingDir = options.workingDir || '/tmp';
    const homeDir = '/tmp';
    const toolResult = options.toolResult || null;

    const field1 = encodeString(1, "");
    const pathInfo = Buffer.concat([encodeString(1, workingDir), encodeString(2, homeDir)]);
    const osInfo = encodeMessage(1, encodeFixed32(9, 0x534f6361));
    const shellInfo = Buffer.concat([encodeString(1, "zsh"), encodeString(2, "5.9")]);
    const timestampInfo = Buffer.concat([encodeVarintField(1, timestamp), encodeVarintField(2, nanos)]);

    const field2_1 = Buffer.concat([
        encodeMessage(1, pathInfo),
        encodeMessage(2, osInfo),
        encodeMessage(3, shellInfo),
        encodeMessage(4, timestampInfo)
    ]);

    let field2_6;
    if (toolResult && toolResult.callId && toolResult.output !== undefined) {
        // Embed tool result into query text so Warp understands context
        // Format: original query + tool execution info + tool output
        const toolResultQuery = `${query}\n\n[Command executed]\nCommand: ${toolResult.command}\nOutput:\n${toolResult.output}`;
        const queryContent = Buffer.concat([encodeString(1, toolResultQuery), encodeString(3, ""), encodeVarintField(4, 1)]);
        field2_6 = encodeMessage(1, encodeMessage(1, queryContent));
    } else {
        // Normal query format
        const queryContent = Buffer.concat([encodeString(1, query), encodeString(3, ""), encodeVarintField(4, 1)]);
        field2_6 = encodeMessage(1, encodeMessage(1, queryContent));
    }
    
    const field2Content = Buffer.concat([encodeMessage(1, field2_1), encodeMessage(6, field2_6)]);

    const modelConfig = Buffer.concat([encodeString(1, "auto-efficient"), encodeString(4, "cli-agent-auto")]);
    const capabilities = Buffer.from([0x06, 0x07, 0x0c, 0x08, 0x09, 0x0f, 0x0e, 0x00, 0x0b, 0x10, 0x0a, 0x14, 0x11, 0x13, 0x12, 0x02, 0x03, 0x01, 0x0d]);
    const capabilities2 = Buffer.from([0x0a, 0x14, 0x06, 0x07, 0x0c, 0x02, 0x01]);

    const field3Content = Buffer.concat([
        encodeMessage(1, modelConfig),
        encodeVarintField(2, 1), encodeVarintField(3, 1), encodeVarintField(4, 1),
        encodeVarintField(6, 1), encodeVarintField(7, 1), encodeVarintField(8, 1),
        encodeBytes(9, capabilities),
        encodeVarintField(10, 1), encodeVarintField(11, 1), encodeVarintField(12, 1),
        encodeVarintField(13, 1), encodeVarintField(14, 1), encodeVarintField(15, 1),
        encodeVarintField(16, 1), encodeVarintField(17, 1), encodeVarintField(21, 1),
        encodeBytes(22, capabilities2), encodeVarintField(23, 1)
    ]);

    const entrypoint = Buffer.concat([
        encodeString(1, "entrypoint"),
        encodeMessage(2, encodeMessage(3, encodeString(1, "USER_INITIATED")))
    ]);
    const autoResume = Buffer.concat([encodeString(1, "is_auto_resume_after_error"), encodeMessage(2, encodeVarintField(4, 0))]);
    const autoDetect = Buffer.concat([encodeString(1, "is_autodetected_user_query"), encodeMessage(2, encodeVarintField(4, 1))]);
    const field4Content = Buffer.concat([encodeMessage(2, entrypoint), encodeMessage(2, autoResume), encodeMessage(2, autoDetect)]);

    return Buffer.concat([field1, encodeMessage(2, field2Content), encodeMessage(3, field3Content), encodeMessage(4, field4Content)]);
}

// ==================== Response Parsing ====================

// Pre-compiled regular expressions (performance optimization)
const UUID_REGEX = /^[0-9a-f-]{36}$/;
const CHINESE_REGEX = /[\u4e00-\u9fff]/;
const ALPHA_2_REGEX = /[a-zA-Z]{2,}/;
const ALPHA_3_REGEX = /[a-zA-Z]{3,}/;
const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;

/**
 * Quick check for Chinese characters
 */
function hasChinese(text) {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0x4e00 && code <= 0x9fff) return true;
    }
    return false;
}

/**
 * Extract text content from protobuf response
 * Supports agent_output.text
 * Fix: collect all matching text fragments instead of returning only the first one
 */
function extractAgentText(buffer) {
    const bufferStr = buffer.toString('utf8');
    const DEBUG = process.env.WARP_DEBUG === 'true';
    
    // Only process agent_output
    if (!bufferStr.includes('agent_output')) {
        return null;
    }
    
    // Debug: print agent_output raw data
    if (DEBUG) {
        const printable = bufferStr.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
        console.log(`  [AGENT_OUTPUT RAW] ${printable.substring(0, 200)}${printable.length > 200 ? '...' : ''}`);
    }
    
    const texts = [];  // Collect all text fragments
    
    // Use \x1a nested parsing
    for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === 0x1a) {
            const outerLen = buffer[i + 1];
            if (outerLen > 2 && outerLen < 200 && buffer[i + 2] === 0x0a) {
                const innerLen = buffer[i + 3];
                if (innerLen > 0 && innerLen <= outerLen - 2 && i + 4 + innerLen <= buffer.length) {
                    const text = buffer.slice(i + 4, i + 4 + innerLen).toString('utf8');
                    
                    // Filter empty text and UUID
                    if (text.length === 0) continue;
                    if (text.length === 36 && UUID_REGEX.test(text)) continue;
                    
                    // Filter system identifiers
                    if (text.includes('agent_') || text.includes('server_') || 
                        text.includes('USER_') || text.includes('primary_') ||
                        text.includes('call_') || text.includes('precmd-')) continue;
                    
                    // Filter JSON metadata fragments (like "isNewTopic": true, "title": "xxx")
                    if (text.includes('isNewTopic') || text.includes('"title"') ||
                        text.includes('"type"') || text.includes('"id"') ||
                        /^"[a-zA-Z_]+"\s*:/.test(text.trim()) ||
                        /^\s*\}?\s*$/.test(text) ||  // Only } or whitespace
                        text.trim() === 'null' || text.trim() === 'true' || text.trim() === 'false') continue;
                    
                    // Check for visible content (Chinese, English, numbers, punctuation, etc.)
                    // Relaxed condition: just need Chinese characters or printable ASCII characters
                    const hasContent = hasChinese(text) || /[a-zA-Z0-9\s\-_.,!?:;'"()\[\]{}@#$%^&*+=<>/\\|`~]/.test(text);
                    
                    if (hasContent) {
                        // Exclude pure base64 long strings (usually IDs)
                        if (text.length > 20 && BASE64_REGEX.test(text)) continue;
                        texts.push(text);  // Collect instead of returning directly
                    }
                }
            }
        }
    }

    if (texts.length === 0) return null;
    
    const result = texts.join('');
    
    // Final filter: if merged text looks like JSON metadata, discard it
    // Match any text containing isNewTopic (this is Warp's session metadata)
    if (/isNewTopic/i.test(result)) {
        return null;
    }
    // Match JSON fragments containing title": (note: may not have quotes)
    if (/title"\s*:\s*/.test(result) && result.length < 150) {
        return null;
    }
    // Match short JSON fragments ending with } or }"
    if (/["}]\s*$/.test(result) && result.length < 100 && /^\s*"/.test(result)) {
        return null;
    }
    // Match short text that looks like JSON key-value pairs
    if (/^[^a-zA-Z\u4e00-\u9fa5]*"?\w+"?\s*:\s*/.test(result) && result.length < 80) {
        return null;
    }
    
    return result;
}

/**
 * Extract tool call request from protobuf response
 * Supports run_shell_command and create_documents types
 * Returns { command, callId, toolName, content } or null
 */
function extractToolCall(buffer) {
    const bufferStr = buffer.toString('utf8');
    const DEBUG = process.env.WARP_DEBUG === 'true';
    
    // Check if contains tool call identifier
    const isShellCommand = bufferStr.includes('tool_call.run_shell_command');
    const isCreateDocuments = bufferStr.includes('tool_call.create_documents');
    
    // Check if contains call_ prefixed tool call ID (generic detection)
    const hasCallId = /call_[A-Za-z0-9]{20,}/.test(bufferStr);
    
    // If has call_id but no known tool type, try to extract content from buffer
    if (hasCallId && !isShellCommand && !isCreateDocuments) {
        const callIdMatch = bufferStr.match(/call_[A-Za-z0-9]+/);
        if (callIdMatch) {
            const callId = callIdMatch[0];
            
            // Method 1: Extract readable text directly after call_id
            const callIdIdx = bufferStr.indexOf(callId);
            const afterCallId = bufferStr.substring(callIdIdx + callId.length);
            
            // Find actual content - skip control characters and garbage data after call_id
            // Look for meaningful text like "Create a simple HTML"
            let directContent = '';
            // Match meaningful sentences (starting with uppercase letter, containing space phrases)
            const sentenceMatch = afterCallId.match(/[A-Z][a-z]+\s+[a-z]+[\x20-\x7E\u4e00-\u9fff]*/);
            if (sentenceMatch && sentenceMatch[0].length > 10) {
                directContent = sentenceMatch[0];
                if (DEBUG) {
                    console.log(`  [TOOL_CALL] sentence match: "${directContent.substring(0, 50)}..."`);
                }
            }
            
            // Fallback: extract consecutive printable characters
            if (!directContent) {
                const directMatch = afterCallId.match(/[\x20-\x7E\u4e00-\u9fff]+/g);
                if (directMatch) {
                    const filtered = directMatch.filter(s => {
                        if (s.length < 2) return false;
                        if (s.includes('call_')) return false;
                        if (s.length === 36 && UUID_REGEX.test(s)) return false;
                        if (s.length > 20 && /^[A-Za-z0-9+/=]+$/.test(s)) return false;
                        return true;
                    });
                    directContent = filtered.join('');
                    if (DEBUG && filtered.length > 0) {
                        console.log(`  [TOOL_CALL] directMatch filtered: ${JSON.stringify(filtered.slice(0, 3))}`);
                    }
                }
            }
            
            // Method 2: Use protobuf style parsing
            const contentTexts = [];
            for (let i = 0; i < buffer.length - 4; i++) {
                if (buffer[i] === 0x1a) {
                    const outerLen = buffer[i + 1];
                    if (outerLen > 2 && outerLen < 200 && buffer[i + 2] === 0x0a) {
                        const innerLen = buffer[i + 3];
                        if (innerLen > 0 && innerLen <= outerLen - 2 && i + 4 + innerLen <= buffer.length) {
                            const text = buffer.slice(i + 4, i + 4 + innerLen).toString('utf8');
                            if (text.length === 0) continue;
                            if (text.length === 36 && UUID_REGEX.test(text)) continue;
                            if (text.includes('call_') || text.includes('tool_call.')) continue;
                            const hasContent = hasChinese(text) || /[a-zA-Z0-9#\-*<>!]/.test(text);
                            if (hasContent) contentTexts.push(text);
                        }
                    }
                }
            }
            const protoContent = contentTexts.join('');
            
            // Choose longer content
            let content = directContent.length > protoContent.length ? directContent : protoContent;
            
            // If content looks like Base64, try to decode
            if (content.length > 20 && /^[A-Za-z0-9+/=]+$/.test(content.replace(/\s/g, ''))) {
                try {
                    const decoded = Buffer.from(content, 'base64').toString('utf8');
                    // Extract readable text from decoded data
                    const readableTexts = decoded.match(/[\x20-\x7E\u4e00-\u9fff]{5,}/g);
                    if (readableTexts) {
                        const extractedContent = readableTexts.filter(s => 
                            !UUID_REGEX.test(s) && 
                            !s.includes('gpt-') &&
                            !/^[A-Za-z0-9+/=]+$/.test(s)
                        ).join(' ');
                        if (extractedContent.length > 10) {
                            content = extractedContent;
                            if (DEBUG) {
                                console.log(`  [TOOL_CALL] decoded Base64: "${content.substring(0, 80)}..."`);
                            }
                        }
                    }
                } catch (e) {
                    // Base64 decode failed, keep original content
                }
            }
            
            if (DEBUG) {
                console.log(`  [TOOL_CALL] generic call_id: ${callId}, direct=${directContent.length}c, proto=${protoContent.length}c, final=${content.length}c`);
            }
            
            // Only return tool call when content is extracted
            if (content.length > 0) {
                return { 
                    toolName: 'Write',
                    callId, 
                    command: 'create_documents',
                    content: content
                };
            }
        }
        return null;
    }
    
    if (!isShellCommand && !isCreateDocuments) {
        return null;
    }
    
    // Handle create_documents tool call
    if (isCreateDocuments) {
        const callIdMatch = bufferStr.match(/call_[A-Za-z0-9]+/);
        const callId = callIdMatch ? callIdMatch[0] : null;
        
        // Extract document content
        let content = null;
        const contentTexts = [];
        
        // Use \x1a nested parsing to extract content fragments
        for (let i = 0; i < buffer.length - 4; i++) {
            if (buffer[i] === 0x1a) {
                const outerLen = buffer[i + 1];
                if (outerLen > 2 && outerLen < 200 && buffer[i + 2] === 0x0a) {
                    const innerLen = buffer[i + 3];
                    if (innerLen > 0 && innerLen <= outerLen - 2 && i + 4 + innerLen <= buffer.length) {
                        const text = buffer.slice(i + 4, i + 4 + innerLen).toString('utf8');
                        if (text.length === 0) continue;
                        if (text.length === 36 && UUID_REGEX.test(text)) continue;
                        if (text.includes('tool_call.') || text.includes('call_')) continue;
                        
                        const hasContent = hasChinese(text) || /[a-zA-Z0-9#\-*]/.test(text);
                        if (hasContent && text.length > 0) {
                            contentTexts.push(text);
                        }
                    }
                }
            }
        }
        
        content = contentTexts.join('');
        
        if (DEBUG && callId) {
            console.log(`  [TOOL_CALL] create_documents: callId=${callId}, content.length=${content?.length || 0}`);
        }
        
        if (callId) {
            return { 
                toolName: 'Write',
                callId, 
                command: 'create_documents',
                content: content || ''
            };
        }
        return null;
    }
    
    // Debug: print tool call raw data
    if (DEBUG) {
        const printable = bufferStr.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
        console.log(`  [TOOL_CALL RAW] ${printable.substring(0, 300)}${printable.length > 300 ? '...' : ''}`);
    }
    
    // Extract call_id
    const callIdMatch = bufferStr.match(/call_[A-Za-z0-9]+/);
    const callId = callIdMatch ? callIdMatch[0] : null;
    
    // Extract command - improved method
    let command = null;
    
    // Method 1: Find command after tool_call.run_shell_command.command marker
    // Command is usually before the "command" field, formatted as length-prefixed string
    const commandMarkerIdx = bufferStr.indexOf('tool_call.run_shell_command.command');
    if (commandMarkerIdx > 0) {
        // Find command string before the marker
        // Search backwards to find the nearest valid command
        for (let i = commandMarkerIdx - 1; i >= 4; i--) {
            if (buffer[i - 1] === 0x0a) {
                const len = buffer[i];
                if (len >= 2 && len <= 200 && i + len <= commandMarkerIdx) {
                    const possibleCmd = buffer.slice(i + 1, i + 1 + len).toString('utf8');
                    // Check if it's a valid command
                    if (/^[a-zA-Z\/\.]/.test(possibleCmd) && 
                        !possibleCmd.includes('tool_call') &&
                        !possibleCmd.includes('agent_') &&
                        !possibleCmd.includes('server_') &&
                        !UUID_REGEX.test(possibleCmd)) {
                        command = possibleCmd;
                        if (DEBUG) {
                            console.log(`  [TOOL_CALL] found command (method1): "${command}"`);
                        }
                        break;
                    }
                }
            }
        }
    }
    
    // Method 2: Scan all length-prefixed strings, find ones that look like commands
    if (!command) {
        for (let i = 0; i < buffer.length - 3; i++) {
            if (buffer[i] === 0x0a) {
                const len = buffer[i + 1];
                if (len >= 2 && len <= 200 && i + 2 + len <= buffer.length) {
                    const possibleCmd = buffer.slice(i + 2, i + 2 + len).toString('utf8');
                    // Check if it's a valid command (starts with letter, /, or .)
                    if (/^[a-zA-Z\/\.]/.test(possibleCmd) && 
                        !possibleCmd.includes('tool_call') &&
                        !possibleCmd.includes('agent_') &&
                        !possibleCmd.includes('server_') &&
                        !possibleCmd.includes('primary_') &&
                        !UUID_REGEX.test(possibleCmd) &&
                        !BASE64_REGEX.test(possibleCmd)) {
                        // Check if contains command characteristics (space+args, or common command names)
                        const cmdName = possibleCmd.split(/\s/)[0];
                        const commonCmds = ['ls', 'cat', 'grep', 'find', 'pwd', 'cd', 'echo', 'head', 'tail', 
                                           'wc', 'tree', 'file', 'stat', 'du', 'df', 'mkdir', 'rm', 'cp', 
                                           'mv', 'touch', 'chmod', 'chown', 'curl', 'wget', 'git', 'npm',
                                           'node', 'python', 'pip', 'yarn', 'pnpm', 'bash', 'sh', 'zsh'];
                        if (commonCmds.includes(cmdName) || possibleCmd.includes(' ')) {
                            command = possibleCmd;
                            if (DEBUG) {
                                console.log(`  [TOOL_CALL] found command (method2): "${command}"`);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }
    
    if (callId) {
        if (DEBUG && !command) {
            console.log(`  [TOOL_CALL] WARNING: callId=${callId} but command not found`);
        }
        return { command: command || 'unknown', callId };
    }
    
    return null;
}

/**
 * Extract tool execution result from protobuf response
 * Tool results usually contain ls, precmd and other identifiers
 */
function extractToolResult(buffer) {
    const bufferStr = buffer.toString('utf8');
    
    // Skip tool call requests (not results)
    if (bufferStr.includes('tool_call.run_shell_command') || 
        bufferStr.includes('server_message_data') ||
        bufferStr.includes('orchestrator executed')) {
        return null;
    }
    
    // Check if contains tool result identifier
    if (!bufferStr.includes('precmd-')) {
        return null;
    }
    
    // Extract tool output (usually in large data blocks after \x12)
    // Find multiline output containing newlines
    const lines = bufferStr.split('\n');
    const resultLines = [];
    
    for (const line of lines) {
        // Clean up non-printable characters
        const cleaned = line.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim();
        if (cleaned.length > 0) {
            // Filter out UUID and system identifiers
            if (UUID_REGEX.test(cleaned)) continue;
            if (cleaned.includes('call_') || cleaned.includes('precmd-')) continue;
            if (cleaned.startsWith('$') && cleaned.length === 37) continue;
            if (cleaned.includes('tool_call.') || cleaned.includes('server_message')) continue;
            
            // Keep meaningful content
            if (hasChinese(cleaned) || /[a-zA-Z0-9]/.test(cleaned)) {
                resultLines.push(cleaned);
            }
        }
    }
    
    if (resultLines.length > 0) {
        return resultLines.join('\n');
    }
    
    return null;
}

/**
 * Extract agent_reasoning.reasoning text from protobuf response
 * This is AI's reasoning process, may only have reasoning when there's no agent_output
 */
function extractReasoning(buffer) {
    const bufferStr = buffer.toString('utf8');
    
    // Only process agent_reasoning
    if (!bufferStr.includes('agent_reasoning.reasoning')) {
        return null;
    }
    
    const texts = [];
    
    // Use \x1a nested parsing (similar to extractAgentText)
    for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === 0x1a) {
            const outerLen = buffer[i + 1];
            if (outerLen > 2 && outerLen < 200 && buffer[i + 2] === 0x0a) {
                const innerLen = buffer[i + 3];
                if (innerLen > 0 && innerLen <= outerLen - 2 && i + 4 + innerLen <= buffer.length) {
                    const text = buffer.slice(i + 4, i + 4 + innerLen).toString('utf8');
                    
                    if (text.length === 0) continue;
                    if (text.length === 36 && UUID_REGEX.test(text)) continue;
                    
                    // Filter system identifiers
                    if (text.includes('agent_') || text.includes('server_') || 
                        text.includes('USER_') || text.includes('primary_') ||
                        text.includes('call_') || text.includes('precmd-')) continue;
                    
                    // Check for visible content
                    const hasContent = hasChinese(text) || /[a-zA-Z0-9\s\-_.,!?:;'"()\[\]{}@#$%^&*+=<>/\\|`~]/.test(text);
                    
                    if (hasContent) {
                        if (text.length > 20 && BASE64_REGEX.test(text)) continue;
                        texts.push(text);
                    }
                }
            }
        }
    }

    return texts.length > 0 ? texts.join('') : null;
}

/**
 * Comprehensively extract response content (including agent_output, agent_reasoning, tool calls and tool results)
 */
function extractContent(buffer, debug = false) {
    const bufferStr = buffer.toString('utf8');
    
    // Debug: print readable part of raw data
    if (debug) {
        // Extract printable characters
        const printable = bufferStr.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
        if (printable.length > 0) {
            console.log(`  [RAW] ${printable.substring(0, 200)}${printable.length > 200 ? '...' : ''}`);
        }
    }
    
    // Prioritize extracting agent_output.text
    const agentText = extractAgentText(buffer);
    if (agentText) {
        return { type: 'text', content: agentText };
    }
    
    // Detect tool call content stream (tool_call.create_documents.new_documents.content)
    // These events contain actual document content, need to accumulate
    if (bufferStr.includes('tool_call.create_documents.new_documents.content')) {
        const contentTexts = [];
        for (let i = 0; i < buffer.length - 4; i++) {
            if (buffer[i] === 0x1a) {
                const outerLen = buffer[i + 1];
                if (outerLen > 2 && outerLen < 200 && buffer[i + 2] === 0x0a) {
                    const innerLen = buffer[i + 3];
                    if (innerLen > 0 && innerLen <= outerLen - 2 && i + 4 + innerLen <= buffer.length) {
                        const text = buffer.slice(i + 4, i + 4 + innerLen).toString('utf8');
                        if (text.length === 0) continue;
                        if (text.length === 36 && UUID_REGEX.test(text)) continue;
                        if (text.includes('tool_call.') || text.includes('new_documents')) continue;
                        const hasContent = hasChinese(text) || /[a-zA-Z0-9#\-*\s]/.test(text);
                        if (hasContent) contentTexts.push(text);
                    }
                }
            }
        }
        if (contentTexts.length > 0) {
            return { type: 'tool_content', content: contentTexts.join('') };
        }
    }
    
    // Detect tool call request
    const toolCall = extractToolCall(buffer);
    if (toolCall) {
        return { type: 'tool_call', content: toolCall };
    }
    
    // Try to extract tool result
    const toolResult = extractToolResult(buffer);
    if (toolResult) {
        return { type: 'tool_result', content: toolResult };
    }
    
    // Extract agent_reasoning.reasoning (AI reasoning process)
    const reasoning = extractReasoning(buffer);
    if (reasoning) {
        return { type: 'reasoning', content: reasoning };
    }
    
    return null;
}

// ==================== API Requests ====================

/**
 * Send non-streaming request
 * @param {string} query - User query
 * @param {string} accessToken - Access token
 * @param {string} model - Model name
 * @param {Object} options - Optional parameters
 * @param {Object} options.toolResult - Tool result { callId, command, output }
 * @param {string} options.workingDir - Working directory
 */
export function sendWarpRequest(query, accessToken, model = 'claude-4.1-opus', reqOptions = {}) {
    return new Promise((resolve, reject) => {
        const body = buildRequestBody(query, model, reqOptions);
        const DEBUG = process.env.WARP_DEBUG === 'true';

        const httpOptions = {
            hostname: WARP_CONFIG.host,
            port: 443,
            path: WARP_CONFIG.path,
            method: 'POST',
            headers: {
                ...WARP_CONFIG.headers,
                'authorization': `Bearer ${accessToken}`,
                'content-length': body.length
            }
        };

        // Set request timeout (increased to 120s because complex requests may take longer)
        const timeoutMs = reqOptions.timeout || 120000;
        const timeout = setTimeout(() => {
            req.destroy(new Error(`Request timeout after ${timeoutMs/1000}s`));
        }, timeoutMs);

        const req = https.request(httpOptions, (res) => {
            if (res.statusCode !== 200) {
                clearTimeout(timeout);
                let errorData = '';
                res.on('data', chunk => errorData += chunk);
                res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errorData}`)));
                return;
            }

            let responseText = '';
            let toolCalls = [];
            let toolResults = [];
            let toolContentBuffer = '';  // Accumulate tool call document content
            let eventCount = 0;
            let textEventCount = 0;
            let buffer = '';  // For handling incomplete lines across chunks

            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                // Keep the last potentially incomplete line
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        eventCount++;
                        const eventData = line.substring(5).trim();
                        if (eventData) {
                            try {
                                const decoded = Buffer.from(eventData, 'base64');
                                const extracted = extractContent(decoded, DEBUG);
                                if (extracted) {
                                    if (extracted.type === 'text') {
                                        textEventCount++;
                                        responseText += extracted.content;
                                        if (DEBUG) {
                                            console.log(`  [WARP DEBUG] event#${eventCount} text: "${extracted.content.substring(0, 50)}${extracted.content.length > 50 ? '...' : ''}" (len=${extracted.content.length})`);
                                        }
                                    } else if (extracted.type === 'reasoning') {
                                        // AI reasoning process also output as text
                                        textEventCount++;
                                        responseText += extracted.content;
                                        if (DEBUG) {
                                            console.log(`  [WARP DEBUG] event#${eventCount} reasoning: "${extracted.content.substring(0, 50)}${extracted.content.length > 50 ? '...' : ''}" (len=${extracted.content.length})`);
                                        }
                                    } else if (extracted.type === 'tool_content') {
                                        // Accumulate tool call document content
                                        toolContentBuffer += extracted.content;
                                        if (DEBUG) {
                                            console.log(`  [WARP DEBUG] event#${eventCount} tool_content: "${extracted.content.substring(0, 30)}..." (total=${toolContentBuffer.length})`);
                                        }
                                    } else if (extracted.type === 'tool_call') {
                                        // If there's accumulated tool content, append to tool call
                                        if (toolContentBuffer.length > 0) {
                                            extracted.content.content = toolContentBuffer;
                                            toolContentBuffer = '';
                                        }
                                        toolCalls.push(extracted.content);
                                        if (DEBUG) {
                                            console.log(`  [WARP DEBUG] event#${eventCount} tool_call: ${JSON.stringify(extracted.content)}`);
                                        }
                                    } else if (extracted.type === 'tool_result') {
                                        toolResults.push(extracted.content);
                                    }
                                }
                            } catch (e) {
                                if (DEBUG) {
                                    console.log(`  [WARP DEBUG] event#${eventCount} parse error: ${e.message}`);
                                }
                            }
                        }
                    }
                }
            });

            res.on('end', () => {
                clearTimeout(timeout);
                // Process remaining data in buffer
                if (buffer.startsWith('data:')) {
                    eventCount++;
                    const eventData = buffer.substring(5).trim();
                    if (eventData) {
                        try {
                            const decoded = Buffer.from(eventData, 'base64');
                            const extracted = extractContent(decoded);
                            if (extracted && (extracted.type === 'text' || extracted.type === 'reasoning')) {
                                textEventCount++;
                                responseText += extracted.content;
                                if (DEBUG) {
                                    console.log(`  [WARP DEBUG] final event#${eventCount} ${extracted.type}: "${extracted.content.substring(0, 50)}..."`);
                                }
                            } else if (extracted && extracted.type === 'tool_content') {
                                toolContentBuffer += extracted.content;
                            }
                        } catch (e) { }
                    }
                }
                
                // If there's accumulated tool content not yet appended to tool call, append to last tool call
                if (toolContentBuffer.length > 0 && toolCalls.length > 0) {
                    const lastToolCall = toolCalls[toolCalls.length - 1];
                    if (!lastToolCall.content || lastToolCall.content.length === 0) {
                        lastToolCall.content = toolContentBuffer;
                        if (DEBUG) {
                            console.log(`  [WARP DEBUG] attached toolContentBuffer (${toolContentBuffer.length}c) to last tool_call`);
                        }
                    }
                }
                
                // If tool call content is still empty, use responseText as content
                for (const tc of toolCalls) {
                    if ((!tc.content || tc.content.length === 0) && responseText.length > 0) {
                        tc.content = responseText;
                        if (DEBUG) {
                            console.log(`  [WARP DEBUG] using responseText (${responseText.length}c) as tool_call content`);
                        }
                    }
                }
                
                if (DEBUG) {
                    console.log(`  [WARP DEBUG] total: ${eventCount} events, ${textEventCount} text events, responseText.length=${responseText.length}, toolContentBuffer.length=${toolContentBuffer.length}`);
                }
                
                // Return response text and tool call info
                resolve({
                    text: responseText,
                    toolCalls: toolCalls,
                    toolResults: toolResults
                });
            });
            
            res.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        req.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        req.write(body);
        req.end();
    });
}

/**
 * Send streaming request
 */
export function sendWarpStreamRequest(query, accessToken, model, onData, onEnd, onError) {
    const body = buildRequestBody(query, model);

    const options = {
        hostname: WARP_CONFIG.host,
        port: 443,
        path: WARP_CONFIG.path,
        method: 'POST',
        headers: {
            ...WARP_CONFIG.headers,
            'authorization': `Bearer ${accessToken}`,
            'content-length': body.length
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            let errorData = '';
            res.on('data', chunk => errorData += chunk);
            res.on('end', () => onError(new Error(`HTTP ${res.statusCode}: ${errorData}`)));
            return;
        }

        res.on('data', (chunk) => {
            const text = chunk.toString();
            const lines = text.split('\n');

            for (const line of lines) {
                if (line.startsWith('data:')) {
                    const eventData = line.substring(5).trim();
                    if (eventData) {
                        try {
                            const decoded = Buffer.from(eventData, 'base64');
                            const content = extractAgentText(decoded);
                            if (content) {
                                onData(content);
                            }
                        } catch (e) { }
                    }
                }
            }
        });

        res.on('end', onEnd);
    });

    req.on('error', onError);
    req.write(body);
    req.end();

    return req;
}

// ==================== Warp Service Class ====================

export class WarpService {
    constructor(warpStore) {
        this.store = warpStore;
    }

    /**
     * Get valid access token
     * If token is expired, automatically refresh
     */
    async getValidAccessToken(credential) {
        // Check if existing token is valid
        if (credential.accessToken && !isTokenExpired(credential.accessToken)) {
            return credential.accessToken;
        }

        // Refresh token
        try {
            const result = await refreshAccessToken(credential.refreshToken);
            const expiresAt = new Date(Date.now() + result.expiresIn * 1000);

            // Update database
            await this.store.updateToken(credential.id, result.accessToken, expiresAt);

            return result.accessToken;
        } catch (error) {
            await this.store.incrementErrorCount(credential.id, error.message);
            throw error;
        }
    }

    /**
     * Send chat request (auto account selection, token refresh, auto failover)
     */
    async chat(query, model = 'claude-4.1-opus') {
        // Use method with failover
        return this.chatWithFailover(query, model, 3);
    }

    /**
     * Send streaming chat request (auto failover)
     */
    async chatStream(query, model, onData, onEnd, onError) {
        // Use method with failover
        return this.chatStreamWithFailover(query, model, onData, onEnd, onError, 3);
    }

    /**
     * Send streaming chat request (original version, no failover)
     */
    async chatStreamSimple(query, model, onData, onEnd, onError) {
        const credential = await this.store.getRandomActive();
        if (!credential) {
            onError(new Error('No available Warp accounts'));
            return null;
        }

        try {
            const accessToken = await this.getValidAccessToken(credential);
            await this.store.incrementUseCount(credential.id);

            return sendWarpStreamRequest(query, accessToken, model, onData, onEnd, (error) => {
                this.store.incrementErrorCount(credential.id, error.message);
                onError(error);
            });
        } catch (error) {
            await this.store.incrementErrorCount(credential.id, error.message);
            onError(error);
            return null;
        }
    }

    /**
     * Batch refresh tokens for all accounts
     */
    async refreshAllTokens() {
        const credentials = await this.store.getAllActive();
        const results = [];

        for (const cred of credentials) {
            try {
                if (!cred.accessToken || isTokenExpired(cred.accessToken)) {
                    const result = await refreshAccessToken(cred.refreshToken);
                    const expiresAt = new Date(Date.now() + result.expiresIn * 1000);
                    await this.store.updateToken(cred.id, result.accessToken, expiresAt);
                    results.push({ id: cred.id, name: cred.name, success: true });
                } else {
                    results.push({ id: cred.id, name: cred.name, success: true, skipped: true });
                }
            } catch (error) {
                await this.store.incrementErrorCount(cred.id, error.message);
                results.push({ id: cred.id, name: cred.name, success: false, error: error.message });
            }
        }

        return results;
    }

    /**
     * Health check
     */
    async healthCheck() {
        const stats = await this.store.getStatistics();
        return {
            ...stats,
            isHealthy: stats.healthy > 0
        };
    }

    /**
     * Query account usage
     */
    async getQuota(credentialId) {
        const credential = credentialId 
            ? await this.store.getById(credentialId)
            : await this.store.getRandomActive();
        
        if (!credential) {
            throw new Error('No available Warp accounts');
        }

        const accessToken = await this.getValidAccessToken(credential);
        const quota = await getRequestLimit(accessToken);
        
        return {
            ...quota,
            credentialId: credential.id,
            credentialName: credential.name,
            email: getEmailFromToken(credential.accessToken)
        };
    }

    /**
     * Query all accounts usage
     */
    async getAllQuotas() {
        const credentials = await this.store.getAllActive();
        const results = [];

        for (const cred of credentials) {
            try {
                const accessToken = await this.getValidAccessToken(cred);
                const quota = await getRequestLimit(accessToken);
                results.push({
                    ...quota,
                    credentialId: cred.id,
                    credentialName: cred.name,
                    email: getEmailFromToken(cred.accessToken)
                });
            } catch (error) {
                results.push({
                    credentialId: cred.id,
                    credentialName: cred.name,
                    email: getEmailFromToken(cred.accessToken),
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Send chat request (with auto failover)
     * If current account fails, automatically try other available accounts
     */
    async chatWithFailover(query, model = 'claude-4.1-opus', maxRetries = 3) {
        const triedIds = new Set();
        let lastError = null;

        for (let i = 0; i < maxRetries; i++) {
            // Get an untried available account
            const credential = await this.store.getRandomActiveExcluding(Array.from(triedIds));
            if (!credential) {
                break;
            }

            triedIds.add(credential.id);

            try {
                const accessToken = await this.getValidAccessToken(credential);
                const warpResponse = await sendWarpRequest(query, accessToken, model);
                await this.store.incrementUseCount(credential.id);

                return {
                    response: warpResponse.text,
                    toolCalls: warpResponse.toolCalls,
                    credentialId: credential.id,
                    credentialName: credential.name,
                    retriesUsed: i
                };
            } catch (error) {
                lastError = error;
                await this.store.incrementErrorCount(credential.id, error.message);
                
                // Check if it's a quota exhausted error
                const isQuotaError = error.message.includes('limit') || 
                                    error.message.includes('quota') ||
                                    error.message.includes('exceeded');
                
                if (isQuotaError) {
                    // Mark account quota exhausted
                    await this.store.markQuotaExhausted(credential.id);
                }
                
                console.log(`[Warp] Account ${credential.name} request failed: ${error.message}, trying next account...`);
            }
        }

        throw lastError || new Error('All accounts request failed');
    }

    /**
     * Streaming chat request (with auto failover)
     */
    async chatStreamWithFailover(query, model, onData, onEnd, onError, maxRetries = 3) {
        const triedIds = new Set();
        let usedCredentialId = null;

        const tryNext = async () => {
            const credential = await this.store.getRandomActiveExcluding(Array.from(triedIds));
            if (!credential) {
                onError(new Error('All accounts request failed'), usedCredentialId);
                return null;
            }

            triedIds.add(credential.id);
            usedCredentialId = credential.id;

            try {
                const accessToken = await this.getValidAccessToken(credential);
                await this.store.incrementUseCount(credential.id);

                return sendWarpStreamRequest(query, accessToken, model, 
                    (content) => onData(content, credential.id),
                    () => onEnd(credential.id),
                    async (error) => {
                        await this.store.incrementErrorCount(credential.id, error.message);
                        
                        if (triedIds.size < maxRetries) {
                            console.log(`[Warp] Account ${credential.name} streaming request failed: ${error.message}, trying next account...`);
                            tryNext();
                        } else {
                            onError(error, credential.id);
                        }
                    }
                );
            } catch (error) {
                await this.store.incrementErrorCount(credential.id, error.message);
                
                if (triedIds.size < maxRetries) {
                    console.log(`[Warp] Account ${credential.name} initialization failed: ${error.message}, trying next account...`);
                    return tryNext();
                } else {
                    onError(error, credential.id);
                    return null;
                }
            }
        };

        return tryNext();
    }
}

/**
 * Get account request quota
 */
export async function getRequestLimit(accessToken) {
    const query = `query GetRequestLimitInfo($requestContext: RequestContext!) {
  user(requestContext: $requestContext) {
    __typename
    ... on UserOutput {
      user {
        requestLimitInfo {
          isUnlimited
          nextRefreshTime
          requestLimit
          requestsUsedSinceLastRefresh
          requestLimitRefreshDuration
        }
      }
    }
    ... on UserFacingError {
      error {
        __typename
        message
      }
    }
  }
}`;

    const appVersion = 'v0.2026.01.14.08.15.stable_02';
    
    const data = {
        operationName: 'GetRequestLimitInfo',
        variables: {
            requestContext: {
                clientContext: { version: appVersion },
                osContext: {
                    category: 'macOS',
                    linuxKernelVersion: null,
                    name: 'macOS',
                    version: '15.7.2'
                }
            }
        },
        query: query
    };

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: 'app.warp.dev',
            port: 443,
            path: '/graphql/v2?op=GetRequestLimitInfo',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'authorization': `Bearer ${accessToken}`,
                'x-warp-client-id': 'warp-app',
                'x-warp-client-version': appVersion,
                'x-warp-os-category': 'macOS',
                'x-warp-os-name': 'macOS',
                'x-warp-os-version': '15.7.2'
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    
                    if (result.errors) {
                        reject(new Error(`GraphQL error: ${result.errors[0].message}`));
                        return;
                    }
                    
                    const userData = result.data?.user;
                    
                    if (userData?.__typename === 'UserOutput') {
                        const limitInfo = userData.user?.requestLimitInfo;
                        
                        if (limitInfo) {
                            resolve({
                                requestLimit: limitInfo.requestLimit || 0,
                                requestsUsed: limitInfo.requestsUsedSinceLastRefresh || 0,
                                requestsRemaining: (limitInfo.requestLimit || 0) - (limitInfo.requestsUsedSinceLastRefresh || 0),
                                isUnlimited: limitInfo.isUnlimited || false,
                                nextRefreshTime: limitInfo.nextRefreshTime || null,
                                refreshDuration: limitInfo.requestLimitRefreshDuration || 'WEEKLY'
                            });
                        } else {
                            reject(new Error('Quota info not found'));
                        }
                    } else if (userData?.__typename === 'UserFacingError') {
                        reject(new Error(userData.error?.message || 'User error'));
                    } else {
                        reject(new Error('Unknown response format'));
                    }
                } catch (e) {
                    reject(new Error(`Parse response failed: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// ==================== Protobufjs Module Export ====================
// New protobufjs implementation provided through the following modules:
// - warp-proto.js: Proto loader and encoding/decoding functions
// - warp-tool-mapper.js: Claude <-> Warp tool mapping
// - warp-message-converter.js: Claude <-> Warp message conversion
//
// Usage:
// import { loadProtos, encodeRequest, decodeResponseEvent } from './warp-proto.js';
// import { buildWarpRequest, parseWarpResponseEvent } from './warp-message-converter.js';
//
// New endpoint /w/v1/messages/proto uses protobufjs implementation
