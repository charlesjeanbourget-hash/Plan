# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

- `backend/server.py` reste la source de vérité en production.
- `backend/core/` : config, sécurité JWT, courriel.
- `backend/routers/auth.py` : login, MFA, me, change-password, accept-privacy, **forgot/reset-password**.

Encore dans le monolithe : admin users, pharmacies, licences.
Ne pas merger tant que les tests d'itération auth ne passent pas contre le monolithe.
