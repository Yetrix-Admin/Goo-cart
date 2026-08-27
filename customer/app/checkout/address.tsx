import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { AddressCard } from "@/components/AddressCard";
import { colors, radius, spacing, typography } from "@/theme";
import { useAddressStore } from "@/store/useAddressStore";
import { locationService } from "@/services/LocationService";
import { Address } from "@/types";

const EMPTY_FORM = {
  label: "Home" as Address["label"],
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
  const loading = useAddressStore((s) => s.loading);
  const select = useAddressStore((s) => s.select);
  const addAddress = useAddressStore((s) => s.addAddress);
  const removeAddress = useAddressStore((s) => s.removeAddress);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const choose = (id: string) => {
    select(id);
    router.back();
  };

  const useCurrentLocation = async () => {
    setLocating(true);
    setError("");
    try {
      const resolved = await locationService.getCurrentLocation();
      if (!resolved) {
        setError("Couldn't get your location. Check location permissions and try again.");
        return;
      }
      setCoords({ latitude: resolved.latitude, longitude: resolved.longitude });
      setForm((f) => ({ ...f, city: f.city || resolved.city }));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!form.house.trim() || !form.city.trim() || !form.pincode.trim() || !form.contactName.trim() || !form.contactPhone.trim()) {
      setError("Fill in house/flat, city, pincode, contact name and phone.");
      return;
    }
    if (!/^\d{6}$/.test(form.pincode.trim())) {
      setError("Enter a valid 6-digit pincode.");
      return;
    }
    // Mandatory per spec: delivery assignment and live tracking both need a
    // real pin, not just a text address — "Use Current Location" above (or
    // search, once that's wired up) is how it gets set.
    if (!coords) {
      setError("Use current location so we can pin this address on the map.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await addAddress({
        label: form.label,
        line1: form.house,
        building: form.building || undefined,
        street: form.street || undefined,
        landmark: form.landmark || undefined,
        city: form.city,
        state: "",
        pincode: form.pincode,
        contactName: form.contactName,
        contactPhone: form.contactPhone,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this address.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (address: Address) => {
    Alert.alert("Remove address", `Delete "${address.label}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void removeAddress(address.id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Delivery Address" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!showForm && (
          <>
            {loading && addresses.length === 0 ? <ActivityIndicator color={colors.primary} /> : null}
            <View style={{ gap: spacing.md }}>
              {addresses.map((a) => (
                <AddressCard key={a.id} address={a} selected={a.id === selectedId} onPress={() => choose(a.id)} onLongPress={() => confirmDelete(a)} />
              ))}
            </View>
            <PrimaryButton label="+ Add New Address" variant="outline" onPress={() => setShowForm(true)} />
          </>
        )}

        {showForm && (
          <View style={{ gap: spacing.md }}>
            <PrimaryButton
              label={locating ? "Locating…" : coords ? "Location captured ✓" : "Use Current Location"}
              variant={coords ? "outline" : undefined}
              onPress={() => void useCurrentLocation()}
              disabled={locating}
            />
            <LabelPicker value={form.label} onChange={(label) => setForm({ ...form, label })} />
            <Field label="House / Flat" value={form.house} onChangeText={(v) => setForm({ ...form, house: v })} />
            <Field label="Building" value={form.building} onChangeText={(v) => setForm({ ...form, building: v })} />
            <Field label="Street" value={form.street} onChangeText={(v) => setForm({ ...form, street: v })} />
            <Field label="Landmark" value={form.landmark} onChangeText={(v) => setForm({ ...form, landmark: v })} />
            <Field label="City" value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} />
            <Field label="Pincode" value={form.pincode} onChangeText={(v) => setForm({ ...form, pincode: v.replace(/[^0-9]/g, "").slice(0, 6) })} keyboardType="number-pad" />
            <Field label="Contact Name" value={form.contactName} onChangeText={(v) => setForm({ ...form, contactName: v })} />
            <Field label="Contact Number" value={form.contactPhone} onChangeText={(v) => setForm({ ...form, contactPhone: v.replace(/[^0-9]/g, "").slice(0, 10) })} keyboardType="number-pad" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label={saving ? "Saving…" : "Save Address"} onPress={() => void save()} disabled={saving} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LabelPicker({ value, onChange }: { value: Address["label"]; onChange: (label: Address["label"]) => void }) {
  const options: Address["label"][] = ["Home", "Work", "Other"];
  return (
    <View style={styles.labelRow}>
      {options.map((opt) => (
        <Text key={opt} style={[styles.labelChip, value === opt && styles.labelChipActive]} onPress={() => onChange(opt)}>
          {opt}
        </Text>
      ))}
    </View>
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
  labelRow: { flexDirection: "row", gap: spacing.sm },
  labelChip: { ...typography.captionStrong, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, color: colors.muted, overflow: "hidden" },
  labelChipActive: { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primaryMuted },
});
