# Garda Jakarta | Backend API

API untuk pelaporan keamanan warga, penugasan polisi, dan pemantauan progres. Backend menyatukan autentikasi, data peta, laporan, riwayat penanganan, media, dan pengelolaan admin.

[Frontend](https://github.com/GardaJakarta/GardaJakarta-FE) · [Landing](https://github.com/GardaJakarta/GardaJakarta-Landing) · [Health API](https://api.gardajakarta.my.id/api/health) · [Swagger UI](https://api.gardajakarta.my.id/api/docs)

## Deskripsi dan tujuan

Garda Jakarta membantu warga menyampaikan kejadian dengan lokasi dan kronologi yang jelas, lalu mengikuti status penanganannya. Polisi mendapat antrian sesuai unit penugasan; admin mengelola data pendukung serta memantau agregat operasional.

Repository ini bersifat **publik**, branch utama `main` (diperiksa tanpa autentikasi pada 8 November 2026). Frontend React dan landing Next.js dikelola di repository terpisah.

## Fitur dan aturan utama

| Modul | Implementasi |
| --- | --- |
| Autentikasi | Email/password, Google OAuth, cookie HttpOnly, role server-owned |
| Peta publik | Laporan, kantor aktif, katalog kategori, tanpa identitas pelapor |
| Laporan | Kategori, severity, kronologi, koordinat, status awal `PENDING` |
| Routing | Kantor aktif terdekat berdasarkan jarak koordinat |
| Interaksi | Komentar anonim, vote, foto bukti, klarifikasi, riwayat status |
| Polisi | Akses penanganan dibatasi ke laporan yang ditugaskan kepada unitnya |
| Admin | CRUD unit/kategori/pengguna/laporan, penugasan polisi, grafik 30 hari, audit |
| Media | Bucket private, proxy API, validasi gambar dan optimasi kategori ke WebP |
| OTP | 6 digit, berlaku 5 menit, hash tersimpan, maksimal 5 percobaan, cooldown kirim ulang |

Routing saat ini **belum memakai polygon yurisdiksi resmi**. Data seed adalah contoh untuk evaluasi, bukan data kriminal resmi.

## Tech stack

| Lapisan | Teknologi |
| --- | --- |
| Runtime/bahasa | Node.js 22.12+, TypeScript |
| HTTP | Express 5, Helmet, CORS, express-rate-limit |
| Database/ORM | PostgreSQL, Prisma 6 |
| Autentikasi | Better Auth 1.7 |
| Validasi | Zod |
| Media | Multer, Sharp, AWS SDK untuk S3-compatible storage |
| Email | Nodemailer SMTP |
| Dokumentasi/uji | OpenAPI, Swagger UI, ESLint, Node test runner |
| Hosting/lokal | Railway, Docker Compose v2 |

Versi dependency dikunci melalui [package-lock.json](package-lock.json).

## Arsitektur dan model data

```mermaid
flowchart LR
  Browser[Frontend React] -->|JSON / multipart + cookie| API[Express]
  API --> Auth[Better Auth]
  API --> Prisma[Prisma]
  Auth --> Prisma
  Prisma --> DB[(PostgreSQL)]
  API --> S3[(Private bucket)]
  Auth --> SMTP[SMTP OTP]
  Auth --> Google[Google OAuth]
```

| Model | Kegunaan |
| --- | --- |
| `User`, `Account`, `Session`, `Verification` | Identitas, credential/provider, session, OTP |
| `PoliceUnit` | Kantor, koordinat, publikasi, penugasan akun polisi |
| `ReportCategory` | Nama kategori dan key gambar |
| `IncidentReport` | Laporan dan unit penanganan |
| `ReportActivity` | Timeline perubahan dan catatan penanganan |
| `ReportComment`, `ReportVote`, `ReportEvidence` | Diskusi, dukungan, dan media |
| `AuditLog` | Jejak operasi administratif |

Rujukan relasi lengkap: [schema.prisma](prisma/schema.prisma).

## Quick start dengan Docker

Prasyarat: Git, Docker Engine/Docker Desktop dalam mode **Linux containers**, dan Docker Compose v2. Compose lokal tidak memakai connection string database Railway.

### 1. Clone repository

```bash
git clone https://github.com/GardaJakarta/GardaJakarta-BE.git
git clone https://github.com/GardaJakarta/GardaJakarta-FE.git
cd GardaJakarta-BE
```

Struktur yang diperlukan untuk profile `app`:

```text
workspace/
  GardaJakarta-BE/    # jalankan Compose di sini
  GardaJakarta-FE/
```

### 2. Siapkan environment lokal

PowerShell:
```powershell
Copy-Item .env.docker.example .env.docker
```

macOS/Linux:
```bash
cp .env.docker.example .env.docker
```

Ganti `BETTER_AUTH_SECRET` di `.env.docker` dengan nilai acak. Jika Node belum terpasang, buat nilai lewat Docker:

```bash
docker run --rm node:22-bookworm-slim node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Isi awal sengaja menonaktifkan OTP dan mengosongkan Google/S3 agar register password, API, dan peta bisa dicoba tanpa credential eksternal. Jangan menyalin secret production untuk quick start.

### 3. Jalankan aplikasi

```bash
docker compose --env-file .env.docker --profile app up --build -d --wait
docker compose --env-file .env.docker exec api npm run db:seed
docker compose --env-file .env.docker --profile app ps
```

| Service | URL / akses |
| --- | --- |
| Frontend | http://localhost:4173/map |
| API | http://localhost:4000/api/health |
| Swagger | http://localhost:4000/api/docs |
| PostgreSQL | Internal Compose: `db:5432`, tidak dibuka ke host |

API menunggu database sehat, menjalankan migration, lalu memulai server. Frontend menunggu API sehat. Hasil build berjalan sebagai user `node` (non-root). Database dan credential seed lokal disimpan dalam named volume.

Untuk API + database saja, hilangkan `--profile app` dari perintah `up`; repository FE tidak diperlukan. Compose adalah lingkungan lokal HTTP, memakai `NODE_ENV=development` agar cookie tidak memakai domain production. Image tetap menjalankan JavaScript hasil build, tanpa hot reload.

### 4. Evaluasi per role

- Pengunjung: buka `/map` untuk memeriksa laporan hasil seed.
- Warga: daftar melalui `/register`; akun baru mulai dengan laporan saya kosong.
- Polisi/admin: baca credential hasil seed di terminal pribadi:

```bash
docker compose --env-file .env.docker exec api cat secrets/gardajakarta-seed-credentials.txt
```

Gunakan `/polisi/login` atau `/admin/login` sesuai role. Password akun seed tidak dipublikasikan di README/Git. Seed membuat 10 unit, 10 akun polisi, satu admin, 28 laporan contoh, katalog kategori, dan timeline. Akun pemilik laporan seed tidak memiliki password warga bawaan; gunakan register untuk menguji alur warga.

Seed bersifat **opt-in** dan memperbarui record contoh yang sudah ada, sehingga jalankan hanya pada database lokal/evaluasi. Tanpa S3, foto kantor menggunakan URL referensi dan seed bukti pendukung dilewati.

### 5. Operasional dan penghentian

```bash
docker compose --env-file .env.docker logs --tail=50 api
docker compose --env-file .env.docker --profile app down
```

`down` mempertahankan named volume. Penambahan `-v` menghapus database **dan credential seed lokal**; jangan gunakan untuk sekadar menghentikan service.

Ubah `API_PORT`/`WEB_PORT` di `.env.docker` jika port bentrok, lalu jalankan `up --build` lagi. URL API frontend ditanam pada waktu build.

## Menjalankan tanpa Docker

Prasyarat: Node.js **22.12+**, npm, dan database PostgreSQL kosong milik lokal/evaluasi. Compose memakai PostgreSQL 16 sebagai referensi.

```bash
npm ci
```

Salin `.env.example` ke `.env` dengan `Copy-Item` (PowerShell) atau `cp` (macOS/Linux), lalu isi:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gardajakarta?schema=public"
BETTER_AUTH_URL="http://localhost:4000"
BETTER_AUTH_SECRET="<secret acak minimal 32 byte>"
CORS_ORIGIN="http://localhost:5173 http://localhost:4173"
NODE_ENV=development
EMAIL_OTP_ENABLED=false
```

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
npm run dev
```

Untuk setup pertama, gunakan migration yang sudah tersimpan melalui `prisma:migrate:deploy`. `prisma:migrate:dev` digunakan saat pengembang mengubah schema, bukan untuk startup biasa. API berada di **http://localhost:4000**.

## Konfigurasi environment

Contoh: [.env.example](.env.example) untuk Node langsung, [.env.docker.example](.env.docker.example) untuk Compose. File asli `.env` dan `.env.docker` diabaikan Git dan build context Docker.

| Variable | Wajib? | Fungsi |
| --- | --- | --- |
| `DATABASE_URL` | Ya | PostgreSQL; Compose mengarahkan ke database internal |
| `BETTER_AUTH_SECRET` | Ya | Secret acak, tidak dipublikasikan |
| `BETTER_AUTH_URL` | Ya | Base API yang diakses browser |
| `CORS_ORIGIN` | Ya | Origin frontend dipisahkan spasi/koma |
| `PORT`, `NODE_ENV` | Sesuai lingkungan | Port API dan konfigurasi cookie |
| `API_PORT`, `WEB_PORT` | Compose, opsional | Port host; default 4000 dan 4173 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Untuk Google login | OAuth Web application |
| `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET_NAME` | Untuk upload | Bucket S3-compatible private |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Untuk upload | Credential bucket |
| `EMAIL_OTP_ENABLED` | Untuk OTP | Aktif setelah SMTP diuji |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Untuk OTP | Transport email |

Compose tidak menjalankan layanan SMTP atau S3. Upload gambar kategori/bukti memerlukan bucket yang sudah dikonfigurasi. Google OAuth dan peta/pencarian eksternal memerlukan internet.

### Google OAuth

Buat OAuth client bertipe **Web application**. Origin lokal: `http://localhost:5173` dan `http://localhost:4173`. Redirect URI: `http://localhost:4000/api/auth/callback/google`. Sesuaikan port jika diubah.

Production: origin `https://app.gardajakarta.my.id` dan `https://gardajakarta.my.id`, redirect `https://api.gardajakarta.my.id/api/auth/callback/google`. Saat consent screen masih Testing, akun penguji harus terdaftar sebagai Test users.

### OTP

Ikuti [docs/email-otp.md](docs/email-otp.md). Pengiriman nyata memerlukan SMTP/App Password. Implementasi tersedia, tetapi status aktivasi production bergantung konfigurasi operator; kode pengujian mock tidak membuktikan email sudah terkirim ke Gmail.

## API dan alur status

[Swagger UI](https://api.gardajakarta.my.id/api/docs) dan [OpenAPI JSON](https://api.gardajakarta.my.id/api/openapi.json) memberi gambaran API. Untuk route yang lebih baru, lihat handler di `src/modules`.

| Method | Endpoint | Akses/fungsi |
| --- | --- | --- |
| GET | `/api/health` | Health check dengan query PostgreSQL |
| POST | `/api/auth/sign-up/email` | Register warga |
| POST | `/api/auth/sign-in/email` | Login |
| GET | `/api/auth/get-session` | Session dari cookie |
| POST | `/api/auth/sign-out` | Logout |
| GET | `/api/public/map`, `/api/public/categories` | Data publik |
| GET | `/api/dashboard` | Data sesuai role |
| POST | `/api/reports` | Submit laporan warga |
| GET | `/api/reports/:id/interactions` | Timeline/interaksi sesuai akses |
| POST | `/api/reports/:id/comments`, `/api/reports/:id/evidence` | Komentar/bukti |
| PATCH | `/api/police/reports/:id/status` | Penanganan unit terkait |
| GET/POST | `/api/admin/{units,categories,users,reports}` | Daftar/tambah, admin |
| GET/PATCH/DELETE | `/api/admin/{resource}/:id` | Detail/edit/hapus, admin |

Transisi mengikuti [policy.ts](src/modules/reports/policy.ts):

| Status saat ini | Status berikut yang diizinkan |
| --- | --- |
| PENDING / Belum diverifikasi | VERIFIED, CLARIFICATION, REJECTED |
| VERIFIED / Terverifikasi | IN_PROGRESS, CLARIFICATION, REJECTED |
| IN_PROGRESS / Ditindaklanjuti | RESOLVED, CLARIFICATION |
| CLARIFICATION / Butuh klarifikasi | VERIFIED, IN_PROGRESS, REJECTED |
| RESOLVED / Selesai | Terminal |
| REJECTED / Ditolak | Terminal |

## Akun staff dan keamanan

Register publik tidak menerima role admin/polisi dari klien. Setelah masuk sebagai admin, buka tab Pengguna untuk mendaftarkan polisi dan memilih kantor. Satu unit hanya dapat ditugasi satu akun polisi melalui validasi admin.

Alternatif operator: isi `STAFF_NAME`, `STAFF_EMAIL`, `STAFF_PASSWORD` (12-128 karakter), `STAFF_ROLE` (`admin`/`polisi`), `STAFF_PROVISIONED_BY`, dan `STAFF_REASON`, lalu jalankan `npm run staff:create`. Script mencatat audit; akun polisi hasil script belum ditugaskan ke kantor sampai diatur melalui admin.

Session bersifat HttpOnly; production memakai Secure dan domain `.gardajakarta.my.id`. Backend memeriksa role/unit, origin, input, dan status transition. Foto bukti disajikan melalui endpoint berizin. Credential SMTP/S3/OAuth tidak diberikan kepada frontend.

## Struktur kode

| Path | Isi |
| --- | --- |
| `src/app.ts`, `src/server.ts` | Routes utama, middleware, health, startup |
| `src/auth.ts`, `src/email.ts` | Session, OAuth, OTP, email |
| `src/modules/reports` | Interaksi dan policy penanganan |
| `src/modules/admin` | CRUD dan katalog gambar |
| `src/storage.ts` | S3 private storage |
| `prisma` | Schema, migration, seed |
| `scripts` | Wrapper Prisma dan provisioning staff |
| `tests` | Integration test auth/OTP |
| `docker/Dockerfile`, `docker-compose.yml` | Container dan stack lokal |

## Verifikasi

[![Docker smoke](https://github.com/GardaJakarta/GardaJakarta-BE/actions/workflows/docker-smoke.yml/badge.svg)](https://github.com/GardaJakarta/GardaJakarta-BE/actions/workflows/docker-smoke.yml)

Workflow Docker membangun FE/BE di Linux, menyalakan PostgreSQL kosong, menerapkan migration, menjalankan seed, lalu memeriksa health, data peta, rute SPA, dan register dengan cookie. Hasil aktual setiap run tersedia pada tautan badge.

```bash
npm run prisma:validate
npm run typecheck
npm run lint
npm run build
```

Integration tests memerlukan **database uji terpisah yang sudah dimigrasi**. Misalnya setelah `DATABASE_URL` pada `.env` menunjuk database uji lokal:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gardajakarta_test?schema=public"
npm run test:integration
node --test tests/otp.integration.mjs
```

Pada macOS/Linux gunakan `export TEST_DATABASE_URL='...'`. Test OTP membaca build `dist` dan menangkap email di memori. Jangan arahkan test atau seed ke database production untuk evaluasi README.

Pemeriksaan konfigurasi Docker:

```bash
docker compose --env-file .env.docker --profile app config --quiet
```

## Progress dan batasan

Status dokumentasi: **8 November 2026**, berdasarkan kode pada branch utama.

| Area | Status | Bukti |
| --- | --- | --- |
| Auth/role/OAuth | Tersedia | `src/auth.ts` |
| Database/migration | Tersedia | `prisma/schema.prisma`, `prisma/migrations` |
| Laporan/routing kantor terdekat | Tersedia | `src/app.ts` |
| Timeline, komentar, bukti | Tersedia | `src/modules/reports` |
| Admin CRUD/grafik/kategori bergambar | Tersedia | `src/modules/admin`, `src/app.ts` |
| Seed lokal 28 laporan dan timeline | Tersedia | `prisma/seed.ts` |
| OTP/S3 | Perlu konfigurasi eksternal | `docs/email-otp.md`, `src/storage.ts` |
| Routing yurisdiksi polygon | Belum tersedia | Saat ini jarak kantor aktif terdekat |
| Analitik dan monitoring lanjutan | Rencana | Memerlukan validasi data operasional |

## Deployment

Railway memakai build `npm run build`, start `npm start`, serta health check `/api/health`. Start menerapkan migration sebelum server. Service `GardaJakarta-BE` memakai branch `main`; credential dan domain berada di pengaturan Railway.

Dockerfile lokal disimpan pada `docker/` sehingga tidak otomatis mengganti builder Railway. Compose mengisolasi database lokal dan tidak mengubah service/database production.

## Troubleshooting

| Gejala | Langkah |
| --- | --- |
| Docker engine tidak ditemukan | Jalankan Docker Desktop dan pilih Linux containers; periksa `docker info` |
| API belum healthy | Periksa `docker compose --env-file .env.docker logs api db` |
| Peta/feed kosong | Jalankan seed lokal, periksa health dan filter frontend |
| Login/CORS/cookie gagal | Pakai `localhost` konsisten; cocokkan URL API dan origin |
| Foto gagal diunggah | Konfigurasikan S3 lengkap; periksa format dan ukuran |
| OTP tidak terkirim | Periksa SMTP, App Password, serta `EMAIL_OTP_ENABLED` |
| Windows Prisma EPERM | Hentikan dev server yang mengunci Prisma sebelum generate ulang |
| Seed gagal menulis credential | Pastikan volume `/app/secrets` dapat ditulis oleh user container |

## Kontribusi

Buat branch dari `main`, tambahkan migration jika schema berubah, jalankan pemeriksaan yang relevan, dan jelaskan dampak API serta cara menguji dalam pull request. Laporkan bug melalui [Issues](https://github.com/GardaJakarta/GardaJakarta-BE/issues); jangan menyertakan secret atau data pelapor.
