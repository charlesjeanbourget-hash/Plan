"""LuminaHR — Iteration 9 tests : Profils, Punch, Pay-settings, Approbations horaires."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

DEMO_PROPOSAL_ID = "cb21ac33-c1c4-4aa9-b00d-a4cfffd62b42"
JULIE_PIN = "7068"


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
def julie_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "julie@luminahr.ca", "password": "employe123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ---------- Punch by code ----------
class TestPunchByCode:
    def test_invalid_code_returns_404(self, s):
        r = s.post(f"{BASE_URL}/api/punch", json={"code": "9999"}, timeout=30)
        assert r.status_code == 404

    def test_missing_code_field(self, s):
        r = s.post(f"{BASE_URL}/api/punch", json={}, timeout=30)
        assert r.status_code in (400, 422)


# ---------- Profiles RBAC ----------
class TestProfiles:
    def test_employee_list_returns_only_own_profile(self, s, julie_token):
        r = s.get(f"{BASE_URL}/api/profiles", headers=bearer(julie_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["employee_id"] == "e2"

    def test_employee_cannot_update_other_profile(self, s, julie_token):
        # Julie is e2; e1 belongs to Marc
        r = s.put(f"{BASE_URL}/api/profiles/e1",
                  json={"employee_name": "Hack Attempt", "min_hours_per_week": 5},
                  headers=bearer(julie_token), timeout=30)
        assert r.status_code == 403

    def test_employee_can_update_own(self, s, julie_token):
        r = s.put(f"{BASE_URL}/api/profiles/e2",
                  json={"employee_name": "Julie Gagnon", "min_hours_week": 20, "max_hours_week": 32},
                  headers=bearer(julie_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body.get("min_hours_week") == 20
        assert body.get("max_hours_week") == 32
        # Verify persistence via GET
        r2 = s.get(f"{BASE_URL}/api/profiles/e2", headers=bearer(julie_token), timeout=30)
        assert r2.status_code == 200
        assert r2.json().get("min_hours_week") == 20
        assert r2.json().get("max_hours_week") == 32

    def test_employee_cannot_generate_punch_code(self, s, julie_token):
        r = s.post(f"{BASE_URL}/api/profiles/e2/punch-code",
                   headers=bearer(julie_token), timeout=30)
        assert r.status_code == 403

    def test_admin_lists_all_profiles(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/profiles", headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # At minimum should have Julie's profile
        assert any(p.get("employee_id") == "e2" for p in data)


# ---------- Schedule proposal apply blocked ----------
class TestScheduleApply:
    def test_admin_apply_blocked_400_when_pending_approvals(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/schedule/proposals/{DEMO_PROPOSAL_ID}/apply",
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 400, r.text

    def test_get_proposals_includes_demo(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/schedule/proposals", headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        demo = next((p for p in data if p.get("id") == DEMO_PROPOSAL_ID), None)
        assert demo is not None, "Demo proposal missing"
        # week_start should be 2026-08-03
        assert demo.get("week_start") == "2026-08-03"


# ---------- Punches summary ----------
class TestPunchesSummary:
    def test_summary_requires_auth(self, s):
        r = s.get(f"{BASE_URL}/api/punches/summary", timeout=30)
        assert r.status_code == 401

    def test_summary_admin_ok(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/punches/summary",
                  params={"start": "2026-07-20", "end": "2026-08-10"},
                  headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Pay settings ----------
class TestPaySettings:
    def test_invalid_period_type_400(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/pay-settings",
                   json={"period_type": "monthly", "anchor": "2026-06-01"},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 400

    def test_get_pay_settings(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/pay-settings", headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("period_type") in ("weekly", "biweekly")

    def test_set_and_reset_biweekly(self, s, admin_token):
        # Ensure biweekly with anchor is set (final state per review requirements)
        r = s.post(f"{BASE_URL}/api/pay-settings",
                   json={"period_type": "biweekly", "anchor": "2026-06-01"},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        r2 = s.get(f"{BASE_URL}/api/pay-settings", headers=bearer(admin_token), timeout=30)
        body = r2.json()
        assert body["period_type"] == "biweekly"
        assert body["anchor"] == "2026-06-01"
