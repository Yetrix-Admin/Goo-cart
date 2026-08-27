import { Pressable, StyleSheet, Text, View } from "react-native";
import { Address } from "@/types";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";

export function AddressCard({
  address,
  selected,
  onPress,
  onLongPress,
}: {
  address: Address;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={[styles.row, selected && styles.rowSelected]}>
      <View style={styles.icon}>
        <Text style={styles.iconText}>{address.label[0]}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={typography.bodyStrong}>{address.label}</Text>
        <Text style={typography.caption} numberOfLines={2}>
          {[address.line1, address.landmark, address.city, address.state, address.pincode].filter(Boolean).join(", ")}
        </Text>
        <Text style={typography.caption}>
          {address.contactName} · {address.contactPhone}
        </Text>
      </View>
      {selected ? <Icon name="checkCircle" size={19} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  icon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.primaryMuted, alignItems: "center", justifyContent: "center" },
  iconText: { color: colors.primary, fontWeight: "800" },
  check: { color: colors.primary, fontSize: 18, fontWeight: "800" },
});
