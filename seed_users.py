# seed_users.py
# Run once to create all FundIQ users and send setup emails
# Usage: python seed_users.py
# Run from project root with environment variables set

import os
import sys

# ── Load .env from backend folder ─────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'))

# ── Add backend to path ────────────────────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from auth.models.auth_models import Base, User, UserRole, SetupToken
from auth.services.auth_service import create_setup_token, send_setup_email

DATABASE_URL = os.environ["DATABASE_URL"]
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://fundiq.buglerock.asia")

engine       = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

# ── Create tables ─────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)
print("✅ Tables created")

# ── User list ─────────────────────────────────────────────────────────────────
USERS = [
    # (name, email, role, is_service_account)
    ("BR Analytics",     "analytics@buglerock.asia",  "admin", True),   # service account — no email
    ("Tejas Singh",      "tejas.s@buglerock.asia",    "admin", False),
    ("Divyansh Agarwal", "divyansh.a@buglerock.asia", "user",  False),
    ("Sujaya Lakshmi",   "sujaya.l@buglerock.asia",   "user",  False),
    # ("Arjun Prasanna",   "arjun.p@buglerock.asia",    "user",  False),
    # ("Pranav Shenoy",    "pranav.s@buglerock.asia",   "user",  False),
    # ("Ishwar Raj",       "ishwar.r@buglerock.asia",   "user",  False),
]

db = SessionLocal()

created     = 0
skipped     = 0
emails_sent = 0

for name, email, role, is_service in USERS:
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        print(f"⏭️  Skipping {email} — already exists")
        skipped += 1
        continue

    user = User(
        email              = email,
        name               = name,
        role               = UserRole(role),
        is_active          = True,
        is_service_account = is_service,
        password_set       = is_service,
    )
    db.add(user)
    db.flush()

    if not is_service:
        setup_token = create_setup_token(db, user)
        try:
            send_setup_email(user, setup_token, FRONTEND_URL)
            print(f"✅ Created {name} ({email}) — setup email sent")
            emails_sent += 1
        except Exception as e:
            print(f"⚠️  Created {name} ({email}) — email FAILED: {e}")
    else:
        print(f"✅ Created {name} ({email}) — service account, no email sent")

    created += 1

db.commit()
db.close()

print(f"\n{'─'*50}")
print(f"✅ Created:     {created} users")
print(f"📧 Emails sent: {emails_sent}")
print(f"⏭️  Skipped:    {skipped} (already existed)")
print(f"{'─'*50}")
print("\nDone. Users will receive setup emails and can set their passwords.")