import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { AddressCard } from "@/components/AddressCard";
import { colors, radius, spacing, typography } from "@/theme";
import { useCartBill, useCartItemCount, useCartStore } from "@/store/useCartStore";
import { useAddressStore } from "@/store/useAddressStore";
import { useAuthStore } from "@/store/useAuthStore";
import { PaymentMethod, Restaurant } from "@/types";
import { restaurantService } from "@/services/RestaurantService";

const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "UPI", label: "UPI" },
  { id: "GPAY", label: "Google Pay" },
  { id: "PHONEPE", label: "PhonePe" },
  { id: "PAYTM", label: "Paytm" },
  { id: "CARD", label: "Cards" },
  { id: "NETBANKING", label: "Net Banking" },
  { id: "WALLET", label: "Wallet" },
  { id: "COD", label: "Cash on Delivery" },
];

export default function CheckoutScreen() {
  const user = useAuthStore((s) => s.user);
  const restaurantId = useCartStore((s) => s.restaurantId);
  const restaurantName = useCartStore((s) => s.restaurantName);
  const totalItems = useCartItemCount();
  const couponCode = useCartStore((s) => s.couponCode);
  const instructions = useCartStore((s) => s.instructions);
  const bill = useCartBill();

  const addresses = useAddressStore((s) => s.addresses);
  const selectedId = useAddressStore((s) => s.selectedId);

  const [method, setMethod] = useState<PaymentMethod>("UPI");

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    restaurantService
      .getRestaurantWithMenu(restaurantId)
      .then((data) => {
        if (!cancelled) setRestaurant(data?.restaurant ?? null);
      })
      .catch(() => {
        if (!cancelled) setRestaurant(null);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const continueToPayment = () => router.push({ pathname: "/checkout/payment", params: { method } });

  // Defensive: cart.tsx already gates entry to this screen, but a guest
  // could still land here via a stale deep link or by signing out on the
  // payment screen in another tab. Placing an order always requires auth.
  if (!user) return <Redirect href={{ pathname: "/login", params: { returnTo: "/checkout" } }} />;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Checkout" subtitle={restaurantName ?? undefined} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Delivery Address" action={{ label: "Change", onPress: () => router.push("/checkout/address") }}>
          {addresses
            .filter((a) => a.id === selectedId)
            .map((a) => (
              <AddressCard key={a.id} address={a} selected />
            ))}
        </Section>

        {restaurant ? (
          <Section title="Delivery ETA">
            <Text style={typography.bodyStrong}>
              {restaurant.deliveryTimeMin}–{restaurant.deliveryTimeMax} minutes
            </Text>
          </Section>
        ) : null}

        <Section title="Order Summary" action={{ label: "Edit cart", onPress: () => router.push("/(tabs)/cart") }}>
          <Text style={typography.body}>
            {totalItems} item{totalItems === 1 ? "" : "s"} from {restaurantName}
          </Text>
          {couponCode ? <Text style={typography.caption}>Coupon applied: {couponCode}</Text> : null}
          {instructions.length > 0 ? <Text style={typography.caption}>{instructions.join(", ")}</Text> : null}
        </Section>

        <Section title="Payment Method">
          {PAYMENT_METHODS.map((m) => (
            <Pressable key={m.id} style={styles.methodRow} onPress={() => setMethod(m.id)}>
              <View style={[styles.radio, method === m.id && styles.radioActive]}>{method === m.id ? <View style={styles.radioDot} /> : null}</View>
              <Text style={typography.body}>{m.label}</Text>
            </Pressable>
          ))}
        </Section>

        <Section title="Bill Details">
          <BillRow label="Item Total" value={bill.itemTotal} />
          {bill.restaurantDiscount > 0 && <BillRow label="Restaurant Discount" value={-bill.restaurantDiscount} highlight />}
          {bill.couponDiscount > 0 && <BillRow label="Coupon Discount" value={-bill.couponDiscount} highlight />}
          <BillRow label="Delivery Fee" value={bill.deliveryFee} />
          <BillRow label="Platform Fee" value={bill.platformFee} />
          <BillRow label="Taxes" value={bill.taxes} />
          {bill.tip > 0 && <BillRow label="Tip" value={bill.tip} />}
          <View style={styles.divider} />
          <BillRow label="To Pay" value={bill.total} strong />
        </Section>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={method === "COD" ? `Place Order • ₹${bill.total}` : `Continue to Payment • ₹${bill.total}`} onPress={continueToPayment} />
      </View>
    </SafeAreaView>
  );
}

function Section({ title, action, children }: { title: string; action?: { label: string; onPress: () => void }; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={typography.h3}>{title}</Text>
        {action ? (
          <Pressable onPress={action.onPress}>
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ gap: spacing.sm }}>{children}</View>
    </View>
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
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 120 },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  action: { ...typography.captionStrong, color: colors.primary },
  methodRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  billRow: { flexDirection: "row", justifyContent: "space-between" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.xl, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
