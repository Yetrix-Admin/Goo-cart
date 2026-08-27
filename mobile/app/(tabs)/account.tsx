import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocationStore } from "@/store/useLocationStore";
import { useCartStore } from "@/store/useCartStore";

type Row = { label: string; onPress: () => void };

export default function AccountScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocationStore((s) => s.selected);
  const clearCart = useCartStore((s) => s.clear);

  const notAvailableYet = (label: string) => Alert.alert(label, `${label} is coming in a later build phase.`);

  const rows: Row[] = [
    { label: "My Orders", onPress: () => router.push("/(tabs)/activity") },
    { label: "My Rides", onPress: () => notAvailableYet("My Rides") },
    { label: "My Parcels", onPress: () => notAvailableYet("My Parcels") },
    { label: "Saved Addresses", onPress: () => router.push("/checkout/address") },
    { label: "Favorites", onPress: () => router.push("/favorites") },
    { label: "Payments", onPress: () => notAvailableYet("Payments") },
    { label: "Goocart Wallet", onPress: () => notAvailableYet("Goocart Wallet") },
    { label: "Offers", onPress: () => notAvailableYet("Offers") },
    { label: "Notifications", onPress: () => notAvailableYet("Notifications") },
    { label: "Help & Support", onPress: () => notAvailableYet("Help & Support") },
  ];

  const confirmLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out of Goocart?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => {
          clearCart();
          void logout().then(() => router.replace("/login"));
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name ?? "G").slice(0, 2).toUpperCase()}</Text>
          </View>
          <Text style={typography.h1}>{user?.name ?? "Goocart Customer"}</Text>
          <Text style={styles.copy}>{user ? (user.isDemo ? "Demo account" : `+91 ${user.phone}`) : " "}</Text>
          {location ? (
            <Pressable onPress={() => router.push("/location")}>
              <Text style={styles.changeLocation}>
                {location.label} · {location.city} — Change
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.list}>
          {rows.map((row) => (
            <Pressable key={row.label} style={styles.row} onPress={row.onPress}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowChevron}>›</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.logout} onPress={confirmLogout}>
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, gap: spacing.xl },
  hero: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.dark,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  avatarText: { color: colors.white, fontWeight: "800", fontSize: 20 },
  copy: { ...typography.body, color: colors.muted },
  changeLocation: { ...typography.captionStrong, color: colors.primary, marginTop: spacing.xs },
  list: { gap: 2, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { ...typography.body },
  rowChevron: { color: colors.muted, fontSize: 16 },
  logout: {
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.errorMuted,
    backgroundColor: colors.errorMuted,
  },
  logoutText: { color: colors.error, fontWeight: "700" },
});
