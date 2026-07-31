"""Iteration 23 — Chat (Messagerie interne) + Publication d'horaires + Punch cost."""
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = backend_env.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = backend_env.get("DB_NAME") or "test_database"


# ---------- Auth fixtures ----------
def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login {email} failed: {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_h():
    return _login("admin@luminahr.ca", "admin123")


@pytest.fixture(scope="module")
def manager_h():
    return _login("gestion@luminahr.ca", "gestion123")


@pytest.fixture(scope="module")
def julie_h():
    return _login("julie@luminahr.ca", "employe123")


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# ---------- Cleanup helper ----------
def _cleanup_test_conversations(admin_h, keep_team=True):
    r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=admin_h, timeout=15)
    if r.status_code != 200:
        return
    for c in r.json():
        if c.get("type") == "equipe" and keep_team:
            continue
        # Delete gestionnaires + direct conversations
        if c.get("type") in ("gestionnaires", "direct"):
            requests.delete(f"{BASE_URL}/api/chat/conversations/{c['id']}",
                            headers=admin_h, timeout=15)


# ============================================================
# CHAT — Messagerie interne
# ============================================================
class TestChat:
    def test_00_precleanup(self, admin_h):
        _cleanup_test_conversations(admin_h)

    def test_chat_users_admin(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/chat/users", headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        users = r.json()
        assert isinstance(users, list) and len(users) > 0
        roles = {u["role"] for u in users}
        assert roles.issubset({"admin", "manager", "employee"}), f"Unexpected roles: {roles}"
        assert "superadmin" not in roles

    def test_chat_users_julie_forbidden(self, julie_h):
        r = requests.get(f"{BASE_URL}/api/chat/users", headers=julie_h, timeout=15)
        assert r.status_code == 403, r.text

    def test_create_gestionnaires_conversation(self, manager_h):
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          json={"type": "gestionnaires"}, headers=manager_h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["type"] == "gestionnaires"
        assert data["name"] == "Gestionnaires"
        assert "_id" not in data

    def test_create_gestionnaires_duplicate(self, manager_h):
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          json={"type": "gestionnaires"}, headers=manager_h, timeout=15)
        assert r.status_code == 400, r.text
        assert "existe" in r.json().get("detail", "").lower()

    def test_create_direct_julie(self, manager_h):
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          json={"type": "direct", "participant_email": "julie@luminahr.ca"},
                          headers=manager_h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["type"] == "direct"
        assert data["participants"] == sorted(data["participants"])
        assert "julie@luminahr.ca" in data["participants"]
        assert "gestion@luminahr.ca" in data["participants"]

    def test_create_direct_duplicate(self, manager_h):
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          json={"type": "direct", "participant_email": "julie@luminahr.ca"},
                          headers=manager_h, timeout=15)
        assert r.status_code == 400, r.text

    def test_create_direct_unknown_user(self, manager_h):
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          json={"type": "direct", "participant_email": "nobody@example.com"},
                          headers=manager_h, timeout=15)
        assert r.status_code == 404, r.text

    def test_create_invalid_type(self, manager_h):
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          json={"type": "invalide"}, headers=manager_h, timeout=15)
        assert r.status_code == 400, r.text

    def test_create_julie_forbidden(self, julie_h):
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          json={"type": "direct", "participant_email": "admin@luminahr.ca"},
                          headers=julie_h, timeout=15)
        assert r.status_code == 403, r.text

    def test_list_conversations_julie_visibility(self, julie_h):
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=julie_h, timeout=15)
        assert r.status_code == 200, r.text
        types = [c["type"] for c in r.json()]
        assert "equipe" in types, "Julie should see 'Toute l'équipe'"
        assert "direct" in types, "Julie should see her direct conv"
        assert "gestionnaires" not in types, "Julie must NOT see 'Gestionnaires'"

    def test_message_send_and_validations(self, julie_h):
        # Find Julie's direct conversation
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=julie_h, timeout=15)
        directs = [c for c in r.json() if c["type"] == "direct"]
        assert directs, "No direct conversation found for Julie"
        conv_id = directs[0]["id"]

        # Valid message
        r = requests.post(f"{BASE_URL}/api/chat/conversations/{conv_id}/messages",
                          json={"body": "test"}, headers=julie_h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["body"] == "test"

        # Empty body
        r = requests.post(f"{BASE_URL}/api/chat/conversations/{conv_id}/messages",
                          json={"body": ""}, headers=julie_h, timeout=15)
        assert r.status_code == 400, r.text

        # 2500 char body
        r = requests.post(f"{BASE_URL}/api/chat/conversations/{conv_id}/messages",
                          json={"body": "x" * 2500}, headers=julie_h, timeout=15)
        assert r.status_code == 400, r.text

    def test_julie_cannot_post_in_gestionnaires(self, julie_h, admin_h):
        # Get gestionnaires convo id (admin sees it)
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=admin_h, timeout=15)
        gest = [c for c in r.json() if c["type"] == "gestionnaires"]
        assert gest, "Gestionnaires conv must exist"
        gid = gest[0]["id"]
        r = requests.post(f"{BASE_URL}/api/chat/conversations/{gid}/messages",
                          json={"body": "hack"}, headers=julie_h, timeout=15)
        assert r.status_code == 404, r.text

    def test_unread_flow(self, admin_h, julie_h):
        # Find direct conversation
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=admin_h, timeout=15)
        directs = [c for c in r.json() if c["type"] == "direct" and "julie@luminahr.ca" in c.get("participants", [])]
        # If no direct with admin — create one
        if not directs:
            r2 = requests.post(f"{BASE_URL}/api/chat/conversations",
                               json={"type": "direct", "participant_email": "julie@luminahr.ca"},
                               headers=admin_h, timeout=15)
            # It may fail if there's already a gestion↔julie direct; but admin should be able to create with self
            assert r2.status_code == 200, r2.text
            conv_id = r2.json()["id"]
        else:
            conv_id = directs[0]["id"]

        # Admin posts a message
        r = requests.post(f"{BASE_URL}/api/chat/conversations/{conv_id}/messages",
                          json={"body": "hello julie"}, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text

        # Julie may or may not be a participant (depending on branch above).
        # Fetch her convos and check unread
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=julie_h, timeout=15)
        j_convo = next((c for c in r.json() if c["id"] == conv_id), None)
        if j_convo is not None:
            assert j_convo["unread"] >= 1, f"Expected unread>=1, got {j_convo['unread']}"

            # Julie fetches messages → unread resets
            r = requests.get(f"{BASE_URL}/api/chat/conversations/{conv_id}/messages",
                             headers=julie_h, timeout=15)
            assert r.status_code == 200
            r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=julie_h, timeout=15)
            j_convo = next((c for c in r.json() if c["id"] == conv_id), None)
            assert j_convo["unread"] == 0, f"Expected unread=0, got {j_convo['unread']}"

    def test_delete_julie_forbidden(self, julie_h, admin_h):
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=admin_h, timeout=15)
        gest = [c for c in r.json() if c["type"] == "gestionnaires"]
        if gest:
            r = requests.delete(f"{BASE_URL}/api/chat/conversations/{gest[0]['id']}",
                                headers=julie_h, timeout=15)
            assert r.status_code == 403, r.text

    def test_delete_conversation_admin(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=admin_h, timeout=15)
        gest = [c for c in r.json() if c["type"] == "gestionnaires"]
        assert gest
        gid = gest[0]["id"]
        r = requests.delete(f"{BASE_URL}/api/chat/conversations/{gid}",
                            headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        # Verify gone
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=admin_h, timeout=15)
        assert not any(c["id"] == gid for c in r.json())

    def test_zz_cleanup(self, admin_h, mongo):
        _cleanup_test_conversations(admin_h, keep_team=True)
        # Preserve "Toute l'équipe" + welcome message
        team = mongo.conversations.find_one({"type": "equipe"})
        if team:
            msg_count = mongo.chat_messages.count_documents({"conversation_id": team["id"]})
            assert msg_count >= 1, "Welcome message should still be there"


# ============================================================
# PUBLICATION D'HORAIRE
# ============================================================
class TestPublish:
    WEEK = "2026-08-03"
    PAYLOAD_OK = {
        "week_start": WEEK,
        "recipients": [
            {"employee_id": "e2", "employee_name": "Julie Gagnon",
             "shift_count": 3, "hours": 24}
        ],
    }

    def test_publish_first_time(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/publish",
                          json=self.PAYLOAD_OK, headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["notified"] == 1
        assert data["updated"] is False
        assert "emailed" in data and isinstance(data["emailed"], int)

    def test_publish_second_time_updated(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/publish",
                          json=self.PAYLOAD_OK, headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["updated"] is True

    def test_julie_notifications(self, julie_h):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=julie_h, timeout=15)
        assert r.status_code == 200, r.text
        titles = [n["title"] for n in r.json()]
        assert any("Horaire publié" in t and self.WEEK in t for t in titles), \
            f"Missing 'Horaire publié — semaine du {self.WEEK}' in {titles}"
        assert any("Horaire modifié" in t and self.WEEK in t for t in titles), \
            f"Missing 'Horaire modifié — semaine du {self.WEEK}' in {titles}"

    def test_publish_empty_recipients(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/publish",
                          json={"week_start": self.WEEK, "recipients": []},
                          headers=admin_h, timeout=15)
        assert r.status_code == 400, r.text

    def test_publish_invalid_week(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/publish",
                          json={"week_start": "not-a-date",
                                "recipients": [{"employee_id": "e2", "shift_count": 1, "hours": 8}]},
                          headers=admin_h, timeout=15)
        assert r.status_code == 400, r.text

    def test_publish_julie_forbidden(self, julie_h):
        r = requests.post(f"{BASE_URL}/api/schedule/publish",
                          json=self.PAYLOAD_OK, headers=julie_h, timeout=15)
        assert r.status_code == 403, r.text

    def test_cleanup_mongo(self, mongo):
        # Cleanup test-week notifications + publications
        n_del = mongo.notifications.delete_many({
            "title": {"$regex": f"Horaire (publié|modifié) — semaine du {self.WEEK}"}
        }).deleted_count
        p_del = mongo.schedule_publications.delete_many({"week_start": self.WEEK}).deleted_count
        print(f"Cleanup: {n_del} notifs, {p_del} publications supprimées.")


# ============================================================
# PUNCH COST
# ============================================================
class TestPunchCost:
    def test_cost_ok(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/punch/cost",
                         params={"start": "2026-07-27", "end": "2026-08-02"},
                         headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "employees" in data and "total_hours" in data and "real_cost" in data
        julie = next((e for e in data["employees"] if e["employee_id"] == "e2"), None)
        assert julie is not None, f"Julie (e2) missing in punch cost: {data}"
        assert julie["hours"] > 0
        assert julie["rate"] == 25.9
        # Server computes cost from raw hours then rounds; displayed hours are also rounded
        # so allow tolerance ≥ 25.9 * 0.005 ≈ 0.13
        assert abs(julie["cost"] - julie["hours"] * 25.9) < 0.20
        # Coherence
        assert data["total_hours"] >= julie["hours"] - 0.01
        assert data["real_cost"] >= julie["cost"] - 0.05

    def test_cost_invalid_date(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/punch/cost",
                         params={"start": "bad", "end": "2026-08-02"},
                         headers=admin_h, timeout=15)
        assert r.status_code == 400, r.text

    def test_cost_julie_forbidden(self, julie_h):
        r = requests.get(f"{BASE_URL}/api/punch/cost",
                         params={"start": "2026-07-27", "end": "2026-08-02"},
                         headers=julie_h, timeout=15)
        assert r.status_code == 403, r.text
