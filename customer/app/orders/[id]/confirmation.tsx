import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { useOrderStore } from "@/store/useOrderStore";

export default function OrderConfirmationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrderStore((s) => (id ? s.getOrder(id) : undefined));

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState icon="alert" title="Order not found" copy="We couldn't find this order." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.check}>
          <Icon name="check" size={38} color={colors.white} />
        </View>
        <Text style={typography.display}>Order Confirmed!</Text>
        <Text style={styles.orderNumber}>Order #{order.orderNumber}</Text>
        <Text style={styles.restaurant}>{order.restaurantName}</Text>
        <View style={styles.etaBox}>
          <Text style={styles.etaLabel}>ESTIMATED ARRIVAL</Text>
          <Text style={styles.etaValue}>{order.estimatedDeliveryMinutes} minutes</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="Track Order" onPress={() => router.replace({ pathname: "/orders/[id]/tracking", params: { id: order.id } })} />
        <PrimaryButton label="Back to Home" variant="outline" onPress={() => router.replace("/(tabs)/home")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl },
  check: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.success, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  checkIcon: { color: colors.white, fontSize: 36, fontWeight: "800" },
  orderNumber: { ...typography.bodyStrong, color: colors.muted, marginTop: spacing.sm },
  restaurant: { ...typography.h2 },
  etaBox: { alignItems: "center", marginTop: spacing.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.lg, paddingHorizontal: spacing.xxl },
  etaLabel: { ...typography.caption, letterSpacing: 1 },
  etaValue: { ...typography.display, marginTop: 4 },
  footer: { padding: spacing.xl, gap: spacing.sm },
});
