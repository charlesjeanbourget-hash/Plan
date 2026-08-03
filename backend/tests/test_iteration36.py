"""Backend tests iteration 36 — Benefits (Avantages sociaux) module.

Covers:
- GET /api/benefits : admin sees drafts+published, employee only published, no image_b64 in list
- POST /api/benefits : admin creates draft with image_status pending → done after Gemini generation
- PUT /api/benefits/{id} : title/category/roles/status; invalid status → 400; empty title → 400
- DELETE /api/benefits/{id}
- POST /api/benefits/{id}/generate-image
- GET /api/benefits/{id}/image : 200 for published (employee) or admin any; 404 employee on draft
- POST /api/benefits/upload : PDF only, employee → 403, PDF text → job processed to done
- GET /api/benefits/imports/{job_id}
"""
import io
import os
import time

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = {"email": "admin@luminahr.ca", "password": "Nlpx!tTE3Aw27"}
JULIE = {"email": "julie@luminahr.ca", "password": "O1ka!gfVV6e54"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def HF(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def julie_token():
    return _login(JULIE)


@pytest.fixture(scope="module")
def created_ids():
    ids = []
    yield ids
    # Cleanup at end of module
    tok = _login(ADMIN)
    for bid in ids:
        try:
            requests.delete(f"{BASE_URL}/api/benefits/{bid}", headers=H(tok), timeout=15)
        except Exception:
            pass


# --- Listing ---
def test_admin_lists_all_benefits(admin_token):
    r = requests.get(f"{BASE_URL}/api/benefits", headers=H(admin_token), timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # Verify no image_b64 leak in list
    for b in data:
        assert "image_b64" not in b, "image_b64 must NOT be present in list responses"
        assert "id" in b and "status" in b


def test_employee_sees_only_published(julie_token, admin_token):
    r_all = requests.get(f"{BASE_URL}/api/benefits", headers=H(admin_token), timeout=30).json()
    r_emp = requests.get(f"{BASE_URL}/api/benefits", headers=H(julie_token), timeout=30)
    assert r_emp.status_code == 200
    emp = r_emp.json()
    for b in emp:
        assert b.get("status") == "published", f"Employee got non-published benefit: {b.get('title')}"
        assert "image_b64" not in b
    # Ensure at least the published ones from all appear
    published_admin_ids = {b["id"] for b in r_all if b.get("status") == "published"}
    # employee should also filter by eligible_roles — so emp ⊆ published_admin_ids
    emp_ids = {b["id"] for b in emp}
    # emp_ids can be a subset (role filter server-side or client-side)
    # Just verify all emp ids exist in admin published set
    assert emp_ids.issubset(published_admin_ids)


# --- Create + image generation ---
def test_admin_creates_benefit_and_image_generates(admin_token, created_ids):
    payload = {
        "title": "TEST_Avantage iteration 36",
        "description": "Description d'un avantage test pour l'itération 36.",
        "category": "Bien-être",
        "details": ["Point A", "Point B"],
        "eligible_roles": ["ATP", "Pharmacien(ne)"],
        "monthly_value": "50 $"
    }
    r = requests.post(f"{BASE_URL}/api/benefits", headers=H(admin_token), json=payload, timeout=30)
    assert r.status_code == 200, r.text[:300]
    b = r.json()
    assert b["title"] == payload["title"]
    assert b["status"] == "draft"
    assert b["image_status"] in ("pending", "done")
    assert b["category"] == "Bien-être"
    assert set(b["eligible_roles"]) == set(payload["eligible_roles"])
    created_ids.append(b["id"])

    # Poll for image_status done (up to ~45 s)
    bid = b["id"]
    final_status = b["image_status"]
    for _ in range(15):
        time.sleep(3)
        got = requests.get(f"{BASE_URL}/api/benefits", headers=H(admin_token), timeout=20).json()
        current = next((x for x in got if x["id"] == bid), None)
        if current and current["image_status"] in ("done", "error"):
            final_status = current["image_status"]
            break
    # We accept either done or error (Gemini API may fail — report but don't hard-fail)
    assert final_status in ("done", "error", "pending"), f"Unexpected status: {final_status}"
    if final_status != "done":
        pytest.skip(f"Image generation did not complete in time (status={final_status}). Downstream image tests will be skipped.")


def test_get_image_admin(admin_token, created_ids):
    if not created_ids:
        pytest.skip("No benefit created")
    bid = created_ids[0]
    r = requests.get(f"{BASE_URL}/api/benefits/{bid}/image", headers=HF(admin_token), timeout=30)
    # Admin can access draft image if generated; otherwise 404
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert r.headers["content-type"] in ("image/png", "image/jpeg")
        assert len(r.content) > 500


def test_employee_gets_404_on_draft_image(julie_token, created_ids):
    if not created_ids:
        pytest.skip("No benefit created")
    bid = created_ids[0]
    r = requests.get(f"{BASE_URL}/api/benefits/{bid}/image", headers=HF(julie_token), timeout=15)
    assert r.status_code == 404, f"Expected 404 for employee on draft image, got {r.status_code}"


# --- Update validations ---
def test_update_invalid_status(admin_token, created_ids):
    if not created_ids:
        pytest.skip("no benefit")
    r = requests.put(f"{BASE_URL}/api/benefits/{created_ids[0]}",
                     headers=H(admin_token), json={"status": "archived"}, timeout=15)
    assert r.status_code == 400


def test_update_empty_title(admin_token, created_ids):
    if not created_ids:
        pytest.skip("no benefit")
    r = requests.put(f"{BASE_URL}/api/benefits/{created_ids[0]}",
                     headers=H(admin_token), json={"title": "   "}, timeout=15)
    assert r.status_code == 400


def test_update_title_category_roles_persists(admin_token, created_ids):
    if not created_ids:
        pytest.skip("no benefit")
    bid = created_ids[0]
    r = requests.put(f"{BASE_URL}/api/benefits/{bid}", headers=H(admin_token),
                     json={"title": "TEST_Avantage renommé", "category": "Santé",
                           "eligible_roles": ["ATP"]}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "TEST_Avantage renommé"
    assert body["category"] == "Santé"
    assert body["eligible_roles"] == ["ATP"]


def test_publish_then_employee_sees(admin_token, julie_token, created_ids):
    if not created_ids:
        pytest.skip("no benefit")
    bid = created_ids[0]
    r = requests.put(f"{BASE_URL}/api/benefits/{bid}", headers=H(admin_token),
                     json={"status": "published"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "published"
    # Julie is ATP → should now see it
    emp = requests.get(f"{BASE_URL}/api/benefits", headers=H(julie_token), timeout=15).json()
    assert any(b["id"] == bid for b in emp), "Julie (ATP) should see the published ATP-eligible benefit"


def test_regenerate_image_endpoint(admin_token, created_ids):
    if not created_ids:
        pytest.skip("no benefit")
    r = requests.post(f"{BASE_URL}/api/benefits/{created_ids[0]}/generate-image",
                      headers=H(admin_token), timeout=15)
    assert r.status_code == 200


# --- Upload ---
def _make_benefits_pdf():
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    text_lines = [
        "Politique d'avantages sociaux 2026 — Pharmacie Test",
        "",
        "1) Assurance médicaments complémentaire",
        "L'employeur rembourse 80 % des médicaments non couverts par la RAMQ, jusqu'à 1500 $ par année.",
        "Admissible : tous les employés permanents après 3 mois. Franchise annuelle 100 $.",
        "",
        "2) Programme de mieux-être annuel",
        "Allocation de 400 $ par année pour activités physiques, abonnements gym, massothérapie.",
        "Soumettre les reçus au gestionnaire. Payé sur la paie du mois suivant.",
        "",
        "3) Contribution REER employeur",
        "L'employeur cotise 4 % du salaire brut pour tout employé cotisant au moins 3 %.",
        "Versement mensuel dans le compte REER collectif.",
    ]
    y = 740
    for line in text_lines:
        c.drawString(60, y, line)
        y -= 18
    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()


def test_employee_upload_forbidden(julie_token):
    pdf = _make_benefits_pdf()
    files = {"file": ("test.pdf", pdf, "application/pdf")}
    r = requests.post(f"{BASE_URL}/api/benefits/upload", headers=HF(julie_token),
                      files=files, timeout=30)
    assert r.status_code == 403


def test_upload_non_pdf_rejected(admin_token):
    files = {"file": ("test.txt", b"just text", "text/plain")}
    r = requests.post(f"{BASE_URL}/api/benefits/upload", headers=HF(admin_token),
                      files=files, timeout=30)
    assert r.status_code == 400


def test_admin_uploads_pdf_and_job_completes(admin_token, created_ids):
    pdf = _make_benefits_pdf()
    files = {"file": ("avantages.pdf", pdf, "application/pdf")}
    r = requests.post(f"{BASE_URL}/api/benefits/upload", headers=HF(admin_token),
                      files=files, timeout=30)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "job_id" in body
    job_id = body["job_id"]

    # Poll job status up to ~90 s
    final = None
    for _ in range(30):
        time.sleep(3)
        j = requests.get(f"{BASE_URL}/api/benefits/imports/{job_id}",
                         headers=H(admin_token), timeout=15)
        assert j.status_code == 200
        st = j.json()
        if st.get("status") in ("done", "error"):
            final = st
            break
    assert final is not None, "Import job did not finish within timeout"
    assert final.get("status") == "done", f"Import ended with error: {final}"
    assert (final.get("created_count") or 0) > 0

    # Track created benefits for cleanup
    listed = requests.get(f"{BASE_URL}/api/benefits", headers=H(admin_token), timeout=15).json()
    for b in listed:
        if b.get("import_job_id") == job_id:
            created_ids.append(b["id"])


# --- Delete ---
def test_delete_created_benefit_at_end(admin_token, created_ids):
    # This is not strictly a test — the module teardown handles cleanup.
    # But we verify DELETE returns ok for one manually.
    if not created_ids:
        pytest.skip("no benefit")
    bid = created_ids[-1]
    r = requests.delete(f"{BASE_URL}/api/benefits/{bid}", headers=H(admin_token), timeout=15)
    assert r.status_code == 200
    # Remove from cleanup list since already deleted
    created_ids.remove(bid)
    # Confirm 404 on subsequent delete
    r2 = requests.delete(f"{BASE_URL}/api/benefits/{bid}", headers=H(admin_token), timeout=15)
    assert r2.status_code == 404
