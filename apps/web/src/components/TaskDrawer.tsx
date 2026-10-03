import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { api } from "../api";
import { errorMessage, formatDate, formatDateTime } from "../format";
import type { Meta, Named, Task, TaskDetail, TaskUpdate } from "../types";
import { Avatar } from "./Avatar";
import { EvidenceGallery } from "./Evidence";
import { PoPicker } from "./PoPicker";

// The fields that are read-only in the sheet and edited here.
type Draft = { title: string; clientIds: string[]; typeId: string | null; reportedDate: string; expectedDeliveryDate: string | null };
const draftOf = (task: Task): Draft => ({
  title: task.title,
  clientIds: task.clients.map((client) => client.id),
  typeId: task.typeId,
  reportedDate: task.reportedDate,
  expectedDeliveryDate: task.expectedDeliveryDate,
});

function PersonRow({ label, person, empty }: { label: string; person: Named | null; empty: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {person ? (
          <span className="person"><Avatar name={person.name} size={24} />{person.name}</span>
        ) : (
          <span className="muted">{empty}</span>
        )}
      </dd>
    </div>
  );
}

// Today minus the probable date: positive is late. Blank once the task is completed.
function GapBadge({ gap }: { gap: number | null }) {
  if (gap === null) return <span className="muted">—</span>;
  if (gap > 0) return <span className="gap-badge late">{gap} day{gap === 1 ? "" : "s"} late</span>;
  if (gap === 0) return <span className="gap-badge soon">Due today</span>;
  return <span className="gap-badge left">{-gap} day{gap === -1 ? "" : "s"} left</span>;
}

export function TaskDrawer({
  taskId,
  meta,
  currentUserId,
  onClose,
  onTaskChanged,
  onDeleted,
  onError,
}: {
  taskId: string;
  meta: Meta;
  currentUserId: string;
  onClose: () => void;
  onTaskChanged: (task: Task) => void;
  onDeleted: (taskId: string) => void;
  onError: (error: unknown) => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const startEditing = () => {
    if (!task) return;
    setDraft(draftOf(task));
    setEditError(null);
  };

  const saveEdits = async (event: FormEvent) => {
    event.preventDefault();
    if (!task || !draft) return;
    const original = draftOf(task);
    const title = draft.title.replace(/\s+/g, " ").trim();
    if (!title) return setEditError("The issue title can't be empty.");
    if (draft.clientIds.length === 0) return setEditError("Pick at least one PO.");
    if (!draft.reportedDate) return setEditError("The date can't be empty.");
    const change: TaskUpdate = {};
    if (title !== original.title) change.title = title;
    if (draft.typeId !== original.typeId) change.typeId = draft.typeId;
    if (draft.reportedDate !== original.reportedDate) change.reportedDate = draft.reportedDate;
    if (draft.expectedDeliveryDate !== original.expectedDeliveryDate) change.expectedDeliveryDate = draft.expectedDeliveryDate;
    if (draft.clientIds.length !== original.clientIds.length || draft.clientIds.some((id) => !original.clientIds.includes(id))) change.clientIds = draft.clientIds;
    setBusy(true);
    try {
      if (Object.keys(change).length > 0) {
        await api.updateTask(taskId, change);
        onTaskChanged(await load());
      }
      setDraft(null);
    } catch (error) {
      setEditError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteTask = async () => {
    if (!task || !window.confirm(`Delete task #${task.number} "${task.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteTask(task.id);
      onDeleted(task.id);
    } catch (error) {
      setBusy(false);
      onError(error);
    }
  };

  const load = async () => {
    const detail = await api.getTask(taskId);
    setTask(detail);
    setDescription(detail.description ?? "");
    return detail;
  };

  useEffect(() => {
    setDraft(null);
    load().catch(onError);
  }, [taskId]);

  // Escape leaves the edit form first, then closes the drawer.
  const editing = draft !== null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editing) setDraft(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

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
  const canDelete = task?.access.delete ?? false;
  // POs archived after the task was logged still show by name.
  const poOptions = task ? [...meta.clients, ...task.clients.filter((client) => !meta.clients.some((po) => po.id === client.id))] : meta.clients;
  const changeDraft = (change: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...change } : current));

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Task details">
        <header className="drawer-header">
          {/* Top bar: issue number on the left, actions on the right. */}
          <div className="drawer-topbar">
            <span className="drawer-number">Issue #{task?.number ?? "…"}</span>
            <div className="drawer-header-actions">
              {task && canUpdate && !editing && (
                <button type="button" className="drawer-tool" onClick={startEditing} title="Edit title, PO, type and dates">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
                  <span>Edit</span>
                </button>
              )}
              {task && canDelete && (
                <button type="button" className="drawer-tool danger" onClick={deleteTask} disabled={busy} title="Delete this task">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /><path d="M10.5 11v5.5M13.5 11v5.5" /></svg>
                  <span>Delete</span>
                </button>
              )}
              {(canUpdate || canDelete) && <span className="drawer-divider" aria-hidden="true" />}
              <button type="button" className="drawer-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>
          <h2>{task?.title ?? "Loading…"}</h2>
          {task && (
            <div className="drawer-pills">
              <span className="drawer-pill status" style={{ "--pill": task.status.color } as CSSProperties}>
                <span className="pill-dot" aria-hidden="true" />{task.status.name}
              </span>
              {task.priority && (
                <span className="drawer-pill" style={{ "--pill": task.priority.color } as CSSProperties}>Priority {task.priority.name}</span>
              )}
              {task.type && <span className="drawer-pill" style={{ "--pill": task.type.color } as CSSProperties}>{task.type.name}</span>}
              {task.clients.map((client) => (
                <span key={client.id} className="drawer-pill solid" style={{ "--pill": client.color } as CSSProperties}>{client.name}</span>
              ))}
            </div>
          )}
        </header>

        {task && draft && (
          <form className="drawer-body drawer-edit" onSubmit={saveEdits}>
            <div className="form-grid">
              <label className="span-2">
                <span>Issue title <b className="req">*</b></span>
                <textarea rows={2} maxLength={300} value={draft.title} onChange={(event) => changeDraft({ title: event.target.value })} autoFocus />
              </label>
              <div className="field span-2">
                <span>PO <b className="req">*</b> <em>one or more</em></span>
                <PoPicker variant="field" options={poOptions} value={draft.clientIds} onChange={(clientIds) => changeDraft({ clientIds })} />
              </div>
              <div className="field span-2">
                <span>Type</span>
                <div className="segmented" role="radiogroup" aria-label="Type">
                  {meta.types.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      role="radio"
                      aria-checked={draft.typeId === type.id}
                      className={draft.typeId === type.id ? "selected" : ""}
                      style={{ "--pill": type.color } as CSSProperties}
                      onClick={() => changeDraft({ typeId: draft.typeId === type.id ? null : type.id })}
                    >
                      <span className="seg-dot" aria-hidden="true" />
                      {type.name}
                    </button>
                  ))}
                </div>
              </div>
              <label>
                <span>Date <b className="req">*</b> <em>assigned on</em></span>
                <input type="date" required value={draft.reportedDate} onChange={(event) => event.target.value && changeDraft({ reportedDate: event.target.value })} />
              </label>
              <label>
                <span>Probable date</span>
                <input type="date" value={draft.expectedDeliveryDate ?? ""} onChange={(event) => changeDraft({ expectedDeliveryDate: event.target.value || null })} />
              </label>
            </div>
            {editError && <p className="form-error" role="alert">{editError}</p>}
            <div className="drawer-actions">
              <button type="button" className="ghost-button" onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className="small-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        )}

        {task && !draft && (
          <div className="drawer-body">
            {/* Two calm cards: who is involved, and when. One label/value pair per line. */}
            <div className="drawer-cards">
              <section className="info-card">
                <h3>People</h3>
                <dl>
                  <PersonRow label="Assigned dev" person={task.assignee} empty="Unassigned" />
                  <PersonRow label="Tested by" person={task.testedBy} empty="Not yet" />
                  <PersonRow label="Created by" person={task.reporter} empty="—" />
                </dl>
              </section>
              <section className="info-card">
                <h3>Dates</h3>
                <dl>
                  <div><dt>Date</dt><dd>{formatDate(task.reportedDate)}</dd></div>
                  <div><dt>Probable date</dt><dd>{task.expectedDeliveryDate ? formatDate(task.expectedDeliveryDate) : <span className="muted">Not set</span>}</dd></div>
                  <div><dt>Gap days</dt><dd><GapBadge gap={task.gapDays} /></dd></div>
                  <div><dt>Completed</dt><dd>{task.deliveredDate ? formatDate(task.deliveredDate) : <span className="muted">Not yet</span>}</dd></div>
                </dl>
              </section>
            </div>

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
