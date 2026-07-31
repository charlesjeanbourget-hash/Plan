"""Iteration 18 — Delivery proof (photo/signature) backend tests."""
import os
from pathlib import Path
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

MANAGER = ("gestion@luminahr.ca", "gestion123")
JULIE = ("julie@luminahr.ca", "employe123")

# 1x1 PNG data URL
PNG_DATAURL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)


def login(email, pwd):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def manager_token():
    return login(*MANAGER)


@pytest.fixture(scope="module")
def julie_token():
    return login(*JULIE)


@pytest.fixture(scope="module")
def julie_employee_id(julie_token):
    r = requests.get(f"{BASE}/api/auth/me", headers={"Authorization": f"Bearer {julie_token}"})
    assert r.status_code == 200
    eid = r.json().get("employee_id") or "e2"
    return eid


def _create(manager_token, julie_id, tag="TEST_proof"):
    r = requests.post(
        f"{BASE}/api/deliveries",
        headers={"Authorization": f"Bearer {manager_token}"},
        json={
            "client_name": f"{tag}", "address": "123 rue Test, Montréal",
            "phone": "5145550000", "priority": "normal",
            "courier_employee_id": julie_id, "courier_name": "Julie Lavoie",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _delete(manager_token, did):
    requests.delete(f"{BASE}/api/deliveries/{did}", headers={"Authorization": f"Bearer {manager_token}"})


class TestDeliveryProof:
    def test_full_flow_with_signature(self, manager_token, julie_token, julie_employee_id):
        did = _create(manager_token, julie_employee_id, "TEST_proof_sig")
        try:
            h = {"Authorization": f"Bearer {julie_token}"}
            r = requests.put(f"{BASE}/api/deliveries/{did}/status", headers=h, json={"status": "en_route"})
            assert r.status_code == 200
            assert r.json()["status"] == "en_route"

            r = requests.put(
                f"{BASE}/api/deliveries/{did}/status", headers=h,
                json={"status": "livree", "proof_image": PNG_DATAURL, "proof_type": "signature"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "livree"
            assert body["proof_type"] == "signature"
            assert body["proof_image"].startswith("data:image/")

            r = requests.get(f"{BASE}/api/deliveries", headers=h)
            assert r.status_code == 200
            found = [d for d in r.json() if d["id"] == did][0]
            assert found["proof_type"] == "signature"
            assert found["proof_image"].startswith("data:image/")
        finally:
            _delete(manager_token, did)

    def test_invalid_proof_format(self, manager_token, julie_token, julie_employee_id):
        did = _create(manager_token, julie_employee_id, "TEST_proof_bad")
        try:
            h = {"Authorization": f"Bearer {julie_token}"}
            requests.put(f"{BASE}/api/deliveries/{did}/status", headers=h, json={"status": "en_route"})
            r = requests.put(
                f"{BASE}/api/deliveries/{did}/status", headers=h,
                json={"status": "livree", "proof_image": "notavaliddataurl", "proof_type": "signature"},
            )
            assert r.status_code == 400
        finally:
            _delete(manager_token, did)

    def test_invalid_proof_type(self, manager_token, julie_token, julie_employee_id):
        did = _create(manager_token, julie_employee_id, "TEST_proof_type")
        try:
            h = {"Authorization": f"Bearer {julie_token}"}
            requests.put(f"{BASE}/api/deliveries/{did}/status", headers=h, json={"status": "en_route"})
            r = requests.put(
                f"{BASE}/api/deliveries/{did}/status", headers=h,
                json={"status": "livree", "proof_image": PNG_DATAURL, "proof_type": "invalidtype"},
            )
            assert r.status_code == 400
        finally:
            _delete(manager_token, did)

    def test_livree_without_proof(self, manager_token, julie_token, julie_employee_id):
        did = _create(manager_token, julie_employee_id, "TEST_proof_none")
        try:
            h = {"Authorization": f"Bearer {julie_token}"}
            requests.put(f"{BASE}/api/deliveries/{did}/status", headers=h, json={"status": "en_route"})
            r = requests.put(f"{BASE}/api/deliveries/{did}/status", headers=h, json={"status": "livree"})
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "livree"
            assert not body.get("proof_image")
        finally:
            _delete(manager_token, did)

    def test_photo_proof(self, manager_token, julie_token, julie_employee_id):
        did = _create(manager_token, julie_employee_id, "TEST_proof_photo")
        try:
            h = {"Authorization": f"Bearer {julie_token}"}
            requests.put(f"{BASE}/api/deliveries/{did}/status", headers=h, json={"status": "en_route"})
            r = requests.put(
                f"{BASE}/api/deliveries/{did}/status", headers=h,
                json={"status": "livree", "proof_image": PNG_DATAURL, "proof_type": "photo"},
            )
            assert r.status_code == 200
            assert r.json()["proof_type"] == "photo"
        finally:
            _delete(manager_token, did)
