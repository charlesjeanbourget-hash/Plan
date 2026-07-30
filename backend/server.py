from fastapi import FastAPI, APIRouter, File, UploadFile, Form, Header, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import uuid
import asyncio
import requests
import resend
from typing import Optional
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime, timezone, date
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

SYSTEM_MESSAGE = (
    "Tu es Lumina, l'assistante IA de LuminaHR, un système de gestion des ressources humaines (SIRH) "
    "conçu pour les pharmacies. Tu aides les gestionnaires et employés de pharmacie avec : la gestion des horaires "
    "et quarts de travail, le recrutement, la paie, les vacances et congés, les remplacements, la performance, "
    "l'onboarding, les contrats et les avantages sociaux. Tu connais les normes du travail au Québec et au Canada. "
    "Réponds toujours en français, de façon concise, professionnelle et chaleureuse."
)


class ChatRequest(BaseModel):
    session_id: str
    message: str


@api_router.get("/")
async def root():
    return {"message": "LuminaHR API"}


@api_router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    await db.chat_messages.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": req.session_id,
        "role": "user",
        "content": req.message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    history = await db.chat_messages.find(
        {"session_id": req.session_id}, {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", -1).to_list(12)
    history.reverse()
    context = "\n".join(f"{m['role']}: {m['content']}" for m in history[:-1])
    system = SYSTEM_MESSAGE
    if context:
        system += f"\n\nHistorique récent de la conversation:\n{context}"

    llm = LlmChat(
        api_key=os.environ['EMERGENT_LLM_KEY'],
        session_id=req.session_id,
        system_message=system,
    ).with_model("openai", "gpt-5.4")

    async def gen():
        parts = []
        try:
            async for ev in llm.stream_message(UserMessage(text=req.message)):
                if isinstance(ev, TextDelta):
                    parts.append(ev.content)
                    yield f"data: {json.dumps({'delta': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    break
            if parts:
                await db.chat_messages.insert_one({
                    "id": str(uuid.uuid4()),
                    "session_id": req.session_id,
                    "role": "assistant",
                    "content": "".join(parts),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as exc:
            logger.error(f"Chat stream error: {exc}")
            yield f"data: {json.dumps({'error': 'Le service IA est momentanément indisponible.'})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ==================== Licences professionnelles — conforme Loi 25 ====================

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "luminahr"
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "")
resend.api_key = RESEND_API_KEY

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

storage_key = None


def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ['EMERGENT_LLM_KEY']}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


ALLOWED_CERT_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
MAX_CERT_SIZE = 10 * 1024 * 1024


async def get_principal(
    x_user_email: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    x_pharmacy_id: Optional[str] = Header(None),
):
    if not x_user_email or x_user_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès refusé : réservé aux administrateurs (Loi 25).")
    return {"email": x_user_email, "role": x_user_role, "pharmacy_id": x_pharmacy_id or ""}


def license_scope(principal: dict, pharmacy_id: Optional[str] = None) -> dict:
    if principal["role"] == "superadmin":
        return {"pharmacy_id": pharmacy_id} if pharmacy_id else {}
    if not principal["pharmacy_id"]:
        raise HTTPException(status_code=403, detail="Aucune pharmacie associée à ce compte.")
    return {"pharmacy_id": principal["pharmacy_id"]}


async def log_audit(actor_email: str, actor_role: str, action: str, resource_type: str,
                    resource_id: str, details: str, pharmacy_id: str = ""):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "actor_email": actor_email,
        "actor_role": actor_role,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "details": details,
        "pharmacy_id": pharmacy_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


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


def report_html(pharmacy_name: str, items: list) -> str:
    if items:
        rows = "".join(
            f"<tr>"
            f"<td style='padding:8px;border:1px solid #e2e8f0'>{i['employee_name']}</td>"
            f"<td style='padding:8px;border:1px solid #e2e8f0'>{i['license_number']}</td>"
            f"<td style='padding:8px;border:1px solid #e2e8f0'>{i['expiry_date']}</td>"
            f"<td style='padding:8px;border:1px solid #e2e8f0;color:{'#dc2626' if i['days_remaining'] < 0 else '#d97706'}'>"
            f"{'Expirée' if i['days_remaining'] < 0 else str(i['days_remaining']) + ' jours restants'}</td>"
            f"</tr>"
            for i in items
        )
        body = (
            "<p>Voici les licences professionnelles arrivant à échéance dans les 60 prochains jours :</p>"
            "<table style='border-collapse:collapse;width:100%;font-size:14px'>"
            "<tr style='background:#f1f5f9'>"
            "<th style='padding:8px;border:1px solid #e2e8f0;text-align:left'>Employé</th>"
            "<th style='padding:8px;border:1px solid #e2e8f0;text-align:left'>No de licence</th>"
            "<th style='padding:8px;border:1px solid #e2e8f0;text-align:left'>Expiration</th>"
            "<th style='padding:8px;border:1px solid #e2e8f0;text-align:left'>Échéance</th>"
            f"</tr>{rows}</table>"
        )
    else:
        body = "<p>Aucune licence n'arrive à échéance dans les 60 prochains jours. Tout est en règle.</p>"
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        f"<h2 style='color:#059669'>LuminaHR — Rapport mensuel des licences</h2>"
        f"<p style='color:#64748b'>{pharmacy_name}</p>"
        f"{body}"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Rapport généré automatiquement le 1er du mois par LuminaHR, "
        "conformément à vos paramètres. Données traitées selon la Loi 25 (Québec).</p>"
        "</div>"
    )


async def send_report_email(setting: dict):
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY manquante dans backend/.env")
    items = await compute_report({"pharmacy_id": setting["pharmacy_id"]})
    params = {
        "from": SENDER_EMAIL,
        "to": [setting["admin_email"]],
        "subject": f"LuminaHR — Rapport mensuel des licences — {setting.get('pharmacy_name', '')}",
        "html": report_html(setting.get("pharmacy_name", ""), items),
    }
    result = await asyncio.to_thread(resend.Emails.send, params)
    await log_audit("système", "system", "ENVOI_RAPPORT", "rapport", setting["pharmacy_id"],
                    f"Rapport mensuel envoyé à {setting['admin_email']} ({len(items)} échéance(s))",
                    setting["pharmacy_id"])
    return result


class ReportSettingsIn(BaseModel):
    pharmacy_id: str
    pharmacy_name: str
    admin_email: str
    enabled: bool


class ReportSendIn(BaseModel):
    pharmacy_id: Optional[str] = None


@api_router.get("/licenses/report")
async def get_license_report(pharmacy_id: Optional[str] = Query(None), principal: dict = Depends(get_principal)):
    scope = license_scope(principal, pharmacy_id)
    items = await compute_report(scope)
    await log_audit(principal["email"], principal["role"], "CONSULTATION_RAPPORT", "rapport",
                    scope.get("pharmacy_id", "toutes"), f"{len(items)} échéance(s) à 60 jours",
                    scope.get("pharmacy_id", ""))
    return {"items": items, "generated_at": datetime.now(timezone.utc).isoformat()}


@api_router.post("/licenses/report/send")
async def send_license_report_now(payload: ReportSendIn, principal: dict = Depends(get_principal)):
    pid = payload.pharmacy_id if (principal["role"] == "superadmin" and payload.pharmacy_id) else principal["pharmacy_id"]
    if not pid:
        raise HTTPException(status_code=400, detail="pharmacy_id requis.")
    setting = await db.report_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    if not setting or not setting.get("admin_email"):
        raise HTTPException(status_code=400, detail="Configurez d'abord le courriel destinataire du rapport.")
    if not RESEND_API_KEY:
        raise HTTPException(status_code=400, detail="Clé API Resend manquante. Ajoutez RESEND_API_KEY dans backend/.env pour activer l'envoi de courriels.")
    try:
        await send_report_email(setting)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Envoi rapport échoué: {exc}")
        raise HTTPException(status_code=500, detail=f"Échec de l'envoi du courriel : {exc}")
    return {"status": "envoyé", "recipient": setting["admin_email"]}


@api_router.get("/report-settings")
async def get_report_settings(pharmacy_id: Optional[str] = Query(None), principal: dict = Depends(get_principal)):
    pid = pharmacy_id if (principal["role"] == "superadmin" and pharmacy_id) else principal["pharmacy_id"]
    setting = await db.report_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return setting or {"pharmacy_id": pid, "pharmacy_name": "", "admin_email": "", "enabled": False}


@api_router.post("/report-settings")
async def save_report_settings(payload: ReportSettingsIn, principal: dict = Depends(get_principal)):
    pid = payload.pharmacy_id if principal["role"] == "superadmin" else principal["pharmacy_id"]
    doc = {"pharmacy_id": pid, "pharmacy_name": payload.pharmacy_name,
           "admin_email": payload.admin_email, "enabled": payload.enabled}
    await db.report_settings.update_one({"pharmacy_id": pid}, {"$set": doc}, upsert=True)
    await log_audit(principal["email"], principal["role"], "MODIFICATION_PARAMETRES_RAPPORT", "rapport", pid,
                    f"Destinataire : {payload.admin_email} — envoi automatique : {'activé' if payload.enabled else 'désactivé'}", pid)
    return doc


@api_router.get("/licenses")
async def list_licenses(branch_id: Optional[str] = Query(None), pharmacy_id: Optional[str] = Query(None),
                        principal: dict = Depends(get_principal)):
    scope = license_scope(principal, pharmacy_id)
    query = {**scope, "is_deleted": False}
    if branch_id:
        query["branch_id"] = branch_id
    docs = await db.licenses.find(query).to_list(1000)
    await log_audit(principal["email"], principal["role"], "CONSULTATION_LISTE", "licence", "liste",
                    f"{len(docs)} licence(s) consultée(s)", scope.get("pharmacy_id", ""))
    return [license_public(d) for d in docs]


async def upload_certificate(pharmacy_id: str, file: UploadFile) -> dict:
    if file.content_type not in ALLOWED_CERT_TYPES:
        raise HTTPException(status_code=400, detail="Format non autorisé (PDF, PNG, JPG ou WEBP uniquement).")
    data = await file.read()
    if len(data) > MAX_CERT_SIZE:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (maximum 10 Mo).")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    path = f"{APP_NAME}/licences/{pharmacy_id}/{uuid.uuid4()}.{ext}"
    result = await asyncio.to_thread(put_object, path, data, file.content_type or "application/octet-stream")
    return {
        "storage_path": result["path"],
        "certificate_filename": file.filename,
        "certificate_content_type": file.content_type,
        "certificate_size": len(data),
    }


@api_router.post("/licenses")
async def create_license(
    employee_id: str = Form(...),
    employee_name: str = Form(...),
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
        "position": position,
        "pharmacy_id": pid,
        "branch_id": branch_id,
        "license_number": license_number,
        "expiry_date": expiry_date,
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
    await log_audit(principal["email"], principal["role"], "CREATION", "licence", doc["id"],
                    f"Licence {license_number} créée pour {employee_name}", pid)
    return license_public(doc)


@api_router.put("/licenses/{license_id}")
async def update_license(
    license_id: str,
    license_number: str = Form(...),
    expiry_date: str = Form(...),
    branch_id: str = Form(""),
    file: Optional[UploadFile] = File(None),
    principal: dict = Depends(get_principal),
):
    scope = license_scope(principal)
    doc = await db.licenses.find_one({"id": license_id, "is_deleted": False, **scope})
    if not doc:
        raise HTTPException(status_code=404, detail="Licence introuvable.")
    patch = {"license_number": license_number, "expiry_date": expiry_date,
             "updated_at": datetime.now(timezone.utc).isoformat()}
    if branch_id:
        patch["branch_id"] = branch_id
    if file is not None and file.filename:
        patch.update(await upload_certificate(doc["pharmacy_id"], file))
    await db.licenses.update_one({"id": license_id}, {"$set": patch})
    await log_audit(principal["email"], principal["role"], "MODIFICATION", "licence", license_id,
                    f"Licence {license_number} modifiée ({doc['employee_name']})", doc["pharmacy_id"])
    return license_public({**doc, **patch})


@api_router.get("/licenses/{license_id}/certificate")
async def get_certificate(license_id: str, principal: dict = Depends(get_principal)):
    scope = license_scope(principal)
    doc = await db.licenses.find_one({"id": license_id, "is_deleted": False, **scope})
    if not doc or not doc.get("storage_path"):
        raise HTTPException(status_code=404, detail="Certificat introuvable.")
    content, ctype = await asyncio.to_thread(get_object, doc["storage_path"])
    await log_audit(principal["email"], principal["role"], "CONSULTATION_CERTIFICAT", "licence", license_id,
                    f"Certificat consulté ({doc['employee_name']})", doc["pharmacy_id"])
    filename = doc.get("certificate_filename") or "certificat"
    return Response(
        content=content,
        media_type=doc.get("certificate_content_type") or ctype,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@api_router.delete("/licenses/employee/{employee_id}")
async def erase_employee_data(employee_id: str, principal: dict = Depends(get_principal)):
    scope = license_scope(principal)
    docs = await db.licenses.find({"employee_id": employee_id, **scope}).to_list(100)
    if not docs:
        return {"deleted": 0}
    employee_name = docs[0].get("employee_name", employee_id)
    pid = docs[0].get("pharmacy_id", scope.get("pharmacy_id", ""))
    result = await db.licenses.delete_many({"employee_id": employee_id, **scope})
    await log_audit(principal["email"], principal["role"], "DROIT_A_L_OUBLI", "employé", employee_id,
                    f"Destruction définitive de {result.deleted_count} licence(s) et document(s) — {employee_name} (Loi 25, art. 23)", pid)
    return {"deleted": result.deleted_count}


@api_router.delete("/licenses/{license_id}")
async def delete_license(license_id: str, principal: dict = Depends(get_principal)):
    scope = license_scope(principal)
    doc = await db.licenses.find_one({"id": license_id, **scope})
    if not doc:
        raise HTTPException(status_code=404, detail="Licence introuvable.")
    await db.licenses.delete_one({"id": license_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION", "licence", license_id,
                    f"Licence {doc['license_number']} supprimée ({doc['employee_name']})", doc["pharmacy_id"])
    return {"status": "supprimée"}


@api_router.get("/audit-logs")
async def list_audit_logs(pharmacy_id: Optional[str] = Query(None), limit: int = Query(200),
                          principal: dict = Depends(get_principal)):
    if principal["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Journal d'audit réservé au superadmin.")
    query = {"pharmacy_id": pharmacy_id} if pharmacy_id else {}
    docs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 500))
    return docs


scheduler = AsyncIOScheduler(timezone="America/Montreal")


async def monthly_reports_job():
    settings = await db.report_settings.find({"enabled": True}, {"_id": 0}).to_list(1000)
    logger.info(f"Rapport mensuel : {len(settings)} pharmacie(s) à traiter")
    for s in settings:
        try:
            await send_report_email(s)
        except Exception as exc:
            logger.error(f"Rapport mensuel échoué pour {s.get('pharmacy_id')}: {exc}")


@app.on_event("startup")
async def startup_tasks():
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Object storage initialisé")
    except Exception as exc:
        logger.error(f"Init object storage échoué : {exc}")
    scheduler.add_job(monthly_reports_job, CronTrigger(day=1, hour=8, minute=0))
    scheduler.start()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
