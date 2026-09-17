# update_gmail_token.py
# Run from project root: python update_gmail_token.py
# Forces the new gmail token (with send scope) from file into DB

import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

from services.gmail_watcher import store_token_from_file, TOKEN_FILE_PATH

print(f"Loading token from: {TOKEN_FILE_PATH}")
result = store_token_from_file()
if result:
    print("✅ Token updated in DB with send scope")
else:
    print("❌ Failed to update token")