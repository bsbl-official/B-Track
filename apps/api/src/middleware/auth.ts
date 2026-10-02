import { createHash, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { env } from "../config/env.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { effectivePermissions, type Permission } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";

// isAssignable: the person's role can take tasks (developers, BAs), so they may claim unassigned ones.
export type Actor = { id: string; name: string; email: string; permissions: string[]; isAssignable: boolean };

declare module "express-serve-static-core" {
  interface Request {
    actor?: Actor;
  }
}

export const SESSION_COOKIE = "tt_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(response: Response, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function endSession(request: Request, response: Response) {
  const token: unknown = request.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  response.clearCookie(SESSION_COOKIE, { path: "/" });
}

export const requireAuth: RequestHandler = asyncHandler(async (request, _response, next) => {
  const token: unknown = request.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) throw new HttpError(401, "Please sign in");

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { role: true } } },
  });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    throw new HttpError(401, "Your session has expired. Please sign in again");
  }
  if (!session.user.isActive || session.user.status !== "APPROVED") {
    await prisma.session.delete({ where: { id: session.id } });
    throw new HttpError(401, "Your account doesn't have access right now. Contact an admin");
  }

  const { user } = session;
  // After an admin reset, only the account endpoints (to set a new password) are open.
  if (user.mustChangePassword && !request.originalUrl.startsWith("/api/auth/")) {
    throw new HttpError(403, "Choose a new password before continuing");
  }
  request.actor = {
    id: user.id,
    name: user.name,
    email: user.email,
    permissions: effectivePermissions(user),
    isAssignable: user.role.isAssignable,
  };
  next();
});

export function getActor(request: Request): Actor {
  if (!request.actor) throw new HttpError(401, "Please sign in");
  return request.actor;
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.includes(permission);
}

export function requirePermission(request: Request, permission: Permission) {
  const actor = getActor(request);
  if (!can(actor, permission)) throw new HttpError(403, "Your role doesn't allow this");
  return actor;
}
