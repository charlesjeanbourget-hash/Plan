"""Messagerie interne — extraits de server.py."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid

CONVERSATION_TYPES = ("equipe", "gestionnaires", "direct")
router = APIRouter(prefix="/chat", tags=["chat"])


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
    if convo["pharmacy_id"] != scoped_pid(user):
        return False
    if convo["type"] == "equipe":
        return True
    if convo["type"] == "gestionnaires":
        return user["role"] in ("admin", "manager", "superadmin")
    return user["email"] in convo.get("participants", [])


@router.get("/users")
async def chat_users(principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    return await db.users.find(
        {"pharmacy_id": pid, "role": {"$in": ["admin", "manager", "employee"]}},
        {"_id": 0, "email": 1, "name": 1, "role": 1, "employee_id": 1},
    ).sort("name", 1).to_list(300)


@router.post("/conversations")
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
            {"pharmacy_id": pid, "type": "direct", "participants": participants}, {"_id": 0}
        )
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
    await log_audit(
        principal["email"], principal["role"], "CREATION_CONVERSATION", "messagerie", doc["id"],
        f"Conversation « {name} » ({payload.type}) créée", pid,
    )
    return doc


@router.get("/conversations")
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
            "created_at": {"$gt": read_by.get(c["id"], "")},
        })
        out.append({**c, "unread": unread})
    return out


@router.get("/conversations/{conversation_id}/messages")
async def list_chat_messages(conversation_id: str, user: dict = Depends(get_current_user)):
    convo = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not convo or not chat_can_access(convo, user):
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    msgs = await db.chat_messages.find(
        {"conversation_id": conversation_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(300)
    await db.conversation_reads.update_one(
        {"conversation_id": conversation_id, "email": user["email"]},
        {"$set": {
            "conversation_id": conversation_id, "email": user["email"],
            "last_read_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return msgs


@router.post("/conversations/{conversation_id}/messages")
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
            "name": att.name[:120] or "fichier", "mime": att.mime[:80], "data": att.data, "created_at": now,
        })
        attachment_meta = {
            "id": att_id, "name": att.name[:120] or "fichier", "mime": att.mime[:80], "size": len(att.data),
        }
    doc = {
        "id": str(uuid.uuid4()), "conversation_id": conversation_id, "pharmacy_id": convo["pharmacy_id"],
        "sender_email": user["email"], "sender_name": user.get("name", ""), "sender_role": user["role"],
        "body": body, "attachment": attachment_meta, "created_at": now,
    }
    await db.chat_messages.insert_one({**doc})
    preview = body[:80] if body else (f"📎 {attachment_meta['name']}" if attachment_meta else "")
    await db.conversations.update_one({"id": conversation_id}, {"$set": {
        "last_message": preview, "last_sender": user.get("name", ""), "last_message_at": now,
    }})
    await db.conversation_reads.update_one(
        {"conversation_id": conversation_id, "email": user["email"]},
        {"$set": {"conversation_id": conversation_id, "email": user["email"], "last_read_at": now}},
        upsert=True,
    )
    return doc


@router.get("/attachments/{attachment_id}")
async def get_chat_attachment(attachment_id: str, user: dict = Depends(get_current_user)):
    att = await db.chat_attachments.find_one({"id": attachment_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable.")
    convo = await db.conversations.find_one({"id": att["conversation_id"]}, {"_id": 0})
    if not convo or not chat_can_access(convo, user):
        raise HTTPException(status_code=404, detail="Pièce jointe introuvable.")
    return {"name": att["name"], "mime": att["mime"], "data": att["data"]}


@router.post("/messages/{message_id}/pin")
async def pin_chat_message(message_id: str, principal: dict = Depends(get_principal)):
    msg = await db.chat_messages.find_one({"id": message_id}, {"_id": 0})
    if not msg or msg["pharmacy_id"] != scoped_pid(principal):
        raise HTTPException(status_code=404, detail="Message introuvable.")
    convo = await db.conversations.find_one({"id": msg["conversation_id"]}, {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    currently = (convo.get("pinned_message") or {}).get("id")
    if currently == message_id:
        await db.conversations.update_one({"id": convo["id"]}, {"$set": {"pinned_message": None}})
        await log_audit(
            principal["email"], principal["role"], "DESEPINGLAGE_MESSAGE", "messagerie", message_id,
            f"Message désépinglé dans « {convo['name']} »", convo["pharmacy_id"],
        )
        return {"pinned": False}
    pinned = {
        "id": msg["id"], "body": msg.get("body", "")[:200], "sender_name": msg.get("sender_name", ""),
        "created_at": msg.get("created_at", ""),
        "attachment_name": (msg.get("attachment") or {}).get("name", ""),
    }
    await db.conversations.update_one({"id": convo["id"]}, {"$set": {"pinned_message": pinned}})
    await log_audit(
        principal["email"], principal["role"], "EPINGLAGE_MESSAGE", "messagerie", message_id,
        f"Message épinglé dans « {convo['name']} »", convo["pharmacy_id"],
    )
    return {"pinned": True}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, principal: dict = Depends(get_principal)):
    convo = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not convo or convo["pharmacy_id"] != scoped_pid(principal):
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    await db.chat_messages.delete_many({"conversation_id": conversation_id})
    await db.conversation_reads.delete_many({"conversation_id": conversation_id})
    await db.conversations.delete_one({"id": conversation_id})
    await log_audit(
        principal["email"], principal["role"], "SUPPRESSION_CONVERSATION", "messagerie", conversation_id,
        f"Conversation « {convo['name']} » supprimée", convo["pharmacy_id"],
    )
    return {"status": "supprimée"}
