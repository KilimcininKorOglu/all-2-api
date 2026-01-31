/**
 * Warp Message Converter
 * Handles bidirectional conversion between Claude API messages and Warp protocol messages
 */

import crypto from 'crypto';
import { createInputContext, createTaskStatus, TOOL_TYPES } from './warp-proto.js';
import {
    claudeToolUseToWarpToolCall,
    claudeToolResultToWarpResult,
    warpToolCallToClaudeToolUse,
    getWarpSupportedTools,
    getToolNameFromWarpToolCall
} from './warp-tool-mapper.js';

/**
 * Convert Claude API request to Warp Request object
 * @param {Object} claudeRequest - Claude API request
 * @param {Object} context - Context information
 * @returns {Object} Warp Request object
 */
export function buildWarpRequest(claudeRequest, context = {}) {
    const { model, messages, system, tools, metadata } = claudeRequest;
    const {
        workingDir = '/tmp',
        homeDir = process.env.HOME || '/root',
        conversationId = null
    } = context;

    const taskId = crypto.randomUUID();
    const convId = conversationId || metadata?.session_id || crypto.randomUUID();

    // Build InputContext
    const inputContext = createInputContext({
        pwd: workingDir,
        home: homeDir
    });

    // Add system as project_rules
    if (system) {
        const systemText = typeof system === 'string'
            ? system
            : (Array.isArray(system) ? system.map(s => s.text || s).join('\n') : '');

        if (systemText) {
            inputContext.project_rules = [{
                root_path: workingDir,
                active_rule_files: [{
                    file_path: '.claude/rules.md',
                    content: systemText
                }],
                additional_rule_file_paths: []
            }];
        }
    }

    // Convert messages
    const { taskMessages, userInputs } = convertClaudeMessages(messages, inputContext);

    // Build Settings
    const supportedTools = getWarpSupportedTools(tools);

    // Build request object
    const request = {
        task_context: {
            tasks: [{
                id: taskId,
                description: '',
                status: createTaskStatus('in_progress'),
                messages: taskMessages,
                summary: ''
            }],
            active_task_id: taskId
        },
        input: {
            context: inputContext,
            user_inputs: { inputs: userInputs }
        },
        settings: {
            model_config: {
                base: model || 'auto',
                planning: '',
                coding: ''
            },
            rules_enabled: true,
            web_context_retrieval_enabled: false,
            supports_parallel_tool_calls: true,
            use_anthropic_text_editor_tools: false,
            planning_enabled: false,
            warp_drive_context_enabled: false,
            supports_create_files: true,
            supported_tools: supportedTools,
            supports_long_running_commands: true,
            should_preserve_file_content_in_history: false,
            supports_todos_ui: true,
            supports_linked_code_blocks: true
        },
        metadata: {
            conversation_id: convId,
            logging: {}
        }
    };

    return request;
}

/**
 * Convert Claude message array to Warp format
 * @param {Array} messages - Claude message array
 * @param {Object} inputContext - Input context
 * @returns {Object} { taskMessages, userInputs }
 */
function convertClaudeMessages(messages, inputContext) {
    const taskMessages = [];
    const userInputs = [];

    // Used to track tool calls so we can look up the corresponding tool name in tool_result
    const toolCallMap = new Map();

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const isLastMessage = i === messages.length - 1;

        if (msg.role === 'user') {
            const converted = convertUserMessage(msg, inputContext, isLastMessage, toolCallMap);

            if (converted.userInputs) {
                userInputs.push(...converted.userInputs);
            }
            if (converted.taskMessages) {
                taskMessages.push(...converted.taskMessages);
            }
        } else if (msg.role === 'assistant') {
            const converted = convertAssistantMessage(msg, toolCallMap);
            taskMessages.push(...converted);
        }
    }

    return { taskMessages, userInputs };
}

/**
 * Convert user message
 * @param {Object} msg - Claude user message
 * @param {Object} inputContext - Input context
 * @param {boolean} isLastMessage - Whether this is the last message
 * @param {Map} toolCallMap - Tool call mapping
 * @returns {Object} { taskMessages, userInputs }
 */
function convertUserMessage(msg, inputContext, isLastMessage, toolCallMap) {
    const result = { taskMessages: [], userInputs: [] };

    if (typeof msg.content === 'string') {
        // Simple text message
        const userQuery = {
            user_query: {
                query: msg.content,
                context: inputContext,
                referenced_attachments: {}
            }
        };

        if (isLastMessage) {
            result.userInputs.push(userQuery);
        } else {
            result.taskMessages.push({
                id: crypto.randomUUID(),
                user_query: userQuery.user_query
            });
        }
    } else if (Array.isArray(msg.content)) {
        // Compound content (may contain text and tool_result)
        let textContent = '';
        const toolResults = [];

        for (const block of msg.content) {
            if (block.type === 'text') {
                textContent += block.text;
            } else if (block.type === 'tool_result') {
                // Find corresponding tool name
                const toolName = toolCallMap.get(block.tool_use_id) || 'Bash';
                const warpResult = claudeToolResultToWarpResult(block, toolName);
                toolResults.push({
                    tool_call_result: warpResult
                });
            }
        }

        // Add text content
        if (textContent) {
            const userQuery = {
                user_query: {
                    query: textContent,
                    context: inputContext,
                    referenced_attachments: {}
                }
            };

            if (isLastMessage && toolResults.length === 0) {
                result.userInputs.push(userQuery);
            } else {
                result.taskMessages.push({
                    id: crypto.randomUUID(),
                    user_query: userQuery.user_query
                });
            }
        }

        // Add tool results
        if (toolResults.length > 0) {
            if (isLastMessage) {
                result.userInputs.push(...toolResults);
            } else {
                for (const tr of toolResults) {
                    result.taskMessages.push({
                        id: crypto.randomUUID(),
                        tool_call_result: tr.tool_call_result
                    });
                }
            }
        }
    }

    return result;
}

/**
 * Convert assistant message
 * @param {Object} msg - Claude assistant message
 * @param {Map} toolCallMap - Tool call mapping (used to record tool calls)
 * @returns {Array} Warp Message array
 */
function convertAssistantMessage(msg, toolCallMap) {
    const messages = [];

    if (typeof msg.content === 'string') {
        messages.push({
            id: crypto.randomUUID(),
            agent_output: {
                text: msg.content,
                reasoning: ''
            }
        });
    } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
            if (block.type === 'text') {
                messages.push({
                    id: crypto.randomUUID(),
                    agent_output: {
                        text: block.text,
                        reasoning: ''
                    }
                });
            } else if (block.type === 'tool_use') {
                // Record tool call for later lookup
                toolCallMap.set(block.id, block.name);

                const warpToolCall = claudeToolUseToWarpToolCall(block);
                messages.push({
                    id: crypto.randomUUID(),
                    tool_call: warpToolCall
                });
            }
        }
    }

    return messages;
}

/**
 * Parse Warp ResponseEvent and convert to Claude API format events
 * @param {Object} responseEvent - Warp ResponseEvent object
 * @returns {Array} Claude format event array
 */
export function parseWarpResponseEvent(responseEvent) {
    const events = [];

    // StreamInit event
    if (responseEvent.init) {
        events.push({
            type: 'stream_init',
            conversationId: responseEvent.init.conversation_id,
            requestId: responseEvent.init.request_id
        });
    }

    // ClientActions event
    if (responseEvent.client_actions) {
        const actions = responseEvent.client_actions.actions || [];

        for (const action of actions) {
            // AppendToMessageContent - streaming text delta
            if (action.append_to_message_content) {
                const msg = action.append_to_message_content.message;
                if (msg?.agent_output?.text) {
                    events.push({
                        type: 'text_delta',
                        text: msg.agent_output.text
                    });
                }
                if (msg?.agent_output?.reasoning) {
                    events.push({
                        type: 'reasoning_delta',
                        text: msg.agent_output.reasoning
                    });
                }
            }

            // AddMessagesToTask - complete message
            if (action.add_messages_to_task) {
                const taskMessages = action.add_messages_to_task.messages || [];

                for (const msg of taskMessages) {
                    if (msg.agent_output) {
                        events.push({
                            type: 'agent_output',
                            text: msg.agent_output.text || '',
                            reasoning: msg.agent_output.reasoning || ''
                        });
                    }
                    if (msg.tool_call) {
                        const claudeToolUse = warpToolCallToClaudeToolUse(msg.tool_call);
                        if (claudeToolUse) {
                            events.push({
                                type: 'tool_use',
                                toolUse: claudeToolUse
                            });
                        }
                    }
                }
            }

            // UpdateTaskMessage - message update
            if (action.update_task_message) {
                const msg = action.update_task_message.message;
                if (msg?.agent_output?.text) {
                    events.push({
                        type: 'text_delta',
                        text: msg.agent_output.text
                    });
                }
            }

            // CreateTask - new task creation
            if (action.create_task) {
                events.push({
                    type: 'task_created',
                    taskId: action.create_task.task?.id,
                    description: action.create_task.task?.description
                });
            }

            // UpdateTaskStatus - task status update
            if (action.update_task_status) {
                events.push({
                    type: 'task_status',
                    taskId: action.update_task_status.task_id,
                    status: action.update_task_status.task_status
                });
            }
        }
    }

    // StreamFinished event
    if (responseEvent.finished) {
        const finished = responseEvent.finished;

        // Determine stop reason
        let stopReason = 'end_turn';
        if (finished.done) {
            stopReason = 'end_turn';
        } else if (finished.quota_limit) {
            stopReason = 'quota_limit';
        } else if (finished.max_token_limit) {
            stopReason = 'max_tokens';
        } else if (finished.context_window_exceeded) {
          stopReason = 'context_window_exceeded';
        } else if (finished.llm_unavailable) {
            stopReason = 'llm_unavailable';
        } else if (finished.internal_error) {
            stopReason = 'internal_error';
        }

        // Extract token usage
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;

        if (finished.token_usage && finished.token_usage.length > 0) {
            for (const usage of finished.token_usage) {
                inputTokens += usage.total_input || 0;
                outputTokens += usage.output || 0;
                cacheReadTokens += usage.input_cache_read || 0;
                cacheWriteTokens += usage.input_cache_write || 0;
            }
        }

        events.push({
            type: 'stream_finished',
            reason: stopReason,
            usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_read_input_tokens: cacheReadTokens,
                cache_creation_input_tokens: cacheWriteTokens
            },
            errorMessage: finished.internal_error?.message || null
        });
    }

    return events;
}

/**
 * Convert Warp response event stream to Claude API SSE format
 * @param {Array} events - Event array returned by parseWarpResponseEvent
 * @param {Object} state - State object { messageId, model, blockIndex, contentBlocks }
 * @returns {Array} SSE data array
 */
export function convertToClaudeSSE(events, state) {
    const sseData = [];

    for (const event of events) {
        switch (event.type) {
            case 'text_delta':
                // Ensure there is a text block
                if (state.blockIndex === 0 && !state.textBlockStarted) {
                    sseData.push({
                        event: 'content_block_start',
                        data: {
                            type: 'content_block_start',
                            index: state.blockIndex,
                            content_block: { type: 'text', text: '' }
                        }
                    });
                    state.textBlockStarted = true;
                }

                sseData.push({
                    event: 'content_block_delta',
                    data: {
                        type: 'content_block_delta',
                        index: state.blockIndex,
                        delta: { type: 'text_delta', text: event.text }
                    }
                });
                state.fullText = (state.fullText || '') + event.text;
                break;

            case 'tool_use':
                // End the previous text block
                if (state.textBlockStarted) {
                    sseData.push({
                        event: 'content_block_stop',
                        data: { type: 'content_block_stop', index: state.blockIndex }
                    });
                    state.blockIndex++;
                    state.textBlockStarted = false;
                }

                // Start tool use block
                sseData.push({
                    event: 'content_block_start',
                    data: {
                        type: 'content_block_start',
                        index: state.blockIndex,
                        content_block: {
                            type: 'tool_use',
                            id: event.toolUse.id,
                            name: event.toolUse.name,
                            input: {}
                        }
                    }
                });

                // Send tool input
                sseData.push({
                    event: 'content_block_delta',
                    data: {
                        type: 'content_block_delta',
                        index: state.blockIndex,
                        delta: {
                            type: 'input_json_delta',
                            partial_json: JSON.stringify(event.toolUse.input)
                        }
                    }
                });

                // End tool use block
                sseData.push({
                    event: 'content_block_stop',
                    data: { type: 'content_block_stop', index: state.blockIndex }
                });

                state.toolCalls = state.toolCalls || [];
                state.toolCalls.push(event.toolUse);
                state.blockIndex++;
                break;

            case 'stream_finished':
                // End any open blocks
                if (state.textBlockStarted) {
                    sseData.push({
                        event: 'content_block_stop',
                        data: { type: 'content_block_stop', index: state.blockIndex }
                    });
                }

                // Determine stop reason
                const stopReason = (state.toolCalls && state.toolCalls.length > 0)
                    ? 'tool_use'
                    : (event.reason === 'end_turn' ? 'end_turn' : event.reason);

                sseData.push({
                    event: 'message_delta',
                    data: {
                        type: 'message_delta',
                        delta: { stop_reason: stopReason, stop_sequence: null },
                        usage: { output_tokens: event.usage.output_tokens }
                    }
                });

                sseData.push({
                    event: 'message_stop',
                    data: { type: 'message_stop' }
                });

                state.finished = true;
                state.usage = event.usage;
                state.stopReason = stopReason;
                break;
        }
    }

    return sseData;
}

/**
 * Build Claude API non-streaming response
 * @param {Object} state - State object
 * @param {string} model - Model name
 * @returns {Object} Claude API response object
 */
export function buildClaudeResponse(state, model) {
    const content = [];

    // Add text content
    if (state.fullText) {
        content.push({
            type: 'text',
            text: state.fullText
        });
    }

    // Add tool calls
    if (state.toolCalls && state.toolCalls.length > 0) {
        for (const toolUse of state.toolCalls) {
            content.push(toolUse);
        }
    }

    // If no content, add default text
    if (content.length === 0) {
        content.push({
            type: 'text',
            text: ''
        });
    }

    return {
        id: state.messageId || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content,
        model,
        stop_reason: state.stopReason || 'end_turn',
        stop_sequence: null,
        usage: state.usage || {
            input_tokens: 0,
            output_tokens: 0
        }
    };
}

/**
 * Create initial SSE state
 * @param {string} messageId - Message ID
 * @param {string} model - Model name
 * @param {number} inputTokens - Input token count
 * @returns {Object} State object
 */
export function createSSEState(messageId, model, inputTokens = 0) {
    return {
        messageId,
        model,
        inputTokens,
        blockIndex: 0,
        textBlockStarted: false,
        fullText: '',
        toolCalls: [],
        finished: false,
        usage: null,
        stopReason: null
    };
}

/**
 * Generate message_start SSE event
 * @param {Object} state - SSE state
 * @returns {Object} SSE data
 */
export function createMessageStartSSE(state) {
    return {
        event: 'message_start',
        data: {
            type: 'message_start',
            message: {
                id: state.messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model: state.model,
                stop_reason: null,
                stop_sequence: null,
                usage: {
                    input_tokens: state.inputTokens,
                    output_tokens: 0
                }
            }
        }
    };
}
