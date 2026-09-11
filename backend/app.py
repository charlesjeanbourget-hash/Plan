"""Entrée modulaire — n'est PAS encore l'entrée de production."""
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
from routers.trainings import router as trainings_router
from routers.security_settings import router as security_settings_router
from routers.chat import router as chat_router
from routers.payroll import pay_router
from routers.schedule_settings import router as schedule_settings_router
from routers.payroll_exports import router as payroll_exports_router
from routers.work_stations import router as work_stations_router
from routers.replacements import router as replacements_router
from routers.agencies import router as agencies_router
from routers.tasks import router as tasks_router

for r in (
    auth_router, auth_reset_router, pharmacies_sa_router, pharmacy_settings_router,
    licenses_router, admin_users_router, punch_router, punches_router, shifts_router,
    leaves_router, trainings_router, security_settings_router, chat_router, pay_router,
    schedule_settings_router, payroll_exports_router, work_stations_router,
    replacements_router, agencies_router, tasks_router,
):
    api_router.include_router(r)
app.include_router(api_router)
