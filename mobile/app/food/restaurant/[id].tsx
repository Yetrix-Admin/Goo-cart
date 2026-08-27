import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { MenuItemCard } from "@/components/MenuItemCard";
import { StickyCartBar } from "@/components/StickyCartBar";
import { CustomizeSheet } from "@/components/CustomizeSheet";
import { SkeletonBlock } from "@/components/SkeletonBlock";
import { restaurantService } from "@/services/RestaurantService";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { cartLineId, useCartBill, useCartItemCount, useCartStore } from "@/store/useCartStore";
import { useFavoritesStore } from "@/store/useFavoritesStore";
import { CartLineItem, FoodItem, MenuCategory, Restaurant } from "@/types";

export default function RestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [restaurant, setRestaurant] = useState<Restaurant | null | undefined>(undefined);
  const [menu, setMenu] = useState<FoodItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [customizeItem, setCustomizeItem] = useState<FoodItem | null>(null);

  const cartRestaurantId = useCartStore((s) => s.restaurantId);
  const cartRestaurantName = useCartStore((s) => s.restaurantName);
  const cartItems = useCartStore((s) => s.items);
  const totalItems = useCartItemCount();
  const bill = useCartBill();
  const addItem = useCartStore((s) => s.addItem);
  const replaceCartWithItem = useCartStore((s) => s.replaceCartWithItem);

  const isFavorite = useFavoritesStore((s) => (id ? s.isFavorite(id) : false));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    restaurantService
      .getRestaurantWithMenu(id)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setRestaurant(null);
          return;
        }
        setRestaurant(data.restaurant);
        setCategories(data.categories);
        setMenu(data.items);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Couldn't load this restaurant.");
        setRestaurant(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const visibleItems = useMemo(() => {
    let items = menu;
    if (menuSearch.trim()) {
      const q = menuSearch.trim().toLowerCase();
      items = items.filter((item) => item.name.toLowerCase().includes(q));
    } else if (activeCategory) {
      items = items.filter((item) => item.categoryId === activeCategory);
    }
    return items;
  }, [menu, menuSearch, activeCategory]);

  const quantityFor = (foodItemId: string) => cartItems.filter((i) => i.foodItemId === foodItemId).reduce((sum, i) => sum + i.quantity, 0);

  const commitLine = (line: CartLineItem) => {
    if (!restaurant) return;
    const result = addItem(restaurant.id, restaurant.name, line);
    if (result.conflict) {
      Alert.alert(
        "Start a new cart?",
        `Your cart contains items from ${cartRestaurantName}. Adding items from another restaurant will clear your current cart.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Start New Cart", style: "destructive", onPress: () => replaceCartWithItem(restaurant.id, restaurant.name, line) },
        ],
      );
    }
    setCustomizeItem(null);
  };

  const onAdd = (item: FoodItem) => {
    if (!restaurant?.isOpen) {
      Alert.alert("Restaurant closed", `${restaurant?.name} is not accepting orders right now.`);
      return;
    }
    if (item.variants?.length || item.addonGroups?.length) {
      setCustomizeItem(item);
      return;
    }
    const line: CartLineItem = {
      lineId: cartLineId(item.id),
      foodItemId: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      veg: item.veg,
      quantity: 1,
      unitPrice: item.price,
      lineTotal: item.price,
      selectedAddons: [],
    };
    commitLine(line);
  };

  if (restaurant === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Loading…" />
        <View style={{ padding: spacing.xl, gap: spacing.md }}>
          <SkeletonBlock width="100%" height={140} />
          <SkeletonBlock width="60%" height={20} />
          <SkeletonBlock width="40%" height={14} />
          <SkeletonBlock width="90%" height={70} />
          <SkeletonBlock width="90%" height={70} />
        </View>
      </SafeAreaView>
    );
  }

  if (restaurant === null) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Restaurant" />
        <EmptyState icon="alert" title={loadError ? "Couldn’t load restaurant" : "Restaurant unavailable"} copy={loadError ?? "This restaurant could not be found. It may have been removed."} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title={restaurant.name}
        subtitle={restaurant.isOpen ? undefined : "Closed now"}
        right={
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable style={styles.iconBtn} onPress={() => setSearchOpen((v) => !v)}>
              <Icon name="search" size={17} color={colors.text} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => toggleFavorite(restaurant.id)}>
              <Icon name={isFavorite ? "heartFilled" : "heart"} size={17} color={isFavorite ? colors.error : colors.text} />
            </Pressable>
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ paddingBottom: totalItems > 0 ? 120 : spacing.xl }}>
        <View style={styles.infoBlock}>
          <View style={styles.row}>
            <Text style={styles.rating}>★ {restaurant.rating.toFixed(1)}</Text>
            <Text style={typography.caption}>({restaurant.ratingCount})</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={typography.caption}>
              {restaurant.deliveryTimeMin}–{restaurant.deliveryTimeMax} min
            </Text>
            <Text style={styles.dot}>•</Text>
            <Text style={typography.caption}>{restaurant.distanceKm} km</Text>
          </View>
          <Text style={typography.caption}>{restaurant.cuisines.join(", ")}</Text>
          {restaurant.priceForTwo ? <Text style={typography.caption}>₹{restaurant.priceForTwo} for two</Text> : null}
          <Text style={typography.caption}>{restaurant.area}</Text>

          {restaurant.offers.length > 0 && (
            <View style={styles.offers}>
              {restaurant.offers.map((offer) => (
                <View key={offer.title} style={styles.offerRow}>
                  <Icon name="offer" size={15} color={colors.primary} />
                  <View>
                    <Text style={typography.bodyStrong}>{offer.title}</Text>
                    {offer.description ? <Text style={typography.caption}>{offer.description}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {searchOpen && (
          <View style={styles.menuSearchWrap}>
            <TextInput
              value={menuSearch}
              onChangeText={setMenuSearch}
              placeholder="Search menu"
              placeholderTextColor={colors.muted}
              style={styles.menuSearchInput}
            />
          </View>
        )}

        {!menuSearch && categories.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            <Pressable style={[styles.categoryChip, !activeCategory && styles.categoryChipActive]} onPress={() => setActiveCategory(null)}>
              <Text style={[styles.categoryChipText, !activeCategory && styles.categoryChipTextActive]}>All</Text>
            </Pressable>
            {categories.map((cat) => (
              <Pressable key={cat.id} style={[styles.categoryChip, activeCategory === cat.id && styles.categoryChipActive]} onPress={() => setActiveCategory(cat.id)}>
                <Text style={[styles.categoryChipText, activeCategory === cat.id && styles.categoryChipTextActive]}>{cat.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.menuList}>
          {visibleItems.length === 0 ? (
            <EmptyState icon="search" title={menuSearch ? "No dishes found" : "No items in this category"} copy={menuSearch ? `Nothing matches "${menuSearch}".` : "Try a different category."} />
          ) : (
            visibleItems.map((item) => <MenuItemCard key={item.id} item={item} quantityInCart={quantityFor(item.id)} onAdd={() => onAdd(item)} />)
          )}
        </View>
      </ScrollView>

      {categories.length > 1 && (
        <Pressable style={[styles.menuFab, cartRestaurantId === restaurant.id && styles.menuFabRaised]} onPress={() => setCategoryPickerOpen(true)}>
          <Icon name="menu" size={15} color={colors.white} />
          <Text style={styles.menuFabText}>MENU</Text>
        </Pressable>
      )}

      <Modal visible={categoryPickerOpen} transparent animationType="fade" onRequestClose={() => setCategoryPickerOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setCategoryPickerOpen(false)}>
          <View style={styles.pickerSheet}>
            {categories.map((cat) => (
              <Pressable
                key={cat.id}
                style={styles.pickerRow}
                onPress={() => {
                  setActiveCategory(cat.id);
                  setMenuSearch("");
                  setCategoryPickerOpen(false);
                }}
              >
                <Text style={typography.body}>{cat.name}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <CustomizeSheet item={customizeItem} visible={!!customizeItem} onClose={() => setCustomizeItem(null)} onConfirm={commitLine} />

      {cartRestaurantId === restaurant.id && (
        <StickyCartBar itemCount={totalItems} total={bill.itemTotal} onPress={() => router.push("/(tabs)/cart")} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  iconBtn: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  infoBlock: { padding: spacing.xl, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rating: { ...typography.captionStrong, color: colors.success },
  dot: { color: colors.border },
  offers: { marginTop: spacing.md, gap: spacing.sm },
  offerRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  offerIcon: { fontSize: 14, color: colors.primary, fontWeight: "800", width: 20 },
  menuSearchWrap: { padding: spacing.xl, paddingBottom: 0 },
  menuSearchInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    ...typography.body,
  },
  categoryRow: { gap: spacing.sm, padding: spacing.xl },
  categoryChip: { paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  categoryChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { ...typography.captionStrong },
  categoryChipTextActive: { color: colors.white },
  menuList: { paddingHorizontal: spacing.xl },
  menuFab: {
    position: "absolute",
    right: spacing.lg,
    bottom: 24,
    backgroundColor: colors.dark,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuFabRaised: { bottom: 96 },
  menuFabText: { color: colors.white, fontWeight: "700", fontSize: 11, letterSpacing: 0.5 },
  pickerBackdrop: { flex: 1, backgroundColor: "#00000055", justifyContent: "center", padding: spacing.xl },
  pickerSheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, maxHeight: "60%" },
  pickerRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.md },
});
