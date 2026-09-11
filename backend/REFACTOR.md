# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

`backend/server.py` reste la source de vérité en production.

## Extraits
- `core/` config, security, email
- `routers/auth.py` login MFA me change-password accept-privacy
- `routers/auth_reset.py` forgot/reset
- `routers/pharmacies.py` CRUD superadmin + /pharmacy/settings

## Encore dans le monolithe
licences, comptes admin, horaires, pointages, paie, formations.

Ne pas merger tant que les tests d'itération ne passent pas contre le monolithe.
