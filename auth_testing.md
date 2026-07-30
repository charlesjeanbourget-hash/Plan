# Auth Testing Playbook (LuminaHR)

## Step 1: MongoDB Verification
```
mongosh
use test_database
db.users.find({role: "superadmin"}).pretty()
db.users.findOne({role: "admin"}, {password_hash: 1})
```
Verify: bcrypt hash starts with `$2b$`, unique index on users.email, index on login_attempts.identifier.

## Step 2: API Testing (Bearer tokens, pas de cookies)
```
TOKEN=$(curl -s -X POST http://localhost:8001/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@luminahr.ca","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s http://localhost:8001/api/auth/me -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:8001/api/licenses -H "Authorization: Bearer $TOKEN"
```
- Login retourne {access_token, user}.
- /api/auth/me retourne l'utilisateur.
- Mauvais mot de passe → 401 « Courriel ou mot de passe invalide. »
- 5 échecs consécutifs → 429 verrouillage 15 min.
- Rôle employee sur /api/licenses → 403.
- Sans jeton → 401.
- POST /api/auth/change-password {current_password, new_password} → met à jour le hash et is_temporary_password=false.
