import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { getTokenUserId, getUser, loginUser, registerUser } from "./auth.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((origin) => origin.trim());

app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: "32kb" }));

const asyncRoute = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "gardajakarta-be" });
});

app.post("/api/auth/register", asyncRoute(async (request, response) => {
  const data = await registerUser(request.body);
  response.status(201).json({ data });
}));

app.post("/api/auth/login", asyncRoute(async (request, response) => {
  const data = await loginUser(request.body);
  response.json({ data });
}));

app.get("/api/auth/me", asyncRoute(async (request, response) => {
  const userId = getTokenUserId(request.header("authorization"));
  if (!userId) {
    response.status(401).json({ error: "Sesi tidak valid atau sudah berakhir." });
    return;
  }
  const user = await getUser(userId);
  if (!user) {
    response.status(401).json({ error: "Pengguna tidak ditemukan." });
    return;
  }
  response.json({ data: user });
}));

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  void next;
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Data yang dikirim belum valid.", details: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "Terjadi kesalahan pada server.";
  const status = message.includes("sudah terdaftar")
    ? 409
    : message.includes("tidak cocok") || message.includes("portal")
      ? 401
      : 500;
  response.status(status).json({ error: message });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Garda Jakarta API listening on http://localhost:${port}`);
});
