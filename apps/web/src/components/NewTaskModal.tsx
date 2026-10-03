import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { errorMessage, hasPermission, todayIso } from "../format";
import { api } from "../api";
import { PERMISSIONS, type Meta, type NewTask, type Profile, type Task } from "../types";
import { EvidencePicker, evidenceProblem, filesFromPaste } from "./Evidence";
import { PoPicker } from "./PoPicker";

const DAY_MS = 24 * 60 * 60 * 1000;

// Same rule as the sheet: today minus the probable date.
function gapPreview(probable: string | null): { text: string; tone: "none" | "late" | "today" | "ok" } {
  if (!probable) return { text: "Set a probable date to see gap days", tone: "none" };
  const gap = Math.round((new Date(`${todayIso()}T00:00:00Z`).getTime() - new Date(`${probable}T00:00:00Z`).getTime()) / DAY_MS);
  if (gap > 0) return { text: `Gap days: ${gap} (already ${gap} day${gap === 1 ? "" : "s"} late)`, tone: "late" };
  if (gap === 0) return { text: "Gap days: 0 (due today)", tone: "today" };
  return { text: `Gap days: ${gap} (${-gap} day${gap === -1 ? "" : "s"} to spare)`, tone: "ok" };
}

export function NewTaskModal({
  meta,
  profile,
  onCreate,
  onUpdated,
  onCreateClient,
  onClose,
}: {
  meta: Meta;
  profile: Profile;
  onCreate: (task: NewTask) => Promise<Task>;
  // After evidence is uploaded, so the sheet can show the file count.
  onUpdated: (task: Task) => void;
  onCreateClient: () => Promise<string | null>;
  onClose: () => void;
}) {
  const permissions = profile.permissions;
  const canSetPriority = hasPermission(permissions, PERMISSIONS.taskSetPriority);
  const canSetStatus = hasPermission(permissions, PERMISSIONS.taskSetStatus);
  const canComment = hasPermission(permissions, PERMISSIONS.commentCreate);
  const canManagePos = hasPermission(permissions, PERMISSIONS.poManage);
  const assignAny = hasPermission(permissions, PERMISSIONS.taskAssignAny);

  const initialStatus = meta.statuses.find((status) => status.isInitial) ?? meta.statuses[0];
  // A new task starts in the initial status or one step from it (e.g. logged as already Completed).
  const statusOptions = meta.statuses.filter(
    (status) => status.id === initialStatus?.id || (canSetStatus && initialStatus?.nextStatusIds.includes(status.id)),
  );
  const assignees = meta.users.filter((user) => user.isAssignable && (assignAny || user.id === profile.id));
  const testers = meta.users.filter((user) => user.canTest);

  const blank = (): NewTask => ({
    title: "",
    description: "",
    clientIds: [],
    typeId: null,
    priorityId: null,
    statusId: initialStatus?.id,
    assigneeId: assignAny ? null : (assignees[0]?.id ?? null),
    testerIds: [],
    reportedDate: todayIso(),
    expectedDeliveryDate: null,
    comment: "",
  });

  const [draft, setDraft] = useState<NewTask>(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const change = (update: Partial<NewTask>) => setDraft((current) => ({ ...current, ...update }));

  useEffect(() => {
    titleInput.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (keepOpen: boolean) => {
    // The "add another" button isn't a submit button, so run the form's checks by hand.
    if (saving || !form.current?.reportValidity()) return;
    if (draft.clientIds.length === 0) {
      setError("Pick at least one PO.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await onCreate({
        ...draft,
        title: draft.title.trim(),
        description: draft.description?.trim() || undefined,
        comment: draft.comment?.trim() || undefined,
        priorityId: canSetPriority ? draft.priorityId : null,
      });
      // The task exists now; attach the evidence. A failed file doesn't undo the task.
      const failed: string[] = [];
      for (const file of files) {
        try {
          await api.uploadAttachment(created.id, file);
        } catch (cause) {
          failed.push(`${file.name} (${errorMessage(cause)})`);
        }
      }
      if (files.length) onUpdated({ ...created, attachmentCount: files.length - failed.length });
      setFiles([]);
      setFileProblem(null);
      if (failed.length) {
        setDraft((current) => ({ ...current, title: "", description: "", comment: "", expectedDeliveryDate: null }));
        setError(`Task #${created.number} was created, but these files couldn't be attached: ${failed.join(", ")}. You can add them from the task's details.`);
        return;
      }
      if (keepOpen) {
        // Keep date, PO, type and people so a batch for the same PO goes in quickly.
        setDraft((current) => ({ ...current, title: "", description: "", comment: "", expectedDeliveryDate: null }));
        setSavedCount((count) => count + 1);
        titleInput.current?.focus();
      } else {
        onClose();
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(false);
  };

  const gap = gapPreview(draft.expectedDeliveryDate);
  const isClosed = meta.statuses.find((status) => status.id === draft.statusId)?.isClosed;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        ref={form}
        className="modal task-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
        onSubmit={onSubmit}
        onPaste={(event) => {
          // A pasted screenshot (or copied file) becomes evidence; pasted text behaves normally.
          const pasted = filesFromPaste(event);
          if (!pasted.length) return;
          event.preventDefault();
          const problems = pasted.map(evidenceProblem).filter(Boolean);
          setFileProblem(problems.length ? problems.join(". ") : null);
          setFiles((current) => [...current, ...pasted.filter((file) => !evidenceProblem(file))]);
        }}
      >
        <header className="modal-header">
          <span className="modal-icon" aria-hidden="true">＋</span>
          <div>
            <h2 id="new-task-title">New task</h2>
            <p>Issue No is given automatically when you save. Fields marked <b className="req">*</b> are required.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {error && <p className="form-error" role="alert">{error}</p>}
          {savedCount > 0 && !error && <p className="form-success">{savedCount} task{savedCount === 1 ? "" : "s"} added. Add the next one.</p>}

          <section className="form-section">
            <h3 className="form-section-title">Issue</h3>
            <div className="form-grid">
              <label className="span-2">
                <span>Issue title <b className="req">*</b></span>
                <input ref={titleInput} required maxLength={300} value={draft.title} onChange={(event) => change({ title: event.target.value })} placeholder="e.g. LOAN_DISBURSEMENT (new condition add)" />
              </label>

              <div className="field">
                <span>PO <b className="req">*</b> <em>one or more</em></span>
                <PoPicker
                  variant="field"
                  options={meta.clients}
                  value={draft.clientIds}
                  onChange={(clientIds) => change({ clientIds })}
                  onCreate={canManagePos ? onCreateClient : undefined}
                />
              </div>

              <div className="field">
                <span>Type <em>optional</em></span>
                <div className="segmented" role="radiogroup" aria-label="Type">
                  {meta.types.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      role="radio"
                      aria-checked={draft.typeId === type.id}
                      className={draft.typeId === type.id ? "selected" : ""}
                      style={{ "--pill": type.color } as CSSProperties}
                      onClick={() => change({ typeId: draft.typeId === type.id ? null : type.id })}
                    >
                      <span className="seg-dot" aria-hidden="true" />
                      {type.name}
                    </button>
                  ))}
                </div>
              </div>

              <label className="span-2">
                <span>Description <em>optional</em></span>
                <textarea rows={3} value={draft.description} onChange={(event) => change({ description: event.target.value })} placeholder="Steps to reproduce, report name, branch…" />
              </label>
            </div>
          </section>

          <section className="form-section">
            <h3 className="form-section-title">Evidence <span className="section-hint">optional</span></h3>
            <EvidencePicker files={files} onChange={setFiles} onProblem={setFileProblem} />
            {fileProblem && <p className="form-error evidence-problem" role="alert">{fileProblem}</p>}
          </section>

          <section className="form-section">
            <h3 className="form-section-title">People &amp; progress</h3>
            <div className="form-grid">
              <label>
                <span>Assigned dev {!assignAny && <em>only yourself</em>}</span>
                <select value={draft.assigneeId ?? ""} onChange={(event) => change({ assigneeId: event.target.value || null })}>
                  <option value="">Unassigned</option>
                  {assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>

              <div className="field">
                <span>Tested by <em>one or more, optional</em></span>
                <PoPicker variant="field" label="Tested by" placeholder="Not yet" required={false} options={testers} value={draft.testerIds} onChange={(testerIds) => change({ testerIds })} />
              </div>

              <div className="field">
                <span>Priority {canSetPriority ? <em>1 is most urgent</em> : <em>set by BA/Admin</em>}</span>
                {canSetPriority ? (
                  <div className="segmented" role="radiogroup" aria-label="Priority">
                    {meta.priorities.map((priority) => (
                      <button
                        key={priority.id}
                        type="button"
                        role="radio"
                        aria-checked={draft.priorityId === priority.id}
                        className={draft.priorityId === priority.id ? "selected" : ""}
                        style={{ "--pill": priority.color } as CSSProperties}
                        onClick={() => change({ priorityId: draft.priorityId === priority.id ? null : priority.id })}
                      >
                        {priority.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input value="Left blank for a BA/Admin" disabled />
                )}
              </div>

              <label>
                <span>Status</span>
                <select value={draft.statusId} onChange={(event) => change({ statusId: event.target.value })} disabled={statusOptions.length < 2}>
                  {statusOptions.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                </select>
                {isClosed && <small>Completed date will be set to today.</small>}
              </label>
            </div>
          </section>

          <section className="form-section">
            <h3 className="form-section-title">Dates</h3>
            <div className="form-grid">
              <label>
                <span>Date <b className="req">*</b> <em>assigned on</em></span>
                <input type="date" required value={draft.reportedDate} onChange={(event) => event.target.value && change({ reportedDate: event.target.value })} />
              </label>

              <label>
                <span>Probable date <em>developer's estimate</em></span>
                <input
                  type="date"
                  min={draft.reportedDate}
                  value={draft.expectedDeliveryDate ?? ""}
                  onChange={(event) => change({ expectedDeliveryDate: event.target.value || null })}
                />
                <small className={`gap-preview ${gap.tone}`}>{gap.text}</small>
              </label>
            </div>
          </section>

          {canComment && (
            <section className="form-section">
              <h3 className="form-section-title">Comment</h3>
              <div className="form-grid">
                <label className="span-2">
                  <span>First comment <em>optional</em></span>
                  <textarea rows={2} value={draft.comment} onChange={(event) => change({ comment: event.target.value })} placeholder="Anything the team should know" />
                </label>
              </div>
            </section>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => submit(true)}>
            Save &amp; add another
          </button>
          <button type="submit" className="small-primary" disabled={saving}>{saving ? "Saving…" : "Create task"}</button>
        </footer>
      </form>
    </div>
  );
}
