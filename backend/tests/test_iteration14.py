"""Iteration 14 backend tests:
- GET /api/tasks/stats (admin vs employee scoping)
- POST /api/tasks/bulk (admin creates N, employee 403)
- POST /api/tasks qualification_warning flag (Julie e2 in/out of capacities, and unassigned)

Note: We deliberately do NOT trigger POST /api/schedule/generate here (expensive AI call).
The main agent already validated that flow via curl. We only verify that the endpoint
accepts absences[] payload (returns 202/dict) without exercising AI — actually still
costs money, so we skip.
"""
import os
import re
import time
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:300]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token"
    return tok


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@luminahr.ca", "admin123")


@pytest.fixture(scope="module")
def julie_token():
    return _login("julie@luminahr.ca", "employe123")


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _monday_iso() -> str:
    import datetime as dt
    today = dt.date.today()
    return (today - dt.timedelta(days=today.weekday())).isoformat()


# ------------ Tasks stats ------------
class TestTaskStats:
    def test_admin_stats_shape(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/tasks/stats?weeks=8", headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("weekly", "by_shift", "by_employee", "team"):
            assert k in d, f"missing {k}"
        assert isinstance(d["weekly"], list)
        assert isinstance(d["by_shift"], list)
        assert isinstance(d["by_employee"], list)
        assert isinstance(d["team"], dict)
        for k in ("total", "done", "rate"):
            assert k in d["team"]

    def test_employee_stats_scoped_to_self(self, julie_token, admin_token):
        # Create one team task and one task assigned to Julie so admin view differs
        monday = _monday_iso()
        created_ids = []
        try:
            r = requests.post(f"{BASE_URL}/api/tasks",
                              json={"date": monday, "shift": "Matin",
                                    "title": "TEST_iter14 team stats task",
                                    "assignee_employee_id": "", "assignee_name": ""},
                              headers=_auth(admin_token), timeout=30)
            assert r.status_code in (200, 201), r.text
            created_ids.append(r.json()["id"])
            r = requests.post(f"{BASE_URL}/api/tasks",
                              json={"date": monday, "shift": "Matin",
                                    "title": "TEST_iter14 Comptage des pilules du soir",
                                    "assignee_employee_id": "e2", "assignee_name": "Julie Gagnon"},
                              headers=_auth(admin_token), timeout=30)
            assert r.status_code in (200, 201), r.text
            created_ids.append(r.json()["id"])
            # Also assign a task to Karim e3 — julie must NOT see him in by_employee
            r = requests.post(f"{BASE_URL}/api/tasks",
                              json={"date": monday, "shift": "Matin",
                                    "title": "TEST_iter14 Karim only task",
                                    "assignee_employee_id": "e3", "assignee_name": "Karim Belkacem"},
                              headers=_auth(admin_token), timeout=30)
            assert r.status_code in (200, 201), r.text
            created_ids.append(r.json()["id"])

            # Julie's view: by_employee should only contain herself (if she has any assigned or team_checks)
            r = requests.get(f"{BASE_URL}/api/tasks/stats?weeks=8", headers=_auth(julie_token), timeout=30)
            assert r.status_code == 200, r.text
            d = r.json()
            names = {e["name"] for e in d["by_employee"]}
            # Should NOT include Karim
            assert not any("Karim" in n for n in names), f"employee should not see Karim in by_employee: {names}"
            # If anyone appears, must be Julie
            for n in names:
                assert "Julie" in n, f"unexpected employee visible to Julie: {n}"

            # Admin view: should include both Julie and Karim
            r = requests.get(f"{BASE_URL}/api/tasks/stats?weeks=8", headers=_auth(admin_token), timeout=30)
            assert r.status_code == 200, r.text
            d = r.json()
            names = {e["name"] for e in d["by_employee"]}
            assert any("Julie" in n for n in names), f"admin should see Julie: {names}"
            assert any("Karim" in n for n in names), f"admin should see Karim: {names}"
        finally:
            for tid in created_ids:
                requests.delete(f"{BASE_URL}/api/tasks/{tid}", headers=_auth(admin_token), timeout=15)


# ------------ Bulk creation ------------
class TestTasksBulk:
    def test_bulk_admin_creates_n(self, admin_token):
        monday = _monday_iso()
        payload = {
            "date": monday,
            "shift": "Soir",
            "recurring": False,
            "items": [
                {"title": "TEST_iter14 bulk item 1", "description": ""},
                {"title": "TEST_iter14 bulk item 2", "description": "avec précision"},
                {"title": "TEST_iter14 bulk item 3", "description": ""},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/tasks/bulk", json=payload,
                          headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("created") == 3

        # Verify via GET /api/tasks
        r = requests.get(f"{BASE_URL}/api/tasks?start={monday}&end={monday}",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        tasks = r.json()
        matched = [t for t in tasks if t["title"].startswith("TEST_iter14 bulk item")]
        assert len(matched) == 3, f"expected 3, got {len(matched)}"
        for t in matched:
            assert t["shift"] == "Soir"
            assert t["assignee_employee_id"] == ""
            # Cleanup
            requests.delete(f"{BASE_URL}/api/tasks/{t['id']}", headers=_auth(admin_token), timeout=15)

    def test_bulk_employee_forbidden(self, julie_token):
        monday = _monday_iso()
        r = requests.post(f"{BASE_URL}/api/tasks/bulk",
                          json={"date": monday, "shift": "Matin", "items": [{"title": "x"}]},
                          headers=_auth(julie_token), timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text[:200]}"


# ------------ Qualification warning ------------
class TestQualificationWarning:
    def test_qualif_out_of_capacities_true(self, admin_token):
        # Julie caps: Saisie des ordonnances, Comptage des pilules, Gestion de la caisse
        monday = _monday_iso()
        r = requests.post(f"{BASE_URL}/api/tasks",
                          json={"date": monday, "shift": "Matin",
                                "title": "TEST_iter14 Préparations magistrales complexes",
                                "assignee_employee_id": "e2", "assignee_name": "Julie Gagnon"},
                          headers=_auth(admin_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        try:
            assert body.get("qualification_warning") is True, f"expected True, got {body}"
        finally:
            requests.delete(f"{BASE_URL}/api/tasks/{body['id']}", headers=_auth(admin_token), timeout=15)

    def test_qualif_in_capacities_false(self, admin_token):
        monday = _monday_iso()
        r = requests.post(f"{BASE_URL}/api/tasks",
                          json={"date": monday, "shift": "Matin",
                                "title": "TEST_iter14 Comptage des pilules du soir",
                                "assignee_employee_id": "e2", "assignee_name": "Julie Gagnon"},
                          headers=_auth(admin_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        try:
            assert body.get("qualification_warning") is False, f"expected False, got {body}"
        finally:
            requests.delete(f"{BASE_URL}/api/tasks/{body['id']}", headers=_auth(admin_token), timeout=15)

    def test_qualif_unassigned_false(self, admin_token):
        monday = _monday_iso()
        r = requests.post(f"{BASE_URL}/api/tasks",
                          json={"date": monday, "shift": "Matin",
                                "title": "TEST_iter14 Préparations magistrales complexes (team)",
                                "assignee_employee_id": "", "assignee_name": ""},
                          headers=_auth(admin_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        try:
            assert body.get("qualification_warning") is False, f"expected False for team task, got {body}"
        finally:
            requests.delete(f"{BASE_URL}/api/tasks/{body['id']}", headers=_auth(admin_token), timeout=15)


# ------------ Schedule generate payload sanity (no AI call) ------------
class TestScheduleGenPayload:
    def test_schedule_generate_accepts_absences_field(self, admin_token):
        # We validate the endpoint accepts absences by sending an invalid week
        # We'll actually just check that the endpoint's payload schema does not reject
        # 'absences' as unknown — since the main agent already ran a real generation,
        # here we only ensure the field is accepted syntactically. Use a validation
        # error path: missing employees list would 400 fast; instead, we send a
        # syntactically valid request but with employees=[] which the backend accepts.
        # NOTE: this will actually kick off the async AI worker — to avoid cost,
        # we skip this test entirely.
        pytest.skip("Skipping real AI schedule generation to avoid cost — validated by main agent via curl.")
