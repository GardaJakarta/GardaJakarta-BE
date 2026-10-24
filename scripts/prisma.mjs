import { spawnSync } from "node:child_process";
import path from "node:path";

const prismaCommand = process.platform === "win32"
  ? path.resolve("node_modules/.bin/prisma.cmd")
  : path.resolve("node_modules/.bin/prisma");
const env = { ...process.env };

// Prisma now targets PostgreSQL in every environment. The fallback only lets
// `prisma generate` and `prisma validate` run before a local database exists.
if (!env.DATABASE_URL) env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/gardajakarta?schema=public";

const result = spawnSync(prismaCommand, process.argv.slice(2), {
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
