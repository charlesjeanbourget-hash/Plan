"""Iteration 47 — Isolation stricte des données par pharmacie (bug client : fuite ph1 -> nouveaux comptes)."""
import json
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL manquant")
BASE = base_url.rstrip("/") + "/api"

CREDS = {
    "admin": ("admin@luminahr.ca", "Nlpx!tTE3Aw27"),
    "employee": ("julie@luminahr.ca", "O1ka!gfVV6e54"),
    "leo": ("leo-test@exemple.ca", "LeoIsole2026!x"),
    "superadmin": ("jeffmenard78@hotmail.com", "JeffSecure2026!x"),
}

# Marqueurs NOMINATIFS de ph1 : leur présence dans une réponse d'un autre compte = fuite
PH1_MARKERS = ["Sophie", "Julie", "Karim", "Lavoie", "luminahr.ca", "ph1"]


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login échoué pour {email}: {r.status_code} {r.text[:300]}")
    tok = r.json().get("access_token")
    assert tok, f"access_token absent pour {email}"
    return tok


@pytest.fixture(scope="session")
def tokens():
    return {k: login(*v) for k, v in CREDS.items()}


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


def find_leaks(payload) -> list:
    blob = json.dumps(payload, ensure_ascii=False, default=str)
    hits = []
    for m in PH1_MARKERS:
        if re.search(re.escape(m), blob, re.IGNORECASE):
            hits.append(m)
    return hits


# Balayage exhaustif des endpoints GET (lecture seule)
SWEEP = [
    "/hr-state", "/shifts", "/tasks?start=2026-08-01&end=2026-08-31", "/tasks/goal?start=2026-08-03", "/tasks/honor-roll?month=2026-08",
    "/leave/requests", "/leave/absences", "/leave/balances", "/leave/policy",
    "/benefits", "/punches?start=2026-01-01&end=2026-12-31", "/punches/summary?start=2026-01-01&end=2026-12-31",
    "/punches/open", "/punch/settings", "/punch/cost?start=2026-01-01&end=2026-12-31",
    "/licenses", "/evaluations", "/deliveries", "/deliveries/proofs",
    "/announcements", "/polls", "/kudos", "/open-shifts",
    "/appointments?start=2026-01-01&end=2026-12-31",
    "/time-bank", "/sst", "/work-stations", "/hr-custom-fields",
    "/agencies", "/replacements/requests", "/chat/conversations", "/chat/users",
    "/schedule/settings", "/schedule/proposals", "/schedule/templates",
    "/trainings", "/notifications", "/pay-settings", "/pharmacy/settings",
    "/report-settings", "/security-settings", "/email-settings",
    "/reports/budget-history", "/branches", "/profiles", "/documents", "/document-requests",
]


class TestPriorite1IsolationLeo:
    """(b) L'admin leo-test ne doit voir AUCUNE donnée nominative de ph1."""

    @pytest.mark.parametrize("path", SWEEP)
    def test_leo_no_ph1_data(self, tokens, path):
        r = requests.get(f"{BASE}{path}", headers=h(tokens["leo"]), timeout=60)
        if r.status_code in (404, 405):
            pytest.skip(f"{path} inexistant ({r.status_code})")
        assert r.status_code in (200, 403), f"{path} -> {r.status_code} {r.text[:200]}"
        if r.status_code != 200:
            return
        data = r.json()
        leaks = find_leaks(data)
        assert not leaks, f"FUITE ph1 dans {path}: marqueurs {leaks} -> {json.dumps(data, ensure_ascii=False)[:600]}"

    def test_leo_hr_state_only_own_employee(self, tokens):
        r = requests.get(f"{BASE}/hr-state", headers=h(tokens["leo"]), timeout=30)
        assert r.status_code == 200
        body = r.json()
        state = body.get("state") or {}
        emps = state.get("employees") or []
        names = [f"{e.get('firstName','')} {e.get('lastName','')}" for e in emps]
        assert all("Sophie" not in (n or "") and "Karim" not in (n or "") and "Julie" not in (n or "")
                   for n in names), f"Employés ph1 visibles par Léo: {names}"
        assert len(state.get("shifts") or []) == 0, "Quarts ph1 visibles"
        assert len(state.get("payrollEntries") or []) == 0, "Paies ph1 visibles"

    def test_leo_shifts_empty(self, tokens):
        r = requests.get(f"{BASE}/shifts", headers=h(tokens["leo"]), timeout=30)
        assert r.status_code == 200
        assert len(r.json().get("shifts") or []) == 0


class TestPriorite1IsolationSuperadmin:
    """(a) Le superadmin ne voit AUCUNE donnée RH cliente."""

    @pytest.mark.parametrize("path", [
        "/hr-state", "/shifts", "/tasks?start=2026-08-01&end=2026-08-31", "/leave/requests", "/benefits",
        "/punches/summary?start=2026-01-01&end=2026-12-31", "/evaluations", "/deliveries",
        "/open-shifts", "/polls", "/kudos", "/announcements", "/trainings",
    ])
    def test_superadmin_no_hr_data(self, tokens, path):
        r = requests.get(f"{BASE}{path}", headers=h(tokens["superadmin"]), timeout=60)
        if r.status_code in (404, 405):
            pytest.skip(f"{path} inexistant")
        assert r.status_code in (200, 403), f"{path} -> {r.status_code} {r.text[:200]}"
        if r.status_code != 200:
            return
        leaks = find_leaks(r.json())
        assert not leaks, f"FUITE RH chez superadmin sur {path}: {leaks} -> {json.dumps(r.json(), ensure_ascii=False)[:500]}"

    def test_superadmin_hr_state_null(self, tokens):
        r = requests.get(f"{BASE}/hr-state", headers=h(tokens["superadmin"]), timeout=30)
        assert r.status_code == 200
        assert not r.json().get("state"), "Le superadmin reçoit un état RH non vide"

    @pytest.mark.parametrize("path", ["/licenses", "/evaluations", "/trainings", "/profiles", "/schedule/proposals"])
    def test_superadmin_cross_pharmacy_endpoints(self, tokens, path):
        """FUITE CONNUE : ces endpoints ne filtrent pas quand le superadmin n'a pas de pharmacie
        (query {} = TOUTES les pharmacies) au lieu d'utiliser scoped_pid -> '__plateforme__'."""
        r = requests.get(f"{BASE}{path}", headers=h(tokens["superadmin"]), timeout=30)
        assert r.status_code == 200
        leaks = find_leaks(r.json())
        assert not leaks, f"FUITE ph1 chez superadmin sur {path}: {leaks}"


class TestPriorite1IsolationPh1:
    """(c) L'admin ph1 ne voit rien de la pharmacie de Léo."""

    def test_admin_ph1_no_leo_data(self, tokens):
        r = requests.get(f"{BASE}/hr-state", headers=h(tokens["admin"]), timeout=30)
        assert r.status_code == 200
        blob = json.dumps(r.json(), ensure_ascii=False)
        assert "DeLeo" not in blob and "ph_a89755dc" not in blob, "Données de Léo visibles par l'admin ph1"

    def test_admin_ph1_pharmacies_forbidden(self, tokens):
        r = requests.get(f"{BASE}/superadmin/pharmacies", headers=h(tokens["admin"]), timeout=30)
        assert r.status_code == 403


class TestPriorite2CompteSansPharmacie:
    def test_create_admin_without_pharmacy_rejected(self, tokens):
        r = requests.post(f"{BASE}/admin/users", headers=h(tokens["superadmin"]), timeout=30, json={
            "email": "TEST_nopharm@exemple.ca", "name": "TEST NoPharm", "role": "admin", "pharmacy_id": None})
        assert r.status_code == 400, r.text[:300]
        assert "pharmacie" in r.json().get("detail", "").lower()

    def test_create_admin_unknown_pharmacy_rejected(self, tokens):
        r = requests.post(f"{BASE}/admin/users", headers=h(tokens["superadmin"]), timeout=30, json={
            "email": "TEST_bidon@exemple.ca", "name": "TEST Bidon", "role": "admin", "pharmacy_id": "ph_bidon"})
        assert r.status_code == 400, r.text[:300]

    def test_create_superadmin_without_pharmacy_ok(self, tokens):
        email = "TEST_sa47@exemple.ca"
        r = requests.post(f"{BASE}/admin/users", headers=h(tokens["superadmin"]), timeout=30, json={
            "email": email, "name": "TEST SA47", "role": "superadmin"})
        assert r.status_code == 200, r.text[:300]
        uid = r.json()["user"]["id"]
        assert not r.json()["user"].get("pharmacy_id")
        d = requests.delete(f"{BASE}/admin/users/{uid}", headers=h(tokens["superadmin"]), timeout=30)
        assert d.status_code in (200, 204)


class TestPriorite3Pharmacies:
    created_id = None

    def test_list_pharmacies(self, tokens):
        r = requests.get(f"{BASE}/superadmin/pharmacies", headers=h(tokens["superadmin"]), timeout=30)
        assert r.status_code == 200
        docs = r.json()
        ids = {d["id"] for d in docs}
        assert "ph1" in ids
        assert "ph_a89755dc" in ids
        for d in docs:
            assert "_id" not in d
            assert isinstance(d.get("accounts_count"), int)

    def test_create_requires_name(self, tokens):
        r = requests.post(f"{BASE}/superadmin/pharmacies", headers=h(tokens["superadmin"]),
                          json={"name": "  "}, timeout=30)
        assert r.status_code == 400

    def test_create_update_pharmacy(self, tokens):
        r = requests.post(f"{BASE}/superadmin/pharmacies", headers=h(tokens["superadmin"]), timeout=30,
                          json={"name": "TEST_Pharmacie47", "city": "Québec", "plan": "Pro"})
        assert r.status_code == 200, r.text[:300]
        doc = r.json()
        pid = doc.get("id") or doc.get("pharmacy", {}).get("id")
        assert pid and pid.startswith("ph_"), doc
        TestPriorite3Pharmacies.created_id = pid

        g = requests.get(f"{BASE}/superadmin/pharmacies", headers=h(tokens["superadmin"]), timeout=30)
        assert any(d["id"] == pid and d["name"] == "TEST_Pharmacie47" for d in g.json())

        u = requests.put(f"{BASE}/superadmin/pharmacies/{pid}", headers=h(tokens["superadmin"]),
                         json={"active": False, "name": "TEST_Pharmacie47_off"}, timeout=30)
        assert u.status_code == 200, u.text[:300]
        g2 = requests.get(f"{BASE}/superadmin/pharmacies", headers=h(tokens["superadmin"]), timeout=30)
        row = next(d for d in g2.json() if d["id"] == pid)
        assert row["active"] is False and row["name"] == "TEST_Pharmacie47_off"

    def test_update_unknown_pharmacy_404(self, tokens):
        r = requests.put(f"{BASE}/superadmin/pharmacies/ph_inexistant", headers=h(tokens["superadmin"]),
                         json={"name": "x"}, timeout=30)
        assert r.status_code == 404


class TestRegressionPh1:
    def test_admin_sees_own_employees_and_payroll(self, tokens):
        r = requests.get(f"{BASE}/hr-state", headers=h(tokens["admin"]), timeout=30)
        assert r.status_code == 200
        state = r.json().get("state") or {}
        names = [f"{e.get('firstName','')} {e.get('lastName','')}" for e in state.get("employees") or []]
        assert len(names) >= 3, f"ph1 devrait avoir >=3 employés, trouvé {names}"
        assert any("Lavoie" in n or "Sophie" in n for n in names), names
        assert len(state.get("payrollEntries") or []) >= 1

    def test_admin_shifts_present(self, tokens):
        r = requests.get(f"{BASE}/shifts", headers=h(tokens["admin"]), timeout=30)
        assert r.status_code == 200
        assert len(r.json().get("shifts") or []) > 0

    def test_shift_create_delete(self, tokens):
        payload = {"id": "TEST_shift47", "employee_id": "e2", "employee_name": "Julie Tremblay",
                   "date": "2026-08-20", "start": "09:00", "end": "17:00", "branch_id": "br1"}
        c = requests.post(f"{BASE}/shifts", headers=h(tokens["admin"]), json=payload, timeout=30)
        assert c.status_code in (200, 201), c.text[:300]
        g = requests.get(f"{BASE}/shifts", headers=h(tokens["admin"]), timeout=30)
        assert any(s.get("id") == "TEST_shift47" for s in g.json().get("shifts", []))
        d = requests.delete(f"{BASE}/shifts/TEST_shift47", headers=h(tokens["admin"]), timeout=30)
        assert d.status_code in (200, 204), d.text[:200]
        g2 = requests.get(f"{BASE}/shifts", headers=h(tokens["admin"]), timeout=30)
        assert not any(s.get("id") == "TEST_shift47" for s in g2.json().get("shifts", []))

    def test_employee_julie_sees_own_data(self, tokens):
        r = requests.get(f"{BASE}/hr-state", headers=h(tokens["employee"]), timeout=30)
        assert r.status_code == 200
        blob = json.dumps(r.json(), ensure_ascii=False)
        assert "DeLeo" not in blob

    def test_auth_me_scoping(self, tokens):
        for key, pid in (("admin", "ph1"), ("leo", "ph_a89755dc")):
            r = requests.get(f"{BASE}/auth/me", headers=h(tokens[key]), timeout=30)
            assert r.status_code == 200
            assert r.json().get("pharmacy_id") == pid


class TestAuthHardening:
    def test_bcrypt_hash_format(self):
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        env = dotenv_values("/app/backend/.env")
        mongo_url = env.get("MONGO_URL") or os.environ.get("MONGO_URL")
        db_name = env.get("DB_NAME") or os.environ.get("DB_NAME")
        assert mongo_url and db_name

        async def check():
            cl = AsyncIOMotorClient(mongo_url)
            doc = await cl[db_name].users.find_one({"email": "admin@luminahr.ca"})
            cl.close()
            return doc

        doc = asyncio.get_event_loop().run_until_complete(check())
        assert doc and doc["password_hash"].startswith("$2b$"), "Hash bcrypt invalide"

    def test_no_token_401(self):
        r = requests.get(f"{BASE}/hr-state", timeout=30)
        assert r.status_code in (401, 403)
