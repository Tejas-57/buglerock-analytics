# backend/auth/routers/auth.py

import os
from datetime import timedelta, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from models.database import get_db
from auth.models.auth_models import User
from auth.services.auth_service import (
    verify_password, hash_password,
    create_access_token, create_refresh_token, rotate_refresh_token, revoke_user_tokens,
    generate_otp, verify_otp,
    create_setup_token, verify_setup_token,
    send_setup_email, send_otp_email,
)
from auth.middleware.auth_middleware import get_current_user, require_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])

FRONTEND_URL       = os.environ.get("FRONTEND_URL", "https://buglerock-analytics.vercel.app")
COOKIE_SECURE      = os.environ.get("ENV", "production") == "production"
REFRESH_TOKEN_DAYS = 30


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

class SetupPasswordRequest(BaseModel):
    token: str
    password: str

class VerifySetupTokenRequest(BaseModel):
    token: str


# ── Helper: set cookies ───────────────────────────────────────────────────────

def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    response.set_cookie(
        key      = "access_token",
        value    = access_token,
        httponly = True,
        secure   = COOKIE_SECURE,
        samesite = "lax",
        max_age  = 8 * 60 * 60,
    )
    response.set_cookie(
        key      = "refresh_token",
        value    = refresh_token,
        httponly = True,
        secure   = COOKIE_SECURE,
        samesite = "lax",
        max_age  = REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        path     = "/api/auth/refresh",
    )


# ── POST /api/auth/login ──────────────────────────────────────────────────────

@router.post("/login")
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.email              == body.email.lower(),
        User.is_service_account == False,
    ).first()

    if not user or not user.hashed_password:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated. Contact your admin.")
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token  = create_access_token(user)
    refresh_token = create_refresh_token(db, user)
    set_auth_cookies(response, access_token, refresh_token)

    return {
        "id":    str(user.id),
        "email": user.email,
        "name":  user.name,
        "role":  user.role.value,
    }


# ── POST /api/auth/refresh ────────────────────────────────────────────────────

@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    old_refresh_token = request.cookies.get("refresh_token")
    if not old_refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        user, new_refresh_token = rotate_refresh_token(db, old_refresh_token)
    except ValueError as e:
        response.delete_cookie("access_token")
        response.delete_cookie("refresh_token")
        raise HTTPException(status_code=401, detail=str(e))

    access_token = create_access_token(user)
    set_auth_cookies(response, access_token, new_refresh_token)
    return {"ok": True}


# ── POST /api/auth/logout ─────────────────────────────────────────────────────

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    current_user = get_current_user(request)
    revoke_user_tokens(db, current_user["id"])
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"ok": True}


# ── GET /api/auth/me ──────────────────────────────────────────────────────────

@router.get("/me")
def me(request: Request):
    return get_current_user(request)


# ── POST /api/auth/forgot-password ───────────────────────────────────────────

@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.email              == body.email.lower(),
        User.is_service_account == False,
        User.is_active          == True,
    ).first()

    if user and user.password_set:
        otp = generate_otp(db, user)
        send_otp_email(user, otp)

    return {"ok": True, "message": "If that email exists, an OTP has been sent."}


# ── POST /api/auth/verify-otp ─────────────────────────────────────────────────

@router.post("/verify-otp")
def verify_otp_and_reset(body: VerifyOTPRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.email              == body.email.lower(),
        User.is_service_account == False,
        User.is_active          == True,
    ).first()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not verify_otp(db, user, body.otp):
        raise HTTPException(status_code=400, detail="OTP is invalid or expired")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user.hashed_password = hash_password(body.new_password)
    db.commit()
    revoke_user_tokens(db, user.id)
    return {"ok": True, "message": "Password reset successful. Please log in."}


# ── POST /api/auth/verify-setup-token ────────────────────────────────────────

@router.post("/verify-setup-token")
def verify_setup(body: VerifySetupTokenRequest, db: Session = Depends(get_db)):
    user = verify_setup_token(db, body.token)
    if not user:
        raise HTTPException(status_code=400, detail="Setup link is invalid or expired")
    new_token = create_setup_token(db, user)
    return {"ok": True, "name": user.name, "email": user.email, "token": new_token}


# ── POST /api/auth/setup-password ────────────────────────────────────────────

@router.post("/setup-password")
def setup_password(body: SetupPasswordRequest, response: Response, db: Session = Depends(get_db)):
    user = verify_setup_token(db, body.token)
    if not user:
        raise HTTPException(status_code=400, detail="Setup link is invalid or expired")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user.hashed_password = hash_password(body.password)
    user.password_set    = True
    db.commit()

    access_token  = create_access_token(user)
    refresh_token = create_refresh_token(db, user)
    set_auth_cookies(response, access_token, refresh_token)

    return {
        "id":    str(user.id),
        "email": user.email,
        "name":  user.name,
        "role":  user.role.value,
    }


# ── Admin: GET /api/auth/users ────────────────────────────────────────────────

@router.get("/users")
def list_users(db: Session = Depends(get_db), admin=Depends(require_admin)):
    users = db.query(User).filter(User.is_service_account == False).all()
    return [
        {
            "id":           str(u.id),
            "name":         u.name,
            "email":        u.email,
            "role":         u.role.value,
            "is_active":    u.is_active,
            "password_set": u.password_set,
            "created_at":   u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


# ── Admin: POST /api/auth/users/{user_id}/revoke ─────────────────────────────

@router.post("/users/{user_id}/revoke")
def revoke_user(user_id: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    revoke_user_tokens(db, user_id)
    return {"ok": True, "message": f"All sessions revoked for user {user_id}"}


# ── Admin: POST /api/auth/users/{user_id}/deactivate ─────────────────────────

@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    revoke_user_tokens(db, user_id)
    return {"ok": True, "message": f"{user.name} deactivated"}


# ── Admin: POST /api/auth/users/{user_id}/resend-setup ───────────────────────

@router.post("/users/{user_id}/resend-setup")
def resend_setup(user_id: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.password_set:
        raise HTTPException(status_code=400, detail="User has already set their password")

    setup_token = create_setup_token(db, user)
    send_setup_email(user, setup_token, FRONTEND_URL)
    return {"ok": True, "message": f"Setup email resent to {user.email}"}
