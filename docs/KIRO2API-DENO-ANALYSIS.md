# KIRO2API-DENO Analiz Dokumani

Bu dokuman, [AAEE86/kiro2api-deno](https://github.com/AAEE86/kiro2api-deno) projesinin kapsamli analizini icermektedir. Proje, Deno runtime uzerinde calisarak Kiro (AWS CodeWhisperer) API'sini OpenAI ve Anthropic uyumlu formata donusturmektedir.

---

## Genel Bakis

| Ozellik                   | Deger                                            |
|---------------------------|--------------------------------------------------|
| **Platform**              | Deno (TypeScript)                                |
| **Varsayilan Port**       | 8080                                             |
| **Kimlik Dogrulama**      | Social Auth, IdC (IAM Identity Center)           |
| **Desteklenen API'ler**   | Anthropic Messages API, OpenAI Chat Completions  |
| **Token Yonetimi**        | Deno KV veya ortam degiskenleri                  |
| **Upstream API**          | AWS CodeWhisperer generateAssistantResponse      |
| **Stream Destegi**        | Evet (SSE - Server-Sent Events)                  |
| **Lisans**                | Acik kaynak                                      |

---

## Proje Yapisi

```
kiro2api-deno/
├── main.ts                 # Ana giris noktasi ve HTTP sunucu
├── deno.json               # Deno yapilandirma dosyasi
├── auth/
│   ├── auth_service.ts     # Kimlik dogrulama servisi
│   ├── config.ts           # Yapilandirma yukleme
│   ├── kv_store.ts         # Deno KV depolama
│   ├── refresh.ts          # Token yenileme islemleri
│   ├── token_cache.ts      # Token onbellekleme
│   ├── token_manager.ts    # Token yonetimi
│   ├── token_refresher.ts  # Token yenileme mekanizmasi
│   ├── token_selector.ts   # Token secimi (round-robin)
│   └── usage_checker.ts    # Kullanim limiti kontrolu
├── config/
│   ├── cache.ts            # Onbellek yapilandirmasi
│   ├── constants.ts        # Sabitler ve model eslesmesi
│   ├── index.ts            # Yapilandirma modulu
│   ├── runtime.ts          # Calisma zamani ayarlari
│   ├── timeout.ts          # Zaman asimi yapilandirmasi
│   └── tuning.ts           # Performans ayarlari
├── converter/
│   ├── converter.ts        # Anthropic <-> CodeWhisperer donusumu
│   ├── content.ts          # Icerik blogu donusumu
│   ├── openai.ts           # OpenAI format donusumu
│   ├── tools.ts            # Arac (tool) donusumu
│   └── mod.ts              # Modul ihracati
├── parser/
│   ├── robust_parser.ts    # AWS Event Stream ayristica
│   ├── header_parser.ts    # Baslik ayristica
│   └── ...                 # Diger ayristic moduller
├── server/
│   ├── handlers.ts         # API istek isleyicileri
│   ├── stream_processor.ts # Streaming islemci
│   ├── openai_handlers.ts  # OpenAI API isleyicileri
│   ├── middleware.ts       # Ara yazilimlar
│   ├── error_mapper.ts     # Hata esleme
│   └── ...                 # Diger sunucu modulleri
├── types/
│   ├── anthropic.ts        # Anthropic tip tanimlari
│   ├── codewhisperer.ts    # CodeWhisperer tip tanimlari
│   ├── openai.ts           # OpenAI tip tanimlari
│   ├── token.ts            # Token tip tanimlari
│   └── common.ts           # Ortak tipler
├── utils/
│   ├── codewhisperer_client.ts  # CodeWhisperer istemci
│   ├── request_headers.ts       # Istek basliklari
│   ├── token_calculation.ts     # Token hesaplama
│   └── ...                      # Diger yardimci fonksiyonlar
└── routes/
    └── token_admin.ts      # Token yonetim API'leri
```

---

## Kimlik Dogrulama Yontemleri

### 1. Social Auth

Google veya GitHub OAuth kullanarak kimlik dogrulama.

| Ozellik           | Deger                                                          |
|-------------------|----------------------------------------------------------------|
| **Auth Type**     | `Social`                                                       |
| **Refresh URL**   | `https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken`    |
| **Gerekli Alan**  | `refreshToken`                                                 |
| **HTTP Metodu**   | POST                                                           |

**Istek Formati:**
```json
{
  "refreshToken": "your_refresh_token"
}
```

**Yanit Formati:**
```typescript
interface RefreshResponse {
  accessToken: string;
  expiresIn: number;      // saniye cinsinden
  profileArn?: string;    // Kullanici profil ARN'i
}
```

### 2. IdC (IAM Identity Center)

AWS IAM Identity Center kullanarak kurumsal kimlik dogrulama.

| Ozellik           | Deger                                              |
|-------------------|----------------------------------------------------|
| **Auth Type**     | `IdC`                                              |
| **Refresh URL**   | `https://oidc.us-east-1.amazonaws.com/token`       |
| **Gerekli Alan**  | `refreshToken`, `clientId`, `clientSecret`         |
| **HTTP Metodu**   | POST                                               |

**Istek Formati:**
```json
{
  "clientId": "your_client_id",
  "clientSecret": "your_client_secret",
  "grantType": "refresh_token",
  "refreshToken": "your_refresh_token"
}
```

**Ozel Basliklar:**
```
Host: oidc.us-east-1.amazonaws.com
x-amz-user-agent: aws-sdk-js/3.738.0 ua/2.1 os/other lang/js md/browser#unknown_unknown api/sso-oidc#3.738.0 m/E KiroIDE
```

---

## Token Yapilandirmasi

### Ortam Degiskenleri

| Degisken           | Zorunlu | Aciklama                                    |
|--------------------|---------|---------------------------------------------|
| `KIRO_CLIENT_TOKEN`| Evet    | API erisimine yetkilendirme anahtari        |
| `KIRO_AUTH_TOKEN`  | Evet    | JSON formatinda auth konfigurasyonu         |
| `PORT`             | Hayir   | Sunucu portu (varsayilan: 8080)             |
| `LOG_LEVEL`        | Hayir   | Log seviyesi: debug, info, warn, error      |
| `LOG_FORMAT`       | Hayir   | Log formati: json, text                     |

### KIRO_AUTH_TOKEN Formati

```json
[
  {
    "auth": "Social",
    "refreshToken": "your_social_refresh_token",
    "description": "Hesap aciklamasi"
  },
  {
    "auth": "IdC",
    "refreshToken": "your_idc_refresh_token",
    "clientId": "your_client_id",
    "clientSecret": "your_client_secret",
    "description": "Kurumsal hesap"
  }
]
```

### AuthConfig Arayuzu

```typescript
interface AuthConfig {
  auth: "Social" | "IdC";
  refreshToken: string;
  clientId?: string;       // Sadece IdC icin
  clientSecret?: string;   // Sadece IdC icin
  disabled?: boolean;      // Devre disi birakma
  description?: string;    // Aciklama
}
```

---

## Token Yonetim Sistemi

### Token Yasam Dongusu

```
[Baslatma] -> [Yapilandirma Yukle] -> [Token Onbellekle] -> [Kullanim Kontrolu]
     |                                        |                    |
     v                                        v                    v
[KV Store/Env] <---------- [Yenileme] <-- [Sureleri Dol?] <-- [Secim]
```

### Token Onbellek Yapilandirmasi

| Parametre             | Deger          | Aciklama                           |
|-----------------------|----------------|------------------------------------|
| `TTL_MS`              | 86.400.000 ms  | 24 saat onbellek suresi            |
| `CLEANUP_INTERVAL_MS` | 3.600.000 ms   | 1 saat temizleme araligi           |
| `EXPIRY_BUFFER_MS`    | 300.000 ms     | 5 dakika erken yenileme tamponu    |

### Token Secim Stratejisi

Round-robin algoritmasi ile token secimi:

1. Mevcut indeksteki token kontrol edilir
2. Kullanim limiti dolmussa bir sonraki tokena gecilir
3. Suresi dolmussa yenileme tetiklenir
4. Yenileme basarisizsa sonraki token denenir
5. Tum tokenlar basarisiz olursa hata dondurulur

---

## API Endpointleri

### Temel Endpointler

| Metod | Endpoint                  | Aciklama                          |
|-------|---------------------------|-----------------------------------|
| GET   | `/`                       | Web yonetim arayuzu               |
| GET   | `/admin`                  | Yonetici paneli                   |
| GET   | `/v1/models`              | Kullanilabilir modeller           |
| POST  | `/v1/messages`            | Anthropic Messages API            |
| POST  | `/v1/chat/completions`    | OpenAI Chat Completions API       |
| POST  | `/v1/messages/count_tokens`| Token sayimi                     |
| GET   | `/api/tokens`             | Token havuzu durumu               |

### Yonetim Endpointleri

| Metod  | Endpoint                     | Aciklama                      |
|--------|------------------------------|-------------------------------|
| GET    | `/api/admin/tokens`          | Tum tokenlari listele         |
| POST   | `/api/admin/tokens`          | Yeni token ekle               |
| DELETE | `/api/admin/tokens`          | Token sil                     |
| POST   | `/api/admin/tokens/import`   | Toplu token yukle             |
| POST   | `/api/admin/tokens/clear`    | Tum tokenlari temizle         |

---

## Model Esleme

| Harici Model Adi                  | CodeWhisperer Model ID               |
|-----------------------------------|--------------------------------------|
| `claude-sonnet-4-5`               | `CLAUDE_SONNET_4_5_20250929_V1_0`    |
| `claude-sonnet-4-5-20250929`      | `CLAUDE_SONNET_4_5_20250929_V1_0`    |
| `claude-sonnet-4-20250514`        | `CLAUDE_SONNET_4_20250514_V1_0`      |
| `claude-3-7-sonnet-20250219`      | `CLAUDE_3_7_SONNET_20250219_V1_0`    |
| `claude-3-5-haiku-20241022`       | `auto`                               |
| `claude-haiku-4-5-20251001`       | `auto`                               |

---

## Istek/Yanit Formatlari

### Anthropic Messages API

**Istek:**
```typescript
interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicRequestMessage[];
  system?: AnthropicSystemMessage[];
  tools?: AnthropicTool[];
  tool_choice?: string | ToolChoice;
  stream: boolean;
  temperature?: number;
}

interface AnthropicRequestMessage {
  role: string;
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: string;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  name?: string;
  input?: unknown;
  id?: string;
  is_error?: boolean;
  source?: ImageSource;
}
```

**Yanit (Non-streaming):**
```typescript
{
  id: "msg_xxx",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: [
    { type: "text", text: "..." }
  ],
  stop_reason: "end_turn" | "tool_use" | "max_tokens",
  usage: {
    input_tokens: 100,
    output_tokens: 50
  }
}
```

### OpenAI Chat Completions API

**Istek:**
```typescript
interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: string | OpenAIToolChoice;
}
```

**Yanit:**
```typescript
interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: string | null,
      tool_calls?: OpenAIToolCall[]
    },
    finish_reason: "stop" | "tool_calls"
  }];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

---

## CodeWhisperer Entegrasyonu

### Upstream API Endpoint

```
https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse
```

### Istek Basliklari

```typescript
{
  "Content-Type": "application/json",
  "Authorization": "Bearer ${accessToken}",
  "x-amzn-kiro-agent-mode": "spec",
  "x-amz-user-agent": "aws-sdk-js/1.0.18 KiroIDE-0.2.13-xxx",
  "user-agent": "aws-sdk-js/1.0.18 ua/2.1 os/darwin#25.0.0 lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.2.13-xxx"
}
```

### CodeWhisperer Istek Formati

```typescript
interface CodeWhispererRequest {
  conversationState: {
    agentContinuationId: string;
    agentTaskType: string;          // "vibe"
    chatTriggerType: string;        // "MANUAL" | "AUTO"
    currentMessage: {
      userInputMessage: {
        userInputMessageContext: {
          toolResults?: ToolResult[];
          tools?: CodeWhispererTool[];
        };
        content: string;
        modelId: string;
        images: CodeWhispererImage[];
        origin: string;             // "AI_EDITOR"
      };
    };
    conversationId: string;
    history: unknown[];
  };
}
```

---

## Stream (Akis) Islemcisi

### SSE Event Tipleri

| Event Tipi             | Aciklama                                |
|------------------------|-----------------------------------------|
| `message_start`        | Mesaj baslangici                        |
| `ping`                 | Baglanti canli tutma                    |
| `content_block_start`  | Icerik blogu baslangici                 |
| `content_block_delta`  | Icerik parcasi (artimsal)               |
| `content_block_stop`   | Icerik blogu sonu                       |
| `message_delta`        | Mesaj guncelleme (stop_reason, usage)   |
| `message_stop`         | Mesaj sonu                              |

### Stop Reason Degerleri

| Deger        | Aciklama                                    |
|--------------|---------------------------------------------|
| `end_turn`   | Normal tamamlanma                           |
| `tool_use`   | Arac kullanimi gerekli                      |
| `max_tokens` | Token limiti asildi                         |

### Stream Yanit Ornegi

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"usage":{"input_tokens":100,"output_tokens":0}}}

event: ping
data: {"type":"ping"}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Merhaba"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":50}}

event: message_stop
data: {"type":"message_stop"}
```

---

## AWS Event Stream Ayristirma

### Message Yapisi

```
+-----------+-----------+--------------+---------+------------+-----------+
| Total Len | Header Len| Prelude CRC  | Headers |  Payload   | Msg CRC   |
|  4 bytes  |  4 bytes  |   4 bytes    | N bytes |  M bytes   |  4 bytes  |
+-----------+-----------+--------------+---------+------------+-----------+
```

### Ayristic Ozellikleri

| Parametre           | Deger        | Aciklama                           |
|---------------------|--------------|------------------------------------|
| `MIN_MESSAGE_SIZE`  | 16 byte      | Minimum mesaj boyutu               |
| `MAX_MESSAGE_SIZE`  | 16 MB        | Maksimum mesaj boyutu              |
| `maxErrors`         | 100          | Maksimum hata sayisi               |

### tool_use_id Dogrulama

- `tooluse_` on eki ile baslamali
- 20-50 karakter uzunlugunda olmali
- Sadece harf, rakam, alt cizgi ve tire icermeli
- Bozuk kaliplar tespit edilir (ornegin `tooluse_tooluse_`)

---

## Kullanim Limiti Kontrolu

### API Endpoint

```
GET https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits
    ?isEmailRequired=true
    &origin=AI_EDITOR
    &resourceType=AGENTIC_REQUEST
```

### Yanit Yapisi

```typescript
interface UsageLimits {
  usageBreakdownList: UsageBreakdown[];
  userInfo: {
    email: string;
    userId: string;
  };
  daysUntilReset: number;
  nextDateReset: number;
  subscriptionInfo: {
    subscriptionTitle: string;
    type: string;
  };
}

interface UsageBreakdown {
  resourceType: string;       // "CREDIT"
  unit: string;
  usageLimit: number;
  usageLimitWithPrecision: number;
  currentUsage: number;
  currentUsageWithPrecision: number;
  freeTrialInfo?: {
    freeTrialExpiry: number;
    freeTrialStatus: string;  // "ACTIVE"
    usageLimit: number;
    usageLimitWithPrecision: number;
    currentUsage: number;
    currentUsageWithPrecision: number;
  };
  displayName: string;
}
```

### Kullanilabilir Kredi Hesaplama

```typescript
function calculateAvailableCount(limits: UsageLimits): number {
  for (const breakdown of limits.usageBreakdownList) {
    if (breakdown.resourceType === "CREDIT") {
      let totalAvailable = 0;

      // Aktif deneme suresi varsa ekle
      if (breakdown.freeTrialInfo?.freeTrialStatus === "ACTIVE") {
        totalAvailable += breakdown.freeTrialInfo.usageLimitWithPrecision -
                         breakdown.freeTrialInfo.currentUsageWithPrecision;
      }

      // Temel kotayi ekle
      totalAvailable += breakdown.usageLimitWithPrecision -
                       breakdown.currentUsageWithPrecision;

      return Math.max(0, totalAvailable);
    }
  }
  return 0;
}
```

---

## Hata Yonetimi

### Hata Kategorileri

| Kategori                      | Aciklama                              |
|-------------------------------|---------------------------------------|
| `AUTH_NO_AVAILABLE_TOKEN`     | Kullanilabilir token yok              |
| `AUTH_REFRESH_FAILED`         | Token yenileme basarisiz              |
| `AUTH_TOKEN_INVALID`          | Gecersiz token yapilandirmasi         |
| `REQUEST_INVALID_PARAMS`      | Gecersiz istek parametreleri          |
| `UPSTREAM_ERROR`              | Upstream API hatasi                   |
| `UPSTREAM_TIMEOUT`            | Upstream zaman asimi                  |
| `STREAM_TIMEOUT`              | Akis zaman asimi                      |
| `STREAM_INTERRUPTED`          | Akis kesintisi                        |

### CodeWhisperer Hata Esleme

| CodeWhisperer Hatasi                   | Claude Eslenmis Hata      |
|----------------------------------------|---------------------------|
| `CONTENT_LENGTH_EXCEEDS_THRESHOLD`     | `max_tokens` stop_reason  |
| Diger 400 hatalari                     | `overloaded_error`        |

### Istisna Olaylari

Content length asimi gibi istisnalar algilandi:
```typescript
private isContentLengthException(event: Record<string, unknown>): boolean {
  return event.__type === "ValidationException" ||
         event.__type === "DryRunOperation" ||
         event.exception_type === "ValidationException";
}
```

---

## Deno KV Depolama

### Anahtar Yapisi

```typescript
const KV_KEY = "kiro_auth_tokens";
```

### Desteklenen Islemler

| Islem               | Aciklama                              |
|---------------------|---------------------------------------|
| `getAuthConfigs`    | Tum konfigurasyonlari getir           |
| `saveAuthConfigs`   | Konfigurasyonlari kaydet              |
| `addAuthConfig`     | Tek konfigurasyonu ekle               |
| `deleteAuthConfig`  | refreshToken ile sil                  |
| `importAuthConfigs` | Toplu import (ustune yaz)             |
| `clearAuthConfigs`  | Tum konfigurasyonlari temizle         |

---

## Arac (Tool) Destegi

### Arac Donusumu

Anthropic araclari CodeWhisperer formatina donusturulur:

```typescript
// Anthropic Format
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// CodeWhisperer Format
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

### Filtrelenen Araclar

`web_search` ve `websearch` araclari otomatik olarak filtrelenir.

### Tool Choice Esleme

| Anthropic          | chatTriggerType    |
|--------------------|--------------------|
| `type: "any"`      | `AUTO`             |
| `type: "tool"`     | `AUTO`             |
| Diger              | `MANUAL`           |

---

## Gorsel Destegi

### Desteklenen Formatlar

| Format  | MIME Tipi         |
|---------|-------------------|
| PNG     | `image/png`       |
| JPEG    | `image/jpeg`      |
| GIF     | `image/gif`       |
| WebP    | `image/webp`      |

### Gorsel Donusumu

```typescript
// Anthropic Format
{
  type: "image",
  source: {
    type: "base64",
    media_type: "image/png",
    data: "base64_encoded_data"
  }
}

// CodeWhisperer Format
{
  format: "png",
  source: {
    bytes: "base64_encoded_data"
  }
}
```

---

## Calistirma Komutlari

### Gelistirme

```bash
# Bagimliliklari yukle ve baslat
deno task start

# Izleme modu ile gelistirme
deno task dev

# Lint kontrolu
deno task lint

# Formatlama
deno task fmt
```

### Uretim

```bash
# Derle
deno task compile

# Docker ile calistir
docker-compose up -d
```

### Ortam Degiskenleri Ornegi

```bash
export KIRO_CLIENT_TOKEN="api_anahtarim"
export KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"xxx"}]'
export PORT=8080
export LOG_LEVEL=info
```

---

## Guvenlik Ozellikleri

### API Kimlik Dogrulama

- `Authorization: Bearer <token>` veya `x-api-key: <token>` basligi
- `/v1/*` yollari korunmali

### Veri Maskeleme

- Token onizlemeleri: `eyJ...xxx` (ilk 4 + son 3 karakter)
- E-posta maskeleme: `u***r@example.com`
- Client ID maskeleme: `abc...xyz`

### CORS Basliklari

```typescript
{
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key"
}
```

### Statik Dosya Guvenligi

- Yol gecisi (path traversal) saldirilarina karsi koruma
- `..` ve mutlak yol dogrulamasi
- `X-Content-Type-Options: nosniff` basligi

---

## Performans Ozellikleri

### Token Onbellegi

- 24 saat TTL
- 5 dakika erken yenileme tamponu
- Saatlik temizleme gorevi

### Stream Tamponu

- 64 KB tampon boyutu
- Maksimum 1000 tampon parcasi

### Refresh Lock Mekanizmasi

Ayni anda birden fazla yenileme istegini onlemek icin kilit mekanizmasi:

```typescript
private refreshLocks: Map<number, Promise<TokenInfo>> = new Map();
```

---

## Farkliliklar: Node.js vs Deno Surumu

| Ozellik              | Node.js (Kiro)           | Deno (kiro2api-deno)     |
|----------------------|--------------------------|--------------------------|
| Runtime              | Node.js                  | Deno                     |
| Veritabani           | MySQL                    | Deno KV                  |
| HTTP Framework       | Express                  | Native Deno.serve        |
| Token Depolama       | MySQL tablolari          | KV Store / Env           |
| Tip Guvenligi        | JavaScript               | TypeScript (strict)      |
| Yapilandirma         | .env dosyasi             | .env + JSON dosya        |
| Cluster Destegi      | Evet (worker nodes)      | Hayir                    |
| Web UI               | Dahili                   | Basit statik dosyalar    |

---

## Sonuc

kiro2api-deno projesi, Deno'nun modern ozellikleri uzerinde insa edilmis, TypeScript ile tip guvenligi saglanmis ve AWS CodeWhisperer API'sini OpenAI/Anthropic uyumlu formata donusturen bir proxy servisidir. Token havuzu yonetimi, otomatik yenileme, kullanim limiti kontrolu ve streaming destegi gibi temel ozellikleri icermektedir.

Projenin temel avantajlari:
- Tek dosya dagilimi (deno compile)
- Harici veritabani gerektirmez (Deno KV)
- Guclu tip guvenligi
- Modern async/await kaliplari
- Kapsamli hata yonetimi

---

*Bu dokuman 01.02.2026 tarihinde olusturulmustur.*
