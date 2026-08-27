import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@/theme";
import { RemoteImage } from "@/components/RemoteImage";

export function CategoryChip({
  name,
  imageUrl,
  active,
  onPress,
}: {
  name: string;
  imageUrl?: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name} style={styles.wrap}>
      <View style={[styles.imageRing, active && styles.imageRingActive]}>
        <RemoteImage uri={imageUrl} fallbackLabel={name} style={styles.image} />
      </View>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.sm, width: 76 },
  imageRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    padding: 3,
    borderWidth: 2,
    borderColor: "transparent",
  },
  imageRingActive: { borderColor: colors.primary },
  image: { width: "100%", height: "100%", borderRadius: 30 },
  label: { ...typography.captionStrong, color: colors.text, fontSize: 11 },
  labelActive: { color: colors.primary },
});
