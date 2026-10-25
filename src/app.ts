import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { Prisma } from "@prisma/client";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { auth, normalizeRole, type AuthSession } from "./auth.js";
import { prisma } from "./prisma.js";

export function createApp() {
  const app = express();
  const origins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,https://gardajakarta.my.id,https://app.gardajakarta.my.id")
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: origins, credentials: true }));
  app.use((request, _response, next) => {
    // Use Express's trusted-proxy result, never the caller's custom header.
    request.headers["x-garda-client-ip"] = request.ip || request.socket.remoteAddress;
    next();
  });
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(["/api/auth/sign-in", "/api/auth/sign-up"], rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." },
  }));

  app.get("/api/health", async (_request, response) => {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ ok: true, service: "gardajakarta-be" });
  });

  const readSession = async (request: Parameters<RequestHandler>[0]): Promise<AuthSession | null> => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    return session as AuthSession | null;
  };

  const requireRole = (role: "warga" | "polisi" | "admin"): RequestHandler => async (request, response, next) => {
    const session = await readSession(request);
    if (!session) return response.status(401).json({ error: "Sesi tidak valid atau sudah berakhir." });
    if (normalizeRole(session.user.role) !== role) return response.status(403).json({ error: "Akses portal tidak diizinkan." });
    response.locals.session = session;
    next();
  };

  app.get("/api/me", async (request, response) => {
    const session = await readSession(request);
    if (!session) return response.status(401).json({ error: "Sesi tidak valid atau sudah berakhir." });
    response.json({ data: { ...session.user, role: normalizeRole(session.user.role) } });
  });

  // Better Auth must receive the raw request stream before body parsers.
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json({ limit: "32kb" }));

  for (const role of ["warga", "polisi", "admin"] as const) {
    app.get(`/api/${role}/session`, requireRole(role), (_request, response) => {
      const session = response.locals.session as AuthSession;
      response.json({ data: { user: { ...session.user, role: normalizeRole(session.user.role) }, portal: role } });
    });
  }

  app.use((_request, response) => response.status(404).json({ error: "Endpoint tidak ditemukan." }));
  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    void next;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return void response.status(409).json({ error: "Email sudah terdaftar." });
    }
    console.error(JSON.stringify({ event: "request_failed", type: error instanceof Error ? error.name : "UnknownError" }));
    response.status(500).json({ error: "Terjadi kesalahan pada server." });
  };
  app.use(errorHandler);
  return app;
}
