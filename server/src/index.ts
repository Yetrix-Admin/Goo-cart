import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDb, dbName } from "./lib/db.js";
import { attachUser } from "./lib/auth.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { ordersRouter } from "./routes/orders.js";
import { portalRouter } from "./routes/portal.js";
import { fail, ok } from "./lib/http.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(attachUser);

// Liveness probe that also reports whether Mongo is actually reachable, so a
// deploy that starts but can't reach Atlas is visible rather than silent.
app.get("/health", async (_req, res) => {
  const mongoose = await import("mongoose");
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  res.json(ok({ status: "up", database: dbName(), mongo: states[mongoose.default.connection.readyState] ?? "unknown" }));
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/catalog", catalogRouter);
app.use("/api/v1/orders", ordersRouter);

// Vendor / delivery-partner / admin web portal. Kept on the legacy
// /api/goocart path so the existing UI needs no change.
app.use("/api/goocart", portalRouter);

app.use((_req, res) => res.status(404).json(fail("NOT_FOUND", "No such endpoint")));

// Final safety net: an unhandled throw returns the standard envelope rather
// than an HTML stack trace the mobile client cannot parse.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json(fail("INTERNAL_ERROR", err instanceof Error ? err.message : "Something went wrong"));
});

async function start() {
  try {
    console.log(`Connecting to MongoDB (database: ${dbName()}) ...`);
    await connectDb();
    console.log("MongoDB connected.");
  } catch (e) {
    console.error("Could not reach MongoDB:", e instanceof Error ? e.message : e);
    console.error("Check MONGODB_URI in server/.env and that your IP is allowed in Atlas → Network Access.");
    process.exit(1);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Goocart API listening on http://0.0.0.0:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

void start();
