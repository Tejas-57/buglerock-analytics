"""
generate_gmail_token.py
Run this ONCE locally to generate gmail_token.json for analytics@buglerock.asia.

Steps:
  1. Make sure backend/credentials/gmail_credentials.json is the NEW one
     downloaded from the new BugleRock Analytics project under analytics@buglerock.asia
  2. Run: python generate_gmail_token.py
  3. Browser opens → sign in with analytics@buglerock.asia → Allow
  4. Token saved to backend/credentials/gmail_token.json
  5. Upload both files to Render secrets
"""

import json
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
]

CREDENTIALS_PATH = "credentials/gmail_credentials.json"
TOKEN_PATH = "credentials/gmail_token.json"

def main():
    if not Path(CREDENTIALS_PATH).exists():
        print(f"ERROR: {CREDENTIALS_PATH} not found.")
        print("Make sure you've placed the new credentials.json from the")
        print("BugleRock Analytics project (analytics@buglerock.asia) in backend/credentials/")
        return

    print("Starting OAuth flow...")
    print("A browser window will open — sign in with analytics@buglerock.asia")
    print()

    flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
    creds = flow.run_local_server(port=0)

    # Save token
    token_data = json.loads(creds.to_json())
    Path(TOKEN_PATH).write_text(json.dumps(token_data, indent=2))

    print()
    print(f"✅ Token saved to {TOKEN_PATH}")
    print()
    print("Next steps:")
    print("  1. Go to Render → buglerock-backend → Secret Files")
    print("  2. Upload credentials/gmail_credentials.json as /etc/secrets/gmail_credentials.json")
    print("  3. Upload credentials/gmail_token.json as /etc/secrets/gmail_token.json")
    print("  4. Redeploy the backend")
    print()
    print("Also add to Render environment variables:")
    print("  GOOGLE_SERVICE_ACCOUNT_JSON = <contents of credentials/sheets_credentials.json>")
    print("  BENCHMARK_SHEET_ID = 1g_-yQIVu4Ror0BgBhW2Pex3Fj3uP_0meZHrpwJQ5qWA")

if __name__ == "__main__":
    main()