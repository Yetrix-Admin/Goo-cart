import { Pressable, StyleSheet, Text, View } from "react-native";
import { FoodItem } from "@/types";
import { colors, radius, spacing, typography } from "@/theme";
import { VegBadge } from "@/components/VegBadge";
import { RemoteImage } from "@/components/RemoteImage";

export function MenuItemCard({ item, quantityInCart, onAdd }: { item: FoodItem; quantityInCart: number; onAdd: () => void }) {
  const hasChoices = Boolean(item.variants?.length || item.addonGroups?.length);

  return (
    <View style={[styles.card, !item.available && styles.cardUnavailable]}>
      <View style={styles.info}>
        <View style={styles.badgeRow}>
          <VegBadge veg={item.veg} />
          {item.bestseller ? (
            <View style={styles.bestsellerPill}>
              <Text style={styles.bestsellerText}>★ BESTSELLER</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.name}>{item.name}</Text>

        <View style={styles.priceRow}>
          <Text style={styles.price}>₹{item.price}</Text>
          {item.rating ? (
            <>
              <Text style={styles.divider}>·</Text>
              <Text style={styles.rating}>
                ★ {item.rating.toFixed(1)}
                {item.ratingCount ? ` (${formatCount(item.ratingCount)})` : ""}
              </Text>
            </>
          ) : null}
        </View>

        <Text style={styles.description} numberOfLines={2}>
          {item.description}
        </Text>
      </View>

      <View style={styles.actionCol}>
        <RemoteImage uri={item.imageUrl} fallbackLabel={item.name} style={styles.photo} />
        <Pressable
          disabled={!item.available}
          onPress={onAdd}
          style={({ pressed }) => [styles.addBtn, !item.available && styles.addBtnDisabled, pressed && item.available && styles.addBtnPressed]}
        >
          <Text style={[styles.addBtnText, !item.available && styles.addBtnTextDisabled]}>
            {!item.available ? "SOLD OUT" : quantityInCart > 0 ? `${quantityInCart} ADDED` : "ADD"}
          </Text>
        </Pressable>
        {item.available && hasChoices ? <Text style={styles.customisable}>customisable</Text> : null}
      </View>
    </View>
  );
}

function formatCount(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}K` : String(count);
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: spacing.lg, paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  cardUnavailable: { opacity: 0.55 },
  info: { flex: 1, gap: 5 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bestsellerPill: { backgroundColor: colors.warningMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  bestsellerText: { color: "#B45309", fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
  name: { ...typography.h3, fontSize: 16 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  price: { ...typography.bodyStrong, fontSize: 15 },
  divider: { color: colors.border },
  rating: { ...typography.caption, color: colors.success, fontWeight: "700" },
  description: { ...typography.caption, lineHeight: 17, marginTop: 2 },
  actionCol: { width: 116, alignItems: "center" },
  photo: { width: 116, height: 96, borderRadius: radius.md },
  addBtn: {
    marginTop: -18,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
    minWidth: 96,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addBtnPressed: { opacity: 0.75 },
  addBtnDisabled: { backgroundColor: colors.background, borderColor: colors.border, shadowOpacity: 0, elevation: 0 },
  addBtnText: { color: colors.primary, fontWeight: "900", fontSize: 12, letterSpacing: 0.5 },
  addBtnTextDisabled: { color: colors.muted },
  customisable: { ...typography.caption, fontSize: 9, marginTop: 4 },
});
