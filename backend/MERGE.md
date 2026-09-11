# Plan de merge — ne pas tout basculer d'un coup

Production reste `uvicorn server:app` jusqu'à ce qu'une étape soit validée.

## Règle
Un domaine à la fois. Après chaque étape : tests d'itération existants + smoke login/API sur preview.
Si ça casse, on revert **ce** domaine seulement.

## Ordre

1. **Auth** (`routers/auth.py` + `auth_reset.py`)
   - Plus isolé, plus testé, plus critique.
   - Dans `server.py` : remplacer les handlers login/reset par `include_router`.
   - Smoke : login, MFA, reset mot de passe.

2. **Security settings**
   - Petit, dépend d'auth.

3. **Licences + pharmacies + admin_users**
   - Cloisonnement `scoped_pid` à vérifier en premier.

4. **Punches** puis **exports paie**

5. **Shifts** puis **schedule_settings**

6. **Leaves** (+ `leave_ops`)
   - Vérifier libération de quarts + open_shifts.

7. **Trainings** (sans IA)
   - Upload + generate_training_content restent dans server.py.

8. **Chat** (messagerie, pas l'assistant IA)

9. **Payroll settings**

## Ne pas merger tant que
- `app.py` n'a pas les mêmes chemins que le front (`/api/...`)
- un test_iteration du domaine échoue
- on n'a pas un revert git d'une étape

## Interdit pour l'instant
Remplacer `server.py` par `app.py` en production.
Extraire le générateur IA d'horaire (trop couplé).
