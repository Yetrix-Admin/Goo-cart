import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";

// Single icon vocabulary for the whole app. Previously these were text glyphs
// (⌂ ⌕ ↻ ▱ ☰), which render as empty boxes on Android devices whose system
// font lacks them — vector icons look identical on every device.
export const ICONS = {
  home: "home-outline",
  homeActive: "home",
  search: "search-outline",
  activity: "receipt-outline",
  activityActive: "receipt",
  cart: "cart-outline",
  cartActive: "cart",
  account: "person-circle-outline",
  accountActive: "person-circle",
  back: "chevron-back",
  forward: "chevron-forward",
  chevronDown: "chevron-down",
  location: "location-outline",
  notification: "notifications-outline",
  heart: "heart-outline",
  heartFilled: "heart",
  star: "star",
  menu: "list-outline",
  close: "close",
  check: "checkmark",
  checkCircle: "checkmark-circle",
  alert: "alert-circle-outline",
  offer: "pricetag-outline",
  plus: "add",
  minus: "remove",
  time: "time-outline",
  bike: "bicycle-outline",
  parcel: "cube-outline",
  food: "restaurant-outline",
  grocery: "basket-outline",
  vegetables: "leaf-outline",
  mart: "storefront-outline",
  empty: "file-tray-outline",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={ICONS[name]} size={size} color={color} />;
}
