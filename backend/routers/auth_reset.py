"""Récupération de mot de passe — extraits de server.py."""
import asyncio
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import resend
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.config import db
from core.email import get_sender, hash_reset_code, reset_email_html
from core.security import (
    client_ip,
    hash_password,
    log_audit,
    record_login_event,
    validate_password_strength,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    email: str
    code: str
    new_password: str


@router.post("/forgot-password")
async def auth_forgot_password(payload: ForgotPasswordIn, request: Request):
    email = payload.email.strip().lower()
    generic = {
        "ok": True,
        "message": (
            "Si un compte existe pour ce courriel, un message avec votre identifiant "
            "et un code de vérification vient d'être envoyé."
        ),
    }
    if not email or "@" not in email:
        return generic
    ip = client_ip(request)
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=1)).isoformat()
    recent = await db.password_resets.count_documents(
        {"$or": [{"email": email}, {"ip": ip}], "created_at": {"$gte": since}}
    )
    if recent >= 5:
        raise HTTPException(status_code=429, detail="Trop de demandes. Réessayez dans une heure.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or user.get("suspended"):
        await db.password_resets.insert_one({
            "id": str(uuid.uuid4()), "email": email, "ip": ip, "code_hash": None,
            "attempts": 0, "used": True, "expires_at": now.isoformat(), "created_at": now.isoformat(),
        })
        return generic
    code = f"{secrets.randbelow(1000000):06d}"
    await db.password_resets.update_many({"email": email, "used": False}, {"$set": {"used": True}})
    await db.password_resets.insert_one({
        "id": str(uuid.uuid4()), "email": email, "ip": ip,
        "code_hash": hash_reset_code(code), "attempts": 0, "used": False,
        "expires_at": (now + timedelta(minutes=15)).isoformat(), "created_at": now.isoformat(),
    })
    api_key = os.environ.get("RESEND_API_KEY", "")
    if api_key:
        resend.api_key = api_key
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": await get_sender(), "to": [email],
                "subject": "Votre code de vérification — Arrière Plan",
                "html": reset_email_html(user.get("name", ""), email, code),
            })
        except Exception as e:
            logger.warning(f"Courriel de réinitialisation non envoyé : {e}")
    await log_audit(
        email, user["role"], "DEMANDE_REINIT_MDP", "utilisateur", user["id"],
        f"Demande de réinitialisation par courriel (IP {ip})", user.get("pharmacy_id") or "",
    )
    return generic


@router.post("/reset-password")
async def auth_reset_password(payload: ResetPasswordIn, request: Request):
    email = payload.email.strip().lower()
    code = payload.code.strip()
    new_password = payload.new_password.strip()
    invalid = HTTPException(status_code=400, detail="Code invalide ou expiré. Refaites une demande de code.")
    doc = await db.password_resets.find_one(
        {"email": email, "used": False}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc or not doc.get("code_hash"):
        raise invalid
    if datetime.fromisoformat(doc["expires_at"]) < datetime.now(timezone.utc) or doc.get("attempts", 0) >= 5:
        raise invalid
    if hash_reset_code(code) != doc["code_hash"]:
        await db.password_resets.update_one({"id": doc["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Code de vérification incorrect.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise invalid
    err = await validate_password_strength(new_password, user.get("pharmacy_id") or "")
    if err:
        raise HTTPException(status_code=400, detail=err)
    await db.users.update_one(
        {"email": email},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "is_temporary_password": False,
                "password_changed_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    await db.password_resets.update_one({"id": doc["id"]}, {"$set": {"used": True}})
    await db.login_attempts.delete_one({"identifier": email})
    await log_audit(
        email, user["role"], "REINIT_MDP_COURRIEL", "utilisateur", user["id"],
        "Mot de passe réinitialisé par vérification courriel", user.get("pharmacy_id") or "",
    )
    await record_login_event(user, "CHANGEMENT_MOT_DE_PASSE", request)
    return {"ok": True}
