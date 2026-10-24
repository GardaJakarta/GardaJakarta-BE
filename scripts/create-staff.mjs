import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const input = z.object({
  STAFF_NAME: z.string().trim().min(2).max(80),
  STAFF_EMAIL: z.string().trim().toLowerCase().email(),
  STAFF_PASSWORD: z.string().min(12).max(128),
  STAFF_ROLE: z.enum(["polisi", "admin"]),
  STAFF_PROVISIONED_BY: z.string().trim().min(2),
  STAFF_REASON: z.string().trim().min(5),
}).safeParse(process.env);

if (!input.success) {
  console.error("Set valid STAFF_NAME, STAFF_EMAIL, STAFF_PASSWORD (12-128 characters), STAFF_ROLE (polisi/admin), STAFF_PROVISIONED_BY, and STAFF_REASON.");
  process.exit(1);
}

const db = new PrismaClient();
try {
  const data = input.data;
  const userId = randomUUID();
  const password = await hashPassword(data.STAFF_PASSWORD);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({ data: {
      id: userId,
      name: data.STAFF_NAME,
      email: data.STAFF_EMAIL,
      emailVerified: true,
      role: data.STAFF_ROLE === "polisi" ? "POLISI" : "ADMIN",
    } });
    await tx.account.create({ data: {
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password,
    } });
    await tx.auditLog.create({ data: {
      actor: data.STAFF_PROVISIONED_BY,
      operation: "STAFF_CREATED",
      resourceId: created.id,
      reason: data.STAFF_REASON,
    } });
    return created;
  });
  console.log(`Staff account created: ${user.id} (${user.role}).`);
} catch {
  console.error("Account was not created. Check database availability and whether the email is already registered.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
