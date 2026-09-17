# reauth_gmail.py
# Run from project root: python reauth_gmail.py

import os
import sys
import ssl
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

# Disable SSL verification globally
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
ssl._create_default_https_context = ssl._create_unverified_context

from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]

CREDENTIALS_PATH = "backend/credentials/gmail_credentials.json"
TOKEN_PATH       = "backend/credentials/gmail_token.json"

print("Opening browser for Gmail authorisation...")
print("Log in as: analytics@buglerock.asia")
print()

flow  = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
creds = flow.run_local_server(port=0)

# Save directly to file
Path(TOKEN_PATH).write_text(creds.to_json())
print(f"✅ Token saved to {TOKEN_PATH}")
print(f"   Scopes: {creds.scopes}")

# Also update DB
from services.gmail_watcher import _save_token_json
_save_token_json(creds.to_json())
print("✅ Token also updated in DB")