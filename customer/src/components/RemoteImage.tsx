import { useState } from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { colors, typography } from "@/theme";

type Props = {
  uri: string | null | undefined;
  fallbackLabel: string;
  style?: ViewStyle;
  contentFit?: "cover" | "contain";
};

// Every remote image goes through here so a missing or broken URL always
// degrades to a branded initial rather than a broken-image icon.
export function RemoteImage({ uri, fallbackLabel, style, contentFit = "cover" }: Props) {
  const [failed, setFailed] = useState(false);
  const showFallback = !uri || failed;

  return (
    <View style={[styles.wrap, style]}>
      {showFallback ? (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>{fallbackLabel.slice(0, 1).toUpperCase()}</Text>
        </View>
      ) : (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={220}
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: colors.primaryMuted },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryMuted },
  fallbackText: { ...typography.display, color: colors.primary, opacity: 0.45 },
});
