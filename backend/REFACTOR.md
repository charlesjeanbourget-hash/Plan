# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

`backend/server.py` reste la source de vérité en production.

## Extraits
- core : config, security, email, storage
- routers/auth.py + auth_reset.py
- routers/pharmacies.py
- routers/licenses.py
- routers/admin_users.py
- routers/punches.py — borne NIP, punch/me, pauses, CRUD, réglages arrondi

## Encore dans le monolithe
export paie, horaires, formations, congés.

Ne pas merger tant que les tests d'itération ne passent pas contre le monolithe.
