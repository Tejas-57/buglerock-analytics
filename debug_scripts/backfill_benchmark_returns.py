"""
backfill_benchmark_returns.py

Computes and stores benchmark returns for a given date using the period dates
from the Morningstar Excel already in Gmail.

  cd buglerock-analytics\\backend
  python ..\\debug_scripts\\backfill_benchmark_returns.py 2026-08-12
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
    target_date = sys.argv[1] if len(sys.argv) > 1 else "2026-08-12"
    print(f"Backfilling benchmark returns for {target_date}...")

    from services.gmail_watcher import get_gmail_service, GMAIL_SENDER, SUBJECT_KEYWORD
    from services.parser import parse_excel_file
    from services.benchmark_db_service import compute_and_store_benchmark_returns

    service = get_gmail_service()

    # Search for the email for this date
    from datetime import datetime, timedelta
    d = datetime.strptime(target_date, "%Y-%m-%d")
    after  = (d - timedelta(days=1)).strftime("%Y/%m/%d")
    before = (d + timedelta(days=2)).strftime("%Y/%m/%d")
    q = f"from:{GMAIL_SENDER} subject:{SUBJECT_KEYWORD} has:attachment after:{after} before:{before}"
    result = service.users().messages().list(userId="me", q=q, maxResults=5).execute()
    messages = result.get("messages", [])

    if not messages:
        print(f"No email found for {target_date}. Try adjacent date.")
        return

    print(f"Found {len(messages)} email(s). Using first.")
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
        print("No .xlsx attachment found.")
        return

    fname, xlsx_bytes = result
    print(f"Downloaded: {fname} ({len(xlsx_bytes):,} bytes)")

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.write(xlsx_bytes)
    tmp.close()

    try:
        parsed = parse_excel_file(tmp.name, target_date, target_date, fname)
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass

    period_dates = parsed.get("period_dates", {})
    print(f"Period dates extracted: {len(period_dates)}")
    for field, dates in sorted(period_dates.items()):
        print(f"  {field:<20} {dates['start']} → {dates['end']}")

    if not period_dates:
        print("No period dates found — check parser.")
        return

    print(f"\nComputing returns for all indices...")
    result = compute_and_store_benchmark_returns(period_dates, target_date)
    print(f"Done: {result}")


if __name__ == "__main__":
    main()