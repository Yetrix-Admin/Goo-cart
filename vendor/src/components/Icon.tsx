import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";

// Single icon vocabulary for the whole app — vector icons render identically
// across every Android device, unlike text glyphs which depend on the system
// font's coverage.
export const ICONS = {
  home: "home-outline",
  homeActive: "home",
  orders: "receipt-outline",
  ordersActive: "receipt",
  menu: "restaurant-outline",
  menuActive: "restaurant",
  account: "person-circle-outline",
  accountActive: "person-circle",
  back: "chevron-back",
  forward: "chevron-forward",
  add: "add-circle-outline",
  plus: "add",
  minus: "remove",
  checkCircle: "checkmark-circle",
  check: "checkmark",
  close: "close",
  alert: "alert-circle-outline",
  time: "time-outline",
  bag: "bag-handle-outline",
  power: "power-outline",
  empty: "file-tray-outline",
  storefront: "storefront-outline",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={ICONS[name]} size={size} color={color} />;
}
