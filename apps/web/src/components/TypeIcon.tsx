import type { CSSProperties } from "react";
import type { Colored } from "../types";

// Glyph by type name; anything else falls back to its first letter.
function Glyph({ name }: { name: string }) {
  const key = name.toLowerCase();
  if (key.includes("bug")) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 5.5a2.5 2.5 0 0 1 5 0" />
        <rect x="4.5" y="5.5" width="7" height="8" rx="3.5" />
        <path d="M8 8v5.5M4.5 9H2M14 9h-2.5M4.8 12 3 13.5M11.2 12l1.8 1.5M4.8 6.5 3 5M11.2 6.5 13 5" />
      </svg>
    );
  }
  if (key.includes("feature")) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8 6.6 6.6Z" />
      </svg>
    );
  }
  return <span className="type-letter">{name.slice(0, 1).toUpperCase()}</span>;
}

/**
 * Bug / Feature shown as an icon before the issue title. When editable, a transparent native
 * <select> sits on top, so a click opens the normal dropdown to change or clear it.
 */
export function TypeIcon({
  type,
  types,
  disabled,
  onChange,
}: {
  type: Colored | null;
  types: Colored[];
  disabled?: boolean;
  onChange?: (typeId: string | null) => void;
}) {
  const label = type ? type.name : "No type";
  const style = type ? ({ "--pill": type.color } as CSSProperties) : undefined;

  return (
    <span className={`type-icon ${type ? "" : "empty"} ${disabled ? "" : "editable"}`} style={style} title={disabled ? label : `${label}: click to change`}>
      {type ? <Glyph name={type.name} /> : <span className="type-empty" aria-hidden="true" />}
      {!disabled && onChange && (
        <select value={type?.id ?? ""} onChange={(event) => onChange(event.target.value || null)} aria-label={`Type: ${label}`}>
          <option value="">No type</option>
          {types.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      )}
      {(disabled || !onChange) && <span className="visually-hidden">{label}</span>}
    </span>
  );
}
