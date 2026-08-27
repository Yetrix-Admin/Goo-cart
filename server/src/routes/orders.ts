import { Router } from "express";
import { AuditLog, Coupon, FoodItem, Order, Restaurant, User, nextSequence } from "../models.js";
import { calculateBill, type CouponRule } from "../lib/pricing.js";
import { canTransition, generateOrderNumber, generateOtp, TERMINAL_STATUSES, type OrderStatus } from "../lib/orderState.js";
import { canAdmin, canPartner, canVendor, hasVendorPermission, requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { claimDelivery, broadcastDeliveryOffer, unassignPartner, clearOrderTimers } from "../lib/delivery.js";
import { emitOrderUpdate } from "../lib/realtime.js";
import { notifyUser, notifyUsers } from "../lib/push.js";

export const ordersRouter = Router();

const VALID_PAYMENT = ["UPI", "GPAY", "PHONEPE", "PAYTM", "CARD", "NETBANKING", "WALLET", "COD"];

// A vendor is not left waiting forever on the customer's behalf: no response
// within this window surfaces as an escalation to admin (spec section 43).
export const MANUAL_ACCEPTANCE_TIMEOUT_MINUTES = Number(process.env.MANUAL_ACCEPTANCE_TIMEOUT_MINUTES) || 5;

class OrderError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/**
 * Re-prices every line from the database. Client-supplied prices are ignored
 * entirely, so a tampered request cannot buy a ₹340 biryani for ₹1.
 */
async function priceLines(restaurantId: string, requested: any[]) {
  if (!Array.isArray(requested) || requested.length === 0) throw new OrderError("EMPTY_CART", "Your cart is empty.");

  const lines = [];
  for (const line of requested) {
    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new OrderError("INVALID_QUANTITY", "Item quantity must be between 1 and 50.");
    }

    const item: any = await FoodItem.findById(line.foodItemId).lean().catch(() => null);
    if (!item) throw new OrderError("ITEM_NOT_FOUND", "An item in your cart no longer exists.");
    if (String(item.restaurantId) !== String(restaurantId)) {
      throw new OrderError("MULTI_VENDOR_CART", "All items must come from the same restaurant.", 409);
    }
    if (!item.available) throw new OrderError("ITEM_UNAVAILABLE", `${item.name} is currently unavailable.`, 409);

    let basePrice = item.price;
    let variant = null;
    if (line.variantId) {
      const v = (item.variants ?? []).find((x: any) => x.key === line.variantId);
      if (!v) throw new OrderError("VARIANT_NOT_FOUND", `That option for ${item.name} is no longer available.`, 409);
      basePrice = v.price;
      variant = { key: v.key, name: v.name, price: v.price };
    }

    const addons = [];
    for (const addonId of line.addonIds ?? []) {
      const found = (item.addonGroups ?? []).flatMap((g: any) => g.options ?? []).find((o: any) => o.key === addonId);
      if (!found) throw new OrderError("ADDON_NOT_FOUND", `An extra on ${item.name} is no longer available.`, 409);
      addons.push({ key: found.key, name: found.name, price: found.price });
    }

    for (const group of (item.addonGroups ?? []).filter((g: any) => g.required)) {
      const keys = (group.options ?? []).map((o: any) => o.key);
      if (!addons.some((a) => keys.includes(a.key))) {
        throw new OrderError("MISSING_REQUIRED_OPTION", `Please choose ${group.name} for ${item.name}.`);
      }
    }

    const unitPrice = basePrice + addons.reduce((s, a) => s + a.price, 0);
    lines.push({
      foodItemId: item._id,
      name: item.name,
      imageUrl: item.imageUrl,
      veg: item.veg,
      quantity,
      unitPrice,
      lineTotal: Math.round(unitPrice * quantity),
      variant,
      addons,
    });
  }
  return lines;
}

async function resolveCoupon(code: string | null | undefined): Promise<CouponRule | null> {
  if (!code) return null;
  const c: any = await Coupon.findOne({ code: String(code).toUpperCase(), active: true }).lean();
  if (!c) throw new OrderError("INVALID_COUPON", "That coupon is not valid.", 409);
  return { code: c.code, type: c.type, value: c.value, minOrder: c.minOrder, maxDiscount: c.maxDiscount ?? null };
}

/** Every vendor login tied to a restaurant: the owner plus any staff. */
async function vendorRecipients(restaurantId: unknown): Promise<any[]> {
  const restaurant: any = await Restaurant.findById(restaurantId, { ownerUserId: 1 }).lean();
  const staff = await User.find({ vendorId: restaurantId }, { _id: 1, role: 1, vendorPermissions: 1 }).lean();
  if (restaurant?.ownerUserId && !staff.some((s: any) => String(s._id) === String(restaurant.ownerUserId))) {
    const owner = await User.findById(restaurant.ownerUserId, { _id: 1, role: 1, vendorPermissions: 1 }).lean();
    if (owner) staff.push(owner as any);
  }
  return staff;
}

ordersRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const restaurant: any = await Restaurant.findById(body.restaurantId).lean().catch(() => null);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));
    if (!restaurant.isOpen) return res.status(409).json(fail("RESTAURANT_CLOSED", `${restaurant.name} is not accepting orders right now.`));
    if (restaurant.status && restaurant.status !== "ACTIVE") {
      return res.status(409).json(fail("RESTAURANT_UNAVAILABLE", `${restaurant.name} is not accepting orders right now.`));
    }

    const paymentMethod = String(body.paymentMethod ?? "");
    if (!VALID_PAYMENT.includes(paymentMethod)) return res.status(400).json(fail("INVALID_PAYMENT_METHOD", "Choose a valid payment method."));
    if (!body.deliveryAddress) return res.status(400).json(fail("ADDRESS_REQUIRED", "A delivery address is required."));

    const lines = await priceLines(String(restaurant._id), body.items);
    const coupon = await resolveCoupon(body.couponCode);
    const bill = calculateBill(lines, coupon, Number(body.tip) || 0);

    const orderNumber = generateOrderNumber(await nextSequence("orderNumber"));
    const now = new Date();

    // Spec sections 15-18: the vendor's own setting decides whether this
    // order needs a human to press Accept, or the backend accepts it for
    // them immediately. Either way the order exists in Mongo before either
    // path runs — nothing here is simulated client-side.
    const manualAcceptanceRequired = restaurant.manualOrderAcceptance !== false;
    const initialStatus: OrderStatus = manualAcceptanceRequired ? "PLACED" : "VENDOR_ACCEPTED";

    const events = [{ event: "ORDER_PLACED", actorType: "customer", actorId: req.user!._id, at: now }];
    if (manualAcceptanceRequired) {
      events.push({ event: "VENDOR_NOTIFIED", actorType: "system", actorId: null, at: now } as any);
    } else {
      events.push({ event: "ORDER_AUTO_ACCEPTED", actorType: "system", actorId: null, at: now } as any);
    }

    const [order] = await Order.create([
      {
        orderNumber,
        customerId: req.user!._id,
        customerName: req.user!.name,
        restaurantId: restaurant._id,
        restaurantName: restaurant.name,
        restaurantArea: restaurant.area,
        restaurantLatitude: restaurant.latitude,
        restaurantLongitude: restaurant.longitude,
        status: initialStatus,
        paymentMethod,
        paymentStatus: paymentMethod === "COD" ? "NOT_APPLICABLE" : "PAID",
        couponCode: coupon?.code ?? null,
        instructions: Array.isArray(body.instructions) ? body.instructions : [],
        bill,
        deliveryAddress: body.deliveryAddress,
        deliveryOtp: generateOtp(),
        estimatedDeliveryMinutes: restaurant.deliveryTimeMax,
        items: lines,
        manualAcceptanceRequired,
        manualAcceptanceDeadlineAt: manualAcceptanceRequired ? new Date(now.getTime() + MANUAL_ACCEPTANCE_TIMEOUT_MINUTES * 60_000) : null,
        autoAccepted: !manualAcceptanceRequired,
        statusHistory: [
          { status: "PLACED", actorId: req.user!._id, actorRole: req.user!.role, at: now },
          ...(manualAcceptanceRequired ? [] : [{ status: "VENDOR_ACCEPTED", actorId: null, actorRole: "system", at: now }]),
        ],
        events,
      },
    ]);

    await AuditLog.create({
      actorId: req.user!._id,
      actorRole: req.user!.role,
      action: "order.create",
      entityType: "order",
      entityId: String(order._id),
      after: { orderNumber, total: bill.total },
    });

    const dto = toOrderDTO(order.toObject(), req.user!);
    emitOrderUpdate(order, manualAcceptanceRequired ? "order:new" : "order:update", { order: dto });

    void notifyUser(req.user!._id, "Order placed", `Your order ${orderNumber} has been placed.`, { type: "ORDER_PLACED", orderId: String(order._id) }, "ORDER");

    const recipients = await vendorRecipients(restaurant._id);
    if (manualAcceptanceRequired) {
      const actionable = recipients.filter((r) => hasVendorPermission(r, "CAN_ACCEPT_ORDER"));
      const viewOnly = recipients.filter((r) => !hasVendorPermission(r, "CAN_ACCEPT_ORDER"));
      void notifyUsers(actionable.map((r) => r._id), "New Order — Accept required", `${orderNumber} • ₹${bill.total} • ${lines.length} items`, { type: "ORDER_NEW", orderId: String(order._id), actionable: true }, "VENDOR");
      void notifyUsers(viewOnly.map((r) => r._id), "New Order Received", `${orderNumber} • ₹${bill.total}`, { type: "ORDER_NEW", orderId: String(order._id), actionable: false }, "VENDOR");
    } else {
      void notifyUsers(recipients.map((r) => r._id), "New Order Received", `${orderNumber} • Automatically Accepted`, { type: "ORDER_AUTO_ACCEPTED", orderId: String(order._id) }, "VENDOR");
    }

    res.json(ok({ order: dto }, "Order placed"));
  } catch (e) {
    if (e instanceof OrderError) return res.status(e.status).json(fail(e.code, e.message));
    res.status(500).json(fail("ORDER_FAILED", e instanceof Error ? e.message : "Could not place order"));
  }
});

ordersRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    let filter: Record<string, unknown>;

    if (canAdmin(user)) filter = {};
    else if (canVendor(user)) {
      const owned = await Restaurant.find({ $or: [{ ownerUserId: user._id }, { _id: (user as any).vendorId ?? null }] }, { _id: 1 }).lean();
      filter = { restaurantId: { $in: owned.map((r: any) => r._id) } };
    } else if (canPartner(user)) {
      // A partner sees jobs actually offered to them (still within the
      // active offer window) plus anything already assigned to them —
      // never every unclaimed order platform-wide.
      filter = {
        $or: [
          { partnerId: user._id },
          { partnerId: null, deliveryOfferStatus: "OFFERING", deliveryOfferedPartnerIds: user._id, deliveryOfferExpiresAt: { $gt: new Date() } },
        ],
      };
    } else filter = { customerId: user._id };

    const rows = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(ok({ orders: rows.map((r) => toOrderDTO(r, user)) }));
  } catch (e) {
    res.status(500).json(fail("ORDERS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load orders"));
  }
});

ordersRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const order: any = await Order.findById(req.params.id).lean().catch(() => null);
    if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));
    if (!(await mayView(req.user!, order))) return res.status(403).json(fail("FORBIDDEN", "This order is outside your scope"));
    res.json(ok({ order: toOrderDTO(order, req.user!) }));
  } catch (e) {
    res.status(500).json(fail("ORDER_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load order"));
  }
});

// Permission required, per target status, for a vendor-side actor. Owners
// bypass this (hasVendorPermission always returns true for VENDOR_OWNER).
const VENDOR_STATUS_PERMISSION: Partial<Record<OrderStatus, string>> = {
  VENDOR_ACCEPTED: "CAN_ACCEPT_ORDER",
  VENDOR_REJECTED: "CAN_REJECT_ORDER",
  PREPARING: "CAN_UPDATE_ORDER_STATUS",
  READY_FOR_PICKUP: "CAN_MARK_READY",
};

ordersRouter.post("/:id/transition", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const to = String(req.body?.to ?? "") as OrderStatus;
    const order: any = await Order.findById(req.params.id).catch(() => null);
    if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));

    const group = await transitionGroup(user, order);
    if (!group) return res.status(403).json(fail("FORBIDDEN", "This order is outside your scope"));

    const from = order.status as OrderStatus;
    if (!canTransition(group, from, to)) return res.status(409).json(fail("INVALID_TRANSITION", `${from} cannot move to ${to}`));

    if (group === "vendor") {
      const permission = VENDOR_STATUS_PERMISSION[to];
      if (permission && !hasVendorPermission(user, permission)) {
        return res.status(403).json(fail("FORBIDDEN", `Your account does not have permission to do this (${permission} required).`));
      }
    }

    // Delivery assignment is the one transition with a real concurrency
    // hazard (multiple partners racing for one job), so it is delegated
    // entirely to claimDelivery()'s atomic guarded update rather than the
    // generic findOneAndUpdate below.
    if (group === "partner" && to === "DELIVERY_PARTNER_ASSIGNED") {
      const result = await claimDelivery(String(order._id), user as any);
      if (!result.ok) {
        const messages: Record<string, [number, string]> = {
          ORDER_NOT_FOUND: [404, "Order not found"],
          OFFER_EXPIRED: [409, "This delivery offer has expired."],
          ORDER_ALREADY_ASSIGNED: [409, "This delivery has already been accepted by another delivery partner."],
          PARTNER_NOT_ELIGIBLE: [409, "Go online before accepting a delivery."],
          PARTNER_HAS_ACTIVE_TASK: [409, "Complete your current task before accepting another."],
        };
        const [status, message] = messages[result.code] ?? [500, "Could not accept this delivery."];
        return res.status(status).json(fail(result.code, message));
      }
      return res.json(ok({ order: toOrderDTO(result.order, user) }, "Delivery accepted"));
    }

    // Delivery is only confirmed by the OTP the customer holds.
    if (to === "DELIVERED" && group === "partner" && String(req.body?.code ?? "").trim() !== order.deliveryOtp) {
      return res.status(401).json(fail("INVALID_CODE", "That verification PIN is incorrect"));
    }

    const now = new Date();
    const update: Record<string, unknown> = { status: to };
    const push: Record<string, unknown> = {
      statusHistory: { status: to, actorId: user._id, actorRole: user.role, at: now },
      events: { event: to, actorType: group, actorId: user._id, at: now },
    };

    const updated = await Order.findOneAndUpdate({ _id: order._id, status: from }, { $set: update, $push: push }, { new: true });

    if (!updated) return res.status(409).json(fail("CONFLICT", "That order was just updated by someone else. Refresh and try again."));

    // A partner finishing (or a terminal state clearing their assignment)
    // frees them up for the next job.
    if (updated.partnerId && (to === "DELIVERED" || TERMINAL_STATUSES.includes(to))) {
      await User.updateOne({ _id: updated.partnerId }, { $set: { partnerBusy: false } });
    }
    if (TERMINAL_STATUSES.includes(to)) {
      clearOrderTimers(updated._id);
      if (!updated.partnerId && updated.deliveryOfferStatus === "OFFERING") {
        updated.deliveryOfferStatus = "EXPIRED";
        await updated.save();
      }
    }

    await AuditLog.create({
      actorId: user._id,
      actorRole: user.role,
      action: "order.transition",
      entityType: "order",
      entityId: String(order._id),
      before: { status: from },
      after: { status: to },
    });

    emitOrderUpdate(updated, "order:update", { orderId: String(updated._id), status: to });
    void sendTransitionPush(updated, to, group);

    // A vendor marking the order ready is the trigger that opens the
    // delivery pool to nearby partners (spec section 25) — never earlier,
    // so a delivery partner cannot see (let alone claim) an order the
    // vendor hasn't even started preparing yet.
    if (group === "vendor" && to === "READY_FOR_PICKUP") void broadcastDeliveryOffer(updated._id);

    res.json(ok({ order: toOrderDTO(updated, user) }, "Status updated"));
  } catch (e) {
    res.status(500).json(fail("TRANSITION_FAILED", e instanceof Error ? e.message : "Could not update order"));
  }
});

// Customer/admin cancellation, or an admin override, may need to free a
// partner who was already on the job (spec section 42).
ordersRouter.post("/:id/cancel", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const order: any = await Order.findById(req.params.id);
    if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));

    const group = canAdmin(user) ? "admin" : String(user._id) === String(order.customerId) ? "customer" : null;
    if (!group) return res.status(403).json(fail("FORBIDDEN", "This order is outside your scope"));

    const to: OrderStatus = group === "admin" ? "CANCELLED_BY_ADMIN" : "CANCELLED_BY_CUSTOMER";
    const from = order.status as OrderStatus;
    if (!canTransition(group, from, to)) {
      return res.status(409).json(fail("CANNOT_CANCEL", "This order can no longer be cancelled."));
    }

    const now = new Date();
    const previousPartnerId = order.partnerId;
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: from },
      {
        $set: { status: to },
        $push: {
          statusHistory: { status: to, actorId: user._id, actorRole: user.role, at: now },
          events: { event: to, actorType: group, actorId: user._id, at: now, metadata: { reason: req.body?.reason ?? null } },
        },
      },
      { new: true },
    );
    if (!updated) return res.status(409).json(fail("CONFLICT", "That order was just updated by someone else."));

    clearOrderTimers(updated._id);
    if (previousPartnerId) await User.updateOne({ _id: previousPartnerId }, { $set: { partnerBusy: false } });

    await AuditLog.create({ actorId: user._id, actorRole: user.role, action: "order.cancel", entityType: "order", entityId: String(order._id), before: { status: from }, after: { status: to } });

    emitOrderUpdate(updated, "order:update", { orderId: String(updated._id), status: to });
    void notifyUser(updated.customerId, "Order cancelled", `Order ${updated.orderNumber} was cancelled.`, { type: "ORDER_CANCELLED", orderId: String(updated._id) }, "ORDER");
    if (previousPartnerId) void notifyUser(previousPartnerId, "Delivery cancelled", `Order ${updated.orderNumber} was cancelled.`, { type: "DELIVERY_CANCELLED", orderId: String(updated._id) }, "DELIVERY");

    res.json(ok({ order: toOrderDTO(updated, user) }, "Order cancelled"));
  } catch (e) {
    res.status(500).json(fail("CANCEL_FAILED", e instanceof Error ? e.message : "Could not cancel order"));
  }
});

// A partner going offline, or the app detecting they've stalled, releases
// them from an in-progress job and restarts the search for someone else.
ordersRouter.post("/:id/release-partner", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = req.user!;
    const order: any = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));
    const isOwnJob = canPartner(user) && String(order.partnerId) === String(user._id);
    if (!isOwnJob && !canAdmin(user)) return res.status(403).json(fail("FORBIDDEN", "This order is outside your scope"));

    await unassignPartner(order._id, req.body?.reason ?? "PARTNER_RELEASED");
    if (isOwnJob) await User.updateOne({ _id: user._id }, { $set: { partnerBusy: false } });

    res.json(ok(null, "Released"));
  } catch (e) {
    res.status(500).json(fail("RELEASE_FAILED", e instanceof Error ? e.message : "Could not release this delivery"));
  }
});

async function sendTransitionPush(order: any, to: OrderStatus, group: string): Promise<void> {
  const CUSTOMER_MESSAGES: Partial<Record<OrderStatus, string>> = {
    VENDOR_ACCEPTED: "Your order has been accepted by the restaurant.",
    PREPARING: "The restaurant is preparing your order.",
    READY_FOR_PICKUP: "Your order is ready and waiting for pickup.",
    DELIVERY_PARTNER_ASSIGNED: "A delivery partner has been assigned to your order.",
    PICKED_UP: "Your order has been picked up.",
    ON_THE_WAY: "Your order is on the way.",
    ARRIVED: "Your delivery partner has arrived.",
    DELIVERED: "Your order has been delivered. Enjoy!",
    VENDOR_REJECTED: "The restaurant was unable to accept your order.",
  };
  const message = CUSTOMER_MESSAGES[to];
  if (message) void notifyUser(order.customerId, `Order ${order.orderNumber}`, message, { type: "ORDER_STATUS", orderId: String(order._id), status: to }, "ORDER");

  if (group === "partner" && ["GOING_TO_VENDOR", "ARRIVED_AT_VENDOR"].includes(to)) {
    void notifyUsers(
      (await vendorRecipients(order.restaurantId)).map((r) => r._id),
      "Delivery partner update",
      to === "ARRIVED_AT_VENDOR" ? "Your delivery partner has arrived to collect the order." : "A delivery partner is on the way to collect the order.",
      { type: "PARTNER_STATUS", orderId: String(order._id), status: to },
      "VENDOR",
    );
  }
}

async function mayView(user: any, order: any): Promise<boolean> {
  if (canAdmin(user)) return true;
  if (String(user._id) === String(order.customerId)) return true;
  if (canPartner(user)) return String(order.partnerId) === String(user._id) || (order.deliveryOfferedPartnerIds ?? []).some((id: unknown) => String(id) === String(user._id));
  if (canVendor(user)) return Boolean(await Restaurant.exists({ _id: order.restaurantId, ownerUserId: user._id })) || String(user.vendorId) === String(order.restaurantId);
  return false;
}

async function transitionGroup(user: any, order: any): Promise<string | null> {
  if (String(user._id) === String(order.customerId)) return "customer";
  const ownsVendor = String(user.vendorId ?? "") === String(order.restaurantId) || (await Restaurant.exists({ _id: order.restaurantId, ownerUserId: user._id }));
  if (canVendor(user) && ownsVendor) return "vendor";
  if (canPartner(user) && (!order.partnerId || String(order.partnerId) === String(user._id))) return "partner";
  if (canAdmin(user)) return "admin";
  return null;
}

export function toOrderDTO(o: any, viewer: any) {
  // The delivery OTP is the customer's proof of receipt — only they and the
  // assigned partner ever see it.
  const seesOtp = String(viewer._id) === String(o.customerId) || (o.partnerId && String(viewer._id) === String(o.partnerId));

  return {
    id: String(o._id),
    orderNumber: o.orderNumber,
    serviceType: "FOOD" as const,
    customerId: String(o.customerId),
    customerName: o.customerName,
    restaurantId: String(o.restaurantId),
    restaurantName: o.restaurantName,
    restaurantArea: o.restaurantArea,
    restaurantLatitude: o.restaurantLatitude,
    restaurantLongitude: o.restaurantLongitude,
    status: o.status,
    manualAcceptanceRequired: o.manualAcceptanceRequired ?? true,
    autoAccepted: Boolean(o.autoAccepted),
    deliveryOfferStatus: o.deliveryOfferStatus ?? "NONE",
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    couponCode: o.couponCode,
    instructions: o.instructions ?? [],
    bill: o.bill,
    deliveryAddress: o.deliveryAddress,
    deliveryOtp: seesOtp ? o.deliveryOtp : null,
    estimatedDeliveryMinutes: o.estimatedDeliveryMinutes,
    deliveryPartner: o.partnerId
      ? { id: String(o.partnerId), name: o.partnerName, latitude: null as number | null, longitude: null as number | null }
      : null,
    items: (o.items ?? []).map((i: any) => ({
      lineId: String(i._id),
      foodItemId: String(i.foodItemId),
      name: i.name,
      imageUrl: i.imageUrl,
      veg: i.veg,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      selectedVariant: i.variant ? { id: i.variant.key, name: i.variant.name, price: i.variant.price } : null,
      selectedAddons: (i.addons ?? []).map((a: any) => ({ id: a.key, name: a.name, price: a.price })),
    })),
    statusHistory: (o.statusHistory ?? []).map((h: any) => ({ status: h.status, at: h.at })),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
