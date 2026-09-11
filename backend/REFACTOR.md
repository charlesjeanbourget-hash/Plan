# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

`backend/server.py` reste la source de vérité en production.

## Extraits
- core : config, security, email, storage
- routers/auth.py + auth_reset.py
- routers/pharmacies.py
- routers/licenses.py — liste, CRUD, certificat chiffré, rapport 60 jours, droit à l'oubli

## Encore dans le monolithe
comptes admin, horaires, pointages, paie, formations, envoi courriel du rapport licences.

Ne pas merger tant que les tests d'itération ne passent pas contre le monolithe.
