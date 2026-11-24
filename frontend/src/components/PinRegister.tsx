import type { AttackView } from "../api";

interface Props {
  pinLength: number;
  attack: AttackView | null;
}

/** The hero: one slot per PIN digit, filled in as the attack locks digits in. */
export function PinRegister({ pinLength, attack }: Props) {
  const running = attack?.status === "running";
  const finished = attack && attack.status !== "running";
  const digits = (finished ? attack.recovered ?? attack.recovered_so_far : attack?.recovered_so_far) ?? "";
  const active = running ? attack.recovered_so_far.length : -1;

  const slotClass = (i: number) => {
    if (i < digits.length) {
      if (finished && attack.status === "done") return attack.correct ? "slot verified" : "slot wrong";
      return `slot locked-in ${attack?.target === "secure" ? "secure" : ""}`;
    }
    return i === active ? "slot active" : "slot";
  };

  return (
    <div className="register-block" data-tour="register">
      <div className="register" role="group" aria-label="Recovered PIN">
        {Array.from({ length: pinLength }, (_, i) => (
          <div key={i} className={slotClass(i)} aria-label={`Digit ${i + 1}: ${digits[i] ?? "unknown"}`}>
            <span className="slot-index" aria-hidden="true">{i + 1}</span>
            <span aria-hidden="true">{digits[i] ?? "?"}</span>
          </div>
        ))}
      </div>
      <div className="register-status" aria-live="polite" style={{ marginTop: 14 }}>
        <StatusLine attack={attack} pinLength={pinLength} />
      </div>
    </div>
  );
}

function StatusLine({ attack, pinLength }: { attack: AttackView | null; pinLength: number }) {
  if (!attack) {
    return <span>The server is holding a secret {pinLength}-digit PIN. Nobody here knows it yet.</span>;
  }
  const where = attack.target === "vulnerable" ? "the vulnerable login" : "the constant-time login";
  switch (attack.status) {
    case "running":
      return (
        <>
          <span>Attacking {where}: testing digit <strong>{attack.position + 1}</strong> of {pinLength}</span>
          <span>{attack.total_requests.toLocaleString()} guesses sent</span>
          <span>{attack.elapsed_s.toFixed(1)} s</span>
        </>
      );
    case "done":
      return attack.correct ? (
        <>
          <span className="verdict good">PIN recovered. The server accepted {attack.recovered}.</span>
          <span>{attack.total_requests.toLocaleString()} guesses in {attack.elapsed_s.toFixed(1)} s, instead of up to {(10 ** pinLength).toLocaleString()} by brute force</span>
        </>
      ) : (
        <>
          <span className="verdict bad">Attack failed. The server rejected {attack.recovered}.</span>
          <span>{attack.target === "secure"
            ? "Every digit took the same time, so the timings gave nothing away."
            : "The leak was too faint against the noise. Try more samples or less jitter."}</span>
        </>
      );
    case "failed":
      if (attack.error?.includes("not implemented")) {
        return <span className="verdict bad">The attack could not run: backend/attacker/attack.py is not written yet.</span>;
      }
      return <span className="verdict bad">Attack blocked: {friendlyError(attack.error)}</span>;
    case "stopped":
      return <span>Attack stopped after {attack.total_requests.toLocaleString()} guesses.</span>;
  }
}

function friendlyError(error?: string) {
  if (!error) return "unknown reason.";
  if (error.startsWith("423")) return "the session locked after too many wrong guesses.";
  if (error.startsWith("429")) return "the rate limit refused further guesses.";
  return error;
}
