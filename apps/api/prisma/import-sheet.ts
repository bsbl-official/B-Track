// One-off import of the team's "Daily Troubleshoot (Aug'26 + Sept'26)" sheet.
// Safe to re-run: rows whose issue number already exists are skipped.
// The sheet itself is internal, so its people, PO colours and rows live in sheet-data.local.json
// (git-ignored) rather than in the repository.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PO_COLORS } from "../src/lib/poColors.js";

const prisma = new PrismaClient();

// The sample tasks the seed created before real data existed.
const sampleTaskTitles = [
  "Login page throws 500 on wrong password",
  "Export monthly invoice report to Excel",
  "Dashboard totals off by one day",
  "Add SMS notification for order dispatch",
  "Password reset email not sent",
];

type Row = {
  date: string | null;
  pos: string[];
  no: number;
  title: string;
  dev: string;
  priority: string | null;
  tester: string | null;
  probable: string | null;
  completed: string | null;
  status: "New" | "In Progress" | "Testing" | "Completed";
  // Sheet values that couldn't be imported as-is.
  note?: string;
};

const r = (
  date: string | null,
  pos: string,
  no: number,
  title: string,
  dev: string,
  priority: string | null,
  tester: string | null,
  probable: string | null,
  completed: string | null,
  status: Row["status"],
  note?: string,
): Row => ({ date, pos: pos.split(",").map((po) => po.trim()), no, title: title.trim(), dev, priority, tester, probable, completed, status, note });

type SheetData = {
  // Placeholder accounts until real emails are added on the Access management page.
  people: Array<{ name: string; email: string; role: string }>;
  // Chip colours as used in the sheet.
  poColors: Record<string, string>;
  // Arguments for r(), one array per sheet row.
  rows: Array<Parameters<typeof r>>;
};

const sheet = JSON.parse(readFileSync(new URL("./sheet-data.local.json", import.meta.url), "utf8")) as SheetData;
const people = sheet.people;
const poColors = sheet.poColors;
const rows: Row[] = sheet.rows.map((args) => r(...args));

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function main() {
  // People from the sheet, with placeholder emails.
  for (const person of people) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: person.role } });
    const existing = await prisma.user.findFirst({ where: { name: person.name } });
    if (!existing) await prisma.user.create({ data: { name: person.name, email: person.email, roleId: role.id } });
  }
  // Imported rows are credited to this inactive account, since the sheet doesn't say who logged them.
  const importer = await prisma.user.upsert({
    where: { email: "sheet-import@example.com" },
    update: {},
    create: {
      name: "Sheet import",
      email: "sheet-import@example.com",
      isActive: false,
      roleId: (await prisma.role.findUniqueOrThrow({ where: { name: "Developer" } })).id,
    },
  });

  for (const [name, color] of Object.entries(poColors)) {
    await prisma.client.upsert({ where: { name }, update: {}, create: { name, color } });
  }

  // Remove the seed's sample tasks so they don't mix with real issue numbers.
  const removed = await prisma.task.deleteMany({ where: { title: { in: sampleTaskTitles }, reporter: { email: { endsWith: "@example.com" } } } });
  // …and sample POs nobody uses any more.
  await prisma.client.deleteMany({ where: { name: { in: ["Acme Corp", "Globex", "Initech"] }, tasks: { none: {} } } });

  const userByName = new Map((await prisma.user.findMany()).map((user) => [user.name, user]));
  const clientByName = new Map((await prisma.client.findMany()).map((client) => [client.name, client]));
  const priorityByName = new Map((await prisma.priority.findMany()).map((priority) => [priority.name, priority]));
  const statusByName = new Map((await prisma.status.findMany()).map((status) => [status.name, status]));

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    if (await prisma.task.findUnique({ where: { number: row.no } })) {
      skipped++;
      continue;
    }
    const notes = [row.note];
    // The sheet has no Date for a few old rows; use the earliest date we do have.
    const date = row.date ?? row.probable ?? row.completed;
    if (!row.date) notes.push(`Sheet had no Date; used ${date} from the ${row.probable ? "probable" : "completed"} date.`);

    await prisma.$transaction(async (transaction) => {
      const task = await transaction.task.create({
        data: {
          number: row.no,
          title: row.title,
          description: notes.filter(Boolean).join("\n") || null,
          clients: { connect: row.pos.map((po) => ({ id: clientByName.get(po)!.id })) },
          priorityId: row.priority ? priorityByName.get(row.priority)!.id : null,
          statusId: statusByName.get(row.status)!.id,
          reporterId: importer.id,
          assigneeId: userByName.get(row.dev)!.id,
          testedById: row.tester ? userByName.get(row.tester)!.id : null,
          reportedDate: day(date!),
          expectedDeliveryDate: row.probable ? day(row.probable) : null,
          deliveredDate: row.completed ? day(row.completed) : null,
        },
      });
      await transaction.taskHistory.create({
        data: { taskId: task.id, actorId: importer.id, field: "Created", newValue: "Imported from Daily Troubleshoot sheet" },
      });
    });
    imported++;
  }

  // Continue numbering after the highest imported issue number.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"Task"', 'number'), (SELECT MAX("number") FROM "Task"))`,
  );

  console.info(`Removed ${removed.count} sample tasks. Imported ${imported} rows, skipped ${skipped} already present (of ${rows.length}).`);
}

await main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
