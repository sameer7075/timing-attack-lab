"""Side-by-side measurement of the two compare functions.

For each correct-prefix length k = 0..n we time guesses that match the
secret in exactly the first k digits. The vulnerable compare climbs a
staircase as k grows; the constant-time compare stays flat. Only timings
per k are returned, never the PIN or any guess built from it.
"""

from __future__ import annotations

import secrets
import time

import statistics

from .compare import insecure_compare, secure_compare
from .sessions import CHARSET, Session


def _guess_with_prefix(pin: str, k: int) -> str:
    if k >= len(pin):
        return pin
    wrong = secrets.choice([c for c in CHARSET if c != pin[k]])
    tail = "".join(secrets.choice(CHARSET) for _ in range(len(pin) - k - 1))
    return pin[:k] + wrong + tail


def _summarise(times_ns: list[int]) -> dict:
    us = [t / 1000 for t in times_ns]
    deciles = statistics.quantiles(us, n=10)
    return {
        "median_us": round(statistics.median(us), 2),
        "p10_us": round(deciles[0], 2),
        "p90_us": round(deciles[-1], 2),
    }


def run_benchmark(session: Session, samples: int) -> dict:
    amplify = session.config.amplify_ms
    rows = []
    for k in range(session.pin_length + 1):
        vuln, safe = [], []
        for _ in range(samples):
            guess = _guess_with_prefix(session.pin, k)
            t0 = time.perf_counter_ns()
            insecure_compare(guess, session.pin, delay_ms=amplify)
            vuln.append(time.perf_counter_ns() - t0)
            t0 = time.perf_counter_ns()
            secure_compare(guess, session.pin)
            safe.append(time.perf_counter_ns() - t0)
        rows.append({"prefix_len": k, "vulnerable": _summarise(vuln), "secure": _summarise(safe)})
    return {"samples": samples, "amplify_ms": amplify, "pin_length": session.pin_length, "rows": rows}
