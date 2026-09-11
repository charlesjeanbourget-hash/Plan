# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

## Production
`uvicorn server:app` — monolithe inchangé.

## Bascule progressive
`uvicorn app:app` — monte uniquement les routeurs extraits sous `/api`.

## Modules extraits
- `core/config.py` Mongo + FastAPI + CORS
- `core/security.py` JWT, cloisonnement, audit
- `core/email.py` Resend
- `core/storage.py` certificats
- `routers/auth.py` + `auth_reset.py`
- `routers/pharmacies.py`
- `routers/licenses.py`
- `routers/admin_users.py`
- `routers/punches.py`
- `app.py` assemblage

## Pas encore extraits
horaires, formations, congés, paie, chat, exports punch.

Ne pas merger tant que les tests d'itération ne passent pas contre le monolithe.
