"""Iteration 26 — durcissement sécurité: mots de passe forts, JWT 24h, flux temporaire,
chat authentifié, NIP haché, certificats chiffrés, CORS restreint, Loi 25."""
import io
import os
import time
import uuid

import pytest
import requests
from dotenv import dotenv_values
from reportlab.pdfgen import canvas

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = ("admin@luminahr.ca", "Nlpx!tTE3Aw27")
JULIE = ("julie@luminahr.ca", "O1ka!gfVV6e54")
GESTION = ("gestion@luminahr.ca", "Jwdh!1l4t5D50")
TEMP_BACKEND = ("charles-jbourget@hotmail.com", "Svq2!FjWYsI88")
TEMP_UI = ("charlesjeanbourget@gmail.com", "Dphb!EGxX6536")

# Nouveaux mots de passe choisis pour les comptes temporaires (à noter dans le rapport)
NEW_PW_BACKEND = "CharlesTest2026!a"
NEW_PW_UI = "OwnerSecure2026!z"


def login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


# ---------- AUTH régression: anciens mdp refusés ----------
class TestAuthRegression:
    def test_old_admin_password_rejected(self):
        r = login("admin@luminahr.ca", "admin123")
        assert r.status_code == 401, f"L'ancien mdp admin123 devrait être 401, obtenu {r.status_code}"

    def test_new_admin_password_ok(self):
        r = login(*ADMIN)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        assert data["user"]["email"] == ADMIN[0]

    def test_new_julie_password_ok(self):
        r = login(*JULIE)
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

    def test_new_gestion_password_ok(self):
        r = login(*GESTION)
        assert r.status_code == 200, r.text


# ---------- Flux mot de passe temporaire ----------
class TestTemporaryPasswordFlow:
    def test_temp_login_blocked_endpoints(self):
        # Login should succeed but endpoints should be blocked
        r = login(*TEMP_BACKEND)
        # If already changed by previous run, use new password
        if r.status_code == 401:
            r = login(TEMP_BACKEND[0], NEW_PW_BACKEND)
            if r.status_code == 200:
                pytest.skip("Mot de passe temporaire déjà consommé par test précédent")
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        # /api/auth/me doit passer
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=10)
        assert me.status_code == 200

        # Autre endpoint doit être bloqué avec header X-Password-Change-Required
        ov = requests.get(f"{BASE_URL}/api/superadmin/overview", headers=h, timeout=10)
        assert ov.status_code == 403, f"Devrait être 403, obtenu {ov.status_code}"
        header_val = ov.headers.get("X-Password-Change-Required") or ov.headers.get("x-password-change-required")
        assert header_val, f"Header X-Password-Change-Required manquant. Headers: {dict(ov.headers)}"

        # Faible → 400
        weak = requests.post(f"{BASE_URL}/api/auth/change-password", headers=h,
                             json={"current_password": TEMP_BACKEND[1], "new_password": "abc"}, timeout=10)
        assert weak.status_code == 400, f"Mdp faible devrait être 400, obtenu {weak.status_code}: {weak.text}"

        # Fort → 200
        strong = requests.post(f"{BASE_URL}/api/auth/change-password", headers=h,
                               json={"current_password": TEMP_BACKEND[1], "new_password": NEW_PW_BACKEND}, timeout=10)
        assert strong.status_code == 200, f"Mdp fort devrait être 200: {strong.text}"

        # Ré-login avec nouveau mdp
        r2 = login(TEMP_BACKEND[0], NEW_PW_BACKEND)
        assert r2.status_code == 200
        token2 = r2.json()["access_token"]
        h2 = {"Authorization": f"Bearer {token2}"}

        # Endpoints débloqués
        ov2 = requests.get(f"{BASE_URL}/api/superadmin/overview", headers=h2, timeout=10)
        assert ov2.status_code == 200, f"Devrait être débloqué: {ov2.status_code} {ov2.text[:200]}"


# ---------- Chat authentifié + rate-limit ----------
class TestChatAuth:
    def test_chat_without_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/chat", json={"session_id": "test-anon", "message": "salut"}, timeout=10)
        assert r.status_code == 401, f"Chat sans auth devrait être 401, obtenu {r.status_code} body={r.text[:200]}"

    def test_chat_with_auth_ok(self):
        tok = login(*ADMIN).json()["access_token"]
        # SSE streaming, on récupère un stream et on vérifie qu'il commence
        r = requests.post(f"{BASE_URL}/api/chat", headers={"Authorization": f"Bearer {tok}"},
                          json={"session_id": f"test-{uuid.uuid4().hex[:6]}", "message": "dis bonjour en un seul mot"},
                          stream=True, timeout=30)
        assert r.status_code == 200, f"Chat authentifié devrait être 200: {r.status_code} {r.text[:200]}"
        # Lire un peu du flux
        chunks = 0
        for line in r.iter_lines():
            if line:
                chunks += 1
                if chunks >= 2:
                    break
        r.close()
        assert chunks >= 1, "Le stream SSE devrait retourner au moins une ligne"


# ---------- NIP haché ----------
class TestPunchCodeHashed:
    def test_punch_preview_public_shortened_name(self):
        r = requests.post(f"{BASE_URL}/api/punch/preview", json={"code": "7068"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # Le nom doit être abrégé "Julie G." (pas complet)
        name = data.get("employee_name", "")
        assert name == "Julie G." or (name.startswith("Julie") and len(name) < len("Julie Gagnon")), \
            f"Nom devrait être abrégé (Julie G.), obtenu: {name!r}"

    def test_profile_no_punch_code_field(self):
        tok = login(*ADMIN).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        r = requests.get(f"{BASE_URL}/api/profiles/e2", headers=h, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "punch_code" not in data, "punch_code ne doit PAS être exposé"
        assert "punch_code_hash" not in data, "punch_code_hash ne doit PAS être exposé"
        assert data.get("punch_code_set") is True, f"punch_code_set devrait être True: {data}"

    def test_regenerate_punch_code_e3(self):
        tok = login(*ADMIN).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        r = requests.post(f"{BASE_URL}/api/profiles/e3/punch-code", headers=h, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        new_code = data.get("punch_code") or data.get("code")
        assert new_code and len(str(new_code)) == 4, f"Nouveau NIP 4 chiffres attendu: {data}"

        # Preview avec le nouveau code doit fonctionner
        time.sleep(1)  # throttle protection
        p = requests.post(f"{BASE_URL}/api/punch/preview", json={"code": str(new_code)}, timeout=10)
        assert p.status_code == 200, f"Preview du nouveau NIP devrait passer: {p.status_code} {p.text}"


# ---------- Licence chiffrée ----------
class TestEncryptedLicense:
    def test_upload_and_retrieve_pdf_decrypted(self):
        tok = login(*ADMIN).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}

        # Générer un petit PDF valide
        buf = io.BytesIO()
        c = canvas.Canvas(buf)
        c.drawString(100, 750, "TEST_ENC_LICENSE iteration26")
        c.showPage()
        c.save()
        pdf_bytes = buf.getvalue()
        assert pdf_bytes.startswith(b"%PDF"), "Le PDF généré doit démarrer par %PDF"

        files = {"file": (f"test_enc_{uuid.uuid4().hex[:6]}.pdf", pdf_bytes, "application/pdf")}
        form = {
            "employee_id": "e2",
            "employee_name": "Julie Gagnon",
            "license_number": f"TEST-ENC-{uuid.uuid4().hex[:6]}",
            "expiry_date": "2027-06-30",
        }
        r = requests.post(f"{BASE_URL}/api/licenses", headers=h, data=form, files=files, timeout=30)
        assert r.status_code == 200, f"Création licence: {r.status_code} {r.text[:300]}"
        lic = r.json()
        lic_id = lic.get("id") or lic.get("_id")
        assert lic_id, f"ID licence manquant: {lic}"

        try:
            cert = requests.get(f"{BASE_URL}/api/licenses/{lic_id}/certificate", headers=h, timeout=15)
            assert cert.status_code == 200, cert.text[:300]
            content = cert.content
            assert content.startswith(b"%PDF"), f"Contenu déchiffré doit être PDF, obtenu: {content[:20]!r}"
            assert content == pdf_bytes, "PDF déchiffré doit être identique à l'original"
        finally:
            d = requests.delete(f"{BASE_URL}/api/licenses/{lic_id}", headers=h, timeout=10)
            assert d.status_code in (200, 204), f"Suppression: {d.status_code}"


# ---------- Verrou brute-force ----------
class TestBruteForceLock:
    def test_5_failed_logins_gives_429(self):
        fake_email = f"nobody-{uuid.uuid4().hex[:8]}@example.com"
        codes = []
        for i in range(6):
            r = login(fake_email, "wrongpwd12345")
            codes.append(r.status_code)
            if r.status_code == 429:
                break
        assert 429 in codes, f"Attendu 429 après 5 échecs, obtenu séquence: {codes}"


# ---------- Punch employé (regression) ----------
class TestJuliePunchMe:
    def test_julie_can_punch(self):
        tok = login(*JULIE).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        # Fermer si ouvert
        status = requests.get(f"{BASE_URL}/api/punch/me/status", headers=h, timeout=10)
        assert status.status_code == 200
        # Punch (in ou out selon état)
        r = requests.post(f"{BASE_URL}/api/punch/me", headers=h, json={}, timeout=10)
        assert r.status_code == 200, f"Punch employé: {r.status_code} {r.text}"
        # Fermer/annuler pour ne pas laisser d'ouvert
        st = requests.get(f"{BASE_URL}/api/punch/me/status", headers=h, timeout=10).json()
        if st.get("has_open_punch") or st.get("open"):
            requests.post(f"{BASE_URL}/api/punch/me", headers=h, json={}, timeout=10)
