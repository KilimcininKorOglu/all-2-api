# Kiro Account Manager Feature Analysis

Bu dokuman, [Kiro-account-manager](https://github.com/chaogei/Kiro-account-manager) projesindeki Kiro (AWS CodeWhisperer) entegrasyonunu analiz eder.

## Genel Bakis

Kiro Account Manager, Electron + React tabanli bir masaustu uygulamasidir. Kiro hesap yonetimi, API proxy servisi ve Machine ID yonetimi sunar.

| Ozellik                | Aciklama                                          |
|------------------------|---------------------------------------------------|
| Platform               | Electron + React + TypeScript                     |
| Authentication Methods | Social Auth (Google/GitHub), AWS Builder ID (IDC) |
| API Proxy              | OpenAI + Claude uyumlu endpoint'ler               |
| Account Pool           | Multi-account rotation, cooldown, error tracking  |
| K-Proxy (MITM)         | Machine ID replacement via HTTPS interception     |
| Format Translation     | OpenAI/Claude -> Kiro, Kiro -> OpenAI/Claude      |

---

## 1. API Endpoints

### 1.1 Kiro API Endpoints

```typescript
const KIRO_ENDPOINTS = [
  {
    url: 'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'AI_EDITOR',
    amzTarget: 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
    name: 'CodeWhisperer'
  },
  {
    url: 'https://q.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'CLI',
    amzTarget: 'AmazonQDeveloperStreamingService.SendMessage',
    name: 'AmazonQ'
  }
]
```

### 1.2 Management API Endpoints

| Endpoint                                      | Purpose            |
|-----------------------------------------------|--------------------|
| `codewhisperer.../ListAvailableModels`        | Model listesi      |
| `codewhisperer.../listAvailableSubscriptions` | Abonelik planlari  |
| `codewhisperer.../CreateSubscriptionToken`    | Stripe odeme linki |
| `q.../getUsageLimits`                         | Kullanim limitleri |

---

## 2. Authentication

### 2.1 Auth Methods

```typescript
interface ProxyAccount {
  authMethod?: 'social' | 'idc'  // Social Auth veya IAM Identity Center
  // Social Auth icin
  accessToken: string
  refreshToken?: string
  profileArn?: string
  // IDC icin
  clientId?: string
  clientSecret?: string
}
```

### 2.2 User-Agent Patterns

**Social Auth (Kiro IDE tarzinda):**
```typescript
// User-Agent
'aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.6.18-{machineId}'

// X-Amz-User-Agent
'aws-sdk-js/1.0.18 KiroIDE 0.6.18 {machineId}'
```

**IDC Auth (Amazon Q CLI tarzinda):**
```typescript
// User-Agent
'aws-sdk-rust/1.3.9 os/macos lang/rust/1.87.0'

// X-Amz-User-Agent
'aws-sdk-rust/1.3.9 ua/2.1 api/ssooidc/1.88.0 os/macos lang/rust/1.87.0 m/E app/AmazonQ-For-CLI'
```

### 2.3 Agent Mode

```typescript
const AGENT_MODE_SPEC = 'spec'  // IDE mode (Social Auth)
const AGENT_MODE_VIBE = 'vibe'  // CLI mode (IDC Auth)

// Header: x-amzn-kiro-agent-mode
```

---

## 3. Model Mapping

```typescript
const MODEL_ID_MAP = {
  // Claude 4.5 Serisi
  'claude-sonnet-4-5': 'claude-sonnet-4.5',
  'claude-haiku-4-5': 'claude-haiku-4.5',
  'claude-opus-4-5': 'claude-opus-4.5',

  // Claude 4 Serisi
  'claude-sonnet-4': 'claude-sonnet-4',

  // Claude 3.5 -> 4.5 mapping
  'claude-3-5-sonnet': 'claude-sonnet-4.5',
  'claude-3-opus': 'claude-sonnet-4.5',

  // GPT uyumluluk
  'gpt-4': 'claude-sonnet-4.5',
  'gpt-4o': 'claude-sonnet-4.5',

  'default': 'claude-sonnet-4.5'
}
```

---

## 4. Account Pool Management

### 4.1 Pool Configuration

```typescript
interface AccountPoolConfig {
  cooldownMs: number      // Error sonrasi bekleme (default: 60000ms)
  maxErrorCount: number   // Maksimum ardisik hata (default: 3)
  quotaResetMs: number    // Quota reset suresi (default: 3600000ms)
}
```

### 4.2 Account State

```typescript
interface ProxyAccount {
  // Runtime state
  lastUsed?: number
  requestCount?: number
  errorCount?: number
  isAvailable?: boolean
  cooldownUntil?: number
  machineId?: string      // Bound device ID (64-char hex)
}
```

### 4.3 Selection Algorithm

```typescript
// Round-robin ile sonraki musait hesap secimi
getNextAccount(): ProxyAccount | null {
  // 1. Tum hesaplari tara
  // 2. isAccountAvailable() kontrol et:
  //    - cooldownUntil > now? -> skip
  //    - errorCount >= maxErrorCount? -> skip
  //    - expiresAt < now? -> skip
  // 3. Musait hesap yoksa cooldown en kisa olani sec
}
```

### 4.4 Error Handling

```typescript
recordError(accountId: string, isQuotaError: boolean) {
  if (isQuotaError) {
    // 429: 1 saat cooldown
    cooldownUntil = now + quotaResetMs
  } else if (errorCount >= maxErrorCount) {
    // 3+ hata: 1 dakika cooldown
    cooldownUntil = now + cooldownMs
  }
}
```

---

## 5. Request/Response Format

### 5.1 Kiro Payload Structure

```typescript
interface KiroPayload {
  conversationState: {
    chatTriggerType: 'MANUAL'
    conversationId: string
    currentMessage: {
      userInputMessage: {
        content: string
        modelId: string
        origin: 'AI_EDITOR' | 'CLI'
        images?: KiroImage[]
        userInputMessageContext?: {
          tools?: KiroToolWrapper[]
          toolResults?: KiroToolResult[]
        }
      }
    }
    history?: KiroHistoryMessage[]
  }
  profileArn?: string  // Social Auth icin
  inferenceConfig?: {
    maxTokens?: number
    temperature?: number
    topP?: number
  }
}
```

### 5.2 Request Headers

```typescript
headers = {
  'Content-Type': 'application/json',
  'Accept': '*/*',
  'X-Amz-Target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
  'User-Agent': getKiroUserAgent(machineId),
  'X-Amz-User-Agent': getKiroAmzUserAgent(machineId),
  'x-amzn-kiro-agent-mode': isIDC ? 'vibe' : 'spec',
  'x-amzn-codewhisperer-optout': 'true',
  'Amz-Sdk-Request': 'attempt=1; max=3',
  'Amz-Sdk-Invocation-Id': uuidv4(),
  'Authorization': `Bearer ${accessToken}`
}
```

---

## 6. Message Sanitization

Kiro API katı mesaj kuralları gerektirir. Bu fonksiyonlar mesajları temizler:

### 6.1 Kurallar

1. **User ile basla**: `ensureStartsWithUserMessage()`
2. **User ile bitir**: `ensureEndsWithUserMessage()`
3. **Alternatif**: `ensureAlternatingMessages()` - user/assistant değişmeli
4. **Tool Results**: `ensureValidToolUsesAndResults()` - her tool_use'un result'u olmali

### 6.2 Placeholder Messages

```typescript
const HELLO_MESSAGE = { userInputMessage: { content: 'Hello', origin: 'AI_EDITOR' } }
const CONTINUE_MESSAGE = { userInputMessage: { content: 'Continue', origin: 'AI_EDITOR' } }
const UNDERSTOOD_MESSAGE = { assistantResponseMessage: { content: 'understood' } }
```

### 6.3 Sanitization Pipeline

```typescript
function sanitizeConversation(messages) {
  let sanitized = [...messages]
  sanitized = ensureStartsWithUserMessage(sanitized)
  sanitized = removeEmptyUserMessages(sanitized)
  sanitized = ensureValidToolUsesAndResults(sanitized)
  sanitized = ensureAlternatingMessages(sanitized)
  sanitized = ensureEndsWithUserMessage(sanitized)
  return sanitized
}
```

---

## 7. Event Stream Parsing

### 7.1 AWS Event Stream Binary Format

```
+----------------+----------------+----------------+
| Total Length   | Headers Length | Prelude CRC    |
| (4 bytes)      | (4 bytes)      | (4 bytes)      |
+----------------+----------------+----------------+
| Headers (variable)                               |
+--------------------------------------------------+
| Payload (variable)                               |
+--------------------------------------------------+
| Message CRC (4 bytes)                            |
+--------------------------------------------------+
```

### 7.2 Event Types

| Event Type                   | Purpose                      |
|------------------------------|------------------------------|
| `assistantResponseEvent`     | Text content                 |
| `toolUseEvent`               | Tool call (start/input/stop) |
| `messageMetadataEvent`       | Token usage info             |
| `meteringEvent`              | Credit usage                 |
| `reasoningContentEvent`      | Thinking mode content        |
| `supplementaryWebLinksEvent` | Web references               |
| `codeReferenceEvent`         | Code/license references      |
| `followupPromptEvent`        | Suggested follow-ups         |
| `contextUsageEvent`          | Context window usage %       |
| `invalidStateEvent`          | Error/warning                |
| `citationEvent`              | Citations                    |

### 7.3 Tool Use Accumulation

```typescript
interface ToolUseState {
  toolUseId: string
  name: string
  inputBuffer: string  // JSON fragments biriktiriliyor
}

// toolUseEvent akisi:
// 1. {toolUseId, name} -> yeni tool use baslat
// 2. {input: "..."} -> inputBuffer'a ekle
// 3. {stop: true} -> JSON parse et ve emit et
```

---

## 8. Format Translation

### 8.1 OpenAI -> Kiro

```typescript
function openaiToKiro(request: OpenAIChatRequest): KiroPayload {
  // 1. System prompt cikar ve timestamp ekle
  // 2. Execution discipline prompt ekle
  // 3. Messages'i Kiro history formatina cevir
  // 4. Tool definitions'i Kiro format'a cevir
  // 5. Image URL'leri base64'e cevir
}
```

### 8.2 Claude -> Kiro

```typescript
function claudeToKiro(request: ClaudeRequest): KiroPayload {
  // 1. System prompt cikar
  // 2. Content blocks'tan text/image/tool_result ayir
  // 3. Tool_use blocks'tan toolUses olustur
  // 4. Strict alternating message order sagla
}
```

### 8.3 Kiro -> OpenAI

```typescript
function kiroToOpenaiResponse(content, toolUses, usage, model): OpenAIChatResponse {
  return {
    id: `chatcmpl-${uuid}`,
    object: 'chat.completion',
    choices: [{
      message: {
        role: 'assistant',
        content: toolUses.length > 0 ? null : content,
        tool_calls: toolUses.map(tu => ({
          id: tu.toolUseId,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input) }
        }))
      },
      finish_reason: toolUses.length > 0 ? 'tool_calls' : 'stop'
    }],
    usage: { prompt_tokens, completion_tokens, total_tokens }
  }
}
```

### 8.4 Kiro -> Claude

```typescript
function kiroToClaudeResponse(content, toolUses, usage, model): ClaudeResponse {
  const contentBlocks = []
  if (content) contentBlocks.push({ type: 'text', text: content })
  for (const tu of toolUses) {
    contentBlocks.push({ type: 'tool_use', id: tu.toolUseId, name: tu.name, input: tu.input })
  }
  return {
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    stop_reason: toolUses.length > 0 ? 'tool_use' : 'end_turn',
    usage: { input_tokens, output_tokens }
  }
}
```

---

## 9. K-Proxy (MITM Proxy)

### 9.1 Overview

K-Proxy, HTTPS trafiğini intercept ederek Machine ID değiştirme sağlar.

```typescript
interface KProxyConfig {
  port: number           // Proxy port
  host: string           // Listen address
  mitmDomains: string[]  // MITM yapilacak domainler
  deviceId: string       // Hedef Machine ID (64-char hex)
  logRequests: boolean
}
```

### 9.2 MITM Flow

```
1. Client -> CONNECT request -> K-Proxy
2. K-Proxy -> shouldMitm(hostname)?
   - Yes: Generate certificate, decrypt, modify, re-encrypt
   - No: Direct tunnel (passthrough)
3. Modified request -> Target server
4. Response -> Client
```

### 9.3 Machine ID Replacement

```typescript
// User-Agent pattern
const KIRO_UA_REGEX = /KiroIDE[-\s][\d.]+[-\s]([a-f0-9]{64})/i

function modifyHeaders(headers, hostname) {
  // user-agent ve x-amz-user-agent header'larindaki
  // 64-char hex Machine ID'yi hedef deviceId ile degistir
  const newLine = line.replace(/[a-f0-9]{64}/gi, targetDeviceId)
}
```

### 9.4 Certificate Generation

```typescript
class CertManager {
  // Root CA olustur (self-signed)
  // Her host icin dinamik certificate uret
  generateCertForHost(hostname: string): { cert, key }
}
```

---

## 10. Special Features

### 10.1 Agentic Mode Detection

```typescript
function isAgenticRequest(model: string, tools?: unknown[]): boolean {
  const lower = model.toLowerCase()
  return lower.includes('-agentic') ||
         lower.includes('agentic') ||
         Boolean(tools && tools.length > 0)
}

// Agentic system prompt:
// - Max 350 lines per write operation
// - Chunked write strategy
// - Surgical edits only
```

### 10.2 Thinking Mode Support

```typescript
function isThinkingEnabled(headers?: Record<string, string>): boolean {
  const betaHeader = headers['anthropic-beta'] || ''
  return betaHeader.toLowerCase().includes('thinking')
}

// Thinking mode prompt:
// <thinking_mode>enabled</thinking_mode>
// <max_thinking_length>200000</max_thinking_length>
```

### 10.3 Execution Discipline Prompt

```xml
<execution_discipline>
1. **Goal Lock**: Maintain original goal throughout session
2. **Action Priority**: Execute tasks, don't just analyze
3. **Plan Execution**: Create steps and mark completion
4. **No Confirmation Questions**: Don't ask "Should I continue?"
5. **Continuous Progress**: Continue with remaining tasks
6. **Complete Delivery**: Only finish when all steps done
</execution_discipline>
```

### 10.4 Token Estimation

```typescript
// API token bilgisi dondurmediyse:
// ~3 karakter = 1 token (mixed language estimate)
if (usage.outputTokens === 0 && totalOutputChars > 0) {
  usage.outputTokens = Math.round(totalOutputChars / 3)
}
```

---

## 11. API Proxy Service

### 11.1 Endpoints

| Path                   | Format | Description      |
|------------------------|--------|------------------|
| `/v1/chat/completions` | OpenAI | Chat completions |
| `/v1/messages`         | Claude | Messages API     |
| `/admin/stats`         | JSON   | Usage statistics |
| `/admin/accounts`      | JSON   | Account list     |
| `/admin/logs`          | JSON   | Request logs     |

### 11.2 Configuration

```typescript
interface ProxyConfig {
  enabled: boolean
  port: number                    // Default: 5580
  host: string                    // Default: 127.0.0.1
  apiKeys?: ApiKey[]              // Multi API key support
  enableMultiAccount: boolean
  selectedAccountIds: string[]
  maxRetries?: number             // Default: 3
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
  autoSwitchOnQuotaExhausted?: boolean
  modelThinkingMode?: Record<string, boolean>
  thinkingOutputFormat?: 'reasoning_content' | 'thinking' | 'think'
}
```

---

## 12. Subscription Management

### 12.1 Plan Types

```typescript
interface SubscriptionPlan {
  name: string  // KIRO_FREE, KIRO_PRO, KIRO_PRO_PLUS, KIRO_POWER
  qSubscriptionType: string
  pricing: { amount: number; currency: string }
}
```

### 12.2 Subscription Token

```typescript
async function fetchSubscriptionToken(account, subscriptionType?) {
  // Stripe odeme linki almak icin
  const payload = {
    provider: 'STRIPE',
    clientToken: uuidv4(),
    subscriptionType  // Upgrade icin
  }
  // Response: { encodedVerificationUrl, token }
}
```

---

## 13. Karsilastirma Tablosu

| Ozellik                 | Kiro Account Manager       | Mevcut Sistem  |
|-------------------------|----------------------------|----------------|
| Platform                | Electron Desktop App       | Node.js Server |
| Multi-Account           | Account Pool + Rotation    | DB-based       |
| Machine ID              | K-Proxy MITM replacement   | -              |
| Message Sanitization    | Full sanitization pipeline | Partial        |
| Thinking Mode           | anthropic-beta header      | -              |
| Execution Discipline    | Auto-injected prompt       | -              |
| Event Stream Parsing    | Full binary parsing        | JSON-based     |
| Tool Input Accumulation | Fragment accumulation      | Single event   |
| Subscription Management | Stripe integration         | -              |
| IDE Integration         | Kiro settings sync         | -              |

---

## 14. Dosya Yapisi

```
src/
├── main/
│   ├── proxy/
│   │   ├── kiroApi.ts       # Kiro API calls, event stream parsing
│   │   ├── accountPool.ts   # Multi-account rotation
│   │   ├── translator.ts    # OpenAI/Claude <-> Kiro conversion
│   │   ├── proxyServer.ts   # HTTP proxy server
│   │   ├── types.ts         # Type definitions
│   │   └── logger.ts        # Request logging
│   ├── kproxy/
│   │   ├── mitmProxy.ts     # HTTPS MITM proxy
│   │   ├── certManager.ts   # Certificate generation
│   │   └── types.ts         # K-Proxy types
│   ├── machineId.ts         # Machine ID management
│   └── index.ts             # Electron main process
├── renderer/
│   └── src/
│       ├── services/
│       │   └── kiro-api.ts  # Frontend API service
│       ├── store/
│       │   └── accounts.ts  # Account state management
│       └── components/
│           ├── accounts/    # Account management UI
│           ├── kiro/        # Kiro settings UI
│           └── proxy/       # API proxy UI
```

---

## 15. Sonuc

Kiro Account Manager, kapsamli bir hesap yonetimi ve API proxy cozumu sunuyor:

1. **Account Pool**: Multi-account rotation, cooldown, error tracking
2. **K-Proxy**: MITM ile Machine ID degistirme
3. **Message Sanitization**: Kiro API kurallarina uyum
4. **Format Translation**: OpenAI/Claude bi-directional conversion
5. **Event Stream**: Full binary AWS Event Stream parsing
6. **Thinking Mode**: Extended thinking support
7. **Execution Discipline**: Auto-injected prompts for better task completion
8. **Subscription**: Stripe payment integration

Bu ozellikler, mevcut Node.js tabanli sistemimize entegre edilebilir veya referans olarak kullanilabilir. Ozellikle:
- Message sanitization pipeline
- K-Proxy Machine ID replacement
- Event stream binary parsing
- Account pool rotation logic
