# Kiro2API-Nineyuanz Analiz Dokumani

Bu dokuman, `gdtiti/kiro2api-nineyuanz` deposunun kapsamli teknik analizini icermektedir. Proje, AWS CodeWhisperer API'sini Anthropic/OpenAI uyumlu bir arayuze donusturmek icin Go dilinde yazilmis bir proxy servisidir.

## Genel Bakis

| Ozellik             | Deger                                           |
|---------------------|-------------------------------------------------|
| Programlama Dili    | Go 1.24.0                                       |
| Web Framework       | Gin-Gonic v1.11.0                               |
| JSON Isleme         | ByteDance Sonic v1.14.1                         |
| Varsayilan Port     | 8080                                            |
| Desteklenen API'ler | Anthropic Messages API, OpenAI Chat Completions |
| Kimlik Dogrulama    | Social (AWS SSO), IdC (Identity Center)         |
| Token Yonetimi      | Coklu hesap havuzu, otomatik yenileme           |
| Guvenlik Onlemleri  | Rate limiting, parmak izi rastgelestirme        |

## Proje Yapisi

```
kiro2api-nineyuanz/
├── main.go                 # Ana giris noktasi
├── auth/                   # Kimlik dogrulama modulu
│   ├── auth.go             # AuthService sinifi
│   ├── config.go           # Yapilandirma yukleme
│   ├── token_manager.go    # Token yonetimi
│   ├── refresh.go          # Token yenileme
│   ├── rate_limiter.go     # Hiz sinirlandirma
│   ├── fingerprint.go      # Parmak izi olusturma
│   ├── usage_checker.go    # Kullanim limiti kontrolu
│   └── proxy_pool.go       # Proxy havuzu
├── config/                 # Yapilandirma sabitleri
│   ├── config.go           # Model esleme ve URL'ler
│   ├── constants.go        # Sabit degerler
│   └── tuning.go           # Performans ayarlari
├── converter/              # Format donusturme
│   ├── codewhisperer.go    # CW istek olusturma
│   ├── openai.go           # OpenAI donusumu
│   ├── content.go          # Icerik isleme
│   └── tools.go            # Arac donusumu
├── parser/                 # Event stream ayristica
│   ├── compliant_event_stream_parser.go
│   ├── robust_parser.go
│   ├── header_parser.go
│   ├── event_stream_types.go
│   ├── tool_lifecycle_manager.go
│   └── thinking_state_machine.go
├── server/                 # HTTP sunucu
│   ├── server.go           # Sunucu baslatma
│   ├── handlers.go         # Istek isleyicileri
│   ├── stream_processor.go # Akim isleme
│   ├── middleware.go       # Ara yazilimlar
│   └── sse_state_manager.go
├── types/                  # Veri tipleri
│   ├── anthropic.go        # Anthropic tipleri
│   ├── codewhisperer.go    # CW tipleri
│   ├── openai.go           # OpenAI tipleri
│   ├── token.go            # Token tipleri
│   └── usage_limits.go     # Kullanim limitleri
├── utils/                  # Yardimci fonksiyonlar
│   ├── client.go           # HTTP istemci
│   ├── token_counter.go    # Token sayaci
│   ├── conversation_id.go  # Konusma ID'si
│   └── image.go            # Goruntu isleme
└── logger/                 # Loglama
    └── logger.go
```

## Kimlik Dogrulama Yontemleri

### 1. Social Authentication (AWS SSO)

Social kimlik dogrulama, Google veya GitHub OAuth ile AWS SSO uzerinden calisir.

**Yapilandirma Formati:**
```json
{
  "auth": "Social",
  "refreshToken": "arn:aws:sso:us-east-1:xxx:token/refresh/xxx"
}
```

**Token Yenileme Endpoint'i:**
```
POST https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken
```

**Istek Yapisi:**
```go
type RefreshRequest struct {
    RefreshToken string `json:"refreshToken"`
}
```

**Yanit Yapisi:**
```go
type RefreshResponse struct {
    AccessToken  string `json:"accessToken"`
    ExpiresIn    int    `json:"expiresIn"`  // saniye cinsinden
    ProfileArn   string `json:"profileArn,omitempty"`
}
```

### 2. IdC Authentication (Identity Center)

AWS Identity Center uzerinden kurumsal kimlik dogrulama.

**Yapilandirma Formati:**
```json
{
  "auth": "IdC",
  "refreshToken": "arn:aws:identitycenter::xxx",
  "clientId": "https://oidc.us-east-1.amazonaws.com/clients/xxx",
  "clientSecret": "xxx-secret-key-xxx"
}
```

**Token Yenileme Endpoint'i:**
```
POST https://oidc.us-east-1.amazonaws.com/token
```

**Istek Yapisi:**
```go
type IdcRefreshRequest struct {
    ClientId     string `json:"clientId"`
    ClientSecret string `json:"clientSecret"`
    GrantType    string `json:"grantType"`     // "refresh_token"
    RefreshToken string `json:"refreshToken"`
}
```

## Token Yonetimi

### Token Manager Mimarisi

```go
type TokenManager struct {
    cache              *SimpleTokenCache
    configs            []AuthConfig
    mutex              sync.RWMutex
    lastRefresh        time.Time
    configOrder        []string         // Token sirasi
    currentIndex       int              // Mevcut token indeksi
    exhausted          map[string]bool  // Tukenmis tokenlar
    rateLimiter        *RateLimiter     // Hiz sinirlandirici
    fingerprintManager *FingerprintManager
}
```

### Token Secim Stratejisi

Sistem "siralı dolaşım" (sequential rotation) stratejisi kullanir:

1. **Sıralı Secim**: Tokenlar yapilandirma sirasina gore secilir
2. **Otomatik Gecis**: Mevcut token tukendiyse bir sonrakine gecer
3. **Sogutma Donemi**: Hata alan tokenlar sogutma donemne girer
4. **Gunluk Limit**: Her token icin gunluk maksimum istek sayisi

### Token Onbellek Yapisi

```go
type CachedToken struct {
    Token     types.TokenInfo
    UsageInfo *types.UsageLimits
    CachedAt  time.Time
    LastUsed  time.Time
    Available float64  // Kalan kullanim hakki
}
```

### Kullanim Limiti Kontrolu

```go
// Kullanim limiti kontrol endpoint'i
GET https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits
    ?isEmailRequired=true
    &origin=AI_EDITOR
    &resourceType=AGENTIC_REQUEST
```

**Yanit Yapisi:**
```go
type UsageLimits struct {
    UsageBreakdownList []UsageBreakdown
    UserInfo           UserInfo
    DaysUntilReset     int
    SubscriptionInfo   SubscriptionInfo
}

type UsageBreakdown struct {
    ResourceType              string
    UsageLimitWithPrecision   float64
    CurrentUsageWithPrecision float64
    FreeTrialInfo             *FreeTrialInfo
}
```

## API Endpoint'leri

### Desteklenen Endpoint'ler

| Endpoint                    | Yontem | Aciklama                 | Kimlik Gerekli |
|-----------------------------|--------|--------------------------|----------------|
| `/`                         | GET    | Dashboard (statik sayfa) | Hayir          |
| `/static/*`                 | GET    | Statik kaynaklar         | Hayir          |
| `/api/tokens`               | GET    | Token havuzu durumu      | Hayir          |
| `/api/anti-ban/status`      | GET    | Engelleme onleme durumu  | Hayir          |
| `/v1/models`                | GET    | Mevcut modeller          | Evet           |
| `/v1/messages`              | POST   | Anthropic API uyumlu     | Evet           |
| `/v1/messages/count_tokens` | POST   | Token sayma              | Evet           |
| `/v1/chat/completions`      | POST   | OpenAI API uyumlu        | Evet           |

### Kimlik Dogrulama

```bash
# Authorization header ile
Authorization: Bearer <KIRO_CLIENT_TOKEN>

# x-api-key header ile
x-api-key: <KIRO_CLIENT_TOKEN>
```

## Model Esleme

| Kullanici Model Adi        | CodeWhisperer Model ID          |
|----------------------------|---------------------------------|
| claude-opus-4-5-20251101   | CLAUDE_OPUS_4_5_20251101_V1_0   |
| claude-sonnet-4-5-20250929 | CLAUDE_SONNET_4_5_20250929_V1_0 |
| claude-sonnet-4-20250514   | CLAUDE_SONNET_4_20250514_V1_0   |
| claude-3-7-sonnet-20250219 | CLAUDE_3_7_SONNET_20250219_V1_0 |
| claude-3-5-haiku-20241022  | auto                            |
| claude-haiku-4-5-20251001  | auto                            |

## Istek/Yanit Formatları

### Anthropic Messages API Istegi

```go
type AnthropicRequest struct {
    Model       string                    `json:"model"`
    MaxTokens   int                       `json:"max_tokens"`
    Messages    []AnthropicRequestMessage `json:"messages"`
    System      []AnthropicSystemMessage  `json:"system,omitempty"`
    Tools       []AnthropicTool           `json:"tools,omitempty"`
    ToolChoice  any                       `json:"tool_choice,omitempty"`
    Stream      bool                      `json:"stream"`
    Temperature *float64                  `json:"temperature,omitempty"`
    Thinking    *Thinking                 `json:"thinking,omitempty"`
}
```

### CodeWhisperer API Istegi

```go
type CodeWhispererRequest struct {
    ConversationState struct {
        AgentContinuationId string
        AgentTaskType       string  // "vibe"
        ChatTriggerType     string  // "MANUAL" veya "AUTO"
        CurrentMessage      struct {
            UserInputMessage struct {
                Content     string
                ModelId     string
                Origin      string  // "AI_EDITOR"
                Images      []CodeWhispererImage
                UserInputMessageContext struct {
                    Tools       []CodeWhispererTool
                    ToolResults []ToolResult
                }
            }
        }
        ConversationId string
        History        []any
    }
    InferenceConfiguration *InferenceConfiguration
}
```

### CodeWhisperer API Endpoint

```
POST https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse
```

## Event Stream Ayristica

### AWS EventStream Formati

```
+----------------+----------------+----------------+----------------+
| Total Length   | Header Length  | Prelude CRC    | Headers        |
| (4 bytes)      | (4 bytes)      | (4 bytes)      | (variable)     |
+----------------+----------------+----------------+----------------+
| Payload                         | Message CRC                     |
| (variable)                      | (4 bytes)                       |
+---------------------------------+---------------------------------+
```

**Minimum Mesaj Boyutu**: 16 byte
**Maksimum Mesaj Boyutu**: 16 MB

### Desteklenen Event Tipleri

| Event Tipi             | Aciklama            |
|------------------------|---------------------|
| assistantResponseEvent | Asistan yaniti      |
| toolCallRequest        | Arac cagrisi istegi |
| toolCallError          | Arac cagrisi hatasi |
| completion             | Tamamlama           |
| completionChunk        | Tamamlama parcasi   |
| sessionStart           | Oturum baslangici   |
| sessionEnd             | Oturum sonu         |
| exception              | Istisna             |

### CRC Dogrulama

```go
// Prelude CRC (ilk 8 byte icin)
preludeCRC := crc32.Checksum(data[:8], crc32.MakeTable(crc32.IEEE))

// Message CRC (son 4 byte haric tum mesaj icin)
messageCRC := crc32.Checksum(data[:payloadEnd], crc32.MakeTable(crc32.IEEE))
```

## Thinking (Derin Dusunme) Modu

### Yapilandirma

```go
type Thinking struct {
    Type         string `json:"type"`          // "enabled" veya "disabled"
    BudgetTokens int    `json:"budget_tokens"` // 1024-24576 arasi
}
```

### Varsayilan Degerler

| Parametre  | Deger |
|------------|-------|
| Minimum    | 1024  |
| Varsayilan | 20000 |
| Maksimum   | 24576 |

### Uyumlu Modeller

- claude-3-7-sonnet-20250219
- claude-sonnet-4-20250514
- claude-sonnet-4-5-20250929
- claude-opus-4-5-20251101

### Thinking Etiketi Enjeksiyonu

```go
// Sistem mesajina enjekte edilir
prefix := "<thinking_mode>enabled</thinking_mode><max_thinking_length>20000</max_thinking_length>"
```

## Hiz Sinirlandirma (Rate Limiting)

### Yapilandirma Parametreleri

| Parametre                    | Varsayilan | Cevre Degiskeni                |
|------------------------------|------------|--------------------------------|
| Token minimum araligi        | 10s        | RATE_LIMIT_MIN_INTERVAL        |
| Token maksimum araligi       | 30s        | RATE_LIMIT_MAX_INTERVAL        |
| Global minimum araligi       | 5s         | RATE_LIMIT_GLOBAL_MIN_INTERVAL |
| Maksimum ardisik kullanim    | 10         | RATE_LIMIT_MAX_CONSECUTIVE     |
| Sogutma suresi               | 5m         | RATE_LIMIT_COOLDOWN            |
| Exponential backoff temeli   | 2m         | RATE_LIMIT_BACKOFF_BASE        |
| Exponential backoff maksimum | 60m        | RATE_LIMIT_BACKOFF_MAX         |
| Backoff carpani              | 2.0        | RATE_LIMIT_BACKOFF_MULTIPLIER  |
| Gunluk maksimum istek        | 500        | RATE_LIMIT_DAILY_MAX           |
| Jitter yuzdesi               | 30         | RATE_LIMIT_JITTER_PERCENT      |
| Askiya alinan token sogutma  | 24h        | SUSPENDED_TOKEN_COOLDOWN       |

### Token Durum Yapisi

```go
type TokenState struct {
    LastRequest    time.Time
    RequestCount   int
    CooldownEnd    time.Time
    FailCount      int
    DailyRequests  int
    DailyResetTime time.Time
    IsSuspended    bool
    SuspendedAt    time.Time
    SuspendReason  string
}
```

### Exponential Backoff Formulu

```go
backoff := backoffBase * (backoffMultiplier ^ (failCount - 1))
jitter := rand.Float64() * 0.2 * backoff
finalBackoff := min(backoff + jitter, backoffMax)
```

## Parmak Izi Yonetimi (Anti-Ban)

### Parmak Izi Yapisi

```go
type Fingerprint struct {
    // Temel bilgiler
    SDKVersion          string
    OSType              string   // darwin, windows, linux
    OSVersion           string
    NodeVersion         string
    KiroVersion         string
    KiroHash            string   // 64 karakter hex

    // HTTP basliklari
    AcceptLanguage      string
    AcceptEncoding      string
    SecFetchMode        string
    SecFetchSite        string
    SecFetchDest        string
    ConnectionBehavior  string   // keep-alive veya close

    // Ek boyutlar
    ScreenResolution    string
    ColorDepth          int
    Platform            string
    DeviceMemory        int
    HardwareConcurrency int
    TimezoneOffset      int
    DoNotTrack          string
    CacheControl        string
}
```

### User-Agent Formati

```go
// User-Agent
fmt.Sprintf(
    "aws-sdk-js/%s ua/2.1 os/%s#%s lang/js md/nodejs#%s api/codewhispererstreaming#%s m/E KiroIDE-%s-%s",
    fp.SDKVersion, fp.OSType, fp.OSVersion, fp.NodeVersion, fp.SDKVersion, fp.KiroVersion, fp.KiroHash,
)

// x-amz-user-agent
fmt.Sprintf("aws-sdk-js/%s KiroIDE-%s-%s", fp.SDKVersion, fp.KiroVersion, fp.KiroHash)
```

### Desteklenen OS Profilleri

| OS      | Surum Ornekleri                        | Platformlar  |
|---------|----------------------------------------|--------------|
| darwin  | 23.0.0, 23.1.0, 24.0.0, 24.5.0, 25.0.0 | MacIntel     |
| windows | 10.0.19041, 10.0.22000, 10.0.22621     | Win32        |
| linux   | 5.15.0, 6.1.0, 6.5.0, 6.8.0            | Linux x86_64 |

## Hata Yonetimi

### Hata Turleri

| Hata Kodu | Aciklama        | Isleme Stratejisi            |
|-----------|-----------------|------------------------------|
| 403       | Yetkisiz erisim | Token sogutma, sonraki token |
| 429       | Cok fazla istek | Exponential backoff          |
| 400       | Gecersiz istek  | Mesaj sikistirma             |
| 500       | Sunucu hatasi   | Yeniden deneme               |

### Askiya Alma Algilama

```go
// TEMPORARILY_SUSPENDED hatasi kontrolu
if strings.Contains(errorMsg, "TEMPORARILY_SUSPENDED") ||
   strings.Contains(errorMsg, "temporarily is suspended") {
    rateLimiter.MarkTokenSuspended(tokenKey, errorMsg)
}
```

### Stop Reason Esleme

| Dahili Durum          | Claude Stop Reason |
|-----------------------|--------------------|
| Normal tamamlama      | end_turn           |
| Arac cagrisi          | tool_use           |
| Maksimum token        | max_tokens         |
| Icerik uzunlugu asimi | max_tokens         |

## Proxy Havuzu

### Yapilandirma

```bash
PROXY_POOL=http://127.0.0.1:40000,http://127.0.0.1:40001,http://127.0.0.1:40002
```

### Desteklenen Formatlar

- `http://ip:port`
- `http://user:pass@ip:port`
- `socks5://ip:port`

### Proxy Havuzu Ozellikleri

- **Rastgele Secim**: Tek bir proxy'nin asiri kullanilmasindan kacinir
- **Kullanim Limiti**: Her proxy maksimum 10 kez kullanilir
- **Saglik Kontrolu**: Periyodik olarak proxy'lerin erisilebilirligi dogrulanir
- **Hata Isaretleme**: Ardisik 3 hata sonrasi sagliksiz olarak isaretlenir
- **Otomatik Kurtarma**: 60 saniye sogutma sonrasi yeniden denenir

## Ortam Degiskenleri

### Zorunlu

| Degisken          | Aciklama                                    |
|-------------------|---------------------------------------------|
| KIRO_AUTH_TOKEN   | Token yapilandirmasi (JSON veya dosya yolu) |
| KIRO_CLIENT_TOKEN | API erisim anahtari                         |

### Opsiyonel

| Degisken        | Varsayilan | Aciklama                      |
|-----------------|------------|-------------------------------|
| PORT            | 8080       | Sunucu portu                  |
| GIN_MODE        | release    | Gin modu (debug/release/test) |
| LOG_LEVEL       | info       | Log seviyesi                  |
| LOG_FORMAT      | json       | Log formati (text/json)       |
| LOG_FILE        | -          | Log dosya yolu                |
| LOG_CONSOLE     | true       | Konsol ciktisi                |
| TOKEN_CACHE_TTL | 5m         | Token onbellek suresi         |

## Guvenlik Ozellikleri

### Engelleme Onleme Mekanizmalari

1. **Istek Parmak Izi Rastgelestirme**
   - Her token benzersiz istemci parmak izine sahip
   - UA, dil, zaman dilimi, ekran cozunurlugu vb. icerir
   - Parmak izi token yasam suresi boyunca tutarli kalir

2. **Akilli Istek Araligi**
   - 10-30 saniye arasi rastgele aralik
   - Ekstra %30 rastgele jitter
   - Insan islem ritmini taklit eder

3. **Akilli Token Dolasimi**
   - Kalan kotaya dayali agirlikli secim
   - 10 ardisik kullanimdan sonra otomatik gecis
   - Tek token asiri kullanilmasindan kacinir

4. **Exponential Backoff**
   - 403/429 hatasi sonrasi tetiklenir
   - 1. hata: 2 dakika bekle
   - 2. hata: 4 dakika bekle
   - 3. hata: 8 dakika bekle
   - Maksimum 60 dakika

5. **Gunluk Istek Limiti**
   - Her token gunluk maksimum 500 istek
   - UTC 00:00'da otomatik sifirlama

## Arac (Tool) Yonetimi

### Arac Donusumu

```go
type AnthropicTool struct {
    Name        string         `json:"name"`
    Description string         `json:"description"`
    InputSchema map[string]any `json:"input_schema"`
}

// CodeWhisperer formatina donusum
type CodeWhispererTool struct {
    ToolSpecification struct {
        Name        string      `json:"name"`
        Description string      `json:"description"`
        InputSchema InputSchema `json:"inputSchema"`
    }
}
```

### Desteklenmeyen Araclar

Asagidaki araclar sessizce filtrelenir:
- `web_search`
- `websearch`

### Arac Sonucu Yapisi

```go
type ToolResult struct {
    ToolUseId string           `json:"toolUseId"`
    Content   []map[string]any `json:"content"`
    Status    string           `json:"status"`  // "success" veya "error"
    IsError   bool             `json:"isError,omitempty"`
}
```

## Performans Optimizasyonlari

### JSON Isleme

ByteDance Sonic kutuphanesi yuksek performansli JSON islemleri icin kullanilir:
- Standart `encoding/json`'dan daha hizli
- SIMD optimizasyonlari
- Dusuk bellek ayirma

### HTTP Istemci

```go
// Paylasilan HTTP istemci ayarlari
var SharedHTTPClient = &http.Client{
    Timeout: 5 * time.Minute,
    Transport: &http.Transport{
        KeepAlive:             30 * time.Second,
        TLSHandshakeTimeout:   15 * time.Second,
        DisableKeepAlives:     false,
    },
}
```

### Token Sayimi

Sistem iki katmanli token sayimi kullanir:
1. **Resmi API**: `/v1/messages/count_tokens` endpoint'i
2. **Yerel Tahmin**: Tiktoken kutuphanesi ile fallback

## Sonuc

kiro2api-nineyuanz projesi, AWS CodeWhisperer API'sini standart Anthropic/OpenAI formatina donusturmek icin kapsamli bir cozum sunmaktadir. Temel ozellikleri sunlardir:

1. **Coklu Kimlik Dogrulama**: Social ve IdC yontemlerinin her ikisini de destekler
2. **Token Havuzu Yonetimi**: Siralı dolasim ve otomatik failover
3. **Engelleme Onleme**: Parmak izi rastgelestirme ve akilli hiz sinirlandirma
4. **Guclu Event Stream Ayristica**: AWS EventStream formatinin tam destegi
5. **Thinking Modu**: Claude derin dusunme ozelligi destegi
6. **Arac Cagrisi**: Tam Anthropic arac kullanim protokolu destegi

Proje, uretim ortamlarinda guvenilir calisma icin tasarlanmis olup, coklu token yonetimi, otomatik hata kurtarma ve kapsamli loglama ozellikleri sunmaktadir.
