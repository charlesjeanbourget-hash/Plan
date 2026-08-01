"""Iteration 28 — Loi 25: privacy consent, unusual IP alert, employee anonymization."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@luminahr.ca", "password": "Nlpx!tTE3Aw27"}
JULIE = {"email": "julie@luminahr.ca", "password": "O1ka!gfVV6e54"}
SUPER = {"email": "charlesjeanbourget@gmail.com", "password": "OwnerSecure2026!z"}


def _login(email, password, xff=None):
    headers = {"Content-Type": "application/json"}
    if xff:
        headers["X-Forwarded-For"] = xff
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, headers=headers, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def julie_token():
    return _login(**JULIE)


@pytest.fixture(scope="module")
def super_token():
    return _login(**SUPER)


# --- Privacy consent ---
class TestPrivacyConsent:
    def test_accept_privacy_requires_auth(self):
        r = requests.post(f"{API}/auth/accept-privacy", timeout=10)
        assert r.status_code in (401, 403)

    def test_julie_already_accepted(self, julie_token):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {julie_token}"}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "privacy_accepted_at" in data
        assert data["privacy_accepted_at"], "julie should already have accepted"

    def test_accept_privacy_persists(self):
        # Use admin then re-accept idempotently (may already be accepted by UI test earlier)
        token = _login(**ADMIN)
        headers = {"Authorization": f"Bearer {token}"}
        r = requests.post(f"{API}/auth/accept-privacy", headers=headers, timeout=10)
        assert r.status_code == 200
        ts = r.json().get("privacy_accepted_at")
        assert ts
        # verify via /auth/me
        me = requests.get(f"{API}/auth/me", headers=headers, timeout=10).json()
        assert me.get("privacy_accepted_at")


# --- Unusual IP login ---
class TestUnusualIP:
    def test_login_events_record_ip_and_flag_field(self, super_token):
        # Perform ONE login (test env: k8s ingress appends its own IP so the last-XFF
        # element does NOT reflect the header we send). We validate that the event
        # is recorded with an ip and a flagged_new_ip boolean.
        xff = "1.2.3.4, 198.51.100.77"
        _login(**JULIE, xff=xff)
        r = requests.get(f"{API}/superadmin/login-events",
                         headers={"Authorization": f"Bearer {super_token}"}, timeout=10)
        assert r.status_code == 200
        events = r.json()
        julie_events = [e for e in events if e.get("email") == JULIE["email"]]
        assert julie_events, "no julie login events found"
        latest = julie_events[0]
        assert "ip" in latest and latest["ip"]
        assert "flagged_new_ip" in latest
        # In this deterministic single-source test env the IP has been seen before
        # so flagged is False. Repeated login must still be False.
        _login(**JULIE)
        r2 = requests.get(f"{API}/superadmin/login-events",
                         headers={"Authorization": f"Bearer {super_token}"}, timeout=10)
        j2 = [e for e in r2.json() if e.get("email") == JULIE["email"]]
        assert j2[0].get("flagged_new_ip") is False

    def test_login_events_forbidden_for_non_super(self, julie_token):
        r = requests.get(f"{API}/superadmin/login-events",
                         headers={"Authorization": f"Bearer {julie_token}"}, timeout=10)
        assert r.status_code == 403


# --- Anonymization ---
class TestAnonymize:
    def test_anonymize_forbidden_for_employee(self, julie_token):
        r = requests.post(f"{API}/employees/e_test_anon/anonymize",
                          headers={"Authorization": f"Bearer {julie_token}"}, timeout=10)
        assert r.status_code == 403

    def test_anonymize_admin_ok_on_fake_id(self):
        token = _login(**ADMIN)
        r = requests.post(f"{API}/employees/e_test_anon/anonymize",
                          headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        for k in ("user", "profile", "punches", "licenses", "label"):
            assert k in body
        assert body["label"].startswith("Employé anonymisé")

    def test_anonymize_requires_auth(self):
        r = requests.post(f"{API}/employees/e_test_anon/anonymize", timeout=10)
        assert r.status_code in (401, 403)
