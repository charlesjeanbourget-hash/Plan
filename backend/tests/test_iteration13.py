"""Iteration 13 backend tests: Shift Tasks CRUD + copy-week + PWA static assets."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = {"email": "admin@luminahr.ca", "password": "admin123"}
JULIE = {"email": "julie@luminahr.ca", "password": "employe123"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"Login failed {creds['email']}: {r.status_code} {r.text[:300]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def julie_token():
    return _login(JULIE)


def h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


WEEK_START = "2026-08-03"
WEEK_END = "2026-08-09"
NEXT_WEEK_START = "2026-08-10"
NEXT_WEEK_END = "2026-08-16"


# Housekeeping: purge any leftover test tasks from these weeks before running
@pytest.fixture(scope="module", autouse=True)
def cleanup_before_and_after(admin_token):
    def purge():
        for start, end in [(WEEK_START, WEEK_END), (NEXT_WEEK_START, NEXT_WEEK_END)]:
            r = requests.get(f"{BASE_URL}/api/tasks", params={"start": start, "end": end}, headers=h(admin_token))
            if r.status_code == 200:
                for t in r.json():
                    if t["title"] in ("Vérifier les frigos", "Fermer la caisse", "Tâche Karim TEST"):
                        requests.delete(f"{BASE_URL}/api/tasks/{t['id']}", headers=h(admin_token))
    purge()
    yield
    purge()


class TestTasksCRUD:
    created_ids = {}

    def test_admin_create_team_task(self, admin_token):
        payload = {"date": WEEK_START, "shift": "Matin", "title": "Vérifier les frigos",
                   "description": "noter les températures", "assignee_employee_id": "", "assignee_name": ""}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload, headers=h(admin_token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] and d["done"] is False and d["title"] == "Vérifier les frigos"
        assert d["shift"] == "Matin" and d["assignee_employee_id"] == ""
        TestTasksCRUD.created_ids["team"] = d["id"]

    def test_admin_create_julie_task(self, admin_token):
        payload = {"date": WEEK_START, "shift": "Soir", "title": "Fermer la caisse",
                   "assignee_employee_id": "e2", "assignee_name": "Julie Tremblay"}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload, headers=h(admin_token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["assignee_employee_id"] == "e2" and d["assignee_name"] == "Julie Tremblay"
        TestTasksCRUD.created_ids["julie"] = d["id"]

    def test_admin_list_tasks(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/tasks", params={"start": WEEK_START, "end": WEEK_END},
                         headers=h(admin_token))
        assert r.status_code == 200
        ids = {t["id"] for t in r.json()}
        assert TestTasksCRUD.created_ids["team"] in ids
        assert TestTasksCRUD.created_ids["julie"] in ids

    def test_julie_list_sees_own_and_team(self, julie_token):
        r = requests.get(f"{BASE_URL}/api/tasks", params={"start": WEEK_START, "end": WEEK_END},
                         headers=h(julie_token))
        assert r.status_code == 200
        ids = {t["id"] for t in r.json()}
        assert TestTasksCRUD.created_ids["team"] in ids
        assert TestTasksCRUD.created_ids["julie"] in ids

    def test_julie_toggle_team_task(self, julie_token):
        tid = TestTasksCRUD.created_ids["team"]
        r = requests.post(f"{BASE_URL}/api/tasks/{tid}/toggle", headers=h(julie_token))
        assert r.status_code == 200
        d = r.json()
        assert d["done"] is True and d["done_by"]
        # re-toggle
        r2 = requests.post(f"{BASE_URL}/api/tasks/{tid}/toggle", headers=h(julie_token))
        assert r2.status_code == 200
        assert r2.json()["done"] is False

    def test_karim_task_hidden_from_julie(self, admin_token, julie_token):
        payload = {"date": WEEK_START, "shift": "Matin", "title": "Tâche Karim TEST",
                   "assignee_employee_id": "e3", "assignee_name": "Karim"}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload, headers=h(admin_token))
        assert r.status_code == 200
        kid = r.json()["id"]
        TestTasksCRUD.created_ids["karim"] = kid
        # Julie must not see it
        r2 = requests.get(f"{BASE_URL}/api/tasks", params={"start": WEEK_START, "end": WEEK_END},
                          headers=h(julie_token))
        assert kid not in {t["id"] for t in r2.json()}
        # Julie toggle → 403
        r3 = requests.post(f"{BASE_URL}/api/tasks/{kid}/toggle", headers=h(julie_token))
        assert r3.status_code == 403, r3.text

    def test_julie_cannot_create(self, julie_token):
        payload = {"date": WEEK_START, "shift": "Matin", "title": "Hack"}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload, headers=h(julie_token))
        assert r.status_code == 403, r.text

    def test_admin_delete_karim(self, admin_token):
        kid = TestTasksCRUD.created_ids.get("karim")
        if kid:
            r = requests.delete(f"{BASE_URL}/api/tasks/{kid}", headers=h(admin_token))
            # 200 = deleted here, 404 = already purged by parallel-worker teardown fixture
            assert r.status_code in (200, 404), r.text


class TestCopyWeek:
    def test_copy_week(self, admin_token):
        # Ensure clean target
        r0 = requests.get(f"{BASE_URL}/api/tasks", params={"start": NEXT_WEEK_START, "end": NEXT_WEEK_END},
                          headers=h(admin_token))
        for t in r0.json():
            if t["title"] in ("Vérifier les frigos", "Fermer la caisse"):
                requests.delete(f"{BASE_URL}/api/tasks/{t['id']}", headers=h(admin_token))

        r = requests.post(f"{BASE_URL}/api/tasks/copy-week",
                          json={"from_start": WEEK_START, "to_start": NEXT_WEEK_START}, headers=h(admin_token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] >= 2, d

        # Verify presence & done=false
        r2 = requests.get(f"{BASE_URL}/api/tasks", params={"start": NEXT_WEEK_START, "end": NEXT_WEEK_END},
                          headers=h(admin_token))
        titles = [t for t in r2.json() if t["title"] in ("Vérifier les frigos", "Fermer la caisse")]
        assert len(titles) >= 2
        for t in titles:
            assert t["done"] is False
            assert NEXT_WEEK_START <= t["date"] <= NEXT_WEEK_END

        # Anti-doublon
        r3 = requests.post(f"{BASE_URL}/api/tasks/copy-week",
                           json={"from_start": WEEK_START, "to_start": NEXT_WEEK_START}, headers=h(admin_token))
        assert r3.status_code == 200 and r3.json()["created"] == 0, r3.json()


class TestPWA:
    def test_manifest(self):
        r = requests.get(f"{BASE_URL}/manifest.json", timeout=15)
        assert r.status_code == 200, r.status_code
        j = r.json()
        assert "Arrière Plan" in j.get("name", "")
        sizes = {i.get("sizes") for i in j.get("icons", [])}
        assert "192x192" in sizes and "512x512" in sizes, sizes

    def test_icons_and_sw(self):
        for path in ["/icon-192.png", "/icon-512.png", "/sw.js"]:
            r = requests.get(f"{BASE_URL}{path}", timeout=15)
            assert r.status_code == 200, f"{path} → {r.status_code}"
