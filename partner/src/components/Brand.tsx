import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

// Real artwork (see assets/images/logo-full.png), not a CSS-drawn stand-in —
// `size` is the rendered height; width follows the logo's own aspect ratio
// so it never looks stretched at any scale it's used at across the app.
const ASPECT_RATIO = 960 / 161;

export function Brand({ size = 32 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <Image
        source={require("../../assets/images/logo-full.png")}
        style={{ height: size, width: size * ASPECT_RATIO }}
        resizeMode="contain"
        accessibilityLabel="Goocart"
      />
      <Text style={[styles.suffix, { fontSize: size * 0.42 }]}>PARTNER</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  suffix: { fontWeight: "800", color: colors.muted, letterSpacing: 1 },
});
