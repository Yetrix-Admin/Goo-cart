import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { serviceJobService } from "@/services/ServiceJobService";
import { colors, radius, spacing, typography } from "@/theme";
import { ServiceJob, ServiceJobStatus } from "@/types";

const POLL_INTERVAL_MS = 5000;

const RIDE_NEXT: Partial<Record<ServiceJobStatus, { to: ServiceJobStatus; label: string }>> = {
  PARTNER_ASSIGNED: { to: "ARRIVING", label: "Heading to pickup" },
  ARRIVING: { to: "IN_PROGRESS", label: "Start ride" },
};

const DELIVERY_NEXT: Partial<Record<ServiceJobStatus, { to: ServiceJobStatus; label: string }>> = {
  PARTNER_ASSIGNED: { to: "PICKED_UP", label: "Mark picked up" },
  PICKED_UP: { to: "IN_TRANSIT", label: "Start delivery" },
};

export default function ServiceTaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const job = useMemo(() => jobs.find((row) => row.id === id), [jobs, id]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await serviceJobService.list();
      setJobs(rows);
      setNotFound(!rows.some((row) => row.id === id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this job");
    }
  }, [id]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const advance = async (to: ServiceJobStatus, otp?: string) => {
    if (!id) return;
    setError("");
    setBusy(true);
    try {
      await serviceJobService.transition(id, to, otp);
      await load();
      if (to === "DELIVERED" || to === "COMPLETED") router.replace("/(tabs)/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update this job");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!job) return;
    if (code.trim().length !== 4) {
      setError("Enter the 4-digit code from the customer.");
      return;
    }
    await advance(job.service === "Bike Taxi" ? "COMPLETED" : "DELIVERED", code.trim());
  };

  if (notFound && !job) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Job" onBack={() => router.replace("/(tabs)/home")} />
        <EmptyState icon="alert" title="This job is no longer available" copy="It may have been cancelled or assigned to someone else." />
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScreenHeader title="Job" onBack={() => router.replace("/(tabs)/home")} />
        <View style={styles.center}>
          <Text style={styles.copy}>Loading job...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isRide = job.service === "Bike Taxi";
  const isFinal = job.status === "DELIVERED" || job.status === "COMPLETED";
  const next = isRide ? RIDE_NEXT[job.status] : DELIVERY_NEXT[job.status];
  const awaitingOtp = isRide ? job.status === "IN_PROGRESS" : job.status === "IN_TRANSIT";
  const items = Array.isArray(job.details.items) ? job.details.items as Array<{ name?: string; quantity?: number; qty?: number }> : [];
  const phone = String(job.details.contactPhone ?? "");
  const address = job.details.address && typeof job.details.address === "object"
    ? Object.values(job.details.address as Record<string, unknown>).filter(Boolean).join(", ")
    : String(job.details.address ?? "Customer address");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={job.service} subtitle={job.reference} onBack={() => router.replace("/(tabs)/home")} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {isFinal ? (
          <View style={styles.doneCard}>
            <Icon name="checkCircle" size={52} color={colors.success} />
            <Text style={typography.h1}>Completed</Text>
            <Text style={styles.copy}>This job is finished.</Text>
            <PrimaryButton label="Back to Home" onPress={() => router.replace("/(tabs)/home")} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={typography.eyebrow}>JOB</Text>
              <Text style={typography.h3}>{job.vendorName}</Text>
              <Text style={styles.copy}>{job.status.replaceAll("_", " ")} · ₹{job.total}</Text>
            </View>

            <View style={styles.card}>
              <Text style={typography.eyebrow}>{isRide ? "RIDE" : "ROUTE"}</Text>
              <Text style={typography.h3}>{String(job.details.pickup ?? job.vendorName)}</Text>
              <Text style={styles.copy}>To: {String(job.details.drop ?? address)}</Text>
              {phone ? (
                <Text style={styles.callText} onPress={() => void Linking.openURL(`tel:${phone}`)}>
                  Call customer: {phone}
                </Text>
              ) : null}
            </View>

            {items.length ? (
              <View style={styles.card}>
                <Text style={typography.eyebrow}>ITEMS</Text>
                {items.map((item, index) => (
                  <Text key={`${item.name ?? "item"}-${index}`} style={styles.copy}>
                    {Number(item.quantity ?? item.qty ?? 1)} x {String(item.name ?? "Item")}
                  </Text>
                ))}
              </View>
            ) : null}

            {awaitingOtp ? (
              <View style={styles.card}>
                <Text style={typography.eyebrow}>VERIFY CUSTOMER</Text>
                <Text style={styles.copy}>Ask the customer for their 4-digit code to finish this job.</Text>
                <TextInput
                  style={styles.otpInput}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="0000"
                  placeholderTextColor={colors.muted}
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <PrimaryButton label={busy ? "Please wait..." : isRide ? "Complete ride" : "Complete delivery"} onPress={() => void complete()} disabled={busy} />
              </View>
            ) : next ? (
              <>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <PrimaryButton label={busy ? "Please wait..." : next.label} onPress={() => void advance(next.to)} disabled={busy} />
              </>
            ) : (
              <EmptyState icon="alert" title="Waiting for update" copy="This job cannot move forward from the current status." />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  copy: { ...typography.body, color: colors.muted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: 6 },
  callText: { ...typography.bodyStrong, color: colors.primary },
  otpInput: {
    height: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 8,
    color: colors.text,
    textAlign: "center",
  },
  error: { ...typography.caption, color: colors.error },
  doneCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
});
