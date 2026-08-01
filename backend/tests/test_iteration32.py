"""Iteration 32 backend tests:
- /api/shifts CRUD (admin RW, employee RO)
- /api/schedule/settings priority_sets validation
- /api/reports/budget-monthly/run
"""
import os
import uuid
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN_EMAIL = "admin@luminahr.ca"
ADMIN_PWD = "Nlpx!tTE3Aw27"
EMP_EMAIL = "julie@luminahr.ca"
EMP_PWD = "O1ka!gfVV6e54"


def bearer(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def emp_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMP_EMAIL, "password": EMP_PWD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ---- Shifts CRUD ----
class TestShifts:
    created_ids = []

    def test_get_shifts_admin(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/shifts", headers=bearer(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert "shifts" in body and isinstance(body["shifts"], list)
        assert body.get("migrated") is True
        # Preserve existing shifts count for later assertion
        TestShifts.baseline_count = len(body["shifts"])
        assert TestShifts.baseline_count >= 1, "Expected server to contain migrated shifts"

    def test_post_shift_upsert_idempotent(self, s, admin_token):
        sid = f"TEST_shift_{uuid.uuid4().hex[:8]}"
        payload = {
            "id": sid,
            "employee_id": "e2",
            "date": "2026-07-15",
            "start": "10:00",
            "end": "14:00",
            "department": "Laboratoire",
        }
        r1 = s.post(f"{BASE_URL}/api/shifts", json=payload, headers=bearer(admin_token))
        assert r1.status_code in (200, 201), r1.text
        TestShifts.created_ids.append(sid)
        # Idempotence: re-POST same id must not duplicate
        r2 = s.post(f"{BASE_URL}/api/shifts", json=payload, headers=bearer(admin_token))
        assert r2.status_code in (200, 201), r2.text

        r3 = s.get(f"{BASE_URL}/api/shifts", headers=bearer(admin_token))
        assert r3.status_code == 200
        shifts = r3.json()["shifts"]
        matching = [x for x in shifts if x.get("id") == sid]
        assert len(matching) == 1, f"Expected 1 shift with id={sid}, got {len(matching)}"
        assert matching[0]["employee_id"] == "e2"
        assert matching[0]["department"] == "Laboratoire"

    def test_put_shift_partial_patch(self, s, admin_token):
        assert TestShifts.created_ids, "Prerequisite create test failed"
        sid = TestShifts.created_ids[0]
        # Patch end + department
        r = s.put(f"{BASE_URL}/api/shifts/{sid}",
                  json={"end": "15:00", "department": "Laboratoire"},
                  headers=bearer(admin_token))
        assert r.status_code == 200, r.text

        # Verify persistence
        rg = s.get(f"{BASE_URL}/api/shifts", headers=bearer(admin_token))
        shift = next(x for x in rg.json()["shifts"] if x["id"] == sid)
        assert shift["end"] == "15:00"
        assert shift["department"] == "Laboratoire"

    def test_put_shift_invalid_department_falls_back(self, s, admin_token):
        sid = TestShifts.created_ids[0]
        r = s.put(f"{BASE_URL}/api/shifts/{sid}",
                  json={"department": "InvalidDept_XYZ"},
                  headers=bearer(admin_token))
        # Expected: 200 with fallback to Général (per review request)
        assert r.status_code == 200, r.text
        rg = s.get(f"{BASE_URL}/api/shifts", headers=bearer(admin_token))
        shift = next(x for x in rg.json()["shifts"] if x["id"] == sid)
        assert shift["department"] == "Général", f"Expected fallback to Général, got {shift['department']}"

    def test_put_shift_invalid_hours_400(self, s, admin_token):
        sid = TestShifts.created_ids[0]
        # Invalid HH:MM format should be 400
        r = s.put(f"{BASE_URL}/api/shifts/{sid}",
                  json={"start": "abc", "end": "xyz"},
                  headers=bearer(admin_token))
        assert r.status_code == 400, f"Expected 400 for invalid HH:MM, got {r.status_code}: {r.text}"

    def test_delete_nonexistent_404(self, s, admin_token):
        r = s.delete(f"{BASE_URL}/api/shifts/nonexistent_id_xyz_{uuid.uuid4().hex}",
                     headers=bearer(admin_token))
        assert r.status_code == 404

    def test_employee_read_ok(self, s, emp_token):
        r = s.get(f"{BASE_URL}/api/shifts", headers=bearer(emp_token))
        assert r.status_code == 200
        assert "shifts" in r.json()

    def test_employee_write_forbidden(self, s, emp_token):
        payload = {"id": f"emp_write_{uuid.uuid4().hex[:6]}", "employee_id": "e2",
                   "date": "2026-07-16", "start": "09:00",
                   "end": "12:00", "department": "Laboratoire"}
        r_post = s.post(f"{BASE_URL}/api/shifts", json=payload, headers=bearer(emp_token))
        assert r_post.status_code == 403, r_post.text

        sid = TestShifts.created_ids[0]
        r_put = s.put(f"{BASE_URL}/api/shifts/{sid}",
                      json={"end": "16:00"}, headers=bearer(emp_token))
        assert r_put.status_code == 403

        r_del = s.delete(f"{BASE_URL}/api/shifts/{sid}", headers=bearer(emp_token))
        assert r_del.status_code == 403


# ---- Priority Sets in schedule/settings ----
class TestPrioritySets:
    def test_get_settings(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/schedule/settings", headers=bearer(admin_token))
        assert r.status_code == 200

    def test_put_priority_sets_without_name_400(self, s, admin_token):
        r = s.put(f"{BASE_URL}/api/schedule/settings",
                  json={"priority_sets": [{"priorities": {"dept_order": ["Laboratoire"]}}]},
                  headers=bearer(admin_token))
        assert r.status_code == 400, f"Expected 400 for priority_set without name, got {r.status_code}: {r.text}"

    def test_put_priority_sets_valid_ok(self, s, admin_token):
        name = f"TEST_prioset_{uuid.uuid4().hex[:6]}"
        r = s.put(f"{BASE_URL}/api/schedule/settings",
                  json={"priority_sets": [{
                      "name": name,
                      "priorities": {"dept_order": ["Laboratoire"], "employee_type": "full_time"}
                  }]},
                  headers=bearer(admin_token))
        assert r.status_code == 200, r.text
        # Verify persisted
        rg = s.get(f"{BASE_URL}/api/schedule/settings", headers=bearer(admin_token)).json()
        sets = rg.get("priority_sets", [])
        assert any(x.get("name") == name for x in sets), f"prio set {name} not persisted: {sets}"

        # Cleanup: remove the test set
        remaining = [x for x in sets if x.get("name") != name]
        s.put(f"{BASE_URL}/api/schedule/settings",
              json={"priority_sets": remaining}, headers=bearer(admin_token))


# ---- Budget Monthly Report ----
class TestBudgetMonthlyReport:
    def test_run_valid_month(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/reports/budget-monthly/run?month=2026-08",
                   headers=bearer(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "sent" in body
        assert isinstance(body["sent"], int)

    def test_run_invalid_month_400(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/reports/budget-monthly/run?month=13-99",
                   headers=bearer(admin_token))
        assert r.status_code == 400, f"Expected 400 for invalid month, got {r.status_code}"

    def test_run_forbidden_employee(self, s, emp_token):
        r = s.post(f"{BASE_URL}/api/reports/budget-monthly/run?month=2026-08",
                   headers=bearer(emp_token))
        assert r.status_code == 403


# ---- Cleanup test shifts ----
@pytest.fixture(scope="module", autouse=True)
def cleanup_shifts(s):
    yield
    try:
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
        if r.status_code == 200:
            tok = r.json()["access_token"]
            for sid in TestShifts.created_ids:
                s.delete(f"{BASE_URL}/api/shifts/{sid}", headers=bearer(tok))
    except Exception as e:
        print(f"Cleanup error: {e}")
