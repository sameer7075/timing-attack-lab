"""Background attack jobs.

Each job runs ``backend.attacker.attack.recover_pin`` in a thread, with a
probe that calls the same ``attempt_login`` the HTTP endpoints use. Targets
are always lab sessions held in this process; there is no way to point a
job at another host.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from backend.attacker.attack import PositionReport, ProbeBlocked, ProbeResult, recover_pin

from .auth import Target, attempt_login
from .sessions import CHARSET, Session

MAX_RUNNING_JOBS = 3
MAX_KEPT_JOBS = 200


@dataclass
class AttackJob:
    attack_id: str
    session: Session
    target: Target
    samples: int
    use_server_time: bool
    status: str = "running"
    position: int = 0
    recovered_so_far: str = ""
    candidate_medians_us: dict[str, float] = field(default_factory=dict)
    history: list[dict] = field(default_factory=list)
    total_requests: int = 0
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    recovered: Optional[str] = None
    correct: Optional[bool] = None
    error: Optional[str] = None
    stop_event: threading.Event = field(default_factory=threading.Event, repr=False)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def elapsed_s(self) -> float:
        end = self.finished_at or time.time()
        return round(end - self.started_at, 2)

    def view(self) -> dict:
        with self.lock:
            medians = {k: round(v) for k, v in self.candidate_medians_us.items()}
            base = {
                "attack_id": self.attack_id,
                "status": self.status,
                "target": self.target,
                "samples": self.samples,
                "use_server_time": self.use_server_time,
                "pin_length": self.session.pin_length,
                "position": self.position,
                "recovered_so_far": self.recovered_so_far,
                "candidate_medians_us": medians,
                "history": list(self.history),
                "total_requests": self.total_requests,
                "elapsed_s": self.elapsed_s(),
            }
            if self.status != "running":
                base.update(recovered=self.recovered, correct=self.correct)
            if self.error:
                base["error"] = self.error
            return base


class AttackManager:
    def __init__(self) -> None:
        self._jobs: dict[str, AttackJob] = {}
        self._lock = threading.Lock()

    def running_count(self) -> int:
        return sum(1 for j in self._jobs.values() if j.status == "running")

    def get(self, attack_id: str) -> Optional[AttackJob]:
        with self._lock:
            return self._jobs.get(attack_id)

    def start(self, session: Session, target: Target, samples: int, use_server_time: bool) -> AttackJob:
        with self._lock:
            for job in self._jobs.values():
                if job.session is session and job.status == "running":
                    raise RuntimeError("an attack is already running for this session")
            if self.running_count() >= MAX_RUNNING_JOBS:
                raise OverflowError("the server is busy with other attacks, try again shortly")
            self._evict_old()
            job = AttackJob(
                attack_id="atk_" + secrets.token_hex(8),
                session=session,
                target=target,
                samples=samples,
                use_server_time=use_server_time,
            )
            self._jobs[job.attack_id] = job
        threading.Thread(target=self._run, args=(job,), daemon=True, name=job.attack_id).start()
        return job

    def stop(self, attack_id: str) -> Optional[AttackJob]:
        job = self.get(attack_id)
        if job is not None:
            job.stop_event.set()
        return job

    def _evict_old(self) -> None:
        finished = [j for j in self._jobs.values() if j.status != "running"]
        finished.sort(key=lambda j: j.started_at)
        while len(self._jobs) >= MAX_KEPT_JOBS and finished:
            del self._jobs[finished.pop(0).attack_id]

    def _run(self, job: AttackJob) -> None:
        session = job.session

        def probe(guess: str) -> ProbeResult:
            start = time.perf_counter_ns()
            outcome = attempt_login(session, guess, job.target)
            round_trip_ns = time.perf_counter_ns() - start
            if outcome.status_code in (423, 429):
                raise ProbeBlocked(outcome.status_code, outcome.error or "blocked")
            if outcome.status_code == 400:
                raise ProbeBlocked(400, outcome.error or "bad guess")
            elapsed_ns = outcome.server_time_ns if job.use_server_time else round_trip_ns
            return ProbeResult(elapsed_us=elapsed_ns / 1000, success=outcome.success)

        def on_sample(total: int, prefix: str, medians: dict[str, float]) -> None:
            with job.lock:
                job.total_requests = total
                job.position = len(prefix)
                job.recovered_so_far = prefix
                job.candidate_medians_us = dict(medians)

        def on_position(report: PositionReport) -> None:
            with job.lock:
                job.recovered_so_far = report.recovered_so_far
                job.position = min(len(report.recovered_so_far), session.pin_length - 1)
                job.candidate_medians_us = dict(report.medians_us)
                job.history.append({
                    "position": report.position,
                    "chosen": report.chosen,
                    "confidence": None if report.confidence == float("inf") else round(report.confidence, 2),
                    "medians_us": {k: round(v) for k, v in report.medians_us.items()},
                })

        try:
            result = recover_pin(
                probe,
                length=session.pin_length,
                charset=CHARSET,
                samples=job.samples,
                on_position=on_position,
                on_sample=on_sample,
                should_stop=job.stop_event.is_set,
            )
        except NotImplementedError:
            self._finish(job, "failed", error="attacker module not implemented yet (backend/attacker/attack.py)")
            return
        except ProbeBlocked as blocked:
            self._finish(job, "failed", error=f"{blocked.status_code}: {blocked.reason}")
            return
        except Exception as exc:  # keep the job record useful instead of a dead thread
            self._finish(job, "failed", error=f"internal error: {exc.__class__.__name__}")
            return

        if result is None:
            self._finish(job, "stopped")
            return

        correct = result.found_by_success
        if not correct:
            # Confirm with one real login, the way an attacker would.
            try:
                correct = probe(result.recovered).success
            except ProbeBlocked:
                correct = False
        with job.lock:
            job.total_requests = result.total_requests
            job.recovered = result.recovered
            job.recovered_so_far = result.recovered
        self._finish(job, "done", correct=correct)

    @staticmethod
    def _finish(job: AttackJob, status: str, correct: Optional[bool] = None, error: Optional[str] = None) -> None:
        with job.lock:
            job.status = status
            job.finished_at = time.time()
            if correct is not None:
                job.correct = correct
            if error:
                job.error = error
            if job.recovered is None and status != "done":
                job.recovered = job.recovered_so_far or None


manager = AttackManager()
