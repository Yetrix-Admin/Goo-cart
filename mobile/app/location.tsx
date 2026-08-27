import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Brand } from "@/components/Brand";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { DEMO_LOCATIONS, useLocationStore } from "@/store/useLocationStore";
import { useAuthStore } from "@/store/useAuthStore";

export default function LocationScreen() {
  const [error, setError] = useState("");
  const isResolving = useLocationStore((s) => s.isResolving);
  const resolveCurrentLocation = useLocationStore((s) => s.resolveCurrentLocation);
  const chooseLocation = useLocationStore((s) => s.chooseLocation);
  const user = useAuthStore((s) => s.user);

  const proceed = () => router.replace(user ? "/(tabs)/home" : "/login");

  const onUseCurrentLocation = async () => {
    setError("");
    const ok = await resolveCurrentLocation();
    if (ok) proceed();
    else setError("Couldn't access your location. Choose a location below instead.");
  };

  return (
    <SafeAreaView style={styles.container}>
      <Brand size={32} />
      <View style={styles.hero}>
        <Text style={typography.h1}>What&apos;s your location?</Text>
        <Text style={styles.copy}>We use this to show restaurants, stores and delivery times near you.</Text>
      </View>

      <PrimaryButton label="Use current location" onPress={() => void onUseCurrentLocation()} loading={isResolving} />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.orLabel}>OR CHOOSE A LOCATION</Text>
      <View style={styles.list}>
        {DEMO_LOCATIONS.map((loc) => (
          <Pressable
            key={loc.label}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => {
              void chooseLocation(loc).then(proceed);
            }}
          >
            <View style={styles.rowIcon}>
              <Text style={styles.rowIconText}>{loc.label[0]}</Text>
            </View>
            <View>
              <Text style={typography.bodyStrong}>{loc.label}</Text>
              <Text style={typography.caption}>
                {loc.city}, {loc.region}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl, gap: spacing.lg },
  hero: { gap: spacing.xs, marginTop: spacing.xl },
  copy: { ...typography.body, color: colors.muted },
  error: { ...typography.caption, color: colors.error, textAlign: "center" },
  orLabel: { ...typography.captionStrong, textAlign: "center", marginTop: spacing.md },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowPressed: { opacity: 0.7 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconText: { color: colors.primary, fontWeight: "800" },
});
