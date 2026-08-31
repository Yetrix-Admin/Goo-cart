import { Router } from "express";
import { Order, ServiceOrder, User } from "../models.js";
import { requireRole, canPartner, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { haversineKm, isValidCoordinate } from "../lib/geo.js";
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
  partnerRating: u.partnerRating,
  partnerCompletedDeliveries: u.partnerCompletedDeliveries,
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
    await User.updateOne({ _id: user._id }, { $set: { partnerOnline: value, ...(value ? { partnerLastOnlineAt: new Date() } : {}) } });
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
    const [completed, serviceCompleted] = await Promise.all([
      Order.find({ partnerId: req.user!._id, status: "DELIVERED" }, { bill: 1, updatedAt: 1, orderNumber: 1 }).sort({ updatedAt: -1 }).lean(),
      ServiceOrder.find({ partnerId: req.user!._id, status: { $in: ["DELIVERED", "COMPLETED"] } }, { details: 1, updatedAt: 1, reference: 1 }).sort({ updatedAt: -1 }).lean(),
    ]);
    const history = [
      ...completed.map((o: any) => ({ orderNumber: o.orderNumber, amount: Number(o.bill?.deliveryPartnerPayout ?? 0), at: o.updatedAt })),
      ...serviceCompleted.map((o: any) => ({ orderNumber: o.reference, amount: Number(o.details?.partnerPayout ?? 0), at: o.updatedAt })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(
      ok({
        totalDeliveries: history.length,
        totalEarnings: history.reduce((sum, row) => sum + row.amount, 0),
        history: history.slice(0, 50),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("EARNINGS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load earnings"));
  }
});

const serviceJobDTO = (o: any, pickupDistanceKm: number | null = null) => ({
  id: String(o._id), reference: o.reference, service: o.service, vendorName: o.vendorName, customerName: o.customerName,
  status: o.status, total: o.total, details: o.details ?? {}, partnerId: o.partnerId ? String(o.partnerId) : null, partnerName: o.partnerName ?? null,
  pickupDistanceKm, createdAt: o.createdAt, updatedAt: o.updatedAt,
});

partnerRouter.get("/service-jobs", async (req: AuthedRequest, res) => {
  try {
    const partner = req.user!;
    const jobs = await ServiceOrder.find({ $or: [{ partnerId: partner._id }, { partnerId: null, status: "READY_FOR_PICKUP" }] }).sort({ createdAt: -1 }).limit(200).lean();

    const hasPartnerFix = isValidCoordinate(partner.currentLatitude, partner.currentLongitude);
    const withDistance = jobs.map((job: any) => {
      const pickupLat = job.details?.pickupLatitude;
      const pickupLng = job.details?.pickupLongitude;
      const pickupDistanceKm =
        hasPartnerFix && isValidCoordinate(pickupLat, pickupLng)
          ? Math.round(haversineKm({ latitude: partner.currentLatitude!, longitude: partner.currentLongitude! }, { latitude: pickupLat, longitude: pickupLng }) * 10) / 10
          : null;
      return { job, pickupDistanceKm };
    });

    // Unclaimed jobs surface nearest-pickup-first for this partner so they
    // aren't picking blind from an arbitrary, creation-time-ordered pool —
    // jobs already assigned to them keep their original order.
    withDistance.sort((a, b) => {
      const aPool = a.job.partnerId === null;
      const bPool = b.job.partnerId === null;
      if (aPool && bPool && a.pickupDistanceKm !== null && b.pickupDistanceKm !== null) return a.pickupDistanceKm - b.pickupDistanceKm;
      return 0;
    });

    res.json(ok({ jobs: withDistance.map(({ job, pickupDistanceKm }) => serviceJobDTO(job, pickupDistanceKm)) }));
  } catch (e) {
    res.status(500).json(fail("SERVICE_JOBS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load service jobs"));
  }
});

partnerRouter.post("/service-jobs/:id/claim", async (req: AuthedRequest, res) => {
  try {
    const partner = await User.findById(req.user!._id).lean();
    if (!partner || partner.status !== "ACTIVE" || partner.partnerApprovalStatus !== "APPROVED" || !partner.partnerOnline || partner.partnerBusy) {
      return res.status(409).json(fail("PARTNER_NOT_ELIGIBLE", "You must be approved, online and free to accept this job."));
    }
    const job = await ServiceOrder.findOneAndUpdate(
      { _id: req.params.id, partnerId: null, status: "READY_FOR_PICKUP" },
      { $set: { partnerId: partner._id, partnerName: partner.name, status: "PARTNER_ASSIGNED" } },
      { new: true },
    );
    if (!job) return res.status(409).json(fail("JOB_ALREADY_ASSIGNED", "This job was already accepted by another partner."));
    await User.updateOne({ _id: partner._id }, { $set: { partnerBusy: true } });
    res.json(ok({ job: serviceJobDTO(job.toObject()) }, "Job accepted"));
  } catch (e) {
    res.status(500).json(fail("JOB_CLAIM_FAILED", e instanceof Error ? e.message : "Could not accept this job"));
  }
});

partnerRouter.post("/service-jobs/:id/status", async (req: AuthedRequest, res) => {
  try {
    const job: any = await ServiceOrder.findOne({ _id: req.params.id, partnerId: req.user!._id });
    if (!job) return res.status(404).json(fail("JOB_NOT_FOUND", "Assigned job not found."));
    const to = String(req.body?.to ?? "");
    const rideFlow: Record<string, string[]> = { PARTNER_ASSIGNED: ["ARRIVING"], ARRIVING: ["IN_PROGRESS"], IN_PROGRESS: ["COMPLETED"] };
    const deliveryFlow: Record<string, string[]> = { PARTNER_ASSIGNED: ["PICKED_UP"], PICKED_UP: ["IN_TRANSIT"], IN_TRANSIT: ["DELIVERED"] };
    const flow = job.service === "Bike Taxi" ? rideFlow : deliveryFlow;
    if (!(flow[job.status] ?? []).includes(to)) return res.status(409).json(fail("INVALID_TRANSITION", `Cannot move ${job.status} to ${to}.`));
    if (["COMPLETED", "DELIVERED"].includes(to) && String(req.body?.code ?? "") !== String(job.details?.verificationCode ?? "")) {
      return res.status(401).json(fail("INVALID_CODE", "Ask the customer for the correct verification code."));
    }
    job.status = to;
    await job.save();
    if (["COMPLETED", "DELIVERED"].includes(to)) await User.updateOne({ _id: req.user!._id }, { $set: { partnerBusy: false } });
    res.json(ok({ job: serviceJobDTO(job.toObject()) }, "Job updated"));
  } catch (e) {
    res.status(500).json(fail("JOB_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update this job"));
  }
});
