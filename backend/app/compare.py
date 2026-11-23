import hmac


def insecure_compare(guess: str, secret: str, delay_ms: float = 0.0) -> bool:
    """Early-exit comparison. Deliberately vulnerable to timing attacks."""
    import time
    if len(guess) != len(secret):
        return False
    for g, s in zip(guess, secret):
        if g != s:
            return False
        if delay_ms:
            time.sleep(delay_ms / 1000)  # amplification (demo only)
    return True


def secure_compare(guess: str, secret: str) -> bool:
    """Constant-time comparison using the standard library."""
    return hmac.compare_digest(guess.encode(), secret.encode())