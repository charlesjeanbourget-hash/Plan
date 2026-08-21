"""Itération 45 — Synchronisation de l'état RH multi-appareils : GET/PUT /api/hr-state"""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL manquant")
BASE_URL = base_url.rstrip("/")


def _creds():
    content = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    rows = re.findall(r"\|\s*([^|]+?)\s*\|\s*([\w.\-]+@[\w.\-]+)\s*\|\s*(\S+)\s*\|", content)
    out = {}
    for _role, email, pwd in rows:
        out[email] = pwd
    return out


CREDS = _creds()
ADMIN_EMAIL = "admin@luminahr.ca"
JULIE_EMAIL = "julie@luminahr.ca"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email):
    pwd = CREDS.get(email)
    if not pwd:
        pytest.fail(f"Aucun mot de passe pour {email} dans test_credentials.md")
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login {email} a échoué: {r.status_code} {r.text[:300]}")
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="module")
def admin_token(session):
    return _login(session, ADMIN_EMAIL)


@pytest.fixture(scope="module")
def julie_token(session):
    return _login(session, JULIE_EMAIL)


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def preserve_hr_state(session, admin_token):
    """Sauvegarde l'état RH complet avant les tests destructifs et le restaure après."""
    snapshot = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=60).json().get("state")
    yield snapshot
    if snapshot:
        r = session.put(f"{BASE_URL}/api/hr-state", json={"state": snapshot},
                        headers=H(admin_token), timeout=120)
        assert r.status_code == 200, "restauration de l'état RH échouée"


# ---------- Auth / sécurité ----------
class TestHrStateAuth:
    def test_get_without_token(self, session):
        r = session.get(f"{BASE_URL}/api/hr-state", timeout=30)
        assert r.status_code in (401, 403), r.text[:200]

    def test_put_without_token(self, session):
        r = session.put(f"{BASE_URL}/api/hr-state", json={"state": {"employees": []}}, timeout=30)
        assert r.status_code in (401, 403), r.text[:200]

    def test_put_invalid_payload(self, session, admin_token):
        r = session.put(f"{BASE_URL}/api/hr-state", json={"nope": 1}, headers=H(admin_token), timeout=30)
        assert r.status_code == 422, r.text[:200]


# ---------- Persistance, strip shifts, partage pharmacie ----------
class TestHrStateSync:
    def test_get_shape(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert set(["state", "updated_at", "updated_by"]).issubset(body.keys())
        assert "_id" not in body

    def test_put_strips_shifts_and_persists(self, session, admin_token, preserve_hr_state):
        st_full = dict(preserve_hr_state or {})
        st_full["employees"] = [{"id": "TEST_e99", "firstName": "SyncTest", "lastName": "Api"}]
        st_full["branches"] = [{"id": "TEST_br9", "name": "TEST_Succ"}]
        st_full["shifts"] = [{"id": "TEST_s1", "employeeId": "TEST_e99"}]
        r = session.put(f"{BASE_URL}/api/hr-state", json={"state": st_full}, headers=H(admin_token), timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True
        assert "updated_at" in r.json()

        g = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=30)
        assert g.status_code == 200
        body = g.json()
        st = body["state"]
        assert st is not None
        assert "shifts" not in st, "le champ shifts doit être retiré de l'état stocké"
        assert st["employees"][0]["firstName"] == "SyncTest"
        assert st["branches"][0]["name"] == "TEST_Succ"
        assert body["updated_by"] == ADMIN_EMAIL
        assert body["updated_at"]

    def test_wipe_guard_rejects_emptied_lists(self, session, admin_token, preserve_hr_state):
        """Nouveau garde-fou : vider plusieurs listes d'un coup -> 409, état intact."""
        before = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=30).json()["state"]
        r = session.put(f"{BASE_URL}/api/hr-state",
                        json={"state": {"employees": [], "branches": [], "payrollEntries": []}},
                        headers=H(admin_token), timeout=30)
        assert r.status_code == 409, f"attendu 409 (garde-fou), obtenu {r.status_code}"
        after = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=30).json()["state"]
        assert after == before, "l'état ne doit pas changer après un rejet 409"

    def test_same_pharmacy_users_share_state(self, session, admin_token, julie_token, preserve_hr_state):
        marker = "TEST_partage_ph1"
        st_full = dict(preserve_hr_state or {})
        st_full["employees"] = [{"id": marker, "firstName": "Partage"}]
        session.put(f"{BASE_URL}/api/hr-state", json={"state": st_full},
                    headers=H(admin_token), timeout=30)
        g = session.get(f"{BASE_URL}/api/hr-state", headers=H(julie_token), timeout=30)
        assert g.status_code == 200, g.text[:300]
        st = g.json()["state"]
        assert st is not None, "Julie (même pharmacie) doit voir l'état de l'admin"
        assert st["employees"][0]["id"] == marker

    def test_employee_write_is_merged_not_full(self, session, julie_token, admin_token):
        """Un employé ne peut plus écraser les listes sensibles : seules les listes
        autorisées (shiftSwaps, benefits, leaveRequests, onboardingItems, tasks) sont fusionnées."""
        before = session.get(f"{BASE_URL}/api/hr-state", headers=H(admin_token), timeout=30).json()["state"]
        assert before.get("employees"), "état de base requis"
        r = session.put(f"{BASE_URL}/api/hr-state",
                        json={"state": {"employees": [{"id": "TEST_julie_write"}],
                                        "shiftSwaps": [{"id": "TEST_swap_it45"}]}},
                        headers=H(julie_token), timeout=30)
        assert r.status_code == 200, r.text[:200]
        g = session.get(f"{BASE_URL}/api/hr-state", headers=H(julie_token), timeout=30)
        st = g.json()["state"]
        ids = [e.get("id") for e in st.get("employees", [])]
        assert "TEST_julie_write" not in ids, "employees ne doit pas être modifiable par un employé"
        assert st.get("employees"), "employees ne doit pas être vidé par l'écriture d'un employé"
        assert any(s.get("id") == "TEST_swap_it45" for s in st.get("shiftSwaps", [])), \
            "shiftSwaps (liste autorisée) doit être fusionnée"

    def test_large_state_rejected(self, session, admin_token, preserve_hr_state):
        big = dict(preserve_hr_state or {})
        big["employees"] = [{"id": f"x{i}", "note": "z" * 200} for i in range(30000)]
        r = session.put(f"{BASE_URL}/api/hr-state", json={"state": big}, headers=H(admin_token), timeout=120)
        assert r.status_code in (413, 422), f"attendu 413, obtenu {r.status_code}"


# ---------- Régression : quarts via /api/shifts ----------
class TestShiftsRegression:
    def test_shifts_get(self, session, admin_token):
        r = session.get(f"{BASE_URL}/api/shifts", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "shifts" in body and "migrated" in body
        assert isinstance(body["shifts"], list)

    def test_shift_crud(self, session, admin_token):
        sid = "TEST_shift_it45"
        payload = {"id": sid, "employee_id": "e2", "employee_name": "Julie Tremblay",
                   "date": "2026-08-20", "start": "09:00", "end": "17:00", "role": "ATP", "branch_id": "br1"}
        r = session.post(f"{BASE_URL}/api/shifts", json=payload, headers=H(admin_token), timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        g = session.get(f"{BASE_URL}/api/shifts", headers=H(admin_token), timeout=30)
        assert any(s.get("id") == sid for s in g.json()["shifts"]), "quart créé absent du GET"
        d = session.delete(f"{BASE_URL}/api/shifts/{sid}", headers=H(admin_token), timeout=30)
        assert d.status_code in (200, 204), d.text[:200]
        g2 = session.get(f"{BASE_URL}/api/shifts", headers=H(admin_token), timeout=30)
        assert not any(s.get("id") == sid for s in g2.json()["shifts"])


# ---------- Nettoyage : l'état RH complet est restauré par la fixture preserve_hr_state ----------
def test_zz_cleanup(session, admin_token, preserve_hr_state):
    assert preserve_hr_state is None or isinstance(preserve_hr_state, dict)
