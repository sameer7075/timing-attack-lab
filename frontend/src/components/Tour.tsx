import { useEffect, useRef } from "react";

export interface TourStep {
  /** value of the data-tour attribute to highlight */
  anchor: string;
  /** tab that must be visible for this step */
  tab: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { anchor: "register", tab: "attack", title: "The secret PIN",
    body: "The server picked a random PIN for your session. These boxes fill in as the attacker works out each digit. The PIN itself is never sent to your browser." },
  { anchor: "attack", tab: "attack", title: "Launch the attack",
    body: "Choose which login to attack and press Start. Begin with Vulnerable: it should recover the whole PIN in under a minute." },
  { anchor: "chart", tab: "attack", title: "Read the leak",
    body: "Each bar is how long the server took to reject guesses ending in that digit. On the vulnerable login one bar stands taller: that digit is correct." },
  { anchor: "defences", tab: "attack", title: "Turn on defences",
    body: "Add jitter, rate limiting or a lockout, apply, and attack again. Notice which ones actually stop the attack and which only slow it down." },
  { anchor: "probe", tab: "probe", title: "Try it yourself",
    body: "Send guesses by hand and time them in your own browser. Change only the first digit and look for the slow one." },
  { anchor: "compare", tab: "compare", title: "See the fix",
    body: "Measure both checks side by side. The vulnerable one climbs with every correct digit; the constant-time one stays flat." },
];

interface Props {
  step: number;
  onStep: (n: number) => void;
  onClose: () => void;
}

export function Tour({ step, onStep, onClose }: Props) {
  const current = TOUR_STEPS[step];
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.anchor}"]`);
    if (!el) return;
    el.classList.add("tour-highlight");
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    return () => el.classList.remove("tour-highlight");
  }, [current.anchor]);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLButtonElement>("button.btn:not(.secondary)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  const last = step === TOUR_STEPS.length - 1;

  return (
    <>
      <div className="tour-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" ref={cardRef}>
        <p className="tour-progress">Step {step + 1} of {TOUR_STEPS.length}</p>
        <h2 id="tour-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="tour-nav">
          <button className="btn secondary small" onClick={onClose}>Close tour</button>
          <div className="button-row">
            {step > 0 && <button className="btn secondary small" onClick={() => onStep(step - 1)}>Back</button>}
            <button className="btn small" onClick={() => (last ? onClose() : onStep(step + 1))}>{last ? "Finish" : "Next"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
