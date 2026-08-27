import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { colors, radius, spacing, typography } from "@/theme";
import { useVendorStore } from "@/store/useVendorStore";

export default function EditMenuItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useVendorStore((s) => s.menu.find((i) => i.id === id));
  const updateMenuItem = useVendorStore((s) => s.updateMenuItem);

  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [veg, setVeg] = useState(item?.veg ?? true);
  const [available, setAvailable] = useState(item?.available ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!item || !id) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Edit dish" />
        <EmptyState icon="alert" title="Item not found" copy="This dish may have been removed." />
      </SafeAreaView>
    );
  }

  const submit = async () => {
    setError("");
    const priceValue = Number(price);
    if (name.trim().length < 2) return setError("Enter a dish name.");
    if (!Number.isFinite(priceValue) || priceValue <= 0) return setError("Enter a valid price.");

    setBusy(true);
    try {
      await updateMenuItem(id, { name: name.trim(), description: description.trim(), price: priceValue, veg, available });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Edit dish" subtitle={item.name} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Field label="Dish name" value={name} onChangeText={setName} />
          <Field label="Description" value={description} onChangeText={setDescription} multiline />
          <Field label="Price (₹)" value={price} onChangeText={setPrice} keyboardType="numeric" />

          <View style={styles.switchRow}>
            <Text style={typography.captionStrong}>Vegetarian</Text>
            <Switch
              value={veg}
              onValueChange={setVeg}
              trackColor={{ false: colors.border, true: colors.successMuted }}
              thumbColor={veg ? colors.success : colors.surface}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={typography.captionStrong}>Available</Text>
            <Switch
              value={available}
              onValueChange={setAvailable}
              trackColor={{ false: colors.border, true: colors.successMuted }}
              thumbColor={available ? colors.success : colors.surface}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton label={busy ? "Saving…" : "Save changes"} onPress={() => void submit()} disabled={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={typography.captionStrong}>{label}</Text>
      <TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor={colors.muted} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  field: { gap: 6 },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    ...typography.body,
  },
  multiline: { height: 90, paddingTop: spacing.sm, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  error: { ...typography.caption, color: colors.error },
});
