import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "./prisma.js";

export const authPortals = ["warga", "polisi", "admin"] as const;
export type AuthPortal = (typeof authPortals)[number];

const authInput = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const registerInput = authInput.extend({ name: z.string().trim().min(2).max(80) });
const loginInput = authInput.extend({ portal: z.enum(authPortals).default("warga") });

function toUser(user: { id: string; name: string; email: string; role: string }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role.toLowerCase() };
}

function roleForPortal(portal: AuthPortal) {
  return portal === "polisi" ? "POLISI" : portal === "admin" ? "ADMIN" : "WARGA";
}

function signToken(userId: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return jwt.sign({ sub: userId }, secret, { expiresIn: "7d" });
}

export async function registerUser(input: unknown) {
  const data = registerInput.parse(input);
  const email = data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("Email sudah terdaftar.");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: { name: data.name, email, passwordHash },
    select: { id: true, name: true, email: true, role: true },
  });
  return { user: toUser(user), token: signToken(user.id) };
}

export async function loginUser(input: unknown) {
  const data = loginInput.parse(input);
  const email = data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
    throw new Error("Email atau password tidak cocok.");
  }
  if (user.role !== roleForPortal(data.portal)) {
    throw new Error("Akun ini tidak terdaftar untuk portal tersebut.");
  }
  return { user: toUser(user), token: signToken(user.id) };
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } });
  return user ? toUser(user) : null;
}

export function getTokenUserId(authorization?: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret || !authorization?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(authorization.slice(7), secret);
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
