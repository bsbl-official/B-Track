import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { dateOnly, formatDateOnly, gapDays, parseDateOnly, today } from "../lib/dates.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { taskAccess, visibleTasksWhere } from "../lib/taskAccess.js";
import { getActor, requirePermission, type Actor } from "../middleware/auth.js";
import { attachmentSelect, attachmentsRouter } from "./attachments.js";

export const tasksRouter = Router();
tasksRouter.use("/:taskId/attachments", attachmentsRouter);

export const taskInclude = {
  clients: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
  type: { select: { id: true, name: true, color: true } },
  priority: { select: { id: true, name: true, color: true, rank: true } },
  status: { select: { id: true, name: true, color: true, isClosed: true } },
  reporter: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  testers: { select: { id: true, name: true }, orderBy: { name: "asc" } },
  // The newest comment fills the sheet's Comments column.
  comments: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { body: true, createdAt: true, author: { select: { name: true } } },
  },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function serializeTask({ _count, comments, ...task }: TaskRow, actor: Actor) {
  return {
    ...task,
    reportedDate: formatDateOnly(task.reportedDate),
    expectedDeliveryDate: formatDateOnly(task.expectedDeliveryDate),
    deliveredDate: formatDateOnly(task.deliveredDate),
    gapDays: gapDays(task.expectedDeliveryDate, task.status.isClosed),
    commentCount: _count.comments,
    attachmentCount: _count.attachments,
    latestComment: comments[0] ? { body: comments[0].body, author: comments[0].author.name, createdAt: comments[0].createdAt } : null,
    access: taskAccess(actor, task),
  };
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

// Assignees must be active users whose role can take tasks. Without "assign to anyone",
// the only allowed assignee is the actor.
async function findAssignee(actor: Actor, assignRule: "anyone" | "self" | "none", id: string) {
  if (assignRule === "none") throw new HttpError(403, "You can't change who this task is assigned to");
  if (assignRule === "self" && id !== actor.id) throw new HttpError(403, "You can only assign tasks to yourself");
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user || !user.isActive) throw new HttpError(400, "Unknown or inactive assignee");
  if (!user.role.isAssignable) throw new HttpError(400, `${user.name}'s role can't be assigned tasks`);
  return user;
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

function assignmentNotice(actor: Actor, assigneeId: string | null, task: { id: string; number: number; title: string }) {
  if (!assigneeId || assigneeId === actor.id) return null;
  return {
    userId: assigneeId,
    actorId: actor.id,
    taskId: task.id,
    message: `${actor.name} assigned you #${task.number} “${task.title}”`,
  };
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
  assigneeId: z.string().min(1).nullish(),
  testerIds: z.array(z.string().min(1)).max(20).optional(),
  // Defaults to the initial status; anything else must be one step away from it.
  statusId: z.string().min(1).optional(),
  reportedDate: dateOnly.optional(),
  expectedDeliveryDate: dateOnly.nullish(),
  comment: z.string().trim().max(5_000).optional(),
});

tasksRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const actor = requirePermission(request, PERMISSIONS.taskCreate);
    const input = createTaskSchema.parse(request.body);
    // The creator of a new task has the same rights as on any task they created.
    const access = taskAccess(actor, { reporterId: actor.id, assigneeId: null });

    const clients = await findClients(input.clientIds);
    const type = input.typeId ? await findType(input.typeId) : null;
    // Without "set priority" the priority stays blank for a BA/Admin to fill in.
    const priority = access.setPriority && input.priorityId ? await findPriority(input.priorityId) : null;
    const assignee = input.assigneeId ? await findAssignee(actor, access.assign, input.assigneeId) : null;
    const testers = input.testerIds?.length ? await findTesters(input.testerIds) : [];
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

    const reportedDate = input.reportedDate ? parseDateOnly(input.reportedDate) : today();
    const expectedDeliveryDate = input.expectedDeliveryDate ? parseDateOnly(input.expectedDeliveryDate) : null;
    assertDateOrder(reportedDate, expectedDeliveryDate);

    const task = await prisma.$transaction(async (transaction) => {
      const created = await transaction.task.create({
        data: {
          title: input.title,
          description: input.description || null,
          clients: { connect: clients.map((client) => ({ id: client.id })) },
          typeId: type?.id ?? null,
          priorityId: priority?.id ?? null,
          assigneeId: assignee?.id ?? null,
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
      const notice = assignmentNotice(actor, created.assigneeId, created);
      if (notice) await transaction.notification.create({ data: notice });
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
    assigneeId: z.string().min(1).nullable(),
    testerIds: z.array(z.string().min(1)).max(20),
    reportedDate: dateOnly,
    expectedDeliveryDate: dateOnly.nullable(),
    deliveredDate: dateOnly.nullable(),
  })
  .partial()
  .strict();

type Change = { field: string; oldValue: string | null; newValue: string | null };

const EDIT_FIELDS = ["title", "description", "clientIds", "typeId", "reportedDate", "expectedDeliveryDate", "deliveredDate"] as const;

tasksRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const input = updateTaskSchema.parse(request.body);
    const task = await findVisibleTask(actor, request.params.id);
    const access = taskAccess(actor, task);

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
    if (input.typeId !== undefined && input.typeId !== task.typeId) {
      const type = input.typeId ? await findType(input.typeId) : null;
      data.typeId = type?.id ?? null;
      record("Type", task.type?.name ?? null, type?.name ?? null);
    }
    if (input.priorityId !== undefined && input.priorityId !== task.priorityId) {
      const priority = input.priorityId ? await findPriority(input.priorityId) : null;
      data.priorityId = priority?.id ?? null;
      record("Priority", task.priority?.name ?? null, priority?.name ?? null);
    }
    if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) {
      if (access.assign === "none") throw new HttpError(403, "You can't change who this task is assigned to");
      const assignee = input.assigneeId ? await findAssignee(actor, access.assign, input.assigneeId) : null;
      data.assigneeId = assignee?.id ?? null;
      record("Assignee", task.assignee?.name ?? null, assignee?.name ?? null);
    }
    if (input.testerIds !== undefined) {
      const testers = await findTesters(input.testerIds, task.testers.map((tester) => tester.id));
      if (names(testers) !== names(task.testers)) {
        if (!access.setTester) throw new HttpError(403, "You can only choose testers on your own tasks");
        data.testers = { set: testers.map((tester) => ({ id: tester.id })) };
        record("Tested by", names(task.testers), names(testers));
      }
    }

    // Workflow: only configured transitions are allowed; entering a closed status stamps the
    // delivered date, leaving one clears it (unless the request sets it explicitly).
    let deliveredDate = task.deliveredDate;
    if (input.statusId !== undefined && input.statusId !== task.statusId) {
      const transition = await prisma.statusTransition.findUnique({
        where: { fromStatusId_toStatusId: { fromStatusId: task.statusId, toStatusId: input.statusId } },
        include: { toStatus: true },
      });
      if (!transition) {
        const target = await prisma.status.findUnique({ where: { id: input.statusId } });
        throw new HttpError(400, `A task can't move from "${task.status.name}" to "${target?.name ?? "that status"}"`);
      }
      data.statusId = transition.toStatusId;
      record("Status", task.status.name, transition.toStatus.name);
      if (transition.toStatus.isClosed && !task.status.isClosed) deliveredDate = today();
      if (!transition.toStatus.isClosed && task.status.isClosed) deliveredDate = null;
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
    const expectedDeliveryDate =
      input.expectedDeliveryDate === undefined
        ? task.expectedDeliveryDate
        : input.expectedDeliveryDate
          ? parseDateOnly(input.expectedDeliveryDate)
          : null;
    if (formatDateOnly(expectedDeliveryDate) !== formatDateOnly(task.expectedDeliveryDate)) {
      data.expectedDeliveryDate = expectedDeliveryDate;
      record("Probable date", formatDateOnly(task.expectedDeliveryDate), formatDateOnly(expectedDeliveryDate));
    }
    assertDateOrder(reportedDate, expectedDeliveryDate);

    if (changes.length === 0) {
      response.json({ success: true, data: serializeTask(task, actor) });
      return;
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.task.update({ where: { id: task.id }, data, include: taskInclude });
      await transaction.taskHistory.createMany({
        data: changes.map((change) => ({ ...change, taskId: task.id, actorId: actor.id })),
      });
      const notice = saved.assigneeId !== task.assigneeId ? assignmentNotice(actor, saved.assigneeId, saved) : null;
      if (notice) await transaction.notification.create({ data: notice });
      return saved;
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
