import { Router } from "express";
import { AuditLog, Order, OrderRating, PricingRule, Product, Restaurant, ServiceConfig, ServiceOrder, SupportTicket, User, nextSequence } from "../models.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { haversineKm, isValidCoordinate } from "../lib/geo.js";
import { geocodeAddress } from "../lib/geocode.js";
import { getPricingSettings } from "../lib/pricingSettings.js";
import { reserveLines, consumeReservations, releaseReservations } from "../lib/inventory.js";

export const customerRouter = Router();

const SUPPORT_REASONS = new Set(["Order delayed", "Missing item", "Wrong item", "Food quality issue", "Payment issue", "Delivery partner issue", "Refund issue", "Other"]);

// Addresses are looked up fresh from the user document (never trusted from
// the request) so a customer can only ever read or edit their own.
const addressDTO = (a: any) => ({
  id: String(a._id),
  label: a.label,
  house: a.house,
  street: a.street,
  landmark: a.landmark,
  area: a.area,
  city: a.city,
  pincode: a.pincode,
  latitude: a.latitude,
  longitude: a.longitude,
  contactName: a.contactName,
  contactPhone: a.contactPhone,
  isDefault: a.isDefault,
});

customerRouter.get("/addresses", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = await User.findById(req.user!._id, { addresses: 1 }).lean();
    res.json(ok({ addresses: (user?.addresses ?? []).map(addressDTO) }));
  } catch (e) {
    res.status(500).json(fail("ADDRESSES_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load your addresses"));
  }
});

customerRouter.post("/addresses", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    // Latitude/longitude are mandatory: they drive delivery-partner
    // assignment and live tracking, so an address without them is useless
    // for anything but display.
    if (!isValidCoordinate(body.latitude, body.longitude)) {
      return res.status(400).json(fail("INVALID_LOCATION", "Use current location or search for an address so we can pin its exact location."));
    }
    if (!["Home", "Work", "Other"].includes(body.label)) return res.status(400).json(fail("INVALID_LABEL", "Label must be Home, Work or Other."));

    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json(fail("USER_NOT_FOUND", "Account not found"));

    const makeDefault = Boolean(body.isDefault) || user.addresses.length === 0;
    if (makeDefault) user.addresses.forEach((a: any) => (a.isDefault = false));

    user.addresses.push({
      label: body.label,
      house: body.house ?? "",
      street: body.street ?? "",
      landmark: body.landmark ?? "",
      area: body.area ?? "",
      city: body.city ?? "",
      pincode: body.pincode ?? "",
      latitude: body.latitude,
      longitude: body.longitude,
      contactName: body.contactName ?? user.name,
      contactPhone: body.contactPhone ?? user.phone ?? "",
      isDefault: makeDefault,
    } as any);
    await user.save();

    res.json(ok({ address: addressDTO(user.addresses[user.addresses.length - 1]) }, "Address added"));
  } catch (e) {
    res.status(500).json(fail("ADDRESS_CREATE_FAILED", e instanceof Error ? e.message : "Could not add this address"));
  }
});

customerRouter.patch("/addresses/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json(fail("USER_NOT_FOUND", "Account not found"));

    const address = (user.addresses as any).id(req.params.id);
    if (!address) return res.status(404).json(fail("ADDRESS_NOT_FOUND", "Address not found"));

    const body = req.body ?? {};
    if (body.latitude !== undefined || body.longitude !== undefined) {
      const lat = body.latitude ?? address.latitude;
      const lng = body.longitude ?? address.longitude;
      if (!isValidCoordinate(lat, lng)) return res.status(400).json(fail("INVALID_LOCATION", "That location isn't valid."));
      address.latitude = lat;
      address.longitude = lng;
    }
    for (const field of ["label", "house", "street", "landmark", "area", "city", "pincode", "contactName", "contactPhone"]) {
      if (body[field] !== undefined) (address as any)[field] = body[field];
    }
    if (body.isDefault === true) {
      user.addresses.forEach((a: any) => (a.isDefault = String(a._id) === String(address._id)));
    }

    await user.save();
    res.json(ok({ address: addressDTO(address) }, "Address updated"));
  } catch (e) {
    res.status(500).json(fail("ADDRESS_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update this address"));
  }
});

customerRouter.delete("/addresses/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json(fail("USER_NOT_FOUND", "Account not found"));

    const address = (user.addresses as any).id(req.params.id);
    if (!address) return res.status(404).json(fail("ADDRESS_NOT_FOUND", "Address not found"));

    const wasDefault = address.isDefault;
    address.deleteOne();
    if (wasDefault && user.addresses.length) user.addresses[0].isDefault = true;

    await user.save();
    res.json(ok(null, "Address removed"));
  } catch (e) {
    res.status(500).json(fail("ADDRESS_DELETE_FAILED", e instanceof Error ? e.message : "Could not remove this address"));
  }
});

customerRouter.post("/ratings", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const order: any = await Order.findOne({ _id: body.orderId, customerId: req.user!._id }).lean().catch(() => null);
    if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));
    if (order.status !== "DELIVERED") return res.status(409).json(fail("ORDER_NOT_DELIVERED", "You can rate an order only after it is delivered."));

    const foodStars = Math.floor(Number(body.foodStars));
    const restaurantStars = Math.floor(Number(body.restaurantStars));
    const deliveryPartnerStars = Math.floor(Number(body.deliveryPartnerStars) || 0);
    if (![foodStars, restaurantStars].every((n) => Number.isInteger(n) && n >= 1 && n <= 5) || deliveryPartnerStars < 0 || deliveryPartnerStars > 5) {
      return res.status(400).json(fail("INVALID_RATING", "Ratings must be between 1 and 5 stars."));
    }

    const rating: any = await OrderRating.findOneAndUpdate(
      { orderId: order._id, customerId: req.user!._id },
      {
        $set: {
          restaurantId: order.restaurantId,
          foodStars,
          restaurantStars,
          deliveryPartnerStars,
          comment: String(body.comment ?? "").trim().slice(0, 1000),
        },
      },
      { upsert: true, new: true },
    );

    const stats = await OrderRating.aggregate([
      { $match: { restaurantId: order.restaurantId } },
      { $group: { _id: "$restaurantId", rating: { $avg: "$restaurantStars" }, ratingCount: { $sum: 1 } } },
    ]);
    if (stats[0]) {
      await Restaurant.updateOne({ _id: order.restaurantId }, { $set: { rating: Math.round(stats[0].rating * 10) / 10, ratingCount: stats[0].ratingCount } });
    }

    res.json(
      ok(
        {
          rating: {
            orderId: String(rating.orderId),
            foodStars: rating.foodStars,
            restaurantStars: rating.restaurantStars,
            deliveryPartnerStars: rating.deliveryPartnerStars,
            comment: rating.comment || undefined,
            createdAt: rating.createdAt,
          },
        },
        "Rating saved",
      ),
    );
  } catch (e) {
    res.status(500).json(fail("RATING_FAILED", e instanceof Error ? e.message : "Could not save rating"));
  }
});

customerRouter.get("/ratings", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const ratings = await OrderRating.find({ customerId: req.user!._id }).sort({ createdAt: -1 }).lean();
    res.json(
      ok({
        ratings: ratings.map((r: any) => ({
          orderId: String(r.orderId),
          foodStars: r.foodStars,
          restaurantStars: r.restaurantStars,
          deliveryPartnerStars: r.deliveryPartnerStars,
          comment: r.comment || undefined,
          createdAt: r.createdAt,
        })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("RATINGS_UNAVAILABLE", e instanceof Error ? e.message : "Could not load ratings"));
  }
});

customerRouter.post("/support-tickets", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const reason = String(req.body?.reason ?? "");
    if (!SUPPORT_REASONS.has(reason)) return res.status(400).json(fail("INVALID_SUPPORT_REASON", "Choose a valid support reason."));

    let orderId = null;
    if (req.body?.orderId) {
      const order = await Order.findOne({ _id: req.body.orderId, customerId: req.user!._id }, { _id: 1 }).lean().catch(() => null);
      if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));
      orderId = order._id;
    }

    const seq = await nextSequence("supportTicketNumber");
    const ticketNumber = `SUP-${new Date().getFullYear()}-${String(seq).padStart(6, "0")}`;
    const message = String(req.body?.details ?? req.body?.message ?? "").trim().slice(0, 2000);
    const ticket: any = await SupportTicket.create({
      ticketNumber,
      customerId: req.user!._id,
      orderId,
      category: reason,
      subject: reason,
      message,
    });
    await AuditLog.create({ actorId: req.user!._id, actorRole: req.user!.role, action: "support_ticket.create", entityType: "support_ticket", entityId: String(ticket._id), after: { ticketNumber, category: reason } });
    res.json(ok({ ticket: { id: ticket.ticketNumber, orderId: ticket.orderId ? String(ticket.orderId) : null, reason: ticket.category, details: ticket.message || undefined, status: ticket.status, createdAt: ticket.createdAt } }, "Support ticket created"));
  } catch (e) {
    res.status(500).json(fail("SUPPORT_TICKET_FAILED", e instanceof Error ? e.message : "Could not create support ticket"));
  }
});

// --- Grocery, vegetables, mart, bike taxi and parcel ---------------------

const SERVICE_NAMES: Record<string, string> = {
  GROCERY: "Grocery",
  VEGETABLES: "Vegetables",
  MART: "Mart",
  BIKE_TAXI: "Bike Taxi",
  PARCEL: "Parcel",
};

const serviceOrderDTO = (o: any) => ({
  id: String(o._id), reference: o.reference, service: o.service, vendorName: o.vendorName, status: o.status,
  total: o.total, details: o.details ?? {}, partner: o.partnerId ? { id: String(o.partnerId), name: o.partnerName ?? null } : null,
  createdAt: o.createdAt, updatedAt: o.updatedAt,
});

customerRouter.get("/services", async (_req, res) => {
  try {
    const [configs, pricing] = await Promise.all([ServiceConfig.find().lean(), PricingRule.find().lean()]);
    res.json(ok({
      services: Object.entries(SERVICE_NAMES).map(([key, name]) => ({ key, name, enabled: (configs as any[]).find((row) => row._id === name)?.enabled !== false })),
      pricing: (pricing as any[]).map((row) => ({ service: row._id, baseFare: row.baseFare, perKm: row.perKm, platformFee: row.platformFee, partnerPayoutPercent: row.partnerPayoutPercent ?? 80 })),
    }));
  } catch (e) {
    res.status(500).json(fail("SERVICES_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load services"));
  }
});

// Distance is always computed here, server-side, never trusted as a raw
// number from the client — so the fare a rider previews is the fare they're
// charged, and a client can't shortchange the partner payout by sending a
// smaller distance than the real trip. When the customer picked pickup/drop
// on the map (the normal path — see location-picker.tsx), the client already
// has exact coordinates and passes them directly, so this skips re-geocoding
// free text through Nominatim entirely — which is also what makes this
// reliable for addresses Nominatim's text search can't resolve on its own.
type GeocodedTrip = { distanceKm: number; pickup: { latitude: number; longitude: number }; drop: { latitude: number; longitude: number } };

async function geocodeTrip(
  pickup: string,
  drop: string,
  pickupCoords?: { latitude: number; longitude: number } | null,
  dropCoords?: { latitude: number; longitude: number } | null,
): Promise<GeocodedTrip | null> {
  const [pickupPoint, dropPoint] = await Promise.all([
    pickupCoords ?? geocodeAddress(pickup),
    dropCoords ?? geocodeAddress(drop),
  ]);
  if (!pickupPoint || !dropPoint) return null;
  const straightLineKm = haversineKm(pickupPoint, dropPoint);
  // Nominatim only gives straight-line distance; a 35% padding approximates
  // real road distance without a paid routing provider.
  const roadKm = Math.round(straightLineKm * 1.35 * 10) / 10;
  const distanceKm = Math.min(50, Math.max(1, roadKm));
  return { distanceKm, pickup: pickupPoint, drop: dropPoint };
}

function coordsFromQuery(req: import("express").Request, prefix: "pickup" | "drop"): { latitude: number; longitude: number } | null {
  const latitude = Number(req.query[`${prefix}Lat`]);
  const longitude = Number(req.query[`${prefix}Lng`]);
  return isValidCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

customerRouter.get("/services/fare-preview", async (req, res) => {
  try {
    const service = SERVICE_NAMES[String(req.query.service ?? "").toUpperCase()];
    if (!["Bike Taxi", "Parcel"].includes(service)) return res.status(400).json(fail("INVALID_SERVICE", "Choose Bike Taxi or Parcel."));
    const pickup = String(req.query.pickup ?? "").trim();
    const drop = String(req.query.drop ?? "").trim();
    if (pickup.length < 3 || drop.length < 3) return res.status(400).json(fail("INVALID_LOCATION", "Enter a pickup and drop address."));

    const trip = await geocodeTrip(pickup, drop, coordsFromQuery(req, "pickup"), coordsFromQuery(req, "drop"));
    if (!trip) return res.status(400).json(fail("GEOCODE_FAILED", "Couldn't locate one of these addresses. Try being more specific."));
    const { distanceKm } = trip;

    const rule: any = await PricingRule.findById(service).lean();
    if (!rule) return res.status(409).json(fail("PRICING_UNAVAILABLE", `${service} pricing has not been configured by admin.`));
    const fare = Math.round(rule.baseFare + rule.perKm * distanceKm);
    const total = Math.round(fare + rule.platformFee);
    res.json(ok({ distanceKm, baseFare: rule.baseFare, perKm: rule.perKm, platformFee: rule.platformFee, fare, total }));
  } catch (e) {
    res.status(500).json(fail("FARE_PREVIEW_FAILED", e instanceof Error ? e.message : "Could not calculate a fare"));
  }
});

customerRouter.get("/services/:key/products", async (req, res) => {
  try {
    const service = SERVICE_NAMES[String(req.params.key).toUpperCase()];
    if (!["Grocery", "Vegetables", "Mart"].includes(service)) return res.status(400).json(fail("INVALID_SERVICE", "This service does not have a product catalog."));
    const config: any = await ServiceConfig.findById(service).lean();
    if (config?.enabled === false) return res.status(409).json(fail("SERVICE_UNAVAILABLE", `${service} is temporarily unavailable.`));
    const products = await Product.find({ service, stock: { $gt: 0 } }).sort({ vendorName: 1, name: 1 }).lean();
    res.json(ok({ products: (products as any[]).map((p) => ({ id: String(p._id), service: p.service, vendorId: String(p.vendorId), vendorName: p.vendorName, name: p.name, description: p.description, imageUrl: p.imageUrl ?? null, price: p.price, stock: p.stock, rating: p.rating, eta: p.eta })) }));
  } catch (e) {
    res.status(500).json(fail("PRODUCTS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load products"));
  }
});

customerRouter.get("/service-orders", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const orders = await ServiceOrder.find({ customerId: req.user!._id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(ok({ orders: orders.map(serviceOrderDTO) }));
  } catch (e) {
    res.status(500).json(fail("SERVICE_ORDERS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load your activity"));
  }
});

customerRouter.post("/service-orders", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const service = SERVICE_NAMES[String(body.service ?? "").toUpperCase()];
    if (!service) return res.status(400).json(fail("INVALID_SERVICE", "Choose a valid service."));
    const config: any = await ServiceConfig.findById(service).lean();
    if (config?.enabled === false) return res.status(409).json(fail("SERVICE_UNAVAILABLE", `${service} is temporarily unavailable.`));

    if (["Bike Taxi", "Parcel"].includes(service)) {
      const pickup = String(body.pickup ?? "").trim();
      const drop = String(body.drop ?? "").trim();
      if (pickup.length < 3 || drop.length < 3) return res.status(400).json(fail("INVALID_LOCATION", "Pickup and drop are required."));
      const pickupCoords = isValidCoordinate(body.pickupLatitude, body.pickupLongitude) ? { latitude: Number(body.pickupLatitude), longitude: Number(body.pickupLongitude) } : null;
      const dropCoords = isValidCoordinate(body.dropLatitude, body.dropLongitude) ? { latitude: Number(body.dropLatitude), longitude: Number(body.dropLongitude) } : null;
      const trip = await geocodeTrip(pickup, drop, pickupCoords, dropCoords);
      if (!trip) return res.status(400).json(fail("GEOCODE_FAILED", "Couldn't locate one of these addresses. Try being more specific."));
      const { distanceKm } = trip;
      const rule: any = await PricingRule.findById(service).lean();
      if (!rule) return res.status(409).json(fail("PRICING_UNAVAILABLE", `${service} pricing has not been configured by admin.`));
      const fare = Math.round(rule.baseFare + rule.perKm * distanceKm);
      const total = Math.round(fare + rule.platformFee);
      const partnerPayout = Math.round(fare * Number(rule.partnerPayoutPercent ?? 80) / 100);
      const seq = await nextSequence(service === "Bike Taxi" ? "rideNumber" : "parcelNumber");
      const reference = `GOO-${service === "Bike Taxi" ? "RIDE" : "PCL"}-${new Date().getFullYear()}-${String(seq).padStart(6, "0")}`;
      const order = await ServiceOrder.create({
        reference, service, vendorName: service === "Bike Taxi" ? "Goocart Bike" : "Goocart Parcel", customerId: req.user!._id, customerName: req.user!.name,
        status: "READY_FOR_PICKUP", total,
        details: {
          pickup, drop, distanceKm, fare, platformFee: rule.platformFee, partnerPayout, platformNetRevenue: total - partnerPayout,
          pickupLatitude: trip.pickup.latitude, pickupLongitude: trip.pickup.longitude,
          dropLatitude: trip.drop.latitude, dropLongitude: trip.drop.longitude,
          packageType: service === "Parcel" ? String(body.packageType ?? "Small Package") : undefined,
          verificationCode: String(Math.floor(1000 + Math.random() * 9000)),
        },
      });
      await AuditLog.create({ actorId: req.user!._id, actorRole: req.user!.role, action: "service_order.create", entityType: service, entityId: String(order._id), after: { reference, total } });
      return res.json(ok({ order: serviceOrderDTO(order.toObject()) }, `${service} booked`));
    }

    const requested = Array.isArray(body.items) ? body.items : [];
    if (!requested.length) return res.status(400).json(fail("EMPTY_CART", "Choose at least one product."));
    const lines: any[] = [];
    for (const entry of requested) {
      const quantity = Math.floor(Number(entry.quantity));
      const product: any = await Product.findById(entry.productId).lean().catch(() => null);
      if (!product || product.service !== service) return res.status(409).json(fail("PRODUCT_UNAVAILABLE", "A selected product is no longer available."));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || product.stock < quantity) return res.status(409).json(fail("OUT_OF_STOCK", `${product.name} does not have enough stock.`));
      lines.push({ product, quantity });
    }
    if (lines.some((line) => String(line.product.vendorId) !== String(lines[0].product.vendorId))) return res.status(409).json(fail("MULTI_VENDOR_CART", "Place separate orders for different stores."));
    const pricing = await getPricingSettings();
    const subtotal = Math.round(lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0));
    const taxes = Math.round(subtotal * pricing.taxRatePercent / 100);
    const vendorCommission = Math.round(subtotal * pricing.vendorCommissionPercent / 100);
    const vendorPayable = subtotal - vendorCommission;
    const total = subtotal + pricing.deliveryFee + pricing.platformFee + taxes;
    // Reserve is atomic and all-or-nothing across every line (a Mongo
    // transaction): either the whole cart's stock is held, or none of it is
    // — a cart that fails on its third item can no longer leave the first
    // two silently decremented with nothing to show for it.
    const reserved = await reserveLines(lines.map((line) => ({ productId: line.product._id, quantity: line.quantity })), req.user!._id);
    if (!reserved.ok) {
      const failedLine = lines.find((line) => String(line.product._id) === reserved.productId);
      return res.status(409).json(fail("OUT_OF_STOCK", `${failedLine?.product.name ?? "An item"} just sold out.`));
    }

    const prefix: Record<string, string> = { Grocery: "GR", Vegetables: "VG", Mart: "MT" };
    const reference = `GOO-${prefix[service]}-${new Date().getFullYear()}-${String(await nextSequence("serviceOrderNumber")).padStart(6, "0")}`;
    let order;
    try {
      order = await ServiceOrder.create({
        reference, service, vendorId: lines[0].product.vendorId, vendorName: lines[0].product.vendorName, customerId: req.user!._id, customerName: req.user!.name,
        status: "READY_FOR_PICKUP", total,
        details: {
          items: lines.map((line) => ({ productId: String(line.product._id), name: line.product.name, quantity: line.quantity, unitPrice: line.product.price, lineTotal: line.product.price * line.quantity })),
          address: body.address ?? null, subtotal, deliveryFee: pricing.deliveryFee, platformFee: pricing.platformFee, taxes, vendorCommission, vendorPayable, partnerPayout: pricing.deliveryPartnerPayout, platformNetRevenue: pricing.deliveryFee + pricing.platformFee + vendorCommission - pricing.deliveryPartnerPayout, verificationCode: String(Math.floor(1000 + Math.random() * 9000)),
          reservationIds: reserved.reservations.map((r) => r.reservationId),
        },
      });
    } catch (e) {
      // The stock hold succeeded but the order it was for could not be
      // created — give the stock back now rather than leaving it stuck
      // until the expiry sweep catches it minutes from now.
      await releaseReservations(reserved.reservations.map((r) => r.reservationId));
      throw e;
    }
    await consumeReservations(reserved.reservations.map((r) => r.reservationId), order._id);

    await AuditLog.create({ actorId: req.user!._id, actorRole: req.user!.role, action: "service_order.create", entityType: service, entityId: String(order._id), after: { reference, total } });
    res.json(ok({ order: serviceOrderDTO(order.toObject()) }, `${service} order placed`));
  } catch (e) {
    res.status(500).json(fail("SERVICE_ORDER_FAILED", e instanceof Error ? e.message : "Could not place this order"));
  }
});
