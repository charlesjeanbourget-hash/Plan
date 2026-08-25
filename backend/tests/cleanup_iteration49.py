"""Nettoyage des données de test de l'itération 49 (compte + pharmacie d'essai, demandes de démo)."""
import os

import requests
from dotenv import dotenv_values

base = os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env").get("REACT_APP_BACKEND_URL")
API = f"{base.rstrip('/')}/api"
TRIAL_EMAIL = "essai-e2e@exemple.ca"
TRIAL_PHARMACY = "Pharmacie E2E Test"

tok = requests.post(f"{API}/auth/login", json={"email": "jeffmenard78@hotmail.com",
                                               "password": "JeffSecure2026!x"}, timeout=40).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}

users = requests.get(f"{API}/admin/users", headers=H, timeout=40).json()
for u in users:
    if u["email"] == TRIAL_EMAIL:
        print("DELETE user", u["email"], requests.delete(f"{API}/admin/users/{u['id']}", headers=H, timeout=40).status_code)

phs = requests.get(f"{API}/superadmin/pharmacies", headers=H, timeout=40).json()
for p in phs:
    if p["name"] == TRIAL_PHARMACY:
        r = requests.delete(f"{API}/superadmin/pharmacies/{p['id']}", headers=H, timeout=40)
        print("DELETE pharmacy", p["id"], r.status_code, r.text[:200])

demos = requests.get(f"{API}/demo-requests", headers=H, timeout=40).json()
for d in demos:
    if d.get("email") in ("demo-e2e@exemple.ca", "demo-api-e2e@exemple.ca") or str(d.get("pharmacy", "")).startswith("TEST_"):
        print("DELETE demo", d["email"], requests.delete(f"{API}/demo-requests/{d['id']}", headers=H, timeout=40).status_code)

print("--- état final ---")
print("pharmacies:", [(p["name"], p.get("plan_status")) for p in requests.get(f"{API}/superadmin/pharmacies", headers=H, timeout=40).json()])
print("comptes:", [u["email"] for u in requests.get(f"{API}/admin/users", headers=H, timeout=40).json()])
print("demandes de démo:", [(d.get("email"), d.get("pharmacy")) for d in requests.get(f"{API}/demo-requests", headers=H, timeout=40).json()])
print("login essai (attendu 401):", requests.post(f"{API}/auth/login", json={"email": TRIAL_EMAIL, "password": "EssaiE2E2026!x"}, timeout=40).status_code)
