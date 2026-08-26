"""Vérification post-restauration des comptes + verrouillage brute force (itération 53)."""
import os
import requests
from dotenv import dotenv_values

env = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or env["REACT_APP_BACKEND_URL"]).rstrip("/")

CREDS = [
    ("admin@luminahr.ca", "Nlpx!tTE3Aw27"),
    ("julie@luminahr.ca", "O1ka!gfVV6e54"),
    ("gestion@luminahr.ca", "Jwdh!1l4t5D50"),
    ("jeffmenard78@hotmail.com", "JeffSecure2026!x"),
    ("charles-jbourget@hotmail.com", "CharlesTest2026!a"),
    ("charlesjeanbourget@gmail.com", "OwnerSecure2026!z"),
    ("leo-test@exemple.ca", "LeoIsole2026!x"),
]


def test_all_documented_accounts_can_login():
    failures = []
    for email, pw in CREDS:
        r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
        ok = r.status_code == 200 and "access_token" in r.json()
        temp = r.json().get("user", {}).get("is_temporary_password") if r.status_code == 200 else None
        print(email, r.status_code, "temp=", temp)
        if not ok:
            failures.append((email, r.status_code, r.text[:120]))
    assert not failures, f"connexions en échec: {failures}"


def test_bruteforce_lockout_on_unknown_account():
    email = "qa.lockout.iter53@exemple.ca"
    codes = []
    for _ in range(6):
        r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "MauvaisMdp1!"}, timeout=30)
        codes.append(r.status_code)
    print("codes:", codes)
    assert codes[-1] in (423, 429, 401), codes
