import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mkdtemp, cp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const databaseUrl = new URL(process.env.DATABASE_URL || "");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "db"].includes(databaseUrl.hostname)) {
  throw new Error("Local setup only supports localhost, 127.0.0.1 or the Compose db service, outside production.");
}
if ((databaseUrl.searchParams.get("schema") || "public") !== "public") {
  throw new Error("Local setup expects the public schema.");
}
const prismaCli = join(root, "node_modules/prisma/build/index.js");
function deploy(schema) {
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], {
    env: process.env, stdio: "inherit",
  });
  if (result.error || result.status !== 0) throw new Error("Local migration failed. Inspect the Prisma output; no data was reset.");
}

const db = new PrismaClient();
let empty;
try {
  const [result] = await db.$queryRaw`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
  empty = result.count === 0;
} finally { await db.$disconnect(); }

if (empty) {
  // The deployed history added comment evidence before its table-creation timestamp.
  // Apply dependencies first without renaming, editing, or marking unapplied SQL complete.
  const temporary = await mkdtemp(join(tmpdir(), "garda-local-migrations-"));
  try {
    await cp(join(root, "prisma/schema.prisma"), join(temporary, "schema.prisma"));
    const source = join(root, "prisma/migrations");
    for (const entry of await readdir(source)) {
      if (entry === "20261029093000_comment_evidence") continue;
      await cp(join(source, entry), join(temporary, "migrations", entry), { recursive: true });
    }
    deploy(join(temporary, "schema.prisma"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
deploy(join(root, "prisma/schema.prisma"));
