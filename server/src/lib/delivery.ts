import { Order, Restaurant, User } from "../models.js";
import { haversineKm, isValidCoordinate } from "./geo.js";
import { isPartnerEligible } from "./auth.js";
import { emitOrderUpdate, emitToPartner, emitToAdmin } from "./realtime.js";
import { notifyUser } from "./push.js";

// Configurable via env so ops can tune without a redeploy of business logic.
export const OFFER_TIMEOUT_SECONDS = Number(process.env.DELIVERY_OFFER_TIMEOUT_SECONDS) || 30;
export const INITIAL_RADIUS_KM = Number(process.env.DELIVERY_INITIAL_RADIUS_KM) || 3;
export const MAX_RADIUS_KM = Number(process.env.DELIVERY_MAX_RADIUS_KM) || 12;
export const RADIUS_STEP_KM = Number(process.env.DELIVERY_RADIUS_STEP_KM) || 3;
export const MAX_OFFER_ATTEMPTS = Number(process.env.DELIVERY_MAX_OFFER_ATTEMPTS) || 3;

// setTimeout handles for pending offer-expiry / retry checks, keyed by order
// id. Node keeps a process alive while any of these are pending, so every
// path that resolves an order (claimed, cancelled, exhausted) clears its
// entry — otherwise a 30-second-away timer outlives a short-lived caller
// such as a test process.
const pendingTimers = new Map<string, NodeJS.Timeout>();

function scheduleOrderTimer(orderId: unknown, ms: number, fn: () => void): void {
  const key = String(orderId);
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    fn();
  }, ms);
  pendingTimers.set(key, timer);
}

export function clearOrderTimers(orderId: unknown): void {
  const key = String(orderId);
  const existing = pendingTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    pendingTimers.delete(key);
  }
}

async function eligiblePartnersNear(latitude: number, longitude: number, radiusKm: number, excludeIds: string[] = []) {
  if (!isValidCoordinate(latitude, longitude)) return [];
  const candidates = await User.find({
    role: "DELIVERY_PARTNER",
    status: "ACTIVE",
    partnerApprovalStatus: "APPROVED",
    partnerOnline: true,
    partnerBusy: false,
    currentLatitude: { $ne: null },
    currentLongitude: { $ne: null },
    _id: { $nin: excludeIds },
  }).lean();

  return candidates
    .map((p: any) => ({ partner: p, distanceKm: haversineKm({ latitude, longitude }, { latitude: p.currentLatitude, longitude: p.currentLongitude }) }))
    .filter((p) => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Sends the delivery opportunity to every eligible nearby partner at once
 * (spec section 25-26). Nothing here decides a winner — that happens
 * atomically in claimDelivery() the moment one of them accepts.
 */
export async function broadcastDeliveryOffer(orderId: unknown, attempt = 1, radiusKm = INITIAL_RADIUS_KM): Promise<void> {
  const order: any = await Order.findById(orderId);
  if (!order || order.partnerId || !["NONE", "EXPIRED"].includes(order.deliveryOfferStatus)) return;

  const nearby = await eligiblePartnersNear(order.restaurantLatitude, order.restaurantLongitude, radiusKm);

  if (!nearby.length) {
    if (attempt >= MAX_OFFER_ATTEMPTS) {
      order.deliveryOfferStatus = "EXPIRED";
      order.events.push({ event: "DELIVERY_OFFER_EXHAUSTED", actorType: "system", metadata: { attempt, radiusKm } });
      await order.save();
      emitToAdmin("delivery:offer_exhausted", { orderId: String(order._id), orderNumber: order.orderNumber });
      return;
    }
    // Nobody nearby yet — widen the search and try again shortly rather than
    // leaving the customer waiting indefinitely with no visible progress.
    order.deliveryOfferAttempts = attempt;
    order.deliveryOfferRadiusKm = radiusKm;
    order.events.push({ event: "DELIVERY_OFFER_NO_PARTNERS", actorType: "system", metadata: { attempt, radiusKm } });
    await order.save();
    scheduleOrderTimer(orderId, 15_000, () => void broadcastDeliveryOffer(orderId, attempt + 1, Math.min(radiusKm + RADIUS_STEP_KM, MAX_RADIUS_KM)));
    return;
  }

  const offeredIds = nearby.map((n) => String(n.partner._id));
  order.deliveryOfferStatus = "OFFERING";
  order.deliveryOfferedPartnerIds = offeredIds;
  order.deliveryOfferStartedAt = new Date();
  order.deliveryOfferExpiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000);
  order.deliveryOfferRadiusKm = radiusKm;
  order.deliveryOfferAttempts = attempt;
  order.events.push({ event: "DELIVERY_OFFER_STARTED", actorType: "system", metadata: { offeredTo: offeredIds, radiusKm, attempt } });
  await order.save();

  const payload = {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    pickup: { name: order.restaurantName, latitude: order.restaurantLatitude, longitude: order.restaurantLongitude, area: order.restaurantArea },
    dropDistanceKm: dropDistanceKm(order),
    total: order.bill?.total ?? 0,
    expiresAt: order.deliveryOfferExpiresAt,
  };

  for (const { partner, distanceKm } of nearby) {
    emitToPartner(partner._id, "delivery:offer", { ...payload, pickupDistanceKm: Math.round(distanceKm * 10) / 10 });
    void notifyUser(
      partner._id,
      "New Delivery Available",
      `Pickup: ${order.restaurantName} • ₹${Math.round(order.bill?.total ?? 0)}`,
      { type: "DELIVERY_OFFER", orderId: String(order._id) },
      "DELIVERY",
    );
  }

  emitToAdmin("delivery:offer_started", { orderId: String(order._id), orderNumber: order.orderNumber, offeredTo: offeredIds.length });

  // Auto-expire if nobody accepts in time.
  scheduleOrderTimer(order._id, OFFER_TIMEOUT_SECONDS * 1000 + 500, () => void expireOfferIfStale(order._id));
}

function dropDistanceKm(order: any): number {
  const addr = order.deliveryAddress ?? {};
  if (!isValidCoordinate(addr.latitude, addr.longitude)) return 0;
  return Math.round(haversineKm({ latitude: order.restaurantLatitude, longitude: order.restaurantLongitude }, { latitude: addr.latitude, longitude: addr.longitude }) * 10) / 10;
}

async function expireOfferIfStale(orderId: unknown): Promise<void> {
  const order: any = await Order.findOneAndUpdate(
    { _id: orderId, deliveryOfferStatus: "OFFERING", partnerId: null, deliveryOfferExpiresAt: { $lte: new Date() } },
    { $set: { deliveryOfferStatus: "EXPIRED" } },
    { new: true },
  );
  if (!order) return; // already claimed, or not actually expired yet

  order.events.push({ event: "DELIVERY_OFFER_EXPIRED", actorType: "system", metadata: { attempt: order.deliveryOfferAttempts } });
  await order.save();

  for (const partnerId of order.deliveryOfferedPartnerIds) emitToPartner(partnerId, "delivery:offer_closed", { orderId: String(order._id), reason: "EXPIRED" });

  // Retry with a wider net, up to the attempt cap.
  const nextAttempt = (order.deliveryOfferAttempts ?? 1) + 1;
  const nextRadius = Math.min((order.deliveryOfferRadiusKm ?? INITIAL_RADIUS_KM) + RADIUS_STEP_KM, MAX_RADIUS_KM);
  if (nextAttempt <= MAX_OFFER_ATTEMPTS) {
    void broadcastDeliveryOffer(orderId, nextAttempt, nextRadius);
  } else {
    emitToAdmin("delivery:offer_exhausted", { orderId: String(order._id), orderNumber: order.orderNumber });
    void notifyAdminEscalation(order);
  }
}

async function notifyAdminEscalation(order: any): Promise<void> {
  // No dedicated "admin broadcast" channel for push exists yet; the socket
  // emit above plus the AuditLog entry written by the caller covers
  // visibility for now (see spec section 41 — "notify admin if necessary").
  console.warn(`[delivery] order ${order.orderNumber} exhausted all delivery-offer attempts and needs manual assignment.`);
}

export type ClaimResult =
  | { ok: true; order: any }
  | { ok: false; code: "ORDER_NOT_FOUND" }
  | { ok: false; code: "OFFER_EXPIRED" }
  | { ok: false; code: "ORDER_ALREADY_ASSIGNED" }
  | { ok: false; code: "PARTNER_NOT_ELIGIBLE" }
  | { ok: false; code: "PARTNER_HAS_ACTIVE_TASK" };

/**
 * The one function that decides who gets a delivery. Multiple partners can
 * call this for the same order at the same instant (spec section 27) — only
 * one write can match the guarded filter below, so MongoDB itself resolves
 * the race; there is no read-then-write window for two partners to both
 * "win".
 */
export async function claimDelivery(orderId: string, partner: { _id: unknown; name: string; status: string; partnerApprovalStatus?: string; partnerOnline?: boolean; partnerBusy?: boolean }): Promise<ClaimResult> {
  if (!isPartnerEligible(partner as any)) return { ok: false, code: "PARTNER_NOT_ELIGIBLE" };

  const activeTask = await Order.exists({
    partnerId: partner._id,
    status: { $nin: ["DELIVERED", "CANCELLED_BY_ADMIN", "CANCELLED_BY_CUSTOMER", "VENDOR_REJECTED"] },
  });
  if (activeTask) return { ok: false, code: "PARTNER_HAS_ACTIVE_TASK" };

  const now = new Date();
  // The guard clause IS the concurrency control: only a document that is
  // still unclaimed and still offering can be matched, and findOneAndUpdate
  // is a single atomic operation at the storage engine level.
  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      partnerId: null,
      deliveryOfferStatus: "OFFERING",
      deliveryOfferExpiresAt: { $gt: now },
      status: "READY_FOR_PICKUP",
    },
    {
      $set: { partnerId: partner._id, partnerName: partner.name, status: "DELIVERY_PARTNER_ASSIGNED", deliveryOfferStatus: "ASSIGNED" },
      $push: {
        statusHistory: { status: "DELIVERY_PARTNER_ASSIGNED", actorId: partner._id, actorRole: "DELIVERY_PARTNER", at: now },
        events: { event: "DELIVERY_PARTNER_ASSIGNED", actorType: "partner", actorId: partner._id, at: now },
      },
    },
    { new: true },
  );

  if (claimed) {
    clearOrderTimers(claimed._id);
    await User.updateOne({ _id: partner._id }, { $set: { partnerBusy: true } });

    for (const otherId of claimed.deliveryOfferedPartnerIds) {
      if (String(otherId) === String(partner._id)) continue;
      emitToPartner(otherId, "delivery:offer_closed", { orderId: String(claimed._id), reason: "ASSIGNED" });
    }
    emitOrderUpdate(claimed, "order:update", { orderId: String(claimed._id), status: claimed.status });
    void notifyUser(claimed.customerId, "Driver assigned", `${partner.name} is heading to pick up your order.`, { type: "PARTNER_ASSIGNED", orderId: String(claimed._id) }, "ORDER");
    return { ok: true, order: claimed };
  }

  // Lost the race (or the offer had already expired, or the order doesn't
  // exist). Distinguish those so the app can show the right message instead
  // of a generic error.
  const current: any = await Order.findById(orderId).lean();
  if (!current) return { ok: false, code: "ORDER_NOT_FOUND" };
  if (current.partnerId) return { ok: false, code: "ORDER_ALREADY_ASSIGNED" };
  if (current.deliveryOfferStatus !== "OFFERING" || (current.deliveryOfferExpiresAt && current.deliveryOfferExpiresAt <= now)) {
    return { ok: false, code: "OFFER_EXPIRED" };
  }
  return { ok: false, code: "ORDER_ALREADY_ASSIGNED" };
}

/**
 * Safely detaches a partner from an order that they can no longer complete
 * (cancelled, went offline, timed out) and restarts the search (spec 42).
 */
export async function unassignPartner(orderId: unknown, reason: string): Promise<void> {
  const order: any = await Order.findOneAndUpdate(
    { _id: orderId, partnerId: { $ne: null }, status: { $nin: ["DELIVERED", "CANCELLED_BY_ADMIN", "CANCELLED_BY_CUSTOMER"] } },
    {
      $set: { partnerId: null, partnerName: null, status: "READY_FOR_PICKUP", deliveryOfferStatus: "NONE" },
      $push: { events: { event: "DELIVERY_PARTNER_UNASSIGNED", actorType: "system", metadata: { reason } } },
    },
    { new: true },
  );
  if (!order) return;

  emitOrderUpdate(order, "order:update", { orderId: String(order._id), status: order.status, reason });
  void notifyUser(order.customerId, "Finding a new delivery partner", "Your previous delivery partner became unavailable — we're reassigning your order.", { type: "PARTNER_REASSIGNING", orderId: String(order._id) }, "ORDER");
  void broadcastDeliveryOffer(order._id);
}

export async function restaurantEligiblePartnersCount(restaurantId: unknown): Promise<number> {
  const restaurant: any = await Restaurant.findById(restaurantId, { latitude: 1, longitude: 1, serviceRadiusKm: 1 }).lean();
  if (!restaurant) return 0;
  const nearby = await eligiblePartnersNear(restaurant.latitude, restaurant.longitude, restaurant.serviceRadiusKm ?? INITIAL_RADIUS_KM);
  return nearby.length;
}
