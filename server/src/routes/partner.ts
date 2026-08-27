import { Router } from "express";
import { Setting } from "../models.js";
import { requireRole, canPartner, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";

export const partnerRouter = Router();
partnerRouter.use(requireRole(canPartner, "Delivery partner access required"));

// Same Setting key portal.ts's buildSnapshot() already reads for the legacy
// web Partner and for Admin's live view, so both surfaces stay consistent
// with no other change needed.
const onlineKey = (userId: unknown) => `partner_online:${userId}`;

partnerRouter.get("/status", async (req: AuthedRequest, res) => {
  try {
    const setting = await Setting.findById(onlineKey(req.user!._id)).lean();
    res.json(ok({ online: (setting as any)?.value === "true" }));
  } catch (e) {
    res.status(500).json(fail("STATUS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load online status"));
  }
});

partnerRouter.post("/online", async (req: AuthedRequest, res) => {
  try {
    const value = Boolean(req.body?.value);
    await Setting.findByIdAndUpdate(onlineKey(req.user!._id), { value: value ? "true" : "false" }, { upsert: true });
    res.json(ok({ online: value }, value ? "You are online" : "You are offline"));
  } catch (e) {
    res.status(500).json(fail("STATUS_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update status"));
  }
});
