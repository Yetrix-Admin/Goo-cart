import { FoodItem, Restaurant } from "../models.js";

export class MenuItemError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

/**
 * Shared by the Vendor App's own menu routes and the Admin console's
 * on-behalf-of-vendor menu routes, so the two never drift into different
 * validation or slug-collision behavior.
 */
export async function createFoodItem(restaurant: any, body: any) {
  const name = String(body?.name ?? "").trim();
  const description = String(body?.description ?? "").trim();
  const price = Number(body?.price);
  const categoryKey = String(body?.categoryKey ?? "").trim();

  if (name.length < 2) throw new MenuItemError("INVALID_NAME", "Enter a dish name.");
  if (!Number.isFinite(price) || price <= 0) throw new MenuItemError("INVALID_PRICE", "Enter a valid price.");
  if (!categoryKey) throw new MenuItemError("INVALID_CATEGORY", "Choose a menu category.");

  // A restaurant with no categories yet (freshly created by admin) gets one
  // seeded automatically rather than rejecting the first item added to it.
  const categoryExists = (restaurant.categories ?? []).some((c: any) => c.key === categoryKey);
  if (!categoryExists) {
    await Restaurant.updateOne({ _id: restaurant._id }, { $push: { categories: { key: categoryKey, name: categoryKey, sortOrder: (restaurant.categories ?? []).length } } });
  }

  let slug = `${restaurant.slug}-${slugify(name)}`;
  if (await FoodItem.exists({ slug })) slug = `${slug}-${Date.now().toString(36)}`;

  return FoodItem.create({
    slug,
    restaurantId: restaurant._id,
    categoryKey,
    name,
    description,
    price,
    veg: Boolean(body?.veg),
    available: true,
  });
}

export async function updateFoodItem(item: any, body: any) {
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) throw new MenuItemError("INVALID_NAME", "Enter a dish name.");
    item.name = name;
  }
  if (body.description !== undefined) item.description = String(body.description).trim();
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new MenuItemError("INVALID_PRICE", "Enter a valid price.");
    item.price = price;
  }
  if (typeof body.veg === "boolean") item.veg = body.veg;
  if (typeof body.available === "boolean") item.available = body.available;

  await item.save();
  return item;
}
