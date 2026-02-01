# Kiro Management API Feature Analysis

Bu dokuman, [kiro-management-api](https://github.com/DiscreteTom/kiro-management-api) projesindeki Kiro/Amazon Q abonelik yonetimi ozelliklerini analiz eder.

## Genel Bakis

Kiro Management API, AWS SigV4 kimlik dogrulamasi kullanarak Kiro (Amazon Q Developer) abonelik atamalari olusturmak ve kullanici aboneliklerini listelemek icin Python modulleri saglar.

| Ozellik        | Aciklama                           |
|----------------|------------------------------------|
| Platform       | Python 3.6+                        |
| Authentication | AWS SigV4 (IAM Credentials)        |
| Dependencies   | boto3, requests, botocore          |
| Use Case       | Enterprise subscription management |

---

## 1. Authentication

### 1.1 AWS SigV4 Authentication

```python
from boto3 import Session
from botocore.awsrequest import AWSRequest
from botocore.auth import SigV4Auth

session = Session()
credentials = session.get_credentials()

# Request'i imzala
SigV4Auth(credentials, service_name, region).add_auth(request)
```

### 1.2 Credential Sources

| Source             | Aciklama                                 |
|--------------------|------------------------------------------|
| aws configure      | CLI ile yapilandirilmis credentials      |
| IAM Roles          | EC2 instance role                        |
| Environment Vars   | AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY |
| Shared Credentials | ~/.aws/credentials dosyasi               |

### 1.3 Required IAM Permissions

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

## 2. Create Assignment API

### 2.1 Endpoint

```
POST https://codewhisperer.us-east-1.amazonaws.com/
```

### 2.2 Headers

```python
headers = {
    "Content-Type": "application/x-amz-json-1.0",
    "x-amz-target": "AmazonQDeveloperService.CreateAssignment"
}
```

### 2.3 Request Payload

```json
{
    "principalId": "12345678-1234-1234-1234-123456789abc",
    "principalType": "USER",
    "subscriptionType": "Q_DEVELOPER_STANDALONE_PRO"
}
```

### 2.4 Parameters

| Parameter         | Type   | Required | Default                      | Description                       |
|-------------------|--------|----------|------------------------------|-----------------------------------|
| principal_id      | string | Yes      | -                            | IAM Identity Center user/group ID |
| principal_type    | string | No       | "USER"                       | "USER" veya "GROUP"               |
| subscription_type | string | No       | "Q_DEVELOPER_STANDALONE_PRO" | Abonelik tipi                     |

### 2.5 Subscription Types

| Subscription Type               | Aciklama           |
|---------------------------------|--------------------|
| Q_DEVELOPER_STANDALONE_PRO      | Pro plan (default) |
| Q_DEVELOPER_STANDALONE_PRO_PLUS | Pro Plus plan      |
| Q_DEVELOPER_STANDALONE_POWER    | Power plan         |

### 2.6 Usage Example

```python
from create_assignment import create_assignment

# Bir kullaniciya Pro abonelik ata
response = create_assignment(
    principal_id="12345678-1234-1234-1234-123456789abc",
    principal_type="USER",
    subscription_type="Q_DEVELOPER_STANDALONE_PRO"
)

print(response.status_code)  # 200 = basarili
print(response.text)         # Response body
```

---

## 3. List User Subscriptions API

### 3.1 Endpoint

```
POST https://service.user-subscriptions.us-east-1.amazonaws.com/
```

### 3.2 Headers

```python
headers = {
    "Content-Type": "application/x-amz-json-1.0",
    "x-amz-target": "AWSZornControlPlaneService.ListUserSubscriptions"
}
```

### 3.3 Request Payload

```json
{
    "instanceArn": "arn:aws:sso:::instance/ssoins-1234567890abcdef",
    "maxResults": 1000,
    "subscriptionRegion": "us-east-1"
}
```

### 3.4 Parameters

| Parameter           | Type   | Required | Default     | Description                      |
|---------------------|--------|----------|-------------|----------------------------------|
| instance_arn        | string | Yes      | -           | IAM Identity Center instance ARN |
| max_results         | int    | No       | 1000        | Maksimum sonuc sayisi            |
| subscription_region | string | No       | "us-east-1" | Abonelik region'u                |

### 3.5 Service Names

| Service            | SigV4 Service Name | Region    |
|--------------------|--------------------|-----------|
| Q Developer        | q                  | us-east-1 |
| User Subscriptions | user-subscriptions | us-east-1 |

### 3.6 Usage Example

```python
from list_user_subscriptions import list_user_subscriptions

# IAM Identity Center instance'indaki abonelikleri listele
response = list_user_subscriptions(
    instance_arn="arn:aws:sso:::instance/ssoins-1234567890abcdef",
    max_results=100,
    subscription_region="us-east-1"
)

print(response.status_code)
print(response.json())
```

---

## 4. AWS Service Endpoints

### 4.1 CodeWhisperer / Q Developer

```
https://codewhisperer.us-east-1.amazonaws.com/
```

**Available Targets:**
- `AmazonQDeveloperService.CreateAssignment`

### 4.2 User Subscriptions Service

```
https://service.user-subscriptions.us-east-1.amazonaws.com/
```

**Available Targets:**
- `AWSZornControlPlaneService.ListUserSubscriptions`

---

## 5. Implementation Details

### 5.1 Request Flow

```
1. boto3.Session() ile AWS credentials al
2. AWSRequest olustur (method, url, data, headers)
3. SigV4Auth ile request'i imzala
4. requests.post() ile gonder
5. Response dondur
```

### 5.2 Code Structure

```python
def create_assignment(principal_id, principal_type="USER", subscription_type="Q_DEVELOPER_STANDALONE_PRO"):
    # 1. Session ve credentials
    session = boto3.Session()
    credentials = session.get_credentials()

    # 2. Payload
    payload = {
        "principalId": principal_id,
        "principalType": principal_type,
        "subscriptionType": subscription_type
    }

    # 3. AWS Request
    request = AWSRequest(
        method="POST",
        url="https://codewhisperer.us-east-1.amazonaws.com/",
        data=json.dumps(payload),
        headers={
            "Content-Type": "application/x-amz-json-1.0",
            "x-amz-target": "AmazonQDeveloperService.CreateAssignment",
        },
    )

    # 4. SigV4 imzalama
    SigV4Auth(credentials, "q", "us-east-1").add_auth(request)

    # 5. Request gonder
    response = requests.post(request.url, headers=dict(request.headers), data=request.body)

    return response
```

---

## 6. IAM Identity Center Integration

### 6.1 Principal Types

| Type  | Description                             |
|-------|-----------------------------------------|
| USER  | Tek bir IAM Identity Center kullanicisi |
| GROUP | IAM Identity Center kullanici grubu     |

### 6.2 Instance ARN Format

```
arn:aws:sso:::instance/ssoins-{instance_id}
```

**Ornek:**
```
arn:aws:sso:::instance/ssoins-1234567890abcdef
```

---

## 7. Error Handling

### 7.1 Expected Response Codes

| Status Code | Meaning            |
|-------------|--------------------|
| 200         | Basarili           |
| 400         | Invalid request    |
| 403         | Permission denied  |
| 404         | Resource not found |
| 500         | Server error       |

### 7.2 Common Errors

| Error                     | Cause                              |
|---------------------------|------------------------------------|
| AccessDeniedException     | IAM permissions eksik              |
| ValidationException       | Invalid parameter                  |
| ResourceNotFoundException | Principal veya instance bulunamadi |
| ThrottlingException       | Rate limit asildi                  |

---

## 8. Use Cases

### 8.1 Enterprise Subscription Management

```python
# Tum takima Pro abonelik ata
team_members = ["user-id-1", "user-id-2", "user-id-3"]

for user_id in team_members:
    response = create_assignment(
        principal_id=user_id,
        principal_type="USER",
        subscription_type="Q_DEVELOPER_STANDALONE_PRO"
    )
    print(f"User {user_id}: {response.status_code}")
```

### 8.2 Group Assignment

```python
# Tum gruba abonelik ata
response = create_assignment(
    principal_id="group-id-12345",
    principal_type="GROUP",
    subscription_type="Q_DEVELOPER_STANDALONE_PRO_PLUS"
)
```

### 8.3 Subscription Audit

```python
# Mevcut abonelikleri listele
response = list_user_subscriptions(
    instance_arn="arn:aws:sso:::instance/ssoins-1234567890abcdef"
)

subscriptions = response.json()
for sub in subscriptions.get("subscriptions", []):
    print(f"User: {sub['principalId']}, Type: {sub['subscriptionType']}")
```

---

## 9. Karsilastirma: Management API vs OAuth API

| Ozellik              | Management API (SigV4) | OAuth API (Bearer Token) |
|----------------------|------------------------|--------------------------|
| Authentication       | AWS IAM Credentials    | OAuth2 Access Token      |
| Use Case             | Enterprise management  | End-user API access      |
| Permissions          | IAM Policies           | OAuth Scopes             |
| Target Users         | Admins                 | Developers               |
| Subscription Control | Yes (create/list)      | No                       |
| Chat/Completions     | No                     | Yes                      |

---

## 10. Dosya Yapisi

```
kiro-management-api/
├── README.md                    # Dokumantasyon
├── create_assignment.py         # Abonelik atama modulu
└── list_user_subscriptions.py   # Abonelik listeleme modulu
```

---

## 11. Dependencies

```bash
pip install boto3 requests
```

| Package  | Purpose                                |
|----------|----------------------------------------|
| boto3    | AWS SDK, credentials ve SigV4          |
| requests | HTTP requests                          |
| botocore | AWS request signing (boto3 dependency) |

---

## 12. Sonuc

Kiro Management API, enterprise ortamlar icin tasarlanmis minimal bir Python kutuphanesidir:

1. **AWS SigV4 Authentication**: IAM credentials ile guvenli API erisimi
2. **Subscription Assignment**: Kullanici ve gruplara abonelik atama
3. **Subscription Listing**: Mevcut abonelikleri sorgulama
4. **IAM Identity Center**: SSO entegrasyonu

Bu API, Kiro/Amazon Q Developer aboneliklerini programatik olarak yonetmek isteyen IT adminleri ve DevOps muhendisleri icin kullanislidir. Ozellikle:

- Toplu kullanici onboarding
- Abonelik auditing
- Otomatik provisioning workflows
- Enterprise license management

**Not:** Bu API, end-user chat/completion API'lerinden farklidir. Sadece abonelik yonetimi icin kullanilir.
