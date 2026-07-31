"""Tests iteration 20 — Mileage export, pharmacy_settings.mileage_rate, appointment reminders."""
import os
import time
from datetime import date, datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

try:
    from zoneinfo import ZoneInfo
    MONTREAL_TZ = ZoneInfo("America/Montreal")
except Exception:  # pragma: no cover
    MONTREAL_TZ = timezone.utc


def _today_mtl():
    return datetime.now(MONTREAL_TZ).date().isoformat()

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL", "")).rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")

ADMIN = {"email": "admin@luminahr.ca", "password": "admin123"}
MANAGER = {"email": "gestion@luminahr.ca", "password": "gestion123"}
JULIE = {"email": "julie@luminahr.ca", "password": "employe123"}
ORIGINAL_ADDRESS = "5090 Rue Sherbrooke Est, Montréal, QC"


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text[:200]}"
    return r.json()


def _h(auth):
    tok = auth.get("token") or auth.get("access_token")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_auth():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def manager_auth():
    return _login(MANAGER)


@pytest.fixture(scope="module")
def julie_auth():
    return _login(JULIE)


# ==================== Pharmacy settings — mileage_rate ====================
class TestPharmacySettingsMileageRate:
    def test_put_address_and_rate(self, manager_auth):
        r = requests.put(f"{BASE_URL}/api/pharmacy/settings",
                         json={"address": ORIGINAL_ADDRESS, "mileage_rate": 0.61},
                         headers=_h(manager_auth), timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/pharmacy/settings", headers=_h(manager_auth), timeout=15)
        assert g.status_code == 200
        data = g.json()
        assert data["address"] == ORIGINAL_ADDRESS
        assert data["mileage_rate"] == 0.61

    def test_rate_too_high_400(self, manager_auth):
        r = requests.put(f"{BASE_URL}/api/pharmacy/settings",
                         json={"address": ORIGINAL_ADDRESS, "mileage_rate": 9.99},
                         headers=_h(manager_auth), timeout=15)
        assert r.status_code == 400

    def test_put_without_rate_keeps_previous(self, manager_auth):
        # After previous test, rate is still 0.61 (400 didn't overwrite)
        r = requests.put(f"{BASE_URL}/api/pharmacy/settings",
                         json={"address": ORIGINAL_ADDRESS},
                         headers=_h(manager_auth), timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/pharmacy/settings", headers=_h(manager_auth), timeout=15)
        assert g.json()["mileage_rate"] == 0.61, "PUT without mileage_rate must NOT reset previous rate"

    def test_restore_defaults(self, manager_auth):
        r = requests.put(f"{BASE_URL}/api/pharmacy/settings",
                         json={"address": ORIGINAL_ADDRESS, "mileage_rate": 0.50},
                         headers=_h(manager_auth), timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/pharmacy/settings", headers=_h(manager_auth), timeout=15)
        assert g.json()["mileage_rate"] == 0.50
        assert g.json()["address"] == ORIGINAL_ADDRESS


# ==================== Mileage endpoint ====================
class TestDeliveryMileage:
    _created = []

    def test_invalid_start_400(self, manager_auth):
        r = requests.get(f"{BASE_URL}/api/deliveries/mileage?start=abc&end=2026-08-02",
                         headers=_h(manager_auth), timeout=15)
        assert r.status_code == 400

    def test_julie_forbidden(self, julie_auth):
        r = requests.get(f"{BASE_URL}/api/deliveries/mileage?start=2026-07-27&end=2026-08-02",
                         headers=_h(julie_auth), timeout=15)
        assert r.status_code == 403

    def test_manager_ok_structure(self, manager_auth):
        r = requests.get(f"{BASE_URL}/api/deliveries/mileage?start=2026-07-27&end=2026-08-02",
                         headers=_h(manager_auth), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "start_address" in d
        assert "mileage_rate" in d
        assert "couriers" in d
        assert isinstance(d["couriers"], list)

    def test_create_deliveries_and_verify_km(self, manager_auth):
        # Create 2 deliveries for e2 with real Montreal addresses
        payloads = [
            {"client_name": "TEST_Mileage Urgent", "address": "1000 Rue Sainte-Catherine Ouest, Montréal, QC",
             "phone": "", "priority": "urgent", "courier_employee_id": "e2", "courier_name": "Julie Gagnon"},
            {"client_name": "TEST_Mileage Normal", "address": "4500 Rue Ontario Est, Montréal, QC",
             "phone": "", "priority": "normal", "courier_employee_id": "e2", "courier_name": "Julie Gagnon"},
        ]
        for p in payloads:
            r = requests.post(f"{BASE_URL}/api/deliveries", json=p, headers=_h(manager_auth), timeout=20)
            assert r.status_code == 200
            did = r.json()["id"]
            TestDeliveryMileage._created.append(did)
            # mark as livree so delivered_at is set
            r2 = requests.put(f"{BASE_URL}/api/deliveries/{did}/status",
                              json={"status": "livree"}, headers=_h(manager_auth), timeout=15)
            assert r2.status_code == 200, r2.text

        # Compute current week (Mon..Sun) in local sense — just use today ±3 days
        today = date.today()
        start = (today - timedelta(days=3)).isoformat()
        end = (today + timedelta(days=3)).isoformat()
        time.sleep(2)
        r = requests.get(f"{BASE_URL}/api/deliveries/mileage?start={start}&end={end}",
                         headers=_h(manager_auth), timeout=45)
        assert r.status_code == 200, r.text
        d = r.json()
        e2 = next((c for c in d["couriers"] if c["courier_employee_id"] == "e2"), None)
        assert e2 is not None, f"e2 not present in couriers: {d}"
        assert e2["deliveries"] >= 2
        assert e2["km"] > 0, f"km should be > 0: {e2}"

    def test_zzz_cleanup(self, manager_auth):
        for did in TestDeliveryMileage._created:
            requests.delete(f"{BASE_URL}/api/deliveries/{did}", headers=_h(manager_auth), timeout=15)


# ==================== Appointment reminders ====================
class TestAppointmentReminders:
    _created_appts = []

    def test_manager_run_empty(self, manager_auth):
        # ensure no appointments today by not creating any first
        # (there could be leftovers, but endpoint should always return {sent: N})
        r = requests.post(f"{BASE_URL}/api/appointments/reminders/run",
                          headers=_h(manager_auth), timeout=30)
        assert r.status_code == 200
        assert "sent" in r.json()

    def test_invalid_date_400(self, manager_auth):
        r = requests.post(f"{BASE_URL}/api/appointments/reminders/run?target_date=notadate",
                          headers=_h(manager_auth), timeout=15)
        assert r.status_code == 400

    def test_julie_forbidden(self, julie_auth):
        r = requests.post(f"{BASE_URL}/api/appointments/reminders/run",
                          headers=_h(julie_auth), timeout=15)
        assert r.status_code == 403

    def test_with_appointment_today_pipeline(self, admin_auth, manager_auth):
        d = _today_mtl()
        payload = {"employee_id": "e2", "employee_name": "Julie Gagnon", "date": d,
                   "start": "10:00", "end": "10:30", "client_name": "TEST_Reminder Client",
                   "reason": "vaccination", "notes": ""}
        r = requests.post(f"{BASE_URL}/api/appointments", json=payload, headers=_h(admin_auth), timeout=15)
        assert r.status_code == 200
        aid = r.json()["id"]
        TestAppointmentReminders._created_appts.append(aid)

        # Run reminders — Resend test mode: attempt to julie@luminahr.ca will FAIL.
        # sent stays 0, backend must log 'Rappel rendez-vous vers julie@luminahr.ca échoué',
        # and NO marker should be inserted (since insert happens only on success).
        r2 = requests.post(f"{BASE_URL}/api/appointments/reminders/run",
                           headers=_h(manager_auth), timeout=30)
        assert r2.status_code == 200
        data = r2.json()
        assert "sent" in data
        assert isinstance(data["sent"], int)
        # In current Resend test mode, expect 0
        assert data["sent"] == 0, f"Expected sent=0 in Resend test mode, got {data}"

        # Retry — marker not inserted, so retry attempts again (same log entry)
        r3 = requests.post(f"{BASE_URL}/api/appointments/reminders/run",
                           headers=_h(manager_auth), timeout=30)
        assert r3.status_code == 200
        assert r3.json()["sent"] == 0

    def test_zzz_cleanup(self, admin_auth):
        for aid in TestAppointmentReminders._created_appts:
            requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=_h(admin_auth), timeout=15)
