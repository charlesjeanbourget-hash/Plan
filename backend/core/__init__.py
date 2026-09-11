"""Noyau partagé du backend Arrière Plan."""
from .config import app, api_router, db, client, ROOT_DIR
from .security import (
    get_current_user,
    get_principal,
    require_superadmin,
    scoped_pid,
    hash_password,
    verify_password,
    create_access_token,
    user_public,
    get_jwt_secret,
    JWT_ALGORITHM,
    LOCKOUT_ATTEMPTS,
    LOCKOUT_MINUTES,
)
