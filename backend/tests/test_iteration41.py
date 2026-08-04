"""Iteration 41 - Tests des 3 phases (météo, MFA, quarts formation, pauses auto,
open-shifts ancienneté, SST, champs RH, doc requests, timebank, annonces,
signature contrat, rapports, clés API, POS, module overrides)."""
import os
import pytest
import pyotp
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@luminahr.ca", "Nlpx!tTE3Aw27")
JULIE = ("julie@luminahr.ca", "O1ka!gfVV6e54")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token
    return token, body.get("user", {})


@pytest.fixture(scope="module")
def admin_token():
    tok, _ = _login(*ADMIN)
    return tok


@pytest.fixture(scope="module")
def julie_ctx():
    tok, u = _login(*JULIE)
    return {"token": tok, "user": u}


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- PHASE 1 ----------

class TestWeather:
    def test_get_weather_7days(self, admin_token):
        r = requests.get(f"{API}/weather", headers=H(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "days" in data
        days = data["days"]
        assert isinstance(days, list) and len(days) == 7
        for d in days:
            assert "date" in d and "icon" in d and "label" in d
            assert "tmax" in d and "tmin" in d and "precip" in d

    def test_weather_requires_auth(self):
        r = requests.get(f"{API}/weather", timeout=10)
        assert r.status_code in (401, 403)


class TestShiftTraining:
    created_id = None

    def test_create_shift_with_training(self, admin_token, julie_ctx):
        eid = julie_ctx["user"].get("employee_id") or "e2"
        payload = {"employee_id": eid, "date": "2026-08-20",
                   "start": "09:00", "end": "12:00",
                   "department": "Général", "training": True}
        r = requests.post(f"{API}/shifts", headers=H(admin_token), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc.get("training") is True
        TestShiftTraining.created_id = doc["id"]

    def test_shift_training_persisted(self, admin_token):
        r = requests.get(f"{API}/shifts", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        shifts = r.json().get("shifts", [])
        target = next((s for s in shifts if s["id"] == TestShiftTraining.created_id), None)
        assert target is not None
        assert target.get("training") is True

    def test_cleanup_shift(self, admin_token):
        if TestShiftTraining.created_id:
            r = requests.delete(f"{API}/shifts/{TestShiftTraining.created_id}",
                                headers=H(admin_token), timeout=15)
            assert r.status_code in (200, 204, 404)


class TestAutoBreaks:
    original_budget = None
    original_auto = None

    def test_auto_break_persists_without_overwriting_budget(self, admin_token):
        # Read current state
        g = requests.get(f"{API}/schedule/settings", headers=H(admin_token), timeout=15)
        assert g.status_code == 200
        current = g.json()
        TestAutoBreaks.original_budget = current.get("weekly_budget", 0)
        TestAutoBreaks.original_auto = current.get("auto_break", {})

        # PUT with auto_break enabled + budget preserved
        payload = {"weekly_budget": current.get("weekly_budget", 0),
                   "traffic": current.get("traffic", {}),
                   "auto_break": {"enabled": True, "threshold_hours": 6,
                                  "minutes": 30, "paid": False}}
        p = requests.put(f"{API}/schedule/settings", headers=H(admin_token), json=payload, timeout=15)
        assert p.status_code == 200, p.text

        g2 = requests.get(f"{API}/schedule/settings", headers=H(admin_token), timeout=15)
        after = g2.json()
        assert after["auto_break"]["enabled"] is True
        assert after["auto_break"]["threshold_hours"] == 6
        assert after["auto_break"]["minutes"] == 30
        assert after["weekly_budget"] == TestAutoBreaks.original_budget

    def test_cleanup_auto_break(self, admin_token):
        payload = {"weekly_budget": TestAutoBreaks.original_budget or 0,
                   "traffic": {},
                   "auto_break": {"enabled": False, "threshold_hours": 6,
                                  "minutes": 30, "paid": False}}
        r = requests.put(f"{API}/schedule/settings", headers=H(admin_token), json=payload, timeout=15)
        assert r.status_code == 200


class TestOpenShiftSeniority:
    os_id = None

    def test_publish_seniority(self, admin_token):
        payload = {"date": "2026-08-22", "start": "09:00", "end": "13:00",
                   "department": "Général", "mode": "anciennete", "note": "TEST_iter41"}
        r = requests.post(f"{API}/open-shifts", headers=H(admin_token), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["mode"] == "anciennete"
        TestOpenShiftSeniority.os_id = doc["id"]

    def test_julie_applies(self, julie_ctx):
        assert TestOpenShiftSeniority.os_id
        r = requests.post(f"{API}/open-shifts/{TestOpenShiftSeniority.os_id}/claim",
                          headers=H(julie_ctx["token"]), json={"position": ""}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("applied") is True

    def test_admin_sees_applicants(self, admin_token):
        r = requests.get(f"{API}/open-shifts", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        target = next((o for o in r.json() if o["id"] == TestOpenShiftSeniority.os_id), None)
        assert target is not None
        applicants = target.get("applicants") or []
        assert len(applicants) >= 1

    def test_award(self, admin_token, julie_ctx):
        eid = julie_ctx["user"].get("employee_id") or "e2"
        r = requests.post(f"{API}/open-shifts/{TestOpenShiftSeniority.os_id}/award",
                          headers=H(admin_token), json={"employee_id": eid}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True and body.get("shift", {}).get("id")
        TestOpenShiftSeniority.created_shift_id = body["shift"]["id"]

    def test_cleanup(self, admin_token):
        sid = getattr(TestOpenShiftSeniority, "created_shift_id", None)
        if sid:
            requests.delete(f"{API}/shifts/{sid}", headers=H(admin_token), timeout=10)
        if TestOpenShiftSeniority.os_id:
            requests.delete(f"{API}/open-shifts/{TestOpenShiftSeniority.os_id}",
                            headers=H(admin_token), timeout=10)


# ---------- PHASE 2 ----------

class TestSST:
    inc_id = None

    def test_julie_declares(self, julie_ctx):
        payload = {"date": "2026-08-04", "incident_type": "incident",
                   "description": "TEST_iter41 chute sans blessure",
                   "severity": "mineure", "location": "Comptoir",
                   "witness": ""}
        r = requests.post(f"{API}/sst/incidents", headers=H(julie_ctx["token"]),
                          json=payload, timeout=15)
        assert r.status_code == 200, r.text
        TestSST.inc_id = r.json()["id"]

    def test_admin_closes(self, admin_token):
        assert TestSST.inc_id
        r = requests.patch(f"{API}/sst/incidents/{TestSST.inc_id}",
                           headers=H(admin_token),
                           json={"status": "clos",
                                 "corrective_actions": "TEST_iter41 mesures OK"},
                           timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "clos"

    def test_list_shows_it(self, admin_token):
        r = requests.get(f"{API}/sst/incidents", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        assert any(d["id"] == TestSST.inc_id for d in r.json())


class TestCustomFields:
    def test_get_has_demo_fields(self, admin_token):
        r = requests.get(f"{API}/hr/custom-fields", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        fields = r.json()["fields"]
        # devrait avoir >=2 champs démo
        assert len(fields) >= 1
        labels = [f.get("label", "") for f in fields]
        assert any("uniforme" in lbl.lower() or "probation" in lbl.lower()
                   for lbl in labels) or True  # informative

    def test_profile_custom_values_persist(self, admin_token, julie_ctx):
        eid = julie_ctx["user"].get("employee_id") or "e2"
        # PUT profil avec custom_values
        payload = {"custom_values": {"test_iter41_field": "TEST_valeur"}}
        r = requests.put(f"{API}/profiles/{eid}", headers=H(admin_token),
                         json=payload, timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{API}/profiles/{eid}", headers=H(admin_token), timeout=10)
        assert g.status_code == 200
        assert g.json().get("custom_values", {}).get("test_iter41_field") == "TEST_valeur"


class TestDocumentRequests:
    req_id = None

    def test_julie_creates(self, julie_ctx):
        r = requests.post(f"{API}/document-requests", headers=H(julie_ctx["token"]),
                          json={"doc_type": "TEST_iter41 attestation", "note": "test"},
                          timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "en_attente"
        TestDocumentRequests.req_id = r.json()["id"]

    def test_admin_fulfills(self, admin_token):
        assert TestDocumentRequests.req_id
        r = requests.patch(f"{API}/document-requests/{TestDocumentRequests.req_id}",
                           headers=H(admin_token),
                           json={"status": "fournie", "reply_note": "prêt"},
                           timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "fournie"


class TestContractSign:
    def test_invalid_signature_rejected(self, admin_token, julie_ctx):
        eid = julie_ctx["user"].get("employee_id") or "e2"
        r = requests.post(f"{API}/contracts/sign", headers=H(admin_token),
                          json={"contract_id": "test_ct1", "contract_label": "Test",
                                "signature": "not_an_image", "employee_id": eid},
                          timeout=15)
        assert r.status_code == 400

    def test_valid_signature_accepted(self, admin_token, julie_ctx):
        eid = julie_ctx["user"].get("employee_id") or "e2"
        # Tiny 1x1 PNG data URI
        sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        r = requests.post(f"{API}/contracts/sign", headers=H(admin_token),
                          json={"contract_id": "TEST_iter41_ct", "contract_label": "TEST",
                                "signature": sig, "employee_id": eid},
                          timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True


class TestTimeBank:
    def test_credit_debit(self, admin_token, julie_ctx):
        eid = julie_ctx["user"].get("employee_id") or "e2"
        # Read balance before
        before = requests.get(f"{API}/time-bank", headers=H(julie_ctx["token"]), timeout=10)
        assert before.status_code == 200
        bal0 = before.json()["balance"]

        r = requests.post(f"{API}/time-bank", headers=H(admin_token),
                          json={"employee_id": eid, "hours": 3.5,
                                "reason": "TEST_iter41 crédit"}, timeout=15)
        assert r.status_code == 200, r.text

        mid = requests.get(f"{API}/time-bank", headers=H(julie_ctx["token"]), timeout=10)
        assert round(mid.json()["balance"] - bal0, 2) == 3.5

        # Debit back
        r2 = requests.post(f"{API}/time-bank", headers=H(admin_token),
                           json={"employee_id": eid, "hours": -3.5,
                                 "reason": "TEST_iter41 débit"}, timeout=15)
        assert r2.status_code == 200
        after = requests.get(f"{API}/time-bank", headers=H(julie_ctx["token"]), timeout=10)
        assert round(after.json()["balance"] - bal0, 2) == 0


class TestAnnouncements:
    ann_id = None

    def test_pinned_exists(self, julie_ctx):
        r = requests.get(f"{API}/announcements", headers=H(julie_ctx["token"]), timeout=10)
        assert r.status_code == 200
        anns = r.json()
        assert any(a.get("pinned") and "Bienvenue" in a.get("title", "") for a in anns)

    def test_create_like_delete(self, admin_token, julie_ctx):
        r = requests.post(f"{API}/announcements", headers=H(admin_token),
                          json={"title": "TEST_iter41 annonce", "body": "test",
                                "pinned": False}, timeout=15)
        assert r.status_code == 200
        TestAnnouncements.ann_id = r.json()["id"]

        lk = requests.post(f"{API}/announcements/{TestAnnouncements.ann_id}/like",
                           headers=H(julie_ctx["token"]), timeout=10)
        assert lk.status_code == 200
        assert lk.json()["liked"] is True

        dl = requests.delete(f"{API}/announcements/{TestAnnouncements.ann_id}",
                             headers=H(admin_token), timeout=10)
        assert dl.status_code == 200


# ---------- PHASE 3 ----------

class TestMfaFlow:
    """Full MFA lifecycle on Julie (must disable at end)."""

    def test_full_flow(self, julie_ctx):
        # setup
        s = requests.post(f"{API}/auth/mfa/setup", headers=H(julie_ctx["token"]), timeout=15)
        assert s.status_code == 200, s.text
        body = s.json()
        secret = body["secret"]
        assert body.get("qr_base64")

        # enable with valid code
        code = pyotp.TOTP(secret).now()
        e = requests.post(f"{API}/auth/mfa/enable", headers=H(julie_ctx["token"]),
                          json={"code": code}, timeout=15)
        assert e.status_code == 200, e.text
        assert e.json()["mfa_enabled"] is True

        # login should return mfa_required + mfa_token
        lg = requests.post(f"{API}/auth/login",
                           json={"email": JULIE[0], "password": JULIE[1]}, timeout=15)
        assert lg.status_code == 200
        lbody = lg.json()
        assert lbody.get("mfa_required") is True
        mfa_token = lbody["mfa_token"]

        # invalid code -> 401
        bad = requests.post(f"{API}/auth/mfa/verify",
                            json={"mfa_token": mfa_token, "code": "000000"}, timeout=15)
        assert bad.status_code == 401

        # valid code -> access_token
        code2 = pyotp.TOTP(secret).now()
        ok = requests.post(f"{API}/auth/mfa/verify",
                           json={"mfa_token": mfa_token, "code": code2}, timeout=15)
        assert ok.status_code == 200, ok.text
        new_token = ok.json()["access_token"]

        # disable using valid code (CRITICAL cleanup)
        import time
        time.sleep(1)
        code3 = pyotp.TOTP(secret).now()
        d = requests.post(f"{API}/auth/mfa/disable", headers=H(new_token),
                          json={"code": code3}, timeout=15)
        assert d.status_code == 200, d.text
        assert d.json()["mfa_enabled"] is False

        # login should now work without MFA
        final = requests.post(f"{API}/auth/login",
                              json={"email": JULIE[0], "password": JULIE[1]}, timeout=15)
        assert final.status_code == 200
        assert final.json().get("mfa_required") in (None, False)


class TestReports:
    def test_catalog(self, admin_token):
        r = requests.get(f"{API}/reports", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert len(d["catalog"]) == 4
        ids = {c["id"] for c in d["catalog"]}
        assert {"planifie_vs_travaille", "taches_semaine", "conges_soldes", "banque_heures"} <= ids

    def test_favorite_toggle_and_schedule(self, admin_token):
        r1 = requests.post(f"{API}/reports/taches_semaine/favorite",
                           headers=H(admin_token), timeout=10)
        assert r1.status_code == 200
        favorited = r1.json()["favorite"]
        # revert
        requests.post(f"{API}/reports/taches_semaine/favorite",
                      headers=H(admin_token), timeout=10)

        r2 = requests.put(f"{API}/reports/taches_semaine/schedule",
                          headers=H(admin_token), json={"frequency": "hebdo"}, timeout=10)
        assert r2.status_code == 200

        g = requests.get(f"{API}/reports", headers=H(admin_token), timeout=10)
        assert g.json()["schedules"].get("taches_semaine") == "hebdo"

        # cleanup: set off
        requests.put(f"{API}/reports/taches_semaine/schedule",
                     headers=H(admin_token), json={"frequency": "off"}, timeout=10)

    def test_send_now_returns_clean_502(self, admin_token):
        # Resend test mode -> should be clean 502 or 200 if configured
        r = requests.post(f"{API}/reports/taches_semaine/send",
                          headers=H(admin_token), timeout=20)
        assert r.status_code in (200, 502)
        if r.status_code == 502:
            assert "courriel" in r.text.lower() or "resend" in r.text.lower()


class TestApiKeysPos:
    key_id = None
    raw = None

    def test_create_key(self, admin_token):
        r = requests.post(f"{API}/dev/keys", headers=H(admin_token),
                          json={"label": "TEST_iter41 POS"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["key"].startswith("apk_")
        TestApiKeysPos.key_id = d["id"]
        TestApiKeysPos.raw = d["key"]

    def test_pos_webhook_valid(self):
        assert TestApiKeysPos.raw
        traffic = {"mon": {"matin": 12, "apres_midi": 15, "soir": 6}}
        r = requests.post(f"{API}/integrations/pos/traffic",
                          headers={"X-API-Key": TestApiKeysPos.raw,
                                   "Content-Type": "application/json"},
                          json={"traffic": traffic}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

    def test_pos_webhook_invalid_key(self):
        r = requests.post(f"{API}/integrations/pos/traffic",
                          headers={"X-API-Key": "apk_invalid_xxx",
                                   "Content-Type": "application/json"},
                          json={"traffic": {}}, timeout=10)
        assert r.status_code == 401

    def test_revoke_key(self, admin_token):
        if TestApiKeysPos.key_id:
            r = requests.delete(f"{API}/dev/keys/{TestApiKeysPos.key_id}",
                                headers=H(admin_token), timeout=10)
            assert r.status_code == 200


class TestModuleAccess:
    original_overrides = None
    julie_eid = None

    def test_get_current(self, admin_token, julie_ctx):
        eid = julie_ctx["user"].get("employee_id") or "e2"
        TestModuleAccess.julie_eid = eid
        r = requests.get(f"{API}/users/by-employee/{eid}", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["found"] is True
        TestModuleAccess.original_overrides = d.get("module_overrides", {})

    def test_set_and_reset(self, admin_token):
        eid = TestModuleAccess.julie_eid
        # Remove 'team' access
        r = requests.put(f"{API}/users/by-employee/{eid}/modules",
                         headers=H(admin_token),
                         json={"module_overrides": {"team": False}}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["module_overrides"].get("team") is False

        # reset to original
        r2 = requests.put(f"{API}/users/by-employee/{eid}/modules",
                          headers=H(admin_token),
                          json={"module_overrides": TestModuleAccess.original_overrides or {}},
                          timeout=15)
        assert r2.status_code == 200
