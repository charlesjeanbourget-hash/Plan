"""Cleanup des pharmacies d'essai créées pendant l'itération 51 (frontend wizard)."""
import os
import requests
from dotenv import dotenv_values

env = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or env["REACT_APP_BACKEND_URL"]).rstrip("/")
KEEP = {"ph1", "ph_a89755dc"}

tok = requests.post(f"{BASE}/api/auth/login", json={
    "email": "jeffmenard78@hotmail.com", "password": "JeffSecure2026!x"}, timeout=30).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}

pharmacies = requests.get(f"{BASE}/api/superadmin/pharmacies", headers=H, timeout=30).json()
plist = pharmacies if isinstance(pharmacies, list) else pharmacies.get("pharmacies", [])
for p in plist:
    pid, name = p.get("id"), p.get("name", "")
    if pid in KEEP:
        continue
    if name.startswith("TEST Pharmacie"):
        r = requests.delete(f"{BASE}/api/superadmin/pharmacies/{pid}", headers=H, timeout=30)
        print("DELETE", pid, name, r.status_code)

users = requests.get(f"{BASE}/api/admin/users", headers=H, timeout=30).json()
ulist = users if isinstance(users, list) else users.get("users", [])
for u in ulist:
    if u.get("email", "").startswith(("qa1b", "qa2b", "qaskip")):
        r = requests.delete(f"{BASE}/api/admin/users/{u['id']}", headers=H, timeout=30)
        print("DELETE USER", u["email"], r.status_code)

left = requests.get(f"{BASE}/api/superadmin/pharmacies", headers=H, timeout=30).json()
llist = left if isinstance(left, list) else left.get("pharmacies", [])
print("REMAINING:", [(p.get("id"), p.get("name")) for p in llist])
