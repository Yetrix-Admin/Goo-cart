import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";

export function Brand({ size = 32 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.32 }]}>
        <Text style={[styles.markText, { fontSize: size * 0.6 }]}>g</Text>
      </View>
      <Text style={[styles.name, { fontSize: size * 0.62 }]}>goocart partner</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mark: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderBottomLeftRadius: 4 },
  markText: { color: colors.white, fontWeight: "900" },
  name: { fontWeight: "900", color: colors.dark, letterSpacing: -0.5 },
});
