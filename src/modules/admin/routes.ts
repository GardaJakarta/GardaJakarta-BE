import { Router, type ErrorRequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { hashPassword } from "better-auth/crypto";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "../../auth.js";
import { prisma } from "../../prisma.js";
import { transitions } from "../reports/policy.js";

class AdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const idInput = z.string().min(1).max(128);
const listInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(100).default(""),
  status: z.enum(["PENDING", "VERIFIED", "IN_PROGRESS", "CLARIFICATION", "RESOLVED", "REJECTED"]).optional(),
  role: z.enum(["WARGA", "POLISI", "ADMIN"]).optional(),
});
const unitInput = z.object({
  name: z.string().trim().min(2).max(120), district: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(240), phone: z.string().trim().max(40).nullable(),
  latitude: z.number().min(-7.2).max(-5.8), longitude: z.number().min(106.4).max(107.2),
  photoUrl: z.string().url().refine((url) => /^https?:\/\//.test(url)).nullable(), isPublished: z.boolean(),
}).strict();
const categoryInput = z.object({ name: z.string().trim().min(2).max(120) }).strict();
const userInput = z.object({
  name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254).toLowerCase(),
  password: z.string().min(12).max(128), role: z.enum(["WARGA", "POLISI", "ADMIN"]),
  policeUnitId: idInput.nullable(),
}).strict();
const userUpdate = userInput.omit({ email: true, password: true });
const reportInput = z.object({
  category: z.string().trim().min(2).max(120), description: z.string().trim().min(10).max(2000),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  latitude: z.number().min(-7.2).max(-5.8), longitude: z.number().min(106.4).max(107.2),
  policeUnitId: idInput.nullable(),
}).strict();
const reportCreate = reportInput.extend({ reporterId: idInput });
const reportUpdate = reportInput.extend({
  status: z.enum(["PENDING", "VERIFIED", "IN_PROGRESS", "CLARIFICATION", "RESOLVED", "REJECTED"]),
  message: z.string().trim().min(4).max(2000), updatedAt: z.string().datetime(),
  evidenceIds: z.array(idInput).max(3).default([]),
});
const userSelect = {
  id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true, policeUnitId: true,
  policeUnit: { select: { id: true, name: true } },
} as const;
const reportInclude = {
  policeUnit: { select: { id: true, name: true, district: true } },
  reporter: { select: { id: true, name: true, email: true } },
} as const;
const unitInclude = { _count: { select: { reports: true, staff: true } } } as const;
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
type Tx = Prisma.TransactionClient;
const audit = (tx: Tx, actor: string, operation: string, resourceId: string, reason: string) =>
  tx.auditLog.create({ data: { actor, operation, resourceId, reason } });
async function requireUnit(tx: Tx, id: string | null, published = false) {
  if (!id) return;
  const unit = await tx.policeUnit.findUnique({ where: { id } });
  if (!unit || (published && !unit.isPublished)) throw new AdminError(400, "Pilih unit polisi yang aktif.");
}
async function requireCategory(tx: Tx, name: string) {
  if (!await tx.reportCategory.findUnique({ where: { name } })) throw new AdminError(400, "Kategori tidak ditemukan. Muat ulang pilihan kategori.");
}
async function validateAssignment(tx: Tx, input: z.infer<typeof userUpdate>, exclude?: string) {
  if (input.role !== "POLISI") {
    if (input.policeUnitId) throw new AdminError(400, "Hanya akun polisi yang dapat ditugaskan ke unit.");
    return;
  }
  if (!input.policeUnitId) throw new AdminError(400, "Akun polisi harus terhubung ke unit.");
  await requireUnit(tx, input.policeUnitId, true);
  if (await tx.user.count({ where: { role: "POLISI", policeUnitId: input.policeUnitId, ...(exclude ? { id: { not: exclude } } : {}) } })) {
    throw new AdminError(409, "Unit ini sudah memiliki akun polisi. Pilih unit lain.");
  }
}
function unitJson(unit: Prisma.PoliceUnitGetPayload<{ include: typeof unitInclude }>) {
  const { _count, ...rest } = unit;
  return { ...rest, latitude: Number(unit.latitude), longitude: Number(unit.longitude), reports: _count.reports, staff: _count.staff };
}
function reportJson(report: Prisma.IncidentReportGetPayload<{ include: typeof reportInclude }>) {
  return { ...report, latitude: Number(report.latitude), longitude: Number(report.longitude) };
}

export function adminRouter(origins: string[]) {
  const router = Router();
  router.use(async (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      ((req.headers.origin && !origins.includes(req.headers.origin)) || (!req.headers.origin && req.headers["sec-fetch-site"] === "cross-site"))) {
      throw new AdminError(403, "Asal permintaan tidak diizinkan.");
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new AdminError(401, "Silakan masuk sebagai admin.");
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true } });
    if (actor?.role !== "ADMIN") throw new AdminError(403, "Akses hanya untuk admin.");
    res.locals.adminId = actor.id;
    next();
  });

  router.get("/users", async (req, res) => {
    const { page, limit, search, role } = listInput.parse(req.query);
    const where: Prisma.UserWhereInput = { ...(role ? { role } : {}), ...(search ? { OR: [
      { name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } },
    ] } : {}) };
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit, skip: (page - 1) * limit }),
      prisma.user.count({ where }),
    ]);
    res.json({ data: { items, users: items, total, page, hasMore: page * limit < total } });
  });
  router.get("/users/:id", async (req, res) => {
    const item = await prisma.user.findUnique({ where: { id: idInput.parse(req.params.id) }, select: userSelect });
    if (!item) throw new AdminError(404, "Pengguna tidak ditemukan.");
    res.json({ data: item });
  });
  router.post("/users", async (req, res) => {
    const { password, ...input } = userInput.parse(req.body);
    const passwordHash = await hashPassword(password);
    const result = await prisma.$transaction(async (tx) => {
      await validateAssignment(tx, input);
      const id = randomUUID();
      const item = await tx.user.create({ data: { ...input, id, emailVerified: false,
        accounts: { create: { id: randomUUID(), providerId: "credential", accountId: id, password: passwordHash } },
      }, select: userSelect });
      await audit(tx, res.locals.adminId, "ADMIN_USER_CREATED", id, "Akun dibuat melalui dashboard admin.");
      return item;
    }, serializable);
    res.status(201).json({ data: result });
  });
  router.patch("/users/:id", async (req, res) => {
    const id = idInput.parse(req.params.id), input = userUpdate.parse(req.body);
    if (id === res.locals.adminId && input.role !== "ADMIN") throw new AdminError(409, "Tidak dapat menurunkan peran akun sendiri.");
    const result = await prisma.$transaction(async (tx) => {
      await validateAssignment(tx, input, id);
      const old = await tx.user.findUnique({ where: { id } });
      if (!old) throw new AdminError(404, "Pengguna tidak ditemukan.");
      const item = await tx.user.update({ where: { id }, data: input, select: userSelect });
      if (old.role !== input.role || old.policeUnitId !== input.policeUnitId) await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, res.locals.adminId, "ADMIN_USER_UPDATED", id, "Profil atau penugasan akun diperbarui.");
      return item;
    }, serializable);
    res.json({ data: result });
  });
  router.delete("/users/:id", async (req, res) => {
    const id = idInput.parse(req.params.id);
    if (id === res.locals.adminId) throw new AdminError(409, "Akun yang sedang dipakai tidak dapat dihapus.");
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, include: { _count: { select: { reports: true, reportActivities: true, reportComments: true, reportEvidence: true, reportVotes: true } } } });
      if (!user) throw new AdminError(404, "Pengguna tidak ditemukan.");
      if (Object.values(user._count).some(Boolean)) throw new AdminError(409, "Akun memiliki laporan atau aktivitas penanganan dan tidak dapat dihapus.");
      await tx.user.delete({ where: { id } });
      await audit(tx, res.locals.adminId, "ADMIN_USER_DELETED", id, "Akun tanpa aktivitas dihapus.");
    }, serializable);
    res.json({ data: { id } });
  });

  router.get("/units", async (req, res) => {
    const { search, page, limit } = listInput.parse(req.query);
    const where: Prisma.PoliceUnitWhereInput = search ? { OR: ["name", "district", "address"].map((key) => ({ [key]: { contains: search, mode: "insensitive" } })) } : {};
    const [items, total] = await Promise.all([
      prisma.policeUnit.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], include: unitInclude, take: limit, skip: (page - 1) * limit }),
      prisma.policeUnit.count({ where }),
    ]);
    res.json({ data: { items: items.map(unitJson), total, page, hasMore: page * limit < total } });
  });
  router.get("/units/:id", async (req, res) => {
    const item = await prisma.policeUnit.findUnique({ where: { id: idInput.parse(req.params.id) }, include: unitInclude });
    if (!item) throw new AdminError(404, "Unit tidak ditemukan.");
    res.json({ data: unitJson(item) });
  });
  router.post("/units", async (req, res) => {
    const input = unitInput.parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      const unit = await tx.policeUnit.create({ data: { id: randomUUID(), ...input }, include: unitInclude });
      await audit(tx, res.locals.adminId, "ADMIN_UNIT_CREATED", unit.id, "Unit polisi dibuat.");
      return unit;
    });
    res.status(201).json({ data: unitJson(item) });
  });
  router.patch("/units/:id", async (req, res) => {
    const id = idInput.parse(req.params.id), input = unitInput.parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      const unit = await tx.policeUnit.update({ where: { id }, data: input, include: unitInclude });
      await audit(tx, res.locals.adminId, "ADMIN_UNIT_UPDATED", id, "Data unit polisi diperbarui.");
      return unit;
    });
    res.json({ data: unitJson(item) });
  });
  router.delete("/units/:id", async (req, res) => {
    const id = idInput.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const unit = await tx.policeUnit.findUnique({ where: { id }, include: unitInclude });
      if (!unit) throw new AdminError(404, "Unit tidak ditemukan.");
      if (unit._count.reports || unit._count.staff) throw new AdminError(409, "Pindahkan petugas dan laporan sebelum menghapus unit ini.");
      await tx.policeUnit.delete({ where: { id } });
      await audit(tx, res.locals.adminId, "ADMIN_UNIT_DELETED", id, "Unit tanpa penugasan dihapus.");
    }, serializable);
    res.json({ data: { id } });
  });

  router.get("/categories", async (req, res) => {
    const { search, page, limit } = listInput.parse(req.query);
    const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};
    const [items, total, counts] = await Promise.all([
      prisma.reportCategory.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
      prisma.reportCategory.count({ where }), prisma.incidentReport.groupBy({ by: ["category"], _count: { _all: true } }),
    ]);
    const countMap = new Map(counts.map((row) => [row.category, row._count._all]));
    res.json({ data: { items: items.map((item) => ({ ...item, reports: countMap.get(item.name) || 0 })), total, page, hasMore: page * limit < total } });
  });
  router.get("/categories/:id", async (req, res) => {
    const item = await prisma.reportCategory.findUnique({ where: { id: idInput.parse(req.params.id) } });
    if (!item) throw new AdminError(404, "Kategori tidak ditemukan.");
    res.json({ data: { ...item, reports: await prisma.incidentReport.count({ where: { category: item.name } }) } });
  });
  router.post("/categories", async (req, res) => {
    const input = categoryInput.parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      const category = await tx.reportCategory.create({ data: { id: randomUUID(), ...input } });
      await audit(tx, res.locals.adminId, "ADMIN_CATEGORY_CREATED", category.id, "Kategori dibuat.");
      return category;
    });
    res.status(201).json({ data: { ...item, reports: 0 } });
  });
  router.patch("/categories/:id", async (req, res) => {
    const id = idInput.parse(req.params.id), input = categoryInput.parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      const old = await tx.reportCategory.findUnique({ where: { id } });
      if (!old) throw new AdminError(404, "Kategori tidak ditemukan.");
      const category = await tx.reportCategory.update({ where: { id }, data: input });
      await tx.incidentReport.updateMany({ where: { category: old.name }, data: { category: input.name } });
      const reports = await tx.incidentReport.count({ where: { category: input.name } });
      await audit(tx, res.locals.adminId, "ADMIN_CATEGORY_UPDATED", id, "Nama kategori dan laporan terkait diperbarui.");
      return { ...category, reports };
    }, serializable);
    res.json({ data: item });
  });
  router.delete("/categories/:id", async (req, res) => {
    const id = idInput.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const item = await tx.reportCategory.findUnique({ where: { id } });
      if (!item) throw new AdminError(404, "Kategori tidak ditemukan.");
      if (await tx.incidentReport.count({ where: { category: item.name } })) throw new AdminError(409, "Kategori masih digunakan laporan dan tidak dapat dihapus.");
      await tx.reportCategory.delete({ where: { id } });
      await audit(tx, res.locals.adminId, "ADMIN_CATEGORY_DELETED", id, "Kategori tidak terpakai dihapus.");
    }, serializable);
    res.json({ data: { id } });
  });

  router.get("/reports", async (req, res) => {
    const { search, status, page, limit } = listInput.parse(req.query);
    const where: Prisma.IncidentReportWhereInput = { ...(status ? { status } : {}), ...(search ? { OR: ["ticketNumber", "category", "description"].map((key) => ({ [key]: { contains: search, mode: "insensitive" } })) } : {}) };
    const [items, total] = await Promise.all([
      prisma.incidentReport.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: limit, skip: (page - 1) * limit, include: reportInclude }),
      prisma.incidentReport.count({ where }),
    ]);
    res.json({ data: { items: items.map(reportJson), total, page, hasMore: page * limit < total } });
  });
  router.get("/reports/:id", async (req, res) => {
    const item = await prisma.incidentReport.findUnique({ where: { id: idInput.parse(req.params.id) }, include: reportInclude });
    if (!item) throw new AdminError(404, "Laporan tidak ditemukan.");
    res.json({ data: reportJson(item) });
  });
  router.post("/reports", async (req, res) => {
    const input = reportCreate.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      await requireCategory(tx, input.category);
      await requireUnit(tx, input.policeUnitId, true);
      const reporter = await tx.user.findUnique({ where: { id: input.reporterId } });
      if (reporter?.role !== "WARGA") throw new AdminError(400, "Pilih akun warga sebagai pelapor.");
      const item = await tx.incidentReport.create({ data: { ...input, id: randomUUID(), ticketNumber: randomUUID().toUpperCase(), status: "PENDING",
        activities: { create: { actorId: res.locals.adminId, actorRole: "ADMIN", type: "SUBMITTED", status: "PENDING", message: "Laporan dicatat oleh admin atas nama pelapor." } },
      }, include: reportInclude });
      await audit(tx, res.locals.adminId, "ADMIN_REPORT_CREATED", item.id, "Laporan dicatat melalui dashboard admin.");
      return item;
    }, serializable);
    res.status(201).json({ data: reportJson(result) });
  });
  router.patch("/reports/:id", async (req, res) => {
    const id = idInput.parse(req.params.id), { message, updatedAt, evidenceIds, ...input } = reportUpdate.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const old = await tx.incidentReport.findUnique({ where: { id } });
      if (!old) throw new AdminError(404, "Laporan tidak ditemukan.");
      if (old.updatedAt.toISOString() !== updatedAt) throw new AdminError(409, "Laporan sudah berubah. Tutup dan buka kembali detail sebelum menyimpan.");
      await requireCategory(tx, input.category);
      await requireUnit(tx, input.policeUnitId, input.policeUnitId !== old.policeUnitId);
      if (old.status !== input.status && !transitions[old.status].includes(input.status)) throw new AdminError(409, "Transisi status tidak tersedia.");
      if (old.status !== input.status && input.status === "RESOLVED" && !evidenceIds.length) throw new AdminError(400, "Lampirkan foto bukti penyelesaian.");
      const result = await tx.incidentReport.updateMany({ where: { id, updatedAt: old.updatedAt }, data: { ...input,
        ...(old.status !== input.status && input.status === "CLARIFICATION" ? { clarificationPrompt: message, clarificationResponse: null, clarificationRequestedAt: new Date(), clarificationRespondedAt: null } : {}),
      } });
      if (result.count !== 1) throw new AdminError(409, "Laporan sudah berubah. Muat ulang detail.");
      const activity = await tx.reportActivity.create({ data: { reportId: id, actorId: res.locals.adminId, actorRole: "ADMIN", type: "ADMIN_UPDATE", status: input.status, message } });
      const ids = [...new Set(evidenceIds)];
      const attached = await tx.reportEvidence.updateMany({ where: { id: { in: ids }, reportId: id, uploaderId: res.locals.adminId, activityId: null, commentId: null }, data: { activityId: activity.id } });
      if (attached.count !== ids.length) throw new AdminError(400, "Bukti tidak valid atau sudah digunakan.");
      await audit(tx, res.locals.adminId, "ADMIN_REPORT_UPDATED", id, `Status ${old.status} -> ${input.status}; unit ${old.policeUnitId ?? "-"} -> ${input.policeUnitId ?? "-"}.`);
      return tx.incidentReport.findUniqueOrThrow({ where: { id }, include: reportInclude });
    }, serializable);
    res.json({ data: reportJson(result) });
  });
  router.delete("/reports/:id", async (req, res) => {
    const id = idInput.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      await tx.incidentReport.delete({ where: { id } });
      await audit(tx, res.locals.adminId, "ADMIN_REPORT_DELETED", id, "Laporan dan interaksi terkait dihapus oleh admin.");
    });
    res.json({ data: { id } });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AdminError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Data tidak valid. Periksa kolom wajib dan batas input.", fields: error.issues.map((issue) => issue.path.join(".")) }); return; }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") { res.status(409).json({ error: "Email atau nama kategori sudah terdaftar." }); return; }
      if (error.code === "P2025") { res.status(404).json({ error: "Data tidak ditemukan." }); return; }
      if (["P2003", "P2034"].includes(error.code)) { res.status(409).json({ error: "Data terkait berubah atau masih digunakan. Muat ulang dan coba lagi." }); return; }
    }
    next(error);
  };
  router.use(errorHandler);
  return router;
}
