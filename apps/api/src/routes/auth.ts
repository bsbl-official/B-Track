import type { Response } from "express";
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import type { User } from "@prisma/client";
import { env } from "../config/env.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "../lib/passwords.js";
import { PERMISSIONS, effectivePermissions } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { createSignupToken, readSignupToken, type GoogleIdentity } from "../lib/signupToken.js";
import { endSession, getActor, requireAuth, startSession } from "../middleware/auth.js";

export const authRouter = Router();

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

const password = z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(200);
const personName = z.string().trim().min(1).max(60);
const fullName = (firstName: string, lastName: string) => `${firstName} ${lastName}`.trim();

// Why someone who exists can't sign in, or null if they can.
function accessProblem(user: User): string | null {
  if (user.status === "PENDING") return "Your access request is waiting for an admin to approve it";
  if (user.status === "REJECTED") return "Your access request was declined. Contact an admin";
  if (!user.isActive) return "Your account has been deactivated. Contact an admin";
  return null;
}

async function signedIn(response: Response, user: User) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(response, user.id);
  response.json({ success: true, data: { result: "signed-in" } });
}

function assertAllowedDomain(email: string) {
  const domain = email.split("@")[1] ?? "";
  if (env.ALLOWED_EMAIL_DOMAINS.length > 0 && !env.ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    throw new HttpError(403, `Only ${env.ALLOWED_EMAIL_DOMAINS.map((item) => `@${item}`).join(", ")} accounts can sign up`);
  }
}

/**
 * After Google confirms who someone is: sign them in if their account is set up, otherwise
 * hand back a sign-up token so they can confirm their name and choose a password.
 */
async function continueWithGoogle(response: Response, identity: GoogleIdentity) {
  identity = { ...identity, email: identity.email.toLowerCase() };
  assertAllowedDomain(identity.email);

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identity.email }, ...(identity.googleId ? [{ googleId: identity.googleId }] : [])] },
  });
  if (user) {
    const problem = accessProblem(user);
    if (problem && user.status !== "PENDING") throw new HttpError(403, problem);
    if (user.status === "APPROVED" && user.passwordHash) {
      if (identity.googleId && !user.googleId) {
        await prisma.user.update({ where: { id: user.id }, data: { googleId: identity.googleId, avatarUrl: user.avatarUrl ?? identity.avatarUrl } });
      }
      return signedIn(response, user);
    }
    if (user.status === "PENDING") throw new HttpError(403, problem!);
    // Added by an admin (or imported) but never signed up: let them finish their profile.
    identity = { ...identity, firstName: user.firstName ?? identity.firstName, lastName: user.lastName ?? identity.lastName };
  }

  response.json({
    success: true,
    data: { result: "sign-up", token: createSignupToken(identity), email: identity.email, firstName: identity.firstName, lastName: identity.lastName },
  });
}

async function notifyAccessManagers(message: string) {
  const people = await prisma.user.findMany({ where: { status: "APPROVED", isActive: true }, include: { role: true } });
  const managers = people.filter((person) => effectivePermissions(person).includes(PERMISSIONS.accessManage));
  if (managers.length === 0) return;
  await prisma.notification.createMany({
    data: managers.map((manager) => ({ userId: manager.id, message, link: "access?tab=requests" })),
  });
}

authRouter.get("/config", asyncHandler(async (_request, response) => {
  // For the collapsed "local testing" tools only.
  const devUsers = env.DEV_LOGIN
    ? await prisma.user.findMany({
        where: { isActive: true, status: "APPROVED" },
        orderBy: { name: "asc" },
        select: { email: true, name: true, role: { select: { name: true } } },
      })
    : undefined;
  response.json({
    success: true,
    data: { googleClientId: env.GOOGLE_CLIENT_ID ?? null, devLogin: env.DEV_LOGIN, devUsers, minPasswordLength: MIN_PASSWORD_LENGTH },
  });
}));

authRouter.post("/login", asyncHandler(async (request, response) => {
  const input = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).parse(request.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (user && !user.passwordHash && user.status === "APPROVED") {
    throw new HttpError(400, "This account has no password yet. Use “Continue with Google” to finish setting it up");
  }
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new HttpError(401, "Wrong email or password");
  }
  const problem = accessProblem(user);
  if (problem) throw new HttpError(403, problem);
  await signedIn(response, user);
}));

authRouter.post("/google", asyncHandler(async (request, response) => {
  if (!googleClient || !env.GOOGLE_CLIENT_ID) throw new HttpError(400, "Google sign-in is not configured");
  const { credential } = z.object({ credential: z.string().min(1) }).parse(request.body);

  const ticket = await googleClient
    .verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID })
    .catch(() => {
      throw new HttpError(401, "Google sign-in failed. Please try again");
    });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) throw new HttpError(401, "Your Google email is not verified");

  await continueWithGoogle(response, {
    email: payload.email,
    firstName: payload.given_name ?? payload.name?.split(" ")[0] ?? "",
    lastName: payload.family_name ?? "",
    googleId: payload.sub,
    avatarUrl: payload.picture,
  });
}));

authRouter.post("/signup", asyncHandler(async (request, response) => {
  const input = z.object({ token: z.string().min(1), firstName: personName, lastName: personName, password }).parse(request.body);
  const identity = readSignupToken(input.token);
  if (!identity) throw new HttpError(400, "Your sign-up session expired. Please continue with Google again");

  const passwordHash = await hashPassword(input.password);
  const profile = {
    firstName: input.firstName,
    lastName: input.lastName,
    name: fullName(input.firstName, input.lastName),
    passwordHash,
    googleId: identity.googleId,
    avatarUrl: identity.avatarUrl,
  };

  const existing = await prisma.user.findUnique({ where: { email: identity.email } });
  if (existing) {
    if (existing.status === "APPROVED" && existing.passwordHash) throw new HttpError(409, "This account is already set up. Please sign in");
    if (existing.status === "REJECTED") throw new HttpError(403, "Your access request was declined. Contact an admin");
    const user = await prisma.user.update({ where: { id: existing.id }, data: { ...profile, avatarUrl: existing.avatarUrl ?? identity.avatarUrl } });
    // Pre-approved by an admin: straight in.
    if (user.status === "APPROVED") return signedIn(response, user);
    response.json({ success: true, data: { result: "pending" } });
    return;
  }

  // ADMIN_EMAILS bootstraps the first admins; everyone else waits for approval.
  const isAdmin = env.ADMIN_EMAILS.includes(identity.email);
  const role = isAdmin
    ? await prisma.role.findFirst({ where: { permissions: { has: PERMISSIONS.accessManage } } })
    : await prisma.role.findFirst({ where: { isDefault: true } });
  if (!role) throw new HttpError(500, "No role is set up for new users. Contact an admin");

  const user = await prisma.user.create({
    data: { ...profile, email: identity.email, roleId: role.id, status: isAdmin ? "APPROVED" : "PENDING" },
  });
  if (isAdmin) return signedIn(response, user);

  await notifyAccessManagers(`${user.name} (${user.email}) requested access`);
  response.status(201).json({ success: true, data: { result: "pending" } });
}));

authRouter.get("/me", requireAuth, asyncHandler(async (request, response) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: getActor(request).id }, include: { role: true } });
  response.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      hasPassword: Boolean(user.passwordHash),
      mustChangePassword: user.mustChangePassword,
      googleLinked: Boolean(user.googleId),
      permissions: effectivePermissions(user),
      role: { id: user.role.id, name: user.role.name, isAssignable: user.role.isAssignable, canTest: user.role.canTest },
    },
  });
}));

authRouter.patch("/me", requireAuth, asyncHandler(async (request, response) => {
  const input = z.object({ firstName: personName, lastName: personName }).parse(request.body);
  await prisma.user.update({ where: { id: getActor(request).id }, data: { ...input, name: fullName(input.firstName, input.lastName) } });
  response.status(204).end();
}));

authRouter.post("/me/password", requireAuth, asyncHandler(async (request, response) => {
  const input = z.object({ currentPassword: z.string().optional(), newPassword: password }).parse(request.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: getActor(request).id } });
  // After an admin reset they've just signed in with the temporary password, so it isn't asked again.
  if (user.passwordHash && !user.mustChangePassword && !(await verifyPassword(input.currentPassword ?? "", user.passwordHash))) {
    throw new HttpError(400, "Your current password is wrong");
  }
  if (user.mustChangePassword && (await verifyPassword(input.newPassword, user.passwordHash))) {
    throw new HttpError(400, "Choose a password different from the temporary one");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
  });
  response.status(204).end();
}));

authRouter.post("/logout", asyncHandler(async (request, response) => {
  await endSession(request, response);
  response.status(204).end();
}));

// Local testing only (DEV_LOGIN): switch user without a password, and pretend to be Google.
authRouter.post("/dev/login", asyncHandler(async (request, response) => {
  if (!env.DEV_LOGIN) throw new HttpError(404, "Not found");
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(request.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new HttpError(404, "No user with that email");
  const problem = accessProblem(user);
  if (problem) throw new HttpError(403, problem);
  await signedIn(response, user);
}));

authRouter.post("/dev/google", asyncHandler(async (request, response) => {
  if (!env.DEV_LOGIN) throw new HttpError(404, "Not found");
  const input = z
    .object({ email: z.string().trim().toLowerCase().email(), firstName: z.string().trim().max(60), lastName: z.string().trim().max(60) })
    .parse(request.body);
  await continueWithGoogle(response, input);
}));
