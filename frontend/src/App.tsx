import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AttackView, type SessionConfig, type SessionInfo, type SessionStatus, type Target } from "./api";
import { AttackPanel } from "./components/AttackPanel";
import { CandidateChart } from "./components/CandidateChart";
import { ComparePanel } from "./components/ComparePanel";
import { DefencesPanel } from "./components/DefencesPanel";
import { HowItWorks } from "./components/HowItWorks";
import { PinRegister } from "./components/PinRegister";
import { ProbePanel } from "./components/ProbePanel";
import { Tip } from "./components/Tip";
import { TOUR_STEPS, Tour } from "./components/Tour";

type Tab = "attack" | "probe" | "compare" | "learn";
const TABS: { id: Tab; label: string }[] = [
  { id: "attack", label: "Run the attack" },
  { id: "probe", label: "Guess by hand" },
  { id: "compare", label: "Compare the checks" },
  { id: "learn", label: "How it works" },
];

const SESSION_KEY = "tal.session";
const TOUR_KEY = "tal.tour-seen";

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [pinLength, setPinLength] = useState(6);
  const [tab, setTab] = useState<Tab>("attack");
  const [bootError, setBootError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [target, setTarget] = useState<Target>("vulnerable");
  const [samples, setSamples] = useState(15);
  const [useServerTime, setUseServerTime] = useState(false);
  const [attack, setAttack] = useState<AttackView | null>(null);
  const [attackError, setAttackError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const [tourStep, setTourStep] = useState<number | null>(null);

  const refreshStatus = useCallback(async (id: string) => {
    try {
      setStatus(await api.getSession(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setStatus(null);
      }
    }
  }, []);

  const newSession = useCallback(async (length: number) => {
    setBusy(true);
    setBootError(null);
    try {
      const s = await api.createSession(length, 2);
      localStorage.setItem(SESSION_KEY, s.session_id);
      setSession(s);
      setAttack(null);
      setAttackError(null);
      setUseServerTime(false);
      await refreshStatus(s.session_id);
    } catch {
      setBootError("The lab server is not answering. Start the backend and reload this page.");
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  // Resume the stored session if it is still alive, otherwise start a new one.
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    (async () => {
      if (stored) {
        try {
          const s = await api.getSession(stored);
          setSession(s);
          setStatus(s);
          setPinLength(s.pin_length);
          return;
        } catch {
          localStorage.removeItem(SESSION_KEY);
        }
      }
      await newSession(6);
    })();
    if (!localStorage.getItem(TOUR_KEY)) setTourStep(0);
  }, [newSession]);

  // Keep the counters (failed guesses, lockout) fresh while the page is open.
  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => refreshStatus(session.session_id), 3000);
    return () => window.clearInterval(id);
  }, [session, refreshStatus]);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  function stopPolling() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function startAttack() {
    if (!session) return;
    setAttackError(null);
    try {
      const { attack_id } = await api.startAttack(session.session_id, target, samples, useServerTime);
      setAttack(await api.attackStatus(attack_id));
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const view = await api.attackStatus(attack_id);
          setAttack(view);
          if (view.status !== "running") {
            stopPolling();
            refreshStatus(session.session_id);
          }
        } catch {
          stopPolling();
        }
      }, 500);
    } catch (e) {
      setAttackError(e instanceof ApiError ? e.message : "The server could not be reached.");
    }
  }

  async function stopAttack() {
    if (attack) await api.stopAttack(attack.attack_id).catch(() => undefined);
  }

  async function applyConfig(changes: Partial<SessionConfig>) {
    if (!session) return;
    setBusy(true);
    try {
      await api.updateConfig(session.session_id, changes);
      if (changes.oracle_mode === false) setUseServerTime(false);
      await refreshStatus(session.session_id);
    } catch (e) {
      setAttackError(e instanceof ApiError ? e.message : "The settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function goToStep(n: number) {
    setTab(TOUR_STEPS[n].tab as Tab);
    setTourStep(n);
  }

  function closeTour() {
    localStorage.setItem(TOUR_KEY, "1");
    setTourStep(null);
  }

  const running = attack?.status === "running";
  const length = session?.pin_length ?? pinLength;

  return (
    <div className="frame">
      <header className="topbar">
        <div className="wordmark">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="6" fill="var(--ink)" />
            <rect x="6" y="18" width="4" height="8" rx="1" fill="#8E9AAE" />
            <rect x="14" y="7" width="4" height="19" rx="1" fill="var(--leak)" />
            <rect x="22" y="18" width="4" height="8" rx="1" fill="#8E9AAE" />
          </svg>
          Timing Attack Lab
        </div>
        <div className="topbar-actions">
          {status && (
            <span className="session-chip">
              <span className={`dot ${status.locked ? "locked" : ""}`} aria-hidden="true" />
              {status.locked ? "Session locked" : `Session expires in ${Math.ceil(status.expires_in_s / 60)} min`}
            </span>
          )}
          <button className="btn secondary small" onClick={() => goToStep(0)}>Take the tour</button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Crack a PIN by timing the server's answers</h1>
          <p>
            The login below rejects wrong PINs a little faster when the first digits are wrong. Watch an
            attacker turn that difference into the whole PIN, then watch a one-line fix stop it.
          </p>
        </div>
        <PinRegister pinLength={length} attack={attack} />
        <div className="button-row" style={{ alignItems: "center" }}>
          <label className="field-row" style={{ gap: 8 }}>
            <span className="field-label">PIN length</span>
            <select value={pinLength} disabled={running || busy} style={{ width: "auto" }}
              onChange={(e) => setPinLength(Number(e.target.value))}>
              {[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} digits</option>)}
            </select>
          </label>
          <button className="btn secondary" disabled={running || busy} onClick={() => newSession(pinLength)}>
            Generate a new PIN
          </button>
          <Tip>Creates a fresh session with a new random PIN (from Python's secrets module) and default settings. Sessions expire after 30 minutes.</Tip>
        </div>
        {bootError && <p className="message error" role="alert">{bootError}</p>}
      </section>

      <nav className="tabs" role="tablist" aria-label="Lab sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
            className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {!session ? (
          <div className="empty"><div><strong>Connecting to the lab server…</strong></div></div>
        ) : tab === "attack" ? (
          <div className="bench">
            <div className="stack">
              <AttackPanel
                target={target} samples={samples} useServerTime={useServerTime}
                oracleOn={Boolean(status?.config.oracle_mode)} running={running} pinLength={length}
                error={attackError}
                onTarget={setTarget} onSamples={setSamples} onServerTime={setUseServerTime}
                onStart={startAttack} onStop={stopAttack}
              />
              <DefencesPanel status={status} busy={busy} onApply={applyConfig} />
            </div>
            <div className="stack">
              <section className="sheet" data-tour="chart" aria-labelledby="chart-title">
                <div className="sheet-head">
                  <h2 id="chart-title">
                    {attack ? `Response time per digit, position ${Math.min(attack.position, length - 1) + 1}` : "Response time per digit"}
                  </h2>
                  {attack && (
                    <span className={`tag ${attack.target}`}>
                      {attack.target === "vulnerable" ? "Vulnerable login" : "Constant-time login"}
                      {attack.use_server_time ? ", server timing" : ", round-trip timing"}
                    </span>
                  )}
                </div>
                <CandidateChart
                  medians={attack?.candidate_medians_us ?? {}}
                  charset={session.charset}
                  target={attack?.target ?? target}
                  position={Math.min(attack?.position ?? 0, length - 1)}
                  prefix={(attack?.recovered_so_far ?? "").slice(0, Math.min(attack?.position ?? 0, length - 1))}
                  pinLength={length}
                />
              </section>
              {attack && attack.history.length > 0 && <HistoryTable attack={attack} />}
            </div>
          </div>
        ) : tab === "probe" ? (
          <ProbePanel sessionId={session.session_id} pinLength={length} onActivity={() => refreshStatus(session.session_id)} />
        ) : tab === "compare" ? (
          <ComparePanel sessionId={session.session_id} pinLength={length} />
        ) : (
          <HowItWorks />
        )}
      </main>

      <footer className="footer">
        CS-3002 Information Security term project. This server is a deliberately vulnerable teaching target:
        the PIN is random per session and never leaves the server.
      </footer>

      {tourStep !== null && <Tour step={tourStep} onStep={goToStep} onClose={closeTour} />}
    </div>
  );
}

function HistoryTable({ attack }: { attack: AttackView }) {
  return (
    <section className="sheet" aria-labelledby="history-title">
      <div className="sheet-head"><h2 id="history-title">Digits locked in</h2></div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Position</th><th>Chosen digit</th><th className="num">Confidence</th><th className="num">Slowest median</th></tr>
          </thead>
          <tbody>
            {attack.history.map((h) => {
              const slowest = Math.max(...Object.values(h.medians_us), 0);
              return (
                <tr key={h.position}>
                  <td>{h.position + 1}</td>
                  <td className="mono">{h.chosen}</td>
                  <td className="num">{h.confidence === null ? "confirmed" : h.confidence.toFixed(1)}</td>
                  <td className="num">{slowest ? `${(slowest / 1000).toFixed(2)} ms` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
