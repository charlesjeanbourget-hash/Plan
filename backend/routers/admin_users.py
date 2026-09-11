"""Comptes plateforme — extraits de server.py."""
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.email import send_credentials_email
from core.security import hash_password, log_audit, require_superadmin, user_public

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


def gen_temp_password() -> str:
    return "Lumina-" + secrets.token_urlsafe(6)


class UserCreateIn(BaseModel):
    email: str
    name: str
    role: str
    pharmacy_id: Optional[str] = None
    employee_id: Optional[str] = None


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    pharmacy_id: Optional[str] = None
    employee_id: Optional[str] = None
    suspended: Optional[bool] = None


@router.get("")
async def admin_list_users(su: dict = Depends(require_superadmin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(1000)
    return [user_public({**d, "password_hash": ""}) for d in docs]


@router.post("")
async def admin_create_user(payload: UserCreateIn, su: dict = Depends(require_superadmin)):
    email = payload.email.strip().lower()
    if payload.role not in ("admin", "manager", "employee", "superadmin"):
        raise HTTPException(status_code=400, detail="Rôle invalide.")
    pharmacy_id = (payload.pharmacy_id or "").strip()
    if payload.role != "superadmin":
        if not pharmacy_id:
            raise HTTPException(
                status_code=400,
                detail="Une pharmacie doit obligatoirement être assignée à ce compte (isolation des données).",
            )
        if not await db.pharmacies.find_one({"id": pharmacy_id}):
            raise HTTPException(
                status_code=400,
                detail="Pharmacie introuvable. Créez-la d'abord dans le module Superadmin.",
            )
    else:
        pharmacy_id = ""
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel.")
    temp = gen_temp_password()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(temp),
        "name": payload.name,
        "role": payload.role,
        "pharmacy_id": pharmacy_id or None,
        "employee_id": payload.employee_id,
        "is_temporary_password": True,
        "suspended": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    await log_audit(
        su["email"], su["role"], "CREATION_COMPTE", "utilisateur", doc["id"],
        f"Compte {payload.role} créé pour {email}", payload.pharmacy_id or "",
    )
    email_sent = await send_credentials_email(payload.name, email, temp)
    return {"user": user_public(doc), "temporary_password": temp, "email_sent": email_sent}


@router.put("/{user_id}")
async def admin_update_user(user_id: str, payload: UserUpdateIn, su: dict = Depends(require_superadmin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Compte introuvable.")
    if user_id == su["id"] and payload.suspended:
        raise HTTPException(status_code=400, detail="Impossible de suspendre votre propre compte.")
    patch = payload.model_dump(exclude_none=True)
    if patch.get("role") and patch["role"] not in ("admin", "manager", "employee", "superadmin"):
        raise HTTPException(status_code=400, detail="Rôle invalide.")
    if user_id == su["id"] and patch.get("role") and patch["role"] != "superadmin":
        raise HTTPException(status_code=400, detail="Impossible de retirer votre propre rôle superadmin.")
    if patch.get("email"):
        patch["email"] = patch["email"].strip().lower()
        if patch["email"] != target["email"] and await db.users.find_one({"email": patch["email"]}):
            raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel.")
    if patch.get("name") is not None:
        patch["name"] = patch["name"].strip()[:120]
        if not patch["name"]:
            raise HTTPException(status_code=400, detail="Le nom ne peut pas être vide.")
    if patch.get("pharmacy_id") and not await db.pharmacies.find_one({"id": patch["pharmacy_id"]}):
        raise HTTPException(status_code=400, detail="Pharmacie introuvable.")
    if patch:
        await db.users.update_one({"id": user_id}, {"$set": patch})
    action = (
        "SUSPENSION_COMPTE" if payload.suspended is True
        else ("REACTIVATION_COMPTE" if payload.suspended is False else "MODIFICATION_COMPTE")
    )
    await log_audit(
        su["email"], su["role"], action, "utilisateur", user_id,
        f"Compte {target['email']} — champs : {', '.join(patch.keys()) or 'aucun'}",
        target.get("pharmacy_id") or "",
    )
    return user_public({**target, **patch})


@router.post("/{user_id}/reset-password")
async def admin_reset_password(user_id: str, su: dict = Depends(require_superadmin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Compte introuvable.")
    temp = gen_temp_password()
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": hash_password(temp), "is_temporary_password": True}},
    )
    await db.login_attempts.delete_one({"identifier": target["email"]})
    await log_audit(
        su["email"], su["role"], "REINITIALISATION_MDP", "utilisateur", user_id,
        f"Mot de passe temporaire généré pour {target['email']} (support à distance)",
        target.get("pharmacy_id") or "",
    )
    email_sent = await send_credentials_email(target.get("name", ""), target["email"], temp, reset=True)
    return {"temporary_password": temp, "email": target["email"], "email_sent": email_sent}


@router.delete("/{user_id}")
async def admin_delete_user(user_id: str, su: dict = Depends(require_superadmin)):
    if user_id == su["id"]:
        raise HTTPException(status_code=400, detail="Impossible de supprimer votre propre compte.")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Compte introuvable.")
    await db.users.delete_one({"id": user_id})
    await log_audit(
        su["email"], su["role"], "SUPPRESSION_COMPTE", "utilisateur", user_id,
        f"Compte {target['email']} supprimé définitivement", target.get("pharmacy_id") or "",
    )
    return {"status": "supprimé"}
