# CLIProxyAPIPlus Kiro Feature Analysis

Bu dokuman, [CLIProxyAPIPlus](https://github.com/fuko2935/CLIProxyAPIPlus) projesindeki Kiro (AWS CodeWhisperer) entegrasyonunu analiz eder.

## Genel Bakis

CLIProxyAPIPlus, Go dilinde yazilmis bir API proxy servisidir. Kiro entegrasyonu asagidaki ozellikleri icerir:

| Ozellik                | Aciklama                                         |
|------------------------|--------------------------------------------------|
| Authentication Methods | AWS Builder ID, Google OAuth, GitHub OAuth       |
| Token Management       | Auto-refresh, multi-account support, JWT parsing |
| Protocol Handler       | Cross-platform `kiro://` URI handler             |
| API Integration        | CodeWhisperer + Amazon Q streaming endpoints     |
| Format Translation     | OpenAI/Claude format to Kiro format conversion   |

---

## 1. Authentication Sistemi

### 1.1 Desteklenen Yontemler

```
+------------------+----------------------+---------------------------+
| Auth Method      | Provider             | Flow Type                 |
+------------------+----------------------+---------------------------+
| AWS Builder ID   | AWS SSO OIDC         | Device Code Flow          |
| Google           | Kiro AuthService     | PKCE + Custom Protocol    |
| GitHub           | Kiro AuthService     | PKCE + Custom Protocol    |
+------------------+----------------------+---------------------------+
```

### 1.2 AWS Builder ID (Device Code Flow)

**Dosya:** `internal/auth/kiro/sso_oidc.go`

**Endpoint:** `https://oidc.us-east-1.amazonaws.com`

**Start URL:** `https://view.awsapps.com/start`

**Flow:**

```
1. RegisterClient
   POST /client/register
   Body: {
     "clientName": "CLI-Proxy-API-{timestamp}",
     "clientType": "public",
     "scopes": ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"]
   }
   Response: { clientId, clientSecret, clientSecretExpiresAt }

2. StartDeviceAuthorization
   POST /device_authorization
   Body: { clientId, clientSecret, startUrl }
   Response: { deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn }

3. Kullanici verification URL'e gider ve user code'u girer

4. CreateToken (polling)
   POST /token
   Body: { clientId, clientSecret, deviceCode, grantType: "urn:ietf:params:oauth:grant-type:device_code" }
   Response: { accessToken, refreshToken, expiresIn }

5. ProfileArn Fetch (token alindiktan sonra)
   - ListProfiles API
   - ListAvailableCustomizations API (fallback)
```

**Token Refresh:**
```go
POST /token
Body: {
  "clientId": "...",
  "clientSecret": "...",
  "refreshToken": "...",
  "grantType": "refresh_token"
}
```

### 1.3 Social Auth (Google/GitHub)

**Dosya:** `internal/auth/kiro/social_auth.go`

**Endpoint:** `https://prod.us-east-1.auth.desktop.kiro.dev`

**Redirect URI:** `kiro://kiro.kiroAgent/authenticate-success`

**Flow:**

```
1. PKCE Generation
   - code_verifier: 32 byte random, base64url encoded
   - code_challenge: SHA256(code_verifier), base64url encoded

2. State Generation
   - 16 byte random, base64url encoded

3. Login URL Construction
   GET /login?idp={Google|Github}&redirect_uri={uri}&code_challenge={challenge}&code_challenge_method=S256&state={state}&prompt=select_account

4. Protocol Handler Callback
   kiro://kiro.kiroAgent/authenticate-success?code={code}&state={state}

5. Token Exchange
   POST /oauth/token
   Body: { code, code_verifier, redirect_uri }
   Response: { accessToken, refreshToken, profileArn, expiresIn }
```

**Token Refresh:**
```go
POST /refreshToken
Body: { "refreshToken": "..." }
```

---

## 2. Token Yonetimi

### 2.1 Token Storage Structure

**Dosya:** `internal/auth/kiro/token.go`

```go
type KiroTokenStorage struct {
    AccessToken  string `json:"access_token"`
    RefreshToken string `json:"refresh_token"`
    ProfileArn   string `json:"profile_arn"`
    ExpiresAt    string `json:"expires_at"`
    AuthMethod   string `json:"auth_method"`    // "social" | "builder-id"
    Provider     string `json:"provider"`        // "Google" | "Github" | "AWS"
    LastRefresh  string `json:"last_refresh"`
}
```

### 2.2 Token Data Structure (API Use)

**Dosya:** `internal/auth/kiro/aws.go`

```go
type KiroTokenData struct {
    AccessToken  string `json:"accessToken"`
    RefreshToken string `json:"refreshToken"`
    ProfileArn   string `json:"profileArn"`
    ExpiresAt    string `json:"expiresAt"`
    AuthMethod   string `json:"authMethod"`
    Provider     string `json:"provider"`
    ClientID     string `json:"clientId,omitempty"`     // Builder ID icin gerekli
    ClientSecret string `json:"clientSecret,omitempty"` // Builder ID icin gerekli
    Email        string `json:"email,omitempty"`        // JWT'den veya kullanici girdisi
}
```

### 2.3 JWT Email Extraction

**Dosya:** `internal/auth/kiro/aws.go:207-259`

Access token JWT formatinda oldugunda, payload'dan email cikarilir:

```go
// JWT format: header.payload.signature
parts := strings.Split(accessToken, ".")
// payload decode (base64url)
// claims: { email, sub, preferred_username, name, iss }
```

Priority:
1. `email` claim
2. `preferred_username` (@ iceriyorsa)
3. `sub` (@ iceriyorsa)

### 2.4 Multi-Account Support

**Dosya:** `internal/auth/kiro/aws.go:138-171`

Token dosyalari: `~/.aws/sso/cache/kiro*.json`

```go
func ListKiroTokenFiles() ([]string, error)
func LoadAllKiroTokens() ([]*KiroTokenData, error)
func LoadKiroTokenFromPath(tokenPath string) (*KiroTokenData, error)
```

### 2.5 Filename Sanitization (Security)

**Dosya:** `internal/auth/kiro/aws.go:264-301`

Email adresleri dosya adina cevirilirken guvenlik icin sanitize edilir:

- URL-encoded path traversal engelleme (`%2F`, `%5C`, `%2E`, `%00`)
- Ozel karakterlerin degistirilmesi (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`)
- Path traversal engelleme (`.` ile baslayan parcalar)

---

## 3. Protocol Handler

### 3.1 Overview

**Dosya:** `internal/auth/kiro/protocol_handler.go`

Custom `kiro://` URI scheme handler, social auth callback'leri icin kullanilir.

```
Protocol: kiro
Authority: kiro.kiroAgent
Path: /authenticate-success
Full URI: kiro://kiro.kiroAgent/authenticate-success?code={code}&state={state}
```

### 3.2 Local Callback Server

- Port range: 19876-19880 (5 port denenir)
- Timeout: 10 dakika
- Endpoint: `http://127.0.0.1:{port}/oauth/callback`

### 3.3 Platform-Specific Implementations

#### Linux

```
Desktop File: ~/.local/share/applications/kiro-oauth-handler.desktop
Handler Script: ~/.local/bin/kiro-oauth-handler

Registration: xdg-mime default kiro-oauth-handler.desktop x-scheme-handler/kiro
```

#### Windows

```
Registry Key: HKCU\Software\Classes\kiro
Handler Script: %USERPROFILE%\.cliproxyapi\kiro-oauth-handler.ps1
Batch Wrapper: %USERPROFILE%\.cliproxyapi\kiro-oauth-handler.bat
```

#### macOS

```
App Bundle: ~/Applications/KiroOAuthHandler.app
  Contents/Info.plist (CFBundleURLTypes)
  Contents/MacOS/kiro-oauth-handler (executable)

Registration: lsregister -f ~/Applications/KiroOAuthHandler.app
```

### 3.4 Handler Script Logic

Her platform icin script:
1. URI'dan code, state, error parametrelerini cikarir
2. Multiple port'lara (19876-19880) curl request gonderir
3. Basarili olan ilk port'ta durur

---

## 4. API Entegrasyonu

### 4.1 Endpoints

| Purpose             | Endpoint                                        |
|---------------------|-------------------------------------------------|
| Management APIs     | `https://codewhisperer.us-east-1.amazonaws.com` |
| Chat/Streaming APIs | `https://q.us-east-1.amazonaws.com`             |
| SSO OIDC            | `https://oidc.us-east-1.amazonaws.com`          |
| Social Auth         | `https://prod.us-east-1.auth.desktop.kiro.dev`  |

### 4.2 Management API Targets

```
AmazonCodeWhispererService.GetUsageLimits
AmazonCodeWhispererService.ListAvailableModels
AmazonCodeWhispererService.ListProfiles
AmazonCodeWhispererService.ListAvailableCustomizations
```

### 4.3 Chat API Target

```
AmazonCodeWhispererStreamingService.GenerateAssistantResponse
```

### 4.4 Request Headers

```
Content-Type: application/x-amz-json-1.0
x-amz-target: {API Target}
Authorization: Bearer {accessToken}
Accept: application/vnd.amazon.eventstream  (streaming icin)
```

### 4.5 Origin Types

| Origin    | Quota Source   | Use Case                          |
|-----------|----------------|-----------------------------------|
| CLI       | Amazon Q quota | Default for non-Opus              |
| AI_EDITOR | Kiro IDE quota | Default for Opus, fallback on 429 |

---

## 5. Model Mapping

### 5.1 Desteklenen Modeller

```go
// Kiro prefix
"kiro-auto"              -> "auto"
"kiro-claude-opus-4.5"   -> "claude-opus-4.5"
"kiro-claude-sonnet-4.5" -> "claude-sonnet-4.5"
"kiro-claude-sonnet-4"   -> "claude-sonnet-4"
"kiro-claude-haiku-4.5"  -> "claude-haiku-4.5"

// Amazon Q prefix (ayni API)
"amazonq-auto"              -> "auto"
"amazonq-claude-opus-4.5"   -> "claude-opus-4.5"
...

// Native format
"claude-opus-4.5"   -> "claude-opus-4.5"
...

// Variants
"kiro-claude-opus-4.5-chat"     -> "claude-opus-4.5" (no tool calling)
"kiro-claude-opus-4.5-agentic"  -> "claude-opus-4.5" (with agentic system prompt)
```

### 5.2 Model Variants

| Suffix   | Ozellik                               |
|----------|---------------------------------------|
| (none)   | Standard model, tool calling destekli |
| -chat    | Tool calling devre disi               |
| -agentic | Chunked write system prompt eklenir   |

---

## 6. Format Translation

### 6.1 OpenAI to Kiro

**Dosya:** `internal/translator/kiro/openai/chat-completions/kiro_openai_request.go`

| OpenAI             | Kiro (Claude)               |
|--------------------|-----------------------------|
| messages[].role    | messages[].role             |
| messages[].content | messages[].content          |
| tools[].function   | tools[].name + input_schema |
| tool_calls         | tool_use blocks             |
| tool messages      | tool_result blocks          |
| system message     | system field                |

### 6.2 Claude to Kiro

**Dosya:** `internal/translator/kiro/claude/kiro_claude.go`

Kiro dahili olarak Claude formatini kullandigi icin translation pass-through:

```go
func ConvertClaudeRequestToKiro(modelName string, inputRawJSON []byte, stream bool) []byte {
    return bytes.Clone(inputRawJSON)
}
```

---

## 7. Error Handling

### 7.1 Auth Error Retry

```
401/403 Error:
  -> Token refresh dene
  -> Basariliysa retry
  -> Maksimum 2 retry
```

### 7.2 Quota Exhausted Fallback

```
429 Error (CLI quota):
  -> AI_EDITOR origin'e gec
  -> Payload'i yeniden olustur
  -> Retry
```

### 7.3 Token Expiry Check

```go
func (k *KiroAuth) IsTokenExpired(tokenData *KiroTokenData) bool {
    // RFC3339 veya 2006-01-02T15:04:05.000Z formatlarini destekler
    expiresAt, err := time.Parse(time.RFC3339, tokenData.ExpiresAt)
    return time.Now().After(expiresAt)
}
```

---

## 8. Agentic System Prompt

Buyuk dosya yazma islemleri icin timeout'lari onlemek amaciyla `-agentic` suffix'li modellere ozel system prompt eklenir:

```
CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

- MAXIMUM 350 LINES per single write/edit operation
- RECOMMENDED 300 LINES or less
- NEVER write entire files in one operation if >300 lines

For NEW FILES (>300 lines total):
1. Write initial chunk (first 250-300 lines)
2. Append remaining content in 250-300 line chunks

For EDITING EXISTING FILES:
1. Use surgical edits - change ONLY what's needed
2. NEVER rewrite entire files
```

---

## 9. Guvenlik Ozellikleri

### 9.1 PKCE Implementation

- Code verifier: 32 byte cryptographically random
- Code challenge: SHA256 hash, base64url encoded
- Challenge method: S256

### 9.2 State Parameter

- 16 byte cryptographically random
- base64url encoded
- Callback'te dogrulanir (CSRF koruması)

### 9.3 Path Traversal Prevention

Email'den dosya adı olusturulurken:
- URL-encoded karakterler sanitize edilir
- Ozel karakterler underscore'a cevirilir
- Leading dots engellenir

### 9.4 Token Security

- Client secret sadece Builder ID icin saklanir
- Token dosyalari 0600 permission ile yazilir
- Directory 0700 permission ile olusturulur

---

## 10. Karsilastirma: CLIProxyAPIPlus vs Mevcut Sistem

| Ozellik               | CLIProxyAPIPlus (Go)   | Mevcut Sistem (Node.js) |
|-----------------------|------------------------|-------------------------|
| Profile ARN Fetch     | Login sonrasi otomatik | Manuel gerekebilir      |
| Multi-Account         | Token file listing     | DB-based                |
| Protocol Handler      | Cross-platform support | -                       |
| Incognito Mode        | Config flag destegi    | -                       |
| Quota Fallback        | CLI -> AI_EDITOR       | -                       |
| Agentic System Prompt | Otomatik ekleme        | -                       |
| JWT Email Extraction  | Otomatik               | -                       |

---

## 11. Entegrasyon Onerileri

### 11.1 Profile ARN Fetch

Mevcut sistemde profile ARN null kalabiliyor. CLIProxyAPIPlus'in yaklasimi:

```javascript
// Login sonrasi otomatik fetch
async function fetchProfileArn(accessToken) {
    // 1. ListProfiles dene
    const profiles = await callAPI('ListProfiles', accessToken);
    if (profiles?.profileArn) return profiles.profileArn;

    // 2. Fallback: ListAvailableCustomizations
    const customs = await callAPI('ListAvailableCustomizations', accessToken);
    return customs?.profileArn || customs?.customizations?.[0]?.arn;
}
```

### 11.2 Quota Fallback Mekanizmasi

429 hatalarinda otomatik origin degisimi:

```javascript
// Ilk istek CLI origin ile
if (response.status === 429 && origin === 'CLI') {
    origin = 'AI_EDITOR';
    // Payload'i yeniden olustur ve retry
}
```

### 11.3 IAM Identity Center Destegi

CLIProxyAPIPlus'ta IAM Identity Center icin ayri endpoint gerekir:
- Custom start URL destegi (`https://d-xxx.awsapps.com/start`)
- Region parametresi
- SSO OIDC endpoint: `https://sso-oidc.{region}.amazonaws.com`

---

## 12. Dosya Yapisi

```
internal/auth/kiro/
├── aws.go              # JWT parsing, multi-account, sanitization
├── aws_auth.go         # KiroAuth class, API calls, token validation
├── oauth.go            # KiroOAuth wrapper class
├── protocol_handler.go # Cross-platform kiro:// URI handler
├── social_auth.go      # Google/GitHub OAuth implementation
├── sso_oidc.go         # AWS Builder ID device code flow
└── token.go            # Token storage structures

internal/runtime/executor/
└── kiro_executor.go    # API execution, retry logic, format translation

internal/translator/kiro/
├── claude/
│   └── kiro_claude.go  # Claude format (pass-through)
└── openai/
    └── chat-completions/
        ├── kiro_openai_request.go  # OpenAI -> Kiro translation
        └── kiro_openai_response.go # Kiro -> OpenAI translation
```

---

## 13. Sonuc

CLIProxyAPIPlus projesi, Kiro entegrasyonu icin kapsamli bir implementasyon sunuyor:

1. **Coklu Authentication:** Builder ID, Google, GitHub destegi
2. **Token Yonetimi:** Otomatik refresh, multi-account, JWT parsing
3. **Cross-Platform:** Linux, Windows, macOS icin protocol handler
4. **Hata Toleransi:** Auth retry, quota fallback mekanizmalari
5. **Format Translation:** OpenAI/Claude uyumlulugu

Bu ozellikler, mevcut Node.js tabanli sistemimize entegre edilebilir veya referans olarak kullanilabilir.
