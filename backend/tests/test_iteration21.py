"""Iteration 21 — Budget hebdomadaire + achalandage dans l'horaire IA.

Focus (per review request):
- GET/PUT /api/schedule/settings validation (400 / 403 / normalization / persistence).
- POST /api/schedule/generate error cases (400 invalid date, 400 no employees).
- ONE full IA generation with budget=1500 to verify estimated_cost > 0, alerts
  kind='profile' pour taux manquant, weekly_budget persisté sur la proposition.
- (Budget-exceeded case already validated by main agent via curl in the review
  request context to save LLM budget — see context_for_next_testing_agent.)
"""

import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@luminahr.ca", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def julie_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "julie@luminahr.ca", "password": "employe123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def julie_h(julie_token):
    return {"Authorization": f"Bearer {julie_token}", "Content-Type": "application/json"}


# ---------- GET/PUT /api/schedule/settings ----------
class TestScheduleSettings:
    def test_get_returns_shape(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/schedule/settings", headers=admin_h, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "weekly_budget" in j and "traffic" in j
        assert isinstance(j["traffic"], dict)

    def test_get_employee_ok(self, julie_h):
        # Every authenticated role can GET
        r = requests.get(f"{BASE_URL}/api/schedule/settings", headers=julie_h, timeout=15)
        assert r.status_code == 200

    def test_put_admin_normalizes_and_persists(self, admin_h):
        payload = {"weekly_budget": 2000,
                   "traffic": {"mon": {"matin": 40, "apres_midi": 25, "soir": 10},
                               "sat": {"matin": 60, "apres_midi": 30, "soir": 0}}}
        r = requests.put(f"{BASE_URL}/api/schedule/settings", json=payload, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["weekly_budget"] == 2000
        # 7 days normalized (missing days filled with zeros)
        for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
            assert d in j["traffic"]
            assert set(j["traffic"][d].keys()) == {"matin", "apres_midi", "soir"}
        assert j["traffic"]["mon"]["matin"] == 40
        assert j["traffic"]["sat"]["matin"] == 60
        assert j["traffic"]["tue"]["matin"] == 0
        # Persistence — GET reads back (traffic only; weekly_budget may be
        # overridden by a parallel generate test since POST /schedule/generate
        # rewrites schedule_settings.weekly_budget)
        g = requests.get(f"{BASE_URL}/api/schedule/settings", headers=admin_h, timeout=15).json()
        assert g["traffic"]["mon"]["apres_midi"] == 25
        assert g["traffic"]["sat"]["matin"] == 60

    def test_put_bounds_500(self, admin_h):
        # values > 500 should be clamped to 500 (bornées 0-500 per spec)
        r = requests.put(f"{BASE_URL}/api/schedule/settings",
                         json={"weekly_budget": 1000,
                               "traffic": {"mon": {"matin": 999}}}, headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["traffic"]["mon"]["matin"] == 500

    def test_put_negative_budget_400(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/schedule/settings",
                         json={"weekly_budget": -5, "traffic": {}}, headers=admin_h, timeout=15)
        assert r.status_code == 400

    def test_put_traffic_invalid_type_400(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/schedule/settings",
                         json={"weekly_budget": 1000,
                               "traffic": {"mon": {"matin": "abc"}}}, headers=admin_h, timeout=15)
        assert r.status_code == 400

    def test_put_forbidden_for_employee(self, julie_h):
        r = requests.put(f"{BASE_URL}/api/schedule/settings",
                         json={"weekly_budget": 500, "traffic": {}}, headers=julie_h, timeout=15)
        assert r.status_code == 403

    def test_cleanup_reset_to_zero(self, admin_h):
        # Restore to zero before generation test so the settings persisted there dominate
        r = requests.put(f"{BASE_URL}/api/schedule/settings",
                         json={"weekly_budget": 0, "traffic": {}}, headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["weekly_budget"] == 0


# ---------- POST /api/schedule/generate — error cases ----------
class TestScheduleGenerateErrors:
    def test_invalid_week_start_400(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/generate",
                          json={"week_start": "not-a-date", "employees": [
                              {"id": "e2", "name": "Julie Gagnon", "position": "ATP"}]},
                          headers=admin_h, timeout=15)
        assert r.status_code == 400

    def test_no_employees_400(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/schedule/generate",
                          json={"week_start": "2026-09-14", "employees": []},
                          headers=admin_h, timeout=15)
        assert r.status_code == 400

    def test_generate_forbidden_for_employee(self, julie_h):
        r = requests.post(f"{BASE_URL}/api/schedule/generate",
                          json={"week_start": "2026-09-14",
                                "employees": [{"id": "e2", "name": "Julie Gagnon", "position": "ATP"}]},
                          headers=julie_h, timeout=15)
        assert r.status_code == 403


# ---------- POST /api/schedule/generate — one full generation with budget ----------
class TestScheduleGenerateWithBudget:
    """Single real AI generation to conserve LLM budget."""
    proposal_id: str = ""

    def test_generate_kickoff_and_wait(self, admin_h):
        payload = {
            "week_start": "2026-09-14",
            "instructions": "",
            "approval_deadline_hours": 48,
            "weekly_budget": 1500,
            "absences": [],
            "employees": [
                {"id": "e1", "name": "Sophie Lavoie", "position": "Pharmacien(ne)"},
                {"id": "e2", "name": "Julie Gagnon", "position": "ATP"},
                {"id": "e3", "name": "Karim Benali", "position": "ATP"},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/schedule/generate", json=payload, headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "generating"
        assert j["weekly_budget"] == 1500
        assert j.get("estimated_cost") is None
        TestScheduleGenerateWithBudget.proposal_id = j["id"]

        # Poll GET /api/schedule/proposals every ~10s up to 120s
        pid = j["id"]
        proposal = None
        for _ in range(24):
            time.sleep(5)
            lst = requests.get(f"{BASE_URL}/api/schedule/proposals", headers=admin_h, timeout=15).json()
            proposal = next((p for p in lst if p["id"] == pid), None)
            if proposal and proposal.get("status") in ("pending_approval", "error"):
                break
        assert proposal is not None
        assert proposal["status"] == "pending_approval", f"IA a échoué: {proposal.get('error')}"
        # estimated_cost > 0 (Julie has rate)
        assert isinstance(proposal["estimated_cost"], (int, float))
        assert proposal["estimated_cost"] > 0
        assert proposal["weekly_budget"] == 1500

        alerts = proposal.get("alerts") or []
        shifts = proposal.get("shifts") or []
        assert len(shifts) > 0
        scheduled_ids = {s["employee_id"] for s in shifts}
        # If Sophie (e1) or Karim (e3) was scheduled, we expect a
        # 'Taux horaire manquant' alert. If IA only scheduled Julie (e2, has
        # a rate) to fit the 1500$ budget, no missing-rate alert is expected.
        if scheduled_ids & {"e1", "e3"}:
            missing = [a for a in alerts if a.get("kind") == "profile"
                       and "Taux horaire manquant" in a.get("text", "")]
            assert len(missing) >= 1, (
                f"attendu au moins 1 alerte 'Taux horaire manquant' "
                f"(scheduled ids={scheduled_ids}), got alerts={alerts}")
        for s in shifts:
            assert s["employee_id"] in {"e1", "e2", "e3"}

    def test_cleanup_delete_proposal(self, admin_h):
        pid = TestScheduleGenerateWithBudget.proposal_id
        if not pid:
            pytest.skip("no proposal created")
        r = requests.delete(f"{BASE_URL}/api/schedule/proposals/{pid}", headers=admin_h, timeout=15)
        assert r.status_code in (200, 204)


# ---------- Regression: demo proposal 2026-08-03 still present ----------
class TestRegressionDemo:
    def test_demo_proposal_still_listed(self, admin_h):
        lst = requests.get(f"{BASE_URL}/api/schedule/proposals", headers=admin_h, timeout=15).json()
        demo = [p for p in lst if p.get("week_start") == "2026-08-03"]
        assert len(demo) >= 1, "propositions démo 2026-08-03 disparues"
        for p in demo:
            # they may not have estimated_cost — must not crash
            assert "id" in p
