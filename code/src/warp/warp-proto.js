/**
 * Warp Protobuf Loader
 * Load and encode/decode Warp protocol messages using protobufjs
 */

import protobuf from 'protobufjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.join(__dirname, '../..', 'warp-protobuf-master');

// Cache loaded root and message types
let root = null;
let messageTypes = {};

/**
 * Load all proto files
 * @returns {Promise<Object>} Message type object
 */
export async function loadProtos() {
    if (root) return messageTypes;

    // Create new Root instance
    root = new protobuf.Root();

    // Set parsing options to support google.protobuf types
    root.resolvePath = (origin, target) => {
        // Handle google/protobuf imports
        if (target.startsWith('google/protobuf/')) {
            // protobufjs has these types built-in, return null to use built-in ones
            return null;
        }
        // Load other files from PROTO_DIR
        return path.join(PROTO_DIR, target);
    };

    // Load proto files in dependency order
    const protoFiles = [
        'options.proto',
        'citations.proto',
        'file_content.proto',
        'attachment.proto',
        'todo.proto',
        'suggestions.proto',
        'input_context.proto',
        'task.proto',
        'request.proto',
        'response.proto',
    ];

    for (const file of protoFiles) {
        await root.load(path.join(PROTO_DIR, file), { keepCase: true });
    }

    // Find and cache message types
    messageTypes = {
        // Request/Response
        Request: root.lookupType('warp.multi_agent.v1.Request'),
        ResponseEvent: root.lookupType('warp.multi_agent.v1.ResponseEvent'),

        // Task related
        Task: root.lookupType('warp.multi_agent.v1.Task'),
        TaskStatus: root.lookupType('warp.multi_agent.v1.TaskStatus'),
        Message: root.lookupType('warp.multi_agent.v1.Message'),

        // Input context
        InputContext: root.lookupType('warp.multi_agent.v1.InputContext'),

        // File content
        FileContent: root.lookupType('warp.multi_agent.v1.FileContent'),
        FileContentLineRange: root.lookupType('warp.multi_agent.v1.FileContentLineRange'),

        // Tool type enum
        ToolType: root.lookupEnum('warp.multi_agent.v1.ToolType'),

        // Client actions
        ClientAction: root.lookupType('warp.multi_agent.v1.ClientAction'),

        // Tool result types
        RunShellCommandResult: root.lookupType('warp.multi_agent.v1.RunShellCommandResult'),
        ReadFilesResult: root.lookupType('warp.multi_agent.v1.ReadFilesResult'),
        ApplyFileDiffsResult: root.lookupType('warp.multi_agent.v1.ApplyFileDiffsResult'),
        GrepResult: root.lookupType('warp.multi_agent.v1.GrepResult'),
        FileGlobV2Result: root.lookupType('warp.multi_agent.v1.FileGlobV2Result'),
        CallMCPToolResult: root.lookupType('warp.multi_agent.v1.CallMCPToolResult'),
        ShellCommandFinished: root.lookupType('warp.multi_agent.v1.ShellCommandFinished'),
    };

    return messageTypes;
}

/**
 * Get message types (ensure loaded)
 * @returns {Promise<Object>} Message type object
 */
export async function getMessageTypes() {
    if (!root) {
        await loadProtos();
    }
    return messageTypes;
}

/**
 * Encode Request message
 * @param {Object} requestObj - Request object
 * @returns {Buffer} Encoded binary data
 */
export function encodeRequest(requestObj) {
    if (!messageTypes.Request) {
        throw new Error('Proto types not loaded. Call loadProtos() first.');
    }

    const { Request } = messageTypes;

    // Validate message
    const errMsg = Request.verify(requestObj);
    if (errMsg) {
        throw new Error(`Invalid request: ${errMsg}`);
    }

    // Create and encode message
    const message = Request.create(requestObj);
    return Buffer.from(Request.encode(message).finish());
}

/**
 * Decode ResponseEvent message
 * @param {Buffer|Uint8Array} buffer - Binary data
 * @returns {Object} Decoded response event object
 */
export function decodeResponseEvent(buffer) {
    if (!messageTypes.ResponseEvent) {
        throw new Error('Proto types not loaded. Call loadProtos() first.');
    }

    const { ResponseEvent } = messageTypes;
    return ResponseEvent.decode(buffer);
}

/**
 * Decode Message message
 * @param {Buffer|Uint8Array} buffer - Binary data
 * @returns {Object} Decoded message object
 */
export function decodeMessage(buffer) {
    if (!messageTypes.Message) {
        throw new Error('Proto types not loaded. Call loadProtos() first.');
    }

    const { Message } = messageTypes;
    return Message.decode(buffer);
}

/**
 * Convert ResponseEvent to plain JavaScript object
 * @param {Object} responseEvent - protobufjs decoded object
 * @returns {Object} Plain JavaScript object
 */
export function responseEventToObject(responseEvent) {
    if (!messageTypes.ResponseEvent) {
        throw new Error('Proto types not loaded. Call loadProtos() first.');
    }

    const { ResponseEvent } = messageTypes;
    return ResponseEvent.toObject(responseEvent, {
        longs: Number,
        enums: String,
        bytes: String,
        defaults: true,
        oneofs: true
    });
}

/**
 * Get ToolType enum value
 * @param {string} name - Tool type name
 * @returns {number} Enum value
 */
export function getToolTypeValue(name) {
    if (!messageTypes.ToolType) {
        throw new Error('Proto types not loaded. Call loadProtos() first.');
    }

    return messageTypes.ToolType.values[name];
}

/**
 * Get ToolType enum name
 * @param {number} value - Enum value
 * @returns {string} Tool type name
 */
export function getToolTypeName(value) {
    if (!messageTypes.ToolType) {
        throw new Error('Proto types not loaded. Call loadProtos() first.');
    }

    const { ToolType } = messageTypes;
    for (const [name, val] of Object.entries(ToolType.values)) {
        if (val === value) return name;
    }
    return 'UNKNOWN';
}

/**
 * Create InputContext object
 * @param {Object} options - Options
 * @param {string} options.pwd - Current working directory
 * @param {string} options.home - User home directory
 * @param {string} options.platform - Operating system platform
 * @param {string} options.shellName - Shell name
 * @param {string} options.shellVersion - Shell version
 * @returns {Object} InputContext object
 */
export function createInputContext(options = {}) {
    const {
        pwd = '/tmp',
        home = process.env.HOME || '/root',
        platform = process.platform === 'darwin' ? 'macOS' : process.platform,
        shellName = 'zsh',
        shellVersion = '5.9'
    } = options;

    return {
        directory: {
            pwd,
            home,
            pwd_file_symbols_indexed: false
        },
        operating_system: {
            platform,
            distribution: ''
        },
        shell: {
            name: shellName,
            version: shellVersion
        },
        current_time: {
            seconds: Math.floor(Date.now() / 1000),
            nanos: (Date.now() % 1000) * 1000000
        }
    };
}

/**
 * Create TaskStatus object
 * @param {string} status - Status name: 'pending', 'in_progress', 'blocked', 'succeeded', 'failed', 'aborted'
 * @returns {Object} TaskStatus object
 */
export function createTaskStatus(status = 'in_progress') {
    const statusMap = {
        'pending': { pending: {} },
        'in_progress': { in_progress: {} },
        'blocked': { blocked: {} },
        'succeeded': { succeeded: {} },
        'failed': { failed: {} },
        'aborted': { aborted: {} }
    };

    return statusMap[status] || statusMap['in_progress'];
}

// Export ToolType enum value constants (for convenience)
export const TOOL_TYPES = {
    RUN_SHELL_COMMAND: 0,
    SEARCH_CODEBASE: 1,
    READ_FILES: 2,
    APPLY_FILE_DIFFS: 3,
    SUGGEST_PLAN: 4,
    SUGGEST_CREATE_PLAN: 5,
    GREP: 6,
    FILE_GLOB: 7,
    READ_MCP_RESOURCE: 8,
    CALL_MCP_TOOL: 9,
    WRITE_TO_LONG_RUNNING_SHELL_COMMAND: 10,
    SUGGEST_NEW_CONVERSATION: 11,
    FILE_GLOB_V2: 12
};
