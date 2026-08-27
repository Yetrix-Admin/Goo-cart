import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { OrderStatusTimeline } from "@/components/OrderStatusTimeline";
import { colors, radius, spacing, typography } from "@/theme";
import { useOrderStore } from "@/store/useOrderStore";
import { useReorder } from "@/hooks/useReorder";
import { ORDER_STATUS_LABEL } from "@/constants/orderStatus";

export default function OrderDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrderStore((s) => (id ? s.getOrder(id) : undefined));
  const { reorder, busy: reorderBusy } = useReorder();

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Order" />
        <EmptyState icon="alert" title="Order not found" copy="This order could not be found." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={`Order #${order.orderNumber}`} subtitle={ORDER_STATUS_LABEL[order.status]} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Restaurant">
          <Text style={typography.bodyStrong}>{order.restaurantName}</Text>
          <Text style={typography.caption}>{order.restaurantArea}</Text>
        </Section>

        <Section title="Items">
          {order.items.map((item) => (
            <View key={item.lineId} style={styles.itemRow}>
              <Text style={typography.body}>
                {item.quantity} × {item.name}
                {item.selectedVariant ? ` (${item.selectedVariant.name})` : ""}
              </Text>
              <Text style={typography.body}>₹{item.lineTotal}</Text>
            </View>
          ))}
        </Section>

        <Section title="Bill Details">
          <BillRow label="Item Total" value={order.bill.itemTotal} />
          {order.bill.restaurantDiscount > 0 && <BillRow label="Restaurant Discount" value={-order.bill.restaurantDiscount} />}
          {order.bill.couponDiscount > 0 && <BillRow label="Coupon Discount" value={-order.bill.couponDiscount} />}
          <BillRow label="Delivery Fee" value={order.bill.deliveryFee} />
          <BillRow label="Platform Fee" value={order.bill.platformFee} />
          <BillRow label="Taxes" value={order.bill.taxes} />
          {order.bill.tip > 0 && <BillRow label="Tip" value={order.bill.tip} />}
          <View style={styles.divider} />
          <BillRow label="Total" value={order.bill.total} strong />
        </Section>

        <Section title="Payment">
          <Text style={typography.body}>{order.paymentMethod}</Text>
          <Text style={typography.caption}>{order.paymentStatus}</Text>
        </Section>

        <Section title="Delivery Address">
          <Text style={typography.bodyStrong}>{order.deliveryAddress.label}</Text>
          <Text style={typography.caption}>
            {order.deliveryAddress.line1}, {order.deliveryAddress.city}, {order.deliveryAddress.pincode}
          </Text>
        </Section>

        {order.deliveryPartner ? (
          <Section title="Delivery Partner">
            <Text style={typography.bodyStrong}>{order.deliveryPartner.name}</Text>
          </Section>
        ) : null}

        <Section title="Order Timeline">
          <OrderStatusTimeline status={order.status} />
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Reorder" loading={reorderBusy} onPress={() => order && void reorder(order)} />
        <PrimaryButton label="Get Help" variant="outline" onPress={() => router.push({ pathname: "/support/[orderId]", params: { orderId: order.id } })} />
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={typography.h3}>{title}</Text>
      <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>{children}</View>
    </View>
  );
}

function BillRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={strong ? typography.bodyStrong : typography.body}>{label}</Text>
      <Text style={strong ? typography.bodyStrong : typography.body}>
        {value < 0 ? "-" : ""}₹{Math.abs(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 140 },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg },
  itemRow: { flexDirection: "row", justifyContent: "space-between" },
  billRow: { flexDirection: "row", justifyContent: "space-between" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.xl, gap: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
