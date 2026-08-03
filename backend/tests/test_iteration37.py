"""Backend tests — Iteration 45/37 (open-shifts, polls, kudos, punch+break, birthdays, superadmin, multi-branches)."""
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@luminahr.ca", "Nlpx!tTE3Aw27")
JULIE = ("julie@luminahr.ca", "O1ka!gfVV6e54")
SUPERADMIN = ("jeffmenard78@hotmail.com", "JeffSecure2026!x")
JULIE_PIN = "7068"
JULIE_ID = "e2"

MTL_TODAY_MD = datetime.now(ZoneInfo("America/Montreal")).strftime("%m-%d")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def julie_tok():
    return _login(*JULIE)


@pytest.fixture(scope="module")
def super_tok():
    return _login(*SUPERADMIN)


# ==================== BACKEND 1 — Open shifts ====================
class TestOpenShifts:
    created_id = None

    def test_create_open_shift(self, admin_tok):
        payload = {"date": "2099-12-31", "start": "09:00", "end": "13:00",
                   "department": "Commerce", "positions": [], "note": "TEST_iter37"}
        r = requests.post(f"{API}/open-shifts", json=payload, headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "open"
        assert d["date"] == "2099-12-31"
        TestOpenShifts.created_id = d["id"]

    def test_list_open_shifts(self, admin_tok):
        r = requests.get(f"{API}/open-shifts", headers=_h(admin_tok))
        assert r.status_code == 200
        assert any(x["id"] == TestOpenShifts.created_id for x in r.json())

    def test_claim_open_shift_julie(self, julie_tok):
        r = requests.post(f"{API}/open-shifts/{TestOpenShifts.created_id}/claim",
                          json={"employee_name": "Julie Gagnon"}, headers=_h(julie_tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["shift"]["employee_id"] == JULIE_ID

    def test_claim_second_time_conflict(self, julie_tok):
        r = requests.post(f"{API}/open-shifts/{TestOpenShifts.created_id}/claim",
                          json={"employee_name": "Julie Gagnon"}, headers=_h(julie_tok))
        assert r.status_code == 409, f"expected 409 got {r.status_code} {r.text[:200]}"

    def test_delete_open_shift(self, admin_tok):
        # can't delete claimed (it's not in 'open' state) — create another to test delete
        payload = {"date": "2099-12-30", "start": "09:00", "end": "13:00",
                   "department": "Commerce", "note": "TEST_iter37_del"}
        r = requests.post(f"{API}/open-shifts", json=payload, headers=_h(admin_tok))
        assert r.status_code == 200
        oid = r.json()["id"]
        r2 = requests.delete(f"{API}/open-shifts/{oid}", headers=_h(admin_tok))
        assert r2.status_code == 200, r2.text


# ==================== BACKEND 2 — Polls & Kudos ====================
class TestPollsKudos:
    poll_id = None
    option_ids = []
    kudos_id = None

    def test_create_poll(self, admin_tok):
        r = requests.post(f"{API}/polls",
                          json={"question": "TEST_iter37 Sondage?", "options": ["A", "B", "C"], "anonymous": False},
                          headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        d = r.json()
        TestPollsKudos.poll_id = d["id"]
        TestPollsKudos.option_ids = [o["id"] for o in d["options"]]
        assert d["status"] == "open"

    def test_vote_julie(self, julie_tok):
        r = requests.post(f"{API}/polls/{TestPollsKudos.poll_id}/vote",
                          json={"option_id": TestPollsKudos.option_ids[0]}, headers=_h(julie_tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["my_vote"] == TestPollsKudos.option_ids[0]
        assert d["total_votes"] >= 1
        assert d["results"] is not None

    def test_vote_second_time_rejected(self, julie_tok):
        r = requests.post(f"{API}/polls/{TestPollsKudos.poll_id}/vote",
                          json={"option_id": TestPollsKudos.option_ids[1]}, headers=_h(julie_tok))
        assert r.status_code == 400

    def test_close_poll(self, admin_tok):
        r = requests.post(f"{API}/polls/{TestPollsKudos.poll_id}/close", headers=_h(admin_tok))
        assert r.status_code == 200
        # verify
        rl = requests.get(f"{API}/polls", headers=_h(admin_tok))
        p = next(x for x in rl.json() if x["id"] == TestPollsKudos.poll_id)
        assert p["status"] == "closed"

    def test_delete_poll(self, admin_tok):
        r = requests.delete(f"{API}/polls/{TestPollsKudos.poll_id}", headers=_h(admin_tok))
        assert r.status_code == 200

    def test_create_kudos(self, admin_tok):
        r = requests.post(f"{API}/kudos",
                          json={"to_employee_id": JULIE_ID, "to_name": "Julie Gagnon",
                                "category": "Bravo", "message": "TEST_iter37 bravo"},
                          headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        TestPollsKudos.kudos_id = r.json()["id"]

    def test_applaud_kudos(self, julie_tok):
        r = requests.post(f"{API}/kudos/{TestPollsKudos.kudos_id}/applaud", headers=_h(julie_tok))
        assert r.status_code == 200
        d = r.json()
        assert d["applause_count"] == 1
        assert d["my_applause"] is True

    def test_cleanup_kudos(self, admin_tok):
        r = requests.delete(f"{API}/kudos/{TestPollsKudos.kudos_id}", headers=_h(admin_tok))
        assert r.status_code in (200, 204)


# ==================== BACKEND 3 — Punch with breaks ====================
class TestPunchBreaks:
    def test_full_break_flow(self, admin_tok):
        # Ensure clean state: check if julie has an open punch, if so close it
        # 1) Punch IN
        r = requests.post(f"{API}/punch", json={"code": JULIE_PIN})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("employee_name")
        # If already IN, this became OUT — we need to make sure we start fresh.
        if d.get("action") == "out":
            time.sleep(1)
            r = requests.post(f"{API}/punch", json={"code": JULIE_PIN})
            assert r.status_code == 200
            d = r.json()
        assert d["action"] == "in", f"expected in, got {d.get('action')}"

        time.sleep(1)
        # 2) Break start
        rb = requests.post(f"{API}/punch/break", json={"code": JULIE_PIN})
        assert rb.status_code == 200, rb.text
        assert rb.json()["action"] == "break_start"

        time.sleep(1)
        # 3) Break end
        rb2 = requests.post(f"{API}/punch/break", json={"code": JULIE_PIN})
        assert rb2.status_code == 200, rb2.text
        assert rb2.json()["action"] == "break_end"

        time.sleep(1)
        # 4) Punch OUT
        r_out = requests.post(f"{API}/punch", json={"code": JULIE_PIN})
        assert r_out.status_code == 200, r_out.text
        d_out = r_out.json()
        assert d_out["action"] == "out"
        # Should include duration and breaks reflected
        # verify punches list contains breaks[]
        today = datetime.now(ZoneInfo("America/Montreal")).date().isoformat()
        pl = requests.get(f"{API}/punches", params={"start": today, "end": today}, headers=_h(admin_tok))
        assert pl.status_code == 200
        matches = [p for p in pl.json() if p.get("employee_id") == JULIE_ID and p.get("date") == today]
        assert matches, "no punch found for julie today"
        latest = sorted(matches, key=lambda p: p.get("punch_in", ""))[-1]
        assert latest.get("breaks"), "breaks should be recorded"
        assert len(latest["breaks"]) >= 1
        assert latest["breaks"][0].get("start") and latest["breaks"][0].get("end")

    def test_punch_settings_get_put(self, admin_tok):
        r = requests.get(f"{API}/punch/settings", headers=_h(admin_tok))
        assert r.status_code == 200
        orig = r.json()
        payload = {"rounding_minutes": 5, "rounding_mode": "nearest", "breaks_paid": False}
        r2 = requests.put(f"{API}/punch/settings", json=payload, headers=_h(admin_tok))
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["rounding_minutes"] == 5
        assert d["breaks_paid"] is False
        # Validation: invalid rounding
        r3 = requests.put(f"{API}/punch/settings",
                          json={"rounding_minutes": 7, "rounding_mode": "nearest", "breaks_paid": False},
                          headers=_h(admin_tok))
        assert r3.status_code == 400
        # Restore
        restore = {"rounding_minutes": orig.get("rounding_minutes", 0),
                   "rounding_mode": orig.get("rounding_mode", "nearest"),
                   "breaks_paid": orig.get("breaks_paid", True)}
        requests.put(f"{API}/punch/settings", json=restore, headers=_h(admin_tok))


# ==================== BACKEND 4 — Birthdays ====================
class TestBirthdays:
    def test_birth_date_validation_invalid(self, admin_tok):
        r = requests.put(f"{API}/profiles/{JULIE_ID}",
                         json={"birth_date": "1993-13-45", "employee_name": "Julie Gagnon"},
                         headers=_h(admin_tok))
        assert r.status_code == 400

    def test_birth_date_valid(self, admin_tok):
        r = requests.put(f"{API}/profiles/{JULIE_ID}",
                         json={"birth_date": "1993-05-10", "employee_name": "Julie Gagnon"},
                         headers=_h(admin_tok))
        assert r.status_code == 200
        assert r.json()["birth_date"] == "1993-05-10"

    def test_restore_today_and_check_birthdays(self, admin_tok):
        today_bd = f"1993-{MTL_TODAY_MD}"
        r = requests.put(f"{API}/profiles/{JULIE_ID}",
                         json={"birth_date": today_bd, "employee_name": "Julie Gagnon"},
                         headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        assert r.json()["birth_date"] == today_bd

        rb = requests.get(f"{API}/birthdays/today", headers=_h(admin_tok))
        assert rb.status_code == 200
        found = rb.json()
        assert any(b["employee_id"] == JULIE_ID and "Julie" in (b.get("employee_name") or "") for b in found), \
            f"Julie birthday not found in {found}"


# ==================== BACKEND 5 — Superadmin overview enriched ====================
class TestSuperadmin:
    def test_admin_forbidden(self, admin_tok):
        r = requests.get(f"{API}/superadmin/overview", headers=_h(admin_tok))
        assert r.status_code == 403

    def test_superadmin_overview_enriched(self, super_tok):
        r = requests.get(f"{API}/superadmin/overview", headers=_h(super_tok))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "pharmacies" in data and "accounts" in data
        ph1 = next((p for p in data["pharmacies"] if p["pharmacy_id"] == "ph1"), None)
        assert ph1 is not None, "ph1 must exist"
        act = ph1.get("activity")
        assert act is not None, "activity block missing"
        expected_keys = {"shifts_total", "shifts_upcoming", "punches_30d", "punch_hours_30d",
                         "leave_pending", "leave_approved", "messages_30d", "open_shifts",
                         "evaluations", "deliveries", "tasks", "benefits_published",
                         "audit_events_30d", "last_activity"}
        missing = expected_keys - set(act.keys())
        assert not missing, f"missing activity keys: {missing}"

        # accounts array with required fields
        assert isinstance(data["accounts"], list) and data["accounts"]
        a0 = data["accounts"][0]
        for key in ["email", "name", "role", "suspended", "is_temporary_password", "last_login", "logins_30d"]:
            assert key in a0, f"missing account key {key}"


# ==================== BACKEND 6 — Multi-branch shifts ====================
class TestMultiBranch:
    def test_create_shift_with_branch(self, admin_tok):
        payload = {"employee_id": JULIE_ID, "date": "2099-11-15",
                   "start": "10:00", "end": "14:00", "branch_id": "br2",
                   "department": "Commerce", "notes": "TEST_iter37"}
        r = requests.post(f"{API}/shifts", json=payload, headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("branch_id") == "br2"
        sid = d["id"]

        # verify GET
        rl = requests.get(f"{API}/shifts", headers=_h(admin_tok))
        assert rl.status_code == 200
        items = rl.json().get("shifts") if isinstance(rl.json(), dict) else rl.json()
        assert any(s["id"] == sid and s.get("branch_id") == "br2" for s in items)

        # cleanup
        requests.delete(f"{API}/shifts/{sid}", headers=_h(admin_tok))
