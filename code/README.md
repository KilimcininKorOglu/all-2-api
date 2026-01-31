# ALL-2-API (Kiro API Client)

A Node.js API proxy service that converts multiple AI provider APIs (Kiro/AWS CodeWhisperer, Gemini Antigravity, Vertex AI, Orchids, Warp, Anthropic, Bedrock) to standardized OpenAI/Claude-compatible interfaces.

## Features

- Multi-provider API proxy with unified interface
- Web management console for credential management
- Account pooling with configurable selection strategies
- Background token refresh and quota monitoring
- Request/response audit logging

## Quick Start

### Docker (Recommended)

```bash
cd code
docker compose up -d
```

Access the web console at http://localhost:13003

Default credentials: `admin` / `admin123`

### Manual Installation

```bash
cd code
npm install
npm run server
```

## Supported Providers

| Provider  | Route Prefix            | Header Value |
|-----------|-------------------------|--------------|
| Kiro      | `/v1/*`                 | (default)    |
| Gemini    | `/gemini-antigravity/*` | `gemini`     |
| Orchids   | `/orchids/*`            | `orchids`    |
| Warp      | `/warp/*`               | `warp`       |
| Vertex    | `/vertex/*`             | `vertex`     |
| Bedrock   | `/bedrock/*`            | `bedrock`    |
| Anthropic | `/anthropic/*`          | `anthropic`  |

## Pool Selection Strategies

Configure via Site Settings page or `site_settings.selection_strategy` database column.

| Strategy    | Description                                                                     |
|-------------|---------------------------------------------------------------------------------|
| Hybrid      | Score-based selection considering credential health, quota availability, and    |
|             | error rates. Automatically routes requests to the healthiest credential with    |
|             | remaining quota. Best for production environments with multiple credentials.    |
| Sticky      | Session affinity mode. Requests with the same `X-Session-ID` header are routed  |
|             | to the same credential. Useful for maintaining conversation context or when     |
|             | consistent credential usage is required within a session.                       |
| Round Robin | Simple sequential rotation through all active credentials. Distributes load     |
|             | equally regardless of health or quota status. Suitable for simple load          |
|             | balancing scenarios or testing.                                                 |

## Dynamic Settings

The following settings can be configured via the Site Settings page (`/pages/site-settings.html`):

| Setting                  | Default        | Description                                      |
|--------------------------|----------------|--------------------------------------------------|
| Token Refresh Interval   | 30 minutes     | Background OAuth token refresh frequency         |
| Token Refresh Threshold  | 10 minutes     | Refresh tokens expiring within this threshold    |
| Quota Refresh Interval   | 5 minutes      | Background quota information refresh frequency   |
| Selection Strategy       | Hybrid         | Credential pool selection strategy               |
| Log Level                | INFO           | Logging verbosity (DEBUG/INFO/WARN/ERROR)        |

## Environment Variables

| Variable         | Default     | Description              |
|------------------|-------------|--------------------------|
| `PORT`           | `13003`     | API server port          |
| `MYSQL_HOST`     | `127.0.0.1` | MySQL host               |
| `MYSQL_PORT`     | `13306`     | MySQL port               |
| `MYSQL_USER`     | `root`      | MySQL user               |
| `MYSQL_PASSWORD` | -           | MySQL password           |
| `MYSQL_DATABASE` | `kiro_api`  | Database name            |

## Authentication

External API requests require authentication via:
- `X-API-Key` header, or
- `Authorization: Bearer <key>` header

API keys are managed through the web console.

## License

MIT
