import { useEffect, useRef, useState } from "react";
import { formatDate } from "../format";
import type { Meta, Named, Profile, Task } from "../types";

export type Filters = {
  search: string;
  clientId: string;
  typeId: string;
  priorityId: string;
  statusId: string;
  // "" = all, "unassigned"/"none" = empty, otherwise a user id
  assigneeId: string;
  testedById: string;
  reportedFrom: string;
  reportedTo: string;
  probableFrom: string;
  probableTo: string;
  completedFrom: string;
  completedTo: string;
};

export const emptyFilters: Filters = {
  search: "",
  clientId: "",
  typeId: "",
  priorityId: "",
  statusId: "",
  assigneeId: "",
  testedById: "",
  reportedFrom: "",
  reportedTo: "",
  probableFrom: "",
  probableTo: "",
  completedFrom: "",
  completedTo: "",
};

/**
 * What the sheet opens with: people who take assignments (developers, BAs) start on their own
 * tasks; everyone else (admins) starts on all tasks. It's only a starting point: anyone who can
 * see all tasks can clear or change it.
 */
export function defaultFilters(profile: Profile): Filters {
  return profile.role.isAssignable ? { ...emptyFilters, assigneeId: profile.id } : emptyFilters;
}

// Dates are ISO "YYYY-MM-DD", so plain string comparison orders them correctly.
function inRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  return (!from || value >= from) && (!to || value <= to);
}

export function matchesFilters(task: Task, filters: Filters): boolean {
  const search = filters.search.trim().toLowerCase().replace(/^#/, "");
  return (
    (!search || task.title.toLowerCase().includes(search) || String(task.number) === search) &&
    (!filters.clientId || task.clients.some((client) => client.id === filters.clientId)) &&
    (!filters.typeId || (filters.typeId === "none" ? task.typeId === null : task.typeId === filters.typeId)) &&
    (!filters.priorityId || (filters.priorityId === "none" ? task.priorityId === null : task.priorityId === filters.priorityId)) &&
    (!filters.statusId || task.statusId === filters.statusId) &&
    (!filters.assigneeId || (filters.assigneeId === "unassigned" ? task.assigneeId === null : task.assigneeId === filters.assigneeId)) &&
    (!filters.testedById || (filters.testedById === "none" ? task.testers.length === 0 : task.testers.some((tester) => tester.id === filters.testedById))) &&
    inRange(task.reportedDate, filters.reportedFrom, filters.reportedTo) &&
    inRange(task.expectedDeliveryDate, filters.probableFrom, filters.probableTo) &&
    inRange(task.deliveredDate, filters.completedFrom, filters.completedTo)
  );
}

type Chip = { label: string; clear: Partial<Filters> };

function rangeText(from: string, to: string): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  return from ? `from ${formatDate(from)}` : `until ${formatDate(to)}`;
}

// One removable chip per active filter (search is shown in its own box).
export function activeFilterChips(filters: Filters, meta: Meta): Chip[] {
  const name = (list: Named[], id: string, empty: string) => (id === "unassigned" || id === "none" ? empty : list.find((item) => item.id === id)?.name ?? "Unknown");
  const chips: Chip[] = [];
  if (filters.clientId) chips.push({ label: `PO: ${name(meta.clients, filters.clientId, "")}`, clear: { clientId: "" } });
  if (filters.typeId) chips.push({ label: `Type: ${name(meta.types, filters.typeId, "None")}`, clear: { typeId: "" } });
  if (filters.priorityId) chips.push({ label: `Priority: ${name(meta.priorities, filters.priorityId, "None")}`, clear: { priorityId: "" } });
  if (filters.statusId) chips.push({ label: `Status: ${name(meta.statuses, filters.statusId, "")}`, clear: { statusId: "" } });
  if (filters.assigneeId) chips.push({ label: `Assigned dev: ${name(meta.users, filters.assigneeId, "Unassigned")}`, clear: { assigneeId: "" } });
  if (filters.testedById) chips.push({ label: `Tested by: ${name(meta.users, filters.testedById, "Not yet")}`, clear: { testedById: "" } });
  if (filters.reportedFrom || filters.reportedTo) chips.push({ label: `Date: ${rangeText(filters.reportedFrom, filters.reportedTo)}`, clear: { reportedFrom: "", reportedTo: "" } });
  if (filters.probableFrom || filters.probableTo) chips.push({ label: `Probable: ${rangeText(filters.probableFrom, filters.probableTo)}`, clear: { probableFrom: "", probableTo: "" } });
  if (filters.completedFrom || filters.completedTo) chips.push({ label: `Completed: ${rangeText(filters.completedFrom, filters.completedTo)}`, clear: { completedFrom: "", completedTo: "" } });
  return chips;
}

/** Search + Filters button, shown at the right just above the task sheet. */
export function FilterBar({
  filters,
  meta,
  onChange,
  onReset,
  isDefault,
}: {
  filters: Filters;
  meta: Meta;
  onChange: (update: Partial<Filters>) => void;
  onReset: () => void;
  isDefault: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const count = activeFilterChips(filters, meta).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => !anchor.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const developers = meta.users.filter((user) => user.isAssignable);
  const testers = meta.users.filter((user) => user.canTest);

  const select = (label: string, key: keyof Filters, options: Named[], extra?: { value: string; label: string }) => (
    <label className="filter-field">
      <span>{label}</span>
      <select value={filters[key]} onChange={(event) => onChange({ [key]: event.target.value })} className={filters[key] ? "set" : ""}>
        <option value="">All</option>
        {extra && <option value={extra.value}>{extra.label}</option>}
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );

  const range = (label: string, fromKey: keyof Filters, toKey: keyof Filters) => (
    <div className="filter-field span-2">
      <span>{label}</span>
      <div className="filter-range">
        <input type="date" value={filters[fromKey]} max={filters[toKey] || undefined} onChange={(event) => onChange({ [fromKey]: event.target.value })} aria-label={`${label} from`} className={filters[fromKey] ? "set" : ""} />
        <span aria-hidden="true">to</span>
        <input type="date" value={filters[toKey]} min={filters[fromKey] || undefined} onChange={(event) => onChange({ [toKey]: event.target.value })} aria-label={`${label} to`} className={filters[toKey] ? "set" : ""} />
        {(filters[fromKey] || filters[toKey]) && (
          <button type="button" className="range-clear" onClick={() => onChange({ [fromKey]: "", [toKey]: "" })} aria-label={`Clear ${label}`}>×</button>
        )}
      </div>
    </div>
  );

  return (
    <div className="filter-tools" ref={anchor}>
      <div className="sheet-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input type="search" placeholder="Search title or issue no" value={filters.search} onChange={(event) => onChange({ search: event.target.value })} aria-label="Search tasks" />
      </div>
      <button type="button" className={`filter-toggle ${count ? "active" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5h17l-6.5 8v5.5l-4 2V13z" /></svg>
        Filters
        {count > 0 && <span className="filter-count">{count}</span>}
      </button>

      {open && (
        <div className="filter-panel" role="dialog" aria-label="Filter tasks">
          <div className="filter-panel-body">
            <section>
              <h3>Task</h3>
              <div className="filter-grid">
                {select("PO", "clientId", meta.clients)}
                {select("Type", "typeId", meta.types, { value: "none", label: "No type" })}
                {select("Priority", "priorityId", meta.priorities, { value: "none", label: "No priority" })}
                {select("Status", "statusId", meta.statuses)}
              </div>
            </section>
            <section>
              <h3>People</h3>
              <div className="filter-grid">
                {select("Assigned dev", "assigneeId", developers, { value: "unassigned", label: "Unassigned" })}
                {select("Tested by", "testedById", testers, { value: "none", label: "Not yet" })}
              </div>
            </section>
            <section>
              <h3>Dates</h3>
              <div className="filter-grid">
                {range("Date (assigned on)", "reportedFrom", "reportedTo")}
                {range("Probable date", "probableFrom", "probableTo")}
                {range("Completed", "completedFrom", "completedTo")}
              </div>
            </section>
          </div>
          <footer className="filter-panel-footer">
            <button type="button" className="ghost-button" onClick={() => onChange({ ...emptyFilters, search: filters.search })} disabled={count === 0}>Clear all</button>
            {!isDefault && <button type="button" className="text-button" onClick={onReset}>Back to my default</button>}
            <button type="button" className="small-primary" onClick={() => setOpen(false)}>Done</button>
          </footer>
        </div>
      )}
    </div>
  );
}
