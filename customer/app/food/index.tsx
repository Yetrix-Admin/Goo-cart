import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SearchBar } from "@/components/SearchBar";
import { CategoryChip } from "@/components/CategoryChip";
import { FilterChip } from "@/components/FilterChip";
import { RestaurantCard } from "@/components/RestaurantCard";
import { RestaurantCardSkeleton } from "@/components/SkeletonBlock";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FOOD_CATEGORIES } from "@/constants/foodCategories";
import { restaurantService } from "@/services/RestaurantService";
import { colors, spacing, typography } from "@/theme";
import { useLocationStore } from "@/store/useLocationStore";
import { useOrderStore } from "@/store/useOrderStore";
import { Restaurant } from "@/types";

type FilterKey = "rating" | "under30" | "veg" | "offers";

const FILTER_LABEL: Record<FilterKey, string> = {
  rating: "Rating 4.0+",
  under30: "Under 30 min",
  veg: "Pure Veg",
  offers: "Offers",
};

export default function FoodHomeScreen() {
  const location = useLocationStore((s) => s.selected);
  const orders = useOrderStore((s) => s.orders);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set());
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await restaurantService.listRestaurants();
      setRestaurants(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load restaurants.");
      setRestaurants(null);
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

  const toggleFilter = (key: FilterKey) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!restaurants) return [];
    let list = restaurants;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.cuisines.some((c) => c.toLowerCase().includes(q)));
    }
    if (activeCategory) {
      const catName = FOOD_CATEGORIES.find((c) => c.id === activeCategory)?.name.toLowerCase() ?? "";
      list = list.filter((r) => r.cuisines.some((c) => c.toLowerCase().includes(catName)) || r.name.toLowerCase().includes(catName));
    }
    if (filters.has("rating")) list = list.filter((r) => r.rating >= 4.0);
    if (filters.has("under30")) list = list.filter((r) => r.deliveryTimeMax <= 30);
    if (filters.has("veg")) list = list.filter((r) => r.vegOnly);
    if (filters.has("offers")) list = list.filter((r) => r.offers.length > 0);
    return list;
  }, [restaurants, query, activeCategory, filters]);

  const topOffers = useMemo(() => (restaurants ?? []).filter((r) => r.offers.length > 0), [restaurants]);
  const topRated = useMemo(() => [...(restaurants ?? [])].filter((r) => r.rating >= 4.4).sort((a, b) => b.rating - a.rating), [restaurants]);
  const fastest = useMemo(() => [...(restaurants ?? [])].filter((r) => r.deliveryTimeMax <= 30).sort((a, b) => a.deliveryTimeMax - b.deliveryTimeMax), [restaurants]);
  const orderedRestaurantIds = useMemo(() => new Set(orders.filter((o) => o.serviceType === "FOOD").map((o) => o.restaurantId)), [orders]);
  const orderAgain = useMemo(() => (restaurants ?? []).filter((r) => orderedRestaurantIds.has(r.id)), [restaurants, orderedRestaurantIds]);

  const openRestaurant = (id: string) => router.push({ pathname: "/food/restaurant/[id]", params: { id } });
  const browsing = query.trim().length > 0 || !!activeCategory || filters.size > 0;

  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Food Delivery" />
        <View style={styles.errorWrap}>
          <EmptyState icon="alert" title="Couldn't load restaurants" copy={error} />
          <PrimaryButton label="Try Again" onPress={() => void load()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Food Delivery" subtitle={`${location?.label ?? "Home"} · ${location?.city ?? "Jangareddigudem"}`} />

      <FlatList
        data={browsing ? filtered : []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <View style={styles.listCard}>
            <RestaurantCard restaurant={item} wide onPress={() => openRestaurant(item.id)} />
          </View>
        )}
        contentContainerStyle={styles.scroll}
        ListHeaderComponent={
          <View style={{ gap: spacing.xxl }}>
            <SearchBar placeholder="Search dishes, restaurants or cuisines" value={query} onChangeText={setQuery} />

            <View>
              <SectionHeader title="What's on your mind?" subtitle="Tap a craving to filter" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                {FOOD_CATEGORIES.map((cat) => (
                  <CategoryChip key={cat.id} name={cat.name} imageUrl={cat.imageUrl} active={activeCategory === cat.id} onPress={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)} />
                ))}
              </ScrollView>
            </View>

            <View>
              <Text style={styles.filterLabel}>REFINE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {(Object.keys(FILTER_LABEL) as FilterKey[]).map((key) => (
                  <FilterChip key={key} label={FILTER_LABEL[key]} active={filters.has(key)} onPress={() => toggleFilter(key)} />
                ))}
              </ScrollView>
            </View>

            {restaurants === null && (
              <View>
                <SectionHeader title="Restaurants near you" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {[1, 2, 3].map((i) => (
                    <RestaurantCardSkeleton key={i} />
                  ))}
                </ScrollView>
              </View>
            )}

            {browsing && (
              <View style={styles.resultHeader}>
                <Text style={typography.h2}>
                  {filtered.length} {filtered.length === 1 ? "place" : "places"}
                </Text>
                <Pressable
                  onPress={() => {
                    setQuery("");
                    setActiveCategory(null);
                    setFilters(new Set());
                  }}
                >
                  <Text style={styles.clearLink}>Clear all</Text>
                </Pressable>
              </View>
            )}

            {!browsing && restaurants !== null && (
              <>
                {orderAgain.length > 0 && <Carousel title="Order Again" subtitle="Places you've ordered from before" restaurants={orderAgain} onPress={openRestaurant} />}
                {topOffers.length > 0 && <Carousel title="Top Offers" subtitle="Save on today's orders" restaurants={topOffers} onPress={openRestaurant} />}
                <Carousel title="All Restaurants" subtitle={`${restaurants.length} places delivering to you`} restaurants={restaurants} onPress={openRestaurant} />
                {topRated.length > 0 && <Carousel title="Top Rated" subtitle="Rated 4.4 and above" restaurants={topRated} onPress={openRestaurant} />}
                {fastest.length > 0 && <Carousel title="Under 30 Minutes" subtitle="Fastest kitchens near you" restaurants={fastest} onPress={openRestaurant} />}
              </>
            )}
          </View>
        }
        ListEmptyComponent={browsing ? <EmptyState icon="search" title="No restaurants found" copy="Try a different search term, or clear your filters." /> : null}
        ListFooterComponent={<View style={{ height: spacing.xxxl }} />}
      />
    </SafeAreaView>
  );
}

function Carousel({ title, subtitle, restaurants, onPress }: { title: string; subtitle?: string; restaurants: Restaurant[]; onPress: (id: string) => void }) {
  if (restaurants.length === 0) return null;
  return (
    <View>
      <SectionHeader title={title} subtitle={subtitle} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
        {restaurants.map((r) => (
          <RestaurantCard key={r.id} restaurant={r} onPress={() => onPress(r.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  categoryRow: { gap: spacing.md, paddingRight: spacing.xl },
  hScroll: { gap: spacing.md, paddingRight: spacing.xl },
  filterLabel: { ...typography.captionStrong, letterSpacing: 1, marginBottom: spacing.sm },
  filterRow: { gap: spacing.sm, paddingRight: spacing.xl },
  listCard: { marginBottom: spacing.lg },
  resultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clearLink: { ...typography.captionStrong, color: colors.primary },
  errorWrap: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
});
