"""Exports paie — extraits de server.py."""
import io
import json
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from core.config import db
from core.security import get_principal, log_audit, scoped_pid
from routers.punches import get_punch_settings, punch_break_minutes, punch_hours

PAYROLL_EXPORT_FORMATS = ("employeurd", "nethris", "adp")
router = APIRouter(tags=["payroll-exports"])


def aggregate_punch_hours(docs: list, settings: Optional[dict] = None) -> list:
    settings = settings or {}
    rows: dict = {}
    weekly: dict = {}
    for p in docs:
        r = rows.setdefault(p["employee_id"], {
            "employee_id": p["employee_id"], "employee_name": p["employee_name"],
            "punched_hours": 0.0, "manual_hours": 0.0, "total_hours": 0.0,
            "regular_hours": 0.0, "overtime_hours": 0.0, "break_minutes": 0.0,
            "entries": 0, "open_entries": 0,
        })
        if not p.get("punch_out"):
            r["open_entries"] += 1
            continue
        h = punch_hours(p, settings)
        r["break_minutes"] += punch_break_minutes(p)
        r["entries"] += 1
        r["punched_hours" if p["source"] == "punch" else "manual_hours"] += h
        r["total_hours"] += h
        iso = date.fromisoformat(p["date"]).isocalendar()
        wk = (p["employee_id"], iso[0], iso[1])
        weekly[wk] = weekly.get(wk, 0.0) + h
    for (eid, _, _), h in weekly.items():
        if h > 40:
            rows[eid]["overtime_hours"] += h - 40
    for r in rows.values():
        r["regular_hours"] = r["total_hours"] - r["overtime_hours"]
        r["break_minutes"] = round(r["break_minutes"], 1)
        for k in ("punched_hours", "manual_hours", "total_hours", "regular_hours", "overtime_hours"):
            r[k] = round(r[k], 2)
    return sorted(rows.values(), key=lambda r: r["employee_name"])


def time_to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def shift_net_hours(s: dict, auto_break: dict) -> float:
    try:
        h = max(0, time_to_minutes(s["end"]) - time_to_minutes(s["start"])) / 60
    except (ValueError, AttributeError, KeyError):
        return 0.0
    if auto_break.get("enabled") and not auto_break.get("paid") and h >= float(auto_break.get("threshold_hours") or 6):
        h = max(0.0, h - float(auto_break.get("minutes") or 30) / 60)
    return h


def num_fr(v: float) -> str:
    return f"{v:.2f}".replace(".", ",")


@router.get("/punches/export-payroll")
async def export_punches_payroll(
    start: str = Query(...), end: str = Query(...),
    format: str = Query(...), principal: dict = Depends(get_principal),
):
    if format not in PAYROLL_EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="Format invalide. Choix : employeurd, nethris, adp.")
    pid = scoped_pid(principal)
    docs = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(5000)
    rows = [r for r in aggregate_punch_hours(docs, await get_punch_settings(pid)) if r["total_hours"] > 0]
    if not rows:
        raise HTTPException(status_code=400, detail="Aucune heure complétée dans cette période.")
    profiles = await db.employee_profiles.find(
        {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "payroll_number": 1}
    ).to_list(1000)
    num_by = {p["employee_id"]: (p.get("payroll_number") or "").strip() for p in profiles}

    if format == "employeurd":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Paie"
        ws.append(["Matricule", "Nom de l'employé", "Code de gain", "Heures"])
        for r in rows:
            mat = num_by.get(r["employee_id"], "")
            if r["regular_hours"] > 0:
                ws.append([mat, r["employee_name"], "REG", r["regular_hours"]])
            if r["overtime_hours"] > 0:
                ws.append([mat, r["employee_name"], "SUP", r["overtime_hours"]])
        buf = io.BytesIO()
        wb.save(buf)
        content = buf.getvalue()
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"employeur-d_paie_{start}_{end}.xlsx"
    elif format == "nethris":
        lines = ["Matricule;Nom de l'employé;Code de gain;Heures"]
        for r in rows:
            mat = num_by.get(r["employee_id"], "")
            if r["regular_hours"] > 0:
                lines.append(f"{mat};{r['employee_name']};REG;{str(r['regular_hours']).replace('.', ',')}")
            if r["overtime_hours"] > 0:
                lines.append(f"{mat};{r['employee_name']};SUP;{str(r['overtime_hours']).replace('.', ',')}")
        content = ("\ufeff" + "\n".join(lines)).encode("utf-8")
        media = "text/csv; charset=utf-8"
        filename = f"nethris_paie_{start}_{end}.csv"
    else:
        lines = ["Co Code,Batch ID,File #,Employee Name,Reg Hours,O/T Hours"]
        for r in rows:
            mat = num_by.get(r["employee_id"], "")
            name = r["employee_name"].replace(",", " ")
            lines.append(f",,{mat},{name},{r['regular_hours']},{r['overtime_hours']}")
        content = ("\ufeff" + "\n".join(lines)).encode("utf-8")
        media = "text/csv; charset=utf-8"
        filename = f"adp_paydata_{start}_{end}.csv"

    missing = sum(1 for r in rows if not num_by.get(r["employee_id"], ""))
    await log_audit(
        principal["email"], principal["role"], "EXPORT_PAIE", "punch", f"{start}_{end}",
        f"Export paie format {format} du {start} au {end} ({len(rows)} employé(s), {missing} sans matricule)", pid,
    )
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/payroll/budget-export")
async def export_branch_budgets(
    start: str = Query(...), end: str = Query(...),
    names: str = Query("{}"), label: str = Query(""),
    principal: dict = Depends(get_principal),
):
    try:
        d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates invalides (format AAAA-MM-JJ).")
    if d1 < d0 or (d1 - d0).days > 62:
        raise HTTPException(status_code=400, detail="Période invalide (maximum 62 jours).")
    try:
        name_map = {str(k): str(v)[:80] for k, v in (json.loads(names) or {}).items()}
    except (json.JSONDecodeError, AttributeError):
        name_map = {}
    pid = scoped_pid(principal)
    settings = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    auto_break = settings.get("auto_break") or {}
    branch_budgets = {
        b.get("branch_id") or "": float(b.get("budget") or 0)
        for b in (settings.get("branch_budgets") or [])
    }
    for b in (settings.get("branch_budgets") or []):
        name_map.setdefault(b.get("branch_id") or "", b.get("branch_name") or "")
    profiles = await db.employee_profiles.find(
        {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "hourly_rate": 1}
    ).to_list(1000)
    rate_by = {p["employee_id"]: float(p.get("hourly_rate") or 0) for p in profiles}
    shifts = await db.shifts.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(20000)
    planned: dict = {}
    shifts_by_emp_day: dict = {}
    for s in shifts:
        bid = s.get("branch_id") or ""
        h = shift_net_hours(s, auto_break)
        row = planned.setdefault(bid, {"hours": 0.0, "cost": 0.0})
        row["hours"] += h
        row["cost"] += h * rate_by.get(s["employee_id"], 0)
        shifts_by_emp_day.setdefault((s["employee_id"], s["date"]), []).append(s)
    punches = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}, "punch_out": {"$ne": None}},
        {"_id": 0},
    ).to_list(20000)
    punch_settings = await get_punch_settings(pid)
    real: dict = {}
    for p in punches:
        h = punch_hours(p, punch_settings)
        if h <= 0:
            continue
        day_shifts = shifts_by_emp_day.get((p["employee_id"], p["date"]), [])
        rate = rate_by.get(p["employee_id"], 0)
        if not day_shifts:
            row = real.setdefault("", {"hours": 0.0, "cost": 0.0})
            row["hours"] += h
            row["cost"] += h * rate
            continue
        total_sched = sum(shift_net_hours(s, auto_break) for s in day_shifts) or 1.0
        for s in day_shifts:
            frac = shift_net_hours(s, auto_break) / total_sched
            row = real.setdefault(s.get("branch_id") or "", {"hours": 0.0, "cost": 0.0})
            row["hours"] += h * frac
            row["cost"] += h * frac * rate
    days = (d1 - d0).days + 1
    factor = days / 7
    all_bids = sorted(
        set(list(planned.keys()) + list(real.keys()) + list(branch_budgets.keys())),
        key=lambda b: name_map.get(b, b),
    )
    period_label = label or f"{start} au {end}"
    lines = [
        f"Budgets de paie par succursale;Période : {period_label};{days} jour(s)",
        "Succursale;Heures planifiées;Coût planifié $;Heures réelles;Coût réel $;"
        "Budget période $ (hebdo × semaines);Écart réel vs budget $",
    ]
    tot = {"ph": 0.0, "pc": 0.0, "rh": 0.0, "rc": 0.0, "b": 0.0}
    for bid in all_bids:
        pl = planned.get(bid, {"hours": 0.0, "cost": 0.0})
        re_ = real.get(bid, {"hours": 0.0, "cost": 0.0})
        budget = round(branch_budgets.get(bid, 0) * factor, 2)
        gap = num_fr(re_["cost"] - budget) if budget > 0 else ""
        nom = (name_map.get(bid) or ("Sans succursale" if not bid else bid)).replace(";", " ")
        lines.append(
            f"{nom};{num_fr(pl['hours'])};{num_fr(pl['cost'])};{num_fr(re_['hours'])};{num_fr(re_['cost'])};"
            f"{num_fr(budget) if budget > 0 else ''};{gap}"
        )
        tot["ph"] += pl["hours"]
        tot["pc"] += pl["cost"]
        tot["rh"] += re_["hours"]
        tot["rc"] += re_["cost"]
        tot["b"] += budget
    weekly_budget = float(settings.get("weekly_budget") or 0)
    global_budget = round(weekly_budget * factor, 2) if weekly_budget > 0 else tot["b"]
    gap_total = num_fr(tot["rc"] - global_budget) if global_budget > 0 else ""
    lines.append(
        f"TOTAL PHARMACIE;{num_fr(tot['ph'])};{num_fr(tot['pc'])};{num_fr(tot['rh'])};{num_fr(tot['rc'])};"
        f"{num_fr(global_budget) if global_budget > 0 else ''};{gap_total}"
    )
    content = ("\ufeff" + "\n".join(lines)).encode("utf-8")
    await log_audit(
        principal["email"], principal["role"], "EXPORT_BUDGETS_PAIE", "paie", f"{start}_{end}",
        f"Export des budgets de paie par succursale du {start} au {end}", pid,
    )
    return Response(
        content=content, media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="budgets-paie_{start}_{end}.csv"'},
    )
