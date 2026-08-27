import { useEffect, useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useOrdersStore } from "@/store/useOrdersStore";
import { FoodOrder } from "@/types";

export default function TripsScreen() {
  const user = useAuthStore((s) => s.user);
  const { orders, loading, refresh } = useOrdersStore();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const trips = useMemo(
    () =>
      orders
        .filter((o) => o.deliveryPartner?.id === user?.id && o.status === "DELIVERED")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [orders, user],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={typography.h1}>Trips</Text>
      </View>
      <FlatList
        data={trips}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
        ListEmptyComponent={<EmptyState icon="trips" title="No completed trips yet" copy="Deliveries you complete will show up here." />}
        renderItem={({ item }) => <TripRow order={item} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
    </SafeAreaView>
  );
}

function TripRow({ order }: { order: FoodOrder }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.iconCircle}>
          <Icon name="checkCircle" size={18} color={colors.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={typography.h3}>{order.restaurantName}</Text>
          <Text style={styles.copy}>Order #{order.orderNumber}</Text>
        </View>
        <Text style={typography.bodyStrong}>₹{order.bill.total}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  content: { padding: spacing.xl, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconCircle: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.successMuted, alignItems: "center", justifyContent: "center" },
  copy: { ...typography.caption },
});
