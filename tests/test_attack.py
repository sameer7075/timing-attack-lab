from backend.attacker.stats import median_time, best_candidate, signal_strength


def test_best_candidate_picks_highest():
    medians = {"0": 100, "1": 95, "2": 210, "3": 90}
    assert best_candidate(medians) == "2"


def test_signal_strength_gap():
    medians = {"0": 100, "1": 210}
    assert signal_strength(medians) == 110


def test_median_time_basic():
    assert median_time([1, 2, 3]) == 2