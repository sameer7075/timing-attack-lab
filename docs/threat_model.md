2. Threat model

Assets

A per-session secret PIN (6 digits, generated with secrets)
The authentication decision (accept or reject)

Adversary (attacker)

Network attacker who can call the login API as many times as they like (up to any rate limit we add)
Can craft arbitrary guesses and precisely measure response latency
Knows the algorithm, the PIN length and the charset (Kerckhoffs's principle)
Does not have server memory access, source access to the secret, or the ability to modify the server

Trust boundaries

Browser/attacker client: untrusted
Backend server: trusted and honest, but its implementation may leak via timing
Optional server-side timing oracle: enabled only in demo mode, and documented as a debugging aid that isolates leakage from network noise

Security goals

Goal	Vulnerable endpoint	Patched endpoint
Secret confidentiality against timing observation	✗ Broken	✓ Holds
Attacker cost to recover a 6-digit PIN	~10 × 6 = 60 guess groups (linear)	Brute force only: up to 10⁶

Out of scope (state this explicitly in the report): power or EM side channels, cache or Spectre-style attacks, server compromise, DoS, and TLS-level attacks.

Why it works: early-exit comparison runs longer for each correct leading character, so total time is a function of the correct-prefix length. This reduces the search space from 10ⁿ to 10·n.