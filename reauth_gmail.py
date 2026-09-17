# reauth_gmail.py
# Run from project root: python reauth_gmail.py

import os
import sys
import ssl
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

# Disable SSL verification globally — same fix as rest of project
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
ssl._create_default_https_context = ssl._create_unverified_context

from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow
from services.gmail_watcher import _save_token_json

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]

CREDENTIALS_PATH = (
    "/etc/secrets/gmail_credentials.json"
    if Path("/etc/secrets/gmail_credentials.json").exists()
    else "backend/credentials/gmail_credentials.json"
)

print("Opening browser for Gmail authorisation...")
print("Log in as: analytics@buglerock.asia")
print()

flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
creds = flow.run_local_server(port=0)

_save_token_json(creds.to_json())
print("✅ New token saved with send scope.")