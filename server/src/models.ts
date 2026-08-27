import mongoose, { Schema, model, InferSchemaType } from "mongoose";

// The relational schema had 25 tables. In MongoDB the tightly-coupled
// one-to-many relations are embedded (a restaurant's offers and menu
// categories; an order's items and status history) because they are always
// read together and never queried independently. Genuine entities that are
// queried on their own — users, sessions, restaurants, food items, orders —
// stay as top-level collections.

const opts = { timestamps: true, versionKey: false };

// --- Identity -------------------------------------------------------------

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
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
  },
  opts,
);
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

const offerSchema = new Schema({ title: { type: String, required: true }, description: { type: String, default: null } }, { _id: false });
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
      total: Number,
    },
    deliveryAddress: { type: Schema.Types.Mixed, required: true },
    deliveryOtp: { type: String, required: true },
    estimatedDeliveryMinutes: { type: Number, default: 30 },
    partnerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    partnerName: { type: String, default: null },
    items: { type: [orderItemSchema], default: [] },
    statusHistory: { type: [statusEventSchema], default: [] },
  },
  opts,
);
orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, status: 1 });

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
  },
  opts,
);
const counterSchema = new Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false });

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
  },
  { versionKey: false, timestamps: true },
);

export const Product = model("Product", productSchema);
export const ServiceOrder = model("ServiceOrder", serviceOrderSchema);
export const VendorOffer = model("VendorOffer", vendorOfferSchema);
export const PricingRule = model("PricingRule", pricingRuleSchema);

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

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
export type RestaurantDoc = InferSchemaType<typeof restaurantSchema> & { _id: mongoose.Types.ObjectId };
export type FoodItemDoc = InferSchemaType<typeof foodItemSchema> & { _id: mongoose.Types.ObjectId };
export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: mongoose.Types.ObjectId };

/** Atomic, gap-free order numbering — the Mongo equivalent of an AUTOINCREMENT. */
export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true }).lean();
  return doc!.seq;
}
