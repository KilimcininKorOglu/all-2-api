# Kiro Console Feature Analysis

Bu dokuman, [Kiro-Console](https://github.com/lilizero123/Kiro-Console) projesindeki tum Kiro ozelliklerini analiz eder.

## Genel Bakis

Kiro Console, Rust (Axum) backend ve React (Vite) admin UI iceren bir Anthropic API uyumlu Kiro proxy servisidir. Coklu credential yonetimi, failover, token refresh ve gorunur admin paneli sunar.

| Ozellik                | Aciklama                                                  |
|------------------------|-----------------------------------------------------------|
| Platform               | Rust 2024 Edition + React (Vite)                          |
| Backend Framework      | Axum 0.8                                                  |
| HTTP Client            | reqwest (rustls-tls, socks proxy destegi)                 |
| Authentication         | Social OAuth, IdC (AWS SSO OIDC), Builder ID              |
| API Compatibility      | Anthropic `/v1/messages`, `/v1/models`, `/v1/count_tokens`|
| Admin UI               | React + Tailwind CSS + Shadcn UI                          |
| Deployment             | Docker one-click script                                   |

---

## 1. Arsitektur

```
React Admin Console (Vite)
  +-- Login/Initialization
  +-- Batch Import Credentials
  +-- Usage Progress Bar & Status
          | Admin API (HTTPS)
Rust Backend (Axum)
  +-- Anthropic Compatible Router
  +-- MultiTokenManager
  +-- SettingsManager
  +-- Balance Query/Writeback/Disable
          | HTTP/HTTPS
Upstream Kiro / Anthropic Service
```

---

## 2. Credential Modeli

### 2.1 Desteklenen Authentication Metodlari

| Method      | Gerekli Alanlar                                    | Token Refresh Endpoint                           |
|-------------|----------------------------------------------------|--------------------------------------------------|
| `social`    | `refreshToken`                                     | `prod.{region}.auth.desktop.kiro.dev/refreshToken` |
| `idc`       | `refreshToken`, `clientId`, `clientSecret`         | `oidc.{region}.amazonaws.com/token`              |
| `builder-id`| `refreshToken`, `clientId`, `clientSecret`         | `oidc.{region}.amazonaws.com/token`              |

### 2.2 Credential Dosya Formatlari

**Tek Credential (Eski Format):**
```json
{
  "refreshToken": "xxxxxxxxxxxx",
  "expiresAt": "2025-12-31T02:32:45.144Z",
  "authMethod": "social"
}
```

**Coklu Credential (Yeni Format):**
```json
[
  {
    "id": 1,
    "refreshToken": "xxxxxxxxxxxx",
    "expiresAt": "2025-12-31T02:32:45.144Z",
    "authMethod": "social",
    "machineId": "aaaa...64chars...aaaa",
    "priority": 0
  },
  {
    "id": 2,
    "refreshToken": "yyyyyyyyyyyy",
    "authMethod": "idc",
    "clientId": "xxxxxxxxx",
    "clientSecret": "xxxxxxxxx",
    "region": "us-east-2",
    "priority": 1
  }
]
```

### 2.3 Credential Alanlari

| Alan           | Tip            | Aciklama                                            |
|----------------|----------------|-----------------------------------------------------|
| `id`           | `u64`          | Otomatik atanan unique ID                           |
| `accessToken`  | `String`       | Gecici erisim tokeni                                |
| `refreshToken` | `String`       | Uzun omurlu yenileme tokeni                         |
| `profileArn`   | `String`       | AWS profil ARN                                      |
| `expiresAt`    | `String`       | RFC3339 formatinda token son kullanim tarihi        |
| `authMethod`   | `String`       | `social`, `idc`, `builder-id`                       |
| `clientId`     | `String`       | IdC/Builder ID icin OIDC client ID                  |
| `clientSecret` | `String`       | IdC/Builder ID icin OIDC client secret              |
| `priority`     | `u32`          | Oncelik (dusuk = yuksek oncelik, varsayilan: 0)     |
| `region`       | `String`       | Credential ozel region (varsayilan: config.region)  |
| `machineId`    | `String`       | Credential ozel machine ID (64 hex karakter)        |

---

## 3. Token Yonetimi

### 3.1 MultiTokenManager

Coklu credential yonetimi icin tasarlanmis ana sinif:

```rust
pub struct MultiTokenManager {
    config: Config,
    proxy: Option<ProxyConfig>,
    entries: Mutex<Vec<CredentialEntry>>,
    current_id: Mutex<u64>,
    refresh_lock: TokioMutex<()>,
    credentials_path: Option<PathBuf>,
    is_multiple_format: bool,
}
```

**Ozellikler:**
- Priority-based credential secimi (dusuk priority = yuksek oncelik)
- Otomatik failover (basarisiz credential'dan sonrakine gecis)
- Double-checked locking ile token refresh
- Credential dosyasina otomatik geri yazma
- Self-healing: Tum credential'lar disable olursa otomatik recovery

### 3.2 Token Expiration Kontrolu

```rust
// Token 5 dakika icinde expired mi?
pub fn is_token_expired(credentials: &KiroCredentials) -> bool {
    is_token_expiring_within(credentials, 5).unwrap_or(true)
}

// Token 10 dakika icinde expire olacak mi?
pub fn is_token_expiring_soon(credentials: &KiroCredentials) -> bool {
    is_token_expiring_within(credentials, 10).unwrap_or(false)
}
```

### 3.3 Token Refresh Metodlari

**Social Token Refresh:**
```rust
let refresh_url = format!("https://prod.{}.auth.desktop.kiro.dev/refreshToken", region);

let response = client
    .post(&refresh_url)
    .header("User-Agent", format!("KiroIDE-{}-{}", kiro_version, machine_id))
    .header("host", &refresh_domain)
    .json(&RefreshRequest { refresh_token })
    .send()
    .await?;
```

**IdC Token Refresh:**
```rust
let refresh_url = format!("https://oidc.{}.amazonaws.com/token", region);

let body = IdcRefreshRequest {
    client_id: client_id.to_string(),
    client_secret: client_secret.to_string(),
    refresh_token: refresh_token.to_string(),
    grant_type: "refresh_token".to_string(),
};

let response = client
    .post(&refresh_url)
    .header("x-amz-user-agent", IDC_AMZ_USER_AGENT)
    .json(&body)
    .send()
    .await?;
```

---

## 4. Machine ID Olusturma

### 4.1 Oncelik Sirasi

1. Credential-level `machineId` (varsa)
2. Config-level `machineId` (varsa)
3. `refreshToken`'dan SHA256 ile turetme

### 4.2 Format Normalizasyonu

```rust
fn normalize_machine_id(machine_id: &str) -> Option<String> {
    let trimmed = machine_id.trim();

    // 64 karakter hex ise direkt kullan
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(trimmed.to_string());
    }

    // UUID formatini 64 karaktere cevir
    let without_dashes: String = trimmed.chars().filter(|c| *c != '-').collect();
    if without_dashes.len() == 32 && without_dashes.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(format!("{}{}", without_dashes, without_dashes));
    }

    None
}
```

### 4.3 refreshToken'dan Turetme

```rust
fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

// Kullanim
sha256_hex(&format!("KotlinNativeAPI/{}", refresh_token))
```

---

## 5. Kiro API Provider

### 5.1 Endpoint'ler

```rust
// Ana API endpoint
pub fn base_url(&self) -> String {
    format!(
        "https://q.{}.amazonaws.com/generateAssistantResponse",
        self.token_manager.config().region
    )
}

// MCP (WebSearch) endpoint
pub fn mcp_url(&self) -> String {
    format!(
        "https://q.{}.amazonaws.com/mcp",
        self.token_manager.config().region
    )
}
```

### 5.2 Request Headers

```rust
let x_amz_user_agent = format!("aws-sdk-js/1.0.27 KiroIDE-{}-{}", kiro_version, machine_id);

let user_agent = format!(
    "aws-sdk-js/1.0.27 ua/2.1 os/{} lang/js md/nodejs#{} api/codewhispererstreaming#1.0.27 m/E KiroIDE-{}-{}",
    os_name, node_version, kiro_version, machine_id
);

headers.insert("x-amzn-codewhisperer-optout", "true");
headers.insert("x-amzn-kiro-agent-mode", "vibe");
headers.insert(AUTHORIZATION, format!("Bearer {}", token));
```

### 5.3 Retry Stratejisi

| Parametre                    | Deger      |
|------------------------------|------------|
| Her credential icin max retry| 3          |
| Toplam max retry             | 9          |
| Base delay                   | 200ms      |
| Max delay                    | 2000ms     |
| Backoff                      | Exponential|

**Hata Isleme:**

| HTTP Status | Davranis                                         |
|-------------|--------------------------------------------------|
| 200         | Basarili, failure count sifirla                  |
| 400         | Direkt hata don (retry anlamsiz)                 |
| 401/403     | Credential hatasi, failover                      |
| 402 + MONTHLY_REQUEST_COUNT | Credential disable, failover   |
| 408/429/5xx | Gecici hata, retry (credential degistirmeden)    |

---

## 6. AWS Event Stream Parser

### 6.1 Decoder State Machine

```
       Ready
         |
         v (feed data)
      Parsing
         |
    +----+----+
    |         |
 [success] [failure]
    |         |
    v         +-> error_count++
  Ready       |
              +-> error_count < max?
              |    YES -> Recovering -> Ready
              |    NO  v
                   Stopped
```

### 6.2 Frame Yapisi

```
+----------------+----------------+
|  Prelude (12)  |    Headers     |
+----------------+----------------+
|     Payload    |   Message CRC  |
+----------------+----------------+
```

**Prelude (12 bytes):**
- Total Length (4 bytes, big-endian)
- Headers Length (4 bytes, big-endian)
- Prelude CRC (4 bytes, CRC32C)

### 6.3 Desteklenen Event Turleri

| Event Type               | Aciklama                                  |
|--------------------------|-------------------------------------------|
| `assistantResponseEvent` | Asistan metin yaniti                      |
| `toolUseEvent`           | Arac kullanimi                            |
| `contextUsageEvent`      | Context kullanim yuzdesi                  |
| `exception`              | Hata durumu (ContentLengthExceededException)|

---

## 7. Anthropic API Uyumlulugu

### 7.1 Desteklenen Endpoint'ler

| Endpoint                       | Method | Aciklama                    |
|--------------------------------|--------|-----------------------------|
| `/v1/models`                   | GET    | Model listesi               |
| `/v1/messages`                 | POST   | Chat completion (stream/non-stream)|
| `/v1/messages/count_tokens`    | POST   | Token sayimi                |

### 7.2 Model Mapping

```rust
pub fn map_model(model: &str) -> Option<String> {
    let model_lower = model.to_lowercase();

    if model_lower.contains("sonnet") {
        Some("claude-sonnet-4.5".to_string())
    } else if model_lower.contains("opus") {
        Some("claude-opus-4.5".to_string())
    } else if model_lower.contains("haiku") {
        Some("claude-haiku-4.5".to_string())
    } else {
        None
    }
}
```

### 7.3 Thinking Mode Destegi

```rust
// Thinking tags injection
fn generate_thinking_prefix(thinking: &Option<Thinking>) -> Option<String> {
    if let Some(t) = thinking {
        if t.thinking_type == "enabled" {
            return Some(format!(
                "<thinking_mode>enabled</thinking_mode><max_thinking_length>{}</max_thinking_length>",
                t.budget_tokens
            ));
        }
    }
    None
}
```

**Thinking Block Isleme:**
- `<thinking>` ve `</thinking>` tag'leri tespit edilir
- Quoted tag'ler (backtick, quotes icindeki) atlanir
- Gercek tag'ler `thinking_delta` event'leri olarak donusturulur

### 7.4 Tool Use Destegi

**Tool Definition Donusumu:**
```rust
Tool {
    tool_specification: ToolSpecification {
        name: t.name.clone(),
        description: description.chars().take(10000).collect(),
        input_schema: InputSchema::from_json(t.input_schema),
    },
}
```

**Desteklenmeyen Tool'lar:**
- `web_search` / `websearch` (ayri MCP endpoint'i kullanir)

---

## 8. SSE Stream Yonetimi

### 8.1 Event Sirasi

1. `message_start` (bir kez)
2. `content_block_start` (her block icin)
3. `content_block_delta` (icerik)
4. `content_block_stop` (block bitisi)
5. `message_delta` (final usage bilgisi)
6. `message_stop` (son)

### 8.2 Ping Keepalive

```rust
const PING_INTERVAL_SECS: u64 = 25;

// Her 25 saniyede bir ping gonderilir
fn create_ping_sse() -> Bytes {
    Bytes::from("event: ping\ndata: {\"type\": \"ping\"}\n\n")
}
```

### 8.3 Context Usage Hesaplama

```rust
// 200k context window
const CONTEXT_WINDOW_SIZE: i32 = 200_000;

// contextUsageEvent yuzdesi -> token sayisi
let actual_input_tokens = (context_usage.context_usage_percentage
    * (CONTEXT_WINDOW_SIZE as f64)
    / 100.0) as i32;
```

---

## 9. Admin API

### 9.1 Endpoint'ler

| Endpoint                            | Method | Aciklama                        |
|-------------------------------------|--------|---------------------------------|
| `/api/admin/credentials`            | GET    | Tum credential'lari listele    |
| `/api/admin/credentials`            | POST   | Yeni credential ekle            |
| `/api/admin/credentials/batch`      | POST   | Toplu credential ekle           |
| `/api/admin/credentials/:id/disabled`| POST  | Disable/Enable                  |
| `/api/admin/credentials/:id/priority`| POST  | Oncelik degistir                |
| `/api/admin/credentials/:id/reset`  | POST   | Failure count sifirla           |
| `/api/admin/credentials/:id/balance`| GET    | Kota sorgula                    |
| `/api/admin/credentials/:id`        | DELETE | Credential sil (disable gerekli)|
| `/api/admin/setup/status`           | GET    | Kurulum durumu                  |
| `/api/admin/setup/init`             | POST   | Admin key ayarla                |
| `/api/admin/settings`               | GET    | Ayarlari getir                  |
| `/api/admin/settings/api-key`       | POST   | API key guncelle                |
| `/api/admin/settings/admin-key`     | POST   | Admin key guncelle              |

### 9.2 Credential Snapshot

```rust
pub struct CredentialEntrySnapshot {
    pub id: u64,
    pub priority: u32,
    pub disabled: bool,
    pub failure_count: u32,
    pub auth_method: Option<String>,
    pub has_profile_arn: bool,
    pub expires_at: Option<String>,
}
```

### 9.3 Usage Limits API

```rust
let url = format!(
    "https://q.{}.amazonaws.com/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST",
    region
);

// Opsiyonel profileArn
if let Some(profile_arn) = &credentials.profile_arn {
    url.push_str(&format!("&profileArn={}", urlencoding::encode(profile_arn)));
}
```

---

## 10. Configuration

### 10.1 config.json

```json
{
  "host": "127.0.0.1",
  "port": 8990,
  "apiKey": "sk-kiro-console-xxx",
  "region": "us-east-1",
  "adminApiKey": "sk-admin-xxx",
  "kiroVersion": "0.8.0",
  "machineId": "optional-64-char-hex",
  "proxyUrl": "socks5://127.0.0.1:1080",
  "proxyUsername": "user",
  "proxyPassword": "pass",
  "countTokensApiUrl": "https://external/count_tokens",
  "countTokensApiKey": "key",
  "countTokensAuthType": "x-api-key"
}
```

### 10.2 settings.json

```json
{
  "adminApiKey": "sk-admin-xxx",
  "apiKey": "sk-kiro-console-xxx"
}
```

Dinamik ayarlar icin kullanilir. Admin UI uzerinden guncellenebilir.

---

## 11. Docker Deployment

### 11.1 One-Click Script

```bash
curl -fsSL https://raw.githubusercontent.com/lilizero123/Kiro-Console/master/tools/docker/oneclick.sh | sudo bash
```

### 11.2 Environment Variables

| Degisken                  | Varsayilan           | Aciklama                  |
|---------------------------|----------------------|---------------------------|
| `KIRO_CONSOLE_PORT`       | `8990`               | Host port                 |
| `KIRO_CONSOLE_IMAGE`      | `kiro-console:latest`| Docker image              |
| `KIRO_CONSOLE_CONTAINER`  | `kiro-console`       | Container adi             |
| `KIRO_CONSOLE_CONFIG_DIR` | `/var/lib/kiro-console`| Config mount path       |
| `KIRO_CONSOLE_REPO`       | GitHub URL           | Git repository            |
| `KIRO_CONSOLE_BRANCH`     | `master`             | Git branch                |
| `KIRO_CONSOLE_FORCE_BUILD`| `0`                  | `1` = skip pull, force build|

---

## 12. WebSearch (MCP) Destegi

### 12.1 MCP Endpoint

```rust
pub fn mcp_url(&self) -> String {
    format!(
        "https://q.{}.amazonaws.com/mcp",
        self.token_manager.config().region
    )
}
```

### 12.2 WebSearch Tool Tespiti

```rust
fn is_unsupported_tool(name: &str) -> bool {
    matches!(name.to_lowercase().as_str(), "web_search" | "websearch")
}
```

WebSearch tool'u tespit edildiginde, istek ayri MCP endpoint'ine yonlendirilir.

---

## 13. Guvenlik Ozellikleri

### 13.1 RefreshToken Validation

```rust
pub fn validate_refresh_token(credentials: &KiroCredentials) -> anyhow::Result<()> {
    let refresh_token = credentials.refresh_token.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Missing refreshToken"))?;

    if refresh_token.is_empty() {
        bail!("refreshToken is empty");
    }

    // Truncated token detection
    if refresh_token.len() < 100 || refresh_token.ends_with("...") {
        bail!("refreshToken has been truncated");
    }

    Ok(())
}
```

### 13.2 API Key Maskeleme

```rust
fn mask_api_key(value: &str) -> String {
    if value.len() <= 8 {
        "*".repeat(value.len())
    } else {
        format!("{}***{}", &value[..4], &value[value.len() - 4..])
    }
}
```

### 13.3 Constant-Time Comparison

```rust
// subtle crate ile timing attack korunmasi
use subtle::ConstantTimeEq;
```

---

## 14. Hata Kurtarma

### 14.1 Credential Self-Healing

```rust
// Tum credential'lar TooManyFailures ile disable olursa
if best.is_none() && entries.iter().any(|e|
    e.disabled && e.disabled_reason == Some(DisabledReason::TooManyFailures)
) {
    // Auto-recovery: failure count sifirla ve yeniden enable et
    for e in entries.iter_mut() {
        if e.disabled_reason == Some(DisabledReason::TooManyFailures) {
            e.disabled = false;
            e.disabled_reason = None;
            e.failure_count = 0;
        }
    }
}
```

### 14.2 Event Stream Recovery

```rust
// Prelude hatasi: 1 byte atla
ParseError::PreludeCrcMismatch { .. } => {
    self.buffer.advance(1);
}

// Data hatasi: tum frame'i atla
ParseError::MessageCrcMismatch { .. } => {
    if total_length >= 16 && total_length <= self.buffer.len() {
        self.buffer.advance(total_length);
    }
}
```

---

## 15. Diger Projelerle Karsilastirma

| Ozellik                    | Kiro Console         | Kiro Account Manager   | AIClient-2-API      |
|----------------------------|----------------------|------------------------|---------------------|
| Platform                   | Rust + React         | Electron               | Node.js             |
| Multi-Credential           | Evet (priority-based)| Evet (round-robin)     | Hayir               |
| Admin UI                   | Evet (React)         | Evet (Electron)        | Hayir               |
| Token Refresh              | Auto + Writeback     | Auto                   | Auto                |
| Event Stream Parser        | Custom CRC32C        | JS Parser              | JS Parser           |
| Docker Support             | One-click script     | Hayir                  | Hayir               |
| Thinking Mode              | Evet                 | ?                      | Evet                |
| Tool Use                   | Evet                 | Evet                   | Evet                |
| WebSearch/MCP              | Evet                 | ?                      | ?                   |
| Proxy Support              | HTTP/SOCKS5          | ?                      | HTTP                |

---

## 16. Sonuc

Kiro Console, Rust ile yazilmis yuksek performansli bir Anthropic-uyumlu Kiro proxy'sidir:

1. **Coklu Credential Yonetimi**: Priority-based secim, otomatik failover, self-healing
2. **React Admin UI**: Gorunur yonetim paneli, batch import, kota gosterimi
3. **Tam Anthropic Uyumlulugu**: Streaming, thinking mode, tool use destegi
4. **AWS Event Stream Parser**: CRC32C dogrulama, state machine, error recovery
5. **Docker One-Click Deployment**: Hizli kurulum ve dagitim
6. **Guvenlik**: Token validation, constant-time comparison, API key maskeleme

**Kullanim Senaryolari:**
- Kurumsal Kiro API gateway
- Coklu hesap havuzu yonetimi
- Anthropic API uyumlu istemciler icin proxy
- Self-hosted Claude API alternatifi
