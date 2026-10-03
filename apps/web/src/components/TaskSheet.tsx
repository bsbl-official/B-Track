import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { api } from "../api";
import { errorMessage, formatDate, hasPermission } from "../format";
import { navigate } from "../router";
import { PERMISSIONS, type Meta, type Named, type NewTask, type Profile, type Task, type TaskUpdate } from "../types";
import { NewTaskModal } from "./NewTaskModal";
import { PoChips, PoPicker } from "./PoPicker";
import { FilterBar, activeFilterChips, defaultFilters, emptyFilters, matchesFilters, type Filters } from "./TaskFilters";
import { TaskDrawer } from "./TaskDrawer";
import { TypeIcon } from "./TypeIcon";

type View = "all" | "open" | "unassigned" | "overdue" | "dueSoon" | "completed";
type SortKey =
  | "reportedDate" | "client" | "number" | "title" | "assignee" | "priority"
  | "testedBy" | "expectedDeliveryDate" | "gapDays" | "status";

const DUE_SOON_DAYS = 3;

const isOverdue = (task: Task) => task.gapDays !== null && task.gapDays > 0;
const isDueSoon = (task: Task) => task.gapDays !== null && task.gapDays <= 0 && task.gapDays >= -DUE_SOON_DAYS;

const views: Array<{ key: View; label: string; matches: (task: Task) => boolean }> = [
  { key: "all", label: "All", matches: () => true },
  { key: "open", label: "Open", matches: (task) => !task.status.isClosed },
  // Open work nobody has taken yet; anyone who can take tasks may claim one.
  { key: "unassigned", label: "Unassigned", matches: (task) => !task.status.isClosed && task.assigneeId === null },
  { key: "overdue", label: "Overdue", matches: isOverdue },
  { key: "dueSoon", label: `Due in ${DUE_SOON_DAYS} days`, matches: isDueSoon },
  { key: "completed", label: "Completed", matches: (task) => task.status.isClosed },
];

// Same order as the team's Daily Troubleshoot sheet. `width` sets each column's default share of the sheet.
type Column = { id: string; key: SortKey | null; label: string; className?: string; width: number };
const columns: Column[] = [
  { id: "date", key: "reportedDate", label: "Date", width: 150 },
  { id: "po", key: "client", label: "PO", className: "col-po", width: 130 },
  { id: "number", key: "number", label: "Issue No", className: "col-number", width: 84 },
  { id: "title", key: "title", label: "Issue title", className: "col-title", width: 320 },
  { id: "dev", key: "assignee", label: "Assigned dev", width: 140 },
  { id: "priority", key: "priority", label: "Priority", className: "col-priority", width: 84 },
  { id: "tester", key: "testedBy", label: "Tested by", width: 130 },
  { id: "due", key: "expectedDeliveryDate", label: "Probable date", width: 150 },
  { id: "gap", key: "gapDays", label: "Gap days", className: "col-gap", width: 90 },
  { id: "status", key: "status", label: "Status", width: 140 },
];
const MIN_COLUMN_WIDTH = 56;
type Shares = Record<string, number>;

// Shares always add up to 1 across the resizable columns.
function normalise(shares: Shares): Shares {
  const total = columns.reduce((sum, column) => sum + shares[column.id], 0);
  return Object.fromEntries(columns.map((column) => [column.id, shares[column.id] / total]));
}
const defaultShares = () => normalise(Object.fromEntries(columns.map((column) => [column.id, column.width])));

// Remembered per browser (best effort: storage may be unavailable).
const SHARES_KEY = "btrack.sheet.columns";
function readShares(): Shares {
  try {
    const saved = JSON.parse(localStorage.getItem(SHARES_KEY) ?? "null") as Record<string, unknown> | null;
    if (saved && columns.every((column) => typeof saved[column.id] === "number" && (saved[column.id] as number) > 0)) {
      return normalise(saved as Shares);
    }
  } catch {
    // Defaults.
  }
  return defaultShares();
}
function saveShares(shares: Shares) {
  try {
    localStorage.setItem(SHARES_KEY, JSON.stringify(shares));
  } catch {
    // Not remembered; fine.
  }
}

/**
 * Moves `deltaPx` of width from the next column to column `index` (negative shrinks it),
 * keeping both at least MIN_COLUMN_WIDTH, so the total never changes.
 */
function shiftShare(shares: Shares, index: number, deltaPx: number, available: number): Shares {
  const current = columns[index];
  const next = columns[index + 1];
  if (!next || available <= 0) return shares;
  const min = MIN_COLUMN_WIDTH / available;
  const pair = shares[current.id] + shares[next.id];
  const width = Math.min(pair - min, Math.max(min, shares[current.id] + deltaPx / available));
  return { ...shares, [current.id]: width, [next.id]: pair - width };
}

// Users a task may be assigned to by someone with the given assign rule.
function assigneeOptions(meta: Meta, profile: Profile, rule: "anyone" | "self" | "none", currentAssignee: Named | null): Named[] {
  const options: Named[] =
    rule === "anyone" ? meta.users.filter((user) => user.isAssignable) : meta.users.filter((user) => user.id === profile.id && user.isAssignable);
  // Keep showing whoever holds the task now, even if the viewer couldn't pick them.
  if (currentAssignee && !options.some((user) => user.id === currentAssignee.id)) options.push(currentAssignee);
  return options;
}

export function TaskSheet({
  meta,
  profile,
  openTaskId,
  preset,
  onMetaChanged,
}: {
  meta: Meta;
  profile: Profile;
  openTaskId: string | null;
  // A view and filters to open on, e.g. from a dashboard card: view=overdue&assignee=me&completedFrom=YYYY-MM-DD.
  preset: URLSearchParams;
  onMetaChanged: () => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const presetView = views.find((item) => item.key === preset.get("view"))?.key;
  const [view, setView] = useState<View>(presetView ?? "open");
  const [filters, setFilters] = useState<Filters>(() =>
    presetView
      ? { ...emptyFilters, assigneeId: preset.get("assignee") === "me" ? profile.id : "", completedFrom: preset.get("completedFrom") ?? "" }
      : defaultFilters(profile),
  );
  const [shares, setShares] = useState(readShares);
  // The sheet always fits the space it has: track that width.
  const scroller = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setAvailable(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "number", direction: -1 });
  const [toast, setToast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const permissions = profile.permissions;
  const canCreate = hasPermission(permissions, PERMISSIONS.taskCreate);
  const openTask = (id: string | null) => (id ? navigate("tasks", { open: id }) : navigate("tasks"));

  const showError = useCallback((error: unknown) => {
    setToast(errorMessage(error));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    api.listTasks().then(setTasks).catch(showError);
  }, [showError]);

  const replaceTask = useCallback((updated: Task) => {
    setTasks((current) => current?.map((task) => (task.id === updated.id ? { ...task, ...updated } : task)) ?? null);
  }, []);

  const updateTask = useCallback(
    async (id: string, update: TaskUpdate) => {
      try {
        replaceTask(await api.updateTask(id, update));
      } catch (error) {
        showError(error);
      }
    },
    [replaceTask, showError],
  );

  const createTask = async (task: NewTask) => {
    const created = await api.createTask(task);
    setTasks((current) => [created, ...(current ?? [])]);
    return created;
  };

  // Deleting happens in the details drawer; drop the row and close it.
  const removeTask = (id: string) => {
    setTasks((current) => current?.filter((item) => item.id !== id) ?? null);
    openTask(null);
  };

  const createClient = async (): Promise<string | null> => {
    const name = window.prompt("New Partner Organisation (PO) name")?.trim();
    if (!name) return null;
    try {
      const client = await api.createClient(name);
      onMetaChanged();
      return client.id;
    } catch (error) {
      showError(error);
      return null;
    }
  };

  const statusById = useMemo(() => new Map(meta.statuses.map((status) => [status.id, status])), [meta.statuses]);

  const counts = useMemo(
    () => Object.fromEntries(views.map((item) => [item.key, tasks?.filter(item.matches).length ?? 0])) as Record<View, number>,
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    if (!tasks) return [];
    const viewMatches = views.find((item) => item.key === view)!.matches;
    const sorted = tasks
      .filter((task) => viewMatches(task) && matchesFilters(task, filters))
      .sort((a, b) => compareTasks(a, b, sort.key, statusById) * sort.direction);
    return sorted;
  }, [tasks, view, filters, sort, statusById]);

  const chips = activeFilterChips(filters, meta);
  const changeFilters = (update: Partial<Filters>) => setFilters((current) => ({ ...current, ...update }));
  const myDefault = defaultFilters(profile);
  const isDefault = (Object.keys(myDefault) as Array<keyof Filters>).every((key) => key === "search" || filters[key] === myDefault[key]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => ({ key, direction: current.key === key ? (current.direction === 1 ? -1 : 1) : 1 }));

  // Space for the resizable columns; below the columns' minimums the sheet has to scroll.
  const columnSpace = Math.max(available, columns.length * MIN_COLUMN_WIDTH);
  const widthOf = (id: string) => Math.floor(shares[id] * columnSpace);

  const startResize = (index: number, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const start = shares;
    const move = (moveEvent: PointerEvent) => setShares(shiftShare(start, index, moveEvent.clientX - startX, columnSpace));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("col-resizing");
      setShares((current) => {
        saveShares(current);
        return current;
      });
    };
    document.body.classList.add("col-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const nudge = (index: number, deltaPx: number) =>
    setShares((current) => {
      const next = shiftShare(current, index, deltaPx, columnSpace);
      saveShares(next);
      return next;
    });
  const resetWidths = () => {
    const next = defaultShares();
    saveShares(next);
    setShares(next);
  };

  return (
    <div className="sheet-page">
      <div className="sheet-heading">
        <div>
          <h1>Task sheet</h1>
          <p className="subtitle">
            {hasPermission(permissions, PERMISSIONS.taskViewAll) ? "Every task across all Partner Organisations (POs)." : "Tasks you created or are assigned to."} Click a row to see details, edit or delete it.
          </p>
        </div>
        {canCreate && (
          <button type="button" className="primary-button" onClick={() => setCreating(true)}>
            <span aria-hidden="true">＋</span> New task
          </button>
        )}
      </div>

      <div className="view-tabs" role="tablist" aria-label="Task views">
        {views.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`view-tab ${item.key} ${view === item.key ? "active" : ""}`}
            onClick={() => {
              setView(item.key);
              // An "Assigned dev" filter (e.g. the default "me") would always empty this tab.
              if (item.key === "unassigned" && filters.assigneeId) setFilters((current) => ({ ...current, assigneeId: "" }));
            }}
          >
            {item.label}
            <span className="view-count">{counts[item.key]}</span>
          </button>
        ))}
      </div>

      <div className="filter-chips">
        {chips.map((chip) => (
          <span key={chip.label} className="filter-chip">
            {chip.label}
            <button type="button" onClick={() => changeFilters(chip.clear)} aria-label={`Remove filter ${chip.label}`}>×</button>
          </span>
        ))}
        {chips.length > 0 && (
          <button type="button" className="text-button" onClick={() => changeFilters({ ...emptyFilters, search: filters.search })}>
            Clear all
          </button>
        )}
        {chips.length === 0 && <span className="filter-none">Showing all tasks</span>}
        <span className="result-count">{visibleTasks.length} shown</span>
        <FilterBar filters={filters} meta={meta} onChange={changeFilters} onReset={() => setFilters(defaultFilters(profile))} isDefault={isDefault} />
      </div>

      <div className="sheet-scroll" ref={scroller}>
        <table className="sheet resizable" style={{ width: columnSpace }}>
          <colgroup>
            {columns.map((column) => <col key={column.id} style={{ width: widthOf(column.id) }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.label}
                  className={column.className}
                  aria-sort={column.key && sort.key === column.key ? (sort.direction === 1 ? "ascending" : "descending") : undefined}
                >
                  {index < columns.length - 1 && (
                    <span
                      className="col-resizer"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${column.label} column`}
                      aria-valuenow={widthOf(column.id)}
                      tabIndex={0}
                      title="Drag to resize · double-click to reset all columns"
                      onPointerDown={(event) => startResize(index, event)}
                      onDoubleClick={resetWidths}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") nudge(index, -16);
                        if (event.key === "ArrowRight") nudge(index, 16);
                      }}
                    />
                  )}
                  {column.key ? (
                    <button type="button" onClick={() => toggleSort(column.key!)}>
                      {column.label}
                      <span className="sort-mark" aria-hidden="true">{sort.key === column.key ? (sort.direction === 1 ? "▲" : "▼") : ""}</span>
                    </button>
                  ) : (
                    <span className="th-label">{column.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks === null && (
              <tr><td className="sheet-message" colSpan={columns.length}>Loading tasks…</td></tr>
            )}
            {tasks !== null && visibleTasks.length === 0 && (
              <tr>
                <td className="sheet-message" colSpan={columns.length}>
                  No tasks match this view.{" "}
                  {canCreate && <button type="button" className="text-button" onClick={() => setCreating(true)}>Create a task</button>}
                </td>
              </tr>
            )}
            {visibleTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                meta={meta}
                profile={profile}
                onUpdate={updateTask}
                onOpen={() => openTask(task.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <NewTaskModal
          meta={meta}
          profile={profile}
          onCreate={createTask}
          onUpdated={replaceTask}
          onCreateClient={createClient}
          onClose={() => setCreating(false)}
        />
      )}

      {openTaskId && (
        <TaskDrawer
          taskId={openTaskId}
          meta={meta}
          currentUserId={profile.id}
          onClose={() => openTask(null)}
          onTaskChanged={replaceTask}
          onDeleted={removeTask}
          onError={(error) => {
            showError(error);
            openTask(null);
          }}
        />
      )}

      {toast && (
        <div className="toast" role="alert">
          {toast}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}

function compareTasks(a: Task, b: Task, key: SortKey, statusById: Map<string, { sortOrder: number }>): number {
  const text = (x: string | null | undefined, y: string | null | undefined) => {
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y);
  };
  const number = (x: number | null, y: number | null) => {
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  };
  switch (key) {
    case "reportedDate": return text(a.reportedDate, b.reportedDate);
    case "client": return text(a.clients.map((c) => c.name).join(", "), b.clients.map((c) => c.name).join(", "));
    case "number": return a.number - b.number;
    case "title": return text(a.title, b.title);
    case "assignee": return text(a.assignee?.name, b.assignee?.name);
    case "priority": return number(a.priority?.rank ?? null, b.priority?.rank ?? null);
    case "testedBy": return text(a.testers.map((t) => t.name).join(", "), b.testers.map((t) => t.name).join(", "));
    case "expectedDeliveryDate": return text(a.expectedDeliveryDate, b.expectedDeliveryDate);
    case "gapDays": return number(a.gapDays, b.gapDays);
    case "status": return (statusById.get(a.statusId)?.sortOrder ?? 0) - (statusById.get(b.statusId)?.sortOrder ?? 0);
  }
}

// Sheet rule: today minus probable date, blank once completed.
function GapCell({ task }: { task: Task }) {
  const gap = task.gapDays;
  if (gap === null) return <span className="gap-badge none">—</span>;
  const tone = gap > 0 ? "late" : gap >= -DUE_SOON_DAYS ? "soon" : "left";
  const hint = gap > 0 ? `${gap} day${gap === 1 ? "" : "s"} past the probable date` : gap === 0 ? "Due today" : `${-gap} day${gap === -1 ? "" : "s"} to spare`;
  return <span className={`gap-badge ${tone}`} title={hint}>{gap}</span>;
}

function CellSelect({
  value,
  label,
  color,
  options,
  onChange,
  allowEmpty,
  disabled,
  className = "",
}: {
  value: string;
  label: string;
  color?: string;
  options: Array<Named & { color?: string }>;
  onChange: (value: string) => void;
  allowEmpty?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      className={`cell-select ${color ? "colored" : ""} ${value ? "" : "empty"} ${className}`}
      style={color ? ({ "--pill": color } as CSSProperties) : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      disabled={disabled}
    >
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.name}</option>
      ))}
    </select>
  );
}

function DateCell({
  value,
  label,
  onChange,
  disabled,
  required,
  alert,
}: {
  value: string | null;
  label: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  alert?: boolean;
}) {
  if (disabled) return <span className={`cell-text ${alert ? "date-alert" : ""}`}>{formatDate(value)}</span>;
  return (
    <input
      className={`cell-date ${value ? "" : "empty"} ${alert ? "date-alert" : ""}`}
      type="date"
      value={value ?? ""}
      aria-label={label}
      required={required}
      onChange={(event) => {
        if (!event.target.value && required) return;
        onChange(event.target.value || null);
      }}
    />
  );
}

// Read-only in the sheet: the title, type, date and PO are edited from the details drawer.
function TitleCell({ value, type, evidenceCount }: { value: string; type: ReactNode; evidenceCount: number }) {
  return (
    <div className="title-cell">
      {type}
      <span className="cell-text title-text">{value}</span>
      {evidenceCount > 0 && (
        <span className="evidence-count" title={`${evidenceCount} evidence file${evidenceCount === 1 ? "" : "s"}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" /></svg>
          {evidenceCount}
        </span>
      )}
    </div>
  );
}

// Clicking a row opens its details, except when the click lands on one of the row's own controls.
const ROW_CONTROLS = "select, input, textarea, button, a, label";

function TaskRow({
  task,
  meta,
  profile,
  onUpdate,
  onOpen,
}: {
  task: Task;
  meta: Meta;
  profile: Profile;
  onUpdate: (id: string, update: TaskUpdate) => void;
  onOpen: () => void;
}) {
  const { access } = task;
  const editable = access.edit;
  const currentStatus = meta.statuses.find((status) => status.id === task.statusId);
  // Only the current status and the ones the workflow allows next.
  const statusOptions = meta.statuses.filter(
    (status) => status.id === task.statusId || currentStatus?.nextStatusIds.includes(status.id),
  );
  // Developers and Business Analysts (roles with "Can test tasks").
  const testers: Named[] = meta.users.filter((user) => user.canTest);
  // People already testing the task stay listed even if they can no longer be picked.
  const testerOptions = [...testers, ...task.testers.filter((tester) => !testers.some((user) => user.id === tester.id))];
  const update = (change: TaskUpdate) => onUpdate(task.id, change);

  return (
    <tr
      className={`clickable ${isOverdue(task) ? "overdue" : ""} ${task.status.isClosed ? "closed" : ""}`}
      tabIndex={0}
      aria-label={`Task #${task.number}: ${task.title}. Press Enter for details.`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest(ROW_CONTROLS)) return;
        // Leave selecting text alone.
        if (window.getSelection()?.toString()) return;
        onOpen();
      }}
      onKeyDown={(event) => event.key === "Enter" && event.target === event.currentTarget && onOpen()}
    >
      <td>
        <span className="cell-text">{formatDate(task.reportedDate)}</span>
      </td>
      <td className="col-po">
        <PoChips pos={task.clients} />
      </td>
      <td className="col-number">{task.number}</td>
      <td className="col-title">
        <TitleCell value={task.title} type={<TypeIcon type={task.type} types={meta.types} disabled />} evidenceCount={task.attachmentCount} />
      </td>
      <td>
        <CellSelect
          label="Assigned dev"
          value={task.assigneeId ?? ""}
          options={assigneeOptions(meta, profile, access.assign, task.assignee)}
          allowEmpty="Unassigned"
          disabled={access.assign === "none"}
          onChange={(assigneeId) => update({ assigneeId: assigneeId || null })}
        />
      </td>
      <td className="col-priority">
        <CellSelect label="Priority" value={task.priorityId ?? ""} color={task.priority?.color} options={meta.priorities} allowEmpty="—" disabled={!access.setPriority} onChange={(priorityId) => update({ priorityId: priorityId || null })} className="centered" />
      </td>
      <td>
        {access.setTester ? (
          <PoPicker label="Tested by" placeholder="—" required={false} options={testerOptions} value={task.testers.map((tester) => tester.id)} onChange={(testerIds) => update({ testerIds })} />
        ) : (
          <PoChips pos={task.testers} placeholder="—" />
        )}
      </td>
      <td>
        <DateCell label="Probable date" value={task.expectedDeliveryDate} alert={isOverdue(task)} disabled={!editable} onChange={(expectedDeliveryDate) => update({ expectedDeliveryDate })} />
      </td>
      <td className="col-gap"><GapCell task={task} /></td>
      <td>
        <CellSelect label="Status" value={task.statusId} color={task.status.color} options={statusOptions} disabled={!access.setStatus} onChange={(statusId) => update({ statusId })} />
      </td>
    </tr>
  );
}
