// Typed client for the endpoints in docs/api_contract.md.

export type Target = "vulnerable" | "secure";

export interface SessionInfo {
  session_id: string;
  pin_length: number;
  charset: string;
  amplify_ms: number;
  expires_in_s: number;
}

export interface SessionConfig {
  amplify_ms: number;
  jitter_ms: number;
  rate_limit_per_min: number | null;
  lockout_after: number | null;
  oracle_mode: boolean;
}

export interface SessionStatus extends SessionInfo {
  config: SessionConfig;
  failed_attempts: number;
  locked: boolean;
  total_attempts: number;
}

export interface LoginResult {
  status: number;
  success: boolean;
  server_time_us?: number;
  error?: string;
  rtt_ms: number;
}

export interface PositionHistory {
  position: number;
  chosen: string;
  confidence: number | null;
  medians_us: Record<string, number>;
}

export interface AttackView {
  attack_id: string;
  status: "running" | "done" | "failed" | "stopped";
  target: Target;
  samples: number;
  use_server_time: boolean;
  pin_length: number;
  position: number;
  recovered_so_far: string;
  candidate_medians_us: Record<string, number>;
  history: PositionHistory[];
  total_requests: number;
  elapsed_s: number;
  recovered?: string | null;
  correct?: boolean | null;
  error?: string;
}

export interface BenchStat {
  median_us: number;
  p10_us: number;
  p90_us: number;
}

export interface BenchmarkResult {
  samples: number;
  amplify_ms: number;
  pin_length: number;
  rows: { prefix_len: number; vulnerable: BenchStat; secure: BenchStat }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `request failed (${res.status})`);
  return data as T;
}

export const api = {
  createSession: (pin_length: number, amplify_ms: number) =>
    call<SessionInfo>("POST", "/api/session", { pin_length, amplify_ms }),
  getSession: (id: string) => call<SessionStatus>("GET", `/api/session/${id}`),
  updateConfig: (id: string, changes: Partial<SessionConfig>) =>
    call<SessionConfig>("PUT", `/api/session/${id}/config`, changes),
  startAttack: (session_id: string, target: Target, samples: number, use_server_time: boolean) =>
    call<{ attack_id: string }>("POST", "/api/attack/start", { session_id, target, samples, use_server_time }),
  attackStatus: (id: string) => call<AttackView>("GET", `/api/attack/${id}`),
  stopAttack: (id: string) => call<unknown>("POST", `/api/attack/${id}/stop`),
  benchmark: (id: string, samples: number) =>
    call<BenchmarkResult>("POST", `/api/session/${id}/benchmark`, { samples }),

  /** One login attempt, timed in the browser. 401 is a normal "wrong PIN" answer, not an error. */
  async login(session_id: string, guess: string, target: Target): Promise<LoginResult> {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/login/${target}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, guess }),
    });
    const data = await res.json().catch(() => ({}));
    const rtt_ms = performance.now() - t0;
    return {
      status: res.status,
      success: Boolean(data.success),
      server_time_us: data.server_time_us,
      error: data.error,
      rtt_ms,
    };
  },
};
