"""Politique de sécurité par pharmacie — extraits de server.py."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import (
    _security_cache,
    get_current_user,
    get_security_settings,
    log_audit,
)

router = APIRouter(prefix="/security-settings", tags=["security-settings"])


class SecuritySettingsIn(BaseModel):
    mfa_required: bool = False
    pw_min_length: int = 10
    pw_require_upper: bool = True
    pw_require_lower: bool = True
    pw_require_digit: bool = True
    pw_require_special: bool = False
    pw_expiry_days: int = 0


@router.get("")
async def get_security_settings_endpoint(user: dict = Depends(get_current_user)):
    return await get_security_settings(user.get("pharmacy_id") or "")


@router.put("")
async def save_security_settings(payload: SecuritySettingsIn, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès refusé : réservé aux administrateurs (Loi 25).")
    pid = user.get("pharmacy_id") or ""
    if not pid:
        raise HTTPException(status_code=400, detail="Aucune pharmacie associée à ce compte.")
    if payload.mfa_required and not user.get("mfa_enabled"):
        raise HTTPException(
            status_code=400,
            detail="Activez d'abord la vérification en 2 étapes sur votre propre compte avant de l'exiger pour toute l'équipe.",
        )
    doc = payload.model_dump()
    doc["pw_min_length"] = max(8, min(64, doc["pw_min_length"]))
    doc["pw_expiry_days"] = max(0, min(730, doc["pw_expiry_days"]))
    await db.security_settings.update_one({"pharmacy_id": pid}, {"$set": doc}, upsert=True)
    _security_cache.pop(pid, None)
    if doc["pw_expiry_days"] > 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_many(
            {"pharmacy_id": pid, "password_changed_at": {"$exists": False}},
            {"$set": {"password_changed_at": now_iso}},
        )
    await log_audit(
        user["email"], user["role"], "MODIFICATION_POLITIQUE_SECURITE", "pharmacie", pid,
        f"MFA obligatoire : {'oui' if doc['mfa_required'] else 'non'} · mdp min {doc['pw_min_length']} car. · expiration {doc['pw_expiry_days']} j",
        pid,
    )
    return await get_security_settings(pid)
