import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon, IconName } from "@/components/Icon";

export function EmptyState({ title, copy, icon = "empty" }: { title: string; copy: string; icon?: IconName }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.copy}>{copy}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl, gap: spacing.sm },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: radius.xl,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, textAlign: "center" },
  copy: { ...typography.caption, textAlign: "center", maxWidth: 280, lineHeight: 18 },
});
