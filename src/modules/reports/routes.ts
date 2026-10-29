import { Router, type ErrorRequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "../../auth.js";
import { prisma } from "../../prisma.js";
import { readImage, uploadImage, storageConfigured } from "../../storage.js";
import { canManage, canRead, canReadPrivate, transitions, type Viewer } from "./policy.js";

class ReportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const input = z.object({
  message: z.string().trim().min(4).max(2000),
  evidenceIds: z.array(z.string().min(1).max(100)).max(3).default([]),
});
const statusInput = input.extend({ status: z.enum(["VERIFIED", "IN_PROGRESS", "CLARIFICATION", "RESOLVED", "REJECTED"]) });
const pagination = z.coerce.number().int().min(1).max(10000).default(1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });

export function reportRouter(origins: string[]) {
  const router = Router();
  router.use(["/reports/:id/interactions", "/reports/:id/vote", "/reports/:id/comments", "/reports/:id/clarification", "/reports/:id/evidence", "/police/reports/:id/status", "/police/reports/:id/clarification"], async (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin && !origins.includes(req.headers.origin)) throw new ReportError(403, "Asal permintaan tidak diizinkan.");
      if (req.headers["sec-fetch-site"] === "cross-site" && !req.headers.origin) throw new ReportError(403, "Asal permintaan tidak diizinkan.");
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    res.locals.viewer = session ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, policeUnitId: true } }) : null;
    if (req.method !== "GET" && !res.locals.viewer) throw new ReportError(401, "Silakan masuk untuk melanjutkan.");
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, limit: 60, skip: (req) => req.method === "GET", standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Terlalu banyak permintaan. Coba sebentar lagi." } }));

  async function readable(id: string, viewer: Viewer | null) {
    const report = await prisma.incidentReport.findUnique({ where: { id } });
    if (!report || !canRead(report, viewer)) throw new ReportError(404, "Laporan tidak ditemukan.");
    return report;
  }

  router.get("/reports/:id/interactions", async (req, res) => {
    const viewer = res.locals.viewer as Viewer | null;
    const report = await readable(String(req.params.id), viewer);
    const pageResult = pagination.safeParse(req.query.page);
    if (!pageResult.success) throw new ReportError(400, "Halaman tidak valid.");
    const page = pageResult.data;
    const privateAccess = canReadPrivate(report, viewer);
    const [activities, comments, voteCount, vote, activityCount, commentCount] = await Promise.all([
      prisma.reportActivity.findMany({ where: { reportId: report.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20, include: { evidence: { select: { id: true } } } }),
      prisma.reportComment.findMany({ where: { reportId: report.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20, select: { id: true, body: true, createdAt: true } }),
      prisma.reportVote.count({ where: { reportId: report.id } }),
      viewer ? prisma.reportVote.findUnique({ where: { reportId_voterId: { reportId: report.id, voterId: viewer.id } }, select: { id: true } }) : null,
      prisma.reportActivity.count({ where: { reportId: report.id } }),
      prisma.reportComment.count({ where: { reportId: report.id } }),
    ]);
    res.json({ data: {
      status: report.status, voteCount, hasVoted: Boolean(vote), comments, page,
      hasMore: page * 20 < Math.max(activityCount, commentCount),
      canParticipate: viewer?.role === "WARGA" && report.status !== "REJECTED",
      canManage: canManage(report, viewer),
      canClarify: viewer?.id === report.reporterId && report.status === "CLARIFICATION",
      nextStatuses: canManage(report, viewer) ? transitions[report.status] : [],
      clarificationPrompt: privateAccess ? report.clarificationPrompt : null,
      clarificationResponse: privateAccess ? report.clarificationResponse : null,
      activities: activities.map((item) => ({
        id: item.id, type: item.type, status: item.status, createdAt: item.createdAt,
        message: privateAccess ? item.message : item.type === "CLARIFICATION_RECEIVED" ? "Pelapor mengirim klarifikasi untuk diperiksa petugas." : "Status penanganan diperbarui.",
        author: item.actorRole === "POLISI" ? "Petugas" : item.actorRole === "WARGA" ? "Pelapor anonim" : "Sistem",
        evidence: privateAccess ? item.evidence.map(({ id }) => ({ id, url: `/api/reports/${report.id}/evidence/${id}` })) : [],
      })),
    } });
  });

  router.post("/reports/:id/vote", async (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const report = await readable(String(req.params.id), viewer);
    if (viewer.role !== "WARGA" || report.status === "REJECTED") throw new ReportError(403, "Dukungan tidak tersedia untuk laporan ini.");
    await prisma.reportVote.upsert({ where: { reportId_voterId: { reportId: report.id, voterId: viewer.id } }, create: { reportId: report.id, voterId: viewer.id }, update: {} });
    res.json({ data: { voteCount: await prisma.reportVote.count({ where: { reportId: report.id } }), hasVoted: true } });
  });
  router.delete("/reports/:id/vote", async (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const report = await readable(String(req.params.id), viewer);
    await prisma.reportVote.deleteMany({ where: { reportId: report.id, voterId: viewer.id } });
    res.json({ data: { voteCount: await prisma.reportVote.count({ where: { reportId: report.id } }), hasVoted: false } });
  });
  router.post("/reports/:id/comments", async (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const report = await readable(String(req.params.id), viewer);
    if (viewer.role !== "WARGA" || report.status === "REJECTED") throw new ReportError(403, "Komentar tidak tersedia untuk laporan ini.");
    const parsed = z.object({ body: z.string().trim().min(2).max(500) }).safeParse(req.body);
    if (!parsed.success) throw new ReportError(400, "Isi komentar 2 sampai 500 karakter.");
    const comment = await prisma.reportComment.create({ data: { reportId: report.id, authorId: viewer.id, body: parsed.data.body }, select: { id: true, body: true, createdAt: true } });
    res.status(201).json({ data: comment });
  });

  router.post("/reports/:id/evidence", async (req, res, next) => {
    const report = await readable(String(req.params.id), res.locals.viewer);
    const viewer = res.locals.viewer as Viewer;
    if (!canManage(report, viewer) && !(viewer.id === report.reporterId && report.status === "CLARIFICATION")) throw new ReportError(403, "Anda tidak dapat mengunggah bukti untuk laporan ini.");
    if (["RESOLVED", "REJECTED"].includes(report.status)) throw new ReportError(409, "Laporan sudah ditutup.");
    if (!storageConfigured) throw new ReportError(503, "Penyimpanan bukti belum tersedia.");
    next();
  }, upload.single("image"), async (req, res) => {
    if (!req.file) throw new ReportError(400, "Pilih satu foto JPG, PNG, atau WebP, maksimal 5 MB.");
    let body: Buffer;
    try {
      const image = sharp(req.file.buffer, { limitInputPixels: 25_000_000 });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages ?? 1) > 1) throw new Error("Invalid image");
      body = await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch { throw new ReportError(400, "Foto tidak valid. Gunakan JPG, PNG, atau WebP."); }
    const reportId = String(req.params.id);
    const key = `report-evidence/${reportId}/${randomUUID()}.webp`;
    await uploadImage({ key, body, contentType: "image/webp" });
    const evidence = await prisma.reportEvidence.create({ data: { reportId, uploaderId: res.locals.viewer.id, key }, select: { id: true } });
    res.status(201).json({ data: evidence });
  });
  router.get("/reports/:id/evidence/:evidenceId", async (req, res) => {
    const viewer = res.locals.viewer as Viewer | null;
    const report = await readable(String(req.params.id), viewer);
    if (!canReadPrivate(report, viewer)) throw new ReportError(403, "Bukti hanya tersedia untuk pelapor dan petugas berwenang.");
    const evidence = await prisma.reportEvidence.findFirst({ where: { id: String(req.params.evidenceId), reportId: report.id, OR: [{ activityId: { not: null } }, { uploaderId: viewer!.id }] } });
    if (!evidence) throw new ReportError(404, "Bukti tidak ditemukan.");
    const file = await readImage(evidence.key);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(file.body);
  });

  router.patch(["/police/reports/:id/status", "/police/reports/:id/clarification"], async (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const parsed = statusInput.safeParse(req.path.endsWith("/clarification") ? { ...req.body, status: "CLARIFICATION", message: req.body.message ?? req.body.prompt } : req.body);
    if (!parsed.success) throw new ReportError(400, "Pilih status dan tulis catatan 4 sampai 2000 karakter.");
    const report = await readable(String(req.params.id), viewer);
    if (!canManage(report, viewer)) throw new ReportError(403, "Hanya petugas unit penanganan yang dapat mengubah laporan.");
    if (!transitions[report.status].includes(parsed.data.status)) throw new ReportError(409, "Perubahan status tidak tersedia. Muat ulang laporan.");
    if (parsed.data.status === "RESOLVED" && !parsed.data.evidenceIds.length) throw new ReportError(400, "Lampirkan foto bukti penyelesaian.");
    await recordChange(report, viewer, parsed.data, false);
    res.json({ data: { id: report.id, status: parsed.data.status } });
  });
  router.post("/reports/:id/clarification", async (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const parsed = input.safeParse({ ...req.body, message: req.body.message ?? req.body.response });
    if (!parsed.success) throw new ReportError(400, "Tulis klarifikasi 4 sampai 2000 karakter.");
    const report = await readable(String(req.params.id), viewer);
    if (viewer.role !== "WARGA" || report.reporterId !== viewer.id) throw new ReportError(403, "Hanya pelapor yang dapat memberikan klarifikasi.");
    if (report.status !== "CLARIFICATION") throw new ReportError(409, "Laporan tidak sedang menunggu klarifikasi.");
    await recordChange(report, viewer, { ...parsed.data, status: "PENDING" }, true);
    res.json({ data: { id: report.id, status: "PENDING" } });
  });

  async function recordChange(report: Awaited<ReturnType<typeof readable>>, viewer: Viewer, change: z.infer<typeof input> & { status: typeof report.status }, reply: boolean) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.incidentReport.updateMany({ where: { id: report.id, status: report.status, updatedAt: report.updatedAt }, data: {
        status: change.status, updatedAt: new Date(),
        ...(reply ? { clarificationResponse: change.message, clarificationRespondedAt: new Date() } : change.status === "CLARIFICATION" ? { clarificationPrompt: change.message, clarificationResponse: null, clarificationRequestedAt: new Date(), clarificationRespondedAt: null } : {}),
      } });
      if (updated.count !== 1) throw new ReportError(409, "Laporan sudah diperbarui. Muat ulang sebelum melanjutkan.");
      const activity = await tx.reportActivity.create({ data: { reportId: report.id, actorId: viewer.id, actorRole: viewer.role, status: change.status, type: reply ? "CLARIFICATION_RECEIVED" : change.status === "CLARIFICATION" ? "CLARIFICATION_REQUESTED" : "STATUS_CHANGED", message: change.message } });
      const ids = [...new Set(change.evidenceIds)];
      const attached = await tx.reportEvidence.updateMany({ where: { id: { in: ids }, reportId: report.id, uploaderId: viewer.id, activityId: null }, data: { activityId: activity.id } });
      if (attached.count !== ids.length) throw new ReportError(400, "Bukti tidak valid atau sudah digunakan.");
      await tx.auditLog.create({ data: { actor: viewer.id, operation: activity.type, resourceId: report.id, reason: `Status ${report.status} -> ${change.status}` } });
    });
  }
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof ReportError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof multer.MulterError) { res.status(400).json({ error: "Unggah satu foto, maksimal 5 MB." }); return; }
    next(error);
  };
  router.use(errorHandler);
  return router;
}
