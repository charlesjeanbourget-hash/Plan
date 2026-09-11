"""Routeur authentification — extraits de server.py."""
import base64
import io
import math
from datetime import datetime, timedelta, timezone

import jwt
import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.config import db
from core.security import (
    JWT_ALGORITHM,
    LOCKOUT_ATTEMPTS,
    LOCKOUT_MINUTES,
    _totp_valid,
    auth_flags,
    create_access_token,
    get_current_user,
    get_fernet,
    get_jwt_secret,
    hash_password,
    log_audit,
    pharmacy_access_error,
    record_login_event,
    user_public,
    validate_password_strength,
    verify_password,
    client_ip,
    is_new_ip_login,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class MfaCodeIn(BaseModel):
    code: str


class MfaVerifyIn(BaseModel):
    mfa_token: str
    code: str


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
    suspicious = await is_new_ip_login(user["id"], client_ip(request))
    await record_login_event(user, "CONNEXION", request, flagged_new_ip=suspicious)
    return {
        "access_token": create_access_token(user),
        "user": {**user_public(user), **(await auth_flags(user))},
    }


@router.post("/mfa/setup")
async def mfa_setup(user: dict = Depends(get_current_user)):
    secret = pyotp.random_base32()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name="Arrière Plan")
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    enc = get_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")
    await db.users.update_one({"id": user["id"]}, {"$set": {"mfa_secret_pending": enc}})
    return {"secret": secret, "otpauth_uri": uri, "qr_base64": qr_b64}


@router.post("/mfa/enable")
async def mfa_enable(payload: MfaCodeIn, user: dict = Depends(get_current_user)):
    enc = user.get("mfa_secret_pending")
    if not enc:
        raise HTTPException(status_code=400, detail="Aucune configuration MFA en cours — relancez l'activation.")
    secret = get_fernet().decrypt(enc.encode("utf-8")).decode("utf-8")
    if not _totp_valid(secret, payload.code):
        raise HTTPException(status_code=400, detail="Code invalide — vérifiez votre application d'authentification.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"mfa_enabled": True, "mfa_secret": enc}, "$unset": {"mfa_secret_pending": ""}},
    )
    await log_audit(
        user["email"], user["role"], "MFA_ACTIVEE", "utilisateur", user["id"],
        "Vérification en 2 étapes activée", user.get("pharmacy_id") or "",
    )
    return {"ok": True, "mfa_enabled": True}


@router.post("/mfa/disable")
async def mfa_disable(payload: MfaCodeIn, user: dict = Depends(get_current_user)):
    enc = user.get("mfa_secret")
    if not user.get("mfa_enabled") or not enc:
        raise HTTPException(status_code=400, detail="La vérification en 2 étapes n'est pas activée.")
    secret = get_fernet().decrypt(enc.encode("utf-8")).decode("utf-8")
    if not _totp_valid(secret, payload.code):
        raise HTTPException(status_code=400, detail="Code invalide.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"mfa_enabled": False}, "$unset": {"mfa_secret": "", "mfa_secret_pending": ""}},
    )
    await log_audit(
        user["email"], user["role"], "MFA_DESACTIVEE", "utilisateur", user["id"],
        "Vérification en 2 étapes désactivée", user.get("pharmacy_id") or "",
    )
    return {"ok": True, "mfa_enabled": False}


@router.post("/mfa/verify")
async def mfa_verify(payload: MfaVerifyIn, request: Request):
    try:
        decoded = jwt.decode(payload.mfa_token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if decoded.get("type") != "mfa":
            raise HTTPException(status_code=401, detail="Jeton invalide.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Délai expiré — reconnectez-vous.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Jeton invalide.")
    user = await db.users.find_one({"id": decoded["sub"]}, {"_id": 0})
    if not user or not user.get("mfa_enabled") or not user.get("mfa_secret"):
        raise HTTPException(status_code=401, detail="Utilisateur introuvable.")
    secret = get_fernet().decrypt(user["mfa_secret"].encode("utf-8")).decode("utf-8")
    if not _totp_valid(secret, payload.code):
        raise HTTPException(status_code=401, detail="Code invalide — réessayez.")
    suspicious = await is_new_ip_login(user["id"], client_ip(request))
    await record_login_event(user, "CONNEXION", request, flagged_new_ip=suspicious)
    return {"access_token": create_access_token(user), "user": {**user_public(user), **(await auth_flags(user))}}


@router.post("/accept-privacy")
async def auth_accept_privacy(user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": user["id"]}, {"$set": {"privacy_accepted_at": now}})
    await log_audit(
        user["email"], user["role"], "ACCEPTATION_POLITIQUE_CONFIDENTIALITE",
        "utilisateur", user["id"], "Politique de confidentialité acceptée",
        user.get("pharmacy_id") or "",
    )
    return {"privacy_accepted_at": now}


@router.get("/me")
async def auth_me(user: dict = Depends(get_current_user)):
    out = {**user_public(user), **(await auth_flags(user))}
    if user.get("role") != "superadmin" and user.get("pharmacy_id"):
        ph = await db.pharmacies.find_one(
            {"id": user["pharmacy_id"]},
            {"_id": 0, "plan_status": 1, "trial_ends_at": 1, "onboarding_pending": 1},
        )
        if ph and ph.get("onboarding_pending") and user.get("role") == "admin":
            out["onboarding_pending"] = True
        if ph and ph.get("plan_status") == "trial" and ph.get("trial_ends_at"):
            try:
                secs = (datetime.fromisoformat(ph["trial_ends_at"]) - datetime.now(timezone.utc)).total_seconds()
                out["trial_ends_at"] = ph["trial_ends_at"]
                out["trial_days_left"] = max(0, math.ceil(secs / 86400))
            except ValueError:
                pass
    return out


@router.post("/change-password")
async def auth_change_password(
    payload: ChangePasswordIn, request: Request, user: dict = Depends(get_current_user)
):
    current_password = payload.current_password.strip()
    new_password = payload.new_password.strip()
    if not verify_password(current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect.")
    err = await validate_password_strength(new_password, user.get("pharmacy_id") or "")
    if err:
        raise HTTPException(status_code=400, detail=err)
    if new_password == current_password:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit être différent de l'actuel.")
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "is_temporary_password": False,
                "password_changed_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    await log_audit(
        user["email"], user["role"], "CHANGEMENT_MOT_DE_PASSE", "utilisateur", user["id"],
        "Mot de passe modifié par l'utilisateur", user.get("pharmacy_id") or "",
    )
    await record_login_event(user, "CHANGEMENT_MOT_DE_PASSE", request)
    return {"status": "modifié"}
