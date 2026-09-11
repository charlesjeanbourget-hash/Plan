"""Tâches par quart — extraits de server.py."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid

router = APIRouter(prefix="/tasks", tags=["tasks"])


class ShiftTaskIn(BaseModel):
    date: str
    shift: str = "Jour"
    title: str
    description: str = ""
    assignee_employee_id: str = ""
    assignee_name: str = ""
    recurring: bool = False
    competences: list[str] = []


class TaskCopyWeekIn(BaseModel):
    from_start: str
    to_start: str


class TaskRecurringIn(BaseModel):
    recurring: bool


async def materialize_recurring_tasks(pid: str, start: str, end: str) -> None:
    try:
        start_d = datetime.fromisoformat(start).date()
        end_d = datetime.fromisoformat(end).date()
    except ValueError:
        return
    if (end_d - start_d).days > 31 or end_d < start_d:
        return
    series_docs = await db.shift_tasks.find(
        {"pharmacy_id": pid, "series_id": {"$nin": ["", None]}}, {"_id": 0}
    ).to_list(2000)
    templates: dict = {}
    for d in series_docs:
        cur = templates.get(d["series_id"])
        if not cur or d["date"] > cur["date"]:
            templates[d["series_id"]] = d
    for sid, tpl in templates.items():
        if not tpl.get("recurring"):
            continue
        tpl_date = datetime.fromisoformat(tpl["date"]).date()
        day = start_d
        while day <= end_d:
            if day.weekday() == tpl_date.weekday() and day > tpl_date:
                exists = await db.shift_tasks.find_one({"series_id": sid, "date": day.isoformat()})
                if not exists:
                    await db.shift_tasks.insert_one({
                        **tpl, "id": str(uuid.uuid4()), "date": day.isoformat(),
                        "done": False, "done_by": "", "done_at": None,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
            day += timedelta(days=1)


@router.get("")
async def list_tasks(start: str = Query(...), end: str = Query(...), user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    await materialize_recurring_tasks(pid, start, end)
    query: dict = {"date": {"$gte": start, "$lte": end}, "pharmacy_id": pid}
    if user["role"] not in ("admin", "manager", "superadmin"):
        eid = user.get("employee_id") or ""
        query["$or"] = [{"assignee_employee_id": eid}, {"assignee_employee_id": ""}]
    return await db.shift_tasks.find(query, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(500)


@router.post("")
async def create_task(payload: ShiftTaskIn, principal: dict = Depends(get_principal)):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Le titre de la tâche est requis.")
    competences = [str(c).strip() for c in (payload.competences or []) if str(c).strip()][:10]
    task_id = str(uuid.uuid4())
    doc = {
        "id": task_id,
        "pharmacy_id": scoped_pid(principal),
        "date": payload.date,
        "shift": payload.shift,
        "title": payload.title.strip(),
        "description": payload.description.strip(),
        "assignee_employee_id": payload.assignee_employee_id,
        "assignee_name": payload.assignee_name,
        "recurring": payload.recurring,
        "series_id": task_id if payload.recurring else "",
        "competences": competences,
        "qualification_warning": False,
        "done": False,
        "done_by": "",
        "done_at": None,
        "created_by": principal["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.shift_tasks.insert_one(doc)
    doc.pop("_id", None)
    await log_audit(
        principal["email"], principal["role"], "CREATION_TACHE", "tâche", doc["id"],
        f"Tâche « {doc['title']} » ({doc['date']}, quart {doc['shift']})", doc["pharmacy_id"],
    )
    return doc


@router.post("/copy-week")
async def copy_week_tasks(payload: TaskCopyWeekIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    from_start = datetime.fromisoformat(payload.from_start).date()
    from_end = from_start + timedelta(days=6)
    to_start = datetime.fromisoformat(payload.to_start).date()
    delta = (to_start - from_start).days
    docs = await db.shift_tasks.find(
        {"pharmacy_id": pid, "date": {"$gte": from_start.isoformat(), "$lte": from_end.isoformat()}},
        {"_id": 0},
    ).to_list(500)
    created = 0
    for d in docs:
        new_date = (datetime.fromisoformat(d["date"]).date() + timedelta(days=delta)).isoformat()
        exists = await db.shift_tasks.find_one(
            {"pharmacy_id": pid, "date": new_date, "shift": d["shift"], "title": d["title"]}
        )
        if exists:
            continue
        await db.shift_tasks.insert_one({
            **d, "id": str(uuid.uuid4()), "date": new_date, "done": False, "done_by": "", "done_at": None,
            "created_by": principal["email"], "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created += 1
    await log_audit(
        principal["email"], principal["role"], "DUPLICATION_TACHES", "tâche", payload.to_start,
        f"{created} tâche(s) copiée(s) de la semaine du {payload.from_start}", pid,
    )
    return {"created": created}


@router.post("/{task_id}/toggle")
async def toggle_task(task_id: str, user: dict = Depends(get_current_user)):
    doc = await db.shift_tasks.find_one({"id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    if user["role"] not in ("admin", "manager", "superadmin"):
        eid = user.get("employee_id") or ""
        if doc["assignee_employee_id"] not in ("", eid):
            raise HTTPException(status_code=403, detail="Cette tâche est assignée à un autre employé.")
    new_done = not doc["done"]
    update = {
        "done": new_done,
        "done_by": (user.get("name") or user["email"]) if new_done else "",
        "done_at": datetime.now(timezone.utc).isoformat() if new_done else None,
    }
    await db.shift_tasks.update_one({"id": task_id}, {"$set": update})
    return {**doc, **update}


@router.delete("/{task_id}")
async def delete_task(task_id: str, principal: dict = Depends(get_principal)):
    doc = await db.shift_tasks.find_one({"id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    await db.shift_tasks.delete_one({"id": task_id})
    series_stopped = False
    if doc.get("series_id"):
        await db.shift_tasks.update_many({"series_id": doc["series_id"]}, {"$set": {"recurring": False}})
        series_stopped = bool(doc.get("recurring"))
    await log_audit(
        principal["email"], principal["role"], "SUPPRESSION_TACHE", "tâche", task_id,
        f"Tâche « {doc['title']} » supprimée", doc["pharmacy_id"],
    )
    return {"status": "supprimée", "series_stopped": series_stopped}


@router.put("/{task_id}/recurring")
async def set_task_recurring(task_id: str, payload: TaskRecurringIn, principal: dict = Depends(get_principal)):
    doc = await db.shift_tasks.find_one({"id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    sid = doc.get("series_id") or doc["id"]
    await db.shift_tasks.update_many(
        {"$or": [{"series_id": sid}, {"id": task_id}]},
        {"$set": {"recurring": payload.recurring, "series_id": sid}},
    )
    await log_audit(
        principal["email"], principal["role"], "RECURRENCE_TACHE", "tâche", task_id,
        f"Récurrence hebdomadaire {'activée' if payload.recurring else 'désactivée'} pour « {doc['title']} »",
        doc["pharmacy_id"],
    )
    return {**doc, "recurring": payload.recurring, "series_id": sid}
