"""Pharmacies clientes + réglages — extraits de server.py."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.email import send_credentials_email
from core.security import (
    _pharmacy_access_cache,
    get_current_user,
    get_principal,
    hash_password,
    log_audit,
    require_superadmin,
    scoped_pid,
    user_public,
)
import secrets

sa_router = APIRouter(prefix="/superadmin/pharmacies", tags=["pharmacies"])
settings_router = APIRouter(prefix="/pharmacy", tags=["pharmacy-settings"])

DEFAULT_PHARMACY_ADDRESS = "5090 Rue Sherbrooke Est, Montréal, QC"

PHARMACY_SCOPED_COLLECTIONS = [
    "announcements", "appointments", "appointment_reminders", "audit_logs", "benefit_imports",
    "chat_attachments", "chat_messages", "contract_signatures", "conversation_reads", "conversations",
    "document_requests", "employee_profiles", "evaluations", "hr_custom_fields", "incidents", "kudos",
    "leave_balances", "leave_policies", "leave_requests", "licenses", "login_events", "notifications",
    "open_shifts", "pay_settings", "pharmacy_settings", "polls", "punch_settings", "punches",
    "replacement_offers", "replacement_requests", "report_schedules", "report_settings",
    "schedule_proposals", "schedule_publications", "schedule_settings", "schedule_templates",
    "schedule_views", "security_settings", "shift_tasks", "shifts", "sst_incidents", "task_goals",
    "time_bank_entries", "training_assignments", "training_attempts", "trainings", "work_stations",
    "agencies", "api_keys", "hr_states",
]


def gen_temp_password() -> str:
    return "Lumina-" + secrets.token_urlsafe(6)


class PharmacyIn(BaseModel):
    name: str
    address: str = ""
    city: str = ""
    owner_name: str = ""
    admin_email: str = ""
    admin_name: str = ""
    plan: str = "Essentiel"


class PharmacyPatchIn(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    owner_name: Optional[str] = None
    admin_email: Optional[str] = None
    plan: Optional[str] = None
    active: Optional[bool] = None
    plan_status: Optional[str] = None
    trial_ends_at: Optional[str] = None


class PharmacySettingsIn(BaseModel):
    address: str
    mileage_rate: float = -1.0


async def ensure_pharmacies_seeded() -> None:
    if not await db.pharmacies.find_one({"id": "ph1"}):
        await db.pharmacies.insert_one({
            "id": "ph1", "name": "Pharmacie Lavoie & Associés",
            "address": "1200 rue Sainte-Catherine", "city": "Montréal",
            "owner_name": "Dr. Sophie Lavoie", "admin_email": "admin@luminahr.ca",
            "plan": "Pro", "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    for pid in await db.users.distinct("pharmacy_id"):
        if not pid:
            continue
        if not await db.pharmacies.find_one({"id": pid}):
            await db.pharmacies.insert_one({
                "id": pid, "name": f"Pharmacie ({pid})", "address": "", "city": "",
                "owner_name": "", "admin_email": "", "plan": "Essentiel", "active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })


@sa_router.get("")
async def sa_list_pharmacies(su: dict = Depends(require_superadmin)):
    docs = await db.pharmacies.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    counts: dict = {}
    async for row in db.users.aggregate([
        {"$match": {"pharmacy_id": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$pharmacy_id", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]
    for d in docs:
        d["accounts_count"] = counts.get(d["id"], 0)
    return docs


@sa_router.get("/{pharmacy_id}")
async def sa_get_pharmacy(pharmacy_id: str, su: dict = Depends(require_superadmin)):
    doc = await db.pharmacies.find_one({"id": pharmacy_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
    accounts = await db.users.find({"pharmacy_id": pharmacy_id}, {"_id": 0, "password_hash": 0}).to_list(500)
    doc["accounts"] = [user_public({**a, "password_hash": ""}) for a in accounts]
    doc["accounts_count"] = len(accounts)
    return doc


@sa_router.post("")
async def sa_create_pharmacy(payload: PharmacyIn, su: dict = Depends(require_superadmin)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Le nom de la pharmacie est requis.")
    admin_name = payload.admin_name.strip()
    admin_email = payload.admin_email.strip().lower()
    if not admin_name or "@" not in admin_email or "." not in admin_email.split("@")[-1]:
        raise HTTPException(
            status_code=400,
            detail="Un compte administrateur est obligatoire : indiquez le nom et un courriel valide.",
        )
    if await db.users.find_one({"email": admin_email}):
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel.")
    doc = {
        "id": "ph_" + uuid.uuid4().hex[:8], "name": name[:120],
        "address": payload.address.strip()[:200], "city": payload.city.strip()[:80],
        "owner_name": (payload.owner_name.strip() or admin_name)[:120],
        "admin_email": admin_email[:120],
        "plan": payload.plan if payload.plan in ("Essentiel", "Pro", "Entreprise") else "Essentiel",
        "active": True, "plan_status": "full",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.pharmacies.insert_one(doc)
    doc.pop("_id", None)
    temp = gen_temp_password()
    user_doc = {
        "id": str(uuid.uuid4()), "email": admin_email, "password_hash": hash_password(temp),
        "name": admin_name[:120], "role": "admin", "pharmacy_id": doc["id"], "employee_id": None,
        "is_temporary_password": True, "suspended": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    await log_audit(
        su["email"], su["role"], "CREATION_PHARMACIE", "pharmacie", doc["id"],
        f"Pharmacie cliente « {name} » créée avec le compte admin {admin_email}", doc["id"],
    )
    email_sent = await send_credentials_email(admin_name, admin_email, temp)
    return {
        **doc, "accounts_count": 1, "admin_user": user_public(user_doc),
        "temporary_password": temp, "email_sent": email_sent,
    }


@sa_router.put("/{pharmacy_id}")
async def sa_update_pharmacy(pharmacy_id: str, payload: PharmacyPatchIn, su: dict = Depends(require_superadmin)):
    doc = await db.pharmacies.find_one({"id": pharmacy_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "name" in patch and not patch["name"].strip():
        raise HTTPException(status_code=400, detail="Le nom ne peut pas être vide.")
    if "plan" in patch and patch["plan"] not in ("Essentiel", "Pro", "Entreprise", "Essai gratuit"):
        patch["plan"] = doc.get("plan", "Essentiel")
    if "plan_status" in patch and patch["plan_status"] not in ("trial", "full"):
        raise HTTPException(status_code=400, detail="Statut d'accès invalide (trial ou full).")
    if patch:
        await db.pharmacies.update_one({"id": pharmacy_id}, {"$set": patch})
        _pharmacy_access_cache.pop(pharmacy_id, None)
        await log_audit(
            su["email"], su["role"], "MODIF_PHARMACIE", "pharmacie", pharmacy_id,
            f"Pharmacie « {doc['name']} » modifiée ({', '.join(patch.keys())})", pharmacy_id,
        )
    return {**doc, **patch}


@sa_router.delete("/{pharmacy_id}")
async def sa_delete_pharmacy(pharmacy_id: str, su: dict = Depends(require_superadmin)):
    doc = await db.pharmacies.find_one({"id": pharmacy_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
    users = await db.users.find({"pharmacy_id": pharmacy_id}, {"_id": 0, "email": 1}).to_list(2000)
    emails = [u["email"] for u in users]
    res = await db.users.delete_many({"pharmacy_id": pharmacy_id, "role": {"$ne": "superadmin"}})
    if emails:
        await db.login_attempts.delete_many({"identifier": {"$in": emails}})
        await db.password_resets.delete_many({"email": {"$in": emails}})
    for coll in PHARMACY_SCOPED_COLLECTIONS:
        await db[coll].delete_many({"pharmacy_id": pharmacy_id})
    await db.pharmacies.delete_one({"id": pharmacy_id})
    _pharmacy_access_cache.pop(pharmacy_id, None)
    await log_audit(
        su["email"], su["role"], "SUPPRESSION_PHARMACIE", "pharmacie", pharmacy_id,
        f"Pharmacie « {doc['name']} » supprimée définitivement avec {res.deleted_count} compte(s) et toutes ses données",
        pharmacy_id,
    )
    return {"status": "supprimé", "accounts_deleted": res.deleted_count}


@settings_router.get("/settings")
async def get_pharmacy_settings(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.pharmacy_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return {
        "address": (doc or {}).get("address") or DEFAULT_PHARMACY_ADDRESS,
        "mileage_rate": (doc or {}).get("mileage_rate", 0.50),
    }


@settings_router.put("/settings")
async def set_pharmacy_settings(payload: PharmacySettingsIn, principal: dict = Depends(get_principal)):
    if not payload.address.strip():
        raise HTTPException(status_code=400, detail="Adresse requise.")
    pid = scoped_pid(principal)
    update = {
        "pharmacy_id": pid,
        "address": payload.address.strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.mileage_rate >= 0:
        update["mileage_rate"] = payload.mileage_rate
    await db.pharmacy_settings.update_one({"pharmacy_id": pid}, {"$set": update}, upsert=True)
    return {"address": update["address"], "mileage_rate": update.get("mileage_rate", 0.50)}
