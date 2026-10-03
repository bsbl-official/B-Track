import { useEffect, useState } from "react";
import { api } from "../api";
import { errorMessage, formatDate, timeAgo } from "../format";
import type { Dashboard, Profile } from "../types";

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// Line icons for the metric cards, drawn like the sidebar's NavIcon.
const statIcons: Record<string, string[]> = {
  assigned: ["M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3 20c0-3.3 2.9-6 6.5-6 1.3 0 2.5.3 3.5.9", "m15 18 2 2 4-4"],
  open: ["M12 3 3 7.5l9 4.5 9-4.5z", "m3 12 9 4.5 9-4.5", "m3 16.5 9 4.5 9-4.5"],
  overdue: ["M12 3.5 2.5 20h19z", "M12 10v4.5", "M12 17.5h.01"],
  soon: ["M4.5 5.5h15v15h-15z", "M4.5 10h15", "M8.5 3v4", "M15.5 3v4", "M12 13v3l2 1.5"],
  done: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "m8 12.5 2.8 2.8L16.5 9.5"],
};

function StatIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {(statIcons[name] ?? []).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

// Local date N days ago as "YYYY-MM-DD", the format the sheet filters use.
function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function deadlineLabel(gapDays: number | null) {
  if (gapDays === null) return "";
  if (gapDays > 0) return `${gapDays}d late`;
  if (gapDays === 0) return "Due today";
  return `in ${-gapDays}d`;
}

export function DashboardPage({ profile }: { profile: Profile }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.dashboard().then(setData).catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
  const maxStatus = Math.max(1, ...(data?.byStatus.map((status) => status.count) ?? [1]));

  // Without "dashboard.view_all" the API counts only the person's own (assigned) tasks, and the team-wide "Open tasks" card is left out.
  const teamWide = data?.scope === "all";
  // Each card opens the task sheet showing exactly the tasks it counts. Without the team-wide
  // scope the numbers cover only the person's assigned tasks, so the sheet filters to them too.
  const mine: Record<string, string> = teamWide ? {} : { assignee: "me" };
  const sheetLink = (params: Record<string, string>) => `#/tasks?${new URLSearchParams(params)}`;
  const cards = data
    ? [
        { key: "assigned", caption: "ON YOUR PLATE", label: "Assigned to me", value: data.cards.assignedToMe, tone: "mine", href: sheetLink({ view: "open", assignee: "me" }), foot: "Open tasks assigned to you" },
        ...(teamWide
          ? [{ key: "open", caption: "ALL WORK", label: "Open tasks", value: data.cards.open, tone: "blue", href: sheetLink({ view: "open" }), foot: `${data.cards.total} tasks in total` }]
          : []),
        { key: "overdue", caption: "NEEDS ATTENTION", label: "Overdue", value: data.cards.overdue, tone: "red", href: sheetLink({ view: "overdue", ...mine }), foot: teamWide ? "Past the probable date" : "Your tasks past the probable date" },
        { key: "soon", caption: "TODAY", label: "Due today", value: data.cards.dueToday, tone: "amber", href: sheetLink({ view: "dueToday", ...mine }), foot: teamWide ? "Probable date is today" : "Your tasks, probable date today" },
        { key: "done", caption: "WRAPPED UP", label: "Completed", value: data.cards.deliveredRecently, tone: "green", href: sheetLink({ view: "all", completedFrom: daysAgo(30), ...mine }), foot: teamWide ? "In the last 30 days" : "By you in the last 30 days" },
      ]
    : [];

  return (
    <div className="dashboard">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">{today}</p>
          <h1>{greeting()}, {profile.name.split(" ")[0]} <span aria-hidden="true">✳</span></h1>
          <p className="subtitle">
            {teamWide ? "Here's how work is going across every Partner Organisation." : "Here's how your tasks are going."}
          </p>
        </div>
        <a className="primary-button" href="#/tasks"><span aria-hidden="true">＋</span> Open task sheet</a>
      </div>

      {error && <p className="load-error" role="alert">{error}</p>}
      {!data && !error && <p className="loading">Loading dashboard…</p>}

      {data && (
        <>
          <div className="stats-grid" aria-label="Task metrics">
            {cards.map((card) => (
              <a key={card.key} href={card.href} className={`stat-card ${card.tone}${card.value === 0 ? " is-zero" : ""}`} title={`Show these tasks in the task sheet`}>
                <div className="stat-top">
                  <span className="stat-icon" aria-hidden="true"><StatIcon name={card.key} /></span>
                  <span className="stat-caption">{card.caption}</span>
                </div>
                <strong className="stat-value">{card.value}</strong>
                <span className="stat-label">{card.label}</span>
                <div className="stat-foot"><span className="muted-dot" /> {card.foot}<span className="stat-go" aria-hidden="true">View →</span></div>
              </a>
            ))}
          </div>

          <div className="lower-grid">
            <section className="panel-card">
              <div className="panel-heading">
                <div><h2>Tasks by status</h2><p>{teamWide ? "All tasks" : "Tasks assigned to you"}</p></div>
              </div>
              <ul className="status-bars">
                {data.byStatus.map((status) => (
                  <li key={status.id}>
                    <span className="status-name">{status.name}</span>
                    <span className="status-track">
                      <span className="status-fill" style={{ width: `${(status.count / maxStatus) * 100}%`, background: status.color }} />
                    </span>
                    <span className="status-count">{status.count}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel-card">
              <div className="panel-heading">
                <div><h2>Upcoming deadlines</h2><p>Open tasks by probable date</p></div>
              </div>
              {data.deadlines.length === 0 ? (
                <div className="deadline-empty"><strong>No deadlines coming up</strong><p>When tasks have probable dates, you'll find them here.</p></div>
              ) : (
                <ul className="deadline-list">
                  {data.deadlines.map((task) => (
                    <li key={task.id}>
                      <a href={`#/tasks?open=${task.id}`}>
                        <span className="deadline-title"><span className="deadline-number">#{task.number}</span> {task.title}</span>
                        <span className="deadline-meta">{task.client} · {formatDate(task.expectedDeliveryDate)}</span>
                      </a>
                      <span className={`deadline-chip ${task.gapDays !== null && task.gapDays > 0 ? "late" : task.gapDays !== null && task.gapDays >= -3 ? "soon" : ""}`}>
                        {deadlineLabel(task.gapDays)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel-card activity-panel">
              <div className="panel-heading">
                <div><h2>Recent activity</h2><p>Latest changes to your tasks</p></div>
              </div>
              {data.activity.length === 0 ? (
                <div className="deadline-empty"><strong>It's quiet around here</strong><p>Changes to tasks will show up here.</p></div>
              ) : (
                <ul className="activity-list">
                  {data.activity.map((entry) => (
                    <li key={entry.id}>
                      <p>
                        <strong>{entry.actor}</strong>{" "}
                        {entry.field === "Created" ? "created " : <>changed <em>{entry.field}</em>{entry.newValue && entry.field !== "Description" ? <> to <b>{entry.newValue}</b></> : null} on </>}
                        <a href={`#/tasks?open=${entry.task.id}`}>#{entry.task.number} {entry.task.title}</a>
                      </p>
                      <span>{timeAgo(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
