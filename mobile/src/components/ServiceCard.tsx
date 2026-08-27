import { Pressable, StyleSheet, Text, View } from "react-native";
import { ServiceMeta } from "@/constants/services";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";

export function ServiceCard({ meta, onPress }: { meta: ServiceMeta; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={meta.label}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { backgroundColor: meta.tint }]}>
        <Icon name={meta.icon} size={24} color={meta.color} />
      </View>
      <Text style={styles.label}>{meta.label}</Text>
      <Text style={styles.note}>{meta.note}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "31%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
  },
  pressed: { opacity: 0.75 },
  icon: { width: 52, height: 52, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  label: { ...typography.bodyStrong, marginTop: spacing.xs },
  note: { ...typography.caption },
});
