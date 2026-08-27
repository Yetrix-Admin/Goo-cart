import { StyleSheet, Text, View } from "react-native";
import { FoodOrderStatus, ORDER_STATUSES } from "@/types";
import { ORDER_STATUS_LABEL, statusIndex } from "@/constants/orderStatus";
import { colors, spacing, typography } from "@/theme";

export function OrderStatusTimeline({ status }: { status: FoodOrderStatus }) {
  const currentIndex = statusIndex(status);
  return (
    <View>
      {ORDER_STATUSES.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const isLast = index === ORDER_STATUSES.length - 1;
        return (
          <View key={step} style={styles.row}>
            <View style={styles.markerCol}>
              <View style={[styles.marker, done && styles.markerDone, active && styles.markerActive]}>
                <Text style={[styles.markerText, done && styles.markerTextActive, active && styles.markerTextOnLight]}>{done ? "✓" : active ? "●" : "○"}</Text>
              </View>
              {!isLast ? <View style={[styles.line, done && styles.lineDone]} /> : null}
            </View>
            <Text style={[typography.body, active && typography.bodyStrong, !done && !active && { color: colors.muted }]}>{ORDER_STATUS_LABEL[step]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, minHeight: 44 },
  markerCol: { alignItems: "center", width: 24 },
  marker: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  markerDone: { backgroundColor: colors.success, borderColor: colors.success },
  markerActive: { borderColor: colors.primary },
  markerText: { fontSize: 11, color: colors.muted },
  markerTextActive: { color: colors.white },
  markerTextOnLight: { color: colors.primary },
  line: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  lineDone: { backgroundColor: colors.success },
});
