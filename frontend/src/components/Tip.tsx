import { useId, useState, type ReactNode } from "react";

/** A small "i" button that explains a control. Works with hover, focus and tap. */
export function Tip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="tip-trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className="tip-bubble">
          {children}
        </span>
      )}
    </span>
  );
}
