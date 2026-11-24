"""Sliding-window rate limiter used as a per-session countermeasure."""

from __future__ import annotations

import threading
import time
from collections import deque


class SlidingWindowLimiter:
    """Allow at most ``limit`` events in any rolling ``window_s`` seconds."""

    def __init__(self, limit: int, window_s: float = 60.0) -> None:
        if limit < 1:
            raise ValueError("limit must be at least 1")
        self.limit = limit
        self.window_s = window_s
        self._events: deque[float] = deque()
        self._lock = threading.Lock()

    def allow(self, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            cutoff = now - self.window_s
            while self._events and self._events[0] <= cutoff:
                self._events.popleft()
            if len(self._events) >= self.limit:
                return False
            self._events.append(now)
            return True
