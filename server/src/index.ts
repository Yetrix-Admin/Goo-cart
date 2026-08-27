import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import { connectDb, dbName } from "./lib/db.js";
import { attachUser } from "./lib/auth.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { ordersRouter } from "./routes/orders.js";
import { portalRouter } from "./routes/portal.js";
import { vendorRouter } from "./routes/vendor.js";
import { adminRouter } from "./routes/admin.js";
import { partnerRouter } from "./routes/partner.js";
import { customerRouter } from "./routes/customer.js";
import { notificationsRouter } from "./routes/notifications.js";
import { fail, ok } from "./lib/http.js";
import { initRealtime } from "./lib/realtime.js";
import { startAcceptanceWatchdog } from "./lib/acceptanceWatchdog.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Browsers are restricted to the configured origins; native apps send no
// Origin header and are unaffected. Unset ALLOWED_ORIGINS means allow all,
// which suits local development only.
const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin: allowed.length ? (origin, cb) => cb(null, !origin || allowed.includes(origin)) : true,
  }),
);
app.use(express.json({ limit: "1mb" }));

// Serverless platforms start a fresh process per cold start, so the database
// connection is established on demand rather than once at boot. connectDb()
// caches its promise, so a warm invocation reuses the existing pool.
app.use(async (_req, res, next) => {
  try {
    await connectDb();
    next();
  } catch (error) {
    console.error("MongoDB unreachable:", error instanceof Error ? error.message : error);
    res.status(503).json(
      fail("DATABASE_UNAVAILABLE", "Could not reach the database. Check MONGODB_URI and that this host's IP is allowed in Atlas -> Network Access."),
    );
  }
});

app.use(attachUser);

// Liveness probe that also reports whether Mongo is actually reachable, so a
// deploy that starts but can't reach Atlas is visible rather than silent.
app.get("/health", async (_req, res) => {
  const mongoose = await import("mongoose");
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  res.json(ok({ status: "up", database: dbName(), mongo: states[mongoose.default.connection.readyState] ?? "unknown" }));
});

app.use("/api/v1/auth", authRouter);
// The web portal predates the versioned mobile API and keeps this shorter
// path. Both mounts share the same users and sessions in Atlas.
app.use("/api/auth", authRouter);
app.use("/api/v1/catalog", catalogRouter);
app.use("/api/v1/orders", ordersRouter);

// Restaurant/menu management for the Vendor app, ownership assignment for the
// Admin web app, and online-status for the Delivery Partner app. Each is
// gated to its role by requireRole() inside the router itself.
app.use("/api/v1/vendor", vendorRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/partner", partnerRouter);
app.use("/api/v1/customer", customerRouter);
app.use("/api/v1/notifications", notificationsRouter);

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

// Exported for serverless hosts (Vercel), which import the app and handle
// listening themselves. Calling app.listen() there would hang the function.
// NOTE: Socket.IO needs a persistent process to hold connections open, which
// a serverless function cannot do — realtime only exists on the host that
// actually calls httpServer.listen() below (Render, per render.yaml). A
// Vercel deployment of this app would serve REST fine but with no realtime.
export default app;

// Only bind a port when started directly, e.g. `npm run dev` or `npm start`.
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!isServerless) {
  const httpServer = http.createServer(app);
  initRealtime(httpServer);

  connectDb()
    .then(() => {
      console.log(`MongoDB connected (database: ${dbName()}).`);
      startAcceptanceWatchdog();
    })
    .catch((e) => {
      // Log loudly but keep serving: /health then reports the real state
      // instead of the process vanishing with no explanation.
      console.error("Could not reach MongoDB:", e instanceof Error ? e.message : e);
      console.error("Check MONGODB_URI in server/.env and that your IP is allowed in Atlas -> Network Access.");
    });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Goocart API listening on http://0.0.0.0:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Realtime (Socket.IO) is live on the same port.`);
  });
}
