# Kiro2API-Node Analizi

Bu dokuman, [Kiro2api-Node](https://github.com/lulistart/Kiro2api-Node) projesinin kapsamli bir teknik analizini icermektedir. Proje, Node.js ile yazilmis olup Kiro API'sini Anthropic Claude API ve OpenAI API uyumlu arayuzlere donusturmektedir.

## Genel Bakis

| Ozellik                  | Deger                                                                 |
|--------------------------|-----------------------------------------------------------------------|
| Proje Adi                | Kiro2api-Node                                                         |
| Programlama Dili         | JavaScript (Node.js)                                                  |
| Web Framework            | Express.js                                                            |
| HTTP Istemcisi           | node-fetch                                                            |
| Lisans                   | MIT                                                                   |
| Varsayilan Port          | 8080                                                                  |
| Varsayilan Region        | us-east-1                                                             |
| API Uyumlulugu           | Anthropic + OpenAI                                                    |

## Mimari Yapisi

```
Kiro2api-Node/
├── src/
│   ├── index.js              # Ana giris noktasi ve Express sunucu
│   ├── kiro-client.js        # Kiro API istemcisi
│   ├── token.js              # Token yonetimi (TokenManager)
│   ├── event-parser.js       # AWS Event Stream ayrıştirici
│   ├── pool.js               # Hesap havuzu yonetimi (AccountPool)
│   ├── settings.js           # Ayar yonetimi (SettingsManager)
│   ├── usage.js              # Kota sorgulama
│   ├── routes/
│   │   ├── api.js            # API endpoint'leri (/v1/*)
│   │   ├── admin.js          # Yonetim endpoint'leri (/api/*)
│   │   └── ui.js             # Web arayuzu route'lari
│   └── public/               # Statik dosyalar (Web UI)
├── data/                     # Veri depolama dizini
├── package.json              # Bagimliliklar ve script'ler
├── Dockerfile                # Docker imaji tanimi
└── docker-compose.yml        # Docker Compose yapilandirmasi
```

## Kimlik Dogrulama Yontemleri

Proje iki farkli kimlik dogrulama yontemini desteklemektedir:

### 1. Social Auth

Google veya GitHub OAuth kullanarak kimlik dogrulama.

| Alan          | Tip     | Zorunlu | Aciklama                          |
|---------------|---------|---------|-----------------------------------|
| refreshToken  | String  | Evet    | OAuth yenileme tokeni             |
| authMethod    | String  | Evet    | "social" degeri                   |

**Token Yenileme Endpoint'i:**
```
POST https://prod.{region}.auth.desktop.kiro.dev/refreshToken
```

**Istek Yapisi:**
```json
{
  "refreshToken": "xxxxx"
}
```

**Yanit Yapisi:**
```json
{
  "accessToken": "xxxxx",
  "refreshToken": "xxxxx",
  "profileArn": "arn:aws:sso::xxxx:profile/xxxx",
  "expiresIn": 3600
}
```

### 2. IAM Identity Center (IDC) / Builder ID

AWS SSO OIDC protokolu kullanarak kimlik dogrulama.

| Alan          | Tip     | Zorunlu | Aciklama                          |
|---------------|---------|---------|-----------------------------------|
| refreshToken  | String  | Evet    | OAuth yenileme tokeni             |
| authMethod    | String  | Evet    | "idc" degeri                      |
| clientId      | String  | Evet    | OIDC istemci kimlik numarasi      |
| clientSecret  | String  | Evet    | OIDC istemci sifresi              |

**Token Yenileme Endpoint'i:**
```
POST https://oidc.{region}.amazonaws.com/token
```

**Istek Yapisi:**
```json
{
  "clientId": "xxxxx",
  "clientSecret": "xxxxx",
  "refreshToken": "xxxxx",
  "grantType": "refresh_token"
}
```

**Yanit Yapisi:**
```json
{
  "accessToken": "xxxxx",
  "refreshToken": "xxxxx",
  "expiresIn": 3600
}
```

## Token Yonetimi

### TokenManager Sinifi

Token yonetiminden sorumlu ana sinif.

| Metot                  | Aciklama                                           |
|------------------------|----------------------------------------------------|
| constructor()          | Yapilandirma ve kimlik bilgileri ile olusturur     |
| ensureValidToken()     | Gecerli token saglar, gerekirse yeniler            |
| refreshToken()         | Token yenileme islemini baslatir                   |

### Token Gecerlilik Kontrolu

Token, son kullanma tarihinden 5 dakika once yenilenmeye hazir sayilir.

```javascript
// Token 5 dakika icerisinde sona erecekse yenilenir
if (token expires more than 5 minutes in the future) {
  return currentToken;
} else {
  return refreshToken();
}
```

### Machine ID Uretimi

Her istemci icin rastgele 64 karakter hex kimlik uretilir:

```javascript
crypto.randomBytes(32).toString('hex')
```

## API Endpoint'leri

### Anthropic Uyumlu API

| Endpoint                     | Metot | Aciklama                          |
|------------------------------|-------|-----------------------------------|
| /v1/models                   | GET   | Mevcut model listesini getirir    |
| /v1/messages                 | POST  | Mesaj olusturur (Anthropic format)|

### OpenAI Uyumlu API

| Endpoint                     | Metot | Aciklama                          |
|------------------------------|-------|-----------------------------------|
| /v1/chat/completions         | POST  | Chat completions (OpenAI format)  |

### Yonetim API'si

| Endpoint                     | Metot  | Aciklama                          |
|------------------------------|--------|-----------------------------------|
| /api/status                  | GET    | Servis durumunu getirir           |
| /api/accounts                | GET    | Hesap listesini getirir           |
| /api/accounts                | POST   | Yeni hesap ekler                  |
| /api/accounts/import         | POST   | Toplu hesap aktarimi              |
| /api/accounts/:id            | DELETE | Hesabi siler                      |
| /api/accounts/batch          | DELETE | Toplu hesap silme                 |
| /api/accounts/:id/enable     | POST   | Hesabi etkinlestirir              |
| /api/accounts/:id/disable    | POST   | Hesabi devre disi birakir         |
| /api/accounts/:id/refresh-usage | POST | Hesap kotasini yeniler          |
| /api/accounts/refresh-all-usage | POST | Tum hesap kotalarini yeniler    |
| /api/strategy                | GET    | Mevcut stratejiyi getirir         |
| /api/strategy                | POST   | Stratejiyi degistirir             |
| /api/logs                    | GET    | Istek kayitlarini getirir         |
| /api/logs                    | DELETE | Istek kayitlarini temizler        |
| /api/logs/stats              | GET    | Istek istatistiklerini getirir    |
| /api/settings/admin-key      | POST   | Admin anahtarini degistirir       |
| /api/settings/api-keys       | GET    | API anahtarlarini listeler        |
| /api/settings/api-keys       | POST   | Yeni API anahtari ekler           |
| /api/settings/api-keys       | DELETE | API anahtarini siler              |

### Kiro API Endpoint'i

```
POST https://q.{region}.amazonaws.com/generateAssistantResponse
```

## Istek/Yanit Formatlari

### Anthropic Messages Istegi

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "stream": true,
  "messages": [
    {"role": "user", "content": "Merhaba!"}
  ],
  "system": "Sen yardimci bir asistansin.",
  "tools": [...],
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

### OpenAI Chat Completions Istegi

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "stream": true,
  "messages": [
    {"role": "system", "content": "Sen yardimci bir asistansin."},
    {"role": "user", "content": "Merhaba!"}
  ],
  "tools": [...]
}
```

### Kiro Istek Donusumu

Anthropic/OpenAI istegi Kiro formatina donusturulur:

```json
{
  "conversationState": {
    "conversationId": "uuid",
    "agentContinuationId": "uuid",
    "agentTaskType": "vibe",
    "chatTriggerType": "MANUAL",
    "currentMessage": {
      "userInputMessage": {
        "content": "Merhaba!",
        "modelId": "claude-sonnet-4.5",
        "origin": "AI_EDITOR",
        "userInputMessageContext": {
          "tools": [...],
          "toolResults": [...]
        }
      }
    },
    "history": [...]
  },
  "profileArn": "arn:aws:..."
}
```

### Model Esleme

| Girdi Model                | Kiro Model          |
|----------------------------|---------------------|
| claude-*-sonnet-*          | claude-sonnet-4.5   |
| claude-*-opus-*            | claude-opus-4.5     |
| claude-*-haiku-*           | claude-haiku-4.5    |

## AWS Event Stream Protokolu

### CRC32C Dogrulama

Veri butunlugu icin CRC32C checksum dogrulamasi yapilir. Lookup table tabanli hesaplama kullanilir.

### Cerceve Yapisi

```
+──────────────+──────────────+──────────────+──────────+──────────+───────────+
│ Total Length │ Header Length│ Prelude CRC  │ Headers  │ Payload  │ Msg CRC   │
│   (4 bytes)  │   (4 bytes)  │   (4 bytes)  │ (degisken)│ (degisken)│ (4 bytes) │
+──────────────+──────────────+──────────────+──────────+──────────+───────────+
```

### Cerceve Sabitleri

| Sabit              | Deger                | Aciklama                    |
|--------------------|----------------------|-----------------------------|
| PRELUDE_SIZE       | 12 byte              | Prelude boyutu              |
| MIN_MESSAGE_SIZE   | 16 byte              | Minimum mesaj boyutu        |
| MAX_MESSAGE_SIZE   | 16 MB                | Maksimum mesaj boyutu       |

### Baslik Deger Tipleri

| Tip Kodu | Tip Adi    | Boyut                      |
|----------|------------|----------------------------|
| 0        | BoolTrue   | 0 byte                     |
| 1        | BoolFalse  | 0 byte                     |
| 2        | Byte       | 1 byte                     |
| 3        | Short      | 2 byte                     |
| 4        | Integer    | 4 byte                     |
| 5        | Long       | 8 byte                     |
| 6        | ByteArray  | 2 byte uzunluk + veri      |
| 7        | String     | 2 byte uzunluk + veri      |
| 8        | Timestamp  | 8 byte                     |
| 9        | Uuid       | 16 byte                    |

### EventStreamDecoder Sinifi

Incremental veri isleme icin arabellek mekanizmasi kullanir:

```javascript
class EventStreamDecoder {
  feed(data)      // Veri ekler
  *decode()       // Generator ile frame'leri dondurur
}
```

### Payload Isleme

- Otomatik gzip dekompresyon tespiti
- JSON parsing denemesi
- Basarisiz durumlarda ham string donusumu

### Olay Tipleri

| Olay Tipi              | Aciklama                              |
|------------------------|---------------------------------------|
| assistantResponseEvent | Asistan metin yaniti                  |
| toolUseEvent           | Arac cagrisi olaylari                 |
| meteringEvent          | Faturalandirma bilgisi                |
| contextUsageEvent      | Baglam penceresi kullanim yuzdesi     |
| error                  | Sunucu hatasi                         |
| exception              | Sunucu istisnasi                      |

## Hesap Havuzu Yonetimi

### AccountPool Sinifi

Hesap havuzu yonetiminden sorumlu sinif.

| Metot                  | Aciklama                                           |
|------------------------|----------------------------------------------------|
| selectAccount()        | Stratejiye gore hesap secer                        |
| recordError()          | Hata kaydeder ve gerekirse sogumaya alir           |
| refreshAccountUsage()  | Hesap kotasini sorgular                            |

### Hesap Durumlari

| Durum     | Aciklama                                    |
|-----------|---------------------------------------------|
| active    | Kullanima hazir                             |
| cooldown  | Oran siniri nedeniyle soguma surecinde      |
| invalid   | Askiya alinmis veya gecersiz                |
| disabled  | Kullanici tarafindan devre disi birakildi   |

### Secim Stratejileri

| Strateji    | Aciklama                                    |
|-------------|---------------------------------------------|
| round-robin | Sirali dongusel secim (varsayilan)          |
| random      | Rastgele hesap secimi                       |
| least-used  | En az kullanilan hesabi sec                 |

### Soguma Suresi

Oran siniri tespit edildiginde hesap 5 dakika sogumaya alinir.

### Istek Kayitlari

Maksimum 1000 istek kaydi tutulur. Her kayit asagidaki bilgileri icerir:
- Hesap ID
- Model adi
- Token sayilari
- Sure
- Basari durumu
- Zaman damgasi

### Veri Kaliciligi

| Dosya             | Aciklama                              |
|-------------------|---------------------------------------|
| accounts.json     | Hesap bilgileri ve durumlari          |

## Kota Yonetimi

### Kota Sorgulama Endpoint'i

```
GET https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits
    ?isEmailRequired=true
    &origin=AI_EDITOR
    &resourceType=AGENTIC_REQUEST
```

### Kota Bilgisi Yapisi

```json
{
  "resourceType": "CREDIT",
  "usageLimit": 1000.0,
  "currentUsage": 250.0,
  "available": 750.0,
  "nextReset": "2025-02-01T00:00:00Z",
  "freeTrial": {
    "status": "ACTIVE",
    "usageLimit": 500.0,
    "currentUsage": 100.0,
    "expiry": "2025-03-01T00:00:00Z"
  },
  "userEmail": "user@example.com",
  "subscriptionType": "PRO"
}
```

### checkUsageLimits Fonksiyonu

Bearer token ile kota bilgisi sorgular. Proxy destegi mevcuttur.

### parseUsageLimits Fonksiyonu

AWS yanitini yapilandirilmis formata donusturur:
- Kaynak tipi
- Limit ve kullanim metrikleri
- Kalan kota
- Yenileme tarihi
- Ucretsiz deneme detaylari

## Yapilandirma

### Ortam Degiskenleri

| Degisken         | Varsayilan  | Aciklama                          |
|------------------|-------------|-----------------------------------|
| PORT             | 8080        | Dinleme portu                     |
| API_KEY          | -           | API anahtari                      |
| ADMIN_KEY        | -           | Yonetim anahtari                  |
| DATA_DIR         | ./data      | Veri depolama dizini              |
| AWS_REGION       | us-east-1   | AWS bolgesi                       |
| PROXY_URL        | -           | HTTP proxy adresi                 |

### SettingsManager Sinifi

Ayar yonetiminden sorumlu sinif.

| Metot                  | Aciklama                                           |
|------------------------|----------------------------------------------------|
| verifyAdminKey()       | Admin anahtarini dogrular                          |
| verifyApiKey()         | API anahtarini dogrular                            |
| changeAdminKey()       | Admin anahtarini degistirir                        |
| addApiKey()            | Yeni API anahtari ekler                            |
| removeApiKey()         | API anahtarini siler                               |
| listApiKeys()          | API anahtarlarini listeler                         |

### Veri Yapisi

```json
{
  "adminKey": "sk-admin-xxxxx",
  "apiKeys": ["sk-key-1", "sk-key-2"]
}
```

## HTTP Baslik Yapisi

### Kiro API Istekleri Icin

| Baslik                      | Deger                                        |
|-----------------------------|----------------------------------------------|
| Content-Type                | application/json                             |
| Authorization               | Bearer {token}                               |
| Host                        | q.{region}.amazonaws.com                     |
| User-Agent                  | aws-sdk-js/1.0.27 ua/2.1 ...                 |
| x-amz-user-agent            | aws-sdk-js/1.0.27 KiroIDE-{version}-{machineId} |
| amz-sdk-invocation-id       | {uuid}                                       |
| amz-sdk-request             | attempt=1; max=3                             |

## Thinking Modu

Extended thinking ozelligi desteklenmektedir.

### Istek Yapisi

```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

### Icerik Blok Tipleri

| Tip      | Aciklama                    |
|----------|----------------------------|
| text     | Metin icerigi              |
| thinking | Dusunme icerigi            |
| tool_use | Arac cagrisi               |

## Arac Kullanimi (Tool Use)

### Arac Donusumu

Anthropic arac tanimi Kiro formatina donusturulur.

**Anthropic Format:**
```json
{
  "name": "get_weather",
  "description": "Hava durumunu getir",
  "input_schema": {
    "type": "object",
    "properties": {
      "city": {"type": "string"}
    }
  }
}
```

**Kiro Format:**
```json
{
  "toolSpecification": {
    "name": "get_weather",
    "description": "Hava durumunu getir",
    "inputSchema": {
      "json": {
        "type": "object",
        "properties": {
          "city": {"type": "string"}
        }
      }
    }
  }
}
```

## SSE Akis Yonetimi

### Anthropic SSE Olay Sirasi

1. message_start (bir kez)
2. content_block_start (her icerik blogu icin)
3. content_block_delta (icerik guncellemeleri)
4. content_block_stop (blok sonu)
5. message_delta (son durum)
6. message_stop (mesaj sonu)

### OpenAI SSE Format

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}

data: [DONE]
```

## Token Sayimi

Karakter tabanli tahmin formulu kullanilir:

```javascript
// ASCII olmayan karakterler: 1.5 token
// ASCII karakterler: 0.25 token
```

## Hata Yonetimi

### HTTP Durum Kodlari

| Durum Kodu | Islem                                      |
|------------|-------------------------------------------|
| 503        | Hesap havuzunda uygun hesap yok           |
| 500        | Sunucu hatasi                             |

### Hata Yanit Yapisi

```json
{
  "type": "error",
  "error": {
    "type": "unavailable",
    "message": "No available accounts in pool"
  }
}
```

## Guvenlik

### API Anahtari Dogrulamasi

Istekler `x-api-key` header'i veya Bearer token ile dogrulanir.

### Admin Anahtari Dogrulamasi

Yonetim endpoint'leri `Authorization` header'i ile dogrulanir.

### CORS Yapilandirmasi

Varsayilan olarak tum kaynaklar izinlidir.

### JSON Body Limiti

Maksimum 50MB JSON payload desteklenir.

## Docker Dagitimi

### Docker Compose Ornegi

```yaml
version: '3'
services:
  kiro2api:
    build: .
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - API_KEY=sk-your-key
      - ADMIN_KEY=sk-admin-key
      - AWS_REGION=us-east-1
    volumes:
      - ./data:/app/data
```

### Dockerfile

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
```

## Calistirma

### NPM ile

```bash
npm install
npm start
```

### Docker ile

```bash
docker-compose up -d
```

## Web Yonetim Paneli

Proje, hesap yonetimi icin web tabanli bir arayuz sunmaktadir.

### Ozellikler

- Hesap ekleme, silme, etkinlestirme/devre disi birakma
- Toplu hesap aktarimi
- Kota izleme ve yenileme
- Istek gecmisi ve istatistikler
- Strateji yapilandirmasi
- API anahtari yonetimi

### Erisim

```
http://localhost:8080/
```

## Sonuc

Kiro2api-Node, Node.js ile yazilmis kapsamli bir API proxy uygulamasidir. Hem Anthropic hem de OpenAI API formatlarini desteklemesi, hesap havuzu yonetimi, kota izleme ve web tabanli yonetim paneli gibi ozellikleriyle ozellikle coklu hesap senaryolari icin uygun bir cozumdur. Express.js tabanli mimarisi sayesinde kolayca genisletilebilir ve ozellestirileb ilir.
