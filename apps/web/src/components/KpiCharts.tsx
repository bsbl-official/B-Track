import type { KpiPerson } from "../types";

// Delivery against the promised (first probable) date. Status colours, always shown with a mark and a label;
// "no date" sits between the two so green and red never touch.
export const DELIVERY = [
  { key: "onTime", label: "On time", icon: "✓", color: "#0ca30c" },
  { key: "noDate", label: "No promised date", icon: "–", color: "#a3a7ae" },
  { key: "late", label: "Late", icon: "!", color: "#d03b3b" },
] as const;

export function DeliveryLegend() {
  return (
    <ul className="kpi-legend">
      {DELIVERY.map((item) => (
        <li key={item.key}><span className="kpi-key" style={{ background: item.color }}>{item.icon}</span>{item.label}</li>
      ))}
    </ul>
  );
}

// One stacked bar per person: completed tasks split by delivery, scaled to the busiest person.
export function TeamDeliveryChart({ people }: { people: KpiPerson[] }) {
  const max = Math.max(1, ...people.map((person) => person.summary.completed));
  return (
    <div className="kpi-team-bars">
      {people.map(({ person, summary }) => (
        <div key={person.id} className="kpi-team-row">
          <span className="kpi-row-label" title={person.name}>{person.name}</span>
          <span className="kpi-stack-track">
            {summary.completed > 0 && (
              <span className="kpi-stack" style={{ width: `${(summary.completed / max) * 100}%` }}>
                {DELIVERY.map((item) => {
                  const count = summary[item.key];
                  if (!count) return null;
                  return (
                    <span key={item.key} className="kpi-seg" style={{ flexGrow: count, background: item.color }} title={`${item.label}: ${count}`}>
                      {count / max >= 0.08 && <span className={item.key === "noDate" ? "dark" : ""}>{count}</span>}
                    </span>
                  );
                })}
              </span>
            )}
            <strong className="kpi-stack-total">{summary.completed}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

// "under 1 hour", "5 hours", "2.5 days" (24 hours = 1 day).
export function formatDuration(hours: number) {
  if (hours < 1) return "under 1 hour";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export type Slice = { key: string; label: string; value: number; color: string; icon?: string };

const MAX_SLICES = 6;
const OTHER_COLOR = "#a3a7ae";

// Part-to-whole as a donut. Past six slices the smallest fold into "Other". The legend beside it
// names every slice with its count and share, so colour never carries the meaning alone.
export function Donut({ slices, center, centerLabel, emptyText }: { slices: Slice[]; center: string; centerLabel: string; emptyText: string }) {
  const present = slices.filter((slice) => slice.value > 0);
  const total = present.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <p className="kpi-none">{emptyText}</p>;
  // Slices keep the order given; only when folding are the largest kept.
  const sorted = present.length > MAX_SLICES ? [...present].sort((a, b) => b.value - a.value) : present;
  const shown =
    sorted.length > MAX_SLICES
      ? [...sorted.slice(0, MAX_SLICES - 1), { key: "other", label: `Other (${sorted.length - MAX_SLICES + 1})`, value: sorted.slice(MAX_SLICES - 1).reduce((sum, slice) => sum + slice.value, 0), color: OTHER_COLOR }]
      : sorted;

  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  // A 2px gap of the page colour between slices.
  const gap = shown.length > 1 ? 2 : 0;
  let start = 0;
  return (
    <div className="kpi-donut">
      <svg viewBox="0 0 132 132" width="132" height="132" role="img" aria-label={`${centerLabel}: ${center}`}>
        <g transform="rotate(-90 66 66)">
          {shown.map((slice) => {
            const length = (slice.value / total) * circumference;
            const dash = Math.max(0.5, length - gap);
            const element = (
              <circle key={slice.key} cx="66" cy="66" r={radius} fill="none" stroke={slice.color} strokeWidth="20" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-start}>
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            );
            start += length;
            return element;
          })}
        </g>
        <text x="66" y="66" textAnchor="middle" className="kpi-donut-value">{center}</text>
        <text x="66" y="81" textAnchor="middle" className="kpi-donut-label">{centerLabel}</text>
      </svg>
      <ul className="kpi-donut-legend">
        {shown.map((slice) => (
          <li key={slice.key}>
            {slice.icon ? <span className="kpi-key" style={{ background: slice.color }}>{slice.icon}</span> : <span className="kpi-swatch" style={{ background: slice.color }} />}
            <span className="kpi-donut-name" title={slice.label}>{slice.label}</span>
            <strong>{slice.value}</strong>
            <em>{Math.round((slice.value / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Horizontal bars, one per row, each in its own colour (e.g. a PO's), with the value at the tip.
export function ColorBars({ rows, unit }: { rows: Array<{ key: string; label: string; value: number; color: string }>; unit: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="kpi-bars">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="kpi-row-label"><span className="kpi-swatch" style={{ background: row.color }} /><span title={row.label}>{row.label}</span></span>
          <span className="kpi-bar-track"><span className="kpi-bar" style={{ width: `${(row.value / max) * 100}%`, background: row.color }} /></span>
          <span className="kpi-bar-value">{unit(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// Columns for a distribution (one series, one colour), the count on each cap.
export function Columns({ columns }: { columns: Array<{ key: string; label: string; value: number }> }) {
  const max = Math.max(1, ...columns.map((column) => column.value));
  return (
    <div className="kpi-columns-chart">
      {columns.map((column) => (
        <div key={column.key} className="kpi-column">
          <span className="kpi-column-value">{column.value}</span>
          <span className="kpi-column-bar" style={{ height: `${(column.value / max) * 100}%` }} />
          <span className="kpi-column-label">{column.label}</span>
        </div>
      ))}
    </div>
  );
}

// Where the time went on an average task: one 100% bar split by status, durations in the legend.
export function TimeSplit({ parts }: { parts: Array<{ key: string; label: string; hours: number; color: string }> }) {
  const shown = parts.filter((part) => part.hours > 0);
  const total = shown.reduce((sum, part) => sum + part.hours, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="kpi-split thin">
        {shown.map((part) => (
          <span key={part.key} className="kpi-seg" style={{ flexGrow: part.hours, background: part.color }} title={`${part.label}: ${formatDuration(part.hours)}`} />
        ))}
      </div>
      <ul className="kpi-legend compact">
        {shown.map((part) => (
          <li key={part.key}><span className="kpi-key bar" style={{ background: part.color }} />{part.label} <strong>{formatDuration(part.hours)}</strong></li>
        ))}
      </ul>
    </div>
  );
}

// Line icons for the summary tiles (16px grid, drawn with the tile's colour).
const TILE_ICONS = {
  completed: <><circle cx="8" cy="8" r="6.2" /><path d="m5.3 8.2 1.9 1.9 3.6-3.8" /></>,
  time: <><circle cx="8" cy="8.6" r="5.6" /><path d="M8 5.6v3.2l2 1.3M6.3 1.6h3.4" /></>,
  onTime: <><rect x="2.2" y="3" width="11.6" height="10.8" rx="2" /><path d="M2.2 6.4h11.6M5.4 1.6v2.6M10.6 1.6v2.6m-4.8 6 1.5 1.5 2.9-3" /></>,
  failedTesting: <><path d="M6.2 1.8h3.6M6.8 1.8v4.3L3 12.7a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L9.2 6.1V1.8" /><path d="M4.6 10h6.8" /></>,
  reopened: <><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" /><path d="M2.4 1.9v2.9h2.9" /></>,
  late: <><path d="M4.2 1.8h7.6M4.2 14.2h7.6" /><path d="M5.2 1.8v1.6c0 2 5.6 2.6 5.6 4.6s-5.6 2.6-5.6 4.6v1.6M10.8 1.8v1.6c0 2-5.6 2.6-5.6 4.6s5.6 2.6 5.6 4.6v1.6" /></>,
};

export type TileTone = "brand" | "blue" | "good" | "warn" | "bad" | "neutral";

/** A headline number: icon and label, the value, a note, and optionally a 0–100 meter. */
export function Tile({
  icon,
  label,
  value,
  note,
  tone = "neutral",
  meter,
}: {
  icon: keyof typeof TILE_ICONS;
  label: string;
  value: string | number;
  note?: string;
  tone?: TileTone;
  meter?: number | null;
}) {
  return (
    <div className={`kpi-tile ${tone}`}>
      <span className="kpi-tile-head">
        <span className="kpi-tile-icon" aria-hidden="true"><svg viewBox="0 0 16 16">{TILE_ICONS[icon]}</svg></span>
        <span className="kpi-tile-label">{label}</span>
      </span>
      <strong className="kpi-tile-value">{value}</strong>
      {meter !== undefined && (
        <span className="kpi-tile-meter" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, meter ?? 0))}%` }} />
        </span>
      )}
      {note && <span className="kpi-tile-note">{note}</span>}
    </div>
  );
}
