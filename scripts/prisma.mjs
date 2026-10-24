import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ quiet: true });
const prismaCommand = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
const env = { ...process.env };

const result = spawnSync(process.execPath, [prismaCommand, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
