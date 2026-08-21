"""Itération 46 — Batterie complète : sécurité hr-state, employee_name sur quarts, auth,
horaires, IA, punch, paie/exports, congés, tâches, avantages, formations, notifications, perf."""
import os
import re
import time
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL manquant")
BASE_URL = base_url.rstrip("/")

ADMIN_EMAIL = "admin@luminahr.ca"
JULIE_EMAIL = "julie@luminahr.ca"
MANAGER_EMAIL = "gestion@luminahr.ca"
SUPERADMIN_EMAIL = "jeffmenard78@hotmail.com"


def _creds():
    content = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    rows = re.findall(r"\|\s*([^|]+?)\s*\|\s*([\w.\-]+@[\w.\-]+)\s*\|\s*(\S+)\s*\|", content)
    out = {}
    for _role, email, pwd in rows:
        out.setdefault(email, pwd)
    return out


CREDS = _creds()


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email):
    pwd = CREDS.get(email)
    if not pwd:
        pytest.fail(f"Aucun mot de passe pour {email}")
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Login {email}: {r.status_code} {r.text[:300]}")
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(session):
    return _login(session, ADMIN_EMAIL)


@pytest.fixture(scope="session")
def julie_token(session):
    return _login(session, JULIE_EMAIL)


@pytest.fixture(scope="session")
def manager_token(session):
    return _login(session, MANAGER_EMAIL)


@pytest.fixture(scope="session")
def superadmin_token(session):
    return _login(session, SUPERADMIN_EMAIL)


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- Authentification ----------
class TestAuth:
    def test_login_roles(self, admin_token, julie_token, manager_token, superadmin_token):
        for tok in (admin_token, julie_token, manager_token, superadmin_token):
            assert isinstance(tok, str) and len(tok) > 20

    def test_bad_password(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login",
                         json={"email": "inexistant_qa46@example.com", "password": "Mauvais123!"}, timeout=30)
        # 429 accepté : protection anti-force brute déjà déclenchée pour cette IP/adresse fictive
        assert r.status_code in (401, 403, 429), r.text[:200]

    def test_me(self, session, admin_token, julie_token):
        r = session.get(f"{BASE_URL}/api/auth/me", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL
        assert r.json()["role"] in ("admin", "manager", "superadmin")
        r2 = session.get(f"{BASE_URL}/api/auth/me", headers=H(julie_token), timeout=30)
        assert r2.status_code == 200 and r2.json()["role"] == "employee"

    def test_me_without_token(self, session):
        r = session.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code in (401, 403)

    def test_security_settings_defaults(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/security-settings", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json().get("mfa_required") is False, "mfa_required doit rester false"


# ---------- PRIORITÉ 2 : sécurité PUT /api/hr-state ----------
class TestHrStateSecurity:
    def test_employee_put_does_not_wipe_sensitive_lists(self, session, admin_token, julie_token):
        before = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=60)
        assert before.status_code == 200
        st_before = before.json().get("state") or {}
        emp_count_before = len(st_before.get("employees") or [])
        assert emp_count_before >= 3, f"attendu >=3 employés au départ, obtenu {emp_count_before}"

        r = session.put(f"{BASE_URL}/api/hr-state",
                        json={"state": {"employees": [], "payrollEntries": [],
                                        "shiftSwaps": [{"id": "sectest"}]}},
                        headers=H(julie_token), timeout=60)
        assert r.status_code == 200, r.text[:300]

        after = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=60)
        st_after = after.json().get("state") or {}
        assert len(st_after.get("employees") or []) == emp_count_before, "employees écrasé par un employé !"
        assert len(st_after.get("payrollEntries") or []) == len(st_before.get("payrollEntries") or [])
        assert any(s.get("id") == "sectest" for s in (st_after.get("shiftSwaps") or [])), \
            "shiftSwaps (liste autorisée) doit être fusionné"

        # NETTOYAGE : retirer sectest via admin
        st_after["shiftSwaps"] = [s for s in (st_after.get("shiftSwaps") or []) if s.get("id") != "sectest"]
        c = session.put(f"{BASE_URL}/api/hr-state", json={"state": st_after},
                        headers=H(admin_token), timeout=60)
        assert c.status_code == 200
        final = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=60).json()["state"]
        assert not any(s.get("id") == "sectest" for s in (final.get("shiftSwaps") or []))
        assert len(final.get("employees") or []) == emp_count_before


# ---------- PRIORITÉ 3 : employee_name sur les quarts ----------
class TestShiftEmployeeName:
    def test_post_shift_stores_employee_name(self, session, admin_token):
        sid = "TEST_it46_shift"
        payload = {"id": sid, "employee_id": "e2", "employee_name": "Julie Tremblay",
                   "date": "2026-09-15", "start": "09:00", "end": "17:00",
                   "role": "ATP", "branch_id": "br1"}
        r = session.post(f"{BASE_URL}/api/shifts", json=payload, headers=H(admin_token), timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        body = r.json()
        doc = body.get("shift") if isinstance(body, dict) and "shift" in body else body
        if isinstance(doc, dict) and "employee_name" in doc:
            assert doc["employee_name"] == "Julie Tremblay"
        g = session.get(f"{BASE_URL}/api/shifts", headers=H(admin_token), timeout=30)
        found = [s for s in g.json()["shifts"] if s.get("id") == sid]
        assert found, "quart créé absent du GET"
        assert found[0].get("employee_name") == "Julie Tremblay"
        d = session.delete(f"{BASE_URL}/api/shifts/{sid}", headers=H(admin_token), timeout=30)
        assert d.status_code in (200, 204)

    def test_employee_cannot_write_shifts(self, session, julie_token):
        r = session.post(f"{BASE_URL}/api/shifts",
                         json={"id": "TEST_it46_forbidden", "employee_id": "e2", "date": "2026-09-16",
                               "start": "09:00", "end": "12:00"},
                         headers=H(julie_token), timeout=30)
        assert r.status_code == 403, r.text[:200]


# ---------- Horaires / publication / budgets ----------
class TestSchedule:
    def test_settings(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/schedule/settings", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "weekly_budget" in body

    def test_publish_week(self, session, admin_token):
        r = session.post(f"{BASE_URL}/api/schedule/publish",
                         json={"week_start": "2026-09-07",
                               "recipients": [{"employee_id": "e2", "employee_name": "Julie Tremblay",
                                               "shift_count": 2, "hours": 16}]},
                         headers=H(admin_token), timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert "updated" in r.json() or r.json().get("ok")

    def test_publish_forbidden_for_employee(self, session, julie_token):
        r = session.post(f"{BASE_URL}/api/schedule/publish",
                         json={"week_start": "2026-09-07", "recipients": []},
                         headers=H(julie_token), timeout=30)
        assert r.status_code == 403

    def test_templates_list(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/schedule/templates", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))


# ---------- Génération d'horaire IA ----------
class TestScheduleAI:
    def test_generate_and_delete(self, session, admin_token):
        r = session.post(f"{BASE_URL}/api/schedule/generate",
                         json={"week_start": "2026-09-07", "instructions": "Test QA it46",
                               "approval_deadline_hours": 48,
                               "employees": [
                                   {"id": "e2", "name": "Julie Gagnon", "position": "ATP",
                                    "branch_id": "br1", "branch_name": "Succursale principale"},
                                   {"id": "e1", "name": "Marc Lavoie", "position": "Pharmacien",
                                    "branch_id": "br1", "branch_name": "Succursale principale"},
                               ]},
                         headers=H(admin_token), timeout=300)
        assert r.status_code == 200, r.text[:500]
        prop = r.json()
        pid = prop.get("id") or (prop.get("proposal") or {}).get("id")
        assert pid, f"pas d'id de proposition: {str(prop)[:300]}"
        # génération asynchrone : attendre la fin (status generating -> pending_approval)
        doc = None
        for _ in range(30):
            time.sleep(6)
            lst = session.get(f"{BASE_URL}/api/schedule/proposals", headers=H(admin_token), timeout=60)
            assert lst.status_code == 200
            items = lst.json() if isinstance(lst.json(), list) else lst.json().get("proposals", [])
            match = [p for p in items if p.get("id") == pid]
            assert match, "proposition absente de la liste"
            doc = match[0]
            if doc.get("status") != "generating":
                break
        assert doc and doc.get("status") != "generating", "génération IA jamais terminée (>180 s)"
        assert doc.get("status") != "error", f"génération en erreur: {str(doc)[:300]}"
        shifts = doc.get("shifts") or []
        assert len(shifts) > 0, "proposition sans quarts"
        assert "estimated_cost" in doc, "coût estimé absent"
        assert isinstance(doc.get("alerts", []), list)

        d = session.delete(f"{BASE_URL}/api/schedule/proposals/{pid}", headers=H(admin_token), timeout=60)
        assert d.status_code in (200, 204), d.text[:200]


# ---------- Punch ----------
class TestPunch:
    PIN = "7068"

    def test_preview_and_punch_cycle(self, session, admin_token):
        p = session.post(f"{BASE_URL}/api/punch/preview", json={"code": self.PIN}, timeout=60)
        assert p.status_code == 200, p.text[:300]
        body = p.json()
        assert body.get("employee_name")
        assert body.get("next_action") in ("in", "out")
        first = body["next_action"]

        r1 = session.post(f"{BASE_URL}/api/punch", json={"code": self.PIN}, timeout=60)
        assert r1.status_code == 200, r1.text[:300]
        assert r1.json().get("action") in ("in", "out")

        r2 = session.post(f"{BASE_URL}/api/punch", json={"code": self.PIN}, timeout=60)
        assert r2.status_code == 200, r2.text[:300]
        assert r2.json().get("action") != r1.json().get("action"), "le 2e punch doit inverser l'action"
        # remise en état : si on a commencé par 'in', le 2e punch a fermé l'entrée => état initial
        assert first in ("in", "out")

    def test_bad_pin(self, session):
        r = session.post(f"{BASE_URL}/api/punch/preview", json={"code": "0000"}, timeout=30)
        assert r.status_code in (400, 401, 404, 429), r.text[:200]

    def test_summary_admin(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/punches/summary?start=2026-08-01&end=2026-08-31",
                        headers=H(admin_token), timeout=60)
        assert r.status_code == 200, r.text[:300]

    def test_punch_settings(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/punch/settings", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        assert "rounding_minutes" in r.json()


# ---------- Paie & exports ----------
class TestPayroll:
    @pytest.mark.parametrize("fmt", ["nethris", "adp", "employeurd"])
    def test_export_payroll(self, session, admin_token, fmt):
        r = session.get(f"{BASE_URL}/api/punches/export-payroll?format={fmt}&start=2026-07-01&end=2026-08-31",
                        headers=H(admin_token), timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert len(r.content) > 0

    def test_export_forbidden_employee(self, session, julie_token):
        r = session.get(f"{BASE_URL}/api/punches/export-payroll?format=nethris&start=2026-07-01&end=2026-08-31",
                        headers=H(julie_token), timeout=60)
        assert r.status_code == 403

    def test_budgets_report_csv(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/payroll/budget-export?start=2026-08-01&end=2026-08-31",
                        headers=H(admin_token), timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert len(r.content) > 0

    def test_pay_settings(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/pay-settings", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json().get("period_type") in ("weekly", "biweekly")


# ---------- Congés ----------
class TestLeave:
    def test_request_approve_flow(self, session, admin_token, julie_token):
        r = session.post(f"{BASE_URL}/api/leave/requests",
                         json={"type": "Vacances", "start_date": "2026-11-16", "end_date": "2026-11-17",
                               "reason": "TEST_it46"},
                         headers=H(julie_token), timeout=60)
        assert r.status_code in (200, 201), r.text[:300]
        body = r.json()
        rid = body.get("id") or (body.get("request") or {}).get("id")
        assert rid, str(body)[:300]

        mine = session.get(f"{BASE_URL}/api/leave/requests", headers=H(julie_token), timeout=60)
        assert mine.status_code == 200
        items = mine.json() if isinstance(mine.json(), list) else mine.json().get("requests", [])
        assert any(x.get("id") == rid for x in items)

        dec = session.post(f"{BASE_URL}/api/leave/requests/{rid}/decide",
                           json={"action": "approve", "note": "TEST_it46 ok"},
                           headers=H(admin_token), timeout=60)
        assert dec.status_code == 200, dec.text[:300]

        allr = session.get(f"{BASE_URL}/api/leave/requests", headers=H(admin_token), timeout=60)
        items = allr.json() if isinstance(allr.json(), list) else allr.json().get("requests", [])
        target = [x for x in items if x.get("id") == rid]
        assert target, "demande introuvable côté admin"
        assert str(target[0].get("status", "")).lower() in ("approved", "approuvé", "approuvée", "approuve"), target[0].get("status")

        # nettoyage
        session.delete(f"{BASE_URL}/api/leave/requests/{rid}", headers=H(admin_token), timeout=60)

    def test_balances(self, session, julie_token):
        r = session.get(f"{BASE_URL}/api/leave/balances", headers=H(julie_token), timeout=60)
        assert r.status_code == 200, r.text[:300]

    def test_policy(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/leave/policy", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        assert "carryover_enabled" in r.json()


# ---------- Tâches ----------
class TestTasks:
    def test_tasks_list_stats_goal(self, session, admin_token, julie_token):
        r = session.get(f"{BASE_URL}/api/tasks?start=2026-08-17&end=2026-08-23",
                        headers=H(admin_token), timeout=30)
        assert r.status_code == 200, r.text[:200]
        s = session.get(f"{BASE_URL}/api/tasks/stats?start=2026-08-17&end=2026-08-23",
                        headers=H(admin_token), timeout=30)
        assert s.status_code == 200
        g = session.get(f"{BASE_URL}/api/tasks/goal?start=2026-08-17", headers=H(admin_token), timeout=30)
        assert g.status_code == 200
        assert "target" in g.json()
        hr = session.get(f"{BASE_URL}/api/tasks/honor-roll?month=2026-08", headers=H(julie_token), timeout=30)
        assert hr.status_code == 200

    def test_task_create_toggle_delete(self, session, admin_token, julie_token):
        payload = {"date": "2026-08-21", "shift": "Jour", "title": "TEST_it46 Nettoyer le labo",
                   "assignee_employee_id": "e2", "assignee_name": "Julie Gagnon"}
        r = session.post(f"{BASE_URL}/api/tasks", json=payload, headers=H(admin_token), timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        body = r.json()
        tid = body.get("id") or (body.get("task") or {}).get("id")
        assert tid

        # l'employée voit la tâche et peut la cocher
        g = session.get(f"{BASE_URL}/api/tasks?start=2026-08-21&end=2026-08-21",
                        headers=H(julie_token), timeout=30)
        assert g.status_code == 200
        items = g.json() if isinstance(g.json(), list) else g.json().get("tasks", [])
        mine = [x for x in items if x.get("id") == tid]
        assert mine, "tâche assignée invisible pour l'employée"
        assert mine[0].get("done") in (False, None)

        tg = session.post(f"{BASE_URL}/api/tasks/{tid}/toggle", json={}, headers=H(julie_token), timeout=30)
        assert tg.status_code == 200, tg.text[:300]
        g2 = session.get(f"{BASE_URL}/api/tasks?start=2026-08-21&end=2026-08-21",
                         headers=H(julie_token), timeout=30)
        items2 = g2.json() if isinstance(g2.json(), list) else g2.json().get("tasks", [])
        assert [x for x in items2 if x.get("id") == tid][0].get("done") is True, "toggle non persisté"

        d = session.delete(f"{BASE_URL}/api/tasks/{tid}", headers=H(admin_token), timeout=30)
        assert d.status_code in (200, 204), d.text[:200]
        g3 = session.get(f"{BASE_URL}/api/tasks?start=2026-08-21&end=2026-08-21",
                         headers=H(admin_token), timeout=30)
        items3 = g3.json() if isinstance(g3.json(), list) else g3.json().get("tasks", [])
        assert not [x for x in items3 if x.get("id") == tid], "tâche non supprimée"


# ---------- Avantages / Formations / Notifications ----------
class TestContent:
    def test_benefits_admin_vs_employee(self, session, admin_token, julie_token):
        a = session.get(f"{BASE_URL}/api/benefits", headers=H(admin_token), timeout=30)
        assert a.status_code == 200
        alist = a.json() if isinstance(a.json(), list) else a.json().get("benefits", [])
        assert len(alist) >= 8, f"admin devrait voir >=8 avantages, obtenu {len(alist)}"
        published = [b for b in alist if b.get("status") == "published"]
        assert all("image_b64" not in b for b in alist)
        e = session.get(f"{BASE_URL}/api/benefits", headers=H(julie_token), timeout=30)
        assert e.status_code == 200
        elist = e.json() if isinstance(e.json(), list) else e.json().get("benefits", [])
        assert len(elist) == len(published), f"employé doit voir uniquement les publiés ({len(elist)} vs {len(published)})"
        assert all(b.get("status") == "published" for b in elist)

    def test_trainings(self, session, admin_token, julie_token):
        a = session.get(f"{BASE_URL}/api/trainings", headers=H(admin_token), timeout=60)
        assert a.status_code == 200
        e = session.get(f"{BASE_URL}/api/trainings", headers=H(julie_token), timeout=60)
        assert e.status_code == 200
        elist = e.json() if isinstance(e.json(), list) else e.json().get("trainings", [])
        assert len(elist) >= 1, "la formation démo publiée doit être visible par l'employée"
        for t in elist:
            exam = t.get("exam") or []
            for q in exam:
                assert "answer" not in q and "correct" not in q, "réponses d'examen exposées à l'employé"

    def test_notifications(self, session, admin_token, julie_token):
        for tok in (admin_token, julie_token):
            r = session.get(f"{BASE_URL}/api/notifications", headers=H(tok), timeout=30)
            assert r.status_code == 200, r.text[:200]

    def test_open_shifts_and_team(self, session, admin_token, julie_token):
        for path in ("/api/open-shifts", "/api/polls", "/api/kudos"):
            r = session.get(f"{BASE_URL}{path}", headers=H(julie_token), timeout=30)
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"

    def test_appointments_and_deliveries(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/appointments?start=2026-07-01&end=2026-12-31",
                        headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        d = session.get(f"{BASE_URL}/api/deliveries", headers=H(admin_token), timeout=30)
        assert d.status_code == 200

    def test_licenses_and_chat(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/licenses", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        c = session.get(f"{BASE_URL}/api/chat/conversations", headers=H(admin_token), timeout=30)
        assert c.status_code == 200


# ---------- Performance des endpoints chauds ----------
class TestPerformance:
    @pytest.mark.parametrize("path", [
        "/api/shifts", "/api/hr-state", "/api/notifications",
        "/api/tasks?start=2026-08-17&end=2026-08-23",
    ])
    def test_hot_endpoint_under_1_5s(self, session, admin_token, path):
        # warmup
        session.get(f"{BASE_URL}{path}", headers=H(admin_token), timeout=60)
        t0 = time.time()
        r = session.get(f"{BASE_URL}{path}", headers=H(admin_token), timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200
        assert elapsed < 1.5, f"{path} a répondu en {elapsed:.2f}s (>1.5s)"
