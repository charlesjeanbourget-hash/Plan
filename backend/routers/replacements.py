"""Remplacements agence — extraits de server.py (sans envoi Resend ni choose)."""
import secrets
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_principal, log_audit, scoped_pid

router = APIRouter(prefix="/replacements", tags=["replacements"])


class ReplacementSlot(BaseModel):
    date: str
    start: str
    end: str


class ReplacementRequestIn(BaseModel):
    role: str
    slots: list[ReplacementSlot]
    notes: str = ""
    urgency: str = "Normale"
    public_base_url: str


class ReplacementOfferIn(BaseModel):
    agency_name: str
    agency_email: str
    candidate_name: str
    license_number: str = ""
    experience_years: int = 0
    hourly_rate: float
    phone: str = ""
    email: str = ""
    note: str = ""


@router.post("/requests")
async def create_replacement_request(payload: ReplacementRequestIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if not payload.slots:
        raise HTTPException(status_code=400, detail="Ajoutez au moins une plage à combler.")
    for s in payload.slots:
        try:
            date.fromisoformat(s.date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Date de plage invalide.")
    token = secrets.token_urlsafe(24)
    link = f"{payload.public_base_url.rstrip('/')}/?remplacement={token}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "role": payload.role,
        "slots": [s.model_dump() for s in payload.slots], "notes": payload.notes.strip(),
        "urgency": payload.urgency, "status": "open", "token": token, "link": link,
        "chosen_offer_id": None, "emails_sent": 0,
        "created_by": principal["email"], "created_at": now, "updated_at": now,
    }
    await db.replacement_requests.insert_one({**doc})
    await log_audit(
        principal["email"], principal["role"], "DEMANDE_REMPLACEMENT", "remplacement", doc["id"],
        f"Demande {payload.role} ({len(payload.slots)} plage(s))", pid,
    )
    return {k: v for k, v in doc.items() if k != "token"} | {"link": link}


@router.get("/requests")
async def list_replacement_requests(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    docs = await db.replacement_requests.find(
        {"pharmacy_id": pid}, {"_id": 0, "token": 0}
    ).sort("created_at", -1).to_list(200)
    for d in docs:
        d["offers_count"] = await db.replacement_offers.count_documents({"request_id": d["id"]})
        d["chosen_offer"] = None
        if d.get("chosen_offer_id"):
            d["chosen_offer"] = await db.replacement_offers.find_one(
                {"id": d["chosen_offer_id"]},
                {"_id": 0, "candidate_name": 1, "agency_name": 1, "hourly_rate": 1},
            )
    return docs


@router.get("/requests/{request_id}/offers")
async def list_replacement_offers(request_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    req = await db.replacement_requests.find_one({"id": request_id, "pharmacy_id": pid}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    return await db.replacement_offers.find({"request_id": request_id}, {"_id": 0}).sort("created_at", 1).to_list(200)


@router.get("/public/{token}")
async def public_replacement_request(token: str):
    doc = await db.replacement_requests.find_one({"token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable ou expirée.")
    return {
        "role": doc["role"], "slots": doc["slots"], "notes": doc["notes"],
        "urgency": doc["urgency"], "status": doc["status"], "created_at": doc["created_at"],
    }


@router.post("/public/{token}/offers")
async def submit_replacement_offer(token: str, payload: ReplacementOfferIn):
    req = await db.replacement_requests.find_one({"token": token}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable ou expirée.")
    if req["status"] != "open":
        raise HTTPException(status_code=400, detail="Cette demande est déjà comblée ou fermée.")
    if payload.hourly_rate <= 0 or not payload.candidate_name.strip():
        raise HTTPException(status_code=400, detail="Nom du remplaçant et taux horaire requis.")
    doc = {
        "id": str(uuid.uuid4()), "request_id": req["id"], "pharmacy_id": req["pharmacy_id"],
        "agency_name": payload.agency_name.strip(), "agency_email": payload.agency_email.strip().lower(),
        "candidate_name": payload.candidate_name.strip(), "license_number": payload.license_number.strip(),
        "experience_years": payload.experience_years, "hourly_rate": round(payload.hourly_rate, 2),
        "phone": payload.phone.strip(), "email": payload.email.strip().lower(), "note": payload.note.strip(),
        "status": "received", "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.replacement_offers.insert_one({**doc})
    await log_audit(
        "agence", "public", "OFFRE_REMPLACEMENT", "remplacement", req["id"],
        f"Offre reçue de {doc['agency_name']} : {doc['candidate_name']} ({req['role']})", req["pharmacy_id"],
    )
    return {"status": "reçue", "id": doc["id"]}


@router.delete("/requests/{request_id}")
async def delete_replacement_request(request_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.replacement_requests.find_one({"id": request_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    await db.replacement_offers.delete_many({"request_id": request_id})
    await db.replacement_requests.delete_one({"id": request_id})
    await log_audit(
        principal["email"], principal["role"], "SUPPRESSION_DEMANDE_REMPLACEMENT", "remplacement", request_id,
        f"Demande {doc.get('role')} supprimée", pid,
    )
    return {"status": "supprimée"}
