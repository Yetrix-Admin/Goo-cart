import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";

const MAX_DIMENSION = 900;
const JPEG_QUALITY = 0.7;

// Stored as a base64 data URI, matching the admin web's product/banner image
// upload — this project has no image CDN/host, so every image field in the
// app (restaurant photo, product photo, banners) is stored the same way.
// Resized/compressed on-device before upload so the payload stays reasonable.
export function DishImageField({ value, onChange }: { value: string | null; onChange: (dataUri: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async () => {
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to add a dish photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: MAX_DIMENSION } }],
        { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) throw new Error("Could not process this photo.");
      onChange(`data:image/jpeg;base64,${manipulated.base64}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process this photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={typography.captionStrong}>Dish photo (optional)</Text>
      <Pressable style={styles.preview} onPress={() => void pick()} disabled={busy} accessibilityRole="button" accessibilityLabel="Add a dish photo">
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : value ? (
          <Image source={{ uri: value }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.empty}>
            <Icon name="image" size={24} color={colors.muted} />
            <Text style={styles.emptyText}>Tap to add a photo</Text>
          </View>
        )}
      </Pressable>
      {value && !busy ? (
        <Pressable onPress={() => onChange(null)} accessibilityRole="button">
          <Text style={styles.removeText}>Remove photo</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  preview: {
    height: 140,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%" },
  empty: { alignItems: "center", gap: 6 },
  emptyText: { ...typography.caption, color: colors.muted },
  removeText: { ...typography.caption, color: colors.error, alignSelf: "flex-start" },
  error: { ...typography.caption, color: colors.error },
});
