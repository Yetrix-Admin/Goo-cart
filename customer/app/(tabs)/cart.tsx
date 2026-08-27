import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { QuantityStepper } from "@/components/QuantityStepper";
import { VegBadge } from "@/components/VegBadge";
import { RemoteImage } from "@/components/RemoteImage";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { useCartBill, useCartStore } from "@/store/useCartStore";
import { validateCoupon } from "@/services/CouponService";
import { useCatalogStore } from "@/store/useCatalogStore";
import { useAuthStore } from "@/store/useAuthStore";
import { DELIVERY_INSTRUCTIONS } from "@/types";

const TIP_OPTIONS = [10, 20, 30];

export default function CartScreen() {
  const items = useCartStore((s) => s.items);
  const restaurantId = useCartStore((s) => s.restaurantId);
  const restaurantName = useCartStore((s) => s.restaurantName);
  const couponCode = useCartStore((s) => s.couponCode);
  const instructions = useCartStore((s) => s.instructions);
  const tip = useCartStore((s) => s.tip);
  const bill = useCartBill();
  const updateQty = useCartStore((s) => s.updateQty);
  const applyCoupon = useCartStore((s) => s.applyCoupon);
  const removeCoupon = useCartStore((s) => s.removeCoupon);
  const toggleInstruction = useCartStore((s) => s.toggleInstruction);
  const setTip = useCartStore((s) => s.setTip);

  const coupons = useCatalogStore((s) => s.coupons);
  const user = useAuthStore((s) => s.user);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState("");
  const [customTip, setCustomTip] = useState("");

  // Guests can build a full cart; signing in is only required the moment
  // they try to move past it toward actually placing an order (spec
  // section 3). The cart itself is untouched either way.
  const proceedToCheckout = () => {
    if (!user) {
      router.push({ pathname: "/login", params: { returnTo: "/checkout" } });
      return;
    }
    router.push("/checkout");
  };

  const submitCoupon = () => {
    if (!couponInput.trim()) return;
    const result = validateCoupon(coupons, couponInput, bill.itemTotal, couponCode ?? undefined);
    if (!result.ok) {
      setCouponError(result.message);
      return;
    }
    applyCoupon(result.coupon.code);
    setCouponError("");
    setCouponInput("");
  };

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Text style={typography.h1}>Your cart</Text>
          <Text style={styles.copy}>Add something delicious or useful.</Text>
        </View>
        <View style={styles.emptyWrap}>
          <EmptyState icon="cart" title="Your cart is empty" copy="Looks like you haven't added anything yet." />
          <PrimaryButton label="Explore Food" onPress={() => router.push("/food")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={typography.h1}>Your cart</Text>
        <Text style={styles.copy}>{restaurantName}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.section}>
          {items.map((item) => (
            <View key={item.lineId} style={styles.itemRow}>
              <RemoteImage uri={item.imageUrl} fallbackLabel={item.name} style={styles.itemThumb} />
              <VegBadge veg={item.veg} />
              <View style={{ flex: 1 }}>
                <Text style={typography.bodyStrong}>{item.name}</Text>
                {item.selectedVariant ? <Text style={typography.caption}>{item.selectedVariant.name}</Text> : null}
                {item.selectedAddons.map((a) => (
                  <Text key={a.id} style={typography.caption}>
                    {a.name}
                  </Text>
                ))}
              </View>
              <QuantityStepper small value={item.quantity} onIncrement={() => updateQty(item.lineId, 1)} onDecrement={() => updateQty(item.lineId, -1)} />
              <Text style={styles.lineTotal}>₹{item.lineTotal}</Text>
            </View>
          ))}
          <Pressable style={styles.addMore} onPress={() => restaurantId && router.push({ pathname: "/food/restaurant/[id]", params: { id: restaurantId } })}>
            <Text style={styles.addMoreText}>+ Add more items</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={typography.h3}>Apply Coupon</Text>
          {couponCode ? (
            <View style={styles.couponApplied}>
              <View style={styles.couponAppliedRow}>
                <Icon name="checkCircle" size={16} color={colors.success} />
                <Text style={styles.couponAppliedText}>{couponCode} applied</Text>
              </View>
              <Pressable onPress={removeCoupon}>
                <Text style={styles.removeCoupon}>Remove</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <View style={styles.couponRow}>
                <TextInput
                  value={couponInput}
                  onChangeText={(t) => {
                    setCouponInput(t);
                    setCouponError("");
                  }}
                  autoCapitalize="characters"
                  placeholder="Enter coupon code"
                  placeholderTextColor={colors.muted}
                  style={styles.couponInput}
                />
                <Pressable style={styles.couponApplyBtn} onPress={submitCoupon}>
                  <Text style={styles.couponApplyText}>Apply</Text>
                </Pressable>
              </View>
              {couponError ? <Text style={styles.error}>{couponError}</Text> : null}
              <Text style={typography.caption}>Try GOO50, FREEDEL or WELCOME100</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={typography.h3}>Delivery Instructions</Text>
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {DELIVERY_INSTRUCTIONS.map((instruction) => {
              const checked = instructions.includes(instruction);
              return (
                <Pressable key={instruction} style={styles.instructionRow} onPress={() => toggleInstruction(instruction)}>
                  <View style={[styles.checkbox, checked && styles.checkboxActive]}>{checked ? <Icon name="check" size={12} color={colors.white} /> : null}</View>
                  <Text style={typography.body}>{instruction}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={typography.h3}>Add a tip</Text>
          <View style={styles.tipRow}>
            {TIP_OPTIONS.map((amount) => (
              <Pressable key={amount} style={[styles.tipChip, tip === amount && styles.tipChipActive]} onPress={() => setTip(tip === amount ? 0 : amount)}>
                <Text style={[typography.bodyStrong, tip === amount && { color: colors.white }]}>₹{amount}</Text>
              </Pressable>
            ))}
            <TextInput
              value={customTip}
              onChangeText={(t) => {
                const digits = t.replace(/[^0-9]/g, "");
                setCustomTip(digits);
                setTip(digits ? Number(digits) : 0);
              }}
              placeholder="Other"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              style={styles.tipInput}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={typography.h3}>Bill Details</Text>
          <BillRow label="Item Total" value={bill.itemTotal} />
          {bill.restaurantDiscount > 0 && <BillRow label="Restaurant Discount" value={-bill.restaurantDiscount} highlight />}
          {bill.couponDiscount > 0 && <BillRow label={`Coupon (${couponCode})`} value={-bill.couponDiscount} highlight />}
          <BillRow label="Delivery Fee" value={bill.deliveryFee} />
          <BillRow label="Platform Fee" value={bill.platformFee} />
          <BillRow label="Taxes" value={bill.taxes} />
          {bill.tip > 0 && <BillRow label="Tip" value={bill.tip} />}
          <View style={styles.divider} />
          <BillRow label="To Pay" value={bill.total} strong />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={`Proceed to Checkout • ₹${bill.total}`} onPress={proceedToCheckout} />
      </View>
    </SafeAreaView>
  );
}

function BillRow({ label, value, strong, highlight }: { label: string; value: number; strong?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={strong ? typography.bodyStrong : typography.body}>{label}</Text>
      <Text style={[strong ? typography.bodyStrong : typography.body, highlight && { color: colors.success }]}>
        {value < 0 ? "-" : ""}₹{Math.abs(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.xl, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  copy: { ...typography.body, color: colors.muted },
  emptyWrap: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 140 },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  itemThumb: { width: 44, height: 44, borderRadius: 8 },
  lineTotal: { ...typography.bodyStrong, width: 56, textAlign: "right" },
  addMore: { marginTop: spacing.sm },
  addMoreText: { ...typography.captionStrong, color: colors.primary },
  couponRow: { flexDirection: "row", gap: spacing.sm },
  couponInput: { flex: 1, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, ...typography.body },
  couponApplyBtn: { paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  couponApplyText: { color: colors.primary, fontWeight: "700" },
  couponApplied: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  couponAppliedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  couponAppliedText: { ...typography.bodyStrong, color: colors.success },
  removeCoupon: { ...typography.captionStrong, color: colors.error },
  error: { ...typography.caption, color: colors.error },
  instructionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.white, fontSize: 12, fontWeight: "800" },
  tipRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  tipChip: { paddingHorizontal: spacing.lg, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  tipChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tipInput: { width: 80, height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, ...typography.body },
  billRow: { flexDirection: "row", justifyContent: "space-between" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.xl, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
