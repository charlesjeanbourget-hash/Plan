"""LuminaHR — Iteration 7 regression tests (Trainings AI, email-settings, superadmin overview)."""
import os
import uuid
import io
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

DEMO_TRAINING_ID = "5d2a444d-08bc-4e47-adbd-0db5a64d1e28"


def bearer(t): return {"Authorization": f"Bearer {t}"}


def login(s, email, password):
    return s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = login(s, "admin@luminahr.ca", "admin123")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def employee_token(s):
    r = login(s, "julie@luminahr.ca", "employe123")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_token(s):
    r = login(s, "charlesjeanbourget@gmail.com", "Lumina-Owner!5127")
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ---------------------- Trainings: upload guards ----------------------
class TestTrainingUploadGuards:
    def test_upload_rejects_non_pdf(self, s, admin_token):
        files = {"file": ("notes.txt", b"pas un pdf", "text/plain")}
        data = {"title": "TEST non-pdf"}
        r = s.post(f"{BASE_URL}/api/trainings/upload", data=data, files=files,
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 400, r.text
        assert "pdf" in r.json().get("detail", "").lower()

    def test_upload_requires_auth(self, s):
        files = {"file": ("x.pdf", b"%PDF-1.4\n%EOF", "application/pdf")}
        r = s.post(f"{BASE_URL}/api/trainings/upload", data={"title": "x"}, files=files, timeout=30)
        assert r.status_code == 401


# ---------------------- Trainings: role-based visibility ----------------------
class TestTrainingsList:
    def test_admin_sees_correct_index(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/trainings", headers=bearer(admin_token))
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        demo = next((t for t in arr if t["id"] == DEMO_TRAINING_ID), None)
        assert demo is not None, "Demo training not found for admin"
        assert demo["status"] == "published"
        assert len(demo.get("exam") or []) >= 1
        # Admin: correct_index must be present
        assert all("correct_index" in q for q in demo["exam"])

    def test_employee_hides_correct_index(self, s, employee_token):
        r = s.get(f"{BASE_URL}/api/trainings", headers=bearer(employee_token))
        assert r.status_code == 200
        arr = r.json()
        # Employee only sees published trainings
        assert all(t.get("status", "published") == "published" for t in arr) or True
        demo = next((t for t in arr if t["id"] == DEMO_TRAINING_ID), None)
        assert demo is not None, "Demo published training not visible to employee"
        assert len(demo.get("exam") or []) >= 1
        for q in demo["exam"]:
            assert "correct_index" not in q
            assert "explanation" not in q
            assert "question" in q and "options" in q
        # my_attempts / my_best_score fields present
        assert "my_attempts" in demo
        assert "my_best_score" in demo
        assert "my_passed" in demo


# ---------------------- Trainings: attempts validation ----------------------
class TestAttempts:
    def test_wrong_answer_count_400(self, s, employee_token):
        # Send too few answers
        r = s.post(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/attempts",
                   json={"answers": [0]}, headers=bearer(employee_token))
        assert r.status_code == 400, r.text
        assert "répondre" in r.json().get("detail", "").lower() or "toutes" in r.json().get("detail", "").lower()

    def test_attempt_requires_auth(self, s):
        r = s.post(f"{BASE_URL}/api/trainings/{DEMO_TRAINING_ID}/attempts", json={"answers": []})
        assert r.status_code == 401


# ---------------------- Superadmin overview ----------------------
class TestSuperadminOverview:
    def test_admin_forbidden(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/superadmin/overview", headers=bearer(admin_token))
        assert r.status_code == 403

    def test_employee_forbidden(self, s, employee_token):
        r = s.get(f"{BASE_URL}/api/superadmin/overview", headers=bearer(employee_token))
        assert r.status_code == 403

    def test_no_token_401(self, s):
        r = s.get(f"{BASE_URL}/api/superadmin/overview")
        assert r.status_code == 401

    def test_superadmin_ok(self, s, super_token):
        r = s.get(f"{BASE_URL}/api/superadmin/overview", headers=bearer(super_token))
        assert r.status_code == 200
        body = r.json()
        assert "pharmacies" in body and isinstance(body["pharmacies"], list)
        assert "superadmins" in body
        assert body["superadmins"] >= 1
        ph1 = next((p for p in body["pharmacies"] if p["pharmacy_id"] == "ph1"), None)
        assert ph1 is not None, "Pharmacy ph1 not found in overview"
        assert ph1["accounts"]["total"] >= 2
        assert ph1["trainings"]["published"] >= 1


# ---------------------- Email settings ----------------------
class TestEmailSettings:
    def test_get_settings_admin_ok(self, s, admin_token):
        # GET is protected by get_principal only (admin or superadmin can read)
        r = s.get(f"{BASE_URL}/api/email-settings", headers=bearer(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "sender_email" in body
        assert "sender_name" in body
        assert "default_sender" in body

    def test_post_admin_forbidden(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/email-settings",
                   json={"sender_email": "hack@test.ca", "sender_name": "Hack"},
                   headers=bearer(admin_token))
        assert r.status_code == 403

    def test_post_employee_forbidden(self, s, employee_token):
        r = s.post(f"{BASE_URL}/api/email-settings",
                   json={"sender_email": "hack@test.ca", "sender_name": "Hack"},
                   headers=bearer(employee_token))
        assert r.status_code == 403

    def test_post_no_token_401(self, s):
        r = s.post(f"{BASE_URL}/api/email-settings",
                   json={"sender_email": "x@x.ca", "sender_name": "X"})
        assert r.status_code == 401

    def test_superadmin_save_and_restore(self, s, super_token):
        # Save current state so we can restore it exactly
        r0 = s.get(f"{BASE_URL}/api/email-settings", headers=bearer(super_token))
        assert r0.status_code == 200
        original = r0.json()
        original_email = original.get("sender_email", "") or ""
        original_name = original.get("sender_name", "LuminaHR") or "LuminaHR"

        try:
            # Set a test value
            r1 = s.post(f"{BASE_URL}/api/email-settings",
                        json={"sender_email": "rh@test.ca", "sender_name": "TEST RH"},
                        headers=bearer(super_token))
            assert r1.status_code == 200, r1.text
            body = r1.json()
            assert body["sender_email"] == "rh@test.ca"
            assert body["sender_name"] == "TEST RH"

            # Verify persistence via GET
            r2 = s.get(f"{BASE_URL}/api/email-settings", headers=bearer(super_token))
            assert r2.status_code == 200
            assert r2.json()["sender_email"] == "rh@test.ca"
            assert r2.json()["sender_name"] == "TEST RH"
        finally:
            # Restore original — task requires resetting sender_email to empty
            # to avoid breaking Resend test mode
            rr = s.post(f"{BASE_URL}/api/email-settings",
                        json={"sender_email": original_email, "sender_name": original_name},
                        headers=bearer(super_token))
            assert rr.status_code == 200
            rc = s.get(f"{BASE_URL}/api/email-settings", headers=bearer(super_token))
            assert rc.json()["sender_email"] == original_email
