from fastapi import FastAPI, APIRouter, File, UploadFile, Form, Header, HTTPException, Query, Depends, Request
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import json
import logging
import uuid
import asyncio
import secrets
import requests
from pypdf import PdfReader
import resend
import bcrypt
import jwt
from typing import Optional
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime, timezone, date, timedelta
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


# ==================== Authentification JWT ====================

JWT_ALGORITHM = "HS256"
LOCKOUT_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def user_public(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc["name"],
        "role": doc["role"],
        "pharmacy_id": doc.get("pharmacy_id"),
        "employee_id": doc.get("employee_id"),
        "is_temporary_password": doc.get("is_temporary_password", False),
        "suspended": doc.get("suspended", False),
        "created_at": doc.get("created_at", ""),
    }


def create_access_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Non authentifié.")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Type de jeton invalide.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expirée, veuillez vous reconnecter.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Jeton invalide.")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable.")
    if user.get("suspended"):
        raise HTTPException(status_code=403, detail="Compte suspendu. Contactez votre superadministrateur.")
    return user


@api_router.post("/auth/login")
async def auth_login(payload: LoginIn, request: Request):
    email = payload.email.strip().lower()
    identifier = email
    now = datetime.now(timezone.utc)
    attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    if attempt and attempt.get("locked_until") and datetime.fromisoformat(attempt["locked_until"]) > now:
        raise HTTPException(status_code=429, detail="Trop de tentatives échouées. Réessayez dans 15 minutes.",
                            headers={"Retry-After": str(LOCKOUT_MINUTES * 60)})
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(payload.password.strip(), user["password_hash"]):
        count = (attempt.get("count", 0) + 1) if attempt else 1
        update = {"identifier": identifier, "count": count, "updated_at": now.isoformat()}
        if count >= LOCKOUT_ATTEMPTS:
            update["locked_until"] = (now + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
            update["count"] = 0
        await db.login_attempts.update_one({"identifier": identifier}, {"$set": update}, upsert=True)
        if count >= LOCKOUT_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Trop de tentatives échouées. Réessayez dans 15 minutes.",
                                headers={"Retry-After": str(LOCKOUT_MINUTES * 60)})
        raise HTTPException(status_code=401, detail="Courriel ou mot de passe invalide.")
    if user.get("suspended"):
        raise HTTPException(status_code=403, detail="Compte suspendu. Contactez votre superadministrateur.")
    await db.login_attempts.delete_one({"identifier": identifier})
    return {"access_token": create_access_token(user), "user": user_public(user)}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user_public(user)


@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordIn, user: dict = Depends(get_current_user)):
    current_password = payload.current_password.strip()
    new_password = payload.new_password.strip()
    if not verify_password(current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect.")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit contenir au moins 8 caractères.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(new_password), "is_temporary_password": False}},
    )
    await log_audit(user["email"], user["role"], "CHANGEMENT_MOT_DE_PASSE", "utilisateur", user["id"],
                    "Mot de passe modifié par l'utilisateur", user.get("pharmacy_id") or "")
    return {"status": "modifié"}


AUTH_SEED_USERS = [
    {"email": "admin@luminahr.ca", "password": "admin123", "name": "Dr. Sophie Lavoie", "role": "admin",
     "pharmacy_id": "ph1", "employee_id": "e1", "temp": False},
    {"email": "julie@luminahr.ca", "password": "employe123", "name": "Julie Gagnon", "role": "employee",
     "pharmacy_id": "ph1", "employee_id": "e2", "temp": False},
    {"email": "jeffmenard78@hotmail.com", "password": "Lumina-Jeff!2941", "name": "Jeff Ménard",
     "role": "superadmin", "temp": True},
    {"email": "charles-jbourget@hotmail.com", "password": "Lumina-Charles!7358", "name": "Charles-J. Bourget",
     "role": "superadmin", "temp": True},
    {"email": "charlesjeanbourget@gmail.com", "password": "Lumina-Owner!5127", "name": "Charles Jean-Bourget",
     "role": "superadmin", "temp": True},
]


async def seed_users():
    for su in AUTH_SEED_USERS:
        existing = await db.users.find_one({"email": su["email"]})
        if existing is None:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": su["email"],
                "password_hash": hash_password(su["password"]),
                "name": su["name"],
                "role": su["role"],
                "pharmacy_id": su.get("pharmacy_id"),
                "employee_id": su.get("employee_id"),
                "is_temporary_password": su["temp"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")


# ==================== Gestion des comptes (superadmin) ====================

async def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Réservé au superadministrateur.")
    return user


def gen_temp_password() -> str:
    return "Lumina-" + secrets.token_urlsafe(6)


class UserCreateIn(BaseModel):
    email: str
    name: str
    role: str
    pharmacy_id: Optional[str] = None
    employee_id: Optional[str] = None


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    pharmacy_id: Optional[str] = None
    suspended: Optional[bool] = None


@api_router.get("/admin/users")
async def admin_list_users(su: dict = Depends(require_superadmin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(1000)
    return [user_public({**d, "password_hash": ""}) for d in docs]


@api_router.post("/admin/users")
async def admin_create_user(payload: UserCreateIn, su: dict = Depends(require_superadmin)):
    email = payload.email.strip().lower()
    if payload.role not in ("admin", "employee", "superadmin"):
        raise HTTPException(status_code=400, detail="Rôle invalide.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel.")
    temp = gen_temp_password()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(temp),
        "name": payload.name,
        "role": payload.role,
        "pharmacy_id": payload.pharmacy_id,
        "employee_id": payload.employee_id,
        "is_temporary_password": True,
        "suspended": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    await log_audit(su["email"], su["role"], "CREATION_COMPTE", "utilisateur", doc["id"],
                    f"Compte {payload.role} créé pour {email}", payload.pharmacy_id or "")
    return {"user": user_public(doc), "temporary_password": temp}


@api_router.put("/admin/users/{user_id}")
async def admin_update_user(user_id: str, payload: UserUpdateIn, su: dict = Depends(require_superadmin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Compte introuvable.")
    if user_id == su["id"] and payload.suspended:
        raise HTTPException(status_code=400, detail="Impossible de suspendre votre propre compte.")
    patch = payload.model_dump(exclude_none=True)
    if patch.get("role") and patch["role"] not in ("admin", "employee", "superadmin"):
        raise HTTPException(status_code=400, detail="Rôle invalide.")
    if patch:
        await db.users.update_one({"id": user_id}, {"$set": patch})
    action = "SUSPENSION_COMPTE" if payload.suspended is True else (
        "REACTIVATION_COMPTE" if payload.suspended is False else "MODIFICATION_COMPTE")
    await log_audit(su["email"], su["role"], action, "utilisateur", user_id,
                    f"Compte {target['email']} — champs : {', '.join(patch.keys()) or 'aucun'}",
                    target.get("pharmacy_id") or "")
    return user_public({**target, **patch})


@api_router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, su: dict = Depends(require_superadmin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Compte introuvable.")
    temp = gen_temp_password()
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(temp), "is_temporary_password": True}})
    await db.login_attempts.delete_one({"identifier": target["email"]})
    await log_audit(su["email"], su["role"], "REINITIALISATION_MDP", "utilisateur", user_id,
                    f"Mot de passe temporaire généré pour {target['email']} (support à distance)",
                    target.get("pharmacy_id") or "")
    return {"temporary_password": temp, "email": target["email"]}


@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, su: dict = Depends(require_superadmin)):
    if user_id == su["id"]:
        raise HTTPException(status_code=400, detail="Impossible de supprimer votre propre compte.")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Compte introuvable.")
    await db.users.delete_one({"id": user_id})
    await log_audit(su["email"], su["role"], "SUPPRESSION_COMPTE", "utilisateur", user_id,
                    f"Compte {target['email']} supprimé définitivement", target.get("pharmacy_id") or "")
    return {"status": "supprimé"}


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


async def get_principal(user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès refusé : réservé aux administrateurs (Loi 25).")
    return {"email": user["email"], "role": user["role"], "pharmacy_id": user.get("pharmacy_id") or ""}


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
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        raise RuntimeError("RESEND_API_KEY manquante dans backend/.env")
    resend.api_key = api_key
    items = await compute_report({"pharmacy_id": setting["pharmacy_id"]})
    params = {
        "from": await get_sender(),
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
    if not os.environ.get("RESEND_API_KEY", ""):
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
    await log_audit(principal["email"], principal["role"], "CREATION", "licence", doc["id"],
                    f"Licence {license_number} créée pour {employee_name}", pid)
    return license_public(doc)


@api_router.put("/licenses/{license_id}")
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
    patch = {"license_number": license_number, "expiry_date": expiry_date,
             "updated_at": datetime.now(timezone.utc).isoformat()}
    if expiry_date != doc.get("expiry_date"):
        patch["reminder_sent_for"] = None
    if branch_id:
        patch["branch_id"] = branch_id
    if employee_email:
        patch["employee_email"] = employee_email
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


# ==================== Paramètres courriel (expéditeur configurable) ====================

DEFAULT_SENDER = f"LuminaHR <{SENDER_EMAIL}>" if SENDER_EMAIL and "<" not in SENDER_EMAIL else (SENDER_EMAIL or "LuminaHR <onboarding@resend.dev>")


async def get_sender() -> str:
    doc = await db.email_settings.find_one({"id": "global"}, {"_id": 0})
    if doc and doc.get("sender_email"):
        return f"{doc.get('sender_name') or 'LuminaHR'} <{doc['sender_email']}>"
    return DEFAULT_SENDER


class EmailSettingsIn(BaseModel):
    sender_email: str
    sender_name: str = "LuminaHR"


@api_router.get("/email-settings")
async def get_email_settings(principal: dict = Depends(get_principal)):
    doc = await db.email_settings.find_one({"id": "global"}, {"_id": 0})
    base = doc or {"id": "global", "sender_email": "", "sender_name": "LuminaHR"}
    return {**base, "default_sender": DEFAULT_SENDER}


@api_router.post("/email-settings")
async def save_email_settings(payload: EmailSettingsIn, su: dict = Depends(require_superadmin)):
    doc = {"id": "global", "sender_email": payload.sender_email.strip(),
           "sender_name": payload.sender_name.strip() or "LuminaHR"}
    await db.email_settings.update_one({"id": "global"}, {"$set": doc}, upsert=True)
    await log_audit(su["email"], su["role"], "MODIFICATION_EXPEDITEUR", "courriel", "global",
                    f"Expéditeur : {doc['sender_name']} <{doc['sender_email'] or 'défaut'}>")
    return doc


# ==================== Tableau de bord global superadmin ====================

@api_router.get("/superadmin/overview")
async def superadmin_overview(su: dict = Depends(require_superadmin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(5000)
    licenses = await db.licenses.find({"is_deleted": False}, {"_id": 0, "pharmacy_id": 1, "expiry_date": 1}).to_list(10000)
    trainings = await db.trainings.find({}, {"_id": 0, "pharmacy_id": 1, "status": 1}).to_list(5000)
    settings = await db.report_settings.find({}, {"_id": 0}).to_list(1000)
    today = date.today()
    pharmacies: dict = {}

    def bucket(pid):
        key = pid or "—"
        if key not in pharmacies:
            pharmacies[key] = {
                "pharmacy_id": key,
                "accounts": {"total": 0, "admins": 0, "employees": 0, "suspended": 0},
                "licenses": {"total": 0, "expiring_60": 0, "expiring_30": 0, "expired": 0},
                "trainings": {"total": 0, "published": 0},
                "report_enabled": False,
            }
        return pharmacies[key]

    superadmins = 0
    for u in users:
        if u["role"] == "superadmin":
            superadmins += 1
            continue
        b = bucket(u.get("pharmacy_id"))
        b["accounts"]["total"] += 1
        b["accounts"]["admins" if u["role"] == "admin" else "employees"] += 1
        if u.get("suspended"):
            b["accounts"]["suspended"] += 1
    for lic in licenses:
        b = bucket(lic.get("pharmacy_id"))
        b["licenses"]["total"] += 1
        try:
            days = (date.fromisoformat(lic["expiry_date"]) - today).days
        except (ValueError, KeyError):
            continue
        if days < 0:
            b["licenses"]["expired"] += 1
        elif days <= 30:
            b["licenses"]["expiring_30"] += 1
        elif days <= 60:
            b["licenses"]["expiring_60"] += 1
    for t in trainings:
        b = bucket(t.get("pharmacy_id"))
        b["trainings"]["total"] += 1
        if t.get("status") == "published":
            b["trainings"]["published"] += 1
    for s in settings:
        if s.get("enabled"):
            bucket(s.get("pharmacy_id"))["report_enabled"] = True
    return {"superadmins": superadmins,
            "pharmacies": sorted(pharmacies.values(), key=lambda p: p["pharmacy_id"]),
            "generated_at": datetime.now(timezone.utc).isoformat()}


# ==================== Formations générées par IA ====================

TRAINING_MAX_SIZE = 15 * 1024 * 1024
TRAINING_SYSTEM = (
    "Tu es un expert en formation du personnel de pharmacie au Québec. À partir du document de formation fourni, "
    "tu produis un parcours de formation structuré PAR SECTEUR d'activité de la pharmacie "
    "(par exemple : ouverture, fermeture, laboratoire / comptage des pilules, nettoyage et hygiène, "
    "service à la clientèle, caisse, savoir-être, conformité aux règlements et procédures — "
    "adapte les secteurs au contenu réel du document). "
    "Puis tu génères un examen final à choix multiples couvrant l'ensemble des sections.\n\n"
    "Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, au format exact :\n"
    "{\n"
    '  "sections": [\n'
    '    {"sector": "Nom du secteur", "title": "Titre de la section", '
    '"content": "Contenu pédagogique clair en français (150 à 350 mots), avec des listes à puces préfixées par \\"• \\".", '
    '"key_points": ["point clé 1", "point clé 2"]}\n'
    "  ],\n"
    '  "exam": [\n'
    '    {"question": "Question en français ?", "options": ["choix A", "choix B", "choix C", "choix D"], '
    '"correct_index": 0, "explanation": "Brève explication de la bonne réponse."}\n'
    "  ]\n"
    "}\n\n"
    "Contraintes : 4 à 10 sections; 10 à 15 questions d'examen; exactement 4 options par question; "
    "une seule bonne réponse par question (correct_index entre 0 et 3); tout en français."
)


def training_public(doc: dict, include_answers: bool) -> dict:
    d = {k: v for k, v in doc.items() if k not in ("_id", "storage_path")}
    if not include_answers:
        d["exam"] = [{"id": q["id"], "question": q["question"], "options": q["options"]}
                     for q in d.get("exam") or []]
    return d


def extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def parse_llm_json(raw: str) -> dict:
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Réponse IA sans JSON exploitable")
    return json.loads(raw[start:end + 1])


async def generate_training_content(training_id: str, pharmacy_id: str, text: str):
    try:
        llm = LlmChat(
            api_key=os.environ['EMERGENT_LLM_KEY'],
            session_id=f"training-{training_id}",
            system_message=TRAINING_SYSTEM,
        ).with_model("openai", "gpt-5.4")
        resp = await llm.send_message(UserMessage(
            text=f"Voici le contenu extrait du document de formation de la pharmacie :\n\n{text[:120000]}"))
        raw = resp if isinstance(resp, str) else getattr(resp, "content", None) or str(resp)
        data = parse_llm_json(raw)
        sections, exam = [], []
        for s in data.get("sections", []):
            if not s.get("title") or not s.get("content"):
                continue
            sections.append({"id": str(uuid.uuid4()), "sector": str(s.get("sector") or "Général"),
                             "title": str(s["title"]), "content": str(s["content"]),
                             "key_points": [str(k) for k in (s.get("key_points") or [])][:8]})
        for q in data.get("exam", []):
            opts = [str(o) for o in (q.get("options") or [])]
            ci = q.get("correct_index")
            if not q.get("question") or len(opts) < 2 or not isinstance(ci, int) or not (0 <= ci < len(opts)):
                continue
            exam.append({"id": str(uuid.uuid4()), "question": str(q["question"]), "options": opts,
                         "correct_index": ci, "explanation": str(q.get("explanation") or "")})
        if not sections or not exam:
            raise ValueError("Génération IA incomplète (sections ou examen manquants)")
        await db.trainings.update_one({"id": training_id}, {"$set": {
            "status": "draft", "sections": sections, "exam": exam, "error": None,
            "updated_at": datetime.now(timezone.utc).isoformat()}})
        await log_audit("système", "system", "GENERATION_FORMATION", "formation", training_id,
                        f"{len(sections)} section(s) et {len(exam)} question(s) générées par IA", pharmacy_id)
    except Exception as exc:
        logger.error(f"Génération formation {training_id} échouée : {exc}")
        await db.trainings.update_one({"id": training_id}, {"$set": {
            "status": "error", "error": str(exc), "updated_at": datetime.now(timezone.utc).isoformat()}})


@api_router.post("/trainings/upload")
async def upload_training(title: str = Form(...), pharmacy_id: str = Form(""),
                          file: UploadFile = File(...), principal: dict = Depends(get_principal)):
    pid = pharmacy_id if (principal["role"] == "superadmin" and pharmacy_id) else principal["pharmacy_id"]
    if not pid:
        raise HTTPException(status_code=400, detail="pharmacy_id requis.")
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Format non autorisé : déposez un dossier de formation en PDF.")
    data = await file.read()
    if len(data) > TRAINING_MAX_SIZE:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (maximum 15 Mo).")
    try:
        text = await asyncio.to_thread(extract_pdf_text, data)
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de lire ce PDF.")
    if len(text.strip()) < 200:
        raise HTTPException(status_code=400, detail="Ce PDF ne contient pas assez de texte lisible (document numérisé en image ?).")
    path = f"{APP_NAME}/formations/{pid}/{uuid.uuid4()}.pdf"
    result = await asyncio.to_thread(put_object, path, data, "application/pdf")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "title": title.strip(),
        "status": "processing", "error": None,
        "source_filename": file.filename, "source_size": len(data), "storage_path": result["path"],
        "sections": [], "exam": [], "passing_score": 80,
        "created_by": principal["email"], "created_at": now, "updated_at": now, "published_at": None,
    }
    await db.trainings.insert_one(doc)
    await log_audit(principal["email"], principal["role"], "CREATION_FORMATION", "formation", doc["id"],
                    f"Formation « {doc['title']} » créée à partir de {file.filename}", pid)
    asyncio.create_task(generate_training_content(doc["id"], pid, text))
    return training_public(doc, True)


@api_router.get("/trainings")
async def list_trainings(pharmacy_id: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    if user["role"] == "superadmin":
        query: dict = {"pharmacy_id": pharmacy_id} if pharmacy_id else {}
    elif user["role"] == "admin":
        if not user.get("pharmacy_id"):
            raise HTTPException(status_code=403, detail="Aucune pharmacie associée à ce compte.")
        query = {"pharmacy_id": user["pharmacy_id"]}
    else:
        query = {"pharmacy_id": user.get("pharmacy_id") or "", "status": "published"}
    docs = await db.trainings.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    include_answers = user["role"] in ("admin", "superadmin")
    out = []
    for d in docs:
        item = training_public(d, include_answers)
        if user["role"] == "employee":
            attempts = await db.training_attempts.find(
                {"training_id": d["id"], "user_id": user["id"]}, {"_id": 0, "score": 1, "passed": 1}).to_list(200)
            item["my_attempts"] = len(attempts)
            item["my_best_score"] = max((a["score"] for a in attempts), default=None)
            item["my_passed"] = any(a["passed"] for a in attempts)
            item["my_assignment"] = await db.training_assignments.find_one(
                {"training_id": d["id"], "employee_email": user["email"]}, {"_id": 0, "due_date": 1})
        out.append(item)
    return out


async def get_training_or_404(training_id: str, user: dict) -> dict:
    doc = await db.trainings.find_one({"id": training_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Formation introuvable.")
    if user["role"] != "superadmin" and (user.get("pharmacy_id") or "") != doc["pharmacy_id"]:
        raise HTTPException(status_code=404, detail="Formation introuvable.")
    if user["role"] == "employee" and doc["status"] != "published":
        raise HTTPException(status_code=404, detail="Formation introuvable.")
    return doc


@api_router.get("/trainings/{training_id}")
async def get_training(training_id: str, user: dict = Depends(get_current_user)):
    doc = await get_training_or_404(training_id, user)
    return training_public(doc, user["role"] in ("admin", "superadmin"))


class TrainingSectionIn(BaseModel):
    id: Optional[str] = None
    sector: str
    title: str
    content: str
    key_points: list[str] = []


class ExamQuestionIn(BaseModel):
    id: Optional[str] = None
    question: str
    options: list[str]
    correct_index: int
    explanation: str = ""


class TrainingUpdateIn(BaseModel):
    title: Optional[str] = None
    sections: Optional[list[TrainingSectionIn]] = None
    exam: Optional[list[ExamQuestionIn]] = None
    passing_score: Optional[int] = None
    status: Optional[str] = None


@api_router.put("/trainings/{training_id}")
async def update_training(training_id: str, payload: TrainingUpdateIn, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    patch: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.title is not None:
        patch["title"] = payload.title.strip()
    if payload.passing_score is not None:
        if not (0 < payload.passing_score <= 100):
            raise HTTPException(status_code=400, detail="Note de passage invalide (1 à 100).")
        patch["passing_score"] = payload.passing_score
    if payload.sections is not None:
        patch["sections"] = [{"id": s.id or str(uuid.uuid4()), "sector": s.sector, "title": s.title,
                              "content": s.content, "key_points": s.key_points} for s in payload.sections]
    if payload.exam is not None:
        for q in payload.exam:
            if len(q.options) < 2 or not (0 <= q.correct_index < len(q.options)):
                raise HTTPException(status_code=400, detail="Question d'examen invalide.")
        patch["exam"] = [{"id": q.id or str(uuid.uuid4()), "question": q.question, "options": q.options,
                          "correct_index": q.correct_index, "explanation": q.explanation} for q in payload.exam]
    if payload.status is not None:
        if payload.status not in ("draft", "published"):
            raise HTTPException(status_code=400, detail="Statut invalide.")
        if doc["status"] in ("processing",):
            raise HTTPException(status_code=400, detail="La formation est encore en préparation par l'IA.")
        patch["status"] = payload.status
        if payload.status == "published":
            if not (patch.get("sections") or doc.get("sections")) or not (patch.get("exam") or doc.get("exam")):
                raise HTTPException(status_code=400, detail="Impossible de publier sans sections ni examen.")
            patch["published_at"] = datetime.now(timezone.utc).isoformat()
            patch["error"] = None
    await db.trainings.update_one({"id": training_id}, {"$set": patch})
    action = "PUBLICATION_FORMATION" if payload.status == "published" else "MODIFICATION_FORMATION"
    await log_audit(principal["email"], principal["role"], action, "formation", training_id,
                    f"Formation « {patch.get('title', doc['title']) }» — champs : {', '.join(k for k in patch if k != 'updated_at')}",
                    doc["pharmacy_id"])
    return training_public({**doc, **patch}, True)


@api_router.delete("/trainings/{training_id}")
async def delete_training(training_id: str, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    await db.trainings.delete_one({"id": training_id})
    await db.training_attempts.delete_many({"training_id": training_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_FORMATION", "formation", training_id,
                    f"Formation « {doc['title']} » et ses résultats supprimés", doc["pharmacy_id"])
    return {"status": "supprimée"}


@api_router.get("/trainings/{training_id}/source")
async def get_training_source(training_id: str, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    full = await db.trainings.find_one({"id": training_id}, {"_id": 0, "storage_path": 1})
    if not full or not full.get("storage_path"):
        raise HTTPException(status_code=404, detail="Document source introuvable.")
    content, ctype = await asyncio.to_thread(get_object, full["storage_path"])
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{doc.get("source_filename") or "formation.pdf"}"'})


class AttemptIn(BaseModel):
    answers: list[int]


@api_router.post("/trainings/{training_id}/attempts")
async def submit_attempt(training_id: str, payload: AttemptIn, user: dict = Depends(get_current_user)):
    doc = await get_training_or_404(training_id, user)
    exam = doc.get("exam") or []
    if not exam:
        raise HTTPException(status_code=400, detail="Cette formation n'a pas encore d'examen.")
    if len(payload.answers) != len(exam):
        raise HTTPException(status_code=400, detail="Veuillez répondre à toutes les questions.")
    correct = sum(1 for a, q in zip(payload.answers, exam) if a == q["correct_index"])
    score = round(correct / len(exam) * 100)
    passing = doc.get("passing_score", 80)
    passed = score >= passing
    attempt = {
        "id": str(uuid.uuid4()), "training_id": training_id, "pharmacy_id": doc["pharmacy_id"],
        "user_id": user["id"], "user_email": user["email"], "user_name": user["name"],
        "answers": payload.answers, "score": score, "passed": passed,
        "correct_count": correct, "total": len(exam),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.training_attempts.insert_one(attempt)
    await log_audit(user["email"], user["role"], "TENTATIVE_EXAMEN", "formation", training_id,
                    f"Examen « {doc['title']} » : {score} % ({'réussi' if passed else 'échoué'})", doc["pharmacy_id"])
    return {
        "score": score, "passed": passed, "correct_count": correct, "total": len(exam),
        "passing_score": passing,
        "results": [{"question_id": q["id"], "your_answer": a, "correct": a == q["correct_index"],
                     "correct_index": q["correct_index"], "explanation": q.get("explanation", "")}
                    for a, q in zip(payload.answers, exam)],
    }


@api_router.get("/trainings/{training_id}/attempts")
async def list_attempts(training_id: str, user: dict = Depends(get_current_user)):
    doc = await get_training_or_404(training_id, user)
    if user["role"] in ("admin", "superadmin"):
        query: dict = {"training_id": training_id}
    else:
        query = {"training_id": training_id, "user_id": user["id"]}
    docs = await db.training_attempts.find(query, {"_id": 0, "answers": 0}).sort("completed_at", -1).to_list(1000)
    return docs


# ==================== Assignation de formations & relances ====================

class AssignmentIn(BaseModel):
    employee_email: str
    employee_name: str
    due_date: str


class AssignmentsIn(BaseModel):
    assignments: list[AssignmentIn]


@api_router.post("/trainings/assignments/reminders/run")
async def run_training_reminders(principal: dict = Depends(get_principal)):
    scope_pid = None if principal["role"] == "superadmin" else principal["pharmacy_id"]
    sent = await send_training_reminders(scope_pid)
    await log_audit(principal["email"], principal["role"], "RELANCES_FORMATION_DECLENCHEES", "formation", "relances",
                    f"{sent} relance(s) envoyée(s) manuellement", principal.get("pharmacy_id", ""))
    return {"sent": sent}


@api_router.get("/trainings/{training_id}/assignments")
async def list_training_assignments(training_id: str, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    await get_training_or_404(training_id, user)
    assigns = await db.training_assignments.find({"training_id": training_id}, {"_id": 0}).sort("due_date", 1).to_list(1000)
    today = date.today().isoformat()
    for a in assigns:
        best = await db.training_attempts.find_one(
            {"training_id": training_id, "user_email": a["employee_email"], "passed": True},
            {"_id": 0, "score": 1, "completed_at": 1}, sort=[("score", -1)])
        a["passed"] = best is not None
        a["passed_score"] = best["score"] if best else None
        a["overdue"] = (best is None) and a["due_date"] < today
    return assigns


@api_router.post("/trainings/{training_id}/assignments")
async def assign_training(training_id: str, payload: AssignmentsIn, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    now = datetime.now(timezone.utc).isoformat()
    count = 0
    for a in payload.assignments:
        email = a.employee_email.strip().lower()
        if not email or not a.due_date:
            continue
        try:
            date.fromisoformat(a.due_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Date limite invalide (format attendu : AAAA-MM-JJ).")
        await db.training_assignments.update_one(
            {"training_id": training_id, "employee_email": email},
            {"$set": {"employee_name": a.employee_name, "due_date": a.due_date,
                      "assigned_by": principal["email"], "assigned_at": now, "reminder_sent_for": None,
                      "pharmacy_id": doc["pharmacy_id"]},
             "$setOnInsert": {"id": str(uuid.uuid4())}},
            upsert=True)
        count += 1
    await log_audit(principal["email"], principal["role"], "ASSIGNATION_FORMATION", "formation", training_id,
                    f"Formation « {doc['title']} » assignée à {count} employé(s)", doc["pharmacy_id"])
    return {"count": count}


@api_router.delete("/trainings/{training_id}/assignments/{assignment_id}")
async def delete_training_assignment(training_id: str, assignment_id: str, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    target = await db.training_assignments.find_one({"id": assignment_id, "training_id": training_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Assignation introuvable.")
    await db.training_assignments.delete_one({"id": assignment_id})
    await log_audit(principal["email"], principal["role"], "RETRAIT_ASSIGNATION", "formation", training_id,
                    f"Assignation retirée pour {target['employee_email']}", doc["pharmacy_id"])
    return {"status": "retirée"}


def training_reminder_html(name: str, title: str, due_date: str, days: int) -> str:
    if days < 0:
        urgence = (f"était à compléter avant le <strong>{due_date}</strong> — "
                   f"elle est en retard de <strong>{-days} jour(s)</strong>")
    else:
        urgence = (f"doit être complétée avant le <strong>{due_date}</strong> — "
                   f"il vous reste <strong>{days} jour(s)</strong>")
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>LuminaHR — Relance de formation</h2>"
        f"<p>Bonjour {name},</p>"
        f"<p>Votre formation <strong>« {title} »</strong> {urgence}.</p>"
        "<p>Connectez-vous à LuminaHR, consultez le contenu par secteur puis complétez l'examen final.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Relance automatique envoyée par LuminaHR.</p>"
        "</div>"
    )


async def send_training_reminders(pharmacy_id: Optional[str] = None) -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("Relances formations : RESEND_API_KEY manquante, envoi ignoré.")
        return 0
    resend.api_key = api_key
    sender = await get_sender()
    query = {"pharmacy_id": pharmacy_id} if pharmacy_id else {}
    assigns = await db.training_assignments.find(query).to_list(5000)
    today = date.today()
    sent = 0
    for a in assigns:
        try:
            days = (date.fromisoformat(a["due_date"]) - today).days
        except (ValueError, KeyError):
            continue
        if days > 7:
            continue
        if a.get("reminder_sent_for") == a["due_date"]:
            continue
        passed = await db.training_attempts.find_one(
            {"training_id": a["training_id"], "user_email": a["employee_email"], "passed": True})
        if passed:
            continue
        training = await db.trainings.find_one({"id": a["training_id"]}, {"_id": 0, "title": 1, "status": 1})
        if not training or training.get("status") != "published":
            continue
        try:
            params = {
                "from": sender,
                "to": [a["employee_email"]],
                "subject": f"Relance — formation « {training['title']} » à compléter" + (" (en retard)" if days < 0 else ""),
                "html": training_reminder_html(a.get("employee_name", ""), training["title"], a["due_date"], days),
            }
            await asyncio.to_thread(resend.Emails.send, params)
            await db.training_assignments.update_one({"id": a["id"]}, {"$set": {"reminder_sent_for": a["due_date"]}})
            await log_audit("système", "system", "RELANCE_FORMATION_ENVOYEE", "formation", a["training_id"],
                            f"Relance envoyée à {a['employee_email']} (échéance {a['due_date']})", a.get("pharmacy_id", ""))
            sent += 1
        except Exception as exc:
            logger.error(f"Relance formation {a.get('id')} échouée : {exc}")
    return sent


async def training_reminders_job():
    sent = await send_training_reminders()
    logger.info(f"Relances formations quotidiennes : {sent} envoyée(s)")


scheduler = AsyncIOScheduler(timezone="America/Montreal")


def reminder_html(doc: dict, days: int) -> str:
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>LuminaHR — Rappel de renouvellement</h2>"
        f"<p>Bonjour {doc['employee_name']},</p>"
        f"<p>Votre licence professionnelle <strong>{doc['license_number']}</strong> "
        f"expire le <strong>{doc['expiry_date']}</strong> — dans <strong>{days} jour(s)</strong>.</p>"
        "<p>Veuillez entamer votre démarche de renouvellement dès maintenant et transmettre "
        "votre nouveau certificat à votre gestionnaire.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Rappel automatique envoyé par LuminaHR "
        "30 jours avant l'échéance. Données traitées selon la Loi 25 (Québec).</p>"
        "</div>"
    )


async def send_license_reminders() -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("Rappels licences : RESEND_API_KEY manquante, envoi ignoré.")
        return 0
    resend.api_key = api_key
    sender = await get_sender()
    docs = await db.licenses.find({"is_deleted": False}).to_list(2000)
    today = date.today()
    sent = 0
    for doc in docs:
        try:
            days = (date.fromisoformat(doc["expiry_date"]) - today).days
        except (ValueError, KeyError):
            continue
        if not (0 <= days <= 30):
            continue
        if doc.get("reminder_sent_for") == doc["expiry_date"] or not doc.get("employee_email"):
            continue
        try:
            params = {
                "from": sender,
                "to": [doc["employee_email"]],
                "subject": f"Rappel — votre licence {doc['license_number']} expire dans {days} jour(s)",
                "html": reminder_html(doc, days),
            }
            await asyncio.to_thread(resend.Emails.send, params)
            await db.licenses.update_one({"id": doc["id"]}, {"$set": {"reminder_sent_for": doc["expiry_date"]}})
            await log_audit("système", "system", "RAPPEL_LICENCE_ENVOYE", "licence", doc["id"],
                            f"Rappel envoyé à {doc['employee_email']} ({days} jour(s) restant(s))", doc["pharmacy_id"])
            sent += 1
        except Exception as exc:
            logger.error(f"Rappel licence {doc['id']} échoué : {exc}")
            await log_audit("système", "system", "RAPPEL_LICENCE_ECHEC", "licence", doc["id"],
                            f"Échec du rappel à {doc.get('employee_email', '?')} : {exc}", doc.get("pharmacy_id", ""))
    return sent


@api_router.post("/licenses/reminders/run")
async def run_license_reminders(principal: dict = Depends(get_principal)):
    sent = await send_license_reminders()
    await log_audit(principal["email"], principal["role"], "RAPPELS_DECLENCHES", "licence", "rappels",
                    f"{sent} rappel(s) envoyé(s) manuellement", principal.get("pharmacy_id", ""))
    return {"sent": sent}


async def license_reminders_job():
    sent = await send_license_reminders()
    logger.info(f"Rappels licences quotidiens : {sent} envoyé(s)")


async def monthly_reports_job():
    settings = await db.report_settings.find({"enabled": True}, {"_id": 0}).to_list(1000)
    logger.info(f"Rapport mensuel : {len(settings)} pharmacie(s) à traiter")
    for s in settings:
        try:
            await send_report_email(s)
        except Exception as exc:
            logger.error(f"Rapport mensuel échoué pour {s.get('pharmacy_id')}: {exc}")
            await log_audit("système", "system", "ENVOI_RAPPORT_ECHEC", "rapport", s.get("pharmacy_id", ""),
                            f"Échec de l'envoi du rapport mensuel à {s.get('admin_email', '?')} : {exc}",
                            s.get("pharmacy_id", ""))


@app.on_event("startup")
async def startup_tasks():
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Object storage initialisé")
    except Exception as exc:
        logger.error(f"Init object storage échoué : {exc}")
    await seed_users()
    scheduler.add_job(monthly_reports_job, CronTrigger(day=1, hour=8, minute=0))
    scheduler.add_job(license_reminders_job, CronTrigger(hour=8, minute=30))
    scheduler.add_job(training_reminders_job, CronTrigger(hour=8, minute=45))
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
