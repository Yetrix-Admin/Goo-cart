// Catalog read layer. All restaurant/menu data lives in D1 and is served from
// here — no catalog data is hardcoded in any client app.

export type RestaurantDTO = {
  id: string;
  name: string;
  imageUrl: string | null;
  rating: number;
  ratingCount: number;
  cuisines: string[];
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  distanceKm: number;
  priceForOne: number | null;
  priceForTwo: number | null;
  vegOnly: boolean;
  isOpen: boolean;
  area: string;
  latitude: number;
  longitude: number;
  offers: { title: string; description: string | null }[];
};

export type MenuCategoryDTO = { id: string; name: string };

export type FoodItemDTO = {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  price: number;
  veg: boolean;
  rating: number | null;
  ratingCount: number | null;
  bestseller: boolean;
  available: boolean;
  variants: { id: string; name: string; price: number }[];
  addonGroups: { id: string; name: string; required: boolean; multiSelect: boolean; max: number | null; options: { id: string; name: string; price: number }[] }[];
};

type RestaurantRow = {
  id: string; name: string; image_url: string | null; rating: number; rating_count: number; cuisines: string;
  delivery_time_min: number; delivery_time_max: number; distance_km: number; price_for_one: number | null;
  price_for_two: number | null; veg_only: number; is_open: number; area: string; latitude: number; longitude: number;
};

type OfferRow = { restaurant_id: string; title: string; description: string | null };

export type RestaurantFilters = {
  search?: string;
  minRating?: number;
  maxDeliveryMinutes?: number;
  vegOnly?: boolean;
  withOffers?: boolean;
  cuisine?: string;
};

export async function listRestaurants(db: D1Database, filters: RestaurantFilters = {}): Promise<RestaurantDTO[]> {
  const clauses: string[] = [];
  const bindings: unknown[] = [];

  if (filters.search) {
    clauses.push("(LOWER(name) LIKE ? OR LOWER(cuisines) LIKE ?)");
    const like = `%${filters.search.toLowerCase()}%`;
    bindings.push(like, like);
  }
  if (filters.minRating !== undefined && Number.isFinite(filters.minRating)) {
    clauses.push("rating >= ?");
    bindings.push(filters.minRating);
  }
  if (filters.maxDeliveryMinutes !== undefined && Number.isFinite(filters.maxDeliveryMinutes)) {
    clauses.push("delivery_time_max <= ?");
    bindings.push(filters.maxDeliveryMinutes);
  }
  if (filters.vegOnly) clauses.push("veg_only = 1");
  if (filters.cuisine) {
    clauses.push("LOWER(cuisines) LIKE ?");
    bindings.push(`%${filters.cuisine.toLowerCase()}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const statement = db.prepare(`SELECT * FROM restaurants ${where} ORDER BY is_open DESC, rating DESC`);
  const rows = (await (bindings.length ? statement.bind(...bindings) : statement).all<RestaurantRow>()).results;

  const offers = (await db.prepare("SELECT restaurant_id, title, description FROM restaurant_offers").all<OfferRow>()).results;
  const offersByRestaurant = new Map<string, { title: string; description: string | null }[]>();
  for (const offer of offers) {
    const list = offersByRestaurant.get(offer.restaurant_id) ?? [];
    list.push({ title: offer.title, description: offer.description });
    offersByRestaurant.set(offer.restaurant_id, list);
  }

  const mapped = rows.map((row) => toRestaurantDTO(row, offersByRestaurant.get(row.id) ?? []));
  return filters.withOffers ? mapped.filter((r) => r.offers.length > 0) : mapped;
}

export async function getRestaurant(db: D1Database, id: string): Promise<RestaurantDTO | null> {
  const row = await db.prepare("SELECT * FROM restaurants WHERE id = ?").bind(id).first<RestaurantRow>();
  if (!row) return null;
  const offers = (await db.prepare("SELECT restaurant_id, title, description FROM restaurant_offers WHERE restaurant_id = ?").bind(id).all<OfferRow>()).results;
  return toRestaurantDTO(row, offers.map((o) => ({ title: o.title, description: o.description })));
}

export async function getMenu(db: D1Database, restaurantId: string): Promise<{ categories: MenuCategoryDTO[]; items: FoodItemDTO[] }> {
  const [categoriesResult, itemsResult, variantsResult, groupsResult, addonsResult] = await Promise.all([
    db.prepare("SELECT id, name FROM menu_categories WHERE restaurant_id = ? ORDER BY sort_order").bind(restaurantId).all<{ id: string; name: string }>(),
    db.prepare("SELECT * FROM food_items WHERE restaurant_id = ? ORDER BY bestseller DESC, name").bind(restaurantId).all<Record<string, never>>(),
    db.prepare("SELECT v.* FROM food_item_variants v JOIN food_items f ON f.id = v.food_item_id WHERE f.restaurant_id = ? ORDER BY v.sort_order").bind(restaurantId).all<Record<string, never>>(),
    db.prepare("SELECT g.* FROM food_item_addon_groups g JOIN food_items f ON f.id = g.food_item_id WHERE f.restaurant_id = ?").bind(restaurantId).all<Record<string, never>>(),
    db.prepare("SELECT a.* FROM food_item_addons a JOIN food_item_addon_groups g ON g.id = a.group_id JOIN food_items f ON f.id = g.food_item_id WHERE f.restaurant_id = ?").bind(restaurantId).all<Record<string, never>>(),
  ]);

  const variantsByItem = new Map<string, { id: string; name: string; price: number }[]>();
  for (const v of variantsResult.results as unknown as { id: string; food_item_id: string; name: string; price: number }[]) {
    const list = variantsByItem.get(v.food_item_id) ?? [];
    list.push({ id: v.id, name: v.name, price: v.price });
    variantsByItem.set(v.food_item_id, list);
  }

  const addonsByGroup = new Map<string, { id: string; name: string; price: number }[]>();
  for (const a of addonsResult.results as unknown as { id: string; group_id: string; name: string; price: number }[]) {
    const list = addonsByGroup.get(a.group_id) ?? [];
    list.push({ id: a.id, name: a.name, price: a.price });
    addonsByGroup.set(a.group_id, list);
  }

  const groupsByItem = new Map<string, FoodItemDTO["addonGroups"]>();
  for (const g of groupsResult.results as unknown as { id: string; food_item_id: string; name: string; required: number; multi_select: number; max_select: number | null }[]) {
    const list = groupsByItem.get(g.food_item_id) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      required: Boolean(g.required),
      multiSelect: Boolean(g.multi_select),
      max: g.max_select,
      options: addonsByGroup.get(g.id) ?? [],
    });
    groupsByItem.set(g.food_item_id, list);
  }

  const items = (itemsResult.results as unknown as {
    id: string; restaurant_id: string; category_id: string; name: string; description: string; image_url: string | null;
    price: number; veg: number; rating: number; rating_count: number; bestseller: number; available: number;
  }[]).map<FoodItemDTO>((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    price: row.price,
    veg: Boolean(row.veg),
    rating: row.rating || null,
    ratingCount: row.rating_count || null,
    bestseller: Boolean(row.bestseller),
    available: Boolean(row.available),
    variants: variantsByItem.get(row.id) ?? [],
    addonGroups: groupsByItem.get(row.id) ?? [],
  }));

  return { categories: categoriesResult.results, items };
}

export async function searchCatalog(db: D1Database, query: string) {
  const like = `%${query.toLowerCase()}%`;
  const [restaurants, items] = await Promise.all([
    listRestaurants(db, { search: query }),
    db
      .prepare(
        `SELECT f.id, f.restaurant_id, f.name, f.price, f.veg, f.image_url, r.name AS restaurant_name
         FROM food_items f JOIN restaurants r ON r.id = f.restaurant_id
         WHERE LOWER(f.name) LIKE ? ORDER BY f.bestseller DESC LIMIT 40`,
      )
      .bind(like)
      .all<{ id: string; restaurant_id: string; name: string; price: number; veg: number; image_url: string | null; restaurant_name: string }>(),
  ]);

  return {
    restaurants,
    items: items.results.map((i) => ({
      id: i.id,
      restaurantId: i.restaurant_id,
      restaurantName: i.restaurant_name,
      name: i.name,
      price: i.price,
      veg: Boolean(i.veg),
      imageUrl: i.image_url,
    })),
  };
}

function toRestaurantDTO(row: RestaurantRow, offers: { title: string; description: string | null }[]): RestaurantDTO {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    rating: row.rating,
    ratingCount: row.rating_count,
    cuisines: row.cuisines ? row.cuisines.split(",").map((c) => c.trim()).filter(Boolean) : [],
    deliveryTimeMin: row.delivery_time_min,
    deliveryTimeMax: row.delivery_time_max,
    distanceKm: row.distance_km,
    priceForOne: row.price_for_one,
    priceForTwo: row.price_for_two,
    vegOnly: Boolean(row.veg_only),
    isOpen: Boolean(row.is_open),
    area: row.area,
    latitude: row.latitude,
    longitude: row.longitude,
    offers,
  };
}
