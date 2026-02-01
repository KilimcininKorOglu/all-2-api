/**
 * Public API Swagger Configuration
 * Claude/OpenAI compatible endpoints
 */
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Kiro API - Public Endpoints',
            version: '1.0.0',
            description: `
## Overview
Kiro API provides Claude and OpenAI compatible endpoints for AI chat completions.

## Authentication
All requests require an API key in the header:
- **Claude format**: \`x-api-key: sk-xxx\`
- **OpenAI format**: \`Authorization: Bearer sk-xxx\`

## Supported Providers
Use the \`Model-Provider\` header to select a provider:
| Provider | Header Value | Description |
|----------|--------------|-------------|
| Kiro | (default) | AWS Q/CodeWhisperer |
| Anthropic | \`anthropic\` | Direct Anthropic API |
| Gemini | \`gemini\` | Gemini Antigravity |
| Vertex | \`vertex\` | Google Vertex AI |
| Bedrock | \`bedrock\` | AWS Bedrock |
| Warp | \`warp\` | Warp API |
| Orchids | \`orchids\` | Orchids API |
            `,
            contact: {
                name: 'Kiro API Support'
            }
        },
        servers: [
            {
                url: '/',
                description: 'Current server'
            }
        ],
        tags: [
            { name: 'Claude API', description: 'Anthropic Claude compatible endpoints' },
            { name: 'OpenAI API', description: 'OpenAI compatible endpoints' },
            { name: 'Models', description: 'Model listing endpoints' },
            { name: 'Health', description: 'Health check endpoints' }
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key',
                    description: 'API key for Claude format'
                },
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'Bearer token for OpenAI format'
                }
            },
            schemas: {
                ClaudeMessage: {
                    type: 'object',
                    required: ['role', 'content'],
                    properties: {
                        role: {
                            type: 'string',
                            enum: ['user', 'assistant'],
                            description: 'Message role'
                        },
                        content: {
                            oneOf: [
                                { type: 'string' },
                                {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            type: { type: 'string', enum: ['text', 'image', 'tool_use', 'tool_result'] },
                                            text: { type: 'string' }
                                        }
                                    }
                                }
                            ],
                            description: 'Message content (string or array of content blocks)'
                        }
                    }
                },
                ClaudeRequest: {
                    type: 'object',
                    required: ['model', 'messages', 'max_tokens'],
                    properties: {
                        model: {
                            type: 'string',
                            example: 'claude-sonnet-4-20250514',
                            description: 'Model ID'
                        },
                        messages: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/ClaudeMessage' },
                            description: 'Conversation messages'
                        },
                        max_tokens: {
                            type: 'integer',
                            example: 4096,
                            description: 'Maximum tokens to generate'
                        },
                        stream: {
                            type: 'boolean',
                            default: false,
                            description: 'Enable streaming response'
                        },
                        system: {
                            type: 'string',
                            description: 'System prompt'
                        },
                        temperature: {
                            type: 'number',
                            minimum: 0,
                            maximum: 1,
                            description: 'Sampling temperature'
                        },
                        tools: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    description: { type: 'string' },
                                    input_schema: { type: 'object' }
                                }
                            },
                            description: 'Available tools for function calling'
                        }
                    }
                },
                ClaudeResponse: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: 'msg_abc123' },
                        type: { type: 'string', example: 'message' },
                        role: { type: 'string', example: 'assistant' },
                        content: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string' },
                                    text: { type: 'string' }
                                }
                            }
                        },
                        model: { type: 'string' },
                        stop_reason: { type: 'string', enum: ['end_turn', 'max_tokens', 'tool_use'] },
                        usage: {
                            type: 'object',
                            properties: {
                                input_tokens: { type: 'integer' },
                                output_tokens: { type: 'integer' }
                            }
                        }
                    }
                },
                OpenAIMessage: {
                    type: 'object',
                    required: ['role', 'content'],
                    properties: {
                        role: {
                            type: 'string',
                            enum: ['system', 'user', 'assistant', 'tool'],
                            description: 'Message role'
                        },
                        content: {
                            type: 'string',
                            description: 'Message content'
                        }
                    }
                },
                OpenAIRequest: {
                    type: 'object',
                    required: ['model', 'messages'],
                    properties: {
                        model: {
                            type: 'string',
                            example: 'gpt-4',
                            description: 'Model ID (mapped to Claude models)'
                        },
                        messages: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/OpenAIMessage' },
                            description: 'Conversation messages'
                        },
                        max_tokens: {
                            type: 'integer',
                            example: 4096
                        },
                        stream: {
                            type: 'boolean',
                            default: false
                        },
                        temperature: {
                            type: 'number'
                        }
                    }
                },
                OpenAIResponse: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        object: { type: 'string', example: 'chat.completion' },
                        created: { type: 'integer' },
                        model: { type: 'string' },
                        choices: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    index: { type: 'integer' },
                                    message: { $ref: '#/components/schemas/OpenAIMessage' },
                                    finish_reason: { type: 'string' }
                                }
                            }
                        },
                        usage: {
                            type: 'object',
                            properties: {
                                prompt_tokens: { type: 'integer' },
                                completion_tokens: { type: 'integer' },
                                total_tokens: { type: 'integer' }
                            }
                        }
                    }
                },
                Model: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        object: { type: 'string', example: 'model' },
                        created: { type: 'integer' },
                        owned_by: { type: 'string' }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'object',
                            properties: {
                                type: { type: 'string' },
                                message: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    },
    apis: [] // We'll define paths inline
};

// Generate base spec
const swaggerSpec = swaggerJsdoc(options);

// Add paths manually for better control
swaggerSpec.paths = {
    '/v1/messages': {
        post: {
            tags: ['Claude API'],
            summary: 'Create a message (Claude format)',
            description: 'Send a message to Claude and get a response. Supports streaming.',
            security: [{ ApiKeyAuth: [] }],
            parameters: [
                {
                    name: 'anthropic-version',
                    in: 'header',
                    required: true,
                    schema: { type: 'string', default: '2023-06-01' },
                    description: 'Anthropic API version'
                },
                {
                    name: 'Model-Provider',
                    in: 'header',
                    required: false,
                    schema: { type: 'string', enum: ['kiro', 'anthropic', 'gemini', 'vertex', 'bedrock', 'warp', 'orchids'] },
                    description: 'Provider to use (default: kiro)'
                }
            ],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/ClaudeRequest' },
                        examples: {
                            simple: {
                                summary: 'Simple message',
                                value: {
                                    model: 'claude-sonnet-4-20250514',
                                    max_tokens: 1024,
                                    messages: [{ role: 'user', content: 'Hello, Claude!' }]
                                }
                            },
                            withSystem: {
                                summary: 'With system prompt',
                                value: {
                                    model: 'claude-sonnet-4-20250514',
                                    max_tokens: 4096,
                                    system: 'You are a helpful assistant.',
                                    messages: [{ role: 'user', content: 'Explain quantum computing.' }]
                                }
                            },
                            streaming: {
                                summary: 'Streaming response',
                                value: {
                                    model: 'claude-sonnet-4-20250514',
                                    max_tokens: 1024,
                                    stream: true,
                                    messages: [{ role: 'user', content: 'Tell me a story.' }]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: 'Successful response',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ClaudeResponse' }
                        },
                        'text/event-stream': {
                            description: 'SSE stream when stream=true'
                        }
                    }
                },
                '400': {
                    description: 'Bad request',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
                },
                '401': {
                    description: 'Unauthorized - Invalid API key',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
                },
                '429': {
                    description: 'Rate limit exceeded',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
                },
                '500': {
                    description: 'Internal server error',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
                }
            }
        }
    },
    '/v1/chat/completions': {
        post: {
            tags: ['OpenAI API'],
            summary: 'Create chat completion (OpenAI format)',
            description: 'OpenAI-compatible chat completions endpoint. Requests are translated to Claude format internally.',
            security: [{ BearerAuth: [] }],
            parameters: [
                {
                    name: 'Model-Provider',
                    in: 'header',
                    required: false,
                    schema: { type: 'string', enum: ['kiro', 'anthropic', 'gemini', 'vertex', 'bedrock', 'warp', 'orchids'] },
                    description: 'Provider to use (default: kiro)'
                }
            ],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/OpenAIRequest' },
                        examples: {
                            simple: {
                                summary: 'Simple chat',
                                value: {
                                    model: 'gpt-4',
                                    messages: [{ role: 'user', content: 'Hello!' }]
                                }
                            },
                            withSystem: {
                                summary: 'With system message',
                                value: {
                                    model: 'gpt-4',
                                    messages: [
                                        { role: 'system', content: 'You are a helpful assistant.' },
                                        { role: 'user', content: 'What is 2+2?' }
                                    ]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': {
                    description: 'Successful response',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/OpenAIResponse' }
                        }
                    }
                },
                '400': { description: 'Bad request' },
                '401': { description: 'Unauthorized' },
                '500': { description: 'Internal server error' }
            }
        }
    },
    '/v1/models': {
        get: {
            tags: ['Models'],
            summary: 'List available models',
            description: 'Returns a list of all available models across all providers.',
            responses: {
                '200': {
                    description: 'List of models',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    object: { type: 'string', example: 'list' },
                                    data: {
                                        type: 'array',
                                        items: { $ref: '#/components/schemas/Model' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    '/health': {
        get: {
            tags: ['Health'],
            summary: 'Health check',
            description: 'Returns server health status.',
            responses: {
                '200': {
                    description: 'Server is healthy',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    status: { type: 'string', example: 'ok' },
                                    timestamp: { type: 'string', format: 'date-time' }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};

export default swaggerSpec;
