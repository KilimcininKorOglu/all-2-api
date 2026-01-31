/**
 * Warp Tool Mapper
 * Handles bidirectional conversion between Claude API tools and Warp tools
 */

import { TOOL_TYPES } from './warp-proto.js';

/**
 * Claude tool name -> Warp tool type mapping
 */
export const CLAUDE_TO_WARP_TOOL = {
    'Bash': { type: TOOL_TYPES.RUN_SHELL_COMMAND, field: 'run_shell_command' },
    'Read': { type: TOOL_TYPES.READ_FILES, field: 'read_files' },
    'Write': { type: TOOL_TYPES.APPLY_FILE_DIFFS, field: 'apply_file_diffs' },
    'Edit': { type: TOOL_TYPES.APPLY_FILE_DIFFS, field: 'apply_file_diffs' },
    'Grep': { type: TOOL_TYPES.GREP, field: 'grep' },
    'Glob': { type: TOOL_TYPES.FILE_GLOB_V2, field: 'file_glob_v2' },
    'WebFetch': { type: TOOL_TYPES.CALL_MCP_TOOL, field: 'call_mcp_tool' },
    'WebSearch': { type: TOOL_TYPES.CALL_MCP_TOOL, field: 'call_mcp_tool' },
    'Task': { type: TOOL_TYPES.CALL_MCP_TOOL, field: 'call_mcp_tool' },
    'TodoWrite': { type: TOOL_TYPES.CALL_MCP_TOOL, field: 'call_mcp_tool' },
};

/**
 * Warp tool type -> Claude tool name mapping
 */
export const WARP_TO_CLAUDE_TOOL = {
    [TOOL_TYPES.RUN_SHELL_COMMAND]: 'Bash',
    [TOOL_TYPES.READ_FILES]: 'Read',
    [TOOL_TYPES.APPLY_FILE_DIFFS]: 'Write',  // Default maps to Write, Edit needs content-based determination
    [TOOL_TYPES.GREP]: 'Grep',
    [TOOL_TYPES.FILE_GLOB_V2]: 'Glob',
    [TOOL_TYPES.CALL_MCP_TOOL]: null,  // MCP tools need name-based determination
    [TOOL_TYPES.SEARCH_CODEBASE]: 'Grep',  // Search codebase maps to Grep
};

/**
 * Get list of Warp supported tool types corresponding to Claude tools
 * @param {Array} claudeTools - Claude API tool definition array
 * @returns {Array<number>} Warp ToolType enum value array
 */
export function getWarpSupportedTools(claudeTools) {
    if (!claudeTools || !Array.isArray(claudeTools)) {
        // Default supported tools
        return [
            TOOL_TYPES.RUN_SHELL_COMMAND,
            TOOL_TYPES.READ_FILES,
            TOOL_TYPES.APPLY_FILE_DIFFS,
            TOOL_TYPES.GREP,
            TOOL_TYPES.FILE_GLOB_V2,
        ];
    }

    const supportedTools = new Set();

    for (const tool of claudeTools) {
        const mapping = CLAUDE_TO_WARP_TOOL[tool.name];
        if (mapping) {
            supportedTools.add(mapping.type);
        } else if (tool.name.startsWith('mcp__')) {
            // MCP tool
            supportedTools.add(TOOL_TYPES.CALL_MCP_TOOL);
        }
    }

    return Array.from(supportedTools);
}

/**
 * Convert Claude tool_use to Warp ToolCall
 * @param {Object} toolUse - Claude tool_use object { id, name, input }
 * @returns {Object} Warp ToolCall object
 */
export function claudeToolUseToWarpToolCall(toolUse) {
    const { id, name, input } = toolUse;
    const toolCall = { tool_call_id: id };

    switch (name) {
        case 'Bash':
            toolCall.run_shell_command = {
                command: input.command || '',
                is_read_only: isReadOnlyCommand(input.command || ''),
                is_risky: isRiskyCommand(input.command || ''),
                uses_pager: false
            };
            break;

        case 'Read':
            toolCall.read_files = {
                files: [{
                    name: input.file_path || '',
                    line_ranges: input.offset && input.limit ? [{
                        start: input.offset,
                        end: input.offset + input.limit
                    }] : []
                }]
            };
            break;

        case 'Write':
            toolCall.apply_file_diffs = {
                summary: `Create ${input.file_path || 'file'}`,
                diffs: [],
                new_files: [{
                    file_path: input.file_path || '',
                    content: input.content || ''
                }]
            };
            break;

        case 'Edit':
            toolCall.apply_file_diffs = {
                summary: `Edit ${input.file_path || 'file'}`,
                diffs: [{
                    file_path: input.file_path || '',
                    search: input.old_string || '',
                    replace: input.new_string || ''
                }],
                new_files: []
            };
            break;

        case 'Grep':
            toolCall.grep = {
                queries: [input.pattern || ''],
                path: input.path || ''
            };
            break;

        case 'Glob':
            toolCall.file_glob_v2 = {
                patterns: [input.pattern || ''],
                search_dir: input.path || '',
                max_matches: 100,
                max_depth: 10,
                min_depth: 0
            };
            break;

        default:
            // MCP tool or other tools
            if (name.startsWith('mcp__')) {
                toolCall.call_mcp_tool = {
                    name: name,
                    args: input || {}
                };
            } else {
                // Unknown tool, try to handle as MCP tool
                toolCall.call_mcp_tool = {
                    name: name,
                    args: input || {}
                };
            }
            break;
    }

    return toolCall;
}

/**
 * Convert Warp ToolCall to Claude tool_use
 * @param {Object} toolCall - Warp ToolCall object
 * @returns {Object|null} Claude tool_use object { id, name, input } or null
 */
export function warpToolCallToClaudeToolUse(toolCall) {
    const { tool_call_id } = toolCall;

    if (toolCall.run_shell_command) {
        return {
            type: 'tool_use',
            id: tool_call_id,
            name: 'Bash',
            input: {
                command: toolCall.run_shell_command.command || ''
            }
        };
    }

    if (toolCall.read_files) {
        const file = toolCall.read_files.files?.[0];
        if (!file) return null;

        const input = { file_path: file.name || '' };
        if (file.line_ranges?.length > 0) {
            const range = file.line_ranges[0];
            input.offset = range.start;
            input.limit = range.end - range.start;
        }

        return {
            type: 'tool_use',
            id: tool_call_id,
            name: 'Read',
            input
        };
    }

    if (toolCall.apply_file_diffs) {
        const { new_files, diffs } = toolCall.apply_file_diffs;

        // If has new_files, this is a Write operation
        if (new_files?.length > 0) {
            const file = new_files[0];
            return {
                type: 'tool_use',
                id: tool_call_id,
                name: 'Write',
                input: {
                    file_path: file.file_path || '',
                    content: file.content || ''
                }
            };
        }

        // If has diffs, this is an Edit operation
        if (diffs?.length > 0) {
          const diff = diffs[0];
            return {
                type: 'tool_use',
                id: tool_call_id,
                name: 'Edit',
                input: {
                    file_path: diff.file_path || '',
                    old_string: diff.search || '',
                    new_string: diff.replace || ''
                }
            };
        }

        return null;
    }

    if (toolCall.grep) {
        return {
            type: 'tool_use',
            id: tool_call_id,
            name: 'Grep',
            input: {
                pattern: toolCall.grep.queries?.[0] || '',
                path: toolCall.grep.path || ''
            }
        };
    }

    if (toolCall.file_glob_v2) {
        return {
            type: 'tool_use',
            id: tool_call_id,
            name: 'Glob',
            input: {
                pattern: toolCall.file_glob_v2.patterns?.[0] || '',
                path: toolCall.file_glob_v2.search_dir || ''
            }
        };
    }

    if (toolCall.call_mcp_tool) {
        return {
            type: 'tool_use',
            id: tool_call_id,
            name: toolCall.call_mcp_tool.name || 'mcp__unknown',
            input: toolCall.call_mcp_tool.args || {}
        };
    }

    // Unknown tool type
    return null;
}

/**
 * Convert Claude tool_result to Warp ToolCallResult
 * @param {Object} toolResult - Claude tool_result object
 * @param {string} toolName - Tool name
 * @returns {Object} Warp ToolCallResult object
 */
export function claudeToolResultToWarpResult(toolResult, toolName) {
    const { tool_use_id, content, is_error } = toolResult;
    const result = { tool_call_id: tool_use_id };

    // Convert content to string
    let contentStr = '';
    if (typeof content === 'string') {
        contentStr = content;
    } else if (Array.isArray(content)) {
        contentStr = content.map(c => c.text || c.content || '').join('\n');
    }

    switch (toolName) {
        case 'Bash':
            result.run_shell_command = {
                command: '',  // Original command not available here
                command_finished: {
                    output: contentStr,
                    exit_code: is_error ? 1 : 0
                }
            };
            break;

        case 'Read':
            if (is_error) {
                result.read_files = {
                    error: { message: contentStr }
                };
            } else {
                result.read_files = {
                    success: {
                        files: [{
                            file_path: '',
                            content: contentStr
                        }]
                    }
                };
            }
            break;

        case 'Write':
        case 'Edit':
            if (is_error) {
                result.apply_file_diffs = {
                    error: { message: contentStr }
                };
            } else {
                result.apply_file_diffs = {
                    success: {
                        updated_files_v2: []
                    }
                };
            }
            break;

        case 'Grep':
            if (is_error) {
                result.grep = {
                    error: { message: contentStr }
                };
            } else {
                result.grep = {
                    success: {
                        matched_files: []  // Simplified handling
                    }
                };
            }
            break;

        case 'Glob':
            if (is_error) {
                result.file_glob_v2 = {
                    error: { message: contentStr }
                };
            } else {
                result.file_glob_v2 = {
                    success: {
                        matched_files: []  // Simplified handling
                    }
                };
            }
            break;

        default:
            // MCP tool or other
            if (is_error) {
                result.call_mcp_tool = {
                    error: { message: contentStr }
                };
            } else {
                result.call_mcp_tool = {
                    success: {
                        results: [{
                            text: { text: contentStr }
                        }]
                    }
                };
            }
            break;
    }

    return result;
}

/**
 * Check if command is read-only
 * @param {string} cmd - Command string
 * @returns {boolean}
 */
export function isReadOnlyCommand(cmd) {
    if (!cmd) return true;

    const readOnlyPatterns = [
        /^ls\b/,
        /^cat\b/,
        /^head\b/,
        /^tail\b/,
        /^grep\b/,
        /^find\b/,
        /^pwd\b/,
        /^echo\b/,
        /^wc\b/,
        /^tree\b/,
        /^file\b/,
        /^stat\b/,
        /^du\b/,
        /^df/,
        /^which\b/,
        /^whereis\b/,
        /^type\b/,
        /^env\b/,
        /^printenv\b/,
        /^whoami\b/,
        /^id\b/,
        /^date\b/,
        /^uname\b/,
        /^hostname\b/,
        /^git\s+(status|log|diff|show|branch|remote|tag)\b/,
        /^npm\s+(list|ls|view|info|search)\b/,
        /^node\s+--version/,
        /^python\s+--version/,
    ];

    return readOnlyPatterns.some(p => p.test(cmd.trim()));
}

/**
 * Check if command is risky
 * @param {string} cmd - Command string
 * @returns {boolean}
 */
export function isRiskyCommand(cmd) {
    if (!cmd) return false;

    const riskyPatterns = [
        /\/,
        /\brm\s+.*\*/,
        /\bsudo\b/,
        /\bchmod\s+777\b/,
        /\bchown\b/,
        /\bmkfs\b/,
        /\bdd\b/,
        /\bformat\b/,
        /\bfdisk\b/,
        /\bparted\b/,
        /\b>\s*\/dev\//,
        /\bcurl\b.*\|\s*(ba)?sh/,
        /\bwget\b.*\|\s*(ba)?sh/,
        /\beval\b/,
        /\bexec\b/,
        /\bkill\s+-9\b/,
        /\bkillall\b/,
        /\bshutdown\b/,
        /\breboot\b/,
        /\binit\s+0\b/,
    ];

    return riskyPatterns.some(p => p.test(cmd));
}

/**
 * Extract tool name from Warp tool call
 * @param {Object} toolCall - Warp ToolCall object
 * @returns {string} Tool name
 */
export function getToolNameFromWarpToolCall(toolCall) {
    if (toolCall.run_shell_command) return 'Bash';
    if (toolCall.read_files) return 'Read';
    if (toolCall.apply_file_diffs) {
        // Determine Write or Edit based on content
        if (toolCall.apply_file_diffs.new_files?.length > 0) return 'Write';
        if (toolCall.apply_file_diffs.diffs?.length > 0) return 'Edit';
        return 'Write';
    }
    if (toolCall.grep) return 'Grep';
    if (toolCall.file_glob_v2 || toolCall.file_glob) return 'Glob';
    if (toolCall.call_mcp_tool) return toolCall.call_mcp_tool.name || 'mcp__unknown';
    if (toolCall.search_codebase) return 'Grep';
    if (toolCall.suggest_plan) return 'Plan';
    if (toolCall.suggest_create_plan) return 'Plan';

    return 'unknown';
}
