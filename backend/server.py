from fastapi import FastAPI, APIRouter, File, UploadFile, Form, Header, HTTPException, Query, Depends, Request
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
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
import base64
import resend
import bcrypt
import jwt
import pyotp
import qrcode
from typing import Optional
from pathlib import Path
from pydantic import BaseModel, Field
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
        "privacy_accepted_at": doc.get("privacy_accepted_at"),
        "mfa_enabled": doc.get("mfa_enabled", False),
        "module_overrides": doc.get("module_overrides", {}),
        "report_favorites": doc.get("report_favorites", []),
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
    if user.get("role") != "superadmin":
        trial_err = await pharmacy_access_error(user.get("pharmacy_id") or "")
        if trial_err:
            raise HTTPException(status_code=403, detail=trial_err)
    if user.get("is_temporary_password") and request.url.path not in (
            "/api/auth/change-password", "/api/auth/me"):
        raise HTTPException(status_code=403,
                            detail="Vous devez d'abord remplacer votre mot de passe temporaire.",
                            headers={"X-Password-Change-Required": "1"})
    pol = await get_security_settings(user.get("pharmacy_id") or "")
    path = request.url.path
    if password_is_expired(user, pol) and path not in ("/api/auth/change-password", "/api/auth/me"):
        raise HTTPException(status_code=403,
                            detail="Votre mot de passe a expiré selon la politique de sécurité de votre pharmacie. Veuillez le renouveler.",
                            headers={"X-Password-Change-Required": "1"})
    if pol.get("mfa_required") and not user.get("mfa_enabled") and path not in (
            "/api/auth/me", "/api/auth/mfa/setup", "/api/auth/mfa/enable", "/api/auth/change-password",
            "/api/security-settings"):
        raise HTTPException(status_code=403,
                            detail="Votre pharmacie exige la vérification en 2 étapes (MFA). Activez-la pour continuer.",
                            headers={"X-Mfa-Setup-Required": "1"})
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
    if user.get("role") != "superadmin":
        trial_err = await pharmacy_access_error(user.get("pharmacy_id") or "")
        if trial_err:
            raise HTTPException(status_code=403, detail=trial_err)
    await db.login_attempts.delete_one({"identifier": identifier})
    if user.get("mfa_enabled"):
        mfa_token = jwt.encode({"sub": user["id"],
                                "exp": datetime.now(timezone.utc) + timedelta(minutes=5), "type": "mfa"},
                               get_jwt_secret(), algorithm=JWT_ALGORITHM)
        return {"mfa_required": True, "mfa_token": mfa_token}
    suspicious = await is_new_ip_login(user["id"], client_ip(request))
    await record_login_event(user, "CONNEXION", request, flagged_new_ip=suspicious)
    if suspicious:
        asyncio.create_task(alert_suspicious_login(user, client_ip(request), request))
    return {"access_token": create_access_token(user), "user": {**user_public(user), **(await auth_flags(user))}}


class MfaCodeIn(BaseModel):
    code: str


_pharmacy_access_cache: dict = {}


async def pharmacy_access_error(pid: str) -> Optional[str]:
    """Retourne un message de blocage si la pharmacie est suspendue ou si son essai gratuit est expiré."""
    if not pid:
        return None
    now = datetime.now(timezone.utc)
    cached = _pharmacy_access_cache.get(pid)
    if cached and (now.timestamp() - cached[1]) < 60:
        doc = cached[0]
    else:
        doc = await db.pharmacies.find_one({"id": pid}, {"_id": 0, "active": 1, "plan_status": 1, "trial_ends_at": 1})
        _pharmacy_access_cache[pid] = (doc, now.timestamp())
    if not doc:
        return None
    if doc.get("active") is False:
        return "L'accès de votre pharmacie est suspendu. Contactez-nous à info@arriereplanrh.com."
    if doc.get("plan_status") == "trial":
        ends = doc.get("trial_ends_at") or ""
        try:
            if ends and datetime.fromisoformat(ends) < now:
                return ("Votre essai gratuit de 30 jours est terminé. "
                        "Contactez-nous à info@arriereplanrh.com pour activer votre accès complet.")
        except ValueError:
            return None
    return None


class TrialSignupIn(BaseModel):
    pharmacy_name: str
    name: str
    email: str
    password: str


async def send_trial_welcome_email(name: str, email: str, pharmacy_name: str, trial_ends_at: str) -> None:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        return
    resend.api_key = api_key
    end_date = trial_ends_at[:10]
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": await get_sender(), "to": [email],
            "subject": "Votre essai gratuit de 30 jours est actif — Arrière Plan",
            "html": (
                "<div style='font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a'>"
                "<h2 style='color:#059669'>Bienvenue sur Arrière Plan !</h2>"
                f"<p>Bonjour {name},</p>"
                f"<p>Votre espace « <b>{pharmacy_name}</b> » est prêt. Vous profitez de <b>toutes les fonctionnalités "
                f"gratuitement jusqu'au {end_date}</b> : horaires IA, punch, paie, tâches, congés, formations et plus.</p>"
                f"<p>Connectez-vous sur <a href='{APP_PUBLIC_URL}' style='color:#059669'><b>{APP_PUBLIC_URL.replace('https://', '')}</b></a> "
                "avec le courriel et le mot de passe que vous venez de choisir.</p>"
                "<p>Des questions ? Écrivez-nous à info@arriereplanrh.com — nous vous accompagnons dans la mise en place.</p>"
                "<p style='font-size:12px;color:#94a3b8;margin-top:20px'>À la fin de l'essai, contactez-nous pour activer votre accès complet.</p></div>"
            )})
    except Exception as exc:
        logger.warning(f"Courriel d'essai non envoyé à {email} : {exc}")


@api_router.post("/auth/signup-trial")
async def auth_signup_trial(payload: TrialSignupIn, request: Request):
    email = payload.email.strip().lower()
    pharmacy_name = payload.pharmacy_name.strip()
    full_name = payload.name.strip()
    if len(pharmacy_name) < 2:
        raise HTTPException(status_code=400, detail="Le nom de votre pharmacie est requis.")
    if not full_name:
        raise HTTPException(status_code=400, detail="Votre nom complet est requis.")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Courriel invalide.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel. Utilisez « Mot de passe oublié » pour le récupérer.")
    ip = client_ip(request)
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    if await db.signup_events.count_documents({"ip": ip, "created_at": {"$gte": since}}) >= 3:
        raise HTTPException(status_code=429, detail="Trop d'inscriptions depuis cette adresse. Réessayez dans une heure ou contactez info@arriereplanrh.com.")
    err = await validate_password_strength(payload.password.strip(), "")
    if err:
        raise HTTPException(status_code=400, detail=err)
    now = datetime.now(timezone.utc)
    await db.signup_events.insert_one({"ip": ip, "email": email, "created_at": now.isoformat()})
    trial_ends_at = (now + timedelta(days=30)).isoformat()
    pid = "ph_" + uuid.uuid4().hex[:8]
    await db.pharmacies.insert_one({
        "id": pid, "name": pharmacy_name[:120], "address": "", "city": "",
        "owner_name": full_name[:120], "admin_email": email, "plan": "Essai gratuit",
        "active": True, "plan_status": "trial", "trial_ends_at": trial_ends_at,
        "onboarding_pending": True, "created_at": now.isoformat()})
    doc = {"id": str(uuid.uuid4()), "email": email, "password_hash": hash_password(payload.password.strip()),
           "name": full_name[:120], "role": "admin", "pharmacy_id": pid, "employee_id": None,
           "suspended": False, "created_at": now.isoformat()}
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    await log_audit(email, "admin", "INSCRIPTION_ESSAI", "pharmacie", pid,
                    f"Essai gratuit 30 jours démarré pour « {pharmacy_name} »", pid)
    await record_login_event(doc, "CONNEXION", request)
    asyncio.create_task(send_trial_welcome_email(full_name, email, pharmacy_name, trial_ends_at))
    return {"access_token": create_access_token(doc),
            "user": {**user_public(doc), **(await auth_flags(doc)), "onboarding_pending": True},
            "trial_ends_at": trial_ends_at}


class OnboardingIn(BaseModel):
    address: str = ""
    city: str = ""
    employee_count: str = ""
    opening_hours: str = ""
    skipped: bool = False


@api_router.post("/onboarding")
async def complete_onboarding(payload: OnboardingIn, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin" or not user.get("pharmacy_id"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs de pharmacie.")
    pid = user["pharmacy_id"]
    patch: dict = {"onboarding_pending": False}
    if not payload.skipped:
        if payload.address.strip():
            patch["address"] = payload.address.strip()[:200]
        if payload.city.strip():
            patch["city"] = payload.city.strip()[:80]
        if payload.employee_count.strip():
            patch["employee_count_estimate"] = payload.employee_count.strip()[:40]
        if payload.opening_hours.strip():
            patch["opening_hours"] = payload.opening_hours.strip()[:200]
    await db.pharmacies.update_one({"id": pid}, {"$set": patch})
    await log_audit(user["email"], user["role"], "CONFIGURATION_INITIALE", "pharmacie", pid,
                    "Configuration initiale reportée" if payload.skipped else "Configuration initiale complétée", pid)
    return {"ok": True}


class MfaVerifyIn(BaseModel):
    mfa_token: str
    code: str


def _totp_valid(secret: str, code: str) -> bool:
    try:
        return pyotp.TOTP(secret).verify(code.strip().replace(" ", ""), valid_window=1)
    except Exception:
        return False


@api_router.post("/auth/mfa/setup")
async def mfa_setup(user: dict = Depends(get_current_user)):
    secret = pyotp.random_base32()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name="Arrière Plan")
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    enc = get_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")
    await db.users.update_one({"id": user["id"]}, {"$set": {"mfa_secret_pending": enc}})
    return {"secret": secret, "otpauth_uri": uri, "qr_base64": qr_b64}


@api_router.post("/auth/mfa/enable")
async def mfa_enable(payload: MfaCodeIn, user: dict = Depends(get_current_user)):
    enc = user.get("mfa_secret_pending")
    if not enc:
        raise HTTPException(status_code=400, detail="Aucune configuration MFA en cours — relancez l'activation.")
    secret = get_fernet().decrypt(enc.encode("utf-8")).decode("utf-8")
    if not _totp_valid(secret, payload.code):
        raise HTTPException(status_code=400, detail="Code invalide — vérifiez votre application d'authentification.")
    await db.users.update_one({"id": user["id"]}, {
        "$set": {"mfa_enabled": True, "mfa_secret": enc}, "$unset": {"mfa_secret_pending": ""}})
    await log_audit(user["email"], user["role"], "MFA_ACTIVEE", "utilisateur", user["id"],
                    "Vérification en 2 étapes activée", user.get("pharmacy_id") or "")
    return {"ok": True, "mfa_enabled": True}


@api_router.post("/auth/mfa/disable")
async def mfa_disable(payload: MfaCodeIn, user: dict = Depends(get_current_user)):
    enc = user.get("mfa_secret")
    if not user.get("mfa_enabled") or not enc:
        raise HTTPException(status_code=400, detail="La vérification en 2 étapes n'est pas activée.")
    secret = get_fernet().decrypt(enc.encode("utf-8")).decode("utf-8")
    if not _totp_valid(secret, payload.code):
        raise HTTPException(status_code=400, detail="Code invalide.")
    await db.users.update_one({"id": user["id"]}, {
        "$set": {"mfa_enabled": False}, "$unset": {"mfa_secret": "", "mfa_secret_pending": ""}})
    await log_audit(user["email"], user["role"], "MFA_DESACTIVEE", "utilisateur", user["id"],
                    "Vérification en 2 étapes désactivée", user.get("pharmacy_id") or "")
    return {"ok": True, "mfa_enabled": False}


@api_router.post("/auth/mfa/verify")
async def mfa_verify(payload: MfaVerifyIn, request: Request):
    try:
        decoded = jwt.decode(payload.mfa_token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if decoded.get("type") != "mfa":
            raise HTTPException(status_code=401, detail="Jeton invalide.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Délai expiré — reconnectez-vous.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Jeton invalide.")
    user = await db.users.find_one({"id": decoded["sub"]}, {"_id": 0})
    if not user or not user.get("mfa_enabled") or not user.get("mfa_secret"):
        raise HTTPException(status_code=401, detail="Utilisateur introuvable.")
    secret = get_fernet().decrypt(user["mfa_secret"].encode("utf-8")).decode("utf-8")
    if not _totp_valid(secret, payload.code):
        raise HTTPException(status_code=401, detail="Code invalide — réessayez.")
    suspicious = await is_new_ip_login(user["id"], client_ip(request))
    await record_login_event(user, "CONNEXION", request, flagged_new_ip=suspicious)
    if suspicious:
        asyncio.create_task(alert_suspicious_login(user, client_ip(request), request))
    return {"access_token": create_access_token(user), "user": {**user_public(user), **(await auth_flags(user))}}


TRUSTED_PROXY_HOPS = max(1, int(os.environ.get("TRUSTED_PROXY_HOPS", "1")))


def client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip", "").strip()
    if cf:
        return cf
    fwd = request.headers.get("x-forwarded-for", "")
    if not fwd:
        return request.client.host if request.client else "inconnu"
    ips = [p.strip() for p in fwd.split(",") if p.strip()]
    if not ips:
        return request.client.host if request.client else "inconnu"
    return ips[-min(TRUSTED_PROXY_HOPS, len(ips))]


async def is_new_ip_login(user_id: str, ip: str) -> bool:
    prior = await db.login_events.count_documents({"user_id": user_id, "event": "CONNEXION"})
    if prior == 0:
        return False
    seen = await db.login_events.find_one({"user_id": user_id, "event": "CONNEXION", "ip": ip})
    return seen is None


async def alert_suspicious_login(user: dict, ip: str, request: Request):
    if not os.environ.get("RESEND_API_KEY", ""):
        return
    supers = await db.users.find({"role": "superadmin", "suspended": {"$ne": True}}, {"_id": 0, "email": 1}).to_list(20)
    recipients = [s["email"] for s in supers]
    notify = os.environ.get("DEMO_NOTIFY_EMAIL", "")
    if notify and notify not in recipients:
        recipients.append(notify)
    if not recipients:
        return
    when = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).strftime("%Y-%m-%d %H:%M")
    ua = request.headers.get("user-agent", "inconnu")[:200]
    html = (
        "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#b45309'>⚠️ Connexion depuis une adresse inhabituelle</h2>"
        f"<p>Une connexion au compte <b>{user['email']}</b> ({user.get('role','')}) a été détectée "
        "depuis une adresse IP jamais utilisée auparavant.</p>"
        f"<table style='background:#f8fafc;border-radius:8px'>"
        f"<tr><td style='padding:6px 12px;color:#64748b'>Utilisateur</td><td style='padding:6px 12px;font-weight:bold'>{user.get('name','')} &lt;{user['email']}&gt;</td></tr>"
        f"<tr><td style='padding:6px 12px;color:#64748b'>Adresse IP</td><td style='padding:6px 12px;font-weight:bold'>{ip}</td></tr>"
        f"<tr><td style='padding:6px 12px;color:#64748b'>Date/heure</td><td style='padding:6px 12px'>{when} (Montréal)</td></tr>"
        f"<tr><td style='padding:6px 12px;color:#64748b'>Appareil</td><td style='padding:6px 12px'>{ua}</td></tr>"
        "</table>"
        "<p style='font-size:13px;color:#64748b;margin-top:16px'>Si cette connexion est légitime, ignorez ce message. "
        "Sinon, réinitialisez le mot de passe de ce compte depuis le tableau de bord superadmin.</p>"
        "<p style='font-size:12px;color:#94a3b8'>Journal des connexions — Arrière Plan</p></div>"
    )
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": await get_sender(), "to": recipients,
            "subject": f"⚠️ Connexion inhabituelle — {user['email']}", "html": html,
        })
    except Exception as e:
        logger.warning(f"Alerte connexion inhabituelle non envoyée : {e}")


async def record_login_event(user: dict, event: str, request: Request, flagged_new_ip: bool = False):
    await db.login_events.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user["role"],
        "event": event,
        "ip": client_ip(request),
        "user_agent": request.headers.get("user-agent", "")[:300],
        "flagged_new_ip": flagged_new_ip,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


@api_router.post("/auth/accept-privacy")
async def auth_accept_privacy(user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": user["id"]}, {"$set": {"privacy_accepted_at": now}})
    await log_audit(user["email"], user["role"], "ACCEPTATION_POLITIQUE_CONFIDENTIALITE", "utilisateur", user["id"],
                    "Politique de confidentialité acceptée", user.get("pharmacy_id") or "")
    return {"privacy_accepted_at": now}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    out = {**user_public(user), **(await auth_flags(user))}
    if user.get("role") != "superadmin" and user.get("pharmacy_id"):
        ph = await db.pharmacies.find_one({"id": user["pharmacy_id"]},
                                          {"_id": 0, "plan_status": 1, "trial_ends_at": 1, "onboarding_pending": 1})
        if ph and ph.get("onboarding_pending") and user.get("role") == "admin":
            out["onboarding_pending"] = True
        if ph and ph.get("plan_status") == "trial" and ph.get("trial_ends_at"):
            try:
                secs = (datetime.fromisoformat(ph["trial_ends_at"]) - datetime.now(timezone.utc)).total_seconds()
                out["trial_ends_at"] = ph["trial_ends_at"]
                out["trial_days_left"] = max(0, math.ceil(secs / 86400))
            except ValueError:
                pass
    return out


DEFAULT_SECURITY_SETTINGS = {
    "mfa_required": False,
    "pw_min_length": 10,
    "pw_require_upper": True,
    "pw_require_lower": True,
    "pw_require_digit": True,
    "pw_require_special": False,
    "pw_expiry_days": 0,
}
_SPECIAL_CHARS = set("!@#$%^&*()-_=+[]{};:,.<>?/\\|~'\"`")
_security_cache: dict = {}


async def get_security_settings(pharmacy_id: str) -> dict:
    if not pharmacy_id:
        return dict(DEFAULT_SECURITY_SETTINGS)
    cached = _security_cache.get(pharmacy_id)
    now_ts = datetime.now(timezone.utc).timestamp()
    if cached and now_ts - cached[0] < 60:
        return cached[1]
    doc = await db.security_settings.find_one({"pharmacy_id": pharmacy_id}, {"_id": 0}) or {}
    settings = {**DEFAULT_SECURITY_SETTINGS, **{k: v for k, v in doc.items() if k in DEFAULT_SECURITY_SETTINGS}}
    _security_cache[pharmacy_id] = (now_ts, settings)
    return settings


async def validate_password_strength(pw: str, pharmacy_id: str = "") -> Optional[str]:
    pol = await get_security_settings(pharmacy_id)
    min_len = max(8, min(64, int(pol.get("pw_min_length") or 10)))
    if len(pw) < min_len:
        return f"Le mot de passe doit contenir au moins {min_len} caractères."
    if pol.get("pw_require_upper") and not any(c.isupper() for c in pw):
        return "Le mot de passe doit contenir au moins une majuscule."
    if pol.get("pw_require_lower") and not any(c.islower() for c in pw):
        return "Le mot de passe doit contenir au moins une minuscule."
    if pol.get("pw_require_digit") and not any(c.isdigit() for c in pw):
        return "Le mot de passe doit contenir au moins un chiffre."
    if pol.get("pw_require_special") and not any(c in _SPECIAL_CHARS for c in pw):
        return "Le mot de passe doit contenir au moins un caractère spécial (!, @, #, $…)."
    return None


def password_is_expired(user: dict, pol: dict) -> bool:
    days = int(pol.get("pw_expiry_days") or 0)
    if days <= 0:
        return False
    changed = user.get("password_changed_at")
    if not changed:
        return False
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(changed) > timedelta(days=days)
    except ValueError:
        return False


async def auth_flags(user: dict) -> dict:
    pol = await get_security_settings(user.get("pharmacy_id") or "")
    return {
        "password_expired": password_is_expired(user, pol),
        "mfa_setup_required": bool(pol.get("mfa_required")) and not user.get("mfa_enabled", False),
    }


@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordIn, request: Request, user: dict = Depends(get_current_user)):
    current_password = payload.current_password.strip()
    new_password = payload.new_password.strip()
    if not verify_password(current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect.")
    err = await validate_password_strength(new_password, user.get("pharmacy_id") or "")
    if err:
        raise HTTPException(status_code=400, detail=err)
    if new_password == current_password:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit être différent de l'actuel.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(new_password), "is_temporary_password": False,
                  "password_changed_at": datetime.now(timezone.utc).isoformat()}},
    )
    await log_audit(user["email"], user["role"], "CHANGEMENT_MOT_DE_PASSE", "utilisateur", user["id"],
                    "Mot de passe modifié par l'utilisateur", user.get("pharmacy_id") or "")
    await record_login_event(user, "CHANGEMENT_MOT_DE_PASSE", request)
    return {"status": "modifié"}


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    email: str
    code: str
    new_password: str


def hash_reset_code(code: str) -> str:
    pepper = os.environ["PUNCH_PEPPER"]
    return hashlib.sha256(f"reset:{pepper}:{code}".encode("utf-8")).hexdigest()


def reset_email_html(name: str, email: str, code: str) -> str:
    return (
        "<div style='font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Récupération de votre compte</h2>"
        f"<p>Bonjour {name},</p>"
        "<p>Une demande de réinitialisation de mot de passe a été faite pour votre compte.</p>"
        f"<p style='background:#f8fafc;border-radius:8px;padding:10px 14px'>Votre identifiant de connexion : <b>{email}</b></p>"
        "<p>Votre code de vérification (valide 15 minutes) :</p>"
        f"<p style='font-size:32px;letter-spacing:8px;font-weight:bold;color:#b45309;background:#fdf6ef;border-radius:8px;padding:14px;text-align:center'>{code}</p>"
        "<p style='font-size:13px;color:#64748b'>Entrez ce code dans la fenêtre « Identifiants oubliés » de la page de connexion, puis choisissez votre nouveau mot de passe.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:20px'>Si vous n'êtes pas à l'origine de cette demande, ignorez ce courriel — votre mot de passe reste inchangé.</p></div>"
    )


APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "https://arriereplanrh.com")


def welcome_email_html(name: str, email: str, temp_password: str, reset: bool = False) -> str:
    intro = ("Votre mot de passe a été réinitialisé par un administrateur de la plateforme."
             if reset else "Votre compte Arrière Plan vient d'être créé.")
    return (
        "<div style='font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a'>"
        f"<h2 style='color:#059669'>{'Arrière Plan — Nouveau mot de passe' if reset else 'Bienvenue sur Arrière Plan'}</h2>"
        f"<p>Bonjour {name or ''},</p>"
        f"<p>{intro} Voici vos informations de connexion :</p>"
        "<table style='background:#f8fafc;border-radius:8px;width:100%;border-collapse:collapse'>"
        f"<tr><td style='padding:10px 14px;color:#64748b'>Identifiant</td><td style='padding:10px 14px'><b>{email}</b></td></tr>"
        f"<tr><td style='padding:10px 14px;color:#64748b'>Mot de passe temporaire</td>"
        f"<td style='padding:10px 14px;font-family:monospace;font-size:16px'><b>{temp_password}</b></td></tr></table>"
        f"<p>Connectez-vous sur <a href='{APP_PUBLIC_URL}' style='color:#059669'><b>{APP_PUBLIC_URL.replace('https://', '')}</b></a> — "
        "vous devrez choisir votre propre mot de passe à la première connexion.</p>"
        "<p style='font-size:12px;color:#94a3b8;margin-top:20px'>Si vous n'êtes pas à l'origine de cette demande, "
        "contactez-nous à info@arriereplanrh.com.</p></div>"
    )


async def send_credentials_email(name: str, email: str, temp_password: str, reset: bool = False) -> bool:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        return False
    resend.api_key = api_key
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": await get_sender(), "to": [email],
            "subject": "Votre nouveau mot de passe temporaire — Arrière Plan" if reset else "Vos accès Arrière Plan — Bienvenue !",
            "html": welcome_email_html(name, email, temp_password, reset)})
        return True
    except Exception as exc:
        logger.warning(f"Courriel d'accès non envoyé à {email} : {exc}")
        return False


@api_router.post("/auth/forgot-password")
async def auth_forgot_password(payload: ForgotPasswordIn, request: Request):
    email = payload.email.strip().lower()
    generic = {"ok": True,
               "message": "Si un compte existe pour ce courriel, un message avec votre identifiant et un code de vérification vient d'être envoyé."}
    if not email or "@" not in email:
        return generic
    ip = client_ip(request)
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=1)).isoformat()
    recent = await db.password_resets.count_documents(
        {"$or": [{"email": email}, {"ip": ip}], "created_at": {"$gte": since}})
    if recent >= 5:
        raise HTTPException(status_code=429, detail="Trop de demandes. Réessayez dans une heure.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or user.get("suspended"):
        await db.password_resets.insert_one({
            "id": str(uuid.uuid4()), "email": email, "ip": ip, "code_hash": None, "attempts": 0,
            "used": True, "expires_at": now.isoformat(), "created_at": now.isoformat()})
        return generic
    code = f"{secrets.randbelow(1000000):06d}"
    await db.password_resets.update_many({"email": email, "used": False}, {"$set": {"used": True}})
    await db.password_resets.insert_one({
        "id": str(uuid.uuid4()), "email": email, "ip": ip,
        "code_hash": hash_reset_code(code), "attempts": 0, "used": False,
        "expires_at": (now + timedelta(minutes=15)).isoformat(), "created_at": now.isoformat()})
    api_key = os.environ.get("RESEND_API_KEY", "")
    if api_key:
        resend.api_key = api_key
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": await get_sender(), "to": [email],
                "subject": "Votre code de vérification — Arrière Plan",
                "html": reset_email_html(user.get("name", ""), email, code)})
        except Exception as e:
            logger.warning(f"Courriel de réinitialisation non envoyé : {e}")
    await log_audit(email, user["role"], "DEMANDE_REINIT_MDP", "utilisateur", user["id"],
                    f"Demande de réinitialisation par courriel (IP {ip})", user.get("pharmacy_id") or "")
    return generic


@api_router.post("/auth/reset-password")
async def auth_reset_password(payload: ResetPasswordIn, request: Request):
    email = payload.email.strip().lower()
    code = payload.code.strip()
    new_password = payload.new_password.strip()
    invalid = HTTPException(status_code=400, detail="Code invalide ou expiré. Refaites une demande de code.")
    doc = await db.password_resets.find_one({"email": email, "used": False}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc or not doc.get("code_hash"):
        raise invalid
    if datetime.fromisoformat(doc["expires_at"]) < datetime.now(timezone.utc) or doc.get("attempts", 0) >= 5:
        raise invalid
    if hash_reset_code(code) != doc["code_hash"]:
        await db.password_resets.update_one({"id": doc["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Code de vérification incorrect.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise invalid
    err = await validate_password_strength(new_password, user.get("pharmacy_id") or "")
    if err:
        raise HTTPException(status_code=400, detail=err)
    await db.users.update_one({"email": email},
                              {"$set": {"password_hash": hash_password(new_password), "is_temporary_password": False,
                                        "password_changed_at": datetime.now(timezone.utc).isoformat()}})
    await db.password_resets.update_one({"id": doc["id"]}, {"$set": {"used": True}})
    await db.login_attempts.delete_one({"identifier": email})
    await log_audit(email, user["role"], "REINIT_MDP_COURRIEL", "utilisateur", user["id"],
                    "Mot de passe réinitialisé par vérification courriel", user.get("pharmacy_id") or "")
    await record_login_event(user, "CHANGEMENT_MOT_DE_PASSE", request)
    return {"ok": True}


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
    email: Optional[str] = None
    role: Optional[str] = None
    pharmacy_id: Optional[str] = None
    employee_id: Optional[str] = None
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
    pharmacy_id = (payload.pharmacy_id or "").strip()
    if payload.role != "superadmin":
        if not pharmacy_id:
            raise HTTPException(status_code=400, detail="Une pharmacie doit obligatoirement être assignée à ce compte (isolation des données).")
        if not await db.pharmacies.find_one({"id": pharmacy_id}):
            raise HTTPException(status_code=400, detail="Pharmacie introuvable. Créez-la d'abord dans le module Superadmin.")
    else:
        pharmacy_id = ""
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel.")
    temp = gen_temp_password()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(temp),
        "name": payload.name,
        "role": payload.role,
        "pharmacy_id": pharmacy_id or None,
        "employee_id": payload.employee_id,
        "is_temporary_password": True,
        "suspended": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    await log_audit(su["email"], su["role"], "CREATION_COMPTE", "utilisateur", doc["id"],
                    f"Compte {payload.role} créé pour {email}", payload.pharmacy_id or "")
    email_sent = await send_credentials_email(payload.name, email, temp)
    return {"user": user_public(doc), "temporary_password": temp, "email_sent": email_sent}


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
    if user_id == su["id"] and patch.get("role") and patch["role"] != "superadmin":
        raise HTTPException(status_code=400, detail="Impossible de retirer votre propre rôle superadmin.")
    if patch.get("email"):
        patch["email"] = patch["email"].strip().lower()
        if patch["email"] != target["email"] and await db.users.find_one({"email": patch["email"]}):
            raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel.")
    if patch.get("name") is not None:
        patch["name"] = patch["name"].strip()[:120]
        if not patch["name"]:
            raise HTTPException(status_code=400, detail="Le nom ne peut pas être vide.")
    if patch.get("pharmacy_id") and not await db.pharmacies.find_one({"id": patch["pharmacy_id"]}):
        raise HTTPException(status_code=400, detail="Pharmacie introuvable.")
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
    email_sent = await send_credentials_email(target.get("name", ""), target["email"], temp, reset=True)
    return {"temporary_password": temp, "email": target["email"], "email_sent": email_sent}


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


def scoped_pid(user: dict) -> str:
    """Cloisonnement strict : chaque compte n'accède qu'aux données de SA pharmacie.
    Superadmin sans pharmacie = espace plateforme isolé (aucune donnée client)."""
    pid = (user.get("pharmacy_id") or "").strip()
    if pid:
        return pid
    if user.get("role") == "superadmin":
        return "__plateforme__"
    raise HTTPException(status_code=403, detail="Aucune pharmacie associée à ce compte. Contactez votre administrateur.")


async def get_principal(request: Request, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès refusé : réservé aux administrateurs (Loi 25).")
    pid = (user.get("pharmacy_id") or "").strip()
    if user["role"] == "superadmin":
        hdr = (request.headers.get("X-Pharmacy-Id") or request.query_params.get("pharmacy_id") or "").strip()
        if hdr:
            exists = await db.pharmacies.find_one({"id": hdr}, {"_id": 1})
            if not exists:
                raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
            pid = hdr
    return {"email": user["email"], "role": user["role"], "pharmacy_id": pid}


def license_scope(principal: dict, pharmacy_id: Optional[str] = None) -> dict:
    if principal["role"] == "superadmin":
        return {"pharmacy_id": scoped_pid(principal)}
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


# ==================== Politique de sécurité (par pharmacie) ====================

class SecuritySettingsIn(BaseModel):
    mfa_required: bool = False
    pw_min_length: int = 10
    pw_require_upper: bool = True
    pw_require_lower: bool = True
    pw_require_digit: bool = True
    pw_require_special: bool = False
    pw_expiry_days: int = 0


@api_router.get("/security-settings")
async def get_security_settings_endpoint(user: dict = Depends(get_current_user)):
    return await get_security_settings(user.get("pharmacy_id") or "")


@api_router.put("/security-settings")
async def save_security_settings(payload: SecuritySettingsIn, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès refusé : réservé aux administrateurs (Loi 25).")
    pid = user.get("pharmacy_id") or ""
    if not pid:
        raise HTTPException(status_code=400, detail="Aucune pharmacie associée à ce compte.")
    if payload.mfa_required and not user.get("mfa_enabled"):
        raise HTTPException(status_code=400,
                            detail="Activez d'abord la vérification en 2 étapes sur votre propre compte avant de l'exiger pour toute l'équipe.")
    doc = payload.model_dump()
    doc["pw_min_length"] = max(8, min(64, doc["pw_min_length"]))
    doc["pw_expiry_days"] = max(0, min(730, doc["pw_expiry_days"]))
    await db.security_settings.update_one({"pharmacy_id": pid}, {"$set": doc}, upsert=True)
    _security_cache.pop(pid, None)
    if doc["pw_expiry_days"] > 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_many({"pharmacy_id": pid, "password_changed_at": {"$exists": False}},
                                   {"$set": {"password_changed_at": now_iso}})
    await log_audit(user["email"], user["role"], "MODIFICATION_POLITIQUE_SECURITE", "pharmacie", pid,
                    f"MFA obligatoire : {'oui' if doc['mfa_required'] else 'non'} · mdp min {doc['pw_min_length']} car. · expiration {doc['pw_expiry_days']} j", pid)
    return await get_security_settings(pid)


# ==================== Synchronisation calendrier personnel (ICS) ====================

@api_router.get("/my/calendar-feed")
async def my_calendar_feed(user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à ce compte.")
    token_val = user.get("calendar_token")
    if not token_val:
        token_val = secrets.token_urlsafe(24)
        await db.users.update_one({"id": user["id"]}, {"$set": {"calendar_token": token_val}})
    return {"token": token_val}


@api_router.post("/my/calendar-feed/reset")
async def reset_calendar_feed(user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à ce compte.")
    token_val = secrets.token_urlsafe(24)
    await db.users.update_one({"id": user["id"]}, {"$set": {"calendar_token": token_val}})
    await log_audit(user["email"], user["role"], "REGENERATION_LIEN_CALENDRIER", "utilisateur", user["id"],
                    "Lien de synchronisation calendrier régénéré", user.get("pharmacy_id") or "")
    return {"token": token_val}


def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


# ==================== Pharmacies clientes (collection serveur, superadmin) ====================

class PharmacyIn(BaseModel):
    name: str
    address: str = ""
    city: str = ""
    owner_name: str = ""
    admin_email: str = ""
    admin_name: str = ""
    plan: str = "Essentiel"


class PharmacyPatchIn(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    owner_name: Optional[str] = None
    admin_email: Optional[str] = None
    plan: Optional[str] = None
    active: Optional[bool] = None
    plan_status: Optional[str] = None
    trial_ends_at: Optional[str] = None


async def ensure_pharmacies_seeded() -> None:
    if not await db.pharmacies.find_one({"id": "ph1"}):
        await db.pharmacies.insert_one({
            "id": "ph1", "name": "Pharmacie Lavoie & Associés", "address": "1200 rue Sainte-Catherine",
            "city": "Montréal", "owner_name": "Dr. Sophie Lavoie", "admin_email": "admin@luminahr.ca",
            "plan": "Pro", "active": True, "created_at": datetime.now(timezone.utc).isoformat()})
    for pid in await db.users.distinct("pharmacy_id"):
        if not pid:
            continue
        if not await db.pharmacies.find_one({"id": pid}):
            await db.pharmacies.insert_one({
                "id": pid, "name": f"Pharmacie ({pid})", "address": "", "city": "", "owner_name": "",
                "admin_email": "", "plan": "Essentiel", "active": True,
                "created_at": datetime.now(timezone.utc).isoformat()})


@api_router.get("/superadmin/pharmacies")
async def sa_list_pharmacies(su: dict = Depends(require_superadmin)):
    docs = await db.pharmacies.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    counts: dict = {}
    async for row in db.users.aggregate([
            {"$match": {"pharmacy_id": {"$nin": [None, ""]}}},
            {"$group": {"_id": "$pharmacy_id", "n": {"$sum": 1}}}]):
        counts[row["_id"]] = row["n"]
    for d in docs:
        d["accounts_count"] = counts.get(d["id"], 0)
    return docs


@api_router.get("/superadmin/pharmacies/{pharmacy_id}")
async def sa_get_pharmacy(pharmacy_id: str, su: dict = Depends(require_superadmin)):
    doc = await db.pharmacies.find_one({"id": pharmacy_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
    accounts = await db.users.find({"pharmacy_id": pharmacy_id}, {"_id": 0, "password_hash": 0}).to_list(500)
    doc["accounts"] = [user_public({**a, "password_hash": ""}) for a in accounts]
    doc["accounts_count"] = len(accounts)
    return doc


@api_router.post("/superadmin/pharmacies")
async def sa_create_pharmacy(payload: PharmacyIn, su: dict = Depends(require_superadmin)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Le nom de la pharmacie est requis.")
    admin_name = payload.admin_name.strip()
    admin_email = payload.admin_email.strip().lower()
    if not admin_name or "@" not in admin_email or "." not in admin_email.split("@")[-1]:
        raise HTTPException(status_code=400,
                            detail="Un compte administrateur est obligatoire : indiquez le nom et un courriel valide.")
    if await db.users.find_one({"email": admin_email}):
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec ce courriel.")
    doc = {"id": "ph_" + uuid.uuid4().hex[:8], "name": name[:120],
           "address": payload.address.strip()[:200], "city": payload.city.strip()[:80],
           "owner_name": (payload.owner_name.strip() or admin_name)[:120], "admin_email": admin_email[:120],
           "plan": payload.plan if payload.plan in ("Essentiel", "Pro", "Entreprise") else "Essentiel",
           "active": True, "plan_status": "full", "created_at": datetime.now(timezone.utc).isoformat()}
    await db.pharmacies.insert_one(doc)
    doc.pop("_id", None)
    temp = gen_temp_password()
    user_doc = {
        "id": str(uuid.uuid4()), "email": admin_email, "password_hash": hash_password(temp),
        "name": admin_name[:120], "role": "admin", "pharmacy_id": doc["id"], "employee_id": None,
        "is_temporary_password": True, "suspended": False,
        "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(user_doc)
    await log_audit(su["email"], su["role"], "CREATION_PHARMACIE", "pharmacie", doc["id"],
                    f"Pharmacie cliente « {name} » créée avec le compte admin {admin_email}", doc["id"])
    email_sent = await send_credentials_email(admin_name, admin_email, temp)
    return {**doc, "accounts_count": 1, "admin_user": user_public(user_doc),
            "temporary_password": temp, "email_sent": email_sent}


@api_router.put("/superadmin/pharmacies/{pharmacy_id}")
async def sa_update_pharmacy(pharmacy_id: str, payload: PharmacyPatchIn, su: dict = Depends(require_superadmin)):
    doc = await db.pharmacies.find_one({"id": pharmacy_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "name" in patch and not patch["name"].strip():
        raise HTTPException(status_code=400, detail="Le nom ne peut pas être vide.")
    if "plan" in patch and patch["plan"] not in ("Essentiel", "Pro", "Entreprise", "Essai gratuit"):
        patch["plan"] = doc.get("plan", "Essentiel")
    if "plan_status" in patch and patch["plan_status"] not in ("trial", "full"):
        raise HTTPException(status_code=400, detail="Statut d'accès invalide (trial ou full).")
    if patch:
        await db.pharmacies.update_one({"id": pharmacy_id}, {"$set": patch})
        _pharmacy_access_cache.pop(pharmacy_id, None)
        await log_audit(su["email"], su["role"], "MODIF_PHARMACIE", "pharmacie", pharmacy_id,
                        f"Pharmacie « {doc['name']} » modifiée ({', '.join(patch.keys())})", pharmacy_id)
    return {**doc, **patch}


PHARMACY_SCOPED_COLLECTIONS = [
    "announcements", "appointments", "appointment_reminders", "audit_logs", "benefit_imports",
    "chat_attachments", "chat_messages", "contract_signatures", "conversation_reads", "conversations",
    "document_requests", "employee_profiles", "evaluations", "hr_custom_fields", "incidents", "kudos",
    "leave_balances", "leave_policies", "leave_requests", "licenses", "login_events", "notifications",
    "open_shifts", "pay_settings", "pharmacy_settings", "polls", "punch_settings", "punches",
    "replacement_offers", "replacement_requests", "report_schedules", "report_settings",
    "schedule_proposals", "schedule_publications", "schedule_settings", "schedule_templates",
    "schedule_views", "security_settings", "shift_tasks", "shifts", "sst_incidents", "task_goals",
    "time_bank_entries", "training_assignments", "training_attempts", "trainings", "work_stations",
    "agencies", "api_keys", "hr_states",
]


@api_router.delete("/superadmin/pharmacies/{pharmacy_id}")
async def sa_delete_pharmacy(pharmacy_id: str, su: dict = Depends(require_superadmin)):
    doc = await db.pharmacies.find_one({"id": pharmacy_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
    users = await db.users.find({"pharmacy_id": pharmacy_id}, {"_id": 0, "email": 1}).to_list(2000)
    emails = [u["email"] for u in users]
    res = await db.users.delete_many({"pharmacy_id": pharmacy_id, "role": {"$ne": "superadmin"}})
    if emails:
        await db.login_attempts.delete_many({"identifier": {"$in": emails}})
        await db.password_resets.delete_many({"email": {"$in": emails}})
    for coll in PHARMACY_SCOPED_COLLECTIONS:
        await db[coll].delete_many({"pharmacy_id": pharmacy_id})
    await db.pharmacies.delete_one({"id": pharmacy_id})
    _pharmacy_access_cache.pop(pharmacy_id, None)
    await log_audit(su["email"], su["role"], "SUPPRESSION_PHARMACIE", "pharmacie", pharmacy_id,
                    f"Pharmacie « {doc['name']} » supprimée définitivement avec {res.deleted_count} compte(s) et toutes ses données", pharmacy_id)
    return {"status": "supprimé", "accounts_deleted": res.deleted_count}


class EmailTestIn(BaseModel):
    to: str


@api_router.post("/superadmin/email-test")
async def sa_email_test(payload: EmailTestIn, su: dict = Depends(require_superadmin)):
    to = payload.to.strip().lower()
    if not to or "@" not in to:
        raise HTTPException(status_code=400, detail="Adresse courriel invalide.")
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="Clé API Resend manquante (RESEND_API_KEY dans backend/.env).")
    resend.api_key = api_key
    sender = await get_sender()
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": sender, "to": [to],
            "subject": "Courriel de test — Arrière Plan",
            "html": "<p>Ceci est un courriel de test envoyé depuis Arrière Plan. "
                    "Si vous le recevez, vos envois (réinitialisations de mot de passe, rapports, rappels) fonctionnent.</p>"})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Échec de l'envoi (expéditeur {sender}) : {exc}")
    return {"ok": True, "sender": sender, "recipient": to}


# ==================== Synchronisation de l'état RH entre appareils ====================

class HRStateIn(BaseModel):
    state: dict


@api_router.get("/hr-state")
async def get_hr_state(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.hr_states.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    return {"state": doc.get("state"), "updated_at": doc.get("updated_at"), "updated_by": doc.get("updated_by")}


EMPLOYEE_HR_STATE_KEYS = {"shiftSwaps", "benefits", "leaveRequests", "onboardingItems", "tasks"}

HR_STATE_GUARDED_KEYS = ["employees", "payrollEntries", "contracts", "benefits", "jobOffers",
                         "candidates", "leaveRequests", "branches", "pharmacies", "resources",
                         "faqItems", "onboardingItems", "performanceReviews", "replacementRequests",
                         "shiftSwaps", "tasks"]


@api_router.put("/hr-state")
async def save_hr_state(payload: HRStateIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    state = dict(payload.state or {})
    state.pop("shifts", None)
    existing = (await db.hr_states.find_one({"pharmacy_id": pid}, {"_id": 0, "state": 1}) or {}).get("state") or {}
    if user["role"] not in ("admin", "manager", "superadmin"):
        if existing:
            merged = dict(existing)
            for k in EMPLOYEE_HR_STATE_KEYS:
                if k in state:
                    merged[k] = state[k]
            state = merged
        else:
            state = {k: v for k, v in state.items() if k in EMPLOYEE_HR_STATE_KEYS}
    else:
        wiped = [k for k in HR_STATE_GUARDED_KEYS
                 if isinstance(existing.get(k), list) and len(existing[k]) >= 2
                 and len(state.get(k) or []) == 0]
        if len(wiped) >= 2:
            await log_audit(user["email"], user["role"], "SYNC_REFUSEE", "hr_state", pid,
                            f"Écriture refusée : listes vidées d'un coup ({', '.join(wiped)})", pid)
            raise HTTPException(status_code=409,
                                detail=f"Synchronisation refusée : l'état envoyé viderait plusieurs listes ({', '.join(wiped)}). "
                                       "L'état à jour du serveur sera rechargé.")
    if len(json.dumps(state, default=str)) > 6_000_000:
        raise HTTPException(status_code=413, detail="État trop volumineux pour la synchronisation.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.hr_states.update_one(
        {"pharmacy_id": pid},
        {"$set": {"state": state, "updated_at": now_iso, "updated_by": user["email"]}, "$inc": {"rev": 1}},
        upsert=True)
    return {"ok": True, "updated_at": now_iso}


def _ics_utc(date_s: str, time_s: str) -> str:
    local = datetime.fromisoformat(f"{date_s}T{time_s}:00").replace(tzinfo=MONTREAL_TZ)
    return local.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


@api_router.get("/calendar/{token}")
async def calendar_ics_feed(token: str):
    user = await db.users.find_one({"calendar_token": token}, {"_id": 0})
    if not user or not user.get("employee_id"):
        raise HTTPException(status_code=404, detail="Flux introuvable.")
    start = (date.today() - timedelta(days=30)).isoformat()
    end = (date.today() + timedelta(days=120)).isoformat()
    query = {"employee_id": user["employee_id"], "date": {"$gte": start, "$lte": end}}
    if user.get("pharmacy_id"):
        query["pharmacy_id"] = user["pharmacy_id"]
    shifts = await db.shifts.find(query, {"_id": 0}).to_list(2000)
    psettings = await db.pharmacy_settings.find_one({"pharmacy_id": user.get("pharmacy_id") or ""}, {"_id": 0, "address": 1}) or {}
    location = _ics_escape(psettings.get("address") or "Pharmacie")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Arriere Plan//Horaires//FR",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Mes quarts — Arrière Plan", "X-WR-TIMEZONE:America/Toronto",
    ]
    for s in shifts:
        try:
            dtstart = _ics_utc(s["date"], s["start"])
            dtend = _ics_utc(s["date"], s["end"])
        except (KeyError, ValueError):
            continue
        summary = f"Quart — {s.get('department') or 'Général'}"
        if s.get("station"):
            summary += f" ({s['station']})"
        if s.get("training"):
            summary += " · Formation"
        desc = f"Horaire {s.get('start', '')}–{s.get('end', '')}"
        if s.get("notes"):
            desc += f"\nNotes : {s['notes']}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:{s.get('id', '')}@arriereplan",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{dtstart}",
            f"DTEND:{dtend}",
            f"SUMMARY:{_ics_escape(summary)}",
            f"DESCRIPTION:{_ics_escape(desc)}",
            f"LOCATION:{location}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    ics = "\r\n".join(lines) + "\r\n"
    return Response(content=ics, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": "inline; filename=\"horaire-arriere-plan.ics\""})


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


PUBLIC_EMAIL_DOMAINS = {"gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.ca",
                        "icloud.com", "live.com", "live.ca", "hotmail.ca", "videotron.ca", "aol.com"}


@api_router.post("/email-settings")
async def save_email_settings(payload: EmailSettingsIn, su: dict = Depends(require_superadmin)):
    sender = payload.sender_email.strip().lower()
    if sender:
        domain = sender.split("@")[-1]
        if domain in PUBLIC_EMAIL_DOMAINS:
            raise HTTPException(status_code=400,
                                detail=f"Impossible d'envoyer depuis @{domain} : ce domaine appartient à un fournisseur public et "
                                       "ne peut pas être vérifié. Utilisez une adresse de VOTRE domaine vérifié sur Resend "
                                       "(ex. info@arriereplanrh.com).")
    doc = {"id": "global", "sender_email": sender,
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

    month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    today_iso = date.today().isoformat()

    async def _by_pharmacy(coll, match: Optional[dict] = None) -> dict:
        pipeline = ([{"$match": match}] if match else []) + [{"$group": {"_id": "$pharmacy_id", "n": {"$sum": 1}}}]
        return {(d["_id"] or "—"): d["n"] async for d in coll.aggregate(pipeline)}

    shifts_by = await _by_pharmacy(db.shifts)
    shifts_upcoming_by = await _by_pharmacy(db.shifts, {"date": {"$gte": today_iso}})
    punches_by = await _by_pharmacy(db.punches, {"punch_in": {"$gte": month_ago}})
    leave_pending_by = await _by_pharmacy(db.leave_requests, {"status": "En attente"})
    leave_approved_by = await _by_pharmacy(db.leave_requests, {"status": "Approuvée"})
    msgs_by = await _by_pharmacy(db.chat_messages, {"pharmacy_id": {"$exists": True}, "created_at": {"$gte": month_ago}})
    open_shifts_by = await _by_pharmacy(db.open_shifts, {"status": "open"})
    evals_by = await _by_pharmacy(db.evaluations)
    deliveries_by = await _by_pharmacy(db.deliveries)
    tasks_by = await _by_pharmacy(db.shift_tasks)
    benefits_by = await _by_pharmacy(db.benefits, {"status": "published"})
    audit_by = await _by_pharmacy(db.audit_logs, {"created_at": {"$gte": month_ago}})

    punch_hours_by: dict = {}
    async for p in db.punches.find({"punch_in": {"$gte": month_ago}, "punch_out": {"$ne": None}},
                                   {"_id": 0, "pharmacy_id": 1, "punch_in": 1, "punch_out": 1, "breaks": 1}):
        try:
            h = (datetime.fromisoformat(p["punch_out"]) - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600
            for br in (p.get("breaks") or []):
                if br.get("start") and br.get("end"):
                    h -= (datetime.fromisoformat(br["end"]) - datetime.fromisoformat(br["start"])).total_seconds() / 3600
            key = p.get("pharmacy_id") or "—"
            punch_hours_by[key] = punch_hours_by.get(key, 0) + max(0, h)
        except (ValueError, TypeError):
            continue

    last_activity_by: dict = {}
    async for d in db.audit_logs.aggregate([{"$group": {"_id": "$pharmacy_id", "last": {"$max": "$created_at"}}}]):
        last_activity_by[d["_id"] or "—"] = d["last"]

    for key, b in pharmacies.items():
        b["activity"] = {
            "shifts_total": shifts_by.get(key, 0),
            "shifts_upcoming": shifts_upcoming_by.get(key, 0),
            "punches_30d": punches_by.get(key, 0),
            "punch_hours_30d": round(punch_hours_by.get(key, 0), 1),
            "leave_pending": leave_pending_by.get(key, 0),
            "leave_approved": leave_approved_by.get(key, 0),
            "messages_30d": msgs_by.get(key, 0),
            "open_shifts": open_shifts_by.get(key, 0),
            "evaluations": evals_by.get(key, 0),
            "deliveries": deliveries_by.get(key, 0),
            "tasks": tasks_by.get(key, 0),
            "benefits_published": benefits_by.get(key, 0),
            "audit_events_30d": audit_by.get(key, 0),
            "last_activity": last_activity_by.get(key, ""),
        }

    last_login_by: dict = {}
    async for d in db.login_events.aggregate([
            {"$match": {"event": "CONNEXION"}},
            {"$group": {"_id": "$email", "last": {"$max": "$created_at"}}}]):
        last_login_by[d["_id"]] = d["last"]
    logins_30d_by: dict = {}
    async for d in db.login_events.aggregate([
            {"$match": {"event": "CONNEXION", "created_at": {"$gte": month_ago}}},
            {"$group": {"_id": "$email", "n": {"$sum": 1}}}]):
        logins_30d_by[d["_id"]] = d["n"]

    accounts = [{
        "email": u["email"], "name": u.get("name", ""), "role": u["role"],
        "pharmacy_id": u.get("pharmacy_id") or "", "suspended": bool(u.get("suspended")),
        "is_temporary_password": bool(u.get("is_temporary_password")),
        "last_login": last_login_by.get(u["email"], ""),
        "logins_30d": logins_30d_by.get(u["email"], 0),
        "created_at": u.get("created_at", ""),
    } for u in users]
    accounts.sort(key=lambda a: a["last_login"], reverse=True)

    return {"superadmins": superadmins,
            "pharmacies": sorted(pharmacies.values(), key=lambda p: p["pharmacy_id"]),
            "accounts": accounts,
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
    pid = scoped_pid(principal)
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
        query: dict = {"pharmacy_id": scoped_pid(user)}
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
    department: Optional[str] = None
    hourly_rate: Optional[float] = None
    birth_date: Optional[str] = None
    custom_values: Optional[dict] = None
    incompatible_with: Optional[list[str]] = None


def sanitize_profile(doc: dict) -> dict:
    doc["punch_code_set"] = bool(doc.get("punch_code_hash") or doc.get("punch_code"))
    doc.pop("punch_code", None)
    doc.pop("punch_code_hash", None)
    return doc


async def get_or_create_profile(pharmacy_id: str, employee_id: str, employee_name: str = "") -> dict:
    defaults = {
        "id": str(uuid.uuid4()), "pharmacy_id": pharmacy_id, "employee_id": employee_id,
        "employee_name": employee_name, "roles": [], "capacities": [], "restrictions": [],
        "min_hours_week": 0, "max_hours_week": 40, "availability": default_availability(),
        "punch_code_hash": None, "notes": "", "department": "", "incompatible_with": [],
        "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": "",
    }
    doc = await db.employee_profiles.find_one_and_update(
        {"pharmacy_id": pharmacy_id, "employee_id": employee_id},
        {"$setOnInsert": defaults},
        upsert=True, return_document=ReturnDocument.AFTER, projection={"_id": 0})
    return sanitize_profile(doc)


def check_profile_access(user: dict, employee_id: str) -> str:
    if user["role"] in ("admin", "manager", "superadmin"):
        pid = user.get("pharmacy_id") or ""
        if not pid and user["role"] in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="Aucune pharmacie associée.")
        return pid or "__plateforme__"
    if user.get("employee_id") != employee_id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez modifier que votre propre profil.")
    return user.get("pharmacy_id") or ""


@api_router.get("/profiles")
async def list_profiles(user: dict = Depends(get_current_user)):
    if user["role"] in ("admin", "manager", "superadmin"):
        docs = await db.employee_profiles.find({"pharmacy_id": scoped_pid(user)}, {"_id": 0}).to_list(1000)
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
    if "birth_date" in patch:
        bd = patch["birth_date"].strip()
        if bd:
            try:
                date.fromisoformat(bd)
            except ValueError:
                raise HTTPException(status_code=400, detail="Date de naissance invalide (format AAAA-MM-JJ).")
        patch["birth_date"] = bd
    if "hourly_rate" in patch:
        if user["role"] not in ("admin", "manager", "superadmin"):
            patch.pop("hourly_rate")
        elif not (0 <= patch["hourly_rate"] <= 1000):
            raise HTTPException(status_code=400, detail="Taux horaire invalide (0 à 1000 $/h).")
        else:
            patch["hourly_rate"] = round(patch["hourly_rate"], 2)
    if "availability" in patch:
        avail = {}
        for d in WEEK_DAYS:
            day = patch["availability"].get(d) or {}
            avail[d] = {"available": bool(day.get("available", True)),
                        "start": str(day.get("start", "08:00")), "end": str(day.get("end", "21:00"))}
        patch["availability"] = avail
    if "custom_values" in patch:
        if user["role"] not in ("admin", "manager", "superadmin"):
            patch.pop("custom_values")
        else:
            patch["custom_values"] = {str(k)[:60]: str(v)[:200] for k, v in list((patch["custom_values"] or {}).items())[:30]}
    if "incompatible_with" in patch:
        if user["role"] not in ("admin", "manager", "superadmin"):
            patch.pop("incompatible_with")
        else:
            new_set = {str(x)[:60] for x in (patch["incompatible_with"] or []) if str(x).strip() and str(x) != employee_id}
            patch["incompatible_with"] = sorted(new_set)[:50]
            old_set = set(doc.get("incompatible_with") or [])
            now_iso = datetime.now(timezone.utc).isoformat()
            for other in new_set - old_set:
                await get_or_create_profile(pid, other)
                await db.employee_profiles.update_one(
                    {"pharmacy_id": pid, "employee_id": other},
                    {"$addToSet": {"incompatible_with": employee_id}, "$set": {"updated_at": now_iso}})
            for other in old_set - new_set:
                await db.employee_profiles.update_one(
                    {"pharmacy_id": pid, "employee_id": other},
                    {"$pull": {"incompatible_with": employee_id}, "$set": {"updated_at": now_iso}})
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    patch["updated_by"] = user["email"]
    await db.employee_profiles.update_one({"id": doc["id"]}, {"$set": patch})
    await log_audit(user["email"], user["role"], "MODIFICATION_PROFIL", "profil", employee_id,
                    f"Profil de {patch.get('employee_name', doc.get('employee_name', employee_id))} mis à jour", pid)
    return {**doc, **patch}


@api_router.post("/profiles/{employee_id}/punch-code")
async def generate_punch_code(employee_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
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


@api_router.get("/birthdays/today")
async def birthdays_today(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    today_md = datetime.now(MONTREAL_TZ).strftime("%m-%d")
    docs = await db.employee_profiles.find(
        {"pharmacy_id": pid, "birth_date": {"$regex": f"-{today_md}$"}},
        {"_id": 0, "employee_id": 1, "employee_name": 1}).to_list(200)
    return [{"employee_id": d.get("employee_id", ""), "employee_name": d.get("employee_name") or ""} for d in docs]


async def send_birthday_wishes(pharmacy_id: Optional[str] = None) -> int:
    today = datetime.now(MONTREAL_TZ).date()
    query: dict = {"birth_date": {"$regex": f"-{today.strftime('%m-%d')}$"}}
    if pharmacy_id:
        query["pharmacy_id"] = pharmacy_id
    sent = 0
    async for prof in db.employee_profiles.find(query, {"_id": 0}):
        pid = prof.get("pharmacy_id")
        if not pid:
            continue
        emp_name = prof.get("employee_name") or "un(e) collègue"
        convo = await db.conversations.find_one({"pharmacy_id": pid, "type": "equipe"}, {"_id": 0},
                                                sort=[("created_at", 1)])
        if not convo:
            continue
        dup = await db.chat_messages.find_one({
            "conversation_id": convo["id"], "kind": "birthday",
            "birthday_for": prof.get("employee_id"), "birthday_date": today.isoformat()})
        if dup:
            continue
        now = datetime.now(timezone.utc).isoformat()
        first_name = emp_name.split(" ")[0]
        body = (f"🎂 Joyeux anniversaire {emp_name} ! 🎉 Toute l'équipe te souhaite une journée aussi "
                f"agréable que ton sourire au comptoir. Laissez un petit mot à {first_name} juste ici !")
        doc = {"id": str(uuid.uuid4()), "conversation_id": convo["id"], "pharmacy_id": pid,
               "sender_email": "systeme@arriereplan.app", "sender_name": "Arrière Plan",
               "sender_role": "system", "kind": "birthday",
               "birthday_for": prof.get("employee_id"), "birthday_date": today.isoformat(),
               "body": body, "attachment": None, "created_at": now}
        await db.chat_messages.insert_one({**doc})
        await db.conversations.update_one({"id": convo["id"]}, {"$set": {
            "last_message": body[:80], "last_sender": "Arrière Plan", "last_message_at": now}})
        sent += 1
    return sent


@api_router.post("/chat/birthday-wishes/run")
async def run_birthday_wishes(user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès réservé aux gestionnaires.")
    pid = None if user["role"] == "superadmin" else (scoped_pid(user))
    sent = await send_birthday_wishes(pid)
    return {"sent": sent}


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
        breaks = open_p.get("breaks") or []
        if breaks and not breaks[-1].get("end"):
            breaks[-1]["end"] = now.isoformat()
        await db.punches.update_one({"id": open_p["id"]},
                                    {"$set": {"punch_out": now.isoformat(), "punch_out_location": location,
                                              "breaks": breaks}})
        settings = await get_punch_settings(pharmacy_id)
        duration = round(punch_hours({**open_p, "punch_out": now.isoformat(), "breaks": breaks}, settings), 2)
        break_mins = punch_break_minutes({"breaks": breaks})
        await log_audit(actor, "system" if source == "punch" else "admin", "PUNCH_SORTIE", "punch", open_p["id"],
                        f"{employee_name} — sortie ({duration} h{f', pauses {break_mins:g} min' if break_mins else ''})", pharmacy_id)
        return {"action": "out", "employee_name": employee_name, "time": now.isoformat(),
                "punch_in": open_p["punch_in"], "duration_hours": duration, "break_minutes": break_mins}
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
    ip = client_ip(request)
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
    breaks = (open_p.get("breaks") or []) if open_p else []
    on_break = bool(breaks and not breaks[-1].get("end"))
    return {"employee_name": display, "next_action": "out" if open_p else "in",
            "since": open_p["punch_in"] if open_p else None,
            "on_break": on_break, "break_since": breaks[-1]["start"] if on_break else None}


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
    settings = await get_punch_settings(pid)
    hours = sum(punch_hours(p, settings) for p in entries)
    return {"open": open_p, "today_hours": round(hours, 2), "today_entries": entries,
            "on_break": bool(open_p and (open_p.get("breaks") or []) and not (open_p["breaks"][-1].get("end")))}


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
    pid = scoped_pid(principal)
    query: dict = {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}
    if employee_id:
        query["employee_id"] = employee_id
    return await db.punches.find(query, {"_id": 0}).sort([("date", -1), ("punch_in", -1)]).to_list(2000)


@api_router.post("/punches/manual")
async def add_manual_punch(payload: ManualPunchIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
    doc = await db.punches.find_one({"id": punch_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Entrée introuvable.")
    await db.punches.delete_one({"id": punch_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_HEURES", "punch", punch_id,
                    f"{doc['employee_name']} — entrée du {doc['date']} supprimée", pid)
    return {"status": "supprimée"}


def aggregate_punch_hours(docs: list, settings: Optional[dict] = None) -> list:
    settings = settings or {}
    rows: dict = {}
    weekly: dict = {}
    for p in docs:
        r = rows.setdefault(p["employee_id"], {
            "employee_id": p["employee_id"], "employee_name": p["employee_name"],
            "punched_hours": 0.0, "manual_hours": 0.0, "total_hours": 0.0,
            "regular_hours": 0.0, "overtime_hours": 0.0, "break_minutes": 0.0,
            "entries": 0, "open_entries": 0})
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


@api_router.get("/punches/summary")
async def punches_summary(start: str = Query(...), end: str = Query(...), principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    docs = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    return aggregate_punch_hours(docs, await get_punch_settings(pid))


@api_router.get("/punches/export")
async def export_punches(start: str = Query(...), end: str = Query(...), principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    docs = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    p_settings = await get_punch_settings(pid)
    lines = ["Employé;Date;Entrée;Sortie;Pauses (min);Heures;Source;Saisie par;Note"]
    for p in sorted(docs, key=lambda x: (x["employee_name"], x["date"], x["punch_in"])):
        t_in = datetime.fromisoformat(p["punch_in"]).astimezone(MONTREAL_TZ).strftime("%H:%M")
        b_mins = punch_break_minutes(p)
        if p.get("punch_out"):
            t_out = datetime.fromisoformat(p["punch_out"]).astimezone(MONTREAL_TZ).strftime("%H:%M")
            h = round(punch_hours(p, p_settings), 2)
        else:
            t_out, h = "en cours", ""
        src = "Punch" if p["source"] == "punch" else "Saisie manuelle"
        note = (p.get("note") or "").replace(";", ",")
        lines.append(f"{p['employee_name']};{p['date']};{t_in};{t_out};{str(b_mins).replace('.', ',')};{str(h).replace('.', ',')};{src};{p.get('created_by', '')};{note}")
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
    pid = scoped_pid(principal)
    docs = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    rows = [r for r in aggregate_punch_hours(docs, await get_punch_settings(pid)) if r["total_hours"] > 0]
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
    pid = scoped_pid(principal)
    docs = await db.punches.find({"pharmacy_id": pid, "punch_out": None}, {"_id": 0}).to_list(500)
    now = datetime.now(timezone.utc)
    for p in docs:
        p["elapsed_hours"] = round((now - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600, 1)
    return sorted(docs, key=lambda p: -p["elapsed_hours"])


# ==================== Export budgets de paie par succursale ====================

def _shift_net_hours(s: dict, auto_break: dict) -> float:
    try:
        h = max(0, _time_to_minutes(s["end"]) - _time_to_minutes(s["start"])) / 60
    except (ValueError, AttributeError, KeyError):
        return 0.0
    if auto_break.get("enabled") and not auto_break.get("paid") and h >= float(auto_break.get("threshold_hours") or 6):
        h = max(0.0, h - float(auto_break.get("minutes") or 30) / 60)
    return h


def _num_fr(v: float) -> str:
    return f"{v:.2f}".replace(".", ",")


@api_router.get("/payroll/budget-export")
async def export_branch_budgets(start: str = Query(...), end: str = Query(...),
                                names: str = Query("{}"), label: str = Query(""),
                                principal: dict = Depends(get_principal)):
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
    branch_budgets = {b.get("branch_id") or "": float(b.get("budget") or 0)
                      for b in (settings.get("branch_budgets") or [])}
    for b in (settings.get("branch_budgets") or []):
        name_map.setdefault(b.get("branch_id") or "", b.get("branch_name") or "")
    profiles = await db.employee_profiles.find(
        {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "hourly_rate": 1}).to_list(1000)
    rate_by = {p["employee_id"]: float(p.get("hourly_rate") or 0) for p in profiles}
    shifts = await db.shifts.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(20000)

    planned: dict = {}
    shifts_by_emp_day: dict = {}
    for s in shifts:
        bid = s.get("branch_id") or ""
        h = _shift_net_hours(s, auto_break)
        row = planned.setdefault(bid, {"hours": 0.0, "cost": 0.0})
        row["hours"] += h
        row["cost"] += h * rate_by.get(s["employee_id"], 0)
        shifts_by_emp_day.setdefault((s["employee_id"], s["date"]), []).append(s)

    punches = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}, "punch_out": {"$ne": None}},
        {"_id": 0}).to_list(20000)
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
        total_sched = sum(_shift_net_hours(s, auto_break) for s in day_shifts) or 1.0
        for s in day_shifts:
            frac = _shift_net_hours(s, auto_break) / total_sched
            row = real.setdefault(s.get("branch_id") or "", {"hours": 0.0, "cost": 0.0})
            row["hours"] += h * frac
            row["cost"] += h * frac * rate

    days = (d1 - d0).days + 1
    factor = days / 7
    all_bids = sorted(set(list(planned.keys()) + list(real.keys()) + list(branch_budgets.keys())),
                      key=lambda b: name_map.get(b, b))
    period_label = label or f"{start} au {end}"
    lines = [f"Budgets de paie par succursale;Période : {period_label};{days} jour(s)",
             "Succursale;Heures planifiées;Coût planifié $;Heures réelles;Coût réel $;"
             "Budget période $ (hebdo × semaines);Écart réel vs budget $"]
    tot = {"ph": 0.0, "pc": 0.0, "rh": 0.0, "rc": 0.0, "b": 0.0}
    for bid in all_bids:
        pl = planned.get(bid, {"hours": 0.0, "cost": 0.0})
        re_ = real.get(bid, {"hours": 0.0, "cost": 0.0})
        budget = round(branch_budgets.get(bid, 0) * factor, 2)
        gap = _num_fr(re_["cost"] - budget) if budget > 0 else ""
        nom = (name_map.get(bid) or ("Sans succursale" if not bid else bid)).replace(";", " ")
        lines.append(f"{nom};{_num_fr(pl['hours'])};{_num_fr(pl['cost'])};{_num_fr(re_['hours'])};{_num_fr(re_['cost'])};"
                     f"{_num_fr(budget) if budget > 0 else ''};{gap}")
        tot["ph"] += pl["hours"]
        tot["pc"] += pl["cost"]
        tot["rh"] += re_["hours"]
        tot["rc"] += re_["cost"]
        tot["b"] += budget
    weekly_budget = float(settings.get("weekly_budget") or 0)
    global_budget = round(weekly_budget * factor, 2) if weekly_budget > 0 else tot["b"]
    gap_total = _num_fr(tot["rc"] - global_budget) if global_budget > 0 else ""
    lines.append(f"TOTAL PHARMACIE;{_num_fr(tot['ph'])};{_num_fr(tot['pc'])};{_num_fr(tot['rh'])};{_num_fr(tot['rc'])};"
                 f"{_num_fr(global_budget) if global_budget > 0 else ''};{gap_total}")
    content = ("\ufeff" + "\n".join(lines)).encode("utf-8")
    await log_audit(principal["email"], principal["role"], "EXPORT_BUDGETS_PAIE", "paie", f"{start}_{end}",
                    f"Export des budgets de paie par succursale du {start} au {end}", pid)
    return Response(content=content, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="budgets-paie_{start}_{end}.csv"'})


# ==================== Paramètres de période de paie ====================

class PaySettingsIn(BaseModel):
    period_type: str
    anchor: str


@api_router.get("/pay-settings")
async def get_pay_settings(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    "- COUVERTURE MINIMALE PAR DÉPARTEMENT : chaque employé a un département par défaut (champ department de son profil) et la liste "
    "des départements est fournie (departements_disponibles). Assure AU MINIMUM une personne présente par département actif pendant "
    "les heures d'ouverture, MÊME en période de faible achalandage, tant qu'il y a assez de personnel disponible et que le budget et "
    "les disponibilités le permettent. PRIORITÉ ABSOLUE au Laboratoire et à la caisse (service au comptoir — département Plancher) : "
    "s'il faut faire des compromis, couvre-les en premier et explique le compromis dans le summary.\n"
    "- PERSONNEL REQUIS (DOTATION) : si personnel_requis_par_departement ou personnel_requis_par_succursale sont fournis, planifie "
    "EN TOUT TEMPS pendant les heures d'ouverture AU MOINS ce nombre d'employés EN SIMULTANÉ dans chaque département et chaque "
    "succursale concernés. Ces exigences PRIMENT sur la règle de couverture minimale par défaut et sur la règle d'achalandage "
    "(l'achalandage peut AJOUTER du personnel au-delà du minimum, jamais en retirer en dessous). Vérifie plage par plage que le "
    "compte est respecté. Si le budget, les disponibilités ou l'effectif rendent l'exigence impossible sur certaines plages, "
    "couvre d'abord les plages les plus achalandées et détaille précisément chaque manque (jour, plage, département/succursale) dans le summary.\n"
    "- BUDGETS PAR DÉPARTEMENT ET PAR SUCCURSALE : s'ils sont fournis (budgets_par_departement, budgets_par_succursale), la masse "
    "salariale des quarts de chaque département — et celle des quarts rattachés à chaque succursale (champ branch_id du QUART) — ne doit "
    "pas dépasser son budget respectif, en plus du budget hebdomadaire global.\n"
    "- EMPLOYÉS VOLATILS (MULTI-SUCCURSALES) : chaque employé a une liste succursales_permises. Tu peux répartir la semaine d'un employé "
    "volatil entre plusieurs de ses succursales permises (ex. 5 h à une succursale et 4 h à une autre). CHAQUE quart doit inclure le champ "
    "branch_id choisi PARMI les succursales_permises de l'employé, et son coût (heures × taux horaire) est imputé au budget de LA succursale "
    "du quart, jamais à une autre. Ne planifie JAMAIS un employé dans une succursale absente de ses succursales_permises. "
    "Ne planifie jamais deux quarts qui se chevauchent pour le même employé, même dans des succursales différentes.\n"
    "- INCOMPATIBILITÉS ENTRE EMPLOYÉS : chaque employé peut avoir une liste incompatible_avec (ids d'employés). Ne planifie JAMAIS deux "
    "employés incompatibles sur des quarts qui se chevauchent dans la MÊME succursale. Si c'est inévitable pour couvrir l'achalandage, "
    "sépare-les (succursales ou plages différentes) et explique le compromis dans le summary.\n"
    "- PRIORITÉS DU GESTIONNAIRE : si priorites_du_gestionnaire est fourni, ces priorités PRIMENT sur les règles de priorisation "
    "par défaut (y compris la priorité Laboratoire/caisse), tout en respectant les contraintes dures (disponibilités, restrictions, "
    "absences, budgets, heures max). Repères : temps plein ≈ 30 h et plus par semaine selon min/max du profil ; ancienneté = date "
    "d'embauche la plus ancienne. Explique dans le summary comment tu as appliqué ces priorités.\n"
    "- Tiens compte des tâches à faire : si une tâche est assignée à un employé un jour donné, planifie-le ce jour-là "
    "sur une plage couvrant le quart de la tâche (Matin ≈ 8h-12h, Après-midi ≈ 12h-17h, Soir ≈ 17h-21h30), "
    "si ses disponibilités le permettent; sinon explique pourquoi dans le summary.\n"
    "- N'attribue à un employé qu'un rôle figurant dans ses rôles ou capacités; s'il faut faire autrement, signale-le dans le summary.\n"
    "- Ne dépasse jamais le maximum d'heures hebdomadaires d'un employé; vise au moins son minimum si le budget le permet.\n"
    "- Des remplaçants d'agence DÉJÀ CONFIRMÉS peuvent être fournis (date, plage horaire, rôle, taux horaire) : considère ces plages "
    "comme déjà couvertes pour ce rôle (ne planifie pas d'employé en double inutilement sur ces plages) et INCLUS leur coût "
    "(durée de la plage × taux horaire du remplaçant) dans ton calcul du budget salarial hebdomadaire.\n"
    "- Des QUARTS EXISTANTS déjà au calendrier peuvent être fournis (quarts_existants_a_conserver) : ils seront CONSERVÉS tels quels. "
    "NE les recrée PAS, ne planifie JAMAIS le même employé sur une plage qui chevauche un de ses quarts existants, considère ces plages "
    "comme déjà couvertes, et INCLUS leur coût (durée × taux horaire de l'employé) dans le budget hebdomadaire. "
    "Complète uniquement les manques de couverture.\n"
    "- Assure une couverture adéquate pendant les heures d'ouverture (par défaut lun-ven 8h-21h, sam-dim 9h-17h, "
    "sauf indication contraire dans les consignes), en priorité un pharmacien présent en tout temps si disponible.\n"
    "- Répartis équitablement les quarts et attribue à chacun un rôle cohérent avec ses rôles/capacités.\n"
    "- Quarts de 4 à 8 heures.\n\n"
    "Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, au format exact :\n"
    "{\n"
    '  "summary": "Explication en français des choix effectués (3 à 6 phrases).",\n'
    '  "shifts": [\n'
    '    {"employee_id": "id", "employee_name": "Prénom Nom", "date": "YYYY-MM-DD", '
    '"start": "08:00", "end": "16:00", "role": "Rôle pour ce quart", '
    '"branch_id": "id de la succursale du quart, parmi les succursales_permises de l\'employé", '
    '"department": "Département du quart, parmi departements_disponibles (défaut : le département de l\'employé)"}\n'
    "  ]\n"
    "}"
)


class RosterEmployee(BaseModel):
    id: str
    name: str
    position: str
    branch_id: str = ""
    branch_name: str = ""
    branch_ids: list[str] = []
    branch_names: list[str] = []
    hire_date: str = ""


TRAFFIC_DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DEPARTMENTS_BE = ("Général", "Plancher", "Laboratoire", "Entrepôt", "Livraison", "Administration")
TRAFFIC_DAY_LABELS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
TRAFFIC_BLOCKS = {
    "matin": ("Matin (8h-12h)", "08:00", "12:00"),
    "apres_midi": ("Après-midi (12h-17h)", "12:00", "17:00"),
    "soir": ("Soir (17h-21h30)", "17:00", "21:30"),
}


def _sanitize_priorities(pr: dict) -> dict:
    pr = pr or {}
    return {
        "dept_order": [d for d in (pr.get("dept_order") or []) if d in DEPARTMENTS_BE][:6],
        "employee_type": pr.get("employee_type") if pr.get("employee_type") in ("full_time", "part_time") else "",
        "availability": pr.get("availability") if pr.get("availability") in ("most", "least") else "",
        "extra": [x for x in (pr.get("extra") or []) if x in ("seniority", "low_cost", "min_hours_equity")],
    }


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


def _sanitize_traffic(raw: dict) -> dict:
    traffic = {}
    for day in TRAFFIC_DAY_KEYS:
        blocks = (raw or {}).get(day) or {}
        traffic[day] = {b: max(0, min(500, int(float(blocks.get(b) or 0)))) for b in TRAFFIC_BLOCKS}
    return traffic


@api_router.get("/schedule/settings")
async def get_schedule_settings(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return {"weekly_budget": (doc or {}).get("weekly_budget", 0),
            "traffic": (doc or {}).get("traffic", {}),
            "traffic_periods": (doc or {}).get("traffic_periods", []),
            "dept_budgets": (doc or {}).get("dept_budgets", {}),
            "branch_budgets": (doc or {}).get("branch_budgets", []),
            "dept_staffing": (doc or {}).get("dept_staffing", {}),
            "branch_staffing": (doc or {}).get("branch_staffing", []),
            "priorities": (doc or {}).get("priorities", {}),
            "priority_sets": (doc or {}).get("priority_sets", []),
            "auto_break": (doc or {}).get("auto_break", {"enabled": False, "threshold_hours": 6, "minutes": 30, "paid": False})}


@api_router.put("/schedule/settings")
async def set_schedule_settings(payload: ScheduleSettingsIn, principal: dict = Depends(get_principal)):
    if not (0 <= payload.weekly_budget <= 1_000_000):
        raise HTTPException(status_code=400, detail="Budget hebdomadaire invalide.")
    try:
        traffic = _sanitize_traffic(payload.traffic)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=400, detail="Valeurs d'achalandage invalides.")
    pid = scoped_pid(principal)
    update = {"pharmacy_id": pid, "weekly_budget": round(payload.weekly_budget, 2), "traffic": traffic,
              "updated_by": principal["email"], "updated_at": datetime.now(timezone.utc).isoformat()}
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
                periods.append({"id": str(p.get("id") or uuid.uuid4()), "name": name[:60],
                                "start_md": smd, "end_md": emd,
                                "traffic": _sanitize_traffic(p.get("traffic") or {})})
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
                branch_list.append({"branch_id": str(b.get("branch_id") or ""),
                                    "branch_name": str(b.get("branch_name") or "")[:80], "budget": round(n, 2)})
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
                staff_list.append({"branch_id": str(b.get("branch_id") or ""),
                                   "branch_name": str(b.get("branch_name") or "")[:80], "count": n})
        update["branch_staffing"] = staff_list
    if payload.priorities is not None:
        update["priorities"] = _sanitize_priorities(payload.priorities)
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
            sets.append({"id": str(ps.get("id") or uuid.uuid4()), "name": name[:60],
                         "priorities": _sanitize_priorities(ps.get("priorities") or {})})
        update["priority_sets"] = sets
    if payload.auto_break is not None:
        ab = payload.auto_break
        try:
            update["auto_break"] = {
                "enabled": bool(ab.get("enabled")),
                "threshold_hours": max(1.0, min(16.0, float(ab.get("threshold_hours") or 6))),
                "minutes": max(5, min(120, int(float(ab.get("minutes") or 30)))),
                "paid": bool(ab.get("paid"))}
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Réglage de pauses automatiques invalide.")
    await db.schedule_settings.update_one({"pharmacy_id": pid}, {"$set": update}, upsert=True)
    saved = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    periods_note = f", {len(update['traffic_periods'])} période(s)" if "traffic_periods" in update else ""
    await log_audit(principal["email"], principal["role"], "MODIF_PARAMS_HORAIRE", "horaire", pid,
                    f"Budget hebdo : {payload.weekly_budget:.2f} $, achalandage mis à jour{periods_note}", pid)
    return {"weekly_budget": saved.get("weekly_budget", 0), "traffic": saved.get("traffic", {}),
            "traffic_periods": saved.get("traffic_periods", []),
            "dept_budgets": saved.get("dept_budgets", {}),
            "branch_budgets": saved.get("branch_budgets", []),
            "priorities": saved.get("priorities", {}),
            "priority_sets": saved.get("priority_sets", []),
            "auto_break": saved.get("auto_break", {"enabled": False, "threshold_hours": 6, "minutes": 30, "paid": False})}


# ==================== Quarts (calendrier synchronisé multi-appareils) ====================

class ShiftIn(BaseModel):
    id: str = ""
    employee_id: str
    employee_name: str = ""
    date: str
    start: str
    end: str
    department: str = "Général"
    resource_ids: list[str] = []
    ai_generated: bool = False
    proposal_id: str = ""
    branch_id: str = ""
    station: str = ""
    notes: str = ""
    training: bool = False


class ShiftPatchIn(BaseModel):
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    date: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    department: Optional[str] = None
    resource_ids: Optional[list[str]] = None
    ai_generated: Optional[bool] = None
    proposal_id: Optional[str] = None
    branch_id: Optional[str] = None
    station: Optional[str] = None
    notes: Optional[str] = None
    training: Optional[bool] = None


class ShiftsBulkIn(BaseModel):
    shifts: list[ShiftIn]


def _validate_shift_core(date_s: str, start: str, end: str) -> None:
    try:
        date.fromisoformat(date_s)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date de quart invalide.")
    if not re.fullmatch(r"\d{2}:\d{2}", start or "") or not re.fullmatch(r"\d{2}:\d{2}", end or ""):
        raise HTTPException(status_code=400, detail="Heures de quart invalides (HH:MM).")
    if end <= start:
        raise HTTPException(status_code=400, detail="L'heure de fin doit être après l'heure de début.")


def _shift_doc(s: ShiftIn, pid: str) -> dict:
    _validate_shift_core(s.date, s.start, s.end)
    return {"id": s.id or str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": s.employee_id,
            "employee_name": (s.employee_name or "")[:80],
            "date": s.date, "start": s.start, "end": s.end,
            "department": s.department if s.department in DEPARTMENTS_BE else "Général",
            "resource_ids": [str(r) for r in (s.resource_ids or [])][:20],
            "ai_generated": bool(s.ai_generated), "proposal_id": s.proposal_id or "",
            "branch_id": s.branch_id or "", "station": (s.station or "")[:80], "notes": (s.notes or "")[:500],
            "training": bool(s.training),
            "updated_at": datetime.now(timezone.utc).isoformat()}


async def _mark_shifts_ready(pid: str) -> None:
    await db.schedule_settings.update_one(
        {"pharmacy_id": pid}, {"$set": {"pharmacy_id": pid, "shifts_server_ready": True}}, upsert=True)


async def _notify_shift_change(pid: str, employee_id: str, title: str, detail: str, tone: str = "sky",
                               module: str = "myspace", icon: str = "schedule") -> None:
    if not employee_id:
        return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_employee_id": employee_id,
        "title": title, "detail": detail, "module": module, "icon": icon,
        "tone": tone, "created_at": datetime.now(timezone.utc).isoformat()})


def _fmt_shift_txt(d: dict) -> str:
    dept = d.get("department") or "Général"
    label = dept + (f" — poste {d['station']}" if d.get("station") else "")
    return f"le {d['date']} de {d['start']} à {d['end']}" + (f" ({label})" if label != "Général" else "")


@api_router.get("/shifts")
async def list_calendar_shifts(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    docs = await db.shifts.find({"pharmacy_id": pid}, {"_id": 0}).to_list(10000)
    settings = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0, "shifts_server_ready": 1}) or {}
    return {"shifts": docs, "migrated": bool(settings.get("shifts_server_ready"))}


async def _incompat_warning(pid: str, shift: dict) -> Optional[str]:
    prof = await db.employee_profiles.find_one(
        {"pharmacy_id": pid, "employee_id": shift["employee_id"]},
        {"_id": 0, "incompatible_with": 1})
    incompat = set((prof or {}).get("incompatible_with") or [])
    if not incompat:
        return None
    others = await db.shifts.find(
        {"pharmacy_id": pid, "date": shift["date"], "employee_id": {"$in": list(incompat)},
         "id": {"$ne": shift["id"]}},
        {"_id": 0, "employee_id": 1, "start": 1, "end": 1, "branch_id": 1}).to_list(100)
    conflicts = [o for o in others
                 if o["start"] < shift["end"] and shift["start"] < o["end"]
                 and (o.get("branch_id") or "") == (shift.get("branch_id") or "")]
    if not conflicts:
        return None
    name_docs = await db.employee_profiles.find(
        {"pharmacy_id": pid, "employee_id": {"$in": [o["employee_id"] for o in conflicts]}},
        {"_id": 0, "employee_id": 1, "employee_name": 1}).to_list(100)
    name_by = {d["employee_id"]: d.get("employee_name") for d in name_docs}
    names = [name_by.get(o["employee_id"]) or o["employee_id"] for o in conflicts]
    return ("⚠️ Incompatibilité : ce quart chevauche celui de " + ", ".join(sorted(set(names))) +
            " dans la même succursale — ces employés ne doivent pas travailler ensemble. Le quart a tout de même été enregistré.")


@api_router.post("/shifts")
async def create_calendar_shift(payload: ShiftIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = _shift_doc(payload, pid)
    res = await db.shifts.update_one({"id": doc["id"], "pharmacy_id": pid}, {"$set": doc}, upsert=True)
    await _mark_shifts_ready(pid)
    if res.upserted_id is not None and not doc["ai_generated"]:
        await _notify_shift_change(pid, doc["employee_id"], "Nouveau quart ajouté",
                                   f"Vous travaillez {_fmt_shift_txt(doc)}.", "sky")
    warning = await _incompat_warning(pid, doc)
    return {**doc, "incompat_warning": warning}


@api_router.post("/shifts/bulk")
async def bulk_import_shifts(payload: ShiftsBulkIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if len(payload.shifts) > 3000:
        raise HTTPException(status_code=400, detail="Maximum 3000 quarts par import.")
    count = 0
    for s in payload.shifts:
        doc = _shift_doc(s, pid)
        await db.shifts.update_one({"id": doc["id"], "pharmacy_id": pid}, {"$set": doc}, upsert=True)
        count += 1
    await _mark_shifts_ready(pid)
    await log_audit(principal["email"], principal["role"], "IMPORT_QUARTS", "horaire", pid,
                    f"Synchronisation initiale du calendrier : {count} quart(s) importés", pid)
    return {"imported": count}


@api_router.put("/shifts/{shift_id}")
async def update_calendar_shift(shift_id: str, payload: ShiftPatchIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.shifts.find_one({"id": shift_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Quart introuvable.")
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "employee_name" in patch:
        patch["employee_name"] = (patch["employee_name"] or "")[:80]
    merged_date = patch.get("date", doc["date"])
    merged_start = patch.get("start", doc["start"])
    merged_end = patch.get("end", doc["end"])
    _validate_shift_core(merged_date, merged_start, merged_end)
    if "department" in patch and patch["department"] not in DEPARTMENTS_BE:
        patch["department"] = "Général"
    if "resource_ids" in patch:
        patch["resource_ids"] = [str(r) for r in patch["resource_ids"]][:20]
    if "station" in patch:
        patch["station"] = (patch["station"] or "")[:80]
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.shifts.update_one({"id": shift_id, "pharmacy_id": pid}, {"$set": patch})
    await _mark_shifts_ready(pid)
    merged = {**doc, **patch}
    relevant = any(patch.get(k) is not None and patch[k] != doc.get(k)
                   for k in ("date", "start", "end", "department", "employee_id", "station"))
    if relevant:
        if patch.get("employee_id") and patch["employee_id"] != doc["employee_id"]:
            await _notify_shift_change(pid, doc["employee_id"], "Quart retiré",
                                       f"Votre quart {_fmt_shift_txt(doc)} a été réassigné.", "red")
            await _notify_shift_change(pid, merged["employee_id"], "Nouveau quart ajouté",
                                       f"Vous travaillez {_fmt_shift_txt(merged)}.", "sky")
        else:
            await _notify_shift_change(pid, doc["employee_id"], "Quart modifié",
                                       f"Avant : {_fmt_shift_txt(doc)} → maintenant : {_fmt_shift_txt(merged)}.", "amber")
    warning = await _incompat_warning(pid, merged)
    return {**merged, "incompat_warning": warning}


@api_router.delete("/shifts/{shift_id}")
async def delete_calendar_shift(shift_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.shifts.find_one({"id": shift_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        await _mark_shifts_ready(pid)
        raise HTTPException(status_code=404, detail="Quart introuvable.")
    await db.shifts.delete_one({"id": shift_id, "pharmacy_id": pid})
    await _mark_shifts_ready(pid)
    if not doc.get("ai_generated"):
        await _notify_shift_change(pid, doc["employee_id"], "Quart retiré",
                                   f"Votre quart {_fmt_shift_txt(doc)} a été retiré de l'horaire.", "red")
    return {"status": "supprimé"}


# ==================== Postes de travail par département ====================

def _st(dept: str, sid: str, name: str, comp: str, normal: int, rush: int, active: bool) -> dict:
    return {"id": sid, "department": dept, "name": name, "competence": comp,
            "normal_count": normal, "rush_count": rush, "active": active}


DEFAULT_WORK_STATIONS = [
    _st("Laboratoire", "lab-accueil", "Accueil client / Réception des ordonnances", "Accueil et réception des ordonnances", 1, 2, True),
    _st("Laboratoire", "lab-saisie", "Saisie / Entrée de données", "Saisie informatique des ordonnances", 1, 2, True),
    _st("Laboratoire", "lab-comptage", "Comptage / Préparation des ordonnances", "Comptage et préparation des ordonnances", 1, 2, True),
    _st("Laboratoire", "lab-robot", "Robot de dispensation", "Opération du robot de dispensation", 1, 1, True),
    _st("Laboratoire", "lab-dispill", "Dispill / Piluliers", "Préparation des Dispill et piluliers", 1, 1, True),
    _st("Laboratoire", "lab-verification", "Vérification contenant-contenu", "Vérification contenant-contenu", 1, 1, False),
    _st("Laboratoire", "lab-remise", "Remise des ordonnances / Caisse labo", "Remise des ordonnances et caisse", 1, 2, False),
    _st("Laboratoire", "lab-telephone", "Téléphone / Renouvellements", "Gestion des appels et renouvellements", 1, 1, False),
    _st("Laboratoire", "lab-fax", "Télécopies / Liaisons prescripteurs", "Liaisons avec les prescripteurs", 1, 1, False),
    _st("Laboratoire", "lab-magistrales", "Préparations magistrales (non stériles)", "Préparations magistrales", 1, 1, False),
    _st("Laboratoire", "lab-steriles", "Préparations stériles", "Préparations stériles", 1, 1, False),
    _st("Laboratoire", "lab-stocks", "Commandes / Réception des stocks du labo", "Gestion des stocks du laboratoire", 1, 1, False),
    _st("Laboratoire", "lab-retours", "Retours / Périmés / Rappels", "Gestion des retours et périmés", 1, 1, False),
    _st("Laboratoire", "lab-narcotiques", "Narcotiques et substances contrôlées", "Gestion des narcotiques", 1, 1, False),
    _st("Laboratoire", "lab-chsld", "Piluliers résidences / CHSLD", "Préparation piluliers établissements", 1, 1, False),
    _st("Laboratoire", "lab-vaccination", "Vaccination / Injections", "Vaccination et injections", 1, 1, False),
    _st("Laboratoire", "lab-mvl", "Conseils MVL au comptoir", "Conseils médicaments en vente libre", 1, 1, False),
    _st("Laboratoire", "lab-pharmacien-verif", "Pharmacien — validation des ordonnances", "Validation pharmaceutique", 1, 2, False),
    _st("Laboratoire", "lab-pharmacien-clinique", "Pharmacien — actes cliniques (Loi 31/41)", "Actes cliniques pharmaceutiques", 1, 1, False),
    _st("Laboratoire", "lab-stagiaire", "Étudiant / Stagiaire en pharmacie", "", 1, 1, False),
    _st("Plancher", "pl-conseil", "Conseil clients / Plancher", "Service à la clientèle", 1, 2, True),
    _st("Plancher", "pl-caisse", "Caisse avant / Loterie", "Opération de caisse", 1, 2, False),
    _st("Plancher", "pl-tablettes", "Mise en tablettes / Facing", "Mise en marché", 1, 1, False),
    _st("Plancher", "pl-etiquetage", "Étiquetage et changements de prix", "Étiquetage et affichage des prix", 1, 1, False),
    _st("Plancher", "pl-cosmetiques", "Cosmétiques / Dermoconseil", "Conseil en cosmétiques", 1, 1, False),
    _st("Plancher", "pl-photo", "Comptoir photo", "Service photo", 1, 1, False),
    _st("Plancher", "pl-gerant", "Gérant de plancher", "Gestion du plancher", 1, 1, False),
    _st("Entrepôt", "en-reception", "Réception et vérification des commandes", "Réception de marchandises", 1, 1, True),
    _st("Entrepôt", "en-rangement", "Rangement / Rotation des stocks", "Gestion des stocks", 1, 1, False),
    _st("Entrepôt", "en-inventaire", "Inventaire cyclique", "Prise d'inventaire", 1, 1, False),
    _st("Livraison", "li-livreur", "Livreur", "Livraison à domicile", 1, 2, True),
    _st("Livraison", "li-preparation", "Préparation des livraisons / Facturation", "Préparation des commandes de livraison", 1, 1, False),
    _st("Livraison", "li-repartition", "Répartition / Tournées", "Planification des tournées", 1, 1, False),
    _st("Administration", "ad-gestion", "Gestion / Horaires et RH", "Gestion administrative", 1, 1, False),
    _st("Administration", "ad-comptabilite", "Comptabilité / Facturation", "Comptabilité", 1, 1, False),
    _st("Administration", "ad-secretariat", "Réception téléphonique / Secrétariat", "Secrétariat", 1, 1, False),
    _st("Général", "ge-polyvalent", "Polyvalent (toutes zones)", "", 1, 1, False),
    _st("Général", "ge-entretien", "Entretien / Salubrité", "Entretien des lieux", 1, 1, False),
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
        doc = {"pharmacy_id": pid, "stations": [dict(s) for s in DEFAULT_WORK_STATIONS],
               "rush_periods": [dict(p) for p in DEFAULT_RUSH_PERIODS],
               "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.work_stations.insert_one({**doc})
    return doc


@api_router.get("/work-stations")
async def list_work_stations(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await get_work_stations_config(pid)
    return {"stations": doc.get("stations", []), "rush_periods": doc.get("rush_periods", [])}


@api_router.put("/work-stations")
async def save_work_stations(payload: WorkStationsConfigIn, principal: dict = Depends(get_principal)):
    if principal["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès réservé aux gestionnaires.")
    pid = scoped_pid(principal)
    stations = []
    for s in payload.stations[:120]:
        if s.department not in DEPARTMENTS_BE or not s.name.strip():
            continue
        stations.append({"id": s.id or str(uuid.uuid4()), "department": s.department,
                         "name": s.name.strip()[:80], "competence": s.competence.strip()[:120],
                         "normal_count": s.normal_count, "rush_count": max(s.rush_count, s.normal_count),
                         "active": s.active})
    periods = []
    for p in payload.rush_periods[:14]:
        if not re.fullmatch(r"\d{2}:\d{2}", p.start) or not re.fullmatch(r"\d{2}:\d{2}", p.end) or p.end <= p.start:
            continue
        periods.append({"days": sorted({d for d in p.days if 0 <= d <= 6}), "start": p.start, "end": p.end})
    doc = {"pharmacy_id": pid, "stations": stations, "rush_periods": periods,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.work_stations.update_one({"pharmacy_id": pid}, {"$set": doc}, upsert=True)
    await log_audit(principal["email"], principal["role"], "CONFIG_POSTES", "horaire", pid,
                    f"Postes de travail mis à jour ({len(stations)} postes, {len(periods)} période(s) de rush)", pid)
    return {"stations": stations, "rush_periods": periods}


def _shift_in_rush(sh: dict, periods: list) -> bool:
    wd = date.fromisoformat(sh["date"]).weekday()
    return any(wd in (p.get("days") or []) and sh["start"] < p["end"] and sh["end"] > p["start"] for p in periods)


class StationsAssignIn(BaseModel):
    week_start: str


async def _assign_stations_range(pid: str, days: list[str], notify: bool = True) -> int:
    cfg = await get_work_stations_config(pid)
    periods = cfg.get("rush_periods", [])
    by_dept: dict = {}
    for st in cfg.get("stations", []):
        if st.get("active"):
            by_dept.setdefault(st["department"], []).append(st)
    if not by_dept:
        return 0
    caps = {p["employee_id"]: (p.get("capacities") or [])
            async for p in db.employee_profiles.find({"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "capacities": 1})}
    shifts = await db.shifts.find({"pharmacy_id": pid, "date": {"$in": days}}, {"_id": 0}).to_list(3000)
    hist_start = (date.fromisoformat(days[0]) - timedelta(days=7)).isoformat()
    last_station: dict = {}
    async for h in db.shifts.find({"pharmacy_id": pid, "date": {"$gte": hist_start, "$lt": days[0]},
                                   "station": {"$nin": ["", None]}},
                                  {"_id": 0, "employee_id": 1, "date": 1, "station": 1}):
        key = (h["employee_id"], h["station"])
        if h["date"] > last_station.get(key, ""):
            last_station[key] = h["date"]

    def _recency(emp: str, st_name: str, day_s: str) -> float:
        last = last_station.get((emp, st_name), "")
        if not last:
            return 0.0
        delta = (date.fromisoformat(day_s) - date.fromisoformat(last)).days
        return max(0.0, (8 - delta) / 8)

    assigned = 0
    for day in days:
        for sh in shifts:
            if sh["date"] == day and sh.get("station"):
                key = (sh["employee_id"], sh["station"])
                if day > last_station.get(key, ""):
                    last_station[key] = day
        for dept, stations in by_dept.items():
            day_shifts = sorted([s for s in shifts if s["date"] == day and (s.get("department") or "Général") == dept],
                                key=lambda x: x["start"])
            names = {st["name"] for st in stations}
            counts = {st["name"]: sum(1 for s in day_shifts if s.get("station") == st["name"]) for st in stations}
            for sh in day_shifts:
                if sh.get("station") in names or (sh.get("station") and sh["station"] not in names):
                    continue
                rush = _shift_in_rush(sh, periods)
                emp_caps = caps.get(sh["employee_id"], [])

                def _needed(st: dict) -> int:
                    return st["rush_count"] if rush else st["normal_count"]

                open_st = [st for st in stations if counts[st["name"]] < _needed(st)]
                qualified = [st for st in open_st
                             if not st.get("competence") or not emp_caps or task_qualification_ok(st["competence"], emp_caps)]
                pool = qualified or open_st
                if not pool:
                    continue
                best = min(pool, key=lambda st: (_recency(sh["employee_id"], st["name"], day),
                                                 counts[st["name"]] / max(_needed(st), 1), -_needed(st)))
                sh["station"] = best["name"]
                counts[best["name"]] += 1
                last_station[(sh["employee_id"], best["name"])] = day
                await db.shifts.update_one({"id": sh["id"], "pharmacy_id": pid},
                                           {"$set": {"station": best["name"],
                                                     "updated_at": datetime.now(timezone.utc).isoformat()}})
                if notify:
                    await _notify_shift_change(pid, sh["employee_id"], "Poste de travail assigné",
                                               f"Votre quart {_fmt_shift_txt(sh)}.", "sky")
                assigned += 1
    return assigned


@api_router.post("/work-stations/assign")
async def auto_assign_stations(payload: StationsAssignIn, principal: dict = Depends(get_principal)):
    if principal["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Accès réservé aux gestionnaires.")
    pid = scoped_pid(principal)
    start = date.fromisoformat(payload.week_start)
    days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    assigned = await _assign_stations_range(pid, days)
    if assigned:
        await log_audit(principal["email"], principal["role"], "ATTRIBUTION_POSTES", "horaire", pid,
                        f"Attribution automatique des postes : {assigned} quart(s) (semaine du {payload.week_start})", pid)
    return {"assigned": assigned, "week_start": payload.week_start}


# ==================== Congés (serveur, Loi 25) ====================

LEAVE_TYPES_BE = ("Vacances", "Maladie", "Mobile", "Personnel", "Formation")
LEAVE_ALLOC_TYPES = ("Vacances", "Maladie", "Mobile")


class LeaveRequestIn(BaseModel):
    employee_id: str = ""
    employee_name: str = ""
    type: str
    start_date: str
    end_date: str
    reason: str = ""


class LeaveDecideIn(BaseModel):
    action: str
    note: str = ""


class LeaveAllocationsIn(BaseModel):
    employee_name: str = ""
    allocations: dict


class LeaveBulkIn(BaseModel):
    requests: list


def _leave_days(start: str, end: str) -> float:
    return float((date.fromisoformat(end) - date.fromisoformat(start)).days + 1)


def _validate_leave_dates(start: str, end: str) -> None:
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Dates invalides (AAAA-MM-JJ).")
    if e < s:
        raise HTTPException(status_code=400, detail="La date de fin doit être après le début.")
    if (e - s).days > 365:
        raise HTTPException(status_code=400, detail="Durée maximale : 365 jours.")


async def _mark_leaves_ready(pid: str) -> None:
    await db.schedule_settings.update_one(
        {"pharmacy_id": pid}, {"$set": {"pharmacy_id": pid, "leaves_server_ready": True}}, upsert=True)


async def _notify_admins(pid: str, title: str, detail: str, module: str = "vacations", tone: str = "amber") -> None:
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_roles": ["admin", "manager"],
        "title": title, "detail": detail, "module": module, "icon": "leave",
        "tone": tone, "created_at": datetime.now(timezone.utc).isoformat()})


def _inclusive_dates(start: str, end: str) -> list:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    out = []
    cur = s
    while cur <= e:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


async def _approved_leave_on(pid: str, employee_id: str, day: str) -> Optional[dict]:
    if not employee_id:
        return None
    return await db.leave_requests.find_one({
        "pharmacy_id": pid, "employee_id": employee_id, "status": "Approuvée",
        "start_date": {"$lte": day}, "end_date": {"$gte": day}}, {"_id": 0, "id": 1, "type": 1})


async def _vacate_shifts_for_leave(pid: str, leave_doc: dict, actor: str) -> dict:
    """Retire les quarts de l'employé en congé et ouvre des quarts à combler."""
    days = _inclusive_dates(leave_doc["start_date"], leave_doc["end_date"])
    shifts = await db.shifts.find(
        {"pharmacy_id": pid, "employee_id": leave_doc["employee_id"], "date": {"$in": days}},
        {"_id": 0}).to_list(500)
    opened = []
    for sh in shifts:
        os_doc = {
            "id": str(uuid.uuid4()), "pharmacy_id": pid, "date": sh["date"],
            "start": sh.get("start") or "09:00", "end": sh.get("end") or "17:00",
            "department": sh.get("department") if sh.get("department") in DEPARTMENTS_BE else "Général",
            "branch_id": sh.get("branch_id") or "", "positions": [],
            "note": f"Libéré : congé {leave_doc.get('type') or ''} de {leave_doc.get('employee_name') or leave_doc['employee_id']}",
            "status": "open", "mode": "premier_arrive", "applicants": [],
            "claimed_by": None, "claimed_by_name": None, "claimed_at": None,
            "created_by": actor, "created_at": datetime.now(timezone.utc).isoformat(),
            "source_leave_id": leave_doc.get("id"), "source_shift_id": sh.get("id"),
        }
        await db.open_shifts.insert_one({**os_doc})
        opened.append(os_doc)
        await db.shifts.delete_one({"id": sh["id"], "pharmacy_id": pid})
    if shifts:
        await _mark_shifts_ready(pid)
        await _notify_admins(
            pid, "Quarts libérés par un congé",
            f"{leave_doc.get('employee_name') or leave_doc['employee_id']} : {len(opened)} quart(s) ouvert(s) "
            f"du {leave_doc['start_date']} au {leave_doc['end_date']}.",
            module="scheduling", tone="amber")
    return {"removed": len(shifts), "open_shifts": len(opened)}


async def _auto_replacement_for_leave(pid: str, leave_doc: dict, actor: str) -> Optional[dict]:
    """Crée une demande d'agence si l'officine a des partenaires pour le rôle."""
    prof = await db.employee_profiles.find_one(
        {"pharmacy_id": pid, "employee_id": leave_doc["employee_id"]},
        {"_id": 0, "roles": 1, "department": 1}) or {}
    role = (prof.get("roles") or ["ATP"])[0] if (prof.get("roles") or ["ATP"]) else "ATP"
    agencies = await db.agencies.find(
        {"$or": [{"pharmacy_id": pid}, {"pharmacy_id": ""}, {"global": True}], "roles": role},
        {"_id": 0, "id": 1}).to_list(5)
    partners = await db.global_partners.find({"roles": role}, {"_id": 0, "id": 1}).to_list(5)
    if not agencies and not partners:
        return None
    days = _inclusive_dates(leave_doc["start_date"], leave_doc["end_date"])
    # plages = quarts libérés s'il y en a, sinon journée type 09-17
    vacated = await db.open_shifts.find(
        {"pharmacy_id": pid, "source_leave_id": leave_doc.get("id")}, {"_id": 0}).to_list(50)
    if vacated:
        slots = [{"date": s["date"], "start": s["start"], "end": s["end"]} for s in vacated]
    else:
        slots = [{"date": d, "start": "09:00", "end": "17:00"} for d in days[:14]]
    payload = ReplacementRequestIn(
        role=str(role)[:60],
        slots=[ReplacementSlot(**s) for s in slots],
        notes=f"Congé {leave_doc.get('type') or ''} — {leave_doc.get('employee_name') or leave_doc['employee_id']}",
        urgency="Urgente" if len(days) <= 3 else "Normale",
        public_base_url=os.environ.get("PUBLIC_APP_URL", "https://arriereplanrh.com"),
    )
    # réutilise la création officielle (courriels agences)
    fake_principal = {"email": actor, "role": "admin", "pharmacy_id": pid}
    # inlining minimal insert to avoid circular call issues with Depends
    token = secrets.token_urlsafe(24)
    link = f"{payload.public_base_url.rstrip('/')}/?remplacement={token}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "role": payload.role,
        "slots": [s.model_dump() for s in payload.slots], "notes": payload.notes,
        "urgency": payload.urgency, "status": "open", "token": token, "link": link,
        "chosen_offer_id": None, "emails_sent": 0, "source_leave_id": leave_doc.get("id"),
        "created_by": actor, "created_at": now, "updated_at": now,
    }
    await db.replacement_requests.insert_one({**doc})
    await _notify_admins(pid, "Demande de remplacement ouverte",
                         f"{payload.role} — {len(payload.slots)} plage(s) suite au congé de "
                         f"{leave_doc.get('employee_name') or leave_doc['employee_id']}.",
                         module="replacements", tone="sky")
    return {"id": doc["id"], "link": link, "role": payload.role, "slots": len(payload.slots)}


def _leave_admin_view(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "pharmacy_id"}


def _leave_own_view(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("pharmacy_id", "history")}


async def _leave_remaining(pid: str, employee_id: str, ltype: str):
    bal = await db.leave_balances.find_one({"pharmacy_id": pid, "employee_id": employee_id}, {"_id": 0}) or {}
    alloc = (bal.get("allocations") or {}).get(ltype)
    if alloc is None:
        return None
    year = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).year
    carry_doc = bal.get("carryover") or {}
    extra = float((carry_doc.get("days") or {}).get(ltype, 0) or 0) if carry_doc.get("year") == year else 0.0
    docs = await db.leave_requests.find(
        {"pharmacy_id": pid, "employee_id": employee_id, "type": ltype, "status": "Approuvée",
         "start_date": {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"}},
        {"_id": 0, "days": 1}).to_list(500)
    used = sum(float(d.get("days") or 0) for d in docs)
    return round(float(alloc) + extra - used, 2)


@api_router.post("/leave/requests")
async def create_leave_request(payload: LeaveRequestIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    employee_id = payload.employee_id if (is_admin and payload.employee_id) else (user.get("employee_id") or "")
    if not employee_id:
        raise HTTPException(status_code=400, detail="Aucun employé associé à ce compte.")
    if payload.type not in LEAVE_TYPES_BE:
        raise HTTPException(status_code=400, detail="Type de congé invalide.")
    _validate_leave_dates(payload.start_date, payload.end_date)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": employee_id,
        "employee_name": payload.employee_name.strip()[:80],
        "type": payload.type, "start_date": payload.start_date, "end_date": payload.end_date,
        "days": _leave_days(payload.start_date, payload.end_date),
        "reason": payload.reason.strip()[:1000],
        "status": "En attente", "created_at": now, "decided_at": None, "decided_by": "",
        "history": [{"action": "soumission", "by": user["email"], "role": user["role"], "at": now}],
    }
    await db.leave_requests.insert_one({**doc})
    await _mark_leaves_ready(pid)
    await _notify_admins(pid, "Nouvelle demande de congé",
                         f"{doc['employee_name'] or employee_id} — {doc['type']}, du {doc['start_date']} "
                         f"au {doc['end_date']} ({doc['days']:g} j) — à approuver")
    await log_audit(user["email"], user["role"], "CONGE_SOUMIS", "conge", doc["id"],
                    f"Demande {doc['type']} du {doc['start_date']} au {doc['end_date']} "
                    f"pour {doc['employee_name'] or employee_id}", pid)
    return _leave_own_view(doc)


@api_router.get("/leave/requests")
async def list_leave_requests(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    if user["role"] in ("admin", "manager", "superadmin"):
        docs = await db.leave_requests.find({"pharmacy_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return [_leave_admin_view(d) for d in docs]
    eid = user.get("employee_id") or "__none__"
    docs = await db.leave_requests.find({"pharmacy_id": pid, "employee_id": eid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_leave_own_view(d) for d in docs]


@api_router.post("/leave/requests/{req_id}/decide")
async def decide_leave_request(req_id: str, payload: LeaveDecideIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if payload.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Action invalide (approve ou reject).")
    doc = await db.leave_requests.find_one({"id": req_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    if doc["status"] != "En attente":
        raise HTTPException(status_code=400, detail="Cette demande a déjà été traitée.")
    now = datetime.now(timezone.utc).isoformat()
    status = "Approuvée" if payload.action == "approve" else "Refusée"
    note = payload.note.strip()[:300]
    entry = {"action": "approbation" if payload.action == "approve" else "refus",
             "by": principal["email"], "role": principal["role"], "at": now, "note": note}
    await db.leave_requests.update_one(
        {"id": req_id, "pharmacy_id": pid},
        {"$set": {"status": status, "decided_at": now, "decided_by": principal["email"]},
         "$push": {"history": entry}})
    await _notify_shift_change(
        pid, doc["employee_id"], f"Demande de congé {status.lower()}",
        f"Votre demande du {doc['start_date']} au {doc['end_date']} a été {status.lower()}."
        + (f" Note : {note}" if note else ""),
        "emerald" if status == "Approuvée" else "red", module="vacations", icon="leave")
    remaining = await _leave_remaining(pid, doc["employee_id"], doc["type"]) if status == "Approuvée" else None
    gaps = {"removed": 0, "open_shifts": 0}
    replacement = None
    if status == "Approuvée":
        gaps = await _vacate_shifts_for_leave(pid, doc, principal["email"])
        if gaps.get("open_shifts"):
            try:
                replacement = await _auto_replacement_for_leave(pid, doc, principal["email"])
            except Exception as exc:
                logger.error(f"Auto-remplacement congé {req_id} : {exc}")
    await log_audit(principal["email"], principal["role"],
                    "CONGE_APPROUVE" if status == "Approuvée" else "CONGE_REFUSE", "conge", req_id,
                    f"Demande {doc['type']} du {doc['start_date']} au {doc['end_date']} de "
                    f"{doc.get('employee_name') or doc['employee_id']} : {status}"
                    + (f" — {gaps['open_shifts']} quart(s) ouvert(s)" if gaps.get("open_shifts") else ""), pid)
    return {"status": status, "remaining": remaining, "gaps": gaps, "replacement": replacement}


@api_router.delete("/leave/requests/{req_id}")
async def cancel_leave_request(req_id: str, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.leave_requests.find_one({"id": req_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    if not is_admin and doc["employee_id"] != (user.get("employee_id") or ""):
        raise HTTPException(status_code=403, detail="Accès refusé.")
    if doc["status"] != "En attente" and not is_admin:
        raise HTTPException(status_code=400, detail="Seules les demandes en attente peuvent être annulées.")
    now = datetime.now(timezone.utc).isoformat()
    await db.leave_requests.update_one(
        {"id": req_id, "pharmacy_id": pid},
        {"$set": {"status": "Annulée"},
         "$push": {"history": {"action": "annulation", "by": user["email"], "role": user["role"], "at": now}}})
    await log_audit(user["email"], user["role"], "CONGE_ANNULE", "conge", req_id,
                    f"Demande du {doc['start_date']} au {doc['end_date']} annulée", pid)
    return {"status": "Annulée"}


@api_router.get("/leave/absences")
async def list_leave_absences(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    settings = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0, "leaves_server_ready": 1}) or {}
    docs = await db.leave_requests.find({"pharmacy_id": pid, "status": "Approuvée"}, {"_id": 0}).to_list(3000)
    items = [{"id": d["id"], "employee_id": d["employee_id"], "employee_name": d.get("employee_name", ""),
              "start_date": d["start_date"], "end_date": d["end_date"],
              "type": d["type"] if is_admin else "Absence"} for d in docs]
    return {"items": items, "migrated": bool(settings.get("leaves_server_ready"))}


@api_router.get("/leave/balances")
async def list_leave_balances(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    eid = user.get("employee_id") or "__none__"
    year = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).year
    q: dict = {"pharmacy_id": pid, "status": "Approuvée",
               "start_date": {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"}}
    bq: dict = {"pharmacy_id": pid}
    if not is_admin:
        q["employee_id"] = eid
        bq["employee_id"] = eid
    approved = await db.leave_requests.find(q, {"_id": 0}).to_list(3000)
    bals = await db.leave_balances.find(bq, {"_id": 0}).to_list(1000)
    used_map: dict = {}
    for d in approved:
        used_map.setdefault(d["employee_id"], {})
        used_map[d["employee_id"]][d["type"]] = used_map[d["employee_id"]].get(d["type"], 0) + float(d.get("days") or 0)
    bal_by = {b["employee_id"]: b for b in bals}
    out = []
    for emp_id in sorted(set(bal_by) | set(used_map)):
        b = bal_by.get(emp_id) or {}
        alloc = b.get("allocations") or {}
        carry_doc = b.get("carryover") or {}
        carry = (carry_doc.get("days") or {}) if carry_doc.get("year") == year else {}
        used = used_map.get(emp_id, {})
        alloc_eff = {t: float(alloc.get(t, 0)) + float(carry.get(t, 0) or 0) for t in LEAVE_ALLOC_TYPES}
        out.append({"employee_id": emp_id,
                    "employee_name": b.get("employee_name", ""),
                    "allocations": alloc_eff,
                    "carryover": {t: float(carry.get(t, 0) or 0) for t in LEAVE_ALLOC_TYPES},
                    "used": {t: round(used.get(t, 0), 2) for t in LEAVE_ALLOC_TYPES},
                    "remaining": {t: round(alloc_eff[t] - used.get(t, 0), 2) for t in LEAVE_ALLOC_TYPES},
                    "year": year})
    return out


@api_router.put("/leave/allocations/{employee_id}")
async def set_leave_allocations(employee_id: str, payload: LeaveAllocationsIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    alloc = {}
    for t, v in (payload.allocations or {}).items():
        if t not in LEAVE_ALLOC_TYPES:
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Allocation invalide.")
        if not (0 <= n <= 365):
            raise HTTPException(status_code=400, detail="Allocation invalide (0 à 365 jours).")
        alloc[t] = round(n, 1)
    await db.leave_balances.update_one(
        {"pharmacy_id": pid, "employee_id": employee_id},
        {"$set": {"pharmacy_id": pid, "employee_id": employee_id,
                  "employee_name": payload.employee_name.strip()[:80], "allocations": alloc,
                  "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await log_audit(principal["email"], principal["role"], "ALLOCATION_CONGES", "conge", employee_id,
                    f"Allocations de congés {alloc} pour {payload.employee_name or employee_id}", pid)
    return {"employee_id": employee_id, "allocations": alloc}


@api_router.post("/leave/bulk-import")
async def bulk_import_leaves(payload: LeaveBulkIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if len(payload.requests) > 1000:
        raise HTTPException(status_code=400, detail="Maximum 1000 demandes par import.")
    now = datetime.now(timezone.utc).isoformat()
    count = 0
    for r in payload.requests:
        if not isinstance(r, dict):
            continue
        start = str(r.get("start_date") or "")
        end = str(r.get("end_date") or "")
        try:
            _validate_leave_dates(start, end)
        except HTTPException:
            continue
        rid = str(r.get("id") or uuid.uuid4())
        doc = {
            "id": rid, "pharmacy_id": pid, "employee_id": str(r.get("employee_id") or ""),
            "employee_name": str(r.get("employee_name") or "")[:80],
            "type": r.get("type") if r.get("type") in LEAVE_TYPES_BE else "Mobile",
            "start_date": start, "end_date": end, "days": _leave_days(start, end),
            "reason": str(r.get("reason") or "")[:1000],
            "status": r.get("status") if r.get("status") in ("En attente", "Approuvée", "Refusée") else "En attente",
            "created_at": now, "decided_at": None, "decided_by": "",
            "history": [{"action": "migration", "by": principal["email"], "role": principal["role"], "at": now}],
        }
        await db.leave_requests.update_one({"id": rid, "pharmacy_id": pid}, {"$setOnInsert": doc}, upsert=True)
        count += 1
    await _mark_leaves_ready(pid)
    await log_audit(principal["email"], principal["role"], "IMPORT_CONGES", "conge", pid,
                    f"Migration du registre des congés : {count} demande(s) importées", pid)
    return {"imported": count}


class LeavePolicyIn(BaseModel):
    carryover_enabled: bool = False
    carryover_max_days: float = 0
    types: list = ["Vacances"]


@api_router.get("/leave/policy")
async def get_leave_policy(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.leave_policies.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    return {"carryover_enabled": bool(doc.get("carryover_enabled")),
            "carryover_max_days": float(doc.get("carryover_max_days") or 0),
            "types": doc.get("types") or ["Vacances"]}


@api_router.put("/leave/policy")
async def set_leave_policy(payload: LeavePolicyIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if not (0 <= payload.carryover_max_days <= 365):
        raise HTTPException(status_code=400, detail="Plafond invalide (0 à 365 jours).")
    types = [t for t in payload.types if t in LEAVE_ALLOC_TYPES]
    if payload.carryover_enabled and not types:
        raise HTTPException(status_code=400, detail="Choisissez au moins un type de congé à reporter.")
    await db.leave_policies.update_one(
        {"pharmacy_id": pid},
        {"$set": {"pharmacy_id": pid, "carryover_enabled": payload.carryover_enabled,
                  "carryover_max_days": round(float(payload.carryover_max_days), 1), "types": types,
                  "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await log_audit(principal["email"], principal["role"], "POLITIQUE_REPORT_CONGES", "conge", pid,
                    f"Report de soldes {'activé' if payload.carryover_enabled else 'désactivé'} — "
                    f"plafond {payload.carryover_max_days:g} j, types {types}", pid)
    return {"ok": True}


async def _used_leave_days(pid: str, employee_id: str, ltype: str, year: int) -> float:
    docs = await db.leave_requests.find(
        {"pharmacy_id": pid, "employee_id": employee_id, "type": ltype, "status": "Approuvée",
         "start_date": {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"}},
        {"_id": 0, "days": 1}).to_list(500)
    return sum(float(d.get("days") or 0) for d in docs)


async def run_leave_carryover(pid: str, year: int, actor: str = "cron", role: str = "system") -> dict:
    policy = await db.leave_policies.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    if not policy.get("carryover_enabled"):
        return {"processed": 0, "details": [], "skipped": "politique désactivée"}
    types = [t for t in (policy.get("types") or []) if t in LEAVE_ALLOC_TYPES]
    max_days = float(policy.get("carryover_max_days") or 0)
    bals = await db.leave_balances.find({"pharmacy_id": pid}, {"_id": 0}).to_list(1000)
    details = []
    for bal in bals:
        prev_carry = bal.get("carryover") or {}
        if prev_carry.get("year") == year:
            continue
        alloc = bal.get("allocations") or {}
        prev_extra = (prev_carry.get("days") or {}) if prev_carry.get("year") == year - 1 else {}
        carried = {}
        for t in types:
            alloc_prev = float(alloc.get(t, 0)) + float(prev_extra.get(t, 0) or 0)
            used_prev = await _used_leave_days(pid, bal["employee_id"], t, year - 1)
            carry = max(0.0, alloc_prev - used_prev)
            if max_days > 0:
                carry = min(carry, max_days)
            carried[t] = round(carry, 1)
        await db.leave_balances.update_one(
            {"pharmacy_id": pid, "employee_id": bal["employee_id"]},
            {"$set": {"carryover": {"year": year, "days": carried,
                                    "applied_at": datetime.now(timezone.utc).isoformat(), "by": actor}}})
        if sum(carried.values()) > 0:
            await _notify_shift_change(
                pid, bal["employee_id"], "Report de soldes de congés",
                f"Jours non utilisés de {year - 1} reportés : "
                + ", ".join(f"{t} +{n:g} j" for t, n in carried.items() if n > 0) + ".",
                "emerald", module="vacations", icon="leave")
        details.append({"employee_id": bal["employee_id"],
                        "employee_name": bal.get("employee_name", ""), "carried": carried})
    await log_audit(actor, role, "REPORT_SOLDES_CONGES", "conge", pid,
                    f"Report des soldes {year - 1}→{year} : {len(details)} employé(s) traités", pid)
    return {"processed": len(details), "details": details}


@api_router.post("/leave/carryover/run")
async def run_carryover_endpoint(year: int = Query(0), principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    target = year or datetime.now(timezone.utc).astimezone(MONTREAL_TZ).year
    if not (2020 <= target <= 2100):
        raise HTTPException(status_code=400, detail="Année invalide.")
    return await run_leave_carryover(pid, target, principal["email"], principal["role"])


async def leave_carryover_job():
    year = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).year
    async for policy in db.leave_policies.find({"carryover_enabled": True}, {"_id": 0, "pharmacy_id": 1}):
        res = await run_leave_carryover(policy["pharmacy_id"], year)
        logger.info(f"Report de soldes {policy['pharmacy_id']} : {res.get('processed', 0)} employé(s)")


# ---------------------------------------------------------------------------
# Avantages sociaux
# ---------------------------------------------------------------------------
BENEFIT_CATEGORIES = ("Santé", "Dentaire", "Vision", "Retraite & épargne", "Congés & vacances",
                      "Rabais employés", "Formation & développement", "Bien-être", "Assurances", "Autre")

BENEFITS_SYSTEM = """Tu es un expert RH québécois. On te fournit le texte d'un document d'avantages sociaux d'une compagnie (pharmacie). Transforme-le en cartes d'avantages claires et chaleureuses pour les employés.
Réponds UNIQUEMENT en JSON strict :
{"benefits": [{"title": "titre court et clair", "description": "2 à 3 phrases simples et engageantes en français expliquant l'avantage et comment en profiter", "category": "une valeur parmi : Santé, Dentaire, Vision, Retraite & épargne, Congés & vacances, Rabais employés, Formation & développement, Bien-être, Assurances, Autre", "details": ["3 à 6 points concrets (montants, pourcentages, conditions, admissibilité)"], "eligible_roles": [], "monthly_value": "ex.: Employeur paie 50 % — ou chaîne vide"}]}
Règles : eligible_roles reste vide (= tous les employés) SAUF si le document réserve clairement l'avantage à certains postes; utilise alors uniquement ces valeurs exactes : Pharmacien(ne), ATP, Technicien(ne) de laboratoire, Infirmier(ère), Gestionnaire, Commis, Caissier(ère), Commis d'entrepôt, Livreur(se). Regroupe intelligemment (maximum 20 avantages). N'invente aucun montant."""


class BenefitIn(BaseModel):
    title: str
    description: str = ""
    category: str = "Autre"
    details: list = []
    eligible_roles: list = []
    monthly_value: str = ""


class BenefitUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    details: Optional[list] = None
    eligible_roles: Optional[list] = None
    monthly_value: Optional[str] = None
    status: Optional[str] = None


def benefit_public(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "image_b64")}


def _clean_benefit_fields(title: str, description: str, category: str, details: list,
                          eligible_roles: list, monthly_value: str) -> dict:
    return {
        "title": title.strip()[:120],
        "description": description.strip()[:2000],
        "category": category if category in BENEFIT_CATEGORIES else "Autre",
        "details": [str(x).strip()[:300] for x in details if str(x).strip()][:12],
        "eligible_roles": [str(x).strip()[:60] for x in eligible_roles if str(x).strip()][:15],
        "monthly_value": monthly_value.strip()[:120],
    }


async def generate_benefit_image(benefit_id: str, title: str, category: str):
    try:
        chat = LlmChat(
            api_key=os.environ['EMERGENT_LLM_KEY'],
            session_id=f"benefit-img-{benefit_id}",
            system_message="Tu génères des illustrations professionnelles.",
        ).with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
        prompt = (
            f"Illustration moderne et chaleureuse représentant un avantage social offert aux employés d'une pharmacie : « {title} » (catégorie : {category}). "
            "Style flat design premium et éditorial, palette vert émeraude (#059669) et bronze doré (#c36030) sur fond crème très pâle, "
            "formes douces et arrondies, personnages stylisés inclusifs, composition aérée, AUCUN texte, AUCUNE lettre, AUCUN chiffre dans l'image. Format paysage."
        )
        _, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
        if not images:
            raise ValueError("Aucune image générée")
        await db.benefits.update_one({"id": benefit_id}, {"$set": {
            "image_b64": images[0]["data"], "image_mime": images[0].get("mime_type") or "image/png",
            "image_status": "done", "updated_at": datetime.now(timezone.utc).isoformat()}})
    except Exception as exc:
        logger.error(f"Image avantage {benefit_id} : {exc}")
        await db.benefits.update_one({"id": benefit_id}, {"$set": {"image_status": "error"}})


async def process_benefits_import(job_id: str, pid: str, text: str, actor_email: str, actor_role: str):
    try:
        llm = LlmChat(
            api_key=os.environ['EMERGENT_LLM_KEY'],
            session_id=f"benefits-{job_id}",
            system_message=BENEFITS_SYSTEM,
        ).with_model("openai", "gpt-5.4")
        resp = await llm.send_message(UserMessage(
            text=f"Voici le texte extrait du document d'avantages sociaux de la compagnie :\n\n{text[:100000]}"))
        raw = resp if isinstance(resp, str) else getattr(resp, "content", None) or str(resp)
        data = parse_llm_json(raw)
        now = datetime.now(timezone.utc).isoformat()
        count = 0
        for b in (data.get("benefits") or [])[:20]:
            fields = _clean_benefit_fields(str(b.get("title") or ""), str(b.get("description") or ""),
                                           str(b.get("category") or "Autre"), b.get("details") or [],
                                           b.get("eligible_roles") or [], str(b.get("monthly_value") or ""))
            if not fields["title"]:
                continue
            doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, **fields,
                   "status": "draft", "source": "pdf", "image_status": "pending",
                   "created_by": actor_email, "created_at": now, "updated_at": now}
            await db.benefits.insert_one(doc)
            asyncio.create_task(generate_benefit_image(doc["id"], doc["title"], doc["category"]))
            count += 1
        if count == 0:
            raise ValueError("Aucun avantage reconnu dans ce document")
        await db.benefit_imports.update_one({"id": job_id}, {"$set": {"status": "done", "created_count": count}})
        await log_audit(actor_email, actor_role, "IMPORT_AVANTAGES", "avantage", job_id,
                        f"{count} avantage(s) créés par IA à partir d'un PDF", pid)
    except Exception as exc:
        logger.error(f"Import avantages {job_id} : {exc}")
        await db.benefit_imports.update_one({"id": job_id}, {"$set": {"status": "error", "error": str(exc)}})


@api_router.post("/benefits/upload")
async def upload_benefits_pdf(file: UploadFile = File(...), principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Format non autorisé : déposez le document d'avantages en PDF.")
    data = await file.read()
    if len(data) > TRAINING_MAX_SIZE:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (maximum 15 Mo).")
    try:
        text = await asyncio.to_thread(extract_pdf_text, data)
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de lire ce PDF.")
    if len(text.strip()) < 200:
        raise HTTPException(status_code=400, detail="Ce PDF ne contient pas assez de texte lisible (document numérisé en image ?).")
    job = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "status": "processing", "created_count": 0,
           "error": None, "filename": file.filename, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.benefit_imports.insert_one(job)
    asyncio.create_task(process_benefits_import(job["id"], pid, text, principal["email"], principal["role"]))
    return {"job_id": job["id"], "status": "processing"}


@api_router.get("/benefits/imports/{job_id}")
async def get_benefits_import(job_id: str, principal: dict = Depends(get_principal)):
    doc = await db.benefit_imports.find_one({"id": job_id, "pharmacy_id": scoped_pid(principal)}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Import introuvable.")
    return doc


@api_router.get("/benefits")
async def list_benefits(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    q: dict = {"pharmacy_id": pid}
    if user["role"] not in ("admin", "manager", "superadmin"):
        q["status"] = "published"
    return await db.benefits.find(q, {"_id": 0, "image_b64": 0}).sort("created_at", -1).to_list(300)


@api_router.post("/benefits")
async def create_benefit(payload: BenefitIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    fields = _clean_benefit_fields(payload.title, payload.description, payload.category,
                                   payload.details, payload.eligible_roles, payload.monthly_value)
    if not fields["title"]:
        raise HTTPException(status_code=400, detail="Le titre de l'avantage est requis.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, **fields,
           "status": "draft", "source": "manuel", "image_status": "pending",
           "created_by": principal["email"], "created_at": now, "updated_at": now}
    await db.benefits.insert_one(doc)
    asyncio.create_task(generate_benefit_image(doc["id"], doc["title"], doc["category"]))
    await log_audit(principal["email"], principal["role"], "CREATION_AVANTAGE", "avantage", doc["id"],
                    f"Avantage « {doc['title']} » créé manuellement", pid)
    return benefit_public(doc)


@api_router.put("/benefits/{benefit_id}")
async def update_benefit(benefit_id: str, payload: BenefitUpdateIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.benefits.find_one({"id": benefit_id, "pharmacy_id": pid}, {"_id": 0, "image_b64": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Avantage introuvable.")
    updates: dict = {}
    if payload.title is not None or payload.description is not None or payload.category is not None \
            or payload.details is not None or payload.eligible_roles is not None or payload.monthly_value is not None:
        fields = _clean_benefit_fields(
            payload.title if payload.title is not None else doc["title"],
            payload.description if payload.description is not None else doc.get("description", ""),
            payload.category if payload.category is not None else doc.get("category", "Autre"),
            payload.details if payload.details is not None else doc.get("details", []),
            payload.eligible_roles if payload.eligible_roles is not None else doc.get("eligible_roles", []),
            payload.monthly_value if payload.monthly_value is not None else doc.get("monthly_value", ""))
        if not fields["title"]:
            raise HTTPException(status_code=400, detail="Le titre de l'avantage est requis.")
        updates.update(fields)
    if payload.status is not None:
        if payload.status not in ("draft", "published"):
            raise HTTPException(status_code=400, detail="Statut invalide.")
        updates["status"] = payload.status
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.benefits.update_one({"id": benefit_id}, {"$set": updates})
    await log_audit(principal["email"], principal["role"], "MODIF_AVANTAGE", "avantage", benefit_id,
                    f"Avantage « {updates.get('title', doc['title'])} » mis à jour"
                    + (f" — statut {updates['status']}" if "status" in updates else ""), pid)
    fresh = await db.benefits.find_one({"id": benefit_id}, {"_id": 0, "image_b64": 0})
    return fresh


@api_router.delete("/benefits/{benefit_id}")
async def delete_benefit(benefit_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.benefits.find_one({"id": benefit_id, "pharmacy_id": pid}, {"_id": 0, "image_b64": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Avantage introuvable.")
    await db.benefits.delete_one({"id": benefit_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_AVANTAGE", "avantage", benefit_id,
                    f"Avantage « {doc['title']} » supprimé", pid)
    return {"ok": True}


@api_router.post("/benefits/{benefit_id}/generate-image")
async def regenerate_benefit_image(benefit_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.benefits.find_one({"id": benefit_id, "pharmacy_id": pid}, {"_id": 0, "image_b64": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Avantage introuvable.")
    await db.benefits.update_one({"id": benefit_id}, {"$set": {"image_status": "pending"}})
    asyncio.create_task(generate_benefit_image(benefit_id, doc["title"], doc.get("category", "Autre")))
    return {"ok": True}


@api_router.get("/benefits/{benefit_id}/image")
async def get_benefit_image(benefit_id: str, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    q: dict = {"id": benefit_id, "pharmacy_id": pid}
    if user["role"] not in ("admin", "manager", "superadmin"):
        q["status"] = "published"
    doc = await db.benefits.find_one(q, {"_id": 0, "image_b64": 1, "image_mime": 1})
    if not doc or not doc.get("image_b64"):
        raise HTTPException(status_code=404, detail="Aucune image pour cet avantage.")
    return Response(content=base64.b64decode(doc["image_b64"]),
                    media_type=doc.get("image_mime") or "image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


# ---------------------------------------------------------------------------
# Quarts ouverts (libre-service)
# ---------------------------------------------------------------------------
class OpenShiftIn(BaseModel):
    date: str
    start: str
    end: str
    department: str = "Général"
    branch_id: str = ""
    positions: list = []
    note: str = ""
    mode: str = "premier_arrive"


class OpenShiftClaimIn(BaseModel):
    position: str = ""
    employee_name: str = ""


@api_router.post("/open-shifts")
async def create_open_shift(payload: OpenShiftIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    _validate_shift_core(payload.date, payload.start, payload.end)
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "date": payload.date,
           "start": payload.start, "end": payload.end,
           "department": payload.department if payload.department in DEPARTMENTS_BE else "Général",
           "branch_id": payload.branch_id or "", "positions": [str(p)[:60] for p in payload.positions][:12],
           "note": (payload.note or "")[:300], "status": "open",
           "mode": payload.mode if payload.mode in ("premier_arrive", "anciennete") else "premier_arrive",
           "applicants": [],
           "claimed_by": None, "claimed_by_name": None, "claimed_at": None,
           "created_by": principal["email"], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.open_shifts.insert_one({**doc})
    pos_txt = f" — réservé : {', '.join(doc['positions'])}" if doc["positions"] else ""
    mode_txt = "Priorité à l'ancienneté — postulez !" if doc["mode"] == "anciennete" else "Premier arrivé, premier servi !"
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_roles": ["employee"],
        "title": "Nouveau quart à combler", "detail": f"{payload.date} de {payload.start} à {payload.end} ({doc['department']}){pos_txt}. {mode_txt}",
        "module": "scheduling", "icon": "schedule", "tone": "sky",
        "created_at": datetime.now(timezone.utc).isoformat()})
    await log_audit(principal["email"], principal["role"], "QUART_OUVERT_PUBLIE", "quart_ouvert", doc["id"],
                    f"Quart ouvert publié : {payload.date} {payload.start}-{payload.end} ({doc['department']})", pid)
    return doc


@api_router.get("/open-shifts")
async def list_open_shifts(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    docs = await db.open_shifts.find({"pharmacy_id": pid, "status": {"$ne": "cancelled"}}, {"_id": 0}) \
        .sort("date", 1).to_list(200)
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    out = []
    for d in docs:
        if d["status"] == "open" and d["date"] < today:
            continue
        if not is_admin and d["status"] == "claimed" and d.get("claimed_by") != user.get("employee_id"):
            continue
        if not is_admin:
            applicants = d.pop("applicants", None) or []
            d["applied"] = any(a.get("employee_id") == user.get("employee_id") for a in applicants)
            d["applicant_count"] = len(applicants)
        out.append(d)
    return out


async def _assign_open_shift(doc: dict, pid: str, emp_id: str, name: str, position: str, by: str) -> dict:
    claimed = await db.open_shifts.find_one_and_update(
        {"id": doc["id"], "pharmacy_id": pid, "status": "open"},
        {"$set": {"status": "claimed", "claimed_by": emp_id, "claimed_by_name": name,
                  "claimed_position": position or "",
                  "claimed_at": datetime.now(timezone.utc).isoformat()}},
        projection={"_id": 0})
    if not claimed:
        raise HTTPException(status_code=409, detail="Trop tard — ce quart vient d'être attribué.")
    shift_doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": emp_id,
                 "date": doc["date"], "start": doc["start"], "end": doc["end"],
                 "department": doc["department"], "resource_ids": [], "ai_generated": False,
                 "proposal_id": "", "branch_id": doc.get("branch_id") or "",
                 "notes": "Quart ouvert réclamé", "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.shifts.insert_one({**shift_doc})
    await _mark_shifts_ready(pid)
    await _notify_shift_change(pid, emp_id, "Quart confirmé",
                               f"Le quart du {doc['date']} de {doc['start']} à {doc['end']} ({doc['department']}) est à vous.",
                               "emerald", module="scheduling")
    await log_audit(by, "system", "QUART_OUVERT_RECLAME", "quart_ouvert", doc["id"],
                    f"{name} obtient le quart du {doc['date']} {doc['start']}-{doc['end']}", pid)
    return shift_doc


@api_router.post("/open-shifts/{os_id}/claim")
async def claim_open_shift(os_id: str, payload: OpenShiftClaimIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    emp_id = user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à votre compte.")
    doc = await db.open_shifts.find_one({"id": os_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Quart introuvable.")
    if doc["positions"] and payload.position and payload.position not in doc["positions"]:
        raise HTTPException(status_code=400, detail=f"Ce quart est réservé aux postes : {', '.join(doc['positions'])}.")
    leave = await db.leave_requests.find_one({
        "pharmacy_id": pid, "employee_id": emp_id, "status": "Approuvée",
        "start_date": {"$lte": doc["date"]}, "end_date": {"$gte": doc["date"]}}, {"_id": 0, "id": 1})
    if leave:
        raise HTTPException(status_code=400, detail="Vous êtes en congé approuvé ce jour-là.")
    name = payload.employee_name or user.get("name") or user["email"]
    if doc.get("mode") == "anciennete":
        if doc["status"] != "open":
            raise HTTPException(status_code=409, detail="Ce quart a déjà été attribué.")
        if any(a.get("employee_id") == emp_id for a in doc.get("applicants") or []):
            return {"ok": True, "applied": True, "already": True}
        prof = await db.employee_profiles.find_one({"pharmacy_id": pid, "employee_id": emp_id},
                                                   {"_id": 0, "hire_date": 1}) or {}
        applicant = {"employee_id": emp_id, "name": name, "position": payload.position or "",
                     "hire_date": prof.get("hire_date") or "",
                     "applied_at": datetime.now(timezone.utc).isoformat()}
        await db.open_shifts.update_one({"id": os_id, "pharmacy_id": pid, "status": "open"},
                                        {"$push": {"applicants": applicant}})
        await _notify_admins(pid, "Nouvelle candidature — quart par ancienneté",
                             f"{name} postule pour le quart du {doc['date']} de {doc['start']} à {doc['end']} ({doc['department']}).",
                             module="scheduling", tone="sky")
        await log_audit(user["email"], user["role"], "QUART_OUVERT_CANDIDATURE", "quart_ouvert", os_id,
                        f"{name} a postulé (mode ancienneté)", pid)
        return {"ok": True, "applied": True}
    shift_doc = await _assign_open_shift(doc, pid, emp_id, name, payload.position or "", user["email"])
    await _notify_admins(pid, "Quart ouvert réclamé",
                         f"{name} a pris le quart du {doc['date']} de {doc['start']} à {doc['end']} ({doc['department']}).",
                         module="scheduling", tone="emerald")
    return {"ok": True, "shift": shift_doc}


class OpenShiftAwardIn(BaseModel):
    employee_id: str


@api_router.post("/open-shifts/{os_id}/award")
async def award_open_shift(os_id: str, payload: OpenShiftAwardIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = await db.open_shifts.find_one({"id": os_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Quart introuvable.")
    applicant = next((a for a in doc.get("applicants") or [] if a.get("employee_id") == payload.employee_id), None)
    if not applicant:
        raise HTTPException(status_code=400, detail="Cet employé n'a pas postulé pour ce quart.")
    shift_doc = await _assign_open_shift(doc, pid, applicant["employee_id"], applicant["name"],
                                         applicant.get("position") or "", principal["email"])
    for a in doc.get("applicants") or []:
        if a["employee_id"] != applicant["employee_id"]:
            await _notify_shift_change(pid, a["employee_id"], "Quart attribué à un(e) collègue",
                                       f"Le quart du {doc['date']} de {doc['start']} à {doc['end']} a été attribué selon l'ancienneté.",
                                       "amber", module="scheduling")
    return {"ok": True, "shift": shift_doc}


@api_router.delete("/open-shifts/{os_id}")
async def cancel_open_shift(os_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    res = await db.open_shifts.update_one({"id": os_id, "pharmacy_id": pid, "status": "open"},
                                          {"$set": {"status": "cancelled"}})
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Quart introuvable ou déjà réclamé.")
    await log_audit(principal["email"], principal["role"], "QUART_OUVERT_RETIRE", "quart_ouvert", os_id,
                    "Quart ouvert retiré", pid)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sondages éclair & mur de reconnaissance
# ---------------------------------------------------------------------------
class PollIn(BaseModel):
    question: str
    options: list
    anonymous: bool = True


class PollVoteIn(BaseModel):
    option_id: str


@api_router.post("/polls")
async def create_poll(payload: PollIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    question = payload.question.strip()[:300]
    labels = [str(o).strip()[:120] for o in payload.options if str(o).strip()]
    if not question:
        raise HTTPException(status_code=400, detail="La question est requise.")
    if not (2 <= len(labels) <= 6):
        raise HTTPException(status_code=400, detail="Entre 2 et 6 choix de réponse.")
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "question": question,
           "options": [{"id": str(uuid.uuid4())[:8], "label": lb} for lb in labels],
           "anonymous": bool(payload.anonymous), "status": "open", "votes": [],
           "created_by": principal["email"], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.polls.insert_one({**doc})
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_roles": ["employee"],
        "title": "Nouveau sondage éclair", "detail": question, "module": "team", "icon": "poll",
        "tone": "sky", "created_at": datetime.now(timezone.utc).isoformat()})
    await log_audit(principal["email"], principal["role"], "CREATION_SONDAGE", "sondage", doc["id"], question, pid)
    return {k: v for k, v in doc.items() if k != "votes"}


def _poll_view(doc: dict, user: dict) -> dict:
    votes = doc.get("votes") or []
    my = next((v for v in votes if v["email"] == user["email"]), None)
    is_admin = user["role"] in ("admin", "manager", "superadmin")
    show_results = is_admin or my is not None or doc["status"] == "closed"
    counts = {o["id"]: 0 for o in doc["options"]}
    for v in votes:
        if v["option_id"] in counts:
            counts[v["option_id"]] += 1
    view = {"id": doc["id"], "question": doc["question"], "options": doc["options"],
            "anonymous": doc["anonymous"], "status": doc["status"],
            "created_at": doc["created_at"], "total_votes": len(votes),
            "my_vote": my["option_id"] if my else None,
            "results": counts if show_results else None}
    if is_admin and not doc["anonymous"]:
        view["voters"] = [{"name": v["name"], "option_id": v["option_id"]} for v in votes]
    return view


@api_router.get("/polls")
async def list_polls(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    docs = await db.polls.find({"pharmacy_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [_poll_view(d, user) for d in docs]


@api_router.post("/polls/{poll_id}/vote")
async def vote_poll(poll_id: str, payload: PollVoteIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.polls.find_one({"id": poll_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sondage introuvable.")
    if doc["status"] != "open":
        raise HTTPException(status_code=400, detail="Ce sondage est terminé.")
    if not any(o["id"] == payload.option_id for o in doc["options"]):
        raise HTTPException(status_code=400, detail="Choix invalide.")
    if any(v["email"] == user["email"] for v in (doc.get("votes") or [])):
        raise HTTPException(status_code=400, detail="Vous avez déjà voté.")
    await db.polls.update_one({"id": poll_id}, {"$push": {"votes": {
        "email": user["email"], "name": user.get("name") or user["email"],
        "option_id": payload.option_id, "at": datetime.now(timezone.utc).isoformat()}}})
    fresh = await db.polls.find_one({"id": poll_id}, {"_id": 0})
    return _poll_view(fresh, user)


@api_router.post("/polls/{poll_id}/close")
async def close_poll(poll_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    res = await db.polls.update_one({"id": poll_id, "pharmacy_id": pid}, {"$set": {"status": "closed"}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sondage introuvable.")
    return {"ok": True}


@api_router.delete("/polls/{poll_id}")
async def delete_poll(poll_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    res = await db.polls.delete_one({"id": poll_id, "pharmacy_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sondage introuvable.")
    return {"ok": True}


KUDOS_CATEGORIES = ("Merci", "Bravo", "Étoile du service", "Esprit d'équipe", "Dépassement")


class KudosIn(BaseModel):
    to_employee_id: str
    to_name: str
    category: str = "Bravo"
    message: str = ""


@api_router.post("/kudos")
async def create_kudos(payload: KudosIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    if not payload.to_employee_id or not payload.to_name.strip():
        raise HTTPException(status_code=400, detail="Choisissez un(e) collègue à féliciter.")
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid,
           "from_email": user["email"], "from_name": user.get("name") or user["email"],
           "from_employee_id": user.get("employee_id") or "",
           "to_employee_id": payload.to_employee_id, "to_name": payload.to_name.strip()[:80],
           "category": payload.category if payload.category in KUDOS_CATEGORIES else "Bravo",
           "message": payload.message.strip()[:400], "applause": [],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.kudos.insert_one({**doc})
    await _notify_shift_change(pid, payload.to_employee_id, f"{doc['category']} de {doc['from_name']} !",
                               doc["message"] or "Vous avez reçu une félicitation publique sur le mur d'équipe.",
                               "emerald", module="team", icon="kudos")
    return doc


@api_router.get("/kudos")
async def list_kudos(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    docs = await db.kudos.find({"pharmacy_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(60)
    return [{**d, "applause_count": len(d.get("applause") or []),
             "my_applause": user["email"] in (d.get("applause") or []),
             "applause": None} for d in docs]


@api_router.post("/kudos/{kudos_id}/applaud")
async def applaud_kudos(kudos_id: str, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.kudos.find_one({"id": kudos_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Félicitation introuvable.")
    applause = doc.get("applause") or []
    if user["email"] in applause:
        applause.remove(user["email"])
    else:
        applause.append(user["email"])
    await db.kudos.update_one({"id": kudos_id}, {"$set": {"applause": applause}})
    return {"applause_count": len(applause), "my_applause": user["email"] in applause}


@api_router.delete("/kudos/{kudos_id}")
async def delete_kudos(kudos_id: str, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.kudos.find_one({"id": kudos_id, "pharmacy_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Félicitation introuvable.")
    if user["role"] not in ("admin", "manager", "superadmin") and doc["from_email"] != user["email"]:
        raise HTTPException(status_code=403, detail="Réservé à l'auteur ou à l'administration.")
    await db.kudos.delete_one({"id": kudos_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Punch : réglages (arrondis, pauses)
# ---------------------------------------------------------------------------
async def get_punch_settings(pid: str) -> dict:
    doc = await db.punch_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    return {"rounding_minutes": int(doc.get("rounding_minutes") or 0),
            "rounding_mode": doc.get("rounding_mode") or "nearest",
            "breaks_paid": bool(doc.get("breaks_paid"))}


def _round_dt(dt: datetime, minutes: int, mode: str) -> datetime:
    if minutes <= 0:
        return dt
    secs = minutes * 60
    ts = dt.timestamp()
    if mode == "up":
        rounded = math.ceil(ts / secs) * secs
    elif mode == "down":
        rounded = math.floor(ts / secs) * secs
    else:
        rounded = round(ts / secs) * secs
    return datetime.fromtimestamp(rounded, tz=timezone.utc)


def punch_break_minutes(p: dict) -> float:
    total = 0.0
    for b in (p.get("breaks") or []):
        if b.get("start") and b.get("end"):
            total += (datetime.fromisoformat(b["end"]) - datetime.fromisoformat(b["start"])).total_seconds() / 60
    return round(total, 1)


def punch_hours(p: dict, settings: dict) -> float:
    if not p.get("punch_out"):
        return 0.0
    m = int(settings.get("rounding_minutes") or 0)
    mode = settings.get("rounding_mode") or "nearest"
    t_in = _round_dt(datetime.fromisoformat(p["punch_in"]), m, mode)
    t_out = _round_dt(datetime.fromisoformat(p["punch_out"]), m, mode)
    h = max(0.0, (t_out - t_in).total_seconds() / 3600)
    if not settings.get("breaks_paid"):
        h = max(0.0, h - punch_break_minutes(p) / 60)
    return h


class PunchSettingsIn(BaseModel):
    rounding_minutes: int = 0
    rounding_mode: str = "nearest"
    breaks_paid: bool = False


@api_router.get("/punch/settings")
async def read_punch_settings(principal: dict = Depends(get_principal)):
    return await get_punch_settings(scoped_pid(principal))


@api_router.put("/punch/settings")
async def write_punch_settings(payload: PunchSettingsIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if payload.rounding_minutes not in (0, 5, 10, 15):
        raise HTTPException(status_code=400, detail="Arrondi permis : 0, 5, 10 ou 15 minutes.")
    if payload.rounding_mode not in ("nearest", "up", "down"):
        raise HTTPException(status_code=400, detail="Mode d'arrondi invalide.")
    await db.punch_settings.update_one({"pharmacy_id": pid}, {"$set": {
        "pharmacy_id": pid, "rounding_minutes": payload.rounding_minutes,
        "rounding_mode": payload.rounding_mode, "breaks_paid": payload.breaks_paid,
        "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    mode_txt = {"nearest": "au plus proche", "up": "vers le haut", "down": "vers le bas"}[payload.rounding_mode]
    await log_audit(principal["email"], principal["role"], "REGLAGES_PUNCH", "punch", pid,
                    f"Arrondi {payload.rounding_minutes} min ({mode_txt}), pauses {'payées' if payload.breaks_paid else 'non payées'}", pid)
    return await get_punch_settings(pid)


async def do_break(pid: str, employee_id: str, employee_name: str, actor: str) -> dict:
    open_p = await db.punches.find_one(
        {"pharmacy_id": pid, "employee_id": employee_id, "punch_out": None}, {"_id": 0})
    if not open_p:
        raise HTTPException(status_code=400, detail="Aucun quart en cours — punchez votre entrée d'abord.")
    breaks = open_p.get("breaks") or []
    now = datetime.now(timezone.utc)
    if breaks and not breaks[-1].get("end"):
        mins = round((now - datetime.fromisoformat(breaks[-1]["start"])).total_seconds() / 60)
        breaks[-1]["end"] = now.isoformat()
        action, detail = "break_end", f"{employee_name} — fin de pause ({mins} min)"
    else:
        breaks.append({"start": now.isoformat(), "end": None})
        action, detail = "break_start", f"{employee_name} — début de pause"
    await db.punches.update_one({"id": open_p["id"]}, {"$set": {"breaks": breaks}})
    await log_audit(actor, "system", "PUNCH_PAUSE", "punch", open_p["id"], detail, pid)
    return {"action": action, "employee_name": employee_name, "time": now.isoformat()}


@api_router.post("/punch/break")
async def punch_break_by_code(payload: PunchCodeIn, request: Request):
    identifier = await punch_throttle_check(request)
    prof = await resolve_punch_code(payload.code.strip(), identifier)
    return await do_break(prof["pharmacy_id"], prof["employee_id"], prof.get("employee_name", ""), "borne")


@api_router.post("/punch/me/break")
async def punch_break_me(user: dict = Depends(get_current_user)):
    if not user.get("employee_id"):
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à votre compte.")
    return await do_break(user.get("pharmacy_id") or "", user["employee_id"], user["name"], user["email"])


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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    if not doc or doc["pharmacy_id"] != (scoped_pid(principal)):
        raise HTTPException(status_code=404, detail="Modèle introuvable.")
    await db.schedule_templates.delete_one({"id": template_id})
    await log_audit(principal["email"], principal["role"], "SUPPRESSION_MODELE_HORAIRE", "horaire", template_id,
                    f"Modèle « {doc['name']} » supprimé", doc["pharmacy_id"])
    return {"status": "supprimé"}


# ==================== Notifications & publication d'horaire ====================

@api_router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    ors = [{"target_email": user["email"]}, {"target_roles": user["role"]}]
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(user)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
    settings = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    weekly_budget = settings.get("weekly_budget", 0)
    punches = await db.punches.find(
        {"pharmacy_id": pid, "date": {"$gte": start, "$lte": end}, "punch_out": {"$ne": None}},
        {"_id": 0}).to_list(5000)
    profiles = await db.employee_profiles.find(
        {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "hourly_rate": 1}).to_list(500)
    rate_by = {p["employee_id"]: p.get("hourly_rate") for p in profiles}
    p_settings = await get_punch_settings(pid)
    per: dict = {}
    for p in punches:
        try:
            h = punch_hours(p, p_settings)
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
    if convo["pharmacy_id"] != (scoped_pid(user)):
        return False
    if convo["type"] == "equipe":
        return True
    if convo["type"] == "gestionnaires":
        return user["role"] in ("admin", "manager", "superadmin")
    return user["email"] in convo.get("participants", [])


@api_router.get("/chat/users")
async def chat_users(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    return await db.users.find(
        {"pharmacy_id": pid, "role": {"$in": ["admin", "manager", "employee"]}},
        {"_id": 0, "email": 1, "name": 1, "role": 1, "employee_id": 1}).sort("name", 1).to_list(300)


@api_router.post("/chat/conversations")
async def create_conversation(payload: ConversationIn, principal: dict = Depends(get_principal)):
    if payload.type not in CONVERSATION_TYPES:
        raise HTTPException(status_code=400, detail="Type de conversation invalide.")
    pid = scoped_pid(principal)
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
    pid = scoped_pid(user)
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
    if not msg or msg["pharmacy_id"] != (scoped_pid(principal)):
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
    if not convo or convo["pharmacy_id"] != (scoped_pid(principal)):
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
    employees: list[RosterEmployee] = []
    absences: list[AbsenceIn] = []
    weekly_budget: float = -1
    department: str = ""
    existing_mode: str = "adjust"
    existing_shifts: list = []


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


def _priorities_text(pr: dict) -> object:
    if not pr or not any((pr.get("dept_order"), pr.get("employee_type"), pr.get("availability"), pr.get("extra"))):
        return "Aucune priorité particulière — applique les règles par défaut (priorité Laboratoire et caisse)."
    lines = []
    if pr.get("dept_order"):
        lines.append("Ordre de priorité des départements : " + " > ".join(pr["dept_order"]) + " (couvre-les dans cet ordre)")
    if pr.get("employee_type") == "full_time":
        lines.append("Prioriser les employés à TEMPS PLEIN (≈30 h et plus/semaine selon le profil) dans l'attribution des heures.")
    elif pr.get("employee_type") == "part_time":
        lines.append("Prioriser les employés à TEMPS PARTIEL (moins de 30 h/semaine selon le profil) dans l'attribution des heures.")
    if pr.get("availability") == "most":
        lines.append("Prioriser les employés offrant les PLUS GRANDES disponibilités (plus de jours/plages disponibles = plus d'heures).")
    elif pr.get("availability") == "least":
        lines.append("Placer D'ABORD les employés aux disponibilités les plus RESTREINTES (les caser en premier), puis compléter avec les plus flexibles.")
    extra = pr.get("extra") or []
    if "seniority" in extra:
        lines.append("À conditions égales, prioriser l'ancienneté (date d'embauche la plus ancienne d'abord).")
    if "low_cost" in extra:
        lines.append("À qualification égale, privilégier les taux horaires les plus bas pour optimiser le budget.")
    if "min_hours_equity" in extra:
        lines.append("Équité : atteindre d'abord le minimum d'heures hebdomadaire de CHAQUE employé avant de dépasser celui des autres.")
    return lines


async def generate_schedule_content(proposal_id: str, pharmacy_id: str, week_start: str,
                                    instructions: str, roster: list, profiles: list, absences: list,
                                    weekly_budget: float = 0, existing_shifts: list | None = None,
                                    existing_mode: str = "adjust", department: str = ""):
    existing_shifts = existing_shifts or []
    try:
        start = date.fromisoformat(week_start)
        week_days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
        await materialize_recurring_tasks(pharmacy_id, week_days[0], week_days[-1])
        week_tasks = await db.shift_tasks.find(
            {"pharmacy_id": pharmacy_id, "date": {"$gte": week_days[0], "$lte": week_days[-1]}},
            {"_id": 0}).to_list(1000)
        filled_reqs = await db.replacement_requests.find(
            {"pharmacy_id": pharmacy_id, "status": "filled"}, {"_id": 0}).to_list(200)
        replacement_slots = []
        for r in filled_reqs:
            offer = None
            if r.get("chosen_offer_id"):
                offer = await db.replacement_offers.find_one(
                    {"id": r["chosen_offer_id"]},
                    {"_id": 0, "candidate_name": 1, "agency_name": 1, "hourly_rate": 1})
            for sl in r.get("slots", []):
                if week_days[0] <= sl["date"] <= week_days[-1]:
                    replacement_slots.append({
                        "date": sl["date"], "de": sl["start"], "a": sl["end"], "role": r.get("role", ""),
                        "remplacant": (offer or {}).get("candidate_name", ""),
                        "agence": (offer or {}).get("agency_name", ""),
                        "taux_horaire": (offer or {}).get("hourly_rate"),
                    })
        settings = await db.schedule_settings.find_one({"pharmacy_id": pharmacy_id}, {"_id": 0}) or {}
        traffic = settings.get("traffic") or {}
        dept_budgets = settings.get("dept_budgets") or {}
        branch_budgets = settings.get("branch_budgets") or []
        dept_staffing = settings.get("dept_staffing") or {}
        branch_staffing = settings.get("branch_staffing") or []
        priorities = settings.get("priorities") or {}
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
            "departement_vise": (f"{department} — génère les quarts pour CE département seulement"
                                 if department else "Tous les départements"),
            "departements_disponibles": list(DEPARTMENTS_BE),
            "budgets_par_departement": ({d: f"{b:.2f} $ maximum" for d, b in dept_budgets.items()}
                                        or "Aucun budget par département."),
            "budgets_par_succursale": ([{"succursale": b.get("branch_name", ""), "budget_max": f"{b.get('budget', 0):.2f} $"}
                                        for b in branch_budgets] or "Aucun budget par succursale."),
            "personnel_requis_par_departement": ({d: f"{n} personne(s) EN SIMULTANÉ, en tout temps pendant les heures d'ouverture"
                                                  for d, n in dept_staffing.items()}
                                                 or "Aucune exigence de dotation par département."),
            "personnel_requis_par_succursale": ([{"succursale": b.get("branch_name", ""), "branch_id": b.get("branch_id", ""),
                                                  "personnes_minimum_en_simultane": b.get("count", 0)}
                                                 for b in branch_staffing] or "Aucune exigence de dotation par succursale."),
            "priorites_du_gestionnaire": _priorities_text(priorities),
            "budget_salarial_hebdomadaire": (
                f"{weekly_budget:.2f} $ — masse salariale MAXIMALE pour l'ensemble des quarts de la semaine"
                if weekly_budget > 0 else "Aucun budget imposé."),
            "achalandage_estime": traffic_payload or "Aucune donnée d'achalandage fournie.",
            "absences_approuvees": [{
                "employee_id": a["employee_id"], "nom": a.get("employee_name", ""),
                "du": a["start"], "au": a["end"], "type": a.get("type", ""),
            } for a in absences] or "Aucune absence approuvée cette semaine.",
            "remplacants_agence_confirmes": replacement_slots or "Aucun remplaçant d'agence confirmé cette semaine.",
            "quarts_existants_a_conserver": existing_shifts if (existing_mode == "adjust" and existing_shifts)
            else "Aucun — semaine à planifier au complet.",
            "taches_a_faire_cette_semaine": [{
                "date": t["date"], "quart": t["shift"], "titre": t["title"],
                "assignee_employee_id": t.get("assignee_employee_id") or "",
                "assignee": t.get("assignee_name") or "Toute l'équipe",
            } for t in week_tasks] or "Aucune tâche planifiée cette semaine.",
            "employes": [{
                "employee_id": e["id"], "nom": e["name"], "poste": e["position"],
                "succursale": e.get("branch_name") or "non précisée",
                "succursales_permises": ([{"branch_id": bid, "nom": nom} for bid, nom in zip(
                    e.get("branch_ids") or ([e["branch_id"]] if e.get("branch_id") else []),
                    e.get("branch_names") or ([e.get("branch_name") or ""] if e.get("branch_id") else []))]
                    or "une seule succursale (aucun choix à faire)"),
                "incompatible_avec": next((p.get("incompatible_with") or [] for p in profiles
                                           if p["employee_id"] == e["id"]), []) or "aucune incompatibilité",
                "date_embauche": e.get("hire_date") or "inconnue",
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
        prof_by_id = {p["employee_id"]: p for p in profiles}
        allowed_branches = {e["id"]: set((e.get("branch_ids") or []) + ([e["branch_id"]] if e.get("branch_id") else []))
                            for e in roster}
        home_branch = {e["id"]: e.get("branch_id") or "" for e in roster}
        for s in data.get("shifts", []):
            if s.get("employee_id") not in roster_ids or s.get("date") not in week_days:
                continue
            if not s.get("start") or not s.get("end"):
                continue
            ai_dept = str(s.get("department") or "")
            dept = department or (ai_dept if ai_dept in DEPARTMENTS_BE else "") \
                or ((prof_by_id.get(s["employee_id"]) or {}).get("department") or "") or "Général"
            eid = s["employee_id"]
            ai_branch = str(s.get("branch_id") or "")
            branch = ai_branch if ai_branch in allowed_branches.get(eid, set()) else home_branch.get(eid, "")
            shifts.append({"id": str(uuid.uuid4()), "employee_id": eid,
                           "employee_name": str(s.get("employee_name", "")), "date": s["date"],
                           "start": str(s["start"]), "end": str(s["end"]), "role": str(s.get("role", "")),
                           "branch_id": branch,
                           "department": dept})
        if not shifts:
            raise ValueError("L'IA n'a généré aucun quart valide")
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
            for ex in existing_shifts:
                if ex["employee_id"] == s["employee_id"] and ex["date"] == s["date"] \
                        and ex["start"] < s["end"] and s["start"] < ex["end"]:
                    warnings.append({
                        "text": f"Dédoublement possible : chevauche un quart existant {ex['start']}–{ex['end']} le {ex['date']}",
                        "kind": "overlap"})
            incompat = set((prof.get("incompatible_with") or []))
            if incompat:
                for o in shifts:
                    if o is s or o["employee_id"] not in incompat or o["date"] != s["date"]:
                        continue
                    if o["start"] < s["end"] and s["start"] < o["end"] \
                            and (o.get("branch_id") or "") == (s.get("branch_id") or ""):
                        warnings.append({
                            "text": f"Incompatibilité : chevauche le quart de {o.get('employee_name') or o['employee_id']} "
                                    f"({o['start']}–{o['end']}) — ces employés ne doivent pas travailler ensemble",
                            "kind": "incompat"})
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
        agency_cost = 0.0
        for rs in replacement_slots:
            if not rs.get("taux_horaire"):
                continue
            try:
                agency_cost += max(0, _time_to_minutes(rs["a"]) - _time_to_minutes(rs["de"])) / 60 * float(rs["taux_horaire"])
            except (ValueError, AttributeError):
                continue
        existing_cost = 0.0
        for ex in existing_shifts:
            rate = (prof_by_id.get(ex["employee_id"]) or {}).get("hourly_rate")
            if not rate:
                continue
            try:
                existing_cost += max(0, _time_to_minutes(ex["end"]) - _time_to_minutes(ex["start"])) / 60 * float(rate)
            except (ValueError, AttributeError):
                continue
        estimated_cost = round(estimated_cost + agency_cost + existing_cost, 2)
        if weekly_budget > 0 and estimated_cost > weekly_budget:
            extras = []
            if agency_cost > 0:
                extras.append(f"{agency_cost:.2f} $ de remplaçants d’agence")
            if existing_cost > 0:
                extras.append(f"{existing_cost:.2f} $ de quarts existants conservés")
            extra_txt = f" (dont {' et '.join(extras)})" if extras else ""
            alerts.append({"kind": "budget",
                           "text": f"Budget dépassé : coût estimé {estimated_cost:.2f} ${extra_txt}"
                                   f" > budget {weekly_budget:.2f} $ (écart +{estimated_cost - weekly_budget:.2f} $)"})
        for eid in sorted(missing_rate_ids):
            who = next((e["name"] for e in roster if e["id"] == eid), eid)
            alerts.append({"kind": "profile", "employee_id": eid,
                           "text": f"Taux horaire manquant au profil de {who} — le coût estimé est sous-évalué"})

        def _shift_cost(s: dict) -> float:
            rate = (prof_by_id.get(s["employee_id"]) or {}).get("hourly_rate")
            if not rate:
                return 0.0
            try:
                return max(0, _time_to_minutes(s["end"]) - _time_to_minutes(s["start"])) / 60 * float(rate)
            except (ValueError, AttributeError):
                return 0.0

        if dept_budgets:
            dept_costs: dict = {}
            for s in shifts:
                dept_costs[s["department"]] = dept_costs.get(s["department"], 0) + _shift_cost(s)
            for d_name, b in dept_budgets.items():
                c = dept_costs.get(d_name, 0)
                if b > 0 and c > b:
                    alerts.append({"kind": "budget",
                                   "text": f"Budget du département {d_name} dépassé : coût estimé {c:.2f} $ > {b:.2f} $"})
        if branch_budgets:
            branch_by_emp = {e["id"]: (e.get("branch_id") or "") for e in roster}
            branch_costs: dict = {}
            for s in shifts:
                bid = s.get("branch_id") or branch_by_emp.get(s["employee_id"], "")
                branch_costs[bid] = branch_costs.get(bid, 0) + _shift_cost(s)
            for b in branch_budgets:
                c = branch_costs.get(b.get("branch_id", ""), 0)
                if b.get("budget", 0) > 0 and c > b["budget"]:
                    alerts.append({"kind": "budget",
                                   "text": f"Budget de la succursale {b.get('branch_name', '')} dépassé : "
                                           f"coût estimé {c:.2f} $ > {b['budget']:.2f} $"})
        if not department:
            staffed_depts = {(prof_by_id.get(e["id"]) or {}).get("department") for e in roster}
            for d_name in DEPARTMENTS_BE:
                if d_name == "Général" or d_name not in staffed_depts:
                    continue
                if not any(s["department"] == d_name for s in shifts):
                    alerts.append({"kind": "traffic",
                                   "text": f"Aucun quart au département {d_name} cette semaine malgré du personnel "
                                           "rattaché — couverture minimale à vérifier (priorité Laboratoire et caisse)"})
        traffic_settings = (await db.schedule_settings.find_one(
            {"pharmacy_id": pharmacy_id}, {"_id": 0}) or {}).get("traffic") or {}
        for i, d in enumerate(week_days):
            day_blocks = traffic_settings.get(TRAFFIC_DAY_KEYS[i]) or {}
            for key, (label, bs, be) in TRAFFIC_BLOCKS.items():
                expected = day_blocks.get(key) or 0
                if expected <= 0:
                    continue
                covered = any(s["date"] == d and s["start"] < be and s["end"] > bs for s in shifts) \
                    or any(rs["date"] == d and rs["de"] < be and rs["a"] > bs for rs in replacement_slots) \
                    or any(ex["date"] == d and ex["start"] < be and ex["end"] > bs for ex in existing_shifts)
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
    pid = scoped_pid(principal)
    try:
        week0 = date.fromisoformat(payload.week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date de début de semaine invalide.")
    week1 = week0 + timedelta(days=6)
    if not (1 <= payload.approval_deadline_hours <= 168):
        raise HTTPException(status_code=400, detail="Délai d'approbation invalide (1 à 168 h).")
    roster = [e.model_dump() for e in payload.employees]
    if not roster:
        profiles_db = await db.employee_profiles.find({"pharmacy_id": pid}, {"_id": 0}).to_list(500)
        roster = [{
            "id": p.get("employee_id"),
            "name": p.get("employee_name") or p.get("employee_id"),
            "position": (p.get("roles") or ["Général"])[0] if (p.get("roles") or ["Général"]) else "Général",
            "branch_id": "", "branch_name": "", "branch_ids": [], "branch_names": [],
            "hire_date": p.get("hire_date") or "",
        } for p in profiles_db if p.get("employee_id")]
    if not roster:
        raise HTTPException(status_code=400, detail="Aucun employé dans cette officine.")
    absences = [a.model_dump() for a in payload.absences]
    leave_docs = await db.leave_requests.find({
        "pharmacy_id": pid, "status": "Approuvée",
        "start_date": {"$lte": week1.isoformat()}, "end_date": {"$gte": week0.isoformat()},
    }, {"_id": 0}).to_list(500)
    seen_abs = {(a.get("employee_id"), a.get("start"), a.get("end")) for a in absences}
    for lv in leave_docs:
        key = (lv.get("employee_id"), lv.get("start_date"), lv.get("end_date"))
        if key in seen_abs:
            continue
        absences.append({
            "employee_id": lv.get("employee_id"), "employee_name": lv.get("employee_name") or "",
            "start": lv.get("start_date"), "end": lv.get("end_date"), "type": lv.get("type") or "Congé",
        })
        seen_abs.add(key)
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
    department = payload.department.strip()[:40]
    existing_mode = payload.existing_mode if payload.existing_mode in ("adjust", "overwrite") else "adjust"
    existing = []
    if existing_mode == "adjust":
        for s in payload.existing_shifts[:200]:
            if not isinstance(s, dict):
                continue
            if s.get("date") and s.get("start") and s.get("end") and s.get("employee_id"):
                existing.append({"employee_id": str(s["employee_id"]), "employee_name": str(s.get("employee_name", "")),
                                 "date": str(s["date"]), "start": str(s["start"]), "end": str(s["end"])})
        if not existing:
            db_shifts = await db.shifts.find({
                "pharmacy_id": pid,
                "date": {"$gte": week0.isoformat(), "$lte": week1.isoformat()},
            }, {"_id": 0}).to_list(500)
            for s in db_shifts:
                if s.get("date") and s.get("start") and s.get("end") and s.get("employee_id"):
                    existing.append({
                        "employee_id": str(s["employee_id"]),
                        "employee_name": str(s.get("employee_name") or ""),
                        "date": str(s["date"]), "start": str(s["start"]), "end": str(s["end"]),
                    })
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "week_start": payload.week_start,
        "status": "generating", "error": None, "summary": "", "shifts": [],
        "instructions": payload.instructions, "absences": absences,
        "department": department, "existing_mode": existing_mode,
        "roster_branches": {e.id: e.branch_id for e in payload.employees},
        "priorities": settings.get("priorities") or {},
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
                                                  roster, profiles, absences, weekly_budget,
                                                  existing, existing_mode, department))
    return proposal_view(doc)


@api_router.get("/schedule/proposals")
async def list_proposals(user: dict = Depends(get_current_user)):
    if user["role"] in ("admin", "manager", "superadmin"):
        docs = await db.schedule_proposals.find({"pharmacy_id": scoped_pid(user)}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return [proposal_view(d) for d in docs]
    pid = user.get("pharmacy_id") or ""
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
    pid = doc["pharmacy_id"]
    week_days = [(date.fromisoformat(doc["week_start"]) + timedelta(days=i)).isoformat() for i in range(7)]
    existing_docs = await db.shifts.find({"pharmacy_id": pid, "date": {"$in": week_days}},
                                         {"_id": 0, "employee_id": 1, "date": 1, "start": 1, "end": 1}).to_list(3000)
    existing_keys = {(e["employee_id"], e["date"], e["start"], e["end"]) for e in existing_docs}
    branches = doc.get("roster_branches") or {}
    inserted = 0
    inserted_emps: set = set()
    for s in doc.get("shifts", []):
        key = (s["employee_id"], s["date"], s["start"], s["end"])
        if key in existing_keys:
            continue
        shift_doc = _shift_doc(ShiftIn(
            id=s.get("id") or "", employee_id=s["employee_id"], date=s["date"], start=s["start"], end=s["end"],
            department=s.get("department") or doc.get("department") or "Général",
            ai_generated=True, proposal_id=proposal_id,
            branch_id=s.get("branch_id") or branches.get(s["employee_id"], "")), pid)
        await db.shifts.update_one({"id": shift_doc["id"], "pharmacy_id": pid}, {"$set": shift_doc}, upsert=True)
        existing_keys.add(key)
        inserted_emps.add(s["employee_id"])
        inserted += 1
    if inserted:
        await _mark_shifts_ready(pid)
    stations_assigned = await _assign_stations_range(pid, week_days, notify=False)
    for eid in inserted_emps:
        await _notify_shift_change(pid, eid, "Nouvel horaire confirmé",
                                   f"Votre horaire de la semaine du {doc['week_start']} est confirmé — "
                                   "consultez vos quarts et postes de travail dans Mon espace.", "emerald")
    await log_audit(principal["email"], principal["role"], "APPLICATION_HORAIRE", "horaire", proposal_id,
                    f"Horaire IA de la semaine du {doc['week_start']} appliqué ({len(doc.get('shifts', []))} quarts, "
                    f"{inserted} ajoutés, {stations_assigned} poste(s) attribués automatiquement)",
                    pid)
    updated = await db.schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
    result = proposal_view(updated)
    result["inserted_count"] = inserted
    result["stations_assigned"] = stations_assigned
    return result


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
    pid = scoped_pid(principal)
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
    if user["role"] in ("admin", "manager", "superadmin"):
        query: dict = {"pharmacy_id": scoped_pid(user)}
    else:
        if not user.get("employee_id"):
            return []
        query = {"pharmacy_id": user.get("pharmacy_id") or "", "employee_id": user["employee_id"]}
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
                    f"{sent} relance(s) d'auto-évaluation envoyée(s) manuellement", scoped_pid(principal))
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
    competences: list[str] = []


class TaskCopyWeekIn(BaseModel):
    from_start: str
    to_start: str


@api_router.get("/tasks")
async def list_tasks(start: str = Query(...), end: str = Query(...), user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    await materialize_recurring_tasks(pid, start, end)
    query: dict = {"date": {"$gte": start, "$lte": end}, "pharmacy_id": pid}
    if user["role"] not in ("admin", "manager", "superadmin"):
        eid = user.get("employee_id") or ""
        query["$or"] = [{"assignee_employee_id": eid}, {"assignee_employee_id": ""}]
    return await db.shift_tasks.find(query, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(500)


@api_router.post("/tasks")
async def create_task(payload: ShiftTaskIn, principal: dict = Depends(get_principal)):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Le titre de la tâche est requis.")
    qualification_warning = False
    competences = [str(c).strip() for c in (payload.competences or []) if str(c).strip()][:10]
    if payload.assignee_employee_id:
        prof = await get_or_create_profile(scoped_pid(principal),
                                           payload.assignee_employee_id, payload.assignee_name)
        caps = prof.get("capacities") or []
        if competences:
            qualification_warning = bool(caps) and not any(task_qualification_ok(c, caps) for c in competences)
        else:
            qualification_warning = not task_qualification_ok(payload.title, caps)
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
    pid = scoped_pid(principal)
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


TASK_WINDOWS = {"Matin": ("06:00", "12:00"), "Après-midi": ("12:00", "17:00"), "Soir": ("17:00", "23:59")}


async def send_shift_task_reminders(shift: str, date_str: str = "") -> int:
    today = date_str or datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    pending = await db.shift_tasks.find({"date": today, "shift": shift, "done": False}, {"_id": 0}).to_list(500)
    if not pending:
        return 0
    by_pharmacy: dict = {}
    for t in pending:
        by_pharmacy.setdefault(t["pharmacy_id"], []).append(t)
    ws, we = TASK_WINDOWS.get(shift, ("00:00", "23:59"))
    api_key = os.environ.get("RESEND_API_KEY", "")
    if api_key:
        resend.api_key = api_key
    sender = await get_sender() if api_key else ""
    actions = 0
    for pid, tasks in by_pharmacy.items():
        on_duty = await db.shifts.find({"pharmacy_id": pid, "date": today, "start": {"$lt": we}, "end": {"$gt": ws}},
                                       {"_id": 0, "employee_id": 1}).to_list(500)
        team_ids = {s["employee_id"] for s in on_duty}
        unassigned_titles = [t["title"] for t in tasks if not t.get("assignee_employee_id")]
        assignee_ids = {t["assignee_employee_id"] for t in tasks if t.get("assignee_employee_id")}
        for eid in assignee_ids | team_ids:
            mine = [t["title"] for t in tasks if t.get("assignee_employee_id") == eid]
            team = unassigned_titles if eid in team_ids else []
            titles = mine + [f"{x} (équipe)" for x in team]
            if not titles:
                continue
            listing = " · ".join(titles[:5]) + (f" (+{len(titles) - 5} autre(s))" if len(titles) > 5 else "")
            notif_title = f"Tâches à terminer — quart {shift}"
            already = await db.notifications.find_one({
                "pharmacy_id": pid, "target_employee_id": eid, "title": notif_title,
                "created_at": {"$gte": f"{today}T00:00:00"}})
            if already:
                continue
            await _notify_shift_change(pid, eid, notif_title,
                                       f"Il reste à faire : {listing}", "amber", module="tasks")
            actions += 1
        convo = await db.conversations.find_one({"pharmacy_id": pid, "type": "equipe"}, {"_id": 0},
                                                sort=[("created_at", 1)])
        if convo:
            dup = await db.chat_messages.find_one({"conversation_id": convo["id"], "kind": "task_reminder",
                                                   "reminder_date": today, "reminder_shift": shift})
            if not dup:
                now = datetime.now(timezone.utc).isoformat()
                titles = [t["title"] for t in tasks]
                body = (f"⏰ Fin du quart {shift} — {len(tasks)} tâche(s) restent à faire : "
                        + ", ".join(titles[:6]) + (f" (+{len(titles) - 6} autre(s))" if len(titles) > 6 else "")
                        + ". Un coup de main avant de partir ?")
                await db.chat_messages.insert_one({
                    "id": str(uuid.uuid4()), "conversation_id": convo["id"], "pharmacy_id": pid,
                    "sender_email": "systeme@arriereplan.app", "sender_name": "Arrière Plan",
                    "sender_role": "system", "kind": "task_reminder",
                    "reminder_date": today, "reminder_shift": shift,
                    "body": body, "attachment": None, "created_at": now})
                await db.conversations.update_one({"id": convo["id"]}, {"$set": {
                    "last_message": body[:80], "last_sender": "Arrière Plan", "last_message_at": now}})
                actions += 1
        emails_sent = 0
        if api_key:
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
                    emails_sent += 1
                except Exception as exc:
                    logger.error(f"Rappel tâches ({shift}) vers {a['email']} échoué : {exc}")
        actions += emails_sent
        await log_audit("système", "system", "RAPPEL_TACHES_QUART", "tâche", today,
                        f"Quart {shift} : {len(tasks)} tâche(s) non complétée(s) — rappels équipe envoyés "
                        f"(notifications + chat, {emails_sent} courriel(s))", pid)
    return actions


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
    logger.info(f"Rappels tâches non faites ({shift}) : {sent} rappel(s) envoyés (notifications, chat, courriels)")


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


# ==================== Rapport budget mensuel ====================

def _month_bounds(month: str) -> tuple:
    y, m = int(month[:4]), int(month[5:7])
    start = date(y, m, 1)
    end = date(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1) - timedelta(days=1)
    return start, end


def _budget_row_html(name: str, cost: float, budget: float) -> str:
    td = "padding:8px 10px;border-bottom:1px solid #e2e8f0"
    over = budget > 0 and cost > budget
    state = ("<span style='color:#dc2626;font-weight:bold'>Dépassé</span>" if over
             else ("<span style='color:#059669;font-weight:bold'>Respecté</span>" if budget > 0 else "—"))
    budget_txt = f"{budget:.2f} $" if budget > 0 else "—"
    return (f"<tr><td style='{td}'>{name}</td><td style='{td};text-align:right'>{cost:.2f} $</td>"
            f"<td style='{td};text-align:right'>{budget_txt}</td><td style='{td}'>{state}</td></tr>")


def monthly_budget_html(month: str, dept_rows: list, branch_rows: list,
                        planned_total: float, punched_total: float, monthly_budget: float) -> str:
    td = "padding:8px 10px;border-bottom:1px solid #e2e8f0"
    header = ("<tr style='text-align:left;color:#64748b;font-size:12px;text-transform:uppercase'>"
              f"<th style='{td}'>Nom</th><th style='{td};text-align:right'>Coût planifié</th>"
              f"<th style='{td};text-align:right'>Budget (mois)</th><th style='{td}'>État</th></tr>")
    dept_html = "".join(_budget_row_html(r["name"], r["cost"], r["budget"]) for r in dept_rows) or \
        f"<tr><td style='{td}' colspan='4'>Aucun quart planifié ce mois-ci.</td></tr>"
    branch_html = "".join(_budget_row_html(r["name"], r["cost"], r["budget"]) for r in branch_rows)
    branch_section = ("<h3 style='color:#0f172a'>Par succursale</h3>"
                      f"<table style='border-collapse:collapse;width:100%'>{header}{branch_html}</table>"
                      if branch_html else "")
    global_state = ("<span style='color:#dc2626;font-weight:bold'>Budget global dépassé</span>"
                    if monthly_budget > 0 and planned_total > monthly_budget
                    else ("<span style='color:#059669;font-weight:bold'>Budget global respecté</span>"
                          if monthly_budget > 0 else ""))
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
        "<h2 style='color:#059669'>Arrière Plan — Rapport budget mensuel</h2>"
        f"<p>Mois de <strong>{month}</strong> — coût planifié total : <strong>{planned_total:.2f} $</strong>"
        f"{f' / budget mensuel ≈ {monthly_budget:.2f} $' if monthly_budget > 0 else ''}. "
        f"Coût réel punché : <strong>{punched_total:.2f} $</strong>. {global_state}</p>"
        "<h3 style='color:#0f172a'>Par département</h3>"
        f"<table style='border-collapse:collapse;width:100%'>{header}{dept_html}</table>"
        f"{branch_section}"
        "<p style='font-size:12px;color:#94a3b8;margin-top:24px'>Budgets mensuels ≈ budgets hebdomadaires × (jours du mois ÷ 7). "
        "Coûts planifiés = quarts du calendrier × taux horaires des profils. Rapport automatique envoyé le 1er de chaque mois par Arrière Plan.</p>"
        "</div>")


async def send_monthly_budget_reports(month: str = "", only_pharmacy: str = "") -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("Rapport budget mensuel : RESEND_API_KEY manquante, envoi ignoré.")
        return 0
    if not month:
        today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date()
        prev = today.replace(day=1) - timedelta(days=1)
        month = prev.strftime("%Y-%m")
    ms, me = _month_bounds(month)
    weeks_factor = ((me - ms).days + 1) / 7
    query: dict = {"date": {"$gte": ms.isoformat(), "$lte": me.isoformat()}}
    if only_pharmacy:
        query["pharmacy_id"] = only_pharmacy
    shift_docs = await db.shifts.find(query, {"_id": 0}).to_list(20000)
    pids = sorted({s["pharmacy_id"] for s in shift_docs} | ({only_pharmacy} if only_pharmacy else set()))
    resend.api_key = api_key
    sender = await get_sender()
    total_sent = 0
    for pid in pids:
        settings = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
        profiles = await db.employee_profiles.find(
            {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "hourly_rate": 1}).to_list(1000)
        rate_by = {p["employee_id"]: float(p.get("hourly_rate") or 0) for p in profiles}
        dept_cost: dict = {}
        branch_cost: dict = {}
        planned_total = 0.0
        for s in (x for x in shift_docs if x["pharmacy_id"] == pid):
            try:
                h = max(0, _time_to_minutes(s["end"]) - _time_to_minutes(s["start"])) / 60
            except (ValueError, AttributeError):
                continue
            c = h * rate_by.get(s["employee_id"], 0)
            planned_total += c
            dept = s.get("department") or "Général"
            dept_cost[dept] = dept_cost.get(dept, 0) + c
            bid = s.get("branch_id") or ""
            branch_cost[bid] = branch_cost.get(bid, 0) + c
        punches = await db.punches.find(
            {"pharmacy_id": pid, "date": {"$gte": ms.isoformat(), "$lte": me.isoformat()},
             "punch_out": {"$ne": None}}, {"_id": 0, "employee_id": 1, "punch_in": 1, "punch_out": 1}).to_list(10000)
        punched_total = 0.0
        for p in punches:
            try:
                h = (datetime.fromisoformat(p["punch_out"]) - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600
            except (ValueError, TypeError):
                continue
            punched_total += max(0, h) * rate_by.get(p["employee_id"], 0)
        if planned_total == 0 and punched_total == 0:
            continue
        dept_budgets = settings.get("dept_budgets") or {}
        branch_budgets = {b.get("branch_id", ""): b for b in (settings.get("branch_budgets") or [])}
        dept_rows = [{"name": d, "cost": round(c, 2),
                      "budget": round(float(dept_budgets.get(d, 0)) * weeks_factor, 2)}
                     for d, c in sorted(dept_cost.items(), key=lambda x: -x[1])]
        branch_rows = [{"name": (branch_budgets.get(bid, {}).get("branch_name") or bid or "Sans succursale"),
                        "cost": round(c, 2),
                        "budget": round(float(branch_budgets.get(bid, {}).get("budget", 0)) * weeks_factor, 2)}
                       for bid, c in sorted(branch_cost.items(), key=lambda x: -x[1])]
        monthly_budget = round(float(settings.get("weekly_budget") or 0) * weeks_factor, 2)
        html = monthly_budget_html(month, dept_rows, branch_rows,
                                   round(planned_total, 2), round(punched_total, 2), monthly_budget)
        admins = await db.users.find({"role": {"$in": ["admin", "manager"]}, "pharmacy_id": pid}, {"_id": 0}).to_list(50)
        sent = 0
        for a in admins:
            if not a.get("email"):
                continue
            try:
                await asyncio.to_thread(resend.Emails.send, {
                    "from": sender, "to": [a["email"]],
                    "subject": f"Rapport budget — {month}",
                    "html": html})
                sent += 1
            except Exception as exc:
                logger.error(f"Rapport budget vers {a['email']} échoué : {exc}")
        await log_audit("système", "system", "RAPPORT_BUDGET_MENSUEL", "horaire", month,
                        f"Rapport budget mensuel {month} : {sent} courriel(s) envoyé(s)", pid)
        total_sent += sent
    return total_sent


@api_router.post("/reports/budget-monthly/run")
async def run_monthly_budget_report(month: str = Query(""), principal: dict = Depends(get_principal)):
    if month and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Mois invalide (format AAAA-MM).")
    only = principal["pharmacy_id"] if principal["role"] in ("admin", "manager") else ""
    sent = await send_monthly_budget_reports(month, only or "")
    return {"sent": sent}


async def monthly_budget_report_job():
    sent = await send_monthly_budget_reports()
    logger.info(f"Rapport budget mensuel : {sent} courriel(s) envoyé(s)")


async def send_shift_reminders(only_pharmacy: str = "") -> int:
    tomorrow = (datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date() + timedelta(days=1)).isoformat()
    query: dict = {"date": tomorrow}
    if only_pharmacy:
        query["pharmacy_id"] = only_pharmacy
    docs = await db.shifts.find(query, {"_id": 0}).to_list(20000)
    by_key: dict = {}
    for s in docs:
        by_key.setdefault((s["pharmacy_id"], s["employee_id"]), []).append(s)
    sent = 0
    for (pid, eid), day_shifts in by_key.items():
        exists = await db.notifications.find_one(
            {"pharmacy_id": pid, "target_employee_id": eid, "kind": "shift_reminder", "reminder_date": tomorrow})
        if exists:
            continue
        day_shifts.sort(key=lambda x: x["start"])
        total_h = 0.0
        parts = []
        for s in day_shifts:
            try:
                total_h += max(0, _time_to_minutes(s["end"]) - _time_to_minutes(s["start"])) / 60
            except (ValueError, AttributeError):
                pass
            dept = s.get("department") or "Général"
            parts.append(f"{s['start']}–{s['end']}" + (f" ({dept})" if dept != "Général" else ""))
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_employee_id": eid,
            "kind": "shift_reminder", "reminder_date": tomorrow,
            "title": "Rappel — vous travaillez demain",
            "detail": f"Demain ({tomorrow}) : {' · '.join(parts)} — total ~{round(total_h, 2):g} h.",
            "module": "myspace", "icon": "schedule", "tone": "sky",
            "created_at": datetime.now(timezone.utc).isoformat()})
        sent += 1
    return sent


@api_router.post("/notifications/shift-reminders/run")
async def run_shift_reminders(principal: dict = Depends(get_principal)):
    only = principal["pharmacy_id"] if principal["role"] in ("admin", "manager") else ""
    sent = await send_shift_reminders(only or "")
    return {"sent": sent}


async def shift_reminder_job():
    sent = await send_shift_reminders()
    logger.info(f"Rappels de quart demain : {sent} notification(s) créée(s)")


async def birthday_wishes_job():
    sent = await send_birthday_wishes()
    logger.info(f"Souhaits d'anniversaire automatiques : {sent} message(s) publié(s)")


# ---------------------- Résumé matinal dans le chat d'équipe ----------------------

FR_MONTHS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet",
             "août", "septembre", "octobre", "novembre", "décembre")


def _fr_date_label(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{TRAFFIC_DAY_LABELS[d.weekday()]} {d.day} {FR_MONTHS[d.month - 1]}"


async def send_morning_digest(date_str: str = "", only_pharmacy: str = "") -> int:
    today = date_str or datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    query: dict = {"date": today}
    if only_pharmacy:
        query["pharmacy_id"] = only_pharmacy
    shifts = await db.shifts.find(query, {"_id": 0}).to_list(20000)
    tasks = await db.shift_tasks.find(query, {"_id": 0}).to_list(2000)
    by_pharmacy: dict = {}
    for s in shifts:
        by_pharmacy.setdefault(s["pharmacy_id"], {"shifts": [], "tasks": []})["shifts"].append(s)
    for t in tasks:
        by_pharmacy.setdefault(t["pharmacy_id"], {"shifts": [], "tasks": []})["tasks"].append(t)
    sent = 0
    for pid, data in by_pharmacy.items():
        if not data["shifts"] and not data["tasks"]:
            continue
        convo = await db.conversations.find_one({"pharmacy_id": pid, "type": "equipe"}, {"_id": 0},
                                                sort=[("created_at", 1)])
        if not convo:
            continue
        dup = await db.chat_messages.find_one({"conversation_id": convo["id"], "kind": "morning_digest",
                                               "digest_date": today})
        if dup:
            continue
        profiles = await db.employee_profiles.find(
            {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "employee_name": 1}).to_list(1000)
        names = {p["employee_id"]: (p.get("employee_name") or "").strip() for p in profiles}
        day_shifts = sorted(data["shifts"], key=lambda x: (x.get("start") or "", x.get("end") or ""))
        lines = [f"☀️ Bonjour l'équipe ! Programme du {_fr_date_label(today)} :"]
        try:
            weather_days = await get_weather_forecast(pid)
            wtoday = next((w for w in weather_days if w["date"] == today), None)
            if wtoday:
                lines.append(f"{wtoday['icon']} Météo : {wtoday['label']}, {wtoday['tmax']}° / {wtoday['tmin']}°"
                             + (f" · pluie {wtoday['precip']} %" if wtoday["precip"] >= 30 else ""))
        except Exception:
            pass
        if day_shifts:
            lines.append(f"\n👥 Quarts ({len(day_shifts)}) :")
            for s in day_shifts[:15]:
                who = names.get(s["employee_id"]) or "Employé(e)"
                dept = s.get("department") or "Général"
                extra = f" · poste {s['station']}" if s.get("station") else (f" · {dept}" if dept != "Général" else "")
                lines.append(f"• {who} {s.get('start', '?')}–{s.get('end', '?')}{extra}")
            if len(day_shifts) > 15:
                lines.append(f"• … +{len(day_shifts) - 15} autre(s) quart(s)")
        pending = [t for t in data["tasks"] if not t.get("done")]
        if pending:
            lines.append(f"\n📋 Tâches prévues ({len(pending)}) :")
            for shift_name in TASK_SHIFTS:
                st = [t for t in pending if t.get("shift") == shift_name]
                if not st:
                    continue
                titles = ", ".join(t["title"] for t in st[:4]) + (f" (+{len(st) - 4})" if len(st) > 4 else "")
                lines.append(f"• {shift_name} ({len(st)}) : {titles}")
        lines.append("\nBonne journée ! 💊")
        body = "\n".join(lines)
        now = datetime.now(timezone.utc).isoformat()
        await db.chat_messages.insert_one({
            "id": str(uuid.uuid4()), "conversation_id": convo["id"], "pharmacy_id": pid,
            "sender_email": "systeme@arriereplan.app", "sender_name": "Arrière Plan",
            "sender_role": "system", "kind": "morning_digest", "digest_date": today,
            "body": body, "attachment": None, "created_at": now})
        await db.conversations.update_one({"id": convo["id"]}, {"$set": {
            "last_message": f"☀️ Résumé du jour — {len(day_shifts)} quart(s), {len(pending)} tâche(s)",
            "last_sender": "Arrière Plan", "last_message_at": now}})
        await log_audit("système", "system", "RESUME_MATINAL", "chat", today,
                        f"Résumé matinal publié : {len(day_shifts)} quart(s), {len(pending)} tâche(s) prévues", pid)
        sent += 1
    return sent


@api_router.post("/chat/morning-digest/run")
async def run_morning_digest(date_param: str = Query("", alias="date"), principal: dict = Depends(get_principal)):
    if date_param and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_param):
        raise HTTPException(status_code=400, detail="Date invalide (format AAAA-MM-JJ).")
    only = principal["pharmacy_id"] if principal["role"] in ("admin", "manager") else ""
    sent = await send_morning_digest(date_param, only or "")
    return {"sent": sent}


async def morning_digest_job():
    sent = await send_morning_digest()
    logger.info(f"Résumé matinal : {sent} message(s) publié(s) dans les chats d'équipe")


@api_router.get("/reports/budget-history")
async def budget_history(months: int = Query(6, ge=1, le=12), principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date()
    labels = []
    cur = today.replace(day=1)
    for _ in range(months):
        labels.append(cur.strftime("%Y-%m"))
        cur = (cur - timedelta(days=1)).replace(day=1)
    labels.reverse()
    _, last_end = _month_bounds(labels[-1])
    profiles = await db.employee_profiles.find(
        {"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "hourly_rate": 1}).to_list(1000)
    rate_by = {p["employee_id"]: float(p.get("hourly_rate") or 0) for p in profiles}
    docs = await db.shifts.find(
        {"pharmacy_id": pid, "date": {"$gte": f"{labels[0]}-01", "$lte": last_end.isoformat()}},
        {"_id": 0}).to_list(50000)
    by_month: dict = {m: {} for m in labels}
    for s in docs:
        m = s["date"][:7]
        if m not in by_month:
            continue
        try:
            h = max(0, _time_to_minutes(s["end"]) - _time_to_minutes(s["start"])) / 60
        except (ValueError, AttributeError):
            continue
        c = h * rate_by.get(s["employee_id"], 0)
        dept = s.get("department") or "Général"
        by_month[m][dept] = by_month[m].get(dept, 0) + c
    depts = [d for d in DEPARTMENTS_BE if any(d in by_month[m] for m in labels)]
    return {"months": [{"month": m,
                        "depts": {d: round(v, 2) for d, v in by_month[m].items()},
                        "total": round(sum(by_month[m].values()), 2)} for m in labels],
            "departments": depts}


# ==================== Livraisons ====================

DELIVERY_STATUSES = ("a_ramasser", "en_route", "livree")

DEFAULT_PHARMACY_ADDRESS = "5090 Rue Sherbrooke Est, Montréal, QC"


class PharmacySettingsIn(BaseModel):
    address: str
    mileage_rate: float = -1.0


@api_router.get("/pharmacy/settings")
async def get_pharmacy_settings(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.pharmacy_settings.find_one({"pharmacy_id": pid}, {"_id": 0})
    return {"address": (doc or {}).get("address") or DEFAULT_PHARMACY_ADDRESS,
            "mileage_rate": (doc or {}).get("mileage_rate", 0.50)}


@api_router.put("/pharmacy/settings")
async def set_pharmacy_settings(payload: PharmacySettingsIn, principal: dict = Depends(get_principal)):
    if not payload.address.strip():
        raise HTTPException(status_code=400, detail="Adresse requise.")
    pid = scoped_pid(principal)
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
    pid = scoped_pid(user)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(user)
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
    pid = scoped_pid(principal)
    courier_user = await db.users.find_one(
        {"employee_id": payload.courier_employee_id, "pharmacy_id": pid, "suspended": {"$ne": True}},
        {"_id": 0, "email": 1, "name": 1})
    if not courier_user:
        raise HTTPException(status_code=400,
                            detail="Ce livreur n'a pas de compte employé actif. Créez-lui un accès avant d'assigner une tournée.")
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    on_leave = await _approved_leave_on(pid, payload.courier_employee_id, today)
    if on_leave:
        raise HTTPException(status_code=400, detail="Ce livreur est en congé approuvé aujourd'hui.")
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
    await _notify_shift_change(
        pid, payload.courier_employee_id,
        "Nouvelle livraison assignée",
        f"{doc['client_name']} — {doc['address']}" + (" (URGENT)" if payload.priority == "urgent" else ""),
        "red" if payload.priority == "urgent" else "sky", module="deliveries", icon="delivery")
    email_sent = False
    api_key = os.environ.get("RESEND_API_KEY", "")
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
    pid = scoped_pid(user)
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
        "id": str(uuid.uuid4()), "pharmacy_id": scoped_pid(user),
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
            "pharmacy_id": scoped_pid(principal),
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
                    scoped_pid(principal))
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
    pid = scoped_pid(user)
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
    pid = scoped_pid(user)
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
    pid = scoped_pid(user)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
    local = await db.agencies.find({"pharmacy_id": pid}, {"_id": 0}).sort("name", 1).to_list(200)
    partners = await db.global_partners.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return local + [{**p, "pharmacy_id": "", "global": True} for p in partners]


@api_router.post("/agencies")
async def create_agency(payload: AgencyIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "name": payload.name.strip(),
           "email": payload.email.strip().lower(), "roles": payload.roles,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.agencies.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "AJOUT_AGENCE", "remplacement", doc["id"],
                    f"Agence « {doc['name']} » ({', '.join(doc['roles'])}) ajoutée", pid)
    return doc


@api_router.delete("/agencies/{agency_id}")
async def delete_agency(agency_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    pid = scoped_pid(principal)
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
    rem_id = "rem_" + uuid.uuid4().hex[:10]
    rem_name = offer.get("candidate_name") or "Remplaçant"
    await get_or_create_profile(pid, rem_id, rem_name)
    await db.employee_profiles.update_one(
        {"pharmacy_id": pid, "employee_id": rem_id},
        {"$set": {
            "hourly_rate": float(offer.get("hourly_rate") or 0),
            "roles": [req.get("role") or "Remplaçant"],
            "notes": f"Agence {offer.get('agency_name') or ''} — offre {offer.get('id')}",
            "department": "",
        }})
    created_shifts = []
    for slot in req.get("slots") or []:
        if not slot.get("date") or not slot.get("start") or not slot.get("end"):
            continue
        shift_doc = {
            "id": str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": rem_id,
            "employee_name": rem_name, "date": slot["date"], "start": slot["start"], "end": slot["end"],
            "department": "Général", "resource_ids": [], "ai_generated": False,
            "proposal_id": "", "branch_id": "",
            "notes": f"Remplacement {req.get('role') or ''} — {offer.get('agency_name') or ''}",
            "updated_at": now,
        }
        await db.shifts.insert_one({**shift_doc})
        created_shifts.append(shift_doc["id"])
        # fermer le quart ouvert correspondant s'il existe
        await db.open_shifts.update_many(
            {"pharmacy_id": pid, "status": "open", "date": slot["date"],
             "start": slot["start"], "end": slot["end"]},
            {"$set": {"status": "claimed", "claimed_by": rem_id, "claimed_by_name": rem_name,
                      "claimed_at": now}})
    if created_shifts:
        await _mark_shifts_ready(pid)
    await _notify_admins(pid, "Remplaçant intégré à l'horaire",
                         f"{rem_name} ({offer.get('agency_name') or 'agence'}) : {len(created_shifts)} quart(s) ajouté(s).",
                         module="scheduling", tone="emerald")
    await log_audit(principal["email"], principal["role"], "CHOIX_REMPLACANT", "remplacement", request_id,
                    f"{offer['candidate_name']} ({offer['agency_name']}) retenu(e) à {offer['hourly_rate']} $/h "
                    f"pour {len(req['slots'])} plage(s) — fiche {rem_id}, {len(created_shifts)} quart(s)", pid)
    return {"request": {**req, "status": "filled", "chosen_offer_id": offer["id"]},
            "offer": {**offer, "status": "chosen"},
            "employee_id": rem_id, "shifts_created": len(created_shifts)}


@api_router.delete("/replacements/requests/{request_id}")
async def delete_replacement_request(request_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
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
        dup_groups = db.employee_profiles.aggregate([
            {"$group": {"_id": {"p": "$pharmacy_id", "e": "$employee_id"},
                        "ids": {"$push": "$_id"}, "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}}])
        async for g in dup_groups:
            docs = await db.employee_profiles.find({"_id": {"$in": g["ids"]}}).to_list(50)
            docs.sort(key=lambda d: (1 if d.get("hourly_rate") else 0,
                                     1 if d.get("roles") else 0, d.get("updated_at") or ""), reverse=True)
            await db.employee_profiles.delete_many({"_id": {"$in": [d["_id"] for d in docs[1:]]}})
            logger.info(f"Profils dédupliqués : {g['_id']} ({g['count'] - 1} doublon(s) retirés)")
        await db.employee_profiles.create_index([("pharmacy_id", 1), ("employee_id", 1)], unique=True)
    except Exception as exc:
        logger.error(f"Déduplication/index des profils échoué : {exc}")
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Object storage initialisé")
    except Exception as exc:
        logger.error(f"Init object storage échoué : {exc}")
    await seed_users()
    await ensure_pharmacies_seeded()
    perf_indexes = [
        (db.hr_states, [("pharmacy_id", 1)]),
        (db.shifts, [("pharmacy_id", 1), ("date", 1)]),
        (db.shifts, [("pharmacy_id", 1), ("employee_id", 1), ("date", 1)]),
        (db.shifts, [("id", 1), ("pharmacy_id", 1)]),
        (db.punches, [("pharmacy_id", 1), ("date", 1)]),
        (db.punches, [("pharmacy_id", 1), ("employee_id", 1), ("date", 1)]),
        (db.shift_tasks, [("pharmacy_id", 1), ("date", 1)]),
        (db.leave_requests, [("pharmacy_id", 1), ("status", 1)]),
        (db.leave_requests, [("pharmacy_id", 1), ("employee_id", 1)]),
        (db.leave_balances, [("pharmacy_id", 1), ("employee_id", 1)]),
        (db.notifications, [("pharmacy_id", 1), ("created_at", -1)]),
        (db.notifications, [("target_employee_id", 1)]),
        (db.chat_messages, [("conversation_id", 1), ("created_at", 1)]),
        (db.conversations, [("pharmacy_id", 1)]),
        (db.conversation_reads, [("user_email", 1)]),
        (db.audit_logs, [("pharmacy_id", 1), ("created_at", -1)]),
        (db.licenses, [("pharmacy_id", 1)]),
        (db.evaluations, [("pharmacy_id", 1)]),
        (db.deliveries, [("pharmacy_id", 1), ("status", 1)]),
        (db.appointments, [("pharmacy_id", 1), ("date", 1)]),
        (db.schedule_proposals, [("pharmacy_id", 1)]),
        (db.schedule_settings, [("pharmacy_id", 1)]),
        (db.trainings, [("pharmacy_id", 1)]),
        (db.training_assignments, [("pharmacy_id", 1)]),
        (db.training_attempts, [("training_id", 1)]),
        (db.open_shifts, [("pharmacy_id", 1), ("date", 1)]),
        (db.benefits, [("pharmacy_id", 1)]),
        (db.announcements, [("pharmacy_id", 1), ("created_at", -1)]),
        (db.replacement_requests, [("pharmacy_id", 1)]),
        (db.replacement_offers, [("request_id", 1)]),
        (db.login_events, [("created_at", -1)]),
        (db.password_resets, [("email", 1)]),
        (db.polls, [("pharmacy_id", 1)]),
        (db.kudos, [("pharmacy_id", 1), ("created_at", -1)]),
        (db.document_requests, [("pharmacy_id", 1)]),
        (db.time_bank_entries, [("pharmacy_id", 1), ("employee_id", 1)]),
        (db.sst_incidents, [("pharmacy_id", 1)]),
    ]
    created = 0
    for coll, keys in perf_indexes:
        try:
            await coll.create_index(keys)
            created += 1
        except Exception as exc:
            logger.error(f"Index {keys} sur {coll.name} échoué : {exc}")
    logger.info(f"Index de performance vérifiés : {created}/{len(perf_indexes)}")
    scheduler.add_job(monthly_reports_job, CronTrigger(day=1, hour=8, minute=0))
    scheduler.add_job(license_reminders_job, CronTrigger(hour=8, minute=30))
    scheduler.add_job(appointment_reminders_job, CronTrigger(hour=8, minute=0))
    scheduler.add_job(training_reminders_job, CronTrigger(hour=8, minute=45))
    scheduler.add_job(evaluation_reminders_job, CronTrigger(hour=9, minute=0))
    scheduler.add_job(shift_task_reminders_job, CronTrigger(hour=12, minute=0), args=["Matin"])
    scheduler.add_job(shift_task_reminders_job, CronTrigger(hour=17, minute=0), args=["Après-midi"])
    scheduler.add_job(shift_task_reminders_job, CronTrigger(hour=21, minute=30), args=["Soir"])
    scheduler.add_job(weekly_task_report_job, CronTrigger(day_of_week="mon", hour=7, minute=0))
    scheduler.add_job(monthly_budget_report_job, CronTrigger(day=1, hour=7, minute=30))
    scheduler.add_job(shift_reminder_job, CronTrigger(hour=18, minute=0))
    scheduler.add_job(birthday_wishes_job, CronTrigger(hour=7, minute=5))
    scheduler.add_job(morning_digest_job, CronTrigger(hour=6, minute=45))
    scheduler.add_job(scheduled_reports_job, CronTrigger(hour=6, minute=0))
    scheduler.add_job(leave_carryover_job, CronTrigger(month=1, day=1, hour=0, minute=45))
    scheduler.start()


# ---------------------- Météo quotidienne (Open-Meteo, sans clé) ----------------------

WEATHER_CODES = {
    0: ("☀️", "ensoleillé"), 1: ("🌤️", "plutôt ensoleillé"), 2: ("⛅", "partiellement nuageux"), 3: ("☁️", "nuageux"),
    45: ("🌫️", "brouillard"), 48: ("🌫️", "brouillard givrant"), 51: ("🌦️", "bruine légère"), 53: ("🌦️", "bruine"),
    55: ("🌧️", "bruine forte"), 56: ("🌧️", "bruine verglaçante"), 57: ("🌧️", "bruine verglaçante"),
    61: ("🌧️", "pluie légère"), 63: ("🌧️", "pluie"), 65: ("🌧️", "pluie forte"), 66: ("🌧️", "pluie verglaçante"),
    67: ("🌧️", "pluie verglaçante"), 71: ("🌨️", "neige légère"), 73: ("🌨️", "neige"), 75: ("❄️", "neige forte"),
    77: ("❄️", "grésil"), 80: ("🌦️", "averses"), 81: ("🌧️", "averses"), 82: ("⛈️", "fortes averses"),
    85: ("🌨️", "averses de neige"), 86: ("🌨️", "averses de neige"), 95: ("⛈️", "orage"),
    96: ("⛈️", "orage avec grêle"), 99: ("⛈️", "orage avec grêle")}


async def get_weather_forecast(pid: str) -> list:
    today = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).date().isoformat()
    cached = await db.weather_cache.find_one({"pharmacy_id": pid, "fetched_date": today}, {"_id": 0})
    if cached:
        return cached.get("days") or []
    settings = await db.pharmacy_settings.find_one({"pharmacy_id": pid}, {"_id": 0}) or {}
    address = settings.get("address") or DEFAULT_PHARMACY_ADDRESS
    parts = [p.strip() for p in address.split(",") if p.strip()]
    city = parts[1] if len(parts) >= 2 else (parts[0] if parts else "Montréal")
    lat, lon = 45.5019, -73.5674
    try:
        geo = await asyncio.to_thread(requests.get, "https://geocoding-api.open-meteo.com/v1/search",
                                      params={"name": city, "count": 1, "language": "fr"}, timeout=8)
        results = (geo.json().get("results") or [])
        if results:
            lat, lon = results[0]["latitude"], results[0]["longitude"]
    except Exception as exc:
        logger.warning(f"Géocodage météo échoué ({city}) : {exc}")
    try:
        fc = await asyncio.to_thread(requests.get, "https://api.open-meteo.com/v1/forecast", params={
            "latitude": lat, "longitude": lon,
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "America/Montreal", "forecast_days": 7}, timeout=8)
        daily = fc.json().get("daily") or {}
        dates = daily.get("time") or []
        codes = daily.get("weather_code") or []
        tmaxs = daily.get("temperature_2m_max") or []
        tmins = daily.get("temperature_2m_min") or []
        precips = daily.get("precipitation_probability_max") or []
        days = []
        for i, d in enumerate(dates):
            icon, label = WEATHER_CODES.get(int(codes[i] if i < len(codes) else 0), ("🌡️", ""))
            days.append({"date": d, "icon": icon, "label": label,
                         "tmax": round(float(tmaxs[i])) if i < len(tmaxs) else 0,
                         "tmin": round(float(tmins[i])) if i < len(tmins) else 0,
                         "precip": int(precips[i] or 0) if i < len(precips) else 0})
        if days:
            await db.weather_cache.update_one(
                {"pharmacy_id": pid},
                {"$set": {"pharmacy_id": pid, "fetched_date": today, "city": city, "days": days}}, upsert=True)
        return days
    except Exception as exc:
        logger.warning(f"Météo indisponible : {exc}")
        return []


@api_router.get("/weather")
async def get_weather(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    return {"days": await get_weather_forecast(pid)}


# ==================== RH avancé : SST, champs personnalisés, documents, banque d'heures, annonces, signatures ====================

class SstIncidentIn(BaseModel):
    date: str
    incident_type: str = "incident"
    location: str = ""
    description: str
    severity: str = "mineure"
    witness: str = ""


class SstPatchIn(BaseModel):
    status: Optional[str] = None
    corrective_actions: Optional[str] = None


@api_router.get("/sst/incidents")
async def list_sst_incidents(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    q: dict = {"pharmacy_id": pid}
    if user["role"] == "employee":
        q["employee_id"] = user.get("employee_id") or "__none__"
    return await db.sst_incidents.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/sst/incidents")
async def create_sst_incident(payload: SstIncidentIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    if payload.incident_type not in ("accident", "incident", "premiers_soins", "quasi_accident"):
        raise HTTPException(status_code=400, detail="Type de déclaration invalide.")
    if payload.severity not in ("mineure", "moderee", "majeure"):
        raise HTTPException(status_code=400, detail="Gravité invalide.")
    if not (payload.description or "").strip():
        raise HTTPException(status_code=400, detail="La description est requise.")
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid,
           "employee_id": user.get("employee_id") or "", "employee_name": user.get("name") or user["email"],
           "date": payload.date, "incident_type": payload.incident_type,
           "location": (payload.location or "")[:120], "description": payload.description.strip()[:2000],
           "severity": payload.severity, "witness": (payload.witness or "")[:120],
           "status": "ouvert", "corrective_actions": "",
           "created_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.sst_incidents.insert_one({**doc})
    type_labels = {"accident": "Accident de travail", "incident": "Incident", "premiers_soins": "Premiers soins", "quasi_accident": "Quasi-accident"}
    await _notify_admins(pid, "Déclaration santé & sécurité",
                         f"{doc['employee_name']} : {type_labels[payload.incident_type]} ({payload.severity}) le {payload.date}.",
                         module="sst", tone="amber")
    await log_audit(user["email"], user["role"], "SST_DECLARATION", "sst", doc["id"],
                    f"{type_labels[payload.incident_type]} — gravité {payload.severity}", pid)
    return doc


@api_router.patch("/sst/incidents/{sst_id}")
async def patch_sst_incident(sst_id: str, payload: SstPatchIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    update: dict = {}
    if payload.status is not None:
        if payload.status not in ("ouvert", "en_analyse", "clos"):
            raise HTTPException(status_code=400, detail="Statut invalide.")
        update["status"] = payload.status
    if payload.corrective_actions is not None:
        update["corrective_actions"] = payload.corrective_actions[:2000]
    if not update:
        raise HTTPException(status_code=400, detail="Aucun changement fourni.")
    doc = await db.sst_incidents.find_one_and_update(
        {"id": sst_id, "pharmacy_id": pid}, {"$set": update},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(status_code=404, detail="Déclaration introuvable.")
    if doc.get("employee_id") and payload.status:
        labels = {"ouvert": "rouverte", "en_analyse": "en cours d'analyse", "clos": "close"}
        await _notify_shift_change(pid, doc["employee_id"], "Suivi de votre déclaration SST",
                                   f"Votre déclaration du {doc['date']} est maintenant {labels.get(payload.status, payload.status)}.",
                                   "sky", module="sst")
    return doc


class CustomFieldsIn(BaseModel):
    fields: list


@api_router.get("/hr/custom-fields")
async def get_custom_fields(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    doc = await db.hr_custom_fields.find_one({"pharmacy_id": pid}, {"_id": 0})
    return {"fields": (doc or {}).get("fields", [])}


@api_router.put("/hr/custom-fields")
async def set_custom_fields(payload: CustomFieldsIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    fields = []
    for f in payload.fields[:12]:
        if not isinstance(f, dict):
            continue
        label = str(f.get("label") or "").strip()[:60]
        if not label:
            continue
        ftype = f.get("type") if f.get("type") in ("texte", "date", "choix") else "texte"
        fields.append({"id": f.get("id") or str(uuid.uuid4()), "label": label, "type": ftype,
                       "options": [str(o)[:40] for o in (f.get("options") or []) if str(o).strip()][:10]})
    await db.hr_custom_fields.update_one({"pharmacy_id": pid},
                                         {"$set": {"pharmacy_id": pid, "fields": fields}}, upsert=True)
    await log_audit(principal["email"], principal["role"], "CHAMPS_RH_MODIFIES", "rh", pid,
                    f"{len(fields)} champ(s) RH personnalisé(s) défini(s)", pid)
    return {"fields": fields}


class DocRequestIn(BaseModel):
    doc_type: str
    note: str = ""


class DocRequestPatchIn(BaseModel):
    status: str
    reply_note: str = ""


@api_router.get("/document-requests")
async def list_document_requests(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    q: dict = {"pharmacy_id": pid}
    if user["role"] == "employee":
        q["employee_id"] = user.get("employee_id") or "__none__"
    return await db.document_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)


@api_router.post("/document-requests")
async def create_document_request(payload: DocRequestIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    if not user.get("employee_id"):
        raise HTTPException(status_code=400, detail="Aucun dossier employé associé à votre compte.")
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid,
           "employee_id": user["employee_id"], "employee_name": user.get("name") or user["email"],
           "doc_type": (payload.doc_type or "Attestation d'emploi")[:80], "note": (payload.note or "")[:500],
           "status": "en_attente", "reply_note": "",
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.document_requests.insert_one({**doc})
    await _notify_admins(pid, "Demande de document RH",
                         f"{doc['employee_name']} demande : {doc['doc_type']}.", module="documents", tone="sky")
    return doc


@api_router.patch("/document-requests/{req_id}")
async def patch_document_request(req_id: str, payload: DocRequestPatchIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if payload.status not in ("en_attente", "en_traitement", "fournie", "refusee"):
        raise HTTPException(status_code=400, detail="Statut invalide.")
    doc = await db.document_requests.find_one_and_update(
        {"id": req_id, "pharmacy_id": pid},
        {"$set": {"status": payload.status, "reply_note": (payload.reply_note or "")[:500]}},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(status_code=404, detail="Demande introuvable.")
    labels = {"en_traitement": "est en traitement", "fournie": "est prête — voyez votre gestionnaire", "refusee": "a été refusée", "en_attente": "est en attente"}
    await _notify_shift_change(pid, doc["employee_id"], "Votre demande de document",
                               f"Votre demande « {doc['doc_type']} » {labels[payload.status]}."
                               + (f" Note : {payload.reply_note}" if payload.reply_note else ""),
                               "emerald" if payload.status == "fournie" else "sky", module="documents")
    return doc


class TimeBankIn(BaseModel):
    employee_id: str
    hours: float
    reason: str = ""


@api_router.get("/time-bank")
async def get_time_bank(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    if user["role"] == "employee":
        eid = user.get("employee_id") or "__none__"
        entries = await db.time_bank_entries.find({"pharmacy_id": pid, "employee_id": eid}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"balance": round(sum(e["hours"] for e in entries), 2), "entries": entries}
    entries = await db.time_bank_entries.find({"pharmacy_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    balances: dict = {}
    for e in entries:
        b = balances.setdefault(e["employee_id"], {"employee_id": e["employee_id"], "name": e.get("employee_name") or e["employee_id"], "balance": 0.0})
        b["balance"] = round(b["balance"] + e["hours"], 2)
    return {"balances": sorted(balances.values(), key=lambda x: x["name"]), "entries": entries[:50]}


@api_router.post("/time-bank")
async def add_time_bank_entry(payload: TimeBankIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if not (-100 <= payload.hours <= 100) or payload.hours == 0:
        raise HTTPException(status_code=400, detail="Heures invalides (entre −100 et 100, non nulles).")
    prof = await db.employee_profiles.find_one({"pharmacy_id": pid, "employee_id": payload.employee_id},
                                               {"_id": 0, "employee_name": 1})
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": payload.employee_id,
           "employee_name": (prof or {}).get("employee_name") or payload.employee_id,
           "hours": round(payload.hours, 2), "reason": (payload.reason or "")[:200],
           "created_by": principal["email"], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.time_bank_entries.insert_one({**doc})
    verb = "créditées à" if payload.hours > 0 else "débitées de"
    await _notify_shift_change(pid, payload.employee_id, "Banque d'heures mise à jour",
                               f"{abs(payload.hours)} h {verb} votre banque d'heures{f' — {payload.reason}' if payload.reason else ''}.",
                               "emerald" if payload.hours > 0 else "amber", module="timebank")
    await log_audit(principal["email"], principal["role"], "BANQUE_HEURES", "banque_heures", doc["id"],
                    f"{doc['employee_name']} : {payload.hours:+.2f} h ({payload.reason or 'sans motif'})", pid)
    return doc


class AnnouncementIn(BaseModel):
    title: str
    body: str = ""
    pinned: bool = False


@api_router.get("/announcements")
async def list_announcements(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    docs = await db.announcements.find({"pharmacy_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(30)
    return sorted(docs, key=lambda d: (not d.get("pinned"), ), reverse=False)


@api_router.post("/announcements")
async def create_announcement(payload: AnnouncementIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if not (payload.title or "").strip():
        raise HTTPException(status_code=400, detail="Le titre est requis.")
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "title": payload.title.strip()[:120],
           "body": (payload.body or "").strip()[:2000], "pinned": bool(payload.pinned),
           "author_name": principal.get("name") or principal["email"], "likes": [],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.announcements.insert_one({**doc})
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "pharmacy_id": pid, "target_roles": ["employee"],
        "title": "Nouvelle annonce", "detail": doc["title"], "module": "dashboard", "tone": "sky",
        "read_by": [], "created_at": datetime.now(timezone.utc).isoformat()})
    await log_audit(principal["email"], principal["role"], "ANNONCE_PUBLIEE", "annonce", doc["id"], doc["title"], pid)
    return doc


@api_router.delete("/announcements/{ann_id}")
async def delete_announcement(ann_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    res = await db.announcements.delete_one({"id": ann_id, "pharmacy_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Annonce introuvable.")
    return {"ok": True}


@api_router.post("/announcements/{ann_id}/like")
async def like_announcement(ann_id: str, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    key = user.get("employee_id") or user["email"]
    doc = await db.announcements.find_one({"id": ann_id, "pharmacy_id": pid}, {"_id": 0, "likes": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Annonce introuvable.")
    op = "$pull" if key in (doc.get("likes") or []) else "$addToSet"
    await db.announcements.update_one({"id": ann_id, "pharmacy_id": pid}, {op: {"likes": key}})
    return {"ok": True, "liked": op == "$addToSet"}


class ContractSignIn(BaseModel):
    contract_id: str
    contract_label: str = ""
    signature: str
    employee_id: str = ""


@api_router.get("/contracts/signatures")
async def list_contract_signatures(user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    q: dict = {"pharmacy_id": pid}
    if user["role"] == "employee":
        q["employee_id"] = user.get("employee_id") or "__none__"
    return await db.contract_signatures.find(q, {"_id": 0}).to_list(500)


@api_router.post("/contracts/sign")
async def sign_contract(payload: ContractSignIn, user: dict = Depends(get_current_user)):
    pid = scoped_pid(user)
    if not payload.signature.startswith("data:image/") or len(payload.signature) > 200_000:
        raise HTTPException(status_code=400, detail="Signature invalide.")
    if user["role"] == "employee":
        eid = user.get("employee_id") or ""
        if payload.employee_id and payload.employee_id != eid:
            raise HTTPException(status_code=403, detail="Vous ne pouvez signer que vos propres contrats.")
    else:
        eid = payload.employee_id or ""
    if not eid:
        raise HTTPException(status_code=400, detail="Employé requis.")
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "contract_id": payload.contract_id,
           "contract_label": (payload.contract_label or "")[:120], "employee_id": eid,
           "signed_by": user.get("name") or user["email"], "signature": payload.signature,
           "signed_at": datetime.now(timezone.utc).isoformat()}
    await db.contract_signatures.update_one({"pharmacy_id": pid, "contract_id": payload.contract_id},
                                            {"$set": doc}, upsert=True)
    await _notify_admins(pid, "Contrat signé électroniquement",
                         f"{doc['signed_by']} a signé « {doc['contract_label'] or payload.contract_id} ».",
                         module="contracts", tone="emerald")
    await log_audit(user["email"], user["role"], "CONTRAT_SIGNE", "contrat", payload.contract_id,
                    f"Signature électronique par {doc['signed_by']}", pid)
    return {"ok": True, "signed_at": doc["signed_at"]}


# ==================== Rôles personnalisables, Rapports, API développeurs & POS ====================

ALL_MODULE_KEYS = {"dashboard", "tasks", "myspace", "messages", "team", "employees", "licenses", "scheduling",
                   "recruitment", "payroll", "replacements", "vacations", "performance", "onboarding", "contracts",
                   "benefits", "faq", "training", "deliveries", "resources", "sst", "reports"}


class ModuleOverridesIn(BaseModel):
    module_overrides: dict


@api_router.get("/users/by-employee/{employee_id}")
async def get_user_by_employee(employee_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    target = await db.users.find_one({"pharmacy_id": pid, "employee_id": employee_id}, {"_id": 0})
    if not target:
        return {"found": False}
    return {"found": True, "email": target["email"], "role": target["role"],
            "module_overrides": target.get("module_overrides", {})}


@api_router.put("/users/by-employee/{employee_id}/modules")
async def set_module_overrides(employee_id: str, payload: ModuleOverridesIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    target = await db.users.find_one({"pharmacy_id": pid, "employee_id": employee_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Aucun compte utilisateur lié à cet employé.")
    overrides = {k: bool(v) for k, v in (payload.module_overrides or {}).items() if k in ALL_MODULE_KEYS}
    await db.users.update_one({"id": target["id"]}, {"$set": {"module_overrides": overrides}})
    await log_audit(principal["email"], principal["role"], "ACCES_MODULES_PERSONNALISES", "utilisateur", target["id"],
                    f"Accès aux modules personnalisé pour {target['email']} ({len(overrides)} règle(s))", pid)
    return {"module_overrides": overrides}


class EmployeeAccountIn(BaseModel):
    employee_id: str
    email: str
    name: str = ""
    role: str = "employee"


class BulkInviteIn(BaseModel):
    items: list[EmployeeAccountIn] = []


ACCOUNT_ROLES = ("employee", "manager", "admin")


async def _create_employee_account(pid: str, item: EmployeeAccountIn) -> dict:
    email = item.email.strip().lower()
    base = {"employee_id": item.employee_id, "email": email, "name": item.name, "created": False}
    if "@" not in email or "." not in email.split("@")[-1]:
        return {**base, "reason": "Courriel invalide"}
    if await db.users.find_one({"email": email}):
        return {**base, "reason": "Un compte existe déjà avec ce courriel"}
    if await db.users.find_one({"pharmacy_id": pid, "employee_id": item.employee_id}):
        return {**base, "reason": "Cet employé a déjà un compte lié"}
    role = item.role if item.role in ACCOUNT_ROLES else "employee"
    temp = gen_temp_password()
    doc = {"id": str(uuid.uuid4()), "email": email, "password_hash": hash_password(temp),
           "name": (item.name.strip() or email)[:120], "role": role, "pharmacy_id": pid,
           "employee_id": item.employee_id, "is_temporary_password": True, "suspended": False,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(doc)
    conv = await db.conversations.find_one({"pharmacy_id": pid, "type": "equipe"})
    if conv:
        parts = list(conv.get("participants") or [])
        if email not in parts:
            parts.append(email)
            await db.conversations.update_one({"id": conv["id"]}, {"$set": {"participants": parts}})
    email_sent = await send_credentials_email(item.name.strip() or email, email, temp)
    return {"employee_id": item.employee_id, "email": email, "name": item.name, "role": role,
            "created": True, "email_sent": email_sent,
            "temporary_password": None if email_sent else temp}


@api_router.post("/accounts/for-employee")
async def create_account_for_employee(payload: EmployeeAccountIn, principal: dict = Depends(get_principal)):
    if principal["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs et gestionnaires.")
    if principal["role"] == "manager" and payload.role == "admin":
        raise HTTPException(status_code=403, detail="Seul un administrateur peut créer un compte administrateur.")
    pid = scoped_pid(principal)
    res = await _create_employee_account(pid, payload)
    if not res.get("created"):
        raise HTTPException(status_code=400, detail=res.get("reason", "Création impossible."))
    await log_audit(principal["email"], principal["role"], "CREATION_COMPTE_EMPLOYE", "utilisateur", res["email"],
                    f"Compte {res['role']} créé pour l'employé {payload.employee_id} (invitation par courriel)", pid)
    return res


@api_router.post("/accounts/bulk-invite")
async def bulk_invite_accounts(payload: BulkInviteIn, principal: dict = Depends(get_principal)):
    if principal["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs et gestionnaires.")
    pid = scoped_pid(principal)
    results = []
    for item in payload.items[:200]:
        if principal["role"] == "manager" and item.role == "admin":
            results.append({"employee_id": item.employee_id, "email": item.email, "name": item.name,
                            "created": False, "reason": "Seul un administrateur peut créer un compte administrateur"})
            continue
        results.append(await _create_employee_account(pid, item))
    created = sum(1 for r in results if r.get("created"))
    if results:
        await log_audit(principal["email"], principal["role"], "INSCRIPTION_PERSONNEL", "utilisateur", pid,
                        f"Inscription du personnel : {created} compte(s) créé(s) sur {len(results)} demandé(s)", pid)
    return {"results": results, "created": created}


@api_router.get("/accounts/linked-employee-ids")
async def linked_employee_ids(principal: dict = Depends(get_principal)):
    if principal["role"] not in ("admin", "manager", "superadmin"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs et gestionnaires.")
    pid = scoped_pid(principal)
    docs = await db.users.find({"pharmacy_id": pid, "employee_id": {"$nin": [None, ""]}},
                               {"_id": 0, "employee_id": 1}).to_list(2000)
    return {"ids": [d["employee_id"] for d in docs]}


REPORT_CATALOG = [
    {"id": "planifie_vs_travaille", "title": "Temps planifié vs travaillé",
     "desc": "Heures à l'horaire et heures pointées des 7 derniers jours, par employé."},
    {"id": "taches_semaine", "title": "Tâches de la semaine",
     "desc": "Tâches faites et restantes de la semaine, par quart."},
    {"id": "conges_soldes", "title": "Congés et demandes",
     "desc": "Demandes en attente et congés approuvés à venir."},
    {"id": "banque_heures", "title": "Banque d'heures",
     "desc": "Soldes de la banque d'heures par employé."},
]


async def build_report_html(pid: str, report_id: str) -> tuple[str, str]:
    now_mtl = datetime.now(timezone.utc).astimezone(MONTREAL_TZ)
    today = now_mtl.date()
    week_ago = (today - timedelta(days=7)).isoformat()
    rows = ""
    if report_id == "planifie_vs_travaille":
        shifts = await db.shifts.find({"pharmacy_id": pid, "date": {"$gte": week_ago, "$lte": today.isoformat()}}, {"_id": 0}).to_list(5000)
        punches = await db.punches.find({"pharmacy_id": pid, "date": {"$gte": week_ago}, "punch_out": {"$ne": None}}, {"_id": 0}).to_list(5000)
        profiles = await db.employee_profiles.find({"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "employee_name": 1}).to_list(1000)
        names = {p["employee_id"]: p.get("employee_name") or p["employee_id"] for p in profiles}
        planned: dict = {}
        for s in shifts:
            try:
                h = (int(s["end"][:2]) * 60 + int(s["end"][3:5]) - int(s["start"][:2]) * 60 - int(s["start"][3:5])) / 60
            except (ValueError, KeyError):
                h = 0
            planned[s["employee_id"]] = planned.get(s["employee_id"], 0) + max(0, h)
        worked: dict = {}
        for p in punches:
            try:
                d = (datetime.fromisoformat(p["punch_out"]) - datetime.fromisoformat(p["punch_in"])).total_seconds() / 3600
            except (ValueError, TypeError):
                d = 0
            worked[p["employee_id"]] = worked.get(p["employee_id"], 0) + max(0, d)
        for eid in sorted(set(planned) | set(worked), key=lambda e: names.get(e, e)):
            rows += (f"<tr><td style='padding:6px 12px'>{names.get(eid, eid)}</td>"
                     f"<td style='padding:6px 12px;text-align:right'>{planned.get(eid, 0):.1f} h</td>"
                     f"<td style='padding:6px 12px;text-align:right'>{worked.get(eid, 0):.1f} h</td></tr>")
        table = ("<table style='border-collapse:collapse;background:#f8fafc;border-radius:8px;width:100%'>"
                 "<tr><th style='padding:6px 12px;text-align:left'>Employé</th><th style='padding:6px 12px;text-align:right'>Planifié</th>"
                 "<th style='padding:6px 12px;text-align:right'>Travaillé (punch)</th></tr>" + (rows or "<tr><td style='padding:6px 12px'>Aucune donnée.</td></tr>") + "</table>")
        return ("Rapport — Temps planifié vs travaillé", table)
    if report_id == "taches_semaine":
        monday = (today - timedelta(days=today.weekday())).isoformat()
        tasks = await db.shift_tasks.find({"pharmacy_id": pid, "date": {"$gte": monday, "$lte": today.isoformat()}}, {"_id": 0}).to_list(2000)
        done = [t for t in tasks if t.get("done")]
        todo = [t for t in tasks if not t.get("done")]
        rows = "".join(f"<tr><td style='padding:6px 12px'>{t['date']}</td><td style='padding:6px 12px'>{t.get('shift','')}</td>"
                       f"<td style='padding:6px 12px'>{t['title']}</td><td style='padding:6px 12px'>{'✅ Faite' if t.get('done') else '⏳ À faire'}</td></tr>"
                       for t in sorted(tasks, key=lambda x: (x['date'], x.get('shift', ''))))
        table = (f"<p><b>{len(done)}</b> faites · <b>{len(todo)}</b> restantes</p>"
                 "<table style='border-collapse:collapse;background:#f8fafc;border-radius:8px;width:100%'>"
                 "<tr><th style='padding:6px 12px;text-align:left'>Date</th><th style='padding:6px 12px;text-align:left'>Quart</th>"
                 "<th style='padding:6px 12px;text-align:left'>Tâche</th><th style='padding:6px 12px;text-align:left'>Statut</th></tr>"
                 + (rows or "<tr><td style='padding:6px 12px'>Aucune tâche cette semaine.</td></tr>") + "</table>")
        return ("Rapport — Tâches de la semaine", table)
    if report_id == "conges_soldes":
        pending = await db.leave_requests.find({"pharmacy_id": pid, "status": "En attente"}, {"_id": 0}).to_list(500)
        upcoming = await db.leave_requests.find({"pharmacy_id": pid, "status": "Approuvée",
                                                 "end_date": {"$gte": today.isoformat()}}, {"_id": 0}).to_list(500)
        rows = "".join(f"<tr><td style='padding:6px 12px'>{r.get('employee_name','')}</td><td style='padding:6px 12px'>{r.get('leave_type','')}</td>"
                       f"<td style='padding:6px 12px'>{r.get('start_date','')} → {r.get('end_date','')}</td><td style='padding:6px 12px'>{r.get('status','')}</td></tr>"
                       for r in pending + upcoming)
        table = (f"<p><b>{len(pending)}</b> demande(s) en attente · <b>{len(upcoming)}</b> congé(s) approuvé(s) à venir</p>"
                 "<table style='border-collapse:collapse;background:#f8fafc;border-radius:8px;width:100%'>"
                 "<tr><th style='padding:6px 12px;text-align:left'>Employé</th><th style='padding:6px 12px;text-align:left'>Type</th>"
                 "<th style='padding:6px 12px;text-align:left'>Dates</th><th style='padding:6px 12px;text-align:left'>Statut</th></tr>"
                 + (rows or "<tr><td style='padding:6px 12px'>Rien à signaler.</td></tr>") + "</table>")
        return ("Rapport — Congés et demandes", table)
    if report_id == "banque_heures":
        entries = await db.time_bank_entries.find({"pharmacy_id": pid}, {"_id": 0}).to_list(2000)
        balances: dict = {}
        for e in entries:
            b = balances.setdefault(e["employee_id"], {"name": e.get("employee_name") or e["employee_id"], "balance": 0.0})
            b["balance"] = round(b["balance"] + e["hours"], 2)
        rows = "".join(f"<tr><td style='padding:6px 12px'>{b['name']}</td>"
                       f"<td style='padding:6px 12px;text-align:right'>{b['balance']:+.2f} h</td></tr>"
                       for b in sorted(balances.values(), key=lambda x: x["name"]))
        table = ("<table style='border-collapse:collapse;background:#f8fafc;border-radius:8px;width:100%'>"
                 "<tr><th style='padding:6px 12px;text-align:left'>Employé</th><th style='padding:6px 12px;text-align:right'>Solde</th></tr>"
                 + (rows or "<tr><td style='padding:6px 12px'>Aucune heure en banque.</td></tr>") + "</table>")
        return ("Rapport — Banque d'heures", table)
    raise HTTPException(status_code=404, detail="Rapport inconnu.")


async def send_scheduled_report_email(pid: str, report_id: str, recipients: list) -> bool:
    if not os.environ.get("RESEND_API_KEY", "") or not recipients:
        return False
    subject, table = await build_report_html(pid, report_id)
    when = datetime.now(timezone.utc).astimezone(MONTREAL_TZ).strftime("%Y-%m-%d %H:%M")
    html = ("<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a'>"
            f"<h2 style='color:#047857'>{subject}</h2>{table}"
            f"<p style='font-size:12px;color:#94a3b8;margin-top:16px'>Généré le {when} (Montréal) — Arrière Plan</p></div>")
    try:
        await asyncio.wait_for(asyncio.to_thread(resend.Emails.send, {
            "from": await get_sender(), "to": recipients, "subject": f"{subject} — Arrière Plan", "html": html}),
            timeout=12)
        return True
    except Exception as e:
        logger.warning(f"Envoi du rapport {report_id} échoué : {e}")
        return False


@api_router.get("/reports")
async def list_reports(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    user = await db.users.find_one({"email": principal["email"]}, {"_id": 0, "report_favorites": 1})
    schedules = await db.report_schedules.find({"pharmacy_id": pid}, {"_id": 0}).to_list(20)
    return {"catalog": REPORT_CATALOG,
            "favorites": (user or {}).get("report_favorites", []),
            "schedules": {s["report_id"]: s["frequency"] for s in schedules if s.get("frequency") != "off"}}


@api_router.post("/reports/{report_id}/favorite")
async def toggle_report_favorite(report_id: str, principal: dict = Depends(get_principal)):
    if report_id not in {r["id"] for r in REPORT_CATALOG}:
        raise HTTPException(status_code=404, detail="Rapport inconnu.")
    user = await db.users.find_one({"email": principal["email"]}, {"_id": 0, "report_favorites": 1})
    favs = (user or {}).get("report_favorites", [])
    op = "$pull" if report_id in favs else "$addToSet"
    await db.users.update_one({"email": principal["email"]}, {op: {"report_favorites": report_id}})
    return {"favorite": op == "$addToSet"}


class ReportScheduleIn(BaseModel):
    frequency: str


@api_router.put("/reports/{report_id}/schedule")
async def set_report_schedule(report_id: str, payload: ReportScheduleIn, principal: dict = Depends(get_principal)):
    if report_id not in {r["id"] for r in REPORT_CATALOG}:
        raise HTTPException(status_code=404, detail="Rapport inconnu.")
    if payload.frequency not in ("hebdo", "mensuel", "off"):
        raise HTTPException(status_code=400, detail="Fréquence invalide (hebdo, mensuel ou off).")
    pid = scoped_pid(principal)
    await db.report_schedules.update_one(
        {"pharmacy_id": pid, "report_id": report_id},
        {"$set": {"pharmacy_id": pid, "report_id": report_id, "frequency": payload.frequency,
                  "updated_by": principal["email"], "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    return {"report_id": report_id, "frequency": payload.frequency}


@api_router.post("/reports/{report_id}/send")
async def send_report_now(report_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    ok = await send_scheduled_report_email(pid, report_id, [principal["email"]])
    if not ok:
        raise HTTPException(status_code=400, detail="Envoi impossible — le courriel expéditeur/destinataire n'est pas autorisé par Resend (vérifiez votre domaine sur resend.com/domains).")
    return {"ok": True, "sent_to": principal["email"]}


async def scheduled_reports_job():
    now_mtl = datetime.now(timezone.utc).astimezone(MONTREAL_TZ)
    is_monday = now_mtl.weekday() == 0
    is_first = now_mtl.day == 1
    schedules = await db.report_schedules.find({"frequency": {"$in": ["hebdo", "mensuel"]}}, {"_id": 0}).to_list(200)
    sent = 0
    for s in schedules:
        if (s["frequency"] == "hebdo" and not is_monday) or (s["frequency"] == "mensuel" and not is_first):
            continue
        admins = await db.users.find({"pharmacy_id": s["pharmacy_id"], "role": {"$in": ["admin", "manager"]},
                                      "suspended": {"$ne": True}}, {"_id": 0, "email": 1}).to_list(20)
        if await send_scheduled_report_email(s["pharmacy_id"], s["report_id"], [a["email"] for a in admins]):
            sent += 1
    if sent:
        logger.info(f"Rapports programmés envoyés : {sent}")


class ApiKeyIn(BaseModel):
    label: str = "Intégration POS"


@api_router.get("/dev/keys")
async def list_api_keys(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    return await db.api_keys.find({"pharmacy_id": pid},
                                  {"_id": 0, "key_hash": 0}).sort("created_at", -1).to_list(20)


@api_router.post("/dev/keys")
async def create_api_key(payload: ApiKeyIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    count = await db.api_keys.count_documents({"pharmacy_id": pid})
    if count >= 5:
        raise HTTPException(status_code=400, detail="Maximum 5 clés API par pharmacie.")
    raw = f"apk_{secrets.token_urlsafe(32)}"
    doc = {"id": str(uuid.uuid4()), "pharmacy_id": pid, "label": (payload.label or "Intégration")[:60],
           "prefix": raw[:12], "key_hash": hashlib.sha256(raw.encode()).hexdigest(),
           "last_used_at": None, "created_by": principal["email"],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.api_keys.insert_one({**doc})
    await log_audit(principal["email"], principal["role"], "CLE_API_CREEE", "api", doc["id"], doc["label"], pid)
    doc.pop("key_hash")
    return {**doc, "key": raw}


@api_router.delete("/dev/keys/{key_id}")
async def delete_api_key(key_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    res = await db.api_keys.delete_one({"id": key_id, "pharmacy_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Clé introuvable.")
    await log_audit(principal["email"], principal["role"], "CLE_API_REVOQUEE", "api", key_id, "", pid)
    return {"ok": True}


async def pharmacy_from_api_key(request: Request) -> str:
    raw = request.headers.get("X-API-Key", "").strip()
    if not raw:
        raise HTTPException(status_code=401, detail="En-tête X-API-Key requis.")
    doc = await db.api_keys.find_one({"key_hash": hashlib.sha256(raw.encode()).hexdigest()}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=401, detail="Clé API invalide ou révoquée.")
    await db.api_keys.update_one({"id": doc["id"]},
                                 {"$set": {"last_used_at": datetime.now(timezone.utc).isoformat()}})
    return doc["pharmacy_id"]


class PosTrafficIn(BaseModel):
    traffic: dict


@api_router.post("/integrations/pos/traffic")
async def pos_traffic_webhook(payload: PosTrafficIn, request: Request):
    pid = await pharmacy_from_api_key(request)
    try:
        traffic = _sanitize_traffic(payload.traffic)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=400, detail="Format d'achalandage invalide.")
    existing = await db.schedule_settings.find_one({"pharmacy_id": pid}, {"_id": 0, "traffic": 1}) or {}
    merged = {**(existing.get("traffic") or {}), **traffic}
    await db.schedule_settings.update_one({"pharmacy_id": pid},
                                          {"$set": {"pharmacy_id": pid, "traffic": merged,
                                                    "updated_by": "api", "updated_at": datetime.now(timezone.utc).isoformat()}},
                                          upsert=True)
    await log_audit("api", "api", "ACHALANDAGE_POS", "horaire", pid,
                    f"Achalandage mis à jour via l'API POS ({len(traffic)} jour(s))", pid)
    return {"ok": True, "days_updated": len(traffic)}


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
    ip = client_ip(request)
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
    notify_to = os.environ.get("DEMO_NOTIFY_EMAIL", "").strip() or "info@arriereplanrh.com"
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

@api_router.post("/employees/{employee_id}/anonymize")
async def anonymize_employee(employee_id: str, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    exists = await db.users.find_one({"employee_id": employee_id}, {"_id": 0, "id": 1}) \
        or await db.employee_profiles.find_one({"pharmacy_id": pid, "employee_id": employee_id}, {"_id": 0, "id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Employé introuvable — aucun dossier serveur à anonymiser.")
    label = f"Employé anonymisé ({employee_id[-4:]})"
    result = {"user": 0, "profile": 0, "punches": 0, "licenses": 0, "label": label}

    user_scrub = {
        "name": label, "email": f"anonymise+{employee_id}@arriereplan.local",
        "suspended": True, "anonymized": True,
        "anonymized_at": datetime.now(timezone.utc).isoformat(),
    }
    ures = await db.users.update_one({"employee_id": employee_id}, {"$set": user_scrub})
    result["user"] = ures.modified_count

    pres = await db.employee_profiles.update_one(
        {"pharmacy_id": pid, "employee_id": employee_id},
        {"$set": {"employee_name": label, "notes": "", "anonymized": True},
         "$unset": {"punch_code_hash": "", "payroll_number": ""}})
    result["profile"] = pres.modified_count

    punres = await db.punches.update_many(
        {"pharmacy_id": pid, "employee_id": employee_id},
        {"$set": {"employee_name": label, "punch_in_location": None, "punch_out_location": None}})
    result["punches"] = punres.modified_count

    licres = await db.licenses.update_many(
        {"pharmacy_id": pid, "employee_id": employee_id},
        {"$set": {"employee_name": label, "employee_email": ""}})
    result["licenses"] = licres.modified_count

    await log_audit(principal["email"], principal["role"], "ANONYMISATION_EMPLOYE", "employé", employee_id,
                    f"Renseignements personnels anonymisés (droit à l'oubli Loi 25) — comptes:{result['user']} profil:{result['profile']} pointages:{result['punches']} licences:{result['licenses']}", pid)
    return {"ok": True, **result}


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
        "evaluations": [],
        "notifications": [],
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
        export["evaluations"] = await db.evaluations.find(
            {"pharmacy_id": user["pharmacy_id"], "employee_id": user["employee_id"]},
            {"_id": 0}).sort("created_at", -1).to_list(500)
    notif_ors: list[dict] = [{"target_email": user["email"]}]
    if user.get("employee_id"):
        notif_ors.append({"target_employee_id": user["employee_id"]})
    export["notifications"] = await db.notifications.find(
        {"pharmacy_id": scoped_pid(user), "$or": notif_ors},
        {"_id": 0}).sort("created_at", -1).to_list(500)
    await log_audit(user["email"], user["role"], "EXPORT_DONNEES_PERSONNELLES", "utilisateur", user["id"],
                    "Export de ses propres données (droit d'accès Loi 25)", user.get("pharmacy_id") or "")
    return export


@api_router.get("/superadmin/security-overview")
async def security_overview(su: dict = Depends(require_superadmin)):
    now = datetime.now(timezone.utc)
    since_7d = (now - timedelta(days=7)).isoformat()
    suspicious = await db.login_events.find(
        {"flagged_new_ip": True, "created_at": {"$gte": since_7d}},
        {"_id": 0}).sort("created_at", -1).to_list(50)
    locks = await db.login_attempts.find(
        {"locked_until": {"$gt": now.isoformat()}}, {"_id": 0}).sort("locked_until", -1).to_list(100)
    incidents = await db.incidents.find(
        {"status": {"$ne": "clos"}},
        {"_id": 0, "id": 1, "title": 1, "severity": 1, "status": 1, "created_at": 1}).sort("created_at", -1).to_list(100)
    temp_pw = await db.users.count_documents({"is_temporary_password": True, "suspended": {"$ne": True}})
    suspended = await db.users.count_documents({"suspended": True})
    return {
        "suspicious_logins_7d": suspicious,
        "locked_accounts": locks,
        "open_incidents": incidents,
        "temporary_password_count": temp_pw,
        "suspended_count": suspended,
    }


class UnlockIn(BaseModel):
    identifier: str


@api_router.post("/superadmin/unlock")
async def unlock_identifier(payload: UnlockIn, su: dict = Depends(require_superadmin)):
    ident = payload.identifier.strip()
    res = await db.login_attempts.delete_one({"identifier": ident})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Aucun verrou trouvé pour cet identifiant.")
    await log_audit(su["email"], su["role"], "DEVERROUILLAGE_COMPTE", "compte", ident,
                    "Verrou de connexion levé par le superadmin", "")
    return {"ok": True}


class RepairTenantIn(BaseModel):
    pharmacy_id: str
    pharmacy_name: Optional[str] = None
    link_admin_employee: bool = True


@api_router.post("/superadmin/repair-tenant")
async def sa_repair_tenant(payload: RepairTenantIn, su: dict = Depends(require_superadmin)):
    """Raccorde comptes, fiches employés et chat d'équipe pour une officine."""
    pid = payload.pharmacy_id.strip()
    ph = await db.pharmacies.find_one({"id": pid}, {"_id": 0})
    if not ph:
        raise HTTPException(status_code=404, detail="Pharmacie introuvable.")
    actions = []
    if payload.pharmacy_name and payload.pharmacy_name.strip():
        await db.pharmacies.update_one({"id": pid}, {"$set": {"name": payload.pharmacy_name.strip()[:120]}})
        actions.append("nom_pharmacie")
    users = await db.users.find({"pharmacy_id": pid}, {"_id": 0}).to_list(500)
    emails = [u.get("email") for u in users if u.get("email")]
    conv = await db.conversations.find_one({"pharmacy_id": pid, "type": "equipe"})
    if conv:
        await db.conversations.update_one({"id": conv["id"]}, {"$set": {"participants": emails}})
        actions.append("chat_equipe")
    elif emails:
        await db.conversations.insert_one({
            "id": str(uuid.uuid4()), "pharmacy_id": pid, "type": "equipe",
            "name": "Toute l'équipe", "participants": emails,
            "created_by": su["email"], "created_at": datetime.now(timezone.utc).isoformat(),
        })
        actions.append("chat_equipe_cree")
    linked = 0
    if payload.link_admin_employee:
        for u in users:
            if u.get("employee_id"):
                continue
            if u.get("role") not in ("admin", "manager"):
                continue
            emp_id = "emp_" + uuid.uuid4().hex[:10]
            name = u.get("name") or u.get("email")
            await db.employee_profiles.update_one(
                {"pharmacy_id": pid, "employee_id": emp_id},
                {"$setOnInsert": {
                    "id": str(uuid.uuid4()), "pharmacy_id": pid, "employee_id": emp_id,
                    "employee_name": name, "hourly_rate": 0, "roles": ["Pharmacien(ne) propriétaire"],
                    "department": "", "punch_code_set": False,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "updated_by": su["email"],
                }},
                upsert=True,
            )
            await db.users.update_one({"id": u["id"]}, {"$set": {"employee_id": emp_id}})
            linked += 1
        if linked:
            actions.append(f"admins_lies:{linked}")
    profiles = await db.employee_profiles.find({"pharmacy_id": pid}, {"_id": 0, "employee_id": 1, "employee_name": 1}).to_list(2000)
    for p in profiles:
        exists = await db.leave_balances.find_one({"employee_id": p["employee_id"], "year": datetime.now(timezone.utc).year})
        if not exists:
            await db.leave_balances.insert_one({
                "employee_id": p["employee_id"], "employee_name": p.get("employee_name") or "",
                "year": datetime.now(timezone.utc).year,
                "allocations": {"Vacances": 0.0, "Maladie": 0.0, "Mobile": 0.0},
                "carryover": {"Vacances": 0.0, "Maladie": 0.0, "Mobile": 0.0},
                "used": {"Vacances": 0, "Maladie": 0, "Mobile": 0},
                "remaining": {"Vacances": 0.0, "Maladie": 0.0, "Mobile": 0.0},
            })
    actions.append("soldes_conges")
    await log_audit(su["email"], su["role"], "REPARATION_OFFICINE", "pharmacie", pid,
                    f"Réparation : {', '.join(actions)}", pid)
    return {"ok": True, "pharmacy_id": pid, "actions": actions, "accounts": len(users), "profiles": len(profiles)}


@api_router.get("/me/expiring")
async def my_expiring(user: dict = Depends(get_current_user)):
    out: dict = {"licenses": [], "trainings": []}
    today = date.today()
    if user.get("employee_id") and user.get("pharmacy_id"):
        docs = await db.licenses.find(
            {"pharmacy_id": user["pharmacy_id"], "employee_id": user["employee_id"], "is_deleted": False},
            {"_id": 0, "license_number": 1, "position": 1, "expiry_date": 1}).to_list(50)
        for d in docs:
            try:
                days = (date.fromisoformat(d["expiry_date"]) - today).days
            except ValueError:
                continue
            if days <= 60:
                out["licenses"].append({**d, "days_left": days})
    assigns = await db.training_assignments.find({"employee_email": user["email"]}, {"_id": 0}).to_list(100)
    for a in assigns:
        try:
            days = (date.fromisoformat(a.get("due_date") or "") - today).days
        except ValueError:
            continue
        if days > 14:
            continue
        best = await db.training_attempts.find_one(
            {"training_id": a["training_id"], "user_email": user["email"], "passed": True}, {"_id": 0, "id": 1})
        if best:
            continue
        training = await db.trainings.find_one({"id": a["training_id"], "status": "published"}, {"_id": 0, "title": 1})
        if not training:
            continue
        out["trainings"].append({"training_id": a["training_id"], "title": training["title"],
                                 "due_date": a["due_date"], "days_left": days, "overdue": days < 0})
    out["licenses"].sort(key=lambda x: x["days_left"])
    out["trainings"].sort(key=lambda x: x["days_left"])
    return out


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

