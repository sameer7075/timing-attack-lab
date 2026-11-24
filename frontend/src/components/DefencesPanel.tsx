import { useEffect, useState } from "react";
import type { SessionConfig, SessionStatus } from "../api";
import { Tip } from "./Tip";

interface Props {
  status: SessionStatus | null;
  busy: boolean;
  onApply: (changes: Partial<SessionConfig>) => Promise<void>;
}

/** Live server settings: the leak amplifier and the countermeasures. */
export function DefencesPanel({ status, busy, onApply }: Props) {
  const [draft, setDraft] = useState<SessionConfig | null>(status?.config ?? null);
  const [rateOn, setRateOn] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const [rate, setRate] = useState(120);
  const [lock, setLock] = useState(25);
  const saved = status?.config;

  // Re-sync the form whenever the server's copy changes (new session, applied changes).
  useEffect(() => {
    if (!saved) return;
    setDraft(saved);
    setRateOn(saved.rate_limit_per_min !== null);
    setLockOn(saved.lockout_after !== null);
    if (saved.rate_limit_per_min !== null) setRate(saved.rate_limit_per_min);
    if (saved.lockout_after !== null) setLock(saved.lockout_after);
  }, [saved?.amplify_ms, saved?.jitter_ms, saved?.rate_limit_per_min, saved?.lockout_after, saved?.oracle_mode, status?.session_id]);

  if (!draft || !saved) return null;

  const next: SessionConfig = {
    ...draft,
    rate_limit_per_min: rateOn ? rate : null,
    lockout_after: lockOn ? lock : null,
  };
  const dirty = (Object.keys(next) as (keyof SessionConfig)[]).some((k) => next[k] !== saved[k]);

  return (
    <section className="panel" data-tour="defences" aria-labelledby="defences-title">
      <div className="panel-head">
        <h2 id="defences-title">Server settings</h2>
        <Tip>These change how the login server behaves for your session. Applying them also clears the failed-guess counter and any lockout.</Tip>
      </div>

      <div className="field">
        <span className="field-label">
          Leak amplifier
          <Tip>Extra delay the vulnerable check adds for every digit that matches. Real servers leak nanoseconds; this makes the same leak big enough to see over a network. Set it to 0 to see how hard the raw leak is to measure.</Tip>
        </span>
        <div className="field-row">
          <input type="range" min={0} max={10} step={0.5} value={draft.amplify_ms}
            aria-label="Leak amplifier in milliseconds"
            onChange={(e) => setDraft({ ...draft, amplify_ms: Number(e.target.value) })} />
          <output>{draft.amplify_ms} ms</output>
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          Random jitter
          <Tip>Adds a random delay of up to this much to every response. It hides the leak behind noise, but averaging enough samples cancels the noise out again, so it is a weak defence on its own.</Tip>
        </span>
        <div className="field-row">
          <input type="range" min={0} max={20} step={0.5} value={draft.jitter_ms}
            aria-label="Random jitter in milliseconds"
            onChange={(e) => setDraft({ ...draft, jitter_ms: Number(e.target.value) })} />
          <output>{draft.jitter_ms} ms</output>
        </div>
      </div>

      <div className="field">
        <label className="toggle">
          <input type="checkbox" checked={rateOn} onChange={(e) => setRateOn(e.target.checked)} />
          Rate limit
          <Tip>Refuses guesses beyond this many per minute (HTTP 429). It does not fix the leak, it just makes collecting enough samples take much longer.</Tip>
        </label>
        {rateOn && (
          <div className="field-row">
            <input type="number" min={1} max={10000} value={rate} aria-label="Guesses allowed per minute"
              onChange={(e) => setRate(Math.max(1, Number(e.target.value) || 1))} />
            <output>per min</output>
          </div>
        )}
      </div>

      <div className="field">
        <label className="toggle">
          <input type="checkbox" checked={lockOn} onChange={(e) => setLockOn(e.target.checked)} />
          Lock after failed guesses
          <Tip>Locks the session after this many wrong guesses in a row (HTTP 423). A timing attack needs hundreds of wrong guesses, so this stops it cold, at the cost of letting anyone lock a real user out.</Tip>
        </label>
        {lockOn && (
          <div className="field-row">
            <input type="number" min={1} max={10000} value={lock} aria-label="Wrong guesses before lockout"
              onChange={(e) => setLock(Math.max(1, Number(e.target.value) || 1))} />
            <output>guesses</output>
          </div>
        )}
      </div>

      <label className="toggle">
        <input type="checkbox" checked={draft.oracle_mode}
          onChange={(e) => setDraft({ ...draft, oracle_mode: e.target.checked })} />
        Reveal server-side timing
        <Tip>Debug mode: login responses include server_time_us, the time spent inside the compare itself. It strips out network noise and jitter, which shows how much the leak exists independently of the network.</Tip>
      </label>

      <div className="button-row">
        <button className="btn secondary" disabled={!dirty || busy} onClick={() => onApply(next)}>
          Apply settings
        </button>
      </div>

      {status && (
        <div className="stats">
          {status.locked
            ? <strong style={{ color: "var(--bad)" }}>Session locked. Apply settings to unlock it.</strong>
            : <div><b>{status.failed_attempts.toLocaleString()}</b>wrong guesses in a row</div>}
          <div><b>{status.total_attempts.toLocaleString()}</b>guesses this session</div>
        </div>
      )}
    </section>
  );
}
