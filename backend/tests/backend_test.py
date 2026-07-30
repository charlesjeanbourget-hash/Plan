"""LuminaHR backend tests — iteration 2 (Licences Loi 25, Audit, Rapport)."""
import os
import io
import json
import uuid
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN_HDR = {"X-User-Email": "admin@luminahr.ca", "X-User-Role": "admin", "X-Pharmacy-Id": "ph1"}
SUPER_HDR = {"X-User-Email": "jeffmenard78@hotmail.com", "X-User-Role": "superadmin", "X-Pharmacy-Id": ""}
EMPLOYEE_HDR = {"X-User-Email": "julie@luminahr.ca", "X-User-Role": "employee", "X-Pharmacy-Id": "ph1"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# Root
class TestRoot:
    def test_root(self, s):
        r = s.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("message") == "LuminaHR API"


# Chat SSE
class TestChat:
    def test_chat_stream(self, s):
        sid = f"TEST_{uuid.uuid4()}"
        with s.post(f"{BASE_URL}/api/chat", json={"session_id": sid, "message": "Bonjour"}, stream=True, timeout=60) as r:
            assert r.status_code == 200
            done = False
            got_delta = False
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    done = True
                    break
                try:
                    obj = json.loads(data)
                    if "delta" in obj:
                        got_delta = True
                except json.JSONDecodeError:
                    pass
            assert done
            assert got_delta


# Auth on /api/licenses*
class TestAuth:
    def test_no_headers_forbidden(self, s):
        r = s.get(f"{BASE_URL}/api/licenses")
        assert r.status_code == 403

    def test_employee_forbidden(self, s):
        r = s.get(f"{BASE_URL}/api/licenses", headers=EMPLOYEE_HDR)
        assert r.status_code == 403

    def test_audit_admin_forbidden(self, s):
        r = s.get(f"{BASE_URL}/api/audit-logs", headers=ADMIN_HDR)
        assert r.status_code == 403


# Licence CRUD + Loi 25
class TestLicensesCRUD:
    created = []

    def test_create_license_no_file(self, s):
        data = {
            "employee_id": f"TEST_emp_{uuid.uuid4()}",
            "employee_name": "TEST Marie Curie",
            "position": "Pharmacienne",
            "branch_id": "br1",
            "license_number": f"TEST-{uuid.uuid4().hex[:6]}",
            "expiry_date": "2030-01-01",
        }
        r = s.post(f"{BASE_URL}/api/licenses", data=data, headers=ADMIN_HDR)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] and body["employee_name"] == "TEST Marie Curie"
        assert body["pharmacy_id"] == "ph1"
        assert "_id" not in body and "storage_path" not in body
        TestLicensesCRUD.created.append((body["id"], data["employee_id"]))

        # GET verify persistence
        r2 = s.get(f"{BASE_URL}/api/licenses", headers=ADMIN_HDR)
        assert r2.status_code == 200
        assert any(x["id"] == body["id"] for x in r2.json())

    def test_upload_and_download_certificate(self, s):
        # Minimal valid PDF
        pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
        files = {"file": ("cert.pdf", pdf, "application/pdf")}
        data = {
            "employee_id": f"TEST_emp_{uuid.uuid4()}",
            "employee_name": "TEST Certif User",
            "position": "ATP",
            "branch_id": "br1",
            "license_number": f"TEST-CERT-{uuid.uuid4().hex[:6]}",
            "expiry_date": "2027-06-30",
        }
        r = s.post(f"{BASE_URL}/api/licenses", data=data, files=files, headers=ADMIN_HDR)
        assert r.status_code == 200, r.text
        lic = r.json()
        assert lic["certificate_filename"] == "cert.pdf"
        assert lic["certificate_content_type"] == "application/pdf"
        assert lic["certificate_size"] == len(pdf)
        TestLicensesCRUD.created.append((lic["id"], data["employee_id"]))

        r2 = s.get(f"{BASE_URL}/api/licenses/{lic['id']}/certificate", headers=ADMIN_HDR)
        assert r2.status_code == 200
        assert r2.headers["content-type"].startswith("application/pdf")
        assert r2.content == pdf

    def test_update_license(self, s):
        lic_id = TestLicensesCRUD.created[0][0]
        data = {"license_number": "TEST-UPDATED-123", "expiry_date": "2031-12-31", "branch_id": "br2"}
        r = s.put(f"{BASE_URL}/api/licenses/{lic_id}", data=data, headers=ADMIN_HDR)
        assert r.status_code == 200, r.text
        assert r.json()["license_number"] == "TEST-UPDATED-123"
        assert r.json()["expiry_date"] == "2031-12-31"

        # verify via list
        r2 = s.get(f"{BASE_URL}/api/licenses", headers=ADMIN_HDR)
        found = next(x for x in r2.json() if x["id"] == lic_id)
        assert found["license_number"] == "TEST-UPDATED-123"

    def test_admin_isolation(self, s):
        # Superadmin creates a licence in ph2
        emp_id = f"TEST_ph2_{uuid.uuid4()}"
        data = {
            "employee_id": emp_id,
            "employee_name": "TEST Ph2 User",
            "position": "Pharmacien",
            "branch_id": "br3",
            "license_number": f"TEST-PH2-{uuid.uuid4().hex[:6]}",
            "expiry_date": "2030-05-01",
            "pharmacy_id": "ph2",
        }
        r = s.post(f"{BASE_URL}/api/licenses", data=data, headers=SUPER_HDR)
        assert r.status_code == 200, r.text
        ph2_id = r.json()["id"]
        TestLicensesCRUD.created.append((ph2_id, emp_id))

        # Admin ph1 must NOT see it
        r2 = s.get(f"{BASE_URL}/api/licenses", headers=ADMIN_HDR)
        assert r2.status_code == 200
        assert all(x["id"] != ph2_id for x in r2.json())
        assert all(x["pharmacy_id"] == "ph1" for x in r2.json())

        # Superadmin can filter by pharmacy_id=ph2
        r3 = s.get(f"{BASE_URL}/api/licenses?pharmacy_id=ph2", headers=SUPER_HDR)
        assert r3.status_code == 200
        assert any(x["id"] == ph2_id for x in r3.json())

    def test_droit_a_loubli(self, s):
        # Use last created employee_id
        emp_id = TestLicensesCRUD.created[-1][1]
        # Delete via superadmin since it's ph2
        r = s.delete(f"{BASE_URL}/api/licenses/employee/{emp_id}", headers=SUPER_HDR)
        assert r.status_code == 200
        assert r.json().get("deleted", 0) >= 1

        # Second call → 0
        r2 = s.delete(f"{BASE_URL}/api/licenses/employee/{emp_id}", headers=SUPER_HDR)
        assert r2.status_code == 200
        assert r2.json()["deleted"] == 0


# Report
class TestReport:
    def test_report_60_days(self, s):
        # Create a licence expiring in 30 days
        import datetime as dt
        expiry = (dt.date.today() + dt.timedelta(days=30)).isoformat()
        emp_id = f"TEST_rep_{uuid.uuid4()}"
        data = {
            "employee_id": emp_id,
            "employee_name": "TEST Rapport User",
            "position": "Pharm",
            "branch_id": "br1",
            "license_number": f"TEST-REP-{uuid.uuid4().hex[:6]}",
            "expiry_date": expiry,
        }
        r = s.post(f"{BASE_URL}/api/licenses", data=data, headers=ADMIN_HDR)
        assert r.status_code == 200
        TestLicensesCRUD.created.append((r.json()["id"], emp_id))

        r2 = s.get(f"{BASE_URL}/api/licenses/report", headers=ADMIN_HDR)
        assert r2.status_code == 200
        items = r2.json()["items"]
        found = next((x for x in items if x["employee_id"] == emp_id), None)
        assert found is not None
        assert 29 <= found["days_remaining"] <= 30

    def test_save_report_settings(self, s):
        payload = {"pharmacy_id": "ph1", "pharmacy_name": "TEST Pharma", "admin_email": "test@example.com", "enabled": False}
        r = s.post(f"{BASE_URL}/api/report-settings", json=payload, headers=ADMIN_HDR)
        assert r.status_code == 200
        r2 = s.get(f"{BASE_URL}/api/report-settings", headers=ADMIN_HDR)
        assert r2.status_code == 200
        assert r2.json()["admin_email"] == "test@example.com"

    def test_send_report_missing_resend_key(self, s):
        # Ensure settings exist
        s.post(f"{BASE_URL}/api/report-settings", json={
            "pharmacy_id": "ph1", "pharmacy_name": "TEST", "admin_email": "test@example.com", "enabled": False
        }, headers=ADMIN_HDR)
        r = s.post(f"{BASE_URL}/api/licenses/report/send", json={}, headers=ADMIN_HDR)
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "Resend" in detail or "resend" in detail.lower()


# Audit
class TestAudit:
    def test_audit_logs_superadmin(self, s):
        r = s.get(f"{BASE_URL}/api/audit-logs", headers=SUPER_HDR)
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list)
        actions = {l["action"] for l in logs}
        # We should have seen at least these after previous tests
        assert "CREATION" in actions
        assert "CONSULTATION_LISTE" in actions
        assert "CONSULTATION_CERTIFICAT" in actions
        assert "DROIT_A_L_OUBLI" in actions


# Cleanup
@pytest.fixture(scope="module", autouse=True)
def cleanup(s):
    yield
    for lic_id, emp_id in TestLicensesCRUD.created:
        try:
            s.delete(f"{BASE_URL}/api/licenses/employee/{emp_id}", headers=SUPER_HDR)
        except Exception:
            pass
