import { useEffect, useMemo, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { Brand } from "@/components/Brand";
import { colors, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocationStore } from "@/store/useLocationStore";

const MIN_SPLASH_MS = 1100;

export default function Splash() {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const opacity = useMemo(() => new Animated.Value(0), []);

  const authHydrated = useAuthStore((s) => s.hasHydrated);
  const locationHydrated = useLocationStore((s) => s.hasHydrated);
  const selectedLocation = useLocationStore((s) => s.selected);

  useEffect(() => {
    // Hydration itself is kicked off once from the root layout so it covers
    // every entry route, not just this splash screen.
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    const timer = setTimeout(() => setMinTimeElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, [opacity]);

  const ready = authHydrated && locationHydrated && minTimeElapsed;

  if (ready) {
    if (!selectedLocation) return <Redirect href="/location" />;
    // Guests browse freely — sign-in is only required later, at checkout,
    // when there is an actual order to place. `user` being null here just
    // means "browsing as guest", not "blocked".
    return <Redirect href="/(tabs)/home" />;
  }

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity, alignItems: "center", gap: spacing.lg }}>
        <Brand size={48} />
        <Text style={styles.tagline}>Everything around you.{"\n"}One Go.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  tagline: { ...typography.body, color: colors.muted, textAlign: "center", marginTop: spacing.sm },
});
