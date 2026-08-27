import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";

// Single icon vocabulary for the whole app — vector icons render identically
// across every Android device, unlike text glyphs which depend on the system
// font's coverage.
export const ICONS = {
  home: "home-outline",
  homeActive: "home",
  trips: "receipt-outline",
  tripsActive: "receipt",
  account: "person-circle-outline",
  accountActive: "person-circle",
  back: "chevron-back",
  forward: "chevron-forward",
  location: "location-outline",
  navigate: "navigate-outline",
  call: "call-outline",
  checkCircle: "checkmark-circle",
  check: "checkmark",
  close: "close",
  alert: "alert-circle-outline",
  time: "time-outline",
  bike: "bicycle-outline",
  bag: "bag-handle-outline",
  power: "power-outline",
  empty: "file-tray-outline",
  lock: "lock-closed-outline",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={ICONS[name]} size={size} color={color} />;
}
