# Kiro.rs Analiz Dokumani

Bu dokuman, [hank9999/kiro.rs](https://github.com/hank9999/kiro.rs) Rust projesinin kapsamli bir analizini icermektedir. Proje, Kiro (AWS CodeWhisperer) API'sini Anthropic Claude API uyumlu bir arayuze donusturmektedir.

## Genel Bakis

| Ozellik                   | Deger                                           |
|---------------------------|-------------------------------------------------|
| Programlama Dili          | Rust                                            |
| Proje Tipi                | API Proxy Sunucusu                              |
| Kaynak API                | Kiro (AWS CodeWhisperer)                        |
| Hedef API                 | Anthropic Claude Messages API                   |
| Varsayilan Port           | 8080                                            |
| Varsayilan Bolge          | us-east-1                                       |
| Desteklenen Modeller      | claude-sonnet-4.5, claude-opus-4.5, claude-haiku-4.5 |
| TLS Backend               | Rustls (varsayilan) veya Native TLS             |
| Yapilandirma Dosyasi      | config.json                                     |

## Dizin Yapisi

```
kiro.rs/
├── Cargo.toml                  # Rust paket yapilandirmasi
├── config.json                 # Ornek yapilandirma dosyasi
├── src/
│   ├── main.rs                 # Ana giris noktasi ve Axum web sunucusu
│   ├── anthropic/              # Anthropic API donusturucu modulu
│   │   ├── mod.rs              # Modul tanimlari
│   │   ├── types.rs            # Anthropic API tip tanimlari
│   │   ├── converter.rs        # Anthropic -> Kiro istek donusturucu
│   │   └── stream.rs           # SSE akis yoneticisi ve olay donusturucu
│   ├── kiro/                   # Kiro API istemci modulu
│   │   ├── mod.rs              # Modul tanimlari ve ihraclar
│   │   ├── provider.rs         # KiroProvider ana sinifi
│   │   ├── token_manager.rs    # Token yonetimi ve yenileme
│   │   ├── machine_id.rs       # Makine ID uretimi
│   │   ├── model/              # Veri modelleri
│   │   │   ├── mod.rs          # Model modulu tanimlari
│   │   │   ├── credentials.rs  # Kimlik bilgileri yapilari
│   │   │   ├── token_refresh.rs# Token yenileme yapilari
│   │   │   ├── usage_limits.rs # Kullanim limiti yapilari
│   │   │   ├── requests/       # Istek modelleri
│   │   │   │   ├── mod.rs
│   │   │   │   ├── kiro.rs     # KiroRequest ana yapisi
│   │   │   │   ├── conversation.rs # Konusma yapilari
│   │   │   │   └── tool.rs     # Arac tanimlari
│   │   │   └── events/         # Olay modelleri
│   │   │       ├── mod.rs
│   │   │       ├── base.rs     # Temel olay yapilari
│   │   │       ├── assistant.rs# Asistan yanit olaylari
│   │   │       ├── context_usage.rs # Baglam kullanim olaylari
│   │   │       └── tool_use.rs # Arac kullanim olaylari
│   │   └── parser/             # AWS Event Stream ayrıstirici
│   │       ├── mod.rs          # Parser modulu tanimlari
│   │       ├── decoder.rs      # Akis cozucu
│   │       ├── frame.rs        # Mesaj cerceve ayristirma
│   │       ├── header.rs       # Baslik ayristirma
│   │       ├── crc.rs          # CRC32 dogrulama
│   │       └── error.rs        # Hata tanimlari
│   └── model/                  # Genel yapilandirma modeli
│       └── config.rs           # Uygulama yapilandirmasi
└── README.md                   # Proje aciklamasi
```

## Kimlik Dogrulama (Authentication)

### Token Yonetimi

Kiro.rs, Builder ID kimlik dogrulama sistemini kullanmaktadir. Token yonetimi `token_manager.rs` dosyasinda uygulanmistir.

#### Kimlik Bilgileri Yapisi

```rust
pub struct BuilderIDCredentials {
    pub client_id: String,           // OAuth istemci ID
    pub client_secret: String,       // OAuth istemci sifresi
    pub access_token: String,        // Erisim tokeni
    pub refresh_token: String,       // Yenileme tokeni
    pub scope: String,               // Yetki kapsami
    pub expires_at: i64,             // Son kullanma zamani (epoch)
    pub region: String,              // AWS bolgesi
}
```

#### Token Yenileme Sureci

Token yenileme islemi otomatik olarak gerceklestirilmektedir:

1. Her istekten once token gecerliligi kontrol edilir
2. Token suresi dolmussa veya dolmak uzereyse yenileme baslатilir
3. Yenileme istegi AWS SSO-OIDC endpoint'ine gonderilir
4. Yeni token alinir ve hafizada guncellenir

```rust
// Token yenileme istegi yapisi
pub struct TokenRefreshRequest {
    pub grant_type: String,      // "refresh_token"
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
}

// Token yenileme yanit yapisi
pub struct TokenRefreshResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub refresh_token: Option<String>,
}
```

#### Token Yenileme Endpoint'leri

| Bolge          | SSO-OIDC URL                                    |
|----------------|-------------------------------------------------|
| us-east-1      | https://oidc.us-east-1.amazonaws.com/token      |
| eu-west-1      | https://oidc.eu-west-1.amazonaws.com/token      |
| ap-northeast-1 | https://oidc.ap-northeast-1.amazonaws.com/token |

### Makine ID Uretimi

Benzersiz makine kimlik tanimlayicisi `machine_id.rs` dosyasinda uretilmektedir:

```rust
pub fn generate_machine_id() -> String {
    // Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // 32 hexadecimal karakter + 4 tire
    uuid::Uuid::new_v4().to_string()
}
```

### API Anahtari Dogrulamasi

Sunucu, gelen isteklerde `X-API-Key` basligi veya `Authorization: Bearer <key>` dogrulamasi yapmaktadir:

```rust
// Yapilandirmadan API anahtari
pub api_key: Option<String>,

// Admin API anahtari (ozel islemler icin)
pub admin_api_key: Option<String>,
```

## API Endpoint'leri

### Ana Endpoint'ler

| Endpoint                     | Metot  | Aciklama                              |
|------------------------------|--------|---------------------------------------|
| `/v1/messages`               | POST   | Anthropic Messages API uyumlu chat    |
| `/cc/v1/messages`            | POST   | Claude Code uyumlu messages API       |
| `/v1/models`                 | GET    | Desteklenen modellerin listesi        |
| `/v1/count_tokens`           | POST   | Token sayimi (harici API destegi)     |
| `/admin/credentials`         | POST   | Kimlik bilgisi ekleme (Admin API)     |
| `/admin/credentials`         | GET    | Kimlik bilgilerini listeleme          |
| `/admin/credentials/{id}`    | DELETE | Kimlik bilgisi silme                  |

### Kiro API Endpoint'leri

| Endpoint                          | Metot  | Aciklama                              |
|-----------------------------------|--------|---------------------------------------|
| `codewhisperer.{region}.amazonaws.com` | POST   | AWS CodeWhisperer API                 |

### Model Eslestirme

Anthropic model adlari Kiro model adlarina eslestirilmektedir:

| Anthropic Model                | Kiro Model         |
|--------------------------------|--------------------|
| claude-*-sonnet-*              | claude-sonnet-4.5  |
| claude-*-opus-*                | claude-opus-4.5    |
| claude-*-haiku-*               | claude-haiku-4.5   |

## Istek/Yanit Formatlari

### Anthropic Messages Istek Formati

```json
{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 4096,
    "messages": [
        {
            "role": "user",
            "content": "Merhaba, nasilsin?"
        }
    ],
    "stream": true,
    "system": "Sen yardimci bir asistansin.",
    "tools": [],
    "thinking": {
        "type": "enabled",
        "budget_tokens": 20000
    },
    "metadata": {
        "user_id": "user_xxx_session_yyy"
    }
}
```

### Kiro API Istek Formati (ConversationState)

```json
{
    "conversationId": "uuid-v4",
    "agentContinuationId": "uuid-v4",
    "agentTaskType": "vibe",
    "chatTriggerType": "MANUAL",
    "currentMessage": {
        "userInputMessage": {
            "content": "Kullanici mesaji",
            "modelId": "claude-sonnet-4.5",
            "origin": "AI_EDITOR",
            "userInputMessageContext": {
                "tools": [],
                "toolResults": []
            },
            "images": []
        }
    },
    "history": []
}
```

### Kiro Tarih Mesaj Yapilari

#### Kullanici Mesaji

```json
{
    "userInputMessage": {
        "content": "Kullanici metni",
        "modelId": "claude-sonnet-4.5",
        "userInputMessageContext": {
            "tools": [],
            "toolResults": []
        },
        "images": []
    }
}
```

#### Asistan Mesaji

```json
{
    "assistantResponseMessage": {
        "content": "Asistan yaniti",
        "toolUses": [
            {
                "toolUseId": "tool-uuid",
                "name": "arac_adi",
                "input": {}
            }
        ]
    }
}
```

### Arac (Tool) Tanimlari

```json
{
    "toolSpecification": {
        "name": "read_file",
        "description": "Dosya icerigini okur",
        "inputSchema": {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Dosya yolu"
                }
            },
            "required": ["path"]
        }
    }
}
```

### SSE Olay Formatlari

#### message_start

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","stop_reason":null,"usage":{"input_tokens":100,"output_tokens":1}}}
```

#### content_block_start (Text)

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
```

#### content_block_start (Thinking)

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}
```

#### content_block_delta (Text)

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Merhaba"}}
```

#### content_block_delta (Thinking)

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Dusunce icerigi..."}}
```

#### content_block_start (Tool Use)

```
event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_xxx","name":"read_file","input":{}}}
```

#### content_block_delta (Tool Input)

```
event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/test.txt\"}"}}
```

#### content_block_stop

```
event: content_block_stop
data: {"type":"content_block_stop","index":0}
```

#### message_delta

```
event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":100,"output_tokens":50}}
```

#### message_stop

```
event: message_stop
data: {"type":"message_stop"}
```

## AWS Event Stream Protokolu

Kiro API, AWS Event Stream binary protokolunu kullanmaktadir. Parser modulu bu protokolu Rust'ta uygulamaktadir.

### Mesaj Cerceve Yapisi

```
+──────────────+──────────────+──────────────+──────────+──────────+───────────+
| Total Length | Header Length| Prelude CRC  | Headers  | Payload  | Msg CRC   |
|   (4 bytes)  |   (4 bytes)  |   (4 bytes)  | (degisken)| (degisken)| (4 bytes)|
+──────────────+──────────────+──────────────+──────────+──────────+───────────+
```

| Alan          | Boyut       | Aciklama                                    |
|---------------|-------------|---------------------------------------------|
| Total Length  | 4 byte      | Toplam mesaj uzunlugu (kendisi dahil)       |
| Header Length | 4 byte      | Baslik verisi uzunlugu                      |
| Prelude CRC   | 4 byte      | Ilk 8 byte icin CRC32 kontrol toplami       |
| Headers       | Degisken    | Mesaj basliklari                            |
| Payload       | Degisken    | JSON mesaj icerigi                          |
| Message CRC   | 4 byte      | Tum mesaj icin CRC32 kontrol toplami        |

### Baslik Deger Tipleri

| Tip Kodu | Tip Adi    | Boyut                    |
|----------|------------|--------------------------|
| 0        | BoolTrue   | 0 byte                   |
| 1        | BoolFalse  | 0 byte                   |
| 2        | Byte       | 1 byte                   |
| 3        | Short      | 2 byte                   |
| 4        | Integer    | 4 byte                   |
| 5        | Long       | 8 byte                   |
| 6        | ByteArray  | 2 byte uzunluk + veri    |
| 7        | String     | 2 byte uzunluk + veri    |
| 8        | Timestamp  | 8 byte                   |
| 9        | UUID       | 16 byte                  |

### Onemli Baslik Alanlari

| Baslik Adi       | Aciklama                          |
|------------------|-----------------------------------|
| :message-type    | Mesaj tipi (event, error, exception) |
| :event-type      | Olay tipi (assistantResponseEvent, toolUseEvent, vb.) |
| :exception-type  | Istisna tipi                      |
| :error-code      | Hata kodu                         |

### CRC32 Hesaplama

ISO-HDLC (Ethernet/ZIP) standardi kullanilmaktadir:

```rust
use crc::{CRC_32_ISO_HDLC, Crc};

const CRC32: Crc<u32> = Crc::<u32>::new(&CRC_32_ISO_HDLC);

pub fn crc32(data: &[u8]) -> u32 {
    CRC32.checksum(data)
}
```

### Olay Tipleri

| Olay Tipi              | Aciklama                                    |
|------------------------|---------------------------------------------|
| assistantResponseEvent | Asistan metin yaniti                        |
| toolUseEvent           | Arac kullanim istegi                        |
| contextUsageEvent      | Baglam penceresi kullanim yuzdesi           |
| error                  | Hata mesaji                                 |
| exception              | Istisna mesaji                              |

### Olay Yapilari

#### AssistantResponseEvent

```rust
pub struct AssistantResponseEvent {
    pub content: String,              // Yanit metni
    pub assistant_response_type: String, // "PARTIAL" veya "FINAL"
}
```

#### ToolUseEvent

```rust
pub struct ToolUseEvent {
    pub name: String,        // Arac adi
    pub tool_use_id: String, // Benzersiz arac cagri ID
    pub input: String,       // JSON girdi (parcali olarak gelebilir)
    pub stop: bool,          // Arac cagrisi tamamlandi mi
}
```

#### ContextUsageEvent

```rust
pub struct ContextUsageEvent {
    pub context_usage_percentage: f64, // Baglam penceresi kullanim yuzdesi (0-100)
}
```

## Hata Yonetimi

### Parser Hatalari

```rust
pub enum ParseError {
    Incomplete { needed: usize, available: usize },  // Eksik veri
    PreludeCrcMismatch { expected: u32, actual: u32 }, // Prelude CRC hatasi
    MessageCrcMismatch { expected: u32, actual: u32 }, // Mesaj CRC hatasi
    InvalidHeaderType(u8),           // Gecersiz baslik tipi
    HeaderParseFailed(String),       // Baslik ayristirma hatasi
    MessageTooLarge { length: u32, max: u32 }, // Mesaj cok buyuk
    MessageTooSmall { length: u32, min: u32 }, // Mesaj cok kucuk
    InvalidMessageType(String),      // Gecersiz mesaj tipi
    PayloadDeserialize(serde_json::Error), // JSON ayristirma hatasi
    Io(std::io::Error),              // IO hatasi
    TooManyErrors { count: usize, last_error: String }, // Cok fazla hata
    BufferOverflow { size: usize, max: usize }, // Tampon tasma
}
```

### Donusturme Hatalari

```rust
pub enum ConversionError {
    UnsupportedModel(String),  // Desteklenmeyen model
    EmptyMessages,             // Bos mesaj listesi
}
```

### API Hata Yaniti

```json
{
    "error": {
        "type": "authentication_error",
        "message": "Invalid API key"
    }
}
```

### Onemli Hata Tipleri

| Hata Tipi                       | Aciklama                           |
|---------------------------------|------------------------------------|
| authentication_error            | Gecersiz API anahtari              |
| invalid_request_error           | Gecersiz istek formati             |
| ContentLengthExceededException  | Icerik uzunlugu limiti asildi      |
| ValidationException             | Dogrulama hatasi                   |

## Yapilandirma

### Yapilandirma Dosyasi (config.json)

```json
{
    "host": "127.0.0.1",
    "port": 8080,
    "region": "us-east-1",
    "kiroVersion": "0.8.0",
    "machineId": null,
    "apiKey": null,
    "systemVersion": "darwin#24.6.0",
    "nodeVersion": "22.21.1",
    "tlsBackend": "rustls",
    "countTokensApiUrl": null,
    "countTokensApiKey": null,
    "countTokensAuthType": "x-api-key",
    "proxyUrl": null,
    "proxyUsername": null,
    "proxyPassword": null,
    "adminApiKey": null
}
```

### Yapilandirma Parametreleri

| Parametre             | Varsayilan       | Aciklama                                  |
|-----------------------|------------------|-------------------------------------------|
| host                  | 127.0.0.1        | Sunucu dinleme adresi                     |
| port                  | 8080             | Sunucu dinleme portu                      |
| region                | us-east-1        | AWS bolgesi                               |
| kiroVersion           | 0.8.0            | Kiro istemci surumu                       |
| machineId             | null (otomatik)  | Makine tanimlayicisi                      |
| apiKey                | null             | API anahtari dogrulamasi                  |
| systemVersion         | darwin#24.6.0    | Isletim sistemi surumu                    |
| nodeVersion           | 22.21.1          | Node.js surumu                            |
| tlsBackend            | rustls           | TLS backend (rustls/native-tls)           |
| countTokensApiUrl     | null             | Harici token sayim API URL                |
| countTokensApiKey     | null             | Token sayim API anahtari                  |
| countTokensAuthType   | x-api-key        | Token sayim kimlik dogrulama tipi         |
| proxyUrl              | null             | HTTP/HTTPS/SOCKS5 proxy URL               |
| proxyUsername         | null             | Proxy kullanici adi                       |
| proxyPassword         | null             | Proxy sifresi                             |
| adminApiKey           | null             | Admin API anahtari                        |

### Proxy Destegi

Desteklenen proxy formatlari:

- `http://host:port`
- `https://host:port`
- `socks5://host:port`

## Thinking (Dusunme) Modu

### Thinking Etkinlestirme

```json
{
    "thinking": {
        "type": "enabled",
        "budget_tokens": 20000
    }
}
```

### Thinking Isleyisi

1. Thinking modu etkinlestirildiginde, sistem mesajina thinking etiketleri eklenir:
   ```
   <thinking_mode>enabled</thinking_mode>
   <max_thinking_length>20000</max_thinking_length>
   ```

2. Yanit akisinda `<thinking>` ve `</thinking>` etiketleri arasindaki icerik ayristirilir

3. Thinking icerigi ayri bir `thinking` blogu olarak SSE uzerinden iletilir

4. Anahtar fonksiyonlar:
   - `find_real_thinking_start_tag`: Gercek `<thinking>` etiketini bulur (tirnak icindeki etiketleri atlar)
   - `find_real_thinking_end_tag`: Gercek `</thinking>` etiketini bulur (tirnak icindeki etiketleri atlar)

### Thinking Blok Siralamasi

| Siralama | Blok Tipi    | Indeks |
|----------|--------------|--------|
| 1        | thinking     | 0      |
| 2        | text         | 1      |
| 3+       | tool_use     | 2+     |

## Arac Kullanimi (Tool Use)

### Arac Sonucu Eslestirme

Sistem, `tool_use_id` ile `tool_result` eslestirilmesini dogrular:

1. Tarihten tum `tool_use_id`'leri toplar
2. Tarihten zaten eslestirilmis `tool_result`'leri toplar
3. Yetim `tool_result`'leri filtreler (eslesmeyenler)
4. Yetim `tool_use`'leri loglar (sonuc alinmayanlar)

### Yer Tutucu Arac Olusturma

Tarihte kullanilan ancak `tools` listesinde olmayan araclar icin otomatik yer tutucu olusturulur:

```rust
fn create_placeholder_tool(name: &str) -> Tool {
    Tool {
        tool_specification: ToolSpecification {
            name: name.to_string(),
            description: "Tool used in conversation history".to_string(),
            input_schema: InputSchema::from_json(serde_json::json!({
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": true
            })),
        },
    }
}
```

## Token Tahmini

Basit token tahmini icin kullanilan algoritma:

```rust
fn estimate_tokens(text: &str) -> i32 {
    let mut chinese_count = 0;
    let mut other_count = 0;

    for c in text.chars() {
        if c >= '\u{4E00}' && c <= '\u{9FFF}' {
            chinese_count += 1;
        } else {
            other_count += 1;
        }
    }

    // Cince: yaklasik 1.5 karakter/token
    // Diger: yaklasik 4 karakter/token
    let chinese_tokens = (chinese_count * 2 + 2) / 3;
    let other_tokens = (other_count + 3) / 4;

    (chinese_tokens + other_tokens).max(1)
}
```

## Bagimliliklari (Cargo.toml)

| Paket             | Surum     | Aciklama                          |
|-------------------|-----------|-----------------------------------|
| axum              | 0.8       | Web framework                     |
| tokio             | 1         | Async runtime                     |
| reqwest           | 0.12      | HTTP istemci                      |
| serde             | 1         | Serializasyon                     |
| serde_json        | 1         | JSON isleme                       |
| uuid              | 1         | UUID uretimi                      |
| crc               | 3         | CRC32 hesaplama                   |
| tracing           | 0.1       | Loglama                           |
| anyhow            | 1         | Hata yonetimi                     |
| fastrand          | 2         | Hizli rastgele sayi uretimi       |
| chrono            | 0.4       | Tarih/zaman islemleri             |

## Onemli Notlar

1. **Baglam Penceresi**: Kiro 200K token baglam penceresini destekler

2. **Akis Tamponlama**: `/cc/v1/messages` endpoint'i icin `BufferedStreamContext` kullanilir, bu sayede `contextUsageEvent`'ten alinan dogru `input_tokens` degeri `message_start` olayinda geri guncellenir

3. **Mesaj Alternasyonu**: Kiro API, kullanici/asistan mesajlarinin sirali olmasi gerektiginden, ardisik kullanici mesajlari otomatik olarak birlestirilir

4. **Tool Use Stop Reason**: Arac kullanimi oldugunda `stop_reason` otomatik olarak `"tool_use"` olarak ayarlanir

5. **UTF-8 Sinir Guvenici**: Cok byte karakterlerin ortasindan kesilmemesi icin `find_char_boundary` fonksiyonu kullanilir

6. **Maksimum Thinking Bütcesi**: Thinking token butcesi maksimum 24576 ile sinirlandirilmistir

## Sonuc

Kiro.rs, AWS CodeWhisperer (Kiro) API'sini Anthropic Claude API formatina donusturmek icin tasarlanmis kapsamli bir Rust uygulamasidir. Proje, AWS Event Stream binary protokolunu tamamen uygulamakta ve SSE akis donusumunu yonetmektedir. Thinking modu destegi, arac kullanimi ve cok turlu konusma yonetimi gibi gelismis ozellikler sunmaktadir.
