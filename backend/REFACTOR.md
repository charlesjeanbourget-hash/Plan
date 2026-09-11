# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

`backend/server.py` reste la source de vérité en production.

## Extraits
- core : config, security, email, storage
- routers/auth.py + auth_reset.py
- routers/pharmacies.py
- routers/licenses.py
- routers/admin_users.py — liste, création, maj, reset MDP, suppression

## Encore dans le monolithe
horaires, pointages, paie, formations, sécurité par pharmacie.

Ne pas merger tant que les tests d'itération ne passent pas contre le monolithe.
