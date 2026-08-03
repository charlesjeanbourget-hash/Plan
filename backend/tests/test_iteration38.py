"""Iteration 38 — Postes de travail par département, tâches superadmin, station sur quarts."""
import os
from datetime import date, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = ("admin@luminahr.ca", "Nlpx!tTE3Aw27")
JULIE = ("julie@luminahr.ca", "O1ka!gfVV6e54")
SUPERADMIN = ("jeffmenard78@hotmail.com", "JeffSecure2026!x")

TODAY = date.today()
MONDAY = TODAY - timedelta(days=TODAY.weekday())
SUNDAY = MONDAY + timedelta(days=6)


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


# ---------- BACKEND 1 : Bug tâches superadmin ----------
def test_superadmin_task_appears_in_get(super_tok):
    date_str = (MONDAY + timedelta(days=1)).isoformat()
    payload = {"date": date_str, "shift": "Matin", "title": "TEST_iter38_superadmin"}
    r = requests.post(f"{BASE_URL}/api/tasks", headers=H(super_tok), json=payload, timeout=30)
    assert r.status_code == 200, f"POST tasks: {r.status_code} {r.text[:300]}"
    task = r.json()
    tid = task["id"]
    try:
        r2 = requests.get(f"{BASE_URL}/api/tasks",
                          params={"start": MONDAY.isoformat(), "end": SUNDAY.isoformat()},
                          headers=H(super_tok), timeout=30)
        assert r2.status_code == 200
        ids = [t["id"] for t in r2.json()]
        assert tid in ids, f"tâche superadmin absente du GET (bug non corrigé); ids={ids[:5]}"
    finally:
        requests.delete(f"{BASE_URL}/api/tasks/{tid}", headers=H(super_tok), timeout=30)


# ---------- BACKEND 2 : Config postes GET ----------
def test_work_stations_defaults(admin_tok):
    r = requests.get(f"{BASE_URL}/api/work-stations", headers=H(admin_tok), timeout=30)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    stations = data["stations"]
    periods = data["rush_periods"]
    assert len(stations) >= 38, f"expected>=38 stations got {len(stations)}"
    # Group by dept
    by_dept = {}
    for s in stations:
        by_dept.setdefault(s["department"], []).append(s)
        for k in ("id", "department", "name", "competence", "normal_count", "rush_count", "active"):
            assert k in s, f"missing {k} in {s}"
    # Count expectations: labo>=20, plancher>=7, entrepôt>=3, livraison>=3, admin>=3, général>=2
    assert len(by_dept.get("Laboratoire", [])) >= 20
    assert len(by_dept.get("Plancher", [])) >= 7
    assert len(by_dept.get("Entrepôt", [])) >= 3
    assert len(by_dept.get("Livraison", [])) >= 3
    assert len(by_dept.get("Administration", [])) >= 3
    assert len(by_dept.get("Général", [])) >= 2
    assert isinstance(periods, list) and len(periods) >= 1
    p0 = periods[0]
    assert p0["start"] == "10:00" and p0["end"] == "14:00"
    assert set(p0["days"]) >= {0, 1, 2, 3, 4}


# ---------- BACKEND 3 : PUT work-stations (admin + custom + rush) & 403 employé ----------
def test_work_stations_put_and_403(admin_tok, julie_tok):
    r = requests.get(f"{BASE_URL}/api/work-stations", headers=H(admin_tok), timeout=30)
    data = r.json()
    stations = data["stations"]
    periods = list(data["rush_periods"])
    # activer "Vérification contenant-contenu"
    verif = next(s for s in stations if s["name"] == "Vérification contenant-contenu")
    verif["active"] = True
    accueil = next(s for s in stations if s["name"] == "Accueil client / Réception des ordonnances")
    accueil["normal_count"] = 2
    # add custom station
    custom_name = "TEST_iter38_custom"
    stations.append({"id": "", "department": "Laboratoire", "name": custom_name,
                     "competence": "Test", "normal_count": 1, "rush_count": 1, "active": True})
    # add 2nd rush period
    periods.append({"days": [5, 6], "start": "12:00", "end": "16:00"})
    put = requests.put(f"{BASE_URL}/api/work-stations", headers=H(admin_tok),
                       json={"stations": stations, "rush_periods": periods}, timeout=30)
    assert put.status_code == 200, put.text[:300]
    # verify GET reflects
    r2 = requests.get(f"{BASE_URL}/api/work-stations", headers=H(admin_tok), timeout=30).json()
    verif2 = next(s for s in r2["stations"] if s["name"] == "Vérification contenant-contenu")
    assert verif2["active"] is True
    accueil2 = next(s for s in r2["stations"] if s["name"] == "Accueil client / Réception des ordonnances")
    assert accueil2["normal_count"] == 2
    assert any(s["name"] == custom_name for s in r2["stations"])
    assert len(r2["rush_periods"]) >= 2

    # Employé 403
    e = requests.put(f"{BASE_URL}/api/work-stations", headers=H(julie_tok),
                     json={"stations": [], "rush_periods": []}, timeout=30)
    assert e.status_code == 403, f"expected 403 got {e.status_code}"

    # Restore near-default: remove custom, revert accueil to 1, verif->False, single rush period
    restored = [s for s in r2["stations"] if s["name"] != custom_name]
    for s in restored:
        if s["name"] == "Vérification contenant-contenu":
            s["active"] = False
        if s["name"] == "Accueil client / Réception des ordonnances":
            s["normal_count"] = 1
    default_periods = [{"days": [0, 1, 2, 3, 4], "start": "10:00", "end": "14:00"}]
    rr = requests.put(f"{BASE_URL}/api/work-stations", headers=H(admin_tok),
                      json={"stations": restored, "rush_periods": default_periods}, timeout=30)
    assert rr.status_code == 200


# ---------- BACKEND 4 : Attribution automatique ----------
def test_auto_assign_stations(admin_tok):
    created_ids = []
    # Get real employees ph1
    profs = requests.get(f"{BASE_URL}/api/profiles", headers=H(admin_tok), timeout=30).json()
    emps = [p for p in profs if p.get("employee_id")][:3]
    assert len(emps) >= 2
    d = (MONDAY + timedelta(days=2)).isoformat()
    for i, p in enumerate(emps):
        r = requests.post(f"{BASE_URL}/api/shifts", headers=H(admin_tok), json={
            "employee_id": p["employee_id"], "employee_name": p.get("employee_name", "Emp"),
            "date": d, "start": f"{8+i:02d}:00", "end": f"{16+i:02d}:00",
            "department": "Laboratoire", "note": "TEST_iter38_assign"
        }, timeout=30)
        assert r.status_code in (200, 201), r.text[:200]
        created_ids.append(r.json()["id"])
    try:
        a = requests.post(f"{BASE_URL}/api/work-stations/assign", headers=H(admin_tok),
                          json={"week_start": MONDAY.isoformat()}, timeout=60)
        assert a.status_code == 200, a.text[:300]
        assigned1 = a.json()["assigned"]
        assert assigned1 >= 2, f"assigned={assigned1}"
        # Verify shifts got station
        shifts = requests.get(f"{BASE_URL}/api/shifts", headers=H(admin_tok), timeout=30).json()["shifts"]
        mine = [s for s in shifts if s["id"] in created_ids]
        stations = [s.get("station") for s in mine]
        assert all(stations), f"some shifts without station: {stations}"
        assert len(set(stations)) >= 2, f"expected different stations, got {stations}"
        # Idempotence
        a2 = requests.post(f"{BASE_URL}/api/work-stations/assign", headers=H(admin_tok),
                           json={"week_start": MONDAY.isoformat()}, timeout=60)
        # assigned should be 0 for these already-assigned shifts (others may still be assigned)
        # We verify by re-fetching that our shifts kept the same station
        shifts2 = requests.get(f"{BASE_URL}/api/shifts", headers=H(admin_tok), timeout=30).json()["shifts"]
        mine2 = {s["id"]: s.get("station") for s in shifts2 if s["id"] in created_ids}
        for sid, st in zip(created_ids, stations):
            assert mine2[sid] == st, f"station changed on 2nd assign for {sid}"
    finally:
        for sid in created_ids:
            requests.delete(f"{BASE_URL}/api/shifts/{sid}", headers=H(admin_tok), timeout=30)


# ---------- BACKEND 5 : Station sur les quarts (POST + PUT + notif) ----------
def test_shift_station_field_and_notification(admin_tok, julie_tok):
    # Julie employee_id
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=H(julie_tok), timeout=30).json()
    julie_eid = me.get("employee_id") or "e2"

    d = (MONDAY + timedelta(days=3)).isoformat()
    r = requests.post(f"{BASE_URL}/api/shifts", headers=H(admin_tok), json={
        "employee_id": julie_eid, "employee_name": me.get("name") or "Julie",
        "date": d, "start": "09:00", "end": "17:00",
        "department": "Laboratoire", "station": "Robot de dispensation", "note": "TEST_iter38"
    }, timeout=30)
    assert r.status_code in (200, 201), r.text[:300]
    shift = r.json()
    sid = shift["id"]
    assert shift.get("station") == "Robot de dispensation", f"station absent: {shift}"
    try:
        # PUT to change station
        pu = requests.put(f"{BASE_URL}/api/shifts/{sid}", headers=H(admin_tok),
                          json={"station": "Dispill / Piluliers"}, timeout=30)
        assert pu.status_code == 200, pu.text[:300]
        assert pu.json().get("station") == "Dispill / Piluliers"
        # Notification created for Julie mentioning "poste"
        notifs = requests.get(f"{BASE_URL}/api/notifications", headers=H(julie_tok), timeout=30).json()
        items = notifs if isinstance(notifs, list) else notifs.get("items", [])
        found = any("poste" in (n.get("body") or n.get("message") or "").lower()
                    or "poste" in (n.get("title") or "").lower()
                    for n in items[:20])
        assert found, f"aucune notif mentionnant 'poste' dans les 20 dernières: {items[:5]}"
    finally:
        requests.delete(f"{BASE_URL}/api/shifts/{sid}", headers=H(admin_tok), timeout=30)
