# Vibe-Open-Auth Kiro Analizi

Bu belge, `vibe-open-auth` projesindeki Kiro (AWS CodeWhisperer) ozelliklerinin kapsamli analizini icermektedir.

## Genel Bakis

| Ozellik                  | Aciklama                                                                |
|--------------------------|-------------------------------------------------------------------------|
| **Proje Adi**            | vibe-open-auth                                                          |
| **Versiyon**             | 1.0.19                                                                  |
| **Lisans**               | MIT                                                                     |
| **Dil**                  | TypeScript                                                              |
| **Platform**             | Node.js >= 20.0.0                                                       |
| **Modul Sistemi**        | ES Modules                                                              |
| **Repository**           | https://github.com/frankekn/vibe-open-auth                              |
| **Ana Fonksiyon**        | OpenCode eklentisi - Google Antigravity ve Kiro (AWS) API'lerine erisim |
| **Desteklenen Modeller** | Claude Opus 4.5, Claude Sonnet 4.5, Claude 3.7 Sonnet, Claude Haiku     |

---

## Dosya Yapisi

```
src/kiro/
├── index.ts              # Modul ihracati
├── auth.ts               # Token yenileme ve kimlik dogrulama
├── eventstream.ts        # AWS Event Stream parser
├── handler.ts            # Google API -> Kiro donusumu
├── plugin.ts             # OpenCode eklenti entegrasyonu
├── request.ts            # CodeWhisperer istek olusturucu
├── response.ts           # Yanit donusturme (Kiro -> Anthropic)
├── storage.ts            # Hesap depolama yonetimi
├── types.ts              # Tip tanimlari ve model haritasi
├── conversation-state.ts # Konusma durumu yonetimi
├── system-prompt.ts      # Sistem prompt olusturucu
├── tool-parser.ts        # Gomulu arac cagirisi ayristirici
└── tool-sanitizer.ts     # Arac sanitizasyonu
```

---

## Kimlik Dogrulama Yontemleri

### 1. Social Auth (Google/GitHub)

| Parametre        | Deger                                                       |
|------------------|-------------------------------------------------------------|
| **Endpoint**     | `https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken` |
| **Metot**        | POST                                                        |
| **Content-Type** | application/json                                            |
| **Body**         | `{ "refreshToken": "<refresh_token>" }`                     |

**Yanit:**
```typescript
interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}
```

### 2. IAM Identity Center (IdC)

| Parametre        | Deger                                        |
|------------------|----------------------------------------------|
| **Endpoint**     | `https://oidc.us-east-1.amazonaws.com/token` |
| **Metot**        | POST                                         |
| **Content-Type** | application/json                             |
| **Host Header**  | oidc.us-east-1.amazonaws.com                 |
| **User-Agent**   | aws-sdk-js/3.738.0 ... KiroIDE               |

**Istek Body:**
```json
{
  "clientId": "<client_id>",
  "clientSecret": "<client_secret>",
  "grantType": "refresh_token",
  "refreshToken": "<refresh_token>"
}
```

### Kimlik Bilgisi Kesfetme

Kiro IDE, kimlik bilgilerini su konumda saklar:

| Dosya                                   | Icerik                                         |
|-----------------------------------------|------------------------------------------------|
| `~/.aws/sso/cache/kiro-auth-token.json` | Access/Refresh token, authMethod, clientIdHash |
| `~/.aws/sso/cache/{clientIdHash}.json`  | clientId, clientSecret (IdC icin)              |

**kiro-auth-token.json Yapisi:**
```typescript
interface KiroAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  clientIdHash?: string;
  authMethod: "IdC" | "Social";
}
```

---

## Token Yonetimi

### Token Yenileme Mantigi

```typescript
export async function refreshKiroToken(
  token: KiroToken,
  options: RefreshKiroTokenOptions = {}
): Promise<KiroToken> {
  const { autoDiscoverCredentials = true } = options;

  if (token.authMethod === "Social") {
    return refreshSocialToken(token.refreshToken);
  }

  if (token.authMethod === "IdC") {
    // clientId/clientSecret yoksa otomatik kesfet
    if (!clientId || !clientSecret) {
      if (autoDiscoverCredentials) {
        const discovered = await discoverKiroDeviceRegistration();
        // ...
      }
    }
    return refreshIdcToken(token.refreshToken, clientId, clientSecret);
  }
}
```

### Token Surumlulugu Kontrolu

```typescript
export function isKiroTokenExpired(token: KiroToken, bufferSeconds = 60): boolean {
  const expiresAt = typeof token.expiresAt === "string"
    ? new Date(token.expiresAt).getTime()
    : token.expiresAt;

  return Date.now() >= expiresAt - bufferSeconds * 1000;
}
```

**Not:** Varsayilan olarak token suresi dolmadan 60 saniye once yenileme yapilir.

---

## API Endpoint'leri

| Endpoint                  | URL                                                                       |
|---------------------------|---------------------------------------------------------------------------|
| **CodeWhisperer API**     | `https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse` |
| **Kota Sorgulama**        | `https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits`            |
| **Social Token Yenileme** | `https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken`               |
| **IdC Token Yenileme**    | `https://oidc.us-east-1.amazonaws.com/token`                              |

### HTTP Header'lari

```typescript
export const KIRO_HEADERS = {
  "User-Agent": "aws-sdk-js/1.0.0 KiroIDE-0.2.13",
  "x-amz-user-agent": "aws-sdk-js/1.0.0",
  Host: "codewhisperer.us-east-1.amazonaws.com",
};
```

---

## Model Haritasi

| Anthropic Model              | Kiro Model ID                   |
|------------------------------|---------------------------------|
| `claude-sonnet-4-5`          | CLAUDE_SONNET_4_5_20250929_V1_0 |
| `claude-sonnet-4-5-20250929` | CLAUDE_SONNET_4_5_20250929_V1_0 |
| `claude-sonnet-4-20250514`   | CLAUDE_SONNET_4_20250514_V1_0   |
| `claude-3-7-sonnet-20250219` | CLAUDE_3_7_SONNET_20250219_V1_0 |
| `claude-3-5-haiku-20241022`  | auto                            |
| `claude-haiku-4-5-20251001`  | auto                            |
| `claude-opus-4-5`            | claude-opus-4.5                 |
| `claude-opus-4`              | claude-opus-4.5                 |
| `claude-opus-4-5-thinking`   | claude-opus-4.5                 |
| `claude-sonnet-4-5-thinking` | CLAUDE_SONNET_4_5_20250929_V1_0 |

---

## Istek/Yanit Formatlari

### CodeWhisperer Istek Yapisi

```typescript
interface CodeWhispererRequest {
  conversationState: {
    agentContinuationId: string;
    agentTaskType: "vibe";
    chatTriggerType: "MANUAL" | "AUTO";
    conversationId: string;
    currentMessage: {
      userInputMessage: {
        content: string;
        modelId: string;
        origin: "AI_EDITOR";
        images?: CodeWhispererImage[];
        userInputMessageContext?: {
          tools?: CodeWhispererTool[];
          toolResults?: ToolResult[];
        };
      };
    };
    history: HistoryMessage[];
  };
}
```

### Mesaj Gecmisi Yapisi

```typescript
type HistoryMessage = HistoryUserMessage | HistoryAssistantMessage;

interface HistoryUserMessage {
  userInputMessage: {
    content: string;
    modelId: string;
    origin: "AI_EDITOR";
    images?: CodeWhispererImage[];
    userInputMessageContext?: {
      toolResults?: ToolResult[];
    };
  };
}

interface HistoryAssistantMessage {
  assistantResponseMessage: {
    content: string;
    toolUses?: ToolUseEntry[];
  };
}
```

### Arac Tanimi

```typescript
interface CodeWhispererTool {
  toolSpecification: {
    name: string;
    description: string;
    inputSchema: {
      json: Record<string, unknown>;
    };
  };
}
```

---

## Event Stream Parser

AWS Event Stream binary formatini parse etmek icin kullanilir.

### Event Stream Mesaj Yapisi

```
+----------------+
| Total Length   | 4 bytes (big-endian)
+----------------+
| Headers Length | 4 bytes (big-endian)
+----------------+
| Prelude CRC    | 4 bytes
+----------------+
| Headers        | variable
+----------------+
| Payload        | variable
+----------------+
| Message CRC    | 4 bytes
+----------------+
```

### Parser Fonksiyonlari

```typescript
// Tek mesaj parse
export function parseEventStreamMessage(
  buffer: Uint8Array,
  offset: number
): { message: EventStreamMessage; bytesRead: number } | null

// Tum stream'i parse
export function parseEventStream(buffer: Uint8Array): EventStreamMessage[]

// Event payload'i cikart
export function extractEventPayload(
  message: EventStreamMessage
): { eventType: string; data: unknown } | null
```

### Event Tipleri

| Event Tipi                   | Aciklama             |
|------------------------------|----------------------|
| `assistantResponseEvent`     | Model yanit metni    |
| `toolUseEvent`               | Arac kullanim istegi |
| `codeEvent`                  | Kod blogu            |
| `supplementaryWebLinksEvent` | Web baglantilari     |
| `messageMetadataEvent`       | Mesaj metadata       |
| `error`                      | Hata mesaji          |

---

## Yanit Donusturme

### Kiro -> Anthropic SSE Donusumu

```typescript
interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
    input?: Record<string, unknown>;
  };
  message?: { ... };
}
```

### SSE Event Turleri

| Event                 | Aciklama                                         |
|-----------------------|--------------------------------------------------|
| `message_start`       | Mesaj baslangici                                 |
| `content_block_start` | Icerik blogu baslangici (text/tool_use/thinking) |
| `content_block_delta` | Icerik blogu parcasi                             |
| `content_block_stop`  | Icerik blogu sonu                                |
| `message_delta`       | Mesaj durumu guncelleme                          |
| `message_stop`        | Mesaj sonu                                       |

---

## Thinking Mode (Dusunme Modu)

### Thinking Mode Prefix

```typescript
export const KIRO_THINKING_MODE_PREFIX = `<thinking_mode>enabled</thinking_mode>
<max_thinking_length>200000</max_thinking_length>

`;
```

### Thinking Bloklari

Thinking bloklari `<thinking>...</thinking>` etiketleri arasinda yer alir ve yanit donusturme sirasinda ayristirilir.

```typescript
function parseThinkingBlocks(text: string): {
  thinking: string | null;
  content: string
} {
  const openTag = "<thinking>";
  const closeTag = "</thinking>";
  // ...
}
```

### Thinking Recovery

Thinking bloklari bozulmus veya silinmis durumdaysa kurtarma mekanizmasi devreye girer:

```typescript
export function needsThinkingRecovery(state: ConversationState): boolean {
  return state.inToolLoop && !state.turnHasThinking;
}

export function closeToolLoopForThinking(contents: any[]): any[] {
  // 1. Tum thinking bloklarini sil
  const strippedContents = stripAllThinkingBlocks(contents);

  // 2. Sentetik model mesaji ekle
  const syntheticModel = {
    role: "model",
    parts: [{ text: "[Tool execution completed.]" }],
  };

  // 3. Sentetik kullanici mesaji ekle (yeni turn baslat)
  const syntheticUser = {
    role: "user",
    parts: [{ text: "[Continue]" }],
  };

  return [...strippedContents, syntheticModel, syntheticUser];
}
```

---

## Arac (Tool) Yonetimi

### Arac Limitleri

| Limit                       | Deger |
|-----------------------------|-------|
| Maksimum arac ismi uzunlugu | 64    |
| Maksimum aciklama uzunlugu  | 10237 |
| Hedef toplam boyut          | 20 KB |
| Minimum aciklama uzunlugu   | 50    |

### Arac Sanitizasyonu

```typescript
export function sanitizeTools(tools: Array<{
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}>): ToolSanitizeResult {
  const sanitized = tools
    .filter(tool => tool.name && tool.name !== "web_search" && tool.name !== "websearch")
    .map(tool => ({
      name: shortenToolName(tool.name),
      description: sanitizeToolDescription(tool.name, tool.description ?? ""),
      input_schema: tool.input_schema ?? { type: "object", properties: {} },
    }));

  // Boyut kontrolu ve sikistirma...
}
```

### Gomulu Arac Cagirisi Parser

Metin icinde gomulu arac cagirilarini tespit eder:

```typescript
// Format: [Called <tool_name> with args: {json}]
const EMBEDDED_TOOL_CALL_REGEX = /\[Called\s+(\w+)\s+with\s+args:\s*(\{[\s\S]*?\})\]/g;

export function parseEmbeddedToolCalls(
  text: string,
  processedIds: Set<string> = new Set()
): { cleanedText: string; toolCalls: ParsedToolCall[] }
```

### JSON Onarimi

Bozuk JSON'u onarmak icin:

```typescript
export function repairJson(jsonString: string): string {
  // 1. Sonraki virgulleri kaldir: ,} -> }
  // 2. Tirnak isareti olmayan anahtarlari duzelt
  // 3. Tek tirnaklari cift tirnaga cevir
  // 4. Eksik parantezleri tamamla
}
```

---

## Konusma Durumu Yonetimi

### Konusma Onbellegi

```typescript
export const MAX_CONVERSATIONS = 200;

const conversationStateCache = new Map<string, ConversationState>();

interface ConversationState {
  conversationId: string;
  agentContinuationId: string;
  pendingCallIdsByName: Map<string, string[]>;
  lastAccessedAt: number;
}
```

### Onbellek Tahliyesi

En eski %20'lik dilim tahliye edilir:

```typescript
function evictOldestEntries(
  cache: Map<string, ConversationState>,
  maxSize: number = MAX_CONVERSATIONS
): void {
  if (cache.size <= maxSize) return;

  const entries = Array.from(cache.entries());
  entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

  const toRemove = Math.ceil(entries.length * 0.2);
  for (let i = 0; i < toRemove; i++) {
    cache.delete(entries[i][0]);
  }
}
```

### Konusma Anahtari Olusturma

```typescript
function extractConversationKeyFromRequest(googleBody: GoogleRequest): string | null {
  // 1. Acik conversationId
  // 2. sessionId
  // 3. contextId
  // 4. Hash-tabanli (sistem + ilk kullanici mesaji)
}
```

---

## Hata Yonetimi

### Token Yenileme Hatalari

```typescript
export class KiroTokenRefreshError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "KiroTokenRefreshError";
  }
}
```

### Hata Kodlari

| Kod                   | Aciklama                             |
|-----------------------|--------------------------------------|
| `refresh_failed`      | Token yenileme basarisiz             |
| `missing_credentials` | IdC icin clientId/clientSecret eksik |
| `unknown_auth_method` | Bilinmeyen kimlik dogrulama yontemi  |

### API Hata Yanitlari

```typescript
// 401 Unauthorized
{
  error: {
    code: 401,
    message: "Kiro: Not authenticated. Please login to Kiro IDE first.",
    status: "UNAUTHENTICATED"
  }
}

// 400 Bad Request
{
  error: {
    code: 400,
    message: "Invalid request body",
    status: "INVALID_ARGUMENT"
  }
}
```

---

## Yapilandirma

### Plugin Yapilandirmasi (antigravity.json)

```json
{
  "quiet_mode": false,
  "debug": false,
  "session_recovery": true,
  "auto_resume": true,
  "quota_fallback": false,
  "account_selection_strategy": "hybrid",
  "switch_on_first_rate_limit": true,
  "default_retry_after_seconds": 60,
  "max_backoff_seconds": 60,
  "quota_protection": {
    "enabled": true,
    "threshold_percentage": 10,
    "refresh_interval_seconds": 300,
    "monitored_models": [
      "claude-sonnet-4-5",
      "gemini-3-pro-high",
      "gemini-3-flash",
      "gemini-3-pro-image"
    ],
    "prefer_high_quota": true
  }
}
```

### Model Yapilandirmasi (opencode.json)

```json
{
  "plugin": ["vibe-open-auth"],
  "provider": {
    "google": {
      "models": {
        "kiro-claude-opus-4-5": {
          "name": "Claude Opus 4.5 (Kiro)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "kiro-claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5 (Kiro)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        }
      }
    }
  }
}
```

---

## Hesap Depolama

### Depolama Konumu

```
~/.config/opencode/kiro-accounts.json
```

### Hesap Yapisi

```typescript
interface KiroAccount {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  authMethod: AuthMethod;
  clientId?: string;
  clientSecret?: string;
  email?: string;
  addedAt: number;
  lastUsed: number;
}

interface KiroAccountStore {
  version: number;
  accounts: KiroAccount[];
  activeIndex: number;
}
```

### Hesap Islemleri

| Fonksiyon                  | Aciklama              |
|----------------------------|-----------------------|
| `loadKiroAccounts()`       | Hesaplari yukle       |
| `saveKiroAccounts()`       | Hesaplari kaydet      |
| `clearKiroAccounts()`      | Tum hesaplari sil     |
| `addKiroAccount()`         | Yeni hesap ekle       |
| `removeKiroAccount()`      | Hesap sil             |
| `getActiveKiroAccount()`   | Aktif hesabi getir    |
| `setActiveKiroAccount()`   | Aktif hesabi degistir |
| `updateKiroAccountToken()` | Token guncelle        |

---

## Sistem Prompt Olusturucu

### Agentic Mod Promtu

```typescript
export const KIRO_AGENTIC_SYSTEM_PROMPT = `
# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- **NEVER** write entire files in one operation if >300 lines

## WHY THIS MATTERS
- AWS Kiro API has 2-3 minute timeout for responses
- Large single writes trigger this timeout
- Chunked writes complete faster and more reliably
`;
```

### Tool Choice Donusumu

```typescript
export function convertToolChoiceToSystemPromptHint(
  toolChoice: ToolChoice | null
): string {
  switch (toolChoice?.type) {
    case "any":
      return "[INSTRUCTION: You MUST use at least one tool...]";
    case "tool":
      return `[INSTRUCTION: You MUST use the tool named '${toolChoice.name}'...]`;
    case "none":
      return "[INSTRUCTION: Do NOT use any tools...]";
    default:
      return "";
  }
}
```

---

## Google API -> Kiro Donusumu

### Istek Donusumu Akisi

```
Google API Istegi
      │
      ▼
┌─────────────────┐
│ convertGoogleTo │
│ AnthropicMessages│
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ buildCodeWhis-  │
│ pererRequest    │
└─────────────────┘
      │
      ▼
CodeWhisperer API
      │
      ▼
┌─────────────────┐
│ parseEventStream│
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ convertAnthro-  │
│ picToGoogleSSE  │
└─────────────────┘
      │
      ▼
Google SSE Yaniti
```

### Rol Donusumu

| Google API | Anthropic | CodeWhisperer            |
|------------|-----------|--------------------------|
| user       | user      | userInputMessage         |
| model      | assistant | assistantResponseMessage |

---

## Bagimliliklar

| Paket                | Versiyon | Aciklama          |
|----------------------|----------|-------------------|
| @openauthjs/openauth | ^0.4.3   | OAuth istemcisi   |
| proper-lockfile      | ^4.1.2   | Dosya kilitleme   |
| xdg-basedir          | ^5.1.0   | XDG dizin yollari |
| zod                  | ^3.24.0  | Schema dogrulama  |

---

## Kullanim Ornekleri

### Kiro ile Model Calistirma

```bash
# Claude Opus 4.5 (Kiro) - Once Kiro IDE'ye giris yapilmali
opencode run "Merhaba" --model=google/kiro-claude-opus-4-5

# Claude Sonnet 4.5 (Kiro)
opencode run "Merhaba" --model=google/kiro-claude-sonnet-4-5
```

### Token Yenileme Ornegi

```typescript
import { refreshKiroToken, isKiroTokenExpired } from "vibe-open-auth/kiro";

const token: KiroToken = {
  accessToken: "...",
  refreshToken: "...",
  expiresAt: Date.now() + 3600000,
  authMethod: "Social",
  expiresIn: 3600
};

if (isKiroTokenExpired(token)) {
  const newToken = await refreshKiroToken(token);
  console.log("Yeni token:", newToken.accessToken);
}
```

---

## Sonuc

`vibe-open-auth` projesi, Kiro (AWS CodeWhisperer) API'sine erisim icin kapsamli bir TypeScript kutuphanesi saglar. Temel ozellikler:

1. **Cift Kimlik Dogrulama**: Social (Google/GitHub) ve IAM Identity Center (IdC) destegi
2. **Otomatik Token Yonetimi**: Token suresi dolmadan 60 saniye once otomatik yenileme
3. **Event Stream Parser**: AWS binary event stream formatini native olarak parse eder
4. **Thinking Mode**: Extended thinking destegi ve corrupted state recovery
5. **Arac Yonetimi**: Tool sanitizasyonu, gomulu arac cagirisi parser'i ve JSON onarimi
6. **Konusma Yonetimi**: Durum onbellegi ve otomatik tahliye
7. **Coklu Hesap Destegi**: Rate limit durumunda otomatik hesap degisimi

Bu dokumasyon, vibe-open-auth v1.0.19 versiyonuna dayanmaktadir.
