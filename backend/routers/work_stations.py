"""Postes de travail — extraits de server.py (sans attribution auto)."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid
from routers.shifts import DEPARTMENTS_BE

router = APIRouter(prefix="/work-stations", tags=["work-stations"])


def _st(dept, sid, name, comp, normal, rush, active):
    return {
        "id": sid, "department": dept, "name": name, "competence": comp,
        "normal_count": normal, "rush_count": rush, "active": active,
    }


DEFAULT_WORK_STATIONS = [
    _st("Laboratoire", "lab-accueil", "Accueil client / Réception des ordonnances", "Accueil et réception des ordonnances", 1, 2, True),
    _st("Laboratoire", "lab-saisie", "Saisie / Entrée de données", "Saisie informatique des ordonnances", 1, 2, True),
    _st("Laboratoire", "lab-comptage", "Comptage / Préparation des ordonnances", "Comptage et préparation des ordonnances", 1, 2, True),
    _st("Plancher", "pl-conseil", "Conseil clients / Plancher", "Service à la clientèle", 1, 2, True),
    _st("Entrepôt", "en-reception", "Réception et vérification des commandes", "Réception de marchandises", 1, 1, True),
    _st("Livraison", "li-livreur", "Livreur", "Livraison à domicile", 1, 2, True),
    _st("Général", "ge-polyvalent", "Polyvalent (toutes zones)", "", 1, 1, False),
]
DEFAULT_RUSH_PERIODS = [{"days": [0, 1, 2, 3, 4], "start": "10:00", "end": "14:00"}]


class WorkStationIn(BaseModel):
    id: str = ""
    department: str
    name: str
    competence: str = ""
    normal_count: int = Field(1, ge=0, le=20)
    rush_count: int = Field(1, ge=0, le=20)
    active: bool = True


class RushPeriodIn(BaseModel):
    days: list[int] = []
    start: str = "10:00"
    end: str = "14:00"


class WorkStationsConfigIn(BaseModel):
    stations: list[WorkStationIn]
    rush_periods: list[RushPeriodIn] = []


async def get_work_stations_config(pid: str) -> dict:
    doc = await db.work_stations.find_one({"pharmacy_id": pid}, {"_id": 0})
    if not doc:
        doc = {
            "pharmacy_id": pid,
            "stations": [dict(s) for s in DEFAULT_WORK_STATIONS],
            "rush_periods": [dict(p) for p in DEFAULT_RUSH_PERIODS],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.work_stations.insert_one({**doc})
    return doc


@router.get("")
async def list_work_stations(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await get_work_stations_config(pid)
    return {"stations": doc.get("stations", []), "rush_periods": doc.get("rush_periods", [])}


@router.put("")
async def save_work_stations(payload: WorkStationsConfigIn, principal: dict = Depends(get_principal)):
    if principal["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès réservé aux gestionnaires.")
    pid = scoped_pid(principal)
    stations = []
    for s in payload.stations[:120]:
        if s.department not in DEPARTMENTS_BE or not s.name.strip():
            continue
        stations.append({
            "id": s.id or str(uuid.uuid4()), "department": s.department,
            "name": s.name.strip()[:80], "competence": s.competence.strip()[:120],
            "normal_count": s.normal_count, "rush_count": max(s.rush_count, s.normal_count),
            "active": s.active,
        })
    periods = []
    for p in payload.rush_periods[:14]:
        if not re.fullmatch(r"\d{2}:\d{2}", p.start) or not re.fullmatch(r"\d{2}:\d{2}", p.end) or p.end <= p.start:
            continue
        periods.append({"days": sorted({d for d in p.days if 0 <= d <= 6}), "start": p.start, "end": p.end})
    doc = {
        "pharmacy_id": pid, "stations": stations, "rush_periods": periods,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.work_stations.update_one({"pharmacy_id": pid}, {"$set": doc}, upsert=True)
    await log_audit(
        principal["email"], principal["role"], "CONFIG_POSTES", "horaire", pid,
        f"Postes de travail mis à jour ({len(stations)} postes, {len(periods)} période(s) de rush)", pid,
    )
    return {"stations": stations, "rush_periods": periods}
