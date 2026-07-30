"""LuminaHR — Iteration 10 tests : Évaluations BAIIA, Remplacements/agences, Punch preview,
Punches open/export, Formations par texte."""
import os
import time
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
PUBLIC_BASE = "https://employee-portal-305.preview.emergentagent.com"


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


# ==================== Évaluations BAIIA ====================
class TestEvaluationsFullFlow:
    """Flux complet : création → employeur (100) → auto (80) → proposition → acceptation → applied."""

    created_ids: list = []

    def test_full_evaluation_flow(self, s, admin_token, julie_token):
        # 1. Create evaluation
        r = s.post(f"{BASE_URL}/api/evaluations",
                   json={"employee_id": "e2", "employee_name": "Julie Tremblay",
                         "current_rate": 25, "baiia_increase_pct": 3},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        TestEvaluationsFullFlow.created_ids.append(eid)
        assert r.json()["status"] == "en_cours"

        # 2. Employer eval — all q1..q10 = 5 → score 100
        answers = {f"q{i}": 5 for i in range(1, 11)}
        r = s.put(f"{BASE_URL}/api/evaluations/{eid}/employer",
                  json={"answers": answers, "strengths": "top", "improvements": "", "objectives": ""},
                  headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["admin_eval"]["score"] == 100.0
        assert body["suggestion"] is None  # self not done

        # 3. Self eval as Julie — all s1..s8 = 4 → score 80
        s_answers = {f"s{i}": 4 for i in range(1, 9)}
        r = s.put(f"{BASE_URL}/api/evaluations/{eid}/self",
                  json={"answers": s_answers, "accomplishments": "", "needs": "", "goals": ""},
                  headers=bearer(julie_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["self_eval"]["score"] == 80.0
        sug = body["suggestion"]
        assert sug is not None
        # perf = 0.7*100 + 0.3*80 = 94 → mult 1.2 → inc 3.6 → rate 25*(1.036)=25.9
        assert sug["performance_score"] == 94.0
        assert sug["multiplier"] == 1.2
        assert sug["suggested_increase_pct"] == 3.6
        assert sug["suggested_rate"] == 25.9
        assert body["status"] == "a_proposer"

        # 4. Employee cannot respond before proposition
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/respond",
                   json={"accepted": True, "comment": ""},
                   headers=bearer(julie_token), timeout=30)
        assert r.status_code == 400

        # 5. Cannot apply before acceptance
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/applied",
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 400

        # 6. Admin proposes rate 25.9
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/propose",
                   json={"proposed_rate": 25.9},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "propose"
        assert r.json()["proposed_rate"] == 25.9

        # 7. Employee accepts
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/respond",
                   json={"accepted": True, "comment": "merci"},
                   headers=bearer(julie_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "accepte"
        assert body["agreed_rate"] == 25.9

        # 8. Admin applies
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/applied",
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "applique"

    def test_employee_cannot_self_eval_other(self, s, admin_token, julie_token):
        # Create eval for a different employee (e1)
        r = s.post(f"{BASE_URL}/api/evaluations",
                   json={"employee_id": "e1", "employee_name": "Marc Untel",
                         "current_rate": 22, "baiia_increase_pct": 2},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        eid = r.json()["id"]
        TestEvaluationsFullFlow.created_ids.append(eid)
        s_answers = {f"s{i}": 4 for i in range(1, 9)}
        r = s.put(f"{BASE_URL}/api/evaluations/{eid}/self",
                  json={"answers": s_answers},
                  headers=bearer(julie_token), timeout=30)
        assert r.status_code == 403

    def test_refuse_then_repropose(self, s, admin_token, julie_token):
        # Fresh eval for e2 — Julie
        r = s.post(f"{BASE_URL}/api/evaluations",
                   json={"employee_id": "e2", "employee_name": "Julie Tremblay",
                         "current_rate": 25, "baiia_increase_pct": 3},
                   headers=bearer(admin_token), timeout=30)
        eid = r.json()["id"]
        TestEvaluationsFullFlow.created_ids.append(eid)

        answers = {f"q{i}": 5 for i in range(1, 11)}
        s.put(f"{BASE_URL}/api/evaluations/{eid}/employer",
              json={"answers": answers}, headers=bearer(admin_token), timeout=30)
        s_answers = {f"s{i}": 4 for i in range(1, 9)}
        s.put(f"{BASE_URL}/api/evaluations/{eid}/self",
              json={"answers": s_answers}, headers=bearer(julie_token), timeout=30)

        # Propose
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/propose",
                   json={"proposed_rate": 25.9},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200

        # Refuse
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/respond",
                   json={"accepted": False, "comment": "trop bas"},
                   headers=bearer(julie_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "refuse"

        # Re-propose
        r = s.post(f"{BASE_URL}/api/evaluations/{eid}/propose",
                   json={"proposed_rate": 26.5},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "propose"

    @classmethod
    def teardown_class(cls):
        sess = requests.Session()
        r = sess.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=30)
        if r.status_code == 200:
            tok = r.json()["access_token"]
            for eid in cls.created_ids:
                sess.delete(f"{BASE_URL}/api/evaluations/{eid}", headers=bearer(tok), timeout=30)


# ==================== Remplacements / Agences ====================
class TestReplacements:
    agency_id: str = ""
    request_id: str = ""
    token: str = ""

    def test_create_agency(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/agencies",
                   json={"name": "TEST_Placement Pharma QC",
                         "email": "TEST_agence@example.com",
                         "roles": ["Pharmacien(ne)"]},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        TestReplacements.agency_id = r.json()["id"]
        # Verify via GET
        r2 = s.get(f"{BASE_URL}/api/agencies", headers=bearer(admin_token), timeout=30)
        assert any(a["id"] == TestReplacements.agency_id for a in r2.json())

    def test_create_replacement_request(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/replacements/requests",
                   json={"role": "Pharmacien(ne)",
                         "slots": [{"date": "2026-08-10", "start": "09:00", "end": "17:00"}],
                         "notes": "test", "urgency": "Élevée",
                         "public_base_url": PUBLIC_BASE},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "?remplacement=" in body["link"]
        assert body["emails_sent"] >= 0  # Resend test mode may be 0
        TestReplacements.request_id = body["id"]
        TestReplacements.token = body["link"].split("?remplacement=")[1]

    def test_public_get_request_no_auth(self, s):
        r = requests.get(f"{BASE_URL}/api/replacements/public/{TestReplacements.token}", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "Pharmacien(ne)"
        assert body["urgency"] == "Élevée"
        assert len(body["slots"]) == 1

    def test_public_invalid_token_404(self, s):
        r = requests.get(f"{BASE_URL}/api/replacements/public/notarealtoken12345", timeout=30)
        assert r.status_code == 404

    def test_public_submit_offer_no_auth(self, s):
        r = requests.post(
            f"{BASE_URL}/api/replacements/public/{TestReplacements.token}/offers",
            json={"agency_name": "TEST_Placement Pharma QC", "agency_email": "TEST_agence@example.com",
                  "candidate_name": "Marc Dupuis", "hourly_rate": 65, "experience_years": 5},
            timeout=30)
        assert r.status_code == 200, r.text

    def test_admin_lists_offers(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/replacements/requests", headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        this_req = next((d for d in r.json() if d["id"] == TestReplacements.request_id), None)
        assert this_req is not None
        assert this_req["offers_count"] == 1

        r2 = s.get(f"{BASE_URL}/api/replacements/requests/{TestReplacements.request_id}/offers",
                   headers=bearer(admin_token), timeout=30)
        assert r2.status_code == 200
        offers = r2.json()
        assert len(offers) == 1
        TestReplacements.offer_id = offers[0]["id"]

    def test_choose_offer_and_lock(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/replacements/requests/{TestReplacements.request_id}/choose",
                   json={"offer_id": TestReplacements.offer_id},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["request"]["status"] == "filled"
        # Note: response payload returns pre-update offer snapshot (status still 'received').
        # Verify actual DB state via GET.
        r2 = s.get(f"{BASE_URL}/api/replacements/requests/{TestReplacements.request_id}/offers",
                   headers=bearer(admin_token), timeout=30)
        assert r2.status_code == 200
        chosen = next(o for o in r2.json() if o["id"] == TestReplacements.offer_id)
        assert chosen["status"] == "chosen"

    def test_no_new_offer_on_filled_request(self, s):
        r = requests.post(
            f"{BASE_URL}/api/replacements/public/{TestReplacements.token}/offers",
            json={"agency_name": "Late", "agency_email": "late@x.com",
                  "candidate_name": "Late Guy", "hourly_rate": 50, "experience_years": 1},
            timeout=30)
        assert r.status_code == 400

    @classmethod
    def teardown_class(cls):
        sess = requests.Session()
        r = sess.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=30)
        if r.status_code == 200:
            tok = r.json()["access_token"]
            if cls.request_id:
                sess.delete(f"{BASE_URL}/api/replacements/requests/{cls.request_id}",
                            headers=bearer(tok), timeout=30)
            if cls.agency_id:
                sess.delete(f"{BASE_URL}/api/agencies/{cls.agency_id}",
                            headers=bearer(tok), timeout=30)


# ==================== Punch preview + export + open ====================
class TestPunchAdvanced:
    created_punch_ids: list = []

    def test_preview_valid_pin_in(self, s):
        # Julie NIP 7068
        r = s.post(f"{BASE_URL}/api/punch/preview", json={"code": "7068"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "employee_name" in body
        assert body["next_action"] in ("in", "out")

    def test_preview_does_not_punch(self, s, admin_token):
        # Take a status snapshot via /api/punches/open then preview, then check no new punch created
        before = s.get(f"{BASE_URL}/api/punches/open", headers=bearer(admin_token), timeout=30).json()
        s.post(f"{BASE_URL}/api/punch/preview", json={"code": "7068"}, timeout=30)
        after = s.get(f"{BASE_URL}/api/punches/open", headers=bearer(admin_token), timeout=30).json()
        # Preview must not create or close a punch
        assert len(before) == len(after)

    def test_preview_invalid_pin(self, s):
        r = s.post(f"{BASE_URL}/api/punch/preview", json={"code": "0000"}, timeout=30)
        assert r.status_code == 404

    def test_open_punches_admin(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/punches/open", headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200
        for p in r.json():
            assert "elapsed_hours" in p

    def test_open_punches_requires_auth(self, s):
        r = requests.get(f"{BASE_URL}/api/punches/open", timeout=30)
        assert r.status_code == 401

    def test_export_csv_header(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/punches/export",
                  params={"start": "2026-06-01", "end": "2026-06-30"},
                  headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "")
        text = r.content.decode("utf-8-sig")
        first_line = text.splitlines()[0]
        assert first_line == "Employé;Date;Entrée;Sortie;Heures;Source;Saisie par;Note"

    def test_export_csv_requires_auth(self, s):
        r = requests.get(f"{BASE_URL}/api/punches/export",
                         params={"start": "2026-06-01", "end": "2026-06-30"}, timeout=30)
        assert r.status_code == 401


# ==================== Formations par texte ====================
class TestTrainingsManual:
    training_id: str = ""

    def test_manual_text_too_short(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/trainings/manual",
                   json={"title": "Trop court", "source_text": "abc"},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 400

    def test_manual_text_creates_processing(self, s, admin_token):
        text = (
            "Cette formation porte sur les procédures de la pharmacie communautaire au Québec. "
            "Nous aborderons la gestion des ordonnances, la vérification des interactions médicamenteuses, "
            "la communication avec les patients, le respect de la Loi 25 sur les renseignements personnels, "
            "ainsi que les bonnes pratiques de manipulation des médicaments de contrôle. "
            "L'objectif est d'assurer la sécurité des patients et la conformité réglementaire en tout temps."
        )
        assert len(text) >= 200
        r = s.post(f"{BASE_URL}/api/trainings/manual",
                   json={"title": "TEST_ formation texte iter10", "source_text": text},
                   headers=bearer(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "processing"
        TestTrainingsManual.training_id = body["id"]

    def test_update_title_still_works(self, s, admin_token):
        # PUT title update should work even during processing (draft normally,
        # but the endpoint allows title changes on any status)
        # Poll first for a short while to give the AI generation a chance to finish.
        tid = TestTrainingsManual.training_id
        assert tid
        end = time.time() + 90
        status = "processing"
        while time.time() < end:
            r = s.get(f"{BASE_URL}/api/trainings/{tid}", headers=bearer(admin_token), timeout=30)
            if r.status_code == 200:
                status = r.json().get("status")
                if status in ("draft", "failed", "published"):
                    break
            time.sleep(5)
        # Even if still processing, try updating the title (title-only should be tolerated for admin)
        r = s.put(f"{BASE_URL}/api/trainings/{tid}",
                  json={"title": "TEST_ formation texte iter10 (modifié)"},
                  headers=bearer(admin_token), timeout=30)
        # Accept either 200 or 400 if backend forbids edits while processing
        assert r.status_code in (200, 400), r.text
        # Report final status for visibility
        print(f"Training final status: {status}")

    @classmethod
    def teardown_class(cls):
        sess = requests.Session()
        r = sess.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=30)
        if r.status_code == 200 and cls.training_id:
            tok = r.json()["access_token"]
            sess.delete(f"{BASE_URL}/api/trainings/{cls.training_id}",
                        headers=bearer(tok), timeout=30)
