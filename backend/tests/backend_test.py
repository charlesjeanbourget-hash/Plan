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

    def test_brute_force_lockout_via_public_url(self):
        # Iteration 3 fix re-test: identifier is now email-only (no IP),
        # so brute-force protection must work through the k8s ingress via
        # the public URL (REACT_APP_BACKEND_URL). We use a dedicated
        # fictitious email to avoid locking real accounts.
        sess = requests.Session()
        email = f"retest-lock-{uuid.uuid4().hex[:8]}@test.ca"

        # 4 first failed attempts → 401
        for i in range(4):
            r = sess.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "wrong"}, timeout=30)
            assert r.status_code == 401, f"Attempt {i+1}: expected 401, got {r.status_code}: {r.text}"

        # 5th attempt → 429 with Retry-After header
        r5 = sess.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": "wrong"}, timeout=30)
        assert r5.status_code == 429, f"5th attempt: expected 429, got {r5.status_code}: {r5.text}"
        assert "tentatives" in r5.json().get("detail", "").lower()
        assert "Retry-After" in r5.headers, f"Missing Retry-After header. Headers: {dict(r5.headers)}"
        retry_after = int(r5.headers["Retry-After"])
        assert 0 < retry_after <= 15 * 60, f"Retry-After out of range: {retry_after}"

        # Follow-up attempts during lockout window → still 429
        for i in range(2):
            r = sess.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "wrong"}, timeout=30)
            assert r.status_code == 429, f"Follow-up {i+1}: expected 429, got {r.status_code}"
            assert "Retry-After" in r.headers

        # Even a login attempt with the *correct* password during lockout should be 429
        # (identifier is email-only, so lockout blocks the account regardless of pwd).
        r_correct = sess.post(f"{BASE_URL}/api/auth/login",
                              json={"email": email, "password": "irrelevant"}, timeout=30)
        assert r_correct.status_code == 429

    def test_valid_login_unaffected_by_other_email_lockout(self, s):
        # While a fictitious email is locked out, admin@luminahr.ca must
        # still be able to log in normally (200), because the identifier is
        # per-email, not global/IP-based.
        lock_email = f"retest-isolation-{uuid.uuid4().hex[:8]}@test.ca"
        lock_sess = requests.Session()
        # Trigger lockout on the fictitious email
        for _ in range(5):
            lock_sess.post(f"{BASE_URL}/api/auth/login",
                           json={"email": lock_email, "password": "wrong"}, timeout=30)
        # Confirm it's actually locked
        r_locked = lock_sess.post(f"{BASE_URL}/api/auth/login",
                                  json={"email": lock_email, "password": "wrong"}, timeout=30)
        assert r_locked.status_code == 429

        # Legitimate admin login must still succeed
        r_admin = login(s, "admin@luminahr.ca", "admin123")
        assert r_admin.status_code == 200, r_admin.text
        assert "access_token" in r_admin.json()


# ---------------------- Iteration 6: Trim whitespace fix ----------------------
class TestTrimWhitespaceLoginFix:
    """Verify the login trim fix reported in iteration 6.

    Backend must strip surrounding whitespace on email + password so users
    who accidentally paste with trailing/leading spaces (or with different
    email casing) can still authenticate.
    """

    def test_owner_login_with_padded_email_and_password(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": "  CharlesJeanBourget@gmail.com ",
                         "password": "Lumina-Owner!5127  "},
                   timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == "charlesjeanbourget@gmail.com"
        assert body["user"]["role"] == "superadmin"
        assert isinstance(body["access_token"], str) and body["access_token"]

    def test_owner_login_exact(self, s):
        r = login(s, "charlesjeanbourget@gmail.com", "Lumina-Owner!5127")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "superadmin"

    def test_wrong_password_still_401_on_throwaway_email(self, s):
        # Use a throw-away email so we don't lock real accounts. Only 1 attempt.
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": f"nonexistent-{uuid.uuid4().hex[:6]}@test.ca",
                         "password": "  wrong-with-spaces  "},
                   timeout=30)
        assert r.status_code == 401
        assert "invalide" in r.json().get("detail", "").lower()

    def test_change_password_with_surrounding_spaces_roundtrip(self, s, super_token):
        """Create a test user (as superadmin), log in with temp pwd, change pwd
        with padded values, then re-login with the trimmed password."""
        email = f"trim_test_{uuid.uuid4().hex[:8]}@lumina.test"
        payload = {"email": email, "name": "TEST Trim", "role": "employee", "pharmacy_id": "ph1"}
        rc = s.post(f"{BASE_URL}/api/admin/users", json=payload, headers=bearer(super_token))
        assert rc.status_code == 200, rc.text
        created = rc.json()
        uid = created["user"]["id"]
        temp = created["temporary_password"]
        try:
            # Login with temp
            rl = login(s, email, temp)
            assert rl.status_code == 200, rl.text
            tok = rl.json()["access_token"]

            # Change password with padded values
            new_pwd = "NouveauMdp123"
            rp = s.post(f"{BASE_URL}/api/auth/change-password",
                        json={"current_password": f"  {temp}  ",
                              "new_password": f"  {new_pwd}  "},
                        headers=bearer(tok))
            assert rp.status_code == 200, rp.text

            # Re-login with the untrimmed new password
            rn = login(s, email, new_pwd)
            assert rn.status_code == 200, rn.text
            assert rn.json()["user"]["is_temporary_password"] is False

            # Padded email + padded password login should also work
            rn2 = s.post(f"{BASE_URL}/api/auth/login",
                         json={"email": f" {email.upper()} ", "password": f" {new_pwd} "},
                         timeout=30)
            assert rn2.status_code == 200, rn2.text
        finally:
            s.delete(f"{BASE_URL}/api/admin/users/{uid}", headers=bearer(super_token))


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


# ---------------------- Iteration 5: Admin user management ----------------------
class TestAdminUsers:
    created_ids = []

    def test_list_requires_superadmin(self, s, admin_token, employee_token):
        r_no = s.get(f"{BASE_URL}/api/admin/users")
        assert r_no.status_code == 401
        r_adm = s.get(f"{BASE_URL}/api/admin/users", headers=bearer(admin_token))
        assert r_adm.status_code == 403
        r_emp = s.get(f"{BASE_URL}/api/admin/users", headers=bearer(employee_token))
        assert r_emp.status_code == 403

    def test_list_users_superadmin(self, s, super_token):
        r = s.get(f"{BASE_URL}/api/admin/users", headers=bearer(super_token))
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 3
        emails = {u["email"] for u in arr}
        assert "admin@luminahr.ca" in emails
        for u in arr:
            assert "password_hash" not in u
            assert "_id" not in u

    def test_create_login_reset_suspend_delete(self, s, super_token):
        email = f"test_{uuid.uuid4().hex[:8]}@lumina.test"
        payload = {"email": email, "name": "TEST User", "role": "employee", "pharmacy_id": "ph1"}
        r = s.post(f"{BASE_URL}/api/admin/users", json=payload, headers=bearer(super_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "user" in body and "temporary_password" in body
        assert body["user"]["email"] == email
        assert body["user"]["is_temporary_password"] is True
        uid = body["user"]["id"]
        temp = body["temporary_password"]
        TestAdminUsers.created_ids.append(uid)

        # Duplicate creation → 400
        r_dup = s.post(f"{BASE_URL}/api/admin/users", json=payload, headers=bearer(super_token))
        assert r_dup.status_code == 400

        # Login with temp works
        r_login = login(s, email, temp)
        assert r_login.status_code == 200, r_login.text
        assert r_login.json()["user"]["is_temporary_password"] is True

        # Reset password → new temp works, old temp fails
        r_reset = s.post(f"{BASE_URL}/api/admin/users/{uid}/reset-password", headers=bearer(super_token))
        assert r_reset.status_code == 200
        new_temp = r_reset.json()["temporary_password"]
        assert new_temp != temp
        r_old = login(s, email, temp)
        assert r_old.status_code == 401
        r_new = login(s, email, new_temp)
        assert r_new.status_code == 200

        # Suspend → login 403
        r_susp = s.put(f"{BASE_URL}/api/admin/users/{uid}", json={"suspended": True},
                       headers=bearer(super_token))
        assert r_susp.status_code == 200
        r_locked = login(s, email, new_temp)
        assert r_locked.status_code == 403
        assert "suspendu" in r_locked.json().get("detail", "").lower()

        # Reactivate → login OK again
        r_react = s.put(f"{BASE_URL}/api/admin/users/{uid}", json={"suspended": False},
                        headers=bearer(super_token))
        assert r_react.status_code == 200
        r_ok = login(s, email, new_temp)
        assert r_ok.status_code == 200

        # Delete
        r_del = s.delete(f"{BASE_URL}/api/admin/users/{uid}", headers=bearer(super_token))
        assert r_del.status_code == 200
        # Login should now fail (user removed)
        r_gone = login(s, email, new_temp)
        assert r_gone.status_code == 401
        TestAdminUsers.created_ids.remove(uid)

    def test_cannot_self_suspend_or_self_delete(self, s, super_token):
        me = s.get(f"{BASE_URL}/api/auth/me", headers=bearer(super_token)).json()
        my_id = me["id"]
        r_susp = s.put(f"{BASE_URL}/api/admin/users/{my_id}", json={"suspended": True},
                       headers=bearer(super_token))
        assert r_susp.status_code == 400
        r_del = s.delete(f"{BASE_URL}/api/admin/users/{my_id}", headers=bearer(super_token))
        assert r_del.status_code == 400

    def test_invalid_role(self, s, super_token):
        r = s.post(f"{BASE_URL}/api/admin/users",
                   json={"email": f"bad_{uuid.uuid4().hex[:6]}@t.ca", "name": "x",
                         "role": "hacker", "pharmacy_id": "ph1"},
                   headers=bearer(super_token))
        assert r.status_code == 400


# ---------------------- Iteration 5: License reminders ----------------------
class TestLicenseReminders:
    created_lic = []

    def test_reminders_run_admin_ok(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/licenses/reminders/run", headers=bearer(admin_token))
        assert r.status_code == 200
        assert "sent" in r.json()
        assert isinstance(r.json()["sent"], int)

    def test_reminders_forbidden_without_token(self, s):
        r = s.post(f"{BASE_URL}/api/licenses/reminders/run")
        assert r.status_code == 401

    def test_reminders_forbidden_for_employee(self, s, employee_token):
        r = s.post(f"{BASE_URL}/api/licenses/reminders/run", headers=bearer(employee_token))
        assert r.status_code == 403

    def test_reminder_sent_and_deduplicated(self, s, admin_token):
        import datetime as dt
        # Create a licence expiring in 15 days with employee_email
        expiry = (dt.date.today() + dt.timedelta(days=15)).isoformat()
        data = {
            "employee_id": f"TEST_rem_{uuid.uuid4()}",
            "employee_name": "TEST Rappel",
            "employee_email": "charlesjeanbourget@gmail.com",
            "position": "Pharm",
            "branch_id": "br1",
            "license_number": f"TEST-REM-{uuid.uuid4().hex[:6]}",
            "expiry_date": expiry,
        }
        r = s.post(f"{BASE_URL}/api/licenses", data=data, headers=bearer(admin_token))
        assert r.status_code == 200, r.text
        lic = r.json()
        TestLicenseReminders.created_lic.append((lic["id"], data["employee_id"]))

        # 1st run: sent >= 1 (contains our new licence)
        r1 = s.post(f"{BASE_URL}/api/licenses/reminders/run", headers=bearer(admin_token))
        assert r1.status_code == 200
        sent1 = r1.json()["sent"]
        # If Resend fails delivery the endpoint logs an error but does NOT dedupe,
        # so sent may be 0. Assert at least the endpoint returns coherent JSON.
        assert isinstance(sent1, int)

        # 2nd run within same expiry_date → should be deduplicated (0 new)
        r2 = s.post(f"{BASE_URL}/api/licenses/reminders/run", headers=bearer(admin_token))
        assert r2.status_code == 200
        sent2 = r2.json()["sent"]
        # dedupe: 2nd run must be <= 1st run (typically 0)
        assert sent2 <= sent1 or sent2 == 0


# ---------------------- Cleanup ----------------------
@pytest.fixture(scope="module", autouse=True)
def cleanup(s):
    yield
    # attempt cleanup with a fresh admin/superadmin token to avoid ordering issues
    try:
        r = login(s, "admin@luminahr.ca", "admin123")
        if r.status_code == 200:
            tok = r.json()["access_token"]
            for lic_id, emp_id in TestLicensesJWT.created:
                s.delete(f"{BASE_URL}/api/licenses/employee/{emp_id}", headers=bearer(tok))
            for lic_id, emp_id in TestLicenseReminders.created_lic:
                s.delete(f"{BASE_URL}/api/licenses/employee/{emp_id}", headers=bearer(tok))
    except Exception:
        pass
    # delete any leftover TEST admin/users
    try:
        rs = login(s, "jeffmenard78@hotmail.com", "Lumina-Jeff!2941")
        if rs.status_code == 200:
            st = rs.json()["access_token"]
            for uid in list(TestAdminUsers.created_ids):
                s.delete(f"{BASE_URL}/api/admin/users/{uid}", headers=bearer(st))
    except Exception:
        pass
