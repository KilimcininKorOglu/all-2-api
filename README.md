# ALL-2-API

A powerful API proxy service that provides free access to Claude/Gemini top-tier models through Kiro API and Gemini Antigravity API, wrapped in a standard OpenAI-compatible interface.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![GitHub stars](https://img.shields.io/github/stars/CaiGaoQing/kiro-api-client?style=social)](https://github.com/CaiGaoQing/kiro-api-client)

---

ALL-2-API is an API proxy service that breaks client restrictions, converting client-only free large models (such as Kiro, Gemini Antigravity) into standard OpenAI-compatible interfaces that can be called by any application. Built on Node.js, it supports intelligent conversion between OpenAI and Claude protocols, enabling tools like Cherry-Studio, NextChat, and Cline to freely use advanced models such as Claude Opus 4.5 and Gemini 3 Pro. The project includes built-in account pool management, intelligent polling, automatic failover, and health check mechanisms to ensure high service availability.

---

## Table of Contents

- [Key Advantages](#key-advantages)
- [Quick Start](#quick-start)
- [Docker Deployment](#docker-deployment)
- [Core Features](#core-features)
- [Supported Models](#supported-models)
- [Authentication Configuration Guide](#authentication-configuration-guide)
- [API Documentation](#api-documentation)
- [Advanced Configuration](#advanced-configuration)
- [FAQ](#faq)
- [License](#license)

---

## Key Advantages

### Unified Access, One-Stop Management
- **Multi-model unified interface**: One configuration to access Claude, Gemini, and other mainstream large models through standard OpenAI-compatible protocol
- **Flexible switching mechanism**: Dynamically switch model providers via request headers to meet different scenario requirements
- **Zero-cost migration**: Fully compatible with OpenAI API specification, tools like Cherry-Studio, NextChat, and Cline work without modification
- **Multi-protocol intelligent conversion**: Supports intelligent conversion between OpenAI and Claude protocols for cross-protocol model calls

### Breaking Limits, Improving Efficiency
- **Breaking official restrictions**: Utilizing OAuth authorization mechanism
- **Free premium models**: Free access to Claude Opus 4.5 via Kiro API, Gemini 3 Pro via Gemini Antigravity, reducing usage costs
- **Intelligent account pool scheduling**: Supports multi-account polling and automatic failover to ensure high service availability

### Secure and Controllable, Data Transparency
- **Full-chain logging**: Captures all request and response data, supporting audit and debugging
- **Cost statistics**: Real-time token usage and cost statistics for cost control
- **System prompt management**: Supports override and append modes for unified base instructions with personalized extensions

### Developer Friendly, Easy to Extend
- **Web UI management console**: Real-time configuration management, health status monitoring, API testing, and log viewing
- **Modular architecture**: Based on strategy and adapter patterns, adding new model providers takes only 3 steps
- **Containerized deployment**: Docker support for one-click deployment and cross-platform operation

---

## Quick Start

### Manual Start

```bash
# Install dependencies
npm install

# Start service
npm run server
```

### Access Console

After the service starts, open your browser and visit: **http://localhost:13003**

**Default credentials**: `admin` / `admin123`

---

## Docker Deployment

### Docker Compose Deployment (Recommended)

#### Using Built-in MySQL

```bash
# Copy environment variable configuration
cp .env.example .env

# Start service (includes MySQL)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop service
docker-compose down
```

#### Using External Database

```bash
# Copy and edit environment variables
cp .env.example .env
# Edit .env to set external database address

# Start service (without built-in MySQL)
docker-compose -f docker-compose.external-db.yml up -d
```

### Environment Variables

| Variable              | Default      | Description                |
|-----------------------|--------------|----------------------------|
| `PORT`                | `13003`      | API service port           |
| `MYSQL_HOST`          | `mysql`      | Database address           |
| `MYSQL_PORT`          | `3306`       | Database port              |
| `MYSQL_USER`          | `root`       | Database user              |
| `MYSQL_PASSWORD`      | `kiro123456` | Database password          |
| `MYSQL_DATABASE`      | `kiro_api`   | Database name              |
| `MYSQL_EXTERNAL_PORT` | `13306`      | MySQL external access port |

---

## Core Features

### Web UI Management Console

A fully-featured web management interface including:

- **Dashboard**: System overview, usage statistics, cost analysis
- **Configuration Management**: Real-time parameter modification, supporting Kiro and Gemini provider configuration
- **Credential Pool Management**: Monitor active connections, health status statistics, enable/disable management
- **Account Management**: Centralized OAuth credential management with batch import support
- **Real-time Logs**: Real-time display of system and request logs with management controls
- **Login Authentication**: Default password `admin123`, can be changed in the console

### Multimodal Input Capability

Supports various input types including images and documents, providing richer interaction experiences and more powerful application scenarios.

### Latest Model Support

Seamlessly supports the following latest large models:

- **Claude Opus 4.5** - Anthropic's most powerful model, supported via Kiro
- **Claude Sonnet 4/4.5** - Cost-effective choice, supported via Kiro
- **Gemini 3 Pro** - Google's next-generation architecture preview, supported via Gemini Antigravity
- **Gemini 3 Flash** - Fast response model, supported via Gemini Antigravity

---

### Screenshots

#### Home Overview
![Index Page](https://github.com/CaiGaoQing/kiro-api-client/blob/main/index.png?raw=true)

#### Statistics Panel
![Index Page 2](https://github.com/CaiGaoQing/kiro-api-client/blob/main/index2.png?raw=true)

#### OAuth Authentication
![OAuth Authentication](https://github.com/CaiGaoQing/kiro-api-client/blob/main/oauth.png?raw=true)

#### API Interface
![API Interface](https://github.com/CaiGaoQing/kiro-api-client/blob/main/api.png?raw=true)

#### Chat Interface
![Chat Interface](https://github.com/CaiGaoQing/kiro-api-client/blob/main/chat.png?raw=true)

#### Usage Statistics
![Usage Statistics](https://github.com/CaiGaoQing/kiro-api-client/blob/main/usage.png?raw=true)

---

## Supported Models

### Kiro (Claude) Models

| Model Name                   | Internal Mapping                  | Description                     |
|------------------------------|-----------------------------------|---------------------------------|
| `claude-opus-4-5-20251101`   | `claude-opus-4.5`                 | Anthropic's most powerful model |
| `claude-sonnet-4-20250514`   | `CLAUDE_SONNET_4_20250514_V1_0`   | Cost-effective choice           |
| `claude-sonnet-4-5-20250929` | `CLAUDE_SONNET_4_5_20250929_V1_0` | Latest Sonnet version           |
| `claude-3-7-sonnet-20250219` | `CLAUDE_3_7_SONNET_20250219_V1_0` | Claude 3.7 Sonnet               |
| `claude-haiku-4-5`           | `claude-haiku-4.5`                | Fast response model             |

### Gemini Models (Antigravity)

| Model Name                                | Internal Mapping             | Description              |
|-------------------------------------------|------------------------------|--------------------------|
| `gemini-3-pro-preview`                    | `gemini-3-pro-high`          | Google's latest flagship |
| `gemini-3-pro-image-preview`              | `gemini-3-pro-image`         | Image generation version |
| `gemini-3-flash-preview`                  | `gemini-3-flash`             | Fast response version    |
| `gemini-2.5-flash-preview`                | `gemini-2.5-flash`           | 2.5 Flash version        |
| `gemini-2.5-computer-use-preview-10-2025` | `rev19-uic3-1p`              | Computer use preview     |
| `gemini-claude-sonnet-4-5`                | `claude-sonnet-4-5`          | Claude via Gemini        |
| `gemini-claude-sonnet-4-5-thinking`       | `claude-sonnet-4-5-thinking` | Thinking mode            |
| `gemini-claude-opus-4-5-thinking`         | `claude-opus-4-5-thinking`   | Opus thinking mode       |

### Model Pricing Reference

#### Kiro (Claude) Models

| Model               | Input Price ($/M tokens) | Output Price ($/M tokens) |
|---------------------|--------------------------|---------------------------|
| Claude Opus 4.5     | $15                      | $75                       |
| Claude Sonnet 4/4.5 | $3                       | $15                       |
| Claude 3.7 Sonnet   | $3                       | $15                       |
| Claude Haiku 4.5    | $0.80                    | $4                        |

#### Gemini Models

| Model                           | Input Price ($/M tokens) | Output Price ($/M tokens) |
|---------------------------------|--------------------------|---------------------------|
| Gemini 3 Pro                    | $1.25                    | $5                        |
| Gemini 3 Flash                  | $0.075                   | $0.30                     |
| Gemini 2.5 Flash                | $0.075                   | $0.30                     |
| Gemini Claude Sonnet 4.5        | $3                       | $15                       |
| Gemini Claude Opus 4.5 Thinking | $15                      | $75                       |

---

## Authentication Configuration Guide

<details>
<summary>Click to expand detailed authentication configuration steps</summary>

### 1. Social Auth (Google/GitHub)

Uses PKCE flow with local HTTP callback server (ports 19876-19880) for authentication.

**Web interface authentication flow:**
1. Access web management interface at http://localhost:13003
2. Go to "Kiro Accounts" page
3. Click "Add Account" -> "OAuth Login"
4. Select Google or GitHub login
5. Credentials are automatically saved after successful authorization

**CLI authentication:**
```bash
node src/auth-cli.js
```

### 2. Builder ID

Uses Device Code Flow with OIDC polling for authentication.

### 3. IAM Identity Center (IdC)

Uses `client_id` and `client_secret` for authentication.

### 4. Gemini Antigravity OAuth

Access Gemini Antigravity API through Google OAuth 2.0 authentication.

**Web interface authentication flow:**
1. Access web management interface at http://localhost:13003
2. Go to "Gemini Accounts" page
3. Click "Add Account" -> "OAuth Login"
4. Complete authorization on the Google login page that appears
5. Credentials are automatically saved after successful authorization

**OAuth configuration:**

| Configuration  | Value                                                                       |
|----------------|-----------------------------------------------------------------------------|
| Client ID      | `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com` |
| Scope          | `https://www.googleapis.com/auth/cloud-platform`                            |
| Callback Port  | `8086`                                                                      |
| Token Endpoint | `https://oauth2.googleapis.com/token`                                       |

</details>

---

## API Documentation

### External API Endpoints (Requires API Key Authentication)

Pass API key via `X-API-Key` or `Authorization: Bearer <key>` request header.

| Method | Path                              | Description                                          |
|--------|-----------------------------------|------------------------------------------------------|
| GET    | `/health`                         | Health check                                         |
| GET    | `/v1/models`                      | Get model list (OpenAI format)                       |
| POST   | `/v1/messages`                    | Claude API compatible interface (supports streaming) |
| POST   | `/v1/chat/completions`            | OpenAI API compatible interface (supports streaming) |
| POST   | `/gemini-antigravity/v1/messages` | Gemini Antigravity API (Claude format)               |

**Model-Provider Routing:** Specify provider via `Model-Provider` request header:
- `gemini` or `gemini-antigravity`: Route to Gemini Antigravity
- Default: Use Kiro/Claude Provider

### API Call Examples

**OpenAI Compatible Interface:**

```bash
curl -X POST 'http://localhost:13003/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

**Claude Compatible Interface:**

```bash
curl -X POST 'http://localhost:13003/v1/messages' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Gemini Antigravity Interface:**

```bash
curl -X POST 'http://localhost:13003/gemini-antigravity/v1/messages' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "model": "gemini-3-pro-preview",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

<details>
<summary>Click to expand complete API endpoint list</summary>

### Authentication API

| Method | Path               | Description                          |
|--------|--------------------|--------------------------------------|
| GET    | `/api/auth/status` | Check if system needs initialization |
| POST   | `/api/auth/setup`  | Initialize admin account             |
| POST   | `/api/auth/login`  | User login                           |
| POST   | `/api/auth/logout` | User logout                          |
| GET    | `/api/auth/me`     | Get current user info                |

### API Key Management (Requires Login)

| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| GET    | `/api/keys`                   | Get API key list               |
| POST   | `/api/keys`                   | Create API key                 |
| GET    | `/api/keys/:id`               | Get single key details         |
| DELETE | `/api/keys/:id`               | Delete API key                 |
| POST   | `/api/keys/:id/toggle`        | Enable/disable key             |
| PUT    | `/api/keys/:id/limits`        | Update key limit configuration |
| GET    | `/api/keys/:id/limits-status` | Get key usage status           |
| GET    | `/api/keys/:id/usage`         | Get key usage statistics       |
| GET    | `/api/keys/:id/cost`          | Get key cost statistics        |

### Kiro Credential Management

| Method | Path                            | Description                  |
|--------|---------------------------------|------------------------------|
| GET    | `/api/credentials`              | Get all credentials          |
| GET    | `/api/credentials/:id`          | Get single credential        |
| DELETE | `/api/credentials/:id`          | Delete credential            |
| POST   | `/api/credentials/:id/activate` | Set as active credential     |
| POST   | `/api/credentials/:id/refresh`  | Manually refresh token       |
| POST   | `/api/credentials/:id/test`     | Test credential validity     |
| GET    | `/api/credentials/:id/models`   | Get available models         |
| GET    | `/api/credentials/:id/usage`    | Get usage                    |
| POST   | `/api/credentials/import`       | Import credentials from file |
| POST   | `/api/credentials/batch-import` | Batch import Social accounts |

### Gemini Credential Management

| Method | Path                                   | Description                |
|--------|----------------------------------------|----------------------------|
| GET    | `/api/gemini/credentials`              | Get all Gemini credentials |
| GET    | `/api/gemini/credentials/:id`          | Get single credential      |
| POST   | `/api/gemini/credentials`              | Add credential             |
| PUT    | `/api/gemini/credentials/:id`          | Update credential          |
| DELETE | `/api/gemini/credentials/:id`          | Delete credential          |
| POST   | `/api/gemini/credentials/:id/activate` | Activate credential        |
| POST   | `/api/gemini/credentials/:id/refresh`  | Refresh token              |
| POST   | `/api/gemini/credentials/:id/test`     | Test credential            |
| GET    | `/api/gemini/credentials/:id/usage`    | Get usage                  |
| POST   | `/api/gemini/credentials/batch-import` | Batch import credentials   |
| POST   | `/api/gemini/oauth/start`              | Start Gemini OAuth login   |
| GET    | `/api/gemini/models`                   | Get Gemini model list      |

### API Log Management (Requires Admin Permission)

| Method | Path                   | Description                 |
|--------|------------------------|-----------------------------|
| GET    | `/api/logs`            | Get log list (paginated)    |
| GET    | `/api/logs/:requestId` | Get single log details      |
| DELETE | `/api/logs/:id`        | Delete single log           |
| POST   | `/api/logs/cleanup`    | Clean up old logs           |
| GET    | `/api/error-logs`      | Get error log list          |
| GET    | `/api/logs-stats`      | Get log statistics          |
| GET    | `/api/logs-stats/cost` | Get cost statistics summary |

### Proxy Configuration (Requires Login)

| Method | Path                | Description              |
|--------|---------------------|--------------------------|
| GET    | `/api/proxy/config` | Get proxy configuration  |
| POST   | `/api/proxy/config` | Save proxy configuration |
| POST   | `/api/proxy/test`   | Test proxy connection    |

### Public API (No Login Required)

| Method | Path                | Description                        |
|--------|---------------------|------------------------------------|
| GET    | `/api/models`       | Get available model list           |
| GET    | `/api/usage`        | Get active credential usage limits |
| POST   | `/api/public/usage` | Query usage via API Key            |

</details>

---

## Advanced Configuration

<details>
<summary>Click to expand proxy configuration, programming interface, and other advanced settings</summary>

### Proxy Settings

The system supports HTTP/HTTPS proxy for accessing APIs in network-restricted environments.

**Configure via Web Interface:**
1. Access web management interface at http://localhost:13003
2. Go to "Proxy Settings" page
3. Enter proxy address and enable

**Supported proxy formats:**
```
# Standard URL format
http://host:port
http://username:password@host:port

# ISP format (auto-converted)
host:port:username:password
host:port
```

**Environment variable proxy:**
```bash
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
```

### Programming Interface

```javascript
import { KiroClient, KiroAPI } from 'kiro-api-client';

// Method 1: Create client from credentials file
const client = await KiroClient.fromCredentialsFile();

// Method 2: Create client directly
const client = new KiroClient({
    accessToken: 'your-access-token',
    refreshToken: 'your-refresh-token',
    profileArn: 'your-profile-arn',
    region: 'us-east-1'
});

// Send message (streaming)
const stream = await client.chatStream([
    { role: 'user', content: 'Hello' }
]);

for await (const chunk of stream) {
    process.stdout.write(chunk);
}

// Send message (non-streaming)
const response = await client.chat([
    { role: 'user', content: 'Hello' }
]);
console.log(response);
```

### Environment Variables

| Variable         | Default     | Description        |
|------------------|-------------|--------------------|
| `PORT`           | `13003`     | API service port   |
| `MYSQL_HOST`     | `127.0.0.1` | MySQL host address |
| `MYSQL_PORT`     | `13306`     | MySQL port         |
| `MYSQL_USER`     | `root`      | MySQL username     |
| `MYSQL_PASSWORD` | -           | MySQL password     |
| `MYSQL_DATABASE` | `kiro_api`  | Database name      |
| `LOG_DIR`        | `./logs`    | Log file directory |
| `LOG_LEVEL`      | `INFO`      | Log level          |
| `LOG_ENABLED`    | `true`      | Enable logging     |
| `LOG_CONSOLE`    | `true`      | Output to console  |

### Project Structure

```
src/
├── index.js              # Main entry, exports all modules
├── client.js             # KiroClient class - API client
├── api.js                # KiroAPI class - Stateless API service
├── auth.js               # KiroAuth class - OAuth authentication
├── auth-cli.js           # Interactive CLI login tool
├── constants.js          # Constants configuration
├── db.js                 # Database connection and table management
├── logger.js             # Logging module
├── proxy.js              # Proxy configuration module
├── server.js             # Express web server
├── kiro-service.js       # Kiro service wrapper
├── gemini/
│   └── antigravity-core.js  # Gemini Antigravity API core
└── public/               # Web frontend files
```

</details>

---

## FAQ

<details>
<summary>Click to expand FAQ and solutions</summary>

### 1. What if the port is occupied?

Modify the `PORT` environment variable or set a different port in the `.env` file.

### 2. Docker startup failed?

Check if Docker is properly installed, ensure the port is not occupied, and view `docker logs` for detailed error information.

### 3. Encountered 429 error (too many requests)?

This is due to rate limiting from high request frequency. Suggestions:
- Add more accounts to the account pool
- Reduce request frequency
- Wait for a while before retrying

### 4. Token refresh failed?

- Check if network connection is normal
- Confirm if refresh_token is valid
- Check the error credentials list and try manual refresh

### 5. How to batch import accounts?

```bash
curl -X POST 'http://localhost:13003/api/credentials/batch-import' \
  -H 'Content-Type: application/json' \
  -d '{
    "accounts": [
      {"email": "user1@example.com", "refreshToken": "aorAAAAA..."},
      {"email": "user2@example.com", "refreshToken": "aorAAAAA..."}
    ],
    "region": "us-east-1"
  }'
```

</details>

---

## Important Notes

- Tokens are automatically refreshed 10 minutes before expiration
- Credentials with failed refresh are moved to the error credentials table and retried periodically
- Message history requires alternating user/assistant roles; adjacent same-role messages are automatically merged
- Default region is `us-east-1`

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=CaiGaoQing/kiro-api-client&type=date&legend=top-left)](https://www.star-history.com/#CaiGaoQing/kiro-api-client&type=date&legend=top-left)

---

## Acknowledgements

- [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) - Project inspiration

---

## License

This project is licensed under the [MIT](https://opensource.org/licenses/MIT) License.

---

## Disclaimer

This project is for learning and research purposes only. When using this project, please comply with the terms of service of relevant services and applicable laws and regulations. The developers are not responsible for any issues arising from the use of this project.
