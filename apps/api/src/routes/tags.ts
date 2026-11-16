// The tag list, kept by people with "Manage tags". Anyone editing a task can also add a new plain tag to it
// by name (see lib/tags.ts).
import { Router } from "express";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { PO_COLORS } from "../lib/poColors.js";
import { prisma } from "../lib/prisma.js";
import { cleanTagName, tagSelect } from "../lib/tags.js";
import { visibleTasksWhere } from "../lib/taskAccess.js";
import { getActor, requirePermission } from "../middleware/auth.js";

export const tagsRouter = Router();

const managedTagSelect = { ...tagSelect, createdAt: true, _count: { select: { tasks: true } } } as const;

async function assertNameFree(name: string, exceptId?: string) {
  const existing = await prisma.tag.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: exceptId ? { not: exceptId } : undefined },
  });
  if (existing) throw new HttpError(409, `The tag “${existing.name}” already exists`);
}

const blankToNull = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);

const tagSettingsSchema = z
  .object({
    name: z.string().trim().min(1, "A tag needs a name").max(60, "Tag names can be up to 60 characters"),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, "Expected a colour like #7c3aed"),
    isActive: z.boolean(),
    // What the details are called ("Tables"); empty = a plain tag.
    detailLabel: z.string().max(40, "Keep the details label under 40 characters").nullable(),
    detailHint: z.string().max(120, "Keep the example under 120 characters").nullable(),
    // File endings such as "fmb" or ".fmx".
    detailExtensions: z
      .array(z.string().trim().transform((value) => value.replace(/^\.+/, "").toLowerCase()).pipe(z.string().regex(/^[a-z0-9]{1,10}$/, "File endings are letters or digits, like fmb")))
      .max(20),
    detailUppercase: z.boolean(),
  })
  .partial()
  .strict();

// Everyone's suggestions for details already used with each tag, so the same table or file is spelled the
// same way everywhere: { tagId: ["CR_INFO", "LOAN_INFO"] }. Only tasks the person can see count.
tagsRouter.get(
  "/details",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const links = await prisma.taskTag.findMany({ where: { task: visibleTasksWhere(actor) }, select: { tagId: true, details: true } });
    const byTag: Record<string, string[]> = {};
    for (const link of links) {
      const list = (byTag[link.tagId] ??= []);
      for (const detail of link.details) if (!list.includes(detail)) list.push(detail);
    }
    for (const list of Object.values(byTag)) list.sort((a, b) => a.localeCompare(b));
    response.json({ success: true, data: byTag });
  }),
);

tagsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    requirePermission(request, PERMISSIONS.tagManage);
    const tags = await prisma.tag.findMany({ orderBy: { name: "asc" }, select: managedTagSelect });
    response.json({ success: true, data: tags });
  }),
);

tagsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    requirePermission(request, PERMISSIONS.tagManage);
    const input = tagSettingsSchema.parse(request.body);
    const name = cleanTagName(input.name ?? "");
    if (!name) throw new HttpError(400, "A tag needs a name");
    await assertNameFree(name);
    const color = input.color ?? PO_COLORS[(await prisma.tag.count()) % PO_COLORS.length];
    const tag = await prisma.tag.create({
      data: { ...input, name, color, detailLabel: blankToNull(input.detailLabel), detailHint: blankToNull(input.detailHint) },
      select: managedTagSelect,
    });
    response.status(201).json({ success: true, data: tag });
  }),
);

tagsRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    requirePermission(request, PERMISSIONS.tagManage);
    const input = tagSettingsSchema.parse(request.body);
    const name = input.name === undefined ? undefined : cleanTagName(input.name);
    if (name) await assertNameFree(name, request.params.id);
    const updated = await prisma.tag.updateMany({
      where: { id: request.params.id },
      data: { ...input, name, detailLabel: blankToNull(input.detailLabel), detailHint: blankToNull(input.detailHint) },
    });
    if (updated.count === 0) throw new HttpError(404, "Tag not found");
    const tag = await prisma.tag.findUniqueOrThrow({ where: { id: request.params.id }, select: managedTagSelect });
    response.json({ success: true, data: tag });
  }),
);
