import { ActivityIndicator, GestureResponderEvent, Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "outline";
};

export function PrimaryButton({ label, onPress, disabled, loading, variant = "primary" }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "outline" && styles.outline,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "outline" ? colors.primary : colors.white} />
      ) : (
        <Text style={[typography.button, variant === "outline" && { color: colors.primary }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.dark },
  outline: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
