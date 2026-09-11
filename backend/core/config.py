"""Configuration FastAPI + Mongo pour Arrière Plan."""
from pathlib import Path
import os
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Arrière Plan API")
api_router = APIRouter(prefix="/api")

_cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_origins and _cors_origins != "*":
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
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
