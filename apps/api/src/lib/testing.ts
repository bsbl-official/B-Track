import { can, type Actor } from "../middleware/auth.js";
import { PERMISSIONS } from "./permissions.js";

/**
 * Testing sign-off.
 *
 * - When an assignee (the developer) adds a tester, the task moves to Testing by itself.
 * - In Testing, every tester gives their own verdict: pass, or send back with a reason. Nobody's verdict
 *   blocks another's, and a tester may change theirs while the round is open. The developer hears about
 *   each verdict straight away, but the status stays locked until every tester has answered.
 * - When the last tester answers: if anyone sent it back, it returns to In Progress (a new round starts
 *   when the developer moves it to Testing again); if everyone passed, the developer may mark it Completed
 *   (the only move left to them).
 * - A task with testers can't be completed without every tester's pass, from any status.
 * - A developer can't take testers off the task; testers may take themselves off.
 * - "Override testing" (Admin, or anyone granted it) lifts all of this.
 *
 * Only real people count as testers: the "User" entry (confirmation from the user's side, flagged
 * isPlaceholder; it can't sign in) never blocks anything and can't give a verdict.
 * Verdicts belong to one round: any status change other than Testing → Completed clears them.
 */

// Statuses are data; like the KPI report, the workflow finds these two by name.
export const TESTING_STATUS = "Testing";
export const IN_PROGRESS_STATUS = "In Progress";

export type TestingTask = {
  status: { name: string; isClosed: boolean };
  testers: Array<{ id: string; name: string; isPlaceholder: boolean }>;
  testVerdicts: Array<{ testerId: string; passed: boolean }>;
};

// "waiting": in Testing and some testers haven't answered, so the status is locked.
// "passed": in Testing and every tester passed, so it may only be completed.
// "untested": has testers but not every one has passed (or it isn't in Testing), so it can't be completed.
export type StatusLock = "waiting" | "passed" | "untested" | null;

export type Verdict = "passed" | "sent_back" | null;

export const isRealTester = (tester: { isPlaceholder: boolean }) => !tester.isPlaceholder;

export function verdictOf(task: Pick<TestingTask, "testVerdicts">, testerId: string): Verdict {
  const verdict = task.testVerdicts.find((item) => item.testerId === testerId);
  return verdict ? (verdict.passed ? "passed" : "sent_back") : null;
}

export function testingState(actor: Actor, task: TestingTask) {
  const realTesters = task.testers.filter(isRealTester);
  const pending = realTesters.filter((tester) => verdictOf(task, tester.id) === null);
  const sentBack = realTesters.filter((tester) => verdictOf(task, tester.id) === "sent_back");
  const allPassed = realTesters.length > 0 && realTesters.every((tester) => verdictOf(task, tester.id) === "passed");
  const inTesting = task.status.name === TESTING_STATUS;
  const override = can(actor, PERMISSIONS.taskOverrideTesting);

  let lock: StatusLock = null;
  if (!override && realTesters.length > 0) {
    if (inTesting && pending.length > 0) lock = "waiting";
    else if (inTesting && allPassed) lock = "passed";
    else if (!task.status.isClosed) lock = "untested";
  }

  return {
    inTesting,
    realTesters,
    pending,
    sentBack,
    allPassed,
    override,
    lock,
    // Each tester gives (or changes) their own verdict while the task is in Testing.
    canVerdict: inTesting && realTesters.some((tester) => tester.id === actor.id),
  };
}

/** What the web app needs: each real tester and their verdict this round. */
export function serializeTesting(actor: Actor, task: TestingTask) {
  const state = testingState(actor, task);
  return {
    testers: state.realTesters.map((tester) => ({ id: tester.id, name: tester.name, verdict: verdictOf(task, tester.id) })),
    allPassed: state.allPassed,
    lock: state.lock,
    canVerdict: state.canVerdict,
    override: state.override,
  };
}
