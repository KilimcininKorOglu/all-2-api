/**
 * Multi-Agent Loop System
 *
 * Implementation principle:
 * 1. User question -> Send to AI
 * 2. AI returns response (may contain tool calls)
 * 3. If there are tool calls -> Execute tools -> Return results to AI
 * 4. Loop until AI returns final answer (no tool calls)
 *
 * Reference: Warp's /ai/multi-agent interface implementation
 */

import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// ==================== Tool Definitions ====================

/**
 * Available tools list
 */
const AVAILABLE_TOOLS = {
    // File system tools
    list_dir: {
        name: 'list_dir',
        description: 'List directory contents',
        parameters: {
            path: { type: 'string', description: 'Directory path', required: true }
        },
        handler: async (params) => {
            const files = await fs.readdir(params.path, { withFileTypes: true });
            return files.map(f => ({
                name: f.name,
                type: f.isDirectory() ? 'directory' : 'file'
            }));
        }
    },

    read_file: {
        name: 'read_file',
        description: 'Read file contents',
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            limit: { type: 'number', description: 'Maximum lines', required: false }
        },
        handler: async (params) => {
            const content = await fs.readFile(params.path, 'utf-8');
            if (params.limit) {
                return content.split('\n').slice(0, params.limit).join('\n');
            }
            return content;
        }
    },

    write_file: {
        name: 'write_file',
        description: 'Write to file',
        parameters: {
            path: { type: 'string', description: 'File path', required: true },
            content: { type: 'string', description: 'File content', required: true }
        },
        handler: async (params) => {
            await fs.writeFile(params.path, params.content, 'utf-8');
            return { success: true, message: `File written: ${params.path}` };
        }
    },

    // Shell command tools
    run_command: {
        name: 'run_command',
        description: 'Execute shell command',
        parameters: {
            command: { type: 'string', description: 'Command to execute', required: true },
            cwd: { type: 'string', description: 'Working directory', required: false }
        },
        handler: async (params) => {
            try {
                const { stdout, stderr } = await execAsync(params.command, {
                    cwd: params.cwd || process.cwd(),
                    timeout: 30000,
                    maxBuffer: 1024 * 1024
                });
                return { stdout, stderr, exitCode: 0 };
            } catch (error) {
                return {
                    stdout: error.stdout || '',
                    stderr: error.stderr || error.message,
                    exitCode: error.code || 1
                };
            }
        }
    },

    // Search tools
    grep_search: {
        name: 'grep_search',
        description: 'Search content in files',
        parameters: {
            pattern: { type: 'string', description: 'Search pattern', required: true },
            path: { type: 'string', description: 'Search path', required: true }
        },
        handler: async (params) => {
            try {
                const { stdout } = await execAsync(
                    `grep -rn "${params.pattern}" "${params.path}" 2>/dev/null | head -50`,
                    { maxBuffer: 1024 * 1024 }
                );
                return stdout || 'No matches found';
            } catch (error) {
                return 'No matches found';
            }
        }
    }
};

// ==================== Session Management ====================

/**
 * Session storage
 */
class SessionStore {
    constructor() {
        this.sessions = new Map();
    }

    create(userId) {
        const sessionId = uuidv4();
        const session = {
            id: sessionId,
            userId,
            messages: [],      // Conversation history
            toolCalls: [],     // Tool call history
            context: {},       // Context information
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    
    addMessage(sessionId, role, content, toolCallId = null) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        
        const message = {
            id: uuidv4(),
            role,
            content,
            toolCallId,
            timestamp: new Date()
        };
        session.messages.push(message);
        session.updatedAt = new Date();
        return message;
    }
    
    addToolCall(sessionId, toolCall) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        
        session.toolCalls.push({
            ...toolCall,
            timestamp: new Date()
        });
        session.updatedAt = new Date();
        return toolCall;
    }
    
    getHistory(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? session.messages : [];
    }
    
    delete(sessionId) {
        return this.sessions.delete(sessionId);
    }
}

// ==================== Multi-Agent Loop Core ====================

/**
 * Multi-Agent Service
 */
export class MultiAgentService {
    constructor(options = {}) {
        this.sessionStore = new SessionStore();
        this.tools = { ...AVAILABLE_TOOLS, ...options.customTools };
        this.maxIterations = options.maxIterations || 10;  // Maximum loop iterations
        this.aiClient = options.aiClient;  // AI client (e.g., OpenAI, Claude, etc.)
        this.onToolCall = options.onToolCall;  // Tool call callback
        this.onIteration = options.onIteration;  // Each iteration callback
    }

    /**
     * Register custom tool
     */
    registerTool(name, tool) {
        this.tools[name] = tool;
    }

    /**
     * Build tool definitions (for sending to AI)
     */
    buildToolDefinitions() {
        return Object.values(this.tools).map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties: Object.fromEntries(
                        Object.entries(tool.parameters).map(([key, param]) => [
                            key,
                            { type: param.type, description: param.description }
                        ])
                    ),
                    required: Object.entries(tool.parameters)
                        .filter(([_, param]) => param.required)
                        .map(([key]) => key)
                }
            }
        }));
    }

    /**
     * Execute tool call
     */
    async executeTool(toolName, params) {
        const tool = this.tools[toolName];
        if (!tool) {
            throw new Error(`Unknown tool: ${toolName}`);
        }

        try {
            const result = await tool.handler(params);
            return {
                success: true,
                result: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Core: Multi-agent loop processing
     *
     * @param {string} userQuery - User question
     * @param {object} options - Options
     * @returns {AsyncGenerator} - Stream return results
     */
    async *processQuery(userQuery, options = {}) {
        const sessionId = options.sessionId || this.sessionStore.create(options.userId || 'anonymous').id;
        const session = this.sessionStore.get(sessionId);

        // Add user message
        this.sessionStore.addMessage(sessionId, 'user', userQuery);

        let iteration = 0;
        let isComplete = false;

        while (!isComplete && iteration < this.maxIterations) {
            iteration++;

            // Send iteration start event
            yield {
                type: 'iteration_start',
                iteration,
                sessionId
            };

            // Build request messages
            const messages = this.buildMessages(session);

            // Call AI
            const aiResponse = await this.callAI(messages, options);

            // Send AI response event
            yield {
                type: 'ai_response',
                iteration,
                content: aiResponse.content,
                toolCalls: aiResponse.toolCalls
            };

            // Check if there are tool calls
            if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
                // Add AI message (with tool calls)
                this.sessionStore.addMessage(sessionId, 'assistant', aiResponse.content || '', null);

                // Execute all tool calls
                for (const toolCall of aiResponse.toolCalls) {
                    const toolCallId = toolCall.id || uuidv4();

                    // Send tool call start event
                    yield {
                        type: 'tool_call_start',
                        iteration,
                        toolCallId,
                        toolName: toolCall.function.name,
                        arguments: toolCall.function.arguments
                    };

                    // Callback notification
                    if (this.onToolCall) {
                        await this.onToolCall(toolCall);
                    }

                    // Parse parameters and execute tool
                    let params;
                    try {
                        params = typeof toolCall.function.arguments === 'string'
                            ? JSON.parse(toolCall.function.arguments)
                            : toolCall.function.arguments;
                    } catch (e) {
                        params = {};
                    }

                    const toolResult = await this.executeTool(toolCall.function.name, params);

                    // Record tool call
                    this.sessionStore.addToolCall(sessionId, {
                        id: toolCallId,
                        name: toolCall.function.name,
                        params,
                        result: toolResult
                    });

                    // Add tool result message
                    this.sessionStore.addMessage(
                        sessionId,
                        'tool',
                        toolResult.success ? toolResult.result : `Error: ${toolResult.error}`,
                        toolCallId
                    );

                    // Send tool call end event
                    yield {
                        type: 'tool_call_end',
                        iteration,
                        toolCallId,
                        toolName: toolCall.function.name,
                        result: toolResult
                    };
                }

                // Continue loop, send tool results to AI
            } else {
                // No tool calls, AI returns final answer
                this.sessionStore.addMessage(sessionId, 'assistant', aiResponse.content);
                isComplete = true;

                // Send complete event
                yield {
                    type: 'complete',
                    iteration,
                    sessionId,
                    finalResponse: aiResponse.content
                };
            }

            // Iteration callback
            if (this.onIteration) {
                await this.onIteration(iteration, isComplete);
            }
        }

        // Exceeded maximum iterations
        if (!isComplete) {
            yield {
                type: 'max_iterations_reached',
                iteration,
                sessionId
            };
        }
    }
    
    /**
     * Build message list to send to AI
     */
    buildMessages(session) {
        const messages = [];

        // System prompt
        messages.push({
            role: 'system',
            content: this.buildSystemPrompt()
        });

        // History messages
        for (const msg of session.messages) {
            if (msg.role === 'user') {
                messages.push({ role: 'user', content: msg.content });
            } else if (msg.role === 'assistant') {
                messages.push({ role: 'assistant', content: msg.content });
            } else if (msg.role === 'tool') {
                messages.push({
                    role: 'tool',
                    tool_call_id: msg.toolCallId,
                    content: msg.content
                });
            }
        }

        return messages;
    }

    /**
     * Build system prompt
     */
    buildSystemPrompt() {
        const toolDescriptions = Object.values(this.tools)
            .map(t => `- ${t.name}: ${t.description}`)
            .join('\n');

        return `You are an intelligent assistant that can use the following tools to help users complete tasks:

${toolDescriptions}

When using tools:
1. Analyze user requirements and decide which tools to use
2. Call tools to obtain information or perform operations
3. Based on tool results, continue analysis or provide final answer
4. If a tool call fails, try other methods or explain to user

Please reply to the user.`;
    }

    /**
     * Call AI (needs implementation based on actual AI service)
     */
    async callAI(messages, options = {}) {
        if (this.aiClient) {
            // Use injected AI client
            return await this.aiClient.chat(messages, {
                tools: this.buildToolDefinitions(),
                ...options
            });
        }

        // Default implementation: use OpenAI compatible interface
        const response = await fetch(options.apiUrl || 'http://localhost:3456/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.apiKey || 'sk-test'}`
            },
            body: JSON.stringify({
                model: options.model || 'gpt-4',
                messages,
                tools: this.buildToolDefinitions(),
                tool_choice: 'auto'
            })
        });

        const data = await response.json();
        const choice = data.choices?.[0];

        return {
            content: choice?.message?.content || '',
            toolCalls: choice?.message?.tool_calls || []
        };
    }

    /**
     * Simplified synchronous processing method (wait for completion and return final result)
     */
    async chat(userQuery, options = {}) {
        let finalResponse = '';
        let allToolCalls = [];

        for await (const event of this.processQuery(userQuery, options)) {
            if (event.type === 'complete') {
                finalResponse = event.finalResponse;
            } else if (event.type === 'tool_call_end') {
                allToolCalls.push({
                    name: event.toolName,
                    result: event.result
                });
            }
        }

        return {
            response: finalResponse,
            toolCalls: allToolCalls
        };
    }
}

// ==================== Streaming Response Wrapper ====================

/**
 * Convert multi-agent loop to SSE stream
 */
export function createSSEStream(multiAgentService, userQuery, options = {}) {
    return new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            
            try {
                for await (const event of multiAgentService.processQuery(userQuery, options)) {
                    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                }
                controller.close();
            } catch (error) {
                const errorData = `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`;
                controller.enqueue(encoder.encode(errorData));
                controller.close();
            }
        }
    });
}

// ==================== Express Route Integration ====================

/**
 * Setup multi-agent routes
 */
export function setupMultiAgentRoutes(app, multiAgentService) {
    // Create session
    app.post('/api/agent/sessions', (req, res) => {
        const session = multiAgentService.sessionStore.create(req.body.userId);
        res.json({ success: true, sessionId: session.id });
    });

    // Send message (streaming)
    app.post('/api/agent/chat/stream', async (req, res) => {
        const { query, sessionId, model } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
            for await (const event of multiAgentService.processQuery(query, { sessionId, model })) {
                res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
            res.end();
        } catch (error) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    });

    // Send message (non-streaming)
    app.post('/api/agent/chat', async (req, res) => {
        const { query, sessionId, model } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }

        try {
            const result = await multiAgentService.chat(query, { sessionId, model });
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get session history
    app.get('/api/agent/sessions/:sessionId/history', (req, res) => {
        const history = multiAgentService.sessionStore.getHistory(req.params.sessionId);
        res.json({ success: true, history });
    });
}

// ==================== Usage Examples ====================

/*
// Basic usage
import { MultiAgentService } from './multi-agent-service.js';

const agent = new MultiAgentService({
    maxIterations: 10,
    // Optional: custom AI client
    aiClient: {
        async chat(messages, options) {
            // Call your AI service
            return { content: '...', toolCalls: [] };
        }
    }
});

// Synchronous call
const result = await agent.chat('Show me what files are in the current directory');
console.log(result.response);

// Streaming call
for await (const event of agent.processQuery('Analyze the structure of this project')) {
    console.log(event.type, event);
}

// Express integration
import express from 'express';
const app = express();
setupMultiAgentRoutes(app, agent);
*/

export default MultiAgentService;
