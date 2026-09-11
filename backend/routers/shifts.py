"""Quarts calendrier — extraits de server.py."""
import re
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid

DEPARTMENTS_BE = ("Général", "Plancher", "Laboratoire", "Entrepôt", "Livraison", "Administration")

router = APIRouter(prefix="/shifts", tags=["shifts"])


class ShiftIn(BaseModel):
    id: str = ""
    employee_id: str
    employee_name: str = ""
    date: str
    start: str
    end: str
    department: str = "Général"
    resource_ids: list[str] = []
    ai_generated: bool = False
    proposal_id: str = ""
    branch_id: str = ""
    station: str = ""
    notes: str = ""
    training: bool = False


class ShiftPatchIn(BaseModel):
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    date: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    department: Optional[str] = None
    resource_ids: Optional[list[str]] = None
    ai_generated: Optional[bool] = None
    proposal_id: Optional[str] = None
    branch_id: Optional[str] = None
    station: Optional[str] = None
    notes: Optional[str] = None
    training: Optional[bool] = None


class ShiftsBulkIn(BaseModel):
    shifts: list[ShiftIn]


def validate_shift_core(date_s: str, start: str, end: str) -> None:
    try:
        date.fromisoformat(date_s)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date de quart invalide.")
    if not re.fullmatch(r"\d{2}:\d{2}", start or "") or not re.fullmatch(r"\d{2}:\d{2}", end or ""):
        raise HTTPException(status_code=400, detail="Heures de quart invalides (HH:MM).")
    if end <= start:
        raise HTTPException(status_code=400, detail="L'heure de fin doit être après l'heure de début.")


def shift_doc(s: ShiftIn, pid: str) -> dict:
    validate_shift_core(s.date, s.start, s.end)
    return {
        "id": s.id or str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": s.employee_id,
        "employee_name": (s.employee_name or "")[:80],
        "date": s.date, "start": s.start, "end": s.end,
        "department": s.department if s.department in DEPARTMENTS_BE else "Général",
        "resource_ids": [str(r) for r in (s.resource_ids or [])][:20],
        "ai_generated": bool(s.ai_generated), "proposal_id": s.proposal_id or "",
        "branch_id": s.branch_id or "", "station": (s.station or "")[:80], "notes": (s.notes or "")[:500],
        "training": bool(s.training),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


async def mark_shifts_ready(pid: str) -> None:
    await db.schedule_settings.update_one(
        {"pharmacy_id": pid}, {"$set": {"pharmacy_id": pid, "shifts_server_ready": True}}, upsert=True
    )


async def notify_shift_change(pid, employee_id, title, detail, tone="sky", module="myspace", icon="schedule"):
    if not employee_id:
        return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_employee_id": employee_id,
        "title": title, "detail": detail, "module": module, "icon": icon,
        "tone": tone, "created_at": datetime.now(timezone.utc).isoformat(),
    })


def fmt_shift_txt(d: dict) -> str:
    dept = d.get("department") or "Général"
    label = dept + (f" — poste {d['station']}" if d.get("station") else "")
    return f"le {d['date']} de {d['start']} à {d['end']}" + (f" ({label})" if label != "Général" else "")


async def incompat_warning(pid: str, shift: dict) -> Optional[str]:
    prof = await db.employee_profiles.find_one(
        {"pharmacy_id": pid, "employee_id": shift["employee_id"]},
        {"_id": 0, "incompatible_with": 1},
    )
    incompat = set((prof or {}).get("incompatible_with") or [])
    if not incompat:
        return None
    others = await db.shifts.find(
        {
            "pharmacy_id": pid, "date": shift["date"], "employee_id": {"$in": list(incompat)},
            "id": {"$ne": shift["id"]},
        },
        {"_id": 0, "employee_id": 1, "start": 1, "end": 1, "branch_id": 1},
    ).to_list(100)
    conflicts = [
        o for o in others
        if o["start"] < shift["end"] and shift["start"] < o["end"]
        and (o.get("branch_id") or "") == (shift.get("branch_id") or "")
    ]
    if not conflicts:
        return None
    name_docs = await db.employee_profiles.find(
        {"pharmacy_id": pid, "employee_id": {"$in": [o["employee_id"] for o in conflicts]}},
        {"_id": 0, "employee_id": 1, "employee_name": 1},
    ).to_list(100)
    name_by = {d["employee_id"]: d.get("employee_name") for d in name_docs}
    names = [name_by.get(o["employee_id"]) or o["employee_id"] for o in conflicts]
    return (
        "⚠️ Incompatibilité : ce quart chevauche celui de " + ", ".join(sorted(set(names))) +
        " dans la même succursale — ces employés ne doivent pas travailler ensemble. Le quart a tout de même été enregistré."
    )


@router.get("")
async def list_calendar_shifts(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    docs = await db.shifts.find({"pharmacy_id": pid}, {"_id": 0}).to_list(10000)
    settings = await db.schedule_settings.find_one(
        {"pharmacy_id": pid}, {"_id": 0, "shifts_server_ready": 1}
    ) or {}
    return {"shifts": docs, "migrated": bool(settings.get("shifts_server_ready"))}


@router.post("")
async def create_calendar_shift(payload: ShiftIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = shift_doc(payload, pid)
    res = await db.shifts.update_one({"id": doc["id"], "pharmacy_id": pid}, {"$set": doc}, upsert=True)
    await mark_shifts_ready(pid)
    if res.upserted_id is not None and not doc["ai_generated"]:
        await notify_shift_change(pid, doc["employee_id"], "Nouveau quart ajouté",
                                  f"Vous travaillez {fmt_shift_txt(doc)}.", "sky")
    warning = await incompat_warning(pid, doc)
    return {**doc, "incompat_warning": warning}


@router.post("/bulk")
async def bulk_import_shifts(payload: ShiftsBulkIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if len(payload.shifts) > 3000:
        raise HTTPException(status_code=400, detail="Maximum 3000 quarts par import.")
    count = 0
    for s in payload.shifts:
        doc = shift_doc(s, pid)
        await db.shifts.update_one({"id": doc["id"], "pharmacy_id": pid}, {"$set": doc}, upsert=True)
        count += 1
    await mark_shifts_ready(pid)
    await log_audit(
        principal["email"], principal["role"], "IMPORT_QUARTS", "horaire", pid,
        f"Synchronisation initiale du calendrier : {count} quart(s) importés", pid,
    )
    return {"imported": count}


@router.put("/{shift_id}")
async def update_calendar_shift(shift_id: str, payload: ShiftPatchIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.shifts.find_one({"id": shift_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Quart introuvable.")
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "employee_name" in patch:
        patch["employee_name"] = (patch["employee_name"] or "")[:80]
    validate_shift_core(patch.get("date", doc["date"]), patch.get("start", doc["start"]), patch.get("end", doc["end"]))
    if "department" in patch and patch["department"] not in DEPARTMENTS_BE:
        patch["department"] = "Général"
    if "resource_ids" in patch:
        patch["resource_ids"] = [str(r) for r in patch["resource_ids"]][:20]
    if "station" in patch:
        patch["station"] = (patch["station"] or "")[:80]
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.shifts.update_one({"id": shift_id, "pharmacy_id": pid}, {"$set": patch})
    await mark_shifts_ready(pid)
    merged = {**doc, **patch}
    relevant = any(
        patch.get(k) is not None and patch[k] != doc.get(k)
        for k in ("date", "start", "end", "department", "employee_id", "station")
    )
    if relevant:
        if patch.get("employee_id") and patch["employee_id"] != doc["employee_id"]:
            await notify_shift_change(pid, doc["employee_id"], "Quart retiré",
                                      f"Votre quart {fmt_shift_txt(doc)} a été réassigné.", "red")
            await notify_shift_change(pid, merged["employee_id"], "Nouveau quart ajouté",
                                      f"Vous travaillez {fmt_shift_txt(merged)}.", "sky")
        else:
            await notify_shift_change(
                pid, doc["employee_id"], "Quart modifié",
                f"Avant : {fmt_shift_txt(doc)} → maintenant : {fmt_shift_txt(merged)}.", "amber",
            )
    warning = await incompat_warning(pid, merged)
    return {**merged, "incompat_warning": warning}


@router.delete("/{shift_id}")
async def delete_calendar_shift(shift_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.shifts.find_one({"id": shift_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        await mark_shifts_ready(pid)
        raise HTTPException(status_code=404, detail="Quart introuvable.")
    await db.shifts.delete_one({"id": shift_id, "pharmacy_id": pid})
    await mark_shifts_ready(pid)
    if not doc.get("ai_generated"):
        await notify_shift_change(
            pid, doc["employee_id"], "Quart retiré",
            f"Votre quart {fmt_shift_txt(doc)} a été retiré de l'horaire.", "red",
        )
    return {"status": "supprimé"}
