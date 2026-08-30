import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Icon } from "@/components/Icon";
import { serviceOrderService, ServiceOrder } from "@/services/ServiceOrderService";
import { colors, radius, spacing, typography } from "@/theme";

const POLL_INTERVAL_MS = 5000;

const RIDE_STEPS: readonly string[] = ["PARTNER_ASSIGNED", "ARRIVING", "IN_PROGRESS", "COMPLETED"];
const DELIVERY_STEPS: readonly string[] = ["PARTNER_ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];

const STEP_LABEL: Record<string, string> = {
  PARTNER_ASSIGNED: "Partner assigned",
  ARRIVING: "Partner arriving",
  IN_PROGRESS: "Ride in progress",
  COMPLETED: "Completed",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "On the way",
  DELIVERED: "Delivered",
};

// One tracking/detail screen for every ServiceOrder (rides, parcels, and
// grocery/mart/vegetables deliveries) — they all share the same
// partner-assignment flow server-side (see partner.ts's rideFlow/deliveryFlow),
// so a single screen covers a gap that previously left service orders as a
// flat, non-tappable summary card with no detail or live status view.
export default function ServiceOrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await serviceOrderService.activity();
      const found = rows.find((row) => row.id === id);
      if (found) {
        setOrder(found);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
    } catch {
      // Transient network error — keep showing the last known state rather
      // than flashing a "not found" screen.
    }
  }, [id]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  if (notFound && !order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Track order" onBack={() => router.back()} />
        <EmptyState icon="alert" title="Order not found" copy="This order could not be found." />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Track order" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.copy}>Loading your order…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isRide = order.service === "Bike Taxi";
  const steps = isRide ? RIDE_STEPS : DELIVERY_STEPS;
  const finalStatus = isRide ? "COMPLETED" : "DELIVERED";
  const cancelled = order.status.startsWith("CANCELLED");
  const finished = order.status === finalStatus;
  const pending = order.status === "READY_FOR_PICKUP";
  const stepIndex = steps.indexOf(order.status);
  const code = String(order.details.verificationCode ?? "");
  const pickup = String(order.details.pickup ?? "");
  const drop = String(order.details.drop ?? "");
  const distanceKm = order.details.distanceKm;
  const items = Array.isArray(order.details.items) ? (order.details.items as { name?: string; quantity?: number }[]) : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={order.reference} subtitle={order.service} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {finished ? (
          <View style={styles.doneCard}>
            <Icon name="checkCircle" size={52} color={colors.success} />
            <Text style={typography.h1}>{isRide ? "Ride completed" : "Delivered"}</Text>
            <Text style={styles.copy}>₹{order.total} • {order.reference}</Text>
            <PrimaryButton label="Back to activity" onPress={() => router.replace("/(tabs)/activity")} />
          </View>
        ) : cancelled ? (
          <View style={styles.doneCard}>
            <Icon name="close" size={48} color={colors.error} />
            <Text style={typography.h1}>Cancelled</Text>
            <PrimaryButton label="Back to activity" onPress={() => router.replace("/(tabs)/activity")} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={typography.eyebrow}>{pending ? "FINDING A PARTNER" : "STATUS"}</Text>
              <Text style={typography.h3}>{pending ? "Matching you with a nearby partner…" : STEP_LABEL[order.status] ?? order.status.replaceAll("_", " ")}</Text>
              <Text style={styles.liveTag}>● LIVE — updates automatically</Text>
            </View>

            {pickup || drop ? (
              <View style={styles.card}>
                {pickup ? <Text style={styles.copy}>From: {pickup}</Text> : null}
                {drop ? <Text style={styles.copy}>To: {drop}</Text> : null}
                {typeof distanceKm === "number" ? <Text style={styles.copy}>{distanceKm} km trip</Text> : null}
              </View>
            ) : null}

            {items.length ? (
              <View style={styles.card}>
                <Text style={typography.eyebrow}>ITEMS</Text>
                {items.map((item, index) => (
                  <Text key={`${item.name ?? "item"}-${index}`} style={styles.copy}>
                    {item.quantity ?? 1} × {item.name ?? "Item"}
                  </Text>
                ))}
              </View>
            ) : null}

            {order.partner ? (
              <View style={styles.partnerCard}>
                <View style={styles.partnerAvatar}>
                  <Text style={styles.partnerInitials}>{(order.partner.name ?? "P").slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={typography.bodyStrong}>{order.partner.name}</Text>
                  <Text style={typography.caption}>Your {isRide ? "driver" : "delivery partner"}</Text>
                </View>
              </View>
            ) : null}

            {!pending && code ? (
              <View style={styles.otpCard}>
                <Text style={styles.otpLabel}>SHOW THIS CODE TO YOUR PARTNER</Text>
                <Text style={styles.otpValue}>{code}</Text>
              </View>
            ) : null}

            <View style={styles.timelineCard}>
              {steps.map((step, index) => {
                const done = stepIndex > index;
                const active = stepIndex === index;
                return (
                  <View key={step} style={styles.timelineRow}>
                    <View style={[styles.marker, done && styles.markerDone, active && styles.markerActive]}>
                      <Text style={[styles.markerText, (done || active) && styles.markerTextActive]}>{done ? "✓" : active ? "●" : "○"}</Text>
                    </View>
                    <Text style={[typography.body, active && typography.bodyStrong, !done && !active ? { color: colors.muted } : null]}>{STEP_LABEL[step]}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.totalRow}>
              <Text style={typography.caption}>Total</Text>
              <Text style={typography.h3}>₹{order.total}</Text>
            </View>
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
  liveTag: { ...typography.caption, color: colors.success, fontWeight: "700", marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  partnerCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  partnerAvatar: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" },
  partnerInitials: { color: colors.white, fontWeight: "800" },
  otpCard: { backgroundColor: colors.primaryMuted, borderRadius: radius.md, padding: spacing.lg, alignItems: "center", gap: 4 },
  otpLabel: { ...typography.caption, color: colors.primary, fontWeight: "800", letterSpacing: 0.6, textAlign: "center" },
  otpValue: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: 8 },
  timelineCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 36 },
  marker: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  markerDone: { backgroundColor: colors.success, borderColor: colors.success },
  markerActive: { borderColor: colors.primary },
  markerText: { fontSize: 11, color: colors.muted },
  markerTextActive: { color: colors.white },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  doneCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
});
