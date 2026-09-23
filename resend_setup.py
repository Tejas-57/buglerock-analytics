# resend_setup.py
# Run from project root: python resend_setup.py

import os
import sys
from dotenv import load_dotenv
import ssl
ssl._create_default_https_context = ssl._create_unverified_context

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

from models.database import SessionLocal
from auth.models.auth_models import User
from auth.services.auth_service import create_setup_token, send_setup_email

FRONTEND_URL = "https://fundiq.buglerock.asia"
EMAIL        = "sujaya.l@buglerock.asia"

db   = SessionLocal()
user = db.query(User).filter(User.email == EMAIL).first()

if not user:
    print(f"❌ User {EMAIL} not found")
else:
    token = create_setup_token(db, user)
    send_setup_email(user, token, FRONTEND_URL)
    print(f"✅ Setup email sent to {user.email}")

db.close()