"""LuminaHR — Iteration 8 tests : assignations de formations & relances."""
import os
import uuid
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

DEMO_TRAINING_ID = "5d2a444d-08bc-4e47-adbd-0db5a64d1e28"
JULIE_EMAIL = "julie@luminahr.ca"


def bearer(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def employee_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": JULIE_EMAIL, "password": "employe123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ---------- GET assignments (admin) ----------
class TestListAssignments:
    def test_admin_list_ok_has_julie_with_computed_fields(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments",
                  headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        assigns = r.json()
        assert isinstance(assigns, list)
        julie = next((a for a in assigns if a["employee_email"] == JULIE_EMAIL), None)
        assert julie is not None, "Assignation de démo pour Julie introuvable"
        assert julie["due_date"] == "2026-08-05"
        # Champs calculés
        for f in ("passed", "passed_score", "overdue"):
            assert f in julie, f"Champ calculé manquant: {f}"
        assert julie["passed"] is True
        assert julie["passed_score"] == 100
        assert julie["overdue"] is False

    def test_list_requires_auth(self, s):
        r = s.get(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments")
        assert r.status_code == 401


# ---------- POST assignments : upsert + DELETE 404 ----------
class TestUpsertAndDelete:
    TEST_EMAIL = "test_iter8_karim@example.test"

    def _cleanup(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments",
                  headers=bearer(admin_token))
        for a in r.json():
            if a["employee_email"] == self.TEST_EMAIL:
                s.delete(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments/{a['id']}",
                         headers=bearer(admin_token))

    def test_upsert_same_email_produces_one_row_and_updates_due(self, s, admin_token):
        self._cleanup(s, admin_token)
        try:
            # 1st POST
            r1 = s.post(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments",
                        json={"assignments": [{"employee_email": self.TEST_EMAIL,
                                               "employee_name": "TEST Karim",
                                               "due_date": "2026-12-31"}]},
                        headers=bearer(admin_token))
            assert r1.status_code == 200, r1.text
            # 2nd POST with different due_date -> should upsert (still 1 row, due_date updated)
            r2 = s.post(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments",
                        json={"assignments": [{"employee_email": self.TEST_EMAIL,
                                               "employee_name": "TEST Karim",
                                               "due_date": "2027-01-15"}]},
                        headers=bearer(admin_token))
            assert r2.status_code == 200

            lst = s.get(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments",
                        headers=bearer(admin_token)).json()
            karim_rows = [a for a in lst if a["employee_email"] == self.TEST_EMAIL]
            assert len(karim_rows) == 1, f"Attendu 1 ligne, obtenu {len(karim_rows)}"
            assert karim_rows[0]["due_date"] == "2027-01-15"
        finally:
            self._cleanup(s, admin_token)

    def test_overdue_computed_when_past_due(self, s, admin_token):
        self._cleanup(s, admin_token)
        try:
            r = s.post(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments",
                       json={"assignments": [{"employee_email": self.TEST_EMAIL,
                                              "employee_name": "TEST Karim",
                                              "due_date": "2026-07-01"}]},
                       headers=bearer(admin_token))
            assert r.status_code == 200
            lst = s.get(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments",
                        headers=bearer(admin_token)).json()
            row = next(a for a in lst if a["employee_email"] == self.TEST_EMAIL)
            assert row["overdue"] is True
            assert row["passed"] is False
            assert row["passed_score"] is None
        finally:
            self._cleanup(s, admin_token)

    def test_delete_nonexistent_returns_404(self, s, admin_token):
        r = s.delete(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/assignments/{uuid.uuid4()}",
                     headers=bearer(admin_token))
        assert r.status_code == 404


# ---------- Reminders : employé 403 ----------
class TestRemindersRBAC:
    def test_employee_forbidden(self, s, employee_token):
        r = s.post(f"{BASE_URL}/api/trainings/assignments/reminders/run",
                   headers=bearer(employee_token))
        assert r.status_code == 403

    def test_no_token_401(self, s):
        r = s.post(f"{BASE_URL}/api/trainings/assignments/reminders/run")
        assert r.status_code == 401

    def test_admin_ok_returns_sent_count(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/trainings/assignments/reminders/run",
                   headers=bearer(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert "sent" in body and isinstance(body["sent"], int)


# ---------- Employee view: my_assignment ----------
class TestMyAssignment:
    def test_julie_gets_my_assignment_on_demo(self, s, employee_token):
        r = s.get(f"{BASE_URL}/api/trainings", headers=bearer(employee_token))
        assert r.status_code == 200
        demo = next((t for t in r.json() if t["id"] == DEMO_TRAINING_ID), None)
        assert demo is not None
        assert "my_assignment" in demo, "my_assignment absent"
        assert demo["my_assignment"] is not None
        assert demo["my_assignment"]["due_date"] == "2026-08-05"
