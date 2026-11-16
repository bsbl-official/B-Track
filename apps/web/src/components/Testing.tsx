import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../format";
import type { Meta, Named, Task } from "../types";
import { Avatar } from "./Avatar";

// Testing sign-off in the web app. The server decides every rule; this only shows them.

// Pseudo options added to the sheet's Status dropdown for a tester.
export const PASS_OPTION = "__pass";
export const SEND_BACK_OPTION = "__send_back";

const list = (people: Named[]) => people.map((person) => person.name).join(", ");

/** One line explaining the testing state, or null when there's nothing to say. */
export function testingNote(task: Task): string | null {
  const { testing } = task;
  if (testing.testers.length === 0) return null;
  const pending = testing.testers.filter((tester) => tester.verdict === null);
  const sentBack = testing.testers.filter((tester) => tester.verdict === "sent_back");
  if (task.status.name === "Testing") {
    if (testing.allPassed) return "Every tester passed it. It can be marked Completed.";
    const back = sentBack.length > 0 ? ` ${list(sentBack)} sent it back; it returns to In Progress once everyone has answered.` : "";
    return pending.length > 0 ? `Waiting for ${list(pending)} to finish testing.${back}` : `Sent back by ${list(sentBack)}.`;
  }
  if (testing.lock === "untested") return "Can be completed only after every tester passes it";
  return null;
}

const answeredCount = (task: Task) => task.testing.testers.filter((tester) => tester.verdict !== null).length;

/**
 * What the sheet's Status cell offers: the workflow's next statuses, narrowed by the testing lock,
 * plus Pass / Send back for a tester. The current status reads "Testing 1/2" while testers work.
 */
export function statusChoices(task: Task, meta: Meta, viewerId: string) {
  const { testing, access } = task;
  const current = meta.statuses.find((status) => status.id === task.statusId);
  let moves = access.setStatus ? meta.statuses.filter((status) => current?.nextStatusIds.includes(status.id)) : [];
  if (testing.lock === "waiting") moves = [];
  if (testing.lock === "passed") moves = moves.filter((status) => status.isClosed);
  if (testing.lock === "untested") moves = moves.filter((status) => !status.isClosed);

  // "Testing 1/2": how many testers have answered this round.
  const inTesting = task.status.name === "Testing" && testing.testers.length > 0;
  const currentOption = { ...task.status, name: inTesting ? `${task.status.name} ${answeredCount(task)}/${testing.testers.length}` : task.status.name };

  const verdicts: Array<Named> = [];
  if (testing.canVerdict) {
    const mine = testing.testers.find((tester) => tester.id === viewerId);
    if (mine?.verdict !== "passed") verdicts.push({ id: PASS_OPTION, name: "✓ Pass testing" });
    verdicts.push({ id: SEND_BACK_OPTION, name: mine?.verdict === "sent_back" ? "↩ Send back again…" : "↩ Send back…" });
  }

  return {
    options: [currentOption, ...moves, ...verdicts],
    disabled: moves.length === 0 && verdicts.length === 0,
    title: testingNote(task) ?? undefined,
  };
}

/** Asks the tester what still needs fixing before the task goes back to In Progress. */
export function SendBackDialog({ task, onCancel, onSave }: { task: Task; onCancel: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return setError("Say what still needs fixing.");
    setBusy(true);
    try {
      await onSave(reason.trim());
    } catch (saveError) {
      setError(errorMessage(saveError));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form className="modal reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="send-back-title" onSubmit={submit}>
        <header className="modal-header">
          <div>
            <h2 id="send-back-title">Send back from testing</h2>
            <p>#{task.number} · {task.title}</p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          {error && <p className="form-error" role="alert">{error}</p>}
          <label className="reschedule-field">
            <span>What still needs fixing? <b className="req">*</b></span>
            <textarea rows={3} maxLength={5000} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. The balance is still wrong for members with two loans" />
            <em>The developer is notified straight away and this is saved as a comment. Once every tester has answered, the task goes back to In Progress, and everyone tests again next round.</em>
          </label>
        </div>
        <footer className="modal-footer">
          <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="small-primary" disabled={busy || !reason.trim()}>{busy ? "Sending…" : "Send back"}</button>
        </footer>
      </form>
    </div>
  );
}

/** The drawer's Testing card: each tester's verdict, and the tester's own actions. */
export function TestingPanel({
  task,
  currentUserId,
  busy,
  onPass,
  onSendBack,
  onLeave,
}: {
  task: Task;
  currentUserId: string;
  busy: boolean;
  onPass: () => void;
  onSendBack: () => void;
  onLeave: () => void;
}) {
  const { testing } = task;
  const inTesting = task.status.name === "Testing";
  const mine = testing.testers.find((tester) => tester.id === currentUserId);
  const note = testingNote(task);

  return (
    <section className="testing-card">
      <div className="testing-head">
        <h3>Testing</h3>
        {inTesting && (
          <span className={`testing-progress ${testing.allPassed ? "done" : testing.testers.some((tester) => tester.verdict === "sent_back") ? "back" : ""}`}>
            {answeredCount(task)}/{testing.testers.length} answered
          </span>
        )}
      </div>
      <ul className="testing-list">
        {testing.testers.map((tester) => (
          <li key={tester.id}>
            <span className="person"><Avatar name={tester.name} size={24} />{tester.name}</span>
            <span className={`testing-verdict ${tester.verdict ?? (inTesting ? "waiting" : "idle")}`}>
              {tester.verdict === "passed" ? "✓ Passed" : tester.verdict === "sent_back" ? "↩ Sent back" : inTesting ? "Testing…" : "Not started"}
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="testing-note">{note}</p>}
      {(testing.canVerdict || mine) && (
        <div className="testing-actions">
          {testing.canVerdict && mine?.verdict !== "passed" && (
            <button type="button" className="small-primary" disabled={busy} onClick={onPass}>✓ Pass testing</button>
          )}
          {testing.canVerdict && (
            <button type="button" className="ghost-button" disabled={busy} onClick={onSendBack}>{mine?.verdict === "sent_back" ? "↩ Send back again" : "↩ Send back"}</button>
          )}
          {mine && (
            <button type="button" className="text-button" disabled={busy} onClick={onLeave} title="Take yourself off Tested by">
              Take me off testing
            </button>
          )}
        </div>
      )}
    </section>
  );
}
