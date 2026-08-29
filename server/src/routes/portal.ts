import { Router } from "express";
import mongoose from "mongoose";
import {
  AuditLog,
  Order,
  PricingRule,
  Product,
  Restaurant,
  ServiceConfig,
  ServiceOrder,
  Setting,
  User,
  VendorOffer,
  nextSequence,
} from "../models.js";
import { canAdmin, canPartner, canVendor, requireAuth, type AuthedRequest } from "../lib/auth.js";
import { canTransition, type OrderStatus } from "../lib/orderState.js";
import { ok, fail } from "../lib/http.js";
import { getPricingSettings } from "../lib/pricingSettings.js";
import { reserveLines, consumeReservations, releaseReservations } from "../lib/inventory.js";
import { writeAuditLog } from "../lib/audit.js";
import { claimDelivery } from "../lib/delivery.js";

export const portalRouter = Router();

const COMMERCE = ["Food", "Grocery", "Vegetables", "Mart"];
const SERVICES = [...COMMERCE, "Bike Taxi", "Parcel"];
const TERMINAL = ["DELIVERED", "COMPLETED", "CANCELLED_BY_ADMIN", "CANCELLED_BY_CUSTOMER", "VENDOR_REJECTED"];

async function audit(user: any, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  await writeAuditLog({ actor: user, action, entityType, entityId, before, after });
}

// --- Snapshot -------------------------------------------------------------

/**
 * The portal renders one flat order queue covering every service. Food orders
 * live in their own richer collection, so they are projected into the same
 * shape here rather than the UI having to understand two models.
 */
function foodOrderToLegacy(o: any, viewer: any) {
  const seesOtp = String(viewer._id) === String(o.customerId) || (o.partnerId && String(viewer._id) === String(o.partnerId));
  const addr: any = o.deliveryAddress ?? {};
  return {
    id: String(o._id),
    reference: o.orderNumber,
    service: "Food",
    vendor: o.restaurantName,
    vendor_id: String(o.restaurantId),
    customer: o.customerName,
    customer_id: String(o.customerId),
    partner: o.partnerName ?? null,
    partner_id: o.partnerId ? String(o.partnerId) : null,
    status: o.status,
    total: o.bill?.total ?? 0,
    details: {
      items: (o.items ?? []).map((i: any) => ({ name: i.variant ? `${i.name} (${i.variant.name})` : i.name, qty: i.quantity })),
      address: [addr.line1, addr.city].filter(Boolean).join(", ") || "Customer address",
      ...(seesOtp ? { verificationCode: o.deliveryOtp } : {}),
    },
    created_at: o.createdAt,
    updated_at: o.updatedAt,
    source: "food" as const,
  };
}

function serviceOrderToLegacy(o: any, viewer: any) {
  const seesOtp = String(viewer._id) === String(o.customerId) || (o.partnerId && String(viewer._id) === String(o.partnerId));
  const details = { ...(o.details ?? {}) };
  if (!seesOtp) delete details.verificationCode;
  return {
    id: String(o._id),
    reference: o.reference,
    service: o.service,
    vendor: o.vendorName,
    vendor_id: o.vendorId ? String(o.vendorId) : "platform",
    customer: o.customerName,
    customer_id: String(o.customerId),
    partner: o.partnerName ?? null,
    partner_id: o.partnerId ? String(o.partnerId) : null,
    status: o.status,
    total: o.total,
    details,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
    source: "service" as const,
  };
}

async function ownedRestaurantIds(user: any): Promise<mongoose.Types.ObjectId[]> {
  if (!canVendor(user)) return [];
  const rows = await Restaurant.find({ ownerUserId: user._id }, { _id: 1 }).lean();
  return rows.map((r: any) => r._id);
}

async function buildSnapshot(user: any) {
  const admin = canAdmin(user);
  const vendor = canVendor(user);
  const partner = canPartner(user);
  const owned = await ownedRestaurantIds(user);

  // Partners see only work already assigned to them plus food delivery offers
  // explicitly broadcast to them. Knowing an order id must never be enough to
  // self-assign an arbitrary ready order.
  const foodFilter = admin
    ? {}
    : vendor
      ? { restaurantId: { $in: owned } }
      : partner
        ? { $or: [{ partnerId: user._id }, { partnerId: null, deliveryOfferStatus: "OFFERING", deliveryOfferedPartnerIds: user._id, deliveryOfferExpiresAt: { $gt: new Date() } }] }
        : { customerId: user._id };

  const serviceFilter = admin
    ? {}
    : vendor
      ? { vendorId: user._id }
      : partner
        ? { $or: [{ partnerId: user._id }, { partnerId: null, status: { $in: ["READY_FOR_PICKUP", "REQUESTED", "CREATED"] } }] }
        : { customerId: user._id };

  const productFilter = admin ? {} : vendor ? { vendorId: user._id } : { stock: { $gt: 0 } };

  const [foodOrders, serviceOrders, products, offers, services, pricing, settings, users, audits] = await Promise.all([
    Order.find(foodFilter).sort({ createdAt: -1 }).limit(200).lean(),
    ServiceOrder.find(serviceFilter).sort({ createdAt: -1 }).limit(200).lean(),
    Product.find(productFilter).sort({ service: 1, name: 1 }).lean(),
    vendor ? VendorOffer.find({ vendorId: user._id }).sort({ createdAt: -1 }).lean() : admin ? VendorOffer.find().sort({ createdAt: -1 }).lean() : [],
    ServiceConfig.find().lean(),
    PricingRule.find().lean(),
    Setting.find({ _id: { $in: [`partner_online:${user._id}`, `vendor_open:${user._id}`] } }).lean(),
    admin ? User.find({}, { email: 1, name: 1, role: 1, status: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(200).lean() : [],
    admin ? AuditLog.find().sort({ createdAt: -1 }).limit(100).lean() : [],
  ]);

  const orders = [...foodOrders.map((o) => foodOrderToLegacy(o, user)), ...serviceOrders.map((o) => serviceOrderToLegacy(o, user))].sort(
    (a, b) => new Date(b.created_at as any).getTime() - new Date(a.created_at as any).getTime(),
  );

  const settingMap: Record<string, string> = {};
  for (const s of settings as any[]) {
    const key = String(s._id).startsWith("partner_online:") ? "partner_online" : String(s._id).startsWith("vendor_open:") ? "vendor_open" : String(s._id);
    settingMap[key] = String(s.value);
  }
  if (partner) settingMap.partner_online = user.partnerOnline ? "true" : "false";

  return {
    actor: { id: String(user._id), email: user.email, name: user.name, role: user.role, status: user.status },
    products: (products as any[]).map((p) => ({
      id: String(p._id),
      service: p.service,
      vendor: p.vendorName,
      vendor_id: String(p.vendorId),
      name: p.name,
      description: p.description,
      price: p.price,
      stock: p.stock,
      rating: p.rating,
      eta: p.eta,
    })),
    orders,
    offers: (offers as any[]).map((o) => ({
      id: String(o._id),
      vendor_id: String(o.vendorId),
      vendor: o.vendorName,
      title: o.title,
      code: o.code,
      discount_percent: o.discountPercent,
      min_order: o.minOrder,
      active: o.active ? 1 : 0,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
    })),
    services: SERVICES.map((s) => ({ service: s, enabled: (services as any[]).find((c) => c._id === s)?.enabled === false ? 0 : 1 })),
    pricing: (pricing as any[]).map((p) => ({ service: p._id, base_fare: p.baseFare, per_km: p.perKm, platform_fee: p.platformFee, partner_payout_percent: p.partnerPayoutPercent ?? 80 })),
    settings: settingMap,
    users: (users as any[]).map((u) => ({ id: String(u._id), email: u.email, name: u.name, role: u.role, status: u.status, created_at: u.createdAt })),
    auditLogs: audits as unknown[],
  };
}

portalRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    res.json(ok(await buildSnapshot(req.user)));
  } catch (e) {
    res.status(500).json(fail("STATE_LOAD_FAILED", e instanceof Error ? e.message : "Unable to load Goocart"));
  }
});

// --- Actions --------------------------------------------------------------

portalRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const body = req.body ?? {};
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "product.create": {
        if (!canVendor(user) && !canAdmin(user)) return res.status(403).json(fail("FORBIDDEN", "Vendor access required"));
        const service = String(body.service);
        const name = String(body.name ?? "").trim();
        const description = String(body.description ?? "").trim();
        const price = Number(body.price);
        const stock = Math.floor(Number(body.stock));
        if (!COMMERCE.includes(service) || name.length < 2 || description.length < 3 || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
          return res.status(400).json(fail("INVALID_PRODUCT", "Enter valid product details"));
        }
        const doc = await Product.create({
          service,
          vendorId: user._id,
          vendorName: user.name,
          name,
          description,
          price,
          stock,
          eta: String(body.eta ?? "30–45 min"),
        });
        await audit(user, "product.create", "product", String(doc._id), null, { service, name, price, stock });
        return res.json(ok(await buildSnapshot(user), "Product created"));
      }

      case "stock.adjust": {
        if (!canVendor(user) && !canAdmin(user)) return res.status(403).json(fail("FORBIDDEN", "Inventory access required"));
        const amount = Math.max(-100, Math.min(100, Math.floor(Number(body.amount) || 0)));
        const filter: any = { _id: body.id };
        if (canVendor(user)) filter.vendorId = user._id;
        const product: any = await Product.findOne(filter);
        if (!product) return res.status(404).json(fail("PRODUCT_NOT_FOUND", "Product not found"));
        const before = product.stock;
        product.stock = Math.max(0, before + amount);
        await product.save();
        await audit(user, "stock.adjust", "product", String(product._id), { stock: before }, { stock: product.stock });
        return res.json(ok(await buildSnapshot(user), "Inventory updated"));
      }

      case "order.transition": {
        const id = String(body.id);
        const to = String(body.to) as OrderStatus;
        const code = String(body.code ?? "").trim();
        const result = await transitionAnyOrder(user, id, to, code);
        if (!result.ok) return res.status(result.status).json(fail(result.code, result.message));
        return res.json(ok(await buildSnapshot(user), "Status updated"));
      }

      case "service.toggle": {
        if (!canAdmin(user)) return res.status(403).json(fail("FORBIDDEN", "Admin access required"));
        const service = String(body.service);
        if (!SERVICES.includes(service)) return res.status(400).json(fail("INVALID_SERVICE", "Unknown service"));
        await ServiceConfig.findByIdAndUpdate(service, { enabled: Boolean(body.enabled) }, { upsert: true });
        await audit(user, "service.toggle", "service", service, null, { enabled: Boolean(body.enabled) });
        return res.json(ok(await buildSnapshot(user), "Service availability updated"));
      }

      case "pricing.update": {
        if (!canAdmin(user)) return res.status(403).json(fail("FORBIDDEN", "Admin access required"));
        const service = String(body.service);
        const baseFare = Number(body.baseFare);
        const perKm = Number(body.perKm);
        const platformFee = Number(body.platformFee);
        const partnerPayoutPercent = body.partnerPayoutPercent === undefined ? 80 : Number(body.partnerPayoutPercent);
        if (!["Bike Taxi", "Parcel"].includes(service) || [baseFare, perKm, platformFee, partnerPayoutPercent].some((n) => !Number.isFinite(n) || n < 0) || partnerPayoutPercent > 100) {
          return res.status(400).json(fail("INVALID_PRICING", "Enter valid non-negative pricing"));
        }
        const before = await PricingRule.findById(service).lean();
        await PricingRule.findByIdAndUpdate(service, { baseFare, perKm, platformFee, partnerPayoutPercent }, { upsert: true });
        await audit(user, "pricing.update", "pricing", service, before, { baseFare, perKm, platformFee, partnerPayoutPercent });
        return res.json(ok(await buildSnapshot(user), "Pricing updated"));
      }

      case "partner.toggle": {
        if (!canPartner(user)) return res.status(403).json(fail("FORBIDDEN", "Partner access required"));
        await User.updateOne({ _id: user._id }, { $set: { partnerOnline: Boolean(body.value), ...(body.value ? {} : { partnerBusy: false }) } });
        user.partnerOnline = Boolean(body.value);
        if (!body.value) user.partnerBusy = false;
        return res.json(ok(await buildSnapshot(user), body.value ? "You are online" : "You are offline"));
      }

      case "vendor.toggle": {
        if (!canVendor(user)) return res.status(403).json(fail("FORBIDDEN", "Vendor access required"));
        await Setting.findByIdAndUpdate(`vendor_open:${user._id}`, { value: body.value ? "true" : "false" }, { upsert: true });
        // Closing a store must also hide its restaurants from customer discovery.
        await Restaurant.updateMany({ ownerUserId: user._id }, { $set: { isOpen: Boolean(body.value) } });
        await audit(user, "vendor.availability", "vendor", String(user._id), null, { open: Boolean(body.value) });
        return res.json(ok(await buildSnapshot(user), body.value ? "Store opened" : "Store closed"));
      }

      case "offer.create": {
        if (!canVendor(user)) return res.status(403).json(fail("FORBIDDEN", "Vendor access required"));
        const title = String(body.title ?? "").trim();
        const code = String(body.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const discountPercent = Math.floor(Number(body.discountPercent));
        const minOrder = Number(body.minOrder);
        if (title.length < 3 || code.length < 3 || code.length > 16 || !(discountPercent >= 1 && discountPercent <= 60) || !Number.isFinite(minOrder) || minOrder < 0) {
          return res.status(400).json(fail("INVALID_OFFER", "Enter a title, code, 1–60% discount and valid minimum order"));
        }
        try {
          const doc = await VendorOffer.create({ vendorId: user._id, vendorName: user.name, title, code, discountPercent, minOrder, active: true });
          await audit(user, "offer.create", "vendor_offer", String(doc._id), null, { title, code, discountPercent, minOrder });
        } catch (e: any) {
          if (e?.code === 11000) return res.status(409).json(fail("OFFER_CODE_EXISTS", "This offer code already exists for your store"));
          throw e;
        }
        return res.json(ok(await buildSnapshot(user), "Offer published"));
      }

      case "offer.toggle": {
        if (!canVendor(user)) return res.status(403).json(fail("FORBIDDEN", "Vendor access required"));
        const offer: any = await VendorOffer.findOne({ _id: body.id, vendorId: user._id });
        if (!offer) return res.status(404).json(fail("OFFER_NOT_FOUND", "Offer not found"));
        const before = offer.active;
        offer.active = Boolean(body.active);
        await offer.save();
        await audit(user, "offer.toggle", "vendor_offer", String(offer._id), { active: before }, { active: offer.active });
        return res.json(ok(await buildSnapshot(user), offer.active ? "Offer activated" : "Offer paused"));
      }

      case "user.update": {
        if (!canAdmin(user)) return res.status(403).json(fail("FORBIDDEN", "Admin access required"));
        const role = String(body.role);
        const status = String(body.status);
        const valid = ["CUSTOMER", "VENDOR_OWNER", "VENDOR_MANAGER", "DELIVERY_PARTNER", "SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN", "MARKETING_ADMIN", "CITY_ADMIN"];
        if (!valid.includes(role) || !["ACTIVE", "SUSPENDED"].includes(status)) {
          return res.status(400).json(fail("INVALID_USER_UPDATE", "Invalid role or status"));
        }
        const before = await User.findById(body.id, { role: 1, status: 1 }).lean();
        if (!before) return res.status(404).json(fail("USER_NOT_FOUND", "User not found"));
        await User.findByIdAndUpdate(body.id, { role, status });
        await audit(user, "user.update", "user", String(body.id), before, { role, status });
        return res.json(ok(await buildSnapshot(user), "User access updated"));
      }

      case "job.create": {
        // Bike Taxi and Parcel bookings, priced from the admin-configured rules.
        const service = String(body.service);
        if (!["Bike Taxi", "Parcel"].includes(service)) return res.status(400).json(fail("INVALID_SERVICE", "Invalid booking service"));
        const pickup = String(body.pickup ?? "").trim();
        const drop = String(body.drop ?? "").trim();
        if (pickup.length < 3 || drop.length < 3) return res.status(400).json(fail("INVALID_LOCATION", "Pickup and drop are required"));

        const enabled = await ServiceConfig.findById(service).lean();
        if (enabled && (enabled as any).enabled === false) return res.status(409).json(fail("SERVICE_UNAVAILABLE", "This service is temporarily unavailable"));

        const rule: any = await PricingRule.findById(service).lean();
        if (!rule) return res.status(409).json(fail("PRICING_UNAVAILABLE", "This service is not yet priced for your area"));

        const distance = Math.max(1, Math.min(30, Number(body.distance) || 4.2));
        const total = Math.round(rule.baseFare + rule.perKm * distance + rule.platformFee);
        const fare = Math.round(rule.baseFare + rule.perKm * distance);
        const partnerPayout = Math.round(fare * Number(rule.partnerPayoutPercent ?? 80) / 100);
        const seq = await nextSequence(service === "Bike Taxi" ? "rideNumber" : "parcelNumber");
        const reference = `GOO-${service === "Bike Taxi" ? "RIDE" : "PCL"}-${new Date().getFullYear()}-${String(seq).padStart(6, "0")}`;

        const doc = await ServiceOrder.create({
          reference,
          service,
          vendorName: service === "Bike Taxi" ? "Goocart Bike" : "Goocart Parcel",
          customerId: user._id,
          customerName: user.name,
          status: "READY_FOR_PICKUP",
          total,
          details: {
            pickup,
            drop,
            distance,
            fare,
            platformFee: rule.platformFee,
            partnerPayout,
            platformNetRevenue: total - partnerPayout,
            verificationCode: String(Math.floor(1000 + Math.random() * 9000)),
            ...(service === "Parcel" ? { packageType: String(body.packageType ?? "Small Package") } : {}),
          },
        });
        await audit(user, "job.create", service, String(doc._id), null, { reference, total });
        return res.json(ok(await buildSnapshot(user), `${service} booked`));
      }

      case "order.create": {
        // Generic commerce order (Grocery / Vegetables / Mart) from the portal.
        const raw = Array.isArray(body.items) ? body.items : [];
        if (!raw.length) return res.status(400).json(fail("EMPTY_CART", "Your cart is empty"));

        const lines: any[] = [];
        for (const entry of raw) {
          const product: any = await Product.findById(entry.productId).lean().catch(() => null);
          const qty = Math.max(1, Math.floor(Number(entry.qty) || 1));
          if (!product || product.stock < qty) return res.status(409).json(fail("OUT_OF_STOCK", `${product?.name ?? "Item"} is unavailable`));
          lines.push({ product, qty });
        }
        if (lines.some((l) => String(l.product.vendorId) !== String(lines[0].product.vendorId))) {
          return res.status(409).json(fail("MULTI_VENDOR_CART", "Use one store per checkout"));
        }

        const service = lines[0].product.service;
        const enabled = await ServiceConfig.findById(service).lean();
        if (enabled && (enabled as any).enabled === false) return res.status(409).json(fail("SERVICE_UNAVAILABLE", "This service is temporarily unavailable"));

        const pricing = await getPricingSettings();
        const subtotal = Math.round(lines.reduce((s, l) => s + l.product.price * l.qty, 0));
        const taxes = Math.round(subtotal * pricing.taxRatePercent / 100);
        const vendorCommission = Math.round(subtotal * pricing.vendorCommissionPercent / 100);
        const vendorPayable = subtotal - vendorCommission;
        const total = subtotal + pricing.deliveryFee + pricing.platformFee + taxes;
        const prefix: Record<string, string> = { Food: "FD", Grocery: "GR", Vegetables: "VG", Mart: "MT" };
        const seq = await nextSequence("serviceOrderNumber");
        const reference = `GOO-${prefix[service] ?? "OR"}-${new Date().getFullYear()}-${String(seq).padStart(6, "0")}`;

        const reserved = await reserveLines(lines.map((l) => ({ productId: l.product._id, quantity: l.qty })), user._id);
        if (!reserved.ok) {
          const failedLine = lines.find((line) => String(line.product._id) === reserved.productId);
          return res.status(409).json(fail("OUT_OF_STOCK", `${failedLine?.product.name ?? "An item"} just sold out.`));
        }

        let doc;
        try {
          doc = await ServiceOrder.create({
            reference,
            service,
            vendorId: lines[0].product.vendorId,
            vendorName: lines[0].product.vendorName,
            customerId: user._id,
            customerName: user.name,
            status: "READY_FOR_PICKUP",
            total,
            details: {
              items: lines.map((l) => ({ name: l.product.name, qty: l.qty, price: l.product.price })),
              subtotal,
              deliveryFee: pricing.deliveryFee,
              platformFee: pricing.platformFee,
              taxes,
              vendorCommission,
              vendorPayable,
              partnerPayout: pricing.deliveryPartnerPayout,
              platformNetRevenue: pricing.deliveryFee + pricing.platformFee + vendorCommission - pricing.deliveryPartnerPayout,
              address: body.address ?? "Home",
              verificationCode: String(Math.floor(1000 + Math.random() * 9000)),
              reservationIds: reserved.reservations.map((r) => r.reservationId),
            },
          });
        } catch (e) {
          await releaseReservations(reserved.reservations.map((r) => r.reservationId));
          throw e;
        }
        await consumeReservations(reserved.reservations.map((r) => r.reservationId), doc._id);
        await audit(user, "order.create", "order", String(doc._id), null, { reference, total });
        return res.json(ok(await buildSnapshot(user), "Order placed"));
      }

      default:
        return res.status(400).json(fail("UNKNOWN_ACTION", "Action is not supported"));
    }
  } catch (e) {
    res.status(500).json(fail("ACTION_FAILED", e instanceof Error ? e.message : "Action failed"));
  }
});

// --- Shared transition path ------------------------------------------------

type TransitionResult = { ok: true } | { ok: false; status: number; code: string; message: string };

/** Routes a transition to whichever collection owns the id, using one state machine. */
async function transitionAnyOrder(user: any, id: string, to: OrderStatus, code: string): Promise<TransitionResult> {
  const food: any = await Order.findById(id).lean().catch(() => null);
  if (food) return transitionDoc(user, Order, food, food.status, to, code, await ownerGroupForFood(user, food));

  const svc: any = await ServiceOrder.findById(id).lean().catch(() => null);
  if (svc) return transitionDoc(user, ServiceOrder, svc, svc.status, to, code, ownerGroupForService(user, svc));

  return { ok: false, status: 404, code: "ORDER_NOT_FOUND", message: "Order not found" };
}

async function ownerGroupForFood(user: any, o: any): Promise<string | null> {
  if (String(user._id) === String(o.customerId)) return "customer";
  if (canVendor(user) && (await Restaurant.exists({ _id: o.restaurantId, ownerUserId: user._id }))) return "vendor";
  if (canPartner(user) && (!o.partnerId || String(o.partnerId) === String(user._id))) return "partner";
  if (canAdmin(user)) return "admin";
  return null;
}

function ownerGroupForService(user: any, o: any): string | null {
  if (String(user._id) === String(o.customerId)) return "customer";
  if (canVendor(user) && String(o.vendorId) === String(user._id)) return "vendor";
  if (canPartner(user) && (!o.partnerId || String(o.partnerId) === String(user._id))) return "partner";
  if (canAdmin(user)) return "admin";
  return null;
}

async function transitionDoc(
  user: any,
  Model: any,
  doc: any,
  from: string,
  to: OrderStatus,
  code: string,
  group: string | null,
): Promise<TransitionResult> {
  if (!group) return { ok: false, status: 403, code: "FORBIDDEN", message: "This order is outside your scope" };
  if (!canTransition(group, from as OrderStatus, to)) {
    return { ok: false, status: 409, code: "INVALID_TRANSITION", message: `${from} cannot move to ${to}` };
  }

  const claiming = group === "partner" && ["DELIVERY_PARTNER_ASSIGNED", "DRIVER_ASSIGNED", "PARTNER_ASSIGNED"].includes(to);
  if (claiming) {
    if (Model === Order) {
      const result = await claimDelivery(String(doc._id), user);
      if (!result.ok) {
        const messages: Record<string, [number, string]> = {
          ORDER_NOT_FOUND: [404, "Order not found"],
          OFFER_EXPIRED: [409, "This delivery offer has expired."],
          ORDER_ALREADY_ASSIGNED: [409, "This delivery has already been accepted by another delivery partner."],
          PARTNER_NOT_ELIGIBLE: [409, "Go online before accepting a delivery."],
          PARTNER_HAS_ACTIVE_TASK: [409, "Complete your current task before accepting another."],
        };
        const [status, message] = messages[result.code] ?? [500, "Could not accept this delivery."];
        return { ok: false, status, code: result.code, message };
      }
      await audit(user, "order.transition", "food_order", String(doc._id), { status: from }, { status: "DELIVERY_PARTNER_ASSIGNED" });
      return { ok: true };
    }
    const partnerUser: any = await User.findById(user._id, { partnerOnline: 1, partnerBusy: 1, status: 1, partnerApprovalStatus: 1 }).lean();
    if (!partnerUser?.partnerOnline) {
      return { ok: false, status: 409, code: "PARTNER_OFFLINE", message: "Go online before accepting a request" };
    }
    const busy =
      (await Order.exists({ partnerId: user._id, status: { $nin: TERMINAL } })) ||
      (await ServiceOrder.exists({ partnerId: user._id, status: { $nin: TERMINAL } }));
    if (busy) return { ok: false, status: 409, code: "ACTIVE_TASK_EXISTS", message: "Complete your current task before accepting another" };
  }

  // Handover is confirmed by the code the customer holds, never by the partner alone.
  if (group === "partner" && ["DELIVERED", "RIDE_STARTED"].includes(to)) {
    const expected = Model === Order ? doc.deliveryOtp : doc.details?.verificationCode;
    if (expected && code !== String(expected)) {
      return { ok: false, status: 401, code: "INVALID_CODE", message: "That verification PIN is incorrect" };
    }
  }

  const update: any = { $set: { status: to } };
  if (claiming) {
    update.$set.partnerId = user._id;
    update.$set.partnerName = user.name;
  }
  if (Model === Order) {
    update.$push = { statusHistory: { status: to, actorId: user._id, actorRole: user.role, at: new Date() } };
  }

  // Guarded on the prior status so two partners racing cannot both win.
  const updated = await Model.findOneAndUpdate({ _id: doc._id, status: from }, update, { new: true }).lean();
  if (!updated) return { ok: false, status: 409, code: "CONFLICT", message: "That order was just updated. Refresh and try again." };

  await audit(user, "order.transition", Model === Order ? "food_order" : "service_order", String(doc._id), { status: from }, { status: to });
  return { ok: true };
}
