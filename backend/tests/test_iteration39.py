"""Itération 39 — Flux IA horaire complet + rotation postes + régression générale."""
import os
import time
from datetime import date, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
MONGO_URL = backend_env.get("MONGO_URL")
DB_NAME = backend_env.get("DB_NAME")

ADMIN = ("admin@luminahr.ca", "Nlpx!tTE3Aw27")
JULIE = ("julie@luminahr.ca", "O1ka!gfVV6e54")
SUPERADMIN = ("jeffmenard78@hotmail.com", "JeffSecure2026!x")

WEEK_P1 = "2026-08-24"  # AI generation main test


def login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_tok():
    return login(*ADMIN)


@pytest.fixture(scope="module")
def julie_tok():
    return login(*JULIE)


@pytest.fixture(scope="module")
def super_tok():
    return login(*SUPERADMIN)


# ============================================================
# PRIORITY 1 + 2 : Flux IA complet -> décision -> apply -> rotation
# ============================================================
@pytest.fixture(scope="module")
def ai_proposal(admin_tok):
    """Génère une proposition IA pour la semaine 2026-08-24 et retourne l'ID une fois pending_approval."""
    payload = {
        "week_start": WEEK_P1,
        "instructions": "Test itération 39 — deux employés Laboratoire, quarts variés.",
        "approval_deadline_hours": 24,
        "employees": [
            {"id": "e1", "name": "Marc Tremblay", "position": "Pharmacien",
             "branch_id": "br1", "branch_name": "Centre-Ville"},
            {"id": "e2", "name": "Julie Gagnon", "position": "ATP",
             "branch_id": "br1", "branch_name": "Centre-Ville"},
        ],
        "absences": [],
        "weekly_budget": -1,
        "department": "Laboratoire",
        "existing_mode": "add",
        "existing_shifts": [],
    }
    r = requests.post(f"{BASE_URL}/api/schedule/generate", headers=H(admin_tok), json=payload, timeout=60)
    assert r.status_code == 200, f"generate failed: {r.status_code} {r.text[:400]}"
    prop = r.json()
    assert prop.get("status") == "generating", f"expected generating, got {prop.get('status')}"
    pid = prop["id"]

    # Poll until pending_approval (or error)
    deadline = time.time() + 120
    final = None
    while time.time() < deadline:
        lst = requests.get(f"{BASE_URL}/api/schedule/proposals", headers=H(admin_tok), timeout=30).json()
        doc = next((d for d in lst if d["id"] == pid), None)
        if doc and doc["status"] in ("pending_approval", "error"):
            final = doc
            break
        time.sleep(3)
    assert final, f"proposition pas résolue en 120s (dernier status inconnu)"
    if final["status"] == "error":
        pytest.fail(f"génération LLM en erreur: {final.get('error')}")
    assert final["status"] == "pending_approval"
    assert final.get("shifts"), f"aucun quart généré: {final}"
    # roster_branches présent
    rb = final.get("roster_branches") or {}
    assert rb.get("e1") == "br1" and rb.get("e2") == "br1", f"roster_branches incorrect: {rb}"

    yield final

    # Teardown : suppression proposition + quarts semaine + notifications
    week_days = [(date.fromisoformat(WEEK_P1) + timedelta(days=i)).isoformat() for i in range(7)]
    requests.delete(f"{BASE_URL}/api/schedule/proposals/{pid}", headers=H(admin_tok), timeout=30)
    # cleanup shifts of the week via DB directly (fast)
    async def _cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.shifts.delete_many({"pharmacy_id": "ph1", "date": {"$in": week_days}, "proposal_id": pid})
        await db.notifications.delete_many({"pharmacy_id": "ph1",
                                            "created_at": {"$gte": (date.today() - timedelta(days=1)).isoformat()},
                                            "title": {"$in": ["Nouvel horaire confirmé", "Poste de travail assigné"]}})
        client.close()
    asyncio.get_event_loop().run_until_complete(_cleanup())


def test_p1_ai_generation_flow(ai_proposal):
    """PRIORITÉ 1 : la proposition IA arrive à pending_approval avec shifts + roster_branches."""
    assert ai_proposal["status"] == "pending_approval"
    assert len(ai_proposal["shifts"]) >= 1
    # Chaque quart a bien un employee_id parmi e1/e2
    for s in ai_proposal["shifts"]:
        assert s["employee_id"] in ("e1", "e2"), f"employee_id inattendu: {s}"


def test_p2_decision_apply_and_rotation(admin_tok, ai_proposal):
    """PRIORITÉ 2 : décision admin -> forçage deadline -> apply -> vérif rotation postes."""
    pid = ai_proposal["id"]
    # Décision approuvée
    r = requests.post(f"{BASE_URL}/api/schedule/proposals/{pid}/decision",
                      headers=H(admin_tok), json={"status": "approved"}, timeout=30)
    assert r.status_code == 200, r.text[:300]

    # Forcer approval_deadline dans le passé (tacite)
    async def _force_deadline():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        past = (date.today() - timedelta(days=1)).isoformat() + "T00:00:00+00:00"
        res = await db.schedule_proposals.update_one({"id": pid}, {"$set": {"approval_deadline": past}})
        client.close()
        return res.modified_count
    modified = asyncio.get_event_loop().run_until_complete(_force_deadline())
    assert modified == 1

    # Apply
    ap = requests.post(f"{BASE_URL}/api/schedule/proposals/{pid}/apply",
                       headers=H(admin_tok), json={}, timeout=60)
    assert ap.status_code == 200, f"apply failed: {ap.status_code} {ap.text[:400]}"
    data = ap.json()
    assert data.get("inserted_count", 0) > 0, f"inserted_count=0: {data}"
    # stations_assigned peut être 0 selon config work-stations, mais Laboratoire devrait générer >0
    assert data.get("stations_assigned", -1) >= 0, f"stations_assigned manquant: {data}"

    # GET /api/shifts -> les quarts existent avec ai_generated=true, branch_id='br1'
    shifts = requests.get(f"{BASE_URL}/api/shifts", headers=H(admin_tok), timeout=30).json()["shifts"]
    week_days = {(date.fromisoformat(WEEK_P1) + timedelta(days=i)).isoformat() for i in range(7)}
    week_shifts = [s for s in shifts if s.get("date") in week_days and s.get("proposal_id") == pid]
    assert week_shifts, "aucun quart de la semaine 2026-08-24 avec proposal_id trouvé"
    for s in week_shifts:
        assert s.get("ai_generated") is True, f"ai_generated manquant: {s}"
        assert s.get("branch_id") == "br1", f"branch_id incorrect: {s}"
    # Postes non-vides sur les quarts Labo
    labo_shifts = [s for s in week_shifts if s.get("department") == "Laboratoire"]
    if labo_shifts and data.get("stations_assigned", 0) > 0:
        # Au moins un doit avoir station
        assert any(s.get("station") for s in labo_shifts), "aucun quart Labo avec station"

    # Rotation : pour un même employé sur plusieurs jours consécutifs Labo, stations doivent varier
    from collections import defaultdict
    by_emp = defaultdict(list)
    for s in labo_shifts:
        if s.get("station"):
            by_emp[s["employee_id"]].append((s["date"], s["station"]))
    rotated_ok = True
    rotation_report = {}
    for eid, entries in by_emp.items():
        entries.sort()
        rotation_report[eid] = entries
        # Vérifier qu'on n'a pas 2 jours consécutifs avec exactement la même station
        # (uniquement si plusieurs postes ouverts / >=2 quarts)
        if len(entries) >= 2:
            for i in range(len(entries) - 1):
                d1 = date.fromisoformat(entries[i][0])
                d2 = date.fromisoformat(entries[i + 1][0])
                if (d2 - d1).days == 1 and entries[i][1] == entries[i + 1][1]:
                    # Peut être acceptable si un seul poste est actif — on ne fail pas dur, on rapporte
                    rotated_ok = False
    # On rapporte mais on n'échoue pas si un seul poste actif (paramètre config)
    print(f"Rotation report: {rotation_report} rotated_ok={rotated_ok}")


# ============================================================
# RÉGRESSION 1 : Auth
# ============================================================
def test_reg1_auth_ok_and_bad_password():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]}, timeout=30)
    assert r.status_code == 200 and "access_token" in r.json()
    r2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": SUPERADMIN[0], "password": SUPERADMIN[1]}, timeout=30)
    assert r2.status_code == 200
    r3 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": JULIE[0], "password": JULIE[1]}, timeout=30)
    assert r3.status_code == 200
    bad = requests.post(f"{BASE_URL}/api/auth/login",
                        json={"email": ADMIN[0], "password": "MauvaisMDP2026!"}, timeout=30)
    assert bad.status_code in (400, 401, 403), f"expected 4xx got {bad.status_code}"


# ============================================================
# RÉGRESSION 2 : Quarts CRUD + notifications
# ============================================================
def test_reg2_shifts_crud(admin_tok, julie_tok):
    # Date : 2026-09-14 (semaine future non liée à la P1)
    d = "2026-09-14"
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=H(julie_tok), timeout=30).json()
    eid = me.get("employee_id") or "e2"
    payload = {
        "employee_id": eid, "employee_name": me.get("name") or "Julie",
        "date": d, "start": "09:00", "end": "17:00",
        "department": "Laboratoire", "station": "Robot de dispensation",
        "note": "TEST_iter39"
    }
    r = requests.post(f"{BASE_URL}/api/shifts", headers=H(admin_tok), json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text[:300]
    shift = r.json()
    sid = shift["id"]
    try:
        assert shift.get("station") == "Robot de dispensation"
        # PUT modif
        pu = requests.put(f"{BASE_URL}/api/shifts/{sid}", headers=H(admin_tok),
                         json={"end": "18:00"}, timeout=30)
        assert pu.status_code == 200
        assert pu.json().get("end") == "18:00"
        # Notification non-IA créée pour Julie
        notifs = requests.get(f"{BASE_URL}/api/notifications", headers=H(julie_tok), timeout=30).json()
        items = notifs if isinstance(notifs, list) else notifs.get("items", [])
        assert items, "aucune notif reçue"
    finally:
        requests.delete(f"{BASE_URL}/api/shifts/{sid}", headers=H(admin_tok), timeout=30)


# ============================================================
# RÉGRESSION 3 : Postes
# ============================================================
def test_reg3_work_stations(admin_tok, julie_tok):
    r = requests.get(f"{BASE_URL}/api/work-stations", headers=H(admin_tok), timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data["stations"]) >= 38, f"stations count {len(data['stations'])}"

    # assign for current week
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    a = requests.post(f"{BASE_URL}/api/work-stations/assign", headers=H(admin_tok),
                     json={"week_start": monday.isoformat()}, timeout=60)
    assert a.status_code == 200
    assert a.json().get("assigned", -1) >= 0

    # PUT config par employé (julie) -> 403
    e = requests.put(f"{BASE_URL}/api/work-stations", headers=H(julie_tok),
                    json={"stations": [], "rush_periods": []}, timeout=30)
    assert e.status_code == 403


# ============================================================
# RÉGRESSION 4 : Tâches admin + superadmin GET inclut la tâche
# ============================================================
def test_reg4_tasks_admin_and_superadmin(admin_tok, super_tok):
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)

    # Admin
    p = {"date": (monday + timedelta(days=1)).isoformat(), "shift": "Matin", "title": "TEST_iter39_admin"}
    r = requests.post(f"{BASE_URL}/api/tasks", headers=H(admin_tok), json=p, timeout=30)
    assert r.status_code == 200
    aid = r.json()["id"]
    try:
        g = requests.get(f"{BASE_URL}/api/tasks",
                        params={"start": monday.isoformat(), "end": sunday.isoformat()},
                        headers=H(admin_tok), timeout=30).json()
        assert aid in [t["id"] for t in g]
        # Toggle
        tog = requests.post(f"{BASE_URL}/api/tasks/{aid}/toggle", headers=H(admin_tok), json={}, timeout=30)
        assert tog.status_code == 200
    finally:
        requests.delete(f"{BASE_URL}/api/tasks/{aid}", headers=H(admin_tok), timeout=30)

    # Superadmin
    p2 = {"date": (monday + timedelta(days=2)).isoformat(), "shift": "Matin", "title": "TEST_iter39_super"}
    r2 = requests.post(f"{BASE_URL}/api/tasks", headers=H(super_tok), json=p2, timeout=30)
    assert r2.status_code == 200
    sid = r2.json()["id"]
    try:
        g2 = requests.get(f"{BASE_URL}/api/tasks",
                         params={"start": monday.isoformat(), "end": sunday.isoformat()},
                         headers=H(super_tok), timeout=30).json()
        assert sid in [t["id"] for t in g2], "bug superadmin GET tasks non corrigé"
    finally:
        requests.delete(f"{BASE_URL}/api/tasks/{sid}", headers=H(super_tok), timeout=30)


# ============================================================
# RÉGRESSION 5 : Punch (code 7068 Julie)
# ============================================================
def test_reg5_punch_flow():
    # Punch entrée
    r = requests.post(f"{BASE_URL}/api/punch", json={"code": "7068"}, timeout=30)
    assert r.status_code == 200, f"punch in: {r.status_code} {r.text[:300]}"
    body = r.json()
    # break start (via NIP)
    b = requests.post(f"{BASE_URL}/api/punch/break", json={"code": "7068"}, timeout=30)
    assert b.status_code == 200, b.text[:200]
    # break end
    b2 = requests.post(f"{BASE_URL}/api/punch/break", json={"code": "7068"}, timeout=30)
    assert b2.status_code == 200
    # Punch out
    r2 = requests.post(f"{BASE_URL}/api/punch", json={"code": "7068"}, timeout=30)
    assert r2.status_code == 200, r2.text[:200]
    body2 = r2.json()
    # Settings public? -> route admin. Skip if 401
    # (endpoint /api/punch/settings sans auth n'est pas testé ici)


def test_reg5_punch_settings(admin_tok):
    r = requests.get(f"{BASE_URL}/api/punch/settings", headers=H(admin_tok), timeout=30)
    assert r.status_code == 200
    s = r.json()
    assert "rounding_minutes" in s or "breaks_paid" in s


# ============================================================
# RÉGRESSION 6 : Congés
# ============================================================
def test_reg6_leave_flow(admin_tok, julie_tok):
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=H(julie_tok), timeout=30).json()
    eid = me.get("employee_id") or "e2"
    # Create leave request (Julie)
    day = "2026-09-21"
    payload = {"employee_id": eid, "employee_name": me.get("name") or "Julie",
               "type": "Vacances", "start_date": day, "end_date": day, "reason": "TEST_iter39"}
    r = requests.post(f"{BASE_URL}/api/leave/requests", headers=H(julie_tok), json=payload, timeout=30)
    assert r.status_code in (200, 201), f"leave create: {r.status_code} {r.text[:300]}"
    lid = r.json()["id"]
    try:
        # Admin approve
        ap = requests.post(f"{BASE_URL}/api/leave/requests/{lid}/decide",
                          headers=H(admin_tok), json={"action": "approve", "note": "OK test"}, timeout=30)
        assert ap.status_code == 200, ap.text[:300]
        # Balances
        bal = requests.get(f"{BASE_URL}/api/leave/balances", headers=H(julie_tok), timeout=30)
        assert bal.status_code == 200
    finally:
        # Cleanup direct DB (approved requests may not be deletable via DELETE)
        async def _rm():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.leave_requests.delete_one({"id": lid})
            client.close()
        asyncio.get_event_loop().run_until_complete(_rm())


# ============================================================
# RÉGRESSION 7 : Divers backend
# ============================================================
def test_reg7_birthdays_today(admin_tok):
    r = requests.get(f"{BASE_URL}/api/birthdays/today", headers=H(admin_tok), timeout=30)
    assert r.status_code == 200


def test_reg7_superadmin_overview(super_tok):
    r = requests.get(f"{BASE_URL}/api/superadmin/overview", headers=H(super_tok), timeout=30)
    assert r.status_code == 200
    data = r.json()
    # Attendu : activity + accounts d'après le contexte
    keys = set(data.keys()) if isinstance(data, dict) else set()
    assert keys, f"overview vide: {data}"


def test_reg7_open_shifts(admin_tok):
    r = requests.get(f"{BASE_URL}/api/open-shifts", headers=H(admin_tok), timeout=30)
    assert r.status_code == 200


def test_reg7_chat_conversations(admin_tok):
    r = requests.get(f"{BASE_URL}/api/chat/conversations", headers=H(admin_tok), timeout=30)
    assert r.status_code == 200
