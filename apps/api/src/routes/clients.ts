// Clients are Partner Organisations, called "POs" in the web app.
import { Router } from "express";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { PO_COLORS } from "../lib/poColors.js";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../middleware/auth.js";

export const clientsRouter = Router();

const clientSelect = { id: true, name: true, color: true, isActive: true, createdAt: true, _count: { select: { tasks: true } } } as const;

async function assertNameFree(name: string, exceptId?: string) {
  const existing = await prisma.client.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: exceptId ? { not: exceptId } : undefined },
  });
  if (existing) throw new HttpError(409, `PO "${existing.name}" already exists`);
}

clientsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    requirePermission(request, PERMISSIONS.poManage);
    const clients = await prisma.client.findMany({ orderBy: { name: "asc" }, select: clientSelect });
    response.json({ success: true, data: clients });
  }),
);

clientsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    requirePermission(request, PERMISSIONS.poManage);
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);
    await assertNameFree(name);
    const color = PO_COLORS[(await prisma.client.count()) % PO_COLORS.length];
    const client = await prisma.client.create({ data: { name, color }, select: clientSelect });
    response.status(201).json({ success: true, data: client });
  }),
);

clientsRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    requirePermission(request, PERMISSIONS.poManage);
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        color: z.string().regex(/^#[0-9a-f]{6}$/i, "Expected a colour like #7c3aed"),
        isActive: z.boolean(),
      })
      .partial()
      .strict()
      .parse(request.body);
    if (input.name) await assertNameFree(input.name, request.params.id);

    const updated = await prisma.client.updateMany({ where: { id: request.params.id }, data: input });
    if (updated.count === 0) throw new HttpError(404, "PO not found");
    const client = await prisma.client.findUniqueOrThrow({ where: { id: request.params.id }, select: clientSelect });
    response.json({ success: true, data: client });
  }),
);
