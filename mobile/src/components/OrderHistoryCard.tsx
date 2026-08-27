import { Pressable, StyleSheet, Text, View } from "react-native";
import { FoodOrder } from "@/types";
import { colors, radius, spacing, typography } from "@/theme";
import { ORDER_STATUS_LABEL } from "@/constants/orderStatus";

export function OrderHistoryCard({ order, onView, onReorder }: { order: FoodOrder; onView: () => void; onReorder: () => void }) {
  const date = new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <Pressable style={styles.card} onPress={onView}>
      <View style={styles.headerRow}>
        <Text style={typography.bodyStrong}>{order.restaurantName}</Text>
        <StatusPill status={order.status} />
      </View>
      <Text style={typography.caption}>
        {order.items.reduce((s, i) => s + i.quantity, 0)} items · ₹{order.bill.total}
      </Text>
      <Text style={typography.caption}>{date}</Text>
      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={onView}>
          <Text style={styles.actionText}>View Order</Text>
        </Pressable>
        {order.status === "DELIVERED" ? (
          <Pressable style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={onReorder}>
            <Text style={[styles.actionText, styles.actionTextPrimary]}>Reorder</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatusPill({ status }: { status: FoodOrder["status"] }) {
  const isDelivered = status === "DELIVERED";
  return (
    <View style={[styles.pill, isDelivered ? styles.pillDone : styles.pillActive]}>
      <Text style={[styles.pillText, isDelivered ? styles.pillTextDone : styles.pillTextActive]}>{ORDER_STATUS_LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillDone: { backgroundColor: colors.successMuted },
  pillActive: { backgroundColor: colors.warningMuted },
  pillText: { fontSize: 10, fontWeight: "700" },
  pillTextDone: { color: colors.success },
  pillTextActive: { color: colors.warning },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  actionBtnPrimary: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  actionText: { ...typography.captionStrong },
  actionTextPrimary: { color: colors.primary },
});
