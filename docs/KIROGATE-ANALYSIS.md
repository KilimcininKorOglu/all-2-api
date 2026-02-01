# KiroGate Analizi

Bu belge, [KiroGate](https://github.com/aliom-v/KiroGate) projesinin kapsamli bir analizini icermektedir. KiroGate, Kiro API'sini OpenAI ve Anthropic uyumlu arayuzlere donusturen bir Python gateway servisidir.

## Genel Bakis

| Ozellik              | Deger                                                                 |
|----------------------|-----------------------------------------------------------------------|
| Proje Adi            | KiroGate                                                              |
| Dil                  | Python 3.x                                                            |
| Framework            | FastAPI                                                               |
| Lisans               | GNU Affero General Public License v3                                  |
| Surum                | 2.3.0                                                                 |
| Temel                | kiro-openai-gateway by Jwadow                                         |
| API Uyumlulugu       | OpenAI Chat Completions, Anthropic Messages API                       |
| Desteklenen Modeller | Claude Opus 4.5, Claude Sonnet 4.5/4, Claude Haiku 4.5, Claude 3.7    |

## Dizin Yapisi

```
kiro_gateway/
├── __init__.py              # Modul tanitimi
├── auth.py                  # Kimlik dogrulama yoneticisi
├── auth_cache.py            # AuthManager onbellek yonetimi
├── auto_chunked_handler.py  # Otomatik parca isleme
├── base_stream_handler.py   # Temel stream isleyici
├── cache.py                 # Model metadata onbellegi
├── chunked_processor.py     # Parca isleyici
├── config.py                # Yapilandirma ve sabitler
├── converters.py            # OpenAI <-> Kiro format donusturucu
├── database.py              # Veritabani islemleri
├── debug_logger.py          # Hata ayiklama gunlukleyici
├── exceptions.py            # Istisna isleyicileri
├── health_checker.py        # Token saglik kontrolu
├── http_client.py           # HTTP istemci yonetimi
├── middleware.py            # FastAPI middleware'leri
├── metrics.py               # Metrik toplama
├── models.py                # Pydantic veri modelleri
├── pages.py                 # Web arayuzu sayfalari
├── parsers.py               # AWS Event Stream ayristirici
├── request_handler.py       # Istek isleyici
├── routes.py                # API endpoint'leri
├── streaming.py             # Stream yanit isleme
├── thinking_parser.py       # Thinking modu ayristirici
├── token_allocator.py       # Token tahsis yonetimi
├── tokenizer.py             # Token sayma modulu
├── user_manager.py          # Kullanici yonetimi
├── utils.py                 # Yardimci fonksiyonlar
└── websearch.py             # Web arama ozelligi
```

---

## Kimlik Dogrulama (Authentication)

### Desteklenen Yontemler

KiroGate iki farkli kimlik dogrulama yontemi destekler:

| Yontem | Aciklama                                      | Endpoint                                           |
|--------|-----------------------------------------------|----------------------------------------------------|
| SOCIAL | Kiro Desktop sosyal giris (Google/GitHub)     | `https://prod.{region}.auth.desktop.kiro.dev/refreshToken` |
| IDC    | AWS IAM Identity Center (Builder ID)          | `https://oidc.{region}.amazonaws.com/token`        |

### Social Authentication

Social kimlik dogrulama, Kiro Desktop uygulamasinin kullandigi yontemdir.

**Istek Formati:**
```json
{
  "refreshToken": "your_refresh_token"
}
```

**Yanittan Beklenen Alanlar:**
- `accessToken`: Yeni erisim tokeni
- `refreshToken`: Yeni yenileme tokeni (opsiyonel)
- `expiresIn`: Gecerlilik suresi (saniye)
- `profileArn`: AWS CodeWhisperer profil ARN'i

### IDC Authentication

AWS SSO OIDC kullanilan kurumsal kimlik dogrulama yontemidir.

**Istek Formati:**
```json
{
  "clientId": "your_client_id",
  "clientSecret": "your_client_secret",
  "grantType": "refresh_token",
  "refreshToken": "your_refresh_token"
}
```

### KiroAuthManager Sinifi

```python
class KiroAuthManager:
    """
    Kiro API erisim tokeni yasam dongusu yonetimi.

    Ozellikler:
    - .env veya JSON dosyasindan kimlik bilgisi yukleme
    - Token suresi doldugunda otomatik yenileme
    - asyncio.Lock ile thread-safe yenileme
    - Social ve IDC kimlik dogrulama destegi
    """

    def __init__(
        self,
        refresh_token: Optional[str] = None,
        profile_arn: Optional[str] = None,
        region: str = "us-east-1",
        creds_file: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
    )
```

### Token Yenileme Sureci

1. Token suresi kontrol edilir (`is_token_expiring_soon`)
2. Suresinin dolmasina `TOKEN_REFRESH_THRESHOLD` (varsayilan 600 saniye) kalmissa yenileme baslar
3. Kimlik dogrulama turune gore uygun endpoint'e istek gonderilir
4. Basarili yanit alinirsa yeni token'lar kaydedilir
5. Hatali yanit alinirsa ustel geri cekilme (exponential backoff) ile yeniden denenir

---

## Token Yonetimi

### Token Yasam Dongusu

```
+------------------+     +-------------------+     +------------------+
|  Token Yukleme   | --> |  Token Kontrolu   | --> |  API Istegi      |
|  (dosya/env)     |     |  (is_expiring?)   |     |  (with token)    |
+------------------+     +-------------------+     +------------------+
                                  |
                                  v (evet)
                         +-------------------+
                         |  Token Yenileme   |
                         |  (refresh_token)  |
                         +-------------------+
                                  |
                                  v
                         +-------------------+
                         |  Yeni Token       |
                         |  Kaydetme         |
                         +-------------------+
```

### Yapilandirma Parametreleri

| Parametre                 | Varsayilan | Aciklama                                    |
|---------------------------|------------|---------------------------------------------|
| TOKEN_REFRESH_THRESHOLD   | 600        | Token yenileme esigi (saniye)               |
| MAX_RETRIES               | 3          | Maksimum yeniden deneme sayisi              |
| BASE_RETRY_DELAY          | 1.0        | Temel bekleme suresi (saniye)               |
| FIRST_TOKEN_TIMEOUT       | 120.0      | Ilk token icin zaman asimi (saniye)         |
| STREAM_READ_TIMEOUT       | 300.0      | Stream okuma zaman asimi (saniye)           |
| NON_STREAM_TIMEOUT        | 900.0      | Non-stream istek zaman asimi (saniye)       |

### Kimlik Bilgisi Dosyasi Formati

```json
{
  "refreshToken": "your_refresh_token",
  "accessToken": "your_access_token",
  "profileArn": "arn:aws:codewhisperer:us-east-1:...",
  "region": "us-east-1",
  "expiresAt": "2025-01-01T00:00:00Z",
  "clientId": "optional_client_id",
  "clientSecret": "optional_client_secret"
}
```

---

## API Endpoint'leri

### Saglik Kontrolu

| Endpoint   | Yontem | Aciklama                    |
|------------|--------|-----------------------------|
| `/`        | GET    | Ana sayfa (HTML)            |
| `/api`     | GET    | API saglik kontrolu (JSON)  |
| `/health`  | GET    | Saglik durumu               |

### OpenAI Uyumlu Endpoint'ler

| Endpoint                | Yontem | Aciklama                              |
|-------------------------|--------|---------------------------------------|
| `/v1/models`            | GET    | Kullanilabilir model listesi          |
| `/v1/chat/completions`  | POST   | Chat tamamlama (streaming destekli)   |

### Anthropic Uyumlu Endpoint'ler

| Endpoint      | Yontem | Aciklama                              |
|---------------|--------|---------------------------------------|
| `/v1/messages`| POST   | Anthropic Messages API                |

### Kimlik Dogrulama

**OpenAI Formati:**
```
Authorization: Bearer {PROXY_API_KEY}
```

**Multi-tenant Formati:**
```
Authorization: Bearer {PROXY_API_KEY}:{REFRESH_TOKEN}
```

**Anthropic Formati:**
```
x-api-key: {PROXY_API_KEY}
```

**Kullanici API Key:**
```
Authorization: Bearer sk-xxx
x-api-key: sk-xxx
```

---

## Istek/Yanit Formatlari

### OpenAI Chat Completions Istegi

```json
{
  "model": "claude-sonnet-4-5",
  "messages": [
    {
      "role": "system",
      "content": "Sen yardimci bir asistansin."
    },
    {
      "role": "user",
      "content": "Merhaba!"
    }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4096,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Hava durumu bilgisi al",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {"type": "string"}
          }
        }
      }
    }
  ]
}
```

### Kiro API Payload Formati

```json
{
  "conversationState": {
    "agentContinuationId": "uuid",
    "agentTaskType": "vibe",
    "chatTriggerType": "MANUAL",
    "conversationId": "uuid",
    "currentMessage": {
      "userInputMessage": {
        "content": "kullanici mesaji",
        "modelId": "claude-sonnet-4.5",
        "origin": "AI_EDITOR",
        "images": [],
        "userInputMessageContext": {
          "tools": [],
          "toolResults": []
        }
      }
    },
    "history": []
  },
  "profileArn": "arn:aws:codewhisperer:..."
}
```

### Streaming Yanit Formati (OpenAI SSE)

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"claude-sonnet-4-5","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"claude-sonnet-4-5","choices":[{"index":0,"delta":{"content":"Merhaba"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"claude-sonnet-4-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}

data: [DONE]
```

### Anthropic Messages API Istegi

```json
{
  "model": "claude-sonnet-4-5",
  "messages": [
    {
      "role": "user",
      "content": "Merhaba!"
    }
  ],
  "max_tokens": 4096,
  "system": "Sen yardimci bir asistansin.",
  "stream": true,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

### Anthropic Streaming Yanit Formati

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-5","stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Merhaba"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}

event: message_stop
data: {"type":"message_stop"}
```

---

## AWS Event Stream Ayristirma

### AwsEventStreamParser Sinifi

Kiro API, AWS Event Stream formatinda yanitlar dondurur. Bu ayristirici, binary formati JSON olaylarina donusturur.

**Desteklenen Olay Turleri:**

| Olay Turu       | Pattern                        | Aciklama                    |
|-----------------|--------------------------------|-----------------------------|
| content         | `{"content":...`               | Metin icerigi               |
| tool_start      | `{"name":...`                  | Tool call baslangici        |
| tool_input      | `{"input":...`                 | Tool call parametreleri     |
| tool_stop       | `{"stop":...`                  | Tool call bitisi            |
| usage           | `{"usage":...`                 | Kredi kullanim bilgisi      |
| context_usage   | `{"contextUsagePercentage":... | Bagalam kullanim yuzdesi    |

### Bracket Tool Call Ayristirma

Bazi modeller tool call'lari metin formatinda dondurur:

```
[Called get_weather with args: {"city": "Istanbul"}]
```

Bu format `parse_bracket_tool_calls` fonksiyonu tarafindan ayristirilir.

---

## Thinking Modu

### Extended Thinking Destegi

KiroGate, Anthropic'in Extended Thinking ozelligini destekler. Kiro API `<thinking>...</thinking>` etiketleri dondurur ve bunlar Anthropic formatina donusturulur.

### KiroThinkingTagParser

```python
class KiroThinkingTagParser:
    """
    <thinking> etiketi artirimli ayristirici.

    Ozellikler:
    - Yalnizca ilk <thinking> blogunu ayristirir
    - Yanit <thinking> ile basladiginda etkinlesir
    - Chunk'lar arasi etiket bolunmesini yonetir
    - Tirnak icindeki sahte etiketleri atlar
    """
```

### Thinking Yapilandirmasi

```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

---

## Hata Yonetimi

### HTTP Durum Kodlari

| Kod | Durum                | Aksiyon                                  |
|-----|----------------------|------------------------------------------|
| 200 | Basarili             | Yaniti isle                              |
| 400 | Gecersiz Istek       | Hatayi dondur                            |
| 401 | Yetkisiz             | API key kontrolu                         |
| 403 | Yasakli              | Token yenileme ve yeniden deneme         |
| 429 | Hiz Siniri           | Ustel geri cekilme ile yeniden deneme    |
| 500 | Sunucu Hatasi        | Ustel geri cekilme ile yeniden deneme    |
| 502 | Bad Gateway          | Ustel geri cekilme ile yeniden deneme    |
| 503 | Servis Kullanilamaz  | Ustel geri cekilme ile yeniden deneme    |
| 504 | Gateway Timeout      | Zaman asimi hatasi dondur                |

### Yeniden Deneme Mekanizmasi

```python
# Ustel geri cekilme formulu
delay = BASE_RETRY_DELAY * (2 ** attempt)

# Ornek: BASE_RETRY_DELAY = 1.0
# attempt 0: 1.0 saniye
# attempt 1: 2.0 saniye
# attempt 2: 4.0 saniye
```

### Dogrulama Hata Isleyicisi

Pydantic dogrulama hatalari `validation_exception_handler` tarafindan islenir ve JSON-serializasyon icin temizlenir.

---

## Yapilandirma

### Ortam Degiskenleri

| Degisken                   | Varsayilan                          | Aciklama                              |
|----------------------------|-------------------------------------|---------------------------------------|
| PROXY_API_KEY              | changeme_proxy_secret               | API erisim sifresi                    |
| REFRESH_TOKEN              | (bos)                               | Kiro yenileme tokeni                  |
| PROFILE_ARN                | (bos)                               | AWS CodeWhisperer profil ARN          |
| KIRO_REGION                | us-east-1                           | AWS bolgesi                           |
| KIRO_CREDS_FILE            | (bos)                               | Kimlik bilgisi dosya yolu             |
| LOG_LEVEL                  | INFO                                | Gunluk seviyesi                       |
| DEBUG_MODE                 | off                                 | Hata ayiklama modu (off/errors/all)   |
| DEBUG_DIR                  | debug_logs                          | Hata ayiklama dizini                  |
| FIRST_TOKEN_TIMEOUT        | 120.0                               | Ilk token zaman asimi (saniye)        |
| FIRST_TOKEN_MAX_RETRIES    | 3                                   | Ilk token max deneme                  |
| STREAM_READ_TIMEOUT        | 300.0                               | Stream okuma zaman asimi              |
| NON_STREAM_TIMEOUT         | 900.0                               | Non-stream zaman asimi                |
| RATE_LIMIT_PER_MINUTE      | 0 (devre disi)                      | Dakika basina istek limiti            |
| AUTO_CHUNKING_ENABLED      | False                               | Otomatik parcalama                    |
| AUTO_CHUNK_THRESHOLD       | 150000                              | Parcalama esigi (karakter)            |
| ADMIN_PASSWORD             | admin123                            | Admin panel sifresi                   |
| ADMIN_SECRET_KEY           | kirogate_admin_secret_key_change_me | Session imza anahtari                 |
| TOOL_DESCRIPTION_MAX_LENGTH| 10000                               | Tool aciklama max uzunlugu            |
| SLOW_MODEL_TIMEOUT_MULTIPLIER | 3.0                              | Yavas model zaman asimi carpani       |

### Proxy Yapilandirmasi

```env
# HTTP Proxy
PROXY_URL="http://127.0.0.1:7890"

# SOCKS5 Proxy
PROXY_URL="socks5://127.0.0.1:1080"

# Kimlik dogrulamali proxy
PROXY_USERNAME="user"
PROXY_PASSWORD="pass"
```

---

## Model Esleme

### Harici -> Dahili Model ID Donusumu

| Harici Model Adi              | Kiro Dahili ID                       |
|-------------------------------|--------------------------------------|
| claude-opus-4-5               | claude-opus-4.5                      |
| claude-opus-4-5-20251101      | claude-opus-4.5                      |
| claude-haiku-4-5              | claude-haiku-4.5                     |
| claude-haiku-4-5-20251001     | claude-haiku-4.5                     |
| claude-sonnet-4-5             | CLAUDE_SONNET_4_5_20250929_V1_0      |
| claude-sonnet-4-5-20250929    | CLAUDE_SONNET_4_5_20250929_V1_0      |
| claude-sonnet-4               | CLAUDE_SONNET_4_20250514_V1_0        |
| claude-sonnet-4-20250514      | CLAUDE_SONNET_4_20250514_V1_0        |
| claude-3-7-sonnet-20250219    | CLAUDE_3_7_SONNET_20250219_V1_0      |
| auto                          | claude-sonnet-4.5                    |

### Yavas Modeller

Asagidaki modeller yavas model olarak isaretlenmistir ve daha uzun zaman asimi degerleri kullanilir:

- claude-opus-4-5
- claude-opus-4-5-20251101
- claude-3-opus
- claude-3-opus-20240229

---

## Token Sayimi

### Tiktoken Entegrasyonu

KiroGate, token sayimi icin OpenAI'nin tiktoken kutuphanesini kullanir. `cl100k_base` kodlamasi Claude tokenizasyonuna yakindir.

### Claude Duzeltme Faktoru

Claude, GPT-4'e gore yaklasik %15 daha fazla token uretir. Bu nedenle `CLAUDE_CORRECTION_FACTOR = 1.15` carpani uygulanir.

```python
def count_tokens(text: str, apply_claude_correction: bool = True) -> int:
    base_tokens = len(encoding.encode(text))
    if apply_claude_correction:
        return int(base_tokens * CLAUDE_CORRECTION_FACTOR)
    return base_tokens
```

---

## HTTP Istemci Yonetimi

### Global Baglanti Havuzu

```python
class GlobalHTTPClientManager:
    """
    Global HTTP istemci yoneticisi.

    Her istek icin yeni istemci olusturmak yerine
    global baglanti havuzu kullanir.

    Yapilandirma:
    - max_connections: 100
    - max_keepalive_connections: 20
    - keepalive_expiry: 60.0 saniye
    """
```

### KiroHttpClient

```python
class KiroHttpClient:
    """
    Yeniden deneme mantigi ile Kiro API HTTP istemcisi.

    Hata turleri:
    - 403: Token yenileme ve yeniden deneme
    - 429: Ustel geri cekilme ile yeniden deneme
    - 5xx: Ustel geri cekilme ile yeniden deneme
    - Timeout: Ustel geri cekilme ile yeniden deneme
    """
```

---

## URL Sablonlari

| Servis            | URL Sablonu                                              |
|-------------------|----------------------------------------------------------|
| Token Yenileme    | `https://prod.{region}.auth.desktop.kiro.dev/refreshToken` |
| AWS SSO OIDC      | `https://oidc.{region}.amazonaws.com/token`              |
| Kiro API          | `https://codewhisperer.{region}.amazonaws.com`           |
| Q API             | `https://q.{region}.amazonaws.com`                       |

---

## Guvenlik Notlari

1. **PROXY_API_KEY**: Uretim ortaminda guclu bir sifre kullanin
2. **ADMIN_SECRET_KEY**: Varsayilan degeri mutlaka degistirin
3. **USER_SESSION_SECRET**: Rastgele bir deger kullanin
4. **TOKEN_ENCRYPT_KEY**: 32 byte uzunlugunda olmali

### Uretim Ortami Kontrolleri

KiroGate, uretim ortaminda varsayilan guvenlik anahtarlarinin kullanilmasini engelleyebilir:

```python
is_production = (
    os.environ.get("DOCKER_CONTAINER") == "1" or
    os.path.exists("/.dockerenv") or
    (settings.oauth_client_id and settings.oauth_client_secret)
)

if is_production and critical_issues:
    raise ValueError("Uretim ortaminda varsayilan anahtarlar kullanilamaz!")
```

---

## Sonuc

KiroGate, Kiro API'sini standart OpenAI ve Anthropic arayuzlerine donusturen kapsamli bir gateway cozumudur. Temel ozellikleri sunlardir:

1. **Coklu Kimlik Dogrulama**: Social ve IDC (AWS SSO) destegi
2. **Otomatik Token Yonetimi**: Sureleri dolmadan once otomatik yenileme
3. **Dual API Uyumlulugu**: OpenAI ve Anthropic formatlari
4. **Streaming Destegi**: Hem SSE hem de non-streaming yanitlar
5. **Tool Calling**: Function calling destegiyle entegre
6. **Extended Thinking**: Anthropic thinking modu donusumu
7. **Hata Toleransi**: Ustel geri cekilme ile yeniden deneme mekanizmasi
8. **Yavas Model Destegi**: Opus gibi yavas modeller icin uyarlanabilir zaman asimlari
