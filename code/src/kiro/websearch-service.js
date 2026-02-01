/**
 * WebSearch Service for Kiro Provider
 * Handles Anthropic web_search tool via Kiro MCP API
 * 
 * Based on KiroGate implementation
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { KIRO_CONSTANTS, buildCodeWhispererUrl } from '../constants.js';

/**
 * Check if request contains only web_search tool
 * @param {Array} tools - Tools array from request
 * @returns {boolean}
 */
export function hasWebSearchTool(tools) {
    if (!tools || !Array.isArray(tools) || tools.length !== 1) {
        return false;
    }

    const tool = tools[0];
    const toolName = tool.name || '';
    const toolType = tool.type || '';

    return (
        toolName === 'web_search' ||
        toolType.startsWith('web_search') ||
        toolType.includes('web_search')
    );
}

/**
 * Extract search query from messages
 * @param {Array} messages - Messages array
 * @returns {string|null}
 */
export function extractSearchQuery(messages) {
    if (!messages || messages.length === 0) {
        return null;
    }

    const firstMsg = messages[0];
    let content = firstMsg.content;

    // Extract text from content
    if (typeof content === 'string') {
        // Direct string
    } else if (Array.isArray(content)) {
        // Array of content blocks
        const textBlock = content.find(block => block.type === 'text');
        content = textBlock?.text || '';
    } else {
        return null;
    }

    // Remove prefix "Perform a web search for the query: "
    const prefix = 'Perform a web search for the query: ';
    if (content.startsWith(prefix)) {
        content = content.slice(prefix.length);
    }

    return content.trim() || null;
}

/**
 * Generate random ID
 * @param {number} length - ID length
 * @param {string} charset - Character set
 * @returns {string}
 */
function generateRandomId(length, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}

/**
 * Create MCP request for web search
 * @param {string} query - Search query
 * @returns {{ toolUseId: string, mcpRequest: object }}
 */
export function createMcpRequest(query) {
    const random22 = generateRandomId(22);
    const timestamp = Date.now();
    const random8 = generateRandomId(8, 'abcdefghijklmnopqrstuvwxyz0123456789');

    const requestId = `web_search_tooluse_${random22}_${timestamp}_${random8}`;
    const toolUseId = `srvtoolu_${uuidv4().replace(/-/g, '').slice(0, 32)}`;

    const mcpRequest = {
        id: requestId,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
            name: 'web_search',
            arguments: { query }
        }
    };

    return { toolUseId, mcpRequest };
}

/**
 * Call Kiro MCP API
 * @param {string} accessToken - Access token
 * @param {string} region - AWS region
 * @param {object} mcpRequest - MCP request object
 * @returns {Promise<object|null>}
 */
export async function callMcpApi(accessToken, region, mcpRequest) {
    const mcpUrl = KIRO_CONSTANTS.MCP_URL.replace('{{region}}', region);

    try {
        const response = await axios.post(mcpUrl, mcpRequest, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': `KiroIDE/${KIRO_CONSTANTS.KIRO_VERSION}`
            },
            timeout: 60000
        });

        if (response.data?.error) {
            console.error('[WebSearch] MCP API error:', response.data.error);
            return null;
        }

        return response.data;
    } catch (error) {
        console.error('[WebSearch] MCP API call failed:', error.message);
        return null;
    }
}

/**
 * Parse search results from MCP response
 * @param {object} mcpResponse - MCP response
 * @returns {object|null}
 */
export function parseSearchResults(mcpResponse) {
    if (!mcpResponse || mcpResponse.error) {
        return null;
    }

    const result = mcpResponse.result;
    if (!result) return null;

    const contentList = result.content || [];
    if (contentList.length === 0) return null;

    const firstContent = contentList[0];
    if (firstContent.type !== 'text') return null;

    try {
        return JSON.parse(firstContent.text || '{}');
    } catch {
        return null;
    }
}

/**
 * Generate search summary text
 * @param {string} query - Search query
 * @param {object|null} results - Search results
 * @returns {string}
 */
export function generateSearchSummary(query, results) {
    let summary = `Here are the search results for "${query}":\n\n`;

    if (results && results.results && results.results.length > 0) {
        results.results.forEach((result, i) => {
            const title = result.title || 'Untitled';
            const url = result.url || '';
            let snippet = result.snippet || '';

            // Truncate long snippets
            if (snippet.length > 200) {
                snippet = snippet.slice(0, 200) + '...';
            }

            summary += `${i + 1}. **${title}**\n`;
            if (snippet) {
                summary += `   ${snippet}\n`;
            }
            summary += `   Source: ${url}\n\n`;
        });
    } else {
        summary += 'No results found.\n';
    }

    summary += '\nPlease note that these are web search results and may not be fully accurate or up-to-date.';

    return summary;
}

/**
 * Generate SSE events for web search response
 * @param {string} model - Model name
 * @param {string} query - Search query
 * @param {string} toolUseId - Tool use ID
 * @param {object|null} searchResults - Search results
 * @param {number} inputTokens - Input token count
 * @returns {AsyncGenerator<string>}
 */
export async function* generateWebSearchSSE(model, query, toolUseId, searchResults, inputTokens) {
    const messageId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    // 1. message_start
    yield formatSSE('message_start', {
        type: 'message_start',
        message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model: model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: inputTokens,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
            }
        }
    });

    // 2. content_block_start (server_tool_use)
    yield formatSSE('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: {
            id: toolUseId,
            type: 'server_tool_use',
            name: 'web_search',
            input: {}
        }
    });

    // 3. content_block_delta (input_json_delta)
    yield formatSSE('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify({ query })
        }
    });

    // 4. content_block_stop (server_tool_use)
    yield formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: 0
    });

    // 5. content_block_start (web_search_tool_result)
    const searchContent = [];
    if (searchResults && searchResults.results) {
        for (const r of searchResults.results) {
            searchContent.push({
                type: 'web_search_result',
                title: r.title || '',
                url: r.url || '',
                encrypted_content: r.snippet || '',
                page_age: null
            });
        }
    }

    yield formatSSE('content_block_start', {
        type: 'content_block_start',
        index: 1,
        content_block: {
            type: 'web_search_tool_result',
            tool_use_id: toolUseId,
            content: searchContent
        }
    });

    // 6. content_block_stop (web_search_tool_result)
    yield formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: 1
    });

    // 7. content_block_start (text)
    yield formatSSE('content_block_start', {
        type: 'content_block_start',
        index: 2,
        content_block: {
            type: 'text',
            text: ''
        }
    });

    // 8. content_block_delta (text_delta) - Send summary in chunks
    const summary = generateSearchSummary(query, searchResults);
    const chunkSize = 100;

    for (let i = 0; i < summary.length; i += chunkSize) {
        const chunk = summary.slice(i, i + chunkSize);
        yield formatSSE('content_block_delta', {
            type: 'content_block_delta',
            index: 2,
            delta: {
                type: 'text_delta',
                text: chunk
            }
        });
    }

    // 9. content_block_stop (text)
    yield formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: 2
    });

    // 10. message_delta
    const outputTokens = Math.ceil((summary.length + 3) / 4);
    yield formatSSE('message_delta', {
        type: 'message_delta',
        delta: {
            stop_reason: 'end_turn',
            stop_sequence: null
        },
        usage: {
            output_tokens: outputTokens
        }
    });

    // 11. message_stop
    yield formatSSE('message_stop', {
        type: 'message_stop'
    });
}

/**
 * Format SSE event
 * @param {string} eventType - Event type
 * @param {object} data - Event data
 * @returns {string}
 */
function formatSSE(eventType, data) {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Generate non-streaming response for web search
 * @param {string} model - Model name
 * @param {string} query - Search query
 * @param {string} toolUseId - Tool use ID
 * @param {object|null} searchResults - Search results
 * @param {number} inputTokens - Input token count
 * @returns {object}
 */
export function generateWebSearchResponse(model, query, toolUseId, searchResults, inputTokens) {
    const messageId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const summary = generateSearchSummary(query, searchResults);
    const outputTokens = Math.ceil((summary.length + 3) / 4);

    const searchContent = [];
    if (searchResults && searchResults.results) {
        for (const r of searchResults.results) {
            searchContent.push({
                type: 'web_search_result',
                title: r.title || '',
                url: r.url || '',
                encrypted_content: r.snippet || '',
                page_age: null
            });
        }
    }

    return {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: model,
        content: [
            {
                id: toolUseId,
                type: 'server_tool_use',
                name: 'web_search',
                input: { query }
            },
            {
                type: 'web_search_tool_result',
                tool_use_id: toolUseId,
                content: searchContent
            },
            {
                type: 'text',
                text: summary
            }
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
        }
    };
}

/**
 * Handle web search request (main entry point)
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {object} credential - Kiro credential
 * @returns {Promise<void>}
 */
export async function handleWebSearchRequest(req, res, credential) {
    const { model, messages, stream } = req.body;
    const startTime = Date.now();

    // Extract search query
    const query = extractSearchQuery(messages);
    if (!query) {
        return res.status(400).json({
            type: 'error',
            error: {
                type: 'invalid_request_error',
                message: 'Could not extract search query from messages'
            }
        });
    }

    console.log(`[WebSearch] Processing request: query="${query}"`);

    // Create MCP request
    const { toolUseId, mcpRequest } = createMcpRequest(query);

    // Call MCP API
    const region = credential.region || KIRO_CONSTANTS.DEFAULT_REGION;
    const mcpResponse = await callMcpApi(credential.accessToken, region, mcpRequest);
    const searchResults = parseSearchResults(mcpResponse);

    // Estimate input tokens
    const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

    const durationMs = Date.now() - startTime;
    console.log(`[WebSearch] Completed in ${durationMs}ms, results: ${searchResults?.results?.length || 0}`);

    if (stream) {
        // Streaming response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        for await (const event of generateWebSearchSSE(model, query, toolUseId, searchResults, inputTokens)) {
            res.write(event);
        }
        res.end();
    } else {
        // Non-streaming response
        const response = generateWebSearchResponse(model, query, toolUseId, searchResults, inputTokens);
        res.json(response);
    }
}
