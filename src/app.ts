import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { Prisma } from "@prisma/client";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { auth, normalizeRole, type AuthSession } from "./auth.js";
import { prisma } from "./prisma.js";
import { readImage } from "./storage.js";

const reportInput = z.object({
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(2000),
  severity: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  latitude: z.number().min(-7.2).max(-5.8),
  longitude: z.number().min(106.4).max(107.2),
});

function serializePoliceUnit(unit: { id: string; name: string; district: string; address: string; phone: string | null; latitude: unknown; longitude: unknown; photoUrl: string | null }) {
  return { ...unit, latitude: Number(unit.latitude), longitude: Number(unit.longitude) };
}

function serializeReport(report: { id: string; ticketNumber: string; category: string; description: string; severity: string; status: string; latitude: unknown; longitude: unknown; createdAt: Date; updatedAt: Date; policeUnit?: { name: string; district: string } | null }) {
  return {
    ...report,
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    policeUnit: report.policeUnit ?? null,
  };
}

function publicReport(report: Parameters<typeof serializeReport>[0]) {
  const serialized = serializeReport(report);
  return {
    id: serialized.id,
    ticketNumber: serialized.ticketNumber,
    category: serialized.category,
    severity: serialized.severity,
    status: serialized.status,
    latitude: Number(serialized.latitude.toFixed(3)),
    longitude: Number(serialized.longitude.toFixed(3)),
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
    policeUnit: serialized.policeUnit,
  };
}

function ticketNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `GJ-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function createApp() {
  const app = express();
  const origins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,https://gardajakarta.my.id,https://app.gardajakarta.my.id")
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

  app.get("/api/public/assets/*splat", async (request, response) => {
    const segments = request.params.splat;
    const key = Array.isArray(segments) ? segments.join("/") : segments;
    if (!key || key.includes("..") || !key.startsWith("police-units/")) {
      return response.status(404).json({ error: "Asset tidak ditemukan." });
    }
    try {
      const image = await readImage(key);
      response.setHeader("Content-Type", image.contentType);
      response.setHeader("Cache-Control", image.cacheControl);
      // Police-unit photos are public API assets consumed by the separate FE origin.
      // Helmet's default same-origin CORP would make the browser drop these images.
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      return response.send(image.body);
    } catch {
      return response.status(404).json({ error: "Asset tidak ditemukan." });
    }
  });

  const readSession = async (request: Parameters<RequestHandler>[0]): Promise<AuthSession | null> => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    return session as AuthSession | null;
  };

  const requireSession: RequestHandler = async (request, response, next) => {
    const session = await readSession(request);
    if (!session) return response.status(401).json({ error: "Sesi tidak valid atau sudah berakhir." });
    response.locals.session = session;
    next();
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

  app.get("/api/public/map", async (_request, response) => {
    const [units, reports] = await Promise.all([
      prisma.policeUnit.findMany({ where: { isPublished: true }, orderBy: { name: "asc" } }),
      prisma.incidentReport.findMany({
        where: { status: { in: ["PENDING", "VERIFIED", "IN_PROGRESS", "RESOLVED"] } },
        orderBy: { updatedAt: "desc" },
        take: 200,
        include: { policeUnit: { select: { name: true, district: true } } },
      }),
    ]);
    response.json({ data: { units: units.map(serializePoliceUnit), reports: reports.map(publicReport), updatedAt: new Date().toISOString() } });
  });

  app.get("/api/dashboard", requireSession, async (_request, response) => {
    const session = response.locals.session as AuthSession;
    const role = normalizeRole(session.user.role);
    const operator = role === "polisi" ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { policeUnitId: true } }) : null;
    const where = role === "warga"
      ? { reporterId: session.user.id }
      : role === "polisi"
        ? { policeUnitId: operator?.policeUnitId ?? "__unassigned__", status: { not: "REJECTED" as const } }
        : {};
    const [reports, total, pending, inProgress, resolved, units] = await Promise.all([
      prisma.incidentReport.findMany({ where, orderBy: { updatedAt: "desc" }, take: 30, include: { policeUnit: { select: { name: true, district: true } } } }),
      prisma.incidentReport.count({ where }),
      prisma.incidentReport.count({ where: { ...where, status: "PENDING" } }),
      prisma.incidentReport.count({ where: { ...where, status: "IN_PROGRESS" } }),
      prisma.incidentReport.count({ where: { ...where, status: "RESOLVED" } }),
      prisma.policeUnit.findMany({ where: { isPublished: true }, orderBy: { name: "asc" } }),
    ]);
    const adminOverview = role === "admin"
      ? await Promise.all([
        prisma.user.count(),
        prisma.policeUnit.count({ where: { isPublished: true } }),
        prisma.auditLog.count(),
        prisma.incidentReport.findMany({ select: { category: true }, orderBy: { updatedAt: "desc" }, take: 1000 }),
      ]).then(([users, publishedUnits, auditLogs, categoryRows]) => {
        const categoryCounts = new Map<string, number>();
        categoryRows.forEach(({ category }) => categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1));
        return { users, units: publishedUnits, auditLogs, categories: [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })) };
      })
      : undefined;
    response.json({ data: { role, reports: reports.map(serializeReport), stats: { total, pending, inProgress, resolved }, units: units.map(serializePoliceUnit), ...(adminOverview ? { adminOverview } : {}) } });
  });

  app.post("/api/reports", requireRole("warga"), async (request, response) => {
    const parsed = reportInput.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Data laporan belum lengkap atau tidak valid." });
    const session = response.locals.session as AuthSession;
    const units = await prisma.policeUnit.findMany({ where: { isPublished: true } });
    const nearest = units.sort((a, b) => {
      const distance = (unit: typeof a) => Math.hypot(Number(unit.latitude) - parsed.data.latitude, Number(unit.longitude) - parsed.data.longitude);
      return distance(a) - distance(b);
    })[0];
    const report = await prisma.incidentReport.create({
      data: { ...parsed.data, ticketNumber: ticketNumber(), reporterId: session.user.id, policeUnitId: nearest?.id },
      include: { policeUnit: { select: { name: true, district: true } } },
    });
    await prisma.auditLog.create({ data: { actor: session.user.id, operation: "REPORT_SUBMITTED", resourceId: report.id, reason: "Warga mengirim laporan keamanan." } });
    response.status(201).json({ data: serializeReport(report) });
  });

  app.get("/api/reports/mine", requireRole("warga"), async (_request, response) => {
    const session = response.locals.session as AuthSession;
    const reports = await prisma.incidentReport.findMany({ where: { reporterId: session.user.id }, orderBy: { createdAt: "desc" }, include: { policeUnit: { select: { name: true, district: true } } } });
    response.json({ data: reports.map(serializeReport) });
  });

  app.patch("/api/police/reports/:id/status", requireRole("polisi"), async (request, response) => {
    const parsed = z.object({ status: z.enum(["VERIFIED", "IN_PROGRESS", "RESOLVED", "REJECTED"]) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Status laporan tidak valid." });
    const reportId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const session = response.locals.session as AuthSession;
    const operator = await prisma.user.findUnique({ where: { id: session.user.id }, select: { policeUnitId: true } });
    const existing = await prisma.incidentReport.findFirst({ where: { id: reportId, policeUnitId: operator?.policeUnitId ?? "__unassigned__" } });
    if (!existing) return response.status(404).json({ error: "Laporan tidak ditemukan di unit Anda." });
    const report = await prisma.incidentReport.update({ where: { id: reportId }, data: { status: parsed.data.status }, include: { policeUnit: { select: { name: true, district: true } } } });
    await prisma.auditLog.create({ data: { actor: session.user.id, operation: "REPORT_STATUS_UPDATED", resourceId: report.id, reason: `Petugas memperbarui status menjadi ${parsed.data.status}.` } });
    response.json({ data: serializeReport(report) });
  });

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
