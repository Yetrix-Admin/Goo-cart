import { useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { useOrdersStore } from "@/store/useOrdersStore";
import { FoodOrder, FoodOrderStatus } from "@/types";

const POLL_INTERVAL_MS = 6000;
const OPEN_STATUSES: FoodOrderStatus[] = ["PLACED", "VENDOR_ACCEPTED", "PREPARING"];

const NEXT_STEP: Partial<Record<FoodOrderStatus, { to: FoodOrderStatus; label: string }>> = {
  VENDOR_ACCEPTED: { to: "PREPARING", label: "Start preparing" },
  PREPARING: { to: "READY_FOR_PICKUP", label: "Ready for pickup" },
};

export default function OrdersScreen() {
  const { orders, loading, error, refresh, transition } = useOrdersStore();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

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
        renderItem={({ item }) => <OrderCard order={item} busy={busyId === item.id} onAct={(to) => void act(item.id, to)} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

function OrderCard({ order, busy, onAct }: { order: FoodOrder; busy: boolean; onAct: (to: FoodOrderStatus) => void }) {
  const next = NEXT_STEP[order.status];
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Text style={typography.h3}>#{order.orderNumber}</Text>
        <Text style={styles.statusTag}>{order.status.replaceAll("_", " ")}</Text>
      </View>
      {order.items.map((item) => (
        <Text key={item.lineId} style={styles.copy}>
          {item.quantity} × {item.name}
        </Text>
      ))}
      <Text style={typography.bodyStrong}>Total: ₹{order.bill.total}</Text>

      {order.status === "PLACED" ? (
        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Accept" onPress={() => onAct("VENDOR_ACCEPTED")} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Reject" variant="danger" onPress={() => onAct("VENDOR_REJECTED")} disabled={busy} />
          </View>
        </View>
      ) : next ? (
        <PrimaryButton label={busy ? "Please wait…" : next.label} onPress={() => onAct(next.to)} disabled={busy} />
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
  copy: { ...typography.body, color: colors.muted },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  error: { ...typography.caption, color: colors.error, textAlign: "center", paddingBottom: spacing.md },
});
