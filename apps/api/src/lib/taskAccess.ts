import type { Prisma } from "@prisma/client";
import { can, type Actor } from "../middleware/auth.js";
import { PERMISSIONS } from "./permissions.js";

type TaskOwnership = { reporterId: string; assigneeId: string | null };

export type TaskAccess = ReturnType<typeof taskAccess>;

/**
 * What the actor may do with one task.
 *
 * A task is "theirs" when it's assigned to them, or when they created it and it's still unassigned.
 * Once a task is assigned to someone else, it belongs to that person: its creator can only view it
 * (and comment), like everyone else. On their own tasks people may edit the fields, move the status,
 * set priority (with "set priority"), choose who tests it, and assign it (to anyone with "assign to
 * anyone", otherwise only themselves or nobody). "Edit & delete any task" gives all of that on every task.
 * Deleting is for the creator while the task is still theirs (and edit-all), so an assignee can't
 * delete work handed to them. Anyone who can take tasks may also claim an unassigned task:
 * assign it to themselves only.
 */
export function taskAccess(actor: Actor, task: TaskOwnership) {
  const isCreator = task.reporterId === actor.id;
  const isAssignee = task.assigneeId === actor.id;
  const editAll = can(actor, PERMISSIONS.taskEditAll);
  const ownedAsCreator = isCreator && (task.assigneeId === null || isAssignee);
  const edit = ownedAsCreator || isAssignee || editAll;

  return {
    view: edit || isCreator || can(actor, PERMISSIONS.taskViewAll),
    edit,
    delete: ownedAsCreator || editAll,
    setStatus: can(actor, PERMISSIONS.taskSetStatus) && edit,
    setPriority: can(actor, PERMISSIONS.taskSetPriority) && edit,
    // Without "assign to anyone", a user may only assign a task to themselves (or unassign it).
    assign: edit
      ? can(actor, PERMISSIONS.taskAssignAny) ? ("anyone" as const) : ("self" as const)
      : task.assigneeId === null && actor.isAssignable ? ("self" as const) : ("none" as const),
    setTester: edit,
    comment: can(actor, PERMISSIONS.commentCreate),
  };
}

export function visibleTasksWhere(actor: Actor): Prisma.TaskWhereInput {
  if (can(actor, PERMISSIONS.taskViewAll) || can(actor, PERMISSIONS.taskEditAll)) return {};
  return { OR: [{ reporterId: actor.id }, { assigneeId: actor.id }] };
}
