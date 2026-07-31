"""Iteration 16 backend tests:
- GET /api/tasks/stats returns badges/streak/perfect_weeks for admin AND employee views
- POST /api/tasks/weekly-report/run (admin 200, employee 403, invalid week_start 400)
- Structured alerts in existing proposal 2002ec16-... (kind/task_id/task_date/employee_id)
"""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

PROPOSAL_ID = "2002ec16-bd6d-430f-8048-484414ad1fe0"
TASK_HIGHLIGHT_ID = "35baf74b-fcd1-4910-98fd-e88f873f2b66"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@luminahr.ca", "admin123")


@pytest.fixture(scope="module")
def julie_token():
    return _login("julie@luminahr.ca", "employe123")


def _auth(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


class TestTaskStatsBadges:
    def test_admin_stats_has_julie_badges(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/tasks/stats?weeks=8",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "by_employee" in d
        julie = next((e for e in d["by_employee"] if "Julie" in e.get("name", "")), None)
        assert julie, f"Julie missing from by_employee: {[e.get('name') for e in d['by_employee']]}"
        # New fields must be present
        for k in ("current_streak", "perfect_weeks", "badges"):
            assert k in julie, f"admin view missing key {k} in by_employee entry: {julie}"
        assert isinstance(julie["badges"], list)
        assert julie["current_streak"] >= 2, f"Julie streak expected >=2, got {julie['current_streak']}"
        codes = {(b.get("key") or b.get("code")) if isinstance(b, dict) else b for b in julie["badges"]}
        assert "perfect_week" in codes, f"missing perfect_week in {codes}"
        assert "streak_2" in codes, f"missing streak_2 in {codes}"

    def test_employee_stats_has_own_badges(self, julie_token):
        r = requests.get(f"{BASE_URL}/api/tasks/stats?weeks=8",
                         headers=_auth(julie_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        julie = next((e for e in d["by_employee"] if "Julie" in e.get("name", "")), None)
        assert julie, "Julie must see herself in by_employee"
        for k in ("current_streak", "perfect_weeks", "badges"):
            assert k in julie, f"employee view missing key {k}"
        codes = {(b.get("key") or b.get("code")) if isinstance(b, dict) else b for b in julie["badges"]}
        assert "perfect_week" in codes
        assert "streak_2" in codes


class TestWeeklyReportRun:
    def test_admin_can_trigger(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/tasks/weekly-report/run",
                          headers=_auth(admin_token), timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "sent" in d, f"missing sent in {d}"
        assert isinstance(d["sent"], int)

    def test_employee_forbidden(self, julie_token):
        r = requests.post(f"{BASE_URL}/api/tasks/weekly-report/run",
                          headers=_auth(julie_token), timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_invalid_week_start_400(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/tasks/weekly-report/run?week_start=not-a-date",
                          headers=_auth(admin_token), timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


class TestStructuredAlerts:
    def test_proposal_alerts_structured(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/schedule/proposals",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        props = r.json()
        target = next((p for p in props if p.get("id") == PROPOSAL_ID), None)
        assert target, f"proposal {PROPOSAL_ID} not found"
        alerts = target.get("alerts") or []
        assert len(alerts) >= 2, f"expected >=2 alerts, got {alerts}"
        # Each alert must be a dict with keys text + kind (task | profile | shift ...)
        kinds = set()
        for a in alerts:
            assert isinstance(a, dict), f"alert not structured: {a}"
            assert "text" in a and "kind" in a, f"missing text/kind in {a}"
            kinds.add(a["kind"])
        assert "task" in kinds or "profile" in kinds, f"expected task/profile kinds, got {kinds}"
        # Look up task alert -> should reference TASK_HIGHLIGHT_ID
        task_alerts = [a for a in alerts if a.get("kind") == "task"]
        if task_alerts:
            ids = {a.get("task_id") for a in task_alerts}
            assert TASK_HIGHLIGHT_ID in ids, f"expected task {TASK_HIGHLIGHT_ID} in alerts, got {ids}"
