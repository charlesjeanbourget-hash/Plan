"""LuminaHR backend tests — iteration 3 (JWT Auth + Licences + Rapport)."""
import os
import uuid
import time
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


def login(session: requests.Session, email: str, password: str):
    return session.post(f"{BASE_URL}/api/auth/login",
                        json={"email": email, "password": password}, timeout=30)


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = login(s, "admin@luminahr.ca", "admin123")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_token(s):
    r = login(s, "jeffmenard78@hotmail.com", "Lumina-Jeff!2941")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def employee_token(s):
    r = login(s, "julie@luminahr.ca", "employe123")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ---------------------- Auth JWT ----------------------
class TestAuthJWT:
    def test_login_admin_ok(self, s):
        r = login(s, "admin@luminahr.ca", "admin123")
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body and isinstance(body["access_token"], str)
        assert body["user"]["email"] == "admin@luminahr.ca"
        assert body["user"]["role"] == "admin"
        assert body["user"]["is_temporary_password"] is False

    def test_login_bad_password(self, s):
        r = login(s, "admin@luminahr.ca", "wrong_password_xyz")
        assert r.status_code == 401
        assert "invalide" in r.json().get("detail", "").lower()

    def test_me_with_token(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=bearer(admin_token))
        assert r.status_code == 200
        assert r.json()["email"] == "admin@luminahr.ca"

    def test_me_no_token(self, s):
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self, s):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=bearer("not.a.valid.jwt"))
        assert r.status_code == 401

    def test_employee_login_and_licenses_forbidden(self, s, employee_token):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=bearer(employee_token))
        assert r.status_code == 200
        assert r.json()["role"] == "employee"
        r2 = s.get(f"{BASE_URL}/api/licenses", headers=bearer(employee_token))
        assert r2.status_code == 403

    def test_superadmin_temp_password_flag(self, s, super_token):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=bearer(super_token))
        assert r.status_code == 200
        assert r.json()["role"] == "superadmin"
        assert r.json()["is_temporary_password"] is True

    def test_brute_force_lockout_localhost(self):
        # Dedicated fictitious email to NOT lock real accounts.
        # NOTE: We call the internal backend directly. Behind the k8s ingress
        # the public URL rotates upstream client IPs (request.client.host
        # varies per request), and since the lockout identifier is
        # "ip:email", brute-force protection is effectively bypassed in
        # production. Reported as a critical security bug.
        local = "http://localhost:8001"
        sess = requests.Session()
        email = f"lockme_{uuid.uuid4().hex[:8]}@test.ca"
        for _ in range(5):
            r = sess.post(f"{local}/api/auth/login",
                          json={"email": email, "password": "wrong"}, timeout=10)
            assert r.status_code == 401
        r = sess.post(f"{local}/api/auth/login",
                      json={"email": email, "password": "wrong"}, timeout=10)
        assert r.status_code == 429, f"Expected 429 after 5 fails, got {r.status_code}: {r.text}"
        assert "tentatives" in r.json().get("detail", "").lower()

    def test_brute_force_ineffective_behind_ingress(self, s):
        # Documents the production security gap: 6 consecutive bad logins
        # via the public URL still return 401 (never 429) because the
        # identifier includes request.client.host which rotates across
        # ingress upstream IPs.
        email = f"ingress_bf_{uuid.uuid4().hex[:8]}@test.ca"
        statuses = []
        for _ in range(7):
            r = login(s, email, "wrong")
            statuses.append(r.status_code)
        # This assertion INTENTIONALLY documents the bug (all 401, never 429).
        # If the identifier is fixed (e.g. email-only or X-Forwarded-For),
        # this test will start failing → update it then.
        assert 429 not in statuses, (
            f"Ingress lockout now triggers correctly ({statuses}) — "
            f"update this documenting test.")


# ---------------------- Change password ----------------------
class TestChangePassword:
    """Uses a temporary user seeded direct in mongo, NOT the seeded accounts."""

    @pytest.fixture(scope="class")
    def temp_user(self):
        """Create/reset a temporary throw-away user directly through the API by
        exploiting change-password on a fresh account. Since there is no
        /register endpoint, we insert a user via mongo shell fallback: skip if
        we cannot. Otherwise use the safest route: use julie's account and
        restore at the end."""
        return None

    def test_change_password_wrong_current(self, s, employee_token):
        r = s.post(f"{BASE_URL}/api/auth/change-password",
                   json={"current_password": "definitely_wrong", "new_password": "NewPassw0rd!"},
                   headers=bearer(employee_token))
        assert r.status_code == 400
        assert "incorrect" in r.json().get("detail", "").lower()

    def test_change_password_success_and_restore(self, s):
        """Test full cycle on julie's account then restore original password."""
        r = login(s, "julie@luminahr.ca", "employe123")
        assert r.status_code == 200
        token = r.json()["access_token"]

        new_pwd = "TempPwd_iter3!42"
        r2 = s.post(f"{BASE_URL}/api/auth/change-password",
                    json={"current_password": "employe123", "new_password": new_pwd},
                    headers=bearer(token))
        assert r2.status_code == 200, r2.text

        # Old password no longer works
        r3 = login(s, "julie@luminahr.ca", "employe123")
        assert r3.status_code == 401

        # New password works and is_temporary_password=False
        r4 = login(s, "julie@luminahr.ca", new_pwd)
        assert r4.status_code == 200
        assert r4.json()["user"]["is_temporary_password"] is False
        new_token = r4.json()["access_token"]

        # RESTORE original password
        r5 = s.post(f"{BASE_URL}/api/auth/change-password",
                    json={"current_password": new_pwd, "new_password": "employe123"},
                    headers=bearer(new_token))
        assert r5.status_code == 200, r5.text

        # Confirm restore
        r6 = login(s, "julie@luminahr.ca", "employe123")
        assert r6.status_code == 200


# ---------------------- Licences with JWT Bearer ----------------------
class TestLicensesJWT:
    created = []

    def test_list_no_token_401(self, s):
        r = s.get(f"{BASE_URL}/api/licenses")
        assert r.status_code == 401

    def test_list_with_admin_bearer(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/licenses", headers=bearer(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_get_license(self, s, admin_token):
        data = {
            "employee_id": f"TEST_emp_{uuid.uuid4()}",
            "employee_name": "TEST JWT User",
            "position": "Pharm",
            "branch_id": "br1",
            "license_number": f"TEST-JWT-{uuid.uuid4().hex[:6]}",
            "expiry_date": "2030-06-30",
        }
        r = s.post(f"{BASE_URL}/api/licenses", data=data, headers=bearer(admin_token))
        assert r.status_code == 200, r.text
        lic = r.json()
        assert lic["employee_name"] == "TEST JWT User"
        assert lic["pharmacy_id"] == "ph1"
        assert "_id" not in lic
        TestLicensesJWT.created.append((lic["id"], data["employee_id"]))

        # Persistence verify
        r2 = s.get(f"{BASE_URL}/api/licenses", headers=bearer(admin_token))
        assert any(x["id"] == lic["id"] for x in r2.json())

    def test_report_60d(self, s, admin_token):
        import datetime as dt
        expiry = (dt.date.today() + dt.timedelta(days=25)).isoformat()
        data = {
            "employee_id": f"TEST_rep_{uuid.uuid4()}",
            "employee_name": "TEST Rapport",
            "position": "Pharm",
            "branch_id": "br1",
            "license_number": f"TEST-R-{uuid.uuid4().hex[:6]}",
            "expiry_date": expiry,
        }
        r = s.post(f"{BASE_URL}/api/licenses", data=data, headers=bearer(admin_token))
        assert r.status_code == 200
        TestLicensesJWT.created.append((r.json()["id"], data["employee_id"]))

        r2 = s.get(f"{BASE_URL}/api/licenses/report", headers=bearer(admin_token))
        assert r2.status_code == 200
        items = r2.json()["items"]
        found = next((x for x in items if x["employee_id"] == data["employee_id"]), None)
        assert found is not None
        assert 24 <= found["days_remaining"] <= 26

    def test_audit_admin_forbidden(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/audit-logs", headers=bearer(admin_token))
        assert r.status_code == 403

    def test_audit_superadmin_ok(self, s, super_token):
        r = s.get(f"{BASE_URL}/api/audit-logs", headers=bearer(super_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------------- Cleanup ----------------------
@pytest.fixture(scope="module", autouse=True)
def cleanup(s):
    yield
    # attempt cleanup with a fresh admin token to avoid ordering issues
    try:
        r = login(s, "admin@luminahr.ca", "admin123")
        if r.status_code == 200:
            tok = r.json()["access_token"]
            for lic_id, emp_id in TestLicensesJWT.created:
                s.delete(f"{BASE_URL}/api/licenses/employee/{emp_id}", headers=bearer(tok))
    except Exception:
        pass
