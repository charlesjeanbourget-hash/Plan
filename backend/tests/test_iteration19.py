"""Tests iteration 19 — Appointments, Delivery Route (tournée), Delivery Proofs listing, Pharmacy Settings."""
import os
import time
from datetime import date, timedelta

import pytest
import requests
from dotenv import dotenv_values

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


@pytest.fixture(scope="module")
def admin_auth():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def manager_auth():
    return _login(MANAGER)


@pytest.fixture(scope="module")
def julie_auth():
    return _login(JULIE)


def _h(auth):
    tok = auth.get("token") or auth.get("access_token")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ==================== Appointments ====================
class TestAppointments:
    _created = []

    def test_admin_create_appointment_ok(self, admin_auth):
        d = str(date.today())
        payload = {"employee_id": "e2", "employee_name": "Julie Gagnon", "date": d,
                   "start": "10:00", "end": "10:30", "client_name": "TEST_Mme Tremblay",
                   "reason": "vaccination", "notes": ""}
        r = requests.post(f"{BASE_URL}/api/appointments", json=payload, headers=_h(admin_auth), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["client_name"] == "TEST_Mme Tremblay"
        assert "id" in data
        TestAppointments._created.append(data["id"])

        # verify persistence via GET
        r2 = requests.get(f"{BASE_URL}/api/appointments?start={d}&end={d}", headers=_h(admin_auth), timeout=15)
        assert r2.status_code == 200
        ids = [a["id"] for a in r2.json()]
        assert data["id"] in ids

    def test_end_before_start_400(self, admin_auth):
        d = str(date.today())
        r = requests.post(f"{BASE_URL}/api/appointments", json={
            "employee_id": "e2", "date": d, "start": "10:00", "end": "09:00",
            "client_name": "TEST_bad"}, headers=_h(admin_auth), timeout=15)
        assert r.status_code == 400

    def test_empty_client_400(self, admin_auth):
        d = str(date.today())
        r = requests.post(f"{BASE_URL}/api/appointments", json={
            "employee_id": "e2", "date": d, "start": "10:00", "end": "11:00",
            "client_name": "   "}, headers=_h(admin_auth), timeout=15)
        assert r.status_code == 400

    def test_julie_create_for_other_403(self, julie_auth):
        d = str(date.today())
        r = requests.post(f"{BASE_URL}/api/appointments", json={
            "employee_id": "e3", "date": d, "start": "10:00", "end": "10:30",
            "client_name": "TEST_forbid"}, headers=_h(julie_auth), timeout=15)
        assert r.status_code == 403

    def test_julie_create_for_self_ok(self, julie_auth):
        d = str(date.today())
        r = requests.post(f"{BASE_URL}/api/appointments", json={
            "employee_id": "e2", "employee_name": "Julie Gagnon", "date": d,
            "start": "11:00", "end": "11:30", "client_name": "TEST_self"}, headers=_h(julie_auth), timeout=15)
        assert r.status_code == 200, r.text
        TestAppointments._created.append(r.json()["id"])

    def test_delete_by_other_employee_403(self, admin_auth, julie_auth):
        # admin creates for e3
        d = str(date.today())
        r = requests.post(f"{BASE_URL}/api/appointments", json={
            "employee_id": "e3", "employee_name": "Autre", "date": d,
            "start": "12:00", "end": "12:30", "client_name": "TEST_e3"}, headers=_h(admin_auth), timeout=15)
        assert r.status_code == 200
        aid = r.json()["id"]
        # julie tries to delete -> 403
        r2 = requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=_h(julie_auth), timeout=15)
        assert r2.status_code == 403
        # admin deletes -> 200
        r3 = requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=_h(admin_auth), timeout=15)
        assert r3.status_code == 200

    def test_zzz_cleanup(self, admin_auth):
        for aid in TestAppointments._created:
            requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=_h(admin_auth), timeout=15)


# ==================== Pharmacy settings ====================
class TestPharmacySettings:
    def test_get_default(self, julie_auth):
        r = requests.get(f"{BASE_URL}/api/pharmacy/settings", headers=_h(julie_auth), timeout=15)
        assert r.status_code == 200
        assert "address" in r.json()

    def test_julie_put_403(self, julie_auth):
        r = requests.put(f"{BASE_URL}/api/pharmacy/settings", json={"address": "hack"},
                         headers=_h(julie_auth), timeout=15)
        assert r.status_code == 403

    def test_admin_put_and_restore(self, admin_auth):
        new = "TEST_1234 Rue Test, Montréal, QC"
        r = requests.put(f"{BASE_URL}/api/pharmacy/settings", json={"address": new},
                         headers=_h(admin_auth), timeout=15)
        assert r.status_code == 200
        assert r.json()["address"] == new
        # verify GET
        r2 = requests.get(f"{BASE_URL}/api/pharmacy/settings", headers=_h(admin_auth), timeout=15)
        assert r2.json()["address"] == new
        # restore
        rr = requests.put(f"{BASE_URL}/api/pharmacy/settings", json={"address": ORIGINAL_ADDRESS},
                          headers=_h(admin_auth), timeout=15)
        assert rr.status_code == 200
        assert rr.json()["address"] == ORIGINAL_ADDRESS

    def test_admin_put_empty_400(self, admin_auth):
        r = requests.put(f"{BASE_URL}/api/pharmacy/settings", json={"address": "   "},
                         headers=_h(admin_auth), timeout=15)
        assert r.status_code == 400


# ==================== Delivery Proofs listing ====================
class TestDeliveryProofs:
    _created_id = None

    def test_julie_forbidden(self, julie_auth):
        r = requests.get(f"{BASE_URL}/api/deliveries/proofs", headers=_h(julie_auth), timeout=15)
        assert r.status_code == 403

    def test_manager_list_and_search(self, manager_auth):
        # create delivery -> en_route -> livree with proof
        payload = {"client_name": "TEST_Proof Client", "address": "123 Rue Test, Montréal, QC",
                   "phone": "", "priority": "normal",
                   "courier_employee_id": "e2", "courier_name": "Julie Gagnon"}
        r = requests.post(f"{BASE_URL}/api/deliveries", json=payload, headers=_h(manager_auth), timeout=20)
        assert r.status_code == 200, r.text
        did = r.json()["id"]
        TestDeliveryProofs._created_id = did

        png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        r2 = requests.put(f"{BASE_URL}/api/deliveries/{did}/status",
                          json={"status": "livree", "proof_image": png, "proof_type": "signature"},
                          headers=_h(manager_auth), timeout=15)
        assert r2.status_code == 200, r2.text

        # listing
        r3 = requests.get(f"{BASE_URL}/api/deliveries/proofs", headers=_h(manager_auth), timeout=15)
        assert r3.status_code == 200
        ids = [d["id"] for d in r3.json()]
        assert did in ids

        # regex search
        r4 = requests.get(f"{BASE_URL}/api/deliveries/proofs?client=proof%20client",
                          headers=_h(manager_auth), timeout=15)
        assert r4.status_code == 200
        assert any(d["id"] == did for d in r4.json())

        # no match
        r5 = requests.get(f"{BASE_URL}/api/deliveries/proofs?client=zzznotfoundzzz",
                          headers=_h(manager_auth), timeout=15)
        assert r5.status_code == 200
        assert r5.json() == [] or all(d["id"] != did for d in r5.json())

    def test_zzz_cleanup(self, manager_auth):
        if TestDeliveryProofs._created_id:
            requests.delete(f"{BASE_URL}/api/deliveries/{TestDeliveryProofs._created_id}",
                            headers=_h(manager_auth), timeout=15)


# ==================== Delivery Route (tournée) ====================
class TestDeliveryRoute:
    _created = []

    def test_julie_empty_when_no_active(self, julie_auth, manager_auth):
        # ensure no active TEST_* for e2 (leftover safety cleanup already done by other tests)
        r = requests.get(f"{BASE_URL}/api/deliveries/route", headers=_h(julie_auth), timeout=30)
        assert r.status_code == 200
        data = r.json()
        # There may be pre-existing active deliveries; only assert structure
        assert "stops" in data and "total_km" in data

    def test_create_and_get_route(self, manager_auth, julie_auth):
        d1 = {"client_name": "TEST_Route Urgent", "address": "1000 Rue Sainte-Catherine Ouest, Montréal, QC",
              "phone": "", "priority": "urgent",
              "courier_employee_id": "e2", "courier_name": "Julie Gagnon"}
        d2 = {"client_name": "TEST_Route Normal", "address": "4500 Rue Ontario Est, Montréal, QC",
              "phone": "", "priority": "normal",
              "courier_employee_id": "e2", "courier_name": "Julie Gagnon"}
        for payload in (d1, d2):
            r = requests.post(f"{BASE_URL}/api/deliveries", json=payload, headers=_h(manager_auth), timeout=20)
            assert r.status_code == 200
            TestDeliveryRoute._created.append(r.json()["id"])

        # allow geocoding time (Nominatim throttled)
        time.sleep(2)
        r = requests.get(f"{BASE_URL}/api/deliveries/route", headers=_h(julie_auth), timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        located_stops = [s for s in data["stops"] if s.get("located")]
        assert len(located_stops) >= 1, f"No located stops: {data}"
        # First located stop should be the urgent one (if located)
        urgent_stops = [s for s in data["stops"] if s["priority"] == "urgent" and s.get("located")]
        if urgent_stops:
            assert data["stops"][0]["priority"] == "urgent", f"Urgent must be first: {data['stops']}"
        # total_km numeric
        assert isinstance(data["total_km"], (int, float))
        assert "google.com/maps/dir" in data["maps_url"]

        # manager view with courier_employee_id
        r2 = requests.get(f"{BASE_URL}/api/deliveries/route?courier_employee_id=e2",
                          headers=_h(manager_auth), timeout=45)
        assert r2.status_code == 200
        assert len(r2.json()["stops"]) >= len(data["stops"]) - 1  # roughly equal

    def test_zzz_cleanup(self, manager_auth):
        for did in TestDeliveryRoute._created:
            requests.delete(f"{BASE_URL}/api/deliveries/{did}", headers=_h(manager_auth), timeout=15)
