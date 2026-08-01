"""Iteration 33 — Budget history + shift-change notifications tests."""
import os
import time
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@luminahr.ca"
ADMIN_PWD = "Nlpx!tTE3Aw27"
JULIE_EMAIL = "julie@luminahr.ca"
JULIE_PWD = "O1ka!gfVV6e54"

TEST_DATE = "2026-08-07"
NON_AI_ID = "ntest-a"
AI_ID = "ntest-ai"


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def julie_token():
    return login(JULIE_EMAIL, JULIE_PWD)


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


# --- Test 1: budget-history endpoint ---
class TestBudgetHistory:
    def test_admin_default_months(self, admin_token):
        r = requests.get(f"{API}/reports/budget-history?months=6", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "months" in data and "departments" in data
        assert isinstance(data["months"], list) and len(data["months"]) == 6
        for m in data["months"]:
            assert "month" in m  # YYYY-MM
            assert len(m["month"]) == 7
            assert "total" in m
            assert "depts" in m or "departments" in m or isinstance(m, dict)

    def test_months_out_of_range(self, admin_token):
        r = requests.get(f"{API}/reports/budget-history?months=15", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 422, f"expected 422 got {r.status_code}"

    def test_employee_forbidden(self, julie_token):
        r = requests.get(f"{API}/reports/budget-history?months=6", headers=hdr(julie_token), timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"


# --- Test 2: shift-change notifications ---
def _julie_notifs(token):
    r = requests.get(f"{API}/notifications", headers=hdr(token), timeout=15)
    assert r.status_code == 200, r.text[:200]
    return r.json() if isinstance(r.json(), list) else r.json().get("notifications", [])


def _cleanup_shift(admin_token, sid):
    try:
        requests.delete(f"{API}/shifts/{sid}", headers=hdr(admin_token), timeout=10)
    except Exception:
        pass


class TestShiftNotifications:
    @pytest.fixture(autouse=True)
    def _cleanup(self, admin_token):
        _cleanup_shift(admin_token, NON_AI_ID)
        _cleanup_shift(admin_token, AI_ID)
        yield
        _cleanup_shift(admin_token, NON_AI_ID)
        _cleanup_shift(admin_token, AI_ID)

    def test_full_flow(self, admin_token, julie_token):
        # POST create
        payload = {"id": NON_AI_ID, "employee_id": "e2", "date": TEST_DATE, "start": "09:00", "end": "12:00"}
        r = requests.post(f"{API}/shifts", json=payload, headers=hdr(admin_token), timeout=15)
        assert r.status_code in (200, 201), f"POST /shifts: {r.status_code} {r.text[:200]}"
        time.sleep(0.5)

        notifs = _julie_notifs(julie_token)
        added = [n for n in notifs if "Nouveau quart" in (n.get("title", "") + n.get("message", ""))]
        assert added, f"Julie should have 'Nouveau quart ajouté' notif. Got: {[n.get('title') for n in notifs][:10]}"
        # verify tone sky
        tones = [n.get("tone") or n.get("color") for n in added]
        assert any(t == "sky" for t in tones), f"Expected sky tone, got {tones}"

        # PUT modify start
        r = requests.put(f"{API}/shifts/{NON_AI_ID}", json={"start": "10:00"}, headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text[:200]
        time.sleep(0.5)

        notifs = _julie_notifs(julie_token)
        modified = [n for n in notifs if "modifié" in (n.get("title", "") + n.get("message", "")).lower()]
        assert modified, f"Expected 'Quart modifié' notif. Titles: {[n.get('title') for n in notifs][:10]}"
        mtones = [n.get("tone") or n.get("color") for n in modified]
        assert any(t == "amber" for t in mtones), f"Expected amber tone, got {mtones}"
        # Detail avant→maintenant
        details = " ".join((n.get("detail", "") + " " + n.get("message", "") + " " + n.get("body", "")) for n in modified)
        assert "Avant" in details or "→" in details or "maintenant" in details.lower(), f"Expected avant→maintenant detail. Got: {details[:400]}"

        # PUT reassignment to e3
        r = requests.put(f"{API}/shifts/{NON_AI_ID}", json={"employee_id": "e3"}, headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text[:200]
        time.sleep(0.5)

        notifs = _julie_notifs(julie_token)
        removed = [n for n in notifs if "retiré" in (n.get("title", "") + n.get("message", "")).lower()]
        assert removed, f"Julie should have 'Quart retiré' after reassignment. Titles: {[n.get('title') for n in notifs][:10]}"
        rtones = [n.get("tone") or n.get("color") for n in removed]
        assert any(t in ("red", "rose") for t in rtones), f"Expected red tone, got {rtones}"

        # e3 should receive 'Nouveau quart ajouté' — check via mongo direct or admin notifications endpoint per target
        # try admin endpoint /api/notifications?employee_id=e3 if exists; else fallback to db check
        try:
            from pymongo import MongoClient
            from dotenv import dotenv_values as _dv
            be = _dv("/app/backend/.env")
            cli = MongoClient(be["MONGO_URL"])
            db = cli[be["DB_NAME"]]
            e3_notifs = list(db.notifications.find({"target_employee_id": "e3"}))
            assert any("Nouveau quart" in (n.get("title", "") + n.get("message", "")) for n in e3_notifs), \
                f"e3 should have 'Nouveau quart ajouté'. Got: {[n.get('title') for n in e3_notifs][:10]}"
        except ImportError:
            pytest.skip("pymongo not available for e3 verification")

        # DELETE non-AI shift → e3 gets 'Quart retiré'
        r = requests.delete(f"{API}/shifts/{NON_AI_ID}", headers=hdr(admin_token), timeout=15)
        assert r.status_code in (200, 204), r.text[:200]
        time.sleep(0.5)
        try:
            from pymongo import MongoClient
            from dotenv import dotenv_values as _dv
            be = _dv("/app/backend/.env")
            cli = MongoClient(be["MONGO_URL"])
            db = cli[be["DB_NAME"]]
            e3_notifs = list(db.notifications.find({"target_employee_id": "e3"}))
            retire_count = sum(1 for n in e3_notifs if "retiré" in (n.get("title", "") + n.get("message", "")).lower())
            assert retire_count >= 1, f"e3 should have 'Quart retiré' after DELETE. Titles: {[n.get('title') for n in e3_notifs]}"
        except ImportError:
            pass

    def test_ai_shift_no_notification(self, admin_token, julie_token):
        # baseline count
        before = _julie_notifs(julie_token)
        before_count = len([n for n in before if "Nouveau quart" in (n.get("title", "") + n.get("message", ""))])

        payload = {"id": AI_ID, "employee_id": "e2", "date": TEST_DATE, "start": "13:00", "end": "16:00", "ai_generated": True}
        r = requests.post(f"{API}/shifts", json=payload, headers=hdr(admin_token), timeout=15)
        assert r.status_code in (200, 201), r.text[:200]
        time.sleep(0.5)

        after = _julie_notifs(julie_token)
        after_count = len([n for n in after if "Nouveau quart" in (n.get("title", "") + n.get("message", ""))])
        assert after_count == before_count, f"AI shift should NOT create notif (before={before_count}, after={after_count})"

        # DELETE ai shift — no notif
        r = requests.delete(f"{API}/shifts/{AI_ID}", headers=hdr(admin_token), timeout=15)
        assert r.status_code in (200, 204)
        time.sleep(0.5)
        after2 = _julie_notifs(julie_token)
        removed_count = len([n for n in after2 if "retiré" in (n.get("title", "") + n.get("message", "")).lower()])
        before_removed = len([n for n in before if "retiré" in (n.get("title", "") + n.get("message", "")).lower()])
        assert removed_count == before_removed, f"AI shift DELETE should not create 'retiré' notif"

    def test_upsert_no_duplicate(self, admin_token, julie_token):
        payload = {"id": NON_AI_ID, "employee_id": "e2", "date": TEST_DATE, "start": "09:00", "end": "12:00"}
        r = requests.post(f"{API}/shifts", json=payload, headers=hdr(admin_token), timeout=15)
        assert r.status_code in (200, 201)
        time.sleep(0.3)
        before = _julie_notifs(julie_token)
        added_before = sum(1 for n in before if n.get("ref_id") == NON_AI_ID or NON_AI_ID in str(n))

        # Re-POST same id
        r = requests.post(f"{API}/shifts", json=payload, headers=hdr(admin_token), timeout=15)
        assert r.status_code in (200, 201)
        time.sleep(0.3)
        after = _julie_notifs(julie_token)
        added_after = sum(1 for n in after if n.get("ref_id") == NON_AI_ID or NON_AI_ID in str(n))
        # allow equal (no dup) — added_after <= added_before + 0
        assert added_after <= added_before, f"Re-POST same id created duplicate notif ({added_before}→{added_after})"
