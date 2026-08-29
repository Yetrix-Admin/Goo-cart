import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { StarRating } from "@/components/StarRating";
import { EmptyState } from "@/components/EmptyState";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { useOrderStore } from "@/store/useOrderStore";
import { useRatingStore } from "@/store/useRatingStore";
import { ratingService } from "@/services/RatingService";

export default function RatingScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const order = useOrderStore((s) => (orderId ? s.getOrder(orderId) : undefined));
  const submitRating = useRatingStore((s) => s.submitRating);

  const [foodStars, setFoodStars] = useState(0);
  const [restaurantStars, setRestaurantStars] = useState(0);
  const [partnerStars, setPartnerStars] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Rate Order" />
        <EmptyState icon="alert" title="Order not found" copy="This order could not be found." />
      </SafeAreaView>
    );
  }

  const submit = async () => {
    const rating = ratingService.buildRating({
      orderId: order.id,
      foodStars,
      restaurantStars,
      deliveryPartnerStars: partnerStars,
      comment: comment.trim() || undefined,
    });
    await submitRating(rating);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Rate Order" />
        <View style={styles.center}>
          <Icon name="star" size={46} color={colors.warning} />
          <Text style={typography.h1}>Thanks for rating!</Text>
          <Text style={styles.copy}>Your feedback helps {order.restaurantName} and Goocart improve.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to Home" onPress={() => router.replace("/(tabs)/home")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Rate Order" subtitle={order.restaurantName} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={typography.h2}>How was your food?</Text>
        <StarRating value={foodStars} onChange={setFoodStars} />

        <View style={styles.group}>
          <Text style={typography.bodyStrong}>Restaurant</Text>
          <StarRating value={restaurantStars} onChange={setRestaurantStars} size={24} />
        </View>

        <View style={styles.group}>
          <Text style={typography.bodyStrong}>Delivery Partner</Text>
          <StarRating value={partnerStars} onChange={setPartnerStars} size={24} />
        </View>

        <Text style={[typography.captionStrong, { marginTop: spacing.lg }]}>Tell us more (optional)</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Share your experience..."
          placeholderTextColor={colors.muted}
          multiline
          style={styles.textarea}
        />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Submit Rating" onPress={() => void submit()} disabled={foodStars === 0} />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, gap: spacing.md },
  group: { marginTop: spacing.lg, gap: spacing.sm },
  textarea: { minHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, ...typography.body, textAlignVertical: "top" },
  footer: { padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.xl },
  thanksIcon: { fontSize: 44, color: colors.warning },
  copy: { ...typography.body, color: colors.muted, textAlign: "center" },
});
