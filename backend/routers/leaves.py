"""Congés — extraits de server.py."""
import logging
import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid
from routers.leave_ops import auto_replacement_for_leave, vacate_shifts_for_leave
from routers.shifts import notify_shift_change

logger = logging.getLogger(__name__)
MONTREAL_TZ = ZoneInfo("America/Montreal")
LEAVE_TYPES_BE = ("Vacances", "Maladie", "Mobile", "Personnel", "Formation")
LEAVE_ALLOC_TYPES = ("Vacances", "Maladie", "Mobile")

router = APIRouter(prefix="/leave", tags=["leave"])


class LeaveRequestIn(BaseModel):
    employee_id: str = ""
    employee_name: str = ""
    type: str
    start_date: str
    end_date: str
    reason: str = ""


class LeaveDecideIn(BaseModel):
    action: str
    note: str = ""


class LeaveAllocationsIn(BaseModel):
    employee_name: str = ""
    allocations: dict


def leave_days(start: str, end: str) -> float:
    return float((date.fromisoformat(end) - date.fromisoformat(start)).days + 1)


def validate_leave_dates(start: str, end: str) -> None:
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Dates invalides (AAAA-MM-JJ).")
    if e < s:
        raise HTTPException(status_code=400, detail="La date de fin doit être après le début.")
    if (e - s).days > 365:
        raise HTTPException(status_code=400, detail="Durée maximale : 365 jours.")


async def mark_leaves_ready(pid: str) -> None:
    await db.schedule_settings.update_one(
        {"pharmacy_id": pid}, {"$set": {"pharmacy_id": pid, "leaves_server_ready": True}}, upsert=True
    )


async def notify_admins(pid: str, title: str, detail: str, module: str = "vacations", tone: str = "amber"):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_roles": ["admin", "manager", "superadmin"],
        "title": title, "detail": detail, "module": module, "icon": "leave",
        "tone": tone, "created_at": datetime.now(timezone.utc).isoformat(),
    })


def leave_admin_view(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "pharmacy_id"}


def leave_own_view(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("pharmacy_id", "history")}


async def leave_remaining(pid: str, employee_id: str, ltype: str):
    bal = await db.leave_balances.find_one({"pharmacy_id": pid, "employee_id": employee_id}, {"_id": 0}) or {}
    alloc = (bal.get("allocations") or {}).get(ltype)
    if alloc is None:
        return None
    year = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).year
    carry_doc = bal.get("carryover") or {}
    extra = float((carry_doc.get("days") or {}).get(ltype, 0) or 0) if carry_doc.get("year") == year else 0.0
    docs = await db.leave_requests.find(
        {
            "pharmacy_id": pid, "employee_id": employee_id, "type": ltype, "status": "Approuvée",
            "start_date": {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"},
        },
        {"_id": 0, "days": 1},
    ).to_list(500)
    used = sum(float(d.get("days") or 0) for d in docs)
    return round(float(alloc) + extra - used, 2)


@router.post("/requests")
async def create_leave_request(payload: LeaveRequestIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    employee_id = payload.employee_id if (is_admin and payload.employee_id) else (user.get("employee_id") or "")
    if not employee_id:
        raise HTTPException(status_code=400, detail="Aucun employé associé à ce compte.")
    if payload.type not in LEAVE_TYPES_BE:
        raise HTTPException(status_code=400, detail="Type de congé invalide.")
    validate_leave_dates(payload.start_date, payload.end_date)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": employee_id,
        "employee_name": payload.employee_name.strip()[:80],
        "type": payload.type, "start_date": payload.start_date, "end_date": payload.end_date,
        "days": leave_days(payload.start_date, payload.end_date),
        "reason": payload.reason.strip()[:1000],
        "status": "En attente", "created_at": now, "decided_at": None, "decided_by": "",
        "history": [{"action": "soumission", "by": user["email"], "role": user["role"], "at": now}],
    }
    await db.leave_requests.insert_one({**doc})
    await mark_leaves_ready(pid)
    await notify_admins(
        pid, "Nouvelle demande de congé",
        f"{doc['employee_name'] or employee_id} — {doc['type']}, du {doc['start_date']} "
        f"au {doc['end_date']} ({doc['days']:g} j) — à approuver",
    )
    await log_audit(
        user["email"], user["role"], "CONGE_SOUMIS", "conge", doc["id"],
        f"Demande {doc['type']} du {doc['start_date']} au {doc['end_date']} "
        f"pour {doc['employee_name'] or employee_id}", pid,
    )
    return leave_own_view(doc)


@router.get("/requests")
async def list_leave_requests(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    if user["role"] in ("admin", "manager", "superadmin"):
        docs = await db.leave_requests.find({"pharmacy_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return [leave_admin_view(d) for d in docs]
    eid = user.get("employee_id") or "__none__"
    docs = await db.leave_requests.find(
        {"pharmacy_id": pid, "employee_id": eid}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return [leave_own_view(d) for d in docs]


@router.post("/requests/{req_id}/decide")
async def decide_leave_request(req_id: str, payload: LeaveDecideIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if payload.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Action invalide (approve ou reject).")
    doc = await db.leave_requests.find_one({"id": req_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    if doc["status"] != "En attente":
        raise HTTPException(status_code=400, detail="Cette demande a déjà été traitée.")
    now = datetime.now(timezone.utc).isoformat()
    status = "Approuvée" if payload.action == "approve" else "Refusée"
    note = payload.note.strip()[:300]
    entry = {
        "action": "approbation" if payload.action == "approve" else "refus",
        "by": principal["email"], "role": principal["role"], "at": now, "note": note,
    }
    await db.leave_requests.update_one(
        {"id": req_id, "pharmacy_id": pid},
        {"$set": {"status": status, "decided_at": now, "decided_by": principal["email"]},
         "$push": {"history": entry}},
    )
    await notify_shift_change(
        pid, doc["employee_id"], f"Demande de congé {status.lower()}",
        f"Votre demande du {doc['start_date']} au {doc['end_date']} a été {status.lower()}."
        + (f" Note : {note}" if note else ""),
        "emerald" if status == "Approuvée" else "red", module="vacations", icon="leave",
    )
    remaining = await leave_remaining(pid, doc["employee_id"], doc["type"]) if status == "Approuvée" else None
    gaps = {"removed": 0, "open_shifts": 0}
    replacement = None
    if status == "Approuvée":
        gaps = await vacate_shifts_for_leave(pid, doc, principal["email"])
        if gaps.get("open_shifts"):
            try:
                replacement = await auto_replacement_for_leave(pid, doc, principal["email"])
            except Exception as exc:
                logger.error(f"Auto-remplacement congé {req_id} : {exc}")
    await log_audit(
        principal["email"], principal["role"],
        "CONGE_APPROUVE" if status == "Approuvée" else "CONGE_REFUSE", "conge", req_id,
        f"Demande {doc['type']} du {doc['start_date']} au {doc['end_date']} de "
        f"{doc.get('employee_name') or doc['employee_id']} : {status}"
        + (f" — {gaps['open_shifts']} quart(s) ouvert(s)" if gaps.get("open_shifts") else ""), pid,
    )
    return {"status": status, "remaining": remaining, "gaps": gaps, "replacement": replacement}


@router.delete("/requests/{req_id}")
async def cancel_leave_request(req_id: str, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.leave_requests.find_one({"id": req_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    if not is_admin and doc["employee_id"] != (user.get("employee_id") or ""):
        raise HTTPException(status_code=403, detail="Accès refusé.")
    if doc["status"] != "En attente" and not is_admin:
        raise HTTPException(status_code=400, detail="Seules les demandes en attente peuvent être annulées.")
    now = datetime.now(timezone.utc).isoformat()
    await db.leave_requests.update_one(
        {"id": req_id, "pharmacy_id": pid},
        {"$set": {"status": "Annulée"},
         "$push": {"history": {"action": "annulation", "by": user["email"], "role": user["role"], "at": now}}},
    )
    await log_audit(
        user["email"], user["role"], "CONGE_ANNULE", "conge", req_id,
        f"Demande du {doc['start_date']} au {doc['end_date']} annulée", pid,
    )
    return {"status": "Annulée"}


@router.get("/absences")
async def list_leave_absences(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    settings = await db.schedule_settings.find_one(
        {"pharmacy_id": pid}, {"_id": 0, "leaves_server_ready": 1}
    ) or {}
    docs = await db.leave_requests.find({"pharmacy_id": pid, "status": "Approuvée"}, {"_id": 0}).to_list(3000)
    items = [{
        "id": d["id"], "employee_id": d["employee_id"], "employee_name": d.get("employee_name", ""),
        "start_date": d["start_date"], "end_date": d["end_date"],
        "type": d["type"] if is_admin else "Absence",
    } for d in docs]
    return {"items": items, "migrated": bool(settings.get("leaves_server_ready"))}


@router.get("/balances")
async def list_leave_balances(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    eid = user.get("employee_id") or "__none__"
    year = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).year
    q: dict = {
        "pharmacy_id": pid, "status": "Approuvée",
        "start_date": {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"},
    }
    bq: dict = {"pharmacy_id": pid}
    if not is_admin:
        q["employee_id"] = eid
        bq["employee_id"] = eid
    approved = await db.leave_requests.find(q, {"_id": 0}).to_list(3000)
    bals = await db.leave_balances.find(bq, {"_id": 0}).to_list(1000)
    used_map: dict = {}
    for d in approved:
        used_map.setdefault(d["employee_id"], {})
        used_map[d["employee_id"]][d["type"]] = used_map[d["employee_id"]].get(d["type"], 0) + float(d.get("days") or 0)
    bal_by = {b["employee_id"]: b for b in bals}
    out = []
    for emp_id in sorted(set(bal_by) | set(used_map)):
        b = bal_by.get(emp_id) or {}
        alloc = b.get("allocations") or {}
        carry_doc = b.get("carryover") or {}
        carry = (carry_doc.get("days") or {}) if carry_doc.get("year") == year else {}
        used = used_map.get(emp_id, {})
        alloc_eff = {t: float(alloc.get(t, 0)) + float(carry.get(t, 0) or 0) for t in LEAVE_ALLOC_TYPES}
        out.append({
            "employee_id": emp_id,
            "employee_name": b.get("employee_name", ""),
            "allocations": alloc_eff,
            "carryover": {t: float(carry.get(t, 0) or 0) for t in LEAVE_ALLOC_TYPES},
            "used": {t: round(used.get(t, 0), 2) for t in LEAVE_ALLOC_TYPES},
            "remaining": {t: round(alloc_eff[t] - used.get(t, 0), 2) for t in LEAVE_ALLOC_TYPES},
            "year": year,
        })
    return out


@router.put("/allocations/{employee_id}")
async def set_leave_allocations(employee_id: str, payload: LeaveAllocationsIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    alloc = {}
    for t, v in (payload.allocations or {}).items():
        if t not in LEAVE_ALLOC_TYPES:
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Allocation invalide.")
        if not (0 <= n <= 365):
            raise HTTPException(status_code=400, detail="Allocation invalide (0 à 365 jours).")
        alloc[t] = round(n, 1)
    await db.leave_balances.update_one(
        {"pharmacy_id": pid, "employee_id": employee_id},
        {"$set": {
            "pharmacy_id": pid, "employee_id": employee_id,
            "employee_name": payload.employee_name.strip()[:80], "allocations": alloc,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"employee_id": employee_id, "allocations": alloc}
