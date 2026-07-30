"""LuminaHR backend tests. Backend only exposes GET /api/ and POST /api/chat (SSE)."""
import os
import json
import uuid
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Root endpoint
class TestRoot:
    def test_root(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("message") == "LuminaHR API"


# Chat SSE streaming
class TestChat:
    def test_chat_stream(self, api_client):
        session_id = f"TEST_{uuid.uuid4()}"
        payload = {"session_id": session_id, "message": "Bonjour, dis-moi bonjour en une phrase."}
        with api_client.post(f"{BASE_URL}/api/chat", json=payload, stream=True, timeout=60) as r:
            assert r.status_code == 200
            assert "text/event-stream" in r.headers.get("content-type", "")
            deltas = []
            done = False
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    done = True
                    break
                try:
                    obj = json.loads(data)
                    if "delta" in obj:
                        deltas.append(obj["delta"])
                except json.JSONDecodeError:
                    pass
            assert done, "Missing [DONE] terminator"
            joined = "".join(deltas)
            assert len(joined) > 0, "No content streamed from LLM"

    def test_chat_validation_missing_fields(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/chat", json={"session_id": "x"})
        assert r.status_code == 422
