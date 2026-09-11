"""JWT, bcrypt, dépendances d'auth, cloisonnement pharmacie."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from .config import db

JWT_ALGORITHM = "HS256"
LOCKOUT_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

_pharmacy_access_cache: dict = {}
_security_cache: dict = {}

DEFAULT_SECURITY_SETTINGS = {
    "mfa_required": False,
    "pw_min_length": 10,
    "pw_require_upper": True,
    "pw_require_lower": True,
    "pw_require_digit": True,
    "pw_require_special": False,
    "pw_expiry_days": 0,
}


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def user_public(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc["name"],
        "role": doc["role"],
        "pharmacy_id": doc.get("pharmacy_id"),
        "employee_id": doc.get("employee_id"),
        "is_temporary_password": doc.get("is_temporary_password", False),
        "suspended": doc.get("suspended", False),
        "privacy_accepted_at": doc.get("privacy_accepted_at"),
        "mfa_enabled": doc.get("mfa_enabled", False),
        "module_overrides": doc.get("module_overrides", {}),
        "report_favorites": doc.get("report_favorites", []),
        "created_at": doc.get("created_at", ""),
    }


def create_access_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def scoped_pid(user: dict) -> str:
    """Cloisonnement strict : chaque compte n'accède qu'aux données de SA pharmacie."""
    pid = (user.get("pharmacy_id") or "").strip()
    if pid:
        return pid
    if user.get("role") == "superadmin":
        return "__plateforme__"
    raise HTTPException(
        status_code=403,
        detail="Aucune pharmacie associée à ce compte. Contactez votre administrateur.",
    )


async def pharmacy_access_error(pid: str) -> Optional[str]:
    if not pid:
        return None
    now = datetime.now(timezone.utc)
    cached = _pharmacy_access_cache.get(pid)
    if cached and (now.timestamp() - cached[1]) < 60:
        doc = cached[0]
    else:
        doc = await db.pharmacies.find_one(
            {"id": pid}, {"_id": 0, "active": 1, "plan_status": 1, "trial_ends_at": 1}
        )
        _pharmacy_access_cache[pid] = (doc, now.timestamp())
    if not doc:
        return None
    if doc.get("active") is False:
        return (
            "L'accès de votre pharmacie est suspendu. "
            "Contactez-nous à info@arriereplanrh.com."
        )
    if doc.get("plan_status") == "trial":
        ends = doc.get("trial_ends_at") or ""
        try:
            if ends and datetime.fromisoformat(ends) < now:
                return (
                    "Votre essai gratuit de 30 jours est terminé. "
                    "Contactez-nous à info@arriereplanrh.com pour activer votre accès complet."
                )
        except ValueError:
            return None
    return None


async def get_security_settings(pharmacy_id: str) -> dict:
    if not pharmacy_id:
        return dict(DEFAULT_SECURITY_SETTINGS)
    cached = _security_cache.get(pharmacy_id)
    now_ts = datetime.now(timezone.utc).timestamp()
    if cached and now_ts - cached[0] < 60:
        return cached[1]
    doc = await db.security_settings.find_one({"pharmacy_id": pharmacy_id}, {"_id": 0}) or {}
    settings = {
        **DEFAULT_SECURITY_SETTINGS,
        **{k: v for k, v in doc.items() if k in DEFAULT_SECURITY_SETTINGS},
    }
    _security_cache[pharmacy_id] = (now_ts, settings)
    return settings


def password_is_expired(user: dict, pol: dict) -> bool:
    days = int(pol.get("pw_expiry_days") or 0)
    if days <= 0:
        return False
    changed = user.get("password_changed_at")
    if not changed:
        return False
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(changed) > timedelta(days=days)
    except ValueError:
        return False


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Non authentifié.")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Type de jeton invalide.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expirée, veuillez vous reconnecter.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Jeton invalide.")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable.")
    if user.get("suspended"):
        raise HTTPException(
            status_code=403,
            detail="Compte suspendu. Contactez votre superadministrateur.",
        )
    if user.get("role") != "superadmin":
        trial_err = await pharmacy_access_error(user.get("pharmacy_id") or "")
        if trial_err:
            raise HTTPException(status_code=403, detail=trial_err)
    if user.get("is_temporary_password") and request.url.path not in (
        "/api/auth/change-password",
        "/api/auth/me",
    ):
        raise HTTPException(
            status_code=403,
            detail="Vous devez d'abord remplacer votre mot de passe temporaire.",
            headers={"X-Password-Change-Required": "1"},
        )
    pol = await get_security_settings(user.get("pharmacy_id") or "")
    path = request.url.path
    if password_is_expired(user, pol) and path not in (
        "/api/auth/change-password",
        "/api/auth/me",
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Votre mot de passe a expiré selon la politique de sécurité "
                "de votre pharmacie. Veuillez le renouveler."
            ),
            headers={"X-Password-Change-Required": "1"},
        )
    if (
        pol.get("mfa_required")
        and not user.get("mfa_enabled")
        and path
        not in (
            "/api/auth/me",
            "/api/auth/mfa/setup",
            "/api/auth/mfa/enable",
            "/api/auth/change-password",
            "/api/security-settings",
        )
    ):
        raise HTTPException(
            status_code=403,
            detail="Votre pharmacie exige la vérification en 2 étapes (MFA). Activez-la pour continuer.",
            headers={"X-Mfa-Setup-Required": "1"},
        )
    return user


async def get_principal(request: Request, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(
            status_code=403,
            detail="Accès refusé : réservé aux administrateurs (Loi 25).",
        )
    pid = (user.get("pharmacy_id") or "").strip()
    if user["role"] == "superadmin":
        hdr = (
            request.headers.get("X-Pharmacy-Id")
            or request.query_params.get("pharmacy_id")
            or ""
        ).strip()
        if hdr:
            exists = await db.pharmacies.find_one({"id": hdr}, {"_id": 1})
            if not exists:
                raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
            pid = hdr
    return {"email": user["email"], "role": user["role"], "pharmacy_id": pid}


async def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Réservé au superadministrateur.")
    return user
