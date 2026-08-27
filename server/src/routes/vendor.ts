import { Router } from "express";
import { FoodItem, Restaurant } from "../models.js";
import { requireRole, canVendor, hasVendorPermission, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { toFoodItemDTO, toRestaurantDTO } from "./catalog.js";
import { createFoodItem, updateFoodItem, MenuItemError } from "../lib/menuItems.js";

export const vendorRouter = Router();
vendorRouter.use(requireRole(canVendor, "Vendor access required"));

/**
 * A vendor login is scoped to its restaurant either by being the legacy
 * "owner" (Restaurant.ownerUserId) or, for anyone admin created afterwards
 * (managers, staff), by User.vendorId — never by a restaurant id taken from
 * the request. A vendor cannot act on another vendor's store just by
 * guessing/supplying its id.
 */
async function ownedRestaurant(user: { _id: unknown; vendorId?: unknown }) {
  if (user.vendorId) {
    const byVendorId = await Restaurant.findById(user.vendorId);
    if (byVendorId) return byVendorId;
  }
  return Restaurant.findOne({ ownerUserId: user._id });
}

function requireVendorPermission(permission: string, message: string) {
  return (req: AuthedRequest, res: any, next: any) => {
    if (!hasVendorPermission(req.user!, permission)) {
      return res.status(403).json(fail("FORBIDDEN", message));
    }
    next();
  };
}

vendorRouter.get("/restaurant", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!);
    res.json(ok({ restaurant: restaurant ? toRestaurantDTO(restaurant.toObject()) : null }));
  } catch (e) {
    res.status(500).json(fail("RESTAURANT_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load your restaurant"));
  }
});

vendorRouter.patch("/restaurant", requireVendorPermission("CAN_MANAGE_PRODUCTS", "You don't have permission to change store settings."), async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!);
    if (!restaurant) return res.status(404).json(fail("NOT_ASSIGNED", "No restaurant is linked to your account yet. Ask an admin to assign one."));

    const body = req.body ?? {};
    if (typeof body.isOpen === "boolean") restaurant.isOpen = body.isOpen;
    if (body.area !== undefined) restaurant.area = String(body.area);
    if (body.deliveryTimeMin !== undefined) {
      const v = Number(body.deliveryTimeMin);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json(fail("INVALID_DELIVERY_TIME", "Delivery time must be a non-negative number."));
      restaurant.deliveryTimeMin = v;
    }
    if (body.deliveryTimeMax !== undefined) {
      const v = Number(body.deliveryTimeMax);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json(fail("INVALID_DELIVERY_TIME", "Delivery time must be a non-negative number."));
      restaurant.deliveryTimeMax = v;
    }

    await restaurant.save();
    res.json(ok({ restaurant: toRestaurantDTO(restaurant.toObject()) }, "Restaurant updated"));
  } catch (e) {
    res.status(500).json(fail("RESTAURANT_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update restaurant"));
  }
});

vendorRouter.get("/menu", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!);
    if (!restaurant) return res.json(ok({ items: [] }));
    const items = await FoodItem.find({ restaurantId: restaurant._id }).sort({ name: 1 }).lean();
    res.json(ok({ items: items.map(toFoodItemDTO) }));
  } catch (e) {
    res.status(500).json(fail("MENU_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load your menu"));
  }
});

vendorRouter.post("/menu", requireVendorPermission("CAN_MANAGE_PRODUCTS", "You don't have permission to add menu items."), async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!);
    if (!restaurant) return res.status(404).json(fail("NOT_ASSIGNED", "No restaurant is linked to your account yet. Ask an admin to assign one."));

    const item = await createFoodItem(restaurant, req.body);
    res.json(ok({ item: toFoodItemDTO(item.toObject()) }, "Menu item created"));
  } catch (e) {
    if (e instanceof MenuItemError) return res.status(e.status).json(fail(e.code, e.message));
    res.status(500).json(fail("MENU_ITEM_CREATE_FAILED", e instanceof Error ? e.message : "Could not create menu item"));
  }
});

vendorRouter.patch("/menu/:id", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!);
    if (!restaurant) return res.status(404).json(fail("NOT_ASSIGNED", "No restaurant is linked to your account yet."));

    // Ownership check happens on the query itself, not after fetching by id
    // alone — a vendor cannot patch another store's item by id-guessing.
    const item = await FoodItem.findOne({ _id: req.params.id, restaurantId: restaurant._id });
    if (!item) return res.status(404).json(fail("ITEM_NOT_FOUND", "Menu item not found"));

    const body = req.body ?? {};
    const touchesPrice = body.price !== undefined;
    const touchesStock = typeof body.available === "boolean";
    const touchesDetails = body.name !== undefined || body.description !== undefined || typeof body.veg === "boolean";
    if (touchesPrice && !hasVendorPermission(req.user!, "CAN_MANAGE_PRICES")) {
      return res.status(403).json(fail("FORBIDDEN", "You don't have permission to change prices."));
    }
    if (touchesStock && !hasVendorPermission(req.user!, "CAN_MANAGE_STOCK")) {
      return res.status(403).json(fail("FORBIDDEN", "You don't have permission to change stock/availability."));
    }
    if (touchesDetails && !hasVendorPermission(req.user!, "CAN_MANAGE_PRODUCTS")) {
      return res.status(403).json(fail("FORBIDDEN", "You don't have permission to edit menu items."));
    }

    const updated = await updateFoodItem(item, body);
    res.json(ok({ item: toFoodItemDTO(updated.toObject()) }, "Menu item updated"));
  } catch (e) {
    if (e instanceof MenuItemError) return res.status(e.status).json(fail(e.code, e.message));
    res.status(500).json(fail("MENU_ITEM_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update menu item"));
  }
});

vendorRouter.delete("/menu/:id", requireVendorPermission("CAN_MANAGE_PRODUCTS", "You don't have permission to remove menu items."), async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!);
    if (!restaurant) return res.status(404).json(fail("NOT_ASSIGNED", "No restaurant is linked to your account yet."));

    const item = await FoodItem.findOneAndDelete({ _id: req.params.id, restaurantId: restaurant._id });
    if (!item) return res.status(404).json(fail("ITEM_NOT_FOUND", "Menu item not found"));

    res.json(ok({ deleted: true }, "Menu item removed"));
  } catch (e) {
    res.status(500).json(fail("MENU_ITEM_DELETE_FAILED", e instanceof Error ? e.message : "Could not remove this menu item"));
  }
});
