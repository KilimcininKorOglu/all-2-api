/**
 * Admin API Swagger Configuration
 * Management and administration endpoints
 */
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Kiro API - Admin Endpoints',
            version: '1.0.0',
            description: `
## Overview
Admin API for managing Kiro API server configuration, credentials, and monitoring.

## Authentication
Admin endpoints require JWT authentication:
1. Login via \`POST /api/auth/login\`
2. Use the returned token in \`Authorization: Bearer <token>\` header

## Default Credentials
- Username: \`admin\`
- Password: \`admin123\`
            `
        },
        servers: [{ url: '/', description: 'Current server' }],
        tags: [
            { name: 'Authentication', description: 'Admin authentication' },
            { name: 'Credentials', description: 'Kiro account management' },
            { name: 'API Keys', description: 'External API key management' },
            { name: 'Settings', description: 'Server configuration' },
            { name: 'Logs', description: 'Request logging and statistics' },
            { name: 'OAuth', description: 'OAuth authentication flows' },
            { name: 'Providers', description: 'Multi-provider management' },
            { name: 'Pricing', description: 'Model pricing configuration' }
        ],
        components: {
            securitySchemes: {
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT token from /api/auth/login'
                }
            },
            schemas: {
                LoginRequest: {
                    type: 'object',
                    required: ['username', 'password'],
                    properties: {
                        username: { type: 'string', example: 'admin' },
                        password: { type: 'string', example: 'admin123' }
                    }
                },
                LoginResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        token: { type: 'string' },
                        expiresIn: { type: 'string', example: '24h' }
                    }
                },
                Credential: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        authMethod: { type: 'string', enum: ['social', 'builder-id', 'IdC'] },
                        region: { type: 'string', example: 'us-east-1' },
                        provider: { type: 'string', example: 'Google' },
                        isActive: { type: 'boolean' },
                        expiresAt: { type: 'string', format: 'date-time' },
                        useCount: { type: 'integer' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                CreateCredential: {
                    type: 'object',
                    required: ['refreshToken'],
                    properties: {
                        email: { type: 'string' },
                        refreshToken: { type: 'string' },
                        authMethod: { type: 'string', enum: ['social', 'builder-id', 'IdC'], default: 'social' },
                        region: { type: 'string', default: 'us-east-1' },
                        provider: { type: 'string', enum: ['Google', 'GitHub'], default: 'Google' },
                        clientId: { type: 'string', description: 'Required for builder-id/IdC' },
                        clientSecret: { type: 'string', description: 'Required for builder-id/IdC' }
                    }
                },
                ApiKey: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                        key: { type: 'string', example: 'sk-xxx...' },
                        isActive: { type: 'boolean' },
                        expiresAt: { type: 'string', format: 'date-time' },
                        rateLimit: { type: 'integer' },
                        dailyLimit: { type: 'integer' },
                        monthlyLimit: { type: 'integer' },
                        usageCount: { type: 'integer' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                CreateApiKey: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                        name: { type: 'string' },
                        expiresAt: { type: 'string', format: 'date-time' },
                        rateLimit: { type: 'integer', description: 'Requests per minute' },
                        dailyLimit: { type: 'integer' },
                        monthlyLimit: { type: 'integer' }
                    }
                },
                SiteSettings: {
                    type: 'object',
                    properties: {
                        selection_strategy: { type: 'string', enum: ['hybrid', 'sticky', 'round-robin'] },
                        token_refresh_interval: { type: 'integer', description: 'Minutes' },
                        token_refresh_threshold: { type: 'integer', description: 'Minutes' },
                        quota_refresh_interval: { type: 'integer', description: 'Minutes' },
                        log_level: { type: 'string', enum: ['DEBUG', 'INFO', 'WARN', 'ERROR'] },
                        log_enabled: { type: 'boolean' },
                        log_console: { type: 'boolean' }
                    }
                },
                ProviderSettings: {
                    type: 'object',
                    properties: {
                        kiro: { type: 'object', properties: { enabled: { type: 'boolean' } } },
                        anthropic: { type: 'object', properties: { enabled: { type: 'boolean' } } },
                        gemini: { type: 'object', properties: { enabled: { type: 'boolean' } } },
                        vertex: { type: 'object', properties: { enabled: { type: 'boolean' } } },
                        bedrock: { type: 'object', properties: { enabled: { type: 'boolean' } } },
                        warp: { type: 'object', properties: { enabled: { type: 'boolean' } } },
                        orchids: { type: 'object', properties: { enabled: { type: 'boolean' } } }
                    }
                },
                ModelAlias: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        aliasName: { type: 'string', example: 'gpt-4' },
                        targetModel: { type: 'string', example: 'claude-sonnet-4-20250514' },
                        provider: { type: 'string' },
                        isActive: { type: 'boolean' }
                    }
                },
                LogEntry: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        requestId: { type: 'string' },
                        provider: { type: 'string' },
                        model: { type: 'string' },
                        inputTokens: { type: 'integer' },
                        outputTokens: { type: 'integer' },
                        cost: { type: 'number' },
                        duration: { type: 'integer', description: 'Milliseconds' },
                        status: { type: 'string' },
                        clientIp: { type: 'string' },
                        apiKeyId: { type: 'integer' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                Pricing: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        modelId: { type: 'string' },
                        inputPrice: { type: 'number', description: 'Per 1M tokens' },
                        outputPrice: { type: 'number', description: 'Per 1M tokens' },
                        cacheReadPrice: { type: 'number' },
                        cacheWritePrice: { type: 'number' },
                        isCustom: { type: 'boolean' }
                    }
                },
                Success: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        error: { type: 'string' }
                    }
                }
            }
        }
    },
    apis: []
};

const swaggerSpec = swaggerJsdoc(options);

// Define paths
swaggerSpec.paths = {
    // Authentication
    '/api/auth/login': {
        post: {
            tags: ['Authentication'],
            summary: 'Admin login',
            requestBody: {
                required: true,
                content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } }
            },
            responses: {
                '200': { description: 'Login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
                '401': { description: 'Invalid credentials' }
            }
        }
    },
    '/api/auth/logout': {
        post: {
            tags: ['Authentication'],
            summary: 'Admin logout',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Logout successful' } }
        }
    },
    '/api/auth/me': {
        get: {
            tags: ['Authentication'],
            summary: 'Get current user info',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'User info' } }
        }
    },
    '/api/auth/change-password': {
        post: {
            tags: ['Authentication'],
            summary: 'Change admin password',
            security: [{ BearerAuth: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['currentPassword', 'newPassword'],
                            properties: {
                                currentPassword: { type: 'string' },
                                newPassword: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Password changed' }, '401': { description: 'Invalid current password' } }
        }
    },

    // Credentials
    '/api/credentials': {
        get: {
            tags: ['Credentials'],
            summary: 'List all Kiro credentials',
            security: [{ BearerAuth: [] }],
            responses: {
                '200': {
                    description: 'List of credentials',
                    content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Credential' } } } }
                }
            }
        },
        post: {
            tags: ['Credentials'],
            summary: 'Add a new credential',
            security: [{ BearerAuth: [] }],
            requestBody: {
                required: true,
                content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCredential' } } }
            },
            responses: {
                '200': { description: 'Credential created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                '400': { description: 'Invalid request' }
            }
        }
    },
    '/api/credentials/{id}': {
        get: {
            tags: ['Credentials'],
            summary: 'Get credential by ID',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'Credential details' }, '404': { description: 'Not found' } }
        },
        put: {
            tags: ['Credentials'],
            summary: 'Update credential',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            requestBody: {
                content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, region: { type: 'string' }, isActive: { type: 'boolean' } } } } }
            },
            responses: { '200': { description: 'Updated' } }
        },
        delete: {
            tags: ['Credentials'],
            summary: 'Delete credential',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'Deleted' } }
        }
    },
    '/api/credentials/{id}/refresh': {
        post: {
            tags: ['Credentials'],
            summary: 'Refresh credential token',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'Token refreshed' }, '500': { description: 'Refresh failed' } }
        }
    },
    '/api/credentials/{id}/test': {
        post: {
            tags: ['Credentials'],
            summary: 'Test credential',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'Test result' } }
        }
    },
    '/api/credentials/batch-import': {
        post: {
            tags: ['Credentials'],
            summary: 'Batch import credentials',
            security: [{ BearerAuth: [] }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                accounts: { type: 'array', items: { type: 'object' } },
                                region: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Import results' } }
        }
    },

    // API Keys
    '/api/keys': {
        get: {
            tags: ['API Keys'],
            summary: 'List all API keys',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'List of API keys', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } } } } }
        },
        post: {
            tags: ['API Keys'],
            summary: 'Create new API key',
            security: [{ BearerAuth: [] }],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateApiKey' } } } },
            responses: { '200': { description: 'API key created' } }
        }
    },
    '/api/keys/{id}': {
        get: {
            tags: ['API Keys'],
            summary: 'Get API key by ID',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'API key details' } }
        },
        delete: {
            tags: ['API Keys'],
            summary: 'Delete API key',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'Deleted' } }
        }
    },
    '/api/keys/{id}/toggle': {
        post: {
            tags: ['API Keys'],
            summary: 'Toggle API key active status',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'Toggled' } }
        }
    },
    '/api/keys/{id}/limits': {
        put: {
            tags: ['API Keys'],
            summary: 'Update API key limits',
            security: [{ BearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                rateLimit: { type: 'integer' },
                                dailyLimit: { type: 'integer' },
                                monthlyLimit: { type: 'integer' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Limits updated' } }
        }
    },

    // Settings
    '/api/site-settings': {
        get: {
            tags: ['Settings'],
            summary: 'Get site settings',
            responses: { '200': { description: 'Settings', content: { 'application/json': { schema: { $ref: '#/components/schemas/SiteSettings' } } } } }
        },
        put: {
            tags: ['Settings'],
            summary: 'Update site settings',
            security: [{ BearerAuth: [] }],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/SiteSettings' } } } },
            responses: { '200': { description: 'Updated' } }
        }
    },
    '/api/provider-settings': {
        get: {
            tags: ['Settings'],
            summary: 'Get provider settings',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Provider settings' } }
        },
        put: {
            tags: ['Settings'],
            summary: 'Update provider settings',
            security: [{ BearerAuth: [] }],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProviderSettings' } } } },
            responses: { '200': { description: 'Updated' } }
        }
    },

    // Model Aliases
    '/api/model-aliases': {
        get: {
            tags: ['Settings'],
            summary: 'List model aliases',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'List of aliases' } }
        },
        post: {
            tags: ['Settings'],
            summary: 'Create model alias',
            security: [{ BearerAuth: [] }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['aliasName', 'targetModel'],
                            properties: {
                                aliasName: { type: 'string' },
                                targetModel: { type: 'string' },
                                provider: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Created' } }
        }
    },

    // Logs
    '/api/logs': {
        get: {
            tags: ['Logs'],
            summary: 'Get request logs',
            security: [{ BearerAuth: [] }],
            parameters: [
                { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                { name: 'provider', in: 'query', schema: { type: 'string' } },
                { name: 'status', in: 'query', schema: { type: 'string' } }
            ],
            responses: { '200': { description: 'Log entries' } }
        }
    },
    '/api/logs-stats': {
        get: {
            tags: ['Logs'],
            summary: 'Get log statistics',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Statistics' } }
        }
    },
    '/api/logs-stats/cost': {
        get: {
            tags: ['Logs'],
            summary: 'Get cost statistics',
            security: [{ BearerAuth: [] }],
            parameters: [
                { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
                { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } }
            ],
            responses: { '200': { description: 'Cost statistics' } }
        }
    },

    // OAuth
    '/api/oauth/social/start': {
        post: {
            tags: ['OAuth'],
            summary: 'Start Social OAuth flow (Google/GitHub)',
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                provider: { type: 'string', enum: ['Google', 'GitHub'] },
                                region: { type: 'string' },
                                name: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'OAuth URL returned' } }
        }
    },
    '/api/oauth/builder-id/start': {
        post: {
            tags: ['OAuth'],
            summary: 'Start Builder ID OAuth flow',
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                region: { type: 'string' },
                                name: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Device code and verification URL' } }
        }
    },
    '/api/oauth/idc/start': {
        post: {
            tags: ['OAuth'],
            summary: 'Start IAM Identity Center OAuth flow',
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['startUrl'],
                            properties: {
                                startUrl: { type: 'string', example: 'https://d-xxx.awsapps.com/start' },
                                region: { type: 'string' },
                                name: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Device code and verification URL' } }
        }
    },
    '/api/oauth/session/{sessionId}': {
        get: {
            tags: ['OAuth'],
            summary: 'Check OAuth session status',
            parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Session status' } }
        }
    },

    // Pricing
    '/api/pricing': {
        get: {
            tags: ['Pricing'],
            summary: 'List all pricing',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Pricing list' } }
        },
        post: {
            tags: ['Pricing'],
            summary: 'Add custom pricing',
            security: [{ BearerAuth: [] }],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pricing' } } } },
            responses: { '200': { description: 'Created' } }
        }
    },
    '/api/pricing/sync-remote': {
        post: {
            tags: ['Pricing'],
            summary: 'Sync pricing from remote source',
            security: [{ BearerAuth: [] }],
            responses: { '200': { description: 'Sync results' } }
        }
    }
};

export default swaggerSpec;
