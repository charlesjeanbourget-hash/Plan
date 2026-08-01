from fastapi import FastAPI, APIRouter, File, UploadFile, Form, Header, HTTPException, Query, Depends, Request
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import re
import math
import unicodedata
import json
import logging
import uuid
import asyncio
import secrets
import hashlib
import requests
from zoneinfo import ZoneInfo
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
    "Tu es Lumina, l'assistante IA d'Arrière Plan, un système de gestion des ressources humaines (SIRH) "
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
    return {"message": "Arrière Plan API"}


CHAT_RATE: dict = {}
CHAT_RATE_LIMIT = 30


@api_router.post("/chat")
async def chat_endpoint(req: ChatRequest, request: Request):
    user = await get_current_user(request)
    now_ts = datetime.now(timezone.utc).timestamp()
    stamps = [t for t in CHAT_RATE.get(user["id"], []) if now_ts - t < 3600]
    if len(stamps) >= CHAT_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Limite de messages atteinte. Réessayez dans une heure.")
    stamps.append(now_ts)
    CHAT_RATE[user["id"]] = stamps
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
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
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
    if user.get("is_temporary_password") and request.url.path not in (
            "/api/auth/change-password", "/api/auth/me"):
        raise HTTPException(status_code=403,
                            detail="Vous devez d'abord remplacer votre mot de passe temporaire.",
                            headers={"X-Password-Change-Required": "1"})
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
    await record_login_event(user, "CONNEXION", request)
    return {"access_token": create_access_token(user), "user": user_public(user)}


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "inconnu")


async def record_login_event(user: dict, event: str, request: Request):
    await db.login_events.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user["role"],
        "event": event,
        "ip": client_ip(request),
        "user_agent": request.headers.get("user-agent", "")[:300],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user_public(user)


def validate_password_strength(pw: str) -> Optional[str]:
    if len(pw) < 10:
        return "Le mot de passe doit contenir au moins 10 caractères."
    if not any(c.isupper() for c in pw):
        return "Le mot de passe doit contenir au moins une majuscule."
    if not any(c.islower() for c in pw):
        return "Le mot de passe doit contenir au moins une minuscule."
    if not any(c.isdigit() for c in pw):
        return "Le mot de passe doit contenir au moins un chiffre."
    return None


@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordIn, request: Request, user: dict = Depends(get_current_user)):
    current_password = payload.current_password.strip()
    new_password = payload.new_password.strip()
    if not verify_password(current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect.")
    err = validate_password_strength(new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if new_password == current_password:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit être différent de l'actuel.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(new_password), "is_temporary_password": False}},
    )
    await log_audit(user["email"], user["role"], "CHANGEMENT_MOT_DE_PASSE", "utilisateur", user["id"],
                    "Mot de passe modifié par l'utilisateur", user.get("pharmacy_id") or "")
    await record_login_event(user, "CHANGEMENT_MOT_DE_PASSE", request)
    return {"status": "modifié"}


AUTH_SEED_USERS = [
    {"email": "admin@luminahr.ca", "name": "Dr. Sophie Lavoie", "role": "admin",
     "pharmacy_id": "ph1", "employee_id": "e1"},
    {"email": "julie@luminahr.ca", "name": "Julie Gagnon", "role": "employee",
     "pharmacy_id": "ph1", "employee_id": "e2"},
    {"email": "gestion@luminahr.ca", "name": "Marc-André Roy", "role": "manager",
     "pharmacy_id": "ph1", "employee_id": None},
    {"email": "jeffmenard78@hotmail.com", "name": "Jeff Ménard", "role": "superadmin"},
    {"email": "charles-jbourget@hotmail.com", "name": "Charles-J. Bourget", "role": "superadmin"},
    {"email": "charlesjeanbourget@gmail.com", "name": "Charles Jean-Bourget", "role": "superadmin"},
]


def hash_punch_code(code: str) -> str:
    pepper = os.environ["PUNCH_PEPPER"]
    return hashlib.sha256(f"{pepper}:{code}".encode("utf-8")).hexdigest()


async def migrate_punch_codes():
    async for prof in db.employee_profiles.find({"punch_code": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "punch_code": 1}):
        await db.employee_profiles.update_one(
            {"id": prof["id"]},
            {"$set": {"punch_code_hash": hash_punch_code(prof["punch_code"])}, "$unset": {"punch_code": ""}})


async def seed_users():
    seed_password = os.environ.get("SEED_DEFAULT_PASSWORD", "")
    for su in AUTH_SEED_USERS:
        existing = await db.users.find_one({"email": su["email"]})
        if existing is None:
            if not seed_password:
                logger.warning(f"SEED_DEFAULT_PASSWORD absent — compte {su['email']} non créé.")
                continue
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": su["email"],
                "password_hash": hash_password(seed_password),
                "name": su["name"],
                "role": su["role"],
                "pharmacy_id": su.get("pharmacy_id"),
                "employee_id": su.get("employee_id"),
                "is_temporary_password": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.employee_profiles.create_index("punch_code_hash")
    await migrate_punch_codes()


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
    if payload.role not in ("admin", "manager", "employee", "superadmin"):
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
    if patch.get("role") and patch["role"] not in ("admin", "manager", "employee", "superadmin"):
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
    if user["role"] not in ("admin", "manager", "superadmin"):
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
        f"<h2 style='color:#059669'>Arrière Plan — Rapport mensuel des licences</h2>"
        f"<p style='color:#64748b'>{pharmacy_name}</p>"
        f"{body}"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Rapport généré automatiquement le 1er du mois par Arrière Plan, "
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
        "subject": f"Arrière Plan — Rapport mensuel des licences — {setting.get('pharmacy_name', '')}",
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


def get_fernet():
    from cryptography.fernet import Fernet
    return Fernet(os.environ["LICENSE_ENCRYPTION_KEY"].encode("utf-8"))


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
    if doc.get("certificate_encrypted"):
        content = get_fernet().decrypt(content)
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

DEFAULT_SENDER = f"Arrière Plan <{SENDER_EMAIL}>" if SENDER_EMAIL and "<" not in SENDER_EMAIL else (SENDER_EMAIL or "Arrière Plan <onboarding@resend.dev>")


async def get_sender() -> str:
    doc = await db.email_settings.find_one({"id": "global"}, {"_id": 0})
    if doc and doc.get("sender_email"):
        return f"{doc.get('sender_name') or 'Arrière Plan'} <{doc['sender_email']}>"
    return DEFAULT_SENDER


class EmailSettingsIn(BaseModel):
    sender_email: str
    sender_name: str = "Arrière Plan"


@api_router.get("/email-settings")
async def get_email_settings(principal: dict = Depends(get_principal)):
    doc = await db.email_settings.find_one({"id": "global"}, {"_id": 0})
    base = doc or {"id": "global", "sender_email": "", "sender_name": "Arrière Plan"}
    return {**base, "default_sender": DEFAULT_SENDER}


@api_router.post("/email-settings")
async def save_email_settings(payload: EmailSettingsIn, su: dict = Depends(require_superadmin)):
    doc = {"id": "global", "sender_email": payload.sender_email.strip(),
           "sender_name": payload.sender_name.strip() or "Arrière Plan"}
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
async def upload_training(title: str = Form(...), pharmacy_id: str = Form(""), category: str = Form("Formation continue"),
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
        "status": "processing", "error": None, "category": category.strip() or "Formation continue",
        "source_filename": file.filename, "source_size": len(data), "storage_path": result["path"],
        "sections": [], "exam": [], "passing_score": 80,
        "created_by": principal["email"], "created_at": now, "updated_at": now, "published_at": None,
    }
    await db.trainings.insert_one(doc)
    await log_audit(principal["email"], principal["role"], "CREATION_FORMATION", "formation", doc["id"],
                    f"Formation « {doc['title']} » créée à partir de {file.filename}", pid)
    asyncio.create_task(generate_training_content(doc["id"], pid, text))
    return training_public(doc, True)


class ManualTrainingIn(BaseModel):
    title: str
    category: str = "Formation continue"
    source_text: str


@api_router.post("/trainings/manual")
async def create_manual_training(payload: ManualTrainingIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    text = payload.source_text.strip()
    if len(text) < 200:
        raise HTTPException(status_code=400, detail="Décrivez la formation plus en détail (au moins 200 caractères) pour que l'IA puisse la construire.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "title": payload.title.strip(),
        "status": "processing", "error": None, "category": payload.category.strip() or "Formation continue",
        "source_filename": "Saisie manuelle (formulaire)", "source_size": len(text), "storage_path": None,
        "sections": [], "exam": [], "passing_score": 80,
        "created_by": principal["email"], "created_at": now, "updated_at": now, "published_at": None,
    }
    await db.trainings.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "CREATION_FORMATION", "formation", doc["id"],
                    f"Formation « {doc['title']} » créée par formulaire ({doc['category']})", pid)
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
    include_answers = user["role"] in ("admin", "manager", "superadmin")
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
    return training_public(doc, user["role"] in ("admin", "manager", "superadmin"))


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
    category: Optional[str] = None
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
    if payload.category is not None:
        patch["category"] = payload.category.strip() or "Formation continue"
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
    if user["role"] in ("admin", "manager", "superadmin"):
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
        "<h2 style='color:#059669'>Arrière Plan — Relance de formation</h2>"
        f"<p>Bonjour {name},</p>"
        f"<p>Votre formation <strong>« {title} »</strong> {urgence}.</p>"
        "<p>Connectez-vous à Arrière Plan, consultez le contenu par secteur puis complétez l'examen final.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Relance automatique envoyée par Arrière Plan.</p>"
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


# ==================== Profils employés (disponibilités, rôles, capacités) ====================

MONTREAL_TZ = ZoneInfo("America/Montreal")
WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def default_availability() -> dict:
    return {d: {"available": True, "start": "08:00", "end": "21:00"} for d in WEEK_DAYS}


class ProfileIn(BaseModel):
    employee_name: Optional[str] = None
    roles: Optional[list[str]] = None
    capacities: Optional[list[str]] = None
    restrictions: Optional[list[str]] = None
    min_hours_week: Optional[int] = None
    max_hours_week: Optional[int] = None
    availability: Optional[dict] = None
    notes: Optional[str] = None
    payroll_number: Optional[str] = None


def sanitize_profile(doc: dict) -> dict:
    doc["punch_code_set"] = bool(doc.get("punch_code_hash") or doc.get("punch_code"))
    doc.pop("punch_code", None)
    doc.pop("punch_code_hash", None)
    return doc


async def get_or_create_profile(pharmacy_id: str, employee_id: str, employee_name: str = "") -> dict:
    doc = await db.employee_profiles.find_one({"pharmacy_id": pharmacy_id, "employee_id": employee_id}, {"_id": 0})
    if doc:
        return sanitize_profile(doc)
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pharmacy_id, "employee_id": employee_id,
        "employee_name": employee_name, "roles": [], "capacities": [], "restrictions": [],
        "min_hours_week": 0, "max_hours_week": 40, "availability": default_availability(),
        "punch_code_hash": None, "notes": "",
        "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": "",
    }
    await db.employee_profiles.insert_one({**doc})
    return sanitize_profile(doc)


def check_profile_access(user: dict, employee_id: str) -> str:
    if user["role"] in ("admin", "manager", "superadmin"):
        pid = user.get("pharmacy_id") or ""
        if not pid and user["role"] == "admin":
            raise HTTPException(status_code=403, detail="Aucune pharmacie associée.")
        return pid or "ph1"
    if user.get("employee_id") != employee_id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez modifier que votre propre profil.")
    return user.get("pharmacy_id") or ""


@api_router.get("/profiles")
async def list_profiles(user: dict = Depends(get_current_user)):
    if user["role"] in ("admin", "manager", "superadmin"):
        pid = user.get("pharmacy_id") or ""
        query = {"pharmacy_id": pid} if pid else {}
        docs = await db.employee_profiles.find(query, {"_id": 0}).to_list(1000)
        return [sanitize_profile(d) for d in docs]
    if not user.get("employee_id"):
        return []
    return [await get_or_create_profile(user.get("pharmacy_id") or "", user["employee_id"], user["name"])]


@api_router.get("/profiles/{employee_id}")
async def get_profile(employee_id: str, employee_name: str = Query(""), user: dict = Depends(get_current_user)):
    pid = check_profile_access(user, employee_id)
    return await get_or_create_profile(pid, employee_id, employee_name or "")


@api_router.put("/profiles/{employee_id}")
async def update_profile(employee_id: str, payload: ProfileIn, user: dict = Depends(get_current_user)):
    pid = check_profile_access(user, employee_id)
    doc = await get_or_create_profile(pid, employee_id, payload.employee_name or "")
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "availability" in patch:
        avail = {}
        for d in WEEK_DAYS:
            day = patch["availability"].get(d) or {}
            avail[d] = {"available": bool(day.get("available", True)),
                        "start": str(day.get("start", "08:00")), "end": str(day.get("end", "21:00"))}
        patch["availability"] = avail
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    patch["updated_by"] = user["email"]
    await db.employee_profiles.update_one({"id": doc["id"]}, {"$set": patch})
    await log_audit(user["email"], user["role"], "MODIFICATION_PROFIL", "profil", employee_id,
                    f"Profil de {patch.get('employee_name', doc.get('employee_name', employee_id))} mis à jour", pid)
    return {**doc, **patch}


@api_router.post("/profiles/{employee_id}/punch-code")
async def generate_punch_code(employee_id: str, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    doc = await get_or_create_profile(pid, employee_id)
    for _ in range(50):
        code = f"{secrets.randbelow(10000):04d}"
        exists = await db.employee_profiles.find_one({"punch_code_hash": hash_punch_code(code)})
        if not exists:
            break
    else:
        raise HTTPException(status_code=500, detail="Impossible de générer un NIP unique.")
    await db.employee_profiles.update_one(
        {"id": doc["id"]},
        {"$set": {"punch_code_hash": hash_punch_code(code)}, "$unset": {"punch_code": ""}})
    await log_audit(principal["email"], principal["role"], "GENERATION_NIP", "profil", employee_id,
                    f"Nouveau NIP de punch généré pour {doc.get('employee_name') or employee_id}", pid)
    return {"punch_code": code}


# ==================== Punch des heures ====================

class PunchCodeIn(BaseModel):
    code: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None


class PunchGeoIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None


def geo_dict(lat: Optional[float], lng: Optional[float], accuracy: Optional[float]) -> Optional[dict]:
    if lat is None or lng is None:
        return None
    return {"lat": lat, "lng": lng, "accuracy": accuracy}


async def do_punch(pharmacy_id: str, employee_id: str, employee_name: str, source: str, actor: str,
                   location: Optional[dict] = None) -> dict:
    now = datetime.now(timezone.utc)
    open_p = await db.punches.find_one(
        {"pharmacy_id": pharmacy_id, "employee_id": employee_id, "punch_out": None}, {"_id": 0})
    if open_p:
        await db.punches.update_one({"id": open_p["id"]},
                                    {"$set": {"punch_out": now.isoformat(), "punch_out_location": location}})
        duration = round((now - datetime.fromisoformat(open_p["punch_in"])).total_seconds() / 3600, 2)
        await log_audit(actor, "system" if source == "punch" else "admin", "PUNCH_SORTIE", "punch", open_p["id"],
                        f"{employee_name} — sortie ({duration} h)", pharmacy_id)
        return {"action": "out", "employee_name": employee_name, "time": now.isoformat(),
                "punch_in": open_p["punch_in"], "duration_hours": duration}
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pharmacy_id, "employee_id": employee_id,
        "employee_name": employee_name, "date": now.astimezone(MONTREAL_TZ).date().isoformat(),
        "punch_in": now.isoformat(), "punch_out": None, "source": source,
        "created_by": actor, "note": "", "punch_in_location": location, "punch_out_location": None,
    }
    await db.punches.insert_one({**doc})
    await log_audit(actor, "system" if source == "punch" else "admin", "PUNCH_ENTREE", "punch", doc["id"],
                    f"{employee_name} — entrée", pharmacy_id)
    return {"action": "in", "employee_name": employee_name, "time": now.isoformat()}


async def punch_throttle_check(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "inconnu")
    identifier = f"punch:{ip}"
    now = datetime.now(timezone.utc)
    attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    if attempt and attempt.get("locked_until") and datetime.fromisoformat(attempt["locked_until"]) > now:
        raise HTTPException(status_code=429,
                            detail="Trop de NIP invalides. Borne verrouillée quelques minutes — contactez l'administration.",
                            headers={"Retry-After": str(LOCKOUT_MINUTES * 60)})
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


@api_router.post("/punch/preview")
async def punch_preview(payload: PunchCodeIn, request: Request):
    identifier = await punch_throttle_check(request)
    prof = await resolve_punch_code(payload.code.strip(), identifier)
    open_p = await db.punches.find_one(
        {"pharmacy_id": prof["pharmacy_id"], "employee_id": prof["employee_id"], "punch_out": None}, {"_id": 0})
    full_name = (prof.get("employee_name", "") or "").strip()
    parts = full_name.split()
    display = f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else full_name
    return {"employee_name": display, "next_action": "out" if open_p else "in",
            "since": open_p["punch_in"] if open_p else None}


@api_router.post("/punch")
async def punch_by_code(payload: PunchCodeIn, request: Request):
    identifier = await punch_throttle_check(request)
    prof = await resolve_punch_code(payload.code.strip(), identifier)
    return await do_punch(prof["pharmacy_id"], prof["employee_id"], prof.get("employee_name", ""), "punch", "borne",
                          geo_dict(payload.lat, payload.lng, payload.accuracy))


@api_router.post("/punch/me")
async def punch_me(payload: Optional[PunchGeoIn] = None, user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à votre compte.")
    location = geo_dict(payload.lat, payload.lng, payload.accuracy) if payload else None
    return await do_punch(user.get("pharmacy_id") or "", user["employee_id"], user["name"], "punch", user["email"],
                          location)


@api_router.get("/punch/me/status")
async def punch_me_status(user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        return {"open": None, "today_hours": 0, "today_entries": []}
    pid = user.get("pharmacy_id") or ""
    open_p = await db.punches.find_one(
        {"pharmacy_id": pid, "employee_id": user["employee_id"], "punch_out": None}, {"_id": 0})
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    entries = await db.punches.find(
        {"pharmacy_id": pid, "employee_id": user["employee_id"], "date": today}, {"_id": 0}).sort("punch_in", 1).to_list(50)
    hours = sum(
        (datetime.fromisoformat(p["punch_out"]) - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600
        for p in entries if p.get("punch_out"))
    return {"open": open_p, "today_hours": round(hours, 2), "today_entries": entries}


class ManualPunchIn(BaseModel):
    employee_id: str
    employee_name: str
    date: str
    start_time: str
    end_time: str
    note: str = ""


def local_iso(date_str: str, time_str: str) -> str:
    try:
        return datetime.fromisoformat(f"{date_str}T{time_str}:00").replace(tzinfo=MONTREAL_TZ).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date ou heure invalide.")


@api_router.get("/punches")
async def list_punches(start: str = Query(...), end: str = Query(...),
                       employee_id: Optional[str] = Query(None), principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    query: dict = {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}
    if employee_id:
        query["employee_id"] = employee_id
    return await db.punches.find(query, {"_id": 0}).sort([("date", -1), ("punch_in", -1)]).to_list(2000)


@api_router.post("/punches/manual")
async def add_manual_punch(payload: ManualPunchIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
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
    await log_audit(principal["email"], principal["role"], "SAISIE_HEURES_MANUELLE", "punch", doc["id"],
                    f"{payload.employee_name} — {payload.date} {payload.start_time}-{payload.end_time} ({payload.note or 'sans note'})", pid)
    return doc


class PunchUpdateIn(BaseModel):
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    note: Optional[str] = None


@api_router.put("/punches/{punch_id}")
async def update_punch(punch_id: str, payload: PunchUpdateIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
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
    await log_audit(principal["email"], principal["role"], "CORRECTION_HEURES", "punch", punch_id,
                    f"{doc['employee_name']} — entrée corrigée ({d})", pid)
    return {**doc, **patch}


@api_router.delete("/punches/{punch_id}")
async def delete_punch(punch_id: str, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    doc = await db.punches.find_one({"id": punch_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Entrée introuvable.")
    await db.punches.delete_one({"id": punch_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_HEURES", "punch", punch_id,
                    f"{doc['employee_name']} — entrée du {doc['date']} supprimée", pid)
    return {"status": "supprimée"}


def aggregate_punch_hours(docs: list) -> list:
    rows: dict = {}
    weekly: dict = {}
    for p in docs:
        r = rows.setdefault(p["employee_id"], {
            "employee_id": p["employee_id"], "employee_name": p["employee_name"],
            "punched_hours": 0.0, "manual_hours": 0.0, "total_hours": 0.0,
            "regular_hours": 0.0, "overtime_hours": 0.0, "entries": 0, "open_entries": 0})
        if not p.get("punch_out"):
            r["open_entries"] += 1
            continue
        h = (datetime.fromisoformat(p["punch_out"]) - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600
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
        for k in ("punched_hours", "manual_hours", "total_hours", "regular_hours", "overtime_hours"):
            r[k] = round(r[k], 2)
    return sorted(rows.values(), key=lambda r: r["employee_name"])


@api_router.get("/punches/summary")
async def punches_summary(start: str = Query(...), end: str = Query(...), principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    docs = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    return aggregate_punch_hours(docs)


@api_router.get("/punches/export")
async def export_punches(start: str = Query(...), end: str = Query(...), principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    docs = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    lines = ["Employé;Date;Entrée;Sortie;Heures;Source;Saisie par;Note"]
    for p in sorted(docs, key=lambda x: (x["employee_name"], x["date"], x["punch_in"])):
        t_in = datetime.fromisoformat(p["punch_in"]).astimezone(MONTREAL_TZ).strftime("%H:%M")
        if p.get("punch_out"):
            t_out = datetime.fromisoformat(p["punch_out"]).astimezone(MONTREAL_TZ).strftime("%H:%M")
            h = round((datetime.fromisoformat(p["punch_out"]) - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600, 2)
        else:
            t_out, h = "en cours", ""
        src = "Punch" if p["source"] == "punch" else "Saisie manuelle"
        note = (p.get("note") or "").replace(";", ",")
        lines.append(f"{p['employee_name']};{p['date']};{t_in};{t_out};{str(h).replace('.', ',')};{src};{p.get('created_by', '')};{note}")
    csv_content = "\ufeff" + "\n".join(lines)
    await log_audit(principal["email"], principal["role"], "EXPORT_HEURES_CSV", "punch", f"{start}_{end}",
                    f"Export CSV des heures du {start} au {end} ({len(docs)} entrées)", pid)
    return Response(content=csv_content.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="heures_{start}_{end}.csv"'})


PAYROLL_EXPORT_FORMATS = ("employeurd", "nethris", "adp")


@api_router.get("/punches/export-payroll")
async def export_punches_payroll(start: str = Query(...), end: str = Query(...),
                                 format: str = Query(...), principal: dict = Depends(get_principal)):
    if format not in PAYROLL_EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="Format invalide. Choix : employeurd, nethris, adp.")
    pid = principal["pharmacy_id"] or "ph1"
    docs = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    rows = [r for r in aggregate_punch_hours(docs) if r["total_hours"] > 0]
    if not rows:
        raise HTTPException(status_code=400, detail="Aucune heure complétée dans cette période.")
    profiles = await db.employee_profiles.find(
        {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "payroll_number": 1}).to_list(1000)
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
    await log_audit(principal["email"], principal["role"], "EXPORT_PAIE", "punch", f"{start}_{end}",
                    f"Export paie format {format} du {start} au {end} ({len(rows)} employé(s), {missing} sans matricule)", pid)
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@api_router.get("/punches/open")
async def open_punches(principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    docs = await db.punches.find({"pharmacy_id": pid, "punch_out": None}, {"_id": 0}).to_list(500)
    now = datetime.now(timezone.utc)
    for p in docs:
        p["elapsed_hours"] = round((now - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600, 1)
    return sorted(docs, key=lambda p: -p["elapsed_hours"])


# ==================== Paramètres de période de paie ====================

class PaySettingsIn(BaseModel):
    period_type: str
    anchor: str


@api_router.get("/pay-settings")
async def get_pay_settings(principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    doc = await db.pay_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return doc or {"pharmacy_id": pid, "period_type": "biweekly", "anchor": "2026-06-01"}


@api_router.post("/pay-settings")
async def save_pay_settings(payload: PaySettingsIn, principal: dict = Depends(get_principal)):
    if payload.period_type not in ("weekly", "biweekly"):
        raise HTTPException(status_code=400, detail="Type de période invalide.")
    try:
        date.fromisoformat(payload.anchor)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date d'ancrage invalide.")
    pid = principal["pharmacy_id"] or "ph1"
    doc = {"pharmacy_id": pid, "period_type": payload.period_type, "anchor": payload.anchor}
    await db.pay_settings.update_one({"pharmacy_id": pid}, {"$set": doc}, upsert=True)
    await log_audit(principal["email"], principal["role"], "MODIFICATION_PERIODE_PAIE", "paie", pid,
                    f"Période de paie : {'hebdomadaire' if payload.period_type == 'weekly' else 'aux 2 semaines'} (ancrage {payload.anchor})", pid)
    return doc


# ==================== Qualification (correspondance tâches/rôles ↔ capacités) ====================

QUALIF_STOP_WORDS = {"gestion", "verification", "verifier", "faire", "avant", "apres", "pour", "dans",
                     "avec", "sans", "sous", "tous", "tout", "toute", "toutes", "cette", "chaque",
                     "pharmacie", "responsable", "service", "prise", "mise"}


def _norm_words(text: str) -> set:
    txt = unicodedata.normalize("NFD", (text or "").lower())
    txt = "".join(c for c in txt if unicodedata.category(c) != "Mn")
    return {w for w in re.findall(r"[a-z]{4,}", txt) if w not in QUALIF_STOP_WORDS}


def task_qualification_ok(title: str, capacities: list) -> bool:
    if not capacities:
        return True
    tw = _norm_words(title)
    if not tw:
        return True
    return any(tw & _norm_words(c) for c in capacities)


# ==================== Horaires générés par IA (double approbation) ====================

SCHEDULE_SYSTEM = (
    "Tu es un expert en planification d'horaires pour les pharmacies du Québec. À partir de la liste des employés, "
    "de leurs profils (rôles, capacités, disponibilités par jour, restrictions, heures minimales et maximales par semaine, taux horaire), "
    "des absences approuvées, des tâches à faire durant la semaine, du budget salarial hebdomadaire, "
    "de l'achalandage estimé (clients à l'heure par jour et par plage) "
    "et des consignes du gestionnaire, tu crées l'horaire de la semaine demandée.\n\n"
    "Règles impératives :\n"
    "- RESPECTE STRICTEMENT les disponibilités (jour et plage horaire) et les restrictions de chaque employé.\n"
    "- Ne planifie JAMAIS un employé pendant une absence approuvée (vacances, maladie, congé, formation).\n"
    "- RESPECTE le budget salarial hebdomadaire s'il est fourni : la somme (durée du quart en heures × taux horaire de "
    "l'employé) de TOUS les quarts ne doit pas dépasser le budget. Calcule mentalement le coût total avant de répondre. "
    "Si le budget rend la couverture complète impossible, privilégie les plages les plus achalandées et explique le compromis dans le summary.\n"
    "- ADAPTE le nombre d'employés présents à l'achalandage fourni (clients/heure) pour chaque jour et plage : "
    "plus de personnel aux plages achalandées, personnel réduit aux plages calmes. Règle pratique : environ 1 employé "
    "au service pour 12 à 15 clients/heure, en plus du pharmacien au laboratoire.\n"
    "- Tiens compte des tâches à faire : si une tâche est assignée à un employé un jour donné, planifie-le ce jour-là "
    "sur une plage couvrant le quart de la tâche (Matin ≈ 8h-12h, Après-midi ≈ 12h-17h, Soir ≈ 17h-21h30), "
    "si ses disponibilités le permettent; sinon explique pourquoi dans le summary.\n"
    "- N'attribue à un employé qu'un rôle figurant dans ses rôles ou capacités; s'il faut faire autrement, signale-le dans le summary.\n"
    "- Ne dépasse jamais le maximum d'heures hebdomadaires d'un employé; vise au moins son minimum si le budget le permet.\n"
    "- Assure une couverture adéquate pendant les heures d'ouverture (par défaut lun-ven 8h-21h, sam-dim 9h-17h, "
    "sauf indication contraire dans les consignes), en priorité un pharmacien présent en tout temps si disponible.\n"
    "- Répartis équitablement les quarts et attribue à chacun un rôle cohérent avec ses rôles/capacités.\n"
    "- Quarts de 4 à 8 heures.\n\n"
    "Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, au format exact :\n"
    "{\n"
    '  "summary": "Explication en français des choix effectués (3 à 6 phrases).",\n'
    '  "shifts": [\n'
    '    {"employee_id": "id", "employee_name": "Prénom Nom", "date": "YYYY-MM-DD", '
    '"start": "08:00", "end": "16:00", "role": "Rôle pour ce quart"}\n'
    "  ]\n"
    "}"
)


class RosterEmployee(BaseModel):
    id: str
    name: str
    position: str


TRAFFIC_DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
TRAFFIC_DAY_LABELS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
TRAFFIC_BLOCKS = {
    "matin": ("Matin (8h-12h)", "08:00", "12:00"),
    "apres_midi": ("Après-midi (12h-17h)", "12:00", "17:00"),
    "soir": ("Soir (17h-21h30)", "17:00", "21:30"),
}


class ScheduleSettingsIn(BaseModel):
    weekly_budget: float = 0
    traffic: dict = {}


@api_router.get("/schedule/settings")
async def get_schedule_settings(user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    doc = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return {"weekly_budget": (doc or {}).get("weekly_budget", 0),
            "traffic": (doc or {}).get("traffic", {})}


@api_router.put("/schedule/settings")
async def set_schedule_settings(payload: ScheduleSettingsIn, principal: dict = Depends(get_principal)):
    if not (0 <= payload.weekly_budget <= 1_000_000):
        raise HTTPException(status_code=400, detail="Budget hebdomadaire invalide.")
    traffic = {}
    try:
        for day in TRAFFIC_DAY_KEYS:
            blocks = (payload.traffic or {}).get(day) or {}
            traffic[day] = {b: max(0, min(500, int(float(blocks.get(b) or 0)))) for b in TRAFFIC_BLOCKS}
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=400, detail="Valeurs d'achalandage invalides.")
    pid = principal["pharmacy_id"] or "ph1"
    await db.schedule_settings.update_one(
        {"pharmacy_id": pid},
        {"$set": {"pharmacy_id": pid, "weekly_budget": round(payload.weekly_budget, 2), "traffic": traffic,
                  "updated_by": principal["email"], "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    await log_audit(principal["email"], principal["role"], "MODIF_PARAMS_HORAIRE", "horaire", pid,
                    f"Budget hebdo : {payload.weekly_budget:.2f} $, achalandage mis à jour", pid)
    return {"weekly_budget": round(payload.weekly_budget, 2), "traffic": traffic}


def _time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


class TemplateEntryIn(BaseModel):
    employee_id: str
    employee_name: str = ""
    weekday: int
    start: str
    end: str


class ScheduleTemplateIn(BaseModel):
    name: str
    entries: list[TemplateEntryIn]


@api_router.get("/schedule/templates")
async def list_schedule_templates(principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    return await db.schedule_templates.find({"pharmacy_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api_router.post("/schedule/templates")
async def create_schedule_template(payload: ScheduleTemplateIn, principal: dict = Depends(get_principal)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nom du modèle requis.")
    if not payload.entries:
        raise HTTPException(status_code=400, detail="Le modèle doit contenir au moins un quart.")
    if len(payload.entries) > 300:
        raise HTTPException(status_code=400, detail="Modèle trop volumineux (max 300 quarts).")
    for e in payload.entries:
        if not (0 <= e.weekday <= 6):
            raise HTTPException(status_code=400, detail="Jour de semaine invalide.")
        if e.end <= e.start:
            raise HTTPException(status_code=400, detail="Heures de quart invalides.")
    pid = principal["pharmacy_id"] or "ph1"
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "name": name,
        "entries": [e.model_dump() for e in payload.entries],
        "created_by": principal["email"], "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.schedule_templates.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "CREATION_MODELE_HORAIRE", "horaire", doc["id"],
                    f"Modèle de semaine « {name} » ({len(doc['entries'])} quart(s))", pid)
    return doc


@api_router.delete("/schedule/templates/{template_id}")
async def delete_schedule_template(template_id: str, principal: dict = Depends(get_principal)):
    doc = await db.schedule_templates.find_one({"id": template_id}, {"_id": 0})
    if not doc or doc["pharmacy_id"] != (principal["pharmacy_id"] or "ph1"):
        raise HTTPException(status_code=404, detail="Modèle introuvable.")
    await db.schedule_templates.delete_one({"id": template_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_MODELE_HORAIRE", "horaire", template_id,
                    f"Modèle « {doc['name']} » supprimé", doc["pharmacy_id"])
    return {"status": "supprimé"}


# ==================== Notifications & publication d'horaire ====================

@api_router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    ors = [{"target_email": user["email"]}]
    if user.get("employee_id"):
        ors.append({"target_employee_id": user["employee_id"]})
    return await db.notifications.find({"pharmacy_id": pid, "$or": ors}, {"_id": 0}).sort("created_at", -1).to_list(50)


class PublishRecipient(BaseModel):
    employee_id: str
    employee_name: str = ""
    shift_count: int = 0
    hours: float = 0


class SchedulePublishIn(BaseModel):
    week_start: str
    recipients: list[PublishRecipient]


def schedule_publish_html(name: str, week_start: str, shift_count: int, hours: float, updated: bool) -> str:
    verb = "a été mis à jour" if updated else "est maintenant publié"
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        f"<h2 style='color:#059669'>Arrière Plan — Horaire {'modifié' if updated else 'publié'}</h2>"
        f"<p>Bonjour {name},</p>"
        f"<p>Votre horaire de la semaine du <strong>{week_start}</strong> {verb} : "
        f"<strong>{shift_count} quart(s)</strong> pour un total d'environ <strong>{hours:g} h</strong>.</p>"
        "<p>Connectez-vous à Arrière Plan (module Horaires) pour consulter le détail.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Notification automatique d'Arrière Plan.</p></div>")


@api_router.post("/schedule/publish")
async def publish_schedule(payload: SchedulePublishIn, principal: dict = Depends(get_principal)):
    try:
        date.fromisoformat(payload.week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="Semaine invalide.")
    if not payload.recipients:
        raise HTTPException(status_code=400, detail="Aucun employé à notifier pour cette semaine.")
    pid = principal["pharmacy_id"] or "ph1"
    prev = await db.schedule_publications.find_one({"pharmacy_id": pid, "week_start": payload.week_start}, {"_id": 0})
    updated = bool(prev)
    now = datetime.now(timezone.utc).isoformat()
    title = f"Horaire {'modifié' if updated else 'publié'} — semaine du {payload.week_start}"
    api_key = os.environ.get("RESEND_API_KEY", "")
    sender = await get_sender() if api_key else ""
    if api_key:
        resend.api_key = api_key
    emailed = 0
    for r in payload.recipients:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_employee_id": r.employee_id,
            "title": title,
            "detail": f"{r.shift_count} quart(s), ~{r.hours:g} h planifiées — consultez le module Horaires.",
            "module": "scheduling", "icon": "schedule", "tone": "emerald", "created_at": now})
        if not api_key:
            continue
        account = await db.users.find_one({"employee_id": r.employee_id, "pharmacy_id": pid},
                                          {"_id": 0, "email": 1, "name": 1})
        if not account or not account.get("email"):
            continue
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": sender, "to": [account["email"]], "subject": title,
                "html": schedule_publish_html(account.get("name") or r.employee_name, payload.week_start,
                                              r.shift_count, r.hours, updated)})
            emailed += 1
        except Exception as exc:
            logger.error(f"Courriel de publication d'horaire vers {account['email']} échoué : {exc}")
    await db.schedule_publications.update_one(
        {"pharmacy_id": pid, "week_start": payload.week_start},
        {"$set": {"pharmacy_id": pid, "week_start": payload.week_start, "published_at": now,
                  "published_by": principal["email"],
                  "recipients": [r.model_dump() for r in payload.recipients]},
         "$inc": {"count": 1}}, upsert=True)
    await log_audit(principal["email"], principal["role"], "PUBLICATION_HORAIRE", "horaire", payload.week_start,
                    f"Horaire de la semaine du {payload.week_start} {'republié (modifié)' if updated else 'publié'} — "
                    f"{len(payload.recipients)} employé(s) notifié(s), {emailed} courriel(s)", pid)
    return {"notified": len(payload.recipients), "emailed": emailed, "updated": updated}


class ScheduleSeenIn(BaseModel):
    week_start: str


@api_router.post("/schedule/seen")
async def mark_schedule_seen(payload: ScheduleSeenIn, user: dict = Depends(get_current_user)):
    try:
        date.fromisoformat(payload.week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="Semaine invalide.")
    eid = user.get("employee_id")
    if not eid:
        return {"status": "ignoré"}
    pid = user.get("pharmacy_id") or "ph1"
    await db.schedule_views.update_one(
        {"pharmacy_id": pid, "employee_id": eid, "week_start": payload.week_start},
        {"$set": {"pharmacy_id": pid, "employee_id": eid, "week_start": payload.week_start,
                  "seen_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"status": "vu"}


@api_router.get("/schedule/publish/status")
async def schedule_publish_status(week_start: str = Query(...), principal: dict = Depends(get_principal)):
    try:
        date.fromisoformat(week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="Semaine invalide.")
    pid = principal["pharmacy_id"] or "ph1"
    pub = await db.schedule_publications.find_one({"pharmacy_id": pid, "week_start": week_start}, {"_id": 0})
    if not pub:
        return {"published": False, "recipients": []}
    views = await db.schedule_views.find({"pharmacy_id": pid, "week_start": week_start}, {"_id": 0}).to_list(500)
    seen_by = {v["employee_id"]: v["seen_at"] for v in views}
    recipients = []
    for r in pub.get("recipients", []):
        seen_at = seen_by.get(r["employee_id"])
        seen = bool(seen_at and seen_at > pub["published_at"])
        recipients.append({**r, "seen": seen, "seen_at": seen_at if seen else None})
    return {"published": True, "published_at": pub["published_at"], "count": pub.get("count", 1),
            "recipients": recipients}


@api_router.get("/punch/cost")
async def punch_cost(start: str = Query(...), end: str = Query(...), principal: dict = Depends(get_principal)):
    try:
        date.fromisoformat(start)
        date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates invalides.")
    if start > end:
        raise HTTPException(status_code=400, detail="La date de début doit précéder la date de fin.")
    pid = principal["pharmacy_id"] or "ph1"
    settings = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    weekly_budget = settings.get("weekly_budget", 0)
    punches = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}, "punch_out": {"$ne": None}},
        {"_id": 0}).to_list(5000)
    profiles = await db.employee_profiles.find(
        {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "hourly_rate": 1}).to_list(500)
    rate_by = {p["employee_id"]: p.get("hourly_rate") for p in profiles}
    per: dict = {}
    for p in punches:
        try:
            h = (datetime.fromisoformat(p["punch_out"]) - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600
        except (ValueError, TypeError):
            continue
        e = per.setdefault(p["employee_id"], {"employee_name": p.get("employee_name", ""), "hours": 0.0})
        e["hours"] += h
    employees = []
    total_hours = 0.0
    real_cost = 0.0
    missing_rates = []
    for eid, e in per.items():
        rate = rate_by.get(eid)
        cost = round(e["hours"] * float(rate), 2) if rate else None
        if rate:
            real_cost += e["hours"] * float(rate)
        else:
            missing_rates.append(e["employee_name"] or eid)
        total_hours += e["hours"]
        employees.append({"employee_id": eid, "employee_name": e["employee_name"],
                          "hours": round(e["hours"], 2), "rate": rate, "cost": cost})
    employees.sort(key=lambda x: -(x["cost"] or 0))
    return {"weekly_budget": weekly_budget, "total_hours": round(total_hours, 2),
            "real_cost": round(real_cost, 2), "employees": employees, "missing_rates": missing_rates}


# ==================== Messagerie interne ====================

CONVERSATION_TYPES = ("equipe", "gestionnaires", "direct")


class ConversationIn(BaseModel):
    type: str
    participant_email: str = ""


class ChatAttachmentIn(BaseModel):
    name: str
    mime: str
    data: str


class ChatMessageIn(BaseModel):
    body: str = ""
    attachment: Optional[ChatAttachmentIn] = None


def chat_can_access(convo: dict, user: dict) -> bool:
    if convo["pharmacy_id"] != (user.get("pharmacy_id") or "ph1"):
        return False
    if convo["type"] == "equipe":
        return True
    if convo["type"] == "gestionnaires":
        return user["role"] in ("admin", "manager", "superadmin")
    return user["email"] in convo.get("participants", [])


@api_router.get("/chat/users")
async def chat_users(principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    return await db.users.find(
        {"pharmacy_id": pid, "role": {"$in": ["admin", "manager", "employee"]}},
        {"_id": 0, "email": 1, "name": 1, "role": 1, "employee_id": 1}).sort("name", 1).to_list(300)


@api_router.post("/chat/conversations")
async def create_conversation(payload: ConversationIn, principal: dict = Depends(get_principal)):
    if payload.type not in CONVERSATION_TYPES:
        raise HTTPException(status_code=400, detail="Type de conversation invalide.")
    pid = principal["pharmacy_id"] or "ph1"
    participants: list = []
    if payload.type == "direct":
        email = payload.participant_email.strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="Choisissez un employé pour la conversation directe.")
        target = await db.users.find_one({"email": email, "pharmacy_id": pid}, {"_id": 0, "email": 1, "name": 1})
        if not target:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable dans cette pharmacie.")
        if target["email"] == principal["email"]:
            raise HTTPException(status_code=400, detail="Impossible de créer une conversation avec vous-même.")
        participants = sorted([principal["email"], target["email"]])
        existing = await db.conversations.find_one(
            {"pharmacy_id": pid, "type": "direct", "participants": participants}, {"_id": 0})
        if existing:
            raise HTTPException(status_code=400, detail=f"Une conversation avec {target['name']} existe déjà.")
        name = target["name"]
    else:
        existing = await db.conversations.find_one({"pharmacy_id": pid, "type": payload.type}, {"_id": 0})
        if existing:
            raise HTTPException(status_code=400, detail="Cette conversation existe déjà.")
        name = "Toute l'équipe" if payload.type == "equipe" else "Gestionnaires"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "type": payload.type, "name": name,
        "participants": participants, "created_by": principal["email"], "created_at": now,
        "last_message": "", "last_sender": "", "last_message_at": now,
    }
    await db.conversations.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "CREATION_CONVERSATION", "messagerie", doc["id"],
                    f"Conversation « {name} » ({payload.type}) créée", pid)
    return doc


@api_router.get("/chat/conversations")
async def list_conversations(user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    convos = await db.conversations.find({"pharmacy_id": pid}, {"_id": 0}).sort("last_message_at", -1).to_list(200)
    visible = [c for c in convos if chat_can_access(c, user)]
    reads = await db.conversation_reads.find({"email": user["email"]}, {"_id": 0}).to_list(500)
    read_by = {r["conversation_id"]: r["last_read_at"] for r in reads}
    out = []
    for c in visible:
        unread = await db.chat_messages.count_documents({
            "conversation_id": c["id"], "sender_email": {"$ne": user["email"]},
            "created_at": {"$gt": read_by.get(c["id"], "")}})
        out.append({**c, "unread": unread})
    return out


@api_router.get("/chat/conversations/{conversation_id}/messages")
async def list_chat_messages(conversation_id: str, user: dict = Depends(get_current_user)):
    convo = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not convo or not chat_can_access(convo, user):
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    msgs = await db.chat_messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1).to_list(300)
    await db.conversation_reads.update_one(
        {"conversation_id": conversation_id, "email": user["email"]},
        {"$set": {"conversation_id": conversation_id, "email": user["email"],
                  "last_read_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return msgs


@api_router.post("/chat/conversations/{conversation_id}/messages")
async def post_chat_message(conversation_id: str, payload: ChatMessageIn, user: dict = Depends(get_current_user)):
    convo = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not convo or not chat_can_access(convo, user):
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    body = payload.body.strip()
    if not body and not payload.attachment:
        raise HTTPException(status_code=400, detail="Message vide.")
    if len(body) > 2000:
        raise HTTPException(status_code=400, detail="Message trop long (max 2000 caractères).")
    now = datetime.now(timezone.utc).isoformat()
    attachment_meta = None
    if payload.attachment:
        att = payload.attachment
        if not att.data.startswith("data:"):
            raise HTTPException(status_code=400, detail="Pièce jointe invalide.")
        if len(att.data) > 7_200_000:
            raise HTTPException(status_code=400, detail="Pièce jointe trop volumineuse (max 5 Mo).")
        att_id = str(uuid.uuid4())
        await db.chat_attachments.insert_one({
            "id": att_id, "conversation_id": conversation_id, "pharmacy_id": convo["pharmacy_id"],
            "name": att.name[:120] or "fichier", "mime": att.mime[:80], "data": att.data, "created_at": now})
        attachment_meta = {"id": att_id, "name": att.name[:120] or "fichier", "mime": att.mime[:80],
                           "size": len(att.data)}
    doc = {
        "id": str(uuid.uuid4()), "conversation_id": conversation_id, "pharmacy_id": convo["pharmacy_id"],
        "sender_email": user["email"], "sender_name": user.get("name", ""), "sender_role": user["role"],
        "body": body, "attachment": attachment_meta, "created_at": now,
    }
    await db.chat_messages.insert_one({**doc})
    preview = body[:80] if body else f"📎 {attachment_meta['name']}" if attachment_meta else ""
    await db.conversations.update_one({"id": conversation_id}, {"$set": {
        "last_message": preview, "last_sender": user.get("name", ""), "last_message_at": now}})
    await db.conversation_reads.update_one(
        {"conversation_id": conversation_id, "email": user["email"]},
        {"$set": {"conversation_id": conversation_id, "email": user["email"], "last_read_at": now}}, upsert=True)
    return doc


@api_router.get("/chat/attachments/{attachment_id}")
async def get_chat_attachment(attachment_id: str, user: dict = Depends(get_current_user)):
    att = await db.chat_attachments.find_one({"id": attachment_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable.")
    convo = await db.conversations.find_one({"id": att["conversation_id"]}, {"_id": 0})
    if not convo or not chat_can_access(convo, user):
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable.")
    return {"name": att["name"], "mime": att["mime"], "data": att["data"]}


@api_router.post("/chat/messages/{message_id}/pin")
async def pin_chat_message(message_id: str, principal: dict = Depends(get_principal)):
    msg = await db.chat_messages.find_one({"id": message_id}, {"_id": 0})
    if not msg or msg["pharmacy_id"] != (principal["pharmacy_id"] or "ph1"):
        raise HTTPException(status_code=404, detail="Message introuvable.")
    convo = await db.conversations.find_one({"id": msg["conversation_id"]}, {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    currently = (convo.get("pinned_message") or {}).get("id")
    if currently == message_id:
        await db.conversations.update_one({"id": convo["id"]}, {"$set": {"pinned_message": None}})
        await log_audit(principal["email"], principal["role"], "DESEPINGLAGE_MESSAGE", "messagerie", message_id,
                        f"Message désépinglé dans « {convo['name']} »", convo["pharmacy_id"])
        return {"pinned": False}
    pinned = {
        "id": msg["id"], "body": msg.get("body", "")[:200], "sender_name": msg.get("sender_name", ""),
        "created_at": msg.get("created_at", ""),
        "attachment_name": (msg.get("attachment") or {}).get("name", ""),
    }
    await db.conversations.update_one({"id": convo["id"]}, {"$set": {"pinned_message": pinned}})
    await log_audit(principal["email"], principal["role"], "EPINGLAGE_MESSAGE", "messagerie", message_id,
                    f"Message épinglé dans « {convo['name']} »", convo["pharmacy_id"])
    return {"pinned": True}


@api_router.delete("/chat/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, principal: dict = Depends(get_principal)):
    convo = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not convo or convo["pharmacy_id"] != (principal["pharmacy_id"] or "ph1"):
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    await db.chat_messages.delete_many({"conversation_id": conversation_id})
    await db.conversation_reads.delete_many({"conversation_id": conversation_id})
    await db.conversations.delete_one({"id": conversation_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_CONVERSATION", "messagerie", conversation_id,
                    f"Conversation « {convo['name']} » supprimée", convo["pharmacy_id"])
    return {"status": "supprimée"}


class AbsenceIn(BaseModel):
    employee_id: str
    employee_name: str = ""
    start: str
    end: str
    type: str = ""


class ScheduleGenIn(BaseModel):
    week_start: str
    instructions: str = ""
    approval_deadline_hours: int = 48
    employees: list[RosterEmployee]
    absences: list[AbsenceIn] = []
    weekly_budget: float = -1


def proposal_view(doc: dict) -> dict:
    d = {k: v for k, v in doc.items() if k != "_id"}
    approvals = d.get("employee_approvals", {})
    deadline_passed = False
    if d.get("approval_deadline"):
        deadline_passed = datetime.fromisoformat(d["approval_deadline"]) < datetime.now(timezone.utc)
    d["deadline_passed"] = deadline_passed
    if d.get("applied_at"):
        d["effective_status"] = "applied"
    elif d["status"] in ("generating", "error"):
        d["effective_status"] = d["status"]
    elif d.get("admin_status") == "rejected":
        d["effective_status"] = "rejected"
    else:
        any_rejected = any(a.get("status") == "rejected" for a in approvals.values())
        all_approved = bool(approvals) and all(a.get("status") == "approved" for a in approvals.values())
        if d.get("admin_status") == "approved" and (all_approved or (deadline_passed and not any_rejected)):
            d["effective_status"] = "approved"
        elif any_rejected:
            d["effective_status"] = "attention"
        else:
            d["effective_status"] = "pending"
    return d


async def generate_schedule_content(proposal_id: str, pharmacy_id: str, week_start: str,
                                    instructions: str, roster: list, profiles: list, absences: list,
                                    weekly_budget: float = 0):
    try:
        start = date.fromisoformat(week_start)
        week_days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
        await materialize_recurring_tasks(pharmacy_id, week_days[0], week_days[-1])
        week_tasks = await db.shift_tasks.find(
            {"pharmacy_id": pharmacy_id, "date": {"$gte": week_days[0], "$lte": week_days[-1]}},
            {"_id": 0}).to_list(1000)
        settings = await db.schedule_settings.find_one({"pharmacy_id": pharmacy_id}, {"_id": 0}) or {}
        traffic = settings.get("traffic") or {}
        traffic_payload = {}
        for i, d in enumerate(week_days):
            day_blocks = traffic.get(TRAFFIC_DAY_KEYS[i]) or {}
            if any((day_blocks.get(k) or 0) > 0 for k in TRAFFIC_BLOCKS):
                traffic_payload[f"{d} ({TRAFFIC_DAY_LABELS[i]})"] = {
                    label: f"{day_blocks.get(key) or 0} client(s)/heure"
                    for key, (label, _, _) in TRAFFIC_BLOCKS.items()}
        payload = {
            "semaine": week_days,
            "consignes_du_gestionnaire": instructions or "Aucune consigne particulière.",
            "budget_salarial_hebdomadaire": (
                f"{weekly_budget:.2f} $ — masse salariale MAXIMALE pour l'ensemble des quarts de la semaine"
                if weekly_budget > 0 else "Aucun budget imposé."),
            "achalandage_estime": traffic_payload or "Aucune donnée d'achalandage fournie.",
            "absences_approuvees": [{
                "employee_id": a["employee_id"], "nom": a.get("employee_name", ""),
                "du": a["start"], "au": a["end"], "type": a.get("type", ""),
            } for a in absences] or "Aucune absence approuvée cette semaine.",
            "taches_a_faire_cette_semaine": [{
                "date": t["date"], "quart": t["shift"], "titre": t["title"],
                "assignee_employee_id": t.get("assignee_employee_id") or "",
                "assignee": t.get("assignee_name") or "Toute l'équipe",
            } for t in week_tasks] or "Aucune tâche planifiée cette semaine.",
            "employes": [{
                "employee_id": e["id"], "nom": e["name"], "poste": e["position"],
                "taux_horaire": next((p.get("hourly_rate") for p in profiles if p["employee_id"] == e["id"]
                                      and p.get("hourly_rate")), "inconnu"),
                "profil": next((p for p in profiles if p["employee_id"] == e["id"]), None),
            } for e in roster],
        }
        llm = LlmChat(
            api_key=os.environ['EMERGENT_LLM_KEY'],
            session_id=f"schedule-{proposal_id}",
            system_message=SCHEDULE_SYSTEM,
        ).with_model("openai", "gpt-5.4")
        resp = await llm.send_message(UserMessage(
            text=f"Crée l'horaire de la semaine avec ces données :\n\n{json.dumps(payload, ensure_ascii=False, default=str)}"))
        raw = resp if isinstance(resp, str) else getattr(resp, "content", None) or str(resp)
        data = parse_llm_json(raw)
        shifts = []
        roster_ids = {e["id"] for e in roster}
        for s in data.get("shifts", []):
            if s.get("employee_id") not in roster_ids or s.get("date") not in week_days:
                continue
            if not s.get("start") or not s.get("end"):
                continue
            shifts.append({"id": str(uuid.uuid4()), "employee_id": s["employee_id"],
                           "employee_name": str(s.get("employee_name", "")), "date": s["date"],
                           "start": str(s["start"]), "end": str(s["end"]), "role": str(s.get("role", ""))})
        if not shifts:
            raise ValueError("L'IA n'a généré aucun quart valide")
        prof_by_id = {p["employee_id"]: p for p in profiles}
        shift_hours = {"Matin": ("08:00", "12:00"), "Après-midi": ("12:00", "17:00"), "Soir": ("17:00", "21:30")}
        for s in shifts:
            warnings = []
            for a in absences:
                if a["employee_id"] == s["employee_id"] and a["start"] <= s["date"] <= a["end"]:
                    warnings.append({
                        "text": f"Conflit d'absence : {a.get('type') or 'congé'} approuvé du {a['start']} au {a['end']}",
                        "kind": "absence"})
            prof = prof_by_id.get(s["employee_id"]) or {}
            known = (prof.get("roles") or []) + (prof.get("capacities") or [])
            if s["role"] and known and not any(_norm_words(s["role"]) & _norm_words(k) for k in known):
                warnings.append({
                    "text": f"Rôle « {s['role']} » absent des rôles/capacités du profil — qualification à vérifier",
                    "kind": "profile"})
            s["warnings"] = warnings
        alerts = []
        for t in week_tasks:
            eid = t.get("assignee_employee_id") or ""
            if not eid or eid not in prof_by_id:
                continue
            who = t.get("assignee_name") or eid
            base = {"task_id": t["id"], "task_date": t["date"], "employee_id": eid}
            day_shifts = [s for s in shifts if s["employee_id"] == eid and s["date"] == t["date"]]
            if not day_shifts:
                alerts.append({**base, "kind": "task",
                               "text": f"Tâche « {t['title']} » assignée à {who} le {t['date']} (quart {t['shift']}), "
                                       "mais aucun quart prévu ce jour-là"})
                continue
            span = shift_hours.get(t["shift"])
            if span and not any(s["start"] < span[1] and s["end"] > span[0] for s in day_shifts):
                alerts.append({**base, "kind": "task",
                               "text": f"Tâche « {t['title']} » ({t['shift']} du {t['date']}) : "
                                       f"le quart de {who} ne couvre pas cette plage horaire"})
            prof = prof_by_id.get(eid) or {}
            if not task_qualification_ok(t["title"], prof.get("capacities") or []):
                alerts.append({**base, "kind": "profile",
                               "text": f"Tâche « {t['title']} » ({t['date']}) : {who} n'a pas cette capacité "
                                       "dans son profil — qualification à vérifier"})
        estimated_cost = 0.0
        missing_rate_ids = set()
        for s in shifts:
            try:
                hours = max(0, _time_to_minutes(s["end"]) - _time_to_minutes(s["start"])) / 60
            except (ValueError, AttributeError):
                continue
            rate = (prof_by_id.get(s["employee_id"]) or {}).get("hourly_rate")
            if rate:
                estimated_cost += hours * float(rate)
            else:
                missing_rate_ids.add(s["employee_id"])
        estimated_cost = round(estimated_cost, 2)
        if weekly_budget > 0 and estimated_cost > weekly_budget:
            alerts.append({"kind": "budget",
                           "text": f"Budget dépassé : coût estimé {estimated_cost:.2f} $ > budget "
                                   f"{weekly_budget:.2f} $ (écart +{estimated_cost - weekly_budget:.2f} $)"})
        for eid in sorted(missing_rate_ids):
            who = next((e["name"] for e in roster if e["id"] == eid), eid)
            alerts.append({"kind": "profile", "employee_id": eid,
                           "text": f"Taux horaire manquant au profil de {who} — le coût estimé est sous-évalué"})
        traffic_settings = (await db.schedule_settings.find_one(
            {"pharmacy_id": pharmacy_id}, {"_id": 0}) or {}).get("traffic") or {}
        for i, d in enumerate(week_days):
            day_blocks = traffic_settings.get(TRAFFIC_DAY_KEYS[i]) or {}
            for key, (label, bs, be) in TRAFFIC_BLOCKS.items():
                expected = day_blocks.get(key) or 0
                if expected <= 0:
                    continue
                covered = any(s["date"] == d and s["start"] < be and s["end"] > bs for s in shifts)
                if not covered:
                    alerts.append({"kind": "traffic",
                                   "text": f"Aucune couverture le {d} ({TRAFFIC_DAY_LABELS[i]}) en {label} "
                                           f"malgré ~{expected} client(s)/heure attendu(s)"})
        warnings_count = sum(len(s["warnings"]) for s in shifts) + len(alerts)
        approvals = {eid: {"status": "pending", "responded_at": None, "comment": ""}
                     for eid in sorted({s["employee_id"] for s in shifts})}
        await db.schedule_proposals.update_one({"id": proposal_id}, {"$set": {
            "status": "pending_approval", "shifts": shifts, "summary": str(data.get("summary", "")),
            "employee_approvals": approvals, "error": None,
            "alerts": alerts, "warnings_count": warnings_count,
            "estimated_cost": estimated_cost, "weekly_budget": weekly_budget,
            "updated_at": datetime.now(timezone.utc).isoformat()}})
        await log_audit("système", "system", "GENERATION_HORAIRE", "horaire", proposal_id,
                        f"Horaire IA généré : {len(shifts)} quart(s), {warnings_count} point(s) à vérifier "
                        f"pour la semaine du {week_start}", pharmacy_id)
    except Exception as exc:
        logger.error(f"Génération horaire {proposal_id} échouée : {exc}")
        await db.schedule_proposals.update_one({"id": proposal_id}, {"$set": {
            "status": "error", "error": str(exc), "updated_at": datetime.now(timezone.utc).isoformat()}})


@api_router.post("/schedule/generate")
async def schedule_generate(payload: ScheduleGenIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    try:
        date.fromisoformat(payload.week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date de début de semaine invalide.")
    if not payload.employees:
        raise HTTPException(status_code=400, detail="Aucun employé fourni.")
    if not (1 <= payload.approval_deadline_hours <= 168):
        raise HTTPException(status_code=400, detail="Délai d'approbation invalide (1 à 168 h).")
    roster = [e.model_dump() for e in payload.employees]
    absences = [a.model_dump() for a in payload.absences]
    profiles = []
    for e in roster:
        profiles.append(await get_or_create_profile(pid, e["id"], e["name"]))
    profiles = [{k: v for k, v in p.items() if k not in ("punch_code",)} for p in profiles]
    settings = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    if payload.weekly_budget >= 0:
        if payload.weekly_budget > 1_000_000:
            raise HTTPException(status_code=400, detail="Budget hebdomadaire invalide.")
        weekly_budget = round(payload.weekly_budget, 2)
        await db.schedule_settings.update_one(
            {"pharmacy_id": pid}, {"$set": {"pharmacy_id": pid, "weekly_budget": weekly_budget}}, upsert=True)
    else:
        weekly_budget = settings.get("weekly_budget", 0)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "week_start": payload.week_start,
        "status": "generating", "error": None, "summary": "", "shifts": [],
        "instructions": payload.instructions, "absences": absences,
        "alerts": [], "warnings_count": 0,
        "estimated_cost": None, "weekly_budget": weekly_budget,
        "employee_approvals": {}, "admin_status": "pending", "admin_decided_by": None,
        "approval_deadline": (now + timedelta(hours=payload.approval_deadline_hours)).isoformat(),
        "approval_deadline_hours": payload.approval_deadline_hours,
        "applied_at": None, "created_by": principal["email"],
        "created_at": now.isoformat(), "updated_at": now.isoformat(),
    }
    await db.schedule_proposals.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "DEMANDE_HORAIRE_IA", "horaire", doc["id"],
                    f"Génération IA demandée pour la semaine du {payload.week_start}"
                    f"{f' (budget {weekly_budget:.2f} $)' if weekly_budget > 0 else ''}", pid)
    asyncio.create_task(generate_schedule_content(doc["id"], pid, payload.week_start, payload.instructions,
                                                  roster, profiles, absences, weekly_budget))
    return proposal_view(doc)


@api_router.get("/schedule/proposals")
async def list_proposals(user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or ""
    if user["role"] in ("admin", "manager", "superadmin"):
        query: dict = {"pharmacy_id": pid} if pid else {}
        docs = await db.schedule_proposals.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
        return [proposal_view(d) for d in docs]
    eid = user.get("employee_id")
    if not eid:
        return []
    docs = await db.schedule_proposals.find(
        {"pharmacy_id": pid, "status": "pending_approval", f"employee_approvals.{eid}": {"$exists": True}},
        {"_id": 0}).sort("created_at", -1).to_list(50)
    return [proposal_view(d) for d in docs]


class ProposalRespondIn(BaseModel):
    status: str
    comment: str = ""


@api_router.post("/schedule/proposals/{proposal_id}/respond")
async def respond_proposal(proposal_id: str, payload: ProposalRespondIn, user: dict = Depends(get_current_user)):
    if payload.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Réponse invalide.")
    eid = user.get("employee_id")
    if not eid:
        raise HTTPException(status_code=403, detail="Aucun dossier employé associé à votre compte.")
    doc = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not doc or eid not in (doc.get("employee_approvals") or {}):
        raise HTTPException(status_code=404, detail="Proposition introuvable.")
    if doc.get("applied_at"):
        raise HTTPException(status_code=400, detail="Cet horaire a déjà été appliqué.")
    await db.schedule_proposals.update_one({"id": proposal_id}, {"$set": {
        f"employee_approvals.{eid}": {"status": payload.status,
                                      "responded_at": datetime.now(timezone.utc).isoformat(),
                                      "comment": payload.comment.strip()}}})
    await log_audit(user["email"], user["role"],
                    "APPROBATION_HORAIRE" if payload.status == "approved" else "REFUS_HORAIRE",
                    "horaire", proposal_id,
                    f"{user['name']} a {'approuvé' if payload.status == 'approved' else 'refusé'} l'horaire de la semaine du {doc['week_start']}"
                    + (f" — {payload.comment.strip()}" if payload.comment.strip() else ""), doc["pharmacy_id"])
    updated = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    return proposal_view(updated)


class ProposalDecisionIn(BaseModel):
    status: str


@api_router.post("/schedule/proposals/{proposal_id}/decision")
async def decide_proposal(proposal_id: str, payload: ProposalDecisionIn, principal: dict = Depends(get_principal)):
    if payload.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Décision invalide.")
    doc = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Proposition introuvable.")
    await db.schedule_proposals.update_one({"id": proposal_id}, {"$set": {
        "admin_status": payload.status, "admin_decided_by": principal["email"],
        "updated_at": datetime.now(timezone.utc).isoformat()}})
    await log_audit(principal["email"], principal["role"], "DECISION_HORAIRE_ADMIN", "horaire", proposal_id,
                    f"Horaire semaine du {doc['week_start']} : {'approuvé' if payload.status == 'approved' else 'rejeté'} par l'administration",
                    doc["pharmacy_id"])
    updated = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    return proposal_view(updated)


@api_router.post("/schedule/proposals/{proposal_id}/apply")
async def apply_proposal(proposal_id: str, principal: dict = Depends(get_principal)):
    doc = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Proposition introuvable.")
    if doc.get("admin_status") != "approved":
        raise HTTPException(status_code=400, detail="L'administration doit d'abord approuver cet horaire.")
    if doc.get("applied_at"):
        raise HTTPException(status_code=400, detail="Cet horaire a déjà été appliqué.")
    view = proposal_view(doc)
    if view["effective_status"] != "approved":
        raise HTTPException(
            status_code=400,
            detail="Les employés doivent approuver (ou le délai doit être écoulé sans refus) avant d'appliquer l'horaire.")
    await db.schedule_proposals.update_one({"id": proposal_id}, {"$set": {
        "applied_at": datetime.now(timezone.utc).isoformat()}})
    await log_audit(principal["email"], principal["role"], "APPLICATION_HORAIRE", "horaire", proposal_id,
                    f"Horaire IA de la semaine du {doc['week_start']} appliqué ({len(doc.get('shifts', []))} quarts)",
                    doc["pharmacy_id"])
    updated = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    return proposal_view(updated)


@api_router.delete("/schedule/proposals/{proposal_id}")
async def delete_proposal(proposal_id: str, principal: dict = Depends(get_principal)):
    doc = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Proposition introuvable.")
    await db.schedule_proposals.delete_one({"id": proposal_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_HORAIRE_IA", "horaire", proposal_id,
                    f"Proposition d'horaire de la semaine du {doc['week_start']} supprimée", doc["pharmacy_id"])
    return {"status": "supprimée"}


# ==================== Évaluations de performance & suggestion salariale ====================

def compute_answers_score(answers: dict) -> float:
    vals = [int(v) for v in answers.values()]
    if not vals or any(not (1 <= v <= 5) for v in vals):
        raise HTTPException(status_code=400, detail="Réponses invalides (échelle de 1 à 5).")
    return round(sum(vals) / (5 * len(vals)) * 100, 1)


def compute_salary_suggestion(doc: dict) -> Optional[dict]:
    admin_eval, self_eval = doc.get("admin_eval"), doc.get("self_eval")
    if not admin_eval or not self_eval:
        return None
    perf = round(0.7 * admin_eval["score"] + 0.3 * self_eval["score"], 1)
    if perf >= 90:
        mult = 1.2
    elif perf >= 75:
        mult = 1.0
    elif perf >= 60:
        mult = 0.7
    elif perf >= 45:
        mult = 0.4
    else:
        mult = 0.0
    inc = round(doc["baiia_increase_pct"] * mult, 2)
    rate = round(doc["current_rate"] * (1 + inc / 100) * 20) / 20
    return {"performance_score": perf, "multiplier": mult, "suggested_increase_pct": inc, "suggested_rate": rate}


class EvaluationCreateIn(BaseModel):
    employee_id: str
    employee_name: str
    current_rate: float
    baiia_increase_pct: float


class EmployerEvalIn(BaseModel):
    answers: dict
    strengths: str = ""
    improvements: str = ""
    objectives: str = ""


class SelfEvalIn(BaseModel):
    answers: dict
    accomplishments: str = ""
    needs: str = ""
    goals: str = ""


class ProposeRateIn(BaseModel):
    proposed_rate: float


class EvalRespondIn(BaseModel):
    accepted: bool
    comment: str = ""


@api_router.post("/evaluations")
async def create_evaluation(payload: EvaluationCreateIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    if payload.current_rate <= 0:
        raise HTTPException(status_code=400, detail="Taux horaire actuel invalide.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid,
        "employee_id": payload.employee_id, "employee_name": payload.employee_name,
        "current_rate": payload.current_rate, "baiia_increase_pct": payload.baiia_increase_pct,
        "status": "en_cours", "admin_eval": None, "self_eval": None, "suggestion": None,
        "proposed_rate": None, "proposed_at": None, "employee_decision": None,
        "agreed_rate": None, "applied": False,
        "created_by": principal["email"], "created_at": now, "updated_at": now,
    }
    await db.evaluations.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "CREATION_EVALUATION", "évaluation", doc["id"],
                    f"Évaluation lancée pour {payload.employee_name} (BAIIA +{payload.baiia_increase_pct} %)", pid)
    return doc


@api_router.get("/evaluations")
async def list_evaluations(user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or ""
    if user["role"] in ("admin", "manager", "superadmin"):
        query: dict = {"pharmacy_id": pid} if pid else {}
    else:
        if not user.get("employee_id"):
            return []
        query = {"pharmacy_id": pid, "employee_id": user["employee_id"]}
    return await db.evaluations.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)


async def get_evaluation_or_404(evaluation_id: str) -> dict:
    doc = await db.evaluations.find_one({"id": evaluation_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Évaluation introuvable.")
    return doc


@api_router.put("/evaluations/{evaluation_id}/employer")
async def submit_employer_eval(evaluation_id: str, payload: EmployerEvalIn, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    admin_eval = {"answers": payload.answers, "score": compute_answers_score(payload.answers),
                  "strengths": payload.strengths, "improvements": payload.improvements,
                  "objectives": payload.objectives, "completed_at": datetime.now(timezone.utc).isoformat(),
                  "by": principal["email"]}
    merged = {**doc, "admin_eval": admin_eval}
    suggestion = compute_salary_suggestion(merged)
    patch = {"admin_eval": admin_eval, "suggestion": suggestion,
             "status": "a_proposer" if suggestion else "en_cours",
             "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(principal["email"], principal["role"], "EVALUATION_EMPLOYEUR", "évaluation", evaluation_id,
                    f"Évaluation employeur de {doc['employee_name']} : {admin_eval['score']} %", doc["pharmacy_id"])
    return {**merged, **patch}


@api_router.put("/evaluations/{evaluation_id}/self")
async def submit_self_eval(evaluation_id: str, payload: SelfEvalIn, user: dict = Depends(get_current_user)):
    doc = await get_evaluation_or_404(evaluation_id)
    if user["role"] == "employee" and user.get("employee_id") != doc["employee_id"]:
        raise HTTPException(status_code=403, detail="Cette évaluation ne vous concerne pas.")
    self_eval = {"answers": payload.answers, "score": compute_answers_score(payload.answers),
                 "accomplishments": payload.accomplishments, "needs": payload.needs,
                 "goals": payload.goals, "completed_at": datetime.now(timezone.utc).isoformat()}
    merged = {**doc, "self_eval": self_eval}
    suggestion = compute_salary_suggestion(merged)
    patch = {"self_eval": self_eval, "suggestion": suggestion,
             "status": "a_proposer" if suggestion else "en_cours",
             "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(user["email"], user["role"], "AUTO_EVALUATION", "évaluation", evaluation_id,
                    f"Auto-évaluation de {doc['employee_name']} : {self_eval['score']} %", doc["pharmacy_id"])
    return {**merged, **patch}


@api_router.post("/evaluations/{evaluation_id}/propose")
async def propose_rate(evaluation_id: str, payload: ProposeRateIn, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    if not doc.get("admin_eval") or not doc.get("self_eval"):
        raise HTTPException(status_code=400, detail="Les deux évaluations doivent être complétées avant de proposer un salaire.")
    if payload.proposed_rate <= 0:
        raise HTTPException(status_code=400, detail="Taux proposé invalide.")
    patch = {"proposed_rate": round(payload.proposed_rate, 2),
             "proposed_at": datetime.now(timezone.utc).isoformat(),
             "employee_decision": None, "status": "propose",
             "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(principal["email"], principal["role"], "PROPOSITION_SALAIRE", "évaluation", evaluation_id,
                    f"Salaire proposé à {doc['employee_name']} : {patch['proposed_rate']} $/h "
                    f"(actuel {doc['current_rate']} $/h)", doc["pharmacy_id"])
    return {**doc, **patch}


@api_router.post("/evaluations/{evaluation_id}/respond")
async def respond_evaluation(evaluation_id: str, payload: EvalRespondIn, user: dict = Depends(get_current_user)):
    doc = await get_evaluation_or_404(evaluation_id)
    if user["role"] == "employee" and user.get("employee_id") != doc["employee_id"]:
        raise HTTPException(status_code=403, detail="Cette évaluation ne vous concerne pas.")
    if doc.get("proposed_rate") is None or doc["status"] not in ("propose",):
        raise HTTPException(status_code=400, detail="Aucune proposition salariale en attente.")
    decision = {"accepted": payload.accepted, "comment": payload.comment.strip(),
                "at": datetime.now(timezone.utc).isoformat()}
    patch: dict = {"employee_decision": decision, "updated_at": decision["at"]}
    if payload.accepted:
        patch["agreed_rate"] = doc["proposed_rate"]
        patch["status"] = "accepte"
        await db.employee_profiles.update_one(
            {"pharmacy_id": doc["pharmacy_id"], "employee_id": doc["employee_id"]},
            {"$set": {"hourly_rate": doc["proposed_rate"]}})
    else:
        patch["status"] = "refuse"
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(user["email"], user["role"],
                    "SALAIRE_ACCEPTE" if payload.accepted else "SALAIRE_REFUSE",
                    "évaluation", evaluation_id,
                    f"{doc['employee_name']} a {'accepté' if payload.accepted else 'refusé'} le taux de {doc['proposed_rate']} $/h"
                    + (f" — {decision['comment']}" if decision["comment"] else ""), doc["pharmacy_id"])
    return {**doc, **patch}


@api_router.post("/evaluations/{evaluation_id}/applied")
async def mark_evaluation_applied(evaluation_id: str, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    if doc["status"] != "accepte":
        raise HTTPException(status_code=400, detail="Le salaire doit d'abord être accepté par l'employé.")
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": {
        "applied": True, "status": "applique", "updated_at": datetime.now(timezone.utc).isoformat()}})
    await log_audit(principal["email"], principal["role"], "SALAIRE_APPLIQUE", "évaluation", evaluation_id,
                    f"Nouveau taux de {doc['agreed_rate']} $/h appliqué au dossier de {doc['employee_name']}",
                    doc["pharmacy_id"])
    return {"status": "applique"}


@api_router.delete("/evaluations/{evaluation_id}")
async def delete_evaluation(evaluation_id: str, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    await db.evaluations.delete_one({"id": evaluation_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_EVALUATION", "évaluation", evaluation_id,
                    f"Évaluation de {doc['employee_name']} supprimée", doc["pharmacy_id"])
    return {"status": "supprimée"}


def eval_reminder_html(doc: dict, days: int) -> str:
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Auto-évaluation en attente</h2>"
        f"<p>Bonjour {doc['employee_name']},</p>"
        f"<p>Votre évaluation de performance a été lancée il y a <strong>{days} jour(s)</strong> et votre "
        "auto-évaluation n'est pas encore complétée.</p>"
        "<p>Connectez-vous à Arrière Plan, ouvrez « Mon espace » puis complétez votre auto-évaluation — "
        "elle compte pour 30 % de votre score global.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Relance automatique envoyée par Arrière Plan.</p>"
        "</div>")


EVAL_REMINDER_DAYS = 3


async def send_evaluation_reminders() -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("Relances auto-évaluations : RESEND_API_KEY manquante, envoi ignoré.")
        return 0
    resend.api_key = api_key
    sender = await get_sender()
    now = datetime.now(timezone.utc)
    docs = await db.evaluations.find({"self_eval": None, "status": "en_cours"}).to_list(1000)
    sent = 0
    for doc in docs:
        days = (now - datetime.fromisoformat(doc["created_at"])).days
        if days < EVAL_REMINDER_DAYS:
            continue
        last = doc.get("self_reminder_at")
        if last and (now - datetime.fromisoformat(last)).days < EVAL_REMINDER_DAYS:
            continue
        user = await db.users.find_one({"employee_id": doc["employee_id"], "pharmacy_id": doc["pharmacy_id"]}, {"_id": 0})
        if not user or not user.get("email"):
            continue
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": sender, "to": [user["email"]],
                "subject": f"Rappel — votre auto-évaluation est en attente depuis {days} jour(s)",
                "html": eval_reminder_html(doc, days)})
            await db.evaluations.update_one({"id": doc["id"]}, {"$set": {"self_reminder_at": now.isoformat()}})
            await log_audit("système", "system", "RAPPEL_AUTOEVALUATION", "évaluation", doc["id"],
                            f"Relance envoyée à {user['email']} ({days} jour(s) d'attente)", doc["pharmacy_id"])
            sent += 1
        except Exception as exc:
            logger.error(f"Relance auto-évaluation {doc['id']} échouée : {exc}")
    return sent


@api_router.post("/evaluations/reminders/run")
async def run_evaluation_reminders(principal: dict = Depends(get_principal)):
    sent = await send_evaluation_reminders()
    await log_audit(principal["email"], principal["role"], "RAPPELS_AUTOEVAL", "évaluation", "rappels",
                    f"{sent} relance(s) d'auto-évaluation envoyée(s) manuellement", principal["pharmacy_id"] or "ph1")
    return {"sent": sent}


async def evaluation_reminders_job():
    sent = await send_evaluation_reminders()
    logger.info(f"Relances auto-évaluations quotidiennes : {sent} envoyée(s)")


# ---------------------- Tâches par quart de travail ----------------------

class ShiftTaskIn(BaseModel):
    date: str
    shift: str = "Jour"
    title: str
    description: str = ""
    assignee_employee_id: str = ""
    assignee_name: str = ""
    recurring: bool = False


class TaskCopyWeekIn(BaseModel):
    from_start: str
    to_start: str


@api_router.get("/tasks")
async def list_tasks(start: str = Query(...), end: str = Query(...), user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or ""
    if pid:
        await materialize_recurring_tasks(pid, start, end)
    query: dict = {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}
    if user["role"] not in ("admin", "manager", "superadmin"):
        eid = user.get("employee_id") or ""
        query["$or"] = [{"assignee_employee_id": eid}, {"assignee_employee_id": ""}]
    return await db.shift_tasks.find(query, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(500)


@api_router.post("/tasks")
async def create_task(payload: ShiftTaskIn, principal: dict = Depends(get_principal)):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Le titre de la tâche est requis.")
    qualification_warning = False
    if payload.assignee_employee_id:
        prof = await get_or_create_profile(principal["pharmacy_id"] or "ph1",
                                           payload.assignee_employee_id, payload.assignee_name)
        qualification_warning = not task_qualification_ok(payload.title, prof.get("capacities") or [])
    task_id = str(uuid.uuid4())
    doc = {
        "id": task_id,
        "pharmacy_id": principal["pharmacy_id"] or "ph1",
        "date": payload.date,
        "shift": payload.shift,
        "title": payload.title.strip(),
        "description": payload.description.strip(),
        "assignee_employee_id": payload.assignee_employee_id,
        "assignee_name": payload.assignee_name,
        "recurring": payload.recurring,
        "series_id": task_id if payload.recurring else "",
        "qualification_warning": qualification_warning,
        "done": False,
        "done_by": "",
        "done_at": None,
        "created_by": principal["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.shift_tasks.insert_one(doc)
    doc.pop("_id", None)
    await log_audit(principal["email"], principal["role"], "CREATION_TACHE", "tâche", doc["id"],
                    f"Tâche « {doc['title']} » ({doc['date']}, quart {doc['shift']})", doc["pharmacy_id"])
    return doc


@api_router.post("/tasks/copy-week")
async def copy_week_tasks(payload: TaskCopyWeekIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    from_start = datetime.fromisoformat(payload.from_start).date()
    from_end = from_start + timedelta(days=6)
    to_start = datetime.fromisoformat(payload.to_start).date()
    delta = (to_start - from_start).days
    docs = await db.shift_tasks.find(
        {"pharmacy_id": pid, "date": {"$gte": from_start.isoformat(), "$lte": from_end.isoformat()}},
        {"_id": 0}).to_list(500)
    created = 0
    for d in docs:
        new_date = (datetime.fromisoformat(d["date"]).date() + timedelta(days=delta)).isoformat()
        exists = await db.shift_tasks.find_one(
            {"pharmacy_id": pid, "date": new_date, "shift": d["shift"], "title": d["title"]})
        if exists:
            continue
        await db.shift_tasks.insert_one({
            **d, "id": str(uuid.uuid4()), "date": new_date, "done": False, "done_by": "", "done_at": None,
            "created_by": principal["email"], "created_at": datetime.now(timezone.utc).isoformat()})
        created += 1
    await log_audit(principal["email"], principal["role"], "DUPLICATION_TACHES", "tâche", payload.to_start,
                    f"{created} tâche(s) copiée(s) de la semaine du {payload.from_start}", pid)
    return {"created": created}


@api_router.post("/tasks/{task_id}/toggle")
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


@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, principal: dict = Depends(get_principal)):
    doc = await db.shift_tasks.find_one({"id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    await db.shift_tasks.delete_one({"id": task_id})
    series_stopped = False
    if doc.get("series_id"):
        await db.shift_tasks.update_many({"series_id": doc["series_id"]}, {"$set": {"recurring": False}})
        series_stopped = bool(doc.get("recurring"))
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_TACHE", "tâche", task_id,
                    f"Tâche « {doc['title']} » supprimée", doc["pharmacy_id"])
    return {"status": "supprimée", "series_stopped": series_stopped}


# ---------------------- Tâches récurrentes + rappels de fin de quart ----------------------

async def materialize_recurring_tasks(pid: str, start: str, end: str) -> None:
    try:
        start_d = datetime.fromisoformat(start).date()
        end_d = datetime.fromisoformat(end).date()
    except ValueError:
        return
    if (end_d - start_d).days > 31 or end_d < start_d:
        return
    series_docs = await db.shift_tasks.find(
        {"pharmacy_id": pid, "series_id": {"$nin": ["", None]}}, {"_id": 0}).to_list(2000)
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
                        "created_at": datetime.now(timezone.utc).isoformat()})
            day += timedelta(days=1)


class TaskRecurringIn(BaseModel):
    recurring: bool


@api_router.put("/tasks/{task_id}/recurring")
async def set_task_recurring(task_id: str, payload: TaskRecurringIn, principal: dict = Depends(get_principal)):
    doc = await db.shift_tasks.find_one({"id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    sid = doc.get("series_id") or doc["id"]
    await db.shift_tasks.update_many(
        {"$or": [{"series_id": sid}, {"id": task_id}]},
        {"$set": {"recurring": payload.recurring, "series_id": sid}})
    await log_audit(principal["email"], principal["role"], "RECURRENCE_TACHE", "tâche", task_id,
                    f"Récurrence hebdomadaire {'activée' if payload.recurring else 'désactivée'} pour « {doc['title']} »",
                    doc["pharmacy_id"])
    return {**doc, "recurring": payload.recurring, "series_id": sid}


TASK_SHIFTS = ["Matin", "Après-midi", "Soir"]


def unfinished_tasks_html(shift: str, date_str: str, tasks: list) -> str:
    rows = "".join(
        f"<li style='margin-bottom:6px'><strong>{t['title']}</strong>"
        f"{(' — ' + t['assignee_name']) if t.get('assignee_name') else ' — Toute l’équipe'}"
        f"{(' <span style=&quot;color:#64748b&quot;>(' + t['description'] + ')</span>') if t.get('description') else ''}</li>"
        for t in tasks)
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Tâches non complétées</h2>"
        f"<p>Le quart <strong>{shift}</strong> du <strong>{date_str}</strong> se termine et "
        f"<strong>{len(tasks)} tâche(s)</strong> n'ont pas été cochées :</p>"
        f"<ul>{rows}</ul>"
        "<p>Ouvrez le module « Tâches par quart » pour faire le suivi avec votre équipe.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Résumé automatique de fin de quart envoyé par Arrière Plan.</p>"
        "</div>")


async def send_shift_task_reminders(shift: str, date_str: str = "") -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("Rappels tâches non faites : RESEND_API_KEY manquante, envoi ignoré.")
        return 0
    today = date_str or datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    pending = await db.shift_tasks.find({"date": today, "shift": shift, "done": False}, {"_id": 0}).to_list(500)
    if not pending:
        return 0
    resend.api_key = api_key
    sender = await get_sender()
    by_pharmacy: dict = {}
    for t in pending:
        by_pharmacy.setdefault(t["pharmacy_id"], []).append(t)
    sent = 0
    for pid, tasks in by_pharmacy.items():
        admins = await db.users.find({"role": {"$in": ["admin", "manager"]}, "pharmacy_id": pid}, {"_id": 0}).to_list(50)
        html = unfinished_tasks_html(shift, today, tasks)
        for a in admins:
            if not a.get("email"):
                continue
            try:
                await asyncio.to_thread(resend.Emails.send, {
                    "from": sender, "to": [a["email"]],
                    "subject": f"{len(tasks)} tâche(s) non faite(s) — quart {shift} du {today}",
                    "html": html})
                sent += 1
            except Exception as exc:
                logger.error(f"Rappel tâches ({shift}) vers {a['email']} échoué : {exc}")
        await log_audit("système", "system", "RAPPEL_TACHES_QUART", "tâche", today,
                        f"Quart {shift} : {len(tasks)} tâche(s) non complétée(s), {sent} courriel(s) envoyé(s)", pid)
    return sent


@api_router.post("/tasks/reminders/run")
async def run_task_reminders(shift: str = Query(""), date: str = Query(""), principal: dict = Depends(get_principal)):
    shifts = [shift] if shift else TASK_SHIFTS
    details: dict = {}
    total = 0
    for s in shifts:
        n = await send_shift_task_reminders(s, date)
        details[s] = n
        total += n
    return {"sent": total, "par_quart": details}


async def shift_task_reminders_job(shift: str):
    sent = await send_shift_task_reminders(shift)
    logger.info(f"Rappels tâches non faites ({shift}) : {sent} courriel(s) envoyé(s)")


# ---------------------- Rapport hebdomadaire des tâches (gestionnaires) ----------------------

def weekly_report_html(week_start: str, week_end: str, by_shift: list, by_emp: list, team: dict, watch: list) -> str:
    def color(rate: int) -> str:
        return "#059669" if rate >= 85 else ("#b45309" if rate >= 60 else "#dc2626")
    td = "padding:6px 12px;border-bottom:1px solid #e2e8f0"
    shift_rows = "".join(
        f"<tr><td style='{td}'>{s['shift']}</td><td style='{td}'>{s['done']}/{s['total']}</td>"
        f"<td style='{td};color:{color(s['rate'])};font-weight:bold'>{s['rate']} %</td></tr>"
        for s in by_shift)
    emp_rows = "".join(
        f"<tr><td style='{td}'>{e['name']}</td><td style='{td}'>{e['done']}/{e['total']}</td>"
        f"<td style='{td};color:{color(e['rate'])};font-weight:bold'>{e['rate']} %</td></tr>"
        for e in by_emp) or f"<tr><td style='{td}' colspan='3'>Aucune tâche assignée individuellement.</td></tr>"
    watch_html = ("<ul>" + "".join(f"<li style='color:#b45309'>{w}</li>" for w in watch) + "</ul>") if watch \
        else "<p style='color:#059669'>Rien à signaler — belle semaine, tout roule.</p>"
    header = "<tr style='text-align:left;color:#64748b;font-size:12px;text-transform:uppercase'>"
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Rapport hebdomadaire des tâches</h2>"
        f"<p>Semaine du <strong>{week_start}</strong> au <strong>{week_end}</strong> — "
        f"tâches d'équipe : <strong>{team['done']}/{team['total']}</strong> complétées ({team['rate']} %).</p>"
        "<h3 style='color:#0f172a'>Taux de complétion par quart</h3>"
        f"<table style='border-collapse:collapse;width:100%'>{header}<th style='{td}'>Quart</th>"
        f"<th style='{td}'>Tâches</th><th style='{td}'>Taux</th></tr>{shift_rows}</table>"
        "<h3 style='color:#0f172a'>Par employé(e)</h3>"
        f"<table style='border-collapse:collapse;width:100%'>{header}<th style='{td}'>Employé(e)</th>"
        f"<th style='{td}'>Tâches</th><th style='{td}'>Taux</th></tr>{emp_rows}</table>"
        "<h3 style='color:#b45309'>Quarts et employés à surveiller (&lt;60 %)</h3>"
        f"{watch_html}"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Rapport automatique envoyé chaque lundi matin par Arrière Plan.</p>"
        "</div>")


async def send_weekly_task_reports(week_start: str = "", only_pharmacy: str = "") -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("Rapport hebdo tâches : RESEND_API_KEY manquante, envoi ignoré.")
        return 0
    if week_start:
        ws = date.fromisoformat(week_start)
        ws = ws - timedelta(days=ws.weekday())
    else:
        today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date()
        ws = today - timedelta(days=today.weekday() + 7)
    we = ws + timedelta(days=6)
    query: dict = {"date": {"$gte": ws.isoformat(), "$lte": we.isoformat()}}
    if only_pharmacy:
        query["pharmacy_id"] = only_pharmacy
    docs = await db.shift_tasks.find(query, {"_id": 0}).to_list(5000)
    if not docs:
        return 0
    resend.api_key = api_key
    sender = await get_sender()
    by_pharmacy: dict = {}
    for t in docs:
        by_pharmacy.setdefault(t["pharmacy_id"], []).append(t)
    total_sent = 0
    for pid, tasks in by_pharmacy.items():
        by_shift: dict = {}
        by_emp: dict = {}
        team = {"total": 0, "done": 0}
        for t in tasks:
            s = by_shift.setdefault(t["shift"], {"shift": t["shift"], "total": 0, "done": 0})
            s["total"] += 1
            done = bool(t.get("done"))
            if done:
                s["done"] += 1
            name = t.get("assignee_name") or ""
            if name:
                e = by_emp.setdefault(name, {"name": name, "total": 0, "done": 0})
                e["total"] += 1
                if done:
                    e["done"] += 1
            else:
                team["total"] += 1
                if done:
                    team["done"] += 1
        for coll in (by_shift, by_emp):
            for v in coll.values():
                v["rate"] = _rate(v["done"], v["total"])
        team["rate"] = _rate(team["done"], team["total"])
        shifts_sorted = [by_shift[k] for k in TASK_SHIFTS if k in by_shift] + \
                        [v for k, v in by_shift.items() if k not in TASK_SHIFTS]
        emp_sorted = sorted(by_emp.values(), key=lambda x: x["rate"])
        watch = [f"Quart {s['shift']} : seulement {s['rate']} % de complétion" for s in shifts_sorted if s["rate"] < 60]
        watch += [f"{e['name']} : {e['rate']} % de ses tâches complétées" for e in emp_sorted if e["rate"] < 60]
        html = weekly_report_html(ws.isoformat(), we.isoformat(), shifts_sorted, emp_sorted, team, watch)
        admins = await db.users.find({"role": {"$in": ["admin", "manager"]}, "pharmacy_id": pid}, {"_id": 0}).to_list(50)
        sent = 0
        for a in admins:
            if not a.get("email"):
                continue
            try:
                await asyncio.to_thread(resend.Emails.send, {
                    "from": sender, "to": [a["email"]],
                    "subject": f"Rapport hebdo des tâches — semaine du {ws.isoformat()}",
                    "html": html})
                sent += 1
            except Exception as exc:
                logger.error(f"Rapport hebdo vers {a['email']} échoué : {exc}")
        await log_audit("système", "system", "RAPPORT_HEBDO_TACHES", "tâche", ws.isoformat(),
                        f"Rapport hebdomadaire des tâches : {sent} courriel(s) envoyé(s) (semaine du {ws.isoformat()})", pid)
        total_sent += sent
    return total_sent


@api_router.post("/tasks/weekly-report/run")
async def run_weekly_task_report(week_start: str = Query(""), principal: dict = Depends(get_principal)):
    if week_start:
        try:
            date.fromisoformat(week_start)
        except ValueError:
            raise HTTPException(status_code=400, detail="Date de semaine invalide.")
    only = principal["pharmacy_id"] if principal["role"] == "admin" else ""
    sent = await send_weekly_task_reports(week_start, only or "")
    return {"sent": sent}


async def weekly_task_report_job():
    sent = await send_weekly_task_reports()
    logger.info(f"Rapport hebdo tâches : {sent} courriel(s) envoyé(s)")


# ==================== Livraisons ====================

DELIVERY_STATUSES = ("a_ramasser", "en_route", "livree")

DEFAULT_PHARMACY_ADDRESS = "5090 Rue Sherbrooke Est, Montréal, QC"


class PharmacySettingsIn(BaseModel):
    address: str
    mileage_rate: float = -1.0


@api_router.get("/pharmacy/settings")
async def get_pharmacy_settings(user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    doc = await db.pharmacy_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return {"address": (doc or {}).get("address") or DEFAULT_PHARMACY_ADDRESS,
            "mileage_rate": (doc or {}).get("mileage_rate", 0.50)}


@api_router.put("/pharmacy/settings")
async def set_pharmacy_settings(payload: PharmacySettingsIn, principal: dict = Depends(get_principal)):
    if not payload.address.strip():
        raise HTTPException(status_code=400, detail="Adresse requise.")
    pid = principal["pharmacy_id"] or "ph1"
    update = {"pharmacy_id": pid, "address": payload.address.strip(),
              "updated_by": principal["email"], "updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.mileage_rate >= 0:
        if payload.mileage_rate > 5:
            raise HTTPException(status_code=400, detail="Taux au kilomètre invalide (max 5 $/km).")
        update["mileage_rate"] = round(payload.mileage_rate, 2)
    await db.pharmacy_settings.update_one({"pharmacy_id": pid}, {"$set": update}, upsert=True)
    await log_audit(principal["email"], principal["role"], "MODIF_ADRESSE_PHARMACIE", "livraison", pid,
                    f"Adresse de départ des tournées : {payload.address.strip()}", pid)
    return {"address": payload.address.strip()}


async def geocode_address(address: str):
    key = address.strip().lower()
    cached = await db.geocache.find_one({"query": key}, {"_id": 0})
    if cached:
        return (cached["lat"], cached["lon"]) if cached.get("lat") is not None else None

    def fetch():
        try:
            r = requests.get("https://nominatim.openstreetmap.org/search",
                             params={"q": address, "format": "json", "limit": 1, "countrycodes": "ca"},
                             headers={"User-Agent": "ArrierePlan-HR/1.0"}, timeout=8)
            data = r.json()
            return (float(data[0]["lat"]), float(data[0]["lon"])) if data else None
        except Exception:
            return None

    result = await asyncio.to_thread(fetch)
    await asyncio.sleep(1.05)
    await db.geocache.update_one({"query": key}, {"$set": {
        "query": key, "lat": result[0] if result else None, "lon": result[1] if result else None,
        "cached_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return result


def haversine_km(a, b) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _tour_order(start, items):
    ordered = []
    total = 0.0
    current = start
    remaining = items[:]
    while remaining:
        if current is None:
            d, coords = remaining.pop(0)
            leg = None
        else:
            idx = min(range(len(remaining)), key=lambda i: haversine_km(current, remaining[i][1]))
            d, coords = remaining.pop(idx)
            leg = round(haversine_km(current, coords) * 1.3, 1)
            total += leg
        current = coords or current
        ordered.append((d, leg))
    return ordered, total, current


@api_router.get("/deliveries/route")
async def delivery_route(courier_employee_id: str = Query(""), user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    is_manager = user["role"] in ("admin", "manager", "superadmin")
    eid = courier_employee_id if (is_manager and courier_employee_id) else (user.get("employee_id") or "")
    if not eid:
        raise HTTPException(status_code=400, detail="Aucun livreur ciblé.")
    active = await db.deliveries.find(
        {"pharmacy_id": pid, "courier_employee_id": eid, "status": {"$ne": "livree"}},
        {"_id": 0, "proof_image": 0}).to_list(100)
    settings = await db.pharmacy_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    start_address = (settings or {}).get("address") or DEFAULT_PHARMACY_ADDRESS
    if not active:
        return {"start_address": start_address, "stops": [], "total_km": 0, "maps_url": ""}
    start = await geocode_address(start_address)
    located_urgent, located_normal, unlocated = [], [], []
    for d in active:
        coords = await geocode_address(d["address"])
        if coords is None:
            unlocated.append(d)
        elif d["priority"] == "urgent":
            located_urgent.append((d, coords))
        else:
            located_normal.append((d, coords))
    ordered_urgent, km_u, current = _tour_order(start, located_urgent)
    ordered_normal, km_n, _ = _tour_order(current, located_normal)
    stops = []
    for d, leg in ordered_urgent + ordered_normal:
        stops.append({"delivery_id": d["id"], "client_name": d["client_name"], "address": d["address"],
                      "priority": d["priority"], "status": d["status"], "leg_km": leg, "located": True})
    for d in unlocated:
        stops.append({"delivery_id": d["id"], "client_name": d["client_name"], "address": d["address"],
                      "priority": d["priority"], "status": d["status"], "leg_km": None, "located": False})
    parts = [start_address] + [s["address"] for s in stops]
    maps_url = "https://www.google.com/maps/dir/" + "/".join(requests.utils.quote(p) for p in parts)
    return {"start_address": start_address, "stops": stops,
            "total_km": round(km_u + km_n, 1), "maps_url": maps_url}


@api_router.get("/deliveries/mileage")
async def delivery_mileage(start: str = Query(...), end: str = Query(...), principal: dict = Depends(get_principal)):
    try:
        date.fromisoformat(start)
        date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates invalides.")
    pid = principal["pharmacy_id"] or "ph1"
    settings = await db.pharmacy_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    start_address = (settings or {}).get("address") or DEFAULT_PHARMACY_ADDRESS
    rate = (settings or {}).get("mileage_rate", 0.50)
    docs = await db.deliveries.find(
        {"pharmacy_id": pid, "status": "livree", "delivered_at": {"$nin": [None, ""]}},
        {"_id": 0, "proof_image": 0}).to_list(2000)
    per_courier: dict = {}
    for d in docs:
        try:
            day = datetime.fromisoformat(d["delivered_at"]).astimezone(MONTREAL_TZ).date().isoformat()
        except ValueError:
            continue
        if not (start <= day <= end):
            continue
        c = per_courier.setdefault(d["courier_employee_id"], {"courier_name": d["courier_name"], "days": {}})
        c["days"].setdefault(day, []).append(d)
    depot = await geocode_address(start_address) if per_courier else None
    couriers = []
    for eid, c in per_courier.items():
        total_km, count, unlocated = 0.0, 0, 0
        for day in sorted(c["days"]):
            located_urgent, located_normal = [], []
            for d in c["days"][day]:
                count += 1
                coords = await geocode_address(d["address"])
                if coords is None:
                    unlocated += 1
                elif d["priority"] == "urgent":
                    located_urgent.append((d, coords))
                else:
                    located_normal.append((d, coords))
            _, km_u, current = _tour_order(depot, located_urgent)
            _, km_n, _ = _tour_order(current, located_normal)
            total_km += km_u + km_n
        couriers.append({"courier_employee_id": eid, "courier_name": c["courier_name"],
                         "deliveries": count, "days": len(c["days"]),
                         "km": round(total_km, 1), "unlocated": unlocated})
    couriers.sort(key=lambda x: -x["km"])
    return {"start_address": start_address, "mileage_rate": rate, "couriers": couriers}


@api_router.get("/deliveries/proofs")
async def delivery_proofs(client: str = Query(""), principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    query: dict = {"pharmacy_id": pid, "status": "livree", "proof_image": {"$nin": [None, ""]}}
    if client.strip():
        query["client_name"] = {"$regex": re.escape(client.strip()), "$options": "i"}
    return await db.deliveries.find(query, {"_id": 0}).sort("delivered_at", -1).to_list(200)


class DeliveryIn(BaseModel):
    client_name: str
    address: str
    phone: str = ""
    order_ref: str = ""
    products: str = ""
    notes: str = ""
    priority: str = "normal"
    courier_employee_id: str
    courier_name: str = ""


class DeliveryStatusIn(BaseModel):
    status: str
    proof_image: str = ""
    proof_type: str = ""


def delivery_email_html(d: dict) -> str:
    maps = "https://www.google.com/maps/search/?api=1&query=" + requests.utils.quote(d["address"])
    urgent = "<p style='color:#dc2626;font-weight:bold'>PRIORITÉ URGENTE</p>" if d["priority"] == "urgent" else ""
    rows = ""
    for label, val in (("Client", d["client_name"]), ("Adresse", d["address"]), ("Téléphone", d["phone"]),
                       ("Commande", d["order_ref"]), ("Produits", d["products"]), ("Notes", d["notes"])):
        if val:
            rows += (f"<tr><td style='padding:4px 12px;color:#64748b'>{label}</td>"
                     f"<td style='padding:4px 12px;font-weight:bold'>{val}</td></tr>")
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Nouvelle livraison assignée</h2>"
        f"{urgent}<table style='border-collapse:collapse'>{rows}</table>"
        f"<p><a href='{maps}' style='color:#059669;font-weight:bold'>Ouvrir l'itinéraire dans Google Maps</a></p>"
        "<p>Ramassez le colis à la pharmacie puis mettez à jour le statut dans votre compte Arrière Plan "
        "(module Livraisons).</p></div>")


@api_router.get("/deliveries")
async def list_deliveries(user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    query: dict = {"pharmacy_id": pid}
    if user["role"] not in ("admin", "manager", "superadmin"):
        query["courier_employee_id"] = user.get("employee_id") or ""
    return await db.deliveries.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/deliveries")
async def create_delivery(payload: DeliveryIn, principal: dict = Depends(get_principal)):
    if not payload.client_name.strip() or not payload.address.strip():
        raise HTTPException(status_code=400, detail="Client et adresse requis.")
    if payload.priority not in ("normal", "urgent"):
        raise HTTPException(status_code=400, detail="Priorité invalide.")
    if not payload.courier_employee_id:
        raise HTTPException(status_code=400, detail="Choisissez un livreur.")
    pid = principal["pharmacy_id"] or "ph1"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid,
        "client_name": payload.client_name.strip(), "address": payload.address.strip(),
        "phone": payload.phone.strip(), "order_ref": payload.order_ref.strip(),
        "products": payload.products.strip(), "notes": payload.notes.strip(),
        "priority": payload.priority,
        "courier_employee_id": payload.courier_employee_id, "courier_name": payload.courier_name,
        "status": "a_ramasser", "picked_up_at": None, "delivered_at": None,
        "proof_image": None, "proof_type": None,
        "created_by": principal["email"], "created_at": now, "updated_at": now,
    }
    await db.deliveries.insert_one({**doc})
    email_sent = False
    api_key = os.environ.get("RESEND_API_KEY", "")
    courier_user = await db.users.find_one(
        {"employee_id": payload.courier_employee_id, "pharmacy_id": pid}, {"_id": 0, "email": 1})
    if api_key and courier_user and courier_user.get("email"):
        resend.api_key = api_key
        sender = await get_sender()
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": sender, "to": [courier_user["email"]],
                "subject": ("URGENT — " if payload.priority == "urgent" else "") + f"Livraison à faire : {doc['client_name']}",
                "html": delivery_email_html(doc)})
            email_sent = True
        except Exception as exc:
            logger.error(f"Courriel livraison vers {courier_user['email']} échoué : {exc}")
    await log_audit(principal["email"], principal["role"], "CREATION_LIVRAISON", "livraison", doc["id"],
                    f"Livraison pour {doc['client_name']} assignée à {doc['courier_name']}"
                    f"{' (courriel envoyé)' if email_sent else ''}", pid)
    return {**doc, "email_sent": email_sent}


@api_router.put("/deliveries/{delivery_id}/status")
async def update_delivery_status(delivery_id: str, payload: DeliveryStatusIn, user: dict = Depends(get_current_user)):
    if payload.status not in DELIVERY_STATUSES:
        raise HTTPException(status_code=400, detail="Statut invalide.")
    doc = await db.deliveries.find_one({"id": delivery_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Livraison introuvable.")
    if user["role"] not in ("admin", "manager", "superadmin") and doc["courier_employee_id"] != (user.get("employee_id") or ""):
        raise HTTPException(status_code=403, detail="Cette livraison est assignée à un autre livreur.")
    now = datetime.now(timezone.utc).isoformat()
    update = {"status": payload.status, "updated_at": now}
    if payload.status == "en_route" and not doc.get("picked_up_at"):
        update["picked_up_at"] = now
    if payload.status == "livree":
        if not doc.get("delivered_at"):
            update["delivered_at"] = now
        if payload.proof_image:
            if not payload.proof_image.startswith("data:image/"):
                raise HTTPException(status_code=400, detail="Format de preuve invalide.")
            if len(payload.proof_image) > 3_000_000:
                raise HTTPException(status_code=400, detail="Image de preuve trop lourde (max ~2 Mo).")
            if payload.proof_type not in ("photo", "signature"):
                raise HTTPException(status_code=400, detail="Type de preuve invalide.")
            update["proof_image"] = payload.proof_image
            update["proof_type"] = payload.proof_type
    await db.deliveries.update_one({"id": delivery_id}, {"$set": update})
    proof_note = f" avec preuve ({payload.proof_type})" if update.get("proof_image") else ""
    await log_audit(user["email"], user["role"], "STATUT_LIVRAISON", "livraison", delivery_id,
                    f"Livraison {doc['client_name']} → {payload.status}{proof_note}", doc["pharmacy_id"])
    return {**doc, **update}


@api_router.delete("/deliveries/{delivery_id}")
async def delete_delivery(delivery_id: str, principal: dict = Depends(get_principal)):
    doc = await db.deliveries.find_one({"id": delivery_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Livraison introuvable.")
    await db.deliveries.delete_one({"id": delivery_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_LIVRAISON", "livraison", delivery_id,
                    f"Livraison {doc['client_name']} supprimée", doc["pharmacy_id"])
    return {"status": "supprimée"}


# ==================== Rendez-vous (infirmière) ====================

class AppointmentIn(BaseModel):
    employee_id: str
    employee_name: str = ""
    date: str
    start: str
    end: str
    client_name: str
    reason: str = ""
    notes: str = ""


@api_router.get("/appointments")
async def list_appointments(start: str = Query(""), end: str = Query(""), user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    query: dict = {"pharmacy_id": pid}
    if start and end:
        query["date"] = {"$gte": start, "$lte": end}
    return await db.appointments.find(query, {"_id": 0}).sort([("date", 1), ("start", 1)]).to_list(1000)


@api_router.post("/appointments")
async def create_appointment(payload: AppointmentIn, user: dict = Depends(get_current_user)):
    if not payload.client_name.strip():
        raise HTTPException(status_code=400, detail="Le nom du client est requis.")
    if payload.end <= payload.start:
        raise HTTPException(status_code=400, detail="L'heure de fin doit suivre l'heure de début.")
    is_manager = user["role"] in ("admin", "manager", "superadmin")
    if not is_manager and payload.employee_id != (user.get("employee_id") or ""):
        raise HTTPException(status_code=403, detail="Vous ne pouvez ajouter des rendez-vous que pour vous-même.")
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": user.get("pharmacy_id") or "ph1",
        "employee_id": payload.employee_id, "employee_name": payload.employee_name,
        "date": payload.date, "start": payload.start, "end": payload.end,
        "client_name": payload.client_name.strip(), "reason": payload.reason.strip(),
        "notes": payload.notes.strip(),
        "created_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.appointments.insert_one({**doc})
    await log_audit(user["email"], user["role"], "CREATION_RDV", "rendez-vous", doc["id"],
                    f"RDV {doc['client_name']} ({doc['reason'] or 'consultation'}) le {doc['date']} "
                    f"{doc['start']}-{doc['end']} pour {doc['employee_name']}", doc["pharmacy_id"])
    return doc


@api_router.delete("/appointments/{appointment_id}")
async def delete_appointment(appointment_id: str, user: dict = Depends(get_current_user)):
    doc = await db.appointments.find_one({"id": appointment_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Rendez-vous introuvable.")
    is_manager = user["role"] in ("admin", "manager", "superadmin")
    if not is_manager and doc["employee_id"] != (user.get("employee_id") or ""):
        raise HTTPException(status_code=403, detail="Ce rendez-vous appartient à un autre employé.")
    await db.appointments.delete_one({"id": appointment_id})
    await log_audit(user["email"], user["role"], "SUPPRESSION_RDV", "rendez-vous", appointment_id,
                    f"RDV {doc['client_name']} du {doc['date']} supprimé", doc["pharmacy_id"])
    return {"status": "supprimé"}


def appointment_reminder_html(name: str, day: str, appts: list) -> str:
    td = "padding:6px 12px;border-bottom:1px solid #e2e8f0"
    rows = "".join(
        f"<tr><td style='{td};font-weight:bold'>{a['start']}–{a['end']}</td>"
        f"<td style='{td}'>{a['client_name']}</td>"
        f"<td style='{td}'>{a['reason'] or 'Consultation'}</td>"
        f"<td style='{td};color:#64748b'>{a['notes']}</td></tr>"
        for a in appts)
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Vos rendez-vous du jour</h2>"
        f"<p>Bonjour {name},</p>"
        f"<p>Vous avez <strong>{len(appts)} rendez-vous</strong> à votre horaire aujourd'hui ({day}) :</p>"
        "<table style='border-collapse:collapse;width:100%'>"
        "<tr style='text-align:left;color:#64748b;font-size:12px;text-transform:uppercase'>"
        "<th style='padding:6px 12px'>Heure</th><th style='padding:6px 12px'>Client</th>"
        f"<th style='padding:6px 12px'>Motif</th><th style='padding:6px 12px'>Notes</th></tr>{rows}</table>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Rappel automatique envoyé chaque matin à 8 h "
        "par Arrière Plan.</p></div>")


async def send_appointment_reminders(target_date: str = "") -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("Rappels rendez-vous : RESEND_API_KEY manquante, envoi ignoré.")
        return 0
    resend.api_key = api_key
    sender = await get_sender()
    day = target_date or datetime.now(MONTREAL_TZ).date().isoformat()
    appts = await db.appointments.find({"date": day}, {"_id": 0}).sort("start", 1).to_list(2000)
    groups: dict = {}
    for a in appts:
        groups.setdefault((a["pharmacy_id"], a["employee_id"]), []).append(a)
    sent = 0
    for (pid, eid), items in groups.items():
        already = await db.appointment_reminders.find_one({"pharmacy_id": pid, "employee_id": eid, "date": day})
        if already:
            continue
        account = await db.users.find_one({"employee_id": eid, "pharmacy_id": pid}, {"_id": 0, "email": 1, "name": 1})
        email = (account or {}).get("email", "")
        if not email:
            continue
        name = (account or {}).get("name") or items[0].get("employee_name") or ""
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": sender, "to": [email],
                "subject": f"Vos {len(items)} rendez-vous du {day}" if len(items) > 1 else f"Votre rendez-vous du {day}",
                "html": appointment_reminder_html(name, day, items)})
            await db.appointment_reminders.insert_one({
                "pharmacy_id": pid, "employee_id": eid, "date": day,
                "count": len(items), "sent_at": datetime.now(timezone.utc).isoformat()})
            await log_audit("système", "system", "RAPPEL_RDV_ENVOYE", "rendez-vous", eid,
                            f"{len(items)} rendez-vous du {day} rappelés à {email}", pid)
            sent += 1
        except Exception as exc:
            logger.error(f"Rappel rendez-vous vers {email} échoué : {exc}")
    return sent


@api_router.post("/appointments/reminders/run")
async def run_appointment_reminders(target_date: str = Query(""), principal: dict = Depends(get_principal)):
    if target_date:
        try:
            date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Date invalide.")
    sent = await send_appointment_reminders(target_date)
    await log_audit(principal["email"], principal["role"], "RAPPELS_RDV_DECLENCHES", "rendez-vous", "rappels",
                    f"{sent} rappel(s) de rendez-vous envoyé(s) manuellement", principal.get("pharmacy_id", ""))
    return {"sent": sent}


async def appointment_reminders_job():
    sent = await send_appointment_reminders()
    logger.info(f"Rappels rendez-vous du matin : {sent} courriel(s) envoyé(s)")


# ==================== Partenaires de remplacement globaux (superadmin) ====================

class GlobalPartnerIn(BaseModel):
    name: str
    email: str
    roles: list[str]
    partner_type: str = "agency"


@api_router.get("/superadmin/partners")
async def list_global_partners(su: dict = Depends(require_superadmin)):
    return await db.global_partners.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@api_router.post("/superadmin/partners")
async def create_global_partner(payload: GlobalPartnerIn, su: dict = Depends(require_superadmin)):
    if payload.partner_type not in ("agency", "individual"):
        raise HTTPException(status_code=400, detail="Type de partenaire invalide.")
    if not payload.name.strip() or not payload.email.strip():
        raise HTTPException(status_code=400, detail="Nom et courriel requis.")
    if not payload.roles:
        raise HTTPException(status_code=400, detail="Sélectionnez au moins un poste couvert.")
    doc = {"id": str(uuid.uuid4()), "name": payload.name.strip(), "email": payload.email.strip().lower(),
           "roles": payload.roles, "partner_type": payload.partner_type,
           "created_by": su["email"], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.global_partners.insert_one({**doc})
    await log_audit(su["email"], su["role"], "AJOUT_PARTENAIRE_GLOBAL", "remplacement", doc["id"],
                    f"Partenaire global « {doc['name']} » ({', '.join(doc['roles'])}) ajouté au réseau", "")
    return doc


@api_router.delete("/superadmin/partners/{partner_id}")
async def delete_global_partner(partner_id: str, su: dict = Depends(require_superadmin)):
    doc = await db.global_partners.find_one({"id": partner_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Partenaire introuvable.")
    await db.global_partners.delete_one({"id": partner_id})
    await log_audit(su["email"], su["role"], "RETRAIT_PARTENAIRE_GLOBAL", "remplacement", partner_id,
                    f"Partenaire global « {doc['name']} » retiré du réseau", "")
    return {"status": "supprimé"}


# ---------------------- Modèles de tâches + statistiques ----------------------

class TaskBulkItem(BaseModel):
    title: str
    description: str = ""


class TaskBulkIn(BaseModel):
    date: str
    shift: str = "Matin"
    recurring: bool = False
    items: list[TaskBulkItem]


@api_router.post("/tasks/bulk")
async def create_tasks_bulk(payload: TaskBulkIn, principal: dict = Depends(get_principal)):
    created = 0
    for item in payload.items:
        if not item.title.strip():
            continue
        tid = str(uuid.uuid4())
        await db.shift_tasks.insert_one({
            "id": tid,
            "pharmacy_id": principal["pharmacy_id"] or "ph1",
            "date": payload.date,
            "shift": payload.shift,
            "title": item.title.strip(),
            "description": item.description.strip(),
            "assignee_employee_id": "",
            "assignee_name": "",
            "recurring": payload.recurring,
            "series_id": tid if payload.recurring else "",
            "done": False,
            "done_by": "",
            "done_at": None,
            "created_by": principal["email"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created += 1
    await log_audit(principal["email"], principal["role"], "AJOUT_MODELE_TACHES", "tâche", payload.date,
                    f"{created} tâche(s) ajoutée(s) ({payload.date}, quart {payload.shift})",
                    principal["pharmacy_id"] or "ph1")
    return {"created": created}


def _rate(done: int, total: int) -> int:
    return round(done / total * 100) if total else 0


TASK_BADGE_DEFS = {
    "perfect_week": ("Semaine parfaite", "Toutes les tâches d'une semaine complétées"),
    "streak_2": ("Sur une lancée", "2 semaines parfaites d'affilée"),
    "streak_4": ("Régularité exemplaire", "4 semaines parfaites d'affilée"),
    "streak_8": ("Légende de la pharmacie", "8 semaines parfaites d'affilée"),
    "team_5": ("Esprit d'équipe", "5 tâches d'équipe cochées"),
    "team_20": ("Pilier de l'équipe", "20 tâches d'équipe cochées"),
}


def compute_task_badges(week_map: dict, team_checks: int, current_week: str) -> dict:
    weeks_desc = sorted((wk for wk, v in week_map.items() if v["total"] > 0), reverse=True)
    perfect_weeks = sum(1 for wk in weeks_desc if week_map[wk]["done"] == week_map[wk]["total"])
    streak = 0
    for i, wk in enumerate(weeks_desc):
        is_perfect = week_map[wk]["done"] == week_map[wk]["total"]
        if i == 0 and wk == current_week and not is_perfect:
            continue
        if is_perfect:
            streak += 1
        else:
            break
    keys = []
    if perfect_weeks >= 1:
        keys.append("perfect_week")
    for n in (2, 4, 8):
        if streak >= n:
            keys.append(f"streak_{n}")
    for n in (5, 20):
        if team_checks >= n:
            keys.append(f"team_{n}")
    badges = [{"key": k, "label": TASK_BADGE_DEFS[k][0], "description": TASK_BADGE_DEFS[k][1]} for k in keys]
    return {"current_streak": streak, "perfect_weeks": perfect_weeks, "badges": badges}


@api_router.get("/tasks/stats")
async def task_stats(weeks: int = Query(8, ge=1, le=26), user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    is_employee = user["role"] not in ("admin", "manager", "superadmin")
    my_eid = user.get("employee_id") or ""
    my_name = user.get("name") or ""
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date()
    monday = today - timedelta(days=today.weekday())
    start = monday - timedelta(weeks=weeks - 1)
    docs = await db.shift_tasks.find(
        {"pharmacy_id": pid, "date": {"$gte": start.isoformat(), "$lte": today.isoformat()}},
        {"_id": 0}).to_list(5000)
    weekly: dict = {}
    by_shift: dict = {}
    by_employee: dict = {}
    emp_weeks: dict = {}
    team = {"total": 0, "done": 0}
    for t in docs:
        assigned = t.get("assignee_employee_id") or ""
        done = bool(t.get("done"))
        if not assigned:
            team["total"] += 1
            if done:
                team["done"] += 1
                checker = t.get("done_by") or ""
                if checker and (not is_employee or checker == my_name):
                    e = by_employee.setdefault(checker, {"name": checker, "total": 0, "done": 0, "team_checks": 0})
                    e["team_checks"] += 1
            if is_employee:
                continue
        elif is_employee and assigned != my_eid:
            continue
        d = datetime.fromisoformat(t["date"]).date()
        wk = (d - timedelta(days=d.weekday())).isoformat()
        w = weekly.setdefault(wk, {"week_start": wk, "total": 0, "done": 0})
        w["total"] += 1
        s = by_shift.setdefault(t["shift"], {"shift": t["shift"], "total": 0, "done": 0})
        s["total"] += 1
        if done:
            w["done"] += 1
            s["done"] += 1
        name = t.get("assignee_name") or ""
        if name:
            e = by_employee.setdefault(name, {"name": name, "total": 0, "done": 0, "team_checks": 0})
            e["total"] += 1
            if done:
                e["done"] += 1
            c = emp_weeks.setdefault(name, {}).setdefault(wk, {"total": 0, "done": 0})
            c["total"] += 1
            if done:
                c["done"] += 1
    for coll in (weekly, by_shift, by_employee):
        for v in coll.values():
            v["rate"] = _rate(v.get("done", 0), v.get("total", 0))
    team["rate"] = _rate(team["done"], team["total"])
    current_week = monday.isoformat()
    for name, e in by_employee.items():
        e.update(compute_task_badges(emp_weeks.get(name, {}), e.get("team_checks", 0), current_week))
    shifts_sorted = [by_shift[s] for s in TASK_SHIFTS if s in by_shift] + \
                    [v for k, v in by_shift.items() if k not in TASK_SHIFTS]
    return {
        "weekly": sorted(weekly.values(), key=lambda x: x["week_start"], reverse=True),
        "by_shift": shifts_sorted,
        "by_employee": sorted(by_employee.values(), key=lambda x: (-x["rate"], x["name"])),
        "team": team,
    }


@api_router.get("/tasks/honor-roll")
async def task_honor_roll(month: str = Query(""), user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date()
    target_month = month if re.fullmatch(r"\d{4}-\d{2}", month or "") else today.isoformat()[:7]
    docs = await db.shift_tasks.find(
        {"pharmacy_id": pid, "date": {"$gte": f"{target_month}-01", "$lte": f"{target_month}-31"}},
        {"_id": 0}).to_list(5000)
    by_emp: dict = {}
    for t in docs:
        done = bool(t.get("done"))
        name = t.get("assignee_name") or ""
        if name:
            e = by_emp.setdefault(name, {"name": name, "total": 0, "done": 0, "team_checks": 0})
            e["total"] += 1
            if done:
                e["done"] += 1
        elif done and t.get("done_by"):
            e = by_emp.setdefault(t["done_by"], {"name": t["done_by"], "total": 0, "done": 0, "team_checks": 0})
            e["team_checks"] += 1
    entries = []
    for e in by_emp.values():
        if e["total"] == 0 and e["team_checks"] == 0:
            continue
        e["rate"] = _rate(e["done"], e["total"]) if e["total"] > 0 else 100
        entries.append(e)
    entries.sort(key=lambda x: (-x["rate"], -(x["done"] + x["team_checks"]), x["name"]))
    return {"month": target_month, "entries": entries[:10]}


class TaskGoalIn(BaseModel):
    target: int


@api_router.get("/tasks/goal")
async def get_task_goal(start: str = Query(""), user: dict = Depends(get_current_user)):
    pid = user.get("pharmacy_id") or "ph1"
    try:
        ws = date.fromisoformat(start) if start else None
    except ValueError:
        ws = None
    if ws is None:
        today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date()
        ws = today - timedelta(days=today.weekday())
    ws = ws - timedelta(days=ws.weekday())
    we = ws + timedelta(days=6)
    goal = await db.task_goals.find_one({"pharmacy_id": pid}, {"_id": 0})
    target = int(goal["target"]) if goal else 0
    docs = await db.shift_tasks.find(
        {"pharmacy_id": pid, "date": {"$gte": ws.isoformat(), "$lte": we.isoformat()}},
        {"_id": 0, "done": 1}).to_list(5000)
    total = len(docs)
    done = sum(1 for t in docs if t.get("done"))
    return {"target": target, "week_start": ws.isoformat(), "total": total, "done": done, "rate": _rate(done, total)}


@api_router.post("/tasks/goal")
async def set_task_goal(payload: TaskGoalIn, principal: dict = Depends(get_principal)):
    if not 50 <= payload.target <= 100:
        raise HTTPException(status_code=400, detail="L'objectif doit être entre 50 et 100 %.")
    pid = principal["pharmacy_id"] or "ph1"
    await db.task_goals.update_one(
        {"pharmacy_id": pid},
        {"$set": {"pharmacy_id": pid, "target": payload.target,
                  "updated_by": principal["email"], "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    await log_audit(principal["email"], principal["role"], "OBJECTIF_EQUIPE", "tâche", pid,
                    f"Objectif d'équipe hebdomadaire fixé à {payload.target} %", pid)
    return {"target": payload.target}


# ==================== Remplaçants : agences, demandes, offres ====================

class AgencyIn(BaseModel):
    name: str
    email: str
    roles: list[str]


@api_router.get("/agencies")
async def list_agencies(principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    local = await db.agencies.find({"pharmacy_id": pid}, {"_id": 0}).sort("name", 1).to_list(200)
    partners = await db.global_partners.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return local + [{**p, "pharmacy_id": "", "global": True} for p in partners]


@api_router.post("/agencies")
async def create_agency(payload: AgencyIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "name": payload.name.strip(),
           "email": payload.email.strip().lower(), "roles": payload.roles,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.agencies.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "AJOUT_AGENCE", "remplacement", doc["id"],
                    f"Agence « {doc['name']} » ({', '.join(doc['roles'])}) ajoutée", pid)
    return doc


@api_router.delete("/agencies/{agency_id}")
async def delete_agency(agency_id: str, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    doc = await db.agencies.find_one({"id": agency_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Agence introuvable.")
    await db.agencies.delete_one({"id": agency_id})
    await log_audit(principal["email"], principal["role"], "RETRAIT_AGENCE", "remplacement", agency_id,
                    f"Agence « {doc['name']} » retirée", pid)
    return {"status": "retirée"}


class ReplacementSlot(BaseModel):
    date: str
    start: str
    end: str


class ReplacementRequestIn(BaseModel):
    role: str
    slots: list[ReplacementSlot]
    notes: str = ""
    urgency: str = "Normale"
    public_base_url: str


def replacement_email_html(pharmacy_name: str, role: str, slots: list, notes: str, urgency: str, link: str) -> str:
    slot_lines = "".join(f"<li><strong>{s['date']}</strong> de {s['start']} à {s['end']}</li>" for s in slots)
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Demande de remplacement</h2>"
        f"<p><strong>{pharmacy_name}</strong> recherche un(e) <strong>{role}</strong> (urgence : {urgency}).</p>"
        f"<ul>{slot_lines}</ul>"
        + (f"<p>Précisions : {notes}</p>" if notes else "")
        + f"<p style='margin:24px 0'><a href='{link}' style='background:#059669;color:#ffffff;padding:12px 24px;"
          "border-radius:9999px;text-decoration:none;font-weight:bold'>Voir la demande et proposer un remplaçant</a></p>"
          "<p style='font-size:12px;color:#94a3b8'>Ce lien vous permet de consulter la demande et de soumettre votre candidat "
          "directement — l'administration de la pharmacie recevra votre offre instantanément.</p>"
        "</div>"
    )


@api_router.post("/replacements/requests")
async def create_replacement_request(payload: ReplacementRequestIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    if not payload.slots:
        raise HTTPException(status_code=400, detail="Ajoutez au moins une plage à combler.")
    for s in payload.slots:
        try:
            date.fromisoformat(s.date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Date de plage invalide.")
    token = secrets.token_urlsafe(24)
    link = f"{payload.public_base_url.rstrip('/')}/?remplacement={token}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "role": payload.role,
        "slots": [s.model_dump() for s in payload.slots], "notes": payload.notes.strip(),
        "urgency": payload.urgency, "status": "open", "token": token, "link": link,
        "chosen_offer_id": None, "emails_sent": 0,
        "created_by": principal["email"], "created_at": now, "updated_at": now,
    }
    sent = 0
    api_key = os.environ.get("RESEND_API_KEY", "")
    agencies = await db.agencies.find({"pharmacy_id": pid, "roles": payload.role}, {"_id": 0}).to_list(200)
    partners = await db.global_partners.find({"roles": payload.role}, {"_id": 0}).to_list(200)
    recipients: list = []
    seen_emails: set = set()
    for r in agencies + partners:
        em = (r.get("email") or "").lower()
        if em and em not in seen_emails:
            seen_emails.add(em)
            recipients.append(r)
    if api_key and recipients:
        resend.api_key = api_key
        sender = await get_sender()
        pharmacy_name = "Pharmacie Arrière Plan"
        html = replacement_email_html(pharmacy_name, payload.role, doc["slots"], doc["notes"], doc["urgency"], link)
        for ag in recipients:
            try:
                await asyncio.to_thread(resend.Emails.send, {
                    "from": sender, "to": [ag["email"]],
                    "subject": f"Demande de remplacement — {payload.role} ({doc['slots'][0]['date']})",
                    "html": html})
                sent += 1
            except Exception as exc:
                logger.error(f"Courriel agence {ag['email']} échoué : {exc}")
    doc["emails_sent"] = sent
    await db.replacement_requests.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "DEMANDE_REMPLACEMENT", "remplacement", doc["id"],
                    f"Demande {payload.role} ({len(payload.slots)} plage(s)) — {sent} courriel(s) envoyé(s) "
                    f"({len(agencies)} agence(s) locale(s) + {len(partners)} partenaire(s) global(aux))", pid)
    return {k: v for k, v in doc.items() if k != "token"} | {"link": link}


@api_router.get("/replacements/requests")
async def list_replacement_requests(principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    docs = await db.replacement_requests.find({"pharmacy_id": pid}, {"_id": 0, "token": 0}).sort("created_at", -1).to_list(200)
    for d in docs:
        d["offers_count"] = await db.replacement_offers.count_documents({"request_id": d["id"]})
        d["chosen_offer"] = None
        if d.get("chosen_offer_id"):
            d["chosen_offer"] = await db.replacement_offers.find_one(
                {"id": d["chosen_offer_id"]},
                {"_id": 0, "candidate_name": 1, "agency_name": 1, "hourly_rate": 1})
    return docs


@api_router.get("/replacements/requests/{request_id}/offers")
async def list_replacement_offers(request_id: str, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    req = await db.replacement_requests.find_one({"id": request_id, "pharmacy_id": pid}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    return await db.replacement_offers.find({"request_id": request_id}, {"_id": 0}).sort("created_at", 1).to_list(200)


@api_router.get("/replacements/public/{token}")
async def public_replacement_request(token: str):
    doc = await db.replacement_requests.find_one({"token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable ou expirée.")
    return {"role": doc["role"], "slots": doc["slots"], "notes": doc["notes"],
            "urgency": doc["urgency"], "status": doc["status"], "created_at": doc["created_at"]}


class ReplacementOfferIn(BaseModel):
    agency_name: str
    agency_email: str
    candidate_name: str
    license_number: str = ""
    experience_years: int = 0
    hourly_rate: float
    phone: str = ""
    email: str = ""
    note: str = ""


@api_router.post("/replacements/public/{token}/offers")
async def submit_replacement_offer(token: str, payload: ReplacementOfferIn):
    req = await db.replacement_requests.find_one({"token": token}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable ou expirée.")
    if req["status"] != "open":
        raise HTTPException(status_code=400, detail="Cette demande est déjà comblée ou fermée.")
    if payload.hourly_rate <= 0 or not payload.candidate_name.strip():
        raise HTTPException(status_code=400, detail="Nom du remplaçant et taux horaire requis.")
    doc = {
        "id": str(uuid.uuid4()), "request_id": req["id"], "pharmacy_id": req["pharmacy_id"],
        "agency_name": payload.agency_name.strip(), "agency_email": payload.agency_email.strip().lower(),
        "candidate_name": payload.candidate_name.strip(), "license_number": payload.license_number.strip(),
        "experience_years": payload.experience_years, "hourly_rate": round(payload.hourly_rate, 2),
        "phone": payload.phone.strip(), "email": payload.email.strip().lower(), "note": payload.note.strip(),
        "status": "received", "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.replacement_offers.insert_one({**doc})
    await log_audit("agence", "public", "OFFRE_REMPLACEMENT", "remplacement", req["id"],
                    f"Offre reçue de {doc['agency_name']} : {doc['candidate_name']} ({req['role']})", req["pharmacy_id"])
    return {"status": "reçue", "id": doc["id"]}


class ChooseOfferIn(BaseModel):
    offer_id: str


@api_router.post("/replacements/requests/{request_id}/choose")
async def choose_replacement_offer(request_id: str, payload: ChooseOfferIn, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    req = await db.replacement_requests.find_one({"id": request_id, "pharmacy_id": pid}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    offer = await db.replacement_offers.find_one({"id": payload.offer_id, "request_id": request_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre introuvable.")
    now = datetime.now(timezone.utc).isoformat()
    await db.replacement_requests.update_one({"id": request_id}, {"$set": {
        "status": "filled", "chosen_offer_id": offer["id"], "updated_at": now}})
    await db.replacement_offers.update_one({"id": offer["id"]}, {"$set": {"status": "chosen"}})
    await db.replacement_offers.update_many(
        {"request_id": request_id, "id": {"$ne": offer["id"]}}, {"$set": {"status": "declined"}})
    api_key = os.environ.get("RESEND_API_KEY", "")
    if api_key:
        resend.api_key = api_key
        sender = await get_sender()
        slot0 = req["slots"][0]["date"] if req.get("slots") else ""
        chosen_html = (
            "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
            "<h2 style='color:#059669'>Arrière Plan — Offre retenue</h2>"
            f"<p>Bonne nouvelle ! Votre candidat(e) <strong>{offer['candidate_name']}</strong> a été retenu(e) "
            f"pour le remplacement de <strong>{req['role']}</strong> ({slot0}) au taux de {offer['hourly_rate']} $/h.</p>"
            "<p>La pharmacie vous contactera pour finaliser les détails.</p></div>")
        declined_html = (
            "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
            "<h2 style='color:#059669'>Arrière Plan — Demande comblée</h2>"
            f"<p>La demande de remplacement de <strong>{req['role']}</strong> ({slot0}) a été comblée par une autre offre.</p>"
            "<p>Merci pour votre proposition — au plaisir de collaborer pour les prochains besoins.</p></div>")
        all_offers = await db.replacement_offers.find({"request_id": request_id}, {"_id": 0}).to_list(200)
        notified: set = set()
        for o in all_offers:
            to_email = o.get("agency_email")
            if not to_email or to_email in notified:
                continue
            notified.add(to_email)
            is_chosen = to_email == offer["agency_email"]
            try:
                await asyncio.to_thread(resend.Emails.send, {
                    "from": sender, "to": [to_email],
                    "subject": ("Offre retenue — " if is_chosen else "Demande comblée — ") + f"{req['role']} ({slot0})",
                    "html": chosen_html if is_chosen else declined_html})
            except Exception as exc:
                logger.error(f"Courriel décision agence {to_email} échoué : {exc}")
    await log_audit(principal["email"], principal["role"], "CHOIX_REMPLACANT", "remplacement", request_id,
                    f"{offer['candidate_name']} ({offer['agency_name']}) retenu(e) à {offer['hourly_rate']} $/h "
                    f"pour {len(req['slots'])} plage(s)", pid)
    return {"request": {**req, "status": "filled", "chosen_offer_id": offer["id"]}, "offer": {**offer, "status": "chosen"}}


@api_router.delete("/replacements/requests/{request_id}")
async def delete_replacement_request(request_id: str, principal: dict = Depends(get_principal)):
    pid = principal["pharmacy_id"] or "ph1"
    req = await db.replacement_requests.find_one({"id": request_id, "pharmacy_id": pid}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    await db.replacement_requests.delete_one({"id": request_id})
    await db.replacement_offers.delete_many({"request_id": request_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_DEMANDE_REMPLACEMENT", "remplacement",
                    request_id, f"Demande {req['role']} supprimée avec ses offres", pid)
    return {"status": "supprimée"}


scheduler = AsyncIOScheduler(timezone="America/Montreal")


def reminder_html(doc: dict, days: int) -> str:
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Rappel de renouvellement</h2>"
        f"<p>Bonjour {doc['employee_name']},</p>"
        f"<p>Votre licence professionnelle <strong>{doc['license_number']}</strong> "
        f"expire le <strong>{doc['expiry_date']}</strong> — dans <strong>{days} jour(s)</strong>.</p>"
        "<p>Veuillez entamer votre démarche de renouvellement dès maintenant et transmettre "
        "votre nouveau certificat à votre gestionnaire.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Rappel automatique envoyé par Arrière Plan "
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
    scheduler.add_job(appointment_reminders_job, CronTrigger(hour=8, minute=0))
    scheduler.add_job(training_reminders_job, CronTrigger(hour=8, minute=45))
    scheduler.add_job(evaluation_reminders_job, CronTrigger(hour=9, minute=0))
    scheduler.add_job(shift_task_reminders_job, CronTrigger(hour=12, minute=0), args=["Matin"])
    scheduler.add_job(shift_task_reminders_job, CronTrigger(hour=17, minute=0), args=["Après-midi"])
    scheduler.add_job(shift_task_reminders_job, CronTrigger(hour=21, minute=30), args=["Soir"])
    scheduler.add_job(weekly_task_report_job, CronTrigger(day_of_week="mon", hour=7, minute=0))
    scheduler.start()


# ==================== Demandes de démo (public) ====================

class DemoRequestIn(BaseModel):
    name: str
    pharmacy: str = ""
    email: str
    phone: str = ""
    message: str = ""


@api_router.post("/demo-requests")
async def create_demo_request(payload: DemoRequestIn, request: Request):
    name = payload.name.strip()
    email = payload.email.strip().lower()
    if not name or not email or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Nom et courriel valide requis.")
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "inconnu")
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = await db.demo_requests.count_documents({"ip": ip, "created_at": {"$gte": since}})
    if recent >= 5:
        raise HTTPException(status_code=429, detail="Trop de demandes envoyées. Réessayez dans une heure.")
    doc = {
        "id": str(uuid.uuid4()), "name": name, "pharmacy": payload.pharmacy.strip(),
        "email": email, "phone": payload.phone.strip(), "message": payload.message.strip()[:2000],
        "ip": ip, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.demo_requests.insert_one({**doc})
    notify_to = os.environ.get("DEMO_NOTIFY_EMAIL", "")
    sent = False
    if os.environ.get("RESEND_API_KEY", "") and notify_to:
        rows = "".join(
            f"<tr><td style='padding:6px 12px;color:#64748b'>{label}</td><td style='padding:6px 12px;font-weight:bold'>{value or '—'}</td></tr>"
            for label, value in [("Nom", doc["name"]), ("Pharmacie", doc["pharmacy"]),
                                 ("Courriel", doc["email"]), ("Téléphone", doc["phone"]),
                                 ("Message", doc["message"])]
        )
        html = (
            "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
            "<h2 style='color:#059669'>Arrière Plan — Nouvelle demande de démo</h2>"
            f"<table style='border-collapse:collapse;background:#f8fafc;border-radius:8px'>{rows}</table>"
            "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Demande envoyée depuis la page d'accueil.</p>"
            "</div>"
        )
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": await get_sender(),
                "to": [notify_to],
                "subject": f"Demande de démo — {name}" + (f" ({doc['pharmacy']})" if doc["pharmacy"] else ""),
                "html": html,
            })
            sent = True
        except Exception as e:
            logger.warning(f"Envoi du courriel de demande de démo échoué : {e}")
    await log_audit("public", "visiteur", "DEMANDE_DEMO", "demo", doc["id"],
                    f"Demande de démo de {name} <{email}>", "")
    return {"ok": True, "email_sent": sent}


DEMO_STATUSES = ("nouvelle", "contactee", "planifiee", "convertie")


class DemoStatusIn(BaseModel):
    status: str


@api_router.get("/demo-requests")
async def list_demo_requests(su: dict = Depends(require_superadmin)):
    docs = await db.demo_requests.find({}, {"_id": 0, "ip": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        d.setdefault("status", "nouvelle")
    return docs


@api_router.put("/demo-requests/{req_id}/status")
async def update_demo_request_status(req_id: str, payload: DemoStatusIn, su: dict = Depends(require_superadmin)):
    if payload.status not in DEMO_STATUSES:
        raise HTTPException(status_code=400, detail="Statut invalide.")
    res = await db.demo_requests.update_one({"id": req_id}, {"$set": {"status": payload.status}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    await log_audit(su["email"], su["role"], "MODIF_STATUT_DEMO", "demo", req_id,
                    f"Statut de la demande de démo : {payload.status}", "")
    return {"ok": True, "status": payload.status}


@api_router.delete("/demo-requests/{req_id}")
async def delete_demo_request(req_id: str, su: dict = Depends(require_superadmin)):
    res = await db.demo_requests.delete_one({"id": req_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    await log_audit(su["email"], su["role"], "SUPPRESSION_DEMO", "demo", req_id,
                    "Demande de démo supprimée", "")
    return {"ok": True}


# ==================== Loi 25 — Journal des connexions, Incidents, Export de données ====================

@api_router.get("/superadmin/login-events")
async def list_login_events(su: dict = Depends(require_superadmin)):
    docs = await db.login_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


INCIDENT_STATUSES = ("nouveau", "en_cours", "notifie", "clos")
INCIDENT_SEVERITIES = ("faible", "moyen", "eleve", "critique")


class IncidentIn(BaseModel):
    title: str
    description: str = ""
    discovered_at: str = ""
    severity: str = "moyen"
    affected_count: int = 0
    measures: str = ""
    cai_notified: bool = False
    persons_notified: bool = False
    status: str = "nouveau"


@api_router.get("/incidents")
async def list_incidents(su: dict = Depends(require_superadmin)):
    return await db.incidents.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/incidents")
async def create_incident(payload: IncidentIn, su: dict = Depends(require_superadmin)):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Le titre est requis.")
    if payload.severity not in INCIDENT_SEVERITIES:
        raise HTTPException(status_code=400, detail="Gravité invalide.")
    if payload.status not in INCIDENT_STATUSES:
        raise HTTPException(status_code=400, detail="Statut invalide.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "title": payload.title.strip(), "description": payload.description.strip(),
        "discovered_at": payload.discovered_at, "severity": payload.severity,
        "affected_count": max(0, payload.affected_count), "measures": payload.measures.strip(),
        "cai_notified": payload.cai_notified, "persons_notified": payload.persons_notified,
        "status": payload.status, "created_by": su["email"], "created_at": now, "updated_at": now,
    }
    await db.incidents.insert_one({**doc})
    await log_audit(su["email"], su["role"], "CREATION_INCIDENT", "incident", doc["id"],
                    f"Incident de confidentialité : {doc['title']}", "")
    return doc


@api_router.put("/incidents/{incident_id}")
async def update_incident(incident_id: str, payload: IncidentIn, su: dict = Depends(require_superadmin)):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Le titre est requis.")
    if payload.severity not in INCIDENT_SEVERITIES or payload.status not in INCIDENT_STATUSES:
        raise HTTPException(status_code=400, detail="Gravité ou statut invalide.")
    patch = {
        "title": payload.title.strip(), "description": payload.description.strip(),
        "discovered_at": payload.discovered_at, "severity": payload.severity,
        "affected_count": max(0, payload.affected_count), "measures": payload.measures.strip(),
        "cai_notified": payload.cai_notified, "persons_notified": payload.persons_notified,
        "status": payload.status, "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.incidents.update_one({"id": incident_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Incident introuvable.")
    await log_audit(su["email"], su["role"], "MODIFICATION_INCIDENT", "incident", incident_id,
                    f"Incident mis à jour : {patch['title']} ({patch['status']})", "")
    return {"ok": True}


@api_router.delete("/incidents/{incident_id}")
async def delete_incident(incident_id: str, su: dict = Depends(require_superadmin)):
    res = await db.incidents.delete_one({"id": incident_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Incident introuvable.")
    await log_audit(su["email"], su["role"], "SUPPRESSION_INCIDENT", "incident", incident_id,
                    "Incident supprimé du registre", "")
    return {"ok": True}


@api_router.get("/me/data-export")
async def my_data_export(user: dict = Depends(get_current_user)):
    export = {
        "genere_le": datetime.now(timezone.utc).isoformat(),
        "avis": "Copie de vos renseignements personnels détenus par Arrière Plan (droit d'accès — Loi 25).",
        "compte": user_public(user),
        "profil": None,
        "pointages": [],
    }
    if user.get("employee_id") and user.get("pharmacy_id"):
        prof = await db.employee_profiles.find_one(
            {"pharmacy_id": user["pharmacy_id"], "employee_id": user["employee_id"]}, {"_id": 0})
        if prof:
            export["profil"] = sanitize_profile(prof)
        punches = await db.punches.find(
            {"pharmacy_id": user["pharmacy_id"], "employee_id": user["employee_id"]},
            {"_id": 0}).sort("punch_in", -1).to_list(2000)
        export["pointages"] = punches
    await log_audit(user["email"], user["role"], "EXPORT_DONNEES_PERSONNELLES", "utilisateur", user["id"],
                    "Export de ses propres données (droit d'accès Loi 25)", user.get("pharmacy_id") or "")
    return export


app.include_router(api_router)

_cors_origins = os.environ.get('CORS_ORIGINS', '').strip()
if _cors_origins and _cors_origins != '*':
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=[o.strip() for o in _cors_origins.split(',') if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origin_regex=r"https://[a-z0-9-]+\.(preview\.)?emergentagent\.com",
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

