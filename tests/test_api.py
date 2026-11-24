import time

import pytest

from backend.attacker import attack as attacker
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.sessions import store

client = TestClient(app)


def _attacker_ready() -> bool:
    try:
        attacker.recover_pin(lambda g: attacker.ProbeResult(0, False), length=4, should_stop=lambda: True)
    except NotImplementedError:
        return False
    return True


needs_attacker = pytest.mark.skipif(not _attacker_ready(), reason="backend/attacker/attack.py not implemented yet")


def new_session(**body):
    r = client.post("/api/session", json=body)
    assert r.status_code == 201
    data = r.json()
    return data["session_id"], store.get(data["session_id"]).pin


def wrong_pin(pin):
    return "".join("1" if c == "0" else "0" for c in pin)


def wait_for(attack_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        view = client.get(f"/api/attack/{attack_id}").json()
        if view["status"] != "running":
            return view
        time.sleep(0.1)
    raise AssertionError("attack did not finish")


def test_session_never_returns_pin():
    r = client.post("/api/session", json={"pin_length": 6})
    body = r.json()
    pin = store.get(body["session_id"]).pin
    assert set(body) == {"session_id", "pin_length", "charset", "amplify_ms", "expires_in_s"}
    assert pin not in r.text
    assert pin not in client.get(f"/api/session/{body['session_id']}").text


def test_session_defaults_without_body():
    r = client.post("/api/session")
    assert r.status_code == 201
    assert r.json()["pin_length"] == 6


@pytest.mark.parametrize("length", [3, 9])
def test_pin_length_bounds(length):
    r = client.post("/api/session", json={"pin_length": length})
    assert r.status_code == 400
    assert "error" in r.json()


@pytest.mark.parametrize("target", ["vulnerable", "secure"])
def test_login_right_and_wrong(target):
    sid, pin = new_session(amplify_ms=0)
    ok = client.post(f"/api/login/{target}", json={"session_id": sid, "guess": pin})
    assert ok.status_code == 200 and ok.json() == {"success": True}
    bad = client.post(f"/api/login/{target}", json={"session_id": sid, "guess": wrong_pin(pin)})
    assert bad.status_code == 401 and bad.json() == {"success": False}


def test_login_validation_and_unknown_session():
    sid, _ = new_session()
    assert client.post("/api/login/secure", json={"session_id": sid, "guess": "12"}).status_code == 400
    assert client.post("/api/login/secure", json={"session_id": sid, "guess": "12a456"}).status_code == 400
    r = client.post("/api/login/secure", json={"session_id": "nope", "guess": "123456"})
    assert r.status_code == 404 and r.json() == {"error": "unknown or expired session"}


def test_oracle_mode_adds_server_time():
    sid, pin = new_session(amplify_ms=0)
    r = client.post("/api/login/vulnerable", json={"session_id": sid, "guess": wrong_pin(pin)})
    assert "server_time_us" not in r.json()
    client.put(f"/api/session/{sid}/config", json={"oracle_mode": True})
    r = client.post("/api/login/vulnerable", json={"session_id": sid, "guess": wrong_pin(pin)})
    assert isinstance(r.json()["server_time_us"], int)


def test_partial_config_update():
    sid, _ = new_session()
    r = client.put(f"/api/session/{sid}/config", json={"jitter_ms": 1.5})
    assert r.json() == {"amplify_ms": 2.0, "jitter_ms": 1.5, "rate_limit_per_min": None,
                        "lockout_after": None, "oracle_mode": False}
    assert client.put(f"/api/session/{sid}/config", json={"amplify_ms": None}).status_code == 400


def test_lockout_then_reset_by_config_change():
    sid, pin = new_session(amplify_ms=0)
    client.put(f"/api/session/{sid}/config", json={"lockout_after": 3})
    codes = [client.post("/api/login/secure", json={"session_id": sid, "guess": wrong_pin(pin)}).status_code
             for _ in range(4)]
    assert codes == [401, 401, 401, 423]
    # Locked sessions refuse even the right PIN.
    assert client.post("/api/login/secure", json={"session_id": sid, "guess": pin}).status_code == 423
    client.put(f"/api/session/{sid}/config", json={"lockout_after": None})
    assert client.post("/api/login/secure", json={"session_id": sid, "guess": pin}).status_code == 200


def test_rate_limit():
    sid, pin = new_session(amplify_ms=0)
    client.put(f"/api/session/{sid}/config", json={"rate_limit_per_min": 5})
    codes = [client.post("/api/login/secure", json={"session_id": sid, "guess": wrong_pin(pin)}).status_code
             for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429


@needs_attacker
def test_attack_recovers_pin_from_vulnerable_endpoint():
    sid, pin = new_session(pin_length=4, amplify_ms=2)
    r = client.post("/api/attack/start", json={"session_id": sid, "target": "vulnerable", "samples": 5})
    assert r.status_code == 202
    view = wait_for(r.json()["attack_id"])
    assert view["status"] == "done"
    assert view["recovered"] == pin and view["correct"] is True
    assert "pin" not in view


@needs_attacker
def test_attack_fails_against_secure_endpoint():
    sid, pin = new_session(pin_length=4, amplify_ms=2)
    r = client.post("/api/attack/start", json={"session_id": sid, "target": "secure", "samples": 3})
    view = wait_for(r.json()["attack_id"])
    assert view["status"] == "done"
    # A random 4-digit guess is right 1 time in 10,000.
    assert view["correct"] is (view["recovered"] == pin)


@needs_attacker
def test_attack_blocked_by_lockout():
    sid, _ = new_session(pin_length=4, amplify_ms=1)
    client.put(f"/api/session/{sid}/config", json={"lockout_after": 20})
    r = client.post("/api/attack/start", json={"session_id": sid, "samples": 5})
    view = wait_for(r.json()["attack_id"])
    assert view["status"] == "failed" and view["error"].startswith("423")


def test_attack_reports_missing_attacker_module():
    if _attacker_ready():
        pytest.skip("attacker implemented")
    sid, _ = new_session(pin_length=4)
    attack_id = client.post("/api/attack/start", json={"session_id": sid}).json()["attack_id"]
    view = wait_for(attack_id)
    assert view["status"] == "failed" and "not implemented" in view["error"]


def test_attack_needs_oracle_for_server_time():
    sid, _ = new_session()
    r = client.post("/api/attack/start", json={"session_id": sid, "use_server_time": True})
    assert r.status_code == 400


@needs_attacker
def test_attack_can_be_stopped():
    sid, _ = new_session(pin_length=8, amplify_ms=3)
    attack_id = client.post("/api/attack/start", json={"session_id": sid, "samples": 50}).json()["attack_id"]
    assert client.post(f"/api/attack/{attack_id}/stop").status_code == 200
    assert wait_for(attack_id)["status"] == "stopped"


def test_benchmark_shows_staircase_only_for_vulnerable():
    sid, pin = new_session(pin_length=4, amplify_ms=2)
    r = client.post(f"/api/session/{sid}/benchmark", json={"samples": 5})
    rows = r.json()["rows"]
    assert len(rows) == 5 and pin not in r.text
    vuln = [row["vulnerable"]["median_us"] for row in rows]
    assert vuln[-1] - vuln[0] > 4 * 2000 * 0.8  # ~2 ms per matched digit
    secure = [row["secure"]["median_us"] for row in rows]
    assert max(secure) < 1000
