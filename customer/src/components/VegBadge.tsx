import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";

export function VegBadge({ veg }: { veg: boolean }) {
  return (
    <View style={[styles.box, { borderColor: veg ? colors.success : colors.error }]}>
      <View style={[styles.dot, { backgroundColor: veg ? colors.success : colors.error }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
