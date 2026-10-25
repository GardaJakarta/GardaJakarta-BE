import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randomPassword() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

const policeUnits = [
  ["polda-metro-jaya", "Polda Metro Jaya", "Jakarta Selatan", "Jl. Jenderal Sudirman No. 55, Senayan", "021-5234001", -6.2132, 106.8294, "https://images.unsplash.com/photo-1564510714747-69c3bc1a0f1c?auto=format&fit=crop&w=900&q=80"],
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

async function main() {
  for (const [id, name, district, address, phone, latitude, longitude, photoUrl] of policeUnits) {
    await prisma.policeUnit.upsert({
      where: { id },
      update: { name, district, address, phone, latitude, longitude, photoUrl, isPublished: true },
      create: { id, name, district, address, phone, latitude, longitude, photoUrl, isPublished: true },
    });
  }

  const credentials: string[] = [
    "Garda Jakarta seeded operational accounts",
    `Generated: ${new Date().toISOString()}`,
    "Keep this file private and rotate these passwords after first login.",
    "",
  ];

  for (const [unitId, unitName] of policeUnits) {
    const slug = unitId.replace(/^polres-|^polsek-|^polda-/, "");
    const email = `petugas.${slug}@gardajakarta.my.id`;
    const existing = await prisma.user.findUnique({ where: { email } });
    const password = existing ? null : randomPassword();
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { name: `Petugas ${unitName}`, role: "POLISI", policeUnitId: unitId, emailVerified: true } })
      : await prisma.user.create({ data: { id: randomUUID(), name: `Petugas ${unitName}`, email, role: "POLISI", policeUnitId: unitId, emailVerified: true } });

    if (password) {
      await prisma.account.create({ data: { id: randomUUID(), accountId: user.id, providerId: "credential", userId: user.id, password: await hashPassword(password) } });
      credentials.push(`POLISI | ${user.name} | ${email} | ${password}`);
    } else {
      credentials.push(`POLISI | ${user.name} | ${email} | EXISTING_PASSWORD_NOT_REGENERATED`);
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
    credentials.push(`ADMIN | ${admin.name} | ${adminEmail} | EXISTING_PASSWORD_NOT_REGENERATED`);
  }

  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("secrets", { recursive: true });
  const credentialPath = "secrets/gardajakarta-seed-credentials.txt";
  await writeFile(credentialPath, `${credentials.join("\n")}\n`, { encoding: "utf8", flag: "w" });
  console.log(`Seeded ${policeUnits.length} Jakarta police units and ${policeUnits.length + 1} operational accounts.`);
  console.log(`Credentials written to ${credentialPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
