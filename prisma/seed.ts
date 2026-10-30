import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { storageConfigured, uploadImage } from "../src/storage.js";

const prisma = new PrismaClient();

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randomPassword() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

const policeUnits = [
  ["polda-metro-jaya", "Polda Metro Jaya", "Jakarta Selatan", "Jl. Jenderal Sudirman No. 55, Senayan", "021-5234001", -6.2132, 106.8294, "https://images.unsplash.com/photo-1577412647305-991150c7d163?auto=format&fit=crop&w=900&q=80"],
  ["polres-jakarta-pusat", "Polres Metro Jakarta Pusat", "Jakarta Pusat", "Jl. Kramat Raya No. 61, Senen", "021-3909922", -6.1788, 106.8332, "https://images.unsplash.com/photo-1577412647305-991150c7d163?auto=format&fit=crop&w=900&q=80"],
  ["polres-jakarta-selatan", "Polres Metro Jakarta Selatan", "Jakarta Selatan", "Jl. Wijaya II No. 42, Kebayoran Baru", "021-7206004", -6.2426, 106.7974, "https://images.unsplash.com/photo-1584551246679-0daf3d275d0f?auto=format&fit=crop&w=900&q=80"],
  ["polres-jakarta-barat", "Polres Metro Jakarta Barat", "Jakarta Barat", "Jl. Letjen S. Parman No. 31, Palmerah", "021-5300330", -6.1681, 106.7584, "https://images.unsplash.com/photo-1580974852861-c381510bc98a?auto=format&fit=crop&w=900&q=80"],
  ["polres-jakarta-utara", "Polres Metro Jakarta Utara", "Jakarta Utara", "Jl. Yos Sudarso No. 1, Tanjung Priok", "021-43931070", -6.1377, 106.8724, "https://images.unsplash.com/photo-1584551246679-0daf3d275d0f?auto=format&fit=crop&w=900&q=80"],
  ["polres-jakarta-timur", "Polres Metro Jakarta Timur", "Jakarta Timur", "Jl. Matraman Raya No. 224, Jatinegara", "021-8191476", -6.2296, 106.9006, "https://images.unsplash.com/photo-1564399579883-451a5d44ec08?auto=format&fit=crop&w=900&q=80"],
  ["polsek-menteng", "Polsek Menteng", "Jakarta Pusat", "Jl. Sutan Syahrir No. 1, Menteng", "021-31925149", -6.1951, 106.8321, "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80"],
  ["polsek-tanah-abang", "Polsek Tanah Abang", "Jakarta Pusat", "Jl. K.H. Mas Mansyur No. 17, Tanah Abang", "021-5703401", -6.2078, 106.8114, "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=80"],
  ["polsek-kebayoran-baru", "Polsek Kebayoran Baru", "Jakarta Selatan", "Jl. Kyai Maja No. 1, Kebayoran Baru", "021-7393431", -6.2445, 106.7998, "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=80"],
  ["polsek-tanjung-priok", "Polsek Tanjung Priok", "Jakarta Utara", "Jl. Gorontalo Raya No. 1, Tanjung Priok", "021-43930045", -6.1259, 106.8802, "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80"],
] as const;

async function seedPoliceImage(unitId: string, sourceUrl: string) {
  const publicApiUrl = (process.env.BETTER_AUTH_URL || "http://localhost:4000").replace(/\/+$/, "");
  const key = `police-units/${unitId}.jpg`;
  if (!storageConfigured) {
    if (process.env.NODE_ENV === "production") throw new Error("S3 storage belum dikonfigurasi untuk seed production.");
    return sourceUrl;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Gagal mengambil foto unit ${unitId}.`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error(`Sumber foto unit ${unitId} bukan gambar.`);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > 10 * 1024 * 1024) throw new Error(`Foto unit ${unitId} melebihi batas 10 MB.`);
  await uploadImage({ key, body, contentType });
  return `${publicApiUrl}/api/public/assets/${key}`;
}

async function main() {
  for (const [id, name, district, address, phone, latitude, longitude, sourceUrl] of policeUnits) {
    const photoUrl = await seedPoliceImage(id, sourceUrl);
    await prisma.policeUnit.upsert({
      where: { id },
      update: { name, district, address, phone, latitude, longitude, photoUrl, isPublished: true },
      create: { id, name, district, address, phone, latitude, longitude, photoUrl, isPublished: true },
    });
  }

  const credentialPath = "secrets/gardajakarta-seed-credentials.txt";
  const previousPasswords = new Map<string, string>();
  try {
    const previous = await readFile(credentialPath, "utf8");
    for (const line of previous.split("\n")) {
      const parts = line.split(" | ");
      if (parts.length === 4 && parts[2]?.includes("@") && parts[3]) previousPasswords.set(parts[2], parts[3]);
    }
  } catch { /* First seed run has no credential note yet. */ }
  const credentials: string[] = [
    "Garda Jakarta seeded operational accounts",
    `Generated: ${new Date().toISOString()}`,
    "Akun polisi adalah akun operasional per unit, bukan identitas personal. Keep this file private and rotate these passwords after first login.",
    "",
  ];

  for (const [unitId, unitName] of policeUnits) {
    const slug = unitId.replace(/^polres-|^polsek-|^polda-/, "");
    const email = `petugas.${slug}@gardajakarta.my.id`;
    const existing = await prisma.user.findUnique({ where: { email } });
    const password = existing ? null : randomPassword();
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { name: `Operator ${unitName}`, role: "POLISI", policeUnitId: unitId, emailVerified: true } })
      : await prisma.user.create({ data: { id: randomUUID(), name: `Operator ${unitName}`, email, role: "POLISI", policeUnitId: unitId, emailVerified: true } });

    if (password) {
      await prisma.account.create({ data: { id: randomUUID(), accountId: user.id, providerId: "credential", userId: user.id, password: await hashPassword(password) } });
      credentials.push(`POLISI | ${user.name} | ${email} | ${password}`);
    } else {
      credentials.push(`POLISI | ${user.name} | ${email} | ${previousPasswords.get(email) || "EXISTING_PASSWORD_NOT_REGENERATED"}`);
    }
  }

  const adminEmail = "admin.operasional@gardajakarta.my.id";
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const adminPassword = existingAdmin ? null : randomPassword();
  const admin = existingAdmin
    ? await prisma.user.update({ where: { id: existingAdmin.id }, data: { name: "Admin Operasional Garda Jakarta", role: "ADMIN", emailVerified: true } })
    : await prisma.user.create({ data: { id: randomUUID(), name: "Admin Operasional Garda Jakarta", email: adminEmail, role: "ADMIN", emailVerified: true } });
  if (adminPassword) {
    await prisma.account.create({ data: { id: randomUUID(), accountId: admin.id, providerId: "credential", userId: admin.id, password: await hashPassword(adminPassword) } });
    credentials.push(`ADMIN | ${admin.name} | ${adminEmail} | ${adminPassword}`);
  } else {
    credentials.push(`ADMIN | ${admin.name} | ${adminEmail} | ${previousPasswords.get(adminEmail) || "EXISTING_PASSWORD_NOT_REGENERATED"}`);
  }

  const seedUser = await prisma.user.upsert({
    where: { email: "warga.jakarta@gardajakarta.my.id" },
    update: { name: "Raka Pratama", role: "WARGA", emailVerified: true },
    create: { id: randomUUID(), name: "Raka Pratama", email: "warga.jakarta@gardajakarta.my.id", role: "WARGA", emailVerified: true },
  });
  const seedDay = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const seededReports = [
    ["8f4a7c2e-3d91-4e6b-9b52-1c7a8f0d2e34", `GJ-${seedDay}-0001`, "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Lampu jalan mati di sekitar jalur pedestrian.", "P2", "VERIFIED", -6.1944, 106.8229, "polsek-menteng"],
    ["2b9d6e41-7f03-4a8c-b5d2-9e1f6c3a8b70", `GJ-${seedDay}-0002`, "Tawuran atau kerumunan berbahaya", "Terlihat kerumunan mencurigakan di dekat area parkir.", "P1", "IN_PROGRESS", -6.1978, 106.8264, "polsek-menteng"],
    ["c6e2a914-5b78-46d0-8f31-7a4c9e2b6d05", `GJ-${seedDay}-0003`, "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Penerangan area publik perlu diperiksa karena mengganggu keamanan malam hari.", "P3", "PENDING", -6.1919, 106.8278, "polsek-menteng"],
    ["d1a83f56-0c29-4b7e-a642-5f9d2c8b1e73", `GJ-${seedDay}-0004`, "Pencurian atau kehilangan barang", "Laporan kehilangan di area transit yang sudah selesai ditangani.", "P2", "RESOLVED", -6.1958, 106.8198, "polsek-menteng"],
    ["a7f1c4e8-2b63-4d90-9f15-6c8e3a2b7d41", "GJ-A7F1C4E8", "Pelecehan verbal atau catcalling", "Warga melaporkan pelecehan verbal berulang di akses pejalan kaki malam hari.", "P1", "PENDING", -6.2052, 106.8231, "polsek-tanah-abang"],
    ["b4c8e2f6-9137-4a5d-b0e2-7c1f6d9a3e85", "GJ-B4C8E2F6", "Pencurian atau perampasan", "Tas warga dirampas saat keluar dari area parkir pusat perbelanjaan.", "P1", "VERIFIED", -6.2241, 106.8017, "polsek-kebayoran-baru"],
    ["c9d2a7f4-5e81-4b36-8c0d-1a6f9e2b7354", "GJ-C9D2A7F4", "Kekerasan fisik", "Terjadi keributan antar pengunjung di depan tempat makan dan perlu pemeriksaan petugas.", "P1", "IN_PROGRESS", -6.2297, 106.8064, "polres-jakarta-selatan"],
    ["d6e3b8a1-7f42-4c95-901d-2b6a8e5f3c74", "GJ-D6E3B8A1", "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Lampu penerangan di jembatan penyeberangan padam selama beberapa malam.", "P2", "CLARIFICATION", -6.1834, 106.8392, "polres-jakarta-pusat"],
    ["e1a5c9f3-6b27-4d80-8f14-3c7e2a9b5d68", "GJ-E1A5C9F3", "Penipuan atau pemerasan", "Warga menerima permintaan pembayaran mencurigakan dari nomor yang mengaku petugas.", "P1", "VERIFIED", -6.1712, 106.7543, "polres-jakarta-barat"],
    ["f8b2d6a4-0c93-4e71-9a25-6d3f8b1c7e42", "GJ-F8B2D6A4", "Tawuran atau kerumunan berbahaya", "Kerumunan remaja memenuhi akses jalan dan mengganggu kendaraan sekitar.", "P0", "IN_PROGRESS", -6.2184, 106.9008, "polres-jakarta-timur"],
    ["a3e7c1f9-5b64-4d28-8a90-2f6c9e1b7d35", "GJ-A3E7C1F9", "Begal atau perampokan", "Pengendara melaporkan percobaan perampasan di ruas jalan yang minim penerangan.", "P0", "PENDING", -6.1458, 106.8781, "polres-jakarta-utara"],
    ["b9f4d2a6-8c17-4e53-90e1-7a3f6b2d5c84", "GJ-B9F4D2A6", "Pelecehan atau kekerasan seksual", "Petugas menerima laporan dugaan pelecehan di area halte yang ramai.", "P1", "CLARIFICATION", -6.2106, 106.8215, "polda-metro-jaya"],
    ["c5a8e3f1-7d29-4b60-9f42-1e6c8a3d5b74", "GJ-C5A8E3F1", "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Penutup saluran dan pagar pembatas rusak di jalur publik dekat sekolah.", "P2", "RESOLVED", -6.1968, 106.8294, "polsek-menteng"],
    ["d2f7b4a9-6c31-4e85-90a2-8b5d1f3c7e64", "GJ-D2F7B4A9", "Pencurian atau perampasan", "Sepeda warga hilang dari area parkir yang tidak memiliki penerangan cukup.", "P2", "VERIFIED", -6.2118, 106.8146, "polsek-tanah-abang"],
    ["e8c3a6f2-1b57-4d90-9e24-7a5f2c8b6d13", "GJ-E8C3A6F2", "Kekerasan fisik", "Warga meminta bantuan setelah perselisihan di area olahraga berubah menjadi perkelahian.", "P1", "PENDING", -6.2451, 106.7987, "polsek-kebayoran-baru"],
    ["f4a9d1c7-3e68-4b25-80f2-6c7a5e9b2d14", "GJ-F4A9D1C7", "Penipuan atau pemerasan", "Pelaku meminta uang kepada pedagang dengan alasan biaya keamanan lingkungan.", "P1", "IN_PROGRESS", -6.1776, 106.8324, "polres-jakarta-pusat"],
    ["a6d1f8c4-9b35-4e72-80a6-2c7f5d3b1e94", "GJ-A6D1F8C4", "Lainnya", "Warga menemukan pintu akses fasilitas umum dirusak dan meminta pemeriksaan lokasi.", "P3", "RESOLVED", -6.1662, 106.7598, "polres-jakarta-barat"],
    ["b2e7c5a1-4d86-4f39-90b2-6c1a8e3d5f74", "GJ-B2E7C5A1", "Tawuran atau kerumunan berbahaya", "Kerumunan kendaraan berhenti di bahu jalan dan menghambat jalur ambulans.", "P1", "VERIFIED", -6.2285, 106.8951, "polres-jakarta-timur"],
    ["c8f3a1d6-7b24-4e90-85c1-2a6d9f4b3e71", "GJ-C8F3A1D6", "Begal atau perampokan", "Saksi melihat percobaan perampasan telepon genggam di sekitar terminal.", "P0", "PENDING", -6.1328, 106.8716, "polres-jakarta-utara"],
    ["d4a8e2f7-1c63-4b95-90d1-7e5f3a6c8b24", "GJ-D4A8E2F7", "Pelecehan verbal atau catcalling", "Laporan catcalling disampaikan oleh beberapa pengguna ruang publik yang sama.", "P2", "IN_PROGRESS", -6.2157, 106.8274, "polda-metro-jaya"],
    ["e9b5c2a8-6d31-4f74-80e2-1c7a5f3b9d64", "GJ-E9B5C2A8", "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Lampu taman dan kamera pengawas tidak aktif di area ruang terbuka.", "P2", "PENDING", -6.2029, 106.8173, "polsek-menteng"],
    ["f1c6a9d3-8b42-4e75-90a1-2d7f5c3b6e84", "GJ-F1C6A9D3", "Pencurian atau perampasan", "Barang bawaan tertinggal dan diduga diambil saat antrean transportasi umum.", "P2", "CLARIFICATION", -6.2084, 106.8098, "polsek-tanah-abang"],
    ["a8d4f2c7-1e63-4b95-90a6-7c3f5d9b2e14", "GJ-A8D4F2C7", "Kekerasan fisik", "Petugas keamanan meminta dukungan untuk menangani konflik antar pengunjung.", "P1", "VERIFIED", -6.2392, 106.8025, "polsek-kebayoran-baru"],
    ["b5e9c1a6-7d32-4f80-92c4-1a6f3e8b5d74", "GJ-B5E9C1A6", "Penipuan atau pemerasan", "Warga melaporkan modus pembayaran palsu saat transaksi barang secara langsung.", "P2", "RESOLVED", -6.1817, 106.8361, "polres-jakarta-pusat"],
    ["c1f7a4d8-9b35-4e62-80c1-6d3f5a2b7e94", "GJ-C1F7A4D8", "Tawuran atau kerumunan berbahaya", "Aktivitas kelompok di bawah jembatan membuat warga menghindari jalur tersebut.", "P1", "IN_PROGRESS", -6.1628, 106.7664, "polres-jakarta-barat"],
    ["d7a2e9c5-4b61-4f83-90d2-1c6f8a3e5b74", "GJ-D7A2E9C5", "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Penerangan gang sempit mati dan warga meminta penanganan unit setempat.", "P3", "VERIFIED", -6.2261, 106.9077, "polres-jakarta-timur"],
    ["e3c8f1a6-7d24-4b95-90e1-5a2f6c3d8b74", "GJ-E3C8F1A6", "Begal atau perampokan", "Pengemudi ojek online melaporkan percobaan pemblokiran jalan pada malam hari.", "P0", "PENDING", -6.1424, 106.8846, "polres-jakarta-utara"],
    ["f6b1d8a4-3c75-4e92-80a6-1f7c5d2b9e64", "GJ-F6B1D8A4", "Pelecehan atau kekerasan seksual", "Laporan dugaan pelecehan diterima dari area transportasi yang padat.", "P1", "CLARIFICATION", -6.2173, 106.8246, "polda-metro-jaya"],
  ] as const;
  const categoryNames = [...new Set(seededReports.map(([, , category]) => category))];
  for (const name of categoryNames) await prisma.reportCategory.upsert({ where: { name }, update: {}, create: { id: randomUUID(), name } });
  await prisma.incidentReport.deleteMany({ where: { id: { in: ["seed-report-1", "seed-report-2", "seed-report-3", "seed-report-4"] } } });
  for (const [id, , category, description, severity, status, latitude, longitude, policeUnitId] of seededReports) {
    const ticketNumber = id.toUpperCase();
    await prisma.incidentReport.upsert({
      where: { id },
      update: { ticketNumber, category, description, severity, status, latitude, longitude, policeUnitId, reporterId: seedUser.id },
      create: { id, ticketNumber, category, description, severity, status, latitude, longitude, policeUnitId, reporterId: seedUser.id },
    });
  }

  const mentengOfficer = await prisma.user.findFirst({ where: { policeUnitId: "polsek-menteng", role: "POLISI" } });
  const activityActorId = mentengOfficer?.id ?? admin.id;
  const officers = await prisma.user.findMany({ where: { role: "POLISI", policeUnitId: { not: null } }, select: { id: true, policeUnitId: true } });
  const officerByUnit = new Map(officers.flatMap((officer) => officer.policeUnitId ? [[officer.policeUnitId, officer.id] as const] : []));
  const activities = [];
  for (const [index, report] of seededReports.entries()) {
    const [reportId, , , , , finalStatus, , , unitId] = report;
    const actorId = officerByUnit.get(unitId) ?? activityActorId;
    const flow = finalStatus === "RESOLVED" ? ["PENDING", "VERIFIED", "IN_PROGRESS", "RESOLVED"] as const
      : finalStatus === "IN_PROGRESS" ? ["PENDING", "VERIFIED", "IN_PROGRESS"] as const
      : finalStatus === "VERIFIED" ? ["PENDING", "VERIFIED"] as const
      : finalStatus === "CLARIFICATION" ? ["PENDING", "CLARIFICATION"] as const : ["PENDING"] as const;
    const messages = {
      PENDING: "Laporan diterima dan diteruskan ke unit penanganan sesuai lokasi.",
      VERIFIED: "Lokasi dan kronologi telah diperiksa. Laporan memenuhi syarat untuk ditindaklanjuti.",
      IN_PROGRESS: "Petugas melakukan pemeriksaan lokasi dan berkoordinasi dengan pengelola setempat.",
      CLARIFICATION: "Mohon lengkapi waktu kejadian dan patokan lokasi agar pemeriksaan dapat dilanjutkan.",
      RESOLVED: "Pemeriksaan dan tindak lanjut selesai. Dokumentasi penanganan telah dilampirkan.",
    };
    const started = Date.now() - (index + 2) * 4 * 3600000;
    for (const [step, status] of flow.entries()) {
      const row = { actorId: step === 0 ? seedUser.id : actorId, actorRole: step === 0 ? "WARGA" as const : "POLISI" as const,
        type: step === 0 ? "SUBMITTED" : "STATUS_UPDATE", status, message: messages[status], createdAt: new Date(started + step * 3600000) };
      const existing = await prisma.reportActivity.findFirst({ where: { reportId, status } });
      activities.push(existing ? await prisma.reportActivity.update({where:{id:existing.id},data:row})
        : await prisma.reportActivity.create({data:{id:randomUUID(),reportId,...row}}));
    }
    await prisma.incidentReport.update({where:{id:reportId},data:{createdAt:new Date(started),updatedAt:new Date(started+(flow.length-1)*3600000),
      ...(finalStatus === "CLARIFICATION" ? {clarificationPrompt:messages.CLARIFICATION,clarificationRequestedAt:new Date(started+3600000)} : {})}});
  }
  if (storageConfigured) {
    // Reference photos exercise private evidence delivery, never public incident imagery.
    const response = await fetch("https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=960&q=80");
    if (!response.ok) throw new Error("Foto pendukung belum dapat diunduh.");
    const evidenceBody = await sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({ width: 960 }).webp({ quality: 85 }).toBuffer();
    for (const activity of activities) {
      const existing = await prisma.reportEvidence.findFirst({ where: { activityId: activity.id } });
      if (existing) continue;
      const key = `report-evidence/${activity.reportId}/${randomUUID()}.webp`;
      await uploadImage({ key, body: evidenceBody, contentType: "image/webp" });
      await prisma.reportEvidence.create({ data: { reportId: activity.reportId, uploaderId: activity.actorId || seedUser.id, activityId: activity.id, key } });
    }
  }

  await mkdir("secrets", { recursive: true });
  await writeFile(credentialPath, `${credentials.join("\n")}\n`, { encoding: "utf8", flag: "w" });
  console.log(`Seeded ${policeUnits.length} Jakarta police units, ${policeUnits.length + 1} operational accounts, and ${seededReports.length} public seeded reports.`);
  console.log(`Credentials written to ${credentialPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
