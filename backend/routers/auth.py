"""Routeur authentification — extraits de server.py."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.core.config import db
from backend.core.security import (
    JWT_ALGORITHM,
    LOCKOUT_ATTEMPTS,
    LOCKOUT_MINUTES,
    create_access_token,
    get_current_user,
    get_jwt_secret,
    pharmacy_access_error,
    user_public,
    verify_password,
)
import jwt

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
async def auth_login(payload: LoginIn, request: Request):
    email = payload.email.strip().lower()
    identifier = email
    now = datetime.now(timezone.utc)
    attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    if attempt and attempt.get("locked_until") and datetime.fromisoformat(attempt["locked_until"]) > now:
        raise HTTPException(
            status_code=429,
            detail="Trop de tentatives échouées. Réessayez dans 15 minutes.",
            headers={"Retry-After": str(LOCKOUT_MINUTES * 60)},
        )
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(payload.password.strip(), user.get("password_hash") or ""):
        count = (attempt.get("count", 0) + 1) if attempt else 1
        update = {"identifier": identifier, "count": count, "updated_at": now.isoformat()}
        if count >= LOCKOUT_ATTEMPTS:
            update["locked_until"] = (now + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
            update["count"] = 0
        await db.login_attempts.update_one({"identifier": identifier}, {"$set": update}, upsert=True)
        if count >= LOCKOUT_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Trop de tentatives échouées. Réessayez dans 15 minutes.",
                headers={"Retry-After": str(LOCKOUT_MINUTES * 60)},
            )
        raise HTTPException(status_code=401, detail="Courriel ou mot de passe invalide.")
    if user.get("suspended"):
        raise HTTPException(
            status_code=403,
            detail="Compte suspendu. Contactez votre superadministrateur.",
        )
    if user.get("role") != "superadmin":
        trial_err = await pharmacy_access_error(user.get("pharmacy_id") or "")
        if trial_err:
            raise HTTPException(status_code=403, detail=trial_err)
    await db.login_attempts.delete_one({"identifier": identifier})
    if user.get("mfa_enabled"):
        mfa_token = jwt.encode(
            {
                "sub": user["id"],
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
                "type": "mfa",
            },
            get_jwt_secret(),
            algorithm=JWT_ALGORITHM,
        )
        return {"mfa_required": True, "mfa_token": mfa_token}
    return {
        "access_token": create_access_token(user),
        "user": user_public(user),
    }


@router.get("/me")
async def auth_me(request: Request):
    user = await get_current_user(request)
    return user_public(user)
