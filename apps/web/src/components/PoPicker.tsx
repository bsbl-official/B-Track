import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Named } from "../types";

// POs carry their own colour; people (testers) use a neutral one.
type Option = Named & { color?: string };
const NEUTRAL = "#5f6673";

export function PoChips({ pos, placeholder = "Select PO…" }: { pos: Option[]; placeholder?: string }) {
  if (pos.length === 0) return <span className="po-placeholder">{placeholder}</span>;
  return (
    <span className="po-chips">
      {pos.map((po) => (
        <span key={po.id} className="po-chip" style={{ "--pill": po.color ?? NEUTRAL } as CSSProperties}>{po.name}</span>
      ))}
    </span>
  );
}

/**
 * Pick one or more POs (or, with `required={false}`, any number of people, e.g. testers). The choice is reported when the list closes, so editing a sheet
 * cell saves once rather than on every tick.
 */
export function PoPicker({
  options,
  value,
  onChange,
  onCreate,
  disabled,
  variant = "cell",
  label = "PO",
  placeholder,
  required = true,
}: {
  options: Option[];
  value: string[];
  onChange: (ids: string[]) => void;
  onCreate?: () => Promise<string | null>;
  disabled?: boolean;
  variant?: "cell" | "field";
  label?: string;
  placeholder?: string;
  // At least one must stay selected (POs). Testers may be cleared to none.
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  const close = () => {
    setOpen(false);
    const next = draftRef.current;
    const changed = next.length !== value.length || next.some((id) => !value.includes(id));
    if (changed && (next.length > 0 || !required)) onChange(next);
    if (next.length === 0 && required) setDraft(value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    // The sheet scrolls; a fixed panel would drift, so close it instead.
    const onScroll = (event: Event) => !panel.current?.contains(event.target as Node) && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  const toggleOpen = () => {
    if (open) return close();
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    // Open upwards when there isn't room below (e.g. near the bottom of the modal).
    setPosition(
      below >= 260 || below >= above
        ? { top: rect.bottom + 6, left, width, maxHeight: Math.min(340, below) }
        : { bottom: window.innerHeight - rect.top + 6, left, width, maxHeight: Math.min(340, above) },
    );
    setOpen(true);
  };

  const toggle = (id: string) =>
    setDraft((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const selected = options.filter((option) => draft.includes(option.id));

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`po-trigger po-trigger--${variant}`}
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected.map((po) => po.name).join(", ") || "none"}`}
      >
        <PoChips pos={selected} placeholder={placeholder} />
        {!disabled && (
          <svg className="po-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        )}
      </button>
      {/* Rendered on <body> so the surrounding form or table styles can't reach it. */}
      {open && position && createPortal(
        <div ref={panel} className="po-panel" style={{ top: position.top, bottom: position.bottom, left: position.left, minWidth: position.width, maxHeight: position.maxHeight }} role="listbox" aria-multiselectable="true" onClick={(event) => event.stopPropagation()}>
          <div className="po-options">
            {options.map((option) => (
              <label key={option.id} className={`po-option ${draft.includes(option.id) ? "checked" : ""}`}>
                <input type="checkbox" checked={draft.includes(option.id)} onChange={() => toggle(option.id)} />
                <span className="po-swatch" style={{ background: option.color ?? NEUTRAL }} aria-hidden="true" />
                <span className="po-option-name">{option.name}</span>
              </label>
            ))}
          </div>
          {draft.length === 0 && required && <p className="po-hint">Pick at least one PO.</p>}
          <div className="po-panel-footer">
            {onCreate && (
              <button
                type="button"
                className="text-button"
                onClick={async () => {
                  const id = await onCreate();
                  if (id) setDraft((current) => [...current, id]);
                }}
              >
                ＋ New PO
              </button>
            )}
            <button type="button" className="small-primary" onClick={close} disabled={draft.length === 0 && required}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
