// Task dates are calendar dates (Postgres DATE), exchanged with the web app as "YYYY-MM-DD".
import { z } from "zod";

export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

// Today's calendar date on the server, as a UTC-midnight Date like the ones Prisma returns.
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Gap days, as in the team sheet: today minus the probable date while the task is open.
 * Positive = that many days late, negative = days to spare. Null once completed or without a probable date.
 */
export function gapDays(probable: Date | null, isClosed: boolean): number | null {
  if (!probable || isClosed) return null;
  return Math.round((today().getTime() - probable.getTime()) / DAY_MS);
}
