import { Pressable, StyleSheet, Text, View } from "react-native";
import { Restaurant } from "@/types";
import { colors, radius, spacing, typography } from "@/theme";
import { RemoteImage } from "@/components/RemoteImage";

export function RestaurantCard({ restaurant, onPress, wide }: { restaurant: Restaurant; onPress?: () => void; wide?: boolean }) {
  const eta = `${restaurant.deliveryTimeMin}–${restaurant.deliveryTimeMax} min`;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, wide && styles.cardWide, pressed && styles.pressed]}>
      <View style={styles.photoWrap}>
        <RemoteImage uri={restaurant.imageUrl} fallbackLabel={restaurant.name} style={wide ? styles.photoWide : styles.photo} />

        {/* ETA badge sits on the image so scanning a list answers "how soon?" first */}
        <View style={styles.etaBadge}>
          <Text style={styles.etaText}>{eta}</Text>
        </View>

        {restaurant.vegOnly ? (
          <View style={styles.vegBadge}>
            <Text style={styles.vegText}>PURE VEG</Text>
          </View>
        ) : null}

        {!restaurant.isOpen ? (
          <View style={styles.closedOverlay}>
            <Text style={styles.closedText}>CLOSED NOW</Text>
            <Text style={styles.closedSub}>Opens tomorrow</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <View style={styles.ratingPill}>
            <Text style={styles.ratingText}>★ {restaurant.rating.toFixed(1)}</Text>
          </View>
        </View>

        <Text style={styles.cuisines} numberOfLines={1}>
          {restaurant.cuisines.join(" • ")}
        </Text>

        <Text style={styles.meta} numberOfLines={1}>
          {restaurant.distanceKm} km · {restaurant.area.split(",")[0]}
          {restaurant.priceForOne ? ` · ₹${restaurant.priceForOne} for one` : ""}
        </Text>

        {restaurant.offers[0] ? (
          <View style={styles.offerStrip}>
            <Text style={styles.offerIcon}>%</Text>
            <Text style={styles.offerText} numberOfLines={1}>
              {restaurant.offers[0].title}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cardWide: { width: "100%" },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  photoWrap: { position: "relative" },
  photo: { height: 150, width: "100%" },
  photoWide: { height: 170, width: "100%" },
  etaBadge: {
    position: "absolute",
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  etaText: { ...typography.captionStrong, color: colors.text, fontSize: 11 },
  vegBadge: {
    position: "absolute",
    right: spacing.sm,
    top: spacing.sm,
    backgroundColor: colors.successMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  vegText: { color: colors.success, fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  closedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000000A6", alignItems: "center", justifyContent: "center" },
  closedText: { color: colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 1 },
  closedSub: { color: "#DDDDDD", fontSize: 11, marginTop: 2 },
  body: { padding: spacing.md, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  name: { ...typography.h3, flex: 1, fontSize: 16 },
  ratingPill: { flexDirection: "row", backgroundColor: colors.success, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5 },
  ratingText: { color: colors.white, fontSize: 11, fontWeight: "800" },
  cuisines: { ...typography.caption },
  meta: { ...typography.caption, color: colors.muted },
  offerStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderStyle: "dashed",
  },
  offerIcon: { color: colors.primary, fontWeight: "900", fontSize: 12 },
  offerText: { ...typography.captionStrong, color: colors.primary, flex: 1 },
});
