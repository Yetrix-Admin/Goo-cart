import { StyleSheet, Text, View } from "react-native";
import { spacing, typography } from "@/theme";

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={typography.h2}>{title}</Text>
      {subtitle ? <Text style={typography.caption}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginBottom: spacing.md },
});
