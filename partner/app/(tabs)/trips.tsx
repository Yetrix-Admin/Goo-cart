import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { apiGet } from "@/services/apiClient";

type EarningsEntry = { orderNumber: string; amount: number; at: string };
type Earnings = { totalDeliveries: number; totalEarnings: number; history: EarningsEntry[] };

// Pulls from /api/v1/partner/earnings, which already merges completed food
// deliveries and service jobs (rides, parcels, grocery/mart) into one
// history — this used to be a food-orders-only list built from the local
// orders store, which silently dropped every non-food job and never showed
// a real earnings total.
export default function TripsScreen() {
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiGet<Earnings>("/api/v1/partner/earnings");
      setData(result);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your trips");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={typography.h1}>Trips</Text>
      </View>

      {data ? (
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>TOTAL EARNINGS</Text>
            <Text style={styles.summaryValue}>₹{data.totalEarnings}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>COMPLETED</Text>
            <Text style={styles.summaryValue}>{data.totalDeliveries}</Text>
          </View>
        </View>
      ) : null}

      <FlatList
        data={data?.history ?? []}
        keyExtractor={(row, index) => `${row.orderNumber}-${index}`}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        ListEmptyComponent={!loading ? <EmptyState icon="trips" title="No completed trips yet" copy="Deliveries and rides you complete will show up here." /> : null}
        renderItem={({ item }) => <TripRow entry={item} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

function TripRow({ entry }: { entry: EarningsEntry }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.iconCircle}>
          <Icon name="checkCircle" size={18} color={colors.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={typography.h3}>{entry.orderNumber}</Text>
          <Text style={styles.copy}>{new Date(entry.at).toLocaleString()}</Text>
        </View>
        <Text style={typography.bodyStrong}>₹{entry.amount}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  summaryRow: { flexDirection: "row", gap: spacing.md, padding: spacing.xl, paddingBottom: 0 },
  summaryCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: 4 },
  summaryLabel: { ...typography.caption, color: colors.muted, letterSpacing: 0.5 },
  summaryValue: { ...typography.h2 },
  content: { padding: spacing.xl, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconCircle: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.successMuted, alignItems: "center", justifyContent: "center" },
  copy: { ...typography.caption },
  error: { ...typography.caption, color: colors.error, textAlign: "center", paddingBottom: spacing.md },
});
