"""Login logic shared by the HTTP endpoints and the in-process attack runner.

Keeping one code path means every countermeasure (rate limit, lockout,
jitter) affects the automated attack exactly the way it affects a person
sending guesses by hand.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Literal, Optional

from .compare import insecure_compare, secure_compare
from .sessions import CHARSET, Session

Target = Literal["vulnerable", "secure"]

_jitter_rng = random.SystemRandom()


@dataclass
class LoginOutcome:
    status_code: int
    success: bool = False
    server_time_ns: Optional[int] = None
    error: Optional[str] = None


def validate_guess(session: Session, guess: str) -> Optional[str]:
    if len(guess) != session.pin_length:
        return f"guess must be exactly {session.pin_length} digits"
    if any(ch not in CHARSET for ch in guess):
        return "guess may only contain the digits 0-9"
    return None


def attempt_login(session: Session, guess: str, target: Target) -> LoginOutcome:
    problem = validate_guess(session, guess)
    if problem:
        return LoginOutcome(400, error=problem)

    cfg = session.config
    with session.lock:
        if session.locked:
            return LoginOutcome(423, error="session is locked after too many failed guesses")
        if session.limiter is not None and not session.limiter.allow():
            return LoginOutcome(429, error="rate limit exceeded, slow down")
        session.total_attempts += 1

    start = time.perf_counter_ns()
    if target == "vulnerable":
        ok = insecure_compare(guess, session.pin, delay_ms=cfg.amplify_ms)
    else:
        ok = secure_compare(guess, session.pin)
    server_time_ns = time.perf_counter_ns() - start

    # Jitter is added *outside* the measured compare window on purpose: it
    # hides the leak from a network observer but not from the server-side
    # oracle, which is the lesson the "weak mitigation" toggle teaches.
    if cfg.jitter_ms > 0:
        time.sleep(_jitter_rng.uniform(0, cfg.jitter_ms) / 1000)

    with session.lock:
        if ok:
            session.failed_attempts = 0
        else:
            session.failed_attempts += 1
            if cfg.lockout_after and session.failed_attempts >= cfg.lockout_after:
                session.locked = True

    return LoginOutcome(200 if ok else 401, success=ok, server_time_ns=server_time_ns)
