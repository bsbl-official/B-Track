import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { ColorBars, Columns, DELIVERY, DeliveryLegend, Donut, formatDuration, Tile, TeamDeliveryChart, TimeSplit, type Slice } from "../components/KpiCharts";
import { Brand } from "../components/Logo";
import { PoPicker } from "../components/PoPicker";
import { errorMessage, formatDate } from "../format";
import { navigate } from "../router";
import type { KpiCompletedTask, KpiPerson, KpiReport, KpiTask, Meta } from "../types";

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// Quick ranges for the period; every one ends today at the latest.
function presets(): Array<{ key: string; label: string; from: string; to: string }> {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysAgo = (days: number) => new Date(y, m, now.getDate() - days);
  const quarter = Math.floor(m / 3) * 3;
  return [
    { key: "month", label: "This month", from: iso(new Date(y, m, 1)), to: iso(now) },
    { key: "lastMonth", label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { key: "30", label: "Last 30 days", from: iso(daysAgo(29)), to: iso(now) },
    { key: "quarter", label: "This quarter", from: iso(new Date(y, quarter, 1)), to: iso(now) },
  ];
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const numberOrDash = (value: number | null, suffix = "") => (value === null ? "—" : `${value}${suffix}`);

// Roles picked when the page opens; any others can be added in the Role filter.
const DEFAULT_ROLES = ["Developer", "DBA"];

const listParam = (params: URLSearchParams, key: string) => params.get(key)?.split(",").filter(Boolean) ?? [];

export function KpiPage({ meta, params }: { meta: Meta; params: URLSearchParams }) {
  const initial = presets()[0];
  const from = params.get("from") ?? initial.from;
  const to = params.get("to") ?? initial.to;

  // Roles of people who can take tasks. Without a "roles" entry in the address, the defaults;
  // an empty one means every role.
  const assignable = meta.users.filter((user) => user.isAssignable);
  const roleNames = [...new Set(assignable.map((user) => user.roleName))].sort();
  const roles = params.has("roles") ? listParam(params, "roles") : DEFAULT_ROLES.filter((role) => roleNames.includes(role));
  const peopleOptions = assignable
    .filter((user) => roles.length === 0 || roles.includes(user.roleName))
    .map((user) => ({ id: user.id, name: roles.length === 1 ? user.name : `${user.name} · ${user.roleName}` }));
  const people = listParam(params, "people").filter((id) => peopleOptions.some((option) => option.id === id));
  const pos = listParam(params, "pos");
  const poLabel = pos.length ? meta.clients.filter((po) => pos.includes(po.id)).map((po) => po.name).join(", ") : null;

  const [report, setReport] = useState<KpiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The filters live in the address, so a report can be bookmarked or shared as a link.
  const update = (next: { from?: string; to?: string; roles?: string[]; pos?: string[]; people?: string[] }) => {
    const nextRoles = next.roles ?? roles;
    const allowed = new Set(assignable.filter((user) => nextRoles.length === 0 || nextRoles.includes(user.roleName)).map((user) => user.id));
    navigate("kpi", {
      from: next.from ?? from,
      to: next.to ?? to,
      roles: nextRoles.join(","),
      pos: (next.pos ?? pos).join(","),
      // Changing roles drops anyone who no longer fits them.
      people: (next.people ?? people).filter((id) => allowed.has(id)).join(","),
    });
  };

  const peopleKey = people.join(",");
  const posKey = pos.join(",");
  useEffect(() => {
    if (!peopleKey) {
      setReport(null);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    api
      .kpi({ from, to, people: peopleKey.split(","), pos: posKey ? posKey.split(",") : [] })
      .then((data) => current && setReport(data))
      .catch((cause: unknown) => current && setError(errorMessage(cause)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [from, to, peopleKey, posKey]);

  // The PDF is the browser's own "Save as PDF", which keeps text sharp and Bangla titles intact.
  // The document title becomes the suggested file name.
  const downloadPdf = () => {
    const title = document.title;
    const who = report?.people.length === 1 ? ` ${report.people[0].person.name}` : "";
    document.title = `B-Track KPI report${who} ${from} to ${to}`;
    const restore = () => {
      document.title = title;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };

  const activePreset = presets().find((preset) => preset.from === from && preset.to === to)?.key;
  const shown = peopleKey ? report : null;

  return (
    <div className="kpi-page">
      <div className="sheet-heading kpi-toolbar">
        <div>
          <h1>KPI report</h1>
          <p className="subtitle">How a developer's work went in the chosen period. Pick the people, then download it as a PDF.</p>
        </div>
        <button type="button" className="primary-button" onClick={downloadPdf} disabled={!shown || loading}>
          <svg className="kpi-button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></svg>
          Download PDF
        </button>
      </div>

      <div className="kpi-filters">
        <div className="kpi-filter-row">
          <div className="kpi-field">
            <span>Period</span>
            <div className="kpi-presets" role="group" aria-label="Period">
              {presets().map((preset) => (
                <button key={preset.key} type="button" className={activePreset === preset.key ? "active" : ""} onClick={() => update({ from: preset.from, to: preset.to })}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <label className="kpi-field kpi-date">
            <span>From</span>
            <input type="date" value={from} max={to} onChange={(event) => event.target.value && update({ from: event.target.value })} />
          </label>
          <label className="kpi-field kpi-date">
            <span>To</span>
            <input type="date" value={to} min={from} onChange={(event) => event.target.value && update({ to: event.target.value })} />
          </label>
        </div>
        <div className="kpi-filter-row">
          <div className="kpi-field kpi-pick">
            <span>Role</span>
            <PoPicker
              options={roleNames.map((name) => ({ id: name, name }))}
              value={roles}
              onChange={(ids) => update({ roles: ids })}
              variant="field"
              label="Role"
              placeholder="All roles"
              required={false}
            />
          </div>
          <div className="kpi-field kpi-pick">
            <span>PO</span>
            <PoPicker options={meta.clients} value={pos} onChange={(ids) => update({ pos: ids })} variant="field" label="PO" placeholder="All POs" required={false} bulk />
          </div>
          <div className="kpi-field kpi-pick wide">
            <span>People</span>
            <PoPicker
              options={peopleOptions}
              value={people}
              onChange={(ids) => update({ people: ids })}
              variant="field"
              label="People"
              placeholder="Choose people…"
              required={false}
              bulk
            />
          </div>
        </div>
      </div>
      <p className="kpi-print-hint">In the print window, choose <strong>Save as PDF</strong> as the destination.</p>

      {error && <p className="load-error" role="alert">{error}</p>}
      {!peopleKey && (
        <div className="kpi-empty">
          <strong>Choose who to report on</strong>
          <p>Pick one or more people in the People filter. The list follows the roles you've chosen.</p>
        </div>
      )}
      {loading && !shown && <p className="loading">Building the report…</p>}
      {shown && (
        <div className={`kpi-report ${loading ? "is-loading" : ""}`}>
          {shown.people.length > 1 && <TeamPage report={shown} poLabel={poLabel} pos={pos} />}
          {shown.people.map((person) => (
            <PersonPage key={person.person.id} report={shown} data={person} poLabel={poLabel} pos={pos} />
          ))}
          <DefinitionsPage report={shown} poLabel={poLabel} />
        </div>
      )}
    </div>
  );
}

function PageHeader({ report, title, subtitle }: { report: KpiReport; title: string; subtitle?: string }) {
  const generated = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(report.generatedAt));
  return (
    <header className="kpi-page-header">
      <div>
        <p className="kpi-eyebrow">Developer KPI report · {formatDate(report.from)} – {formatDate(report.to)}</p>
        <h2>{title}</h2>
        {subtitle && <p className="kpi-page-subtitle">{subtitle}</p>}
      </div>
      <div className="kpi-page-brand">
        <Brand size={30} />
        <span>Generated {generated} by {report.generatedBy}</span>
      </div>
    </header>
  );
}

// A chart card: a title, a line on what it shows, then the chart. "wide" spans both columns.
function Card({ title, caption, wide, children }: { title: string; caption?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`kpi-card ${wide ? "wide" : ""}`}>
      <h3>{title}</h3>
      {caption && <p className="kpi-card-caption">{caption}</p>}
      {children}
    </section>
  );
}

const HOUR_MS = 60 * 60 * 1000;
// What each status means while the task is theirs.
const STAGE_LABELS: Record<string, string> = { New: "Waiting to start", "In Progress": "In progress", Testing: "Testing", Blocked: "Blocked", Completed: "Completed, then reopened" };

// Hours from being assigned to being completed.
function hoursToFinish(task: KpiCompletedTask) {
  const end = task.stages[task.stages.length - 1]?.to;
  return end ? (new Date(end).getTime() - new Date(task.assignedAt).getTime()) / HOUR_MS : task.daysToComplete * 24;
}

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

// A task's POs, keeping only the chosen ones when the report is filtered by PO.
const posOf = (task: KpiTask, pos: string[]) => task.pos.filter((po) => pos.length === 0 || pos.includes(po.id));

// Counts per PO, largest first, in each PO's own colour.
function perPo(tasks: KpiTask[], pos: string[]) {
  const counts = new Map<string, Slice>();
  for (const task of tasks) {
    for (const po of posOf(task, pos)) {
      const slice = counts.get(po.id) ?? { key: po.id, label: po.name, value: 0, color: po.color };
      slice.value += 1;
      counts.set(po.id, slice);
    }
  }
  return [...counts.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

const deliverySlices = (summary: KpiPerson["summary"]): Slice[] =>
  DELIVERY.map((item) => ({ key: item.key, label: item.label, value: summary[item.key], color: item.color, icon: item.icon }));

// The first page when several people are chosen: their totals and a side-by-side comparison.
function TeamPage({ report, poLabel, pos }: { report: KpiReport; poLabel: string | null; pos: string[] }) {
  const total = (key: keyof KpiPerson["summary"]) => report.people.reduce((sum, person) => sum + (person.summary[key] ?? 0), 0);
  const onTime = total("onTime");
  const late = total("late");
  const rate = onTime + late ? Math.round((onTime / (onTime + late)) * 100) : null;
  const allCompleted = report.people.flatMap((person) => person.completed);
  const teamAverage = average(allCompleted.map(hoursToFinish));
  const generated = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(report.generatedAt));

  return (
    <article className="kpi-sheet kpi-cover">
      <header className="kpi-cover-head">
        <Brand size={40} />
        <div className="kpi-cover-meta">
          <span>Generated {generated}</span>
          <span>by {report.generatedBy}</span>
        </div>
      </header>
      <div className="kpi-cover-title">
        <p className="kpi-eyebrow">Developer KPI report</p>
        <h2>{formatDate(report.from)} – {formatDate(report.to)}</h2>
        <p className="kpi-page-subtitle">
          {report.people.length} people · {poLabel ? `POs: ${poLabel}` : "all POs"} · an overview first, then a page per person
        </p>
      </div>

      <div className="kpi-tiles">
        <Tile label="Tasks completed" value={total("completed")} note={`of ${total("handled")} handled`} />
        <Tile label="Average time to finish" value={teamAverage === null ? "—" : formatDuration(teamAverage)} note="from assigned to completed" />
        <Tile label="On time" value={rate === null ? "—" : `${rate}%`} note={`${onTime} of ${onTime + late} with a promised date`} />
        <Tile label="Probable date changes" value={total("dateChanges")} note={`+${total("daysPushedBack")} days in total`} />
      </div>

      <div className="kpi-cards">
        <Card title="Completed tasks by PO" caption="Everyone in this report together.">
          <Donut slices={perPo(allCompleted, pos)} center={String(allCompleted.length)} centerLabel="completed" emptyText="Nothing completed in this period." />
        </Card>
        <Card title="Completed by person" caption="Split by whether they were done by the promised date.">
          <DeliveryLegend />
          <TeamDeliveryChart people={report.people} />
        </Card>
        <Card title="Side by side" wide>
          <table className="kpi-table kpi-team-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Handled</th>
                <th>Completed</th>
                <th>Avg time to finish</th>
                <th>On time</th>
                <th>Date changes</th>
                <th>Failed testing</th>
                <th>Reopened</th>
                <th>Days blocked</th>
              </tr>
            </thead>
            <tbody>
              {report.people.map(({ person, summary, completed }) => {
                const personAverage = average(completed.map(hoursToFinish));
                return (
                  <tr key={person.id}>
                    <td><strong>{person.name}</strong><span className="kpi-role">{person.role}</span></td>
                    <td>{summary.handled}</td>
                    <td><strong>{summary.completed}</strong></td>
                    <td>{personAverage === null ? "—" : formatDuration(personAverage)}</td>
                    <td>{numberOrDash(summary.onTimeRate, "%")}</td>
                    <td>{summary.dateChanges}</td>
                    <td>{summary.failedTesting}</td>
                    <td>{summary.reopened}</td>
                    <td>{summary.blockedDays}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </article>
  );
}

const DURATION_BUCKETS = [
  { key: "day", label: "Under 1 day", below: 24 },
  { key: "two", label: "1–2 days", below: 48 },
  { key: "four", label: "2–4 days", below: 96 },
  { key: "week", label: "4–7 days", below: 168 },
  { key: "more", label: "Over a week", below: Infinity },
];
const LONGEST_SHOWN = 10;
const REASONS_SHOWN = 8;

function PersonPage({ report, data, poLabel, pos }: { report: KpiReport; data: KpiPerson; poLabel: string | null; pos: string[] }) {
  const { person, summary, completed } = data;
  const statusColor = new Map(report.statuses.map((status) => [status.name, status.color]));
  const priorityColor = new Map(report.priorities.map((priority) => [priority.name, priority.color]));
  const typeColor = new Map(report.types.map((type) => [type.name, type.color]));

  // 4. Time to finish: the average, where it went, and how it spread.
  const hours = completed.map(hoursToFinish);
  const averageHours = average(hours);
  const stageHours = new Map<string, number>();
  for (const task of completed) {
    for (const stage of task.stages) {
      const spent = (new Date(stage.to).getTime() - new Date(stage.from).getTime()) / HOUR_MS;
      stageHours.set(stage.status, (stageHours.get(stage.status) ?? 0) + spent);
    }
  }
  const timeParts = [...stageHours].map(([status, total]) => ({
    key: status,
    label: STAGE_LABELS[status] ?? status,
    hours: total / Math.max(1, completed.length),
    color: statusColor.get(status) ?? "#a3a7ae",
  }));
  const spread = DURATION_BUCKETS.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    value: hours.filter((value) => value < bucket.below && (index === 0 || value >= DURATION_BUCKETS[index - 1].below)).length,
  }));

  // 3. Tasks that took longer than their own average.
  const longer =
    averageHours === null
      ? []
      : completed
          .map((task) => ({ task, hours: hoursToFinish(task) }))
          .filter((entry) => entry.hours > averageHours)
          .sort((a, b) => b.hours - a.hours);

  // 5. Probable date changes: tasks per PO, and the reasons given.
  const movedTasks = [...new Map(data.dateChanges.map((change) => [change.id, change])).values()];
  const movedPerPo = perPo(movedTasks, pos);

  const byPriority = data.priorityMix
    .filter((row) => row.completed > 0)
    .map((row) => ({ key: row.name, label: row.name === "Not set" ? "No priority" : `Priority ${row.name}`, value: row.completed, color: priorityColor.get(row.name) ?? "#a3a7ae" }));
  const byType = data.typeMix
    .filter((row) => row.completed > 0)
    .map((row) => ({ key: row.name, label: row.name === "Not set" ? "No type" : row.name, value: row.completed, color: typeColor.get(row.name) ?? "#a3a7ae" }));
  const tasksUnit = (value: number) => plural(value, "task");

  return (
    <article className="kpi-sheet">
      <PageHeader report={report} title={person.name.toLocaleUpperCase()} subtitle={`${person.role}${person.isActive ? "" : " · inactive"} · ${poLabel ? `POs: ${poLabel}` : "all POs"}`} />

      <div className="kpi-tiles">
        <Tile label="Tasks completed" value={summary.completed} note={`of ${summary.handled} assigned to them`} />
        <Tile label="Average time to finish" value={averageHours === null ? "—" : formatDuration(averageHours)} note="from assigned to completed" />
        <Tile label="On time" value={numberOrDash(summary.onTimeRate, "%")} note={`${summary.onTime} of ${summary.onTime + summary.late} with a promised date`} />
        <Tile label="Probable date changes" value={summary.dateChanges} note={`on ${plural(movedTasks.length, "task")}, +${summary.daysPushedBack} days`} />
        <Tile label="Failed testing" value={summary.failedTesting} note="sent back from Testing" />
        <Tile label="Reopened" value={summary.reopened} note="came back after Completed" />
        <Tile label="Days blocked" value={summary.blockedDays} note={`on ${plural(summary.blockedTasks, "task")}`} />
        <Tile label="Late tasks" value={summary.late} note={summary.averageDaysLate === null ? "none" : `${summary.averageDaysLate} days late on average`} />
      </div>

      <div className="kpi-cards">
        <Card title="Completed tasks by PO" caption={pos.length ? "A task for several of the chosen POs counts toward each." : "A task for several POs counts toward each."}>
          <Donut slices={perPo(completed, pos)} center={String(summary.completed)} centerLabel="completed" emptyText="Nothing completed in this period." />
        </Card>

        <Card title="Delivered when promised" caption="Completed date against the first probable date given.">
          <Donut
            slices={deliverySlices(summary)}
            center={summary.onTimeRate === null ? "—" : `${summary.onTimeRate}%`}
            centerLabel="on time"
            emptyText="Nothing completed in this period."
          />
        </Card>

        <Card title="Time to finish a task" caption="From the moment a task was assigned to them until it was completed." wide>
          {averageHours === null ? (
            <p className="kpi-none">Nothing completed in this period.</p>
          ) : (
            <div className="kpi-time">
              <div>
                <p className="kpi-big">{formatDuration(averageHours)}<span>on average</span></p>
                <p className="kpi-card-caption">Where the time went on an average task</p>
                <TimeSplit parts={timeParts} />
              </div>
              <div>
                <p className="kpi-card-caption">How long their tasks took</p>
                <Columns columns={spread} />
              </div>
            </div>
          )}
        </Card>

        <Card title="Urgency and kind of work" caption="Their completed tasks by priority and by type." wide>
          {completed.length === 0 ? (
            <p className="kpi-none">Nothing completed in this period.</p>
          ) : (
            <div className="kpi-halves">
              <ColorBars rows={byPriority} unit={tasksUnit} />
              <ColorBars rows={byType} unit={tasksUnit} />
            </div>
          )}
        </Card>

        <Card title="Probable date changes" caption="Tasks whose probable date was moved after it was set, by PO, and the reasons given." wide>
          {data.dateChanges.length === 0 ? (
            <p className="kpi-none">No probable dates were moved.</p>
          ) : (
            <div className="kpi-halves">
              <div>
                <p className="kpi-lead">
                  <strong>{plural(summary.dateChanges, "change")}</strong> on <strong>{plural(movedTasks.length, "task")}</strong>, pushed back <strong>{plural(summary.daysPushedBack, "day")}</strong> in total.
                </p>
                <ColorBars rows={movedPerPo} unit={tasksUnit} />
              </div>
              <ul className="kpi-reasons">
                {data.dateChanges.slice(0, REASONS_SHOWN).map((change) => (
                  <li key={`${change.id}-${change.at}`}>
                    <span className="kpi-reason-meta">
                      #{change.number} · {posOf(change, pos).map((po) => po.name).join(", ") || "—"} · {change.days === null ? "date cleared" : `${change.days > 0 ? "+" : ""}${plural(change.days, "day")}`}
                    </span>
                    <span className="kpi-reason-text">{change.reason ?? "No reason recorded"}</span>
                  </li>
                ))}
                {data.dateChanges.length > REASONS_SHOWN && <li className="kpi-more">and {data.dateChanges.length - REASONS_SHOWN} more</li>}
              </ul>
            </div>
          )}
        </Card>

        <Card
          title="Took longer than average"
          caption={averageHours === null ? undefined : `Tasks that took them longer than their average of ${formatDuration(averageHours)}.`}
          wide
        >
          {longer.length === 0 ? (
            <p className="kpi-none">{completed.length ? "No task took longer than average." : "Nothing completed in this period."}</p>
          ) : (
            <table className="kpi-table">
              <thead>
                <tr><th>Task</th><th>PO</th><th>Priority</th><th>Time taken</th><th>Over the average by</th></tr>
              </thead>
              <tbody>
                {longer.slice(0, LONGEST_SHOWN).map(({ task, hours: taken }) => (
                  <tr key={task.id}>
                    <td><span className="kpi-task-number">#{task.number}</span> {task.title}</td>
                    <td className="nowrap">{task.pos.map((po) => po.name).join(", ") || "—"}</td>
                    <td>{task.priority ?? "—"}</td>
                    <td className="nowrap"><strong>{formatDuration(taken)}</strong></td>
                    <td className="nowrap">{formatDuration(taken - averageHours!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {longer.length > LONGEST_SHOWN && <p className="kpi-more">and {longer.length - LONGEST_SHOWN} more</p>}
        </Card>
      </div>
    </article>
  );
}

function DefinitionsPage({ report, poLabel }: { report: KpiReport; poLabel: string | null }) {
  const rows: Array<[string, string]> = [
    ["Tasks completed", "Tasks completed in the period (by their Completed date) and still completed now. Each is credited to the person it was assigned to when it was completed, even if someone else had it before. \"Assigned to them\" counts every task they held at some point in the period."],
    ["Average time to finish", "The time from the moment a task was assigned to them until it was completed, averaged over the tasks they completed. Under a day it's shown in hours (24 hours = 1 day)."],
    ["Where the time went", "For an average task: how long it waited before work started (New), was In Progress, in Testing and Blocked."],
    ["On time / late", "The promised date is the first probable date while the task was theirs: the date it had when they got it, or else the first one they set. On time means completed on or before it; moving the date later doesn't change this. Tasks without a promised date are shown separately and left out of the percentage."],
    ["Completed tasks by PO", "A task for several POs counts toward each of them. Past six POs, the smallest are grouped as \"Other\"."],
    ["Probable date changes", "Every time a probable date that was already set was moved or cleared while the task was theirs, with the reason that had to be given (changes made before reasons were required show none). Setting the first date doesn't count."],
    ["Took longer than average", "Their completed tasks that took more than their own average time to finish, longest first."],
    ["Failed testing", "Each move from Testing back to In Progress while the task was theirs."],
    ["Reopened", "Each move from Completed back to an open status. It counts against whoever completed the task."],
    ["Days blocked", "Time their tasks spent in Blocked within the period (24 hours = 1 day)."],
  ];
  return (
    <article className="kpi-sheet kpi-definitions">
      <PageHeader report={report} title="How to read this report" />
      <dl>
        {rows.map(([term, text]) => (
          <div key={term}><dt>{term}</dt><dd>{text}</dd></div>
        ))}
      </dl>
      <p className="kpi-footnote">
        All figures come from each task's history in B-Track. Days are calendar days, weekends included.
        {poLabel && ` Only tasks for these POs are counted: ${poLabel}; for a task that also has other POs, only these count toward the PO shares.`}
        {report.excludedImported > 0 && ` The ${report.excludedImported} tasks imported from the old Daily Troubleshoot sheet are left out, because they arrived without a history.`}
      </p>
    </article>
  );
}
