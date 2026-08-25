"""Cleanup: delete only QA test pharmacies created during iteration 50 testing."""
import os
import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/") + "/api"
PROTECTED = {"ph1", "ph_a89755dc"}
TEST_PREFIXES = ("TEST_", "Test E2E", "Pharmacie Wizard Test", "Pharmacie Skip Test")

tok = requests.post(f"{BASE}/auth/login", json={"email": "jeffmenard78@hotmail.com", "password": "JeffSecure2026!x"}).json()["access_token"]
h = {"Authorization": f"Bearer {tok}"}
rows = requests.get(f"{BASE}/superadmin/pharmacies", headers=h).json()
for p in rows:
    if p["id"] in PROTECTED:
        continue
    if p["name"].startswith(TEST_PREFIXES):
        r = requests.delete(f"{BASE}/superadmin/pharmacies/{p['id']}", headers=h)
        print("deleted", p["id"], p["name"], r.status_code, r.text[:80])
print("remaining:", [(p["id"], p["name"]) for p in requests.get(f"{BASE}/superadmin/pharmacies", headers=h).json()])
