import { useState } from "react";
import { api, type LoginResult, type Target } from "../api";
import { fmtMs, fmtUs } from "../format";
import { Tip } from "./Tip";

interface Props {
  sessionId: string;
  pinLength: number;
  onActivity: () => void;
}

interface Row extends LoginResult {
  n: number;
  guess: string;
  target: Target;
  repeats: number;
}

/**
 * Manual probing from the browser: the student types a guess, it is sent to
 * both logins, and the round-trip time is measured here with performance.now().
 */
export function ProbePanel({ sessionId, pinLength, onActivity }: Props) {
  const [guess, setGuess] = useState("");
  const [repeats, setRepeats] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = guess.length === pinLength && /^\d+$/.test(guess);

  async function send(target: Target) {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      // Take the median of several tries so one slow network hop does not mislead.
      const results: LoginResult[] = [];
      for (let i = 0; i < repeats; i++) {
        const r = await api.login(sessionId, guess, target);
        if (r.status >= 400 && r.status !== 401) {
          setError(r.error ?? `The server answered ${r.status}.`);
          break;
        }
        results.push(r);
      }
      if (results.length) {
        const sorted = [...results].sort((a, b) => a.rtt_ms - b.rtt_ms);
        const mid = sorted[Math.floor(sorted.length / 2)];
        setRows((prev) => [{ ...mid, n: (prev[0]?.n ?? 0) + 1, guess, target, repeats: results.length }, ...prev].slice(0, 40));
      }
    } catch {
      setError("The server could not be reached. Check that the backend is running.");
    } finally {
      setBusy(false);
      onActivity();
    }
  }

  const suggestions = Array.from({ length: 3 }, (_, i) => String(i * 3 + 1).padEnd(pinLength, "0"));

  return (
    <div className="bench">
      <section className="panel" data-tour="probe" aria-labelledby="probe-title">
        <div className="panel-head">
          <h2 id="probe-title">Guess by hand</h2>
          <Tip>This is what the automated attack does, slowed down. Your browser sends the guess and times the reply itself.</Tip>
        </div>
        <p className="panel-note">
          Try guesses that change only the first digit, like {suggestions.join(", ")}. On the vulnerable login,
          one of the ten first digits takes noticeably longer. That is the first digit of the PIN.
        </p>
        <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); send("vulnerable"); }}>
          <label className="field">
            <span className="field-label">Your guess ({pinLength} digits)</span>
            <input type="text" inputMode="numeric" autoComplete="off" maxLength={pinLength} value={guess}
              placeholder={"0".repeat(pinLength)} style={{ fontFamily: "var(--mono)", letterSpacing: "0.2em" }}
              onChange={(e) => setGuess(e.target.value.replace(/\D/g, ""))} />
          </label>
          <div className="field">
            <span className="field-label">
              Tries per send
              <Tip>Each send repeats the guess this many times and keeps the median round trip.</Tip>
            </span>
            <div className="field-row">
              <input type="range" min={1} max={15} value={repeats} aria-label="Tries per send"
                onChange={(e) => setRepeats(Number(e.target.value))} />
              <output>{repeats}</output>
            </div>
          </div>
          <div className="button-row">
            <button type="submit" className="btn leak" disabled={!valid || busy}>Send to vulnerable</button>
            <button type="button" className="btn patched" disabled={!valid || busy} onClick={() => send("secure")}>Send to constant-time</button>
          </div>
        </form>
        {error && <p className="message error" role="alert">{error}</p>}
      </section>

      <section className="sheet" aria-labelledby="probe-log-title">
        <div className="sheet-head">
          <h2 id="probe-log-title">Your guesses</h2>
          {rows.length > 0 && <button className="btn secondary small" onClick={() => setRows([])}>Clear list</button>}
        </div>
        {rows.length === 0 ? (
          <div className="empty"><div><strong>Nothing sent yet.</strong><p>Type a guess and send it to either login.</p></div></div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Guess</th><th>Login</th><th>Result</th>
                  <th className="num">Round trip (median)</th><th className="num">Server time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td className="mono">{r.guess}</td>
                    <td><span className={`tag ${r.target}`}>{r.target === "vulnerable" ? "Vulnerable" : "Constant-time"}</span></td>
                    <td>{r.success ? <strong style={{ color: "var(--good)" }}>Accepted</strong> : "Rejected"}</td>
                    <td className="num">{fmtMs(r.rtt_ms)}</td>
                    <td className="num">{r.server_time_us === undefined ? "hidden" : fmtUs(r.server_time_us)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
