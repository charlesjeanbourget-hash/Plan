"""Iteration 50 — Onboarding wizard, superadmin pharmacy creation with admin account, cascade delete."""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"

SUPERADMIN = {"email": "jeffmenard78@hotmail.com", "password": "JeffSecure2026!x"}
ADMIN_PH1 = {"email": "admin@luminahr.ca", "password": "Nlpx!tTE3Aw27"}


def rid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def su_token(sess):
    r = sess.post(f"{BASE}/auth/login", json=SUPERADMIN)
    if r.status_code != 200:
        pytest.fail(f"Superadmin login failed {r.status_code}: {r.text[:300]}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def created_pharmacies():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(sess, su_token, created_pharmacies):
    yield
    for pid in created_pharmacies:
        sess.delete(f"{BASE}/superadmin/pharmacies/{pid}",
                    headers={"Authorization": f"Bearer {su_token}"})


def _clear_rate_limit():
    """Signup rate limit is 3/h/IP — clear signup_events so tests can run."""
    import subprocess
    subprocess.run(
        ["python", "-c",
         "import os;from pymongo import MongoClient;from dotenv import dotenv_values;"
         "e=dotenv_values('/app/backend/.env');"
         "c=MongoClient(e['MONGO_URL']);c[e['DB_NAME']].signup_events.delete_many({});"],
        check=False, capture_output=True)


# ---------- signup-trial + onboarding ----------
class TestTrialOnboarding:
    def test_signup_trial_sets_onboarding_pending(self, sess, created_pharmacies):
        _clear_rate_limit()
        email = f"test_onb_{rid()}@exemple.test"
        r = sess.post(f"{BASE}/auth/signup-trial", json={
            "pharmacy_name": "TEST_Pharmacie Onboarding",
            "name": "Testeur Onboarding",
            "email": email,
            "password": "TestOnb2026!x",
        })
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["user"]["onboarding_pending"] is True
        assert data["user"]["role"] == "admin"
        assert data["user"]["email"] == email
        assert isinstance(data["access_token"], str) and len(data["access_token"]) > 20
        assert "trial_ends_at" in data
        pid = data["user"].get("pharmacyId") or data["user"].get("pharmacy_id")
        assert pid
        created_pharmacies.append(pid)
        pytest.trial_token = data["access_token"]
        pytest.trial_email = email

        # GET /auth/me must still show onboarding_pending before completion
        me = sess.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"})
        assert me.status_code == 200
        assert me.json().get("onboarding_pending") is True

    def test_post_onboarding_completes(self, sess):
        tok = getattr(pytest, "trial_token", None)
        assert tok, "signup test must run first"
        r = sess.post(f"{BASE}/onboarding", json={
            "address": "123 rue Principale", "city": "Montréal",
            "employee_count": "6 à 15", "opening_hours": "Lun-Ven 8h-21h"},
            headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text[:300]
        assert r.json() == {"ok": True}

        me = sess.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        assert "onboarding_pending" not in me.json()

    def test_onboarding_skipped_flow(self, sess, created_pharmacies):
        _clear_rate_limit()
        email = f"test_skip_{rid()}@exemple.test"
        r = sess.post(f"{BASE}/auth/signup-trial", json={
            "pharmacy_name": "TEST_Pharmacie Skip", "name": "Testeur Skip",
            "email": email, "password": "TestSkip2026!x"})
        assert r.status_code == 200, r.text[:400]
        tok = r.json()["access_token"]
        created_pharmacies.append(r.json()["user"]["pharmacy_id"])
        r2 = sess.post(f"{BASE}/onboarding", json={"skipped": True},
                       headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 200 and r2.json()["ok"] is True
        me = sess.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert "onboarding_pending" not in me.json()

    def test_onboarding_forbidden_for_employee(self, sess):
        r = sess.post(f"{BASE}/auth/login", json={"email": "julie@luminahr.ca", "password": "O1ka!gfVV6e54"})
        assert r.status_code == 200, r.text[:200]
        tok = r.json()["access_token"]
        r2 = sess.post(f"{BASE}/onboarding", json={"skipped": True},
                       headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 403, f"expected 403 got {r2.status_code}"

    def test_onboarding_requires_auth(self, sess):
        r = sess.post(f"{BASE}/onboarding", json={"skipped": True})
        assert r.status_code in (401, 403)

    def test_existing_admin_ph1_no_onboarding(self, sess):
        r = sess.post(f"{BASE}/auth/login", json=ADMIN_PH1)
        assert r.status_code == 200, r.text[:200]
        tok = r.json()["access_token"]
        me = sess.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        assert "onboarding_pending" not in me.json(), "ph1 grandfathered pharmacy should not trigger wizard"


# ---------- superadmin pharmacy creation with mandatory admin ----------
class TestSuperadminPharmacyCreate:
    def test_create_without_admin_returns_400_fr(self, sess, su_token):
        r = sess.post(f"{BASE}/superadmin/pharmacies", json={"name": "TEST_SansAdmin"},
                      headers={"Authorization": f"Bearer {su_token}"})
        assert r.status_code == 400, r.text[:300]
        detail = r.json().get("detail", "")
        assert "administrateur" in detail.lower()

    def test_create_with_admin(self, sess, su_token, created_pharmacies):
        admin_email = f"test_adm_{rid()}@exemple.test"
        r = sess.post(f"{BASE}/superadmin/pharmacies", json={
            "name": "TEST_Pharmacie SA", "city": "Québec", "address": "1 rue Test",
            "admin_name": "Admin Test", "admin_email": admin_email},
            headers={"Authorization": f"Bearer {su_token}"})
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["accounts_count"] == 1
        assert d["temporary_password"] and isinstance(d["temporary_password"], str)
        assert "email_sent" in d
        assert d["admin_user"]["email"] == admin_email
        assert "_id" not in d
        pid = d["id"]
        created_pharmacies.append(pid)

        # persisted in list
        lst = sess.get(f"{BASE}/superadmin/pharmacies", headers={"Authorization": f"Bearer {su_token}"})
        assert lst.status_code == 200
        row = next((p for p in lst.json() if p["id"] == pid), None)
        assert row is not None and row["accounts_count"] == 1

        # duplicate email -> 400
        dup = sess.post(f"{BASE}/superadmin/pharmacies", json={
            "name": "TEST_Dup", "admin_name": "Dup", "admin_email": admin_email},
            headers={"Authorization": f"Bearer {su_token}"})
        assert dup.status_code == 400
        assert "existe" in dup.json()["detail"].lower()

        # new admin can log in, temp password flag set
        lg = requests.post(f"{BASE}/auth/login",
                           json={"email": admin_email, "password": d["temporary_password"]})
        assert lg.status_code == 200, lg.text[:300]
        assert lg.json()["user"].get("isTemporaryPassword") or lg.json()["user"].get("is_temporary_password"), \
            f"temp flag missing: {lg.json()['user']}"
        pytest.sa_pid = pid
        pytest.sa_admin_email = admin_email
        pytest.sa_admin_pwd = d["temporary_password"]

    def test_non_superadmin_cannot_create(self, sess):
        lg = sess.post(f"{BASE}/auth/login", json=ADMIN_PH1)
        tok = lg.json()["access_token"]
        r = sess.post(f"{BASE}/superadmin/pharmacies", json={
            "name": "TEST_Nope", "admin_name": "x", "admin_email": f"x_{rid()}@a.test"},
            headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 403


# ---------- cascade delete ----------
class TestSuperadminPharmacyDelete:
    def test_cascade_delete(self, sess, su_token):
        pid = getattr(pytest, "sa_pid", None)
        assert pid, "create test must run first"
        email = pytest.sa_admin_email
        pwd = pytest.sa_admin_pwd
        h = {"Authorization": f"Bearer {su_token}"}
        r = sess.delete(f"{BASE}/superadmin/pharmacies/{pid}", headers=h)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["accounts_deleted"] >= 1, d
        assert d["status"] == "supprimé"

        lst = sess.get(f"{BASE}/superadmin/pharmacies", headers=h)
        assert all(p["id"] != pid for p in lst.json()), "pharmacy still listed after delete"

        lg = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd})
        assert lg.status_code == 401, f"deleted admin can still login: {lg.status_code}"

    def test_delete_unknown_returns_404(self, sess, su_token):
        r = sess.delete(f"{BASE}/superadmin/pharmacies/ph_doesnotexist",
                        headers={"Authorization": f"Bearer {su_token}"})
        assert r.status_code == 404

    def test_delete_requires_superadmin(self, sess):
        lg = sess.post(f"{BASE}/auth/login", json=ADMIN_PH1)
        tok = lg.json()["access_token"]
        r = sess.delete(f"{BASE}/superadmin/pharmacies/ph1", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 403
        # ph1 must still exist
        su = sess.post(f"{BASE}/auth/login", json=SUPERADMIN).json()["access_token"]
        lst = sess.get(f"{BASE}/superadmin/pharmacies", headers={"Authorization": f"Bearer {su}"})
        assert any(p["id"] == "ph1" for p in lst.json())
