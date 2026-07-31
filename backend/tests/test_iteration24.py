"""Iteration 24 backend tests — Pin messages, chat attachments, schedule read receipts.

Focuses on error cases (403/404/400) and full happy-path for the 3 new backend endpoints.
Cleans up all test-created data at end.
"""
import os
import pytest
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = backend_env.get("MONGO_URL", "mongodb://localhost:27017").strip('"')
DB_NAME = backend_env.get("DB_NAME", "test_database").strip('"')

WEEK = "2026-10-05"
TINY_PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
            "AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

# ---------- Fixtures ----------

@pytest.fixture(scope="session")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin@luminahr.ca", "admin123")


@pytest.fixture(scope="session")
def julie_token():
    return _login("julie@luminahr.ca", "employe123")


@pytest.fixture(scope="session")
def gestion_token():
    return _login("gestion@luminahr.ca", "gestion123")


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# Ids to clean up
CLEANUP = {"messages": [], "attachments": [], "conversations": []}


@pytest.fixture(scope="session", autouse=True)
def _cleanup(mongo):
    yield
    if CLEANUP["messages"]:
        mongo.chat_messages.delete_many({"id": {"$in": CLEANUP["messages"]}})
    if CLEANUP["attachments"]:
        mongo.chat_attachments.delete_many({"id": {"$in": CLEANUP["attachments"]}})
    if CLEANUP["conversations"]:
        mongo.conversations.delete_many({"id": {"$in": CLEANUP["conversations"]}})
    # Schedule test data
    mongo.schedule_publications.delete_many({"week_start": WEEK})
    mongo.schedule_views.delete_many({"week_start": WEEK})
    mongo.notifications.delete_many({"title": {"$regex": WEEK}})


@pytest.fixture(scope="class", autouse=False)
def _reset_pinned(mongo):
    """Class-scoped fixture: only reset pinned_message on Toute l'équipe at end of pin test class."""
    yield
    mongo.conversations.update_many({"name": "Toute l'équipe"}, {"$set": {"pinned_message": None}})


# ---------- Helpers ----------

def _get_equipe_id(token):
    r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=_h(token), timeout=10)
    assert r.status_code == 200
    for c in r.json():
        if c["name"] == "Toute l'équipe":
            return c["id"]
    pytest.fail("Conversation 'Toute l'équipe' introuvable")


def _post_message(token, convo_id, body="", attachment=None):
    payload = {"body": body}
    if attachment is not None:
        payload["attachment"] = attachment
    r = requests.post(f"{BASE_URL}/api/chat/conversations/{convo_id}/messages",
                      headers=_h(token), json=payload, timeout=15)
    return r


# =========================================================================
# PIN MESSAGE TESTS
# =========================================================================
@pytest.mark.xdist_group("chat_shared")
@pytest.mark.usefixtures("_reset_pinned")
class TestPinMessage:

    def test_pin_toggle_and_conversation_state(self, admin_token):
        eq = _get_equipe_id(admin_token)
        # Create test message
        r = _post_message(admin_token, eq, body="TEST_pin message body")
        assert r.status_code == 200
        msg = r.json()
        mid = msg["id"]
        CLEANUP["messages"].append(mid)

        # Pin it
        r = requests.post(f"{BASE_URL}/api/chat/messages/{mid}/pin", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json() == {"pinned": True}

        # Verify in conversation list
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        c = next(c for c in r.json() if c["id"] == eq)
        pinned = c.get("pinned_message")
        assert pinned is not None
        assert pinned["id"] == mid
        assert pinned["body"] == "TEST_pin message body"
        assert "sender_name" in pinned

        # Toggle unpin
        r = requests.post(f"{BASE_URL}/api/chat/messages/{mid}/pin", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json() == {"pinned": False}

        # Verify pinned_message removed
        r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=_h(admin_token), timeout=10)
        c = next(c for c in r.json() if c["id"] == eq)
        assert c.get("pinned_message") in (None, {})

    def test_pin_forbidden_for_employee(self, admin_token, julie_token):
        eq = _get_equipe_id(admin_token)
        r = _post_message(admin_token, eq, body="TEST_pin rbac")
        assert r.status_code == 200
        mid = r.json()["id"]
        CLEANUP["messages"].append(mid)
        r = requests.post(f"{BASE_URL}/api/chat/messages/{mid}/pin", headers=_h(julie_token), timeout=10)
        assert r.status_code == 403

    def test_pin_message_not_found(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/chat/messages/does-not-exist/pin",
                          headers=_h(admin_token), timeout=10)
        assert r.status_code == 404


# =========================================================================
# ATTACHMENT TESTS
# =========================================================================
@pytest.mark.xdist_group("chat_shared")
class TestAttachments:

    def test_post_attachment_and_last_message_preview(self, admin_token):
        eq = _get_equipe_id(admin_token)
        r = _post_message(admin_token, eq, body="",
                          attachment={"name": "TEST_note.png", "mime": "image/png", "data": TINY_PNG})
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["attachment"] is not None
        assert m["attachment"]["name"] == "TEST_note.png"
        assert m["attachment"]["mime"] == "image/png"
        assert "id" in m["attachment"]
        assert "size" in m["attachment"]
        CLEANUP["messages"].append(m["id"])
        CLEANUP["attachments"].append(m["attachment"]["id"])

        # Last message preview
        r2 = requests.get(f"{BASE_URL}/api/chat/conversations", headers=_h(admin_token), timeout=10)
        c = next(c for c in r2.json() if c["id"] == eq)
        assert c["last_message"] == "📎 TEST_note.png"

        # Admin can fetch the attachment
        att_id = m["attachment"]["id"]
        r3 = requests.get(f"{BASE_URL}/api/chat/attachments/{att_id}", headers=_h(admin_token), timeout=10)
        assert r3.status_code == 200
        data = r3.json()
        assert data["name"] == "TEST_note.png"
        assert data["mime"] == "image/png"
        assert data["data"].startswith("data:image/png;base64,")

    def test_julie_can_access_attachment_in_equipe(self, admin_token, julie_token):
        eq = _get_equipe_id(admin_token)
        r = _post_message(admin_token, eq, body="",
                          attachment={"name": "TEST_shared.png", "mime": "image/png", "data": TINY_PNG})
        assert r.status_code == 200
        mid = r.json()["id"]
        att_id = r.json()["attachment"]["id"]
        CLEANUP["messages"].append(mid)
        CLEANUP["attachments"].append(att_id)

        r2 = requests.get(f"{BASE_URL}/api/chat/attachments/{att_id}", headers=_h(julie_token), timeout=10)
        assert r2.status_code == 200
        assert r2.json()["name"] == "TEST_shared.png"

    def test_julie_forbidden_on_gestionnaires_attachment(self, admin_token, julie_token):
        # Create a gestionnaires conversation
        r = requests.post(f"{BASE_URL}/api/chat/conversations",
                          headers=_h(admin_token), json={"type": "gestionnaires"}, timeout=10)
        assert r.status_code == 200
        convo_id = r.json()["id"]
        CLEANUP["conversations"].append(convo_id)

        # Post an attachment in it
        r2 = _post_message(admin_token, convo_id, body="",
                           attachment={"name": "TEST_secret.png", "mime": "image/png", "data": TINY_PNG})
        assert r2.status_code == 200
        mid = r2.json()["id"]
        att_id = r2.json()["attachment"]["id"]
        CLEANUP["messages"].append(mid)
        CLEANUP["attachments"].append(att_id)

        # Julie -> 404
        r3 = requests.get(f"{BASE_URL}/api/chat/attachments/{att_id}", headers=_h(julie_token), timeout=10)
        assert r3.status_code == 404

    def test_attachment_invalid_data_prefix(self, admin_token):
        eq = _get_equipe_id(admin_token)
        r = _post_message(admin_token, eq, body="",
                          attachment={"name": "bad.png", "mime": "image/png",
                                      "data": "iVBORw0KGgoAAAANSUhEUgAAA"})
        assert r.status_code == 400

    def test_empty_body_and_no_attachment(self, admin_token):
        eq = _get_equipe_id(admin_token)
        r = _post_message(admin_token, eq, body="", attachment=None)
        assert r.status_code == 400


# =========================================================================
# SCHEDULE READ RECEIPTS
# =========================================================================
class TestScheduleReceipts:

    def test_publish_and_status_flow(self, admin_token, julie_token, gestion_token):
        # Publish
        r = requests.post(f"{BASE_URL}/api/schedule/publish", headers=_h(admin_token), json={
            "week_start": WEEK,
            "recipients": [{"employee_id": "e2", "employee_name": "Julie Gagnon",
                            "shift_count": 2, "hours": 16}]
        }, timeout=15)
        assert r.status_code == 200, r.text

        # Status (admin) -> published True, seen False
        r2 = requests.get(f"{BASE_URL}/api/schedule/publish/status",
                         headers=_h(admin_token), params={"week_start": WEEK}, timeout=10)
        assert r2.status_code == 200
        s = r2.json()
        assert s["published"] is True
        assert len(s["recipients"]) == 1
        assert s["recipients"][0]["employee_id"] == "e2"
        assert s["recipients"][0]["seen"] is False

        # Julie marks seen
        r3 = requests.post(f"{BASE_URL}/api/schedule/seen", headers=_h(julie_token),
                           json={"week_start": WEEK}, timeout=10)
        assert r3.status_code == 200
        assert r3.json() == {"status": "vu"}

        # Status -> seen True with seen_at
        r4 = requests.get(f"{BASE_URL}/api/schedule/publish/status",
                          headers=_h(admin_token), params={"week_start": WEEK}, timeout=10)
        assert r4.status_code == 200
        s2 = r4.json()
        assert s2["recipients"][0]["seen"] is True
        assert s2["recipients"][0]["seen_at"] is not None

        # gestion@ (no employee_id) -> ignoré
        r5 = requests.post(f"{BASE_URL}/api/schedule/seen", headers=_h(gestion_token),
                           json={"week_start": WEEK}, timeout=10)
        assert r5.status_code == 200
        assert r5.json() == {"status": "ignoré"}

    def test_status_for_unpublished_week(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/schedule/publish/status",
                         headers=_h(admin_token), params={"week_start": "2029-01-07"}, timeout=10)
        assert r.status_code == 200
        assert r.json() == {"published": False, "recipients": []}

    def test_julie_forbidden_on_status(self, julie_token):
        r = requests.get(f"{BASE_URL}/api/schedule/publish/status",
                         headers=_h(julie_token), params={"week_start": WEEK}, timeout=10)
        assert r.status_code == 403

    def test_invalid_week_start(self, admin_token, julie_token):
        r = requests.get(f"{BASE_URL}/api/schedule/publish/status",
                         headers=_h(admin_token), params={"week_start": "not-a-date"}, timeout=10)
        assert r.status_code == 400
        r2 = requests.post(f"{BASE_URL}/api/schedule/seen",
                           headers=_h(julie_token), json={"week_start": "not-a-date"}, timeout=10)
        assert r2.status_code == 400
