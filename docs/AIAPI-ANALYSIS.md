# AIAPI Kiro Modulu Analizi

Bu dokuman, [imbuxiangnan-cyber/aiapi](https://github.com/imbuxiangnan-cyber/aiapi) deposundaki Kiro (AWS CodeWhisperer) modulunun kapsamli teknik analizini icermektedir.

---

## Genel Bakis

| Ozellik                 | Deger                                           |
|-------------------------|-------------------------------------------------|
| Repository              | github.com/imbuxiangnan-cyber/aiapi             |
| Versiyon                | 1.0.2                                           |
| Dil                     | TypeScript                                      |
| Runtime                 | Bun / Node.js                                   |
| Framework               | Hono (HTTP server)                              |
| Varsayilan Port         | 4141                                            |
| Lisans                  | MIT                                             |
| Kiro API Endpoint       | codewhisperer.us-east-1.amazonaws.com           |
| Desteklenen Protokoller | OpenAI Chat Completions, Anthropic Messages API |

### Desteklenen Platformlar

| Platform           | Mod Flag         | Aciklama                            |
|--------------------|------------------|-------------------------------------|
| GitHub Copilot     | (varsayilan)     | GitHub Copilot aboneligi gerektirir |
| OpenCode Zen       | `--zen`, `-z`    | Zen API anahtari gerektirir         |
| Google Antigravity | `--antigravity`  | Google hesabi gerektirir            |
| AWS Kiro           | `--kiro`, `-k`   | CodeWhisperer erisimi gerektirir    |
| Factory AI Droids  | `--droids`, `-d` | Droids API anahtari gerektirir      |

---

## Dosya Yapisi

```
src/services/kiro/
├── api.ts            # Ana API istegi fonksiyonu
├── auth.ts           # Kimlik dogrulama yapilandirmasi ve token yenileme URL'leri
├── models.ts         # Model eslestirme ve listeleme
├── token-manager.ts  # Token havuzu yonetimi ve otomatik yenileme
└── routes/
    ├── index.ts      # Route disa aktarimlari
    ├── chat.ts       # /chat/completions endpoint'i
    ├── messages.ts   # /messages endpoint'i (Anthropic uyumlu)
    └── models.ts     # /models endpoint'i
```

---

## Kimlik Dogrulama (Authentication)

### Desteklenen Yontemler

| Yontem | Aciklama                        | Gerekli Parametreler                       |
|--------|---------------------------------|--------------------------------------------|
| Social | Google/GitHub OAuth via AWS SSO | `refreshToken`                             |
| IdC    | IAM Identity Center             | `refreshToken`, `clientId`, `clientSecret` |

### Kimlik Dogrulama Yapilandirmasi

```typescript
interface KiroAuthConfig {
  auth: "Social" | "IdC"      // Kimlik dogrulama yontemi
  refreshToken: string        // Yenileme token'i
  clientId?: string           // IdC icin zorunlu
  clientSecret?: string       // IdC icin zorunlu
  disabled?: boolean          // Hesabi devre disi birak
  description?: string        // Opsiyonel aciklama
}
```

### Token Bilgi Yapisi

```typescript
interface KiroTokenInfo {
  accessToken: string   // Erisim token'i
  refreshToken: string  // Yenileme token'i
  expiresIn: number     // Gecerlilik suresi (saniye)
  expiresAt: Date       // Son kullanim tarihi
}
```

### Token Dosya Konumu

```
~/.local/share/copilot-api-plus/kiro-auth.json
```

---

## Token Yenileme (Refresh)

### API Endpoint'leri

| Yontem | URL                                                         |
|--------|-------------------------------------------------------------|
| Social | `https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken` |
| IdC    | `https://oidc.us-east-1.amazonaws.com/token`                |

### Social Token Yenileme

```typescript
// POST https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken
// Content-Type: application/json

// Request Body:
{
  "refreshToken": "<refresh_token>"
}

// Response:
{
  "accessToken": "<access_token>",
  "expiresIn": 3600
}
```

### IdC Token Yenileme

```typescript
// POST https://oidc.us-east-1.amazonaws.com/token
// Content-Type: application/json
// Host: oidc.us-east-1.amazonaws.com

// Request Body:
{
  "client_id": "<client_id>",
  "client_secret": "<client_secret>",
  "grant_type": "refresh_token",
  "refresh_token": "<refresh_token>"
}

// Response:
{
  "access_token": "<access_token>",
  "expires_in": 3600
}
```

---

## Token Yonetimi (Token Manager)

### KiroTokenManager Sinifi

Token havuzu yonetimi icin singleton sinif:

```typescript
class KiroTokenManager {
  private tokens: Array<CachedToken> = []
  private currentIndex = 0

  async initialize(): Promise<void>
  async getToken(): Promise<string>
  private async ensureValidToken(cached: CachedToken): Promise<KiroTokenInfo>
  private async refreshToken(config: KiroAuthConfig): Promise<KiroTokenInfo>
  getStatus(): TokenPoolStatus
}
```

### CachedToken Yapisi

```typescript
interface CachedToken {
  config: KiroAuthConfig    // Hesap yapilandirmasi
  token: KiroTokenInfo | null // Mevcut token
  lastUsed: Date            // Son kullanim zamani
  usageCount: number        // Kullanim sayaci
  errorCount: number        // Hata sayaci (max 3)
}
```

### Token Secim Algoritmasi

1. Tum token'lar uzerinde donguyle kontrol edilir
2. Hata sayisi 3'ten az olan ilk gecerli token secilir
3. Token suresi dolmussa otomatik yenileme yapilir
4. Tum token'lar tukenmisse hatalar sifirlenir ve tekrar denenir

---

## API Endpoint'leri

### Ana CodeWhisperer Endpoint'i

```
POST https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse
```

### Request Header'lari

| Header        | Deger                                                        |
|---------------|--------------------------------------------------------------|
| Content-Type  | `application/json`                                           |
| Authorization | `Bearer <access_token>`                                      |
| x-amz-target  | `AmazonQDeveloperStreamingService.GenerateAssistantResponse` |

### Request Body Formati

```typescript
{
  "conversationState": {
    "currentMessage": {
      "userInputMessage": {
        "content": "<mesaj_icerigi>"
      }
    },
    "chatTriggerType": "MANUAL"
  },
  "profileArn": "arn:aws:codewhisperer:us-east-1:aws:profile/default"
}
```

---

## Kiro Route'lari

### Kiro-Spesifik Route'lar (Her Zaman Aktif)

| Route                       | Metod | Aciklama               |
|-----------------------------|-------|------------------------|
| `/kiro/v1/chat/completions` | POST  | Chat tamamlama         |
| `/kiro/v1/models`           | GET   | Model listesi          |
| `/kiro/v1/messages`         | POST  | Anthropic uyumlu mesaj |

### Mod-Tabanli Dinamik Route'lar

Kiro modu aktifken (`--kiro` veya `-k`), asagidaki route'lar Kiro'ya yonlendirilir:

| Route                  | Metod | Aciklama               |
|------------------------|-------|------------------------|
| `/v1/chat/completions` | POST  | Chat tamamlama         |
| `/chat/completions`    | POST  | Chat tamamlama         |
| `/v1/models`           | GET   | Model listesi          |
| `/models`              | GET   | Model listesi          |
| `/v1/messages`         | POST  | Anthropic uyumlu mesaj |

---

## Model Eslestirme

### Desteklenen Modeller

| Harici Model Adi                    | Dahili CodeWhisperer ID                  |
|-------------------------------------|------------------------------------------|
| claude-opus-4-5                     | CLAUDE_OPUS_4_5_V1_0                     |
| claude-opus-4-5-20251101            | CLAUDE_OPUS_4_5_20251101_V1_0            |
| claude-opus-4-5-thinking            | CLAUDE_OPUS_4_5_THINKING_V1_0            |
| claude-opus-4-5-20251101-thinking   | CLAUDE_OPUS_4_5_20251101_THINKING_V1_0   |
| claude-sonnet-4-5                   | CLAUDE_SONNET_4_5_V1_0                   |
| claude-sonnet-4-5-20250929          | CLAUDE_SONNET_4_5_20250929_V1_0          |
| claude-sonnet-4-5-thinking          | CLAUDE_SONNET_4_5_THINKING_V1_0          |
| claude-sonnet-4-5-20250929-thinking | CLAUDE_SONNET_4_5_20250929_THINKING_V1_0 |
| claude-haiku-4-5                    | CLAUDE_HAIKU_4_5_V1_0                    |
| claude-haiku-4-5-20251001           | CLAUDE_HAIKU_4_5_20251001_V1_0           |
| claude-opus-4-1                     | CLAUDE_OPUS_4_1_V1_0                     |
| claude-opus-4-1-20250805            | CLAUDE_OPUS_4_1_20250805_V1_0            |
| claude-opus-4-1-thinking            | CLAUDE_OPUS_4_1_THINKING_V1_0            |
| claude-opus-4-1-20250805-thinking   | CLAUDE_OPUS_4_1_20250805_THINKING_V1_0   |
| claude-opus-4                       | CLAUDE_OPUS_4_V1_0                       |
| claude-opus-4-20250514              | CLAUDE_OPUS_4_20250514_V1_0              |
| claude-opus-4-thinking              | CLAUDE_OPUS_4_THINKING_V1_0              |
| claude-opus-4-20250514-thinking     | CLAUDE_OPUS_4_20250514_THINKING_V1_0     |
| claude-sonnet-4                     | CLAUDE_SONNET_4_V1_0                     |
| claude-sonnet-4-20250514            | CLAUDE_SONNET_4_20250514_V1_0            |
| claude-sonnet-4-thinking            | CLAUDE_SONNET_4_THINKING_V1_0            |
| claude-sonnet-4-20250514-thinking   | CLAUDE_SONNET_4_20250514_THINKING_V1_0   |
| claude-3-5-sonnet                   | CLAUDE_3_5_SONNET_V1_0                   |
| claude-3-5-sonnet-20241022          | CLAUDE_3_5_SONNET_20241022_V1_0          |
| claude-3-5-haiku                    | CLAUDE_3_5_HAIKU_V1_0                    |
| claude-3-5-haiku-20241022           | CLAUDE_3_5_HAIKU_20241022_V1_0           |

### Dinamik Model Eslestirme

Statik eslestirmede bulunmayan modeller icin dinamik donusum uygulanir:

```typescript
function mapModelToKiroInternal(model: string): string {
  if (model.startsWith("claude-")) {
    // claude-opus-4-5-20251101-thinking -> CLAUDE_OPUS_4_5_20251101_THINKING_V1_0
    return model.toUpperCase().replaceAll("-", "_") + "_V1_0"
  }
  return model
}
```

### Model Alias'lari

| Alias             | Standart Ad       |
|-------------------|-------------------|
| claude-4.5-opus   | claude-opus-4-5   |
| claude-4.5-sonnet | claude-sonnet-4-5 |
| claude-4.5-haiku  | claude-haiku-4-5  |
| claude-4-opus     | claude-opus-4     |
| claude-4-sonnet   | claude-sonnet-4   |
| claude-3.5-sonnet | claude-3-5-sonnet |
| claude-3.5-haiku  | claude-3-5-haiku  |

---

## Request/Response Formatlari

### OpenAI Uyumlu Chat Request

```typescript
interface KiroChatRequest {
  model: string                        // Model adi
  messages: Array<KiroMessage>         // Mesaj dizisi
  max_tokens?: number                  // Maksimum token
  temperature?: number                 // Sicaklik parametresi
  stream?: boolean                     // Streaming modu
}

interface KiroMessage {
  role: "user" | "assistant"
  content: string
}
```

### Streaming Response

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### Non-Streaming Response

```
Content-Type: application/json
```

---

## Hata Yonetimi

### Token Hatasi Isleme

```typescript
// Token yenileme basarisiz oldugunda:
// 1. Hata sayaci arttirilir
// 2. 3 hatadan sonra token "exhausted" olarak isaretlenir
// 3. Bir sonraki token'a gecilir
// 4. Tum token'lar tukenmisse hatalar sifirlanir

if (cached.errorCount >= 3) continue
try {
  const token = await this.ensureValidToken(cached)
  // ...
} catch {
  cached.errorCount++
  consola.warn(`Token ${idx} failed, trying next`)
}
```

### HTTP Hata Yaniti

```typescript
class HTTPError extends Error {
  response: Response
  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

// Hata yaniti formati:
{
  "error": {
    "message": "<hata_mesaji>",
    "type": "error"
  }
}
```

### Route Seviyesinde Hata Isleme

```typescript
// Chat route hatasi
try {
  const response = await createKiroChatCompletion(body)
  if (!response.ok) {
    const text = await response.text()
    consola.error("Kiro API error:", text)
    return c.json({ error: text }, response.status as 400)
  }
  // ...
} catch (error) {
  consola.error("Kiro chat error:", error)
  return c.json({ error: String(error) }, 500)
}
```

---

## Yapilandirma (Configuration)

### Ortam Degiskenleri

Bu proje icin ozel ortam degiskenleri bulunmamaktadir. Yapilandirma dosyalar uzerinden yapilir.

### Komut Satiri Parametreleri

| Parametre       | Alias | Varsayilan | Aciklama                           |
|-----------------|-------|------------|------------------------------------|
| `--kiro`        | `-k`  | false      | Kiro modunu etkinlestir            |
| `--port`        | `-p`  | 4141       | Sunucu portu                       |
| `--verbose`     | `-v`  | false      | Detayli loglama                    |
| `--claude-code` | `-c`  | false      | Claude Code baslat komutu olustur  |
| `--rate-limit`  | `-r`  | -          | Istekler arasi bekleme (saniye)    |
| `--wait`        | `-w`  | false      | Rate limit'te bekle, hata verme    |
| `--proxy-env`   |       | false      | Proxy'yi ortam degiskenlerinden al |

### Veri Depolama Konumlari

| Dosya     | Konum                                            | Aciklama                 |
|-----------|--------------------------------------------------|--------------------------|
| Kiro Auth | `~/.local/share/copilot-api-plus/kiro-auth.json` | Kimlik dogrulama bilgisi |
| Config    | `~/.local/share/copilot-api-plus/config.json`    | Genel yapilandirma       |

---

## Multi-Platform Rotasyon

### Rotasyon Yapilandirmasi

```typescript
interface RotationConfig {
  enabled: boolean              // Rotasyon aktif mi
  platforms: Array<Platform>    // Katilan platformlar
  currentIndex: number          // Mevcut platform indeksi
  failedPlatforms: Set<Platform>// Basarisiz platformlar
}
```

### Rotasyon API'si

```typescript
// Rotasyonu etkinlestir
enableRotation(["kiro", "antigravity", "droids"])

// Rotasyonu devre disi birak
disableRotation()

// Platformu basarisiz olarak isaretle
markPlatformFailed("kiro")

// Basarisiz platformlari sifirla
resetFailedPlatforms()
```

### Platform Secim Onceligi

1. Manuel eslestirme (varsa)
2. Rotasyon modu (aktifse)
3. Aktif platform (modeli destekliyorsa)
4. Onerilen platform (model tipine gore)
5. Varsayilan olarak aktif platform

---

## Coklu Hesap Yonetimi

### Hesap Havuzu Yapisi

```typescript
class TokenPool {
  private tokens: Map<string, CachedToken> = new Map()
  private tokenOrder: Array<string> = []
  private currentIndex = 0

  getBestToken(): TokenConfig | null
  markExhausted(token: string): void
  markError(token: string): void
  getStatus(): TokenPoolStatus
}
```

### Hesap Secim Mantigi

1. Siradaki token kontrol edilir
2. Tukenmemis ve hata sayisi < 3 ise kullanilir
3. Aksi halde bir sonraki token'a gecilir
4. Tum token'lar tukenmisse havuz sifirlanir

---

## Izleme ve Durum Kontrol

### Token Pool Durumu

```typescript
interface TokenPoolStatus {
  totalTokens: number
  currentIndex: number
  tokens: Array<{
    name: string
    usageCount: number
    isExhausted: boolean
    errorCount: number
    lastUsed: string
  }>
}
```

### Kiro Token Durumu

```typescript
// kiroTokenManager.getStatus() donusu:
{
  totalTokens: number,
  currentIndex: number,
  tokens: Array<{
    index: number,
    auth: "Social" | "IdC",
    usageCount: number,
    errorCount: number,
    hasValidToken: boolean
  }>
}
```

---

## Kurulum ve Baslangic

### NPX ile Hizli Baslangic

```bash
# Kiro modu ile baslatma
npx aiapi-server start --kiro

# Claude Code entegrasyonu ile
npx aiapi-server start --kiro --claude-code
```

### Kaynak Koddan Calistirma

```bash
# Depoyu klonla
git clone https://github.com/imbuxiangnan-cyber/aiapi.git
cd aiapi

# Bagimliliklari yukle
bun install

# Gelistirme modu
bun run dev

# Kiro modu ile uretim
bun run start --kiro
```

### Ilk Kurulum Adlari

1. `aiapi start --kiro` komutunu calistirin
2. Kimlik dogrulama yontemi secin (Social veya IdC)
3. Refresh token girisini yapin
4. IdC icin client ID ve secret girisini yapin
5. Token otomatik olarak kaydedilir

---

## Guvenlik Notlari

1. Refresh token'lar yerel dosyada saklanir (`kiro-auth.json`)
2. Token dosyasi 0o600 izinleriyle olusturulur (sadece kullanici okuyabilir)
3. Access token'lar bellekte tutulur, diske yazilmaz
4. Proxy ayarlari ortam degiskenlerinden veya yapilandirma dosyasindan okunabilir

---

## Karsilastirma: Kiro Modulu vs Bizim Uygulamamiz

| Ozellik          | AIAPI Kiro Modulu        | Bizim Uygulama              |
|------------------|--------------------------|-----------------------------|
| Dil              | TypeScript (Bun)         | JavaScript (Node.js)        |
| HTTP Framework   | Hono                     | Express                     |
| Token Saklama    | JSON dosya               | MySQL veritabani            |
| Coklu Hesap      | Bellek ici havuz         | Veritabani ile havuz        |
| Token Yenileme   | Istek sirasinda          | Zamanlayici ile proaktif    |
| Hata Yonetimi    | Hata sayaci (max 3)      | error_credentials tablosu   |
| Kimlik Dogrulama | Social, IdC              | Social, Builder ID, IdC     |
| Model Eslestirme | Dinamik donusum          | Statik eslestirme + dinamik |
| Rate Limiting    | Komut satiri parametresi | Dahili middleware           |
| Izleme           | Endpoint bazli           | Web konsolu + API logs      |

---

## Sonuc

AIAPI'nin Kiro modulu, AWS CodeWhisperer API'sine erisim icin saglam bir cozum sunmaktadir. Temel ozellikleri:

- **Cift Protokol Destegi**: Hem OpenAI hem de Anthropic API formatlarini destekler
- **Token Havuzu**: Coklu hesap destegi ile otomatik token yonetimi
- **Model Eslestirme**: Esnek model adi donusumu
- **Hata Toleransi**: Otomatik yedekleme ve hata sayaci mekanizmasi
- **Platform Rotasyonu**: Coklu platform arasinda yuk dengeleme

Bu analiz, mevcut uygulamamizi gelistirmek veya yeni ozellikler eklemek icin referans olarak kullanilabilir.
