import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SearchBar } from "@/components/SearchBar";
import { ServiceCard } from "@/components/ServiceCard";
import { SectionHeader } from "@/components/SectionHeader";
import { RestaurantCard } from "@/components/RestaurantCard";
import { RestaurantCardSkeleton } from "@/components/SkeletonBlock";
import { SERVICES } from "@/constants/services";
import { restaurantService } from "@/services/RestaurantService";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { RemoteImage } from "@/components/RemoteImage";
import { VegBadge } from "@/components/VegBadge";
import { useLocationStore } from "@/store/useLocationStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import { Coupon, Restaurant, ServiceType } from "@/types";

export default function HomeScreen() {
  const location = useLocationStore((s) => s.selected);
  const user = useAuthStore((s) => s.user);
  const coupons = useCatalogStore((s) => s.coupons);
  const [popular, setPopular] = useState<Restaurant[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const discountedItems = useMemo(() => {
    const seen = new Set<string>();
    return coupons
      .filter((coupon) => coupon.showOnHome !== false)
      .flatMap((coupon) => (coupon.targetFoodItems ?? []).map((item) => ({ ...item, code: coupon.code, offer: offerLabel(coupon) })))
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 10);
  }, [coupons]);

  const load = useCallback(async () => {
    try {
      const [list] = await Promise.all([restaurantService.listRestaurants(), useCatalogStore.getState().load(true)]);
      setPopular(list.filter((r) => r.isOpen).slice(0, 6));
      setFailed(false);
    } catch {
      setFailed(true);
      setPopular([]);
    }
  }, []);

  useEffect(() => {
    // load() is async: every setState inside it runs after an await, so this
    // is a plain data fetch rather than a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openService = (service: ServiceType) => {
    if (service === "FOOD") {
      router.push("/food");
      return;
    }
    router.push({ pathname: "/service/[type]", params: { type: service } });
  };

  const greeting = getGreeting();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable style={styles.location} onPress={() => router.push("/location")} accessibilityRole="button">
          <View style={styles.pin}>
            <Icon name="location" size={17} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.locationLabel}>DELIVERING TO</Text>
            <Text style={styles.locationName} numberOfLines={1}>
              {location?.label ?? "Home"} · {location?.city ?? "Set location"}
            </Text>
          </View>
        </Pressable>
        <Pressable style={styles.profileButton} onPress={() => router.push("/(tabs)/account")} accessibilityLabel="Account">
          <Text style={styles.profileText}>{(user?.name ?? "G").slice(0, 2).toUpperCase()}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />}
      >
        <View style={styles.hero}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.heroTitle}>What can we{"\n"}bring you today?</Text>
        </View>

        <SearchBar placeholder="Search dishes, groceries, stores…" editable={false} onPress={() => router.push("/(tabs)/search")} />

        {discountedItems.length > 0 && (
          <View style={styles.discountSection}>
            <SectionHeader title="Discounted items" subtitle="Live offers picked from admin" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.discountScroll}>
              {discountedItems.map((item) => (
                <DiscountItemCard key={item.id} item={item} />
              ))}
            </ScrollView>
          </View>
        )}

        {coupons.some((coupon) => coupon.showOnHome !== false) && (
          <View style={styles.offersSection}>
            <SectionHeader title="Offers for you" subtitle="Use the code at checkout" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.offerScroll}>
              {coupons.filter((coupon) => coupon.showOnHome !== false).map((coupon) => (
                <HomeOfferCard key={coupon.code} coupon={coupon} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Step 1 of the journey: pick a service. Numbered + captioned so a
            first-time user understands this is the entry point, not decoration. */}
        <View>
          <View style={styles.stepHeader}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={typography.h2}>Choose a service</Text>
              <Text style={typography.caption}>Six services, one Goocart account</Text>
            </View>
          </View>
          <View style={styles.serviceGrid}>
            {SERVICES.map((meta) => (
              <ServiceCard key={meta.type} meta={meta} onPress={() => openService(meta.type)} />
            ))}
          </View>
        </View>

        <View style={styles.promo}>
          <View style={{ flex: 1 }}>
            <Text style={styles.promoEyebrow}>LIVE IN {(location?.city ?? "YOUR AREA").toUpperCase()}</Text>
            <Text style={styles.promoTitle}>Fresh picks,{"\n"}right on time.</Text>
            <Text style={styles.promoCopy}>Live prices and availability from local kitchens and stores.</Text>
          </View>
        </View>

        <View>
          <SectionHeader title="Popular Near You" subtitle="Highest-rated places delivering to your area" />
          {popular === null ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
              {[1, 2, 3].map((i) => (
                <RestaurantCardSkeleton key={i} />
              ))}
            </ScrollView>
          ) : failed ? (
            <View style={styles.offlineCard}>
              <Text style={typography.bodyStrong}>Couldn&apos;t reach Goocart</Text>
              <Text style={typography.caption}>Pull down to retry. Make sure the backend is running and your phone is on the same Wi-Fi.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
              {popular.map((r) => (
                <RestaurantCard key={r.id} restaurant={r} onPress={() => router.push({ pathname: "/food/restaurant/[id]", params: { id: r.id } })} />
              ))}
            </ScrollView>
          )}
        </View>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function offerLabel(coupon: Coupon) {
  if (coupon.type === "FREE_DELIVERY") return "FREE DELIVERY";
  if (coupon.type === "PERCENT") return `${coupon.value}% OFF`;
  return `₹${coupon.value} OFF`;
}

function DiscountItemCard({ item }: { item: NonNullable<Coupon["targetFoodItems"]>[number] & { code: string; offer: string } }) {
  return (
    <Pressable
      style={styles.discountCard}
      onPress={() => router.push({ pathname: "/food/restaurant/[id]", params: { id: item.restaurantId } })}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.offer}`}
    >
      <RemoteImage uri={item.imageUrl} fallbackLabel={item.name} style={styles.discountImage} />
      <View style={styles.discountBody}>
        <View style={styles.discountTopRow}>
          <VegBadge veg={item.veg} />
          <Text style={styles.discountOffer}>{item.offer}</Text>
        </View>
        <Text style={styles.discountName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.discountMeta} numberOfLines={1}>{item.restaurantName || "Restaurant offer"}</Text>
        <View style={styles.discountBottomRow}>
          <Text style={styles.discountPrice}>₹{item.price}</Text>
          <Text style={styles.discountCode}>{item.code}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function HomeOfferCard({ coupon }: { coupon: Coupon }) {
  const discount = offerLabel(coupon);
  const scope = (coupon.targetFoodItemNames ?? []).length
    ? coupon.targetFoodItemNames.slice(0, 2).join(" • ")
    : (coupon.targetRestaurantNames ?? []).length
      ? coupon.targetRestaurantNames.slice(0, 2).join(" • ")
      : "All restaurants";
  const openOffer = () => {
    if ((coupon.targetRestaurantIds ?? []).length === 1) {
      router.push({ pathname: "/food/restaurant/[id]", params: { id: coupon.targetRestaurantIds[0] } });
    } else {
      router.push("/food");
    }
  };

  return <Pressable style={styles.offerCard} onPress={openOffer} accessibilityRole="button" accessibilityLabel={`${discount}, code ${coupon.code}`}>
    <View style={styles.offerBadge}><Text style={styles.offerBadgeText}>{discount}</Text></View>
    <Text style={styles.offerTitle} numberOfLines={1}>{coupon.title || discount}</Text>
    <Text style={styles.offerScope} numberOfLines={1}>{scope}</Text>
    <View style={styles.offerCodeRow}>
      <Text style={styles.offerCode}>{coupon.code}</Text>
      <Text style={styles.offerAction}>VIEW →</Text>
    </View>
  </Pressable>;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "GOOD MORNING";
  if (hour < 17) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  location: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  pin: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.primaryMuted, alignItems: "center", justifyContent: "center" },
  pinIcon: { color: colors.primary, fontSize: 14 },
  locationLabel: { ...typography.caption, fontSize: 9, letterSpacing: 1.1 },
  locationName: { ...typography.bodyStrong, fontSize: 13 },
  chevron: { color: colors.muted },
  profileButton: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" },
  profileText: { color: colors.white, fontSize: 11, fontWeight: "800" },
  scroll: { padding: spacing.xl, gap: spacing.xxl },
  hero: { gap: spacing.xs },
  greeting: { ...typography.eyebrow },
  heroTitle: { ...typography.display, lineHeight: 38 },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: colors.white, fontSize: 12, fontWeight: "800" },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  offersSection: { marginTop: -spacing.sm },
  offerScroll: { gap: spacing.md, paddingRight: spacing.xl },
  discountSection: { marginTop: -spacing.sm },
  discountScroll: { gap: spacing.md, paddingRight: spacing.xl },
  discountCard: {
    width: 218,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  discountImage: { width: "100%", height: 106 },
  discountBody: { padding: spacing.md, gap: 5 },
  discountTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  discountOffer: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  discountName: { ...typography.bodyStrong },
  discountMeta: { ...typography.caption, color: colors.muted },
  discountBottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  discountPrice: { ...typography.bodyStrong },
  discountCode: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  offerCard: { width: 238, backgroundColor: "#FFF1EB", borderWidth: 1, borderColor: "#FFD2C2", borderRadius: radius.lg, padding: spacing.lg, gap: 5 },
  offerBadge: { alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5 },
  offerBadgeText: { color: colors.white, fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  offerTitle: { ...typography.bodyStrong, marginTop: 3 },
  offerScope: { ...typography.caption, color: colors.muted },
  offerCodeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  offerCode: { color: colors.primary, fontWeight: "900", letterSpacing: 1 },
  offerAction: { color: colors.dark, fontSize: 10, fontWeight: "800" },
  promo: { backgroundColor: colors.dark, borderRadius: radius.xl, padding: spacing.xl, flexDirection: "row" },
  promoEyebrow: { color: "#FF9D7A", fontSize: 9, fontWeight: "800", letterSpacing: 1.4 },
  promoTitle: { color: colors.white, fontSize: 26, fontWeight: "700", lineHeight: 30, marginTop: spacing.sm },
  promoCopy: { color: "#BBBBBB", fontSize: 11, marginTop: spacing.sm },
  hScroll: { gap: spacing.md, paddingRight: spacing.xl },
  offlineCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
});
