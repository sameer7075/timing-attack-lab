import { useState } from "react";
import type { Target } from "../api";
import { fmtUs, niceTicks } from "../format";

interface Props {
  medians: Record<string, number>;
  charset: string;
  target: Target;
  position: number;
  prefix: string;
  pinLength: number;
}

const W = 640;
const H = 300;
const M = { top: 28, right: 12, bottom: 44, left: 64 };

/**
 * Ten bars, one per candidate digit at the current position. With the
 * vulnerable compare, the right digit stands out as the tallest bar.
 */
export function CandidateChart({ medians, charset, target, position, prefix, pinLength }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const digits = charset.split("");
  const values = digits.map((d) => medians[d]).filter((v): v is number => v !== undefined);

  if (values.length === 0) {
    return (
      <div className="empty">
        <div>
          <strong>No measurements yet.</strong>
          <p>Start the attack and a bar will appear here for every digit the attacker tries.</p>
        </div>
      </div>
    );
  }

  const leader = digits.reduce((best, d) => ((medians[d] ?? -1) > (medians[best] ?? -1) ? d : best), digits[0]);
  const { top, ticks } = niceTicks(Math.max(...values) * 1.08);
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const band = innerW / digits.length;
  const barW = Math.min(36, band - 10);
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const accent = target === "vulnerable" ? "var(--leak)" : "var(--patched)";
  const guessFor = (d: string) => prefix + d + "0".repeat(Math.max(0, pinLength - position - 1));

  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Median response time for each candidate digit at position ${position + 1}. Slowest: ${leader} at ${fmtUs(medians[leader])}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "axis-line" : "grid-line"} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            <text x={M.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle">{fmtUs(t)}</text>
          </g>
        ))}
        {digits.map((d, i) => {
          const v = medians[d];
          const cx = M.left + band * i + band / 2;
          const isLeader = d === leader;
          const h = v === undefined ? 0 : Math.max(2, M.top + innerH - y(v));
          const r = Math.min(4, barW / 2, h);
          const x0 = cx - barW / 2;
          const yTop = M.top + innerH - h;
          return (
            <g key={d}>
              {v !== undefined && (
                <path
                  d={`M${x0},${M.top + innerH} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${M.top + innerH} Z`}
                  fill={isLeader ? accent : hover === d ? "var(--muted)" : "var(--idle)"}
                />
              )}
              {isLeader && v !== undefined && (
                <text className="value-label" x={cx} y={yTop - 8} textAnchor="middle">{fmtUs(v)}</text>
              )}
              <text x={cx} y={H - M.bottom + 20} textAnchor="middle"
                style={{ fontFamily: "var(--mono)", fontSize: 14, fill: isLeader ? "var(--ink)" : undefined, fontWeight: isLeader ? 700 : 500 }}>
                {d}
              </text>
              <rect className="hit" x={cx - band / 2} y={M.top} width={band} height={innerH + 30}
                onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
        <text x={M.left + innerW / 2} y={H - 4} textAnchor="middle">Candidate digit at position {position + 1}</text>
      </svg>
      {hover !== null && medians[hover] !== undefined && (
        <div className="chart-tooltip"
          style={{ left: `${((M.left + band * digits.indexOf(hover) + band / 2) / W) * 100}%`, top: `${(y(medians[hover]) / H) * 100}%` }}>
          <b>Digit {hover}: {fmtUs(medians[hover])}</b>
          <span>Median for guesses like {guessFor(hover)}</span>
        </div>
      )}
      <details className="data-table">
        <summary>Show as a table</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Digit</th><th>Example guess</th><th className="num">Median time</th></tr></thead>
            <tbody>
              {digits.map((d) => (
                <tr key={d}>
                  <td className="mono">{d}</td>
                  <td className="mono">{guessFor(d)}</td>
                  <td className="num">{medians[d] === undefined ? "–" : fmtUs(medians[d])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
