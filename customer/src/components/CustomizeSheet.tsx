import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddonItem, CartLineItem, FoodItem, FoodVariant } from "@/types";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { QuantityStepper } from "@/components/QuantityStepper";
import { cartLineId } from "@/store/useCartStore";

type Props = {
  item: FoodItem | null;
  visible: boolean;
  onClose: () => void;
  onConfirm: (line: CartLineItem) => void;
};

export function CustomizeSheet({ item, visible, onClose, onConfirm }: Props) {
  if (!item) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <CustomizeSheetContent key={item.id} item={item} onClose={onClose} onConfirm={onConfirm} />
    </Modal>
  );
}

function CustomizeSheetContent({ item, onClose, onConfirm }: { item: FoodItem; onClose: () => void; onConfirm: (line: CartLineItem) => void }) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants?.[0]?.id);
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);

  const selectedVariant: FoodVariant | undefined = item.variants?.find((v) => v.id === variantId);
  const allAddons: AddonItem[] = item.addonGroups?.flatMap((g) => g.options) ?? [];
  const selectedAddons = allAddons.filter((a) => addonIds.has(a.id));

  const unitPrice = (selectedVariant?.price ?? item.price) + selectedAddons.reduce((s, a) => s + a.price, 0);
  const total = unitPrice * quantity;

  const missingRequiredGroup = item.addonGroups?.find((g) => g.required && !g.options.some((o) => addonIds.has(o.id)));
  const canAdd = !missingRequiredGroup;

  const toggleAddon = (groupId: string, addon: AddonItem, multiSelect: boolean, max?: number | null) => {
    setAddonIds((prev) => {
      const next = new Set(prev);
      const group = item.addonGroups?.find((g) => g.id === groupId);
      const groupOptionIds = new Set(group?.options.map((o) => o.id));
      if (!multiSelect) {
        groupOptionIds.forEach((id) => next.delete(id));
        next.add(addon.id);
        return next;
      }
      if (next.has(addon.id)) {
        next.delete(addon.id);
        return next;
      }
      const currentInGroup = [...next].filter((id) => groupOptionIds.has(id)).length;
      if (max && currentInGroup >= max) return next;
      next.add(addon.id);
      return next;
    });
  };

  const confirm = () => {
    if (!canAdd) return;
    const line: CartLineItem = {
      lineId: cartLineId(item.id, selectedVariant?.id, selectedAddons.map((a) => a.id)),
      foodItemId: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      veg: item.veg,
      quantity,
      unitPrice,
      lineTotal: Math.round(unitPrice * quantity),
      selectedVariant: selectedVariant ? { id: selectedVariant.id, name: selectedVariant.name, price: selectedVariant.price } : undefined,
      selectedAddons: selectedAddons.map((a) => ({ id: a.id, name: a.name, price: a.price })),
    };
    onConfirm(line);
  };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: spacing.lg }}>
          <Text style={typography.h2}>{item.name}</Text>

          {item.variants && item.variants.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={typography.bodyStrong}>Choose size</Text>
                <Text style={styles.requiredTag}>Required</Text>
              </View>
              {item.variants.map((variant) => (
                <Pressable key={variant.id} style={styles.optionRow} onPress={() => setVariantId(variant.id)}>
                  <View style={[styles.radio, variantId === variant.id && styles.radioActive]}>{variantId === variant.id ? <View style={styles.radioDot} /> : null}</View>
                  <Text style={styles.optionLabel}>{variant.name}</Text>
                  <Text style={styles.optionPrice}>₹{variant.price}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {item.addonGroups?.map((group) => (
            <View key={group.id} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={typography.bodyStrong}>{group.name}</Text>
                {group.required ? <Text style={styles.requiredTag}>Required</Text> : null}
              </View>
              {group.options.map((option) => {
                const checked = addonIds.has(option.id);
                return (
                  <Pressable key={option.id} style={styles.optionRow} onPress={() => toggleAddon(group.id, option, group.multiSelect, group.max)}>
                    <View style={[styles.checkbox, checked && styles.checkboxActive]}>{checked ? <Icon name="check" size={12} color={colors.white} /> : null}</View>
                    <Text style={styles.optionLabel}>{option.name}</Text>
                    <Text style={styles.optionPrice}>+₹{option.price}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          {missingRequiredGroup ? <Text style={styles.warning}>Please select {missingRequiredGroup.name.toLowerCase()} to continue.</Text> : null}

          <View style={styles.qtyRow}>
            <Text style={typography.bodyStrong}>Quantity</Text>
            <QuantityStepper value={quantity} onIncrement={() => setQuantity((q) => q + 1)} onDecrement={() => setQuantity((q) => Math.max(1, q - 1))} />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label={`Add item • ₹${total}`} onPress={confirm} disabled={!canAdd} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000055" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "85%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: spacing.sm },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  section: { marginTop: spacing.lg, gap: spacing.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  requiredTag: { ...typography.caption, color: colors.error, fontWeight: "700" },
  optionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.white, fontSize: 12, fontWeight: "800" },
  optionLabel: { ...typography.body, flex: 1 },
  optionPrice: { ...typography.caption },
  warning: { ...typography.caption, color: colors.error, marginTop: spacing.sm },
  qtyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xl },
  footer: { padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border },
});
