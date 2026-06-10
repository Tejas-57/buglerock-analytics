from google_auth_oauthlib.flow import InstalledAppFlow
import json

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
flow = InstalledAppFlow.from_client_secrets_file('credentials/gmail_credentials.json', SCOPES)
creds = flow.run_local_server(port=0)

token_data = json.loads(creds.to_json())
print(json.dumps(token_data, indent=2))

# Also save to file automatically
with open('credentials/gmail_token.json', 'w') as f:
    json.dump(token_data, f, indent=2)

print("\n✓ Token saved to credentials/gmail_token.json")