import { useEffect } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { VegBadge } from "@/components/VegBadge";
import { colors, radius, spacing, typography } from "@/theme";
import { useVendorStore } from "@/store/useVendorStore";
import { FoodItem } from "@/types";

export default function MenuScreen() {
  const { restaurant, menu, loading, error, loadMenu, updateMenuItem } = useVendorStore();

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  const toggleAvailable = async (item: FoodItem) => {
    try {
      await updateMenuItem(item.id, { available: !item.available });
    } catch {
      // Store surfaces the error via its `error` field; nothing else to do here.
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={typography.h1}>Menu</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/menu/new")}
          style={styles.addBtn}
          disabled={!restaurant}
        >
          <Icon name="add" size={26} color={restaurant ? colors.primary : colors.border} />
        </Pressable>
      </View>
      <FlatList
        data={menu}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadMenu()} />}
        ListEmptyComponent={
          !restaurant ? (
            <EmptyState icon="storefront" title="No restaurant yet" copy="An admin needs to link your account before you can add dishes." />
          ) : (
            <EmptyState icon="menu" title="Your menu is empty" copy="Tap + to add your first dish." />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: "/menu/[id]", params: { id: item.id } })} style={styles.card}>
            <View style={styles.cardRow}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={styles.thumbEmpty}>
                  <Icon name="image" size={18} color={colors.muted} />
                </View>
              )}
              <VegBadge veg={item.veg} />
              <View style={{ flex: 1 }}>
                <Text style={typography.h3}>{item.name}</Text>
                <Text style={styles.copy}>₹{item.price}</Text>
              </View>
              <Switch
                value={item.available}
                onValueChange={() => void toggleAvailable(item)}
                trackColor={{ false: colors.border, true: colors.successMuted }}
                thumbColor={item.available ? colors.success : colors.surface}
              />
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  addBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  thumbEmpty: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  copy: { ...typography.body, color: colors.muted },
  error: { ...typography.caption, color: colors.error, textAlign: "center", paddingBottom: spacing.md },
});
