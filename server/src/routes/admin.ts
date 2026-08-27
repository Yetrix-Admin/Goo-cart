import { Router } from "express";
import { AuditLog, Coupon, Order, Restaurant, Session, User } from "../models.js";
import { requireRole, canAdmin, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { toRestaurantDTO } from "./catalog.js";
import { toOrderDTO } from "./orders.js";
import { VENDOR_PERMISSIONS, TERMINAL_STATUSES } from "../lib/orderState.js";
import { isValidCoordinate } from "../lib/geo.js";
import { emitToAdmin } from "../lib/realtime.js";
import { notifyUser } from "../lib/push.js";
import { unassignPartner } from "../lib/delivery.js";
import { getPricingSettings, updatePricingSettings } from "../lib/pricingSettings.js";
import { EMAIL_RE, PHONE_RE } from "../lib/http.js";

export const adminRouter = Router();
adminRouter.use(requireRole(canAdmin, "Admin access required"));

const VENDOR_ROLES = ["VENDOR_OWNER", "VENDOR_MANAGER", "VENDOR_STAFF"];

async function audit(req: AuthedRequest, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  await AuditLog.create({ actorId: req.user!._id, actorRole: req.user!.role, action, entityType, entityId, before, after });
}

// --- Customers (spec sections 9) -------------------------------------------
// Never surfaces OTP codes, session tokens, or password hashes — those
// fields are not even selected out of Mongo below, let alone returned.

adminRouter.get("/customers", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const filter: Record<string, unknown> = { role: "CUSTOMER" };
    if (q) filter.$or = [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }, { phone: { $regex: q, $options: "i" } }];

    const customers = await User.find(filter, { name: 1, email: 1, phone: 1, status: 1, createdAt: 1, lastLoginAt: 1 }).sort({ createdAt: -1 }).limit(500).lean();
    const ids = customers.map((c: any) => c._id);

    const stats = await Order.aggregate([
      { $match: { customerId: { $in: ids } } },
      {
        $group: {
          _id: "$customerId",
          orders: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "DELIVERED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $in: ["$status", ["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_ADMIN"]] }, 1, 0] } },
          totalSpend: { $sum: { $cond: [{ $eq: ["$status", "DELIVERED"] }, "$bill.total", 0] } },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ]);
    const byId = new Map(stats.map((s: any) => [String(s._id), s]));

    res.json(
      ok({
        customers: customers.map((c: any) => {
          const s = byId.get(String(c._id));
          return {
            id: String(c._id),
            name: c.name,
            email: c.email,
            phone: c.phone ?? null,
            status: c.status,
            joinedAt: c.createdAt,
            lastLoginAt: c.lastLoginAt,
            orders: s?.orders ?? 0,
            completedOrders: s?.completed ?? 0,
            cancelledOrders: s?.cancelled ?? 0,
            totalSpend: Math.round(s?.totalSpend ?? 0),
            lastOrderAt: s?.lastOrderAt ?? null,
          };
        }),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("CUSTOMERS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load customers"));
  }
});

adminRouter.get("/customers/:id", async (req, res) => {
  try {
    const customer: any = await User.findOne({ _id: req.params.id, role: "CUSTOMER" }, { name: 1, email: 1, phone: 1, status: 1, createdAt: 1, lastLoginAt: 1, addresses: 1 }).lean();
    if (!customer) return res.status(404).json(fail("CUSTOMER_NOT_FOUND", "Customer not found"));

    const orders = await Order.find({ customerId: customer._id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json(
      ok({
        customer: {
          id: String(customer._id),
          name: customer.name,
          email: customer.email,
          phone: customer.phone ?? null,
          status: customer.status,
          joinedAt: customer.createdAt,
          lastLoginAt: customer.lastLoginAt,
          addresses: (customer.addresses ?? []).map((a: any) => ({
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
            isDefault: a.isDefault,
          })),
        },
        orders: orders.map((o) => toOrderDTO(o, { _id: customer._id, role: "SUPER_ADMIN" })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("CUSTOMER_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load customer"));
  }
});

adminRouter.patch("/customers/:id/status", async (req: AuthedRequest, res) => {
  try {
    const status = String(req.body?.status ?? "");
    if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) return res.status(400).json(fail("INVALID_STATUS", "Status must be ACTIVE, SUSPENDED or DISABLED."));

    const customer = await User.findOneAndUpdate({ _id: req.params.id, role: "CUSTOMER" }, { $set: { status } }, { new: true });
    if (!customer) return res.status(404).json(fail("CUSTOMER_NOT_FOUND", "Customer not found"));

    await audit(req, "customer.status", "user", req.params.id, {}, { status });
    res.json(ok({ id: String(customer._id), status: customer.status }, "Customer updated"));
  } catch (e) {
    res.status(500).json(fail("CUSTOMER_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update customer"));
  }
});

// --- Vendors (spec section 10) ----------------------------------------------

adminRouter.get("/restaurants", async (_req, res) => {
  try {
    const restaurants = await Restaurant.find().sort({ name: 1 }).lean();
    const ownerIds = restaurants.map((r: any) => r.ownerUserId).filter(Boolean);
    const owners = ownerIds.length ? await User.find({ _id: { $in: ownerIds } }, { name: 1, email: 1 }).lean() : [];
    const ownerById = new Map(owners.map((o: any) => [String(o._id), o]));

    res.json(
      ok({
        restaurants: restaurants.map((r: any) => ({
          ...toRestaurantDTO(r),
          owner: r.ownerUserId ? { id: String(r.ownerUserId), name: ownerById.get(String(r.ownerUserId))?.name ?? "Unknown", email: ownerById.get(String(r.ownerUserId))?.email ?? "" } : null,
        })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("RESTAURANTS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load restaurants"));
  }
});

adminRouter.post("/restaurants", async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a business name."));
    if (!isValidCoordinate(body.latitude, body.longitude)) return res.status(400).json(fail("INVALID_LOCATION", "A valid latitude and longitude are required."));

    const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "vendor";
    let slug = slugBase;
    if (await Restaurant.exists({ slug })) slug = `${slugBase}-${Date.now().toString(36)}`;

    const restaurant = await Restaurant.create({
      slug,
      name,
      area: String(body.area ?? ""),
      latitude: body.latitude,
      longitude: body.longitude,
      businessType: body.businessType ?? null,
      gst: body.gst ?? null,
      pan: body.pan ?? null,
      bankDetails: body.bankDetails ?? null,
      openingTime: body.openingTime ?? null,
      closingTime: body.closingTime ?? null,
      serviceRadiusKm: Number(body.serviceRadiusKm) || 8,
      manualOrderAcceptance: body.manualOrderAcceptance !== false,
      isOpen: true,
      status: "ACTIVE",
    });

    await audit(req, "vendor.create", "restaurant", String(restaurant._id), null, { name });
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Vendor created"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_CREATE_FAILED", e instanceof Error ? e.message : "Could not create vendor"));
  }
});

const EDITABLE_RESTAURANT_FIELDS = ["name", "area", "latitude", "longitude", "businessType", "gst", "pan", "bankDetails", "openingTime", "closingTime", "serviceRadiusKm"];

adminRouter.patch("/restaurants/:id", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    const before = restaurant.toObject();
    for (const field of EDITABLE_RESTAURANT_FIELDS) {
      if (req.body?.[field] !== undefined) (restaurant as any)[field] = req.body[field];
    }
    await restaurant.save();
    await audit(req, "vendor.edit", "restaurant", req.params.id, before, restaurant.toObject());
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Vendor updated"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update vendor"));
  }
});

adminRouter.patch("/restaurants/:id/status", async (req: AuthedRequest, res) => {
  try {
    const status = String(req.body?.status ?? "");
    if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) return res.status(400).json(fail("INVALID_STATUS", "Status must be ACTIVE, SUSPENDED or DISABLED."));

    const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, { $set: { status, isOpen: status === "ACTIVE" } }, { new: true });
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    await audit(req, "vendor.status", "restaurant", req.params.id, {}, { status });
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Vendor status updated"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_STATUS_FAILED", e instanceof Error ? e.message : "Could not update vendor status"));
  }
});

adminRouter.patch("/restaurants/:id/manual-acceptance", async (req: AuthedRequest, res) => {
  try {
    const manualOrderAcceptance = Boolean(req.body?.manualOrderAcceptance);
    const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, { $set: { manualOrderAcceptance } }, { new: true });
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    await audit(req, "vendor.manual_acceptance", "restaurant", req.params.id, {}, { manualOrderAcceptance });
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, manualOrderAcceptance ? "Manual acceptance enabled" : "Manual acceptance disabled — orders will auto-accept"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_SETTING_FAILED", e instanceof Error ? e.message : "Could not update this vendor's setting"));
  }
});

adminRouter.delete("/restaurants/:id", async (req: AuthedRequest, res) => {
  try {
    // A vendor with any order history is preserved (disabled instead of
    // deleted) so past orders keep a valid reference; only a genuinely
    // history-free vendor can be hard-deleted.
    const hasOrders = await Order.exists({ restaurantId: req.params.id });
    if (hasOrders) {
      const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, { $set: { status: "DISABLED", isOpen: false } }, { new: true });
      if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));
      await audit(req, "vendor.disable", "restaurant", req.params.id, {}, { status: "DISABLED" });
      return res.json(ok({ deleted: false, disabled: true }, "This vendor has order history, so it was disabled rather than deleted."));
    }

    const restaurant = await Restaurant.findByIdAndDelete(req.params.id);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));
    await audit(req, "vendor.delete", "restaurant", req.params.id, restaurant.toObject(), null);
    res.json(ok({ deleted: true }, "Vendor deleted"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_DELETE_FAILED", e instanceof Error ? e.message : "Could not delete vendor"));
  }
});

// Legacy: assign a lone owner via ownerUserId (kept for compatibility with
// the current admin UI's dropdown). New vendor users should be created via
// POST /restaurants/:id/users instead, which also sets vendorId + permissions.
adminRouter.get("/vendors", async (_req, res) => {
  try {
    const vendors = await User.find({ role: { $in: VENDOR_ROLES } }, { name: 1, email: 1, role: 1, status: 1 }).sort({ name: 1 }).lean();
    res.json(ok({ vendors: vendors.map((v: any) => ({ id: String(v._id), name: v.name, email: v.email, role: v.role, status: v.status })) }));
  } catch (e) {
    res.status(500).json(fail("VENDORS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load vendor accounts"));
  }
});

adminRouter.patch("/restaurants/:id/owner", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    const userId = req.body?.userId;
    if (userId === null) {
      restaurant.ownerUserId = null as unknown as typeof restaurant.ownerUserId;
      await restaurant.save();
      return res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Owner removed"));
    }

    const vendor = await User.findById(userId).lean();
    if (!vendor) return res.status(404).json(fail("VENDOR_NOT_FOUND", "That user does not exist"));
    if (!VENDOR_ROLES.includes((vendor as any).role)) {
      return res.status(400).json(fail("NOT_A_VENDOR", "That account is not a vendor owner or manager"));
    }

    restaurant.ownerUserId = vendor._id as unknown as typeof restaurant.ownerUserId;
    await restaurant.save();
    await User.updateOne({ _id: vendor._id }, { $set: { vendorId: restaurant._id } });
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Owner assigned"));
  } catch (e) {
    res.status(500).json(fail("OWNER_ASSIGN_FAILED", e instanceof Error ? e.message : "Could not assign owner"));
  }
});

// --- Vendor App users (spec sections 11, 14, 18) ----------------------------
// One restaurant, many mobile-app logins. Every one of them is scoped by
// vendorId so a query for "my restaurant's orders" (see vendor.ts / orders.ts)
// can never accidentally return another vendor's rows.

adminRouter.get("/restaurants/:id/users", async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id, { ownerUserId: 1 }).lean();
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    const users = await User.find({ vendorId: req.params.id }, { name: 1, email: 1, phone: 1, role: 1, status: 1, staffTitle: 1, vendorPermissions: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean();
    res.json(
      ok({
        users: users.map((u: any) => ({
          id: String(u._id),
          name: u.name,
          email: u.email,
          phone: u.phone ?? null,
          role: u.role,
          status: u.status,
          staffTitle: u.staffTitle,
          isPrimaryOwner: String(u._id) === String(restaurant.ownerUserId ?? ""),
          permissions: u.role === "VENDOR_OWNER" ? [...VENDOR_PERMISSIONS] : u.vendorPermissions ?? [],
          createdAt: u.createdAt,
        })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("VENDOR_USERS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load vendor users"));
  }
});

adminRouter.post("/restaurants/:id/users", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    const body = req.body ?? {};
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = body.phone ? String(body.phone).trim() : undefined;
    const name = String(body.name ?? "").trim();
    const role = String(body.role ?? "VENDOR_STAFF");
    const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p: unknown) => VENDOR_PERMISSIONS.includes(p as any)) : [];

    if (!EMAIL_RE.test(email)) return res.status(400).json(fail("INVALID_EMAIL", "Enter a valid email address."));
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json(fail("INVALID_PHONE", "Enter a valid phone number."));
    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a full name."));
    if (!VENDOR_ROLES.includes(role)) return res.status(400).json(fail("INVALID_ROLE", "Role must be VENDOR_OWNER, VENDOR_MANAGER or VENDOR_STAFF."));
    if (await User.exists({ email })) return res.status(409).json(fail("EMAIL_TAKEN", "An account with this email already exists."));

    // No password is set here — a vendor user signs into the Vendor App with
    // an OTP sent to this email or phone, the same mechanism the Customer
    // App already uses. There is nothing to "hand over" insecurely.
    const user = await User.create({
      email,
      ...(phone ? { phone } : {}),
      name,
      role,
      status: "ACTIVE",
      vendorId: restaurant._id,
      staffTitle: body.staffTitle ?? null,
      vendorPermissions: permissions,
    });

    if (role === "VENDOR_OWNER" && !restaurant.ownerUserId) {
      restaurant.ownerUserId = user._id as unknown as typeof restaurant.ownerUserId;
      await restaurant.save();
    }

    await audit(req, "vendor_user.create", "user", String(user._id), null, { restaurantId: String(restaurant._id), role, permissions });
    res.json(ok({ user: { id: String(user._id), name, email, role, permissions } }, "Vendor user created"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_USER_CREATE_FAILED", e instanceof Error ? e.message : "Could not create vendor user"));
  }
});

adminRouter.patch("/restaurants/:id/users/:userId", async (req: AuthedRequest, res) => {
  try {
    const user = await User.findOne({ _id: req.params.userId, vendorId: req.params.id });
    if (!user) return res.status(404).json(fail("VENDOR_USER_NOT_FOUND", "Vendor user not found"));

    const body = req.body ?? {};
    const before = { status: user.status, vendorPermissions: user.vendorPermissions, staffTitle: user.staffTitle, role: user.role };

    if (body.name !== undefined) user.name = String(body.name).trim();
    if (body.staffTitle !== undefined) user.staffTitle = body.staffTitle;
    if (Array.isArray(body.permissions)) user.vendorPermissions = body.permissions.filter((p: unknown) => VENDOR_PERMISSIONS.includes(p as any));
    if (body.role !== undefined && VENDOR_ROLES.includes(body.role)) user.role = body.role;
    if (body.status !== undefined && ["ACTIVE", "SUSPENDED", "DISABLED"].includes(body.status)) user.status = body.status;

    await user.save();
    await audit(req, "vendor_user.edit", "user", req.params.userId, before, { status: user.status, vendorPermissions: user.vendorPermissions, staffTitle: user.staffTitle, role: user.role });
    res.json(ok({ user: { id: String(user._id), name: user.name, status: user.status, role: user.role, permissions: user.vendorPermissions, staffTitle: user.staffTitle } }, "Vendor user updated"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_USER_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update vendor user"));
  }
});

adminRouter.post("/restaurants/:id/users/:userId/reset-access", async (req: AuthedRequest, res) => {
  try {
    const user = await User.findOne({ _id: req.params.userId, vendorId: req.params.id }, { _id: 1 }).lean();
    if (!user) return res.status(404).json(fail("VENDOR_USER_NOT_FOUND", "Vendor user not found"));

    // Every device this login is currently signed into is forced out; they
    // sign back in with a fresh OTP.
    const result = await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await audit(req, "vendor_user.reset_access", "user", req.params.userId, {}, { sessionsRevoked: result.modifiedCount });
    res.json(ok({ sessionsRevoked: result.modifiedCount }, "Login access reset — they'll need to sign in again"));
  } catch (e) {
    res.status(500).json(fail("RESET_FAILED", e instanceof Error ? e.message : "Could not reset login access"));
  }
});

adminRouter.delete("/restaurants/:id/users/:userId", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id, { ownerUserId: 1 });
    if (restaurant && String(restaurant.ownerUserId ?? "") === req.params.userId) {
      return res.status(409).json(fail("CANNOT_DELETE_OWNER", "Assign a different owner before removing this user."));
    }
    const user = await User.findOneAndDelete({ _id: req.params.userId, vendorId: req.params.id });
    if (!user) return res.status(404).json(fail("VENDOR_USER_NOT_FOUND", "Vendor user not found"));

    await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await audit(req, "vendor_user.delete", "user", req.params.userId, { name: user.name, email: user.email }, null);
    res.json(ok({ deleted: true }, "Vendor user removed"));
  } catch (e) {
    res.status(500).json(fail("VENDOR_USER_DELETE_FAILED", e instanceof Error ? e.message : "Could not remove vendor user"));
  }
});

adminRouter.get("/vendor-permissions", (_req, res) => res.json(ok({ permissions: VENDOR_PERMISSIONS })));

// --- Delivery Partners (spec sections 23-24) --------------------------------

adminRouter.get("/partners", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const filter: Record<string, unknown> = { role: "DELIVERY_PARTNER" };
    if (q) filter.$or = [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }, { phone: { $regex: q, $options: "i" } }];

    const partners = await User.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json(ok({ partners: partners.map(partnerDTO) }));
  } catch (e) {
    res.status(500).json(fail("PARTNERS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load delivery partners"));
  }
});

function partnerDTO(u: any) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    photoUrl: u.photoUrl,
    vehicleType: u.vehicleType,
    vehicleNumber: u.vehicleNumber,
    licenceNumber: u.licenceNumber,
    rcNumber: u.rcNumber,
    status: u.status,
    partnerApprovalStatus: u.partnerApprovalStatus,
    partnerOnline: u.partnerOnline,
    partnerBusy: u.partnerBusy,
    currentLatitude: u.currentLatitude,
    currentLongitude: u.currentLongitude,
    locationUpdatedAt: u.locationUpdatedAt,
    createdAt: u.createdAt,
  };
}

adminRouter.post("/partners", async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = body.phone ? String(body.phone).trim() : undefined;
    const name = String(body.name ?? "").trim();

    if (!EMAIL_RE.test(email)) return res.status(400).json(fail("INVALID_EMAIL", "Enter a valid email address."));
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json(fail("INVALID_PHONE", "Enter a valid phone number."));
    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a full name."));
    if (await User.exists({ email })) return res.status(409).json(fail("EMAIL_TAKEN", "An account with this email already exists."));

    const partner = await User.create({
      email,
      ...(phone ? { phone } : {}),
      name,
      role: "DELIVERY_PARTNER",
      status: "ACTIVE",
      vehicleType: body.vehicleType ?? null,
      vehicleNumber: body.vehicleNumber ?? null,
      licenceNumber: body.licenceNumber ?? null,
      rcNumber: body.rcNumber ?? null,
      bankDetails: body.bankDetails ?? null,
      photoUrl: body.photoUrl ?? null,
      // Admin approval is required before a newly-created partner can go
      // online (spec section 23-24) — they don't start eligible for work.
      partnerApprovalStatus: "PENDING",
    });

    await audit(req, "partner.create", "user", String(partner._id), null, { name, email });
    res.json(ok({ partner: partnerDTO(partner.toObject()) }, "Delivery partner created — pending approval"));
  } catch (e) {
    res.status(500).json(fail("PARTNER_CREATE_FAILED", e instanceof Error ? e.message : "Could not create delivery partner"));
  }
});

const EDITABLE_PARTNER_FIELDS = ["name", "vehicleType", "vehicleNumber", "licenceNumber", "rcNumber", "bankDetails", "photoUrl"];

adminRouter.patch("/partners/:id", async (req: AuthedRequest, res) => {
  try {
    const partner = await User.findOne({ _id: req.params.id, role: "DELIVERY_PARTNER" });
    if (!partner) return res.status(404).json(fail("PARTNER_NOT_FOUND", "Delivery partner not found"));

    const before = partner.toObject();
    for (const field of EDITABLE_PARTNER_FIELDS) {
      if (req.body?.[field] !== undefined) (partner as any)[field] = req.body[field];
    }
    await partner.save();
    await audit(req, "partner.edit", "user", req.params.id, before, partner.toObject());
    res.json(ok({ partner: partnerDTO(partner.toObject()) }, "Delivery partner updated"));
  } catch (e) {
    res.status(500).json(fail("PARTNER_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update delivery partner"));
  }
});

adminRouter.patch("/partners/:id/approval", async (req: AuthedRequest, res) => {
  try {
    const approvalStatus = String(req.body?.approvalStatus ?? "");
    if (!["PENDING", "APPROVED", "REJECTED"].includes(approvalStatus)) return res.status(400).json(fail("INVALID_STATUS", "Status must be PENDING, APPROVED or REJECTED."));

    const update: Record<string, unknown> = { partnerApprovalStatus: approvalStatus };
    if (approvalStatus !== "APPROVED") update.partnerOnline = false;

    const partner = await User.findOneAndUpdate({ _id: req.params.id, role: "DELIVERY_PARTNER" }, { $set: update }, { new: true });
    if (!partner) return res.status(404).json(fail("PARTNER_NOT_FOUND", "Delivery partner not found"));

    await audit(req, "partner.approval", "user", req.params.id, {}, { approvalStatus });
    void notifyUser(partner._id, "Application update", approvalStatus === "APPROVED" ? "You're approved — go online to start receiving deliveries." : "Your delivery partner application was not approved.", { type: "PARTNER_APPROVAL", approvalStatus });
    res.json(ok({ partner: partnerDTO(partner.toObject()) }, "Approval status updated"));
  } catch (e) {
    res.status(500).json(fail("PARTNER_APPROVAL_FAILED", e instanceof Error ? e.message : "Could not update approval status"));
  }
});

adminRouter.patch("/partners/:id/status", async (req: AuthedRequest, res) => {
  try {
    const status = String(req.body?.status ?? "");
    if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) return res.status(400).json(fail("INVALID_STATUS", "Status must be ACTIVE, SUSPENDED or DISABLED."));

    const update: Record<string, unknown> = { status };
    if (status !== "ACTIVE") update.partnerOnline = false;

    const partner = await User.findOneAndUpdate({ _id: req.params.id, role: "DELIVERY_PARTNER" }, { $set: update }, { new: true });
    if (!partner) return res.status(404).json(fail("PARTNER_NOT_FOUND", "Delivery partner not found"));

    if (status !== "ACTIVE") {
      const activeOrder = await Order.findOne({ partnerId: partner._id, status: { $nin: TERMINAL_STATUSES } }, { _id: 1 }).lean();
      if (activeOrder) await unassignPartner(activeOrder._id, `PARTNER_${status}`);
    }

    await audit(req, "partner.status", "user", req.params.id, {}, { status });
    res.json(ok({ partner: partnerDTO(partner.toObject()) }, "Delivery partner status updated"));
  } catch (e) {
    res.status(500).json(fail("PARTNER_STATUS_FAILED", e instanceof Error ? e.message : "Could not update delivery partner status"));
  }
});

adminRouter.delete("/partners/:id", async (req: AuthedRequest, res) => {
  try {
    const hasHistory = await Order.exists({ partnerId: req.params.id });
    if (hasHistory) {
      const partner = await User.findOneAndUpdate({ _id: req.params.id, role: "DELIVERY_PARTNER" }, { $set: { status: "DISABLED", partnerOnline: false } }, { new: true });
      if (!partner) return res.status(404).json(fail("PARTNER_NOT_FOUND", "Delivery partner not found"));
      await audit(req, "partner.disable", "user", req.params.id, {}, { status: "DISABLED" });
      return res.json(ok({ deleted: false, disabled: true }, "This partner has delivery history, so the account was disabled rather than deleted."));
    }
    const partner = await User.findOneAndDelete({ _id: req.params.id, role: "DELIVERY_PARTNER" });
    if (!partner) return res.status(404).json(fail("PARTNER_NOT_FOUND", "Delivery partner not found"));
    await audit(req, "partner.delete", "user", req.params.id, { name: partner.name, email: partner.email }, null);
    res.json(ok({ deleted: true }, "Delivery partner deleted"));
  } catch (e) {
    res.status(500).json(fail("PARTNER_DELETE_FAILED", e instanceof Error ? e.message : "Could not delete delivery partner"));
  }
});

// --- Live Orders (spec sections 36-38) --------------------------------------

adminRouter.get("/orders/live", async (_req, res) => {
  try {
    const orders = await Order.find({ status: { $nin: TERMINAL_STATUSES } }).sort({ createdAt: -1 }).limit(300).lean();
    const partnerIds = orders.map((o: any) => o.partnerId).filter(Boolean);
    const partners = partnerIds.length ? await User.find({ _id: { $in: partnerIds } }, { currentLatitude: 1, currentLongitude: 1, locationUpdatedAt: 1 }).lean() : [];
    const byId = new Map(partners.map((p: any) => [String(p._id), p]));

    res.json(
      ok({
        orders: orders.map((o: any) => ({
          id: String(o._id),
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          restaurantName: o.restaurantName,
          status: o.status,
          total: o.bill?.total ?? 0,
          paymentStatus: o.paymentStatus,
          deliveryOfferStatus: o.deliveryOfferStatus,
          partner: o.partnerId
            ? {
                id: String(o.partnerId),
                name: o.partnerName,
                latitude: byId.get(String(o.partnerId))?.currentLatitude ?? null,
                longitude: byId.get(String(o.partnerId))?.currentLongitude ?? null,
                locationUpdatedAt: byId.get(String(o.partnerId))?.locationUpdatedAt ?? null,
              }
            : null,
          createdAt: o.createdAt,
          estimatedDeliveryMinutes: o.estimatedDeliveryMinutes,
        })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("LIVE_ORDERS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load live orders"));
  }
});

adminRouter.get("/orders/:id/detail", async (req: AuthedRequest, res) => {
  try {
    const order: any = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));

    const partner = order.partnerId ? await User.findById(order.partnerId, { currentLatitude: 1, currentLongitude: 1, locationUpdatedAt: 1, phone: 1 }).lean() : null;

    res.json(
      ok({
        order: toOrderDTO(order, req.user!),
        events: (order.events ?? []).map((e: any) => ({ event: e.event, actorType: e.actorType, actorId: e.actorId ? String(e.actorId) : null, at: e.at, metadata: e.metadata ?? null })),
        tracking: partner
          ? { latitude: (partner as any).currentLatitude, longitude: (partner as any).currentLongitude, updatedAt: (partner as any).locationUpdatedAt, partnerPhone: (partner as any).phone ?? null }
          : null,
      }),
    );
  } catch (e) {
    res.status(500).json(fail("ORDER_DETAIL_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load this order"));
  }
});

// --- Admin overrides (spec section 37) --------------------------------------

adminRouter.post("/orders/:id/reassign-partner", async (req: AuthedRequest, res) => {
  try {
    const order: any = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json(fail("ORDER_NOT_FOUND", "Order not found"));
    if (TERMINAL_STATUSES.includes(order.status)) return res.status(409).json(fail("ORDER_TERMINAL", "This order is already finished."));

    if (order.partnerId) {
      await unassignPartner(order._id, "ADMIN_REASSIGN");
      await User.updateOne({ _id: order.partnerId }, { $set: { partnerBusy: false } });
    } else {
      const { broadcastDeliveryOffer } = await import("../lib/delivery.js");
      await broadcastDeliveryOffer(order._id);
    }

    await audit(req, "order.reassign", "order", req.params.id, { previousPartnerId: order.partnerId }, {});
    emitToAdmin("order:reassign_requested", { orderId: req.params.id });
    res.json(ok(null, "Reassignment started"));
  } catch (e) {
    res.status(500).json(fail("REASSIGN_FAILED", e instanceof Error ? e.message : "Could not reassign this order"));
  }
});

adminRouter.get("/audit-logs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json(
      ok({
        logs: logs.map((l: any) => ({
          id: String(l._id),
          actorId: l.actorId ? String(l.actorId) : null,
          actorRole: l.actorRole,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          before: l.before ?? null,
          after: l.after ?? null,
          at: l.createdAt,
        })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("AUDIT_LOG_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load the audit log"));
  }
});

// --- Platform pricing & discounts ("admin can set the discount thing and
// percentage things and everything should handle from admin only") --------

adminRouter.get("/pricing-settings", async (_req, res) => {
  try {
    res.json(ok({ pricing: await getPricingSettings() }));
  } catch (e) {
    res.status(500).json(fail("PRICING_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load pricing settings"));
  }
});

adminRouter.patch("/pricing-settings", async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const patch: Record<string, number> = {};
    for (const field of ["deliveryFee", "platformFee", "taxRatePercent", "restaurantDiscountThreshold", "restaurantDiscountAmount"]) {
      if (body[field] === undefined) continue;
      const value = Number(body[field]);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json(fail("INVALID_VALUE", `${field} must be a non-negative number.`));
      if (field === "taxRatePercent" && value > 100) return res.status(400).json(fail("INVALID_VALUE", "Tax rate cannot exceed 100%."));
      patch[field] = value;
    }
    const before = await getPricingSettings();
    const pricing = await updatePricingSettings(patch);
    await audit(req, "pricing.update", "pricing_settings", "food", before, pricing);
    res.json(ok({ pricing }, "Pricing updated"));
  } catch (e) {
    res.status(500).json(fail("PRICING_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update pricing settings"));
  }
});

// --- Coupons (platform-wide discount codes) --------------------------------

const couponDTO = (c: any) => ({
  id: String(c._id),
  code: c.code,
  title: c.title,
  description: c.description,
  type: c.type,
  value: c.value,
  minOrder: c.minOrder,
  maxDiscount: c.maxDiscount ?? null,
  active: c.active,
});

adminRouter.get("/coupons", async (_req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
    res.json(ok({ coupons: coupons.map(couponDTO) }));
  } catch (e) {
    res.status(500).json(fail("COUPONS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load coupons"));
  }
});

adminRouter.post("/coupons", async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const code = String(body.code ?? "").trim().toUpperCase();
    const type = String(body.type ?? "");
    const value = Number(body.value);

    if (code.length < 3) return res.status(400).json(fail("INVALID_CODE", "Enter a coupon code (at least 3 characters)."));
    if (!["PERCENT", "FLAT", "FREE_DELIVERY"].includes(type)) return res.status(400).json(fail("INVALID_TYPE", "Type must be PERCENT, FLAT or FREE_DELIVERY."));
    if (type !== "FREE_DELIVERY" && (!Number.isFinite(value) || value <= 0)) return res.status(400).json(fail("INVALID_VALUE", "Enter a discount value greater than 0."));
    if (type === "PERCENT" && value > 100) return res.status(400).json(fail("INVALID_VALUE", "A percentage discount cannot exceed 100."));
    if (await Coupon.exists({ code })) return res.status(409).json(fail("CODE_TAKEN", "A coupon with this code already exists."));

    const coupon = await Coupon.create({
      code,
      title: body.title ?? code,
      description: body.description ?? "",
      type,
      value: type === "FREE_DELIVERY" ? 0 : value,
      minOrder: Number(body.minOrder) || 0,
      maxDiscount: body.maxDiscount !== undefined && body.maxDiscount !== null && body.maxDiscount !== "" ? Number(body.maxDiscount) : null,
      active: body.active !== false,
    });

    await audit(req, "coupon.create", "coupon", String(coupon._id), null, couponDTO(coupon.toObject()));
    res.json(ok({ coupon: couponDTO(coupon.toObject()) }, "Coupon created"));
  } catch (e) {
    res.status(500).json(fail("COUPON_CREATE_FAILED", e instanceof Error ? e.message : "Could not create coupon"));
  }
});

adminRouter.patch("/coupons/:id", async (req: AuthedRequest, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json(fail("COUPON_NOT_FOUND", "Coupon not found"));

    const before = couponDTO(coupon.toObject());
    const body = req.body ?? {};
    if (body.title !== undefined) coupon.title = body.title;
    if (body.description !== undefined) coupon.description = body.description;
    if (body.value !== undefined) {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json(fail("INVALID_VALUE", "Enter a valid discount value."));
      if (coupon.type === "PERCENT" && value > 100) return res.status(400).json(fail("INVALID_VALUE", "A percentage discount cannot exceed 100."));
      coupon.value = value;
    }
    if (body.minOrder !== undefined) coupon.minOrder = Number(body.minOrder) || 0;
    if (body.maxDiscount !== undefined) (coupon as any).maxDiscount = body.maxDiscount === null || body.maxDiscount === "" ? null : Number(body.maxDiscount);
    if (typeof body.active === "boolean") coupon.active = body.active;

    await coupon.save();
    await audit(req, "coupon.edit", "coupon", req.params.id, before, couponDTO(coupon.toObject()));
    res.json(ok({ coupon: couponDTO(coupon.toObject()) }, "Coupon updated"));
  } catch (e) {
    res.status(500).json(fail("COUPON_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update coupon"));
  }
});

adminRouter.delete("/coupons/:id", async (req: AuthedRequest, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json(fail("COUPON_NOT_FOUND", "Coupon not found"));
    await audit(req, "coupon.delete", "coupon", req.params.id, couponDTO(coupon.toObject()), null);
    res.json(ok({ deleted: true }, "Coupon deleted"));
  } catch (e) {
    res.status(500).json(fail("COUPON_DELETE_FAILED", e instanceof Error ? e.message : "Could not delete coupon"));
  }
});

// --- Per-restaurant offers ("50% OFF", "FREE DELIVERY" banners) ------------

adminRouter.post("/restaurants/:id/offers", async (req: AuthedRequest, res) => {
  try {
    const title = String(req.body?.title ?? "").trim();
    if (title.length < 2) return res.status(400).json(fail("INVALID_TITLE", "Enter an offer title."));

    const restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      { $push: { offers: { title, description: req.body?.description ?? null } } },
      { new: true },
    );
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    await audit(req, "offer.create", "restaurant", req.params.id, null, { title });
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Offer added"));
  } catch (e) {
    res.status(500).json(fail("OFFER_CREATE_FAILED", e instanceof Error ? e.message : "Could not add this offer"));
  }
});

adminRouter.delete("/restaurants/:id/offers/:offerId", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      { $pull: { offers: { _id: req.params.offerId } } },
      { new: true },
    );
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    await audit(req, "offer.delete", "restaurant", req.params.id, { offerId: req.params.offerId }, null);
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Offer removed"));
  } catch (e) {
    res.status(500).json(fail("OFFER_DELETE_FAILED", e instanceof Error ? e.message : "Could not remove this offer"));
  }
});
