import { Router } from "express";
import mongoose from "mongoose";
import { AuditLog, Coupon, FoodItem, Order, Restaurant, Setting, nextSequence } from "../models.js";
import { calculateBill, type CouponRule } from "../lib/pricing.js";
import { canTransition, generateOrderNumber, generateOtp, type OrderStatus } from "../lib/orderState.js";
import { canAdmin, canPartner, canVendor, requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";

export const ordersRouter = Router();

const VALID_PAYMENT = ["UPI", "GPAY", "PHONEPE", "PAYTM", "CARD", "NETBANKING", "WALLET", "COD"];

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

ordersRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const restaurant: any = await Restaurant.findById(body.restaurantId).lean().catch(() => null);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));
    if (!restaurant.isOpen) return res.status(409).json(fail("RESTAURANT_CLOSED", `${restaurant.name} is not accepting orders right now.`));

    const paymentMethod = String(body.paymentMethod ?? "");
    if (!VALID_PAYMENT.includes(paymentMethod)) return res.status(400).json(fail("INVALID_PAYMENT_METHOD", "Choose a valid payment method."));
    if (!body.deliveryAddress) return res.status(400).json(fail("ADDRESS_REQUIRED", "A delivery address is required."));

    const lines = await priceLines(String(restaurant._id), body.items);
    const coupon = await resolveCoupon(body.couponCode);
    const bill = calculateBill(lines, coupon, Number(body.tip) || 0);

    const orderNumber = generateOrderNumber(await nextSequence("orderNumber"));
    const now = new Date();

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
        status: "PLACED",
        paymentMethod,
        paymentStatus: paymentMethod === "COD" ? "NOT_APPLICABLE" : "PAID",
        couponCode: coupon?.code ?? null,
        instructions: Array.isArray(body.instructions) ? body.instructions : [],
        bill,
        deliveryAddress: body.deliveryAddress,
        deliveryOtp: generateOtp(),
        estimatedDeliveryMinutes: restaurant.deliveryTimeMax,
        items: lines,
        statusHistory: [{ status: "PLACED", actorId: req.user!._id, actorRole: req.user!.role, at: now }],
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

    res.json(ok({ order: toOrderDTO(order.toObject(), req.user!) }, "Order placed"));
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
      const owned = await Restaurant.find({ ownerUserId: user._id }, { _id: 1 }).lean();
      filter = { restaurantId: { $in: owned.map((r: any) => r._id) } };
    } else if (canPartner(user)) {
      filter = { $or: [{ partnerId: user._id }, { partnerId: null, status: "READY_FOR_PICKUP" }] };
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

    const claiming = group === "partner" && to === "DELIVERY_PARTNER_ASSIGNED";
    if (claiming) {
      const online = await Setting.findById(`partner_online:${user._id}`).lean();
      if (!online || String((online as any).value) !== "true") {
        return res.status(409).json(fail("PARTNER_OFFLINE", "Go online before accepting a delivery"));
      }
      const active = await Order.findOne({
        partnerId: user._id,
        status: { $nin: ["DELIVERED", "CANCELLED_BY_ADMIN", "CANCELLED_BY_CUSTOMER", "VENDOR_REJECTED"] },
      }).lean();
      if (active) return res.status(409).json(fail("ACTIVE_TASK_EXISTS", "Complete your current task before accepting another"));
    }

    // Delivery is only confirmed by the OTP the customer holds.
    if (to === "DELIVERED" && group === "partner" && String(req.body?.code ?? "").trim() !== order.deliveryOtp) {
      return res.status(401).json(fail("INVALID_CODE", "That verification PIN is incorrect"));
    }

    // Guarded on `status: from` so two partners racing to claim the same job
    // cannot both succeed.
    const update: Record<string, unknown> = { status: to };
    if (claiming) {
      update.partnerId = user._id;
      update.partnerName = user.name;
    }

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: from },
      { $set: update, $push: { statusHistory: { status: to, actorId: user._id, actorRole: user.role, at: new Date() } } },
      { new: true },
    ).lean();

    if (!updated) return res.status(409).json(fail("CONFLICT", "That order was just updated by someone else. Refresh and try again."));

    await AuditLog.create({
      actorId: user._id,
      actorRole: user.role,
      action: "order.transition",
      entityType: "order",
      entityId: String(order._id),
      before: { status: from },
      after: { status: to },
    });

    res.json(ok({ order: toOrderDTO(updated, user) }, "Status updated"));
  } catch (e) {
    res.status(500).json(fail("TRANSITION_FAILED", e instanceof Error ? e.message : "Could not update order"));
  }
});

async function mayView(user: any, order: any): Promise<boolean> {
  if (canAdmin(user)) return true;
  if (String(user._id) === String(order.customerId)) return true;
  if (canPartner(user)) return String(order.partnerId) === String(user._id) || (!order.partnerId && order.status === "READY_FOR_PICKUP");
  if (canVendor(user)) return Boolean(await Restaurant.exists({ _id: order.restaurantId, ownerUserId: user._id }));
  return false;
}

async function transitionGroup(user: any, order: any): Promise<string | null> {
  if (String(user._id) === String(order.customerId)) return "customer";
  if (canVendor(user) && (await Restaurant.exists({ _id: order.restaurantId, ownerUserId: user._id }))) return "vendor";
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
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    couponCode: o.couponCode,
    instructions: o.instructions ?? [],
    bill: o.bill,
    deliveryAddress: o.deliveryAddress,
    deliveryOtp: seesOtp ? o.deliveryOtp : null,
    estimatedDeliveryMinutes: o.estimatedDeliveryMinutes,
    deliveryPartner: o.partnerId ? { id: String(o.partnerId), name: o.partnerName } : null,
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
