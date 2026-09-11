"""Opérations annexes congés : vider les quarts, ouvrir un remplacement."""
import logging
import os
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from core.config import db
from routers.shifts import DEPARTMENTS_BE, mark_shifts_ready

logger = logging.getLogger(__name__)


def inclusive_dates(start: str, end: str) -> list:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    out = []
    cur = s
    while cur <= e:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


async def notify_admins(pid: str, title: str, detail: str, module: str = "vacations", tone: str = "amber"):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_roles": ["admin", "manager"],
        "title": title, "detail": detail, "module": module, "icon": "leave",
        "tone": tone, "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def vacate_shifts_for_leave(pid: str, leave_doc: dict, actor: str) -> dict:
    days = inclusive_dates(leave_doc["start_date"], leave_doc["end_date"])
    shifts = await db.shifts.find(
        {"pharmacy_id": pid, "employee_id": leave_doc["employee_id"], "date": {"$in": days}},
        {"_id": 0},
    ).to_list(500)
    opened = []
    for sh in shifts:
        os_doc = {
            "id": str(uuid.uuid4()), "pharmacy_id": pid, "date": sh["date"],
            "start": sh.get("start") or "09:00", "end": sh.get("end") or "17:00",
            "department": sh.get("department") if sh.get("department") in DEPARTMENTS_BE else "Général",
            "branch_id": sh.get("branch_id") or "", "positions": [],
            "note": (
                f"Libéré : congé {leave_doc.get('type') or ''} de "
                f"{leave_doc.get('employee_name') or leave_doc['employee_id']}"
            ),
            "status": "open", "mode": "premier_arrive", "applicants": [],
            "claimed_by": None, "claimed_by_name": None, "claimed_at": None,
            "created_by": actor, "created_at": datetime.now(timezone.utc).isoformat(),
            "source_leave_id": leave_doc.get("id"), "source_shift_id": sh.get("id"),
        }
        await db.open_shifts.insert_one({**os_doc})
        opened.append(os_doc)
        await db.shifts.delete_one({"id": sh["id"], "pharmacy_id": pid})
    if shifts:
        await mark_shifts_ready(pid)
        await notify_admins(
            pid, "Quarts libérés par un congé",
            f"{leave_doc.get('employee_name') or leave_doc['employee_id']} : {len(opened)} quart(s) ouvert(s) "
            f"du {leave_doc['start_date']} au {leave_doc['end_date']}.",
            module="scheduling", tone="amber",
        )
    return {"removed": len(shifts), "open_shifts": len(opened)}


async def auto_replacement_for_leave(pid: str, leave_doc: dict, actor: str) -> Optional[dict]:
    prof = await db.employee_profiles.find_one(
        {"pharmacy_id": pid, "employee_id": leave_doc["employee_id"]},
        {"_id": 0, "roles": 1, "department": 1},
    ) or {}
    role = (prof.get("roles") or ["ATP"])[0] if (prof.get("roles") or ["ATP"]) else "ATP"
    agencies = await db.agencies.find(
        {"$or": [{"pharmacy_id": pid}, {"pharmacy_id": ""}, {"global": True}], "roles": role},
        {"_id": 0, "id": 1},
    ).to_list(5)
    partners = await db.global_partners.find({"roles": role}, {"_id": 0, "id": 1}).to_list(5)
    if not agencies and not partners:
        return None
    days = inclusive_dates(leave_doc["start_date"], leave_doc["end_date"])
    vacated = await db.open_shifts.find(
        {"pharmacy_id": pid, "source_leave_id": leave_doc.get("id")}, {"_id": 0}
    ).to_list(50)
    if vacated:
        slots = [{"date": s["date"], "start": s["start"], "end": s["end"]} for s in vacated]
    else:
        slots = [{"date": d, "start": "09:00", "end": "17:00"} for d in days[:14]]
    token = secrets.token_urlsafe(24)
    base = os.environ.get("PUBLIC_APP_URL", "https://arriereplanrh.com")
    link = f"{base.rstrip('/')}/?remplacement={token}"
    now = datetime.now(timezone.utc).isoformat()
    notes = f"Congé {leave_doc.get('type') or ''} — {leave_doc.get('employee_name') or leave_doc['employee_id']}"
    urgency = "Urgente" if len(days) <= 3 else "Normale"
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "role": str(role)[:60],
        "slots": slots, "notes": notes, "urgency": urgency, "status": "open",
        "token": token, "link": link, "chosen_offer_id": None, "emails_sent": 0,
        "source_leave_id": leave_doc.get("id"), "created_by": actor,
        "created_at": now, "updated_at": now,
    }
    await db.replacement_requests.insert_one({**doc})
    await notify_admins(
        pid, "Demande de remplacement ouverte",
        f"{doc['role']} — {len(slots)} plage(s) suite au congé de "
        f"{leave_doc.get('employee_name') or leave_doc['employee_id']}.",
        module="replacements", tone="sky",
    )
    return {"id": doc["id"], "link": link, "role": doc["role"], "slots": len(slots)}
