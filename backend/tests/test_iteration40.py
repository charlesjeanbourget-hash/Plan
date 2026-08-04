"""Iteration 40 — Backend: Rappels de tâches (POST /api/tasks/reminders/run)."""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
MTL = ZoneInfo("America/Montreal")

ADMIN_EMAIL = "admin@luminahr.ca"
ADMIN_PASSWORD = "Nlpx!tTE3Aw27"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login admin fail: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def today_str():
    return datetime.now(MTL).date().isoformat()


class TestTaskReminders:
    task_id = None

    def test_1_login(self, admin_token):
        assert admin_token

    def test_2_create_pending_task(self, headers, today_str):
        payload = {
            "date": today_str,
            "shift": "Matin",
            "title": "TEST_iter40 tâche non faite",
            "description": "Créée par test automatisé",
            "assignee_employee_id": "",
            "assignee_name": "",
            "recurring": False,
            "competences": [],
        }
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload, headers=headers, timeout=15)
        assert r.status_code == 200, f"create task: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert data.get("id")
        assert data["done"] is False
        assert data["shift"] == "Matin"
        assert data["date"] == today_str
        TestTaskReminders.task_id = data["id"]

    def test_3_first_reminder_run_sends(self, headers):
        r = requests.post(f"{BASE_URL}/api/tasks/reminders/run",
                          params={"shift": "Matin"}, headers=headers, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        data = r.json()
        assert "sent" in data
        # chat msg (dedup key) counts once even with 0 assigned employees on duty.
        assert data["sent"] >= 1, f"Expected sent>=1 (chat message), got {data}"

    def test_4_second_reminder_run_dedup(self, headers):
        r = requests.post(f"{BASE_URL}/api/tasks/reminders/run",
                          params={"shift": "Matin"}, headers=headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 0, f"Expected 0 (anti-dup), got {data}"

    def test_5_chat_has_task_reminder(self, headers, today_str):
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=headers, timeout=15)
        assert r.status_code == 200
        convos = r.json()
        assert isinstance(convos, list) and len(convos) > 0
        # Find team conversation
        team = next((c for c in convos if c.get("type") == "equipe"), None)
        assert team, "No equipe conversation"
        r2 = requests.get(f"{BASE_URL}/api/chat/conversations/{team['id']}/messages",
                          headers=headers, timeout=15)
        assert r2.status_code == 200
        msgs = r2.json()
        reminders = [m for m in msgs if m.get("kind") == "task_reminder"
                     and m.get("reminder_date") == today_str
                     and m.get("reminder_shift") == "Matin"]
        assert len(reminders) == 1, f"Expected exactly 1 task_reminder msg, got {len(reminders)}"
        assert "Matin" in reminders[0].get("body", "")

    def test_6_run_all_shifts_no_param(self, headers):
        r = requests.post(f"{BASE_URL}/api/tasks/reminders/run", headers=headers, timeout=45)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        data = r.json()
        assert "sent" in data and "par_quart" in data
        # 3 shifts must be present
        assert set(data["par_quart"].keys()) == {"Matin", "Après-midi", "Soir"}, data["par_quart"]

    def test_7_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/tasks/reminders/run",
                          params={"shift": "Matin"}, timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403 without auth, got {r.status_code}"

    def test_9_cleanup_task(self, headers):
        if TestTaskReminders.task_id:
            r = requests.delete(f"{BASE_URL}/api/tasks/{TestTaskReminders.task_id}",
                                headers=headers, timeout=15)
            assert r.status_code in (200, 204)
