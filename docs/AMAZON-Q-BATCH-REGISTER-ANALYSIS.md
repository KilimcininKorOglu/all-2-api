# Amazon Q Developer Batch Register Feature Analysis

Bu dokuman, [amazon-q-developer-batch-register](https://github.com/DiscreteTom/amazon-q-developer-batch-register) projesindeki toplu kullanici kayit ve Amazon Q Developer abonelik ozelliklerini analiz eder.

## Genel Bakis

Amazon Q Developer Batch Register, CSV dosyasindan toplu kullanici olusturma ve otomatik Amazon Q Developer Pro aboneligi atama islemlerini gerceklestiren bir Python script setidir.

| Ozellik                | Aciklama                                              |
|------------------------|-------------------------------------------------------|
| Platform               | Python 3.6+                                           |
| Authentication         | AWS SigV4 (IAM Credentials)                           |
| Dependencies           | boto3, requests                                       |
| Use Case               | Enterprise bulk user onboarding                       |

> **Not:** Bu yontem artik onerilmiyor. Kiro icin dogrudan [enterprise billing](https://kiro.dev/enterprise/) kullanilmasi tavsiye ediliyor.

---

## 1. Workflow

```
CSV Dosyasi
    │
    ▼
┌─────────────────────────────────────┐
│  1. CSV Parsing & Validation        │
│     - Required fields check         │
│     - Username validation           │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  2. IAM Identity Center User Create │
│     - boto3 identitystore client    │
│     - CreateUser API                │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  3. Amazon Q Developer Subscribe    │
│     - SigV4 signed request          │
│     - CreateAssignment API          │
└─────────────────────────────────────┘
    │
    ▼
Summary Report
```

---

## 2. CSV File Format

### 2.1 Required Header

```csv
email,username,display_name,given_name,family_name
```

### 2.2 Example Content

```csv
email,username,display_name,given_name,family_name
john.doe@example.com,johndoe,John Doe,John,Doe
jane.smith@example.com,janesmith,Jane Smith,Jane,Smith
bob.wilson@example.com,bobwilson,Bob Wilson,Bob,Wilson
```

### 2.3 Field Requirements

| Field        | Type   | Max Length | Restrictions                              |
|--------------|--------|------------|-------------------------------------------|
| email        | string | -          | Valid email format, primary work email    |
| username     | string | 128 chars  | Cannot be `Administrator` or `AWSAdministrators` |
| display_name | string | -          | User's display name                       |
| given_name   | string | -          | First name (required by IAM IdC)          |
| family_name  | string | -          | Last name (required by IAM IdC)           |

---

## 3. IAM Identity Center User Creation

### 3.1 API Call

```python
response = client.create_user(
    IdentityStoreId=identity_store_id,
    UserName=username,
    DisplayName=display_name,
    Name={
        "GivenName": given_name,
        "FamilyName": family_name
    },
    Emails=[{
        "Value": email,
        "Type": "Work",
        "Primary": True
    }]
)

user_id = response.get("UserId")
```

### 3.2 Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "identitystore:CreateUser",
        "identitystore:ListUsers"
      ],
      "Resource": "*"
    }
  ]
}
```

### 3.3 Error Handling

| Error Code             | Description                           | Action                    |
|------------------------|---------------------------------------|---------------------------|
| ConflictException      | Kullanici zaten mevcut                | Skip user                 |
| ValidationException    | Gecersiz parametre                    | Log and skip              |
| AccessDeniedException  | IAM yetkisi yok                       | Check permissions         |
| ResourceNotFoundException | Identity store bulunamadi          | Check identity_store_id   |

---

## 4. Amazon Q Developer Subscription

### 4.1 Endpoint

```
POST https://codewhisperer.us-east-1.amazonaws.com/
```

### 4.2 Headers

```python
headers = {
    "Content-Type": "application/x-amz-json-1.0",
    "X-Amz-Target": "AmazonQDeveloperService.CreateAssignment",
    "X-Amz-User-Agent": "aws-sdk-js/2.1594.0 promise"
}
```

### 4.3 Request Payload

```json
{
    "principalId": "user-id-from-identity-center",
    "principalType": "USER"
}
```

### 4.4 SigV4 Authentication

```python
from botocore.awsrequest import AWSRequest
from botocore.auth import SigV4Auth

session = boto3.Session()
credentials = session.get_credentials()

request = AWSRequest(
    method="POST",
    url="https://codewhisperer.us-east-1.amazonaws.com/",
    data=json.dumps(payload),
    headers=headers
)

# Service name: "q", Region: "us-east-1"
SigV4Auth(credentials, "q", "us-east-1").add_auth(request)
```

### 4.5 Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "q:CreateAssignment"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 5. Usage

### 5.1 Command Line

```bash
python3 main.py <csv_file> <identity_store_id>
```

### 5.2 Example

```bash
python3 main.py sample_users.csv d-123123123
```

### 5.3 Parameters

| Parameter         | Description                          | Example          |
|-------------------|--------------------------------------|------------------|
| csv_file          | CSV dosyasi yolu                     | users.csv        |
| identity_store_id | IAM Identity Center Identity Store ID| d-123123123      |

---

## 6. Output Example

```
IAM Identity Center Bulk User Creation Script (boto3)
===================================================
CSV File: sample_users.csv
Identity Store ID: d-123123123

Found 3 valid users to create

[1/3] Creating user: johndoe (John Doe)
✅ Successfully created user: johndoe (ID: 12345678-1234-1234-1234-123456789abc)
  Subscribing user johndoe to Amazon Q Developer...
  ✅ Successfully subscribed user: johndoe

[2/3] Creating user: janesmith (Jane Smith)
✅ Successfully created user: janesmith (ID: 87654321-4321-4321-4321-cba987654321)
  Subscribing user janesmith to Amazon Q Developer...
  ✅ Successfully subscribed user: janesmith

[3/3] Creating user: bobwilson (Bob Wilson)
❌ User already exists: bobwilson

===================================================
Bulk User Creation and Subscription Summary
===================================================
Total users processed: 3
Successfully created: 2
Failed to create: 1
Successfully subscribed: 2
Failed to subscribe: 1

⚠️  Some operations failed. Please check the errors above.

Failed user creations:
  - bobwilson: ❌ User already exists: bobwilson
```

---

## 7. Prerequisites

### 7.1 AWS Configuration

```bash
# Option 1: AWS CLI
aws configure

# Option 2: Environment Variables
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1

# Option 3: IAM Role (EC2)
# Automatic via instance metadata
```

### 7.2 Email OTP Configuration

IAM Identity Center'da "Send email OTP" ayari etkinlestirilmeli. Bu, API ile olusturulan kullanicilarin parola kurulum e-postalari almasini saglar.

**Adimlar:**
1. AWS Console → IAM Identity Center
2. Settings → Authentication
3. "Send email OTP for users created..." seceenegini etkinlestir

---

## 8. File Structure

```
amazon-q-developer-batch-register/
├── README.md           # Dokumantasyon
├── requirements.txt    # Python dependencies
├── main.py             # Ana script (CSV okuma, orkestrasyon)
├── create_user.py      # IAM Identity Center kullanici olusturma
└── subscribe.py        # Amazon Q Developer abonelik atama
```

---

## 9. Code Details

### 9.1 main.py - CSV Parsing

```python
def read_users_from_csv(csv_file: str) -> List[Dict[str, str]]:
    users = []
    with open(csv_file, "r", newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        for row_num, row in enumerate(reader, start=2):
            user_data = {key: value.strip() for key, value in row.items()}

            # Skip empty rows
            if not any(user_data.values()):
                continue

            # Validate required fields
            missing_fields = [key for key, value in user_data.items() if not value]
            if missing_fields:
                print(f"❌ Skipping row {row_num} with missing fields: {missing_fields}")
                continue

            # Username validation
            if user_data["username"].lower() in ["administrator", "awsadministrators"]:
                print(f"❌ Username '{user_data['username']}' is reserved")
                continue

            if len(user_data["username"]) > 128:
                print(f"❌ Username exceeds 128 characters")
                continue

            users.append(user_data)
    return users
```

### 9.2 create_user.py - User Creation

```python
def create_user(client, user_data, identity_store_id) -> Tuple[bool, str, Optional[str]]:
    try:
        response = client.create_user(
            IdentityStoreId=identity_store_id,
            UserName=user_data["username"],
            DisplayName=user_data["display_name"],
            Name={
                "GivenName": user_data["given_name"],
                "FamilyName": user_data["family_name"]
            },
            Emails=[{
                "Value": user_data["email"],
                "Type": "Work",
                "Primary": True
            }]
        )
        user_id = response.get("UserId")
        return True, f"Successfully created user", user_id

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        # Handle specific errors...
        return False, error_message, None
```

### 9.3 subscribe.py - Q Developer Subscription

```python
def subscribe(principal_id, principal_type="USER"):
    session = boto3.Session()
    credentials = session.get_credentials()

    payload = {
        "principalId": principal_id,
        "principalType": principal_type
    }

    request = AWSRequest(
        method="POST",
        url="https://codewhisperer.us-east-1.amazonaws.com/",
        data=json.dumps(payload),
        headers={
            "Content-Type": "application/x-amz-json-1.0",
            "X-Amz-Target": "AmazonQDeveloperService.CreateAssignment",
            "X-Amz-User-Agent": "aws-sdk-js/2.1594.0 promise"
        }
    )

    SigV4Auth(credentials, "q", "us-east-1").add_auth(request)
    response = requests.post(request.url, headers=dict(request.headers), data=request.body)
    return response
```

---

## 10. Installation

```bash
# Clone repository
git clone https://github.com/DiscreteTom/amazon-q-developer-batch-register.git
cd amazon-q-developer-batch-register

# Install dependencies
pip install -r requirements.txt
# or
pip install boto3 requests

# Configure AWS credentials
aws configure

# Run
python3 main.py users.csv d-123456789
```

---

## 11. Karsilastirma: Batch Register vs Management API

| Ozellik                 | Batch Register           | Management API            |
|-------------------------|--------------------------|---------------------------|
| User Creation           | Yes (IAM Identity Center)| No                        |
| Subscription Assignment | Yes                      | Yes                       |
| List Subscriptions      | No                       | Yes                       |
| Input Format            | CSV file                 | Python function call      |
| Bulk Processing         | Built-in                 | Manual loop required      |
| Progress Tracking       | Console output           | Return value              |
| Error Recovery          | Skip and continue        | Exception handling        |

---

## 12. Sonuc

Amazon Q Developer Batch Register, enterprise ortamlar icin tasarlanmis pratik bir bulk user onboarding aracidir:

1. **CSV-based Input**: Kolayca hazirlanabilir kullanici listesi
2. **IAM Identity Center Integration**: Kullanici olusturma + abonelik atama
3. **SigV4 Authentication**: Guvenli AWS API erisimi
4. **Error Handling**: Detayli hata raporlama ve kurtarma
5. **Progress Tracking**: Islem durumu ve ozet rapor

**Kullanim Senaryolari:**
- Yeni ekip uyeleri onboarding
- Departman bazli toplu kayit
- Enterprise lisans yonetimi
- Otomatik provisioning workflows

**Not:** Bu arac artik aktif olarak onerilmiyor. Kiro icin dogrudan enterprise billing kullanilmasi tavsiye ediliyor.
