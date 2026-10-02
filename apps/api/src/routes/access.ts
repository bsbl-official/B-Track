// Access management: sign-up requests, roles and their permissions, and each person's access.
import type { Prisma, Role, User } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http.js";
import { generateTemporaryPassword, hashPassword } from "../lib/passwords.js";
import { PERMISSION_CATALOGUE, PERMISSIONS, effectivePermissions } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { getActor, requirePermission } from "../middleware/auth.js";

export const accessRouter = Router();

accessRouter.use((request, _response, next) => {
  requirePermission(request, PERMISSIONS.accessManage);
  next();
});

const permissionKeys = PERMISSION_CATALOGUE.map((permission) => permission.key) as [string, ...string[]];

const userSelect = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  avatarUrl: true,
  status: true,
  isActive: true,
  grantedPermissions: true,
  revokedPermissions: true,
  passwordHash: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  roleId: true,
} as const;

accessRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    const [roles, users] = await Promise.all([
      prisma.role.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
      prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: userSelect }),
    ]);
    response.json({ success: true, data: { permissions: PERMISSION_CATALOGUE, roles, users: users.map(serializeUser) } });
  }),
);

// The password hash never leaves the server; the page only needs to know whether one is set.
function serializeUser({ passwordHash, ...user }: Prisma.UserGetPayload<{ select: typeof userSelect }>) {
  return { ...user, hasPassword: Boolean(passwordHash) };
}

type UserWithRole = User & { role: Role };

/**
 * Keeps at least one approved, active person able to open this page. `apply` describes the
 * change being made: it gets each person and their role, and returns them as they'd be after it.
 */
async function assertAccessManagerRemains(apply: (user: UserWithRole) => UserWithRole | null) {
  const people = await prisma.user.findMany({ include: { role: true } });
  const remaining = people
    .map(apply)
    .filter((user): user is UserWithRole => Boolean(user && user.isActive && user.status === "APPROVED"))
    .filter((user) => effectivePermissions(user).includes(PERMISSIONS.accessManage));
  if (remaining.length === 0) throw new HttpError(400, "At least one active user must keep access management");
}

const permissionList = () => z.array(z.enum(permissionKeys));

const roleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z.array(z.enum(permissionKeys)),
  isAssignable: z.boolean(),
  canTest: z.boolean(),
  isDefault: z.boolean(),
});

accessRouter.post(
  "/roles",
  asyncHandler(async (request, response) => {
    const input = roleSchema.parse(request.body);
    const existing = await prisma.role.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
    if (existing) throw new HttpError(409, `Role "${existing.name}" already exists`);

    const role = await prisma.$transaction(async (transaction) => {
      if (input.isDefault) await transaction.role.updateMany({ data: { isDefault: false } });
      return transaction.role.create({ data: input });
    });
    response.status(201).json({ success: true, data: role });
  }),
);

accessRouter.patch(
  "/roles/:id",
  asyncHandler(async (request, response) => {
    const input = roleSchema.partial().strict().parse(request.body);
    const role = await prisma.role.findUnique({ where: { id: request.params.id } });
    if (!role) throw new HttpError(404, "Role not found");

    if (input.name && input.name !== role.name) {
      const clash = await prisma.role.findFirst({
        where: { name: { equals: input.name, mode: "insensitive" }, id: { not: role.id } },
      });
      if (clash) throw new HttpError(409, `Role "${clash.name}" already exists`);
    }
    if (input.permissions && role.permissions.includes(PERMISSIONS.accessManage) && !input.permissions.includes(PERMISSIONS.accessManage)) {
      await assertAccessManagerRemains((user) =>
        user.roleId === role.id ? { ...user, role: { ...user.role, permissions: input.permissions! } } : user,
      );
    }
    if (input.isDefault === false && role.isDefault) {
      throw new HttpError(400, "Pick another role as the default instead; one role must be the default");
    }

    const updated = await prisma.$transaction(async (transaction) => {
      if (input.isDefault) await transaction.role.updateMany({ where: { id: { not: role.id } }, data: { isDefault: false } });
      return transaction.role.update({ where: { id: role.id }, data: input });
    });
    response.json({ success: true, data: updated });
  }),
);

accessRouter.delete(
  "/roles/:id",
  asyncHandler(async (request, response) => {
    const role = await prisma.role.findUnique({ where: { id: request.params.id }, include: { _count: { select: { users: true } } } });
    if (!role) throw new HttpError(404, "Role not found");
    if (role._count.users > 0) throw new HttpError(400, "Move this role's users to another role first");
    if (role.isDefault) throw new HttpError(400, "The default role for new users can't be deleted");
    await prisma.role.delete({ where: { id: role.id } });
    response.status(204).end();
  }),
);

// Adds someone before their first sign-in. They're pre-approved: when they continue with
// Google using this email, they only confirm their name and set a password.
accessRouter.post(
  "/users",
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        firstName: z.string().trim().min(1).max(60),
        lastName: z.string().trim().min(1).max(60),
        roleId: z.string().min(1),
      })
      .parse(request.body);
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      throw new HttpError(409, "A user with this email already exists");
    }
    if (!(await prisma.role.findUnique({ where: { id: input.roleId } }))) throw new HttpError(400, "Unknown role");
    const user = await prisma.user.create({
      data: { ...input, name: `${input.firstName} ${input.lastName}`, status: "APPROVED" },
      select: userSelect,
    });
    response.status(201).json({ success: true, data: serializeUser(user) });
  }),
);

const userUpdateSchema = z
  .object({
    roleId: z.string().min(1),
    isActive: z.boolean(),
    email: z.string().trim().toLowerCase().email(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    grantedPermissions: permissionList(),
    revokedPermissions: permissionList(),
    status: z.enum(["APPROVED", "REJECTED"]),
  })
  .partial()
  .strict();

// Also used to approve or decline a sign-up request (status), with the role and access to give.
accessRouter.patch(
  "/users/:id",
  asyncHandler(async (request, response) => {
    const input = userUpdateSchema.parse(request.body);
    const actor = getActor(request);
    const user = await prisma.user.findUnique({ where: { id: request.params.id }, include: { role: true } });
    if (!user) throw new HttpError(404, "User not found");

    const role = input.roleId ? await prisma.role.findUnique({ where: { id: input.roleId } }) : user.role;
    if (!role) throw new HttpError(400, "Unknown role");
    if (input.email && input.email !== user.email && (await prisma.user.findUnique({ where: { email: input.email } }))) {
      throw new HttpError(409, "Another user already has this email");
    }
    if (user.id === actor.id && (input.isActive === false || input.status === "REJECTED")) {
      throw new HttpError(400, "You can't deactivate or decline yourself");
    }

    const firstName = input.firstName ?? user.firstName;
    const lastName = input.lastName ?? user.lastName;
    // Only keep adjustments that actually differ from the role.
    const granted = (input.grantedPermissions ?? user.grantedPermissions).filter((key) => !role.permissions.includes(key));
    const revoked = (input.revokedPermissions ?? user.revokedPermissions).filter((key) => role.permissions.includes(key));
    const data = {
      ...input,
      roleId: role.id,
      grantedPermissions: granted,
      revokedPermissions: revoked,
      ...(input.firstName || input.lastName ? { name: `${firstName ?? ""} ${lastName ?? ""}`.trim() } : {}),
    };

    await assertAccessManagerRemains((person) => (person.id === user.id ? { ...person, ...data, role } : person));

    const updated = await prisma.$transaction(async (transaction) => {
      // People who lose access are signed out everywhere.
      if (input.isActive === false || input.status === "REJECTED") {
        await transaction.session.deleteMany({ where: { userId: user.id } });
      }
      return transaction.user.update({ where: { id: user.id }, data, select: userSelect });
    });
    response.json({ success: true, data: serializeUser(updated) });
  }),
);

// Gives someone a one-time temporary password (shown to the admin once, never stored in plain
// text). They're signed out everywhere and must choose their own password when they next sign in.
accessRouter.post(
  "/users/:id/reset-password",
  asyncHandler(async (request, response) => {
    const actor = getActor(request);
    const user = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!user) throw new HttpError(404, "User not found");
    if (user.id === actor.id) throw new HttpError(400, "Change your own password from your profile");
    if (user.status !== "APPROVED") throw new HttpError(400, "Only approved users can have their password reset");

    const temporaryPassword = generateTemporaryPassword();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
      }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    response.json({ success: true, data: { temporaryPassword } });
  }),
);
