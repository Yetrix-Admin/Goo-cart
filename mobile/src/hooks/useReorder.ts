import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { checkReorderAvailability } from "@/services/OrderService";
import { useCartStore } from "@/store/useCartStore";
import { FoodOrder } from "@/types";

// Shared by the Activity list and Order Details — both offer "Reorder" and
// must apply identical availability/price rules.
export function useReorder() {
  const [busy, setBusy] = useState(false);
  const addItem = useCartStore((s) => s.addItem);
  const replaceCartWithItem = useCartStore((s) => s.replaceCartWithItem);

  const reorder = async (order: FoodOrder) => {
    setBusy(true);
    try {
      const { items, unavailable, priceChanged } = await checkReorderAvailability(order);

      if (items.length === 0) {
        Alert.alert("Nothing available", "None of the items from this order are available right now.");
        return;
      }

      const proceed = () => {
        replaceCartWithItem(order.restaurantId, order.restaurantName, items[0]);
        items.slice(1).forEach((line) => addItem(order.restaurantId, order.restaurantName, line));
        router.push("/(tabs)/cart");
      };

      const warnings: string[] = [];
      if (unavailable.length > 0) {
        warnings.push(`${unavailable.join(", ")} ${unavailable.length > 1 ? "are" : "is"} no longer available.`);
      }
      if (priceChanged) warnings.push("Some prices have changed since your last order.");

      if (warnings.length > 0) {
        Alert.alert("Before you reorder", `${warnings.join("\n\n")}\n\nContinue with the current menu?`, [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", onPress: proceed },
        ]);
      } else {
        proceed();
      }
    } catch (e) {
      Alert.alert("Couldn't reorder", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return { reorder, busy };
}
