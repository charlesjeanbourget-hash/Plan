"""Iteration 17 backend tests: manager role, deliveries, global partners, honor-roll, team goal."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = ("admin@luminahr.ca", "admin123")
MANAGER = ("gestion@luminahr.ca", "gestion123")
JULIE = ("julie@luminahr.ca", "employe123")
SUPERADMIN = ("charlesjeanbourget@gmail.com", "Lumina-Owner!5127")


def _login(email, pwd):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:200]}"
    return r.json()


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "admin": _login(*ADMIN)["access_token"],
        "manager": _login(*MANAGER),  # keep full payload
        "julie": _login(*JULIE)["access_token"],
        "super": _login(*SUPERADMIN)["access_token"],
    }


# ---------- Manager role ----------
class TestManagerRole:
    def test_manager_login_role(self, tokens):
        payload = tokens["manager"]
        assert payload["user"]["role"] == "manager"

    def test_manager_licenses_report(self, tokens):
        r = requests.get(f"{BASE_URL}/api/licenses/report", headers=_h(tokens["manager"]["access_token"]))
        assert r.status_code == 200

    def test_manager_can_create_task(self, tokens):
        r = requests.post(
            f"{BASE_URL}/api/tasks",
            headers=_h(tokens["manager"]["access_token"]),
            json={"title": "TEST_manager_task_it17", "date": "2026-08-15", "shift": "Jour", "assignee_employee_id": "e2", "assignee_name": "Julie Lavoie"},
        )
        assert r.status_code in (200, 201), r.text[:200]
        tid = r.json().get("id")
        assert tid
        # cleanup
        requests.delete(f"{BASE_URL}/api/tasks/{tid}", headers=_h(tokens["manager"]["access_token"]))

    def test_manager_tasks_stats(self, tokens):
        r = requests.get(f"{BASE_URL}/api/tasks/stats", headers=_h(tokens["manager"]["access_token"]))
        assert r.status_code == 200
        data = r.json()
        assert "by_employee" in data
        assert isinstance(data["by_employee"], list)
        # manager should see same pharmacy-wide view as admin
        admin_r = requests.get(f"{BASE_URL}/api/tasks/stats", headers=_h(tokens["admin"]))
        assert len(data["by_employee"]) == len(admin_r.json()["by_employee"])


# ---------- Deliveries ----------
class TestDeliveries:
    created_id = None

    def test_manager_creates_delivery(self, tokens):
        r = requests.post(
            f"{BASE_URL}/api/deliveries",
            headers=_h(tokens["manager"]["access_token"]),
            json={
                "client_name": "TEST_Client_it17",
                "address": "123 rue Test, Montréal",
                "phone": "5145550000",
                "products": "TEST médicament",
                "priority": "normal",
                "courier_employee_id": "e2",
                "courier_name": "Julie Lavoie",
            },
        )
        assert r.status_code in (200, 201), r.text[:300]
        d = r.json()
        assert d["status"] == "a_ramasser"
        assert "email_sent" in d
        TestDeliveries.created_id = d["id"]

    def test_admin_sees_all(self, tokens):
        r = requests.get(f"{BASE_URL}/api/deliveries", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        ids = [d["id"] for d in r.json()]
        assert TestDeliveries.created_id in ids

    def test_julie_only_sees_own(self, tokens):
        r = requests.get(f"{BASE_URL}/api/deliveries", headers=_h(tokens["julie"]))
        assert r.status_code == 200
        for d in r.json():
            assert d.get("courier_employee_id") == "e2"

    def test_julie_updates_en_route(self, tokens):
        r = requests.put(
            f"{BASE_URL}/api/deliveries/{TestDeliveries.created_id}/status",
            headers=_h(tokens["julie"]),
            json={"status": "en_route"},
        )
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("picked_up_at")

    def test_julie_updates_livree(self, tokens):
        r = requests.put(
            f"{BASE_URL}/api/deliveries/{TestDeliveries.created_id}/status",
            headers=_h(tokens["julie"]),
            json={"status": "livree"},
        )
        assert r.status_code == 200
        assert r.json().get("delivered_at")

    def test_invalid_status(self, tokens):
        r = requests.put(
            f"{BASE_URL}/api/deliveries/{TestDeliveries.created_id}/status",
            headers=_h(tokens["julie"]),
            json={"status": "bogus"},
        )
        assert r.status_code == 400

    def test_unassigned_employee_403(self, tokens):
        # create another delivery assigned to someone else (e3) and try Julie
        c = requests.post(
            f"{BASE_URL}/api/deliveries",
            headers=_h(tokens["admin"]),
            json={"client_name": "TEST_Client2", "address": "X", "courier_employee_id": "e3", "courier_name": "Karim", "priority": "normal"},
        )
        assert c.status_code in (200, 201)
        did = c.json()["id"]
        r = requests.put(f"{BASE_URL}/api/deliveries/{did}/status", headers=_h(tokens["julie"]), json={"status": "en_route"})
        assert r.status_code == 403
        requests.delete(f"{BASE_URL}/api/deliveries/{did}", headers=_h(tokens["admin"]))

    def test_invalid_priority(self, tokens):
        r = requests.post(
            f"{BASE_URL}/api/deliveries",
            headers=_h(tokens["admin"]),
            json={"client_name": "X", "address": "Y", "priority": "SUPER_URGENT", "courier_employee_id": "e2", "courier_name": "Julie"},
        )
        assert r.status_code == 400

    def test_admin_delete(self, tokens):
        r = requests.delete(f"{BASE_URL}/api/deliveries/{TestDeliveries.created_id}", headers=_h(tokens["admin"]))
        assert r.status_code in (200, 204)


# ---------- Global partners ----------
class TestGlobalPartners:
    created_id = None
    created_req_ids = []

    def test_admin_cannot_list_partners(self, tokens):
        r = requests.get(f"{BASE_URL}/api/superadmin/partners", headers=_h(tokens["admin"]))
        assert r.status_code == 403

    def test_super_get_partners_has_demo(self, tokens):
        r = requests.get(f"{BASE_URL}/api/superadmin/partners", headers=_h(tokens["super"]))
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert "PharmaStaff Québec" in names

    def test_super_create_missing_roles(self, tokens):
        r = requests.post(
            f"{BASE_URL}/api/superadmin/partners",
            headers=_h(tokens["super"]),
            json={"name": "TEST_p", "email": "x@x.com", "partner_type": "individual", "roles": []},
        )
        assert r.status_code == 400

    def test_super_create_and_delete(self, tokens):
        r = requests.post(
            f"{BASE_URL}/api/superadmin/partners",
            headers=_h(tokens["super"]),
            json={"name": "TEST_partner_it17", "email": "test@example.com", "partner_type": "individual", "roles": ["ATP"]},
        )
        assert r.status_code in (200, 201), r.text[:200]
        pid = r.json()["id"]
        TestGlobalPartners.created_id = pid
        d = requests.delete(f"{BASE_URL}/api/superadmin/partners/{pid}", headers=_h(tokens["super"]))
        assert d.status_code in (200, 204)

    def test_agencies_include_global(self, tokens):
        r = requests.get(f"{BASE_URL}/api/agencies", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        globals_ = [a for a in r.json() if a.get("global")]
        assert any(a["name"] == "PharmaStaff Québec" for a in globals_)

    def test_replacement_request_emails_partner(self, tokens):
        r = requests.post(
            f"{BASE_URL}/api/replacements/requests",
            headers=_h(tokens["admin"]),
            json={
                "role": "ATP",
                "slots": [{"date": "2026-08-20", "start": "09:00", "end": "17:00"}],
                "notes": "TEST_it17",
                "urgency": "normal",
                "public_base_url": "https://example.com",
            },
        )
        assert r.status_code in (200, 201), r.text[:300]
        data = r.json()
        assert data.get("emails_sent", 0) >= 1
        rid = data.get("id") or data.get("request", {}).get("id")
        if rid:
            TestGlobalPartners.created_req_ids.append(rid)

    def test_cleanup_requests(self, tokens):
        for rid in TestGlobalPartners.created_req_ids:
            requests.delete(f"{BASE_URL}/api/replacements/requests/{rid}", headers=_h(tokens["admin"]))


# ---------- Honor roll + goal ----------
class TestHonorRollAndGoal:
    def test_honor_roll_admin(self, tokens):
        r = requests.get(f"{BASE_URL}/api/tasks/honor-roll?month=2026-07", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        data = r.json()
        # Accept either list or dict shape
        entries = data if isinstance(data, list) else data.get("entries") or data.get("ranking") or []
        assert len(entries) >= 1
        top = entries[0]
        assert "Julie" in (top.get("name") or top.get("employee_name", ""))
        rate = top.get("rate") or top.get("completion_rate") or 0
        assert rate == 100 or rate == 1.0

    def test_honor_roll_employee(self, tokens):
        r = requests.get(f"{BASE_URL}/api/tasks/honor-roll?month=2026-07", headers=_h(tokens["julie"]))
        assert r.status_code == 200

    def test_goal_get(self, tokens):
        r = requests.get(f"{BASE_URL}/api/tasks/goal", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        assert r.json().get("target") == 80

    def test_goal_invalid_target(self, tokens):
        r = requests.post(f"{BASE_URL}/api/tasks/goal", headers=_h(tokens["admin"]), json={"target": 45})
        assert r.status_code == 400

    def test_goal_employee_forbidden(self, tokens):
        r = requests.post(f"{BASE_URL}/api/tasks/goal", headers=_h(tokens["julie"]), json={"target": 85})
        assert r.status_code == 403

    def test_goal_reset_to_80(self, tokens):
        # try setting 85 then back to 80
        r = requests.post(f"{BASE_URL}/api/tasks/goal", headers=_h(tokens["admin"]), json={"target": 85})
        assert r.status_code in (200, 201)
        r2 = requests.post(f"{BASE_URL}/api/tasks/goal", headers=_h(tokens["admin"]), json={"target": 80})
        assert r2.status_code in (200, 201)
        g = requests.get(f"{BASE_URL}/api/tasks/goal", headers=_h(tokens["admin"])).json()
        assert g["target"] == 80
