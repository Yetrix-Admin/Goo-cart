import { Router } from "express";
import { FoodItem, Restaurant } from "../models.js";
import { requireRole, canVendor, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { toFoodItemDTO, toRestaurantDTO } from "./catalog.js";

export const vendorRouter = Router();
vendorRouter.use(requireRole(canVendor, "Vendor access required"));

// Every route below scopes by the CALLER's ownerUserId, never by a restaurant
// id taken from the request — a vendor cannot act on another vendor's store
// just by guessing/supplying its id.
// Not async: returns the Mongoose Query itself (not a Promise wrapping it) so
// callers can chain .lean() the same way they would on Restaurant.findOne()
// directly.
function ownedRestaurant(userId: unknown) {
  return Restaurant.findOne({ ownerUserId: userId });
}

vendorRouter.get("/restaurant", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!._id).lean();
    res.json(ok({ restaurant: restaurant ? toRestaurantDTO(restaurant) : null }));
  } catch (e) {
    res.status(500).json(fail("RESTAURANT_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load your restaurant"));
  }
});

vendorRouter.patch("/restaurant", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!._id);
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
    const restaurant = await ownedRestaurant(req.user!._id).lean();
    if (!restaurant) return res.json(ok({ items: [] }));
    const items = await FoodItem.find({ restaurantId: restaurant._id }).sort({ name: 1 }).lean();
    res.json(ok({ items: items.map(toFoodItemDTO) }));
  } catch (e) {
    res.status(500).json(fail("MENU_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load your menu"));
  }
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

vendorRouter.post("/menu", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!._id).lean();
    if (!restaurant) return res.status(404).json(fail("NOT_ASSIGNED", "No restaurant is linked to your account yet. Ask an admin to assign one."));

    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const price = Number(body.price);
    const categoryKey = String(body.categoryKey ?? "").trim();

    if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a dish name."));
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json(fail("INVALID_PRICE", "Enter a valid price."));
    if (!categoryKey) return res.status(400).json(fail("INVALID_CATEGORY", "Choose a menu category."));

    // A restaurant with no categories yet (freshly created by admin) gets one
    // seeded automatically rather than rejecting the vendor's first item.
    const categoryExists = (restaurant.categories ?? []).some((c: any) => c.key === categoryKey);
    if (!categoryExists) {
      await Restaurant.updateOne({ _id: restaurant._id }, { $push: { categories: { key: categoryKey, name: categoryKey, sortOrder: (restaurant.categories ?? []).length } } });
    }

    let slug = `${restaurant.slug}-${slugify(name)}`;
    if (await FoodItem.exists({ slug })) slug = `${slug}-${Date.now().toString(36)}`;

    const item = await FoodItem.create({
      slug,
      restaurantId: restaurant._id,
      categoryKey,
      name,
      description,
      price,
      veg: Boolean(body.veg),
      available: true,
    });

    res.json(ok({ item: toFoodItemDTO(item.toObject()) }, "Menu item created"));
  } catch (e) {
    res.status(500).json(fail("MENU_ITEM_CREATE_FAILED", e instanceof Error ? e.message : "Could not create menu item"));
  }
});

vendorRouter.patch("/menu/:id", async (req: AuthedRequest, res) => {
  try {
    const restaurant = await ownedRestaurant(req.user!._id).lean();
    if (!restaurant) return res.status(404).json(fail("NOT_ASSIGNED", "No restaurant is linked to your account yet."));

    // Ownership check happens on the query itself, not after fetching by id
    // alone — a vendor cannot patch another store's item by id-guessing.
    const item = await FoodItem.findOne({ _id: req.params.id, restaurantId: restaurant._id });
    if (!item) return res.status(404).json(fail("ITEM_NOT_FOUND", "Menu item not found"));

    const body = req.body ?? {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2) return res.status(400).json(fail("INVALID_NAME", "Enter a dish name."));
      item.name = name;
    }
    if (body.description !== undefined) item.description = String(body.description).trim();
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0) return res.status(400).json(fail("INVALID_PRICE", "Enter a valid price."));
      item.price = price;
    }
    if (typeof body.veg === "boolean") item.veg = body.veg;
    if (typeof body.available === "boolean") item.available = body.available;

    await item.save();
    res.json(ok({ item: toFoodItemDTO(item.toObject()) }, "Menu item updated"));
  } catch (e) {
    res.status(500).json(fail("MENU_ITEM_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update menu item"));
  }
});
