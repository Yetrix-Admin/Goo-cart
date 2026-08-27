import { useEffect, useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Brand } from "@/components/Brand";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useOrdersStore } from "@/store/useOrdersStore";
import { FoodOrder } from "@/types";

const POLL_INTERVAL_MS = 6000;
const ACTIVE_STATUSES = ["DELIVERY_PARTNER_ASSIGNED", "PICKED_UP", "ON_THE_WAY", "ARRIVED"];

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const { online, statusLoaded, onlineBusy, orders, loading, error, loadStatus, setOnline, refresh, transition } = useOrdersStore();

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // A partner acting on their phone needs to see a new job appear without
  // pulling to refresh — this mirrors the polling pattern the customer app
  // uses for live order tracking.
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const activeTask = useMemo(
    () => orders.find((o) => o.deliveryPartner?.id === user?.id && ACTIVE_STATUSES.includes(o.status)),
    [orders, user],
  );
  const pool = useMemo(() => orders.filter((o) => !o.deliveryPartner && o.status === "READY_FOR_PICKUP"), [orders]);

  const toggleOnline = async () => {
    try {
      await setOnline(!online);
    } catch {
      // Error is already surfaced via the store's `error` field.
    }
  };

  const accept = async (order: FoodOrder) => {
    try {
      await transition(order.id, "DELIVERY_PARTNER_ASSIGNED");
      router.push({ pathname: "/task/[id]", params: { id: order.id } });
    } catch {
      void refresh();
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

      {!online ? (
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
          renderItem={({ item }) => <JobCard order={item} onAccept={() => void accept(item)} />}
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

function JobCard({ order, onAccept }: { order: FoodOrder; onAccept: () => void }) {
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
      <PrimaryButton label="Accept job" onPress={onAccept} />
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
