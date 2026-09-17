# check_users.py
# Run from project root: python check_users.py

import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

from models.database import SessionLocal
from auth.models.auth_models import User

db = SessionLocal()
users = db.query(User).all()

print(f"\n{'─'*80}")
print(f"{'Name':<20} {'Email':<35} {'Role':<8} {'Password':<10} {'Active'}")
print(f"{'─'*80}")
for u in users:
    print(f"{u.name:<20} {u.email:<35} {u.role.value:<8} {'✅ Set' if u.password_set else '⏳ Pending':<10} {'✅' if u.is_active else '❌'}")
print(f"{'─'*80}\n")

db.close()