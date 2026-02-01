# HaoYan-A/kiro-api Analiz Dokumantasyonu

Bu dokuman, [HaoYan-A/kiro-api](https://github.com/HaoYan-A/kiro-api) deposunun kapsamli bir analizini icermektedir. Proje, Anthropic Claude API isteklerini AWS CodeWhisperer'a donusturmek icin tasarlanmis bir Python proxy sunucusudur.

## Genel Bakis

| Ozellik              | Deger                                                      |
|----------------------|------------------------------------------------------------|
| **Proje Adi**        | Kiro API                                                   |
| **Dil**              | Python 3.12+                                               |
| **Framework**        | FastAPI + Uvicorn                                          |
| **Varsayilan Port**  | 8080                                                       |
| **Veritabani**       | JSON dosya tabanlari depolama                              |
| **Kimlik Dogrulama** | HTTP Basic Auth (Admin), API Key (Istemci)                 |
| **Lisans**           | MIT                                                        |
| **Ilham Kaynagi**    | [kiro2cc](https://github.com/bestK/kiro2cc) (Go versiyonu) |

## Dosya Yapisi

```
kiro-api/
├── app/
│   ├── __init__.py           # Modul baslangici
│   ├── account_service.py    # Hesap yonetim servisi
│   ├── admin_routes.py       # Admin API rotalari
│   ├── api_proxy.py          # API proxy mantigi
│   ├── auth.py               # Kimlik dogrulama modulu
│   ├── config.py             # Yapilandirma yonetimi
│   ├── event_stream_parser.py # AWS Event Stream ayrıstirici
│   ├── models.py             # Veri modelleri (Pydantic)
│   ├── request_converter.py  # Anthropic -> CodeWhisperer donusturucu
│   ├── response_parser.py    # CodeWhisperer yanit ayrıstirici
│   ├── storage.py            # JSON dosya depolama servisi
│   ├── stream_handler.py     # Akis isleme modulu
│   └── token_manager.py      # Token yonetimi
├── data/                     # Hesap ve token depolama
│   ├── accounts.json         # Hesap verileri
│   └── tokens/               # Token dosyalari
├── static/                   # Onceden derlanmis frontend
├── web/                      # Frontend kaynak kodu (React + Vite)
├── server.py                 # Ana sunucu giris noktasi
├── config.yaml               # Yapilandirma dosyasi
├── config.example.yaml       # Ornek yapilandirma
├── requirements.txt          # Python bagimlikları
├── Dockerfile                # Docker imaji tanimlari
└── docker-compose.yml        # Docker Compose yapilandirmasi
```

## Kimlik Dogrulama (Authentication)

### 1. Admin Panel Kimlik Dogrulama

Admin paneli HTTP Basic Authentication kullanir.

**Dosya:** `app/auth.py`

| Parametre        | Varsayilan | Aciklama                      |
|------------------|------------|-------------------------------|
| `ADMIN_USERNAME` | `admin`    | Ortam degiskeni ile ayarlanir |
| `ADMIN_PASSWORD` | `admin123` | Ortam degiskeni ile ayarlanir |

```python
# Kimlik dogrulama kontrolu
def verify_credentials(credentials: HTTPBasicCredentials) -> bool:
    correct_username = secrets.compare_digest(credentials.username, ADMIN_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)
    return correct_username and correct_password
```

### 2. API Istemci Kimlik Dogrulamasi

API istekleri iki yontemle dogrulanabilir:

| Yontem           | Header                      | Ornek                 |
|------------------|-----------------------------|-----------------------|
| **x-api-key**    | `x-api-key: sk-kiro-xxx`    | Dogrudan API anahtari |
| **Bearer Token** | `Authorization: Bearer xxx` | Bearer token formati  |

```python
# API Key cikarma mantigi
api_key = x_api_key
if not api_key and authorization:
    if authorization.startswith("Bearer "):
        api_key = authorization[7:]
```

### 3. Token Dosya Yapisi

AWS SSO cache dosyalarindan alinan token verileri:

**Ana Token Dosyasi:** `~/.aws/sso/cache/kiro-auth-token.json`

```json
{
    "accessToken": "eyJraWQiOi...",
    "refreshToken": "Atza|IwEB...",
    "expiresAt": "2025-01-15T10:30:00.000Z",
    "clientIdHash": "abc123...",
    "authMethod": "social",
    "provider": "google",
    "region": "us-east-1"
}
```

**Client Credentials Dosyasi:** `~/.aws/sso/cache/{clientIdHash}.json`

```json
{
    "clientId": "arn:aws:sso::...",
    "clientSecret": "secret-value-here"
}
```

## Token Yonetimi

**Dosya:** `app/token_manager.py`

### TokenData Sinifi

Token verilerini temsil eden ana sinif:

| Ozellik          | Tur | Aciklama                         |
|------------------|-----|----------------------------------|
| `access_token`   | str | Erisim tokeni                    |
| `refresh_token`  | str | Yenileme tokeni                  |
| `expires_at`     | str | ISO 8601 formatinda son kullanma |
| `client_id_hash` | str | Client credentials dosya adi     |
| `auth_method`    | str | Kimlik dogrulama yontemi         |
| `provider`       | str | OAuth saglayici (google, vb.)    |
| `region`         | str | AWS bolgesi                      |

### Token Yenileme Akisi

```
Token Kontrolu
     │
     ▼
┌────────────────────┐
│ Token suresi dolmus│
│    mu kontrol et   │
│ (5 dakika tampon)  │
└────────────────────┘
     │
     ▼ Evet
┌────────────────────┐
│ Client Credentials │
│    dosyasini oku   │
└────────────────────┘
     │
     ▼
┌────────────────────┐
│   OIDC Token       │
│   Yenileme API     │
└────────────────────┘
     │
     ▼
┌────────────────────┐
│  Yeni token kaydet │
└────────────────────┘
```

### Token Yenileme API Cagrilari

**Yenileme URL'i:** `https://oidc.us-east-1.amazonaws.com/token`

```python
payload = {
    "clientId": client_id,
    "clientSecret": client_secret,
    "grantType": "refresh_token",
    "refreshToken": token.refresh_token,
}
```

**Alternatif URL (Kiro Desktop):** `https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken`

### Profile ARN Otomatik Kesfetme

**URL:** `https://q.us-east-1.amazonaws.com/ListAvailableProfiles`

```python
async def fetch_profile_arn(self, account: AccountConfig) -> str:
    response = await client.post(
        self.LIST_PROFILES_URL,
        json={},
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token.access_token}"
        }
    )
    profiles = result.get("profiles", [])
    profile_arn = profiles[0].get("arn", "")
    return profile_arn
```

## API Endpoint'leri

### Ana API Endpoint'leri

| Endpoint              | Yontem | Kimlik Dogrulama | Aciklama                    |
|-----------------------|--------|------------------|-----------------------------|
| `/v1/messages`        | POST   | API Key          | Anthropic API proxy         |
| `/claude/v1/messages` | POST   | API Key          | Anthropic API proxy (alias) |
| `/health`             | GET    | Yok              | Saglik kontrolu             |
| `/`                   | GET    | Yok              | Web admin paneli            |

### Admin API Endpoint'leri

| Endpoint                         | Yontem | Aciklama                            |
|----------------------------------|--------|-------------------------------------|
| `/admin/accounts`                | GET    | Tum hesaplari listele               |
| `/admin/accounts`                | POST   | Yeni hesap olustur                  |
| `/admin/accounts/{name}`         | GET    | Hesap detaylarini getir             |
| `/admin/accounts/{name}`         | PUT    | Hesabi guncelle                     |
| `/admin/accounts/{name}`         | DELETE | Hesabi sil                          |
| `/admin/accounts/{name}/toggle`  | POST   | Hesabi etkinlestir/devre disi birak |
| `/admin/accounts/{name}/token`   | POST   | Token verilerini guncelle           |
| `/admin/accounts/{name}/refresh` | POST   | Token yenile                        |
| `/admin/accounts/{name}/test`    | POST   | Hesabi test et                      |
| `/admin/check-auth`              | GET    | Kimlik dogrulama durumu             |

## Istek/Yanit Formatlari

### Anthropic API Istek Formati

**Dosya:** `app/models.py`

```python
class AnthropicRequest(BaseModel):
    model: str                                    # Model adi
    messages: List[AnthropicMessage]              # Mesaj listesi
    max_tokens: int = 4096                        # Maksimum token sayisi
    temperature: Optional[float] = None           # Sicaklik parametresi
    top_p: Optional[float] = None                 # Top-p ornekleme
    top_k: Optional[int] = None                   # Top-k ornekleme
    stream: bool = False                          # Akis modu
    system: Optional[Union[str, List]] = None     # Sistem mesaji
    stop_sequences: Optional[List[str]] = None    # Durma dizileri
    tools: Optional[List[Dict]] = None            # Arac tanimlari
    tool_choice: Optional[Dict] = None            # Arac secimi
    metadata: Optional[Dict] = None               # Metadata
```

### CodeWhisperer Istek Donusumu

**Dosya:** `app/request_converter.py`

Anthropic istekleri CodeWhisperer formatina donusturulur:

```python
cw_request = {
    "profileArn": profile_arn,
    "conversationState": {
        "chatTriggerType": "MANUAL",
        "conversationId": generate_uuid(),
        "currentMessage": {
            "userInputMessage": {
                "content": current_message_content,
                "modelId": mapped_model,
                "origin": "AI_EDITOR",
                "userInputMessageContext": {}
            }
        },
        "history": []
    }
}
```

### Model Esleme

| Anthropic Model             | CodeWhisperer Model |
|-----------------------------|---------------------|
| `claude-sonnet-4-20250514`  | `claude-sonnet-4.5` |
| `claude-sonnet-4-5`         | `claude-sonnet-4.5` |
| `claude-opus-4-20250514`    | `claude-opus-4.5`   |
| `claude-opus-4-5`           | `claude-opus-4.5`   |
| `claude-opus-4-5-20251101`  | `claude-opus-4.5`   |
| `claude-3-5-haiku-20241022` | `claude-sonnet-4.5` |

### Anthropic API Yanit Formati

```json
{
    "id": "msg_20250115120000",
    "type": "message",
    "role": "assistant",
    "content": [
        {
            "type": "text",
            "text": "Merhaba! Size nasil yardimci olabilirim?"
        }
    ],
    "model": "claude-sonnet-4-20250514",
    "stop_reason": "end_turn",
    "stop_sequence": null,
    "usage": {
        "input_tokens": 10,
        "output_tokens": 25
    }
}
```

## AWS Event Stream Ayrıstirma

**Dosya:** `app/event_stream_parser.py`

### Event Stream Formati

AWS CodeWhisperer, `application/vnd.amazon.eventstream` formatinda yanit dondurur.

```
┌──────────────────────────────────────────┐
│ Prelude (12 bytes)                       │
├──────────────────────────────────────────┤
│ Total Length     (4 bytes, big-endian)   │
│ Headers Length   (4 bytes, big-endian)   │
│ Prelude CRC      (4 bytes, big-endian)   │
├──────────────────────────────────────────┤
│ Headers (degisken uzunluk)               │
├──────────────────────────────────────────┤
│ Payload (degisken uzunluk)               │
├──────────────────────────────────────────┤
│ Message CRC      (4 bytes, big-endian)   │
└──────────────────────────────────────────┘
```

### Header Ayrıstirma

```python
@staticmethod
def parse_headers(headers_data: bytes) -> Dict[str, str]:
    # Header formati:
    # - Header name length (1 byte)
    # - Header name (degisken)
    # - Header value type (1 byte, 7=string)
    # - Header value length (2 bytes, big-endian)
    # - Header value (degisken)
```

### Olay Turleri

| Olay Turu                | Aciklama                         |
|--------------------------|----------------------------------|
| `initial-response`       | Ilk yanit, conversationId icerir |
| `assistantResponseEvent` | Metin icerigi                    |
| `toolUseEvent`           | Arac kullanimi                   |

## Akis (Streaming) Yonetimi

**Dosya:** `app/stream_handler.py`

### StreamHandler Sinifi

Akis olaylarini isleyen ana sinif:

| Ozellik                 | Tur  | Aciklama                    |
|-------------------------|------|-----------------------------|
| `response_buffer`       | list | Yanit metni biriktiricisi   |
| `content_block_index`   | int  | Icerik blogu indeksi        |
| `content_block_started` | bool | Icerik blogu baslatildi mi  |
| `message_start_sent`    | bool | message_start gonderildi mi |
| `current_tool_use`      | dict | Aktif arac kullanimi        |
| `in_think_block`        | bool | Thinking blogu icinde mi    |

### SSE Olay Donusumu

Anthropic SSE formati:

```
event: message_start
data: {"type": "message_start", "message": {...}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {...}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "..."}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {...}}

event: message_stop
data: {"type": "message_stop"}
```

### Thinking Tag Isleme

Sistem `<thinking>` ve `</thinking>` etiketlerini tanir ve ayri bir icerik blogu olarak isler:

```python
THINKING_START_TAG = "<thinking>"
THINKING_END_TAG = "</thinking>"
```

## Hata Yonetimi

### HTTP Durum Kodlari

| Kod | Aciklama       | Islem                |
|-----|----------------|----------------------|
| 200 | Basarili       | Yaniti isle          |
| 400 | Gecersiz istek | Hata mesaji dondur   |
| 401 | Yetkisiz       | Token yenileme dene  |
| 403 | Yasak          | Token yenileme dene  |
| 404 | Bulunamadi     | Hata mesaji dondur   |
| 500 | Sunucu hatasi  | Detayli hata loglama |

### Otomatik Token Yenileme

401/403 hatalarinda otomatik token yenileme:

```python
if response.status_code in (401, 403) and retry_on_auth_error:
    logger.warning(f"Got {response.status_code}, attempting token refresh...")
    token = await token_manager.get_token(account, force_refresh=True)
    headers["Authorization"] = f"Bearer {token.access_token}"
    # Istegi tekrarla
```

### Hata Yanit Formati

```json
{
    "error": {
        "type": "api_error",
        "message": "CodeWhisperer returned status 500: ..."
    }
}
```

## Yapilandirma

### Ortam Degiskenleri

| Degisken         | Varsayilan | Aciklama                  |
|------------------|------------|---------------------------|
| `ADMIN_USERNAME` | `admin`    | Admin panel kullanici adi |
| `ADMIN_PASSWORD` | `admin123` | Admin panel sifresi       |

### config.yaml Yapisi

```yaml
server:
  host: "0.0.0.0"
  port: 8080

accounts:
  - name: "example"
    api_key: "sk-kiro-example-your-secret-key"
    token_file: "~/.aws/sso/cache/kiro-auth-token.json"

model_mapping:
  claude-sonnet-4-20250514: "claude-sonnet-4.5"
  claude-sonnet-4-5: "claude-sonnet-4.5"
  claude-opus-4-20250514: "claude-opus-4.5"
  claude-opus-4-5: "claude-opus-4.5"
  claude-opus-4-5-20251101: "claude-opus-4.5"
  claude-3-5-haiku-20241022: "claude-sonnet-4.5"

api:
  codewhisperer_url: "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
  refresh_url: "https://oidc.us-east-1.amazonaws.com/token"
```

### Depolama Yapisi

**Hesap Dosyasi:** `data/accounts.json`

```json
{
    "accounts": [
        {
            "name": "user1",
            "api_key": "sk-kiro-user1-abc123...",
            "enabled": true,
            "created_at": "2025-01-15T10:00:00+00:00",
            "updated_at": "2025-01-15T10:00:00+00:00"
        }
    ]
}
```

**Token Dosyasi:** `data/tokens/{account_name}.json`

```json
{
    "access_token": "eyJraWQiOi...",
    "refresh_token": "Atza|IwEB...",
    "expires_at": "2025-01-15T11:00:00.000Z",
    "client_id_hash": "abc123...",
    "client_id": "arn:aws:sso::...",
    "client_secret": "secret..."
}
```

## Docker Dagitimi

### Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY server.py .
COPY config.yaml .
COPY static/ ./static/

RUN mkdir -p /app/data/tokens

ENV ADMIN_USERNAME=admin
ENV ADMIN_PASSWORD=admin123

EXPOSE 8080

CMD ["python3", "server.py", "--port", "8080", "--host", "0.0.0.0"]
```

### Docker Compose

```yaml
services:
  kiro-api:
    build: .
    container_name: kiro-api
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - ./config.yaml:/app/config.yaml:ro
    environment:
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=your_secure_password
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Bagimlilıklar

| Paket               | Versiyon   | Aciklama           |
|---------------------|------------|--------------------|
| `fastapi`           | >= 0.104.0 | Web framework      |
| `uvicorn`           | >= 0.24.0  | ASGI sunucu        |
| `httpx`             | >= 0.25.0  | Async HTTP istemci |
| `pyyaml`            | >= 6.0     | YAML ayrıstirma    |
| `pydantic`          | >= 2.0.0   | Veri dogrulama     |
| `pydantic-settings` | >= 2.0.0   | Ayar yonetimi      |
| `python-multipart`  | >= 0.0.6   | Form veri isleme   |
| `tiktoken`          | >= 0.5.1   | Token sayma        |

## Token Sayma

**Dosya:** `app/token_manager.py` ve `app/stream_handler.py`

Token sayimi icin `tiktoken` kutuphanesi kullanilir:

```python
def estimate_input_tokens(anthropic_req) -> int:
    try:
        import tiktoken
        encoding = tiktoken.get_encoding("cl100k_base")
        # Sistem mesaji, kullanici mesajlari ve araclari birlestir
        full_text = "\n".join(text_parts)
        tokens = len(encoding.encode(full_text))
        return tokens
    except ImportError:
        # Basitlestirılmis tahmin: her 4 karakter = 1 token
        return max(1, total_chars // 4)
```

## Arac (Tool) Kullanimi Destegi

### Arac Tanim Donusumu

Anthropic arac formati CodeWhisperer formatina donusturulur:

```python
def convert_tools(tools: List[Dict]) -> List[Dict]:
    cw_tools = []
    for tool in tools:
        cw_tool = {
            "toolSpecification": {
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "inputSchema": {
                    "json": tool.get("input_schema", {})
                }
            }
        }
        cw_tools.append(cw_tool)
    return cw_tools
```

### Arac Kullanimi Olay Akisi

```
┌────────────────────┐
│ toolUseEvent       │
│ (baslangic)        │
└────────────────────┘
        │
        ▼
┌────────────────────┐
│ content_block_start│
│ type: "tool_use"   │
└────────────────────┘
        │
        ▼
┌────────────────────┐
│ toolUseEvent       │
│ (input parcalari)  │
└────────────────────┘
        │
        ▼
┌────────────────────┐
│ content_block_delta│
│ input_json_delta   │
└────────────────────┘
        │
        ▼
┌────────────────────┐
│ toolUseEvent       │
│ (stop: true)       │
└────────────────────┘
        │
        ▼
┌────────────────────┐
│ content_block_stop │
└────────────────────┘
```

## Karsilastirma: HaoYan-A/kiro-api vs Mevcut Proje

| Ozellik              | HaoYan-A/kiro-api   | Mevcut Proje               |
|----------------------|---------------------|----------------------------|
| **Dil**              | Python              | Node.js                    |
| **Framework**        | FastAPI             | Express.js                 |
| **Veritabani**       | JSON dosyalari      | MySQL                      |
| **Coklu Saglayici**  | Hayir (Sadece Kiro) | Evet (Gemini, Vertex, vb.) |
| **Kimlik Dogrulama** | Social Auth         | Social, Builder ID, IdC    |
| **Cluster Modu**     | Hayir               | Evet                       |
| **Token Depolama**   | Dosya tabanlari     | Veritabani tabanlari       |
| **Web Arayuzu**      | React + Vite        | Yerlesik HTML/JS           |
| **Docker Destegi**   | Evet                | Evet                       |

## Sonuc

HaoYan-A/kiro-api, Anthropic Claude API isteklerini AWS CodeWhisperer'a yonlendirmek icin hafif ve etkili bir cozum sunmaktadir. Proje, JSON dosya tabanli depolama ile basit bir mimari sunarken, coklu hesap destegi, otomatik token yenileme ve akis yanit destegi gibi temel ozellikleri icermektedir. Python/FastAPI ekosistemi sayesinde hizli gelistirme ve kolay bakim imkani saglamaktadir.
