import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must point to a migrated PostgreSQL test database.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "production";
process.env.BETTER_AUTH_URL = "https://api.gardajakarta.my.id";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.GOOGLE_CLIENT_ID = "integration-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "integration-only-placeholder";
process.env.CORS_ORIGIN = "https://app.gardajakarta.my.id";
const { createApp } = await import("../dist/app.js");
const { prisma } = await import("../dist/prisma.js");

test("Better Auth sessions, Google initiation, and role boundaries", async (t) => {
  const runId = randomUUID();
  const emails = ["warga", "polisi", "admin"].map((role) => `${role}-${runId}@example.invalid`);
  const password = `${randomUUID()}-Aa9`;
  const origin = process.env.CORS_ORIGIN;
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const states = [];
  async function request(path, { cookie, body, requestOrigin = origin, ...options } = {}) {
    return fetch(`${base}${path}`, {
      ...options,
      redirect: "manual",
      headers: { Origin: requestOrigin, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body), method: "POST" } : {}),
    });
  }
  const sessionCookie = (response) => response.headers.getSetCookie().find((value) => value.startsWith("__Secure-garda.session_token="))?.split(";")[0];
  let citizenCookie;
  let citizenId;
  try {
    await prisma.$connect();
    await t.test("public signup creates only a citizen with a host-only secure cookie", async () => {
      const response = await request("/auth/sign-up/email", { body: { name: "Integration User", email: emails[0], password, role: "ADMIN" } });
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      citizenId = body.user.id;
      assert.equal(body.user.role, "WARGA");
      assert.equal(body.user.passwordHash, undefined);
      citizenCookie = sessionCookie(response);
      assert.ok(citizenCookie);
      const header = response.headers.getSetCookie().find((value) => value.includes("session_token="));
      assert.match(header, /HttpOnly/i);
      assert.match(header, /Secure/i);
      assert.match(header, /SameSite=Lax/i);
      assert.doesNotMatch(header, /Domain=/i);
      const account = await prisma.account.findFirst({ where: { userId: citizenId, providerId: "credential" } });
      assert.ok(account?.password);
      assert.notEqual(account.password, password);
    });
    assert.ok(citizenId && citizenCookie, "Stop dependent tests if signup failed.");
    await t.test("session survives a new request and protects role-specific APIs", async () => {
      assert.equal((await (await request("/auth/get-session")).json()), null);
      assert.equal((await (await request("/auth/get-session", { cookie: citizenCookie })).json()).user.id, citizenId);
      assert.equal((await request("/warga/session", { cookie: citizenCookie })).status, 200);
      assert.equal((await request("/polisi/session", { cookie: citizenCookie })).status, 403);
      assert.equal((await request("/admin/session", { cookie: citizenCookie })).status, 403);
      assert.equal((await request("/admin/session")).status, 401);
      assert.equal((await request("/auth/update-user", { cookie: citizenCookie, body: { role: "ADMIN" } })).status, 400);
      assert.equal((await prisma.user.findUnique({ where: { id: citizenId } })).role, "WARGA");
    });
    await t.test("wrong password and duplicate email are rejected", async () => {
      assert.equal((await request("/auth/sign-in/email", { body: { email: emails[0], password: "WrongPassword123" } })).status, 401);
      assert.equal((await request("/auth/sign-up/email", { body: { name: "Duplicate", email: emails[0].toUpperCase(), password } })).status, 422);
    });
    await t.test("staff credentials and immediate role changes are enforced", async () => {
      const passwordHash = await bcrypt.hash(password, 12);
      for (const [index, role] of ["polisi", "admin"].entries()) {
        const id = randomUUID();
        await prisma.user.create({ data: {
          id, name: "Integration Staff", email: emails[index + 1], emailVerified: true, role: role.toUpperCase(),
          accounts: { create: { id: randomUUID(), providerId: "credential", accountId: id, password: passwordHash } },
        } });
        const login = await request("/auth/sign-in/email", { body: { email: emails[index + 1], password } });
        assert.equal(login.status, 200, await login.clone().text());
        const cookie = sessionCookie(login);
        assert.equal((await request(`/${role}/session`, { cookie })).status, 200);
        assert.equal((await request("/warga/session", { cookie })).status, 403);
        await prisma.user.update({ where: { id }, data: { role: "WARGA" } });
        assert.equal((await request(`/${role}/session`, { cookie })).status, 403);
      }
    });
    await t.test("Google start uses registered callback, state, PKCE, and trusted redirects", async () => {
      const response = await request("/auth/sign-in/social", { body: { provider: "google", callbackURL: `${origin}/map`, disableRedirect: true } });
      assert.equal(response.status, 200, await response.clone().text());
      const url = new URL((await response.json()).url);
      assert.equal(url.hostname, "accounts.google.com");
      assert.equal(url.searchParams.get("redirect_uri"), "https://api.gardajakarta.my.id/api/auth/callback/google");
      assert.ok(url.searchParams.get("state"));
      states.push(url.searchParams.get("state"));
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.ok(url.searchParams.get("code_challenge"));
      assert.equal((await request("/auth/sign-in/social", { body: { provider: "google", callbackURL: "https://attacker.invalid" } })).status, 403);
      const callback = await request("/auth/callback/google?state=forged&code=forged");
      assert.equal(callback.status, 302);
      assert.match(callback.headers.get("location"), /error=/);
      assert.equal(sessionCookie(callback), undefined);
    });
    await t.test("untrusted origins and malformed input are rejected", async () => {
      assert.equal((await request("/auth/sign-in/email", { body: { email: emails[0], password }, requestOrigin: "https://attacker.invalid" })).status, 403);
      const invalid = await request("/auth/sign-up/email", { body: { name: "Invalid", email: "invalid", password: "x" } });
      assert.equal(invalid.status, 400);
      assert.equal((await request("/auth/sign-up/email", { body: { name: "Long", email: emails[0], password: "x".repeat(129) } })).status, 400);
    });
    await t.test("expired sessions and sign-out invalidate API access", async () => {
      assert.ok(citizenId);
      await prisma.session.updateMany({ where: { userId: citizenId }, data: { expiresAt: new Date(0) } });
      assert.equal((await request("/warga/session", { cookie: citizenCookie })).status, 401);
      const login = await request("/auth/sign-in/email", { body: { email: emails[0], password } });
      assert.equal(login.status, 200);
      const cookie = sessionCookie(login);
      assert.equal((await request("/auth/sign-out", { cookie, body: {} })).status, 200);
      assert.equal((await request("/warga/session", { cookie })).status, 401);
    });
    await t.test("repeated auth attempts are rate limited", async () => {
      let response;
      for (let index = 0; index < 22; index++) {
        response = await request("/auth/sign-in/email", { body: { email: "invalid", password: "invalid" } });
        if (response.status === 429) break;
      }
      assert.equal(response.status, 429);
    });
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.verification.deleteMany({ where: { identifier: { in: states } } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
