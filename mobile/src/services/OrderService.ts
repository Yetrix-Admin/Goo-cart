import { restaurantService } from "@/services/RestaurantService";
import { cartLineId } from "@/store/useCartStore";
import { CartLineItem, FoodOrder } from "@/types";

export type ReorderResult = {
  items: CartLineItem[];
  unavailable: string[];
  priceChanged: boolean;
};

// Rebuilds cart lines from a past order against the LIVE catalog, so a reorder
// always uses today's prices and availability — never the historical values
// stored on the original order. Order creation itself lives on the server
// (see useOrderStore / POST /api/v1/orders).
export async function checkReorderAvailability(order: FoodOrder): Promise<ReorderResult> {
  const data = await restaurantService.getRestaurantWithMenu(order.restaurantId);
  if (!data) return { items: [], unavailable: order.items.map((i) => i.name), priceChanged: false };

  const items: CartLineItem[] = [];
  const unavailable: string[] = [];
  let priceChanged = false;

  for (const line of order.items) {
    const current = data.items.find((i) => i.id === line.foodItemId);
    if (!current || !current.available) {
      unavailable.push(line.name);
      continue;
    }

    const variantPrice = line.selectedVariant
      ? current.variants?.find((v) => v.id === line.selectedVariant!.id)?.price ?? current.price
      : current.price;
    const addonsPrice = line.selectedAddons.reduce((sum, a) => sum + a.price, 0);
    const unitPrice = variantPrice + addonsPrice;
    if (unitPrice !== line.unitPrice) priceChanged = true;

    items.push({
      ...line,
      lineId: cartLineId(line.foodItemId, line.selectedVariant?.id, line.selectedAddons.map((a) => a.id)),
      imageUrl: current.imageUrl,
      unitPrice,
      lineTotal: Math.round(unitPrice * line.quantity),
    });
  }

  return { items, unavailable, priceChanged };
}
