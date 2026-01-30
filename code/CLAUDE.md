# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ALL-2-API (Kiro API Client) - A Node.js API proxy service that converts Kiro (AWS CodeWhisperer), Gemini Antigravity, Vertex AI, Orchids, Warp, and Bedrock APIs to standardized OpenAI/Claude-compatible interfaces. Includes a web management console for credential management, account pooling, and usage monitoring.

## Commands

```bash
# Install dependencies
npm install

# Start web server (port 13003)
npm run server

# Start with HTTP proxy
npm run server:proxy

# Run test script
npm test

# Cluster mode
npm run cluster    # Start worker nodes
npm run balancer   # Start load balancer
npm run prod       # Both together
```

## Architecture

### Directory Structure

```
src/
├── index.js              # Main entry, exports all modules
├── server.js             # Express web server (main file)
├── constants.js          # API endpoints, model mappings
├── db.js                 # MySQL connection and schema
├── logger.js             # Per-module logging
├── proxy.js              # Proxy configuration
├── kiro/                 # Kiro (Claude via AWS) module
│   ├── client.js         # KiroClient class
│   ├── api.js            # KiroAPI stateless service
│   ├── auth.js           # OAuth authentication
│   ├── auth-cli.js       # CLI login tool
│   └── kiro-service.js   # Service wrapper
├── gemini/               # Gemini Antigravity module
│   ├── antigravity-core.js
│   └── gemini-routes.js
├── orchids/              # Orchids API module
│   ├── orchids-service.js
│   ├── orchids-chat-service.js
│   ├── orchids-routes.js
│   └── orchids-loadbalancer.js
├── warp/                 # Warp API module
│   ├── warp-service.js
│   ├── warp-routes.js
│   └── warp-multi-agent.js
├── vertex/               # Vertex AI module
│   ├── vertex.js
│   └── vertex-routes.js
├── bedrock/              # Amazon Bedrock module
│   ├── bedrock.js
│   └── bedrock-routes.js
├── cluster/              # Clustering and load balancing
│   ├── cluster.js
│   └── balancer.js
└── public/               # Web UI (HTML/JS/CSS)
    ├── index.html
    ├── pages/            # Feature pages
    ├── js/               # Frontend JavaScript
    └── css/              # Stylesheets
```

### Multi-Provider Routing

The server routes requests to different AI providers based on the `Model-Provider` header or route prefix:

| Provider | Route Prefix             | Header Value |
|----------|--------------------------|--------------|
| Kiro     | `/v1/*`                  | (default)    |
| Gemini   | `/gemini-antigravity/*`  | `gemini`     |
| Orchids  | `/orchids/*`             | `orchids`    |
| Warp     | `/warp/*`                | `warp`       |
| Vertex   | `/vertex/*`              | `vertex`     |
| Bedrock  | `/bedrock/*`             | `bedrock`    |

### Core Modules

- **src/index.js** - Main entry point, exports: `KiroClient`, `KiroAuth`, `KiroAPI`, `VertexClient`, `VertexAPI`, constants

- **src/kiro/client.js** - `KiroClient` class: Main API client for Claude model interactions
  - Handles chat requests (streaming and non-streaming)
  - AWS Event Stream parsing for responses
  - Automatic retry with exponential backoff (429, 5xx errors)
  - Factory methods: `fromCredentialsFile()`, `fromDatabase()`, `fromDatabaseById()`

- **src/kiro/api.js** - `KiroAPI` class: Unified stateless API service
  - `refreshToken()` / `batchRefreshToken()` - Token refresh for all auth methods
  - `chat()` / `chatStream()` - Non-streaming and streaming chat
  - `getUsageLimits()` / `listModels()` - Usage and model queries
  - `isTokenExpiringSoon()` - Token expiration check (default 10 min threshold)

- **src/kiro/auth.js** - `KiroAuth` class: OAuth authentication
  - Social Auth (Google/GitHub): PKCE flow with local HTTP callback server (ports 19876-19880)
  - Builder ID: Device Code Flow with OIDC polling

- **src/db.js** - MySQL database management
  - Connection pooling with mysql2
  - Schema definitions for all credential tables
  - CRUD operations for credentials, users, API keys, logs

- **src/server.js** - Express web server
  - REST API at `/api/*` for management operations
  - OpenAI-compatible endpoints at `/v1/*`
  - Background tasks: credential refresh, error credential retry

- **src/logger.js** - Unified logging module
  - Per-module log files: `logs/{module}-YYYY-MM-DD.log`
  - Usage: `import { logger } from './logger.js'; logger.api.info('message')`

### Database Schema (MySQL)

Key tables in `kiro_api` database:

| Table                 | Description                        |
|-----------------------|------------------------------------|
| `credentials`         | Kiro OAuth credentials (active)    |
| `error_credentials`   | Failed credentials (auto-retry)    |
| `gemini_credentials`  | Gemini Antigravity credentials     |
| `orchids_credentials` | Orchids credentials                |
| `users`               | Web console authentication         |
| `api_keys`            | External API key management        |
| `api_logs`            | Request/response audit logs        |
| `model_pricing`       | Token cost configuration           |

### Authentication Methods (Kiro)

1. **Social Auth** (`authMethod: 'social'`): Uses `profileArn` for API calls, refreshes via Kiro auth service
2. **Builder ID** (`authMethod: 'builder-id'`): Uses `clientId`/`clientSecret`, refreshes via `oidc.amazonaws.com`
3. **IAM Identity Center** (`authMethod: 'IdC'`): Uses `clientId`/`clientSecret`, refreshes via `sso-oidc.amazonaws.com`

### Model Mapping

Models are mapped to internal CodeWhisperer names in `MODEL_MAPPING` (constants.js):
- `claude-sonnet-4-20250514` → `CLAUDE_SONNET_4_20250514_V1_0`
- `claude-opus-4-5-20251101` → `claude-opus-4.5`
- `claude-sonnet-4-5-20250929` → `CLAUDE_SONNET_4_5_20250929_V1_0`

### External API Endpoints

Require API key via `X-API-Key` header or `Authorization: Bearer <key>`:

| Method | Path                            | Description                    |
|--------|---------------------------------|--------------------------------|
| GET    | `/v1/models`                    | List models (OpenAI format)    |
| POST   | `/v1/messages`                  | Claude API compatible          |
| POST   | `/v1/chat/completions`          | OpenAI API compatible          |
| POST   | `/gemini-antigravity/v1/messages` | Gemini Antigravity API       |

### Management API Endpoints

Require web console login session:

- `GET/POST/DELETE /api/credentials` - Kiro credential CRUD
- `POST /api/credentials/:id/activate` - Set active credential
- `POST /api/credentials/:id/refresh` - Manual token refresh
- `POST /api/credentials/:id/test` - Test credential validity
- `POST /api/credentials/batch-import` - Batch import accounts
- `GET/POST/DELETE /api/gemini/credentials` - Gemini credential management
- `GET/POST/DELETE /api/keys` - API key management
- `GET /api/logs` - Request logs (paginated)

## Key Implementation Details

- ES Modules (`"type": "module"` in package.json)
- MySQL 8.0 with connection pooling
- Token auto-refresh triggers 10 minutes before expiration
- Failed credentials move to `error_credentials` table with periodic retry
- Message history requires alternating user/assistant roles; adjacent same-role messages are auto-merged
- AWS Event Stream responses parsed with bracket-counting JSON extraction
- Automatic message compression on 400 ValidationException errors

## Environment Variables

| Variable         | Default      | Description              |
|------------------|--------------|--------------------------|
| `PORT`           | `13003`      | API server port          |
| `MYSQL_HOST`     | `127.0.0.1`  | MySQL host               |
| `MYSQL_PORT`     | `13306`      | MySQL port               |
| `MYSQL_USER`     | `root`       | MySQL user               |
| `MYSQL_PASSWORD` | -            | MySQL password           |
| `MYSQL_DATABASE` | `kiro_api`   | Database name            |
| `LOG_DIR`        | `./logs`     | Log file directory       |
| `LOG_LEVEL`      | `INFO`       | DEBUG, INFO, WARN, ERROR |
| `LOG_ENABLED`    | `true`       | Enable file logging      |
| `LOG_CONSOLE`    | `true`       | Enable console output    |

## Docker Deployment

```bash
# With built-in MySQL
docker-compose up -d

# With external database
docker-compose -f docker-compose.external-db.yml up -d
```

## Web Console

- URL: http://localhost:13003
- Default credentials: `admin` / `admin123`

## Naming Conventions

- JavaScript: camelCase for variables, functions, properties
- Database fields: snake_case (e.g., `access_token`, `profile_arn`)
