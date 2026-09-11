"""Expéditeur Resend + gabarits courriel."""
import asyncio
import logging
import os

import resend

from .config import db

logger = logging.getLogger(__name__)

SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "")
DEFAULT_SENDER = (
    f"Arrière Plan <{SENDER_EMAIL}>"
    if SENDER_EMAIL and "<" not in SENDER_EMAIL
    else (SENDER_EMAIL or "Arrière Plan <onboarding@resend.dev>")
)
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "https://arriereplanrh.com")


async def get_sender() -> str:
    doc = await db.email_settings.find_one({"id": "global"}, {"_id": 0})
    if doc and doc.get("sender_email"):
        return f"{doc.get('sender_name') or 'Arrière Plan'} <{doc['sender_email']}>"
    return DEFAULT_SENDER


def hash_reset_code(code: str) -> str:
    import hashlib
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


def welcome_email_html(name: str, email: str, temp_password: str, reset: bool = False) -> str:
    intro = (
        "Votre mot de passe a été réinitialisé par un administrateur de la plateforme."
        if reset else "Votre compte Arrière Plan vient d'être créé."
    )
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
            "html": welcome_email_html(name, email, temp_password, reset),
        })
        return True
    except Exception as exc:
        logger.warning(f"Courriel d'accès non envoyé à {email} : {exc}")
        return False
