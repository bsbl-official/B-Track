import { Router } from "express";
import { asyncHandler } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { getActor } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { actor: { select: { id: true, name: true } } },
      }),
      prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
    ]);
    response.json({ success: true, data: { items, unreadCount } });
  }),
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (request, response) => {
    await prisma.notification.updateMany({ where: { userId: getActor(request).id, readAt: null }, data: { readAt: new Date() } });
    response.status(204).end();
  }),
);

notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (request, response) => {
    await prisma.notification.updateMany({
      where: { id: request.params.id, userId: getActor(request).id, readAt: null },
      data: { readAt: new Date() },
    });
    response.status(204).end();
  }),
);
