"""Statistics helpers for timing analysis."""
from statistics import median
from typing import List


def median_time(samples: List[float]) -> float:
    """Return the median of a list of timing samples (robust to outliers/jitter)."""
    if not samples:
        raise ValueError("no samples provided")
    return median(samples)


def best_candidate(candidate_medians: dict) -> str:
    """Given {candidate_digit: median_time}, return the digit with the highest
    median latency — the one most likely to be the correct next character,
    since a correct prefix character means one more comparison iteration
    before the early exit."""
    return max(candidate_medians, key=candidate_medians.get)


def signal_strength(candidate_medians: dict) -> float:
    """Gap between the top and second-best candidate. Used to report confidence
    and to decide whether to re-sample before locking in a digit."""
    values = sorted(candidate_medians.values(), reverse=True)
    if len(values) < 2:
        return 0.0
    return values[0] - values[1]