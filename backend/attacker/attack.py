"""Timing attack against the lab's login check.  >>> TODO: implement <<<

The backend (backend/app/attacks.py) already calls ``recover_pin`` from a
background thread when the UI presses "Start attack", and shows whatever
it reports. Until ``recover_pin`` is implemented, the attack ends with
status "failed" and the message "attacker module not implemented yet".

What the backend gives you
--------------------------
``probe(guess) -> ProbeResult``
    Sends one guess to the selected login (vulnerable or constant-time) of
    the session being attacked and returns how long it took in
    microseconds, plus whether the server accepted it. If a countermeasure
    refuses the guess (lockout 423, rate limit 429) the probe raises
    ``ProbeBlocked``; let it propagate and the backend marks the job failed.

What the backend expects back
-----------------------------
* Call ``on_sample(total_requests, recovered_so_far, medians_us)`` as you
  collect timings, so the live bar chart updates. ``medians_us`` maps each
  candidate character (e.g. "0".."9") to its current median time.
* Call ``on_position(PositionReport(...))`` each time you lock in a digit.
* Check ``should_stop()`` often and return ``None`` if it is true.
* Return a ``RecoveryResult`` when done. Set ``found_by_success=True`` if a
  probe came back with ``success=True`` (the backend then skips its own
  confirmation login).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional


class ProbeBlocked(Exception):
    """Raised by a probe when a countermeasure (rate limit, lockout) refuses it."""

    def __init__(self, status_code: int, reason: str) -> None:
        super().__init__(reason)
        self.status_code = status_code
        self.reason = reason


@dataclass
class ProbeResult:
    elapsed_us: float
    success: bool


Probe = Callable[[str], ProbeResult]


@dataclass
class PositionReport:
    position: int              # zero-based index of the digit just locked in
    recovered_so_far: str      # all digits locked in so far, including this one
    medians_us: dict[str, float]
    chosen: str                # the digit picked for this position
    confidence: float          # your own score; use float("inf") if certain


@dataclass
class RecoveryResult:
    recovered: str
    found_by_success: bool
    total_requests: int
    positions: list[PositionReport]


def recover_pin(
    probe: Probe,
    length: int,
    charset: str = "0123456789",
    samples: int = 15,
    on_position: Optional[Callable[[PositionReport], None]] = None,
    on_sample: Optional[Callable[[int, str, dict[str, float]], None]] = None,
    should_stop: Callable[[], bool] = lambda: False,
) -> Optional[RecoveryResult]:
    """Recover the PIN using only ``probe`` timings. Returns ``None`` if stopped."""
    raise NotImplementedError("attacker module not implemented yet")
