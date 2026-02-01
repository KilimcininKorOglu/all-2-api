# Windsurf Account Manager Feature Analysis

Bu dokuman, [windsurf-account-manager-simple](https://github.com/chaogei/windsurf-account-manager-simple) projesindeki Windsurf hesap yonetimi ozelliklerini analiz eder.

## Genel Bakis

Windsurf Account Manager, Tauri + Vue 3 + TypeScript tabanli bir masaustu uygulamasidir. Windsurf IDE icin coklu hesap yonetimi, otomatik token yenileme, koltuk (seat) yonetimi ve aktif hesap degisimi sunar.

| Ozellik                | Aciklama                                              |
|------------------------|-------------------------------------------------------|
| Platform               | Tauri 2.x (Rust) + Vue 3 + TypeScript                 |
| Authentication         | Firebase Auth (Email/Password)                        |
| Backend API            | Protobuf over HTTP (gRPC-web style)                   |
| Data Encryption        | AES-256-GCM + System Keychain                         |
| Supported OS           | Windows, macOS, Linux                                 |

---

## 1. Authentication Sistemi

### 1.1 Firebase Authentication

**API Key:** `AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY`

**Login Endpoint:**
```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}
```

**Request:**
```json
{
  "returnSecureToken": true,
  "email": "user@example.com",
  "password": "password123",
  "clientType": "CLIENT_TYPE_WEB"
}
```

**Response:**
```json
{
  "idToken": "eyJhbGciOiJS...",
  "refreshToken": "AGEhc0C...",
  "expiresIn": "3600",
  "localId": "firebase_uid",
  "email": "user@example.com",
  "displayName": "John Doe"
}
```

### 1.2 Token Refresh

**Endpoint:**
```
POST https://securetoken.googleapis.com/v1/token?key={API_KEY}
```

**Request:**
```
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={REFRESH_TOKEN}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJS...",
  "expires_in": "3600",
  "token_type": "Bearer",
  "refresh_token": "AGEhc0C...",
  "id_token": "eyJhbGciOiJS...",
  "user_id": "firebase_uid",
  "project_id": "codeium-a]..."
}
```

### 1.3 Token Expiry Check

```rust
fn should_refresh_token(expires_at: &DateTime<Utc>) -> bool {
    // 5 dakika onceden yenile
    let buffer = Duration::minutes(5);
    Utc::now() + buffer >= *expires_at
}
```

---

## 2. Windsurf Backend API

### 2.1 Base URL

```
https://web-backend.windsurf.com
```

### 2.2 API Endpoints

| Endpoint                                                    | Purpose                    |
|-------------------------------------------------------------|----------------------------|
| `/exa.seat_management_pb.SeatManagementService/UpdateSeats` | Koltuk sayisi guncelle     |
| `/exa.seat_management_pb.SeatManagementService/GetCurrentUser` | Kullanici bilgisi        |
| `/exa.seat_management_pb.SeatManagementService/GetTeamBilling` | Fatura bilgisi           |
| `/exa.seat_management_pb.SeatManagementService/UpdatePlan`  | Plan guncelle              |
| `/exa.seat_management_pb.SeatManagementService/CancelPlan`  | Abonelik iptal             |
| `/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken` | Auth token al       |
| `/exa.seat_management_pb.SeatManagementService/SubscribeToPlan` | Trial baslat           |
| `/exa.seat_management_pb.SeatManagementService/GetPlanStatus` | Plan durumu              |

### 2.3 Request Headers

```rust
headers: {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "connect-protocol-version": "1",
    "content-type": "application/proto",
    "pragma": "no-cache",
    "sec-ch-ua": "\"Chromium\";v=\"142\", \"Google Chrome\";v=\"142\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Referer": "https://windsurf.com/"
}
```

---

## 3. Protobuf Message Encoding

### 3.1 Wire Types

| Wire Type | Meaning           | Used For                              |
|-----------|-------------------|---------------------------------------|
| 0         | Varint            | int32, int64, uint32, bool, enum      |
| 2         | Length-delimited  | string, bytes, embedded messages      |

### 3.2 Varint Encoding

```rust
fn encode_varint(length: usize, buffer: &mut Vec<u8>) {
    if length < 128 {
        buffer.push(length as u8);
    } else {
        buffer.push(((length & 0x7F) | 0x80) as u8);
        buffer.push((length >> 7) as u8);
    }
}
```

### 3.3 UpdateSeats Request

```rust
fn build_request_body(token: &str, seat_count: i32) -> Vec<u8> {
    let mut body = vec![];

    // Field 1: token (string)
    body.push(0x0a);  // (1 << 3) | 2 = 10 = 0x0a
    encode_varint(token.len(), &mut body);
    body.extend_from_slice(token.as_bytes());

    // Field 2: seat_count (int32)
    body.push(0x10);  // (2 << 3) | 0 = 16 = 0x10
    body.push(seat_count as u8);

    body
}
```

### 3.4 UpdatePlan Request

```rust
// Protobuf Structure:
// - Field 1 (string): auth_token
// - Field 2 (varint): price (StripePrice enum)
// - Field 3 (varint): preview (bool)
// - Field 4 (varint): payment_period (1=monthly, 2=yearly)
// - Field 5 (varint): teams_tier (TeamsTier enum)
```

**TeamsTier Enum:**
```rust
enum TeamsTier {
    UNSPECIFIED = 0,
    TEAMS = 1,
    PRO = 2,
    ENTERPRISE_SAAS = 3,
    HYBRID = 4,
    ENTERPRISE_SELF_HOSTED = 5,
    WAITLIST_PRO = 6,
    TEAMS_ULTIMATE = 7,
    PRO_ULTIMATE = 8,
    TRIAL = 9,
    ENTERPRISE_SELF_SERVE = 10,
    ENTERPRISE_SAAS_POOLED = 11
}
```

### 3.5 CancelPlan Request

```rust
// Field 1 (string): Firebase ID Token
// Field 2 (varint): 1 (cancel action)
// Field 5 (string): Cancel reason
```

### 3.6 SubscribeToPlan Request

```rust
// Field 1: auth_token (string)
// Field 3: start_trial = true (bool)
// Field 4: success_url (string)
// Field 5: cancel_url (string)
// Field 6: seats (int64) - Teams/Enterprise only
// Field 7: team_name (string) - Teams/Enterprise only
// Field 8: teams_tier (enum)
// Field 9: payment_period (enum)
// Field 10: turnstile_token (string) - Pro only
```

---

## 4. Response Parsing

### 4.1 UpdateSeats Response

```rust
struct UpdateSeatsResponse {
    success: bool,
    total_seats: i32,           // Field 4
    used_seats: i32,            // Field 5
    price_per_seat: f32,        // Field 3 (USD)
    total_monthly_price: f32,   // Field 6 (USD)
    billing_start_time: i64,    // SubMessage 7, Field 1
    next_billing_time: i64,     // SubMessage 8, Field 1
}
```

### 4.2 GetCurrentUser Response

```rust
struct UserInfo {
    user: UserBasicInfo,
    team: Option<TeamInfo>,
    plan: Option<PlanInfo>,
    role: Option<UserRole>,
    subscription: Option<SubscriptionInfo>,
    is_root_admin: bool,
}

struct UserBasicInfo {
    api_key: String,              // Field 1
    name: String,                 // Field 2
    email: String,                // Field 3
    signup_time: Option<i64>,     // Field 4 (Unix timestamp)
    last_update_time: Option<i64>,// Field 5
    id: String,                   // Field 6 (Firebase UID)
    team_id: String,              // Field 7
    team_status: i32,             // Field 8 (UserTeamStatus enum)
    timezone: String,             // Field 10
    pro: bool,                    // Field 13
    disable_codeium: bool,        // Field 16
    used_trial: bool,             // Field 25
    used_prompt_credits: i64,     // Field 28
    used_flow_credits: i64,       // Field 29
}

struct TeamInfo {
    id: String,                   // Field 1
    name: String,                 // Field 2
    stripe_subscription_id: Option<String>,  // Field 6
    subscription_active: bool,    // Field 7
    stripe_customer_id: Option<String>,      // Field 8
    current_billing_period_start: Option<i64>, // Field 9
    num_seats_current_billing_period: i32,   // Field 10
    teams_tier: i32,              // Field 14 (TeamsTier enum)
    flex_credit_quota: i64,       // Field 15
    used_flow_credits: i64,       // Field 16
    used_prompt_credits: i64,     // Field 17
    current_billing_period_end: Option<i64>, // Field 18
    used_flex_credits: i64,       // Field 27
    num_users: i32,               // Member count
}

struct PlanInfo {
    teams_tier: i32,              // Field 1
    plan_name: String,            // Field 2
    monthly_prompt_credits: i64,  // Field 12
    monthly_flow_credits: i64,    // Field 13
    is_enterprise: bool,          // Field 16
    is_teams: bool,               // Field 17
    can_buy_more_credits: bool,   // Field 18
}
```

### 4.3 GetTeamBilling Response

```rust
struct BillingInfo {
    plan_name: String,
    base_quota: i64,              // Field 8
    extra_credits: Option<i64>,   // Field 4
    used_quota: Option<i64>,      // Field 6
    cache_limit: i64,             // Field 9
    payment_method: String,
    next_billing_date: String,
    invoice_url: String,
    monthly_price: f32,
}
```

---

## 5. Hesap Degistirme (Switch Account)

### 5.1 Flow

```
1. Refresh Token -> Access Token (Firebase)
2. Access Token -> Auth Token (GetOneTimeAuthToken API)
3. Reset Machine ID (optional, requires admin)
4. Trigger Windsurf Callback URL
```

### 5.2 GetOneTimeAuthToken

```rust
async fn get_auth_token(access_token: &str) -> String {
    let url = "https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken";

    // Protobuf: Field 1 = access_token
    let request = serialize_protobuf_string(access_token);

    let response = client.post(url)
        .header("Content-Type", "application/proto")
        .header("Accept", "application/proto")
        .body(request)
        .send().await;

    // Response: Field 1 = auth_token
    deserialize_protobuf_response(response)
}
```

### 5.3 Windsurf Callback URL

```rust
// URL format:
// windsurf://codeium.windsurf#access_token={auth_token}&state={uuid}&token_type=Bearer

fn trigger_windsurf_callback(auth_token: &str) {
    let state = Uuid::new_v4().to_string();
    let callback_url = format!(
        "windsurf://codeium.windsurf#access_token={}&state={}&token_type=Bearer",
        auth_token, state
    );

    // Platform-specific URL opening
    #[cfg(windows)] { powershell Start-Process }
    #[cfg(macos)] { open }
    #[cfg(linux)] { xdg-open }
}
```

---

## 6. Machine ID Yonetimi

### 6.1 Machine ID Types

| ID Type         | Format                       | Location                              |
|-----------------|------------------------------|---------------------------------------|
| machineId       | 64-char hex (256-bit)        | storage.json                          |
| macMachineId    | 32-char hex (MD5 format)     | storage.json                          |
| sqmId           | UUID (uppercase, no braces)  | storage.json                          |
| devDeviceId     | UUID (lowercase)             | storage.json                          |
| MachineGuid     | UUID (Windows Registry)      | HKLM\\SOFTWARE\\Microsoft\\Cryptography |

### 6.2 Storage.json Location

| OS      | Path                                                    |
|---------|---------------------------------------------------------|
| Windows | `%APPDATA%\Windsurf\User\globalStorage\storage.json`    |
| macOS   | `~/Library/Application Support/Windsurf/User/globalStorage/storage.json` |
| Linux   | `~/.config/Windsurf/User/globalStorage/storage.json`    |

### 6.3 Machine ID Reset (Windows)

```rust
async fn reset_machine_id_internal() {
    // 1. Generate new IDs
    let new_machine_id = hex::encode(random_bytes(32));     // 64 chars
    let new_mac_machine_id = format!("{:032x}", random_u128());
    let new_sqm_id = Uuid::new_v4().to_string().to_uppercase();
    let new_device_id = Uuid::new_v4().to_string().to_lowercase();

    // 2. Update storage.json
    storage["telemetry.machineId"] = new_machine_id;
    storage["telemetry.macMachineId"] = new_mac_machine_id;
    storage["telemetry.sqmId"] = new_sqm_id;
    storage["telemetry.devDeviceId"] = new_device_id;

    // 3. Update Windows Registry (requires admin)
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto_key = hklm.open_subkey_with_flags(
        "SOFTWARE\\Microsoft\\Cryptography",
        KEY_ALL_ACCESS
    );
    crypto_key.set_value("MachineGuid", &Uuid::new_v4().to_string().to_uppercase());
}
```

### 6.4 Machine ID Reset (Linux)

```rust
// 1. Update /etc/machine-id (requires sudo)
let new_id = format!("{:032x}", random_u128());
fs::write("/etc/machine-id", format!("{}\n", new_id));

// 2. Remove cache files
fs::remove_file("~/.config/Windsurf/machineid");
fs::remove_file("~/.local/share/Windsurf/.installerId");
```

---

## 7. Koltuk (Seat) Yonetimi

### 7.1 Akilli Koltuk Dongusu

Koltuk sayisi 3/4/5 arasinda otomatik degistirilir:

```rust
fn get_next_seat_count(current: i32) -> i32 {
    match current {
        3 => 4,
        4 => 5,
        5 => 3,
        _ => 3
    }
}
```

### 7.2 Batch Reset

- Maksimum 5 paralel islem
- Her islem arasinda 1 saniye bekleme
- Basarisiz hesaplar loglanir

---

## 8. Trial Payment Link

### 8.1 SubscribeToPlan API

```rust
async fn get_trial_payment_link(
    token: &str,
    teams_tier: i32,        // 1=Teams, 2=Pro, 3=Enterprise
    payment_period: i32,    // 1=Monthly, 2=Yearly
    team_name: Option<&str>,
    seat_count: Option<i32>,
    turnstile_token: Option<&str>  // Pro icin gerekli
) -> StripeCheckoutUrl {
    let body = build_subscribe_to_plan_body(
        token,
        "https://windsurf.com/pricing/success",
        "https://windsurf.com/pricing/cancel",
        teams_tier,
        payment_period,
        team_name,
        seat_count,
        turnstile_token
    );

    // Response contains Stripe Checkout URL
}
```

---

## 9. Veri Guvenligi

### 9.1 Sifreleme

```rust
// AES-256-GCM encryption
// Key stored in system keychain:
// - Windows: Credential Manager
// - macOS: Keychain
// - Linux: Secret Service (libsecret)
```

### 9.2 Veri Depolama

```json
// %APPDATA%/com.chao.windsurf-account-manager/accounts.json
{
  "accounts": [...],
  "groups": [...],
  "settings": {...},
  "logs": [...]
}
```

---

## 10. Ek Ozellikler

### 10.1 Virtual Card Generator

```typescript
interface VirtualCard {
  cardNumber: string;      // 16 digit
  expiryMonth: string;     // MM
  expiryYear: string;      // YYYY
  cvv: string;             // 3-4 digit
  cardholderName: string;
}

// Custom BIN support
settings.customCardBin: string;        // 4-12 digits
settings.customCardBinRange: string;   // e.g., "626200-626300"
```

### 10.2 Seamless Switch Patch

Windsurf'un `extension.js` dosyasini yamalar:
- 180 saniye OAuth timeout'u kaldirir
- Otomatik hesap gecisi saglar
- Yedekleme olusturur (max 3 kopya)

### 10.3 Analytics

```typescript
interface AnalyticsData {
  dailyUsage: DailyUsage[];  // Son 30 gun
  totalCredits: number;
  averageDaily: number;
  peakUsage: number;
}
```

### 10.4 Team Config

```typescript
interface TeamConfig {
  allow_auto_run_commands: boolean;
  allow_mcp_servers: boolean;
  allow_app_deployments: boolean;
  allow_github_reviews: boolean;
  allow_conversation_sharing: boolean;
  disable_deepwiki: boolean;
  allowed_mcp_servers: string[];
}
```

---

## 11. Error Handling

### 11.1 Firebase Errors

| Error Code                   | Aciklama                        |
|------------------------------|---------------------------------|
| TOO_MANY_ATTEMPTS_TRY_LATER  | Rate limit, 15-30 dk bekle      |
| INVALID_LOGIN_CREDENTIALS    | Email/password hatasi           |
| EMAIL_NOT_FOUND              | Kayitli olmayan email           |
| USER_DISABLED                | Devre disi hesap                |
| TOKEN_EXPIRED                | Token suresi dolmus             |
| INVALID_REFRESH_TOKEN        | Gecersiz refresh token          |

### 11.2 Admin Privilege Errors

```rust
// Windows: Check elevation status
fn is_elevated() -> bool {
    // TOKEN_ELEVATION check via GetTokenInformation
}

// Unix: Check euid
fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}
```

---

## 12. Karsilastirma: Windsurf vs Kiro

| Ozellik                | Windsurf Account Manager       | Kiro Account Manager           |
|------------------------|--------------------------------|--------------------------------|
| Auth System            | Firebase Email/Password        | AWS SSO OIDC / Social OAuth    |
| Backend Protocol       | Protobuf (custom encoding)     | AWS Event Stream               |
| Machine ID             | storage.json + Registry        | User-Agent header              |
| Credit System          | Prompt/Flow/Flex credits       | Single quota                   |
| Team Management        | Seats, billing, members        | ProfileArn based               |
| Payment Integration    | Stripe Checkout                | Stripe (via Kiro)              |
| Plan Types             | Teams/Pro/Enterprise/Trial     | Free/Pro                       |

---

## 13. Dosya Yapisi

```
src/
├── api/index.ts           # Frontend API calls (Tauri invoke)
├── types/index.ts         # TypeScript type definitions
├── store/modules/
│   ├── accounts.ts        # Account state management
│   ├── settings.ts        # App settings
│   └── ui.ts              # UI state
└── utils/
    ├── cardGenerator.ts   # Virtual card generator
    ├── stripeFormFiller.ts # Auto-fill Stripe forms
    └── privacy.ts         # Privacy mode utils

src-tauri/src/
├── commands/
│   ├── account_commands.rs     # Account CRUD
│   ├── api_commands.rs         # API operations
│   ├── switch_account_commands.rs # Account switching
│   ├── patch_commands.rs       # Seamless switch patch
│   ├── payment_commands.rs     # Payment operations
│   ├── team_commands.rs        # Team management
│   └── proto_commands.rs       # Protobuf parsing
├── services/
│   ├── auth_service.rs         # Firebase auth
│   ├── windsurf_service.rs     # Windsurf API calls
│   ├── proto_parser.rs         # Protobuf response parsing
│   └── analytics_service.rs    # Usage analytics
├── repository/
│   └── data_store.rs           # Local data persistence
├── models/
│   ├── account.rs              # Account model
│   └── config.rs               # Config model
└── utils/
    ├── crypto.rs               # AES-256-GCM encryption
    └── errors.rs               # Error types
```

---

## 14. Sonuc

Windsurf Account Manager, kapsamli bir hesap yonetimi cozumu sunuyor:

1. **Firebase Authentication**: Email/password ile guvenli giris
2. **Protobuf API Integration**: Custom encoding ile backend iletisimi
3. **Seat Management**: Akilli koltuk dongusu ile limit yonetimi
4. **Machine ID Reset**: Cross-platform cihaz kimlik sifirlama
5. **Account Switching**: Tek tikla hesap degisimi
6. **Data Security**: AES-256-GCM sifreleme, system keychain
7. **Team Management**: Fatura, uyelik ve plan yonetimi
8. **Payment Integration**: Stripe Checkout entegrasyonu

Bu ozellikler, benzer hesap yonetimi sistemleri icin referans olarak kullanilabilir.
