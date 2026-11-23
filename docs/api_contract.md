# API Contract: Timing Attack Lab

**Version:** 1.0 (draft)
**Owners:** Subhan (backend), Affaf (frontend consumer), Sameer (attacker module)
**Rule:** Any change to this file needs a PR reviewed by all three members.

## 1. Conventions

| Item | Value |
|---|---|
| Base path | `/api` |
| Format | JSON request and response (`Content-Type: application/json`) |
| Time units | All timings in **microseconds** (`_us` suffix) |
| Session | Identified by `session_id` returned from `POST /api/session` |
| Secrets | The PIN is **never** returned by any endpoint |
| Auto-docs | FastAPI Swagger UI at `/docs` |
| CORS | Enabled for the frontend origin if hosted separately |

### Uniform error shape

```json
{ "error": "short message" }
```

Error messages must not reveal anything about the secret (for example, never say "first digit correct").

### Common status codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Resource created |
| 202 | Accepted (async job started) |
| 400 | Malformed request or invalid field |
| 401 | Login guess incorrect |
| 404 | Unknown `session_id` or `attack_id` |
| 423 | Session locked out (lockout countermeasure) |
| 429 | Rate limit exceeded |

---

## 2. Endpoints

### 2.1 `POST /api/session`: create a session

Generates a fresh random PIN using `secrets`. All fields optional.

**Request**
```json
{
  "pin_length": 6,
  "amplify_ms": 2
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `pin_length` | int | 6 | Allowed range 4 to 8 |
| `amplify_ms` | float | 2 | Artificial delay per matched character in the vulnerable compare. 0 disables. |

**Response `201`**
```json
{
  "session_id": "k3J9x...",
  "pin_length": 6,
  "charset": "0123456789",
  "amplify_ms": 2,
  "expires_in_s": 1800
}
```

---

### 2.2 `POST /api/login/vulnerable`: login with early-exit comparison

### 2.3 `POST /api/login/secure`: login with `hmac.compare_digest`

Both endpoints share the same request and response shape. Only the comparison differs.

**Request**
```json
{
  "session_id": "k3J9x...",
  "guess": "123456"
}
```

**Response `200` (correct) or `401` (incorrect)**
```json
{
  "success": false,
  "server_time_us": 4210
}
```

| Field | Type | Notes |
|---|---|---|
| `success` | bool | Whether the guess matched |
| `server_time_us` | int | **Only present when `oracle_mode` is on.** Server-side time spent in the compare function. Omitted otherwise. |

**Other responses:** `400` (wrong length or non-digit characters), `404` (unknown session), `423` (locked), `429` (rate limited).

---

### 2.4 `PUT /api/session/{session_id}/config`: toggle countermeasures live

Used by the UI's settings panel. Only fields present in the body are changed.

**Request**
```json
{
  "amplify_ms": 2,
  "jitter_ms": 0,
  "rate_limit_per_min": null,
  "lockout_after": null,
  "oracle_mode": false
}
```

| Field | Type | Notes |
|---|---|---|
| `amplify_ms` | float | Per-matched-character delay (vulnerable endpoint only) |
| `jitter_ms` | float | Max random delay added to every response (demonstrates weak mitigation) |
| `rate_limit_per_min` | int or null | Null disables rate limiting |
| `lockout_after` | int or null | Lock the session after N failed guesses. Null disables. |
| `oracle_mode` | bool | Include `server_time_us` in login responses |

**Response `200`**: the full effective config (same fields as above).

---

### 2.5 `POST /api/attack/start`: launch the automated attack

Runs the attacker module server-side against the session's login endpoint.

**Request**
```json
{
  "session_id": "k3J9x...",
  "target": "vulnerable",
  "samples": 15,
  "use_server_time": false
}
```

| Field | Type | Notes |
|---|---|---|
| `target` | `"vulnerable"` or `"secure"` | Which endpoint to attack |
| `samples` | int | Requests per candidate digit; the median is taken (range 1 to 100) |
| `use_server_time` | bool | Use `server_time_us` instead of round-trip time (requires `oracle_mode`) |

**Response `202`**
```json
{ "attack_id": "atk_7f3a..." }
```

---

### 2.6 `GET /api/attack/{attack_id}`: attack progress

The frontend polls every ~500 ms. A WebSocket alternative may be added later at `/ws/attack/{attack_id}` with the same payload.

**Response `200` (running)**
```json
{
  "status": "running",
  "position": 2,
  "recovered_so_far": "47",
  "candidate_medians_us": {
    "0": 4010, "1": 4005, "2": 6120, "3": 4008, "4": 4011,
    "5": 4002, "6": 4009, "7": 4007, "8": 4012, "9": 4004
  },
  "total_requests": 450
}
```

**Response `200` (finished)**
```json
{
  "status": "done",
  "recovered": "472913",
  "correct": true,
  "elapsed_s": 41.2,
  "total_requests": 900,
  "candidate_medians_us": { "...": "last position's medians" }
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | `"running"`, `"done"`, `"failed"`, `"stopped"` | |
| `position` | int | Zero-based index of the digit currently being recovered |
| `recovered_so_far` | string | Digits locked in so far |
| `candidate_medians_us` | object | Median latency