import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";
import { emailOTP } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOtpEnabled, mailConfigured, sendRegistrationOtp } from "./email.js";

const production = process.env.NODE_ENV === "production";
const apiUrl = process.env.BETTER_AUTH_URL || (production ? "https://api.gardajakarta.my.id" : "http://localhost:4000");
const origins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,https://gardajakarta.my.id,https://app.gardajakarta.my.id")
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
  disabledPaths: ["/sign-in/email-otp"],
  plugins: [emailOTP({
    otpLength: 6, expiresIn: 300, allowedAttempts: 5, storeOTP: "hashed",
    disableSignUp: true, sendVerificationOnSignUp: emailOtpEnabled,
    overrideDefaultEmailVerification: true,
    rateLimit: { window: 60, max: 5 },
    async sendVerificationOTP({ email, otp, type }) {
      if (!emailOtpEnabled || !mailConfigured || type !== "email-verification") throw new APIError("SERVICE_UNAVAILABLE", { message: "Pengiriman kode belum tersedia." });
      try { await sendRegistrationOtp(email, otp); }
      catch { throw new APIError("SERVICE_UNAVAILABLE", { message: "Kode belum terkirim. Coba lagi sebentar." }); }
    },
  })],
  hooks: { before: createAuthMiddleware(async (ctx) => {
    if (ctx.path === "/sign-up/email" && emailOtpEnabled && !mailConfigured) throw new APIError("SERVICE_UNAVAILABLE", { message: "Pendaftaran sedang disiapkan. Coba lagi nanti." });
  }) },
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
    autoSignIn: !emailOtpEnabled,
    requireEmailVerification: emailOtpEnabled,
    password: {
      hash: hashPassword,
      // Keep passwords migrated from the original bcrypt implementation valid.
      verify: async ({ hash, password }) => hash.startsWith("$2")
        ? Buffer.byteLength(password, "utf8") <= 72 && await bcrypt.compare(password, hash)
        : verifyPassword({ hash, password }),
    },
  },
  emailVerification: { sendOnSignUp: emailOtpEnabled, sendOnSignIn: emailOtpEnabled, autoSignInAfterVerification: false },
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
      "/email-otp/send-verification-otp": { window: 60, max: 1 },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;

export function normalizeRole(role: unknown): "warga" | "polisi" | "admin" {
  if (role === "POLISI" || role === "polisi") return "polisi";
  if (role === "ADMIN" || role === "admin") return "admin";
  return "warga";
}
