import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { RestaurantCard } from "@/components/RestaurantCard";
import { RestaurantCardSkeleton } from "@/components/SkeletonBlock";
import { EmptyState } from "@/components/EmptyState";
import { colors, spacing } from "@/theme";
import { useFavoritesStore } from "@/store/useFavoritesStore";
import { restaurantService } from "@/services/RestaurantService";
import { Restaurant } from "@/types";

export default function FavoritesScreen() {
  const favoriteIds = useFavoritesStore((s) => s.restaurantIds);
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    restaurantService
      .listRestaurants()
      .then((list) => {
        if (!cancelled) setRestaurants(list);
      })
      .catch(() => {
        if (!cancelled) setRestaurants([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const favorites = (restaurants ?? []).filter((r) => favoriteIds.includes(r.id));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Favorites" />
      {restaurants === null ? (
        <View style={styles.list}>
          <RestaurantCardSkeleton />
        </View>
      ) : favorites.length === 0 ? (
        <EmptyState icon="heartFilled" title="Nothing saved yet" copy="Tap the heart on any restaurant to save it here." />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {favorites.map((r) => (
            <View key={r.id} style={{ marginBottom: spacing.md }}>
              <RestaurantCard restaurant={r} wide onPress={() => router.push({ pathname: "/food/restaurant/[id]", params: { id: r.id } })} />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.xl },
});
