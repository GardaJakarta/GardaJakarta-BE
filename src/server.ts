import "dotenv/config";
import { createApp } from "./app.js";
import { prisma } from "./prisma.js";

const port = Number(process.env.PORT || 4000);
const server = createApp().listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "server_started", port }));
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(() => { void prisma.$disconnect().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
