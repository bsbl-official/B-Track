import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { formatDateOnly, gapDays, today } from "../lib/dates.js";
import { asyncHandler } from "../lib/http.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { visibleTasksWhere } from "../lib/taskAccess.js";
import { can, getActor } from "../middleware/auth.js";

export const dashboardRouter = Router();

// Team-wide metrics need "dashboard.view_all"; everyone else gets numbers for the tasks assigned to them.
dashboardRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const teamWide = can(actor, PERMISSIONS.dashboardViewAll);
    const scope: Prisma.TaskWhereInput = teamWide ? visibleTasksWhere(actor) : { assignees: { some: { id: actor.id } } };

    const [tasks, statuses, activity] = await Promise.all([
      prisma.task.findMany({
        where: scope,
        select: {
          id: true,
          number: true,
          title: true,
          statusId: true,
          assignees: { select: { id: true } },
          expectedDeliveryDate: true,
          deliveredDate: true,
          status: { select: { name: true, color: true, isClosed: true, isInitial: true } },
          clients: { select: { name: true }, orderBy: { name: "asc" } },
          priority: { select: { name: true, color: true } },
        },
      }),
      prisma.status.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.taskHistory.findMany({
        where: { task: scope },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { actor: { select: { name: true } }, task: { select: { id: true, number: true, title: true } } },
      }),
    ]);

    // "Completed" card: tasks completed in the current calendar month (from its 1st up to today).
    const deliveredSince = today();
    deliveredSince.setUTCDate(1);

    const withGap = tasks.map((task) => ({ ...task, gapDays: gapDays(task.expectedDeliveryDate, task.status.isClosed) }));
    const open = withGap.filter((task) => !task.status.isClosed);
    const assignedOpen = open.filter((task) => task.assignees.some((assignee) => assignee.id === actor.id));

    response.json({
      success: true,
      data: {
        scope: teamWide ? "all" : "mine",
        cards: {
          assignedToMe: assignedOpen.length,
          // Of those, the ones still in the initial status (nobody has started them).
          assignedNew: assignedOpen.filter((task) => task.status.isInitial).length,
          open: open.length,
          overdue: open.filter((task) => task.gapDays !== null && task.gapDays > 0).length,
          dueToday: open.filter((task) => task.gapDays === 0).length,
          deliveredRecently: withGap.filter((task) => task.deliveredDate && task.deliveredDate >= deliveredSince).length,
          // The 1st of the current month, in the server's calendar, so the card's sheet link counts the same tasks.
          deliveredSince: formatDateOnly(deliveredSince)!,
          // All-time count, the same set as the task sheet's Completed tab.
          completedTotal: tasks.filter((task) => task.status.isClosed).length,
          total: tasks.length,
        },
        byStatus: statuses.map((status) => ({
          id: status.id,
          name: status.name,
          color: status.color,
          isClosed: status.isClosed,
          count: tasks.filter((task) => task.statusId === status.id).length,
        })),
        deadlines: open
          .filter((task) => task.expectedDeliveryDate)
          .sort((a, b) => a.expectedDeliveryDate!.getTime() - b.expectedDeliveryDate!.getTime())
          .slice(0, 6)
          .map((task) => ({
            id: task.id,
            number: task.number,
            title: task.title,
            client: task.clients.map((client) => client.name).join(", "),
            priority: task.priority,
            expectedDeliveryDate: formatDateOnly(task.expectedDeliveryDate),
            gapDays: task.gapDays,
          })),
        activity: activity.map((entry) => ({
          id: entry.id,
          field: entry.field,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          createdAt: entry.createdAt,
          actor: entry.actor.name,
          task: entry.task,
        })),
      },
    });
  }),
);
