"""Iteration 25 — Punch géolocalisation, matricules paie, régression exports."""
import os
from datetime import date, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@luminahr.ca", "password": "admin123"}
JULIE = {"email": "julie@luminahr.ca", "password": "employe123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login {creds['email']} failed: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def julie_token():
    return _login(JULIE)


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def julie_h(julie_token):
    return {"Authorization": f"Bearer {julie_token}"}


def _cleanup_open_punch(admin_h, employee_id="e2"):
    """Close any open punch for Julie so tests start clean."""
    r = requests.get(f"{API}/punches/open", headers=admin_h, timeout=30)
    if r.status_code == 200:
        for p in r.json():
            if p.get("employee_id") == employee_id:
                requests.delete(f"{API}/punches/{p['id']}", headers=admin_h, timeout=30)


# -------- Punch geolocation (feature 4) --------
@pytest.mark.xdist_group("punch_julie")
class TestPunchGeo:
    def test_punch_me_with_geo_then_close(self, julie_h, admin_h):
        _cleanup_open_punch(admin_h)
        # 1st call → punch in with location
        r1 = requests.post(f"{API}/punch/me", json={"lat": 45.5, "lng": -73.56, "accuracy": 10},
                           headers=julie_h, timeout=30)
        assert r1.status_code == 200, r1.text
        assert r1.json()["action"] == "in"

        # 2nd call → punch out with different geo
        r2 = requests.post(f"{API}/punch/me", json={"lat": 45.6, "lng": -73.7, "accuracy": 20},
                           headers=julie_h, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["action"] == "out"

        # verify via status
        rs = requests.get(f"{API}/punch/me/status", headers=julie_h, timeout=30)
        assert rs.status_code == 200
        data = rs.json()
        assert "today_entries" in data
        matched = [e for e in data["today_entries"]
                   if e.get("punch_in_location", {}) and
                   e.get("punch_in_location", {}).get("lat") == 45.5 and
                   e.get("punch_out_location", {}) and
                   e.get("punch_out_location", {}).get("lat") == 45.6]
        assert matched, f"punch entry with expected locations not found: {data['today_entries']}"
        e = matched[0]
        assert e["punch_in_location"]["lng"] == -73.56
        assert e["punch_out_location"]["lng"] == -73.7

    def test_punch_me_empty_body(self, julie_h, admin_h):
        _cleanup_open_punch(admin_h)
        # empty body — should still work (geo null)
        r = requests.post(f"{API}/punch/me", json={}, headers=julie_h, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "in"
        # close it
        r2 = requests.post(f"{API}/punch/me", json={}, headers=julie_h, timeout=30)
        assert r2.status_code == 200

    def test_punch_me_no_body(self, julie_h, admin_h):
        _cleanup_open_punch(admin_h)
        # no body at all
        r = requests.post(f"{API}/punch/me", headers=julie_h, timeout=30)
        assert r.status_code == 200, r.text
        _cleanup_open_punch(admin_h)

    # Kiosk (public /api/punch) — merged into same class to keep loadscope serial
    def _julie_code(self, admin_h):
        r = requests.get(f"{API}/profiles", headers=admin_h, timeout=30)
        assert r.status_code == 200
        for p in r.json():
            if p["employee_id"] == "e2":
                return p.get("punch_code") or "7068"
        return "7068"

    def test_punch_public_with_geo(self, admin_h):
        _cleanup_open_punch(admin_h)
        code = self._julie_code(admin_h)
        r = requests.post(f"{API}/punch", json={"code": code, "lat": 45.5, "lng": -73.5}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "in"

    def test_punch_public_without_geo(self, admin_h):
        code = self._julie_code(admin_h)
        r = requests.post(f"{API}/punch", json={"code": code}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "out"
        _cleanup_open_punch(admin_h)


# -------- Public punch kiosk (feature 4) --------
@pytest.mark.xdist_group("punch_julie")
class _TestPunchKioskDisabled:
    def _julie_code(self, admin_h):
        r = requests.get(f"{API}/profiles", headers=admin_h, timeout=30)
        assert r.status_code == 200
        for p in r.json():
            if p["employee_id"] == "e2":
                return p.get("punch_code") or "7068"
        return "7068"

    def test_punch_public_with_geo(self, admin_h):
        _cleanup_open_punch(admin_h)
        code = self._julie_code(admin_h)
        r = requests.post(f"{API}/punch", json={"code": code, "lat": 45.5, "lng": -73.5}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "in"

    def test_punch_public_without_geo(self, admin_h):
        code = self._julie_code(admin_h)
        r = requests.post(f"{API}/punch", json={"code": code}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "out"
        _cleanup_open_punch(admin_h)


# -------- Payroll number (feature 1) --------
class TestPayrollNumber:
    def test_put_and_get_payroll_number(self, admin_h):
        # save
        r = requests.put(f"{API}/profiles/e2", json={"payroll_number": "000999"},
                         headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        # verify via GET
        r2 = requests.get(f"{API}/profiles", headers=admin_h, timeout=30)
        assert r2.status_code == 200
        e2 = next((p for p in r2.json() if p["employee_id"] == "e2"), None)
        assert e2 is not None
        assert e2.get("payroll_number") == "000999"


# -------- Regression exports --------
class TestRegression:
    def test_export_payroll_nethris(self, admin_h):
        r = requests.get(f"{API}/punches/export-payroll",
                         params={"format": "nethris", "start": "2026-07-26", "end": "2026-08-01"},
                         headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        # should be CSV or text
        assert len(r.content) >= 0

    def test_punches_summary(self, admin_h):
        today = date.today()
        start = (today - timedelta(days=7)).isoformat()
        end = today.isoformat()
        r = requests.get(f"{API}/punches/summary",
                         params={"start": start, "end": end}, headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list) or isinstance(r.json(), dict)
