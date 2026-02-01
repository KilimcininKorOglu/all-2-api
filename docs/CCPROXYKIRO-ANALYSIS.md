# CCPROXYKIRO Analizi

Bu belge, [ccproxykiro](https://github.com/stevengonsalvez/ccproxykiro) projesinin kapsamli bir analizini icermektedir. Proje, Kiro (AWS CodeWhisperer) kimlik dogrulama tokenlarini yonetmek ve Anthropic API isteklerini AWS CodeWhisperer API'sine proxy olarak yonlendirmek icin gelistirilmis bir Go CLI aracidir.

## Genel Bakis

| Ozellik              | Deger                                                    |
|----------------------|----------------------------------------------------------|
| Proje Adi            | ccproxykiro                                              |
| Dil                  | Go 1.23.3                                                |
| Lisans               | Belirtilmemis                                            |
| Repository           | https://github.com/stevengonsalvez/ccproxykiro           |
| Temel Islevsellik    | Kiro token yonetimi ve Anthropic API proxy               |
| Hedef Platform       | Windows, Linux, macOS (cross-platform)                   |
| API Uyumlulugu       | Anthropic Messages API (Claude Code uyumlu)              |
| Backend Servisi      | AWS CodeWhisperer (generateAssistantResponse)            |

## Mimari Yapi

```
+-------------------+     +------------------+     +------------------------+
|   Claude Code     |---->|   ccproxykiro    |---->|   AWS CodeWhisperer    |
|   Cherry Studio   |     |   Proxy Server   |     |   API                  |
+-------------------+     +------------------+     +------------------------+
        |                        |                          |
        |  Anthropic API         |  Request Transform       |  Native API
        |  Format                |  Response Transform      |  Format
        v                        v                          v
   POST /v1/messages     localhost:8080          codewhisperer.us-east-1.amazonaws.com
```

## Kimlik Dogrulama (Authentication)

### Token Dosyasi Konumu

Proje, Kiro uygulamasinin olusturdugu token dosyasini kullanir:

| Platform | Token Dosyasi Yolu                              |
|----------|-------------------------------------------------|
| Windows  | `%USERPROFILE%\.aws\sso\cache\kiro-auth-token.json` |
| Linux    | `~/.aws/sso/cache/kiro-auth-token.json`         |
| macOS    | `~/.aws/sso/cache/kiro-auth-token.json`         |

### Token Dosyasi Formati

```json
{
    "accessToken": "eyJraWQiOiJhYmNkZWZnIiwiYWxnIjoiUlMyNTYifQ...",
    "refreshToken": "Atzr|IwEBIJxxx...",
    "expiresAt": "2024-01-01T00:00:00Z"
}
```

| Alan         | Tip    | Aciklama                                   |
|--------------|--------|--------------------------------------------|
| accessToken  | string | API istekleri icin kullanilan JWT token    |
| refreshToken | string | Access token yenilemek icin kullanilan token |
| expiresAt    | string | Token'in gecerlilik suresi (ISO 8601)      |

### Token Yenileme Mekanizmasi

Token yenileme islemi asagidaki endpoint uzerinden gerceklestirilir:

| Ozellik     | Deger                                                      |
|-------------|-----------------------------------------------------------|
| URL         | `https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken` |
| Method      | POST                                                       |
| Content-Type| application/json                                           |

**Istek Formati:**

```json
{
    "refreshToken": "Atzr|IwEBIJxxx..."
}
```

**Yanit Formati:**

```json
{
    "accessToken": "eyJraWQiOiJhYmNkZWZnIiwiYWxnIjoiUlMyNTYifQ...",
    "refreshToken": "Atzr|IwEBIJxxx...",
    "expiresAt": "2024-01-01T00:00:00Z"
}
```

### Otomatik Token Yenileme

Proxy sunucusu, 403 HTTP durum kodu aldiginda otomatik olarak token'i yeniler:

```go
if resp.StatusCode == 403 {
    refreshToken()
    sendErrorEvent(w, flusher, "error", fmt.Errorf("CodeWhisperer Token has been refreshed, please retry"))
}
```

## API Endpoint'leri

### Proxy Sunucusu Endpoint'leri

| Endpoint        | Method | Aciklama                           |
|-----------------|--------|-----------------------------------|
| `/v1/messages`  | POST   | Anthropic Messages API proxy      |
| `/v1/messages/` | POST   | Anthropic Messages API proxy (/)  |
| `/health`       | GET    | Saglik kontrolu                   |
| `/`             | *      | 404 Not Found (diger tum istekler)|

### AWS CodeWhisperer API

| Ozellik          | Deger                                                                    |
|------------------|-------------------------------------------------------------------------|
| Base URL         | `https://codewhisperer.us-east-1.amazonaws.com`                         |
| Endpoint         | `/generateAssistantResponse`                                             |
| Method           | POST                                                                     |
| Authentication   | Bearer Token                                                             |
| Response Format  | AWS Event Stream (binary)                                                |
| Profile ARN      | `arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK`     |

## Model Destegi

### Desteklenen Modeller

| Anthropic Model Adi           | CodeWhisperer Model ID              | Notlar           |
|------------------------------|-------------------------------------|------------------|
| `claude-sonnet-4-20250514`   | `CLAUDE_SONNET_4_20250514_V1_0`     | Onerilen model   |
| `claude-3-5-haiku-20241022`  | `CLAUDE_3_7_SONNET_20250219_V1_0`   | Haiku (mapping)  |

**Not:** Haiku modeli aslinda Sonnet 3.7 modeline yonlendirilmektedir. Bu bir mapping hatasi veya kasitli bir tercih olabilir.

## Istek/Yanit Formatlari

### Anthropic API Istek Formati (Giris)

```json
{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
        {
            "role": "user",
            "content": "Merhaba, nasilsin?"
        }
    ],
    "system": [
        {
            "type": "text",
            "text": "Sen yardimci bir asistansin."
        }
    ],
    "tools": [
        {
            "name": "calculator",
            "description": "Matematiksel islemler yapar",
            "input_schema": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string"}
                }
            }
        }
    ],
    "temperature": 0.7
}
```

### CodeWhisperer API Istek Formati (Donusturulmus)

```json
{
    "conversationState": {
        "chatTriggerType": "MANUAL",
        "conversationId": "550e8400-e29b-41d4-a716-446655440000",
        "currentMessage": {
            "userInputMessage": {
                "content": "Merhaba, nasilsin?",
                "modelId": "CLAUDE_SONNET_4_20250514_V1_0",
                "origin": "AI_EDITOR",
                "userInputMessageContext": {
                    "tools": [...],
                    "toolResults": [...]
                }
            }
        },
        "history": [
            {
                "userInputMessage": {
                    "content": "System mesaji",
                    "modelId": "CLAUDE_SONNET_4_20250514_V1_0",
                    "origin": "AI_EDITOR"
                }
            },
            {
                "assistantResponseMessage": {
                    "content": "I will follow these instructions",
                    "toolUses": []
                }
            }
        ]
    },
    "profileArn": "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"
}
```

### Conversation History Yapisi

| Mesaj Tipi | Yapi                                                              |
|------------|------------------------------------------------------------------|
| User       | `{"userInputMessage": {"content": "...", "modelId": "...", "origin": "AI_EDITOR"}}` |
| Assistant  | `{"assistantResponseMessage": {"content": "...", "toolUses": []}}` |

**System Mesaj Isleme:**

System mesajlari, konusma gecmisine user-assistant cifti olarak eklenir:
1. System mesaji -> UserInputMessage olarak
2. "I will follow these instructions" -> AssistantResponseMessage olarak

## AWS Event Stream Parsing

### Binary Frame Yapisi

AWS CodeWhisperer, yanitlarini AWS Event Stream formatinda gonderir:

```
+----------------+----------------+----------------+----------------+
| Total Length   | Header Length  | Headers        | Payload        |
| (4 bytes)      | (4 bytes)      | (variable)     | (variable)     |
+----------------+----------------+----------------+----------------+
| CRC32          |
| (4 bytes)      |
+----------------+
```

### Event Payload Formati

```json
{
    "content": "Yazi icerik parcasi",
    "name": "",
    "toolUseId": "",
    "input": null,
    "stop": false
}
```

| Alan      | Tip     | Aciklama                                |
|-----------|---------|----------------------------------------|
| content   | string  | Metin icerigi (text delta)             |
| name      | string  | Tool adi (tool_use icin)               |
| toolUseId | string  | Tool kullanim ID'si                    |
| input     | *string | Tool input JSON parcasi                |
| stop      | bool    | Blok sonlandirma gostergesi            |

### SSE Event Donusumu

Parser, AWS Event Stream'i Anthropic SSE formatina donusturur:

| AWS Event Tipi            | Anthropic SSE Event          |
|---------------------------|------------------------------|
| content (text)            | content_block_delta (text)   |
| toolUseId + name (start)  | content_block_start (tool)   |
| toolUseId + input         | content_block_delta (json)   |
| stop: true                | content_block_stop           |

## Streaming Yanit Formati

### SSE Event Sirasi

```
event: message_start
data: {"type":"message_start","message":{...}}

event: ping
data: {"type":"ping"}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Merhaba"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}

event: message_stop
data: {"type":"message_stop"}
```

### Non-Streaming Yanit Formati

```json
{
    "content": [
        {
            "type": "text",
            "text": "Merhaba! Size nasil yardimci olabilirim?"
        }
    ],
    "model": "claude-sonnet-4-20250514",
    "role": "assistant",
    "stop_reason": "end_turn",
    "stop_sequence": null,
    "type": "message",
    "usage": {
        "input_tokens": 10,
        "output_tokens": 15
    }
}
```

## Tool (Function) Destegi

### Anthropic Tool Formati

```json
{
    "name": "read_file",
    "description": "Dosya icerigini okur",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Dosya yolu"}
        },
        "required": ["path"]
    }
}
```

### CodeWhisperer Tool Formati

```json
{
    "toolSpecification": {
        "name": "read_file",
        "description": "Dosya icerigini okur",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Dosya yolu"}
                },
                "required": ["path"]
            }
        }
    }
}
```

### Tool Use Yaniti

```json
{
    "type": "tool_use",
    "id": "toolu_01abc123",
    "name": "read_file",
    "input": {"path": "/etc/hosts"}
}
```

## Hata Yonetimi

### HTTP Durum Kodlari

| Kod | Anlam                                          | Islem                              |
|-----|-----------------------------------------------|------------------------------------|
| 200 | Basarili                                      | Normal yanit                       |
| 400 | Gecersiz istek                                | Hata mesaji dondur                 |
| 403 | Yetkisiz (token suresi dolmus)                | Token yenile, yeniden dene         |
| 404 | Bulunamadi                                    | 404 Not Found                      |
| 405 | Method desteklenmiyor                         | "Only POST requests are supported" |
| 500 | Sunucu hatasi                                 | Hata mesaji                        |

### SSE Error Event

```json
{
    "type": "error",
    "error": {
        "type": "overloaded_error",
        "message": "Hata aciklamasi"
    }
}
```

### Dogrulama Hatalari

| Hata Durumu          | Hata Mesaji                                        |
|----------------------|---------------------------------------------------|
| Model eksik          | `{"message":"Missing required field: model"}`     |
| Mesajlar eksik       | `{"message":"Missing required field: messages"}`  |
| Desteklenmeyen model | `{"message":"Unknown or unsupported model: ..."}` |

## CLI Komutlari

| Komut                        | Aciklama                                        |
|------------------------------|-------------------------------------------------|
| `ccproxykiro read`           | Token bilgilerini goruntule                     |
| `ccproxykiro refresh`        | Token'i yenile                                  |
| `ccproxykiro export`         | Ortam degiskenlerini disa aktar                 |
| `ccproxykiro claude`         | Claude Code yapilandirmasini guncelle           |
| `ccproxykiro server [port]`  | Proxy sunucusunu baslat (varsayilan: 8080)      |

### Claude Yapilandirmasi

`ccproxykiro claude` komutu `~/.claude.json` dosyasini gunceller:

```json
{
    "hasCompletedOnboarding": true,
    "ccproxykiro": true
}
```

## Yapilandirma

### Ortam Degiskenleri

| Degisken             | Deger                    | Aciklama                      |
|----------------------|--------------------------|-------------------------------|
| ANTHROPIC_BASE_URL   | `http://localhost:8080`  | Proxy sunucu adresi           |
| ANTHROPIC_API_KEY    | `<access_token>`         | Kiro access token             |
| ANTHROPIC_AUTH_TOKEN | `dummy-token`            | Claude Code icin placeholder  |

### Claude Code Settings Dosyasi

Dosya Yolu: `~/.claude/settings.json`

```json
{
    "model": "claude-sonnet-4-20250514",
    "env": {
        "ANTHROPIC_AUTH_TOKEN": "dummy-token",
        "ANTHROPIC_BASE_URL": "http://localhost:8080"
    }
}
```

## Cross-Platform Destek

### Binary Dagitimi

| Platform | Binary Adi                           |
|----------|--------------------------------------|
| Linux    | `ccproxykiro-linux-amd64-{version}`  |
| Windows  | `ccproxykiro-windows-amd64-{version}.exe` |
| macOS    | `ccproxykiro-macos-amd64-{version}`  |

### Ortam Degiskeni Ciktisi

**Linux/macOS:**
```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY="<token>"
```

**Windows CMD:**
```cmd
set ANTHROPIC_BASE_URL=http://localhost:8080
set ANTHROPIC_API_KEY=<token>
```

**Windows PowerShell:**
```powershell
$env:ANTHROPIC_BASE_URL="http://localhost:8080"
$env:ANTHROPIC_API_KEY="<token>"
```

## Proje Karsilastirmasi

### ccproxykiro vs Kiro API (Bu Proje)

| Ozellik                    | ccproxykiro           | Kiro API (Bu Proje)        |
|----------------------------|-----------------------|----------------------------|
| Programlama Dili           | Go                    | Node.js (JavaScript)       |
| Veritabani                 | Yok (dosya tabanli)   | MySQL                      |
| Coklu Hesap Destegi        | Hayir                 | Evet (credential pool)     |
| Token Otomatik Yenileme    | Sadece 403'te         | 10 dakika once             |
| Web Arayuzu                | Yok                   | Evet                       |
| API Key Yonetimi           | Yok                   | Evet                       |
| Loglama                    | Konsol                | Dosya + Konsol             |
| Hata Credential Yonetimi   | Yok                   | Ayri tablo (retry)         |
| Cluster Destegi            | Yok                   | Evet                       |
| Coklu Provider             | Hayir (sadece Kiro)   | Evet (6 provider)          |
| Kimlik Dogrulama Yontemleri| Tek (Kiro token)      | Social, Builder ID, IdC    |
| Tool Destegi               | Evet                  | Evet                       |
| Streaming                  | Evet                  | Evet                       |

### Benzersiz Ozellikler

**ccproxykiro:**
- Tek binary, bagimliliklsiz calisir
- Hafif ve hizli (Go ile yazilmis)
- Claude Code icin direkt yapilandirma

**Kiro API (Bu Proje):**
- Gelismis hesap havuzu yonetimi
- Web tabanli yonetim konsolu
- Kullanim istatistikleri ve faturalama
- Coklu AI saglayici destegi
- Kurumsal ozellikler

## Sonuc

ccproxykiro, Kiro tokenlarini kullanarak Claude Code ve benzeri araclarin AWS CodeWhisperer uzerinden Claude modellerine erisimini saglayan hafif bir proxy cozumudur. Tek binary olarak dagitilabilmesi ve sifir yapilandirma gerektirmesi, bireysel kullanim icin ideal hale getirir.

Ancak, kurumsal ihtiyaclar icin (coklu kullanici, hesap havuzu, detayli loglama, web arayuzu) Kiro API projesi daha uygun bir secimdir.

## Kaynaklar

| Kaynak                | URL                                                        |
|-----------------------|------------------------------------------------------------|
| GitHub Repository     | https://github.com/stevengonsalvez/ccproxykiro             |
| AWS CodeWhisperer API | https://codewhisperer.us-east-1.amazonaws.com              |
| Kiro Auth Service     | https://prod.us-east-1.auth.desktop.kiro.dev               |
| Claude Code           | https://claude.ai/code                                     |
