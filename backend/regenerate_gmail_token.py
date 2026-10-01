"""
Run this script locally from buglerock-analytics/backend/ to regenerate gmail_token.json.
Requires: pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client

Usage:
    cd buglerock-analytics/backend
    python regenerate_gmail_token.py

IMPORTANT: Delete credentials/gmail_token.json first before running this script.
"""
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow
import json

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
]

CREDENTIALS_PATH = Path(__file__).parent / "credentials" / "gmail_credentials.json"
TOKEN_PATH       = Path(__file__).parent / "credentials" / "gmail_token.json"

def main():
    if not CREDENTIALS_PATH.exists():
        print(f"ERROR: gmail_credentials.json not found at {CREDENTIALS_PATH}")
        return

    # Delete old token to force fresh auth
    if TOKEN_PATH.exists():
        TOKEN_PATH.unlink()
        print("Deleted old token — starting fresh auth...")

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), SCOPES)
    creds = flow.run_local_server(port=0)

    TOKEN_PATH.write_text(creds.to_json())

    # Verify scopes
    token_data = json.loads(TOKEN_PATH.read_text())
    print(f"\n✅ Token saved to: {TOKEN_PATH}")
    print(f"   Scopes: {token_data.get('scopes', 'not found')}")

    if "https://www.googleapis.com/auth/gmail.send" in str(token_data.get("scopes", "")):
        print("   ✅ gmail.send scope confirmed")
    else:
        print("   ❌ gmail.send scope MISSING — something went wrong")

    print("\nNext steps:")
    print("1. Go to Render dashboard → your backend service")
    print("2. Environment → Secret Files")
    print("3. Update /etc/secrets/gmail_token.json with the contents of the new token file")
    print("4. Redeploy the service")

if __name__ == "__main__":
    main()