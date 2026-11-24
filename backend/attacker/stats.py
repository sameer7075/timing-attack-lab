"""Statistics helpers for the attacker."""
from __future__ import annotations

from statistics import median
from typing import Dict


def median_time(samples: list[float]) -> float:
    """Median of a list of timing samples in microseconds."""
    if not samples:
        raise ValueError("no samples provided")
    return median(samples)


def best_candidate(medians: Dict[str, float]) -> str:
    """Candidate with the highest median latency: one more compare
    iteration ran before the early exit, so it's the likely correct digit."""
    return max(medians, key=medians.get)


def confidence(medians: Dict[str, float]) -> float:
    """Relative margin between the best and second-best candidate, as a
    fraction of the best value. 0 means no signal; higher is more certain."""
    values = sorted(medians.values(), reverse=True)
    if len(values) < 2 or values[0] == 0:
        return 0.0
    return (values[0] - values[1]) / values[0]