import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SearchBar } from "@/components/SearchBar";
import { EmptyState } from "@/components/EmptyState";
import { VegBadge } from "@/components/VegBadge";
import { RemoteImage } from "@/components/RemoteImage";
import { colors, radius, spacing, typography } from "@/theme";
import { restaurantService } from "@/services/RestaurantService";
import { serviceMeta } from "@/constants/services";
import { ServiceType } from "@/types";
import { SearchResult } from "@/services/RestaurantService";

const RECENT_SEARCHES = ["Biryani", "Milk", "Tomatoes", "Cold Drink"];
const TRENDING = ["Chicken Biryani", "Pizza", "Milk", "Ice Cream"];

export default function SearchScreen() {
  const { service } = useLocalSearchParams<{ service?: ServiceType }>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);

  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      restaurantService.searchFood(query).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const meta = service && service !== "FOOD" ? serviceMeta(service) : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <SearchBar placeholder="Search food, grocery, products or stores..." value={query} onChangeText={setQuery} />
      </View>

      {meta ? (
        <ScrollView contentContainerStyle={styles.body}>
          <EmptyState
            icon={meta.icon}
            title={`${meta.label} is coming next`}
            copy={`Browsing, product details and checkout for ${meta.label} land in the next build phase. Food search works right now — try typing a dish or restaurant above.`}
          />
        </ScrollView>
      ) : !query.trim() ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={typography.h3}>Recent Searches</Text>
          <View style={styles.chipRow}>
            {RECENT_SEARCHES.map((term) => (
              <Pressable key={term} style={styles.chip} onPress={() => setQuery(term)}>
                <Text style={typography.captionStrong}>{term}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[typography.h3, { marginTop: spacing.xl }]}>Trending</Text>
          <View style={styles.chipRow}>
            {TRENDING.map((term) => (
              <Pressable key={term} style={styles.chip} onPress={() => setQuery(term)}>
                <Text style={typography.captionStrong}>{term}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {results && results.restaurants.length === 0 && results.items.length === 0 ? (
            <EmptyState icon="search" title="No results found" copy={`Nothing matches "${query}".`} />
          ) : (
            <>
              {results && results.restaurants.length > 0 && (
                <View style={styles.resultSection}>
                  <Text style={styles.resultLabel}>RESTAURANTS</Text>
                  {results.restaurants.map((r) => (
                    <Pressable key={r.id} style={styles.resultRow} onPress={() => router.push({ pathname: "/food/restaurant/[id]", params: { id: r.id } })}>
                      <RemoteImage uri={r.imageUrl} fallbackLabel={r.name} style={styles.resultThumb} />
                      <View style={{ flex: 1 }}>
                        <Text style={typography.bodyStrong}>{r.name}</Text>
                        <Text style={typography.caption} numberOfLines={1}>
                          {r.cuisines.join(", ")} · ★ {r.rating.toFixed(1)}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
              {results && results.items.length > 0 && (
                <View style={styles.resultSection}>
                  <Text style={styles.resultLabel}>DISHES</Text>
                  {results.items.map((item) => (
                    <Pressable key={item.id} style={styles.resultRow} onPress={() => router.push({ pathname: "/food/restaurant/[id]", params: { id: item.restaurantId } })}>
                      <RemoteImage uri={item.imageUrl} fallbackLabel={item.name} style={styles.resultThumb} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.dishTitleRow}>
                          <VegBadge veg={item.veg} />
                          <Text style={typography.bodyStrong} numberOfLines={1}>
                            {item.name}
                          </Text>
                        </View>
                        <Text style={typography.caption} numberOfLines={1}>
                          {item.restaurantName} · ₹{item.price}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.xl, paddingBottom: spacing.md },
  body: { flexGrow: 1, padding: spacing.xl, paddingTop: 0 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  resultSection: { gap: spacing.sm, marginBottom: spacing.lg },
  resultLabel: { ...typography.captionStrong, letterSpacing: 1 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  resultThumb: { width: 52, height: 52, borderRadius: radius.sm },
  dishTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
