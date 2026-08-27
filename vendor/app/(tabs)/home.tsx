import { useEffect, useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { useVendorStore } from "@/store/useVendorStore";
import { useOrdersStore } from "@/store/useOrdersStore";

const ACTIVE_STATUSES = ["PLACED", "VENDOR_ACCEPTED", "PREPARING"];

export default function HomeScreen() {
  const { restaurant, restaurantLoaded, error, loadRestaurant, setOpen } = useVendorStore();
  const { orders, loading, refresh } = useOrdersStore();

  useEffect(() => {
    void loadRestaurant();
  }, [loadRestaurant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingCount = useMemo(() => orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length, [orders]);

  const toggleOpen = async () => {
    if (!restaurant) return;
    try {
      await setOpen(!restaurant.isOpen);
    } catch {
      // Store already surfaces the error via its `error` field.
    }
  };

  if (!restaurantLoaded) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.copy}>Loading your restaurant…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!restaurant) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Brand size={28} />
        </View>
        <EmptyState
          icon="storefront"
          title="Waiting on setup"
          copy="An admin needs to link your account to a restaurant before you can manage it here. Check back soon."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
      >
        <View style={styles.header}>
          <Brand size={28} />
        </View>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={{ flex: 1 }}>
              <Text style={typography.h2}>{restaurant.name}</Text>
              <Text style={styles.copy}>{restaurant.area}</Text>
            </View>
            <Switch
              value={restaurant.isOpen}
              onValueChange={() => void toggleOpen()}
              trackColor={{ false: colors.border, true: colors.successMuted }}
              thumbColor={restaurant.isOpen ? colors.success : colors.surface}
            />
          </View>
          <Text style={[typography.captionStrong, { color: restaurant.isOpen ? colors.success : colors.muted }]}>
            {restaurant.isOpen ? "Open — accepting orders" : "Closed — not accepting orders"}
          </Text>
        </View>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Icon name="bag" size={20} color={colors.primary} />
            <Text style={typography.h1}>{pendingCount}</Text>
            <Text style={styles.copy}>Active orders</Text>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  content: { padding: spacing.xl, paddingTop: 0, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  statRow: { flexDirection: "row", gap: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: 4, alignItems: "flex-start" },
  copy: { ...typography.body, color: colors.muted },
  error: { ...typography.caption, color: colors.error, textAlign: "center" },
});
