// Runs a local PostgreSQL server from the embedded-postgres package, for machines without Docker.
// Data lives outside the repo (the repo may sit in a synced folder such as OneDrive).
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.DATABASE_PORT ?? 5432);
const dataDirectory =
  process.env.DATABASE_DATA_DIR ??
  join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "task-tracker", "pgdata");

function isPortInUse(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

if (await isPortInUse()) {
  console.info(`PostgreSQL is already running on port ${port}; leaving it as is.`);
  // Stay alive so `npm run dev` does not treat this process as finished.
  setInterval(() => undefined, 1 << 30);
} else {
  const database = new EmbeddedPostgres({
    databaseDir: dataDirectory,
    user: "task_tracker",
    password: "task_tracker",
    port,
    persistent: true,
    // Without this, Windows creates the cluster in WIN1252, which can't store Bangla text.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => undefined,
  });

  if (!existsSync(join(dataDirectory, "PG_VERSION"))) {
    console.info(`Initialising PostgreSQL data directory at ${dataDirectory}`);
    await database.initialise();
  }

  await database.start();

  try {
    await database.createDatabase("task_tracker");
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("already exists"))) {
      throw error;
    }
  }

  console.info(`PostgreSQL listening on localhost:${port} (data: ${dataDirectory})`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await database.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
