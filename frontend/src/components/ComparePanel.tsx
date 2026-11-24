import { useState } from "react";
import { api, ApiError, type BenchmarkResult } from "../api";
import { fmtUs, niceTicks } from "../format";
import { Tip } from "./Tip";

const W = 680;
const H = 320;
const M = { top: 20, right: 120, bottom: 48, left: 72 };

export function ComparePanel({ sessionId, pinLength }: { sessionId: string; pinLength: number }) {
  const [samples, setSamples] = useState(25);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.benchmark(sessionId, samples));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bench">
      <section className="panel" data-tour="compare" aria-labelledby="compare-title">
        <div className="panel-head">
          <h2 id="compare-title">Compare the two checks</h2>
          <Tip>The server times both compare functions on guesses that share exactly 0, 1, 2… leading digits with the PIN. Only the timings come back, never the PIN.</Tip>
        </div>
        <p className="panel-note">
          A guess that gets more leading digits right should not take longer to reject. Measure both
          checks and see which one breaks that rule.
        </p>
        <div className="field">
          <span className="field-label">Samples per point</span>
          <div className="field-row">
            <input type="range" min={3} max={60} value={samples} aria-label="Samples per point"
              onChange={(e) => setSamples(Number(e.target.value))} />
            <output>{samples}</output>
          </div>
        </div>
        <div className="button-row">
          <button className="btn" disabled={busy} onClick={run}>{busy ? "Measuring…" : "Measure both checks"}</button>
        </div>
        {error && <p className="message error" role="alert">{error}</p>}
        {result && <Findings result={result} />}
      </section>

      <section className="sheet" aria-labelledby="compare-chart-title">
        <div className="sheet-head">
          <h2 id="compare-chart-title">Time to reject vs. correct leading digits</h2>
          <div className="legend">
            <span><i style={{ background: "var(--leak)" }} />Vulnerable (early exit)</span>
            <span><i style={{ background: "var(--patched)" }} />Constant-time (compare_digest)</span>
          </div>
        </div>
        {result ? <LineChart result={result} /> : (
          <div className="empty"><div><strong>No measurements yet.</strong><p>Measure both checks to draw the chart for this {pinLength}-digit PIN.</p></div></div>
        )}
      </section>
    </div>
  );
}

function Findings({ result }: { result: BenchmarkResult }) {
  const first = result.rows[0];
  const last = result.rows[result.rows.length - 1];
  const vulnSpread = last.vulnerable.median_us - first.vulnerable.median_us;
  const secureMeds = result.rows.map((r) => r.secure.median_us);
  const secureSpread = Math.max(...secureMeds) - Math.min(...secureMeds);
  const perDigit = vulnSpread / result.pin_length;
  return (
    <div className="stats" aria-live="polite">
      <div><b>{fmtUs(perDigit)}</b>extra per correct digit, vulnerable</div>
      <div><b>{fmtUs(secureSpread)}</b>spread across all points, constant-time</div>
    </div>
  );
}

function LineChart({ result }: { result: BenchmarkResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = result.rows;
  const maxV = Math.max(...rows.map((r) => Math.max(r.vulnerable.p90_us, r.secure.p90_us)));
  const { top, ticks } = niceTicks(maxV * 1.05);
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (k: number) => M.left + (k / Math.max(1, rows.length - 1)) * innerW;
  const y = (v: number) => M.top + innerH - (v / top) * innerH;

  const series = [
    { key: "vulnerable" as const, label: "Vulnerable", color: "var(--leak)" },
    { key: "secure" as const, label: "Constant-time", color: "var(--patched)" },
  ];

  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Line chart. Vulnerable compare time rises with each correct leading digit; constant-time stays flat.">
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "axis-line" : "grid-line"} x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} />
            <text x={M.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle">{fmtUs(t)}</text>
          </g>
        ))}
        {rows.map((r) => (
          <text key={r.prefix_len} x={x(r.prefix_len)} y={M.top + innerH + 20} textAnchor="middle">{r.prefix_len}</text>
        ))}
        <text x={M.left + innerW / 2} y={H - 6} textAnchor="middle">Leading digits that match the PIN</text>

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} stroke="var(--rule-strong)" strokeDasharray="3 3" />
        )}

        {series.map((s) => {
          const band = rows.map((r) => `${x(r.prefix_len)},${y(r[s.key].p90_us)}`).join(" ")
            + " " + [...rows].reverse().map((r) => `${x(r.prefix_len)},${y(r[s.key].p10_us)}`).join(" ");
          const line = rows.map((r) => `${x(r.prefix_len)},${y(r[s.key].median_us)}`).join(" ");
          const end = rows[rows.length - 1];
          return (
            <g key={s.key}>
              <polygon points={band} fill={s.color} opacity={0.12} />
              <polyline points={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {rows.map((r) => (
                <circle key={r.prefix_len} cx={x(r.prefix_len)} cy={y(r[s.key].median_us)} r={hover === r.prefix_len ? 5 : 4}
                  fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
              <text x={x(end.prefix_len) + 10} y={y(end[s.key].median_us)} dominantBaseline="middle"
                style={{ fill: "var(--ink)", fontWeight: 600 }}>{s.label}</text>
            </g>
          );
        })}

        {rows.map((r) => (
          <rect key={r.prefix_len} className="hit" x={x(r.prefix_len) - innerW / rows.length / 2} y={M.top}
            width={innerW / rows.length} height={innerH}
            onMouseEnter={() => setHover(r.prefix_len)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(rows[hover].vulnerable.median_us) / H) * 100}%` }}>
          <b>{hover} matching digit{hover === 1 ? "" : "s"}</b>
          <span>Vulnerable: {fmtUs(rows[hover].vulnerable.median_us)}</span><br />
          <span>Constant-time: {fmtUs(rows[hover].secure.median_us)}</span>
        </div>
      )}
      <p className="panel-note" style={{ marginTop: 8 }}>Lines show the median; the shaded band covers the 10th to 90th percentile.</p>
      <details className="data-table">
        <summary>Show as a table</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Matching digits</th><th className="num">Vulnerable median</th><th className="num">Constant-time median</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.prefix_len}>
                  <td>{r.prefix_len}</td>
                  <td className="num">{fmtUs(r.vulnerable.median_us)}</td>
                  <td className="num">{fmtUs(r.secure.median_us)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
