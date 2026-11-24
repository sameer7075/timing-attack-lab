"""In-memory session store.

Each session owns one secret PIN (generated with ``secrets``), its live
countermeasure configuration, and the counters used by rate limiting and
lockout. Nothing here is persisted: restarting the server wipes all sessions,
which is the intended lifecycle for a lab secret (see docs/threat_model.md).
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

from .ratelimit import SlidingWindowLimiter

CHARSET = "0123456789"
SESSION_TTL_S = 30 * 60
MAX_SESSIONS = 500
PIN_LENGTH_MIN, PIN_LENGTH_MAX = 4, 8


@dataclass
class SessionConfig:
    amplify_ms: float = 2.0
    jitter_ms: float = 0.0
    rate_limit_per_min: Optional[int] = None
    lockout_after: Optional[int] = None
    oracle_mode: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Session:
    session_id: str
    pin: str
    created_at: float
    config: SessionConfig = field(default_factory=SessionConfig)
    failed_attempts: int = 0
    locked: bool = False
    total_attempts: int = 0
    limiter: Optional[SlidingWindowLimiter] = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    @property
    def pin_length(self) -> int:
        return len(self.pin)

    @property
    def expires_at(self) -> float:
        return self.created_at + SESSION_TTL_S

    def expires_in_s(self) -> int:
        return max(0, int(self.expires_at - time.time()))

    def apply_config(self, changes: dict) -> None:
        """Apply a partial config update and reset the countermeasure counters.

        Counters are reset on every change so a presenter can re-run a demo
        after a lockout without creating a new session.
        """
        with self.lock:
            for key, value in changes.items():
                setattr(self.config, key, value)
            rpm = self.config.rate_limit_per_min
            self.limiter = SlidingWindowLimiter(rpm, 60.0) if rpm else None
            self.failed_attempts = 0
            self.locked = False

    def public_view(self) -> dict:
        """Everything about the session that is safe to show. Never the PIN."""
        return {
            "session_id": self.session_id,
            "pin_length": self.pin_length,
            "charset": CHARSET,
            "amplify_ms": self.config.amplify_ms,
            "expires_in_s": self.expires_in_s(),
        }

    def status_view(self) -> dict:
        return {
            **self.public_view(),
            "config": self.config.as_dict(),
            "failed_attempts": self.failed_attempts,
            "locked": self.locked,
            "total_attempts": self.total_attempts,
        }


def generate_pin(length: int) -> str:
    return "".join(secrets.choice(CHARSET) for _ in range(length))


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def _purge_expired(self) -> None:
        now = time.time()
        for sid in [s for s, sess in self._sessions.items() if sess.expires_at <= now]:
            del self._sessions[sid]

    def create(self, pin_length: int, amplify_ms: float) -> Session:
        with self._lock:
            self._purge_expired()
            if len(self._sessions) >= MAX_SESSIONS:
                # Evict the oldest session rather than refusing service.
                oldest = min(self._sessions.values(), key=lambda s: s.created_at)
                del self._sessions[oldest.session_id]
            session = Session(
                session_id=secrets.token_urlsafe(16),
                pin=generate_pin(pin_length),
                created_at=time.time(),
                config=SessionConfig(amplify_ms=amplify_ms),
            )
            self._sessions[session.session_id] = session
            return session

    def get(self, session_id: str) -> Optional[Session]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            if session.expires_at <= time.time():
                del self._sessions[session_id]
                return None
            return session

    def __len__(self) -> int:
        return len(self._sessions)


store = SessionStore()
