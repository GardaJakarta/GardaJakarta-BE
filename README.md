# Garda Jakarta BE

Backend Express + Prisma untuk autentikasi awal Garda Jakarta.

## Scope awal

- Express 5 dengan Helmet, CORS, JSON body limit, dan error handler terpusat.
- Prisma ORM dengan PostgreSQL untuk deployment dan development yang konsisten.
- Register warga, login terpisah untuk portal warga/polisi/admin, dan validasi token JWT untuk endpoint `/api/auth/me`.
- Password disimpan sebagai hash bcrypt, bukan plaintext.
- Endpoint health check untuk dev dan deployment probe.

## Menjalankan

```bash
npm install
copy .env.example .env
npm run prisma:migrate:dev
npm run dev
```

Saat development lokal, set `DATABASE_URL` ke PostgreSQL lokal atau database development lain yang kompatibel.

API berjalan pada `http://localhost:4000`.

## Endpoint

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/register` | Membuat akun baru |
| `POST` | `/api/auth/login` | Mendapatkan token JWT; body menerima `portal`: `warga`, `polisi`, atau `admin` |
| `GET` | `/api/auth/me` | Mengambil user dari Bearer token |

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

Simpan `JWT_SECRET` melalui secret manager. Deployment menjalankan migration Prisma sebelum server dimulai.
