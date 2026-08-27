import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { OrderStatusTimeline } from "@/components/OrderStatusTimeline";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { TrackingMap } from "@/components/TrackingMap";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { useOrderStore } from "@/store/useOrderStore";
import { useAuthStore } from "@/store/useAuthStore";
import { getSocket } from "@/services/socket";
import { ORDER_STATUS_LABEL } from "@/constants/orderStatus";

const POLL_INTERVAL_MS = 5000;
// A customer may cancel any time before the kitchen starts preparing (spec
// section 44) — matched against the same status set the backend enforces in
// server/src/lib/orderState.ts's "customer" transition group.
const CUSTOMER_CANCELLABLE_STATUSES = ["PLACED", "VENDOR_ACCEPTED"];

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrderStore((s) => (id ? s.getOrder(id) : undefined));
  const fetchOrder = useOrderStore((s) => s.fetchOrder);
  const cancelOrder = useOrderStore((s) => s.cancelOrder);
  const token = useAuthStore((s) => s.token);
  const [notFound, setNotFound] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // The only source of the rider marker: a real GPS fix relayed from the
  // delivery partner's device over the realtime channel. Nothing here
  // simulates or interpolates movement — if no fix has arrived yet, there is
  // simply no marker (see TrackingMap's "waiting for live location" state).
  const [riderPosition, setRiderPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Status advances because a vendor or delivery partner actually acted on
  // the order server-side. The realtime socket below delivers this near-
  // instantly; polling stays on as a resilient fallback if a push is missed
  // (a dropped connection, a backgrounded app waking back up, etc).
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

  useEffect(() => {
    if (!id || !token) return;
    const socket = getSocket(token);
    if (!socket) return;

    socket.emit("subscribe:order", id);

    const onUpdate = (payload: { orderId: string }) => {
      if (payload.orderId === id) void fetchOrder(id);
    };
    const onLocation = (payload: { orderId: string; latitude: number; longitude: number }) => {
      if (payload.orderId === id) setRiderPosition({ latitude: payload.latitude, longitude: payload.longitude });
    };

    socket.on("order:update", onUpdate);
    socket.on("order:location", onLocation);

    return () => {
      socket.emit("unsubscribe:order", id);
      socket.off("order:update", onUpdate);
      socket.off("order:location", onLocation);
    };
  }, [id, token, fetchOrder]);

  // A newly-assigned partner (or a screen re-entered mid-delivery) has no
  // live fix yet until their next GPS beat — reset so a stale rider from a
  // previous order/partner never lingers on screen.
  useEffect(() => {
    setRiderPosition(null);
  }, [order?.deliveryPartner?.id]);

  const confirmCancel = () => {
    if (!id) return;
    Alert.alert("Cancel order?", "This cannot be undone.", [
      { text: "Keep order", style: "cancel" },
      {
        text: "Cancel order",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          try {
            await cancelOrder(id);
          } catch (e) {
            Alert.alert("Couldn't cancel", e instanceof Error ? e.message : "Please try again.");
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  if (notFound && !order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Track Order" />
        <EmptyState icon="alert" title="Tracking data unavailable" copy="We couldn't find this order to track." />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Track Order" />
        <View style={styles.center}>
          <Text style={styles.copy}>Loading your order…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const cancelled = order.status.startsWith("CANCELLED") || order.status === "VENDOR_REJECTED";
  const showMap = ["DELIVERY_PARTNER_ASSIGNED", "PICKED_UP", "ON_THE_WAY", "ARRIVED"].includes(order.status);
  const showOtp = showMap && order.deliveryOtp;
  const minutesElapsed = Math.floor((now - new Date(order.createdAt).getTime()) / 60000);
  const etaRemaining = Math.max(1, order.estimatedDeliveryMinutes - minutesElapsed);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={ORDER_STATUS_LABEL[order.status] ?? order.status.replaceAll("_", " ")} subtitle={`Order #${order.orderNumber}`} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {order.status === "DELIVERED" ? (
          <View style={styles.deliveredCard}>
            <Icon name="checkCircle" size={52} color={colors.success} />
            <Text style={typography.h1}>Delivered successfully</Text>
            <Text style={styles.copy}>Enjoy your meal!</Text>
            <View style={styles.deliveredActions}>
              <PrimaryButton label="Rate Order" onPress={() => router.push({ pathname: "/rating/[orderId]", params: { orderId: order.id } })} />
              <PrimaryButton label="View Order" variant="outline" onPress={() => router.push({ pathname: "/orders/[id]", params: { id: order.id } })} />
              <PrimaryButton label="Get Help" variant="outline" onPress={() => router.push({ pathname: "/support/[orderId]", params: { orderId: order.id } })} />
            </View>
          </View>
        ) : cancelled ? (
          <View style={styles.deliveredCard}>
            <Icon name="close" size={48} color={colors.error} />
            <Text style={typography.h1}>Order cancelled</Text>
            <Text style={styles.copy}>
              {order.status === "VENDOR_REJECTED" ? `${order.restaurantName} could not accept this order.` : "This order was cancelled."}
            </Text>
            <View style={styles.deliveredActions}>
              <PrimaryButton label="Back to Home" onPress={() => router.replace("/(tabs)/home")} />
              <PrimaryButton label="Get Help" variant="outline" onPress={() => router.push({ pathname: "/support/[orderId]", params: { orderId: order.id } })} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.restaurantCard}>
              <Text style={typography.h3}>{order.restaurantName}</Text>
              <Text style={styles.copy}>Arriving in about {etaRemaining} min</Text>
              <Text style={styles.liveTag}>● LIVE — updates automatically</Text>
            </View>

            {showMap && (
              <TrackingMap
                restaurant={{ latitude: order.restaurantLatitude, longitude: order.restaurantLongitude, name: order.restaurantName }}
                destination={{
                  latitude: order.deliveryAddress?.latitude ?? order.restaurantLatitude,
                  longitude: order.deliveryAddress?.longitude ?? order.restaurantLongitude,
                }}
                rider={riderPosition ? { ...riderPosition, name: order.deliveryPartner?.name ?? "Rider" } : null}
              />
            )}

            {order.deliveryPartner ? (
              <View style={styles.partnerCard}>
                <View style={styles.partnerAvatar}>
                  <Text style={styles.partnerInitials}>{(order.deliveryPartner.name ?? "R").slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={typography.bodyStrong}>{order.deliveryPartner.name}</Text>
                  <Text style={typography.caption}>Your delivery partner</Text>
                </View>
              </View>
            ) : null}

            {showOtp && (
              <View style={styles.otpCard}>
                <Text style={styles.otpLabel}>SHOW THIS CODE TO YOUR DELIVERY PARTNER</Text>
                <Text style={styles.otpValue}>{order.deliveryOtp}</Text>
              </View>
            )}

            <View style={styles.timelineCard}>
              <OrderStatusTimeline status={order.status} />
            </View>

            {CUSTOMER_CANCELLABLE_STATUSES.includes(order.status) ? (
              <PrimaryButton label={cancelling ? "Cancelling…" : "Cancel Order"} variant="outline" onPress={confirmCancel} disabled={cancelling} />
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
  liveTag: { ...typography.caption, color: colors.success, fontWeight: "700", marginTop: spacing.xs },
  restaurantCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  partnerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  partnerAvatar: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" },
  partnerInitials: { color: colors.white, fontWeight: "800" },
  otpCard: { backgroundColor: colors.primaryMuted, borderRadius: radius.md, padding: spacing.lg, alignItems: "center", gap: 4 },
  otpLabel: { ...typography.caption, color: colors.primary, fontWeight: "800", letterSpacing: 0.6, textAlign: "center" },
  otpValue: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: 8 },
  timelineCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg },
  deliveredCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  deliveredIcon: { fontSize: 44, color: colors.success, fontWeight: "800" },
  cancelledIcon: { fontSize: 44, color: colors.error, fontWeight: "800" },
  deliveredActions: { width: "100%", gap: spacing.sm, marginTop: spacing.lg },
});
