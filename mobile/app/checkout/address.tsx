import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { AddressCard } from "@/components/AddressCard";
import { colors, radius, spacing, typography } from "@/theme";
import { useAddressStore } from "@/store/useAddressStore";
import { Address } from "@/types";

const EMPTY_FORM = {
  house: "",
  building: "",
  street: "",
  landmark: "",
  city: "",
  pincode: "",
  contactName: "",
  contactPhone: "",
};

export default function AddressScreen() {
  const addresses = useAddressStore((s) => s.addresses);
  const selectedId = useAddressStore((s) => s.selectedId);
  const select = useAddressStore((s) => s.select);
  const addAddress = useAddressStore((s) => s.addAddress);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");

  const choose = (id: string) => {
    select(id);
    router.back();
  };

  const save = () => {
    if (!form.house.trim() || !form.city.trim() || !form.pincode.trim() || !form.contactName.trim() || !form.contactPhone.trim()) {
      setError("Fill in house/flat, city, pincode, contact name and phone.");
      return;
    }
    if (!/^\d{6}$/.test(form.pincode.trim())) {
      setError("Enter a valid 6-digit pincode.");
      return;
    }
    const address: Address = {
      id: `addr-${Date.now()}`,
      label: "Other",
      line1: form.house,
      building: form.building || undefined,
      street: form.street || undefined,
      landmark: form.landmark || undefined,
      city: form.city,
      state: "Andhra Pradesh",
      pincode: form.pincode,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      latitude: 17.4362,
      longitude: 81.2661,
    };
    addAddress(address);
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Delivery Address" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!showForm && (
          <>
            <View style={{ gap: spacing.md }}>
              {addresses.map((a) => (
                <AddressCard key={a.id} address={a} selected={a.id === selectedId} onPress={() => choose(a.id)} />
              ))}
            </View>
            <PrimaryButton label="+ Add New Address" variant="outline" onPress={() => setShowForm(true)} />
          </>
        )}

        {showForm && (
          <View style={{ gap: spacing.md }}>
            <Field label="House / Flat" value={form.house} onChangeText={(v) => setForm({ ...form, house: v })} />
            <Field label="Building" value={form.building} onChangeText={(v) => setForm({ ...form, building: v })} />
            <Field label="Street" value={form.street} onChangeText={(v) => setForm({ ...form, street: v })} />
            <Field label="Landmark" value={form.landmark} onChangeText={(v) => setForm({ ...form, landmark: v })} />
            <Field label="City" value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} />
            <Field label="Pincode" value={form.pincode} onChangeText={(v) => setForm({ ...form, pincode: v.replace(/[^0-9]/g, "").slice(0, 6) })} keyboardType="number-pad" />
            <Field label="Contact Name" value={form.contactName} onChangeText={(v) => setForm({ ...form, contactName: v })} />
            <Field label="Contact Number" value={form.contactPhone} onChangeText={(v) => setForm({ ...form, contactPhone: v.replace(/[^0-9]/g, "").slice(0, 10) })} keyboardType="number-pad" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label="Save Address" onPress={save} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (t: string) => void; keyboardType?: "default" | "number-pad" }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={typography.captionStrong}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={styles.input} placeholderTextColor={colors.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  input: { height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface, ...typography.body },
  error: { ...typography.caption, color: colors.error },
});
