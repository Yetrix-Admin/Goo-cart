import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { useVendorStore } from "@/store/useVendorStore";

export default function NewMenuItemScreen() {
  const createMenuItem = useVendorStore((s) => s.createMenuItem);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [veg, setVeg] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    const priceValue = Number(price);
    if (name.trim().length < 2) return setError("Enter a dish name.");
    if (!categoryKey.trim()) return setError("Enter a menu category, e.g. Starters.");
    if (!Number.isFinite(priceValue) || priceValue <= 0) return setError("Enter a valid price.");

    setBusy(true);
    try {
      await createMenuItem({ name: name.trim(), description: description.trim(), price: priceValue, categoryKey: categoryKey.trim(), veg });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create this item");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Add dish" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Field label="Dish name" value={name} onChangeText={setName} />
          <Field label="Description" value={description} onChangeText={setDescription} multiline />
          <Field label="Category" value={categoryKey} onChangeText={setCategoryKey} placeholder="e.g. Starters" />
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

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton label={busy ? "Saving…" : "Add to menu"} onPress={() => void submit()} disabled={busy} />
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
