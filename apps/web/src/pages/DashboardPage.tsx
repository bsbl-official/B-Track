import { useEffect, useState } from "react";
import { api } from "../api";
import { errorMessage, formatDate, timeAgo } from "../format";
import type { Dashboard, Profile } from "../types";

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
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
  const cards = data
    ? [
        { key: "assigned", caption: "ON YOUR PLATE", label: "Assigned to me", value: data.cards.assignedToMe, icon: "☑", tone: "violet", foot: "Open tasks assigned to you" },
        ...(teamWide
          ? [{ key: "open", caption: "ALL WORK", label: "Open tasks", value: data.cards.open, icon: "☷", tone: "blue", foot: `${data.cards.total} tasks in total` }]
          : []),
        { key: "overdue", caption: "NEEDS ATTENTION", label: "Overdue", value: data.cards.overdue, icon: "!", tone: "red", foot: teamWide ? "Past the probable date" : "Your tasks past the probable date" },
        { key: "soon", caption: "COMING UP", label: "Due in 3 days", value: data.cards.dueSoon, icon: "◷", tone: "amber", foot: teamWide ? "Including today" : "Your tasks, including today" },
        { key: "done", caption: "WRAPPED UP", label: "Completed", value: data.cards.deliveredRecently, icon: "✓", tone: "green", foot: teamWide ? "In the last 30 days" : "By you in the last 30 days" },
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
              <article key={card.key} className={`stat-card ${card.tone}`}>
                <div className="stat-top">
                  <span className={`stat-icon ${card.tone}`} aria-hidden="true">{card.icon}</span>
                  <span className="stat-caption">{card.caption}</span>
                </div>
                <strong className="stat-value">{card.value}</strong>
                <span className="stat-label">{card.label}</span>
                <div className="stat-foot"><span className="muted-dot" /> {card.foot}</div>
              </article>
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
