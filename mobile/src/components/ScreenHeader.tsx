import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
};

export function ScreenHeader({ title, subtitle, onBack, right }: Props) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack ?? (() => router.back())} style={styles.backBtn}>
        <Icon name="back" size={20} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={typography.h2} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={typography.caption} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
});
