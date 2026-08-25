"""Itération 49 — Demandes de démo + essai gratuit self-service (signup-trial, blocage, accès complet)."""
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL manquant")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

SUPERADMIN = ("jeffmenard78@hotmail.com", "JeffSecure2026!x")
ADMIN_PH1 = ("admin@luminahr.ca", "Nlpx!tTE3Aw27")
LEO = ("leo-test@exemple.ca", "LeoIsole2026!x")
TRIAL_EMAIL = "essai-e2e@exemple.ca"
TRIAL_PASSWORD = "EssaiE2E2026!x"
TRIAL_PHARMACY_NAME = "Pharmacie E2E Test"


def login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=40)


@pytest.fixture(scope="session")
def sa_headers():
    r = login(*SUPERADMIN)
    if r.status_code != 200:
        pytest.fail(f"Login superadmin échoué: {r.status_code} {r.text[:300]}")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def trial_pid(sa_headers):
    r = requests.get(f"{API}/superadmin/pharmacies", headers=sa_headers, timeout=40)
    assert r.status_code == 200, r.text[:300]
    match = [p for p in r.json() if p.get("name") == TRIAL_PHARMACY_NAME]
    if not match:
        pytest.skip("Pharmacie d'essai E2E absente (créer via le flux d'inscription frontend d'abord)")
    return match[0]["id"]


# ---------------------------------------------------------------- Demandes de démo
class TestDemoRequests:
    def test_create_demo_request_sends_email(self, sa_headers):
        payload = {"name": "QA Backend 49", "pharmacy": "TEST_Pharmacie Demo API",
                   "email": "demo-api-e2e@exemple.ca", "phone": "(514) 555-0100",
                   "message": "Test automatisé itération 49."}
        r = requests.post(f"{API}/demo-requests", json=payload, timeout=60)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data.get("ok") is True
        assert data.get("email_sent") is True, f"email_sent attendu true: {data}"

        lst = requests.get(f"{API}/demo-requests", headers=sa_headers, timeout=40)
        assert lst.status_code == 200
        rows = lst.json()
        mine = [x for x in rows if x.get("email") == payload["email"]]
        assert mine, "La demande créée n'apparaît pas dans GET /api/demo-requests"
        assert mine[0]["pharmacy"] == payload["pharmacy"]
        assert mine[0]["name"] == payload["name"]
        assert "_id" not in mine[0]

    def test_demo_requests_requires_superadmin(self):
        r = requests.get(f"{API}/demo-requests", timeout=40)
        assert r.status_code in (401, 403), r.status_code

    def test_cleanup_test_demo_requests(self, sa_headers):
        rows = requests.get(f"{API}/demo-requests", headers=sa_headers, timeout=40).json()
        targets = [x for x in rows if x.get("email") in ("demo-api-e2e@exemple.ca", "demo-e2e@exemple.ca")]
        for t in targets:
            d = requests.delete(f"{API}/demo-requests/{t['id']}", headers=sa_headers, timeout=40)
            assert d.status_code in (200, 204), d.text[:200]
        after = requests.get(f"{API}/demo-requests", headers=sa_headers, timeout=40).json()
        assert not [x for x in after if x.get("email") in ("demo-api-e2e@exemple.ca", "demo-e2e@exemple.ca")]


# ---------------------------------------------------------------- Validations inscription essai
class TestTrialSignupValidation:
    def test_duplicate_email_rejected(self):
        r = requests.post(f"{API}/auth/signup-trial", json={
            "pharmacy_name": "TEST_Doublon", "name": "QA", "email": ADMIN_PH1[0],
            "password": "MotDePasse2026!x"}, timeout=40)
        assert r.status_code == 400, r.text[:300]
        assert "existe déjà" in r.json().get("detail", "")

    def test_short_password_rejected(self):
        r = requests.post(f"{API}/auth/signup-trial", json={
            "pharmacy_name": "TEST_Court", "name": "QA", "email": "qa-court-49@exemple.ca",
            "password": "abc"}, timeout=40)
        assert r.status_code == 400, r.text[:300]
        assert r.json().get("detail")

    def test_empty_pharmacy_rejected(self):
        r = requests.post(f"{API}/auth/signup-trial", json={
            "pharmacy_name": "", "name": "QA", "email": "qa-vide-49@exemple.ca",
            "password": "MotDePasse2026!x"}, timeout=40)
        assert r.status_code == 400, r.text[:300]
        assert "pharmacie" in r.json().get("detail", "").lower()

    def test_invalid_email_rejected(self):
        r = requests.post(f"{API}/auth/signup-trial", json={
            "pharmacy_name": "TEST_Courriel", "name": "QA", "email": "pas-un-courriel",
            "password": "MotDePasse2026!x"}, timeout=40)
        assert r.status_code == 400

    def test_no_orphan_accounts_created(self, sa_headers):
        users = requests.get(f"{API}/admin/users", headers=sa_headers, timeout=40).json()
        emails = [u["email"] for u in users]
        for e in ("qa-court-49@exemple.ca", "qa-vide-49@exemple.ca"):
            assert e not in emails, f"Compte orphelin créé malgré la validation: {e}"


# ---------------------------------------------------------------- Compte d'essai : accès et isolation
class TestTrialAccountAccess:
    @pytest.fixture(scope="class", autouse=True)
    def restore_trial_window(self, sa_headers, trial_pid):
        """S'assure que l'essai est actif (les tests d'expiration le repoussent dans le passé)."""
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        r = requests.put(f"{API}/superadmin/pharmacies/{trial_pid}",
                         json={"plan_status": "trial", "trial_ends_at": future}, headers=sa_headers, timeout=40)
        assert r.status_code == 200, r.text[:300]

    def test_login_and_trial_days_left(self, trial_pid):
        r = login(TRIAL_EMAIL, TRIAL_PASSWORD)
        assert r.status_code == 200, r.text[:300]
        token = r.json()["access_token"]
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=40)
        assert me.status_code == 200
        body = me.json()
        assert body["role"] == "admin"
        assert body["pharmacy_id"] == trial_pid
        assert isinstance(body.get("trial_days_left"), int)
        assert 0 < body["trial_days_left"] <= 30, body.get("trial_days_left")

    def test_isolation_empty_state_and_write(self):
        token = login(TRIAL_EMAIL, TRIAL_PASSWORD).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        r = requests.get(f"{API}/hr-state", headers=h, timeout=40)
        assert r.status_code == 200, r.text[:300]
        raw = r.text
        for leak in ("Sophie", "Julie", "Karim", "Employe DeLeo"):
            assert leak not in raw, f"Fuite de données ph1/leo dans hr-state de l'essai: {leak}"
        state = r.json().get("state") or {}
        assert len(state.get("employees") or []) == 0, state.get("employees")

        # Création d'un employé dans l'espace d'essai
        state["employees"] = [{"id": "e_test49", "name": "TEST_Employe Essai", "role": "ATP",
                               "email": "test49@exemple.ca", "branchId": "", "active": True}]
        put = requests.put(f"{API}/hr-state", json={"state": state}, headers=h, timeout=60)
        assert put.status_code == 200, put.text[:300]
        again = (requests.get(f"{API}/hr-state", headers=h, timeout=40).json().get("state") or {})
        names = [e.get("name") for e in (again.get("employees") or [])]
        assert "TEST_Employe Essai" in names, names

    def test_ph1_admin_has_no_trial_banner_data(self):
        r = login(*ADMIN_PH1)
        assert r.status_code == 200, r.text[:300]
        me = requests.get(f"{API}/auth/me",
                          headers={"Authorization": f"Bearer {r.json()['access_token']}"}, timeout=40).json()
        assert "trial_days_left" not in me, "ph1 (grandfathered) ne doit pas avoir de compteur d'essai"

    def test_leo_login_regression(self):
        r = login(*LEO)
        assert r.status_code == 200, r.text[:300]


# ---------------------------------------------------------------- Blocage à l'expiration
class TestTrialExpiryBlocking:
    def test_expired_trial_blocks_login(self, sa_headers, trial_pid):
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        r = requests.put(f"{API}/superadmin/pharmacies/{trial_pid}",
                         json={"trial_ends_at": yesterday}, headers=sa_headers, timeout=40)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("plan_status") == "trial"

        lg = login(TRIAL_EMAIL, TRIAL_PASSWORD)
        assert lg.status_code == 403, f"attendu 403, obtenu {lg.status_code} {lg.text[:300]}"
        detail = lg.json().get("detail", "")
        assert "essai gratuit" in detail.lower()
        assert "info@arriereplanrh.com" in detail

    def test_invalid_plan_status_rejected(self, sa_headers, trial_pid):
        r = requests.put(f"{API}/superadmin/pharmacies/{trial_pid}",
                         json={"plan_status": "gratuit"}, headers=sa_headers, timeout=40)
        assert r.status_code == 400

    def test_other_pharmacies_unaffected(self):
        assert login(*ADMIN_PH1).status_code == 200
        assert login(*LEO).status_code == 200
