# AIClient-2-API Kiro Feature Analysis

Bu dokuman, [AIClient-2-API](https://github.com/Ravens2121/AIClient-2-API) projesindeki Kiro (AWS CodeWhisperer) entegrasyonunu analiz eder.

## Genel Bakis

AIClient-2-API, Node.js tabanli bir API proxy servisidir. Kiro entegrasyonu asagidaki ozellikleri icerir:

| Ozellik                | Aciklama                                              |
|------------------------|-------------------------------------------------------|
| Provider Type          | `claude-kiro-oauth`                                   |
| Authentication Methods | Social Auth (Google/GitHub), AWS Builder ID           |
| Token Management       | Auto-refresh, credential file storage                 |
| API Endpoints          | CodeWhisperer + Amazon Q streaming                    |
| Format Output          | Claude-compatible JSON response                       |

---

## 1. Authentication Sistemi

### 1.1 Desteklenen Yontemler

**Dosya:** `src/oauth-handlers.js`

```
+------------------+----------------------+---------------------------+
| Auth Method      | Provider             | Flow Type                 |
+------------------+----------------------+---------------------------+
| google           | Kiro AuthService     | PKCE + HTTP Callback      |
| github           | Kiro AuthService     | PKCE + HTTP Callback      |
| builder-id       | AWS SSO OIDC         | Device Code Flow          |
+------------------+----------------------+---------------------------+
```

### 1.2 KIRO_OAUTH_CONFIG

```javascript
const KIRO_OAUTH_CONFIG = {
    // Kiro Auth Service endpoint (Social Auth icin)
    authServiceEndpoint: 'https://prod.us-east-1.auth.desktop.kiro.dev',

    // AWS SSO OIDC endpoint (Builder ID icin)
    ssoOIDCEndpoint: 'https://oidc.us-east-1.amazonaws.com',

    // AWS Builder ID baslangic URL
    builderIDStartURL: 'https://view.awsapps.com/start',

    // Local callback port range (Social Auth HTTP callback icin)
    callbackPortStart: 19876,
    callbackPortEnd: 19880,

    // Timeout
    authTimeout: 10 * 60 * 1000,  // 10 dakika
    pollInterval: 5000,           // 5 saniye

    // CodeWhisperer Scopes
    scopes: [
        'codewhisperer:completions',
        'codewhisperer:analysis',
        'codewhisperer:conversations',
        'codewhisperer:transformations',
        'codewhisperer:taskassist'
    ],

    // Credential storage
    credentialsDir: '.kiro',
    credentialsFile: 'oauth_creds.json',
};
```

### 1.3 Social Auth Flow (Google/GitHub)

```
1. PKCE Generation
   - codeVerifier: crypto.randomBytes(32).toString('base64url')
   - codeChallenge: SHA256(codeVerifier).toString('base64url')
   - state: crypto.randomBytes(16).toString('base64url')

2. Login URL Construction
   GET /login?idp={Google|Github}
       &redirect_uri=http://127.0.0.1:{port}/oauth/callback
       &code_challenge={challenge}
       &code_challenge_method=S256
       &state={state}
       &prompt=select_account

3. HTTP Callback Server (127.0.0.1:{19876-19880})
   - Receives code and state
   - Validates state parameter
   - Exchanges code for token

4. Token Exchange
   POST /oauth/token
   Body: { code, code_verifier, redirect_uri }
   Response: { accessToken, refreshToken, profileArn, expiresIn }
```

### 1.4 Builder ID Device Code Flow

```
1. Client Registration
   POST https://oidc.us-east-1.amazonaws.com/client/register
   Body: {
       clientName: 'Kiro IDE',
       clientType: 'public',
       scopes: [...],
       grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']
   }
   Response: { clientId, clientSecret }

2. Device Authorization
   POST /device_authorization
   Body: { clientId, clientSecret, startUrl: 'https://view.awsapps.com/start' }
   Response: { deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn }

3. Token Polling
   POST /token
   Body: {
       clientId, clientSecret, deviceCode,
       grantType: 'urn:ietf:params:oauth:grant-type:device_code'
   }
   Response (pending): { error: 'authorization_pending' }
   Response (success): { accessToken, refreshToken, expiresIn }
```

---

## 2. API Service (KiroApiService)

### 2.1 Sinif Yapisi

**Dosya:** `src/claude/claude-kiro.js`

```javascript
class KiroApiService {
    constructor(config = {}) {
        this.credPath = config.KIRO_OAUTH_CREDS_DIR_PATH || '~/.aws/sso/cache';
        this.credsBase64 = config.KIRO_OAUTH_CREDS_BASE64;
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_KIRO ?? false;
        this.uuid = config?.uuid;
    }
}
```

### 2.2 KIRO_CONSTANTS

```javascript
const KIRO_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    BASE_URL: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
    AMAZON_Q_URL: 'https://codewhisperer.{{region}}.amazonaws.com/SendMessageStreaming',
    USAGE_LIMITS_URL: 'https://q.{{region}}.amazonaws.com/getUsageLimits',
    DEFAULT_MODEL_NAME: 'claude-opus-4-5',
    AXIOS_TIMEOUT: 300000, // 5 dakika
    USER_AGENT: 'KiroIDE',
    KIRO_VERSION: '0.7.5',
    CONTENT_TYPE_JSON: 'application/json',
    ACCEPT_JSON: 'application/json',
    AUTH_METHOD_SOCIAL: 'social',
    CHAT_TRIGGER_TYPE_MANUAL: 'MANUAL',
    ORIGIN_AI_EDITOR: 'AI_EDITOR',
};
```

### 2.3 Desteklenen Modeller

```javascript
const PROVIDER_MODELS['claude-kiro-oauth'] = [
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
    'claude-haiku-4-5',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219'
];

const MODEL_MAPPING = {
    "claude-opus-4-5": "claude-opus-4.5",
    "claude-opus-4-5-20251101": "claude-opus-4.5",
    "claude-haiku-4-5": "claude-haiku-4.5",
    "claude-sonnet-4-5": "CLAUDE_SONNET_4_5_20250929_V1_0",
    "claude-sonnet-4-5-20250929": "CLAUDE_SONNET_4_5_20250929_V1_0",
    "claude-sonnet-4-20250514": "CLAUDE_SONNET_4_20250514_V1_0",
    "claude-3-7-sonnet-20250219": "CLAUDE_3_7_SONNET_20250219_V1_0"
};
```

---

## 3. Credential Yonetimi

### 3.1 Credential Loading Priority

```
1. Base64 encoded credentials (KIRO_OAUTH_CREDS_BASE64)
2. Specified file path (KIRO_OAUTH_CREDS_FILE_PATH)
3. Default directory (~/.aws/sso/cache/kiro-auth-token.json)
4. Other JSON files in cache directory (client credentials)
```

### 3.2 Credential File Format

**Social Auth:**
```json
{
    "accessToken": "...",
    "refreshToken": "...",
    "profileArn": "arn:aws:codewhisperer:...",
    "expiresAt": "2025-01-31T20:00:00.000Z",
    "authMethod": "social",
    "region": "us-east-1"
}
```

**Builder ID:**
```json
{
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": "2025-01-31T20:00:00.000Z",
    "authMethod": "builder-id",
    "clientId": "...",
    "clientSecret": "...",
    "region": "us-east-1"
}
```

### 3.3 Token Refresh

```javascript
async initializeAuth(forceRefresh = false) {
    // Social Auth refresh
    if (this.authMethod === 'social') {
        const response = await axios.post(
            'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken',
            { refreshToken: this.refreshToken }
        );
    }

    // Builder ID refresh
    else {
        const response = await axios.post(
            'https://oidc.us-east-1.amazonaws.com/token',
            {
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                refreshToken: this.refreshToken,
                grantType: 'refresh_token'
            }
        );
    }
}
```

---

## 4. API Request/Response

### 4.1 CodeWhisperer Request Format

```javascript
{
    conversationState: {
        chatTriggerType: 'MANUAL',
        conversationId: '<uuid>',
        history: [
            {
                userInputMessage: {
                    content: 'Hello',
                    modelId: 'claude-opus-4.5',
                    origin: 'AI_EDITOR',
                    images: [...],
                    userInputMessageContext: {
                        toolResults: [...],
                        tools: [...]
                    }
                }
            },
            {
                assistantResponseMessage: {
                    content: 'Hi there!',
                    toolUses: [...]
                }
            }
        ],
        currentMessage: {
            userInputMessage: {
                content: 'Current question',
                modelId: 'claude-opus-4.5',
                origin: 'AI_EDITOR'
            }
        }
    },
    profileArn: 'arn:aws:codewhisperer:...'  // Only for social auth
}
```

### 4.2 Request Headers

```javascript
headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'amz-sdk-request': 'attempt=1; max=1',
    'amz-sdk-invocation-id': '<uuid>',
    'x-amzn-kiro-agent-mode': 'vibe',
    'x-amz-user-agent': `aws-sdk-js/1.0.0 KiroIDE-${version}-${machineId}`,
    'user-agent': `aws-sdk-js/1.0.0 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererruntime#1.0.0 m/E KiroIDE-${version}-${machineId}`,
    'Connection': 'close'
}
```

### 4.3 Machine ID Generation

```javascript
function generateMachineIdFromConfig(credentials) {
    // Priority: uuid > profileArn > clientId > fallback
    const uniqueKey = credentials.uuid ||
                      credentials.profileArn ||
                      credentials.clientId ||
                      "KIRO_DEFAULT_MACHINE";
    return crypto.createHash('sha256').update(uniqueKey).digest('hex');
}
```

---

## 5. Response Parsing

### 5.1 Event Stream Format

Kiro API, AWS Event Stream formatinda response dondurur:

```
:message-typeevent{"content":"Hello"}
:event-type...
:message-typeevent{"content":" world"}
:message-typeevent{"name":"tool_name","toolUseId":"...","input":"..."}
:message-typeevent{"input":"continued..."}
:message-typeevent{"stop":true}
```

### 5.2 parseAwsEventStreamBuffer

```javascript
parseAwsEventStreamBuffer(buffer) {
    const events = [];

    // Search for JSON payload patterns:
    // {"content":"..."} - text content
    // {"name":"xxx","toolUseId":"xxx"} - tool use start
    // {"input":"..."} - tool input continuation
    // {"stop":true} - tool use end
    // {"followupPrompt":"..."} - followup (ignored)

    // Parse using bracket counting for nested JSON
    // Return { events, remaining }
}
```

### 5.3 Tool Call Parsing

**Structured Tool Calls:**
```json
{"name":"tool_name","toolUseId":"tool_123","input":"{\"param\":\"value\"}"}
{"input":"continuation..."}
{"stop":true}
```

**Bracket Format Tool Calls:**
```
[Called function_name with args: {"param": "value"}]
```

```javascript
function parseBracketToolCalls(responseText) {
    // Pattern: [Called {name} with args: {json}]
    const namePattern = /\[Called\s+(\w+)\s+with\s+args:/i;
    // Extract and parse JSON arguments
}
```

---

## 6. Claude Response Format

### 6.1 Non-Streaming Response

```javascript
{
    id: '<uuid>',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-5',
    stop_reason: 'end_turn',  // or 'tool_use'
    stop_sequence: null,
    usage: {
        input_tokens: 100,
        output_tokens: 50
    },
    content: [
        { type: 'text', text: 'Response text' },
        { type: 'tool_use', id: 'tool_123', name: 'func', input: {...} }
    ]
}
```

### 6.2 Streaming Response Events

```javascript
// 1. message_start
{ type: 'message_start', message: { id, type, role, model, usage, content: [] } }

// 2. content_block_start (text)
{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }

// 3. content_block_delta (text)
{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'chunk' } }

// 4. content_block_stop
{ type: 'content_block_stop', index: 0 }

// 5. content_block_start (tool_use)
{ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name, input: {} } }

// 6. content_block_delta (tool_use)
{ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '...' } }

// 7. content_block_stop
{ type: 'content_block_stop', index: 1 }

// 8. message_delta
{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } }

// 9. message_stop
{ type: 'message_stop' }
```

---

## 7. Error Handling ve Retry

### 7.1 Automatic Retry

```javascript
async callApi(method, model, body, isRetry = false, retryCount = 0) {
    const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
    const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

    try {
        const response = await this.axiosInstance.post(url, data, { headers });
        return response;
    } catch (error) {
        // 403: Token refresh and retry
        if (error.response?.status === 403 && !isRetry) {
            await this.initializeAuth(true);
            return this.callApi(method, model, body, true, retryCount);
        }

        // 429: Exponential backoff
        if (error.response?.status === 429 && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.callApi(method, model, body, isRetry, retryCount + 1);
        }

        // 5xx: Server error retry
        if (error.response?.status >= 500 && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.callApi(method, model, body, isRetry, retryCount + 1);
        }

        throw error;
    }
}
```

### 7.2 Token Expiry Check

```javascript
isExpiryDateNear() {
    const expirationTime = new Date(this.expiresAt);
    const currentTime = new Date();
    const cronNearMinutes = this.config.CRON_NEAR_MINUTES || 10;
    const thresholdTime = new Date(currentTime.getTime() + cronNearMinutes * 60 * 1000);
    return expirationTime.getTime() <= thresholdTime.getTime();
}
```

---

## 8. Token Counting

### 8.1 Anthropic Tokenizer

```javascript
import { countTokens } from '@anthropic-ai/tokenizer';

countTextTokens(text) {
    if (!text) return 0;
    try {
        return countTokens(text);
    } catch (error) {
        // Fallback: 4 karakter = 1 token
        return Math.ceil((text || '').length / 4);
    }
}
```

### 8.2 Input Token Estimation

```javascript
estimateInputTokens(requestBody) {
    let totalTokens = 0;

    // System prompt
    if (requestBody.system) {
        totalTokens += this.countTextTokens(requestBody.system);
    }

    // Messages
    for (const message of requestBody.messages) {
        totalTokens += this.countTextTokens(message.content);
    }

    // Tools
    if (requestBody.tools) {
        totalTokens += this.countTextTokens(JSON.stringify(requestBody.tools));
    }

    return totalTokens;
}
```

---

## 9. Usage Limits API

### 9.1 getUsageLimits()

```javascript
async getUsageLimits() {
    const usageLimitsUrl = 'https://q.us-east-1.amazonaws.com/getUsageLimits';
    const params = new URLSearchParams({
        isEmailRequired: 'true',
        origin: 'AI_EDITOR',
        resourceType: 'AGENTIC_REQUEST',
        profileArn: this.profileArn  // Only for social auth
    });

    const response = await this.axiosInstance.get(`${usageLimitsUrl}?${params}`, { headers });
    return response.data;
}
```

---

## 10. Message Processing

### 10.1 Adjacent Message Merging

Kiro API ayni role'e sahip ardisik mesajlari kabul etmez. Bu nedenle merge edilir:

```javascript
// Ardisik ayni role mesajlarini birlestir
const mergedMessages = [];
for (const msg of processedMessages) {
    if (mergedMessages.length === 0) {
        mergedMessages.push(msg);
    } else {
        const lastMsg = mergedMessages[mergedMessages.length - 1];
        if (msg.role === lastMsg.role) {
            // Merge content
            if (Array.isArray(lastMsg.content) && Array.isArray(msg.content)) {
                lastMsg.content.push(...msg.content);
            } else {
                lastMsg.content += '\n' + msg.content;
            }
        } else {
            mergedMessages.push(msg);
        }
    }
}
```

### 10.2 Tool Result Deduplication

```javascript
// Kiro API ayni toolUseId'ye sahip birden fazla tool result kabul etmez
const uniqueToolResults = [];
const seenIds = new Set();
for (const tr of toolResults) {
    if (!seenIds.has(tr.toolUseId)) {
        seenIds.add(tr.toolUseId);
        uniqueToolResults.push(tr);
    }
}
```

---

## 11. Image Support

```javascript
// Claude format -> Kiro format
{
    type: 'image',
    source: {
        media_type: 'image/png',
        data: '<base64>'
    }
}
// Kiro format
{
    format: 'png',
    source: {
        bytes: '<base64>'
    }
}
```

---

## 12. Command Line Options

```bash
--model-provider claude-kiro-oauth
--kiro-oauth-creds-base64 <base64>
--kiro-oauth-creds-file <path>
```

---

## 13. Karsilastirma: AIClient-2-API vs Mevcut Sistem

| Ozellik                    | AIClient-2-API (Node.js)         | Mevcut Sistem (Node.js)   |
|----------------------------|----------------------------------|---------------------------|
| Auth Methods               | Social + Builder ID              | Social + Builder ID + IdC |
| HTTP Callback              | localhost:19876-19880            | -                         |
| Streaming                  | Real streaming                   | Pseudo streaming          |
| Token Counting             | @anthropic-ai/tokenizer          | Manual estimation         |
| Tool Call Parsing          | Structured + Bracket format      | -                         |
| Message Merging            | Automatic                        | -                         |
| Machine ID                 | SHA256 hash of identifiers       | -                         |
| Usage Limits API           | Supported                        | Supported                 |
| Amazon Q URL Support       | Model prefix ile                 | -                         |

---

## 14. Onemli Farklar

### 14.1 HTTP Callback vs Protocol Handler

AIClient-2-API, Social Auth icin `kiro://` protocol handler yerine HTTP localhost callback kullanir:

```
CLIProxyAPIPlus: kiro://kiro.kiroAgent/authenticate-success
AIClient-2-API:  http://127.0.0.1:19876/oauth/callback
```

Bu yaklasim:
- Cross-platform uyumluluk (protocol handler kurulumu gerekmez)
- Daha basit implementation
- Ancak browser'in localhost'a erisim izni olmali

### 14.2 Real Streaming

AIClient-2-API gercek streaming destekler (responseType: 'stream'):

```javascript
async * streamApiReal(method, model, body) {
    const response = await axios.post(url, data, { responseType: 'stream' });

    for await (const chunk of response.data) {
        const { events, remaining } = this.parseAwsEventStreamBuffer(buffer + chunk);
        for (const event of events) {
            yield event;
        }
    }
}
```

### 14.3 Anthropic Tokenizer

Resmi `@anthropic-ai/tokenizer` paketi kullanilir:

```javascript
import { countTokens } from '@anthropic-ai/tokenizer';

// Daha dogru token sayimi
const tokens = countTokens("Hello, world!");
```

---

## 15. Dosya Yapisi

```
src/
├── claude/
│   ├── claude-kiro.js      # KiroApiService - main implementation
│   ├── claude-core.js      # Claude API core
│   └── claude-strategy.js  # Claude provider strategy
├── oauth-handlers.js       # OAuth flow implementations
├── provider-models.js      # Model definitions
├── provider-strategy.js    # Base strategy class
├── provider-pool-manager.js # Account pool management
└── api-server.js           # Express server
```

---

## 16. Sonuc

AIClient-2-API projesi, Kiro entegrasyonu icin kapsamli bir implementasyon sunuyor:

1. **Coklu Authentication:** Social Auth (Google/GitHub) ve Builder ID destegi
2. **HTTP Callback:** Protocol handler yerine localhost callback kullanimi
3. **Real Streaming:** Gercek streaming response destegi
4. **Token Counting:** Resmi Anthropic tokenizer kullanimi
5. **Tool Calling:** Hem structured hem bracket format destegi
6. **Message Processing:** Otomatik merge ve deduplication
7. **Error Handling:** Exponential backoff ile retry mekanizmasi

Bu ozellikler, mevcut Node.js tabanli sistemimize entegre edilebilir veya referans olarak kullanilabilir.
