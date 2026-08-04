"""Iteration 42 — security-settings (MFA policy + password rules) + ICS calendar sync."""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN_EMAIL = "admin@luminahr.ca"
ADMIN_PASS = "Nlpx!tTE3Aw27"
JULIE_EMAIL = "julie@luminahr.ca"
JULIE_PASS = "O1ka!gfVV6e54"

DEFAULT_POLICY = {
    "mfa_required": False,
    "pw_min_length": 10,
    "pw_require_upper": True,
    "pw_require_lower": True,
    "pw_require_digit": True,
    "pw_require_special": False,
    "pw_expiry_days": 0,
}


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    token = data.get("access_token")
    assert token
    return token


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def julie_token():
    return _login(JULIE_EMAIL, JULIE_PASS)


@pytest.fixture(scope="module", autouse=True)
def restore_policy_after(admin_token):
    yield
    # Always restore default policy at end
    requests.put(f"{BASE_URL}/api/security-settings", json=DEFAULT_POLICY,
                 headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)


# ==== SECURITY SETTINGS ====

class TestSecuritySettings:
    def test_get_default(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/security-settings",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k, v in DEFAULT_POLICY.items():
            assert d.get(k) == v, f"{k}={d.get(k)} expected {v}"

    def test_put_bounds(self, admin_token):
        # Try to exceed bounds
        payload = {**DEFAULT_POLICY, "pw_min_length": 100, "pw_expiry_days": 5000}
        r = requests.put(f"{BASE_URL}/api/security-settings", json=payload,
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["pw_min_length"] == 64
        assert d["pw_expiry_days"] == 730

        # Below bound
        payload2 = {**DEFAULT_POLICY, "pw_min_length": 4}
        r2 = requests.put(f"{BASE_URL}/api/security-settings", json=payload2,
                          headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["pw_min_length"] == 8
        # Restore default
        requests.put(f"{BASE_URL}/api/security-settings", json=DEFAULT_POLICY,
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)

    def test_employee_forbidden(self, julie_token):
        r = requests.put(f"{BASE_URL}/api/security-settings", json=DEFAULT_POLICY,
                         headers={"Authorization": f"Bearer {julie_token}"}, timeout=15)
        assert r.status_code == 403

    def test_mfa_required_blocked_when_admin_no_mfa(self, admin_token):
        payload = {**DEFAULT_POLICY, "mfa_required": True}
        r = requests.put(f"{BASE_URL}/api/security-settings", json=payload,
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 400
        assert "Activez d'abord" in r.json().get("detail", "")

    def test_password_policy_enforced_on_change(self, admin_token, julie_token):
        # Set strict policy
        payload = {**DEFAULT_POLICY, "pw_min_length": 12, "pw_require_special": True}
        r = requests.put(f"{BASE_URL}/api/security-settings", json=payload,
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200

        # Julie tries weak password (short)
        r2 = requests.post(f"{BASE_URL}/api/auth/change-password",
                           json={"current_password": JULIE_PASS, "new_password": "Short1a"},
                           headers={"Authorization": f"Bearer {julie_token}"}, timeout=15)
        assert r2.status_code == 400
        assert "au moins 12" in r2.json().get("detail", "")

        # Julie tries password with 12 chars but no special
        r3 = requests.post(f"{BASE_URL}/api/auth/change-password",
                           json={"current_password": JULIE_PASS, "new_password": "Abcdefgh1234"},
                           headers={"Authorization": f"Bearer {julie_token}"}, timeout=15)
        assert r3.status_code == 400
        assert "spécial" in r3.json().get("detail", "")

        # Restore default policy
        requests.put(f"{BASE_URL}/api/security-settings", json=DEFAULT_POLICY,
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)


# ==== ICS CALENDAR ====

class TestCalendarICS:
    def test_get_feed_token_and_ics(self, julie_token):
        r = requests.get(f"{BASE_URL}/api/my/calendar-feed",
                         headers={"Authorization": f"Bearer {julie_token}"}, timeout=15)
        assert r.status_code == 200
        token = r.json().get("token")
        assert token and len(token) > 10

        # Public fetch (no auth)
        r2 = requests.get(f"{BASE_URL}/api/calendar/{token}", timeout=15)
        assert r2.status_code == 200
        assert "text/calendar" in r2.headers.get("content-type", "")
        body = r2.text
        assert "BEGIN:VCALENDAR" in body
        assert "END:VCALENDAR" in body
        # Not asserting VEVENT presence since it depends on scheduled shifts
        if "BEGIN:VEVENT" in body:
            assert re.search(r"DTSTART:\d{8}T\d{6}Z", body), "DTSTART not in UTC"
            assert re.search(r"DTEND:\d{8}T\d{6}Z", body), "DTEND not in UTC"
            assert "SUMMARY:Quart" in body
            # Location should be pharmacy address (Sherbrooke)
            assert "Sherbrooke" in body or "LOCATION:" in body

    def test_invalid_token_404(self):
        r = requests.get(f"{BASE_URL}/api/calendar/invalid-token-xyz-123", timeout=15)
        assert r.status_code == 404

    def test_reset_regenerates_token(self, julie_token):
        old = requests.get(f"{BASE_URL}/api/my/calendar-feed",
                           headers={"Authorization": f"Bearer {julie_token}"}, timeout=15).json()["token"]
        r = requests.post(f"{BASE_URL}/api/my/calendar-feed/reset",
                          headers={"Authorization": f"Bearer {julie_token}"}, timeout=15)
        assert r.status_code == 200
        new = r.json()["token"]
        assert new != old
        # Old token now invalid
        r_old = requests.get(f"{BASE_URL}/api/calendar/{old}", timeout=15)
        assert r_old.status_code == 404
        # New token works
        r_new = requests.get(f"{BASE_URL}/api/calendar/{new}", timeout=15)
        assert r_new.status_code == 200
