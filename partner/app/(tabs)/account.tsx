import { useCallback, useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useOrdersStore } from "@/store/useOrdersStore";
import { apiGet } from "@/services/apiClient";

type PartnerProfile = {
  name: string;
  email: string;
  phone: string | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  photoUrl: string | null;
  partnerRating: number;
  partnerCompletedDeliveries: number;
};

export default function AccountScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const clearOrders = useOrdersStore((s) => s.clear);
  const [profile, setProfile] = useState<PartnerProfile | null>(null);

  // The account header used to show only the name/email already held in
  // memory from login — never the photo, vehicle, rating or delivery count
  // an admin sets up for this partner, even though /profile already
  // returns all of it.
  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ partner: PartnerProfile }>("/api/v1/partner/profile");
      setProfile(data.partner);
    } catch {
      // Falls back to the login-time user object below.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    await logout();
    clearOrders();
    router.replace("/login");
  };

  const name = profile?.name ?? user?.name ?? "";
  const email = profile?.email ?? user?.email ?? "";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={typography.h1}>Account</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.card}>
          {profile?.photoUrl ? (
            <Image source={{ uri: profile.photoUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{name.slice(0, 2).toUpperCase() || "P"}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={typography.h3}>{name}</Text>
            <Text style={styles.copy}>{email}</Text>
            {profile?.phone ? <Text style={styles.copy}>{profile.phone}</Text> : null}
          </View>
        </View>

        {profile ? (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Icon name="checkCircle" size={18} color={colors.success} />
              <Text style={styles.statValue}>{profile.partnerCompletedDeliveries}</Text>
              <Text style={styles.statLabel}>COMPLETED</Text>
            </View>
            <View style={styles.statCard}>
              <Icon name="checkCircle" size={18} color={colors.warning} />
              <Text style={styles.statValue}>{profile.partnerRating.toFixed(1)}</Text>
              <Text style={styles.statLabel}>RATING</Text>
            </View>
          </View>
        ) : null}

        {profile?.vehicleType ? (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={typography.captionStrong}>Vehicle</Text>
              <Text style={styles.copy}>
                {profile.vehicleType}
                {profile.vehicleNumber ? ` • ${profile.vehicleNumber}` : ""}
              </Text>
            </View>
          </View>
        ) : null}

        <PrimaryButton label="Sign out" variant="outline" onPress={() => void signOut()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  content: { padding: spacing.xl, gap: spacing.lg },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  avatar: { width: 52, height: 52, borderRadius: radius.lg, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 52, height: 52, borderRadius: radius.lg },
  avatarText: { color: colors.white, fontWeight: "800", fontSize: 16 },
  copy: { ...typography.caption },
  statsRow: { flexDirection: "row", gap: spacing.md },
  statCard: { flex: 1, alignItems: "center", gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  statValue: { ...typography.h2 },
  statLabel: { ...typography.caption, color: colors.muted, letterSpacing: 0.5 },
});
