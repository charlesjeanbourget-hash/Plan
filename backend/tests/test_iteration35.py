"""Backend tests iteration 35 — Leave module (congés) + bulk employee import context.

Covers:
- POST /api/leave/requests (validations + roles)
- GET /api/leave/requests (admin sees all + history ; employee only own, no history)
- POST /api/leave/requests/{id}/decide (admin/manager only, idempotent)
- DELETE /api/leave/requests/{id} (owner or admin, only En attente)
- GET /api/leave/absences (Loi 25 : type='Absence' for non-admin viewer)
- PUT /api/leave/allocations/{employee_id} + GET /api/leave/balances
- POST /api/leave/bulk-import (idempotent)
"""
import os
from datetime import date, timedelta

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = {"email": "admin@luminahr.ca", "password": "Nlpx!tTE3Aw27"}
JULIE = {"email": "julie@luminahr.ca", "password": "O1ka!gfVV6e54"}
JULIE_EMP_ID = "e2"


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"No access_token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def julie_token():
    return _login(JULIE)


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- Auth sanity ---
def test_admin_and_julie_login(admin_token, julie_token):
    assert admin_token and julie_token


# --- Allocations & balances ---
def test_admin_sets_allocations_for_julie(admin_token):
    r = requests.put(
        f"{BASE_URL}/api/leave/allocations/{JULIE_EMP_ID}",
        headers=H(admin_token),
        json={"employee_name": "Julie Tremblay",
              "allocations": {"Vacances": 10, "Maladie": 5, "Mobile": 2}},
        timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["employee_id"] == JULIE_EMP_ID
    assert data["allocations"]["Vacances"] == 10.0
    assert data["allocations"]["Maladie"] == 5.0
    assert data["allocations"]["Mobile"] == 2.0


def test_allocation_invalid_value_400(admin_token):
    r = requests.put(
        f"{BASE_URL}/api/leave/allocations/{JULIE_EMP_ID}",
        headers=H(admin_token),
        json={"employee_name": "Julie", "allocations": {"Vacances": 999}},
        timeout=30)
    assert r.status_code == 400


def test_employee_cannot_set_allocations(julie_token):
    r = requests.put(
        f"{BASE_URL}/api/leave/allocations/{JULIE_EMP_ID}",
        headers=H(julie_token),
        json={"employee_name": "x", "allocations": {"Vacances": 1}},
        timeout=30)
    assert r.status_code == 403


def test_balances_admin_sees_all(admin_token):
    r = requests.get(f"{BASE_URL}/api/leave/balances", headers=H(admin_token), timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    julie = next((b for b in data if b["employee_id"] == JULIE_EMP_ID), None)
    assert julie is not None
    assert julie["allocations"]["Vacances"] == 10.0


def test_balances_employee_only_own(julie_token):
    r = requests.get(f"{BASE_URL}/api/leave/balances", headers=H(julie_token), timeout=30)
    assert r.status_code == 200
    data = r.json()
    for b in data:
        assert b["employee_id"] == JULIE_EMP_ID


# --- POST /leave/requests validations ---
def test_create_leave_invalid_type_400(julie_token):
    r = requests.post(
        f"{BASE_URL}/api/leave/requests", headers=H(julie_token),
        json={"type": "FooBar", "start_date": "2026-09-01", "end_date": "2026-09-02"}, timeout=30)
    assert r.status_code == 400


def test_create_leave_invalid_dates_400(julie_token):
    r = requests.post(
        f"{BASE_URL}/api/leave/requests", headers=H(julie_token),
        json={"type": "Vacances", "start_date": "2026-09-05", "end_date": "2026-09-01"}, timeout=30)
    assert r.status_code == 400


def test_create_leave_bad_date_format_400(julie_token):
    r = requests.post(
        f"{BASE_URL}/api/leave/requests", headers=H(julie_token),
        json={"type": "Vacances", "start_date": "not-a-date", "end_date": "2026-09-02"}, timeout=30)
    assert r.status_code == 400


# --- End-to-end : julie creates -> admin lists -> approve -> balance updates ---
@pytest.fixture(scope="module")
def julie_request_id(julie_token):
    # 2-day Vacances request in the future
    start = (date.today() + timedelta(days=30)).isoformat()
    end = (date.today() + timedelta(days=31)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/leave/requests", headers=H(julie_token),
        json={"type": "Vacances", "start_date": start, "end_date": end,
              "employee_name": "Julie Tremblay", "reason": "Test T35"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "En attente"
    assert data["days"] == 2.0
    assert data["type"] == "Vacances"
    assert "history" not in data  # own view hides history
    assert data["reason"] == "Test T35"
    return data["id"]


def test_julie_lists_own_only_no_history(julie_token, julie_request_id):
    r = requests.get(f"{BASE_URL}/api/leave/requests", headers=H(julie_token), timeout=30)
    assert r.status_code == 200
    docs = r.json()
    assert len(docs) >= 1
    for d in docs:
        assert d["employee_id"] == JULIE_EMP_ID
        assert "history" not in d  # Loi 25 : no history for employee
        assert "reason" in d  # own request keeps its own reason


def test_admin_lists_all_with_history(admin_token, julie_request_id):
    r = requests.get(f"{BASE_URL}/api/leave/requests", headers=H(admin_token), timeout=30)
    assert r.status_code == 200
    docs = r.json()
    match = next((d for d in docs if d["id"] == julie_request_id), None)
    assert match is not None
    assert "history" in match
    assert any(h["action"] == "soumission" for h in match["history"])
    assert match["reason"] == "Test T35"  # admin sees the reason


def test_employee_cannot_decide(julie_token, julie_request_id):
    r = requests.post(
        f"{BASE_URL}/api/leave/requests/{julie_request_id}/decide",
        headers=H(julie_token), json={"action": "approve", "note": ""}, timeout=30)
    assert r.status_code == 403


def test_admin_approves_and_balance_deducted(admin_token, julie_token, julie_request_id):
    r = requests.post(
        f"{BASE_URL}/api/leave/requests/{julie_request_id}/decide",
        headers=H(admin_token), json={"action": "approve", "note": "OK T35"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "Approuvée"
    assert data["remaining"] == 8.0  # 10 - 2

    # Verify via balances (julie perspective)
    r = requests.get(f"{BASE_URL}/api/leave/balances", headers=H(julie_token), timeout=30)
    assert r.status_code == 200
    bal = next(b for b in r.json() if b["employee_id"] == JULIE_EMP_ID)
    assert bal["used"]["Vacances"] == 2.0
    assert bal["remaining"]["Vacances"] == 8.0


def test_decide_already_processed_400(admin_token, julie_request_id):
    r = requests.post(
        f"{BASE_URL}/api/leave/requests/{julie_request_id}/decide",
        headers=H(admin_token), json={"action": "approve"}, timeout=30)
    assert r.status_code == 400


def test_delete_approved_leave_400(admin_token, julie_request_id):
    r = requests.delete(f"{BASE_URL}/api/leave/requests/{julie_request_id}",
                        headers=H(admin_token), timeout=30)
    assert r.status_code == 400  # only En attente can be cancelled


# --- Loi 25 : /leave/absences ---
def test_absences_julie_sees_type_absence_only(julie_token, julie_request_id):
    # Julie's own approved request will show real type; but ensure no OTHER employee's real type leaks.
    # We create a second approved request for a different employee_id via admin bulk-import.
    r = requests.get(f"{BASE_URL}/api/leave/absences", headers=H(julie_token), timeout=30)
    assert r.status_code == 200
    data = r.json()
    items = data["items"]
    for it in items:
        if it["employee_id"] != JULIE_EMP_ID:
            assert it["type"] == "Absence", f"Loi 25 leak: {it}"


def test_absences_admin_sees_real_type(admin_token, julie_request_id):
    r = requests.get(f"{BASE_URL}/api/leave/absences", headers=H(admin_token), timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    match = next((i for i in items if i["id"] == julie_request_id), None)
    assert match is not None
    assert match["type"] == "Vacances"


def test_julie_leave_requests_never_include_others(julie_token, admin_token):
    # Create a request for e1 via admin
    start = (date.today() + timedelta(days=60)).isoformat()
    end = (date.today() + timedelta(days=60)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/leave/requests", headers=H(admin_token),
        json={"employee_id": "e1", "employee_name": "Test Other",
              "type": "Maladie", "start_date": start, "end_date": end,
              "reason": "PRIVE_T35"}, timeout=30)
    assert r.status_code == 200
    other_id = r.json()["id"]
    # Julie should not see it
    r2 = requests.get(f"{BASE_URL}/api/leave/requests", headers=H(julie_token), timeout=30)
    ids = [d["id"] for d in r2.json()]
    assert other_id not in ids


# --- Cancel own pending ---
def test_julie_cancels_own_pending(julie_token):
    start = (date.today() + timedelta(days=90)).isoformat()
    end = (date.today() + timedelta(days=91)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/leave/requests", headers=H(julie_token),
        json={"type": "Mobile", "start_date": start, "end_date": end}, timeout=30)
    assert r.status_code == 200
    rid = r.json()["id"]
    r2 = requests.delete(f"{BASE_URL}/api/leave/requests/{rid}", headers=H(julie_token), timeout=30)
    assert r2.status_code == 200
    assert r2.json()["status"] == "Annulée"


# --- Admin creates for another employee ---
def test_admin_creates_for_specific_employee(admin_token):
    start = (date.today() + timedelta(days=45)).isoformat()
    end = (date.today() + timedelta(days=45)).isoformat()
    r = requests.post(
        f"{BASE_URL}/api/leave/requests", headers=H(admin_token),
        json={"employee_id": "e3", "employee_name": "Karim",
              "type": "Personnel", "start_date": start, "end_date": end,
              "reason": "T35 admin-for-emp"}, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data["employee_id"] == "e3"


# --- Bulk import idempotency ---
def test_bulk_import_is_idempotent(admin_token):
    payload = {"requests": [{
        "id": "t35-bulk-1", "employee_id": "e1", "employee_name": "Bulk 1",
        "type": "Vacances", "start_date": "2026-10-01", "end_date": "2026-10-02",
        "status": "Approuvée", "reason": "seed"}]}
    r1 = requests.post(f"{BASE_URL}/api/leave/bulk-import", headers=H(admin_token), json=payload, timeout=30)
    assert r1.status_code == 200
    r2 = requests.post(f"{BASE_URL}/api/leave/bulk-import", headers=H(admin_token), json=payload, timeout=30)
    assert r2.status_code == 200
    # Verify not duplicated
    r3 = requests.get(f"{BASE_URL}/api/leave/requests", headers=H(admin_token), timeout=30)
    matches = [d for d in r3.json() if d["id"] == "t35-bulk-1"]
    assert len(matches) == 1


def test_bulk_import_forbidden_for_employee(julie_token):
    r = requests.post(f"{BASE_URL}/api/leave/bulk-import", headers=H(julie_token),
                      json={"requests": []}, timeout=30)
    assert r.status_code == 403


# --- Notifications ---
def test_admin_notification_for_new_leave(admin_token, julie_token):
    start = (date.today() + timedelta(days=120)).isoformat()
    end = start
    r = requests.post(f"{BASE_URL}/api/leave/requests", headers=H(julie_token),
                      json={"type": "Mobile", "start_date": start, "end_date": end,
                            "employee_name": "Julie Tremblay"}, timeout=30)
    assert r.status_code == 200
    # Now admin should have a "Nouvelle demande de congé" notification
    r2 = requests.get(f"{BASE_URL}/api/notifications", headers=H(admin_token), timeout=30)
    assert r2.status_code == 200
    notifs = r2.json()
    if isinstance(notifs, dict):
        notifs = notifs.get("items") or notifs.get("notifications") or []
    assert any("Nouvelle demande de congé" in (n.get("title") or "") for n in notifs), \
        f"No 'Nouvelle demande de congé' notification found in {len(notifs)} notifs"
