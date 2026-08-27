import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { useOrdersStore } from "@/store/useOrdersStore";
import { FoodOrderStatus } from "@/types";

const POLL_INTERVAL_MS = 5000;

// What this partner can do at each stage, and what the next stage is called.
const NEXT_STEP: Partial<Record<FoodOrderStatus, { to: FoodOrderStatus; label: string }>> = {
  DELIVERY_PARTNER_ASSIGNED: { to: "PICKED_UP", label: "Mark picked up" },
  PICKED_UP: { to: "ON_THE_WAY", label: "Start delivery" },
  ON_THE_WAY: { to: "ARRIVED", label: "I've arrived" },
};

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrdersStore((s) => (id ? s.getOrder(id) : undefined));
  const fetchOrder = useOrdersStore((s) => s.fetchOrder);
  const transition = useOrdersStore((s) => s.transition);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Status advances because this partner (or an admin) actually acted on the
  // order server-side — the app polls rather than assuming its own action
  // succeeded everywhere at once.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const tick = async () => {
      const result = await fetchOrder(id);
      if (!cancelled && result === null) setNotFound(true);
    };
    void tick();
    const interval = setInterval(() => {
      if (!cancelled) void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, fetchOrder]);

  const advance = async (to: FoodOrderStatus) => {
    if (!id) return;
    setError("");
    setBusy(true);
    try {
      await transition(id, to);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update this job");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!id) return;
    if (code.trim().length !== 4) {
      setError("Enter the 4-digit code the customer gives you.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await transition(id, "DELIVERED", code.trim());
      router.replace("/(tabs)/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't match. Ask the customer to check it.");
    } finally {
      setBusy(false);
    }
  };

  if (notFound && !order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Job" onBack={() => router.replace("/(tabs)/home")} />
        <EmptyState icon="alert" title="This job is no longer available" copy="It may have been cancelled or claimed by someone else." />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Job" onBack={() => router.replace("/(tabs)/home")} />
        <View style={styles.center}>
          <Text style={styles.copy}>Loading job…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const address = order.deliveryAddress;
  const next = NEXT_STEP[order.status];
  const awaitingOtp = order.status === "ARRIVED";
  const delivered = order.status === "DELIVERED";
  const lost = !next && !awaitingOtp && !delivered;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={order.restaurantName} subtitle={`Order #${order.orderNumber}`} onBack={() => router.replace("/(tabs)/home")} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {delivered ? (
          <View style={styles.doneCard}>
            <Icon name="checkCircle" size={52} color={colors.success} />
            <Text style={typography.h1}>Delivered</Text>
            <Text style={styles.copy}>Nice work — this job is complete.</Text>
            <PrimaryButton label="Back to Home" onPress={() => router.replace("/(tabs)/home")} />
          </View>
        ) : lost ? (
          <EmptyState icon="alert" title="This job is no longer yours" copy="It was reassigned or cancelled." />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={typography.eyebrow}>PICKUP</Text>
              <Text style={typography.h3}>{order.restaurantName}</Text>
              <Text style={styles.copy}>{order.restaurantArea}</Text>
            </View>

            <View style={styles.card}>
              <Text style={typography.eyebrow}>DROP-OFF</Text>
              <Text style={typography.h3}>{address.contactName}</Text>
              <Text style={styles.copy}>
                {[address.line1, address.building, address.street, address.landmark].filter(Boolean).join(", ")}
              </Text>
              <Text style={styles.copy}>{[address.city, address.state, address.pincode].filter(Boolean).join(", ")}</Text>
              {address.contactPhone ? (
                <View style={styles.callRow}>
                  <Icon name="call" size={14} color={colors.primary} />
                  <Text style={styles.callText} onPress={() => void Linking.openURL(`tel:${address.contactPhone}`)}>
                    {address.contactPhone}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={typography.eyebrow}>ORDER</Text>
              {order.items.map((item) => (
                <Text key={item.lineId} style={styles.copy}>
                  {item.quantity} × {item.name}
                </Text>
              ))}
              <Text style={typography.bodyStrong}>Total: ₹{order.bill.total}</Text>
              <Text style={styles.copy}>{order.paymentMethod === "COD" ? "Collect cash on delivery" : "Already paid online"}</Text>
            </View>

            {awaitingOtp ? (
              <View style={styles.card}>
                <Text style={typography.eyebrow}>VERIFY DELIVERY</Text>
                <Text style={styles.copy}>Ask the customer for their 4-digit code to complete this delivery.</Text>
                <TextInput
                  style={styles.otpInput}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="0000"
                  placeholderTextColor={colors.muted}
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <PrimaryButton label={busy ? "Please wait…" : "Complete delivery"} onPress={() => void complete()} disabled={busy} />
              </View>
            ) : next ? (
              <>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <PrimaryButton label={busy ? "Please wait…" : next.label} onPress={() => void advance(next.to)} disabled={busy} />
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  copy: { ...typography.body, color: colors.muted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: 6 },
  callRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  callText: { ...typography.bodyStrong, color: colors.primary },
  otpInput: {
    height: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 8,
    color: colors.text,
    textAlign: "center",
  },
  error: { ...typography.caption, color: colors.error },
  doneCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
});
