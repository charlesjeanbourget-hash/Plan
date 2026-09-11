# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

- `backend/server.py` reste la source de vérité en production.
- `backend/core/` : config + sécurité JWT extraite à l'identique.
- `backend/routers/auth.py` :
  - POST /auth/login
  - POST /auth/mfa/setup|enable|disable|verify
  - POST /auth/accept-privacy
  - GET /auth/me
  - POST /auth/change-password

Encore dans le monolithe : forgot/reset-password, admin users, pharmacies, licences.
Ne pas merger tant que les tests d'itération auth ne passent pas contre le monolithe.
