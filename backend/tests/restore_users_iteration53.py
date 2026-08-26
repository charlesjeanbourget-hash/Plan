"""Restauration des comptes users supprimés par erreur (itération 53)."""
import uuid
from datetime import datetime, timezone

import bcrypt
from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]

NOW = datetime.now(timezone.utc).isoformat()
USERS = [
    ("admin@luminahr.ca", "Nlpx!tTE3Aw27", "Dr. Sophie Lavoie", "admin", "ph1", "e1"),
    ("julie@luminahr.ca", "O1ka!gfVV6e54", "Julie Gagnon", "employee", "ph1", "e2"),
    ("gestion@luminahr.ca", "Jwdh!1l4t5D50", "Marc-André Roy", "manager", "ph1", None),
    ("jeffmenard78@hotmail.com", "JeffSecure2026!x", "Jeff Ménard", "superadmin", None, None),
    ("charles-jbourget@hotmail.com", "CharlesTest2026!a", "Charles-J. Bourget", "superadmin", None, None),
    ("charlesjeanbourget@gmail.com", "OwnerSecure2026!z", "Charles Jean-Bourget", "superadmin", None, None),
]

for email, pw, name, role, pid, eid in USERS:
    if db.users.find_one({"email": email}):
        print("existe déjà:", email)
        continue
    db.users.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode(),
        "name": name,
        "role": role,
        "pharmacy_id": pid,
        "employee_id": eid,
        "is_temporary_password": False,
        "suspended": False,
        "created_at": NOW,
        "password_changed_at": NOW,
        "privacy_accepted_at": NOW,
    })
    print("restauré:", email)

for u in db.users.find({}, {"_id": 0, "email": 1, "role": 1, "pharmacy_id": 1, "employee_id": 1}):
    print(u)
