import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { colors, radius, spacing } from "@/theme";

type Props = {
  restaurant: { latitude: number; longitude: number; name: string };
  destination: { latitude: number; longitude: number };
  rider?: { latitude: number; longitude: number; name: string } | null;
};

// Native implementation (Android/iOS via Expo Go). react-native-maps has no
// web target, so TrackingMap.web.tsx provides the web fallback — Metro picks
// whichever file matches the bundling platform automatically.
export function TrackingMap({ restaurant, destination, rider }: Props) {
  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: restaurant.latitude, longitude: restaurant.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      >
        <Marker coordinate={restaurant} title={restaurant.name} pinColor={colors.primary} />
        <Marker coordinate={destination} title="You" pinColor={colors.success} />
        {rider ? <Marker coordinate={rider} title={rider.name} pinColor={colors.dark} /> : null}
      </MapView>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>DEMO TRACKING</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 220, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  map: { flex: 1 },
  badge: { position: "absolute", top: spacing.sm, left: spacing.sm, backgroundColor: colors.dark, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  badgeText: { color: colors.white, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
});
