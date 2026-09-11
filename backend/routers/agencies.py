"""Agences de remplacement."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_principal, log_audit, scoped_pid

router = APIRouter(prefix="/agencies", tags=["agencies"])


class AgencyIn(BaseModel):
    name: str
    email: str
    roles: list[str]


@router.get("")
async def list_agencies(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    local = await db.agencies.find({"pharmacy_id": pid}, {"_id": 0}).sort("name", 1).to_list(200)
    partners = await db.global_partners.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return local + [{**p, "pharmacy_id": "", "global": True} for p in partners]


@router.post("")
async def create_agency(payload: AgencyIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "name": payload.name.strip(),
        "email": payload.email.strip().lower(), "roles": payload.roles,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.agencies.insert_one({**doc})
    await log_audit(
        principal["email"], principal["role"], "AJOUT_AGENCE", "remplacement", doc["id"],
        f"Agence « {doc['name']} » ({', '.join(doc['roles'])}) ajoutée", pid,
    )
    return doc


@router.delete("/{agency_id}")
async def delete_agency(agency_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.agencies.find_one({"id": agency_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Agence introuvable.")
    await db.agencies.delete_one({"id": agency_id})
    await log_audit(
        principal["email"], principal["role"], "RETRAIT_AGENCE", "remplacement", agency_id,
        f"Agence « {doc['name']} » retirée", pid,
    )
    return {"status": "retirée"}
