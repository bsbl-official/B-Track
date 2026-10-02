// Starter configuration plus a few sample rows. Safe to re-run: configuration is upserted,
// sample tasks are only created while the task table is empty.
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "../src/lib/permissions.js";
import { PO_COLORS } from "../src/lib/poColors.js";

const prisma = new PrismaClient();

const roles = [
  {
    name: "Admin",
    description: "Full access, including POs and access management",
    permissions: Object.values(PERMISSIONS),
    isAssignable: false,
    canTest: false,
    isDefault: false,
  },
  {
    name: "Business Analyst",
    description: "Manages all tasks and assigns them to the team",
    permissions: [
      PERMISSIONS.taskCreate,
      PERMISSIONS.taskViewAll,
      PERMISSIONS.taskEditAll,
      PERMISSIONS.taskAssignAny,
      PERMISSIONS.taskSetPriority,
      PERMISSIONS.taskSetStatus,
      PERMISSIONS.commentCreate,
    ],
    isAssignable: true,
    // Business Analysts test tasks.
    canTest: true,
    isDefault: false,
  },
  {
    name: "Developer",
    description: "Works on their own and assigned tasks",
    permissions: [PERMISSIONS.taskCreate, PERMISSIONS.taskViewAll, PERMISSIONS.taskSetPriority, PERMISSIONS.taskSetStatus, PERMISSIONS.commentCreate],
    isAssignable: true,
    // Developers can also be "Tested by".
    canTest: true,
    isDefault: true,
  },
];

// Matches the team's Daily Troubleshoot sheet.
const statuses = [
  { name: "New", color: "#6b7a99", sortOrder: 1, isInitial: true },
  { name: "In Progress", color: "#ea580c", sortOrder: 2 },
  { name: "Testing", color: "#ca8a04", sortOrder: 3 },
  { name: "Completed", color: "#16a34a", sortOrder: 4, isClosed: true },
];

const transitions: Array<[string, string]> = [
  ["New", "In Progress"],
  ["New", "Testing"],
  ["New", "Completed"],
  ["In Progress", "New"],
  ["In Progress", "Testing"],
  ["In Progress", "Completed"],
  ["Testing", "In Progress"],
  ["Testing", "Completed"],
  ["Completed", "In Progress"],
];

const types = [
  { name: "Feature", color: "#2563eb", sortOrder: 1 },
  { name: "Bug", color: "#dc2626", sortOrder: 2 },
];

// 1 is the most urgent, as in the sheet.
const priorities = [
  { name: "1", color: "#dc2626", rank: 1 },
  { name: "2", color: "#ea580c", rank: 2 },
  { name: "3", color: "#ca8a04", rank: 3 },
  { name: "4", color: "#64748b", rank: 4 },
];

// Sample accounts for local testing (sign in with DEV_LOGIN). Real people sign in with Google.
const users = [
  { name: "Ada Admin", email: "admin@example.com", role: "Admin" },
  { name: "Bella Analyst", email: "ba@example.com", role: "Business Analyst" },
  { name: "Dev One", email: "dev1@example.com", role: "Developer" },
  { name: "Dev Two", email: "dev2@example.com", role: "Developer" },
];

// Sample POs, only created while there are none yet.
const clients = ["ALPHA", "BETA", "GAMMA", "DELTA"];

function daysFromToday(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function main() {
  for (const role of roles) {
    await prisma.role.upsert({ where: { name: role.name }, update: {}, create: role });
  }
  for (const status of statuses) {
    await prisma.status.upsert({ where: { name: status.name }, update: {}, create: status });
  }
  const statusByName = new Map((await prisma.status.findMany()).map((status) => [status.name, status]));
  for (const [from, to] of transitions) {
    const fromStatusId = statusByName.get(from)!.id;
    const toStatusId = statusByName.get(to)!.id;
    await prisma.statusTransition.upsert({
      where: { fromStatusId_toStatusId: { fromStatusId, toStatusId } },
      update: {},
      create: { fromStatusId, toStatusId },
    });
  }
  for (const type of types) {
    await prisma.taskType.upsert({ where: { name: type.name }, update: {}, create: type });
  }
  for (const priority of priorities) {
    await prisma.priority.upsert({ where: { name: priority.name }, update: {}, create: priority });
  }
  for (const user of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: user.role } });
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { name: user.name, email: user.email, roleId: role.id },
    });
  }
  if ((await prisma.client.count()) === 0) {
    for (const [index, name] of clients.entries()) {
      await prisma.client.create({ data: { name, color: PO_COLORS[index % PO_COLORS.length] } });
    }
  }

  if ((await prisma.task.count()) > 0) return;

  const userByEmail = new Map((await prisma.user.findMany()).map((user) => [user.email, user]));
  const clientByName = new Map((await prisma.client.findMany()).map((client) => [client.name, client]));
  const typeByName = new Map((await prisma.taskType.findMany()).map((type) => [type.name, type]));
  const priorityByName = new Map((await prisma.priority.findMany()).map((priority) => [priority.name, priority]));

  const samples = [
    { title: "Login page throws 500 on wrong password", client: "ALPHA", type: "Bug", priority: "1", status: "In Progress", reporter: "ba@example.com", assignee: "dev1@example.com", reported: -6, expected: -1 },
    { title: "Export monthly invoice report to Excel", client: "ALPHA", type: "Feature", priority: "3", status: "New", reporter: "ba@example.com", assignee: "dev2@example.com", reported: -2, expected: 10 },
    { title: "Dashboard totals off by one day", client: "BETA", type: "Bug", priority: "2", status: "Testing", reporter: "dev2@example.com", assignee: "dev2@example.com", reported: -9, expected: 1 },
    { title: "Add SMS notification for order dispatch", client: "BETA", type: "Feature", priority: "4", status: "In Progress", reporter: "admin@example.com", assignee: null, reported: -15, expected: 20 },
    { title: "Password reset email not sent", client: "GAMMA", type: "Bug", priority: "2", status: "Completed", reporter: "dev1@example.com", assignee: "dev1@example.com", reported: -20, expected: -12, delivered: -10 },
  ];

  for (const sample of samples) {
    await prisma.task.create({
      data: {
        title: sample.title,
        clients: { connect: [{ id: clientByName.get(sample.client)!.id }] },
        typeId: typeByName.get(sample.type)!.id,
        priorityId: priorityByName.get(sample.priority)!.id,
        statusId: statusByName.get(sample.status)!.id,
        reporterId: userByEmail.get(sample.reporter)!.id,
        assigneeId: sample.assignee ? userByEmail.get(sample.assignee)!.id : null,
        reportedDate: daysFromToday(sample.reported),
        expectedDeliveryDate: daysFromToday(sample.expected),
        deliveredDate: sample.delivered === undefined ? null : daysFromToday(sample.delivered),
      },
    });
  }
}

await main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
