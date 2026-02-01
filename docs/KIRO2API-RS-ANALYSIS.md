# Kiro2API-RS Analizi

Bu dokuman, [kiro2api-rs](https://github.com/gdtiti/kiro2api-rs) projesinin kapsamli bir teknik analizini icermektedir. Proje, Rust programlama dili ile yazilmis olup Kiro API'sini Anthropic Claude API uyumlu bir arayuze donusturmektedir.

## Genel Bakis

| Ozellik           | Deger                            |
|-------------------|----------------------------------|
| Proje Adi         | kiro-rs                          |
| Versiyon          | 2025.12.7                        |
| Programlama Dili  | Rust (Edition 2021)              |
| Web Framework     | Axum 0.8                         |
| Asenkron Runtime  | Tokio                            |
| HTTP Istemcisi    | Reqwest (rustls, SOCKS5 destegi) |
| Lisans            | MIT                              |
| Varsayilan Port   | 8080                             |
| Varsayilan Region | us-east-1                        |

## Mimari Yapisi

```
kiro2api-rs/
├── src/
│   ├── main.rs                 # Ana giris noktasi
│   ├── http_client.rs          # HTTP istemci ve proxy yapisi
│   ├── token.rs                # Token sayimi yardimcilari
│   ├── debug.rs                # Hata ayiklama yardimcilari
│   ├── test.rs                 # Test yardimcilari
│   ├── anthropic/              # Anthropic API uyumluluk katmani
│   │   ├── mod.rs              # Modul tanimi
│   │   ├── types.rs            # Tip tanimlari
│   │   ├── converter.rs        # Anthropic -> Kiro donusturucu
│   │   ├── handlers.rs         # HTTP isleyicileri
│   │   ├── middleware.rs       # Kimlik dogrulama middleware
│   │   ├── router.rs           # Route tanimlari
│   │   └── stream.rs           # SSE akis yonetimi
│   ├── kiro/                   # Kiro API cekirdek modulu
│   │   ├── mod.rs              # Modul tanimi
│   │   ├── provider.rs         # KiroProvider sinifi
│   │   ├── token_manager.rs    # Token yonetimi
│   │   ├── machine_id.rs       # Cihaz parmak izi uretimi
│   │   ├── model/              # Veri modelleri
│   │   │   ├── credentials.rs  # OAuth kimlik bilgileri
│   │   │   ├── token_refresh.rs# Token yenileme yapilari
│   │   │   ├── requests/       # Istek yapilari
│   │   │   │   ├── kiro.rs     # Ana istek yapisi
│   │   │   │   ├── conversation.rs # Konusma yapilari
│   │   │   │   └── tool.rs     # Arac tanimlari
│   │   │   └── events/         # Olay yapilari
│   │   │       ├── base.rs     # Temel olay tipleri
│   │   │       ├── assistant.rs# Asistan yanit olaylari
│   │   │       ├── context_usage.rs # Baglam kullanimi
│   │   │       └── tool_use.rs # Arac kullanimi olaylari
│   │   └── parser/             # AWS Event Stream ayrıştirici
│   │       ├── decoder.rs      # Akis kod cozucu
│   │       ├── frame.rs        # Cerceve ayrıştirici
│   │       ├── header.rs       # Baslik ayrıştirici
│   │       ├── crc.rs          # CRC32 hesaplama
│   │       └── error.rs        # Hata tanimlari
│   ├── model/                  # Genel yapilandirma modelleri
│   │   ├── config.rs           # Yapilandirma dosyasi
│   │   └── arg.rs              # Komut satiri argumanlari
│   ├── pool/                   # Hesap havuzu yonetimi
│   │   ├── account.rs          # Hesap durumu
│   │   ├── manager.rs          # Havuz yoneticisi
│   │   ├── strategy.rs         # Secim stratejileri
│   │   └── usage.rs            # Kullanim ve kota yonetimi
│   └── ui/                     # Web yonetim paneli
│       ├── mod.rs              # UI route'lari
│       └── index.html          # Yonetim paneli HTML
└── tools/
    └── event-viewer.html       # Olay goruntuleyici araci
```

## Kimlik Dogrulama Yontemleri

Proje uc farkli kimlik dogrulama yontemini desteklemektedir:

### 1. Social Auth

Google veya GitHub OAuth kullanarak kimlik dogrulama.

| Alan         | Tip    | Zorunlu | Aciklama                            |
|--------------|--------|---------|-------------------------------------|
| refreshToken | String | Evet    | OAuth yenileme tokeni               |
| expiresAt    | String | Hayir   | Token son kullanma tarihi (RFC3339) |
| authMethod   | String | Evet    | "social" degeri                     |

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

### 2. Builder ID / IAM Identity Center (IdC)

AWS SSO OIDC protokolu kullanarak kimlik dogrulama.

| Alan         | Tip    | Zorunlu | Aciklama                            |
|--------------|--------|---------|-------------------------------------|
| refreshToken | String | Evet    | OAuth yenileme tokeni               |
| expiresAt    | String | Hayir   | Token son kullanma tarihi (RFC3339) |
| authMethod   | String | Evet    | "idc" veya "builder-id" degeri      |
| clientId     | String | Evet    | OIDC istemci kimlik numarasi        |
| clientSecret | String | Evet    | OIDC istemci sifresi                |

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

### Kimlik Bilgileri Yukleme Onceligi

1. Ortam degiskenleri (REFRESH_TOKEN, AUTH_METHOD, vb.)
2. credentials.json dosyasi

## Token Yonetimi

### TokenManager Sinifi

Token yonetiminden sorumlu ana sinif. Thread-safe erisim icin Mutex kullanir.

| Metot                | Aciklama                                 |
|----------------------|------------------------------------------|
| new()                | Yeni TokenManager olusturur              |
| credentials()        | Kimlik bilgilerinin referansini dondurur |
| config()             | Yapilandirma referansini dondurur        |
| ensure_valid_token() | Gecerli token saglar, gerekirse yeniler  |

### Token Gecerlilik Kontrolleri

| Kontrol                  | Sure      | Aciklama                                  |
|--------------------------|-----------|-------------------------------------------|
| is_token_expired()       | 5 dakika  | Token 5 dakika icinde sona erecekse true  |
| is_token_expiring_soon() | 10 dakika | Token 10 dakika icinde sona erecekse true |

### Token Dogrulama

refreshToken minimum 100 karakter uzunlugunda olmalidir. Kesik veya bos tokenlar reddedilir.

```rust
fn validate_refresh_token(credentials: &KiroCredentials) -> anyhow::Result<()> {
    // Token en az 100 karakter olmali
    // "..." icermemeli (kesik token gostergesi)
}
```

## API Endpoint'leri

### Anthropic Uyumlu API

| Endpoint                  | Metot | Aciklama                       |
|---------------------------|-------|--------------------------------|
| /v1/models                | GET   | Mevcut model listesini getirir |
| /v1/messages              | POST  | Mesaj olusturur (sohbet)       |
| /v1/messages/count_tokens | POST  | Token sayisini hesaplar        |

### Yonetim API'si (Kimlik Dogrulama Gerektirir)

| Endpoint                         | Metot  | Aciklama                        |
|----------------------------------|--------|---------------------------------|
| /api/status                      | GET    | Servis durumunu getirir         |
| /api/accounts                    | GET    | Hesap listesini getirir         |
| /api/accounts                    | POST   | Yeni hesap ekler                |
| /api/accounts/import             | POST   | Kiro JSON kimlik bilgisi alinir |
| /api/accounts/{id}               | DELETE | Hesabi siler                    |
| /api/accounts/{id}/enable        | POST   | Hesabi etkinlestirir            |
| /api/accounts/{id}/disable       | POST   | Hesabi devre disi birakir       |
| /api/accounts/{id}/usage         | GET    | Hesap kotasini getirir          |
| /api/accounts/{id}/usage/refresh | POST   | Hesap kotasini yeniler          |
| /api/strategy                    | GET    | Mevcut stratejiyi getirir       |
| /api/strategy                    | POST   | Stratejiyi degistirir           |
| /api/logs                        | GET    | Istek kayitlarini getirir       |
| /api/logs/stats                  | GET    | Istek istatistiklerini getirir  |
| /api/usage/refresh               | POST   | Tum hesap kotalarini yeniler    |

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
  "system": [
    {"text": "Sen yardimci bir asistansin."}
  ],
  "tools": [...],
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

### Kiro Istek Donusumu

Anthropic istegi Kiro formatina donusturulur:

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

| Anthropic Model   | Kiro Model        |
|-------------------|-------------------|
| claude-*-sonnet-* | claude-sonnet-4.5 |
| claude-*-opus-*   | claude-opus-4.5   |
| claude-*-haiku-*  | claude-haiku-4.5  |

## AWS Event Stream Protokolu

### Cerceve Yapisi

```
┌──────────────┬──────────────┬──────────────┬──────────┬──────────┬───────────┐
│ Total Length │ Header Length│ Prelude CRC  │ Headers  │ Payload  │ Msg CRC   │
│   (4 bytes)  │   (4 bytes)  │   (4 bytes)  │ (degisken)│ (degisken)│ (4 bytes) │
└──────────────┴──────────────┴──────────────┴──────────┴──────────┴───────────┘
```

### Cerceve Sabitleri

| Sabit            | Deger   | Aciklama              |
|------------------|---------|-----------------------|
| PRELUDE_SIZE     | 12 byte | Prelude boyutu        |
| MIN_MESSAGE_SIZE | 16 byte | Minimum mesaj boyutu  |
| MAX_MESSAGE_SIZE | 16 MB   | Maksimum mesaj boyutu |

### Baslik Deger Tipleri

| Tip Kodu | Tip Adi   | Boyut                 |
|----------|-----------|-----------------------|
| 0        | BoolTrue  | 0 byte                |
| 1        | BoolFalse | 0 byte                |
| 2        | Byte      | 1 byte                |
| 3        | Short     | 2 byte                |
| 4        | Integer   | 4 byte                |
| 5        | Long      | 8 byte                |
| 6        | ByteArray | 2 byte uzunluk + veri |
| 7        | String    | 2 byte uzunluk + veri |
| 8        | Timestamp | 8 byte                |
| 9        | Uuid      | 16 byte               |

### Olay Tipleri

| Olay Tipi              | Aciklama                          |
|------------------------|-----------------------------------|
| assistantResponseEvent | Asistan metin yaniti              |
| toolUseEvent           | Arac cagrisi olaylari             |
| meteringEvent          | Faturalandirma bilgisi            |
| contextUsageEvent      | Baglam penceresi kullanim yuzdesi |
| error                  | Sunucu hatasi                     |
| exception              | Sunucu istisnasi                  |

### Kod Cozucu Durum Makinesi

```
┌─────────────────┐
│      Ready      │  (Baslangic durumu)
└────────┬────────┘
         │ feed() veri saglar
         ↓
┌─────────────────┐
│     Parsing     │  decode() ayrıştirmayı dener
└────────┬────────┘
         │
    ┌────┴────────────┐
    ↓                 ↓
 [Basarili]        [Basarisiz]
    │                 │
    ↓                 ├─> error_count++
┌─────────┐           │
│  Ready  │           ├─> error_count < max_errors?
└─────────┘           │    EVET → Recovering → Ready
                      │    HAYIR ↓
                 ┌────────────┐
                 │   Stopped  │ (Sonlandirma durumu)
                 └────────────┘
```

## Hata Yonetimi

### Hata Tipleri

| Hata Tipi          | Aciklama                               |
|--------------------|----------------------------------------|
| Incomplete         | Veri yetersiz, daha fazla byte gerekli |
| PreludeCrcMismatch | Prelude CRC dogrulama hatasi           |
| MessageCrcMismatch | Mesaj CRC dogrulama hatasi             |
| InvalidHeaderType  | Gecersiz baslik deger tipi             |
| HeaderParseFailed  | Baslik ayrıştirma hatasi               |
| MessageTooLarge    | Mesaj boyutu limiti asildi             |
| MessageTooSmall    | Mesaj boyutu minimum altinda           |
| InvalidMessageType | Gecersiz mesaj tipi                    |
| PayloadDeserialize | Payload JSON ayrıştirma hatasi         |
| TooManyErrors      | Cok fazla ardisik hata, durdu          |
| BufferOverflow     | Tampon tasma hatasi                    |

### HTTP Durum Kodu Isleme

| Durum Kodu | Islem                                      |
|------------|--------------------------------------------|
| 401        | Kimlik bilgileri suresi dolmus/gecersiz    |
| 403        | Hesap askiya alinmis, gecersiz olarak isle |
| 429        | Oran siniri, 5 dakika soguma suresi        |
| 500-599    | Sunucu hatasi, gecici olarak kullanilamaz  |

## Hesap Havuzu Yonetimi

### Hesap Durumlari

| Durum    | Aciklama                                  |
|----------|-------------------------------------------|
| Active   | Kullanima hazir                           |
| Cooldown | Oran siniri nedeniyle soguma surecinde    |
| Invalid  | Askiya alinmis veya gecersiz              |
| Disabled | Kullanici tarafindan devre disi birakildi |

### Secim Stratejileri

| Strateji   | Aciklama                           |
|------------|------------------------------------|
| RoundRobin | Sirali dongusel secim (varsayilan) |
| Random     | Rastgele hesap secimi              |
| LeastUsed  | En az kullanilan hesabi sec        |

### Veri Kaliciligi

Hesap havuzu modu acik oldugunda asagidaki veriler DATA_DIR'e kaydedilir:

| Dosya             | Aciklama                          |
|-------------------|-----------------------------------|
| accounts.json     | Hesap bilgileri ve durumlari      |
| request_logs.json | Istek kayitlari (maks. 1000 adet) |
| usage_cache.json  | Hesap kota onbellegi              |

## Yapilandirma

### config.json

| Alan                | Tip    | Varsayilan | Aciklama                       |
|---------------------|--------|------------|--------------------------------|
| host                | String | 0.0.0.0    | Dinleme adresi                 |
| port                | Number | 8080       | Dinleme portu                  |
| apiKey              | String | -          | API anahtari                   |
| region              | String | us-east-1  | AWS bolgesi                    |
| kiroVersion         | String | 0.8.0      | Kiro surum numarasi            |
| machineId           | String | Otomatik   | Ozel makine kodu (64 karakter) |
| systemVersion       | String | Rastgele   | Isletim sistemi surumu         |
| nodeVersion         | String | 22.21.1    | Node.js surumu                 |
| countTokensApiUrl   | String | -          | Harici token sayim API'si      |
| countTokensApiKey   | String | -          | Token sayim API anahtari       |
| countTokensAuthType | String | x-api-key  | Kimlik dogrulama tipi          |
| proxyUrl            | String | -          | HTTP/SOCKS5 proxy adresi       |
| proxyUsername       | String | -          | Proxy kullanici adi            |
| proxyPassword       | String | -          | Proxy sifresi                  |

### Ortam Degiskenleri

| Degisken       | Varsayilan | Aciklama                        |
|----------------|------------|---------------------------------|
| HOST           | 0.0.0.0    | Dinleme adresi                  |
| PORT           | 8080       | Dinleme portu                   |
| API_KEY        | -          | API anahtari                    |
| REGION         | us-east-1  | AWS bolgesi                     |
| POOL_MODE      | false      | Hesap havuzu modunu etkinlestir |
| DATA_DIR       | ./data     | Veri depolama dizini            |
| REFRESH_TOKEN  | -          | OAuth yenileme tokeni           |
| AUTH_METHOD    | -          | Kimlik dogrulama yontemi        |
| CLIENT_ID      | -          | IdC istemci kimlik numarasi     |
| CLIENT_SECRET  | -          | IdC istemci sifresi             |
| KIRO_VERSION   | 0.8.0      | Kiro surum numarasi             |
| MACHINE_ID     | -          | Ozel makine kodu                |
| PROXY_URL      | -          | Proxy adresi                    |
| PROXY_USERNAME | -          | Proxy kullanici adi             |
| PROXY_PASSWORD | -          | Proxy sifresi                   |

## Cihaz Parmak Izi (Machine ID)

### Uretim Onceligi

1. Yapilandirmadan ozel machineId (64 karakter)
2. profileArn'dan SHA256 hash
3. refreshToken'dan SHA256 hash

### Hash Formati

```rust
sha256_hex(&format!("KotlinNativeAPI/{}", kaynak))
```

Sonuc: 64 karakter hex dizesi

## HTTP Baslik Yapisi

### Kiro API Istekleri Icin

| Baslik                      | Deger                                           |
|-----------------------------|-------------------------------------------------|
| Content-Type                | application/json                                |
| Authorization               | Bearer {token}                                  |
| Host                        | q.{region}.amazonaws.com                        |
| x-amzn-codewhisperer-optout | true                                            |
| x-amzn-kiro-agent-mode      | vibe                                            |
| x-amz-user-agent            | aws-sdk-js/1.0.27 KiroIDE-{version}-{machineId} |
| User-Agent                  | aws-sdk-js/1.0.27 ua/2.1 os/{os} lang/js ...    |
| amz-sdk-invocation-id       | {uuid}                                          |
| amz-sdk-request             | attempt=1; max=3                                |
| Connection                  | close                                           |

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

### Maksimum Budget Tokens

24576 token (hard limit)

### Islem Akisi

1. Sistem mesajina thinking etiketleri enjekte edilir
2. `<thinking>` ve `</thinking>` etiketleri arasindaki icerik ayristirilir
3. Thinking icerigi ayri content block olarak gonderilir
4. Metin icerigi ayri content block olarak gonderilir

## Arac Kullanimi (Tool Use)

### Desteklenen Arac Tipleri

Tum ozel araclar desteklenir, asagidakiler haric:
- web_search
- websearch

### Arac Donusumu

Anthropic arac tanimi Kiro formatina donusturulur:

```json
// Anthropic
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

// Kiro
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

### Arac Sonucu Isleme

Arac sonuclari toolResults dizisinde gonderilir:

```json
{
  "toolUseId": "tool_xxx",
  "content": [{"text": "Sonuc icerigi"}],
  "status": "success",
  "isError": false
}
```

## SSE Akis Yonetimi

### Olay Sirasi

1. message_start (bir kez)
2. content_block_start (her icerik blogu icin)
3. content_block_delta (icerik guncellemeleri)
4. content_block_stop (blok sonu)
5. message_delta (son durum)
6. message_stop (mesaj sonu)

### Ping Olaylari

25 saniyede bir ping olaylari gonderilir:

```
event: ping
data: {"type": "ping"}
```

### Icerik Blok Tipleri

| Tip      | Aciklama        |
|----------|-----------------|
| text     | Metin icerigi   |
| thinking | Dusunme icerigi |
| tool_use | Arac cagrisi    |

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

## Guvenlik Onlemleri

### API Anahtari Dogrulamasi

Zamanlama saldirilarina karsi sabit zamanli karsilastirma kullanilir:

```rust
fn constant_time_eq(a: &str, b: &str) -> bool {
    // XOR tabanli karsilastirma
    // Erken cikis yok
}
```

### CORS Yapilandirmasi

Varsayilan olarak tum kaynaklar, yontemler ve basliklar izinlidir.

### Token Guvenlik Dogrulamasi

- Minimum 100 karakter uzunluk kontrolu
- Kesik token tespiti ("..." kontrolu)
- Bos token reddi

## Performans Optimizasyonlari

### Release Profili

```toml
[profile.release]
lto = true      # Link-Time Optimization
strip = true    # Sembol cikarma
```

### HTTP Istemci Ayarlari

| Ayar           | Deger      | Aciklama                   |
|----------------|------------|----------------------------|
| Zaman Asimi    | 720 saniye | API istekleri icin (12 dk) |
| Token Yenileme | 60 saniye  | Token yenileme icin        |
| Baglanti       | close      | Her istekten sonra kapat   |

### Tampon Ayarlari

| Ayar                  | Deger | Aciklama                |
|-----------------------|-------|-------------------------|
| Varsayilan Kapasite   | 8 KB  | Baslangic tampon boyutu |
| Maksimum Tampon       | 16 MB | Maksimum tampon boyutu  |
| Maksimum Ardisik Hata | 5     | Durdurmadan once        |

## Bagimliliklar

| Paket      | Surum | Aciklama                           |
|------------|-------|------------------------------------|
| axum       | 0.8   | Web framework                      |
| tokio      | 1.0   | Asenkron runtime                   |
| reqwest    | 0.12  | HTTP istemci (stream, json, socks) |
| serde      | 1.0   | Serializasyon                      |
| serde_json | 1.0   | JSON isleme                        |
| tracing    | 0.1   | Loglama                            |
| anyhow     | 1.0   | Hata yonetimi                      |
| chrono     | 0.4   | Tarih/saat isleme                  |
| uuid       | 1.10  | UUID uretimi                       |
| sha2       | 0.10  | SHA256 hash                        |
| crc        | 3     | CRC32 hesaplama                    |
| bytes      | 1     | Etkin byte tamponu                 |
| tower-http | 0.6   | CORS middleware                    |
| clap       | 4.5   | Komut satiri ayrıştirici           |

## Calistirma Modlari

### Tek Hesap Modu (Varsayilan)

```bash
./kiro-rs --credentials credentials.json
```

### Hesap Havuzu Modu

```bash
POOL_MODE=true ./kiro-rs
```

Web yonetim paneli: `http://sunucu-adresi/`

## Docker Dagitimi

```bash
docker build -t kiro-rs .
docker run -d \
  -p 8080:8080 \
  -e API_KEY=sk-your-key \
  -e POOL_MODE=true \
  -v /path/to/data:/app/data \
  kiro-rs
```

## Sonuc

kiro2api-rs, Rust'in performans ve guvenlik ozelliklerinden yararlanan saglam bir API proxy uygulamasidir. AWS Event Stream protokolunun tam uygulamasi, kapsamli hata yonetimi ve hesap havuzu yonetimi gibi gelismis ozellikler sunmaktadir.
