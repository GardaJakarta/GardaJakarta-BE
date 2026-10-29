import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
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
    where: { email: "demo.warga@gardajakarta.my.id" },
    update: { name: "Warga Garda Jakarta", role: "WARGA", emailVerified: true },
    create: { id: "seed-warga", name: "Warga Garda Jakarta", email: "demo.warga@gardajakarta.my.id", role: "WARGA", emailVerified: true },
  });
  const seedDay = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const seededReports = [
    ["seed-report-1", `GJ-${seedDay}-0001`, "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Lampu jalan mati di sekitar jalur pedestrian.", "P2", "VERIFIED", -6.1944, 106.8229, "polsek-menteng"],
    ["seed-report-2", `GJ-${seedDay}-0002`, "Tawuran atau kerumunan berbahaya", "Terlihat kerumunan mencurigakan di dekat area parkir.", "P1", "IN_PROGRESS", -6.1978, 106.8264, "polsek-menteng"],
    ["seed-report-3", `GJ-${seedDay}-0003`, "Gangguan penerangan atau fasilitas yang berdampak pada keamanan", "Penerangan area publik perlu diperiksa karena mengganggu keamanan malam hari.", "P3", "PENDING", -6.1919, 106.8278, "polsek-menteng"],
    ["seed-report-4", `GJ-${seedDay}-0004`, "Pencurian atau kehilangan barang", "Laporan kehilangan di area transit yang sudah selesai ditangani.", "P2", "RESOLVED", -6.1958, 106.8198, "polsek-menteng"],
  ] as const;
  for (const [id, ticketNumber, category, description, severity, status, latitude, longitude, policeUnitId] of seededReports) {
    await prisma.incidentReport.upsert({
      where: { id },
      update: { ticketNumber, category, description, severity, status, latitude, longitude, policeUnitId, reporterId: seedUser.id },
      create: { id, ticketNumber, category, description, severity, status, latitude, longitude, policeUnitId, reporterId: seedUser.id },
    });
  }

  const mentengOfficer = await prisma.user.findFirst({ where: { policeUnitId: "polsek-menteng", role: "POLISI" } });
  const activityActorId = mentengOfficer?.id ?? admin.id;
  const activityRows = [
    { reportId: "seed-report-1", actorId: seedUser.id, actorRole: "WARGA" as const, type: "SUBMITTED", status: "PENDING" as const, message: "Laporan diterima dan menunggu verifikasi.", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 28) },
    { reportId: "seed-report-1", actorId: activityActorId, actorRole: "POLISI" as const, type: "STATUS_UPDATE", status: "VERIFIED" as const, message: "Laporan diverifikasi oleh petugas lapangan.", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20) },
    { reportId: "seed-report-2", actorId: seedUser.id, actorRole: "WARGA" as const, type: "SUBMITTED", status: "PENDING" as const, message: "Laporan kerumunan berbahaya dikirim warga.", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18) },
    { reportId: "seed-report-2", actorId: activityActorId, actorRole: "POLISI" as const, type: "STATUS_UPDATE", status: "VERIFIED" as const, message: "Petugas memvalidasi lokasi dan tingkat urgensi laporan.", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 14) },
    { reportId: "seed-report-2", actorId: activityActorId, actorRole: "POLISI" as const, type: "STATUS_UPDATE", status: "IN_PROGRESS" as const, message: "Patroli dan tindak lanjut sedang berjalan di area laporan.", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4) },
    { reportId: "seed-report-3", actorId: seedUser.id, actorRole: "WARGA" as const, type: "SUBMITTED", status: "PENDING" as const, message: "Laporan baru diterima sistem.", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8) },
    { reportId: "seed-report-4", actorId: activityActorId, actorRole: "POLISI" as const, type: "STATUS_UPDATE", status: "RESOLVED" as const, message: "Penanganan selesai dan laporan ditutup.", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 32) },
  ];
  await prisma.reportActivity.deleteMany({ where: { reportId: { in: seededReports.map(([id]) => id) } } });
  await prisma.reportActivity.createMany({ data: activityRows });

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
