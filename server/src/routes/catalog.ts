import { Router } from "express";
import { Coupon, FoodItem, Restaurant } from "../models.js";
import { ok, fail } from "../lib/http.js";
import { getPricingSettings } from "../lib/pricingSettings.js";

export const catalogRouter = Router();

// Shapes below match the DTOs the mobile app already consumes, so switching
// the backend from D1 to MongoDB needs no client changes.
function toRestaurantDTO(r: any) {
  return {
    id: String(r._id),
    name: r.name,
    imageUrl: r.imageUrl,
    rating: r.rating,
    ratingCount: r.ratingCount,
    cuisines: r.cuisines ?? [],
    deliveryTimeMin: r.deliveryTimeMin,
    deliveryTimeMax: r.deliveryTimeMax,
    distanceKm: r.distanceKm,
    priceForOne: r.priceForOne,
    priceForTwo: r.priceForTwo,
    vegOnly: r.vegOnly,
    isOpen: r.isOpen,
    area: r.area,
    latitude: r.latitude,
    longitude: r.longitude,
    offers: (r.offers ?? []).map((o: any) => ({ id: String(o._id), title: o.title, description: o.description ?? null })),
    manualOrderAcceptance: r.manualOrderAcceptance !== false,
    status: r.status ?? "ACTIVE",
  };
}

function toFoodItemDTO(f: any) {
  return {
    id: String(f._id),
    restaurantId: String(f.restaurantId),
    categoryId: f.categoryKey,
    name: f.name,
    description: f.description,
    imageUrl: f.imageUrl,
    price: f.price,
    veg: f.veg,
    rating: f.rating || null,
    ratingCount: f.ratingCount || null,
    bestseller: f.bestseller,
    available: f.available,
    variants: (f.variants ?? []).map((v: any) => ({ id: v.key, name: v.name, price: v.price })),
    addonGroups: (f.addonGroups ?? []).map((g: any) => ({
      id: g.key,
      name: g.name,
      required: g.required,
      multiSelect: g.multiSelect,
      max: g.maxSelect ?? null,
      options: (g.options ?? []).map((o: any) => ({ id: o.key, name: o.name, price: o.price })),
    })),
  };
}

catalogRouter.get("/restaurants", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const filter: Record<string, unknown> = {};

    if (q) filter.$or = [{ name: { $regex: q, $options: "i" } }, { cuisines: { $regex: q, $options: "i" } }];
    if (req.query.minRating) filter.rating = { $gte: Number(req.query.minRating) };
    if (req.query.maxDeliveryMinutes) filter.deliveryTimeMax = { $lte: Number(req.query.maxDeliveryMinutes) };
    if (req.query.vegOnly === "true") filter.vegOnly = true;
    if (req.query.cuisine) filter.cuisines = { $regex: String(req.query.cuisine), $options: "i" };
    if (req.query.withOffers === "true") filter["offers.0"] = { $exists: true };

    const rows = await Restaurant.find(filter).sort({ isOpen: -1, rating: -1 }).lean();
    res.json(ok({ restaurants: rows.map(toRestaurantDTO) }));
  } catch (e) {
    res.status(500).json(fail("CATALOG_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load restaurants"));
  }
});

catalogRouter.get("/restaurants/:id", async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id).lean().catch(() => null);
    if (!restaurant) return res.status(404).json(fail("RESTAURANT_NOT_FOUND", "Restaurant not found"));

    const items = await FoodItem.find({ restaurantId: restaurant._id }).sort({ bestseller: -1, name: 1 }).lean();
    const categories = (restaurant.categories ?? [])
      .slice()
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
      .map((c: any) => ({ id: c.key, name: c.name }));

    res.json(ok({ restaurant: toRestaurantDTO(restaurant), categories, items: items.map(toFoodItemDTO) }));
  } catch (e) {
    res.status(500).json(fail("CATALOG_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load restaurant"));
  }
});

catalogRouter.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json(ok({ restaurants: [], items: [] }));

    const [restaurants, items] = await Promise.all([
      Restaurant.find({ $or: [{ name: { $regex: q, $options: "i" } }, { cuisines: { $regex: q, $options: "i" } }] })
        .sort({ rating: -1 })
        .lean(),
      FoodItem.find({ name: { $regex: q, $options: "i" } }).sort({ bestseller: -1 }).limit(40).lean(),
    ]);

    // One lookup for the restaurant names the matched dishes belong to.
    const names = new Map<string, string>();
    if (items.length) {
      const owners = await Restaurant.find({ _id: { $in: items.map((i: any) => i.restaurantId) } }, { name: 1 }).lean();
      owners.forEach((o: any) => names.set(String(o._id), o.name));
    }

    res.json(
      ok({
        restaurants: restaurants.map(toRestaurantDTO),
        items: items.map((i: any) => ({
          id: String(i._id),
          restaurantId: String(i.restaurantId),
          restaurantName: names.get(String(i.restaurantId)) ?? "",
          name: i.name,
          price: i.price,
          veg: i.veg,
          imageUrl: i.imageUrl,
        })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("SEARCH_UNAVAILABLE", e instanceof Error ? e.message : "Search failed"));
  }
});

catalogRouter.get("/coupons", async (_req, res) => {
  try {
    const rows = await Coupon.find({ active: true }).lean();
    res.json(
      ok({
        coupons: rows.map((c: any) => ({
          code: c.code,
          title: c.title,
          description: c.description,
          type: c.type,
          value: c.value,
          minOrder: c.minOrder,
          maxDiscount: c.maxDiscount ?? null,
        })),
      }),
    );
  } catch (e) {
    res.status(500).json(fail("COUPONS_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load coupons"));
  }
});

// Read-only, public: so the app can show the customer the fees/discount
// rule that will actually be charged (admin-controlled — see
// admin.ts's /pricing-settings) instead of a value baked into the client.
catalogRouter.get("/pricing-settings", async (_req, res) => {
  try {
    const settings = await getPricingSettings();
    res.json(ok({ pricing: settings }));
  } catch (e) {
    res.status(500).json(fail("PRICING_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load pricing"));
  }
});

export { toRestaurantDTO, toFoodItemDTO };
