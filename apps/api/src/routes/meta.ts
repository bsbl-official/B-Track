import { Router } from "express";
import { asyncHandler } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";

// Everything the web app needs to fill dropdowns and apply workflow rules.
export const metaRouter = Router();

metaRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    const [users, clients, types, priorities, statuses] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: { select: { name: true, isAssignable: true, canTest: true } } },
      }),
      prisma.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
      prisma.taskType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.priority.findMany({ orderBy: { rank: "asc" } }),
      prisma.status.findMany({ orderBy: { sortOrder: "asc" }, include: { transitionsFrom: { select: { toStatusId: true } } } }),
    ]);

    response.json({
      success: true,
      data: {
        users: users.map(({ role, ...user }) => ({ ...user, roleName: role.name, isAssignable: role.isAssignable, canTest: role.canTest })),
        clients,
        types,
        priorities,
        statuses: statuses.map(({ transitionsFrom, ...status }) => ({
          ...status,
          nextStatusIds: transitionsFrom.map((transition) => transition.toStatusId),
        })),
      },
    });
  }),
);
