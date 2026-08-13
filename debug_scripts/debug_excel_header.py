"""
debug_excel_header.py

Prints the first 5 rows of the Equity sheet from the latest Morningstar Excel
so we can see exactly where period dates live.

  cd buglerock-analytics\\backend
  python ..\\debug_scripts\\debug_excel_header.py
"""

import sys
import base64
import tempfile
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

try:
    from dotenv import load_dotenv
    backend_env = BACKEND_DIR / ".env"
    if backend_env.exists():
        load_dotenv(backend_env)
    else:
        load_dotenv()
except ImportError:
    pass


def main():
    from services.gmail_watcher import get_gmail_service, GMAIL_SENDER, SUBJECT_KEYWORD
    from openpyxl import load_workbook

    print("Fetching latest Morningstar Excel from Gmail...")
    service = get_gmail_service()
    result = service.users().messages().list(
        userId="me",
        q=f"from:{GMAIL_SENDER} subject:{SUBJECT_KEYWORD} has:attachment",
        maxResults=1,
    ).execute()
    messages = result.get("messages", [])
    if not messages:
        print("No emails found.")
        return

    msg_id = messages[0]["id"]
    msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()

    def find_xlsx(parts):
        for part in parts:
            fname = part.get("filename", "")
            if fname.lower().endswith(".xlsx"):
                body = part.get("body", {})
                att_id = body.get("attachmentId")
                data = body.get("data")
                if att_id:
                    att = service.users().messages().attachments().get(
                        userId="me", messageId=msg_id, id=att_id
                    ).execute()
                    data = att.get("data", "")
                if data:
                    return fname, base64.urlsafe_b64decode(data)
            sub = part.get("parts", [])
            if sub:
                r = find_xlsx(sub)
                if r:
                    return r
        return None

    payload = msg.get("payload", {})
    result = find_xlsx(payload.get("parts", []))
    if not result:
        print("No .xlsx found.")
        return

    fname, xlsx_bytes = result
    print(f"Downloaded: {fname}\n")

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.write(xlsx_bytes)
    tmp.close()

    try:
        wb = load_workbook(tmp.name, read_only=True, data_only=True)
        sheet_name = "Equity"
        actual = next((s for s in wb.sheetnames if s.strip() == sheet_name), None)
        if not actual:
            print(f"Sheet '{sheet_name}' not found. Available: {wb.sheetnames}")
            return

        ws = wb[actual]
        rows = list(ws.iter_rows(values_only=True))

        print(f"First 6 rows of '{sheet_name}' sheet:")
        print("=" * 120)
        for i, row in enumerate(rows[:6]):
            print(f"\nROW {i}:")
            for j, val in enumerate(row):
                if val is not None and str(val).strip() not in ("", "None"):
                    print(f"  col[{j:>3}] = {repr(val)}")
    finally:
        os.unlink(tmp.name)


if __name__ == "__main__":
    main()