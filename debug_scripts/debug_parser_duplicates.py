"""
debug_parser_duplicates.py

Parse the LATEST Morningstar Excel directly from Gmail (no DB save) and check
whether the parser itself is producing duplicate rows.

  cd buglerock-analytics/backend
  python ..\\debug_scripts\\debug_parser_duplicates.py

If duplicates appear in the raw parse output → parser bug
If NOT → the save logic is running multiple times concurrently
"""

import os
import sys
from pathlib import Path
from collections import Counter

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
    import tempfile
    import base64
    from datetime import date, timedelta

    from services.gmail_watcher import get_gmail_service, GMAIL_SENDER, SUBJECT_KEYWORD
    from services.parser import parse_excel_file

    print("Fetching latest Morningstar email from Gmail...")
    service = get_gmail_service()

    # Find latest email
    result = service.users().messages().list(
        userId="me",
        q=f"from:{GMAIL_SENDER} subject:{SUBJECT_KEYWORD} has:attachment",
        maxResults=1,
    ).execute()
    messages = result.get("messages", [])
    if not messages:
        print("No Morningstar emails found.")
        return

    msg_id = messages[0]["id"]
    msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()

    # Download attachment
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
    print(f"Downloaded: {fname} ({len(xlsx_bytes):,} bytes)\n")

    # Save to temp file and parse
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.write(xlsx_bytes)
    tmp.close()

    try:
        parsed = parse_excel_file(
            file_path=tmp.name,
            data_date="2026-08-12",
            email_date="2026-08-12",
            file_name=fname,
        )
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass

    funds = parsed.get("funds", [])
    print(f"Parser output: {len(funds)} fund rows")

    # Count ISIN occurrences
    isin_counts = Counter(f.get("isin") for f in funds if f.get("isin"))
    distinct = len(isin_counts)
    dupes = {isin: n for isin, n in isin_counts.items() if n > 1}

    print(f"Distinct ISINs: {distinct}")
    print(f"ISINs appearing more than once: {len(dupes)}")

    if not dupes:
        print("\n✓ Parser output is clean — no duplicates in a single parse run.")
        print("  → The 4x duplication in DB comes from the save logic being called multiple times.")
        return

    print("\n⚠ Parser output has duplicates. Root cause is in the parser itself.")
    print("\nTop duplicated ISINs and their sheet_name + category values:\n")

    # Group duplicates by isin and show what's different
    by_isin = {}
    for f in funds:
        isin = f.get("isin")
        if isin in dupes:
            by_isin.setdefault(isin, []).append(f)

    # Show first 5 duplicated ISINs in detail
    for isin, rows in list(by_isin.items())[:5]:
        print(f"ISIN: {isin} — appears {len(rows)} times")
        for i, r in enumerate(rows, 1):
            print(f"  [{i}] name={r.get('name')}  sheet={r.get('sheet_name')}  "
                  f"category={r.get('category')}  raw_cat={r.get('raw_category')}  "
                  f"asset_class={r.get('asset_class')}")
        print()

    # Summarise dupe counts
    count_dist = Counter(dupes.values())
    print("Duplication frequency histogram:")
    for n, count in sorted(count_dist.items()):
        print(f"  {count} ISINs appear exactly {n} times each")


if __name__ == "__main__":
    main()