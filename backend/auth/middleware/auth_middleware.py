# backend/auth/middleware/auth_middleware.py

from fastapi import Request, HTTPException, status, Depends
from fastapi.responses import JSONResponse
from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware

from auth.services.auth_service import decode_access_token

# Routes that don't need a token
PUBLIC_ROUTES = {
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/forgot-password",
    "/api/auth/verify-otp",
    "/api/auth/setup-password",
    "/api/auth/verify-setup-token",
    "/api/status",
    "/api/health",
    "/docs",
    "/openapi.json",
    "/redoc",
}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in PUBLIC_ROUTES:
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        token = request.cookies.get("access_token")

        if not token:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"},
            )

        try:
            payload = decode_access_token(token)
            request.state.user_id = payload["sub"]
            request.state.email   = payload["email"]
            request.state.name    = payload["name"]
            request.state.role    = payload["role"]
        except JWTError:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Token invalid or expired"},
            )

        return await call_next(request)


# ── Dependencies ──────────────────────────────────────────────────────────────

def get_current_user(request: Request) -> dict:
    return {
        "id":    request.state.user_id,
        "email": request.state.email,
        "name":  request.state.name,
        "role":  request.state.role,
    }

def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user
