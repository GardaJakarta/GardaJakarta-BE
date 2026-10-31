import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test, mock } from "node:test";
import nodemailer from "nodemailer";

if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to a migrated database.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "development";
process.env.BETTER_AUTH_SECRET = randomUUID() + randomUUID();
process.env.BETTER_AUTH_URL = "http://localhost:4000";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.EMAIL_OTP_ENABLED = "true";
process.env.SMTP_HOST = "smtp.example.invalid";
process.env.SMTP_USER = "sender@example.invalid";
process.env.SMTP_PASS = randomUUID();
const messages = [];
mock.method(nodemailer, "createTransport", () => ({ sendMail: async (message) => { messages.push(message); return {}; } }));
const { createApp } = await import("../dist/app.js");
const { auth } = await import("../dist/auth.js");
const { prisma } = await import("../dist/prisma.js");

test("registration OTP delivery, verification, expiry and throttling", async (t) => {
  const email = `${randomUUID()}@example.invalid`;
  const password = randomUUID() + "Aa!";
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { Origin: process.env.CORS_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const latest = () => messages.filter((message) => message.to === email).at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  try {
    await t.test("signup sends one code and cannot create a session before verification", async () => {
      const response = await post("/sign-up/email", { email, password, name: "Warga Jakarta" });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).token, null);
      assert.equal(messages.length, 1);
      assert.match(latest(), /^\d{6}$/);
      const saved = await prisma.verification.findFirst({ where: { identifier: { contains: email } } });
      assert.ok(saved && !saved.value.includes(latest()));
      const login = await post("/sign-in/email", { email, password });
      assert.equal(login.status, 403);
      assert.equal((await login.json()).code, "EMAIL_NOT_VERIFIED");
    });
    await t.test("wrong code, expired code and resend throttle are enforced", async () => {
      const wrong = latest() === "000000" ? "111111" : "000000";
      assert.equal((await post("/email-otp/verify-email", { email, otp: wrong })).status, 400);
      await prisma.verification.updateMany({ where: { identifier: { contains: email } }, data: { expiresAt: new Date(0) } });
      assert.equal((await post("/email-otp/verify-email", { email, otp: latest() })).status, 400);
      assert.equal((await post("/email-otp/send-verification-otp", { email, type: "email-verification" })).status, 200);
      assert.equal((await post("/email-otp/send-verification-otp", { email, type: "email-verification" })).status, 429);
    });
    await t.test("valid code is single-use and permits password login", async () => {
      const otp = latest();
      assert.equal((await post("/email-otp/verify-email", { email, otp })).status, 200);
      assert.equal((await post("/email-otp/verify-email", { email, otp })).status, 400);
      const user = await prisma.user.findUnique({ where: { email } });
      assert.equal(user.emailVerified, true);
      assert.equal((await post("/sign-in/email", { email, password })).status, 200);
      assert.equal((await post("/sign-in/email-otp", { email, otp })).status, 404);
    });
    await t.test("five wrong attempts invalidate a code", async () => {
      await auth.api.sendVerificationOTP({ body: { email, type: "email-verification" } });
      const otp = latest(), wrong = otp === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) await assert.rejects(auth.api.verifyEmailOTP({ body: { email, otp: wrong } }));
      await assert.rejects(auth.api.verifyEmailOTP({ body: { email, otp } }));
    });
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.verification.deleteMany({ where: { identifier: { contains: email } } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
    mock.restoreAll();
  }
});
