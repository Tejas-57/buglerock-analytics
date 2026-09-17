# backend/auth/services/auth_service.py

import os
import secrets
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from auth.models.auth_models import User, RefreshToken, OTPCode, SetupToken

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY         = os.environ["JWT_SECRET_KEY"]
ALGORITHM          = "HS256"
ACCESS_TOKEN_MINS  = 8 * 60
REFRESH_TOKEN_DAYS = 30
OTP_EXPIRY_MINS    = 10
SETUP_TOKEN_HOURS  = 24

GMAIL_SENDER = os.environ.get("GMAIL_SENDER", "analytics@buglerock.asia")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── Password hashing ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT access token ──────────────────────────────────────────────────────────

def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINS)
    payload = {
        "sub":   str(user.id),
        "email": user.email,
        "name":  user.name,
        "role":  user.role.value,
        "exp":   expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ── Refresh token ─────────────────────────────────────────────────────────────

def create_refresh_token(db: Session, user: User, device_hint: str = None) -> str:
    token_str  = secrets.token_urlsafe(64)
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)

    rt = RefreshToken(
        user_id     = user.id,
        token       = token_str,
        device_hint = device_hint,
        expires_at  = expires_at,
    )
    db.add(rt)
    db.commit()
    return token_str

def rotate_refresh_token(db: Session, old_token_str: str):
    rt = db.query(RefreshToken).filter(
        RefreshToken.token   == old_token_str,
        RefreshToken.revoked == False,
    ).first()

    if not rt:
        raise ValueError("Invalid refresh token")
    if rt.expires_at < datetime.now(timezone.utc):
        raise ValueError("Refresh token expired")

    user = rt.user
    if not user.is_active:
        raise ValueError("Account deactivated")

    rt.revoked   = True
    rt.last_used = datetime.now(timezone.utc)
    db.commit()

    new_token = create_refresh_token(db, user, rt.device_hint)
    return user, new_token

def revoke_user_tokens(db: Session, user_id: str):
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked == False,
    ).update({"revoked": True})
    db.commit()


# ── OTP ───────────────────────────────────────────────────────────────────────

def generate_otp(db: Session, user: User) -> str:
    db.query(OTPCode).filter(OTPCode.user_id == user.id).update({"used": True})
    db.commit()

    code       = "".join(random.choices(string.digits, k=6))
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINS)

    otp = OTPCode(user_id=user.id, code=code, expires_at=expires_at)
    db.add(otp)
    db.commit()
    return code

def verify_otp(db: Session, user: User, code: str) -> bool:
    otp = db.query(OTPCode).filter(
        OTPCode.user_id == user.id,
        OTPCode.code    == code,
        OTPCode.used    == False,
    ).first()

    if not otp:
        return False
    if otp.expires_at < datetime.now(timezone.utc):
        return False

    otp.used = True
    db.commit()
    return True


# ── Setup token ───────────────────────────────────────────────────────────────

def create_setup_token(db: Session, user: User) -> str:
    db.query(SetupToken).filter(SetupToken.user_id == user.id).update({"used": True})
    db.commit()

    token_str  = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=SETUP_TOKEN_HOURS)

    st = SetupToken(user_id=user.id, token=token_str, expires_at=expires_at)
    db.add(st)
    db.commit()
    return token_str

def verify_setup_token(db: Session, token_str: str) -> Optional[User]:
    st = db.query(SetupToken).filter(
        SetupToken.token == token_str,
        SetupToken.used  == False,
    ).first()

    if not st:
        return None
    if st.expires_at < datetime.now(timezone.utc):
        return None

    st.used = True
    db.commit()
    return st.user


# ── Email via Gmail API ───────────────────────────────────────────────────────

def _get_gmail_service():
    creds = Credentials(
        token         = os.environ.get("GMAIL_ACCESS_TOKEN"),
        refresh_token = os.environ.get("GMAIL_REFRESH_TOKEN"),
        token_uri     = "https://oauth2.googleapis.com/token",
        client_id     = os.environ.get("GMAIL_CLIENT_ID"),
        client_secret = os.environ.get("GMAIL_CLIENT_SECRET"),
        scopes        = ["https://www.googleapis.com/auth/gmail.send"],
    )
    return build("gmail", "v1", credentials=creds)

def _send_email(to: str, subject: str, html_body: str):
    service = _get_gmail_service()
    msg = MIMEMultipart("alternative")
    msg["From"]    = GMAIL_SENDER
    msg["To"]      = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId="me", body={"raw": raw}).execute()


def send_setup_email(user: User, setup_token: str, frontend_url: str):
    setup_link = f"{frontend_url}/setup-password?token={setup_token}"
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#912F63;">Set up your FundIQ account</h2>
      <p>Hi {user.name.split()[0]},</p>
      <p>Your FundIQ account is ready. Click below to set your password and get started.</p>
      <a href="{setup_link}"
         style="display:inline-block;background:#912F63;color:white;padding:12px 24px;
                border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0;">
        Set up my account
      </a>
      <p style="color:#888;font-size:13px;">This link expires in 24 hours.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
      <p style="color:#aaa;font-size:12px;">BugleRock Capital · analytics@buglerock.asia</p>
    </div>
    """
    _send_email(user.email, "Set up your FundIQ account", html)


def send_otp_email(user: User, otp_code: str):
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#912F63;">Your FundIQ OTP</h2>
      <p>Hi {user.name.split()[0]},</p>
      <p>Use the code below to reset your password. Expires in <strong>10 minutes</strong>.</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:8px;
                  color:#3E3452;margin:24px 0;text-align:center;">
        {otp_code}
      </div>
      <p style="color:#888;font-size:13px;">If you didn't request this, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
      <p style="color:#aaa;font-size:12px;">BugleRock Capital · analytics@buglerock.asia</p>
    </div>
    """
    _send_email(user.email, "Your FundIQ OTP", html)
