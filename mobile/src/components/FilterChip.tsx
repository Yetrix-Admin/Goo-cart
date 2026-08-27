import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

export function FilterChip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.chip, active && styles.chipActive]}>
      <Text style={[typography.captionStrong, { color: active ? colors.white : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.dark, borderColor: colors.dark },
});
