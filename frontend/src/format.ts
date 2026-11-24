/** Format a microsecond value at a sensible precision for the lab's ranges. */
export function fmtUs(us: number): string {
  if (!Number.isFinite(us)) return "–";
  if (us === 0) return "0";
  if (us >= 1000) return `${(us / 1000).toFixed(us >= 10000 ? 1 : 2)} ms`;
  if (us >= 10) return `${Math.round(us)} µs`;
  return `${us.toFixed(1)} µs`;
}

export function fmtMs(ms: number): string {
  return ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(2)} ms`;
}

/** A tidy axis maximum and tick list for values from 0 to `max`. */
export function niceTicks(max: number, count = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}
