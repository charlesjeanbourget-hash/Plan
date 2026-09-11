"""Entrée modulaire — n'est PAS encore l'entrée de production.

Production : uvicorn server:app (monolithe).
Test / bascule progressive : uvicorn app:app
"""
from core.config import app, api_router
from routers.auth import router as auth_router
from routers.auth_reset import router as auth_reset_router
from routers.pharmacies import sa_router as pharmacies_sa_router
from routers.pharmacies import settings_router as pharmacy_settings_router
from routers.licenses import router as licenses_router
from routers.admin_users import router as admin_users_router
from routers.punches import punch_router, punches_router
from routers.shifts import router as shifts_router
from routers.leaves import router as leaves_router

api_router.include_router(auth_router)
api_router.include_router(auth_reset_router)
api_router.include_router(pharmacies_sa_router)
api_router.include_router(pharmacy_settings_router)
api_router.include_router(licenses_router)
api_router.include_router(admin_users_router)
api_router.include_router(punch_router)
api_router.include_router(punches_router)
api_router.include_router(shifts_router)
api_router.include_router(leaves_router)

app.include_router(api_router)
