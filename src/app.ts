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
import swaggerUi from "swagger-ui-express";
import { openapiDocument } from "./openapi.js";
import { adminRouter } from "./modules/admin/routes.js";
import { categoryJson } from "./modules/admin/category-image.js";
import { reportRouter } from "./modules/reports/routes.js";

const reportInput = z.object({
  category: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(2000),
  severity: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  latitude: z.number().min(-7.2).max(-5.8),
  longitude: z.number().min(106.4).max(107.2),
});

function serializePoliceUnit(unit: { id: string; name: string; district: string; address: string; phone: string | null; latitude: unknown; longitude: unknown; photoUrl: string | null }) {
  return { ...unit, latitude: Number(unit.latitude), longitude: Number(unit.longitude) };
}

function serializeReport(report: { id: string; ticketNumber: string; category: string; description: string; severity: string; status: string; latitude: unknown; longitude: unknown; createdAt: Date; updatedAt: Date; policeUnit?: { name: string; district: string } | null; clarificationPrompt?: string | null; clarificationResponse?: string | null; clarificationRequestedAt?: Date | null; clarificationRespondedAt?: Date | null; activities?: Array<{ id: string; type: string; message: string; createdAt: Date }>; _count?: { votes: number; comments: number }; votes?: Array<{ voterId: string }> }) {
  return {
    id: report.id, ticketNumber: report.ticketNumber, category: report.category,
    description: report.description, status: report.status, severity: report.severity,
    createdAt: report.createdAt, updatedAt: report.updatedAt,
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    policeUnit: report.policeUnit ?? null,
    clarificationPrompt: report.clarificationPrompt ?? null,
    clarificationResponse: report.clarificationResponse ?? null,
    clarificationRequestedAt: report.clarificationRequestedAt ?? null,
    clarificationRespondedAt: report.clarificationRespondedAt ?? null,
    activities: report.activities?.map((activity) => ({ id: activity.id, type: activity.type, message: activity.message, createdAt: activity.createdAt })) ?? [],
    voteCount: report._count?.votes ?? 0,
    commentCount: report._count?.comments ?? 0,
    hasVoted: Boolean(report.votes?.length),
  };
}

const reportInteractionInclude = {
  policeUnit: { select: { name: true, district: true } },
  activities: { orderBy: { createdAt: "asc" as const }, select: { id: true, type: true, message: true, createdAt: true } },
  _count: { select: { votes: true, comments: true } },
} as const;

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

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument, { customSiteTitle: "Garda Jakarta API Docs", swaggerOptions: { persistAuthorization: true } }));
  app.get("/api/openapi.json", (_request, response) => response.json(openapiDocument));

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

  app.get("/api/public/categories", async (_request, response) => {
    response.json({ data: (await prisma.reportCategory.findMany({ orderBy: { createdAt: "asc" } })).map(categoryJson) });
  });
  app.get("/api/public/categories/:id/image", async (request, response) => {
    const category = await prisma.reportCategory.findUnique({ where: { id: String(request.params.id) } });
    if (!category?.imageKey) return void response.status(404).json({ error: "Foto kategori tidak ditemukan." });
    const file = await readImage(category.imageKey);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.setHeader("Cache-Control", "public, max-age=300");
    response.send(file.body);
  });

  app.get("/api/public/map", async (_request, response) => {
    const [units, reports] = await Promise.all([
      prisma.policeUnit.findMany({ where: { isPublished: true }, orderBy: { name: "asc" } }),
      prisma.incidentReport.findMany({
        where: { status: { in: ["PENDING", "VERIFIED", "IN_PROGRESS", "CLARIFICATION", "RESOLVED"] } },
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
      prisma.incidentReport.findMany({ where, orderBy: { updatedAt: "desc" }, take: 30, include: reportInteractionInclude }),
      prisma.incidentReport.count({ where }),
      prisma.incidentReport.count({ where: { ...where, status: "PENDING" } }),
      prisma.incidentReport.count({ where: { ...where, status: "IN_PROGRESS" } }),
      prisma.incidentReport.count({ where: { ...where, status: "RESOLVED" } }),
      prisma.policeUnit.findMany({ where: { isPublished: true }, orderBy: { name: "asc" } }),
    ]);
    const adminOverview = role === "admin"
      ? await (async () => {
        const [users, allUnits, auditLogs, reportsTotal, assignedPolice, categoryRows, statusRows, unitRows, categoriesTotal, trend] = await Promise.all([
          prisma.user.count(),
          prisma.policeUnit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, district: true, address: true, isPublished: true, _count: { select: { reports: true, staff: { where: { role: "POLISI" } } } } } }),
          prisma.auditLog.count(),
          prisma.incidentReport.count(),
          prisma.user.count({ where: { role: "POLISI", policeUnitId: { not: null } } }),
          prisma.incidentReport.groupBy({ by: ["category"], _count: { _all: true }, orderBy: { _count: { category: "desc" } } }),
          prisma.incidentReport.groupBy({ by: ["status"], _count: { _all: true } }),
          prisma.incidentReport.groupBy({ by: ["policeUnitId"], _count: { _all: true } }),
          prisma.reportCategory.count(),
          prisma.$queryRaw<Array<{ date: string; count: number }>>`
            WITH days AS (SELECT generate_series((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date - 29, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date, '1 day'::interval)::date AS day),
            counts AS (SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date AS day, COUNT(*)::int AS count FROM "IncidentReport" WHERE "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '31 days' GROUP BY 1)
            SELECT to_char(days.day, 'YYYY-MM-DD') AS date, COALESCE(counts.count, 0)::int AS count FROM days LEFT JOIN counts USING(day) ORDER BY days.day`,
        ]);
        const unitsById = new Map(allUnits.map((unit) => [unit.id, unit]));
        return {
          users,
          units: allUnits.length,
          publishedUnits: allUnits.filter((unit) => unit.isPublished).length,
          districts: new Set(allUnits.map((unit) => unit.district)).size,
          categoriesCount: categoriesTotal,
          reports: reportsTotal,
          assignedPolice,
          auditLogs,
          trend,
          categories: categoryRows.map((row) => ({ name: row.category, count: row._count._all })),
          statuses: statusRows.map((row) => ({ status: row.status, count: row._count._all })),
          unitsByReport: unitRows.map((row) => ({ name: unitsById.get(row.policeUnitId || "")?.name || "Belum dirutekan", count: row._count._all })).sort((a, b) => b.count - a.count),
          unitDirectory: allUnits.map(({ _count, ...unit }) => ({ ...unit, reports: _count.reports, staff: _count.staff })),
        };
      })()
      : undefined;
    const notifications = reports.flatMap((report) => report.activities.map((activity) => ({
      id: activity.id, title: activity.type === "SUBMITTED" ? "Laporan masuk" : "Pembaruan penanganan",
      body: report.ticketNumber + " - " + activity.message, createdAt: activity.createdAt.getTime(),
    }))).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    response.json({ data: { role, notifications, reports: reports.map(serializeReport), stats: { total, pending, inProgress, resolved }, units: units.map(serializePoliceUnit), ...(adminOverview ? { adminOverview } : {}) } });
  });

  app.use("/api/admin", adminRouter(origins));

  app.get("/api/reports/feed", requireSession, async (request, response) => {
    const session = response.locals.session as AuthSession;
    const role = normalizeRole(session.user.role);
    const parsed = z.object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      search: z.string().trim().max(100).default(""),
      status: z.enum(["PENDING", "VERIFIED", "IN_PROGRESS", "CLARIFICATION", "RESOLVED", "REJECTED"]).optional(),
    }).safeParse(request.query);
    if (!parsed.success) return response.status(400).json({ error: "Filter laporan tidak valid." });
    const { page, limit, search, status } = parsed.data;
    const operator = role === "polisi" ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { policeUnitId: true } }) : null;
    const where: Prisma.IncidentReportWhereInput = role === "warga" ? { reporterId: session.user.id } : role === "polisi" ? { policeUnitId: operator?.policeUnitId ?? "__unassigned__", status: { not: "REJECTED" as const } } : {
      ...(status ? { status } : {}),
      ...(search ? { OR: ["category", "ticketNumber", "description"].map((field) => ({ [field]: { contains: search, mode: "insensitive" } })) } : {}),
    };
    const rows = await prisma.incidentReport.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit + 1, include: reportInteractionInclude });
    const hasMore = rows.length > limit;
    response.json({ data: { reports: rows.slice(0, limit).map(serializeReport), page, limit, hasMore } });
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
      data: { ...parsed.data, ticketNumber: ticketNumber(), reporterId: session.user.id, policeUnitId: nearest?.id, activities: { create: { actorId: session.user.id, actorRole: "WARGA", type: "SUBMITTED", status: "PENDING", message: "Laporan dibuat oleh warga." } } },
      include: reportInteractionInclude,
    });
    await prisma.auditLog.create({ data: { actor: session.user.id, operation: "REPORT_SUBMITTED", resourceId: report.id, reason: "Warga mengirim laporan keamanan." } });
    response.status(201).json({ data: serializeReport(report) });
  });

  app.get("/api/reports/mine", requireRole("warga"), async (_request, response) => {
    const session = response.locals.session as AuthSession;
    const reports = await prisma.incidentReport.findMany({ where: { reporterId: session.user.id }, orderBy: { createdAt: "desc" }, include: reportInteractionInclude });
    response.json({ data: reports.map(serializeReport) });
  });

  app.use("/api", reportRouter(origins));

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
