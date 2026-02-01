# Business Gemini 2 API - Kapsamli Analiz Dokumantasyonu

Bu dokuman, [business-gemini-2api](https://github.com/lulistart/business-gemini-2api) projesinin detayli teknik analizini icermektedir.

---

## Genel Bakis

| Ozellik              | Aciklama                                                                  |
|----------------------|---------------------------------------------------------------------------|
| **Proje Adi**        | Business Gemini 2 API                                                     |
| **Amac**             | Google Gemini Business hesaplarini OpenAI uyumlu API formatina donusturme |
| **Dil/Framework**    | Python 3.x, Flask, SQLAlchemy                                             |
| **Veritabani**       | SQLite (varsayilan), JSON dosya destegi                                   |
| **Kimlik Dogrulama** | Cookie tabanli (Secure_C_SES, Host_C_OSES), JWT olusturma                 |
| **API Uyumlulugu**   | OpenAI Chat Completions API formatinda                                    |
| **Ozellikler**       | Coklu hesap yonetimi, resim/video uretimi, akis destegi, oto-yenileme     |
| **Lisans**           | MIT                                                                       |

---

## Proje Mimarisi

### Dizin Yapisi

```
business-gemini-2api/
├── backend/                    # Ana API sunucusu (Python/Flask)
│   ├── app/                    # Uygulama modulleri
│   │   ├── __init__.py         # Flask uygulama baslangici
│   │   ├── account_manager.py  # Hesap yonetimi ve havuzlama
│   │   ├── api_key_manager.py  # API anahtar yonetimi
│   │   ├── auth.py             # Kimlik dogrulama sistemi
│   │   ├── chat_handler.py     # Sohbet isleme ve stream
│   │   ├── config.py           # Yapilandirma sabitleri
│   │   ├── database.py         # SQLAlchemy modelleri
│   │   ├── exceptions.py       # Ozel istisna siniflari
│   │   ├── jwt_utils.py        # JWT olusturma araclari
│   │   ├── media_handler.py    # Resim/video isleme
│   │   ├── routes.py           # Flask rota tanimlari
│   │   ├── session_manager.py  # Oturum yonetimi
│   │   ├── tempmail_api.py     # Gecici e-posta istemcisi
│   │   └── utils.py            # Yardimci fonksiyonlar
│   ├── static/                 # Statik dosyalar (JS, CSS)
│   ├── templates/              # HTML sablonlari
│   ├── gemini.py               # Ana giris noktasi
│   └── requirements.txt        # Python bagimliliklari
├── frontend/                   # On yuz paneli (Node.js)
│   └── app-v6.js               # Otomatik kayit botu
└── tempmail/                   # Gecici e-posta servisi (Node.js)
    └── src/index.js            # E-posta servisi
```

---

## Kimlik Dogrulama Sistemi

### Hesap Yapilandirmasi

Her Gemini Business hesabi su bilgileri icerir:

| Alan            | Tur     | Aciklama                                            |
|-----------------|---------|-----------------------------------------------------|
| `team_id`       | String  | Gemini Business takim kimlik numarasi               |
| `secure_c_ses`  | String  | `__Secure-C_SES` cookie degeri (oturum dogrulamasi) |
| `host_c_oses`   | String  | `__Host-C_OSES` cookie degeri (kaynak dogrulamasi)  |
| `csesidx`       | String  | Oturum indeks kimlik numarasi                       |
| `user_agent`    | String  | Isteklerde kullanilacak tarayici kimlik bilgisi     |
| `available`     | Boolean | Hesap kullanilabilirlik durumu                      |
| `tempmail_url`  | String  | Cookie yenileme icin gecici e-posta URL'si          |
| `tempmail_name` | String  | Gecici e-posta kullanici adi                        |

### JWT Token Olusturma Sureci

JWT token olusturma sureci `jwt_utils.py` dosyasinda tanimlanmistir:

```python
# JWT Yapisi
Header: {
    "alg": "HS256",
    "typ": "JWT",
    "kid": "<key_id>"  # XSRF token'dan alinan anahtar kimlik numarasi
}

Payload: {
    "iss": "https://business.gemini.google",
    "aud": "https://biz-discoveryengine.googleapis.com",
    "sub": "csesidx/<csesidx_degeri>",
    "iat": <simdiki_zaman>,
    "exp": <simdiki_zaman + 300>,  # 5 dakika gecerlilik
    "nbf": <simdiki_zaman>
}
```

### XSRF Token Alma

```python
# XSRF token alma URL'si
GETOXSRF_URL = "https://business.gemini.google/auth/getoxsrf"

# Istek baslik bilgileri
headers = {
    "accept": "*/*",
    "user-agent": "<tarayici_kimlik_bilgisi>",
    "cookie": "__Secure-C_SES=<deger>; __Host-C_OSES=<deger>"
}

# Yanittan alinan bilgiler
{
    "keyId": "<anahtar_kimlik_numarasi>",
    "xsrfToken": "<xsrf_token>"  # JWT imzalama icin kullanilir
}
```

### Admin Token Sistemi

Backend yonetimi icin ayri bir token sistemi kullanilir:

```python
# Token olusturma
payload = {
    "exp": time.time() + 86400,  # 24 saat gecerlilik
    "ts": int(time.time())
}

# Token formati: <base64_payload>.<hmac_sha256_imza>
```

---

## Token Yonetimi

### JWT Yasam Dongusu

| Asama          | Sure       | Aciklama                                  |
|----------------|------------|-------------------------------------------|
| Olusturma      | Anlik      | Ilk istek veya yenileme gerektiginde      |
| Gecerlilik     | 300 saniye | JWT'nin gecerli oldugu sure               |
| Yenileme Esigi | 240 saniye | 4 dakika sonra yenileme tetiklenir        |
| Yenileme       | Otomatik   | `ensure_jwt_for_account()` fonksiyonu ile |

### Hesap Durumu Yonetimi

```python
account_states = {
    index: {
        "jwt": None,              # Gecerli JWT token
        "jwt_time": 0,            # JWT olusturma zamani
        "session": None,          # Aktif oturum adii
        "available": True,        # Kullanilabilirlik durumu
        "cooldown_until": None,   # Sogutma bitis zamani
        "cooldown_reason": "",    # Sogutma nedeni
        "cookie_expired": False   # Cookie suresi dolmus mu
    }
}
```

### Sogutma (Cooldown) Sureleri

| Durum                   | Sogutma Suresi     | Aciklama                       |
|-------------------------|--------------------|--------------------------------|
| Kimlik Hatasi (401/403) | 900 saniye (15 dk) | Cookie gecersiz veya yetki yok |
| Rate Limit (429)        | 300 saniye (5 dk)  | veya PT gece yarisina kadar    |
| Genel Hata              | 120 saniye (2 dk)  | Diger API hatalari             |

---

## API Endpoint'leri

### Ana API Rotalari

| Metod  | Endpoint               | Aciklama                         | Yetki        |
|--------|------------------------|----------------------------------|--------------|
| GET    | `/v1/models`           | Model listesini getir            | API Token    |
| POST   | `/v1/chat/completions` | Sohbet tamamlama (akis destekli) | API Token    |
| POST   | `/v1/files`            | Dosya yukleme                    | API Token    |
| GET    | `/v1/files`            | Yuklu dosyalari listele          | API Token    |
| GET    | `/v1/files/<id>`       | Dosya bilgisi getir              | API Token    |
| DELETE | `/v1/files/<id>`       | Dosya sil                        | API Token    |
| GET    | `/v1/status`           | Sistem durumu                    | API Token    |
| GET    | `/health`              | Saglik kontrolu                  | Herkese Acik |
| GET    | `/image/<filename>`    | Onbelleklenmis resim getir       | Herkese Acik |
| GET    | `/video/<filename>`    | Onbelleklenmis video getir       | Herkese Acik |

### Yonetim Endpoint'leri

| Metod  | Endpoint                     | Aciklama                  |
|--------|------------------------------|---------------------------|
| POST   | `/api/login`                 | Yonetici girisi           |
| GET    | `/api/accounts`              | Hesap listesi             |
| POST   | `/api/accounts`              | Hesap ekle                |
| DELETE | `/api/accounts/<id>`         | Hesap sil                 |
| POST   | `/api/accounts/<id>/refresh` | Hesap Cookie'sini yenile  |
| GET    | `/api/config`                | Sistem yapilandirmasi     |
| POST   | `/api/config`                | Yapilandirma guncelle     |
| GET    | `/api/api-keys`              | API anahtarlarini listele |
| POST   | `/api/api-keys`              | API anahtari olustur      |

---

## Istek/Yanit Formatlari

### Chat Completions Istegi

```json
{
    "model": "gemini-enterprise",
    "messages": [
        {
            "role": "user",
            "content": "Merhaba!"
        }
    ],
    "stream": true,
    "conversation_id": "abc123",
    "is_new_conversation": false,
    "image_format": "markdown"
}
```

### Desteklenen Icerik Formatlari

```json
// Duz metin
{
    "role": "user",
    "content": "Merhaba!"
}

// Resimli icerik (OpenAI formati)
{
    "role": "user",
    "content": [
        {"type": "text", "text": "Bu resmi analiz et"},
        {
            "type": "image_url",
            "image_url": {
                "url": "data:image/png;base64,..."
            }
        }
    ]
}

// Dosya referansi
{
    "role": "user",
    "content": [
        {"type": "text", "text": "Bu dosyayi analiz et"},
        {"type": "file", "file_id": "file-abc123"}
    ]
}
```

### Akis Yanit Formati (SSE)

```
data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1234567890,"model":"gemini-enterprise","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1234567890,"model":"gemini-enterprise","choices":[{"index":0,"delta":{"content":"Merhaba"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1234567890,"model":"gemini-enterprise","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Akis Olmayan Yanit Formati

```json
{
    "id": "chatcmpl-abc123",
    "object": "chat.completion",
    "created": 1234567890,
    "model": "gemini-enterprise",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "Merhaba! Size nasil yardimci olabilirim?"
            },
            "finish_reason": "stop"
        }
    ],
    "usage": {
        "prompt_tokens": 10,
        "completion_tokens": 15,
        "total_tokens": 25
    }
}
```

---

## Event Stream (Akis) Isleme

### JSONStreamParser Sinifi

Gemini API'sinden gelen parcali JSON akislarini gercek zamanli olarak isler:

```python
class JSONStreamParser:
    def __init__(self):
        self.buffer = ""
        self.decoder = json.JSONDecoder()

    def decode(self, chunk: str) -> List[dict]:
        """Parcali JSON verisini ayristir, tam JSON nesneleri listesi dondur"""
        self.buffer += chunk
        results = []
        while True:
            self.buffer = self.buffer.lstrip()
            # Dizi baslangici veya ayiriciyi atla
            if self.buffer.startswith("[") or self.buffer.startswith(","):
                self.buffer = self.buffer[1:]
                continue

            if not self.buffer:
                break

            try:
                obj, idx = self.decoder.raw_decode(self.buffer)
                results.append(obj)
                self.buffer = self.buffer[idx:]
            except json.JSONDecodeError:
                break  # Eksik veri, sonraki chunk'i bekle
        return results
```

### Gemini API Yanit Yapisi

```python
# streamAssistResponse yapisi
{
    "streamAssistResponse": {
        "sessionInfo": {
            "session": "sessions/xyz123"
        },
        "answer": {
            "replies": [
                {
                    "groundedContent": {
                        "content": {
                            "text": "Yanit metni",
                            "thought": false,  # True ise dusunce sureci, filtrelenir
                            "file": {
                                "fileId": "abc123",
                                "mimeType": "image/png",
                                "name": "uretilen_resim.png"
                            }
                        }
                    },
                    "attachments": []
                }
            ],
            "generatedImages": [
                {
                    "image": {
                        "bytesBase64Encoded": "<base64_veri>",
                        "mimeType": "image/png"
                    }
                }
            ]
        }
    }
}
```

### Resim Formati Algilama

```python
def detect_client_image_format(request, request_data) -> str:
    """
    Oncelik sirasi:
    1. Istek parametresi (image_format/response_format)
    2. User-Agent tabanli (Cherry Studio -> markdown)
    3. Mesaj formati (dizi formati destegi)
    4. Varsayilan: markdown (en genis uyumluluk)
    """
    # Markdown formati gerektiren istemciler
    markdown_clients = ['cherry', 'studio', 'go-http-client']

    # Dizi formati destekleyen istemciler
    array_clients = ['cursor', 'vscode', 'chatgpt', 'openai', 'anthropic']
```

---

## Hata Yonetimi

### Istisna Sinif Hiyerarsisi

```python
class AccountError(Exception):
    """Temel hesap istisnasi"""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code

class AccountAuthError(AccountError):
    """Kimlik/yetki ile ilgili istisnalar (401, 403)"""

class AccountRateLimitError(AccountError):
    """Kota veya hiz siniri istisnalari (429)"""

class AccountRequestError(AccountError):
    """Diger istek istisnalari"""

class NoAvailableAccount(AccountError):
    """Kullanilabilir hesap yok istisnasi"""
```

### Hata Kodlari ve Eylemler

| HTTP Kodu | Istisna Tipi          | Eylem                                        |
|-----------|-----------------------|----------------------------------------------|
| 401       | AccountAuthError      | Hesabi devre disi birak, 15 dk sogutma       |
| 403       | AccountAuthError      | Hesabi devre disi birak, 15 dk sogutma       |
| 429       | AccountRateLimitError | Kota tipine gore sogutma veya PT gece yarisi |
| 500       | AccountRequestError   | Oturumu temizle, 30 sn sogutma               |
| Diger     | AccountRequestError   | Genel sogutma (2 dk)                         |

### Pasif Kota Tespiti

Sistem, kota durumunu proaktif kontrol etmek yerine API hatalari uzerinden pasif olarak tespit eder:

```python
def raise_for_account_response(resp, action, account_idx, quota_type):
    """
    Pasif kota hatasi tespiti:
    - 429 hatasi: kota tipi belirtilmisse o tipi sogut
    - 401/403: tum hesabi sogut
    """
    if account_idx is not None and status in (401, 403, 429):
        if status == 429 and quota_type:
            # Kota tipine gore sogutma (ornegin: images, videos)
            account_manager.mark_quota_error(account_idx, status, error_msg, quota_type)
        else:
            # Tum hesabi sogut
            account_manager.mark_quota_error(account_idx, status, error_msg, None)
```

---

## Yapilandirma

### Ortam Degiskenleri

| Degisken                 | Varsayilan | Aciklama                          |
|--------------------------|------------|-----------------------------------|
| `ADMIN_PASSWORD`         | (gerekli)  | Yonetici paneli sifresi           |
| `DATA_DIR`               | `./`       | Veritabani ve onbellek dizini     |
| `TEMP_MAIL_URL`          | -          | Gecici e-posta servisi adresi     |
| `LOG_LEVEL`              | `INFO`     | Log seviyesi (DEBUG, INFO, ERROR) |
| `API_KEY_ENCRYPTION_KEY` | (otomatik) | API anahtari sifreleme anahtari   |

### Sistem Yapilandirmasi (Veritabani)

| Anahtar                 | Tur    | Aciklama                                |
|-------------------------|--------|-----------------------------------------|
| `proxy`                 | string | HTTP/HTTPS proxy adresi                 |
| `proxy_enabled`         | bool   | Proxy kullanimi aktif mi                |
| `image_base_url`        | string | Resim URL'leri icin temel adres         |
| `upload_endpoint`       | string | Harici resim yukleme endpoint'i (cfbed) |
| `upload_api_token`      | string | Harici yukleme API token'i              |
| `auto_refresh_cookie`   | bool   | Otomatik Cookie yenileme aktif mi       |
| `health_check_enabled`  | bool   | Saglik kontrolu aktif mi                |
| `health_check_interval` | int    | Saglik kontrolu araligi (dakika)        |
| `admin_secret_key`      | string | Admin token imzalama anahtari           |

### Model Yapilandirmasi

```python
{
    "models": [
        {
            "id": "gemini-enterprise",       # Kullanici tarafindan gorulen ID
            "name": "Gemini Enterprise",     # Goruntulenen ad
            "description": "...",            # Aciklama
            "api_model_id": "gemini-pro",    # Gercek API model ID'si
            "context_length": 32768,         # Baglam uzunlugu
            "max_tokens": 8192,              # Maksimum token sayisi
            "enabled": true,                 # Aktif mi
            "account_index": 0               # Tercih edilen hesap indeksi
        }
    ]
}
```

---

## Veritabani Semasi

### Tablolar

#### accounts

| Sutun              | Tur      | Aciklama                 |
|--------------------|----------|--------------------------|
| `id`               | Integer  | Birincil anahtar         |
| `team_id`          | String   | Gemini takim ID'si       |
| `secure_c_ses`     | Text     | Guvenli oturum cookie'si |
| `host_c_oses`      | Text     | Host cookie'si           |
| `csesidx`          | String   | Oturum indeksi           |
| `user_agent`       | Text     | Tarayici kimlik bilgisi  |
| `available`        | Boolean  | Kullanilabilirlik durumu |
| `tempmail_url`     | Text     | Gecici e-posta URL'si    |
| `tempmail_name`    | String   | Gecici e-posta adi       |
| `quota_usage_json` | Text     | Kota kullanimi (JSON)    |
| `quota_reset_date` | String   | Kota sifirlama tarihi    |
| `created_at`       | DateTime | Olusturulma zamani       |
| `updated_at`       | DateTime | Guncellenme zamani       |

#### api_keys

| Sutun           | Tur      | Aciklama                       |
|-----------------|----------|--------------------------------|
| `id`            | Integer  | Birincil anahtar               |
| `key_hash`      | String   | SHA256 hash (dogrulama icin)   |
| `encrypted_key` | Text     | Sifrelenmis anahtar (gosterim) |
| `name`          | String   | Anahtar adi                    |
| `created_at`    | DateTime | Olusturulma zamani             |
| `expires_at`    | DateTime | Son kullanma tarihi            |
| `is_active`     | Boolean  | Aktif durumu                   |
| `usage_count`   | Integer  | Kullanim sayisi                |
| `last_used_at`  | DateTime | Son kullanim zamani            |

#### models

| Sutun            | Tur     | Aciklama               |
|------------------|---------|------------------------|
| `id`             | Integer | Birincil anahtar       |
| `model_id`       | String  | Benzersiz model ID'si  |
| `name`           | String  | Model adi              |
| `description`    | Text    | Aciklama               |
| `api_model_id`   | String  | Gercek API model ID'si |
| `context_length` | Integer | Baglam uzunlugu        |
| `max_tokens`     | Integer | Maksimum token         |
| `enabled`        | Boolean | Aktif durumu           |
| `account_index`  | Integer | Tercih edilen hesap    |

#### system_config

| Sutun        | Tur     | Aciklama                             |
|--------------|---------|--------------------------------------|
| `id`         | Integer | Birincil anahtar                     |
| `key`        | String  | Yapilandirma anahtari                |
| `value`      | Text    | Yapilandirma degeri                  |
| `value_type` | String  | Deger tipi (string, bool, int, json) |

---

## Hesap Havuzlama ve Dongusel Kullanim

### Dongusel Secim Algoritmasi

```python
def get_next_account(quota_type=None):
    """
    Dongusel olarak bir sonraki kullanilabilir hesabi sec

    Args:
        quota_type: Opsiyonel kota tipi (images, videos, text_queries)
    """
    available = get_available_accounts(quota_type)
    if not available:
        raise NoAvailableAccount("Kullanilabilir hesap yok")

    # Kullanilabilir liste icinde dongusal pozisyon
    list_index = current_index % len(available)
    idx, account = available[list_index]
    current_index = (current_index + 1) % len(available)

    return idx, account
```

### Kullanilabilirlik Kontrolu

```python
def is_account_available(index, quota_type=None):
    """
    Hesabin kullanilabilir olup olmadigini kontrol et

    Kontroller:
    1. available == True (manuel olarak devre disi degilse)
    2. Sogutma surecinde degil
    3. Belirtilen kota tipi icin sogutma surecinde degil
    """
```

---

## Saglik Kontrolu

### Periyodik Kontrol

```python
def run_health_check(account_manager, auto_delete=False):
    """
    Tum hesaplarda saglik kontrolu calistir

    Kontrol icerigi:
    1. Cookie alanlarinin varligini dogrula
    2. JWT token almaya calis
    3. Basarili/basarisiz sonuclari logla

    Secenek:
    - auto_delete: Basarisiz hesaplari otomatik sil
    """
```

### Kontrol Sonuclari

| Sonuc         | Durum           | Eylem                               |
|---------------|-----------------|-------------------------------------|
| Basarili      | available=True  | Hesap kullanima hazir               |
| Kimlik Hatasi | available=False | Hesabi devre disi birak veya sil    |
| Rate Limit    | rate_limited    | Basari olarak sayilir, gecici durum |
| Diger Hata    | available=False | Hesabi devre disi birak veya sil    |

---

## Resim ve Video Isleme

### Onbellekleme

| Medya | Dizin               | Onbellek Suresi |
|-------|---------------------|-----------------|
| Resim | `<DATA_DIR>/image/` | 1 saat          |
| Video | `<DATA_DIR>/video/` | 6 saat          |

### Dosya Indirme

```python
def download_file_with_jwt(jwt, session_name, file_id, proxy):
    """
    JWT kimlik dogrulamasi ile dosya indir

    URL formati:
    https://biz-discoveryengine.googleapis.com/v1alpha/{session}:downloadFile?fileId={id}&alt=media
    """
```

### Harici Yukleme (cfbed)

Sistem, resimleri harici bir servise yukleyebilir:

```python
# cfbed yapilandirmasi
upload_endpoint = "https://example.com/upload"
upload_api_token = "api_token"
image_base_url = "https://cdn.example.com/"

# Sonuc: https://cdn.example.com/file/abc123_image.jpg
```

---

## Oturum Yonetimi

### Oturum Olusturma

```python
def create_chat_session(jwt, team_id, proxy):
    """
    Yeni sohbet oturumu olustur

    API: POST https://biz-discoveryengine.googleapis.com/v1alpha/locations/global/widgetCreateSession

    Istek govdesi:
    {
        "configId": "<team_id>",
        "additionalParams": {"token": "-"},
        "createSessionRequest": {
            "session": {"name": "<oturum_id>", "displayName": "<oturum_id>"}
        }
    }
    """
```

### Konusma Oturum Eslemesi

Farkli konusmalar icin ayri oturumlar korunur:

```python
conversation_sessions = {
    account_idx: {
        conversation_id: session_name,
        # ...
    }
}
```

### Oturum Yeniden Kullanimi

- Ayni `conversation_id` ile gelen istekler mevcut oturumu kullanir
- `is_new_conversation=True` yeni oturum olusturur
- Dosya yukleme yapilmissa dosyanin oturumu tercih edilir

---

## Kiro Projesi ile Karsilastirma

| Ozellik          | Business Gemini 2 API    | Kiro                          |
|------------------|--------------------------|-------------------------------|
| Hedef Platform   | Google Gemini Business   | AWS CodeWhisperer (Kiro)      |
| Kimlik Dogrulama | Cookie + JWT olusturma   | OAuth2 / Builder ID / IdC     |
| Token Yenileme   | 5 dakikada bir otomatik  | 10 dakika oncesinden otomatik |
| API Formati      | OpenAI uyumlu            | OpenAI/Claude uyumlu          |
| Veritabani       | SQLite                   | MySQL                         |
| Akis Destegi     | SSE (Server-Sent Events) | AWS Event Stream              |
| Coklu Hesap      | Dongusel havuzlama       | Dongusel havuzlama            |
| Hata Kurtarma    | Pasif kota tespiti       | Aktif yeniden deneme          |

---

## Sonuc

Business Gemini 2 API, Google Gemini Business hesaplarini OpenAI uyumlu bir API'ye donusturen kapsamli bir sistemdir. Temel ozellikleri:

1. **Guvenli Kimlik Dogrulama**: Cookie tabanli JWT token olusturma
2. **Akilli Havuzlama**: Dongusel hesap secimi ve otomatik sogutma
3. **Gercek Zamanli Akis**: SSE ile chunk-by-chunk yanit iletimi
4. **Medya Destegi**: Resim ve video uretimi ve isleme
5. **Hata Dayanikliligi**: Pasif kota tespiti ve otomatik kurtarma
6. **Genisletilebilirlik**: Modular mimari ve veritabani destegi

Bu analiz, Kiro projesine benzer ozelliklerin nasil uygulanabilecegine dair referans saglamaktadir.

---

## Kaynaklar

- Kaynak Kod: [github.com/lulistart/business-gemini-2api](https://github.com/lulistart/business-gemini-2api)
- Analiz Tarihi: Subat 2026
- Surum: v1.0.0
