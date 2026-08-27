import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  restaurant: { latitude: number; longitude: number; name: string };
  destination: { latitude: number; longitude: number };
  rider?: { latitude: number; longitude: number; name: string } | null;
};

// react-native-maps has no web target. This placeholder keeps the web preview
// usable during development — the real map renders on Android/iOS via Expo Go
// (see TrackingMap.tsx).
export function TrackingMap({ restaurant, rider }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={typography.bodyStrong}>Map preview unavailable on web</Text>
      <Text style={styles.copy}>Live map tracking renders on Android/iOS in Expo Go.</Text>
      <Text style={styles.coords}>
        {restaurant.name}: {restaurant.latitude.toFixed(4)}, {restaurant.longitude.toFixed(4)}
      </Text>
      {rider ? (
        <Text style={styles.coords}>
          {rider.name}: {rider.latitude.toFixed(4)}, {rider.longitude.toFixed(4)}
        </Text>
      ) : null}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>WEB PREVIEW</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 140, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, gap: 4, justifyContent: "center" },
  copy: { ...typography.caption },
  coords: { ...typography.caption, fontFamily: "monospace" as never },
  badge: { position: "absolute", top: spacing.sm, left: spacing.sm, backgroundColor: colors.dark, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  badgeText: { color: colors.white, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
});
