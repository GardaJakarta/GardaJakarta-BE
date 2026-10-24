import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (databaseUrl && !databaseUrl.searchParams.has("connect_timeout")) {
  databaseUrl.searchParams.set("connect_timeout", "30");
}
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  ...(databaseUrl ? { datasourceUrl: databaseUrl.href } : {}),
  transactionOptions: { maxWait: 10_000, timeout: 30_000 },
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
