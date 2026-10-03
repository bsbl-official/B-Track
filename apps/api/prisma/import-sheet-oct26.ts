// One-off import of the team's "Daily Troubleshoot (Oct'26)" sheet.
// Safe to re-run: rows whose issue number already exists are skipped.
// The rows are internal, so they live in sheet-data-oct26.local.json (git-ignored).
// Assigned dev and Tested by are left blank on purpose: the owner assigns them in the app.
//
//   npx dotenv -e ../../.env -- tsx prisma/import-sheet-oct26.ts            (DATABASE_URL)
//   npx dotenv -e ../../.env -- tsx prisma/import-sheet-oct26.ts --target   (TARGET_DATABASE_URL)
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const url = process.argv.includes("--target") ? process.env.TARGET_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("No database URL set.");
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Row = {
  date: string | null;
  pos: string[];
  no: number;
  title: string;
  priority: string | null;
  probable: string | null;
  completed: string | null;
  status: string | null;
  comment?: string;
};
type SheetData = { poColors: Record<string, string>; rows: Row[] };

const sheet = JSON.parse(readFileSync(new URL("./sheet-data-oct26.local.json", import.meta.url), "utf8")) as SheetData;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = new Date().toISOString().slice(0, 10);

// The sheet's "Blocked" status: reachable from any open status, and back again.
const blockedTransitions: Array<[string, string]> = [
  ["New", "Blocked"],
  ["In Progress", "Blocked"],
  ["Testing", "Blocked"],
  ["Blocked", "New"],
  ["Blocked", "In Progress"],
  ["Blocked", "Testing"],
];

async function ensureConfiguration() {
  await prisma.status.upsert({ where: { name: "Blocked" }, update: {}, create: { name: "Blocked", color: "#b42318", sortOrder: 5 } });
  const statusByName = new Map((await prisma.status.findMany()).map((status) => [status.name, status]));
  for (const [from, to] of blockedTransitions) {
    const fromStatusId = statusByName.get(from)!.id;
    const toStatusId = statusByName.get(to)!.id;
    await prisma.statusTransition.upsert({
      where: { fromStatusId_toStatusId: { fromStatusId, toStatusId } },
      update: {},
      create: { fromStatusId, toStatusId },
    });
  }

  // "User" stands for confirmation from the user's side in "Tested by". It's a role with one
  // entry that can't sign in: no password, no Google account, and an unroutable address.
  const userRole = await prisma.role.upsert({
    where: { name: "User" },
    update: {},
    create: { name: "User", description: "Confirmation from the user's side (Tested by only; can't sign in)", permissions: [], isAssignable: false, canTest: true, isDefault: false },
  });
  await prisma.user.upsert({
    where: { email: "user-confirmation@b-track.invalid" },
    update: {},
    create: { name: "User", firstName: "User", email: "user-confirmation@b-track.invalid", roleId: userRole.id },
  });

  for (const [name, color] of Object.entries(sheet.poColors)) {
    await prisma.client.upsert({ where: { name }, update: {}, create: { name, color } });
  }
}

async function main() {
  await ensureConfiguration();

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

  const clientByName = new Map((await prisma.client.findMany()).map((client) => [client.name, client]));
  const priorityByName = new Map((await prisma.priority.findMany()).map((priority) => [priority.name, priority]));
  const statusByName = new Map((await prisma.status.findMany()).map((status) => [status.name, status]));

  let imported = 0;
  let skipped = 0;
  for (const row of sheet.rows) {
    if (await prisma.task.findUnique({ where: { number: row.no } })) {
      skipped++;
      continue;
    }
    // Sheet cells that were empty but are required here, noted in the description.
    const notes: string[] = [];
    if (!row.date) notes.push(`Sheet had no Date; set to the import date (${today}).`);
    if (!row.status) notes.push("Sheet had no Status; set to New.");
    if (row.pos.length === 0) notes.push("Sheet had no PO.");

    await prisma.$transaction(async (transaction) => {
      const task = await transaction.task.create({
        data: {
          number: row.no,
          title: row.title.trim(),
          description: notes.join("\n") || null,
          clients: { connect: row.pos.map((po) => ({ id: clientByName.get(po)!.id })) },
          priorityId: row.priority ? priorityByName.get(row.priority)!.id : null,
          statusId: statusByName.get(row.status ?? "New")!.id,
          reporterId: importer.id,
          reportedDate: day(row.date ?? today),
          expectedDeliveryDate: row.probable ? day(row.probable) : null,
          deliveredDate: row.completed ? day(row.completed) : null,
        },
      });
      await transaction.taskHistory.create({
        data: { taskId: task.id, actorId: importer.id, field: "Created", newValue: "Imported from Daily Troubleshoot (Oct'26) sheet" },
      });
      if (row.comment) await transaction.comment.create({ data: { taskId: task.id, authorId: importer.id, body: row.comment } });
    });
    imported++;
  }

  // New tasks continue after the highest issue number.
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Task"', 'number'), (SELECT MAX("number") FROM "Task"))`);

  console.info(`Imported ${imported} rows, skipped ${skipped} already present (of ${sheet.rows.length}).`);
}

await main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
