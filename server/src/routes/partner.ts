import { Router } from "express";
import { Order, User } from "../models.js";
import { requireRole, canPartner, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { isValidCoordinate } from "../lib/geo.js";
import { emitOrderUpdate } from "../lib/realtime.js";
import { unassignPartner } from "../lib/delivery.js";
import { ACTIVE_DELIVERY_STATUSES } from "../lib/orderState.js";

export const partnerRouter = Router();
partnerRouter.use(requireRole(canPartner, "Delivery partner access required"));

const publicProfile = (u: any) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  phone: u.phone ?? null,
  status: u.status,
  vehicleType: u.vehicleType,
  vehicleNumber: u.vehicleNumber,
  licenceNumber: u.licenceNumber,
  rcNumber: u.rcNumber,
  photoUrl: u.photoUrl,
  partnerApprovalStatus: u.partnerApprovalStatus,
  partnerOnline: u.partnerOnline,
  partnerBusy: u.partnerBusy,
});

partnerRouter.get("/status", async (req: AuthedRequest, res) => {
  res.json(ok({ online: Boolean(req.user!.partnerOnline), busy: Boolean(req.user!.partnerBusy), approvalStatus: req.user!.partnerApprovalStatus }));
});

partnerRouter.get("/profile", async (req: AuthedRequest, res) => {
  res.json(ok({ partner: publicProfile(req.user!) }));
});

partnerRouter.post("/online", async (req: AuthedRequest, res) => {
  try {
    const value = Boolean(req.body?.value);
    const user = req.user!;

    if (value && user.partnerApprovalStatus !== "APPROVED") {
      return res.status(403).json(fail("NOT_APPROVED", "Your account is pending admin approval and cannot go online yet."));
    }

    // Going offline mid-delivery does not abandon the customer — the active
    // job stays assigned; only the eligibility to receive NEW offers changes.
    await User.updateOne({ _id: user._id }, { $set: { partnerOnline: value } });
    res.json(ok({ online: value }, value ? "You are online" : "You are offline"));
  } catch (e) {
    res.status(500).json(fail("STATUS_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update status"));
  }
});

// Spec section 32: latitude, longitude, accuracy, heading, speed, timestamp —
// pushed by the app every 5-10s while a delivery is active. This is the ONLY
// source of a partner's on-map position; nothing on the server simulates or
// interpolates movement.
partnerRouter.post("/location", async (req: AuthedRequest, res) => {
  try {
    const { latitude, longitude, accuracy, heading, speed } = req.body ?? {};
    if (!isValidCoordinate(latitude, longitude)) return res.status(400).json(fail("INVALID_LOCATION", "A valid latitude and longitude are required."));

    const now = new Date();
    await User.updateOne({ _id: req.user!._id }, { $set: { currentLatitude: latitude, currentLongitude: longitude, locationUpdatedAt: now } });

    const activeOrder = await Order.findOne({ partnerId: req.user!._id, status: { $in: ACTIVE_DELIVERY_STATUSES } }, { customerId: 1, restaurantId: 1, partnerId: 1 }).lean();

    if (activeOrder) {
      emitOrderUpdate(activeOrder as any, "order:location", {
        orderId: String((activeOrder as any)._id),
        latitude,
        longitude,
        accuracy: accuracy ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        timestamp: now,
      });
    }

    res.json(ok({ tracked: Boolean(activeOrder) }));
  } catch (e) {
    res.status(500).json(fail("LOCATION_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update location"));
  }
});

// A partner stuck on a job they cannot complete (vehicle broke down, etc.)
// releases themselves rather than leaving the customer waiting forever.
partnerRouter.post("/active-delivery/release", async (req: AuthedRequest, res) => {
  try {
    const order = await Order.findOne({ partnerId: req.user!._id, status: { $in: ACTIVE_DELIVERY_STATUSES } }, { _id: 1 }).lean();
    if (!order) return res.status(404).json(fail("NO_ACTIVE_DELIVERY", "You have no active delivery to release."));

    await unassignPartner(order._id, String(req.body?.reason ?? "PARTNER_UNABLE_TO_COMPLETE"));
    await User.updateOne({ _id: req.user!._id }, { $set: { partnerBusy: false } });
    res.json(ok(null, "Delivery released"));
  } catch (e) {
    res.status(500).json(fail("RELEASE_FAILED", e instanceof Error ? e.message : "Could not release this delivery"));
  }
});

partnerRouter.get("/earnings", async (req: AuthedRequest, res) => {
  try {
    const completed = await Order.find({ partnerId: req.user!._id, status: "DELIVERED" }, { bill: 1, updatedAt: 1, orderNumber: 1 }).sort({ updatedAt: -1 }).lean();
    // Flat per-delivery payout placeholder until a real payout/pricing rule
    // is wired up — deliberately conservative rather than inventing a number
    // that looks authoritative but isn't backed by any ledger.
    const PER_DELIVERY_PAYOUT = 35;
    res.json(
      ok({
        totalDeliveries: completed.length,
        totalEarnings: completed.length * PER_DELIVERY_PAYOUT,
        history: completed.slice(0, 50).map((o: any) => ({ orderNumber: o.orderNumber, amount: PER_DELIVERY_PAYOUT, at: o.updatedAt })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("EARNINGS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load earnings"));
  }
});
