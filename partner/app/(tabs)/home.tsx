import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Brand } from "@/components/Brand";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useOrdersStore } from "@/store/useOrdersStore";
import { getSocket } from "@/services/socket";
import { startLocationTracking, stopLocationTracking } from "@/services/LocationTracker";
import { ApiError } from "@/services/apiClient";
import { FoodOrder } from "@/types";

const POLL_INTERVAL_MS = 6000;
const ACTIVE_STATUSES = ["DELIVERY_PARTNER_ASSIGNED", "GOING_TO_VENDOR", "ARRIVED_AT_VENDOR", "PICKED_UP", "ON_THE_WAY", "ARRIVED"];

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const { online, statusLoaded, onlineBusy, orders, loading, error, loadStatus, setOnline, refresh, transition } = useOrdersStore();
  const [accepting, setAccepting] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Polling stays on as a resilient fallback; the socket below (spec
  // section 19/26) is what makes a new offer appear without waiting for it.
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket(token);
    if (!socket) return;

    const onOffer = () => void refresh();
    const onOfferClosed = (payload: { reason?: string }) => {
      void refresh();
      if (payload?.reason === "ASSIGNED") {
        // Someone else won a job we were shown — the app just quietly drops
        // it from the pool rather than surfacing an error (spec section 29).
      }
    };
    socket.on("delivery:offer", onOffer);
    socket.on("delivery:offer_closed", onOfferClosed);
    socket.on("order:update", onOffer);

    return () => {
      socket.off("delivery:offer", onOffer);
      socket.off("delivery:offer_closed", onOfferClosed);
      socket.off("order:update", onOffer);
    };
  }, [token, refresh]);

  const activeTask = useMemo(
    () => orders.find((o) => o.deliveryPartner?.id === user?.id && ACTIVE_STATUSES.includes(o.status)),
    [orders, user],
  );
  const pool = useMemo(() => orders.filter((o) => !o.deliveryPartner && o.status === "READY_FOR_PICKUP"), [orders]);

  // GPS only streams while there is an actual job to track against (spec
  // section 32) — never in the background just for being "online".
  const trackingActiveTaskId = useRef<string | null>(null);
  useEffect(() => {
    if (activeTask) {
      if (trackingActiveTaskId.current !== activeTask.id) {
        trackingActiveTaskId.current = activeTask.id;
        void startLocationTracking().then((result) => {
          if (!result.ok) Alert.alert("Location needed", result.reason ?? "Enable location to continue this delivery.");
        });
      }
    } else if (trackingActiveTaskId.current) {
      trackingActiveTaskId.current = null;
      stopLocationTracking();
    }
    return () => {
      if (!activeTask) stopLocationTracking();
    };
  }, [activeTask]);

  const toggleOnline = async () => {
    try {
      await setOnline(!online);
    } catch {
      // Error is already surfaced via the store's `error` field.
    }
  };

  const accept = async (order: FoodOrder) => {
    setAccepting(order.id);
    try {
      await transition(order.id, "DELIVERY_PARTNER_ASSIGNED");
      router.push({ pathname: "/task/[id]", params: { id: order.id } });
    } catch (e) {
      // Spec section 28: a clear, specific message — never a generic
      // "Unknown error" / 500 — when someone else already took this job.
      if (e instanceof ApiError && e.code === "ORDER_ALREADY_ASSIGNED") {
        Alert.alert("Already accepted", "This delivery has already been accepted by another delivery partner.");
      } else if (e instanceof ApiError && e.code === "OFFER_EXPIRED") {
        Alert.alert("Offer expired", "This delivery offer is no longer available.");
      } else if (e instanceof ApiError) {
        Alert.alert("Couldn't accept", e.message);
      }
      void refresh();
    } finally {
      setAccepting(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Brand size={28} />
        <View style={styles.toggleRow}>
          <Text style={[typography.captionStrong, { color: online ? colors.success : colors.muted }]}>{online ? "Online" : "Offline"}</Text>
          <Switch
            value={online}
            onValueChange={() => void toggleOnline()}
            disabled={onlineBusy || !statusLoaded}
            trackColor={{ false: colors.border, true: colors.successMuted }}
            thumbColor={online ? colors.success : colors.surface}
          />
        </View>
      </View>

      {user?.partnerApprovalStatus === "PENDING" ? (
        <EmptyState icon="time" title="Pending approval" copy="Your account is waiting on admin approval. You'll be able to go online once approved." />
      ) : user?.partnerApprovalStatus === "REJECTED" ? (
        <EmptyState icon="alert" title="Application not approved" copy="Contact Goocart support for details." />
      ) : !online ? (
        <EmptyState icon="power" title="You're offline" copy="Go online to start receiving delivery jobs near you." />
      ) : activeTask ? (
        <View style={styles.content}>
          <Text style={typography.eyebrow}>CURRENT JOB</Text>
          <TaskCard order={activeTask} onPress={() => router.push({ pathname: "/task/[id]", params: { id: activeTask.id } })} />
        </View>
      ) : (
        <FlatList
          data={pool}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
          ListHeaderComponent={pool.length ? <Text style={typography.eyebrow}>AVAILABLE JOBS</Text> : null}
          ListEmptyComponent={
            <EmptyState icon="bike" title="No jobs right now" copy="New pickup-ready orders will show up here automatically." />
          }
          renderItem={({ item }) => <JobCard order={item} busy={accepting === item.id} onAccept={() => void accept(item)} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

function TaskCard({ order, onPress }: { order: FoodOrder; onPress: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Icon name="bag" size={20} color={colors.primary} />
        <Text style={typography.h3}>{order.restaurantName}</Text>
      </View>
      <Text style={styles.copy}>{order.restaurantArea}</Text>
      <Text style={styles.copy}>Order #{order.orderNumber} · ₹{order.bill.total}</Text>
      <PrimaryButton label="View job" onPress={onPress} />
    </View>
  );
}

function JobCard({ order, busy, onAccept }: { order: FoodOrder; busy: boolean; onAccept: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Icon name="bag" size={20} color={colors.primary} />
        <Text style={typography.h3}>{order.restaurantName}</Text>
      </View>
      <Text style={styles.copy}>{order.restaurantArea}</Text>
      <View style={styles.cardRow}>
        <Icon name="time" size={14} color={colors.muted} />
        <Text style={styles.copy}>Ready for pickup · ₹{order.bill.total}</Text>
      </View>
      <PrimaryButton label={busy ? "Accepting…" : "Accept job"} onPress={onAccept} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  content: { padding: spacing.xl, gap: spacing.sm, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  copy: { ...typography.body, color: colors.muted },
  error: { ...typography.caption, color: colors.error, textAlign: "center", paddingBottom: spacing.md },
});
