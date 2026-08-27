import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

export function StarRating({ value, onChange, size = 32 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable key={star} onPress={() => onChange(star)} hitSlop={6}>
          <Text style={{ fontSize: size, color: star <= value ? colors.warning : colors.border }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6 },
});
