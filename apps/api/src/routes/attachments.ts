// Evidence files on a task: upload (raw body), view/download, delete.
import express, { Router } from "express";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { taskAccess } from "../lib/taskAccess.js";
import { getActor } from "../middleware/auth.js";
import { findVisibleTask } from "./tasks.js";

export const attachmentsRouter = Router({ mergeParams: true });

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TASK = 20;

// Types people attach as evidence. HTML, SVG and scripts are refused: served from our origin
// they could run code in the viewer's session.
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
// Shown in the browser; everything else is downloaded.
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

export const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploader: { select: { id: true, name: true } },
} as const;

const cleanFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 150) || "evidence";

// Upload: the file is the request body; its name comes in ?name= and its type in Content-Type.
attachmentsRouter.post(
  "/",
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const task = await findVisibleTask(actor, request.params.taskId);
    if (!taskAccess(actor, task).edit) throw new HttpError(403, "You can only add evidence to your own tasks");

    const { name } = z.object({ name: z.string().trim().min(1).max(200) }).parse(request.query);
    const mimeType = (request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(mimeType)) throw new HttpError(415, "Attach images, PDFs, text, CSV, Word, Excel or ZIP files");
    const data = request.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, "The file is empty");

    const existing = await prisma.attachment.count({ where: { taskId: task.id } });
    if (existing >= MAX_ATTACHMENTS_PER_TASK) throw new HttpError(400, `A task can have up to ${MAX_ATTACHMENTS_PER_TASK} evidence files`);

    const fileName = cleanFileName(name);
    const attachment = await prisma.$transaction(async (transaction) => {
      const created = await transaction.attachment.create({
        data: { taskId: task.id, uploaderId: actor.id, fileName, mimeType, size: data.length, data: new Uint8Array(data) },
        select: attachmentSelect,
      });
      await transaction.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, field: "Evidence", newValue: fileName } });
      return created;
    });
    response.status(201).json({ success: true, data: attachment });
  }),
);

// View (images, PDFs) or download (everything else). Anyone who can see the task can open it.
attachmentsRouter.get(
  "/:attachmentId",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const task = await findVisibleTask(actor, request.params.taskId);
    const attachment = await prisma.attachment.findFirst({ where: { id: request.params.attachmentId, taskId: task.id } });
    if (!attachment) throw new HttpError(404, "File not found");

    const disposition = INLINE_TYPES.has(attachment.mimeType) && request.query.download === undefined ? "inline" : "attachment";
    response.setHeader("Content-Type", attachment.mimeType);
    response.setHeader("Content-Length", attachment.size);
    response.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.end(Buffer.from(attachment.data));
  }),
);

// Remove: the person who uploaded it, or anyone who can edit the task.
attachmentsRouter.delete(
  "/:attachmentId",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const task = await findVisibleTask(actor, request.params.taskId);
    const attachment = await prisma.attachment.findFirst({ where: { id: request.params.attachmentId, taskId: task.id }, select: { id: true, uploaderId: true, fileName: true } });
    if (!attachment) throw new HttpError(404, "File not found");
    if (attachment.uploaderId !== actor.id && !taskAccess(actor, task).edit) throw new HttpError(403, "You can't remove this file");

    await prisma.$transaction([
      prisma.attachment.delete({ where: { id: attachment.id } }),
      prisma.taskHistory.create({ data: { taskId: task.id, actorId: actor.id, field: "Evidence", oldValue: attachment.fileName } }),
    ]);
    response.status(204).end();
  }),
);
