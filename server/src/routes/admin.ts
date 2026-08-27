import { Router } from "express";
import { Restaurant, User } from "../models.js";
import { requireRole, canAdmin } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { toRestaurantDTO } from "./catalog.js";

export const adminRouter = Router();
adminRouter.use(requireRole(canAdmin, "Admin access required"));

const VENDOR_ROLES = ["VENDOR_OWNER", "VENDOR_MANAGER"];

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

adminRouter.get("/vendors", async (_req, res) => {
  try {
    const vendors = await User.find({ role: { $in: VENDOR_ROLES } }, { name: 1, email: 1, role: 1, status: 1 }).sort({ name: 1 }).lean();
    res.json(ok({ vendors: vendors.map((v: any) => ({ id: String(v._id), name: v.name, email: v.email, role: v.role, status: v.status })) }));
  } catch (e) {
    res.status(500).json(fail("VENDORS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load vendor accounts"));
  }
});

adminRouter.patch("/restaurants/:id/owner", async (req, res) => {
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
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Owner assigned"));
  } catch (e) {
    res.status(500).json(fail("OWNER_ASSIGN_FAILED", e instanceof Error ? e.message : "Could not assign owner"));
  }
});
