# Garda Jakarta BE

Backend Express + Prisma untuk `api.gardajakarta.my.id`. Service ini menyediakan autentikasi awal tiga portal dan fondasi PostgreSQL untuk fitur peta, laporan, penugasan, dan audit yang akan datang.

## Scope saat ini

- Express 5 dengan CORS allowlist dan raw request handling untuk Better Auth.
- Better Auth 1.7 dengan Prisma adapter PostgreSQL.
- Register email publik selalu membuat role `WARGA`; role adalah field server-owned.
- Login email/password terpisah secara UI untuk portal `warga`, `polisi`, dan `admin`.
- Google OAuth melalui provider Google; callback produksi berada di `/api/auth/callback/google`.
- Session Better Auth memakai HttpOnly cookie host-only pada API, Secure saat production, dan SameSite=Lax untuk callback OAuth. Frontend mengirim credentials pada setiap request.
- Endpoint role `/api/warga/session`, `/api/polisi/session`, dan `/api/admin/session` tetap memvalidasi role di backend.
- Prisma migration menyimpan akun credential dan OAuth provider pada model `Account`.
- Audit log untuk provisioning akun staff.

## Menjalankan lokal

```bash
npm ci
copy .env.example .env
npm run prisma:migrate:dev
npm run dev
```

`DATABASE_URL` harus menunjuk PostgreSQL. Repository ini memakai database Garda Jakarta yang sudah ada; jangan membuat service database kedua untuk deployment.

API lokal berjalan di `http://localhost:4000`.

## Endpoint Better Auth

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/health` | Health check dengan query PostgreSQL |
| `POST` | `/api/auth/sign-up/email` | Register warga dan membuat session |
| `POST` | `/api/auth/sign-in/email` | Login email/password |
| `POST` | `/api/auth/sign-in/social` | Memulai Google OAuth |
| `GET` | `/api/auth/callback/google` | Callback Google OAuth |
| `GET` | `/api/auth/get-session` | Mengambil session dari cookie |
| `POST` | `/api/auth/sign-out` | Mencabut session aktif |
| `GET` | `/api/me` | Response user ringkas untuk frontend |
| `GET` | `/api/warga/session` | Validasi session role warga |
| `GET` | `/api/polisi/session` | Validasi session role polisi |
| `GET` | `/api/admin/session` | Validasi session role admin |

## Google Cloud OAuth

Tambahkan origin berikut pada Google OAuth client:

- `https://app.gardajakarta.my.id`
- `http://localhost:5173`

Tambahkan redirect URI berikut persis:

- `https://api.gardajakarta.my.id/api/auth/callback/google`
- `http://localhost:4000/api/auth/callback/google`

Pakai tipe Web application. Selama OAuth consent screen masih Testing, tambahkan akun penguji sebagai Test users. Untuk pemakaian publik, selesaikan consent screen dan publish sesuai ketentuan Google. Credential Google hanya disimpan sebagai environment variable backend.

## Provisioning staff

Tidak ada akun polisi/admin bawaan dan tidak ada register publik untuk staff. Buat akun secara eksplisit dari lingkungan operator dengan variable `STAFF_NAME`, `STAFF_EMAIL`, `STAFF_PASSWORD`, `STAFF_ROLE` (`polisi` atau `admin`), `STAFF_PROVISIONED_BY`, dan `STAFF_REASON`, lalu jalankan:

```bash
npm run staff:create
```

Script membuat credential account Better Auth dan mencatat operasi ke `AuditLog`. Operator wajib memverifikasi kepemilikan email staff sebelum provisioning. Akun warga email/password yang belum terverifikasi harus masuk dengan password lalu memilih Tautkan akun Google; implicit linking hanya diizinkan untuk email lokal terverifikasi.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
npm run test:integration
```

`test:integration` membutuhkan `TEST_DATABASE_URL` yang sudah menjalankan migration dan hanya membuat fixture sementara.

## Environment Railway

Service `GardaJakarta-BE` memakai branch `main` dari repository ini.

| Variable | Nilai |
| --- | --- |
| `DATABASE_URL` | Reference Railway ke `GardaJakarta Database` |
| `BETTER_AUTH_URL` | `https://api.gardajakarta.my.id` |
| `BETTER_AUTH_SECRET` | Secret acak minimal 32 byte |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `CORS_ORIGIN` | `https://app.gardajakarta.my.id` |
| `NODE_ENV` | `production` |

Domain API: `api.gardajakarta.my.id`. Railway menjalankan `prisma migrate deploy` sebelum server start.

Konfigurasi service tersimpan di Railway: build `npm run build`, start `npm start`, health check `/api/health` (timeout 120 detik), region `asia-southeast1-eqsg3a`, dan 1 replica. Deploy otomatis mengikuti GitHub `main`. Railway tidak menerima `railway.json` untuk service baru; konfigurasi ini dikelola melalui dashboard/API.

Kedua service aplikasi dibatasi 1 vCPU dan 1 GB RAM. DNS yang diperlukan:

| Tipe | Host | Target |
| --- | --- | --- |
| CNAME | `app` | `puzwyn71.up.railway.app` |
| CNAME | `api` | `8g2xjt72.up.railway.app` |

Gunakan DNS-only ketika memverifikasi sertifikat Railway. Jangan membuat database PostgreSQL tambahan; service ini menggunakan `GardaJakarta Database`.

Dependency override `@prisma/config -> deepmerge-ts 8.0.2` menutup GHSA-ggr8-5vv4-36mx sambil mempertahankan Prisma 6.19. Validasi schema, generate, migration, dan integration test harus tetap dijalankan saat memperbaruinya.

## Batasan tahap awal

Endpoint laporan, peta, routing, moderasi, permission granular, notifikasi, dan dashboard operasional belum dibuat. Schema auth dan audit sudah menjadi fondasi untuk tahap tersebut.
