"""Paramètres d'horaire — extraits de server.py."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid
from routers.shifts import DEPARTMENTS_BE

TRAFFIC_DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
TRAFFIC_BLOCKS = {
    "matin": ("Matin (8h-12h)", "08:00", "12:00"),
    "apres_midi": ("Après-midi (12h-17h)", "12:00", "17:00"),
    "soir": ("Soir (17h-21h30)", "17:00", "21:30"),
}

router = APIRouter(prefix="/schedule", tags=["schedule-settings"])


class ScheduleSettingsIn(BaseModel):
    weekly_budget: float = 0
    traffic: dict = {}
    traffic_periods: list | None = None
    dept_budgets: dict | None = None
    branch_budgets: list | None = None
    dept_staffing: dict | None = None
    branch_staffing: list | None = None
    priorities: dict | None = None
    priority_sets: list | None = None
    auto_break: dict | None = None


def sanitize_priorities(pr: dict) -> dict:
    pr = pr or {}
    return {
        "dept_order": [d for d in (pr.get("dept_order") or []) if d in DEPARTMENTS_BE][:6],
        "employee_type": pr.get("employee_type") if pr.get("employee_type") in ("full_time", "part_time") else "",
        "availability": pr.get("availability") if pr.get("availability") in ("most", "least") else "",
        "extra": [x for x in (pr.get("extra") or []) if x in ("seniority", "low_cost", "min_hours_equity")],
    }


def sanitize_traffic(raw: dict) -> dict:
    traffic = {}
    for day in TRAFFIC_DAY_KEYS:
        blocks = (raw or {}).get(day) or {}
        traffic[day] = {b: max(0, min(500, int(float(blocks.get(b) or 0)))) for b in TRAFFIC_BLOCKS}
    return traffic


def settings_out(doc: dict | None) -> dict:
    doc = doc or {}
    return {
        "weekly_budget": doc.get("weekly_budget", 0),
        "traffic": doc.get("traffic", {}),
        "traffic_periods": doc.get("traffic_periods", []),
        "dept_budgets": doc.get("dept_budgets", {}),
        "branch_budgets": doc.get("branch_budgets", []),
        "dept_staffing": doc.get("dept_staffing", {}),
        "branch_staffing": doc.get("branch_staffing", []),
        "priorities": doc.get("priorities", {}),
        "priority_sets": doc.get("priority_sets", []),
        "auto_break": doc.get("auto_break", {"enabled": False, "threshold_hours": 6, "minutes": 30, "paid": False}),
    }


@router.get("/settings")
async def get_schedule_settings(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return settings_out(doc)


@router.put("/settings")
async def set_schedule_settings(payload: ScheduleSettingsIn, principal: dict = Depends(get_principal)):
    if not (0 <= payload.weekly_budget <= 1_000_000):
        raise HTTPException(status_code=400, detail="Budget hebdomadaire invalide.")
    try:
        traffic = sanitize_traffic(payload.traffic)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=400, detail="Valeurs d'achalandage invalides.")
    pid = scoped_pid(principal)
    update = {
        "pharmacy_id": pid, "weekly_budget": round(payload.weekly_budget, 2), "traffic": traffic,
        "updated_by": principal["email"], "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.traffic_periods is not None:
        if len(payload.traffic_periods) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 périodes d'achalandage.")
        periods = []
        for p in payload.traffic_periods:
            if not isinstance(p, dict):
                raise HTTPException(status_code=400, detail="Période invalide.")
            name = str(p.get("name") or "").strip()
            smd, emd = str(p.get("start_md") or ""), str(p.get("end_md") or "")
            if not name or not re.fullmatch(r"\d{2}-\d{2}", smd) or not re.fullmatch(r"\d{2}-\d{2}", emd):
                raise HTTPException(status_code=400, detail="Période invalide : nom et dates (mois-jour) requis.")
            try:
                periods.append({
                    "id": str(p.get("id") or uuid.uuid4()), "name": name[:60],
                    "start_md": smd, "end_md": emd, "traffic": sanitize_traffic(p.get("traffic") or {}),
                })
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(status_code=400, detail="Valeurs d'achalandage invalides dans une période.")
        update["traffic_periods"] = periods
    if payload.dept_budgets is not None:
        dept_map = {}
        for k, v in payload.dept_budgets.items():
            if k not in DEPARTMENTS_BE:
                continue
            try:
                n = float(v)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Budget de département invalide.")
            if not (0 <= n <= 1_000_000):
                raise HTTPException(status_code=400, detail="Budget de département invalide.")
            if n > 0:
                dept_map[k] = round(n, 2)
        update["dept_budgets"] = dept_map
    if payload.branch_budgets is not None:
        if len(payload.branch_budgets) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 budgets de succursale.")
        branch_list = []
        for b in payload.branch_budgets:
            if not isinstance(b, dict):
                raise HTTPException(status_code=400, detail="Budget de succursale invalide.")
            try:
                n = float(b.get("budget") or 0)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Budget de succursale invalide.")
            if not (0 <= n <= 1_000_000):
                raise HTTPException(status_code=400, detail="Budget de succursale invalide.")
            if n > 0:
                branch_list.append({
                    "branch_id": str(b.get("branch_id") or ""),
                    "branch_name": str(b.get("branch_name") or "")[:80], "budget": round(n, 2),
                })
        update["branch_budgets"] = branch_list
    if payload.dept_staffing is not None:
        staff_map = {}
        for k, v in payload.dept_staffing.items():
            if k not in DEPARTMENTS_BE:
                continue
            try:
                n = int(float(v))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Personnel requis par département invalide.")
            if not (0 <= n <= 100):
                raise HTTPException(status_code=400, detail="Personnel requis par département invalide (0 à 100).")
            if n > 0:
                staff_map[k] = n
        update["dept_staffing"] = staff_map
    if payload.branch_staffing is not None:
        if len(payload.branch_staffing) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 exigences de succursale.")
        staff_list = []
        for b in payload.branch_staffing:
            if not isinstance(b, dict):
                raise HTTPException(status_code=400, detail="Personnel requis par succursale invalide.")
            try:
                n = int(float(b.get("count") or 0))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Personnel requis par succursale invalide.")
            if not (0 <= n <= 100):
                raise HTTPException(status_code=400, detail="Personnel requis par succursale invalide (0 à 100).")
            if n > 0:
                staff_list.append({
                    "branch_id": str(b.get("branch_id") or ""),
                    "branch_name": str(b.get("branch_name") or "")[:80], "count": n,
                })
        update["branch_staffing"] = staff_list
    if payload.priorities is not None:
        update["priorities"] = sanitize_priorities(payload.priorities)
    if payload.priority_sets is not None:
        if len(payload.priority_sets) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 jeux de priorités.")
        sets = []
        for ps in payload.priority_sets:
            if not isinstance(ps, dict):
                raise HTTPException(status_code=400, detail="Jeu de priorités invalide.")
            name = str(ps.get("name") or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Jeu de priorités : nom requis.")
            sets.append({
                "id": str(ps.get("id") or uuid.uuid4()), "name": name[:60],
                "priorities": sanitize_priorities(ps.get("priorities") or {}),
            })
        update["priority_sets"] = sets
    if payload.auto_break is not None:
        ab = payload.auto_break
        try:
            update["auto_break"] = {
                "enabled": bool(ab.get("enabled")),
                "threshold_hours": max(1.0, min(16.0, float(ab.get("threshold_hours") or 6))),
                "minutes": max(5, min(120, int(float(ab.get("minutes") or 30)))),
                "paid": bool(ab.get("paid")),
            }
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Réglage de pauses automatiques invalide.")
    await db.schedule_settings.update_one({"pharmacy_id": pid}, {"$set": update}, upsert=True)
    saved = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    periods_note = f", {len(update['traffic_periods'])} période(s)" if "traffic_periods" in update else ""
    await log_audit(
        principal["email"], principal["role"], "MODIF_PARAMS_HORAIRE", "horaire", pid,
        f"Budget hebdo : {payload.weekly_budget:.2f} $, achalandage mis à jour{periods_note}", pid,
    )
    return settings_out(saved)
