"""Iteration 34 — hourly_rate on ProfileIn (PUT /api/profiles/{id})."""
import os
import pytest
import requests
from dotenv import dotenv_values

env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = {"email": "admin@luminahr.ca", "password": "Nlpx!tTE3Aw27"}
JULIE = {"email": "julie@luminahr.ca", "password": "O1ka!gfVV6e54"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def julie_token():
    return _login(JULIE)


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _profiles(token):
    r = requests.get(f"{BASE_URL}/api/profiles", headers=_hdr(token), timeout=15)
    assert r.status_code == 200, r.text
    return {p["employee_id"]: p for p in r.json()}


class TestHourlyRateProfileEndpoint:
    def test_admin_sets_rate_e3_valid(self, admin_token):
        r = requests.put(f"{BASE_URL}/api/profiles/e3",
                         json={"hourly_rate": 24.5, "employee_name": "Karim Benali"},
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        profiles = _profiles(admin_token)
        assert profiles["e3"].get("hourly_rate") == 24.5

    def test_admin_sets_rate_invalid_high(self, admin_token):
        r = requests.put(f"{BASE_URL}/api/profiles/e3",
                         json={"hourly_rate": 5000},
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 400, r.text

    def test_admin_sets_rate_invalid_negative(self, admin_token):
        r = requests.put(f"{BASE_URL}/api/profiles/e3",
                         json={"hourly_rate": -5},
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 400, r.text

    def test_employee_cannot_change_rate(self, admin_token, julie_token):
        # capture current rate of e2
        before = _profiles(admin_token)["e2"].get("hourly_rate")
        # Julie tries to modify her own rate
        r = requests.put(f"{BASE_URL}/api/profiles/e2",
                         json={"hourly_rate": 99},
                         headers=_hdr(julie_token), timeout=15)
        assert r.status_code == 200, r.text
        after = _profiles(admin_token)["e2"].get("hourly_rate")
        assert after == before, f"Rate should be unchanged; before={before} after={after}"

    def test_admin_zero_rate_accepted(self, admin_token):
        # Setup for auto-healing test (frontend TEST 3): allow 0 to be persisted
        r = requests.put(f"{BASE_URL}/api/profiles/e1",
                         json={"hourly_rate": 0, "employee_name": "Sophie Lavoie"},
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        profiles = _profiles(admin_token)
        assert profiles["e1"].get("hourly_rate") == 0

    def test_cleanup_restore_e3(self, admin_token):
        # Restore an admin-friendly rate for e3 so the follow-up frontend test can use 27.25
        r = requests.put(f"{BASE_URL}/api/profiles/e3",
                         json={"hourly_rate": 22.75, "employee_name": "Karim Benali"},
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
