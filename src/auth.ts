import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

const production = process.env.NODE_ENV === "production";
const apiUrl = process.env.BETTER_AUTH_URL || (production ? "https://api.gardajakarta.my.id" : "http://localhost:4000");
const origins = (process.env.CORS_ORIGIN || "http://localhost:5173,https://gardajakarta.my.id,https://app.gardajakarta.my.id")
  .split(/[\s,]+/)
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!process.env.BETTER_AUTH_SECRET && production) {
  throw new Error("BETTER_AUTH_SECRET must be configured in production.");
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  baseURL: apiUrl,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: origins,
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "WARGA",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    password: {
      hash: hashPassword,
      // Keep passwords migrated from the original bcrypt implementation valid.
      verify: async ({ hash, password }) => hash.startsWith("$2")
        ? Buffer.byteLength(password, "utf8") <= 72 && await bcrypt.compare(password, hash)
        : verifyPassword({ hash, password }),
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirectURI: `${apiUrl}/api/auth/callback/google`,
      requireEmailVerification: true,
      disableIdTokenSignIn: true,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      requireLocalEmailVerified: true,
      allowDifferentEmails: false,
    },
    encryptOAuthTokens: true,
    storeStateStrategy: "database",
  },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-garda-client-ip"] },
    useSecureCookies: production,
    disableCSRFCheck: false,
    disableOriginCheck: false,
    cookiePrefix: "garda",
    crossSubDomainCookies: production
      ? { enabled: true, domain: ".gardajakarta.my.id" }
      : { enabled: false },
  },
  session: { cookieCache: { enabled: false } },
  rateLimit: {
    enabled: true,
    customRules: {
      "/sign-in/email": { window: 900, max: 20 },
      "/sign-up/email": { window: 900, max: 20 },
      "/sign-in/social": { window: 900, max: 20 },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;

export function normalizeRole(role: unknown): "warga" | "polisi" | "admin" {
  if (role === "POLISI" || role === "polisi") return "polisi";
  if (role === "ADMIN" || role === "admin") return "admin";
  return "warga";
}
