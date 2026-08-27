import { useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { useOrdersStore } from "@/store/useOrdersStore";
import { useAuthStore } from "@/store/useAuthStore";
import { getSocket } from "@/services/socket";
import { FoodOrder, FoodOrderStatus, hasPermission } from "@/types";

const POLL_INTERVAL_MS = 6000;
const OPEN_STATUSES: FoodOrderStatus[] = ["PLACED", "VENDOR_ACCEPTED", "PREPARING"];

const NEXT_STEP: Partial<Record<FoodOrderStatus, { to: FoodOrderStatus; label: string; permission: "CAN_UPDATE_ORDER_STATUS" | "CAN_MARK_READY" }>> = {
  VENDOR_ACCEPTED: { to: "PREPARING", label: "Start preparing", permission: "CAN_UPDATE_ORDER_STATUS" },
  PREPARING: { to: "READY_FOR_PICKUP", label: "Ready for pickup", permission: "CAN_MARK_READY" },
};

export default function OrdersScreen() {
  const { orders, loading, error, refresh, transition } = useOrdersStore();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Realtime new-order / status-change push (spec section 19) — polling
  // above stays on as a fallback if a socket event is ever missed.
  useEffect(() => {
    const socket = getSocket(token);
    if (!socket) return;

    const onOrderEvent = () => void refresh();
    socket.on("order:new", onOrderEvent);
    socket.on("order:update", onOrderEvent);
    socket.on("order:acceptance_overdue", onOrderEvent);

    return () => {
      socket.off("order:new", onOrderEvent);
      socket.off("order:update", onOrderEvent);
      socket.off("order:acceptance_overdue", onOrderEvent);
    };
  }, [token, refresh]);

  const queue = orders.filter((o) => OPEN_STATUSES.includes(o.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const act = async (id: string, to: FoodOrderStatus) => {
    setBusyId(id);
    try {
      await transition(id, to);
    } catch {
      void refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={typography.h1}>Orders</Text>
      </View>
      <FlatList
        data={queue}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
        ListEmptyComponent={<EmptyState icon="bag" title="No open orders" copy="New orders will show up here as customers place them." />}
        renderItem={({ item }) => <OrderCard order={item} busy={busyId === item.id} user={user} onAct={(to) => void act(item.id, to)} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

function OrderCard({
  order,
  busy,
  user,
  onAct,
}: {
  order: FoodOrder;
  busy: boolean;
  user: ReturnType<typeof useAuthStore.getState>["user"];
  onAct: (to: FoodOrderStatus) => void;
}) {
  const next = NEXT_STEP[order.status];
  const canAccept = hasPermission(user, "CAN_ACCEPT_ORDER");
  const canReject = hasPermission(user, "CAN_REJECT_ORDER");
  const canAdvance = next ? hasPermission(user, next.permission) : false;

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Text style={typography.h3}>#{order.orderNumber}</Text>
        <Text style={styles.statusTag}>{order.status.replaceAll("_", " ")}</Text>
      </View>
      {order.status === "PLACED" && order.autoAccepted ? <Text style={styles.autoTag}>Automatically accepted</Text> : null}
      {order.status === "PLACED" && order.manualAcceptanceRequired ? <Text style={styles.manualTag}>Accept required</Text> : null}
      {order.items.map((item) => (
        <Text key={item.lineId} style={styles.copy}>
          {item.quantity} × {item.name}
        </Text>
      ))}
      <Text style={typography.bodyStrong}>Total: ₹{order.bill.total}</Text>

      {order.status === "PLACED" ? (
        canAccept || canReject ? (
          <View style={styles.actionRow}>
            {canAccept ? (
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Accept" onPress={() => onAct("VENDOR_ACCEPTED")} disabled={busy} />
              </View>
            ) : null}
            {canReject ? (
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Reject" variant="danger" onPress={() => onAct("VENDOR_REJECTED")} disabled={busy} />
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={styles.viewOnly}>Waiting for an authorized team member to accept</Text>
        )
      ) : next ? (
        canAdvance ? (
          <PrimaryButton label={busy ? "Please wait…" : next.label} onPress={() => onAct(next.to)} disabled={busy} />
        ) : (
          <Text style={styles.viewOnly}>You don't have permission to update this order</Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  content: { padding: spacing.xl, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusTag: { ...typography.captionStrong, color: colors.primary, textTransform: "uppercase" },
  autoTag: { ...typography.caption, color: colors.success, fontWeight: "700" },
  manualTag: { ...typography.caption, color: colors.warning, fontWeight: "700" },
  viewOnly: { ...typography.caption, color: colors.muted, fontStyle: "italic" },
  copy: { ...typography.body, color: colors.muted },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  error: { ...typography.caption, color: colors.error, textAlign: "center", paddingBottom: spacing.md },
});
