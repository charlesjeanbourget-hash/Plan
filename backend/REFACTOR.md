# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

- `backend/server.py` reste la source de vérité en production.
- `backend/core/` : config Mongo/FastAPI + sécurité JWT extraite à l'identique.
- `backend/routers/auth.py` : login + /me (première extraction).

Prochaines étapes : MFA, change-password, pharmacies, licences.
Ne pas merger tant que les tests d'itération auth ne passent pas contre le monolithe.
