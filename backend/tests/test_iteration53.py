"""Iteration 53 — Comptes de connexion employés (accounts/for-employee, bulk-invite, linked-employee-ids)."""
import os
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = backend_env.get("MONGO_URL")
DB_NAME = backend_env.get("DB_NAME")

ADMIN = ("admin@luminahr.ca", "Nlpx!tTE3Aw27")
EMPLOYEE = ("julie@luminahr.ca", "O1ka!gfVV6e54")
TEST_EMAIL = "test.karim.qa@exemple.ca"


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _token(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login {email} failed {r.status_code}: {r.text[:300]}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_token(*ADMIN)}"}


@pytest.fixture(scope="module")
def emp_h():
    return {"Authorization": f"Bearer {_token(*EMPLOYEE)}"}


@pytest.fixture(scope="module", autouse=True)
def cleanup(mongo):
    """Supprime UNIQUEMENT les comptes créés par ce fichier de test."""
    yield
    mongo.users.delete_one({"email": TEST_EMAIL})
    mongo.users.delete_one({"email": "autre.qa@exemple.ca"})


class TestLinkedIds:
    def test_initial_linked_ids(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/accounts/linked-employee-ids", headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        ids = r.json()["ids"]
        assert sorted(ids) == ["e1", "e2"], f"attendu [e1,e2], obtenu {ids}"

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/accounts/linked-employee-ids", timeout=30)
        assert r.status_code in (401, 403)


class TestCreateAccountForEmployee:
    def test_existing_email_returns_400_french(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/accounts/for-employee", headers=admin_h, timeout=30,
                          json={"employee_id": "e3", "email": "admin@luminahr.ca", "name": "Karim Benali", "role": "employee"})
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "existe déjà" in detail, detail

    def test_invalid_email_returns_400(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/accounts/for-employee", headers=admin_h, timeout=30,
                          json={"employee_id": "e3", "email": "pas-un-courriel", "role": "employee"})
        assert r.status_code == 400
        assert "Courriel invalide" in r.json().get("detail", "")

    def test_employee_role_forbidden(self, emp_h):
        r = requests.post(f"{BASE_URL}/api/accounts/for-employee", headers=emp_h, timeout=30,
                          json={"employee_id": "e3", "email": TEST_EMAIL, "role": "employee"})
        assert r.status_code == 403, r.text

    def test_create_then_duplicate_then_cleanup(self, admin_h, mongo):
        r = requests.post(f"{BASE_URL}/api/accounts/for-employee", headers=admin_h, timeout=60,
                          json={"employee_id": "e3", "email": TEST_EMAIL, "name": "Karim Benali", "role": "manager"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] is True
        assert data["role"] == "manager"
        assert data["email"] == TEST_EMAIL
        # persistance mongo
        u = mongo.users.find_one({"email": TEST_EMAIL})
        assert u is not None
        assert u["employee_id"] == "e3"
        assert u["pharmacy_id"] == "ph1"
        assert u["role"] == "manager"
        assert u["is_temporary_password"] is True
        assert u["password_hash"].startswith("$2b$")

        # linked ids contient e3
        ids = requests.get(f"{BASE_URL}/api/accounts/linked-employee-ids", headers=admin_h, timeout=30).json()["ids"]
        assert "e3" in ids

        # employé déjà lié -> 400
        r2 = requests.post(f"{BASE_URL}/api/accounts/for-employee", headers=admin_h, timeout=30,
                           json={"employee_id": "e3", "email": "autre.qa@exemple.ca", "role": "employee"})
        assert r2.status_code == 400
        assert "déjà un compte lié" in r2.json().get("detail", "")

        # bulk-invite renvoie une raison sans créer
        r3 = requests.post(f"{BASE_URL}/api/accounts/bulk-invite", headers=admin_h, timeout=60,
                           json={"items": [{"employee_id": "e3", "email": "autre.qa@exemple.ca", "role": "employee"}]})
        assert r3.status_code == 200, r3.text
        body = r3.json()
        assert body["created"] == 0
        assert body["results"][0]["created"] is False
        assert body["results"][0]["reason"]

        # nettoyage
        mongo.users.delete_one({"email": TEST_EMAIL})
        ids2 = requests.get(f"{BASE_URL}/api/accounts/linked-employee-ids", headers=admin_h, timeout=30).json()["ids"]
        assert sorted(ids2) == ["e1", "e2"]

    def test_manager_role_permission(self):
        """Le rôle Gestionnaire = mêmes accès qu'admin selon la spec : vérifie le comportement réel."""
        h = {"Authorization": f"Bearer {_token('gestion@luminahr.ca', 'Jwdh!1l4t5D50')}"}
        r = requests.get(f"{BASE_URL}/api/accounts/linked-employee-ids", headers=h, timeout=30)
        print("manager linked-ids:", r.status_code, r.text[:120])
        r2 = requests.post(f"{BASE_URL}/api/accounts/bulk-invite", headers=h, timeout=30, json={"items": []})
        print("manager bulk-invite:", r2.status_code, r2.text[:160])
        r3 = requests.post(f"{BASE_URL}/api/accounts/for-employee", headers=h, timeout=30,
                           json={"employee_id": "e3", "email": "manager.qa@exemple.ca", "role": "employee"})
        print("manager for-employee:", r3.status_code, r3.text[:160])
        assert r3.status_code != 500

    def test_bulk_invite_forbidden_for_employee(self, emp_h):
        r = requests.post(f"{BASE_URL}/api/accounts/bulk-invite", headers=emp_h, timeout=30, json={"items": []})
        assert r.status_code == 403


class TestModuleAccessLookup:
    def test_by_employee_found_for_e1(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/users/by-employee/e1", headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["found"] is True
        assert d["email"] == "admin@luminahr.ca"
        assert "_id" not in d

    def test_by_employee_not_found_for_e3(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/users/by-employee/e3", headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["found"] is False
