# Vertex AI Setup Guide

## Creating a Service Account in GCP Console

### Step 1: Access GCP Console

Visit https://console.cloud.google.com/

### Step 2: Create or Select a Project

1. Click the project selector at the top
2. Create a new project or select an existing one

### Step 3: Enable Vertex AI API

1. Go to APIs & Services > Library
2. Search for "Vertex AI API"
3. Click Enable

### Step 4: Create a Service Account

1. Go to IAM & Admin > Service Accounts
   - Direct link: https://console.cloud.google.com/iam-admin/serviceaccounts
2. Click + CREATE SERVICE ACCOUNT
3. Fill in the details:
   - Service account name: vertex-ai-client (custom name)
   - Service account ID: auto-generated
   - Click CREATE AND CONTINUE
4. Grant roles (important):
   - Click Select a role
   - Search and add: Vertex AI User (roles/aiplatform.user)
   - Click CONTINUE
5. Click DONE

### Step 5: Create and Download Key

1. In the service accounts list, click on the account you just created
2. Go to the KEYS tab
3. Click ADD KEY > Create new key
4. Select JSON format
5. Click CREATE
6. The browser will automatically download the JSON key file

### Step 6: Import to System

The downloaded JSON file content looks like:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "vertex-ai-client@your-project-id.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

Then import:

```bash
# Use the JSON file content as the keyJson parameter
curl -X POST 'http://localhost:13003/api/vertex/credentials/import' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-gcp-account",
    "region": "us-central1",
    "keyJson": <paste entire JSON file content>
  }'
```

## Important Notes

1. **Billing**: You need to enable a billing account in your GCP project
2. **Quotas**: Vertex AI has usage quota limits, check in IAM & Admin > Quotas
3. **Region**: Different regions may support different models, us-central1 is recommended
4. **Security**: The JSON key file contains a private key, keep it secure and do not expose it
