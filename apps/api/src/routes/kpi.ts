import { Router } from "express";
import { z } from "zod";
import { dateOnly } from "../lib/dates.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { buildKpiReport } from "../lib/kpi.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { requirePermission } from "../middleware/auth.js";

export const kpiRouter = Router();

// Comma-separated ids; empty = no filter.
const idList = z
  .string()
  .optional()
  .transform((value) => {
    const ids = value?.split(",").filter(Boolean) ?? [];
    return ids.length ? ids : null;
  });

const querySchema = z.object({
  from: dateOnly,
  to: dateOnly,
  // The people to report on; without it, everyone who had work in the period.
  people: idList,
  // Only tasks for these POs.
  pos: idList,
});

kpiRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const actor = requirePermission(request, PERMISSIONS.kpiView);
    const query = querySchema.parse(request.query);
    if (query.from > query.to) throw new HttpError(400, "The start date must be on or before the end date");
    const report = await buildKpiReport(query.from, query.to, query.people, query.pos);
    response.json({ success: true, data: { ...report, generatedBy: actor.name } });
  }),
);
