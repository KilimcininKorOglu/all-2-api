/**
 * Warp Multi-Agent API Full Forward Proxy
 *
 * Features:
 * 1. One-to-one forwarding of Warp's /ai/multi-agent requests
 * 2. Support for multi-turn conversations (via session history accumulation)
 * 3. Support for tool call loops (automatic submission of tool results)
 * 4. Support for MCP protocol
 *
 * Protocol Notes:
 * - Request: POST /ai/multi-agent, Content-Type: application/x-protobuf
 * - Response: text/event-stream (SSE + Base64 encoded Protobuf)
 * - Multi-turn conversations: Each request contains complete session history (field 1.1.5 array)
 * - Tool calls: AI response contains tool_call (field 4), client executes and returns result via field 5
 */

import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

// ==================== Protobuf Encoding Utilities ====================

function encodeVarint(value) {
    const bytes = [];
    let v = typeof value === 'bigint' ? value : BigInt(value);
    do {
        let byte = Number(v & 0x7fn);
        v >>= 7n;
        if (v > 0n) byte |= 0x80;
        bytes.push(byte);
    } while (v > 0n);
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

function encodeFixed64(fieldNum, value) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(value), 0);
    return encodeField(fieldNum, 1, buf);
}

// ==================== Message Structure Definitions ====================

/**
 * Message type enum
 */
const MessageType = {
    SYSTEM_INIT: 'system_init',           // field 4 - System initialization message
    STATUS: 'status',                      // field 6 - Status message
    USER_QUERY: 'user_query',              // field 2 - User query
    ASSISTANT_TEXT: 'assistant_text',      // field 3 - Assistant text response
    TOOL_CALL: 'tool_call',                // field 4 - Tool call request
    TOOL_RESULT: 'tool_result',            // field 5 - Tool execution result
    REASONING: 'reasoning',                // field 15 - Reasoning/thinking
};

/**
 * Session message
 */
class Message {
    constructor(type, id = uuidv4()) {
        this.id = id;
        this.type = type;
        this.timestamp = Date.now();
        this.cascadeId = null;
        this.turnId = null;
    }
}

/**
 * User query message
 */
class UserQueryMessage extends Message {
    constructor(content, context = {}, id = uuidv4()) {
        super(MessageType.USER_QUERY, id);
        this.content = content;
        this.context = context;  // Contains workingDir, homeDir, shell, etc.
    }
    
    encode(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        
        // Build environment context (field 2)
        const envContext = Buffer.concat([
            encodeMessage(1, Buffer.concat([
                encodeString(1, this.context.workingDir || '/tmp'),
                encodeString(2, this.context.homeDir || '/tmp'),
                encodeVarintField(3, 1)
            ])),
            encodeMessage(2, encodeMessage(1, encodeFixed32(9, 0x534f6361))),
            encodeMessage(3, Buffer.concat([
                encodeString(1, this.context.shell || 'zsh'),
                encodeString(2, this.context.shellVersion || '5.9')
            ])),
            encodeMessage(4, Buffer.concat([
                encodeVarintField(1, timestamp),
                encodeVarintField(2, nanos)
            ])),
            ...(this.context.repoName ? [encodeMessage(8, Buffer.concat([
                encodeString(1, this.context.repoName),
                encodeString(2, this.context.workingDir || '/tmp')
            ]))] : []),
            ...(this.context.gitBranch ? [encodeMessage(11, encodeString(1, this.context.gitBranch))] : [])
        ]);
        
        // Build query content (field 1)
        const queryContent = Buffer.concat([
            encodeString(1, this.content),
            encodeMessage(2, envContext),
            encodeString(4, ''),
            encodeVarintField(5, 1)
        ]);
        
        // Build complete message (field 2 in field 5)
        return encodeMessage(5, Buffer.concat([
            encodeString(1, this.id),
            encodeMessage(2, queryContent),
            this._encodeServerData(cascadeId, turnId),
            encodeString(11, cascadeId),
            encodeString(13, turnId),
            encodeMessage(14, Buffer.concat([
                encodeVarintField(1, timestamp),
                encodeVarintField(2, nanos)
            ]))
        ]));
    }
    
    _encodeServerData(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        const serverData = Buffer.concat([
            encodeVarintField(1, timestamp),
            encodeVarintField(2, nanos)
        ]);
        return encodeBytes(7, Buffer.from(serverData.toString('base64')));
    }
}

/**
 * Assistant text response message
 */
class AssistantTextMessage extends Message {
    constructor(content, id = uuidv4()) {
        super(MessageType.ASSISTANT_TEXT, id);
        this.content = content;
    }
    
    encode(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        
        return encodeMessage(5, Buffer.concat([
            encodeString(1, this.id),
            encodeMessage(3, encodeString(1, this.content)),
            this._encodeServerData(cascadeId, turnId),
            encodeString(11, cascadeId),
            encodeString(13, turnId),
            encodeMessage(14, Buffer.concat([
                encodeVarintField(1, timestamp),
                encodeVarintField(2, nanos)
            ]))
        ]));
    }
    
    _encodeServerData(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        const serverData = Buffer.concat([
            encodeString(1, uuidv4()),
            encodeVarintField(1, timestamp),
            encodeVarintField(2, nanos)
        ]);
        return encodeBytes(7, Buffer.from(serverData.toString('base64')));
    }
}

/**
 * Tool call request message
 */
class ToolCallMessage extends Message {
    constructor(callId, toolName, params = {}, id = uuidv4()) {
        super(MessageType.TOOL_CALL, id);
        this.callId = callId;      // e.g., "call_eUhKl67rXZNARIHAiux5wcNl"
        this.toolName = toolName;  // e.g., "ls", "cat", "grep"
        this.params = params;      // Tool parameters
    }
    
    encode(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        
        // Tool call content (field 2 in field 4)
        const toolContent = Buffer.concat([
            encodeString(1, this.toolName),
            encodeVarintField(2, 1),  // mode = wait
            encodeVarintField(6, 0)   // is_read_only = false
        ]);
        
        return encodeMessage(5, Buffer.concat([
            encodeString(1, this.id),
            encodeMessage(4, Buffer.concat([
                encodeString(1, this.callId),
                encodeMessage(2, toolContent)
            ])),
            this._encodeServerData(cascadeId, turnId),
            encodeString(11, cascadeId),
            encodeString(13, turnId),
            encodeMessage(14, Buffer.concat([
                encodeVarintField(1, timestamp),
                encodeVarintField(2, nanos)
            ]))
        ]));
    }
    
    _encodeServerData(cascadeId, turnId) {
        // Additional server data can be added here
        return encodeBytes(7, Buffer.from(''));
    }
}

/**
 * Tool execution result message
 */
class ToolResultMessage extends Message {
    constructor(callId, command, output, context = {}, id = uuidv4()) {
        super(MessageType.TOOL_RESULT, id);
        this.callId = callId;
        this.command = command;
        this.output = output;
        this.context = context;
        this.precmdId = `precmd-${Date.now()}-${Math.floor(Math.random() * 10)}`;
    }
    
    encode(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        
        // Tool result content (field 2 in field 5)
        const resultContent = Buffer.concat([
            encodeString(3, this.command),
            encodeMessage(5, Buffer.concat([
                encodeString(1, this.output),
                encodeString(3, this.precmdId)
            ]))
        ]);
        
        // Environment context
        const envContext = Buffer.concat([
            encodeMessage(1, Buffer.concat([
                encodeString(1, this.context.workingDir || '/tmp'),
                encodeString(2, this.context.homeDir || '/tmp'),
                encodeVarintField(3, 1)
            ])),
            encodeMessage(2, encodeMessage(1, encodeFixed32(9, 0x534f6361))),
            encodeMessage(3, Buffer.concat([
                encodeString(1, this.context.shell || 'zsh'),
                encodeString(2, this.context.shellVersion || '5.9')
            ])),
            encodeMessage(4, Buffer.concat([
                encodeVarintField(1, timestamp),
                encodeVarintField(2, nanos)
            ])),
            ...(this.context.repoName ? [encodeMessage(8, Buffer.concat([
                encodeString(1, this.context.repoName),
                encodeString(2, this.context.workingDir || '/tmp')
            ]))] : []),
            ...(this.context.gitBranch ? [encodeMessage(11, encodeString(1, this.context.gitBranch))] : [])
        ]);
        
        return encodeMessage(5, Buffer.concat([
            encodeString(1, this.id),
            encodeMessage(5, Buffer.concat([
                encodeString(1, this.callId),
                encodeMessage(2, resultContent),
                encodeMessage(11, envContext)
            ])),
            this._encodeServerData(cascadeId, turnId),
            encodeString(11, cascadeId),
            encodeString(13, turnId),
            encodeMessage(14, Buffer.concat([
                encodeVarintField(1, timestamp),
                encodeVarintField(2, nanos)
            ]))
        ]));
    }
    
    _encodeServerData(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        const serverData = Buffer.concat([
            encodeVarintField(1, timestamp),
            encodeVarintField(2, nanos)
        ]);
        return encodeBytes(7, Buffer.from(serverData.toString('base64')));
    }
}

/**
 * Reasoning/thinking message
 */
class ReasoningMessage extends Message {
    constructor(content, usage = { inputTokens: 0, outputTokens: 0 }, id = uuidv4()) {
        super(MessageType.REASONING, id);
        this.content = content;
        this.usage = usage;
    }
    
    encode(cascadeId, turnId) {
        const timestamp = Math.floor(this.timestamp / 1000);
        const nanos = (this.timestamp % 1000) * 1000000;
        
        return encodeMessage(5, Buffer.concat([
            encodeString(1, this.id),
            encodeMessage(15, Buffer.concat([
                encodeString(1, this.content),
                encodeMessage(2, Buffer.concat([
                    encodeVarintField(1, this.usage.inputTokens),
                    encodeVarintField(2, this.usage.outputTokens)
                ]))
            ])),
            this._encodeServerData(cascadeId, turnId),
            encodeString(11, cascadeId),
            encodeString(13, turnId),
            encodeMessage(14, Buffer.concat([
                encodeVarintField(1, timestamp),
                encodeVarintField(2, nanos)
            ]))
        ]));
    }
    
    _encodeServerData(cascadeId, turnId) {
        return encodeBytes(7, Buffer.from(''));
    }
}

// ==================== Session Management ====================

/**
 * Session state
 */
class Session {
    constructor(id = uuidv4()) {
        this.id = id;
        this.cascadeId = uuidv4();
        this.turnId = uuidv4();
        this.title = '';
        this.messages = [];
        this.context = {
            workingDir: process.cwd(),
            homeDir: process.env.HOME || '/tmp',
            shell: 'zsh',
            shellVersion: '5.9',
            repoName: '',
            gitBranch: 'master'
        };
        this.model = 'claude-4.1-opus';
        this.createdAt = new Date();
        this.updatedAt = new Date();
    }
    
    addMessage(message) {
        message.cascadeId = this.cascadeId;
        message.turnId = this.turnId;
        this.messages.push(message);
        this.updatedAt = new Date();
    }
    
    /**
     * Start a new turn (when user sends new message)
     */
    newTurn() {
        this.turnId = uuidv4();
    }
    
    /**
     * Encode all messages to Protobuf
     */
    encodeMessages() {
        return Buffer.concat(
            this.messages.map(msg => msg.encode(this.cascadeId, this.turnId))
        );
    }
}

// ==================== Warp Request Building ====================

/**
 * Build complete Warp request body
 */
function buildWarpRequest(session, userQuery = null, model = 'claude-4.1-opus') {
    const timestamp = Math.floor(Date.now() / 1000);
    const nanos = (Date.now() % 1000) * 1000000;
    
    // Field 1: Cascade information
    const cascadeInfo = Buffer.concat([
        encodeString(1, session.cascadeId),
        encodeString(2, session.title || 'Chat'),
        // Field 5: Messages array
        session.encodeMessages(),
        // Field 8: Model info (base64 encoded)
        encodeBytes(8, Buffer.from(`\x0a\x15${model}`))
    ]);
    
    // Field 2: Current environment and user query
    const envInfo = Buffer.concat([
        encodeMessage(1, Buffer.concat([
            encodeString(1, session.context.workingDir),
            encodeString(2, session.context.homeDir),
            encodeVarintField(3, 1)
        ])),
        encodeMessage(2, encodeMessage(1, encodeFixed32(9, 0x534f6361))),
        encodeMessage(3, Buffer.concat([
            encodeString(1, session.context.shell),
            encodeString(2, session.context.shellVersion)
        ])),
        encodeMessage(4, Buffer.concat([
            encodeVarintField(1, timestamp),
            encodeVarintField(2, nanos)
        ])),
        ...(session.context.repoName ? [encodeMessage(8, Buffer.concat([
            encodeString(1, session.context.repoName),
            encodeString(2, session.context.workingDir)
        ]))] : []),
        ...(session.context.gitBranch ? [encodeMessage(11, encodeString(1, session.context.gitBranch))] : [])
    ]);
    
    // Field 2.6: User query (if new query)
    let field2Content;
    if (userQuery) {
        const queryContent = Buffer.concat([
            encodeString(1, userQuery),
            encodeString(3, ''),
            encodeVarintField(4, 1)
        ]);
        field2Content = Buffer.concat([
            encodeMessage(1, envInfo),
            encodeMessage(6, encodeMessage(1, encodeMessage(1, queryContent)))
        ]);
    } else {
        field2Content = encodeMessage(1, envInfo);
    }
    
    // Field 3: Model configuration
    const modelConfig = Buffer.concat([
        encodeMessage(1, Buffer.concat([
            encodeString(1, model),
            encodeString(4, 'cli-agent-auto')
        ])),
        encodeVarintField(2, 1),
        encodeVarintField(3, 1),
        encodeVarintField(4, 1),
        encodeVarintField(6, 1),
        encodeVarintField(7, 1),
        encodeVarintField(8, 1),
        encodeBytes(9, Buffer.from([0x06, 0x07, 0x0c, 0x08, 0x09, 0x0f, 0x0e, 0x00, 0x0b, 0x10, 0x0a, 0x14, 0x11, 0x13, 0x12, 0x02, 0x03, 0x01, 0x0d])),
        encodeVarintField(10, 1),
        encodeVarintField(11, 1),
        encodeVarintField(12, 1),
        encodeVarintField(13, 1),
        encodeVarintField(14, 1),
        encodeVarintField(15, 1),
        encodeVarintField(16, 1),
        encodeVarintField(17, 1),
        encodeVarintField(21, 1),
        encodeBytes(22, Buffer.from([0x0a, 0x14, 0x06, 0x07, 0x0c, 0x02, 0x01])),
        encodeVarintField(23, 1)
    ]);
    
    // Field 4: Metadata
    const metadata = Buffer.concat([
        encodeString(1, session.id),
        encodeMessage(2, Buffer.concat([
            encodeString(1, 'entrypoint'),
            encodeMessage(2, encodeMessage(3, Buffer.concat([
                encodeFixed64(10, 0x5f524553n),
                encodeFixed64(9, 0x444554414954494en)
            ])))
        ])),
        encodeMessage(2, Buffer.concat([
            encodeString(1, 'is_auto_resume_after_error'),
            encodeMessage(2, encodeVarintField(4, 0))
        ])),
        encodeMessage(2, Buffer.concat([
            encodeString(1, 'is_autodetected_user_query'),
            encodeMessage(2, encodeVarintField(4, 1))
        ]))
    ]);
    
    // Combine complete request
    return Buffer.concat([
        encodeMessage(1, cascadeInfo),
        encodeMessage(2, field2Content),
        encodeMessage(3, modelConfig),
        encodeMessage(4, metadata)
    ]);
}

// ==================== Response Parsing ====================

/**
 * Parse events in SSE response
 */
function parseSSEEvent(line) {
    if (!line.startsWith('data:')) return null;
    const data = line.substring(5).trim();
    if (!data) return null;
    
    try {
        return Buffer.from(data, 'base64');
    } catch {
        return null;
    }
}

/**
 * Extract text content from Protobuf response
 */
function extractAgentText(buffer) {
    const texts = [];
    
    // Find agent_output.text marker
    const bufferStr = buffer.toString('utf8');
    if (!bufferStr.includes('agent_output')) {
        return null;
    }
    
    // Use nested parsing to extract text
    for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === 0x1a) {  // Length-delimited field
            const outerLen = buffer[i + 1];
            if (outerLen > 2 && outerLen < 200 && buffer[i + 2] === 0x0a) {
                const innerLen = buffer[i + 3];
                if (innerLen > 0 && innerLen <= outerLen - 2 && i + 4 + innerLen <= buffer.length) {
                    const text = buffer.slice(i + 4, i + 4 + innerLen).toString('utf8');
                    
                    // Filter
                    if (text.length === 0) continue;
                    if (text.length === 36 && /^[0-9a-f-]{36}$/.test(text)) continue;
                    if (text.includes('agent_') || text.includes('server_') ||
                        text.includes('USER_') || text.includes('primary_') ||
                        text.includes('call_') || text.includes('precmd-')) continue;
                    
                    // Check if has visible content
                    const hasChinese = /[\u4e00-\u9fff]/.test(text);
                    const hasAlpha = /[a-zA-Z0-9]/.test(text);
                    
                    if (hasChinese || hasAlpha) {
                        if (!/^[A-Za-z0-9+/=]+$/.test(text) || text.length < 20) {
                            texts.push(text);
                        }
                    }
                }
            }
        }
    }
    
    return texts.length > 0 ? texts.join('') : null;
}

/**
 * Extract tool calls from response
 */
function extractToolCall(buffer) {
    const bufferStr = buffer.toString('utf8');
    
    // Check if contains tool call identifier
    if (!bufferStr.includes('call_')) return null;
    
    // Extract call_id
    const callIdMatch = bufferStr.match(/call_[A-Za-z0-9]+/);
    if (!callIdMatch) return null;
    
    const callId = callIdMatch[0];
    
    // Extract command
    const cmdMatch = bufferStr.match(/\x0a\x02ls|\x0a\x03cat|\x0a\x04grep|\x0a\x04find/);
    let command = 'ls';
    if (cmdMatch) {
        command = cmdMatch[0].slice(2);
    }
    
    return { callId, command };
}

/**
 * Extract reasoning content from response
 */
function extractReasoning(buffer) {
    const bufferStr = buffer.toString('utf8');
    
    if (!bufferStr.includes('agent_reasoning')) return null;
    
    // Extract reasoning text
    const texts = [];
    for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === 0x1a) {
            const outerLen = buffer[i + 1];
            if (outerLen > 2 && outerLen < 200 && buffer[i + 2] === 0x0a) {
                const innerLen = buffer[i + 3];
                if (innerLen > 0 && innerLen <= outerLen - 2 && i + 4 + innerLen <= buffer.length) {
                    const text = buffer.slice(i + 4, i + 4 + innerLen).toString('utf8');
                    if (text.length > 0 && !text.includes('agent_') && !text.includes('call_')) {
                        texts.push(text);
                    }
                }
            }
        }
    }
    
    return texts.length > 0 ? texts.join('') : null;
}

// ==================== Warp Proxy Service ====================

/**
 * Warp Proxy Service
 */
export class WarpProxy extends EventEmitter {
    constructor(options = {}) {
        super();
        this.accessToken = options.accessToken;
        this.sessions = new Map();
        this.maxIterations = options.maxIterations || 20;
        this.autoExecuteTools = options.autoExecuteTools !== false;
        
        // Tool handlers
        this.toolHandlers = {
            ls: this._handleLs.bind(this),
            cat: this._handleCat.bind(this),
            grep: this._handleGrep.bind(this),
            find: this._handleFind.bind(this),
            run_shell_command: this._handleShell.bind(this)
        };
    }
    
    /**
     * Create new session
     */
    createSession(context = {}) {
        const session = new Session();
        Object.assign(session.context, context);
        this.sessions.set(session.id, session);
        return session;
    }
    
    /**
     * Get session
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    
    /**
     * Send request to Warp
     */
    async sendRequest(session, userQuery = null, model = 'claude-4.1-opus') {
        const body = buildWarpRequest(session, userQuery, model);
        
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'app.warp.dev',
                port: 443,
                path: '/ai/multi-agent',
                method: 'POST',
                headers: {
                    'x-warp-client-id': 'warp-app',
                    'x-warp-client-version': 'v0.2026.01.14.08.15.stable_04',
                    'x-warp-os-category': 'macOS',
                    'x-warp-os-name': 'macOS',
                    'x-warp-os-version': '15.7.2',
                    'content-type': 'application/x-protobuf',
                    'accept': 'text/event-stream',
                    'accept-encoding': 'identity',
                    'authorization': `Bearer ${this.accessToken}`,
                    'content-length': body.length
                }
            };
            
            const req = https.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let errorData = '';
                    res.on('data', chunk => errorData += chunk);
                    res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errorData}`)));
                    return;
                }
                
                let fullText = '';
                let toolCalls = [];
                let reasoning = '';
                let buffer = '';
                
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        if (line.startsWith('event:')) continue;
                        
                        const decoded = parseSSEEvent(line);
                        if (!decoded) continue;
                        
                        // Extract text
                        const text = extractAgentText(decoded);
                        if (text) {
                            fullText += text;
                            this.emit('text', text);
                        }
                        
                        // Extract tool calls
                        const toolCall = extractToolCall(decoded);
                        if (toolCall && !toolCalls.find(t => t.callId === toolCall.callId)) {
                            toolCalls.push(toolCall);
                            this.emit('tool_call', toolCall);
                        }
                        
                        // Extract reasoning
                        const reasoningText = extractReasoning(decoded);
                        if (reasoningText) {
                            reasoning += reasoningText;
                            this.emit('reasoning', reasoningText);
                        }
                    }
                });
                
                res.on('end', () => {
                    resolve({
                        text: fullText,
                        toolCalls,
                        reasoning
                    });
                });
                
                res.on('error', reject);
            });
            
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }
    
    /**
     * Execute tool
     */
    async executeTool(toolName, params, context) {
        const handler = this.toolHandlers[toolName] || this.toolHandlers.run_shell_command;
        try {
            const result = await handler(params, context);
            return { success: true, output: result };
        } catch (error) {
            return { success: false, output: `Error: ${error.message}` };
        }
    }
    
    /**
     * Core: Multi-turn conversation processing
     */
    async chat(sessionOrId, userQuery, options = {}) {
        // Get or create session
        let session;
        if (typeof sessionOrId === 'string') {
            session = this.getSession(sessionOrId);
            if (!session) {
                session = this.createSession(options.context);
                session.id = sessionOrId;
                this.sessions.set(sessionOrId, session);
            }
        } else if (sessionOrId instanceof Session) {
            session = sessionOrId;
        } else {
            session = this.createSession(options.context);
        }
        
        const model = options.model || session.model || 'claude-4.1-opus';
        
        // Add user message
        const userMsg = new UserQueryMessage(userQuery, session.context);
        session.addMessage(userMsg);
        session.newTurn();
        
        let iteration = 0;
        let finalResponse = '';
        const allToolCalls = [];
        
        while (iteration < this.maxIterations) {
            iteration++;
            
            this.emit('iteration_start', { iteration, sessionId: session.id });
            
            // Send request
            const response = await this.sendRequest(
                session,
                iteration === 1 ? userQuery : null,
                model
            );
            
            // Add assistant response
            if (response.text) {
                const assistantMsg = new AssistantTextMessage(response.text);
                session.addMessage(assistantMsg);
                finalResponse = response.text;
            }
            
            // Check if there are tool calls
            if (response.toolCalls.length > 0 && this.autoExecuteTools) {
                for (const toolCall of response.toolCalls) {
                    this.emit('tool_executing', toolCall);
                    
                    // Execute tool
                    const result = await this.executeTool(
                        toolCall.command,
                        { command: toolCall.command },
                        session.context
                    );
                    
                    // Add tool result to session
                    const toolResultMsg = new ToolResultMessage(
                        toolCall.callId,
                        toolCall.command,
                        result.output,
                        session.context
                    );
                    session.addMessage(toolResultMsg);
                    
                    allToolCalls.push({
                        ...toolCall,
                        result: result.output
                    });
                    
                    this.emit('tool_result', { toolCall, result });
                }
                
                // Continue loop to let AI process tool result
                continue;
            }
            
            // No tool calls, complete
            this.emit('complete', {
                sessionId: session.id,
                response: finalResponse,
                toolCalls: allToolCalls,
                iterations: iteration
            });
            
            return {
                sessionId: session.id,
                response: finalResponse,
                toolCalls: allToolCalls,
                iterations: iteration
            };
        }
        
        // Reached maximum iterations
        this.emit('max_iterations', { sessionId: session.id, iterations: iteration });
        
        return {
            sessionId: session.id,
            response: finalResponse,
            toolCalls: allToolCalls,
            iterations: iteration,
            maxIterationsReached: true
        };
    }
    
    /**
     * Streaming conversation
     */
    async *chatStream(sessionOrId, userQuery, options = {}) {
        // Get or create session
        let session;
        if (typeof sessionOrId === 'string') {
            session = this.getSession(sessionOrId) || this.createSession(options.context);
        } else if (sessionOrId instanceof Session) {
            session = sessionOrId;
        } else {
            session = this.createSession(options.context);
        }
        
        const model = options.model || session.model || 'claude-4.1-opus';
        
        // Add user message
        const userMsg = new UserQueryMessage(userQuery, session.context);
        session.addMessage(userMsg);
        session.newTurn();
        
        let iteration = 0;
        
        while (iteration < this.maxIterations) {
            iteration++;
            
            yield { type: 'iteration_start', iteration, sessionId: session.id };
            
            const body = buildWarpRequest(
                session,
                iteration === 1 ? userQuery : null,
                model
            );
            
            // Streaming request
            const response = await this._streamRequest(body);
            
            for await (const event of response) {
                yield event;
                
                // Process tool call
                if (event.type === 'tool_call' && this.autoExecuteTools) {
                    yield { type: 'tool_executing', ...event };
                    
                    const result = await this.executeTool(
                        event.command,
                        { command: event.command },
                        session.context
                    );
                    
                    // Add tool result
                    const toolResultMsg = new ToolResultMessage(
                        event.callId,
                        event.command,
                        result.output,
                        session.context
                    );
                    session.addMessage(toolResultMsg);
                    
                    yield { type: 'tool_result', callId: event.callId, result };
                }
            }
            
            // Check if need to continue
            if (!response.hasToolCalls) {
                yield { type: 'complete', sessionId: session.id, iterations: iteration };
                return;
            }
        }
        
        yield { type: 'max_iterations', sessionId: session.id, iterations: iteration };
    }
    
    /**
     * Internal streaming request
     */
    async *_streamRequest(body) {
        // Simplified version, returns async generator
        const response = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'app.warp.dev',
                port: 443,
                path: '/ai/multi-agent',
                method: 'POST',
                headers: {
                    'x-warp-client-id': 'warp-app',
                    'x-warp-client-version': 'v0.2026.01.14.08.15.stable_04',
                    'x-warp-os-category': 'macOS',
                    'x-warp-os-name': 'macOS',
                    'x-warp-os-version': '15.7.2',
                    'content-type': 'application/x-protobuf',
                    'accept': 'text/event-stream',
                    'accept-encoding': 'identity',
                    'authorization': `Bearer ${this.accessToken}`,
                    'content-length': body.length
                }
            };
            
            const req = https.request(options, resolve);
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        
        let hasToolCalls = false;
        let buffer = '';
        
        for await (const chunk of response) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('event:')) continue;
                
                const decoded = parseSSEEvent(line);
                if (!decoded) continue;
                
                const text = extractAgentText(decoded);
                if (text) {
                    yield { type: 'text', content: text };
                }
                
                const toolCall = extractToolCall(decoded);
                if (toolCall) {
                    hasToolCalls = true;
                    yield { type: 'tool_call', ...toolCall };
                }
                
                const reasoning = extractReasoning(decoded);
                if (reasoning) {
                    yield { type: 'reasoning', content: reasoning };
                }
            }
        }
        
        // Mark if has tool calls
        response.hasToolCalls = hasToolCalls;
    }
    
    // ==================== Tool Handlers ====================
    
    async _handleLs(params, context) {
        const cwd = context?.workingDir || process.cwd();
        const { stdout } = await execAsync('ls', { cwd });
        return stdout;
    }
    
    async _handleCat(params, context) {
        const file = params.file || params.path;
        const content = await fs.readFile(file, 'utf-8');
        return content;
    }
    
    async _handleGrep(params, context) {
        const pattern = params.pattern || params.query;
        const path = params.path || '.';
        const { stdout } = await execAsync(`grep -rn "${pattern}" "${path}" | head -50`, {
            cwd: context?.workingDir || process.cwd()
        });
        return stdout || 'No matches found';
    }
    
    async _handleFind(params, context) {
        const pattern = params.pattern || '*';
        const path = params.path || '.';
        const { stdout } = await execAsync(`find "${path}" -name "${pattern}" | head -50`, {
            cwd: context?.workingDir || process.cwd()
        });
        return stdout || 'No files found';
    }
    
    async _handleShell(params, context) {
        const command = params.command || 'echo "no command"';
        const cwd = context?.workingDir || process.cwd();
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: 30000,
            env: { ...process.env, PAGER: 'cat' }
        });
        return stdout || stderr || '(no output)';
    }
}

// ==================== Express Routes ====================

export function setupWarpProxyRoutes(app, warpStore) {
    const proxies = new Map();
    
    /**
     * Get proxy instance
     */
    async function getProxy(credentialId) {
        if (proxies.has(credentialId)) {
            return proxies.get(credentialId);
        }
        
        const credential = credentialId 
            ? await warpStore.getById(credentialId)
            : await warpStore.getRandomActive();
            
        if (!credential) {
            throw new Error('No available credentials');
        }
        
        // Check if token needs refresh
        const { refreshAccessToken, isTokenExpired } = await import('./warp-service.js');
        let accessToken = credential.accessToken;
        
        if (!accessToken || isTokenExpired(accessToken)) {
            const result = await refreshAccessToken(credential.refreshToken);
            accessToken = result.accessToken;
            await warpStore.updateToken(credential.id, accessToken, new Date(Date.now() + result.expiresIn * 1000));
        }
        
        const proxy = new WarpProxy({ accessToken });
        proxies.set(credential.id, proxy);
        return proxy;
    }
    
    /**
     * Non-streaming conversation
     */
    app.post('/api/warp/proxy/chat', async (req, res) => {
        try {
            const { query, sessionId, model, context, credentialId } = req.body;
            
            if (!query) {
                return res.status(400).json({ error: 'query is required' });
            }
            
            const proxy = await getProxy(credentialId);
            const result = await proxy.chat(sessionId, query, { model, context });
            
            await warpStore.incrementUseCount(credentialId || 1);
            
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    /**
     * Streaming conversation
     */
    app.post('/api/warp/proxy/stream', async (req, res) => {
        const { query, sessionId, model, context, credentialId } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        try {
            const proxy = await getProxy(credentialId);
            
            for await (const event of proxy.chatStream(sessionId, query, { model, context })) {
                res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
            
            await warpStore.incrementUseCount(credentialId || 1);
            res.end();
        } catch (error) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    });
    
    /**
     * Session management
     */
    app.get('/api/warp/proxy/sessions', async (req, res) => {
        const { credentialId } = req.query;
        const proxy = await getProxy(credentialId);
        
        const sessions = Array.from(proxy.sessions.values()).map(s => ({
            id: s.id,
            title: s.title,
            messageCount: s.messages.length,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt
        }));
        
        res.json({ success: true, sessions });
    });
    
    app.delete('/api/warp/proxy/sessions/:id', async (req, res) => {
        const { credentialId } = req.query;
        const proxy = await getProxy(credentialId);
        
        proxy.sessions.delete(req.params.id);
        res.json({ success: true });
    });
    
    console.log('[WarpProxy] Routes configured');
    console.log('[WarpProxy] Endpoints:');
    console.log('[WarpProxy]   POST /api/warp/proxy/chat - Non-streaming conversation');
    console.log('[WarpProxy]   POST /api/warp/proxy/stream - Streaming conversation');
    console.log('[WarpProxy]   GET /api/warp/proxy/sessions - Get session list');
}

export default WarpProxy;
