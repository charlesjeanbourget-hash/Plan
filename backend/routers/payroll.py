"""Période de paie."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_principal, log_audit, scoped_pid

pay_router = APIRouter(tags=["payroll"])


class PaySettingsIn(BaseModel):
    period_type: str
    anchor: str


@pay_router.get("/pay-settings")
async def get_pay_settings(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.pay_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return doc or {"pharmacy_id": pid, "period_type": "biweekly", "anchor": "2026-06-01"}


@pay_router.post("/pay-settings")
async def save_pay_settings(payload: PaySettingsIn, principal: dict = Depends(get_principal)):
    if payload.period_type not in ("weekly", "biweekly"):
        raise HTTPException(status_code=400, detail="Type de période invalide.")
    try:
        date.fromisoformat(payload.anchor)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date d'ancrage invalide.")
    pid = scoped_pid(principal)
    doc = {"pharmacy_id": pid, "period_type": payload.period_type, "anchor": payload.anchor}
    await db.pay_settings.update_one({"pharmacy_id": pid}, {"$set": doc}, upsert=True)
    await log_audit(
        principal["email"], principal["role"], "MODIFICATION_PERIODE_PAIE", "paie", pid,
        f"Période de paie : {'hebdomadaire' if payload.period_type == 'weekly' else 'aux 2 semaines'} (ancrage {payload.anchor})",
        pid,
    )
    return doc
