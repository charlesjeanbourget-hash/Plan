"""Licences professionnelles — extraits de server.py."""
import asyncio
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from core.config import db
from core.security import get_fernet, get_principal, log_audit, scoped_pid
from core.storage import ALLOWED_CERT_TYPES, APP_NAME, MAX_CERT_SIZE, get_object, put_object

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/licenses", tags=["licenses"])


def license_scope(principal: dict, pharmacy_id: Optional[str] = None) -> dict:
    if principal["role"] == "superadmin":
        return {"pharmacy_id": scoped_pid(principal)}
    if not principal["pharmacy_id"]:
        raise HTTPException(status_code=403, detail="Aucune pharmacie associée à ce compte.")
    return {"pharmacy_id": principal["pharmacy_id"]}


def license_public(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "storage_path")}


async def compute_report(scope: dict):
    docs = await db.licenses.find({**scope, "is_deleted": False}).to_list(1000)
    today = date.today()
    items = []
    for doc in docs:
        try:
            days = (date.fromisoformat(doc["expiry_date"]) - today).days
        except (ValueError, KeyError):
            continue
        if days <= 60:
            items.append({**license_public(doc), "days_remaining": days})
    items.sort(key=lambda i: i["days_remaining"])
    return items


async def upload_certificate(pharmacy_id: str, file: UploadFile) -> dict:
    if file.content_type not in ALLOWED_CERT_TYPES:
        raise HTTPException(status_code=400, detail="Format non autorisé (PDF, PNG, JPG ou WEBP uniquement).")
    data = await file.read()
    if len(data) > MAX_CERT_SIZE:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (maximum 10 Mo).")
    encrypted = get_fernet().encrypt(data)
    path = f"{APP_NAME}/licences/{pharmacy_id}/{uuid.uuid4()}.enc"
    result = await asyncio.to_thread(put_object, path, encrypted, "application/octet-stream")
    return {
        "storage_path": result["path"],
        "certificate_filename": file.filename,
        "certificate_content_type": file.content_type,
        "certificate_size": len(data),
        "certificate_encrypted": True,
    }


class ReportSendIn(BaseModel):
    pharmacy_id: Optional[str] = None


class ReportSettingsIn(BaseModel):
    pharmacy_id: str
    pharmacy_name: str
    admin_email: str
    enabled: bool


@router.get("/report")
async def get_license_report(
    pharmacy_id: Optional[str] = Query(None), principal: dict = Depends(get_principal)
):
    scope = license_scope(principal, pharmacy_id)
    items = await compute_report(scope)
    await log_audit(
        principal["email"], principal["role"], "CONSULTATION_RAPPORT", "rapport",
        scope.get("pharmacy_id", "toutes"), f"{len(items)} échéance(s) à 60 jours",
        scope.get("pharmacy_id", ""),
    )
    return {"items": items, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("")
async def list_licenses(
    branch_id: Optional[str] = Query(None),
    pharmacy_id: Optional[str] = Query(None),
    principal: dict = Depends(get_principal),
):
    scope = license_scope(principal, pharmacy_id)
    query = {**scope, "is_deleted": False}
    if branch_id:
        query["branch_id"] = branch_id
    docs = await db.licenses.find(query).to_list(1000)
    await log_audit(
        principal["email"], principal["role"], "CONSULTATION_LISTE", "licence", "liste",
        f"{len(docs)} licence(s) consultée(s)", scope.get("pharmacy_id", ""),
    )
    return [license_public(d) for d in docs]


@router.post("")
async def create_license(
    employee_id: str = Form(...),
    employee_name: str = Form(...),
    employee_email: str = Form(""),
    position: str = Form(""),
    branch_id: str = Form(""),
    license_number: str = Form(...),
    expiry_date: str = Form(...),
    pharmacy_id: str = Form(""),
    file: Optional[UploadFile] = File(None),
    principal: dict = Depends(get_principal),
):
    pid = pharmacy_id if (principal["role"] == "superadmin" and pharmacy_id) else principal["pharmacy_id"]
    if not pid:
        raise HTTPException(status_code=400, detail="pharmacy_id requis.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "employee_id": employee_id,
        "employee_name": employee_name,
        "employee_email": employee_email,
        "position": position,
        "pharmacy_id": pid,
        "branch_id": branch_id,
        "license_number": license_number,
        "expiry_date": expiry_date,
        "reminder_sent_for": None,
        "storage_path": None,
        "certificate_filename": None,
        "certificate_content_type": None,
        "certificate_size": 0,
        "is_deleted": False,
        "created_at": now,
        "updated_at": now,
    }
    if file is not None and file.filename:
        doc.update(await upload_certificate(pid, file))
    await db.licenses.insert_one(doc)
    await log_audit(
        principal["email"], principal["role"], "CREATION", "licence", doc["id"],
        f"Licence {license_number} créée pour {employee_name}", pid,
    )
    return license_public(doc)


@router.put("/{license_id}")
async def update_license(
    license_id: str,
    license_number: str = Form(...),
    expiry_date: str = Form(...),
    branch_id: str = Form(""),
    employee_email: str = Form(""),
    file: Optional[UploadFile] = File(None),
    principal: dict = Depends(get_principal),
):
    scope = license_scope(principal)
    doc = await db.licenses.find_one({"id": license_id, "is_deleted": False, **scope})
    if not doc:
        raise HTTPException(status_code=404, detail="Licence introuvable.")
    patch = {
        "license_number": license_number,
        "expiry_date": expiry_date,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if expiry_date != doc.get("expiry_date"):
        patch["reminder_sent_for"] = None
    if branch_id:
        patch["branch_id"] = branch_id
    if employee_email:
        patch["employee_email"] = employee_email
    if file is not None and file.filename:
        patch.update(await upload_certificate(doc["pharmacy_id"], file))
    await db.licenses.update_one({"id": license_id}, {"$set": patch})
    await log_audit(
        principal["email"], principal["role"], "MODIFICATION", "licence", license_id,
        f"Licence {license_number} modifiée ({doc['employee_name']})", doc["pharmacy_id"],
    )
    return license_public({**doc, **patch})


@router.get("/{license_id}/certificate")
async def get_certificate(license_id: str, principal: dict = Depends(get_principal)):
    scope = license_scope(principal)
    doc = await db.licenses.find_one({"id": license_id, "is_deleted": False, **scope})
    if not doc or not doc.get("storage_path"):
        raise HTTPException(status_code=404, detail="Certificat introuvable.")
    content, ctype = await asyncio.to_thread(get_object, doc["storage_path"])
    if doc.get("certificate_encrypted"):
        content = get_fernet().decrypt(content)
    await log_audit(
        principal["email"], principal["role"], "CONSULTATION_CERTIFICAT", "licence", license_id,
        f"Certificat consulté ({doc['employee_name']})", doc["pharmacy_id"],
    )
    filename = doc.get("certificate_filename") or "certificat"
    return Response(
        content=content,
        media_type=doc.get("certificate_content_type") or ctype,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/employee/{employee_id}")
async def erase_employee_data(employee_id: str, principal: dict = Depends(get_principal)):
    scope = license_scope(principal)
    docs = await db.licenses.find({"employee_id": employee_id, **scope}).to_list(100)
    if not docs:
        return {"deleted": 0}
    employee_name = docs[0].get("employee_name", employee_id)
    pid = docs[0].get("pharmacy_id", scope.get("pharmacy_id", ""))
    result = await db.licenses.delete_many({"employee_id": employee_id, **scope})
    await log_audit(
        principal["email"], principal["role"], "DROIT_A_L_OUBLI", "employé", employee_id,
        f"Destruction définitive de {result.deleted_count} licence(s) et document(s) — {employee_name} (Loi 25, art. 23)",
        pid,
    )
    return {"deleted": result.deleted_count}


@router.delete("/{license_id}")
async def delete_license(license_id: str, principal: dict = Depends(get_principal)):
    scope = license_scope(principal)
    doc = await db.licenses.find_one({"id": license_id, **scope})
    if not doc:
        raise HTTPException(status_code=404, detail="Licence introuvable.")
    await db.licenses.delete_one({"id": license_id})
    await log_audit(
        principal["email"], principal["role"], "SUPPRESSION", "licence", license_id,
        f"Licence {doc['license_number']} supprimée ({doc['employee_name']})", doc["pharmacy_id"],
    )
    return {"status": "supprimée"}
