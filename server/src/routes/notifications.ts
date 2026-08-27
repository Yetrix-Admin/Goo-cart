import { Router } from "express";
import { DeviceToken, Notification } from "../models.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// One Expo/FCM/APNs push token per row, reassignable between accounts (the
// same phone logging out of one account and into another should stop
// receiving the first account's pushes).
notificationsRouter.post("/register-device", async (req: AuthedRequest, res) => {
  try {
    const token = String(req.body?.token ?? "").trim();
    const platform = String(req.body?.platform ?? "unknown");
    if (!token) return res.status(400).json(fail("INVALID_TOKEN", "A device token is required."));

    await DeviceToken.findOneAndUpdate({ token }, { $set: { userId: req.user!._id, platform } }, { upsert: true });
    res.json(ok(null, "Device registered"));
  } catch (e) {
    res.status(500).json(fail("DEVICE_REGISTER_FAILED", e instanceof Error ? e.message : "Could not register this device"));
  }
});

notificationsRouter.post("/unregister-device", async (req: AuthedRequest, res) => {
  try {
    const token = String(req.body?.token ?? "").trim();
    if (token) await DeviceToken.deleteOne({ token, userId: req.user!._id });
    res.json(ok(null, "Device unregistered"));
  } catch (e) {
    res.status(500).json(fail("DEVICE_UNREGISTER_FAILED", e instanceof Error ? e.message : "Could not unregister this device"));
  }
});

notificationsRouter.get("/", async (req: AuthedRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await Notification.find({ userId: req.user!._id }).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(
      ok({
        notifications: rows.map((n: any) => ({ id: String(n._id), title: n.title, body: n.body, data: n.data ?? null, channel: n.channel, read: Boolean(n.readAt), at: n.createdAt })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("NOTIFICATIONS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load notifications"));
  }
});

notificationsRouter.post("/:id/read", async (req: AuthedRequest, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user!._id }, { $set: { readAt: new Date() } });
    res.json(ok(null, "Marked as read"));
  } catch (e) {
    res.status(500).json(fail("NOTIFICATION_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update this notification"));
  }
});
