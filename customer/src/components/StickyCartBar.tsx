import { Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@/theme";

export function StickyCartBar({ itemCount, total, onPress }: { itemCount: number; total: number; onPress: () => void }) {
  if (itemCount === 0) return null;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.safe}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.bar, pressed && styles.pressed]}>
        <Text style={styles.label}>
          {itemCount} item{itemCount > 1 ? "s" : ""} | ₹{total}
        </Text>
        <Text style={styles.cta}>View Cart →</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "transparent" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pressed: { opacity: 0.9 },
  label: { ...typography.bodyStrong, color: colors.white },
  cta: { ...typography.bodyStrong, color: colors.white },
});
