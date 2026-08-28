import { Router } from "express";
import { AuditLog, Coupon, FoodItem, Order, PricingRule, Product, Restaurant, ServiceOrder, Session, User } from "../models.js";
import { requireRole, canAdmin, hashPassword, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { toFoodItemDTO, toRestaurantDTO } from "./catalog.js";
import { toOrderDTO } from "./orders.js";
import { VENDOR_PERMISSIONS, TERMINAL_STATUSES } from "../lib/orderState.js";
import { isValidCoordinate } from "../lib/geo.js";
import { emitToAdmin } from "../lib/realtime.js";
import { notifyUser } from "../lib/push.js";
import { unassignPartner } from "../lib/delivery.js";
import { getPricingSettings, updatePricingSettings } from "../lib/pricingSettings.js";
import { createFoodItem, updateFoodItem, MenuItemError } from "../lib/menuItems.js";
import { EMAIL_RE, PHONE_RE } from "../lib/http.js";
import { sendEmail } from "../lib/email.js";

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
    const ownerName = String(body.ownerName ?? "").trim();
    const ownerEmail = String(body.ownerEmail ?? "").trim().toLowerCase();
    const ownerPhone = body.ownerPhone ? String(body.ownerPhone).trim() : undefined;
    const initialPassword = String(body.initialPassword ?? "");
    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a business name."));
    if (!isValidCoordinate(body.latitude, body.longitude)) return res.status(400).json(fail("INVALID_LOCATION", "A valid latitude and longitude are required."));
    if (ownerName.length < 2) return res.status(400).json(fail("INVALID_OWNER_NAME", "Enter the owner's full name."));
    if (!EMAIL_RE.test(ownerEmail)) return res.status(400).json(fail("INVALID_OWNER_EMAIL", "Enter a valid owner email."));
    if (ownerPhone && !PHONE_RE.test(ownerPhone)) return res.status(400).json(fail("INVALID_OWNER_PHONE", "Enter a valid owner phone number."));
    if (initialPassword.length < 8) return res.status(400).json(fail("WEAK_PASSWORD", "The initial password must be at least 8 characters."));
    if (await User.exists({ email: ownerEmail })) return res.status(409).json(fail("EMAIL_TAKEN", "An account with this owner email already exists."));

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

    let owner;
    try {
      owner = await User.create({
        email: ownerEmail,
        ...(ownerPhone ? { phone: ownerPhone } : {}),
        name: ownerName,
        passwordHash: await hashPassword(initialPassword),
        role: "VENDOR_OWNER",
        status: "ACTIVE",
        vendorId: restaurant._id,
        vendorPermissions: [...VENDOR_PERMISSIONS],
      });
      restaurant.ownerUserId = owner._id as unknown as typeof restaurant.ownerUserId;
      await restaurant.save();
    } catch (error) {
      await Restaurant.deleteOne({ _id: restaurant._id });
      throw error;
    }

    await audit(req, "vendor.create", "restaurant", String(restaurant._id), null, { name, ownerId: String(owner._id), ownerEmail });
    void sendEmail(
      ownerEmail,
      `Your ${name} Goocart Vendor account is ready`,
      `<p>Hello ${ownerName},</p><p>Your Goocart Vendor account for <strong>${name}</strong> is ready. Sign in with ${ownerEmail} using the password created by your administrator, or request an email OTP in the Vendor app.</p>`,
      `Hello ${ownerName}. Your Goocart Vendor account for ${name} is ready. Sign in with ${ownerEmail} using the password created by your administrator, or request an email OTP in the Vendor app.`,
    );
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()), owner: { id: String(owner._id), name: ownerName, email: ownerEmail } }, "Vendor and owner login created"));
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
    const initialPassword = String(body.initialPassword ?? "");
    const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p: unknown) => VENDOR_PERMISSIONS.includes(p as any)) : [];

    if (!EMAIL_RE.test(email)) return res.status(400).json(fail("INVALID_EMAIL", "Enter a valid email address."));
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json(fail("INVALID_PHONE", "Enter a valid phone number."));
    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a full name."));
    if (!VENDOR_ROLES.includes(role)) return res.status(400).json(fail("INVALID_ROLE", "Role must be VENDOR_OWNER, VENDOR_MANAGER or VENDOR_STAFF."));
    if (initialPassword.length < 8) return res.status(400).json(fail("WEAK_PASSWORD", "The initial password must be at least 8 characters."));
    if (await User.exists({ email })) return res.status(409).json(fail("EMAIL_TAKEN", "An account with this email already exists."));

    const user = await User.create({
      email,
      ...(phone ? { phone } : {}),
      name,
      passwordHash: await hashPassword(initialPassword),
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
    void sendEmail(email, "Your Goocart Vendor login is ready", `<p>Hello ${name},</p><p>Your Vendor app login is ready. Use <strong>${email}</strong> with the password created by your administrator, or request an email OTP.</p>`, `Hello ${name}. Your Vendor app login is ready. Use ${email} with the password created by your administrator, or request an email OTP.`);
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
    const user = await User.findOne({ _id: req.params.userId, vendorId: req.params.id });
    if (!user) return res.status(404).json(fail("VENDOR_USER_NOT_FOUND", "Vendor user not found"));

    const password = String(req.body?.password ?? "");
    if (password && password.length < 8) return res.status(400).json(fail("WEAK_PASSWORD", "The new password must be at least 8 characters."));
    if (password) {
      user.passwordHash = await hashPassword(password);
      await user.save();
    }

    // Every device this login is currently signed into is forced out; they
    // sign back in with a fresh OTP.
    const result = await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await audit(req, "vendor_user.reset_access", "user", req.params.userId, {}, { sessionsRevoked: result.modifiedCount });
    res.json(ok({ sessionsRevoked: result.modifiedCount, passwordChanged: Boolean(password) }, password ? "Password changed and existing sessions signed out" : "Login access reset — they'll need to sign in again"));
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
    const initialPassword = String(body.initialPassword ?? "");

    if (!EMAIL_RE.test(email)) return res.status(400).json(fail("INVALID_EMAIL", "Enter a valid email address."));
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json(fail("INVALID_PHONE", "Enter a valid phone number."));
    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a full name."));
    if (initialPassword.length < 8) return res.status(400).json(fail("WEAK_PASSWORD", "The initial password must be at least 8 characters."));
    if (await User.exists({ email })) return res.status(409).json(fail("EMAIL_TAKEN", "An account with this email already exists."));

    const partner = await User.create({
      email,
      ...(phone ? { phone } : {}),
      name,
      passwordHash: await hashPassword(initialPassword),
      role: "DELIVERY_PARTNER",
      status: "ACTIVE",
      vehicleType: body.vehicleType ?? null,
      vehicleNumber: body.vehicleNumber ?? null,
      licenceNumber: body.licenceNumber ?? null,
      rcNumber: body.rcNumber ?? null,
      bankDetails: body.bankDetails ?? null,
      photoUrl: body.photoUrl ?? null,
      // Admin may complete verification during creation, or leave the
      // account pending for a separate document-check step.
      partnerApprovalStatus: body.approveNow === true ? "APPROVED" : "PENDING",
    });

    await audit(req, "partner.create", "user", String(partner._id), null, { name, email });
    void sendEmail(email, "Your Goocart Partner login is ready", `<p>Hello ${name},</p><p>Your Goocart Partner login is ready. Use <strong>${email}</strong> with the password created by your administrator, or request an email OTP. You can go online after admin approval.</p>`, `Hello ${name}. Your Goocart Partner login is ready. Use ${email} with the password created by your administrator, or request an email OTP. You can go online after admin approval.`);
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
// --- Finance --------------------------------------------------------------
// Finance is derived from immutable order bill snapshots. Older food orders
// created before settlement snapshots existed are clearly counted as legacy
// estimates instead of silently presenting guessed values as exact.

adminRouter.get("/finance", async (_req, res) => {
  try {
    const [foodOrders, serviceOrders, currentPricing] = await Promise.all([
      Order.find({}, { orderNumber: 1, restaurantId: 1, restaurantName: 1, status: 1, paymentStatus: 1, bill: 1, createdAt: 1 }).lean(),
      ServiceOrder.find({}, { reference: 1, service: 1, vendorId: 1, vendorName: 1, status: 1, total: 1, details: 1, createdAt: 1 }).lean(),
      getPricingSettings(),
    ]);

    const successful = new Set(["DELIVERED", "COMPLETED"]);
    const cancelled = new Set(["VENDOR_REJECTED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_ADMIN", "CANCELLED"]);
    const rows: any[] = [];
    let legacyEstimatedOrders = 0;

    for (const order of foodOrders as any[]) {
      const bill = order.bill ?? {};
      const netFood = Math.max(0, Number(bill.itemTotal ?? 0) - Number(bill.restaurantDiscount ?? 0) - Number(bill.couponDiscount ?? 0));
      const hasSnapshot = bill.vendorPayable !== undefined && bill.vendorCommission !== undefined && bill.deliveryPartnerPayout !== undefined;
      if (!hasSnapshot) legacyEstimatedOrders += 1;
      const vendorCommission = hasSnapshot ? Number(bill.vendorCommission ?? 0) : Math.round(netFood * currentPricing.vendorCommissionPercent / 100);
      const vendorPayable = hasSnapshot ? Number(bill.vendorPayable ?? 0) : Math.max(0, netFood - vendorCommission);
      const partnerPayout = hasSnapshot ? Number(bill.deliveryPartnerPayout ?? 0) : currentPricing.deliveryPartnerPayout;
      const platformGross = Number(bill.platformFee ?? 0) + Number(bill.deliveryFee ?? 0) + vendorCommission;
      rows.push({
        id: String(order._id), reference: order.orderNumber, service: "Food", vendorId: String(order.restaurantId), vendorName: order.restaurantName,
        status: order.status, total: Number(bill.total ?? 0), itemTotal: Number(bill.itemTotal ?? 0), discounts: Number(bill.restaurantDiscount ?? 0) + Number(bill.couponDiscount ?? 0),
        taxes: Number(bill.taxes ?? 0), platformFees: Number(bill.platformFee ?? 0) + Number(bill.deliveryFee ?? 0), vendorCommission, vendorPayable,
        partnerPayout, platformGross, platformNet: platformGross - partnerPayout, completed: successful.has(order.status), cancelled: cancelled.has(order.status), createdAt: order.createdAt,
      });
    }

    for (const order of serviceOrders as any[]) {
      const details = order.details ?? {};
      const isCommerce = ["Grocery", "Vegetables", "Mart"].includes(order.service);
      const subtotal = Number(details.subtotal ?? (isCommerce ? order.total : 0));
      const feeSnapshot = details.fees !== undefined
        ? Number(details.fees)
        : Number(details.platformFee ?? 0) + Number(details.deliveryFee ?? 0);
      const platformFees = feeSnapshot || (isCommerce ? Math.max(0, Number(order.total ?? 0) - subtotal - Number(details.taxes ?? 0)) : 0);
      const partnerPayout = Number(details.partnerPayout ?? 0);
      const vendorPayable = Number(details.vendorPayable ?? (isCommerce ? subtotal : 0));
      rows.push({
        id: String(order._id), reference: order.reference, service: order.service, vendorId: order.vendorId ? String(order.vendorId) : null, vendorName: order.vendorName,
        status: order.status, total: Number(order.total ?? 0), itemTotal: subtotal, discounts: Number(details.discounts ?? 0), taxes: Number(details.taxes ?? 0),
        platformFees, vendorCommission: Number(details.vendorCommission ?? 0), vendorPayable, partnerPayout,
        platformGross: platformFees + Number(details.vendorCommission ?? 0), platformNet: platformFees + Number(details.vendorCommission ?? 0) - partnerPayout,
        completed: successful.has(order.status), cancelled: cancelled.has(order.status), createdAt: order.createdAt,
      });
    }

    const recognized = rows.filter((row) => row.completed);
    const sum = (field: string) => Math.round(recognized.reduce((total, row) => total + Number(row[field] ?? 0), 0));
    const byServiceMap = new Map<string, any>();
    const vendorMap = new Map<string, any>();
    for (const row of recognized) {
      const service = byServiceMap.get(row.service) ?? { service: row.service, orders: 0, customerRevenue: 0, platformNetRevenue: 0, vendorPayable: 0, partnerPayout: 0 };
      service.orders += 1; service.customerRevenue += row.total; service.platformNetRevenue += row.platformNet; service.vendorPayable += row.vendorPayable; service.partnerPayout += row.partnerPayout;
      byServiceMap.set(row.service, service);
      if (row.vendorId) {
        const vendor = vendorMap.get(row.vendorId) ?? { vendorId: row.vendorId, vendorName: row.vendorName || "Vendor", orders: 0, grossFoodSales: 0, commission: 0, payable: 0 };
        vendor.orders += 1; vendor.grossFoodSales += row.itemTotal; vendor.commission += row.vendorCommission; vendor.payable += row.vendorPayable;
        vendorMap.set(row.vendorId, vendor);
      }
    }

    res.json(ok({
      summary: {
        recognizedOrders: recognized.length,
        pendingOrders: rows.filter((row) => !row.completed && !row.cancelled).length,
        cancelledOrders: rows.filter((row) => row.cancelled).length,
        customerRevenue: sum("total"), merchandiseValue: sum("itemTotal"), discounts: sum("discounts"), taxes: sum("taxes"),
        platformGrossRevenue: sum("platformGross"), platformNetRevenue: sum("platformNet"), vendorPayable: sum("vendorPayable"), partnerPayable: sum("partnerPayout"),
        legacyEstimatedOrders,
      },
      byService: [...byServiceMap.values()].sort((a, b) => b.customerRevenue - a.customerRevenue),
      vendorSettlements: [...vendorMap.values()].sort((a, b) => b.payable - a.payable),
      recent: rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100),
    }));
  } catch (e) {
    res.status(500).json(fail("FINANCE_UNAVAILABLE", e instanceof Error ? e.message : "Unable to calculate finance"));
  }
});

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
    for (const field of ["deliveryFee", "platformFee", "taxRatePercent", "restaurantDiscountThreshold", "restaurantDiscountAmount", "vendorCommissionPercent", "deliveryPartnerPayout"]) {
      if (body[field] === undefined) continue;
      const value = Number(body[field]);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json(fail("INVALID_VALUE", `${field} must be a non-negative number.`));
      if ((field === "taxRatePercent" || field === "vendorCommissionPercent") && value > 100) return res.status(400).json(fail("INVALID_VALUE", `${field} cannot exceed 100%.`));
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

adminRouter.get("/service-pricing", async (_req, res) => {
  try {
    const rows = await PricingRule.find().sort({ _id: 1 }).lean();
    res.json(ok({
      pricing: rows.map((row: any) => ({
        service: row._id,
        baseFare: row.baseFare,
        perKm: row.perKm,
        platformFee: row.platformFee,
        partnerPayoutPercent: row.partnerPayoutPercent ?? 80,
      })),
    }));
  } catch (e) {
    res.status(500).json(fail("SERVICE_PRICING_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load service pricing"));
  }
});

adminRouter.patch("/service-pricing/:service", async (req: AuthedRequest, res) => {
  try {
    const service = req.params.service === "Bike Taxi" ? "Bike Taxi" : req.params.service === "Parcel" ? "Parcel" : "";
    if (!service) return res.status(400).json(fail("INVALID_SERVICE", "Only Bike Taxi and Parcel pricing can be edited here."));
    const body = req.body ?? {};
    const patch: Record<string, number> = {};
    for (const field of ["baseFare", "perKm", "platformFee", "partnerPayoutPercent"]) {
      if (body[field] === undefined) continue;
      const value = Number(body[field]);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json(fail("INVALID_VALUE", `${field} must be a non-negative number.`));
      if (field === "partnerPayoutPercent" && value > 100) return res.status(400).json(fail("INVALID_VALUE", "partnerPayoutPercent cannot exceed 100%."));
      patch[field] = value;
    }
    if (!Object.keys(patch).length) return res.status(400).json(fail("NO_CHANGES", "Enter at least one pricing value."));
    const before = await PricingRule.findById(service).lean();
    const pricing = await PricingRule.findByIdAndUpdate(service, patch, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    await audit(req, "service_pricing.update", "pricing", service, before, pricing);
    res.json(ok({ pricing }, "Service pricing updated"));
  } catch (e) {
    res.status(500).json(fail("SERVICE_PRICING_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update service pricing"));
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
  targetRestaurantIds: (c.targetRestaurantIds ?? []).map(String),
  targetFoodItemIds: (c.targetFoodItemIds ?? []).map(String),
  showOnHome: c.showOnHome !== false,
});

async function validateCouponTargets(rawRestaurantIds: unknown, rawFoodItemIds: unknown) {
  const targetRestaurantIds = [...new Set(Array.isArray(rawRestaurantIds) ? rawRestaurantIds.map(String).filter(Boolean) : [])];
  const targetFoodItemIds = [...new Set(Array.isArray(rawFoodItemIds) ? rawFoodItemIds.map(String).filter(Boolean) : [])];

  const restaurants = targetRestaurantIds.length ? await Restaurant.find({ _id: { $in: targetRestaurantIds } }, { _id: 1 }).lean() : [];
  if (restaurants.length !== targetRestaurantIds.length) throw new Error("One or more selected restaurants no longer exist.");

  const foods = targetFoodItemIds.length ? await FoodItem.find({ _id: { $in: targetFoodItemIds } }, { _id: 1, restaurantId: 1 }).lean() : [];
  if (foods.length !== targetFoodItemIds.length) throw new Error("One or more selected food items no longer exist.");
  if (foods.length && !targetRestaurantIds.length) throw new Error("Select the restaurant before selecting its food items.");
  const restaurantSet = new Set(targetRestaurantIds);
  if (foods.some((food: any) => !restaurantSet.has(String(food.restaurantId)))) {
    throw new Error("Every selected food item must belong to a selected restaurant.");
  }
  return { targetRestaurantIds, targetFoodItemIds };
}

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

    let targets;
    try {
      targets = await validateCouponTargets(body.targetRestaurantIds, body.targetFoodItemIds);
    } catch (error) {
      return res.status(400).json(fail("INVALID_TARGETS", error instanceof Error ? error.message : "Invalid offer targets."));
    }

    const coupon = await Coupon.create({
      code,
      title: body.title ?? code,
      description: body.description ?? "",
      type,
      value: type === "FREE_DELIVERY" ? 0 : value,
      minOrder: Number(body.minOrder) || 0,
      maxDiscount: body.maxDiscount !== undefined && body.maxDiscount !== null && body.maxDiscount !== "" ? Number(body.maxDiscount) : null,
      active: body.active !== false,
      ...targets,
      showOnHome: body.showOnHome !== false,
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
    if (typeof body.showOnHome === "boolean") (coupon as any).showOnHome = body.showOnHome;
    if (body.targetRestaurantIds !== undefined || body.targetFoodItemIds !== undefined) {
      try {
        const targets = await validateCouponTargets(
          body.targetRestaurantIds ?? (coupon as any).targetRestaurantIds,
          body.targetFoodItemIds ?? (coupon as any).targetFoodItemIds,
        );
        (coupon as any).targetRestaurantIds = targets.targetRestaurantIds;
        (coupon as any).targetFoodItemIds = targets.targetFoodItemIds;
      } catch (error) {
        return res.status(400).json(fail("INVALID_TARGETS", error instanceof Error ? error.message : "Invalid offer targets."));
      }
    }

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

// --- Menu items (spec: admin must be able to manage everything, not just
// wait for a vendor to log into the separate Vendor App) --------------------

adminRouter.get("/restaurants/:id/menu", async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id, { _id: 1 }).lean();
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));
    const items = await FoodItem.find({ restaurantId: restaurant._id }).sort({ name: 1 }).lean();
    res.json(ok({ items: items.map(toFoodItemDTO) }));
  } catch (e) {
    res.status(500).json(fail("MENU_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load this restaurant's menu"));
  }
});

adminRouter.post("/restaurants/:id/menu", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    const item = await createFoodItem(restaurant, req.body);
    await audit(req, "menu_item.create", "food_item", String(item._id), null, { restaurantId: req.params.id, name: item.name });
    res.json(ok({ item: toFoodItemDTO(item.toObject()) }, "Menu item created"));
  } catch (e) {
    if (e instanceof MenuItemError) return res.status(e.status).json(fail(e.code, e.message));
    res.status(500).json(fail("MENU_ITEM_CREATE_FAILED", e instanceof Error ? e.message : "Could not create menu item"));
  }
});

adminRouter.patch("/restaurants/:id/menu/:itemId", async (req: AuthedRequest, res) => {
  try {
    const item = await FoodItem.findOne({ _id: req.params.itemId, restaurantId: req.params.id });
    if (!item) return res.status(404).json(fail("ITEM_NOT_FOUND", "Menu item not found"));

    const before = item.toObject();
    const updated = await updateFoodItem(item, req.body ?? {});
    await audit(req, "menu_item.edit", "food_item", req.params.itemId, before, updated.toObject());
    res.json(ok({ item: toFoodItemDTO(updated.toObject()) }, "Menu item updated"));
  } catch (e) {
    if (e instanceof MenuItemError) return res.status(e.status).json(fail(e.code, e.message));
    res.status(500).json(fail("MENU_ITEM_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update menu item"));
  }
});

adminRouter.delete("/restaurants/:id/menu/:itemId", async (req: AuthedRequest, res) => {
  try {
    const item = await FoodItem.findOneAndDelete({ _id: req.params.itemId, restaurantId: req.params.id });
    if (!item) return res.status(404).json(fail("ITEM_NOT_FOUND", "Menu item not found"));
    await audit(req, "menu_item.delete", "food_item", req.params.itemId, { name: item.name }, null);
    res.json(ok({ deleted: true }, "Menu item removed"));
  } catch (e) {
    res.status(500).json(fail("MENU_ITEM_DELETE_FAILED", e instanceof Error ? e.message : "Could not remove this menu item"));
  }
});

// --- Legacy multi-service products (Grocery/Mart/Vegetables) --------------
// Distinct from FoodItem above — see models.ts's note on the two catalog
// shapes. The portal's own /api/goocart previously could only adjust stock
// on products a seed script created; admin can now create/edit/delete them
// directly like any other catalog entry.

const productDTO = (p: any) => ({
  id: String(p._id),
  service: p.service,
  vendorId: p.vendorId ? String(p.vendorId) : null,
  vendorName: p.vendorName,
  name: p.name,
  description: p.description,
  price: p.price,
  stock: p.stock,
  rating: p.rating,
  eta: p.eta,
});

adminRouter.get("/products", async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.service) filter.service = String(req.query.service);
    const products = await Product.find(filter).sort({ name: 1 }).lean();
    res.json(ok({ products: products.map(productDTO) }));
  } catch (e) {
    res.status(500).json(fail("PRODUCTS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load products"));
  }
});

adminRouter.post("/products", async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    const service = String(body.service ?? "");
    const price = Number(body.price);

    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a product name."));
    if (!["Grocery", "Vegetables", "Mart"].includes(service)) return res.status(400).json(fail("INVALID_SERVICE", "Service must be Grocery, Vegetables or Mart."));
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json(fail("INVALID_PRICE", "Enter a valid price."));

    // Admin acts as the vendor of record for these platform-run catalogs —
    // there is no separate vendor-app login for this legacy service line.
    const product = await Product.create({
      service,
      vendorId: req.user!._id,
      vendorName: body.vendorName || "Goocart",
      name,
      description: body.description ?? "",
      price,
      stock: Number(body.stock) || 0,
      eta: body.eta || "30–45 min",
    });

    await audit(req, "product.create", "product", String(product._id), null, { name, service });
    res.json(ok({ product: productDTO(product.toObject()) }, "Product created"));
  } catch (e) {
    res.status(500).json(fail("PRODUCT_CREATE_FAILED", e instanceof Error ? e.message : "Could not create product"));
  }
});

adminRouter.patch("/products/:id", async (req: AuthedRequest, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json(fail("PRODUCT_NOT_FOUND", "Product not found"));

    const before = product.toObject();
    const body = req.body ?? {};
    if (body.name !== undefined) product.name = String(body.name).trim();
    if (body.description !== undefined) product.description = String(body.description);
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0) return res.status(400).json(fail("INVALID_PRICE", "Enter a valid price."));
      product.price = price;
    }
    if (body.stock !== undefined) {
      const stock = Number(body.stock);
      if (!Number.isFinite(stock) || stock < 0) return res.status(400).json(fail("INVALID_STOCK", "Stock cannot be negative."));
      product.stock = stock;
    }
    if (body.eta !== undefined) product.eta = String(body.eta);

    await product.save();
    await audit(req, "product.edit", "product", req.params.id, before, product.toObject());
    res.json(ok({ product: productDTO(product.toObject()) }, "Product updated"));
  } catch (e) {
    res.status(500).json(fail("PRODUCT_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update product"));
  }
});

adminRouter.delete("/products/:id", async (req: AuthedRequest, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json(fail("PRODUCT_NOT_FOUND", "Product not found"));
    await audit(req, "product.delete", "product", req.params.id, { name: product.name }, null);
    res.json(ok({ deleted: true }, "Product deleted"));
  } catch (e) {
    res.status(500).json(fail("PRODUCT_DELETE_FAILED", e instanceof Error ? e.message : "Could not delete product"));
  }
});
