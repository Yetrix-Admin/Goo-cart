import { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";

export function SkeletonBlock({ width, height, style }: { width: number | `${number}%`; height: number; style?: object }) {
  // useMemo (not useRef().current) keeps the Animated.Value stable without
  // reading a ref during render.
  const opacity = useMemo(() => new Animated.Value(0.4), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.border, opacity }, style]} />;
}

export function RestaurantCardSkeleton() {
  return (
    <View style={styles.card}>
      <SkeletonBlock width="100%" height={150} style={styles.top} />
      <View style={{ padding: 12, gap: 8 }}>
        <SkeletonBlock width="70%" height={14} />
        <SkeletonBlock width="50%" height={11} />
        <SkeletonBlock width="40%" height={11} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 260, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: colors.surface },
  top: { borderRadius: 0 },
});
