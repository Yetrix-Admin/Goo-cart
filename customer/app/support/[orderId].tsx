import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";
import { supportService } from "@/services/SupportService";
import { SUPPORT_REASONS, SupportReason, SupportTicket } from "@/types";

export default function SupportScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [reason, setReason] = useState<SupportReason | null>(null);
  const [details, setDetails] = useState("");
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!reason || !orderId) return;
    setBusy(true);
    setError("");
    try {
      setTicket(await supportService.createTicket(orderId, reason, details.trim() || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create support ticket");
    } finally {
      setBusy(false);
    }
  };

  if (ticket) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Support" />
        <View style={styles.center}>
          <View style={styles.check}>
            <Icon name="check" size={30} color={colors.white} />
          </View>
          <Text style={typography.h1}>Ticket created</Text>
          <Text style={styles.ticketId}>#{ticket.id}</Text>
          <Text style={styles.copy}>Our team will review your {ticket.reason.toLowerCase()} report and follow up.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to Order" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Get Help" />
      <View style={styles.content}>
        <Text style={typography.h2}>What&apos;s wrong with this order?</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {SUPPORT_REASONS.map((r) => (
            <Pressable key={r} style={[styles.reasonRow, reason === r && styles.reasonRowActive]} onPress={() => setReason(r)}>
              <View style={[styles.radio, reason === r && styles.radioActive]}>{reason === r ? <View style={styles.radioDot} /> : null}</View>
              <Text style={typography.body}>{r}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[typography.captionStrong, { marginTop: spacing.lg }]}>Tell us more (optional)</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder="Add any details that might help..."
          placeholderTextColor={colors.muted}
          multiline
          style={styles.textarea}
        />
      </View>
      <View style={styles.footer}>
        <PrimaryButton label={busy ? "Submitting..." : "Submit"} onPress={() => void submit()} disabled={!reason || busy} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xl },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  reasonRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  textarea: { minHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, ...typography.body, textAlignVertical: "top" },
  footer: { padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.xl },
  check: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.success, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  checkIcon: { color: colors.white, fontSize: 28, fontWeight: "800" },
  ticketId: { ...typography.h2, color: colors.primary },
  copy: { ...typography.body, color: colors.muted, textAlign: "center", marginTop: spacing.sm },
  error: { ...typography.caption, color: colors.error },
});
