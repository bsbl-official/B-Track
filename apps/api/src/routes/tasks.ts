import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { dateOnly, formatDateOnly, gapDays, parseDateOnly, today } from "../lib/dates.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { resolveTags, saveNewTags, tagInputSchema, tagsText, type ResolvedTag } from "../lib/tags.js";
import { taskAccess, visibleTasksWhere } from "../lib/taskAccess.js";
import { IN_PROGRESS_STATUS, TESTING_STATUS, isRealTester, serializeTesting, testingState, verdictOf } from "../lib/testing.js";
import { can, getActor, requirePermission, type Actor } from "../middleware/auth.js";
import { attachmentSelect, attachmentsRouter } from "./attachments.js";

export const tasksRouter = Router();
tasksRouter.use("/:taskId/attachments", attachmentsRouter);

export const taskInclude = {
  clients: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
  type: { select: { id: true, name: true, color: true, isRoutine: true } },
  priority: { select: { id: true, name: true, color: true, rank: true } },
  status: { select: { id: true, name: true, color: true, isClosed: true } },
  reporter: { select: { id: true, name: true } },
  assignees: { select: { id: true, name: true }, orderBy: { name: "asc" } },
  // isPlaceholder marks the "User" entry, which never counts in the testing sign-off.
  testers: { select: { id: true, name: true, isPlaceholder: true }, orderBy: { name: "asc" } },
  testVerdicts: { select: { testerId: true, passed: true } },
  tags: {
    select: { details: true, tag: { select: { id: true, name: true, color: true, detailLabel: true } } },
    orderBy: { tag: { name: "asc" } },
  },
  // The newest comment fills the sheet's Comments column.
  comments: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { body: true, createdAt: true, author: { select: { name: true } } },
  },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function serializeTask({ _count, comments, testVerdicts, tags, ...task }: TaskRow, actor: Actor) {
  return {
    ...task,
    testers: task.testers.map(({ id, name }) => ({ id, name })),
    // Each tag with the tables, files or screens listed for it on this task.
    tags: tags.map(({ tag, details }) => ({ ...tag, details })),
    reportedDate: formatDateOnly(task.reportedDate),
    expectedDeliveryDate: formatDateOnly(task.expectedDeliveryDate),
    deliveredDate: formatDateOnly(task.deliveredDate),
    gapDays: gapDays(task.expectedDeliveryDate, task.status.isClosed),
    commentCount: _count.comments,
    attachmentCount: _count.attachments,
    latestComment: comments[0] ? { body: comments[0].body, author: comments[0].author.name, createdAt: comments[0].createdAt } : null,
    access: taskAccess(actor, task),
    testing: serializeTesting(actor, { ...task, testVerdicts }),
  };
}

async function findStatusByName(name: string) {
  return prisma.status.findFirst({ where: { name } });
}

// Tasks the actor can't see are reported as missing rather than forbidden.
export async function findVisibleTask(actor: Actor, id: string) {
  const task = await prisma.task.findFirst({ where: { AND: [{ id }, visibleTasksWhere(actor)] }, include: taskInclude });
  if (!task) throw new HttpError(404, "Task not found");
  return task;
}

function assertDateOrder(reported: Date, expected: Date | null) {
  if (expected && expected < reported) {
    throw new HttpError(400, "Probable date can't be before the task's date");
  }
}

// POs being added to a task must exist and be active; ones already on it may be archived.
async function findClients(ids: string[], alreadyLinked: string[] = []) {
  const unique = [...new Set(ids)];
  const clients = await prisma.client.findMany({ where: { id: { in: unique } }, orderBy: { name: "asc" } });
  if (clients.length !== unique.length) throw new HttpError(400, "Unknown PO");
  const archived = clients.find((client) => !client.isActive && !alreadyLinked.includes(client.id));
  if (archived) throw new HttpError(400, `PO "${archived.name}" is archived`);
  return clients;
}

const poNames = (clients: Array<{ name: string }>) => clients.map((client) => client.name).sort().join(", ");
async function findType(id: string) {
  const type = await prisma.taskType.findUnique({ where: { id } });
  if (!type) throw new HttpError(400, "Unknown task type");
  return type;
}
async function findPriority(id: string) {
  const priority = await prisma.priority.findUnique({ where: { id } });
  if (!priority) throw new HttpError(400, "Unknown priority");
  return priority;
}

// Assignees being added must be active users whose role can take tasks; ones already on the task may
// stay. Without "assign to anyone", the only person someone may add or remove is themselves.
async function findAssignees(actor: Actor, assignRule: "anyone" | "self" | "none", ids: string[], alreadyLinked: string[] = []) {
  const unique = [...new Set(ids)];
  const changed = [...unique.filter((id) => !alreadyLinked.includes(id)), ...alreadyLinked.filter((id) => !unique.includes(id))];
  if (changed.length > 0 && assignRule === "none") throw new HttpError(403, "You can't change who this task is assigned to");
  if (assignRule === "self" && changed.some((id) => id !== actor.id)) throw new HttpError(403, "You can only add or remove yourself as assignee");
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, include: { role: true }, orderBy: { name: "asc" } });
  if (users.length !== unique.length) throw new HttpError(400, "Unknown assignee");
  for (const user of users) {
    if (alreadyLinked.includes(user.id)) continue;
    if (!user.isActive) throw new HttpError(400, `${user.name} is inactive`);
    if (!user.role.isAssignable) throw new HttpError(400, `${user.name}'s role can't be assigned tasks`);
  }
  return users;
}

// Testers being added must be active users whose role can test; ones already on the task may stay.
async function findTesters(ids: string[], alreadyLinked: string[] = []) {
  const unique = [...new Set(ids)];
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, include: { role: true }, orderBy: { name: "asc" } });
  if (users.length !== unique.length) throw new HttpError(400, "Unknown tester");
  for (const user of users) {
    if (alreadyLinked.includes(user.id)) continue;
    if (!user.isActive) throw new HttpError(400, `${user.name} is inactive`);
    if (!user.role.canTest) throw new HttpError(400, `${user.name}'s role can't test tasks`);
  }
  return users;
}

const names = (people: Array<{ name: string }>) => people.map((person) => person.name).sort().join(", ") || null;
// Names can repeat, so assignee history also keeps the ids (in the same order as the names).
const refs = (people: Array<{ id: string; name: string }>) =>
  [...people].sort((a, b) => a.name.localeCompare(b.name)).map((person) => person.id).join(",") || null;
const sameIds = (a: Array<{ id: string }>, b: Array<{ id: string }>) =>
  a.length === b.length && a.every((person) => b.some((other) => other.id === person.id));

// People newly assigned hear about it, except whoever assigned themselves.
function assignmentNotices(actor: Actor, assigneeIds: string[], task: { id: string; number: number; title: string }) {
  return assigneeIds
    .filter((id) => id !== actor.id)
    .map((userId) => ({
      userId,
      actorId: actor.id,
      taskId: task.id,
      message: `${actor.name} assigned you #${task.number} “${task.title}”`,
    }));
}

// People newly added to "Tested by" hear about it, except whoever added themselves.
function testerNotices(actor: Actor, testerIds: string[], task: { id: string; number: number; title: string }) {
  return testerIds
    .filter((id) => id !== actor.id)
    .map((userId) => ({
      userId,
      actorId: actor.id,
      taskId: task.id,
      message: `${actor.name} asked you to test #${task.number} “${task.title}”`,
    }));
}

tasksRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const tasks = await prisma.task.findMany({ where: visibleTasksWhere(actor), include: taskInclude, orderBy: { number: "desc" } });
    response.json({ success: true, data: tasks.map((task) => serializeTask(task, actor)) });
  }),
);

tasksRouter.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const task = await findVisibleTask(actor, request.params.id);
    const [comments, history, attachments] = await Promise.all([
      prisma.comment.findMany({
        where: { taskId: task.id },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      }),
      prisma.taskHistory.findMany({
        where: { taskId: task.id },
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, name: true } } },
      }),
      prisma.attachment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" }, select: attachmentSelect }),
    ]);
    response.json({ success: true, data: { ...serializeTask(task, actor), comments, history, attachments } });
  }),
);

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10_000).optional(),
  clientIds: z.array(z.string().min(1)).min(1, "Pick at least one PO"),
  typeId: z.string().min(1).nullish(),
  priorityId: z.string().min(1).nullish(),
  assigneeIds: z.array(z.string().min(1)).max(20).optional(),
  testerIds: z.array(z.string().min(1)).max(20).optional(),
  // Defaults to the initial status; anything else must be one step away from it.
  statusId: z.string().min(1).optional(),
  reportedDate: dateOnly.optional(),
  expectedDeliveryDate: dateOnly.nullish(),
  comment: z.string().trim().max(5_000).optional(),
  tags: tagInputSchema.optional(),
});

tasksRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const actor = requirePermission(request, PERMISSIONS.taskCreate);
    const input = createTaskSchema.parse(request.body);
    // The creator of a new task has the same rights as on any task they created.
    const access = taskAccess(actor, { reporterId: actor.id, assignees: [] });

    const clients = await findClients(input.clientIds);
    const type = input.typeId ? await findType(input.typeId) : null;
    // Without "set priority" the priority stays blank for a BA/Admin to fill in.
    const priority = access.setPriority && input.priorityId ? await findPriority(input.priorityId) : null;
    const assignees = input.assigneeIds?.length ? await findAssignees(actor, access.assign, input.assigneeIds) : [];
    const testers = input.testerIds?.length ? await findTesters(input.testerIds) : [];
    const tags = input.tags?.length ? await resolveTags(input.tags) : [];
    if (input.comment && !access.comment) throw new HttpError(403, "Your role can't comment");

    const initialStatus = await prisma.status.findFirst({ where: { isInitial: true }, orderBy: { sortOrder: "asc" } });
    if (!initialStatus) throw new HttpError(500, "No initial status is configured");
    let status = initialStatus;
    if (input.statusId && input.statusId !== initialStatus.id) {
      if (!access.setStatus) throw new HttpError(403, "Your role can't set status");
      const transition = await prisma.statusTransition.findUnique({
        where: { fromStatusId_toStatusId: { fromStatusId: initialStatus.id, toStatusId: input.statusId } },
        include: { toStatus: true },
      });
      if (!transition) throw new HttpError(400, `A new task can't start as that status`);
      status = transition.toStatus;
    }
    // Testing sign-off: with real testers, a task can't start out completed, and a developer who assigns
    // it to themselves and picks testers hands it straight to testing.
    if (testers.some(isRealTester)) {
      if (status.isClosed && !can(actor, PERMISSIONS.taskOverrideTesting)) {
        throw new HttpError(400, "A task with testers can only be completed after every tester has passed it");
      }
      if (!status.isClosed && assignees.some((assignee) => assignee.id === actor.id)) {
        status = (await findStatusByName(TESTING_STATUS)) ?? status;
      }
    }

    const reportedDate = input.reportedDate ? parseDateOnly(input.reportedDate) : today();
    // Daily (routine) tasks have no probable date.
    const expectedDeliveryDate = input.expectedDeliveryDate && !type?.isRoutine ? parseDateOnly(input.expectedDeliveryDate) : null;
    assertDateOrder(reportedDate, expectedDeliveryDate);

    const task = await prisma.$transaction(async (transaction) => {
      const tagLinks = await saveNewTags(transaction, tags);
      const created = await transaction.task.create({
        data: {
          tags: { create: tagLinks },
          title: input.title,
          description: input.description || null,
          clients: { connect: clients.map((client) => ({ id: client.id })) },
          typeId: type?.id ?? null,
          priorityId: priority?.id ?? null,
          assignees: { connect: assignees.map((assignee) => ({ id: assignee.id })) },
          testers: { connect: testers.map((tester) => ({ id: tester.id })) },
          statusId: status.id,
          reporterId: actor.id,
          reportedDate,
          expectedDeliveryDate,
          deliveredDate: status.isClosed ? today() : null,
        },
      });
      await transaction.taskHistory.create({
        data: { taskId: created.id, actorId: actor.id, field: "Created", newValue: created.title },
      });
      if (input.comment) {
        await transaction.comment.create({ data: { taskId: created.id, authorId: actor.id, body: input.comment } });
      }
      await transaction.notification.createMany({ data: assignmentNotices(actor, assignees.map((assignee) => assignee.id), created) });
      await transaction.notification.createMany({ data: testerNotices(actor, testers.map((tester) => tester.id), created) });
      return transaction.task.findUniqueOrThrow({ where: { id: created.id }, include: taskInclude });
    });

    response.status(201).json({ success: true, data: serializeTask(task, actor) });
  }),
);

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(10_000).nullable(),
    clientIds: z.array(z.string().min(1)).min(1, "A task needs at least one PO"),
    typeId: z.string().min(1).nullable(),
    priorityId: z.string().min(1).nullable(),
    statusId: z.string().min(1),
    assigneeIds: z.array(z.string().min(1)).max(20),
    testerIds: z.array(z.string().min(1)).max(20),
    reportedDate: dateOnly,
    expectedDeliveryDate: dateOnly.nullable(),
    deliveredDate: dateOnly.nullable(),
    // The reason for moving the probable date; saved as a comment on the task.
    comment: z.string().trim().max(5_000),
    tags: tagInputSchema,
  })
  .partial()
  .strict();

type Change = { field: string; oldValue: string | null; newValue: string | null; oldRef?: string | null; newRef?: string | null };

// "12 Oct 2026", as the web app shows dates.
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const readableDate = (value: Date | null) => (value ? dateFormat.format(value) : "not set");

const EDIT_FIELDS = ["title", "description", "clientIds", "typeId", "reportedDate", "expectedDeliveryDate", "deliveredDate", "tags"] as const;

tasksRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const input = updateTaskSchema.parse(request.body);
    const task = await findVisibleTask(actor, request.params.id);
    const access = taskAccess(actor, task);
    const testing = testingState(actor, task);

    if (!access.edit && EDIT_FIELDS.some((field) => input[field] !== undefined)) {
      throw new HttpError(403, "You can only change tasks assigned to you (or unassigned ones you created)");
    }
    if (input.priorityId !== undefined && input.priorityId !== task.priorityId && !access.setPriority) {
      throw new HttpError(403, access.edit ? "Your role can't change priority" : "You can only change the priority of your own tasks");
    }
    if (input.statusId !== undefined && input.statusId !== task.statusId && !access.setStatus) {
      throw new HttpError(403, "You can't change this task's status");
    }

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changes: Change[] = [];
    const record = (field: string, oldValue: string | null, newValue: string | null) => {
      if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
    };

    if (input.title !== undefined && input.title !== task.title) {
      data.title = input.title;
      record("Title", task.title, input.title);
    }
    if (input.description !== undefined && (input.description || null) !== task.description) {
      data.description = input.description || null;
      record("Description", task.description, input.description || null);
    }
    if (input.clientIds !== undefined) {
      const clients = await findClients(input.clientIds, task.clients.map((client) => client.id));
      if (poNames(clients) !== poNames(task.clients)) {
        data.clients = { set: clients.map((client) => ({ id: client.id })) };
        record("PO", poNames(task.clients), poNames(clients));
      }
    }
    // Tags are replaced as a whole; new names become new tags when the change is saved.
    let nextTags: ResolvedTag[] | null = null;
    if (input.tags !== undefined) {
      const resolved = await resolveTags(input.tags, task.tags.map(({ tag }) => tag.id));
      const before = tagsText(task.tags.map(({ tag, details }) => ({ name: tag.name, details })));
      const after = tagsText(resolved);
      if (before !== after) {
        nextTags = resolved;
        record("Tags", before, after);
      }
    }
    let isRoutine = task.type?.isRoutine ?? false;
    if (input.typeId !== undefined && input.typeId !== task.typeId) {
      const type = input.typeId ? await findType(input.typeId) : null;
      data.typeId = type?.id ?? null;
      record("Type", task.type?.name ?? null, type?.name ?? null);
      isRoutine = type?.isRoutine ?? false;
    }
    const becameRoutine = isRoutine && !task.type?.isRoutine;
    if (input.priorityId !== undefined && input.priorityId !== task.priorityId) {
      const priority = input.priorityId ? await findPriority(input.priorityId) : null;
      data.priorityId = priority?.id ?? null;
      record("Priority", task.priority?.name ?? null, priority?.name ?? null);
    }
    let nextAssignees: Array<{ id: string }> = task.assignees;
    if (input.assigneeIds !== undefined) {
      const assignees = await findAssignees(actor, access.assign, input.assigneeIds, task.assignees.map((assignee) => assignee.id));
      nextAssignees = assignees;
      if (!sameIds(assignees, task.assignees)) {
        data.assignees = { set: assignees.map((assignee) => ({ id: assignee.id })) };
        changes.push({ field: "Assignee", oldValue: names(task.assignees), newValue: names(assignees), oldRef: refs(task.assignees), newRef: refs(assignees) });
      }
    }
    let nextTesters: Array<{ id: string; name: string; isPlaceholder: boolean }> = task.testers;
    let removedTesterIds: string[] = [];
    if (input.testerIds !== undefined) {
      const testers = await findTesters(input.testerIds, task.testers.map((tester) => tester.id));
      if (!sameIds(testers, task.testers)) {
        const added = testers.filter((tester) => !task.testers.some((before) => before.id === tester.id));
        const removed = task.testers.filter((before) => !testers.some((tester) => tester.id === before.id));
        // Testers may take themselves off a task they can't otherwise edit.
        const leavingOnly = added.length === 0 && removed.length === 1 && removed[0].id === actor.id;
        if (!access.setTester && !leavingOnly) throw new HttpError(403, "You can only choose testers on your own tasks");
        // Taking someone else off testing would skip their sign-off.
        const removedOthers = removed.filter((tester) => isRealTester(tester) && tester.id !== actor.id);
        if (removedOthers.length > 0 && !testing.override) {
          throw new HttpError(403, `Only an admin can take ${names(removedOthers)} off testing (testers can take themselves off)`);
        }
        data.testers = { set: testers.map((tester) => ({ id: tester.id })) };
        record("Tested by", names(task.testers), names(testers));
        nextTesters = testers;
        removedTesterIds = removed.map((tester) => tester.id);
      }
    }

    // Workflow: only configured transitions are allowed; entering a closed status stamps the
    // delivered date, leaving one clears it (unless the request sets it explicitly).
    let deliveredDate = task.deliveredDate;
    let nextStatus: { id: string; name: string; isClosed: boolean } = task.status;
    if (input.statusId !== undefined && input.statusId !== task.statusId) {
      // Testing sign-off: while testers are working on it, the status waits for them.
      if (testing.lock === "waiting") {
        throw new HttpError(403, `Waiting for ${names(testing.pending)} to finish testing. A tester can pass it or send it back.`);
      }
      const transition = await prisma.statusTransition.findUnique({
        where: { fromStatusId_toStatusId: { fromStatusId: task.statusId, toStatusId: input.statusId } },
        include: { toStatus: true },
      });
      if (!transition) {
        const target = await prisma.status.findUnique({ where: { id: input.statusId } });
        throw new HttpError(400, `A task can't move from "${task.status.name}" to "${target?.name ?? "that status"}"`);
      }
      if (testing.lock === "passed" && !transition.toStatus.isClosed) {
        throw new HttpError(403, "Every tester has passed this task, so it can only be marked Completed now");
      }
      nextStatus = transition.toStatus;
    }
    // A task with testers is completed only once every one of them has passed it (testers added in
    // this same change haven't).
    if (nextStatus.isClosed && nextStatus.id !== task.statusId && !testing.override) {
      const missing = nextTesters.filter((tester) => isRealTester(tester) && verdictOf(task, tester.id) !== "passed");
      if (missing.length > 0) {
        throw new HttpError(403, `${names(missing)} must pass testing before this task can be completed`);
      }
    }
    // A developer handing their task to (new) testers sends it to testing.
    const addedRealTester = nextTesters.some((tester) => isRealTester(tester) && !task.testers.some((before) => before.id === tester.id));
    if (addedRealTester && nextAssignees.some((assignee) => assignee.id === actor.id) && !nextStatus.isClosed && nextStatus.name !== TESTING_STATUS) {
      nextStatus = (await findStatusByName(TESTING_STATUS)) ?? nextStatus;
    }
    // Someone left testing and everyone still on it has answered, with at least one send-back: the round is
    // over, so it goes back to the developer as it would after the last verdict.
    if (nextStatus.id === task.statusId && testing.inTesting && removedTesterIds.length > 0 && !addedRealTester) {
      const remaining = nextTesters.filter(isRealTester);
      if (remaining.length > 0 && remaining.every((tester) => verdictOf(task, tester.id) !== null) && remaining.some((tester) => verdictOf(task, tester.id) === "sent_back")) {
        nextStatus = (await findStatusByName(IN_PROGRESS_STATUS)) ?? nextStatus;
      }
    }
    if (nextStatus.id !== task.statusId) {
      data.statusId = nextStatus.id;
      record("Status", task.status.name, nextStatus.name);
      if (nextStatus.isClosed && !task.status.isClosed) deliveredDate = today();
      if (!nextStatus.isClosed && task.status.isClosed) deliveredDate = null;
    }
    if (input.deliveredDate !== undefined) {
      deliveredDate = input.deliveredDate ? parseDateOnly(input.deliveredDate) : null;
    }
    if (formatDateOnly(deliveredDate) !== formatDateOnly(task.deliveredDate)) {
      data.deliveredDate = deliveredDate;
      record("Completed date", formatDateOnly(task.deliveredDate), formatDateOnly(deliveredDate));
    }

    const reportedDate = input.reportedDate ? parseDateOnly(input.reportedDate) : task.reportedDate;
    if (formatDateOnly(reportedDate) !== formatDateOnly(task.reportedDate)) {
      data.reportedDate = reportedDate;
      record("Date", formatDateOnly(task.reportedDate), formatDateOnly(reportedDate));
    }
    if (isRoutine && input.expectedDeliveryDate) throw new HttpError(400, "Daily tasks don't have a probable date");
    // Daily (routine) tasks have none, so making a task daily clears its probable date.
    const expectedDeliveryDate = isRoutine
      ? null
      : input.expectedDeliveryDate === undefined
        ? task.expectedDeliveryDate
        : input.expectedDeliveryDate
          ? parseDateOnly(input.expectedDeliveryDate)
          : null;
    // Moving (or clearing) a probable date that was already set needs a reason; the first one doesn't,
    // and neither does clearing it because the task became daily.
    let reason: string | null = null;
    if (formatDateOnly(expectedDeliveryDate) !== formatDateOnly(task.expectedDeliveryDate)) {
      const from = formatDateOnly(task.expectedDeliveryDate);
      const to = formatDateOnly(expectedDeliveryDate);
      if (from && !becameRoutine) {
        if (!input.comment) throw new HttpError(400, "Add a comment explaining why the probable date is changing");
        reason = `Probable date changed from ${readableDate(task.expectedDeliveryDate)} to ${readableDate(expectedDeliveryDate)}: ${input.comment}`;
      }
      data.expectedDeliveryDate = expectedDeliveryDate;
      record("Probable date", from, to);
    }
    assertDateOrder(reportedDate, expectedDeliveryDate);

    if (changes.length === 0) {
      response.json({ success: true, data: serializeTask(task, actor) });
      return;
    }

    // Verdicts belong to one testing round: they go when the status moves on (except Testing -> Completed),
    // and with the tester when someone leaves testing.
    const clearVerdicts = nextStatus.id !== task.statusId && !(task.status.name === TESTING_STATUS && nextStatus.isClosed);

    const updated = await prisma.$transaction(async (transaction) => {
      if (clearVerdicts) await transaction.testVerdict.deleteMany({ where: { taskId: task.id } });
      else if (removedTesterIds.length > 0) await transaction.testVerdict.deleteMany({ where: { taskId: task.id, testerId: { in: removedTesterIds } } });
      if (nextTags) {
        const tagLinks = await saveNewTags(transaction, nextTags);
        await transaction.taskTag.deleteMany({ where: { taskId: task.id } });
        await transaction.taskTag.createMany({ data: tagLinks.map((link) => ({ ...link, taskId: task.id })) });
      }
      const saved = await transaction.task.update({ where: { id: task.id }, data, include: taskInclude });
      await transaction.taskHistory.createMany({
        data: changes.map((change) => ({ ...change, taskId: task.id, actorId: actor.id })),
      });
      if (reason) await transaction.comment.create({ data: { taskId: task.id, authorId: actor.id, body: reason } });
      const addedAssignees = saved.assignees.filter((assignee) => !task.assignees.some((before) => before.id === assignee.id));
      await transaction.notification.createMany({ data: assignmentNotices(actor, addedAssignees.map((assignee) => assignee.id), saved) });
      const addedTesters = saved.testers.filter((tester) => !task.testers.some((before) => before.id === tester.id));
      await transaction.notification.createMany({ data: testerNotices(actor, addedTesters.map((tester) => tester.id), saved) });
      return saved;
    });

    response.json({ success: true, data: serializeTask(updated, actor) });
  }),
);

const verdictSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("pass") }),
  z.object({ result: z.literal("send_back"), reason: z.string().trim().min(1, "Say what still needs fixing").max(5_000) }),
]);

const shorten = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// A tester's own verdict on a task in Testing: pass it, or send it back with a reason. Testers answer
// independently and may change their verdict while the round is open; the developer hears about each one.
// When the last tester answers, the round ends: any send-back returns the task to In Progress, and if
// everyone passed the developer may mark it Completed.
tasksRouter.post(
  "/:id/testing",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const input = verdictSchema.parse(request.body);
    const task = await findVisibleTask(actor, request.params.id);
    const state = testingState(actor, task);
    if (!state.inTesting) throw new HttpError(400, "This task isn't in Testing");
    if (!state.canVerdict) throw new HttpError(403, "Only this task's testers can pass it or send it back");

    const passed = input.result === "pass";
    const reason = input.result === "send_back" ? input.reason : null;
    const previous = verdictOf(task, actor.id);
    // Passing twice changes nothing.
    if (passed && previous === "passed") {
      response.json({ success: true, data: serializeTask(task, actor) });
      return;
    }

    // The round as it stands with this verdict.
    const verdicts = [...task.testVerdicts.filter((item) => item.testerId !== actor.id), { testerId: actor.id, passed }];
    const after = (id: string) => verdictOf({ testVerdicts: verdicts }, id);
    const waitingFor = state.realTesters.filter((tester) => after(tester.id) === null);
    const sentBackBy = state.realTesters.filter((tester) => after(tester.id) === "sent_back");
    const roundOver = waitingFor.length === 0;
    const backToDeveloper = roundOver && sentBackBy.length > 0;
    const inProgress = backToDeveloper ? await findStatusByName(IN_PROGRESS_STATUS) : null;
    if (backToDeveloper && !inProgress) throw new HttpError(500, `No "${IN_PROGRESS_STATUS}" status is configured`);

    const label = `#${task.number} “${task.title}”`;
    const answered = `${state.realTesters.length - waitingFor.length} of ${state.realTesters.length} testers answered`;
    let message: string;
    if (backToDeveloper) {
      message = passed
        ? `Testing finished on ${label}: sent back by ${names(sentBackBy)}. It's back In Progress.`
        : `${actor.name} sent ${label} back from testing: ${shorten(reason!)}. Testing finished; it's back In Progress.`;
    } else if (roundOver) {
      message = `${state.realTesters.length > 1 ? "All testers" : actor.name} passed ${label}. You can mark it Completed.`;
    } else {
      message = passed
        ? `${actor.name} passed testing on ${label} (${answered})`
        : `${actor.name} sent ${label} back from testing: ${shorten(reason!)} (${answered})`;
    }

    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.testVerdict.upsert({
        where: { taskId_testerId: { taskId: task.id, testerId: actor.id } },
        create: { taskId: task.id, testerId: actor.id, passed, reason },
        update: { passed, reason },
      });
      const history: Prisma.TaskHistoryCreateManyInput[] = [
        { taskId: task.id, actorId: actor.id, field: "Testing", newValue: passed ? "Passed" : "Sent back" },
      ];
      if (reason) await transaction.comment.create({ data: { taskId: task.id, authorId: actor.id, body: `Sent back from testing: ${reason}` } });
      if (backToDeveloper) {
        // The round is over; the next one starts when the developer moves it to Testing again.
        await transaction.testVerdict.deleteMany({ where: { taskId: task.id } });
        await transaction.task.update({ where: { id: task.id }, data: { statusId: inProgress!.id } });
        history.push({ taskId: task.id, actorId: actor.id, field: "Status", oldValue: task.status.name, newValue: inProgress!.name });
      }
      await transaction.taskHistory.createMany({ data: history });
      await transaction.notification.createMany({
        data: task.assignees
          .filter((assignee) => assignee.id !== actor.id)
          .map((assignee) => ({ userId: assignee.id, actorId: actor.id, taskId: task.id, message })),
      });
      return transaction.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
    });
    response.json({ success: true, data: serializeTask(updated, actor) });
  }),
);

tasksRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const task = await findVisibleTask(actor, request.params.id);
    if (!taskAccess(actor, task).delete) throw new HttpError(403, "Only the task's creator (while it isn't assigned to someone else) or someone who can edit all tasks can delete it");
    await prisma.task.delete({ where: { id: task.id } });
    response.status(204).end();
  }),
);

const createCommentSchema = z.object({ body: z.string().trim().min(1).max(5_000) });

tasksRouter.post(
  "/:id/comments",
  asyncHandler(async (request, response) => {
    const actor = requirePermission(request, PERMISSIONS.commentCreate);
    const { body } = createCommentSchema.parse(request.body);
    const task = await findVisibleTask(actor, request.params.id);

    const comment = await prisma.comment.create({
      data: { taskId: task.id, authorId: actor.id, body },
      include: { author: { select: { id: true, name: true } } },
    });
    response.status(201).json({ success: true, data: comment });
  }),
);
