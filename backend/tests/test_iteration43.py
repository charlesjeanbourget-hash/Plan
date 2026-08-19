"""Itération 43 — incompatibilités employés, avertissement quart, export budgets par succursale, IA multi-succursales."""
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import quote

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL manquant")
BASE_URL = base_url.rstrip("/")


def _creds(role_label):
    content = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    for line in content.splitlines():
        if line.strip().startswith("|") and role_label in line:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 3:
                return {"email": cells[1], "password": cells[2]}
    pytest.fail(f"Identifiants introuvables pour {role_label}")


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login échoué {r.status_code}: {r.text[:300]}")
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def admin_token():
    return _login(_creds("Admin (pharmacie ph1)"))


@pytest.fixture(scope="module")
def emp_token():
    return _login(_creds("Employée (ATP, br1)"))


@pytest.fixture(scope="module")
def admin(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def employee(emp_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {emp_token}", "Content-Type": "application/json"})
    return s


def _set_incompat(admin, emp, lst):
    return admin.put(f"{BASE_URL}/api/profiles/{emp}", json={"incompatible_with": lst}, timeout=30)


# ==================== Incompatibilités (réciprocité) ====================
# NOTE: paire dédiée (e1 <-> P2) pour éviter les collisions avec TestShiftIncompatWarning (xdist).
P1, P2 = "e1", "ni2xmk5fmsch98t7"


class TestIncompatibilities:
    def test_reciprocity_add_and_remove(self, admin):
        r = _set_incompat(admin, P1, [P2])
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("incompatible_with") == [P2]

        g3 = admin.get(f"{BASE_URL}/api/profiles/{P2}", timeout=30)
        assert g3.status_code == 200
        assert P1 in (g3.json().get("incompatible_with") or []), g3.json()

        r = _set_incompat(admin, P1, [])
        assert r.status_code == 200
        assert r.json().get("incompatible_with") == []
        g3 = admin.get(f"{BASE_URL}/api/profiles/{P2}", timeout=30)
        assert P1 not in (g3.json().get("incompatible_with") or []), g3.json()

    def test_self_reference_ignored(self, admin):
        r = _set_incompat(admin, P1, [P1, P2])
        assert r.status_code == 200
        assert r.json().get("incompatible_with") == [P2]
        _set_incompat(admin, P1, [])
        _set_incompat(admin, P2, [])

    def test_employee_cannot_set_incompat(self, employee, admin):
        r = employee.put(f"{BASE_URL}/api/profiles/e2", json={"incompatible_with": [P2]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("incompatible_with") == [], r.json()
        g = admin.get(f"{BASE_URL}/api/profiles/{P2}", timeout=30)
        assert "e2" not in (g.json().get("incompatible_with") or [])


# ==================== Avertissement incompatibilité sur les quarts ====================
class TestShiftIncompatWarning:
    created = []

    @pytest.fixture(scope="class", autouse=True)
    def prep(self, admin):
        _set_incompat(admin, "e2", ["e3"])
        yield
        for sid in self.created:
            admin.delete(f"{BASE_URL}/api/shifts/{sid}", timeout=30)
        _set_incompat(admin, "e2", [])

    def _shift(self, admin, sid, emp, branch, start, end):
        payload = {"id": sid, "employee_id": emp, "employee_name": emp,
                   "date": "2026-08-20", "start": start, "end": end,
                   "branch_id": branch, "department": "Général"}
        r = admin.post(f"{BASE_URL}/api/shifts", json=payload, timeout=30)
        if r.status_code in (200, 201):
            self.created.append(sid)
        return r

    def test_first_shift_no_warning(self, admin):
        r = self._shift(admin, "TEST_it43_a", "e3", "br1", "09:00", "17:00")
        assert r.status_code in (200, 201), r.text[:300]
        assert r.json().get("incompat_warning") is None, r.json()

    def test_overlap_same_branch_warns_but_creates(self, admin):
        r = self._shift(admin, "TEST_it43_b", "e2", "br1", "10:00", "16:00")
        assert r.status_code in (200, 201), r.text[:300]
        w = r.json().get("incompat_warning")
        assert w and "Incompatibilité" in w, r.json()
        listing = admin.get(f"{BASE_URL}/api/shifts", timeout=30).json()["shifts"]
        assert any(s["id"] == "TEST_it43_b" for s in listing)

    def test_overlap_other_branch_no_warning(self, admin):
        r = admin.put(f"{BASE_URL}/api/shifts/TEST_it43_b", json={"branch_id": "br2"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("incompat_warning") is None, r.json()

    def test_put_back_same_branch_warns(self, admin):
        r = admin.put(f"{BASE_URL}/api/shifts/TEST_it43_b", json={"branch_id": "br1"}, timeout=30)
        assert r.status_code == 200
        w = r.json().get("incompat_warning")
        assert w and "Incompatibilité" in w, r.json()


# ==================== Export CSV budgets par succursale ====================
class TestBudgetExport:
    def test_export_csv_structure(self, admin):
        names = quote(json.dumps({"br1": "Centre-ville", "br2": "Nord"}))
        r = admin.get(f"{BASE_URL}/api/payroll/budget-export?start=2026-07-27&end=2026-08-09&names={names}",
                      timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert "text/csv" in r.headers.get("Content-Type", "")
        text = r.content.decode("utf-8")
        assert text.startswith("\ufeff"), "BOM UTF-8 manquant"
        lines = text.lstrip("\ufeff").split("\n")
        assert lines[0].startswith("Budgets de paie par succursale;")
        header = lines[1]
        for col in ["Heures planifiées", "Coût planifié", "Heures réelles", "Coût réel", "Budget période", "Écart"]:
            assert col in header, header
        assert any(ln.startswith("TOTAL PHARMACIE;") for ln in lines), lines
        total = [ln for ln in lines if ln.startswith("TOTAL PHARMACIE;")][0]
        assert re.search(r"\d,\d\d", total), total  # décimales avec virgules

    def test_period_too_long(self, admin):
        r = admin.get(f"{BASE_URL}/api/payroll/budget-export?start=2026-01-01&end=2026-06-01", timeout=30)
        assert r.status_code == 400, r.text[:200]

    def test_invalid_dates(self, admin):
        r = admin.get(f"{BASE_URL}/api/payroll/budget-export?start=abc&end=2026-08-09", timeout=30)
        assert r.status_code == 400

    def test_reversed_dates(self, admin):
        r = admin.get(f"{BASE_URL}/api/payroll/budget-export?start=2026-08-09&end=2026-07-27", timeout=30)
        assert r.status_code == 400

    def test_employee_forbidden(self, employee):
        r = employee.get(f"{BASE_URL}/api/payroll/budget-export?start=2026-07-27&end=2026-08-09", timeout=30)
        assert r.status_code == 403, f"{r.status_code} {r.text[:200]}"


# ==================== Génération IA multi-succursales ====================
class TestAiMultiBranch:
    def test_multi_branch_generation(self, admin):
        """Une seule génération IA (coût LLM) : e2 volatile (br1+br2) + e1 en ANCIEN format (sans branch_ids)."""
        payload = {"week_start": "2026-09-14", "instructions": "TEST_it43 multi-succursales",
                   "approval_deadline_hours": 48,
                   "employees": [
                       {"id": "e2", "name": "Julie", "position": "ATP",
                        "branch_id": "br1", "branch_name": "Centre",
                        "branch_ids": ["br1", "br2"], "branch_names": ["Centre", "Nord"]},
                       {"id": "e1", "name": "Sophie", "position": "ATP",
                        "branch_id": "br1", "branch_name": "Centre"}]}
        r = admin.post(f"{BASE_URL}/api/schedule/generate", json=payload, timeout=90)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:400]}"
        prop_id = r.json().get("id") or r.json().get("proposal_id")
        assert prop_id, r.json()
        try:
            prop = None
            for _ in range(40):
                time.sleep(6)
                lst = admin.get(f"{BASE_URL}/api/schedule/proposals", timeout=60)
                assert lst.status_code == 200, lst.text[:200]
                items = lst.json() if isinstance(lst.json(), list) else lst.json().get("proposals", [])
                prop = next((p for p in items if p.get("id") == prop_id), None)
                if prop and prop.get("status") not in ("generating", "processing", "pending"):
                    break
            assert prop, "Proposition introuvable"
            assert prop.get("status") == "pending_approval", f"statut={prop.get('status')} err={prop.get('error')}"
            shifts = prop.get("shifts") or []
            assert shifts, prop
            julie = [s for s in shifts if s.get("employee_id") == "e2"]
            assert julie, "Aucun quart pour l'employée volatile e2"
            for s in julie:
                assert s.get("branch_id") in ("br1", "br2"), s
            for s in shifts:
                if s.get("employee_id") == "e1":
                    assert s.get("branch_id") == "br1", s
        finally:
            admin.delete(f"{BASE_URL}/api/schedule/proposals/{prop_id}", timeout=30)
