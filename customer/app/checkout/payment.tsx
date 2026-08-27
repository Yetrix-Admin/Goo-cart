import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { useCartBill, useCartStore } from "@/store/useCartStore";
import { useSelectedAddress } from "@/store/useAddressStore";
import { useOrderStore } from "@/store/useOrderStore";
import { PaymentMethod, Restaurant } from "@/types";
import { restaurantService } from "@/services/RestaurantService";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  UPI: "UPI",
  GPAY: "Google Pay",
  PHONEPE: "PhonePe",
  PAYTM: "Paytm",
  CARD: "Cards",
  NETBANKING: "Net Banking",
  WALLET: "Wallet",
  COD: "Cash on Delivery",
};

type Stage = "idle" | "processing" | "failed" | "creating" | "create_failed";

export default function PaymentScreen() {
  const { method } = useLocalSearchParams<{ method: PaymentMethod }>();
  const [stage, setStage] = useState<Stage>("idle");

  const restaurantId = useCartStore((s) => s.restaurantId);
  const items = useCartStore((s) => s.items);
  const couponCode = useCartStore((s) => s.couponCode);
  const instructions = useCartStore((s) => s.instructions);
  const bill = useCartBill();
  const clearCart = useCartStore((s) => s.clear);

  const address = useSelectedAddress();
  const createOrder = useOrderStore((s) => s.createOrder);
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

  const placeOrder = async () => {
    if (!restaurantId || !restaurant || !address || items.length === 0) {
      setStage("create_failed");
      return;
    }
    setStage("creating");
    try {
      const order = await createOrder({
        restaurantId: restaurant.id,
        items,
        deliveryAddress: address as unknown as Record<string, unknown>,
        instructions,
        couponCode: couponCode ?? undefined,
        tip: bill.tip,
        paymentMethod: method,
      });
      clearCart();
      router.replace({ pathname: "/orders/[id]/confirmation", params: { id: order.id } });
    } catch {
      setStage("create_failed");
    }
  };

  const simulateSuccess = () => void placeOrder();
  const simulateFailure = () => setStage("failed");

  if (stage === "creating") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Payment" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.processingText}>Placing your order…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (stage === "create_failed") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Payment" />
        <EmptyState icon="alert" title="Order creation failed" copy="We couldn't place your order. Your payment method was not charged." />
        <View style={styles.footer}>
          <PrimaryButton label="Try Again" onPress={() => setStage("idle")} />
        </View>
      </SafeAreaView>
    );
  }

  if (stage === "failed") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Payment" />
        <View style={styles.center}>
          <Icon name="close" size={46} color={colors.error} />
          <Text style={typography.h1}>Payment Failed</Text>
          <Text style={styles.copy}>No money was charged.</Text>
        </View>
        <View style={[styles.footer, { gap: spacing.sm }]}>
          <PrimaryButton label="Try Again" onPress={() => setStage("idle")} />
          <PrimaryButton label="Choose Another Method" variant="outline" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Payment" subtitle={METHOD_LABEL[method] ?? method} />
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={typography.h3}>Paying via {METHOD_LABEL[method] ?? method}</Text>
          <Text style={styles.copy}>Amount to pay: ₹{bill.total}</Text>
        </View>

        {method === "COD" ? (
          <Text style={styles.copy}>Pay in cash when your order is delivered. No online payment is required.</Text>
        ) : (
          <View style={styles.demoBox}>
            <Text style={styles.demoLabel}>DEMO PAYMENT</Text>
            <Text style={styles.copy}>This is a prototype — no real payment gateway is connected yet. Use the buttons below to simulate an outcome.</Text>
          </View>
        )}
      </View>

      <View style={[styles.footer, { gap: spacing.sm }]}>
        {method === "COD" ? (
          <PrimaryButton label={`Place Order • ₹${bill.total}`} onPress={simulateSuccess} />
        ) : (
          <>
            <PrimaryButton label="Simulate Payment Success" onPress={simulateSuccess} />
            <PrimaryButton label="Simulate Payment Failure" variant="outline" onPress={simulateFailure} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  copy: { ...typography.body, color: colors.muted },
  demoBox: { backgroundColor: colors.warningMuted, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  demoLabel: { ...typography.captionStrong, color: colors.warning, letterSpacing: 1 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.xl, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl },
  processingText: { ...typography.body, color: colors.muted },
  failIcon: { fontSize: 48, color: colors.error, fontWeight: "800" },
});
