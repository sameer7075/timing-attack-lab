# tests/test_recover_pin.py
from backend.attacker.attack import recover_pin, ProbeResult

SECRET = "4729"

def fake_probe_factory(delay_per_match=1.0):
    """Simulates an early-exit vulnerable compare: elapsed time grows
    with the number of correctly matched leading characters."""
    def probe(guess: str) -> ProbeResult:
        matched = 0
        for g, s in zip(guess, SECRET):
            if g != s:
                break
            matched += 1
        elapsed = matched * delay_per_match
        return ProbeResult(elapsed_us=elapsed, success=(guess == SECRET))
    return probe

def test_recovers_correct_pin_with_clear_signal():
    probe = fake_probe_factory()
    result = recover_pin(probe, length=4, charset="0123456789", samples=5)
    assert result is not None
    assert result.recovered == SECRET

def test_should_stop_returns_none():
    probe = fake_probe_factory()
    result = recover_pin(probe, length=4, should_stop=lambda: True)
    assert result is None