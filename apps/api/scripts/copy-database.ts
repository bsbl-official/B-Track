// One-off copy of every row from the local database (DATABASE_URL) into an empty, migrated
// database (TARGET_DATABASE_URL), e.g. a hosted Neon database. Sessions are not copied, so
// everyone signs in again on the new site.
//
//   1. TARGET_DATABASE_URL=... npx prisma migrate deploy   (with DATABASE_URL set to the target)
//   2. npm run db:copy --workspace @task-tracker/api       (TARGET_DATABASE_URL in the root .env)
import { PrismaClient } from "@prisma/client";

const targetUrl = process.env.TARGET_DATABASE_URL;
if (!targetUrl) throw new Error("Set TARGET_DATABASE_URL to the database to copy into");
if (targetUrl === process.env.DATABASE_URL) throw new Error("TARGET_DATABASE_URL is the same as DATABASE_URL");

const source = new PrismaClient();
const target = new PrismaClient({ datasourceUrl: targetUrl });

// createMany sends one statement per call; keep batches small enough for large attachment rows.
async function copy<T>(label: string, rows: T[], insert: (batch: T[]) => Promise<unknown>, batchSize = 500) {
  for (let start = 0; start < rows.length; start += batchSize) await insert(rows.slice(start, start + batchSize));
  console.info(`${label}: ${rows.length}`);
}

async function main() {
  if ((await target.user.count()) > 0 || (await target.task.count()) > 0) {
    throw new Error("The target database already has users or tasks; it must be empty (only migrated).");
  }

  await copy("Roles", await source.role.findMany(), (data) => target.role.createMany({ data }));
  await copy("Users", await source.user.findMany(), (data) => target.user.createMany({ data }));
  await copy("POs", await source.client.findMany(), (data) => target.client.createMany({ data }));
  await copy("Types", await source.taskType.findMany(), (data) => target.taskType.createMany({ data }));
  await copy("Priorities", await source.priority.findMany(), (data) => target.priority.createMany({ data }));
  await copy("Statuses", await source.status.findMany(), (data) => target.status.createMany({ data }));
  await copy("Status transitions", await source.statusTransition.findMany(), (data) => target.statusTransition.createMany({ data }));

  const tasks = await source.task.findMany({ include: { clients: { select: { id: true } }, testers: { select: { id: true } } } });
  await copy("Tasks", tasks.map(({ clients: _clients, testers: _testers, ...task }) => task), (data) => target.task.createMany({ data }));
  const links = tasks.flatMap((task) => task.clients.map((client) => ({ clientId: client.id, taskId: task.id })));
  await copy("Task–PO links", links, (batch) =>
    target.$transaction(batch.map((link) => target.task.update({ where: { id: link.taskId }, data: { clients: { connect: { id: link.clientId } } } }))),
  );
  const testerLinks = tasks.flatMap((task) => task.testers.map((tester) => ({ userId: tester.id, taskId: task.id })));
  await copy("Task–tester links", testerLinks, (batch) =>
    target.$transaction(batch.map((link) => target.task.update({ where: { id: link.taskId }, data: { testers: { connect: { id: link.userId } } } }))),
  );
  // Explicit issue numbers don't move the counter; continue after the highest one.
  await target.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Task"', 'number'), COALESCE((SELECT MAX("number") FROM "Task"), 1))`);

  await copy("Attachments", await source.attachment.findMany(), (data) => target.attachment.createMany({ data }), 5);
  await copy("Comments", await source.comment.findMany(), (data) => target.comment.createMany({ data }));
  await copy("History", await source.taskHistory.findMany(), (data) => target.taskHistory.createMany({ data }));
  await copy("Notifications", await source.notification.findMany(), (data) => target.notification.createMany({ data }));

  console.info("Done. Next task number:", ((await target.task.aggregate({ _max: { number: true } }))._max.number ?? 0) + 1);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([source.$disconnect(), target.$disconnect()]));
