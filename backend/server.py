from fastapi import FastAPI, APIRouter
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime, timezone
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
