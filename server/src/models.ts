import mongoose, { Schema, model, InferSchemaType } from "mongoose";

// The relational schema had 25 tables. In MongoDB the tightly-coupled
// one-to-many relations are embedded (a restaurant's offers and menu
// categories; an order's items and status history) because they are always
// read together and never queried independently. Genuine entities that are
// queried on their own — users, sessions, restaurants, food items, orders —
// stay as top-level collections.

const opts = { timestamps: true, versionKey: false };

// --- Identity -------------------------------------------------------------

// A customer's saved delivery addresses. Always read and written together
// with the owning user (never queried on their own), so this is embedded
// rather than a top-level "Address" collection.
const addressSchema = new Schema(
  {
    label: { type: String, enum: ["Home", "Work", "Other"], default: "Home" },
    house: { type: String, default: "" },
    street: { type: String, default: "" },
    landmark: { type: String, default: "" },
    area: { type: String, default: "" },
    city: { type: String, default: "" },
    pincode: { type: String, default: "" },
    // Mandatory for delivery assignment and live tracking — validated in the
    // route layer, not the schema, so a legacy row missing them isn't lost.
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    contactName: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, default: undefined, lowercase: true, trim: true },
    // Leave absent for email-only accounts. A unique sparse index ignores a
    // missing field, but MongoDB treats an explicit null as an indexed value.
    phone: { type: String, default: undefined },
    passwordHash: { type: String, default: null },
    name: { type: String, required: true },
    role: { type: String, required: true, default: "CUSTOMER", index: true },
    status: { type: String, required: true, default: "ACTIVE" },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },

    // --- Customer -----------------------------------------------------
    addresses: { type: [addressSchema], default: [] },

    // --- Vendor App user (VENDOR_OWNER / VENDOR_MANAGER / VENDOR_STAFF) ----
    // The restaurant this login belongs to. Owners are also referenced by
    // Restaurant.ownerUserId (kept for backward compatibility); vendorId is
    // the source of truth for "which staff belong to which vendor" so one
    // restaurant can have many logins without touching that field.
    vendorId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null, index: true },
    staffTitle: { type: String, default: null },
    // Admin-assigned capabilities, e.g. CAN_ACCEPT_ORDER, CAN_MANAGE_PRODUCTS.
    // VENDOR_OWNER implicitly has every permission (see hasVendorPermission
    // in lib/auth.ts) regardless of what is stored here.
    vendorPermissions: { type: [String], default: [] },

    // --- Delivery Partner App user -------------------------------------
    vehicleType: { type: String, default: null },
    vehicleNumber: { type: String, default: null },
    licenceNumber: { type: String, default: null },
    rcNumber: { type: String, default: null },
    bankDetails: { type: Schema.Types.Mixed, default: null },
    photoUrl: { type: String, default: null },
    partnerApprovalStatus: { type: String, default: "APPROVED" }, // PENDING | APPROVED | REJECTED
    partnerOnline: { type: Boolean, default: false },
    // A partner with an active delivery cannot be offered another one.
    partnerBusy: { type: Boolean, default: false },
    partnerAcceptanceRate: { type: Number, default: 1 },
    partnerRecentRejectionRate: { type: Number, default: 0 },
    partnerRating: { type: Number, default: 5 },
    partnerCompletedDeliveries: { type: Number, default: 0 },
    partnerLastAssignedAt: { type: Date, default: null },
    partnerLastOnlineAt: { type: Date, default: null },
    currentLatitude: { type: Number, default: null },
    currentLongitude: { type: Number, default: null },
    locationUpdatedAt: { type: Date, default: null },
  },
  opts,
);
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    ip: String,
    userAgent: String,
  },
  opts,
);
// Expired sessions are removed by Mongo itself rather than a cleanup job.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const otpSchema = new Schema(
  {
    identifier: { type: String, required: true, index: true },
    purpose: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  opts,
);
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const roleSchema = new Schema(
  { _id: { type: String }, label: String, description: String, permissions: [String] },
  { versionKey: false },
);

// --- Catalog --------------------------------------------------------------

// _id (default true) so admin can address a single offer to edit/delete it,
// not just push/replace the whole array.
const offerSchema = new Schema({ title: { type: String, required: true }, description: { type: String, default: null } });
const categorySchema = new Schema({ key: { type: String, required: true }, name: { type: String, required: true }, sortOrder: { type: Number, default: 0 } }, { _id: false });

const restaurantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true, index: true },
    imageUrl: { type: String, default: null },
    ownerUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    cuisines: { type: [String], default: [] },
    deliveryTimeMin: { type: Number, default: 30 },
    deliveryTimeMax: { type: Number, default: 45 },
    distanceKm: { type: Number, default: 0 },
    priceForOne: { type: Number, default: null },
    priceForTwo: { type: Number, default: null },
    vegOnly: { type: Boolean, default: false },
    isOpen: { type: Boolean, default: true, index: true },
    area: { type: String, default: "" },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    offers: { type: [offerSchema], default: [] },
    categories: { type: [categorySchema], default: [] },

    // Business details an admin captures when onboarding a vendor.
    businessType: { type: String, default: null },
    gst: { type: String, default: null },
    pan: { type: String, default: null },
    bankDetails: { type: Schema.Types.Mixed, default: null },
    openingTime: { type: String, default: null },
    closingTime: { type: String, default: null },
    serviceRadiusKm: { type: Number, default: 8 },
    status: { type: String, default: "ACTIVE", index: true }, // ACTIVE | SUSPENDED | DISABLED

    // The vendor-level toggle from spec section 15. true = an authorized
    // vendor user must press Accept before the order (and delivery
    // broadcast) proceeds; false = the backend accepts automatically.
    manualOrderAcceptance: { type: Boolean, default: true },
    autoAcceptanceMode: { type: String, enum: ["MANUAL", "AUTOMATIC", "SMART_AUTOMATIC"], default: "MANUAL" },
    temporaryBusyMode: { type: Boolean, default: false },
    maxSimultaneousOrders: { type: Number, default: 12 },
    averagePreparationMinutes: { type: Number, default: 25 },
    maximumQueue: { type: Number, default: 20 },
  },
  opts,
);
// Backs the catalog search endpoint.
restaurantSchema.index({ name: "text", cuisines: "text" });

const variantSchema = new Schema({ key: { type: String, required: true }, name: String, price: Number, sortOrder: { type: Number, default: 0 } }, { _id: false });
const addonSchema = new Schema({ key: { type: String, required: true }, name: String, price: Number }, { _id: false });
const addonGroupSchema = new Schema(
  {
    key: { type: String, required: true },
    name: String,
    required: { type: Boolean, default: false },
    multiSelect: { type: Boolean, default: true },
    maxSelect: { type: Number, default: null },
    options: { type: [addonSchema], default: [] },
  },
  { _id: false },
);

const foodItemSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    categoryKey: { type: String, required: true },
    name: { type: String, required: true, index: true },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: null },
    price: { type: Number, required: true },
    veg: { type: Boolean, default: true },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    bestseller: { type: Boolean, default: false },
    available: { type: Boolean, default: true },
    variants: { type: [variantSchema], default: [] },
    addonGroups: { type: [addonGroupSchema], default: [] },
  },
  opts,
);
foodItemSchema.index({ name: "text" });

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    title: String,
    description: { type: String, default: "" },
    type: { type: String, enum: ["PERCENT", "FLAT", "FREE_DELIVERY"], required: true },
    value: { type: Number, default: 0 },
    minOrder: { type: Number, default: 0 },
    maxDiscount: { type: Number, default: null },
    active: { type: Boolean, default: true },
    // Empty targets mean platform-wide. When restaurants are selected the
    // coupon only works for orders from those restaurants; selected food
    // items narrow the discounted subtotal even further.
    targetRestaurantIds: { type: [Schema.Types.ObjectId], ref: "Restaurant", default: [] },
    targetFoodItemIds: { type: [Schema.Types.ObjectId], ref: "FoodItem", default: [] },
    showOnHome: { type: Boolean, default: true },
  },
  opts,
);

// --- Orders ---------------------------------------------------------------

const orderItemSchema = new Schema(
  {
    foodItemId: { type: Schema.Types.ObjectId, ref: "FoodItem", required: true },
    name: String,
    imageUrl: { type: String, default: null },
    veg: Boolean,
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    variant: { type: { key: String, name: String, price: Number }, default: null, _id: false },
    addons: { type: [{ key: String, name: String, price: Number }], default: [], _id: false },
  },
  { _id: true },
);

const statusEventSchema = new Schema(
  { status: { type: String, required: true }, actorId: { type: Schema.Types.ObjectId, default: null }, actorRole: String, at: { type: Date, default: Date.now } },
  { _id: false },
);

// The immutable operational timeline (spec section 38) — distinct from
// statusHistory above, which is the smaller customer-facing progress list.
// This one carries system events too (VENDOR_NOTIFIED, DELIVERY_OFFER_*,
// GPS_TRACKING_STARTED) with the actor and free-form metadata, and nothing
// ever mutates or removes an entry once appended.
const orderEventSchema = new Schema(
  {
    event: { type: String, required: true },
    eventType: { type: String, default: null },
    oldStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    actorType: { type: String, required: true }, // customer | vendor | partner | admin | system
    actorId: { type: Schema.Types.ObjectId, default: null },
    at: { type: Date, default: Date.now },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    customerName: String,
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    restaurantName: String,
    restaurantArea: { type: String, default: "" },
    restaurantLatitude: { type: Number, default: 0 },
    restaurantLongitude: { type: Number, default: 0 },
    status: { type: String, required: true, default: "PLACED", index: true },
    paymentMethod: { type: String, required: true },
    paymentStatus: { type: String, required: true },
    couponCode: { type: String, default: null },
    instructions: { type: [String], default: [] },
    bill: {
      itemTotal: Number,
      restaurantDiscount: { type: Number, default: 0 },
      couponDiscount: { type: Number, default: 0 },
      deliveryFee: { type: Number, default: 0 },
      platformFee: { type: Number, default: 0 },
      taxes: { type: Number, default: 0 },
      tip: { type: Number, default: 0 },
      vendorCommission: { type: Number, default: 0 },
      vendorPayable: { type: Number, default: 0 },
      deliveryPartnerPayout: { type: Number, default: 0 },
      platformNetRevenue: { type: Number, default: 0 },
      total: Number,
    },
    deliveryAddress: { type: Schema.Types.Mixed, required: true },
    deliveryOtp: { type: String, required: true },
    // Vendor-facing handoff code: the delivery partner must key this in
    // (given to them verbally/on-screen by the vendor) before PICKED_UP is
    // accepted, so a partner cannot self-report a collection that never
    // happened. Never sent to the customer or an unassigned partner.
    pickupOtp: { type: String, required: true },
    estimatedDeliveryMinutes: { type: Number, default: 30 },
    predictedReadyAt: { type: Date, default: null },
    dispatchAt: { type: Date, default: null },
    partnerEtaToStoreMinutes: { type: Number, default: null },
    partnerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    partnerName: { type: String, default: null },
    items: { type: [orderItemSchema], default: [] },
    statusHistory: { type: [statusEventSchema], default: [] },
    events: { type: [orderEventSchema], default: [] },

    // A client-generated key so a retried or double-tapped "Place Order"
    // request returns the order already created instead of creating a
    // second one (spec section 48). Scoped per customer, not global — two
    // different customers using the same key string is not a collision.
    // Deliberately NO default: the sparse unique index below only excludes
    // documents where the field is absent, not documents where it's null,
    // so an order placed without a key must never have this path set at all.
    idempotencyKey: { type: String },

    // --- Vendor acceptance (spec sections 15-18, 43) --------------------
    manualAcceptanceRequired: { type: Boolean, default: true },
    manualAcceptanceDeadlineAt: { type: Date, default: null },
    autoAccepted: { type: Boolean, default: false },

    // --- Delivery offer / atomic assignment (spec sections 25-30, 41-42) --
    // NONE: not yet broadcast. OFFERING: sent to eligible partners, first to
    // accept wins. ASSIGNED: partnerId is authoritative. EXPIRED: nobody
    // accepted in time (retried with a wider radius or escalated to admin).
    deliveryOfferStatus: { type: String, default: "NONE", index: true },
    deliveryOfferedPartnerIds: { type: [Schema.Types.ObjectId], default: [] },
    deliveryOfferStartedAt: { type: Date, default: null },
    deliveryOfferExpiresAt: { type: Date, default: null },
    deliveryOfferRadiusKm: { type: Number, default: null },
    deliveryOfferAttempts: { type: Number, default: 0 },
  },
  opts,
);
orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, status: 1 });
orderSchema.index({ deliveryOfferStatus: 1, deliveryOfferExpiresAt: 1 });
// A partial unique index, not a sparse one: for a COMPOUND index, "sparse"
// only excludes a document that is missing every indexed field, and
// customerId is always present — so a plain sparse index would still treat
// every order that lacks a key as colliding on {customerId, null}. A partial
// filter is the correct tool: only documents that genuinely carry a key are
// indexed at all, and the constraint is per-customer, not platform-wide.
orderSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } });

// --- Platform -------------------------------------------------------------

const settingSchema = new Schema({ _id: { type: String }, value: Schema.Types.Mixed }, { versionKey: false, timestamps: true });
const serviceConfigSchema = new Schema({ _id: { type: String }, enabled: { type: Boolean, default: true } }, { versionKey: false });
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorRole: String,
    action: { type: String, index: true },
    entityType: String,
    entityId: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    changedFields: { type: [String], default: [] },
    requestId: { type: String, default: null },
  },
  opts,
);
const counterSchema = new Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false });

// One row per device a user has ever logged into from, so a push can reach
// every phone they use rather than just the most recent one.
const deviceTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, default: "unknown" }, // ios | android | web
  },
  opts,
);

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    data: { type: Schema.Types.Mixed, default: null },
    channel: { type: String, default: "GENERAL" },
    readAt: { type: Date, default: null },
  },
  opts,
);
notificationSchema.index({ userId: 1, createdAt: -1 });

// --- Multi-service commerce (vendor/admin portal) --------------------------
// Distinct from the food catalog above: these back the Grocery, Vegetables,
// Mart, Bike Taxi and Parcel services the web portal manages, which use a
// flat product/order shape rather than the richer restaurant menu model.

const productSchema = new Schema(
  {
    service: { type: String, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    vendorName: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, default: 0, min: 0 },
    rating: { type: Number, default: 0 },
    eta: { type: String, default: "30–45 min" },
  },
  opts,
);

const serviceOrderSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    service: { type: String, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, default: null, index: true },
    vendorName: { type: String, default: "" },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    customerName: { type: String, default: "" },
    partnerId: { type: Schema.Types.ObjectId, default: null, index: true },
    partnerName: { type: String, default: null },
    status: { type: String, required: true, index: true },
    total: { type: Number, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  opts,
);
serviceOrderSchema.index({ createdAt: -1 });

const vendorOfferSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    vendorName: { type: String, default: "" },
    title: { type: String, required: true },
    code: { type: String, required: true },
    discountPercent: { type: Number, required: true, min: 1, max: 60 },
    minOrder: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
  },
  opts,
);
// A code is unique per vendor, not globally — two stores may both run "SAVE10".
vendorOfferSchema.index({ vendorId: 1, code: 1 }, { unique: true });

const pricingRuleSchema = new Schema(
  {
    _id: { type: String },
    baseFare: { type: Number, required: true, min: 0 },
    perKm: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, required: true, min: 0 },
    partnerPayoutPercent: { type: Number, required: true, min: 0, max: 100, default: 80 },
  },
  { versionKey: false, timestamps: true },
);

// Singleton document (_id: "food") the admin edits to control every fee and
// discount rule calculateBill() applies — nothing about pricing is hardcoded
// in a way only a redeploy could change (spec: "admin can set the discount
// thing and percentage things and everything should handle from admin only").
const pricingSettingsSchema = new Schema(
  {
    _id: { type: String },
    deliveryFee: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, required: true, min: 0 },
    taxRatePercent: { type: Number, required: true, min: 0, max: 100 },
    restaurantDiscountThreshold: { type: Number, required: true, min: 0 },
    restaurantDiscountAmount: { type: Number, required: true, min: 0 },
    vendorCommissionPercent: { type: Number, required: true, min: 0, max: 100 },
    deliveryPartnerPayout: { type: Number, required: true, min: 0 },
  },
  { versionKey: false, timestamps: true },
);

// A stock hold created atomically alongside the matching Product decrement
// (see lib/inventory.ts). Exists so overselling is prevented with a real
// audit trail — not just a bare $inc — and so an abandoned checkout releases
// its hold back to stock instead of the item staying short forever.
const reservationSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "ServiceOrder", default: null, index: true },
    // RESERVED: stock held, not yet tied to a confirmed order.
    // CONSUMED: the order this hold was for was confirmed; stock stays decremented.
    // RELEASED: explicitly returned (checkout abandoned/failed) — stock restored.
    // EXPIRED: nobody consumed it before expiresAt — stock restored by the sweep.
    status: { type: String, required: true, default: "RESERVED", index: true },
    expiresAt: { type: Date, required: true },
  },
  opts,
);
reservationSchema.index({ status: 1, expiresAt: 1 });

const orderRatingSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    foodStars: { type: Number, required: true, min: 1, max: 5 },
    restaurantStars: { type: Number, required: true, min: 1, max: 5 },
    deliveryPartnerStars: { type: Number, min: 0, max: 5, default: 0 },
    comment: { type: String, default: "" },
  },
  opts,
);
orderRatingSchema.index({ orderId: 1, customerId: 1 }, { unique: true });

const supportTicketSchema = new Schema(
  {
    ticketNumber: { type: String, required: true, unique: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    category: { type: String, required: true },
    subject: { type: String, required: true },
    message: { type: String, default: "" },
    status: { type: String, enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"], default: "OPEN", index: true },
  },
  opts,
);

export const Product = model("Product", productSchema);
export const Reservation = model("Reservation", reservationSchema);
export const ServiceOrder = model("ServiceOrder", serviceOrderSchema);
export const VendorOffer = model("VendorOffer", vendorOfferSchema);
export const PricingRule = model("PricingRule", pricingRuleSchema);
export const PricingSettings = model("PricingSettings", pricingSettingsSchema);

export const User = model("User", userSchema);
export const Session = model("Session", sessionSchema);
export const Otp = model("Otp", otpSchema);
export const Role = model("Role", roleSchema);
export const Restaurant = model("Restaurant", restaurantSchema);
export const FoodItem = model("FoodItem", foodItemSchema);
export const Coupon = model("Coupon", couponSchema);
export const Order = model("Order", orderSchema);
export const Setting = model("Setting", settingSchema);
export const ServiceConfig = model("ServiceConfig", serviceConfigSchema);
export const AuditLog = model("AuditLog", auditLogSchema);
export const Counter = model("Counter", counterSchema);
export const DeviceToken = model("DeviceToken", deviceTokenSchema);
export const Notification = model("Notification", notificationSchema);
export const OrderRating = model("OrderRating", orderRatingSchema);
export const SupportTicket = model("SupportTicket", supportTicketSchema);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
export type RestaurantDoc = InferSchemaType<typeof restaurantSchema> & { _id: mongoose.Types.ObjectId };
export type FoodItemDoc = InferSchemaType<typeof foodItemSchema> & { _id: mongoose.Types.ObjectId };
export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: mongoose.Types.ObjectId };

/** Atomic, gap-free order numbering — the Mongo equivalent of an AUTOINCREMENT. */
export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true }).lean();
  return doc!.seq;
}
