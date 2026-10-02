import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { formatDate, formatDateTime } from "../format";
import type { Task, TaskDetail } from "../types";
import { EvidenceGallery } from "./Evidence";

export function TaskDrawer({
  taskId,
  currentUserId,
  onClose,
  onTaskChanged,
  onError,
}: {
  taskId: string;
  currentUserId: string;
  onClose: () => void;
  onTaskChanged: (task: Task) => void;
  onError: (error: unknown) => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const detail = await api.getTask(taskId);
    setTask(detail);
    setDescription(detail.description ?? "");
    return detail;
  };

  useEffect(() => {
    load().catch(onError);
  }, [taskId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveDescription = async () => {
    setBusy(true);
    try {
      await api.updateTask(taskId, { description: description.trim() || null });
      onTaskChanged(await load());
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  const addComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api.addComment(taskId, comment.trim());
      setComment("");
      onTaskChanged(await load());
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  const descriptionChanged = task !== null && description.trim() !== (task.description ?? "");
  const canUpdate = task?.access.edit ?? false;
  const canComment = task?.access.comment ?? false;

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Task details">
        <header className="drawer-header">
          <div>
            <span className="drawer-number">Issue #{task?.number ?? "…"}{task?.clients.map((client) => <span key={client.id} className="drawer-po" style={{ background: client.color }}>{client.name}</span>)}</span>
            <h2>{task?.title ?? "Loading…"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        {task && (
          <div className="drawer-body">
            <dl className="drawer-facts">
              <div><dt>{task.clients.length > 1 ? "Partner Organisations" : "Partner Organisation"}</dt><dd>{task.clients.map((client) => client.name).join(", ")}</dd></div>
              <div><dt>Type</dt><dd>{task.type?.name ?? "—"}</dd></div>
              <div><dt>Priority</dt><dd>{task.priority?.name ?? "—"}</dd></div>
              <div><dt>Status</dt><dd>{task.status.name}</dd></div>
              <div><dt>Assigned dev</dt><dd>{task.assignee?.name ?? "Unassigned"}</dd></div>
              <div><dt>Tested by</dt><dd>{task.testedBy?.name ?? "—"}</dd></div>
              <div><dt>Created by</dt><dd>{task.reporter.name}</dd></div>
              <div><dt>Date</dt><dd>{formatDate(task.reportedDate)}</dd></div>
              <div><dt>Probable date</dt><dd>{formatDate(task.expectedDeliveryDate)}</dd></div>
              <div><dt>Gap days</dt><dd>{task.gapDays ?? "—"}</dd></div>
              <div><dt>Completed</dt><dd>{formatDate(task.deliveredDate)}</dd></div>
            </dl>

            <section className="drawer-section">
              <h3>Description</h3>
              {canUpdate ? (
                <>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Add details, steps to reproduce, acceptance notes…"
                    rows={4}
                  />
                  {descriptionChanged && (
                    <div className="drawer-actions">
                      <button type="button" className="text-button" onClick={() => setDescription(task.description ?? "")}>Cancel</button>
                      <button type="button" className="small-primary" disabled={busy} onClick={saveDescription}>Save description</button>
                    </div>
                  )}
                </>
              ) : (
                <p className="drawer-text">{task.description || "No description."}</p>
              )}
            </section>

            <section className="drawer-section">
              <h3>Evidence <span className="section-count">{task.attachments.length}</span></h3>
              <EvidenceGallery
                taskId={task.id}
                attachments={task.attachments}
                canAdd={canUpdate}
                currentUserId={currentUserId}
                onChanged={() => load().then(onTaskChanged).catch(onError)}
              />
            </section>

            <section className="drawer-section">
              <h3>Comments <span className="section-count">{task.comments.length}</span></h3>
              {task.comments.length === 0 && <p className="drawer-empty">No comments yet.</p>}
              <ul className="comment-list">
                {task.comments.map((item) => (
                  <li key={item.id}>
                    <div className="comment-meta"><strong>{item.author.name}</strong><span>{formatDateTime(item.createdAt)}</span></div>
                    <p>{item.body}</p>
                  </li>
                ))}
              </ul>
              {canComment && (
                <form className="comment-form" onSubmit={addComment}>
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Write a comment…" rows={2} />
                  <button type="submit" className="small-primary" disabled={busy || !comment.trim()}>Comment</button>
                </form>
              )}
            </section>

            <section className="drawer-section">
              <h3>Edit history</h3>
              <ol className="history-list">
                {task.history.map((entry) => (
                  <li key={entry.id}>
                    <span className="history-dot" aria-hidden="true" />
                    <div>
                      <p>
                        <strong>{entry.actor.name}</strong>{" "}
                        {entry.field === "Created" ? (
                          "created this task"
                        ) : entry.field === "Evidence" ? (
                          <>
                            {entry.newValue ? "added evidence" : "removed evidence"}{" "}
                            <span className="history-value">{entry.newValue ?? entry.oldValue}</span>
                          </>
                        ) : (
                          <>
                            changed <em>{entry.field}</em>
                            {entry.field !== "Description" && (
                              <>
                                {" "}from <span className="history-value">{entry.oldValue ?? "empty"}</span> to{" "}
                                <span className="history-value">{entry.newValue ?? "empty"}</span>
                              </>
                            )}
                          </>
                        )}
                      </p>
                      <span className="history-time">{formatDateTime(entry.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
