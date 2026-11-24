import type { Target } from "../api";
import { Tip } from "./Tip";

interface Props {
  target: Target;
  samples: number;
  useServerTime: boolean;
  oracleOn: boolean;
  running: boolean;
  pinLength: number;
  error: string | null;
  onTarget: (t: Target) => void;
  onSamples: (n: number) => void;
  onServerTime: (v: boolean) => void;
  onStart: () => void;
  onStop: () => void;
}

export function AttackPanel(p: Props) {
  const estimate = 10 * p.samples * p.pinLength;
  return (
    <section className="panel" data-tour="attack" aria-labelledby="attack-title">
      <div className="panel-head">
        <h2 id="attack-title">Automated attack</h2>
        <Tip>The attacker sends guesses that differ only in one digit, times every response, and keeps the digit whose guesses are slowest. Then it moves on to the next digit.</Tip>
      </div>

      <div className="field">
        <span className="field-label">
          Login to attack
          <Tip>Vulnerable stops comparing at the first wrong digit, so time grows with each correct digit. Constant-time uses hmac.compare_digest, which always takes the same time.</Tip>
        </span>
        <div className="segmented" role="group" aria-label="Login to attack">
          <button type="button" className="vulnerable" aria-pressed={p.target === "vulnerable"}
            disabled={p.running} onClick={() => p.onTarget("vulnerable")}>Vulnerable</button>
          <button type="button" className="secure" aria-pressed={p.target === "secure"}
            disabled={p.running} onClick={() => p.onTarget("secure")}>Constant-time</button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          Samples per digit
          <Tip>How many times each candidate digit is tried. The attacker uses the median, so more samples beat more noise, at the cost of more guesses.</Tip>
        </span>
        <div className="field-row">
          <input type="range" min={1} max={50} value={p.samples} disabled={p.running}
            aria-label="Samples per digit" onChange={(e) => p.onSamples(Number(e.target.value))} />
          <output>{p.samples}</output>
        </div>
        <p className="panel-note">Up to {estimate.toLocaleString()} guesses, against {(10 ** p.pinLength).toLocaleString()} for brute force.</p>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={p.useServerTime} disabled={p.running || !p.oracleOn}
          onChange={(e) => p.onServerTime(e.target.checked)} />
        Use server-side timing
        <Tip>Measure only the time spent inside the compare, ignoring network and jitter. Needs "Reveal server-side timing" switched on in Server settings.</Tip>
      </label>

      <div className="button-row">
        {p.running ? (
          <button className="btn secondary" onClick={p.onStop}>Stop attack</button>
        ) : (
          <button className={`btn ${p.target === "vulnerable" ? "leak" : "patched"}`} onClick={p.onStart}>
            Start attack
          </button>
        )}
      </div>
      {p.error && <p className="message error" role="alert">{p.error}</p>}
    </section>
  );
}
