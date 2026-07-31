"""Iteration 22 — Modèles de semaine (schedule templates) CRUD + validations + RBAC."""
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


# ---------- Fixtures auth ----------
@pytest.fixture(scope="module")
def admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token")
    assert tok
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def manager_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "gestion@luminahr.ca", "password": "gestion123"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def julie_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "julie@luminahr.ca", "password": "employe123"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


VALID_ENTRIES = [
    {"employee_id": "e2", "employee_name": "Julie Gagnon", "weekday": 0, "start": "09:00", "end": "17:00"},
    {"employee_id": "e3", "employee_name": "Karim Benali", "weekday": 5, "start": "12:00", "end": "20:00"},
]


# ---------- Cleanup helper ----------
def _cleanup_test_templates(headers):
    r = requests.get(f"{BASE_URL}/api/schedule/templates", headers=headers, timeout=15)
    if r.status_code != 200:
        return
    for t in r.json():
        if t.get("name", "").startswith("TEST_"):
            requests.delete(f"{BASE_URL}/api/schedule/templates/{t['id']}", headers=headers, timeout=15)


@pytest.fixture(scope="module", autouse=True)
def cleanup_after(admin_h):
    _cleanup_test_templates(admin_h)
    yield
    _cleanup_test_templates(admin_h)


# ---------- GET ----------
class TestListTemplates:
    def test_get_admin_ok(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/schedule/templates", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_manager_ok(self, manager_h):
        r = requests.get(f"{BASE_URL}/api/schedule/templates", headers=manager_h, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_employee_forbidden(self, julie_h):
        r = requests.get(f"{BASE_URL}/api/schedule/templates", headers=julie_h, timeout=15)
        assert r.status_code == 403


# ---------- POST create ----------
class TestCreateTemplate:
    def test_create_success_and_persistence(self, admin_h):
        payload = {"name": "TEST_Ete", "entries": VALID_ENTRIES}
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=admin_h,
                          json=payload, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "id" in j and j["name"] == "TEST_Ete"
        assert len(j["entries"]) == 2
        assert j["entries"][0]["employee_id"] == "e2"
        assert "_id" not in j  # ensure no Mongo _id leaked
        # Persistence — GET should list it
        rl = requests.get(f"{BASE_URL}/api/schedule/templates", headers=admin_h, timeout=15)
        assert any(t["id"] == j["id"] for t in rl.json())

    def test_create_empty_name_400(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=admin_h,
                          json={"name": "   ", "entries": VALID_ENTRIES}, timeout=15)
        assert r.status_code == 400

    def test_create_empty_entries_400(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=admin_h,
                          json={"name": "TEST_Empty", "entries": []}, timeout=15)
        assert r.status_code == 400

    def test_create_weekday_out_of_range_400(self, admin_h):
        bad = [{"employee_id": "e2", "employee_name": "Julie", "weekday": 7,
                "start": "09:00", "end": "17:00"}]
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=admin_h,
                          json={"name": "TEST_BadDay", "entries": bad}, timeout=15)
        assert r.status_code == 400

    def test_create_end_le_start_400(self, admin_h):
        bad = [{"employee_id": "e2", "employee_name": "Julie", "weekday": 0,
                "start": "17:00", "end": "09:00"}]
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=admin_h,
                          json={"name": "TEST_BadHours", "entries": bad}, timeout=15)
        assert r.status_code == 400

    def test_create_employee_forbidden(self, julie_h):
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=julie_h,
                          json={"name": "TEST_ByJulie", "entries": VALID_ENTRIES}, timeout=15)
        assert r.status_code == 403


# ---------- DELETE ----------
class TestDeleteTemplate:
    def test_delete_success_and_gone(self, admin_h):
        # Create then delete
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=admin_h,
                          json={"name": "TEST_ToDelete", "entries": VALID_ENTRIES}, timeout=15)
        assert r.status_code == 200
        tid = r.json()["id"]
        rd = requests.delete(f"{BASE_URL}/api/schedule/templates/{tid}",
                             headers=admin_h, timeout=15)
        assert rd.status_code == 200
        # Verify removal
        rl = requests.get(f"{BASE_URL}/api/schedule/templates", headers=admin_h, timeout=15)
        assert not any(t["id"] == tid for t in rl.json())

    def test_delete_unknown_404(self, admin_h):
        r = requests.delete(f"{BASE_URL}/api/schedule/templates/does-not-exist-xyz",
                            headers=admin_h, timeout=15)
        assert r.status_code == 404

    def test_delete_employee_forbidden(self, julie_h, admin_h):
        # Create with admin
        r = requests.post(f"{BASE_URL}/api/schedule/templates", headers=admin_h,
                          json={"name": "TEST_ForForbidden", "entries": VALID_ENTRIES}, timeout=15)
        tid = r.json()["id"]
        rd = requests.delete(f"{BASE_URL}/api/schedule/templates/{tid}",
                             headers=julie_h, timeout=15)
        assert rd.status_code == 403
        # Cleanup
        requests.delete(f"{BASE_URL}/api/schedule/templates/{tid}", headers=admin_h, timeout=15)
