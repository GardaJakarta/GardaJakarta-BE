export const openapiDocument = {
  openapi: "3.0.3",
  info: { title: "Garda Jakarta API", version: "0.1.0", description: "API laporan keamanan, peta publik, dan operasional unit Garda Jakarta." },
  servers: [{ url: "https://api.gardajakarta.my.id", description: "Production" }, { url: "http://localhost:4000", description: "Local" }],
  tags: [{ name: "Health" }, { name: "Public map" }, { name: "Reports" }, { name: "Police" }],
  paths: {
    "/api/health": { get: { tags: ["Health"], summary: "Cek kesehatan API", responses: { "200": { description: "API aktif" } } } },
    "/api/public/map": { get: { tags: ["Public map"], summary: "Ambil unit polisi dan laporan publik", responses: { "200": { description: "Data peta publik" } } } },
    "/api/dashboard": { get: { tags: ["Reports"], summary: "Ambil dashboard sesuai role", security: [{ cookieAuth: [] }], responses: { "200": { description: "Dashboard role aktif" }, "401": { description: "Sesi tidak valid" } } } },
    "/api/reports/feed": { get: { tags: ["Reports"], summary: "Ambil feed laporan bertahap", security: [{ cookieAuth: [] }], parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } }], responses: { "200": { description: "Halaman feed laporan" }, "401": { description: "Sesi tidak valid" } } } },
    "/api/reports": { post: { tags: ["Reports"], summary: "Buat laporan warga", security: [{ cookieAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateReport" } } } }, responses: { "201": { description: "Laporan dibuat" }, "400": { description: "Input tidak valid" }, "401": { description: "Sesi tidak valid" } } } },
    "/api/police/reports/{id}/status": { patch: { tags: ["Police"], summary: "Perbarui status laporan unit", security: [{ cookieAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["VERIFIED", "IN_PROGRESS", "RESOLVED", "REJECTED"] } } } } } }, responses: { "200": { description: "Status diperbarui" }, "403": { description: "Role bukan polisi" }, "404": { description: "Laporan tidak ditemukan" } } } },
  },
  components: {
    securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "garda.session_token" } },
    schemas: { CreateReport: { type: "object", required: ["category", "description", "latitude", "longitude"], properties: { category: { type: "string", minLength: 2, maxLength: 80 }, description: { type: "string", minLength: 10, maxLength: 2000 }, severity: { type: "string", enum: ["P0", "P1", "P2", "P3"], default: "P2" }, latitude: { type: "number", minimum: -7.2, maximum: -5.8 }, longitude: { type: "number", minimum: 106.4, maximum: 107.2 } } } },
  },
} as const;
