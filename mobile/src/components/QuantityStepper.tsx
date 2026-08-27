import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { Icon } from "@/components/Icon";

export function QuantityStepper({ value, onIncrement, onDecrement, small }: { value: number; onIncrement: () => void; onDecrement: () => void; small?: boolean }) {
  return (
    <View style={[styles.wrap, small && styles.wrapSmall]}>
      <Pressable onPress={onDecrement} hitSlop={8} style={styles.btn}>
        <Icon name="minus" size={16} color={colors.primary} />
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable onPress={onIncrement} hitSlop={8} style={styles.btn}>
        <Icon name="plus" size={16} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: 96,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
  },
  wrapSmall: { width: 84, height: 32 },
  btn: { paddingHorizontal: 4, paddingVertical: 4 },
  btnText: { color: colors.primary, fontSize: 18, fontWeight: "800" },
  value: { color: colors.primary, fontWeight: "800", fontSize: 14 },
});
