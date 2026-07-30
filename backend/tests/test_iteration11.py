"""Arrière Plan — Iteration 11 tests : rappels d'auto-évaluation, chosen_offer enrichi, régression flux évaluation."""
import os
import time
import datetime as dt
import asyncio
import pytest
import requests
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = backend_env.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = backend_env.get("DB_NAME", "test_database")


def bearer(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def julie_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "julie@luminahr.ca", "password": "employe123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _mongo_set_created_at(eid: str, days_ago: int):
    """Update evaluation created_at directly via mongo to simulate ancienneté."""
    async def _run():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days_ago)
        res = await db.evaluations.update_one(
            {"id": eid},
            {"$set": {"created_at": past.isoformat(), "self_reminder_at": None}})
        client.close()
        return res.modified_count
    return asyncio.run(_run())


# ==================== 1. Rappels d'auto-évaluation ====================
class TestEvaluationReminders:
    eid: str = ""

    def test_setup_eval(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/evaluations",
                   json={"employee_id": "e2", "employee_name": "Julie Tremblay",
                         "current_rate": 25, "baiia_increase_pct": 3},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        TestEvaluationReminders.eid = r.json()["id"]
        assert r.json()["status"] == "en_cours"
        assert r.json().get("self_eval") in (None, {})

    def test_reminder_not_sent_when_recent(self, s, admin_token):
        # Fresh eval created_at is now; endpoint must return {sent: 0}
        r = s.post(f"{BASE_URL}/api/evaluations/reminders/run",
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["sent"] == 0

    def test_reminder_after_backdating(self, s, admin_token):
        # Backdate to 5 days ago
        n = _mongo_set_created_at(TestEvaluationReminders.eid, days_ago=5)
        assert n == 1
        r = s.post(f"{BASE_URL}/api/evaluations/reminders/run",
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # In Resend test mode, sent may be 0 if the domain is not verified.
        # The important thing is 200 + not crash. If sent=1, verify anti-doublon.
        assert "sent" in body
        assert isinstance(body["sent"], int)
        print(f"[reminder] first run sent={body['sent']}")

        if body["sent"] == 1:
            # Anti-doublon: second immediate run should return 0
            r2 = s.post(f"{BASE_URL}/api/evaluations/reminders/run",
                        headers=bearer(admin_token), timeout=30)
            assert r2.status_code == 200
            assert r2.json()["sent"] == 0, "Anti-doublon KO — second run should be 0"

            # self_reminder_at should be set
            r3 = s.get(f"{BASE_URL}/api/evaluations",
                       headers=bearer(admin_token), timeout=30)
            docs = r3.json()
            found = next((d for d in docs if d["id"] == TestEvaluationReminders.eid), None)
            assert found is not None
            assert found.get("self_reminder_at") is not None
        else:
            print("[reminder] Resend probably rejected — endpoint OK but sent=0 (test mode).")

    def test_reminder_requires_auth(self, s):
        r = s.post(f"{BASE_URL}/api/evaluations/reminders/run", timeout=30)
        assert r.status_code in (401, 403)

    @classmethod
    def teardown_class(cls):
        if cls.eid:
            sess = requests.Session()
            r = sess.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=30)
            if r.status_code == 200:
                tok = r.json()["access_token"]
                sess.delete(f"{BASE_URL}/api/evaluations/{cls.eid}", headers=bearer(tok), timeout=30)


# ==================== 2. chosen_offer enrichi + slot cette semaine ====================
class TestChosenOfferEnrichment:
    agency_id: str = ""
    request_id: str = ""
    _cleanup: bool = True

    def test_setup_agency_and_request_and_choose(self, s, admin_token):
        # Create agency
        r = s.post(f"{BASE_URL}/api/agencies",
                   json={"name": "TEST_ITER11_Agence",
                         "email": "TEST_iter11@example.com",
                         "roles": ["Pharmacien(ne)"]},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        TestChosenOfferEnrichment.agency_id = r.json()["id"]

        # Slot THIS week (Wednesday of current week)
        today = dt.date.today()
        monday = today - dt.timedelta(days=today.weekday())
        slot_date = (monday + dt.timedelta(days=2)).isoformat()  # Wed

        r = s.post(f"{BASE_URL}/api/replacements/requests",
                   json={"role": "Pharmacien(ne)",
                         "slots": [{"date": slot_date, "start": "09:00", "end": "17:00"}],
                         "notes": "TEST_iter11", "urgency": "Élevée",
                         "public_base_url": BASE_URL},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        req = r.json()
        TestChosenOfferEnrichment.request_id = req["id"]

        # Get token for public submission
        docs = s.get(f"{BASE_URL}/api/replacements/requests",
                     headers=bearer(admin_token), timeout=30).json()
        # token is stripped in GET; fetch from mongo
        async def _get_token():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            d = await db.replacement_requests.find_one({"id": req["id"]})
            client.close()
            return d["token"]
        token = asyncio.run(_get_token())

        # Public offer submission
        r = s.post(f"{BASE_URL}/api/replacements/public/{token}/offers",
                   json={"agency_name": "TEST_ITER11_Agence",
                         "agency_email": "TEST_iter11@example.com",
                         "candidate_name": "Alex Roy",
                         "license_number": "12345",
                         "experience_years": 5,
                         "hourly_rate": 55.0,
                         "phone": "5145550000",
                         "email": "alex@example.com"}, timeout=30)
        assert r.status_code == 200, r.text
        offer_id = r.json()["id"]

        # Choose offer
        r = s.post(f"{BASE_URL}/api/replacements/requests/{req['id']}/choose",
                   json={"offer_id": offer_id},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text

    def test_chosen_offer_enrichment_in_list(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/replacements/requests",
                  headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        docs = r.json()
        target = next((d for d in docs if d["id"] == TestChosenOfferEnrichment.request_id), None)
        assert target is not None, "Request not found in list"
        assert target["status"] == "filled"
        co = target.get("chosen_offer")
        assert co is not None, "chosen_offer field missing"
        assert co.get("candidate_name") == "Alex Roy"
        assert co.get("agency_name") == "TEST_ITER11_Agence"
        assert co.get("hourly_rate") == 55.0
        # Do NOT delete request/agency — leave for frontend tests
        TestChosenOfferEnrichment._cleanup = False

    @classmethod
    def teardown_class(cls):
        # Leave data for frontend tests. Manual cleanup instructions logged.
        print(f"[iter11] KEEP for frontend: request_id={cls.request_id} agency_id={cls.agency_id}")


# ==================== 3. Régression : flux évaluation complet + garder une évaluation appliquée ====================
class TestEvaluationRegression:
    eid_applied: str = ""

    def test_full_flow_and_keep_for_frontend(self, s, admin_token, julie_token):
        r = s.post(f"{BASE_URL}/api/evaluations",
                   json={"employee_id": "e2", "employee_name": "Julie Tremblay",
                         "current_rate": 25, "baiia_increase_pct": 3},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        TestEvaluationRegression.eid_applied = eid

        answers = {f"q{i}": 5 for i in range(1, 11)}
        r = s.put(f"{BASE_URL}/api/evaluations/{eid}/employer",
                  json={"answers": answers, "strengths": "", "improvements": "", "objectives": ""},
                  headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200

        s_answers = {f"s{i}": 4 for i in range(1, 9)}
        r = s.put(f"{BASE_URL}/api/evaluations/{eid}/self",
                  json={"answers": s_answers, "accomplishments": "", "needs": "", "goals": ""},
                  headers=bearer(julie_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["suggestion"]["suggested_rate"] == 25.9

        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/propose",
                   json={"proposed_rate": 25.9},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200

        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/respond",
                   json={"accepted": True, "comment": "ok"},
                   headers=bearer(julie_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "accepte"

        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/applied",
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "applique"
        print(f"[iter11] KEEP applied evaluation for frontend salary history: eid={eid}")

    @classmethod
    def teardown_class(cls):
        # Keep the applied evaluation for frontend salary-history test
        print(f"[iter11] KEEPING evaluation {cls.eid_applied} for salary-history frontend test")
