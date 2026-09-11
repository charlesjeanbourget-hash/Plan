"""Pointage des heures — extraits de server.py."""
import hashlib
import math
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from core.config import db
from core.security import (
    LOCKOUT_ATTEMPTS,
    LOCKOUT_MINUTES,
    client_ip,
    get_current_user,
    get_principal,
    log_audit,
    scoped_pid,
)

MONTREAL_TZ = ZoneInfo("America/Montreal")

punch_router = APIRouter(prefix="/punch", tags=["punch"])
punches_router = APIRouter(prefix="/punches", tags=["punches"])


def hash_punch_code(code: str) -> str:
    pepper = os.environ["PUNCH_PEPPER"]
    return hashlib.sha256(f"{pepper}:{code}".encode("utf-8")).hexdigest()


class PunchCodeIn(BaseModel):
    code: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None


class PunchGeoIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None


class ManualPunchIn(BaseModel):
    employee_id: str
    employee_name: str
    date: str
    start_time: str
    end_time: str
    note: str = ""


class PunchUpdateIn(BaseModel):
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    note: Optional[str] = None


class PunchSettingsIn(BaseModel):
    rounding_minutes: int = 0
    rounding_mode: str = "nearest"
    breaks_paid: bool = False


def geo_dict(lat, lng, accuracy):
    if lat is None or lng is None:
        return None
    return {"lat": lat, "lng": lng, "accuracy": accuracy}


def local_iso(date_str: str, time_str: str) -> str:
    try:
        return datetime.fromisoformat(f"{date_str}T{time_str}:00").replace(tzinfo=MONTREAL_TZ).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date ou heure invalide.")


async def get_punch_settings(pid: str) -> dict:
    doc = await db.punch_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    return {
        "rounding_minutes": int(doc.get("rounding_minutes") or 0),
        "rounding_mode": doc.get("rounding_mode") or "nearest",
        "breaks_paid": bool(doc.get("breaks_paid")),
    }


def _round_dt(dt: datetime, minutes: int, mode: str) -> datetime:
    if minutes <= 0:
        return dt
    secs = minutes * 60
    ts = dt.timestamp()
    if mode == "up":
        rounded = math.ceil(ts / secs) * secs
    elif mode == "down":
        rounded = math.floor(ts / secs) * secs
    else:
        rounded = round(ts / secs) * secs
    return datetime.fromtimestamp(rounded, tz=timezone.utc)


def punch_break_minutes(p: dict) -> float:
    total = 0.0
    for b in (p.get("breaks") or []):
        if b.get("start") and b.get("end"):
            total += (datetime.fromisoformat(b["end"]) - datetime.fromisoformat(b["start"])).total_seconds() / 60
    return round(total, 1)


def punch_hours(p: dict, settings: dict) -> float:
    if not p.get("punch_out"):
        return 0.0
    m = int(settings.get("rounding_minutes") or 0)
    mode = settings.get("rounding_mode") or "nearest"
    t_in = _round_dt(datetime.fromisoformat(p["punch_in"]), m, mode)
    t_out = _round_dt(datetime.fromisoformat(p["punch_out"]), m, mode)
    h = max(0.0, (t_out - t_in).total_seconds() / 3600)
    if not settings.get("breaks_paid"):
        h = max(0.0, h - punch_break_minutes(p) / 60)
    return h


async def do_punch(pharmacy_id, employee_id, employee_name, source, actor, location=None) -> dict:
    now = datetime.now(timezone.utc)
    open_p = await db.punches.find_one(
        {"pharmacy_id": pharmacy_id, "employee_id": employee_id, "punch_out": None}, {"_id": 0}
    )
    if open_p:
        breaks = open_p.get("breaks") or []
        if breaks and not breaks[-1].get("end"):
            breaks[-1]["end"] = now.isoformat()
        await db.punches.update_one(
            {"id": open_p["id"]},
            {"$set": {"punch_out": now.isoformat(), "punch_out_location": location, "breaks": breaks}},
        )
        settings = await get_punch_settings(pharmacy_id)
        duration = round(punch_hours({**open_p, "punch_out": now.isoformat(), "breaks": breaks}, settings), 2)
        break_mins = punch_break_minutes({"breaks": breaks})
        await log_audit(
            actor, "system" if source == "punch" else "admin", "PUNCH_SORTIE", "punch", open_p["id"],
            f"{employee_name} — sortie ({duration} h{f', pauses {break_mins:g} min' if break_mins else ''})",
            pharmacy_id,
        )
        return {
            "action": "out", "employee_name": employee_name, "time": now.isoformat(),
            "punch_in": open_p["punch_in"], "duration_hours": duration, "break_minutes": break_mins,
        }
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pharmacy_id, "employee_id": employee_id,
        "employee_name": employee_name, "date": now.astimezone(MONTREAL_TZ).date().isoformat(),
        "punch_in": now.isoformat(), "punch_out": None, "source": source,
        "created_by": actor, "note": "", "punch_in_location": location, "punch_out_location": None,
    }
    await db.punches.insert_one({**doc})
    await log_audit(
        actor, "system" if source == "punch" else "admin", "PUNCH_ENTREE", "punch", doc["id"],
        f"{employee_name} — entrée", pharmacy_id,
    )
    return {"action": "in", "employee_name": employee_name, "time": now.isoformat()}


async def do_break(pid, employee_id, employee_name, actor) -> dict:
    open_p = await db.punches.find_one(
        {"pharmacy_id": pid, "employee_id": employee_id, "punch_out": None}, {"_id": 0}
    )
    if not open_p:
        raise HTTPException(status_code=400, detail="Aucun quart en cours — punchez votre entrée d'abord.")
    breaks = open_p.get("breaks") or []
    now = datetime.now(timezone.utc)
    if breaks and not breaks[-1].get("end"):
        mins = round((now - datetime.fromisoformat(breaks[-1]["start"])).total_seconds() / 60)
        breaks[-1]["end"] = now.isoformat()
        action, detail = "break_end", f"{employee_name} — fin de pause ({mins} min)"
    else:
        breaks.append({"start": now.isoformat(), "end": None})
        action, detail = "break_start", f"{employee_name} — début de pause"
    await db.punches.update_one({"id": open_p["id"]}, {"$set": {"breaks": breaks}})
    await log_audit(actor, "system", "PUNCH_PAUSE", "punch", open_p["id"], detail, pid)
    return {"action": action, "employee_name": employee_name, "time": now.isoformat()}


async def punch_throttle_check(request: Request) -> str:
    ip = client_ip(request)
    identifier = f"punch:{ip}"
    now = datetime.now(timezone.utc)
    attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    if attempt and attempt.get("locked_until") and datetime.fromisoformat(attempt["locked_until"]) > now:
        raise HTTPException(
            status_code=429,
            detail="Trop de NIP invalides. Borne verrouillée quelques minutes — contactez l'administration.",
            headers={"Retry-After": str(LOCKOUT_MINUTES * 60)},
        )
    return identifier


async def resolve_punch_code(code: str, identifier: str) -> dict:
    if len(code) != 4 or not code.isdigit():
        raise HTTPException(status_code=400, detail="NIP invalide (4 chiffres).")
    prof = await db.employee_profiles.find_one({"punch_code_hash": hash_punch_code(code)}, {"_id": 0})
    if not prof:
        now = datetime.now(timezone.utc)
        attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
        count = (attempt.get("count", 0) if attempt else 0) + 1
        update = {"identifier": identifier, "count": count, "updated_at": now.isoformat()}
        if count >= LOCKOUT_ATTEMPTS:
            update["locked_until"] = (now + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
            update["count"] = 0
        await db.login_attempts.update_one({"identifier": identifier}, {"$set": update}, upsert=True)
        raise HTTPException(status_code=404, detail="NIP inconnu. Vérifiez votre code ou contactez l'administration.")
    await db.login_attempts.delete_one({"identifier": identifier})
    return prof


@punch_router.post("/preview")
async def punch_preview(payload: PunchCodeIn, request: Request):
    identifier = await punch_throttle_check(request)
    prof = await resolve_punch_code(payload.code.strip(), identifier)
    open_p = await db.punches.find_one(
        {"pharmacy_id": prof["pharmacy_id"], "employee_id": prof["employee_id"], "punch_out": None}, {"_id": 0}
    )
    full_name = (prof.get("employee_name", "") or "").strip()
    parts = full_name.split()
    display = f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else full_name
    breaks = (open_p.get("breaks") or []) if open_p else []
    on_break = bool(breaks and not breaks[-1].get("end"))
    return {
        "employee_name": display,
        "next_action": "out" if open_p else "in",
        "since": open_p["punch_in"] if open_p else None,
        "on_break": on_break,
        "break_since": breaks[-1]["start"] if on_break else None,
    }


@punch_router.post("")
async def punch_by_code(payload: PunchCodeIn, request: Request):
    identifier = await punch_throttle_check(request)
    prof = await resolve_punch_code(payload.code.strip(), identifier)
    return await do_punch(
        prof["pharmacy_id"], prof["employee_id"], prof.get("employee_name", ""), "punch", "borne",
        geo_dict(payload.lat, payload.lng, payload.accuracy),
    )


@punch_router.post("/me")
async def punch_me(payload: Optional[PunchGeoIn] = None, user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à votre compte.")
    location = geo_dict(payload.lat, payload.lng, payload.accuracy) if payload else None
    return await do_punch(user.get("pharmacy_id") or "", user["employee_id"], user["name"], "punch", user["email"], location)


@punch_router.get("/me/status")
async def punch_me_status(user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        return {"open": None, "today_hours": 0, "today_entries": []}
    pid = user.get("pharmacy_id") or ""
    open_p = await db.punches.find_one(
        {"pharmacy_id": pid, "employee_id": user["employee_id"], "punch_out": None}, {"_id": 0}
    )
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    entries = await db.punches.find(
        {"pharmacy_id": pid, "employee_id": user["employee_id"], "date": today}, {"_id": 0}
    ).sort("punch_in", 1).to_list(50)
    settings = await get_punch_settings(pid)
    hours = sum(punch_hours(p, settings) for p in entries)
    return {
        "open": open_p,
        "today_hours": round(hours, 2),
        "today_entries": entries,
        "on_break": bool(open_p and (open_p.get("breaks") or []) and not (open_p["breaks"][-1].get("end"))),
    }


@punch_router.get("/settings")
async def read_punch_settings(principal: dict = Depends(get_principal)):
    return await get_punch_settings(scoped_pid(principal))


@punch_router.put("/settings")
async def write_punch_settings(payload: PunchSettingsIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if payload.rounding_minutes not in (0, 5, 10, 15):
        raise HTTPException(status_code=400, detail="Arrondi permis : 0, 5, 10 ou 15 minutes.")
    if payload.rounding_mode not in ("nearest", "up", "down"):
        raise HTTPException(status_code=400, detail="Mode d'arrondi invalide.")
    await db.punch_settings.update_one(
        {"pharmacy_id": pid},
        {"$set": {
            "pharmacy_id": pid,
            "rounding_minutes": payload.rounding_minutes,
            "rounding_mode": payload.rounding_mode,
            "breaks_paid": payload.breaks_paid,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    mode_txt = {"nearest": "au plus proche", "up": "vers le haut", "down": "vers le bas"}[payload.rounding_mode]
    await log_audit(
        principal["email"], principal["role"], "REGLAGES_PUNCH", "punch", pid,
        f"Arrondi {payload.rounding_minutes} min ({mode_txt}), pauses {'payées' if payload.breaks_paid else 'non payées'}",
        pid,
    )
    return await get_punch_settings(pid)


@punch_router.post("/break")
async def punch_break_by_code(payload: PunchCodeIn, request: Request):
    identifier = await punch_throttle_check(request)
    prof = await resolve_punch_code(payload.code.strip(), identifier)
    return await do_break(prof["pharmacy_id"], prof["employee_id"], prof.get("employee_name", ""), "borne")


@punch_router.post("/me/break")
async def punch_break_me(user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à votre compte.")
    return await do_break(user.get("pharmacy_id") or "", user["employee_id"], user["name"], user["email"])


@punches_router.get("")
async def list_punches(
    start: str = Query(...), end: str = Query(...),
    employee_id: Optional[str] = Query(None), principal: dict = Depends(get_principal),
):
    pid = scoped_pid(principal)
    query: dict = {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}
    if employee_id:
        query["employee_id"] = employee_id
    return await db.punches.find(query, {"_id": 0}).sort([("date", -1), ("punch_in", -1)]).to_list(2000)


@punches_router.post("/manual")
async def add_manual_punch(payload: ManualPunchIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    p_in, p_out = local_iso(payload.date, payload.start_time), local_iso(payload.date, payload.end_time)
    if p_out <= p_in:
        raise HTTPException(status_code=400, detail="L'heure de fin doit être après l'heure de début.")
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": payload.employee_id,
        "employee_name": payload.employee_name, "date": payload.date,
        "punch_in": p_in, "punch_out": p_out, "source": "manual",
        "created_by": principal["email"], "note": payload.note,
    }
    await db.punches.insert_one({**doc})
    await log_audit(
        principal["email"], principal["role"], "SAISIE_HEURES_MANUELLE", "punch", doc["id"],
        f"{payload.employee_name} — {payload.date} {payload.start_time}-{payload.end_time} ({payload.note or 'sans note'})",
        pid,
    )
    return doc


@punches_router.put("/{punch_id}")
async def update_punch(punch_id: str, payload: PunchUpdateIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.punches.find_one({"id": punch_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Entrée introuvable.")
    d = payload.date or doc["date"]
    patch: dict = {"date": d}
    if payload.start_time:
        patch["punch_in"] = local_iso(d, payload.start_time)
    if payload.end_time:
        patch["punch_out"] = local_iso(d, payload.end_time)
    if payload.note is not None:
        patch["note"] = payload.note
    if patch.get("punch_out") and patch.get("punch_in") and patch["punch_out"] <= patch["punch_in"]:
        raise HTTPException(status_code=400, detail="L'heure de fin doit être après l'heure de début.")
    await db.punches.update_one({"id": punch_id}, {"$set": patch})
    await log_audit(
        principal["email"], principal["role"], "CORRECTION_HEURES", "punch", punch_id,
        f"{doc['employee_name']} — entrée corrigée ({d})", pid,
    )
    return {**doc, **patch}


@punches_router.delete("/{punch_id}")
async def delete_punch(punch_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.punches.find_one({"id": punch_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Entrée introuvable.")
    await db.punches.delete_one({"id": punch_id})
    await log_audit(
        principal["email"], principal["role"], "SUPPRESSION_HEURES", "punch", punch_id,
        f"{doc['employee_name']} — entrée du {doc['date']} supprimée", pid,
    )
    return {"status": "supprimée"}
