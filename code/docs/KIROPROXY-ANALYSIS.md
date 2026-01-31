# KiroProxy Analizi

Bu dokuman, [petehsu/KiroProxy](https://github.com/petehsu/KiroProxy) projesinin kapsamli teknik analizini icermektedir.

## Genel Bakis

| Ozellik              | Deger                                                                 |
|----------------------|-----------------------------------------------------------------------|
| Proje Adi            | KiroProxy                                                             |
| Surum                | v1.7.16                                                               |
| Programlama Dili     | Python 3.x                                                            |
| Framework            | FastAPI + httpx                                                       |
| Lisans               | MIT                                                                   |
| Amac                 | Kiro IDE API reverse proxy - coklu hesap, token yenileme, kota yonetimi |
| Protokol Destegi     | OpenAI, Anthropic, Gemini                                             |
| Varsayilan Port      | 8080                                                                  |

## Dizin Yapisi

```
kiro_proxy/
├── __init__.py
├── main.py                 # FastAPI ana uygulamasi
├── config.py               # Yapilandirma ve model esleme
├── models.py               # Veri modelleri (uyumluluk katmani)
├── converters.py           # Protokol donusturuculer
├── kiro_api.py             # Kiro API uyumluluk katmani
├── auth/
│   └── device_flow.py      # OAuth kimlik dogrulama
├── credential/
│   ├── types.py            # KiroCredentials veri sinifi
│   ├── refresher.py        # Token yenileme
│   ├── fingerprint.py      # Cihaz parmak izi
│   └── quota.py            # Kota yonetimi
├── core/
│   ├── state.py            # Global durum yonetimi
│   ├── account.py          # Hesap yonetimi
│   ├── error_handler.py    # Hata siniflandirma
│   ├── history_manager.py  # Konusma gecmisi yonetimi
│   └── rate_limiter.py     # Istek hizi sinirlandirma
├── handlers/
│   ├── anthropic.py        # /v1/messages
│   ├── openai.py           # /v1/chat/completions
│   ├── gemini.py           # /v1/models/{model}:generateContent
│   └── admin.py            # Yonetim API'leri
├── providers/
│   └── kiro.py             # KiroProvider sinifi
└── web/
    └── i18n.py             # Coklu dil destegi
```

## Kimlik Dogrulama Yontemleri

KiroProxy uc farkli kimlik dogrulama yontemini destekler:

### 1. Social Auth (Google/GitHub) - PKCE Flow

```python
KIRO_AUTH_ENDPOINT = "https://prod.us-east-1.auth.desktop.kiro.dev"

# PKCE Sureci:
# 1. code_verifier olustur (128 karakter)
# 2. code_challenge olustur (SHA256 hash)
# 3. OAuth state olustur
# 4. Kullaniciyi login URL'ine yonlendir
# 5. Yerel callback sunucusu baslat (127.0.0.1:19823)
# 6. Yetkilendirme kodu al
# 7. Token icin kod degisimi yap
```

**Login URL Formati:**
```
https://prod.us-east-1.auth.desktop.kiro.dev/login
  ?idp={Google|Github}
  &redirect_uri=http://127.0.0.1:19823/kiro-social-callback
  &code_challenge={code_challenge}
  &code_challenge_method=S256
  &state={oauth_state}
```

**Token Exchange Endpoint:**
```
POST https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token
Content-Type: application/json

{
    "grant_type": "authorization_code",
    "code": "{auth_code}",
    "redirect_uri": "http://127.0.0.1:19823/kiro-social-callback",
    "code_verifier": "{code_verifier}"
}
```

### 2. AWS Builder ID - Device Code Flow

```python
KIRO_START_URL = "https://view.awsapps.com/start"
KIRO_SCOPES = [
    "codewhisperer:completions",
    "codewhisperer:analysis",
    "codewhisperer:conversations",
    "codewhisperer:transformations",
    "codewhisperer:taskassist",
]
```

**Istemci Kayit:**
```
POST https://oidc.{region}.amazonaws.com/client/register
Content-Type: application/json

{
    "clientName": "Kiro Proxy",
    "clientType": "public",
    "scopes": [...KIRO_SCOPES],
    "grantTypes": ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    "issuerUrl": "https://view.awsapps.com/start"
}

Yanit:
{
    "clientId": "...",
    "clientSecret": "..."
}
```

**Cihaz Yetkilendirme:**
```
POST https://oidc.{region}.amazonaws.com/device_authorization
Content-Type: application/json

{
    "clientId": "{client_id}",
    "clientSecret": "{client_secret}",
    "startUrl": "https://view.awsapps.com/start"
}

Yanit:
{
    "deviceCode": "...",
    "userCode": "XXXX-XXXX",
    "verificationUriComplete": "https://...",
    "interval": 5,
    "expiresIn": 600
}
```

**Token Yoklama:**
```
POST https://oidc.{region}.amazonaws.com/token
Content-Type: application/json

{
    "clientId": "{client_id}",
    "clientSecret": "{client_secret}",
    "grantType": "urn:ietf:params:oauth:grant-type:device_code",
    "deviceCode": "{device_code}"
}

Hata Kodlari:
- "authorization_pending": Kullanici henuz yetkilendirmedi
- "slow_down": Yoklama cok hizli
- "expired_token": Yetkilendirme suresi doldu
- "access_denied": Kullanici reddetti
```

### 3. IAM Identity Center (IdC)

```python
# IdC icin farkli token yenileme URL'i
def get_refresh_url(self):
    if auth_method == "idc":
        return f"https://oidc.{region}.amazonaws.com/token"
    else:
        return f"https://prod.{region}.auth.desktop.kiro.dev/refreshToken"
```

## Token Yonetimi

### Kimlik Bilgisi Veri Yapisi

```python
@dataclass
class KiroCredentials:
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    profile_arn: Optional[str] = None
    expires_at: Optional[str] = None       # ISO format veya timestamp
    region: str = "us-east-1"
    auth_method: str = "social"            # "social", "idc"
    client_id_hash: Optional[str] = None
    last_refresh: Optional[str] = None
```

### Token Yenileme

**Social Auth Yenileme:**
```
POST https://prod.{region}.auth.desktop.kiro.dev/refreshToken
Content-Type: application/json
User-Agent: KiroIDE-{version}-{machine_id}
Accept: application/json, text/plain, */*

{
    "refreshToken": "{refresh_token}"
}
```

**IdC Yenileme:**
```
POST https://oidc.{region}.amazonaws.com/token
Content-Type: application/json
x-amz-user-agent: aws-sdk-js/3.738.0 KiroIDE-{version}-{machine_id}
User-Agent: node

{
    "refreshToken": "{refresh_token}",
    "clientId": "{client_id}",
    "clientSecret": "{client_secret}",
    "grantType": "refresh_token"
}
```

### Token Durum Kontrolu

```python
def is_expired(self) -> bool:
    """Token'in suresi dolmus mu kontrol et (5 dakika tolerans)"""
    if "T" in self.expires_at:  # ISO format
        expires = datetime.fromisoformat(self.expires_at)
        return expires <= now + timedelta(minutes=5)
    else:  # Unix timestamp
        return now_ts >= (expires_ts - 300)

def is_expiring_soon(self, minutes: int = 10) -> bool:
    """Token yakinda dolacak mi kontrol et"""
    return expires < now + timedelta(minutes=minutes)
```

## API Endpoint'leri

### Ana API URL

```python
KIRO_API_URL = "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
MODELS_URL = "https://q.us-east-1.amazonaws.com/ListAvailableModels"
```

### Desteklenen Protokoller

| Protokol  | Endpoint                                    | Aciklama                    |
|-----------|---------------------------------------------|-----------------------------|
| OpenAI    | `POST /v1/chat/completions`                 | Chat Completions API        |
| OpenAI    | `POST /v1/responses`                        | Responses API (Codex CLI)   |
| OpenAI    | `GET /v1/models`                            | Model listesi               |
| Anthropic | `POST /v1/messages`                         | Claude Code                 |
| Anthropic | `POST /v1/messages/count_tokens`            | Token sayimi                |
| Gemini    | `POST /v1/models/{model}:generateContent`   | Gemini CLI                  |

### Model Esleme

```python
MODEL_MAPPING = {
    # Claude 3.5 -> Kiro Claude 4
    "claude-3-5-sonnet-20241022": "claude-sonnet-4",
    "claude-3-5-sonnet-latest": "claude-sonnet-4",
    "claude-3-5-haiku-20241022": "claude-haiku-4.5",

    # Claude 3
    "claude-3-opus-20240229": "claude-opus-4.5",
    "claude-3-sonnet-20240229": "claude-sonnet-4",

    # OpenAI GPT -> Claude
    "gpt-4o": "claude-sonnet-4",
    "gpt-4o-mini": "claude-haiku-4.5",
    "gpt-4-turbo": "claude-sonnet-4",

    # OpenAI o1 -> Claude Opus
    "o1": "claude-opus-4.5",
    "o1-preview": "claude-opus-4.5",

    # Gemini -> Claude
    "gemini-2.0-flash": "claude-sonnet-4",
    "gemini-2.0-flash-thinking": "claude-opus-4.5",

    # Kisayollar
    "sonnet": "claude-sonnet-4",
    "haiku": "claude-haiku-4.5",
    "opus": "claude-opus-4.5",
}

KIRO_MODELS = {"auto", "claude-sonnet-4.5", "claude-sonnet-4",
               "claude-haiku-4.5", "claude-opus-4.5"}
```

## Istek/Yanit Formatlari

### Kiro API Istek Yapisi

```python
def build_request(
    user_content: str,
    model: str = "claude-sonnet-4",
    history: List[dict] = None,
    tools: List[dict] = None,
    images: List[dict] = None,
    tool_results: List[dict] = None
) -> dict:
    return {
        "conversationState": {
            "agentContinuationId": str(uuid.uuid4()),
            "agentTaskType": "vibe",
            "chatTriggerType": "MANUAL",
            "conversationId": str(uuid.uuid4()),
            "currentMessage": {
                "userInputMessage": {
                    "content": user_content,
                    "modelId": model,
                    "origin": "AI_EDITOR",
                    "images": images,                    # Opsiyonel
                    "userInputMessageContext": {
                        "tools": tools,                  # Opsiyonel
                        "toolResults": tool_results      # Opsiyonel
                    }
                }
            },
            "history": history or []
        }
    }
```

### Istek Basliklari

```python
def build_headers(token: str, agent_mode: str = "vibe", machine_id: str = None):
    return {
        "content-type": "application/json",
        "x-amzn-codewhisperer-optout": "true",
        "x-amzn-kiro-agent-mode": agent_mode,
        "x-amz-user-agent": f"aws-sdk-js/1.0.0 KiroIDE-{kiro_version}-{machine_id}",
        "user-agent": f"aws-sdk-js/1.0.0 ua/2.1 os/{os_name} lang/js md/nodejs#{node_version} "
                      f"api/codewhispererruntime#1.0.0 m/E KiroIDE-{kiro_version}-{machine_id}",
        "amz-sdk-invocation-id": str(uuid.uuid4()),
        "amz-sdk-request": "attempt=1; max=1",
        "Authorization": f"Bearer {token}",
        "Connection": "close",
    }
```

### Gecmis Mesaj Formati

```python
# Kullanici mesaji
{
    "userInputMessage": {
        "content": "mesaj icerigi",
        "modelId": "claude-sonnet-4",
        "origin": "AI_EDITOR",
        "userInputMessageContext": {           # Opsiyonel
            "tools": [...],
            "toolResults": [...]
        }
    }
}

# Asistan mesaji
{
    "assistantResponseMessage": {
        "content": "yanit icerigi",
        "toolUses": [                          # Opsiyonel
            {
                "toolUseId": "...",
                "name": "arac_adi",
                "input": {...}
            }
        ]
    }
}
```

### AWS Event-Stream Ayrıstirma

```python
def parse_response(self, raw: bytes) -> dict:
    """AWS event-stream formatini ayristir"""
    result = {
        "content": [],
        "tool_uses": [],
        "stop_reason": "end_turn"
    }

    tool_input_buffer = {}
    pos = 0

    while pos < len(raw):
        if pos + 12 > len(raw):
            break

        # Bayt sirasi: total_len (4) + headers_len (4) + prelude_crc (4)
        total_len = int.from_bytes(raw[pos:pos+4], 'big')
        headers_len = int.from_bytes(raw[pos+4:pos+8], 'big')

        # Baslik verilerini oku
        header_start = pos + 12
        header_end = header_start + headers_len
        headers_data = raw[header_start:header_end]

        # Olay turunu belirle
        headers_str = headers_data.decode('utf-8', errors='ignore')
        if 'toolUseEvent' in headers_str:
            event_type = 'toolUseEvent'
        elif 'assistantResponseEvent' in headers_str:
            event_type = 'assistantResponseEvent'

        # Payload'i ayristir
        payload_start = pos + 12 + headers_len
        payload_end = pos + total_len - 4  # CRC icin 4 bayt cikar

        if payload_start < payload_end:
            payload = json.loads(raw[payload_start:payload_end])

            if 'assistantResponseEvent' in payload:
                content = payload['assistantResponseEvent'].get('content')
                if content:
                    result["content"].append(content)

            if event_type == 'toolUseEvent':
                tool_id = payload.get('toolUseId', '')
                tool_name = payload.get('name', '')
                tool_input = payload.get('input', '')
                # Arac cagrisi parcalarini biriktir...

        pos += total_len

    return result
```

## Hata Yonetimi

### Hata Turleri

```python
class ErrorType(str, Enum):
    ACCOUNT_SUSPENDED = "account_suspended"      # Hesap askiya alindi
    RATE_LIMITED = "rate_limited"                # Kota asildi
    CONTENT_TOO_LONG = "content_too_long"        # Icerik cok uzun
    AUTH_FAILED = "auth_failed"                  # Kimlik dogrulama basarisiz
    SERVICE_UNAVAILABLE = "service_unavailable"  # Servis kullanilamaz
    MODEL_UNAVAILABLE = "model_unavailable"      # Model kullanilamaz
    UNKNOWN = "unknown"                          # Bilinmeyen hata
```

### Hata Siniflandirma

```python
def classify_error(status_code: int, error_text: str) -> KiroError:
    error_lower = error_text.lower()

    # 1. Hesap askiya alma tespiti
    if "temporarily_suspended" in error_lower:
        return KiroError(
            type=ErrorType.ACCOUNT_SUSPENDED,
            should_disable_account=True,
            should_switch_account=True,
        )

    # 2. Kota asildi tespiti
    if status_code == 429 or any(kw in error_lower for kw in
        ["rate limit", "quota", "too many requests", "throttl"]):
        return KiroError(
            type=ErrorType.RATE_LIMITED,
            should_switch_account=True,
            cooldown_seconds=300,
        )

    # 3. Icerik cok uzun tespiti
    if "content_length_exceeds_threshold" in error_lower:
        return KiroError(
            type=ErrorType.CONTENT_TOO_LONG,
            should_retry=True,
        )

    # 4. Kimlik dogrulama hatasi
    if status_code == 401 or "unauthorized" in error_lower:
        return KiroError(
            type=ErrorType.AUTH_FAILED,
            should_switch_account=True,
        )

    # ...
```

### HTTP Durum Kodlari

| Kod | Anlam                    | Eylem                              |
|-----|--------------------------|------------------------------------|
| 200 | Basarili                 | -                                  |
| 400 | Gecersiz istek           | Istegi kontrol et                  |
| 401 | Yetkisiz                 | Token yenile veya hesap degistir   |
| 403 | Yasakli                  | Hesap askiya alindi, devre disi    |
| 408 | Zaman asimi              | Yeniden dene                       |
| 429 | Hiz siniri               | Sogutmaya gec, hesap degistir      |
| 502 | Sunucu hatasi            | Yeniden dene                       |
| 503 | Servis kullanilamaz      | Yeniden dene                       |
| 529 | Asiri yukleme            | Sogutmaya gec                      |

## Coklu Hesap Yonetimi

### Hesap Durumu

```python
class CredentialStatus(Enum):
    ACTIVE = "active"           # Aktif ve kullanilabilir
    COOLDOWN = "cooldown"       # Kota sogutma doneminde
    UNHEALTHY = "unhealthy"     # Sagliksiz (yenileme basarisiz)
    DISABLED = "disabled"       # Manuel olarak devre disi
    SUSPENDED = "suspended"     # Hesap askiya alindi
```

### Hesap Secimi

```python
def get_available_account(self, session_id: Optional[str] = None):
    # 1. Oturum yapiskanligi kontrolu (60 saniye)
    if session_id and session_id in self.session_locks:
        account_id = self.session_locks[session_id]
        ts = self.session_timestamps.get(session_id, 0)
        if time.time() - ts < 60:
            for acc in self.accounts:
                if acc.id == account_id and acc.is_available():
                    return acc

    # 2. En az istek yapan hesabi sec
    available = [a for a in self.accounts if a.is_available()]
    if not available:
        return None

    account = min(available, key=lambda a: a.request_count)

    # 3. Oturum yapiskanligini kaydet
    if session_id:
        self.session_locks[session_id] = account.id
        self.session_timestamps[session_id] = time.time()

    return account
```

### Kota Yonetimi

```python
class QuotaManager:
    QUOTA_KEYWORDS = [
        "rate limit", "quota", "too many requests", "throttl",
        "capacity", "overloaded", "try again later"
    ]
    QUOTA_STATUS_CODES = {429, 503, 529}

    def __init__(self, cooldown_seconds: int = 300):
        self.cooldown_seconds = cooldown_seconds
        self.exceeded_records: Dict[str, QuotaRecord] = {}

    def mark_exceeded(self, credential_id: str, reason: str,
                     cooldown_seconds: int = None):
        """Hesabi kota asildi olarak isaretle"""
        cooldown = cooldown_seconds or self.cooldown_seconds
        self.exceeded_records[credential_id] = QuotaRecord(
            credential_id=credential_id,
            exceeded_at=time.time(),
            cooldown_until=time.time() + cooldown,
            reason=reason
        )

    def is_available(self, credential_id: str) -> bool:
        """Hesabin kullanilabilir olup olmadigini kontrol et"""
        record = self.exceeded_records.get(credential_id)
        if not record:
            return True
        if time.time() >= record.cooldown_until:
            del self.exceeded_records[credential_id]
            return True
        return False
```

## Cihaz Parmak Izi

### Machine ID Olusturma

```python
def generate_machine_id(profile_arn: str = None, client_id: str = None) -> str:
    """
    Kimlik bilgisine dayali benzersiz Machine ID olustur

    Oncelik: profileArn > clientId > Sistem donanim ID'si
    Zaman faktoru: Saatlik degisim, parmak izinin tamamen sabitlenmesini onler
    """
    unique_key = None
    if profile_arn:
        unique_key = profile_arn
    elif client_id:
        unique_key = client_id
    else:
        unique_key = get_raw_machine_id() or "KIRO_DEFAULT_MACHINE"

    # Saatlik dilim ekle
    hour_slot = int(time.time()) // 3600

    hasher = hashlib.sha256()
    hasher.update(unique_key.encode())
    hasher.update(hour_slot.to_bytes(8, 'little'))

    return hasher.hexdigest()
```

### Sistem Bilgisi

```python
def get_system_info() -> tuple:
    """Sistem calisma zamani bilgisi al (os_name, node_version)"""
    system = platform.system()

    if system == "Darwin":
        # sw_vers -productVersion
        os_name = f"macos#{version}"  # ornegin "macos#14.0"
    elif system == "Linux":
        # uname -r
        os_name = f"linux#{version}"
    elif system == "Windows":
        os_name = "windows#10.0"

    node_version = "20.18.0"
    return os_name, node_version

def get_kiro_version() -> str:
    """Kiro IDE surum numarasini al"""
    # macOS: /Applications/Kiro.app/Contents/Info.plist oku
    # Varsayilan: "0.1.25"
```

## Konusma Gecmisi Yonetimi

### Kisitlama Stratejileri

```python
class TruncateStrategy(str, Enum):
    NONE = "none"                    # Kisitlama yok
    AUTO_TRUNCATE = "auto_truncate"  # Otomatik kisitla (son N mesaji koru)
    SMART_SUMMARY = "smart_summary"  # Akilli ozet
    ERROR_RETRY = "error_retry"      # Hatada kisitla ve tekrar dene
    PRE_ESTIMATE = "pre_estimate"    # On tahmin kontrolu
```

### Yapilandirma

```python
@dataclass
class HistoryConfig:
    strategies: List[TruncateStrategy] = [TruncateStrategy.ERROR_RETRY]

    # Otomatik kisitlama
    max_messages: int = 30           # Maksimum mesaj sayisi
    max_chars: int = 150000          # Maksimum karakter (~50k token)

    # Akilli ozet
    summary_keep_recent: int = 10    # Tam tutulan son mesaj sayisi
    summary_threshold: int = 100000  # Ozet tetikleme esigi
    summary_max_length: int = 2000   # Maksimum ozet uzunlugu

    # Hata tekrar deneme
    retry_max_messages: int = 20     # Tekrar denemede tutulan mesaj
    max_retries: int = 2             # Maksimum tekrar sayisi

    # On tahmin
    estimate_threshold: int = 180000 # Tahmin esigi (karakter)
    chars_per_token: float = 3.0     # Token basina karakter

    # Ozet onbellegi
    summary_cache_enabled: bool = True
    summary_cache_min_delta_messages: int = 3
    summary_cache_max_age_seconds: int = 180
```

### Gecmis Dongusu Onarimi

```python
def fix_history_alternation(history: List[dict], model_id: str = "claude-sonnet-4"):
    """
    Gecmisi onar, user/assistant katı dongusu sagla

    Kiro API kurallari:
    1. Mesajlar katı donguyle olmali: user -> assistant -> user -> assistant
    2. assistant'in toolUses'i varsa, sonraki user'da toolResults olmali
    3. assistant'in toolUses'i yoksa, sonraki user'da toolResults olmamali
    """
    fixed = []

    for item in history:
        is_user = "userInputMessage" in item
        is_assistant = "assistantResponseMessage" in item

        if is_user:
            # Onceki de user ise, arada yer tutucu assistant ekle
            if fixed and "userInputMessage" in fixed[-1]:
                fixed.append({
                    "assistantResponseMessage": {
                        "content": "I understand."
                    }
                })

            # toolResults/toolUses eslesmesini dogrula
            # ...
            fixed.append(item)

        elif is_assistant:
            # Onceki de assistant ise, arada yer tutucu user ekle
            if fixed and "assistantResponseMessage" in fixed[-1]:
                fixed.append({
                    "userInputMessage": {
                        "content": "Continue",
                        "modelId": model_id,
                        "origin": "AI_EDITOR"
                    }
                })
            fixed.append(item)

    return fixed
```

## Arac Cagirma Destegi

### Arac Formati Donusumu

**Anthropic -> Kiro:**
```python
def convert_anthropic_tools_to_kiro(tools: List[dict]) -> List[dict]:
    kiro_tools = []
    for tool in tools:
        name = tool.get("name", "")

        # Ozel arac: web_search
        if name in ("web_search", "web_search_20250305"):
            kiro_tools.append({
                "webSearchTool": {"type": "web_search"}
            })
            continue

        # Arac sayisi siniri (maks 50)
        if len(kiro_tools) >= 50:
            continue

        kiro_tools.append({
            "toolSpecification": {
                "name": name,
                "description": truncate_description(tool.get("description", ""), 500),
                "inputSchema": {
                    "json": tool.get("input_schema", {"type": "object", "properties": {}})
                }
            }
        })

    return kiro_tools
```

**OpenAI -> Kiro:**
```python
def convert_openai_tools_to_kiro(tools: List[dict]) -> List[dict]:
    kiro_tools = []
    for tool in tools:
        if tool.get("type") == "web_search":
            kiro_tools.append({"webSearchTool": {"type": "web_search"}})
            continue

        if tool.get("type") != "function":
            continue

        func = tool.get("function", {})
        kiro_tools.append({
            "toolSpecification": {
                "name": func.get("name", ""),
                "description": truncate_description(func.get("description", ""), 500),
                "inputSchema": {
                    "json": func.get("parameters", {"type": "object", "properties": {}})
                }
            }
        })

    return kiro_tools
```

### Arac Cagirma Ozellikleri

| Ozellik              | Anthropic               | OpenAI                  | Gemini                   |
|----------------------|-------------------------|-------------------------|--------------------------|
| Arac Tanimi          | `tools`                 | `tools.function`        | `functionDeclarations`   |
| Arac Cagrisi Yaniti  | `tool_use`              | `tool_calls`            | `functionCall`           |
| Arac Sonuclari       | `tool_result`           | `tool` rol mesaji       | `functionResponse`       |
| Zorla Arac Cagir     | `tool_choice`           | `tool_choice`           | `toolConfig.mode`        |
| Arac Siniri          | 50                      | 50                      | 50                       |
| Resim Anlama         | Destekleniyor           | Destekleniyor           | Desteklenmiyor           |
| Web Arama            | Destekleniyor           | Destekleniyor           | Desteklenmiyor           |

## Yapilandirma

### Ortam Degiskenleri

KiroProxy ortam degiskenlerini dogrudan kullanmaz, bunun yerine yapilandirma dosyasini kullanir:

```python
TOKEN_PATH = Path.home() / ".aws/sso/cache/kiro-auth-token.json"
KIRO_API_URL = "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
MODELS_URL = "https://q.us-east-1.amazonaws.com/ListAvailableModels"
QUOTA_COOLDOWN_SECONDS = 300  # 5 dakika sogutma suresi
```

### CLI Kullanimi

```bash
# Hesap Yonetimi
python run.py accounts list              # Hesaplari listele
python run.py accounts export -o acc.json  # Hesaplari disari aktar
python run.py accounts import acc.json   # Hesaplari iceri aktar
python run.py accounts add               # Interaktif token ekleme
python run.py accounts scan --auto       # Yerel tokenları tara ve otomatik ekle

# Giris
python run.py login google               # Google girisi
python run.py login github               # GitHub girisi
python run.py login remote --host myserver.com:8080  # Uzak giris linki olustur

# Servis
python run.py serve                      # Servisi baslat (varsayilan 8080)
python run.py serve -p 8081              # Port belirt
python run.py status                     # Durum gor
```

## Yonetim API'leri

| Endpoint                         | Metod  | Aciklama                        |
|----------------------------------|--------|----------------------------------|
| `/api/accounts`                  | GET    | Tum hesap durumlarini al         |
| `/api/accounts/{id}`             | GET    | Hesap detaylarini al             |
| `/api/accounts/{id}/usage`       | GET    | Hesap kullanim bilgilerini al    |
| `/api/accounts/{id}/refresh`     | POST   | Hesap token'ini yenile           |
| `/api/accounts/{id}/restore`     | POST   | Hesabi geri yukle (sogutmadan)   |
| `/api/accounts/refresh-all`      | POST   | Suresi dolmak uzere tokenlari yenile |
| `/api/flows`                     | GET    | Istek kayitlarini al             |
| `/api/flows/stats`               | GET    | Istek istatistiklerini al        |
| `/api/quota`                     | GET    | Kota durumunu al                 |
| `/api/stats`                     | GET    | Istatistikleri al                |
| `/api/settings/history`          | GET    | Gecmis ayarlarini al             |
| `/api/settings/history`          | POST   | Gecmis ayarlarini guncelle       |
| `/api/settings/rate-limit`       | GET    | Hiz siniri ayarlarini al         |
| `/api/settings/rate-limit`       | POST   | Hiz siniri ayarlarini guncelle   |

## Sonuc

KiroProxy, Kiro IDE API'si icin kapsamli bir reverse proxy cozumu sunmaktadir. Temel ozellikleri:

1. **Coklu Protokol Destegi**: OpenAI, Anthropic ve Gemini protokollerini Kiro API'sine cevirir
2. **Coklu Kimlik Dogrulama**: Social Auth (Google/GitHub), AWS Builder ID ve IAM Identity Center destegi
3. **Akilli Hesap Yonetimi**: Otomatik yuk dengeleme, oturum yapiskanligi ve kota yonetimi
4. **Guvenilir Token Yonetimi**: Otomatik yenileme ve durum izleme
5. **Hata Direnci**: Otomatik tekrar deneme, hesap degistirme ve gecmis kisitlama
6. **Tam Arac Cagirma**: Uc protokol icin de tam arac destegi

Bu proje, Kiro IDE API'sini daha genis bir ekosistemde kullanilabilir hale getirmek icin tasarlanmistir.
