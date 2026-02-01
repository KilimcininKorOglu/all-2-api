# Kiro Reverse API Analizi

Bu dokuman, `kiro-reverse-api` projesinin kapsamli bir analizini sunmaktadir. Proje, Kiro (AWS CodeWhisperer), Gemini, Claude ve diger AI saglayicilarini OpenAI/Claude uyumlu arayuzlere donusturmek icin tasarlanmis bir Node.js API proxy servisidir.

---

## Genel Bakis

| Ozellik                  | Deger                                                                  |
|--------------------------|------------------------------------------------------------------------|
| Proje Adi                | kiro-reverse-api                                                       |
| Dil                      | JavaScript (ES Modules)                                                |
| Calisma Ortami           | Node.js                                                                |
| Varsayilan Port          | 3000                                                                   |
| Lisans                   | MIT                                                                    |
| Temel Amac               | Coklu AI saglayicisini tek bir API uzerinden yonetme                   |
| Desteklenen Saglayicilar | Kiro OAuth, Gemini CLI OAuth, Gemini Antigravity, OpenAI, Claude, Qwen |

---

## Desteklenen Saglayicilar ve Model Listesi

| Saglayici Tipi       | Tanim                         | Desteklenen Modeller                                                                                                                                             |
|----------------------|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `claude-kiro-oauth`  | Kiro OAuth ile Claude erisimi | claude-opus-4-5, claude-opus-4-5-20251101, claude-haiku-4-5, claude-sonnet-4-5, claude-sonnet-4-5-20250929, claude-sonnet-4-20250514, claude-3-7-sonnet-20250219 |
| `gemini-cli-oauth`   | Gemini CLI OAuth              | gemini-2.5-flash, gemini-2.5-pro, gemini-2.5-pro-preview-06-05, gemini-3-pro-preview, gemini-3-flash-preview                                                     |
| `gemini-antigravity` | Gemini Antigravity (deneysel) | gemini-2.5-computer-use-preview-10-2025, gemini-3-pro-image-preview, gemini-claude-sonnet-4-5                                                                    |
| `openai-custom`      | Ozel OpenAI API               | Yapilandirmaya bagli                                                                                                                                             |
| `claude-custom`      | Ozel Claude API               | Yapilandirmaya bagli                                                                                                                                             |
| `openai-qwen-oauth`  | Qwen OAuth                    | qwen3-coder-plus, qwen3-coder-flash                                                                                                                              |

---

## Kimlik Dogrulama Yontemleri

### 1. Kiro OAuth

Kiro, uc farkli kimlik dogrulama yontemi destekler:

#### 1.1 Social Auth (Google/GitHub)

PKCE (Proof Key for Code Exchange) akisi kullanir.

```javascript
// Yapilandirma
const KIRO_OAUTH_CONFIG = {
    authServiceEndpoint: 'https://prod.us-east-1.auth.desktop.kiro.dev',
    callbackPortStart: 19876,
    callbackPortEnd: 19880,
    authTimeout: 10 * 60 * 1000,  // 10 dakika
    scopes: [
        'codewhisperer:completions',
        'codewhisperer:analysis',
        'codewhisperer:conversations',
        'codewhisperer:transformations',
        'codewhisperer:taskassist'
    ]
};
```

**Akis:**
1. PKCE parametreleri (code_verifier, code_challenge) olusturulur
2. Yerel HTTP callback sunucusu baslatilir
3. Kullanici yetkilendirme URL'sine yonlendirilir
4. Callback'ten kod alinir ve token ile degistirilir

#### 1.2 AWS Builder ID (Device Code Flow)

```javascript
// Endpoint'ler
const ssoOIDCEndpoint = 'https://oidc.us-east-1.amazonaws.com';
const builderIDStartURL = 'https://view.awsapps.com/start';

// Akis:
// 1. OIDC istemci kaydı
POST /client/register
{
    "clientName": "Kiro IDE",
    "clientType": "public",
    "scopes": [...],
    "grantTypes": ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"]
}

// 2. Cihaz yetkilendirmesi
POST /device_authorization
{
    "clientId": "<client_id>",
    "clientSecret": "<client_secret>",
    "startUrl": "https://view.awsapps.com/start"
}

// 3. Token yoklaması
POST /token
{
    "clientId": "<client_id>",
    "clientSecret": "<client_secret>",
    "deviceCode": "<device_code>",
    "grantType": "urn:ietf:params:oauth:grant-type:device_code"
}
```

#### 1.3 IAM Identity Center (IdC)

AWS SSO-OIDC endpoint'i uzerinden calisir.

### 2. Gemini OAuth

```javascript
const OAUTH_PROVIDERS = {
    'gemini-cli-oauth': {
        clientId: 'SAMPLE_CLIENT_ID.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-SAMPLE_SECRET_1',
        port: 8085,
        scope: ['https://www.googleapis.com/auth/cloud-platform']
    },
    'gemini-antigravity': {
        clientId: 'SAMPLE_CLIENT_ID_2.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-SAMPLE_SECRET_2',
        port: 8086
    }
};
```

### 3. Qwen OAuth (Device Code Flow)

```javascript
const QWEN_OAUTH_CONFIG = {
    clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
    scope: 'openid profile email model.completion',
    deviceCodeEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
    tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
    grantType: 'urn:ietf:params:oauth:grant-type:device_code'
};
```

---

## Token Yonetimi

### Token Yenileme

Kiro servisi, token'larin otomatik yenilenmesini destekler:

```javascript
const KIRO_CONSTANTS = {
    REFRESH_URL: 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
    REFRESH_IDC_URL: 'https://oidc.{{region}}.amazonaws.com/token',
    AXIOS_TIMEOUT: 300000  // 5 dakika
};
```

**Yenileme Mantigi:**

```javascript
// Social Auth icin
POST /refreshToken
{
    "refreshToken": "<refresh_token>"
}

// Builder ID icin
POST /token
{
    "clientId": "<client_id>",
    "clientSecret": "<client_secret>",
    "refreshToken": "<refresh_token>",
    "grantType": "refresh_token"
}
```

### Token Suresi Kontrolu

```javascript
isExpiryDateNear() {
    const expirationTime = new Date(this.expiresAt);
    const currentTime = new Date();
    const cronNearMinutesInMillis = (this.config.CRON_NEAR_MINUTES || 10) * 60 * 1000;
    const thresholdTime = new Date(currentTime.getTime() + cronNearMinutesInMillis);
    return expirationTime.getTime() <= thresholdTime.getTime();
}
```

### Kimlik Bilgileri Depolama

Token'lar JSON dosyalari olarak saklanir:

```json
{
    "accessToken": "<access_token>",
    "refreshToken": "<refresh_token>",
    "profileArn": "<profile_arn>",
    "expiresAt": "2026-02-01T12:00:00.000Z",
    "authMethod": "social",
    "region": "us-east-1"
}
```

---

## API Endpoint'leri

### Temel Endpoint'ler

| Endpoint                                       | Metod | Aciklama                       |
|------------------------------------------------|-------|--------------------------------|
| `/v1/chat/completions`                         | POST  | OpenAI uyumlu sohbet tamamlama |
| `/v1/messages`                                 | POST  | Claude uyumlu mesaj API'si     |
| `/v1/responses`                                | POST  | OpenAI Responses API           |
| `/v1/models`                                   | GET   | OpenAI format model listesi    |
| `/v1beta/models`                               | GET   | Gemini format model listesi    |
| `/v1beta/models/{model}:generateContent`       | POST  | Gemini icerik olusturma        |
| `/v1beta/models/{model}:streamGenerateContent` | POST  | Gemini akisli icerik olusturma |
| `/health`                                      | GET   | Saglik kontrolu                |
| `/provider_health`                             | GET   | Saglayici saglik durumu        |

### Saglayici Bazli Routing

Saglayici, URL yolu veya `Model-Provider` basligı ile belirlenir:

```javascript
// URL yolu ile
GET /claude-kiro-oauth/v1/chat/completions

// Baslik ile
POST /v1/chat/completions
Headers: {
    "Model-Provider": "claude-kiro-oauth"
}
```

### Kiro API Endpoint'leri

```javascript
const KIRO_CONSTANTS = {
    BASE_URL: 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
    AMAZON_Q_URL: 'https://codewhisperer.{{region}}.amazonaws.com/SendMessageStreaming',
    USAGE_LIMITS_URL: 'https://q.{{region}}.amazonaws.com/getUsageLimits'
};
```

---

## Istek/Yanit Formatlari

### Kiro Istek Formati (CodeWhisperer)

```javascript
{
    "conversationState": {
        "chatTriggerType": "MANUAL",
        "conversationId": "<uuid>",
        "currentMessage": {
            "userInputMessage": {
                "content": "Merhaba",
                "modelId": "claude-opus-4.5",
                "origin": "AI_EDITOR",
                "images": [],  // Opsiyonel
                "userInputMessageContext": {
                    "toolResults": [],  // Opsiyonel
                    "tools": []  // Opsiyonel
                }
            }
        },
        "history": [
            {
                "userInputMessage": {
                    "content": "Onceki mesaj",
                    "modelId": "claude-opus-4.5",
                    "origin": "AI_EDITOR"
                }
            },
            {
                "assistantResponseMessage": {
                    "content": "Asistan yaniti",
                    "toolUses": []
                }
            }
        ]
    },
    "profileArn": "<profile_arn>"  // Social Auth icin
}
```

### Model Eslemesi

```javascript
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

### HTTP Baslik Yapisi

```javascript
{
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'Bearer <access_token>',
    'amz-sdk-request': 'attempt=1; max=1',
    'amz-sdk-invocation-id': '<uuid>',
    'x-amzn-kiro-agent-mode': 'vibe',
    'x-amz-user-agent': 'aws-sdk-js/1.0.0 KiroIDE-0.7.5-<machine_id>',
    'user-agent': 'aws-sdk-js/1.0.0 ua/2.1 os/<os_name> lang/js md/nodejs#<version> api/codewhispererruntime#1.0.0 m/E KiroIDE-0.7.5-<machine_id>'
}
```

---

## Event Stream Ayristirma

Kiro API, AWS Event Stream formatinda yanit dondurur. Ayristirma mantigi:

### Temel Event Yapisi

```javascript
// Icerik eventi
{ "content": "Merhaba, size nasil yardimci olabilirim?" }

// Arac kullanimi baslangici
{ "name": "search_web", "toolUseId": "tool_abc123" }

// Arac kullanimi input'u
{ "input": "{\"query\": \"hava durumu\"}" }

// Arac kullanimi sonu
{ "stop": true }

// Takip istemi
{ "followupPrompt": "Baska bir soru var mi?" }
```

### Ayristirma Algoritmasi

```javascript
parseAwsEventStreamBuffer(buffer) {
    const events = [];
    let remaining = buffer;

    // JSON payload kaliplarini ara
    const patterns = [
        '{"content":',
        '{"name":',
        '{"followupPrompt":',
        '{"input":',
        '{"stop":'
    ];

    // Parantez eslestirme ile tam JSON cikar
    for (let i = jsonStart; i < remaining.length; i++) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;

        if (braceCount === 0) {
            // Tam JSON bulundu
            const parsed = JSON.parse(remaining.substring(jsonStart, i + 1));
            events.push(parsed);
        }
    }

    return { events, remaining };
}
```

### Arac Cagrisi Ayristirma

Bracket format arac cagrilari (`[Called ... with args: ...]`) da desteklenir:

```javascript
function parseBracketToolCalls(responseText) {
    if (!responseText.includes("[Called")) return null;

    const toolCalls = [];
    const namePattern = /\[Called\s+(\w+)\s+with\s+args:/i;

    // Her "[Called" isaretleyicisi icin
    // - Fonksiyon adini cikar
    // - JSON argumanlari ayristir
    // - OpenAI uyumlu formata donustur

    return toolCalls;
}
```

---

## Hata Yonetimi

### Yeniden Deneme Mekanizmasi

```javascript
async callApi(method, model, body, isRetry = false, retryCount = 0) {
    const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
    const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

    try {
        const response = await this.axiosInstance.post(requestUrl, requestData, { headers });
        return response;
    } catch (error) {
        // 403: Token yenile ve tekrar dene
        if (error.response?.status === 403 && !isRetry) {
            await this.initializeAuth(true);
            return this.callApi(method, model, body, true, retryCount);
        }

        // 429: Ustel geri cekilme ile tekrar dene
        if (error.response?.status === 429 && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.callApi(method, model, body, isRetry, retryCount + 1);
        }

        // 5xx: Sunucu hatasi, tekrar dene
        if (error.response?.status >= 500 && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.callApi(method, model, body, isRetry, retryCount + 1);
        }

        throw error;
    }
}
```

### Hata Kodu Haritalamasi

| HTTP Kodu | Aciklama              | Islem                       |
|-----------|-----------------------|-----------------------------|
| 401       | Gecersiz API anahtari | Hata firlat                 |
| 403       | Erisim reddedildi     | Token yenile ve tekrar dene |
| 429       | Cok fazla istek       | Ustel geri cekilme          |
| 5xx       | Sunucu hatasi         | Ustel geri cekilme          |

### Saglayici Havuzu Saglik Yonetimi

```javascript
class ProviderPoolManager {
    constructor(providerPools, options = {}) {
        this.maxErrorCount = options.maxErrorCount ?? 3;
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000;
    }

    markProviderUnhealthy(providerType, providerConfig, errorMessage) {
        provider.config.errorCount++;
        provider.config.lastErrorTime = new Date().toISOString();

        if (provider.config.errorCount >= this.maxErrorCount) {
            provider.config.isHealthy = false;
        }
    }

    markProviderHealthy(providerType, providerConfig) {
        provider.config.isHealthy = true;
        provider.config.errorCount = 0;
        provider.config.lastErrorTime = null;
    }
}
```

---

## Yapilandirma

### Ana Yapilandirma Dosyasi (config.json)

```json
{
    "REQUIRED_API_KEY": "123456",
    "SERVER_PORT": 3000,
    "HOST": "0.0.0.0",
    "MODEL_PROVIDER": "claude-kiro-oauth",
    "OPENAI_API_KEY": null,
    "OPENAI_BASE_URL": "https://api.openai.com/v1",
    "CLAUDE_API_KEY": null,
    "CLAUDE_BASE_URL": null,
    "PROJECT_ID": null,
    "GEMINI_OAUTH_CREDS_BASE64": null,
    "GEMINI_OAUTH_CREDS_FILE_PATH": null,
    "KIRO_OAUTH_CREDS_BASE64": null,
    "KIRO_OAUTH_CREDS_FILE_PATH": null,
    "QWEN_OAUTH_CREDS_FILE_PATH": null,
    "KIRO_REFRESH_URL": null,
    "KIRO_REFRESH_IDC_URL": null,
    "KIRO_BASE_URL": null,
    "SYSTEM_PROMPT_FILE_PATH": "configs/input_system_prompt.txt",
    "SYSTEM_PROMPT_MODE": "overwrite",
    "PROMPT_LOG_MODE": "none",
    "REQUEST_MAX_RETRIES": 3,
    "REQUEST_BASE_DELAY": 1000,
    "CRON_NEAR_MINUTES": 15,
    "CRON_REFRESH_TOKEN": false,
    "PROVIDER_POOLS_FILE_PATH": "configs/provider_pools.json",
    "MAX_ERROR_COUNT": 3,
    "providerFallbackChain": {}
}
```

### Saglayici Havuzu Yapilandirmasi (provider_pools.json)

```json
{
    "claude-kiro-oauth": [
        {
            "uuid": "kiro-1",
            "KIRO_OAUTH_CREDS_FILE_PATH": "configs/kiro/auth-token-1.json",
            "isHealthy": true,
            "isDisabled": false,
            "checkHealth": true,
            "checkModelName": "claude-haiku-4-5",
            "notSupportedModels": [],
            "usageCount": 0,
            "errorCount": 0,
            "lastUsed": null,
            "lastErrorTime": null
        }
    ],
    "gemini-cli-oauth": [
        {
            "uuid": "gemini-1",
            "GEMINI_OAUTH_CREDS_FILE_PATH": "configs/gemini/oauth_creds.json",
            "PROJECT_ID": "my-project-id",
            "isHealthy": true,
            "checkHealth": true
        }
    ]
}
```

### Komut Satiri Parametreleri

| Parametre                     | Varsayilan                        | Aciklama                                 |
|-------------------------------|-----------------------------------|------------------------------------------|
| `--host`                      | `0.0.0.0`                         | Sunucu dinleme adresi                    |
| `--port`                      | `3000`                            | Sunucu dinleme portu                     |
| `--api-key`                   | `123456`                          | Zorunlu API anahtari                     |
| `--model-provider`            | `gemini-cli-oauth`                | Varsayilan model saglayicisi             |
| `--kiro-oauth-creds-base64`   | -                                 | Base64 kodlu Kiro kimlik bilgileri       |
| `--kiro-oauth-creds-file`     | -                                 | Kiro kimlik bilgileri dosya yolu         |
| `--gemini-oauth-creds-base64` | -                                 | Base64 kodlu Gemini kimlik bilgileri     |
| `--gemini-oauth-creds-file`   | -                                 | Gemini kimlik bilgileri dosya yolu       |
| `--system-prompt-file`        | `configs/input_system_prompt.txt` | Sistem istemi dosya yolu                 |
| `--system-prompt-mode`        | `overwrite`                       | Sistem istemi modu (overwrite/append)    |
| `--log-prompts`               | `none`                            | Istem loglama modu (console/file/none)   |
| `--request-max-retries`       | `3`                               | Maksimum yeniden deneme sayisi           |
| `--request-base-delay`        | `1000`                            | Temel bekleme suresi (ms)                |
| `--cron-near-minutes`         | `15`                              | Token yenileme kontrolu araligi (dakika) |
| `--cron-refresh-token`        | `false`                           | Otomatik token yenileme                  |
| `--provider-pools-file`       | `configs/provider_pools.json`     | Saglayici havuzu dosya yolu              |
| `--max-error-count`           | `3`                               | Saglayici icin maksimum hata sayisi      |

---

## Protokol Donusumu

Sistem, farkli AI protokolleri arasinda otomatik donusum saglar:

### Desteklenen Donusumler

| Kaynak Protokol  | Hedef Protokol | Desteklenen |
|------------------|----------------|-------------|
| OpenAI           | Claude         | Evet        |
| OpenAI           | Gemini         | Evet        |
| Claude           | OpenAI         | Evet        |
| Claude           | Gemini         | Evet        |
| Gemini           | OpenAI         | Evet        |
| Gemini           | Claude         | Evet        |
| OpenAI Responses | Claude         | Evet        |
| OpenAI Responses | Gemini         | Evet        |

### Donusum Ornegi

```javascript
// OpenAI formatindan Claude formatina
const claudeRequest = convertData(openaiRequest, 'request', 'openai', 'claude');

// Claude yanitindan OpenAI yanitina
const openaiResponse = convertData(claudeResponse, 'response', 'claude', 'openai');

// Akisli chunk donusumu
const openaiChunk = convertData(claudeChunk, 'streamChunk', 'claude', 'openai');
```

---

## Kullanim Limitleri Sorgulama

```javascript
async getUsageLimits() {
    const usageLimitsUrl = 'https://q.{{region}}.amazonaws.com/getUsageLimits';
    const params = new URLSearchParams({
        isEmailRequired: 'true',
        origin: 'AI_EDITOR',
        resourceType: 'AGENTIC_REQUEST'
    });

    if (this.authMethod === 'social' && this.profileArn) {
        params.append('profileArn', this.profileArn);
    }

    const response = await this.axiosInstance.get(fullUrl, { headers });
    return response.data;
}
```

---

## Makine Kimlik Uretimi

Her yapilandirma icin benzersiz bir makine kimligi uretilir:

```javascript
function generateMachineIdFromConfig(credentials) {
    const uniqueKey = credentials.uuid ||
                      credentials.profileArn ||
                      credentials.clientId ||
                      "KIRO_DEFAULT_MACHINE";
    return crypto.createHash('sha256').update(uniqueKey).digest('hex');
}
```

---

## Dosya Yapisi

```
kiro-reverse-api/
├── src/
│   ├── api-server.js              # Ana sunucu dosyasi
│   ├── config-manager.js          # Yapilandirma yonetimi
│   ├── service-manager.js         # Servis yonetimi
│   ├── request-handler.js         # Istek yonlendirici
│   ├── api-manager.js             # API istek isleyicisi
│   ├── oauth-handlers.js          # OAuth akislari
│   ├── provider-pool-manager.js   # Saglayici havuzu yonetimi
│   ├── provider-models.js         # Model tanimlari
│   ├── common.js                  # Ortak yardimcilar
│   ├── convert.js                 # Protokol donusumu
│   ├── adapter.js                 # Servis adaptoru
│   ├── claude/
│   │   ├── claude-kiro.js         # Kiro OAuth servisi
│   │   ├── claude-core.js         # Claude API servisi
│   │   └── claude-strategy.js     # Claude stratejisi
│   ├── gemini/
│   │   ├── gemini-core.js         # Gemini API servisi
│   │   ├── antigravity-core.js    # Antigravity servisi
│   │   └── gemini-strategy.js     # Gemini stratejisi
│   ├── openai/
│   │   ├── openai-core.js         # OpenAI API servisi
│   │   ├── qwen-core.js           # Qwen servisi
│   │   └── openai-strategy.js     # OpenAI stratejisi
│   └── converters/
│       ├── BaseConverter.js       # Temel donusturucu
│       ├── ConverterFactory.js    # Donusturucu fabrikasi
│       └── strategies/            # Donusum stratejileri
├── configs/
│   ├── config.json                # Ana yapilandirma
│   └── provider_pools.json        # Saglayici havuzu
├── static/                        # Web arayuzu dosyalari
└── tests/                         # Test dosyalari
```

---

## Sonuc

`kiro-reverse-api` projesi, birden fazla AI saglayicisini tek bir birlesik API uzerinden yonetmek icin kapsamli bir cozum sunmaktadir. Temel ozellikleri sunlardir:

1. **Coklu Kimlik Dogrulama**: Social Auth, Builder ID ve IAM Identity Center desteği
2. **Otomatik Token Yonetimi**: Sureleri dolan token'larin otomatik yenilenmesi
3. **Protokol Donusumu**: OpenAI, Claude ve Gemini formatlari arasinda seffaf donusum
4. **Saglayici Havuzu**: Yuk dengeleme ve failover icin birden fazla saglayici yonetimi
5. **Saglik Izleme**: Saglayici saglik kontrolu ve otomatik devre disi birakma
6. **Akisli Yanit Destegi**: Gercek zamanli streaming icin AWS Event Stream ayristirma

Bu analiz, projenin teknik yapisini ve temel ozelliklerini kapsamli bir sekilde ortaya koymaktadir.
