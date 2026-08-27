import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Brand } from "@/components/Brand";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

type Mode = "otp" | "password";
type Step = "identify" | "verify";

// No self-signup: an admin creates every Delivery Partner App account (spec
// section 23), and the account signs in with an OTP the same way a Vendor
// App user does. Password stays as a fallback for pre-existing accounts.
export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>("otp");
  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState("");

  const [pwEmail, setPwEmail] = useState("");
  const [pwPassword, setPwPassword] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const requestOtp = useAuthStore((s) => s.requestOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const signIn = useAuthStore((s) => s.signIn);

  const submitIdentifier = async () => {
    setError("");
    const trimmed = identifier.trim();
    if (!EMAIL_RE.test(trimmed) && !PHONE_RE.test(trimmed)) {
      setError("Enter the email or mobile number your admin registered for you.");
      return;
    }
    setBusy(true);
    try {
      const result = await requestOtp(trimmed);
      setHint(result.message);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send a code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError("");
    if (!/^[0-9]{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(identifier.trim(), code.trim());
      router.replace("/(tabs)/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code is incorrect or has expired.");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setError("");
    if (!EMAIL_RE.test(pwEmail.trim()) || !pwPassword) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await signIn(pwEmail.trim(), pwPassword);
      router.replace("/(tabs)/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Brand size={32} />

          <View style={styles.hero}>
            <Text style={typography.h1}>Delivery partner sign in</Text>
            <Text style={styles.copy}>Sign in with the account your admin set up for you.</Text>
          </View>

          {mode === "otp" ? (
            step === "identify" ? (
              <>
                <Field label="Email or mobile number" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <PrimaryButton label={busy ? "Please wait…" : "Send code"} onPress={() => void submitIdentifier()} disabled={busy} />
              </>
            ) : (
              <>
                {hint ? <Text style={styles.hint}>{hint}</Text> : null}
                <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <PrimaryButton label={busy ? "Verifying…" : "Verify & continue"} onPress={() => void submitCode()} disabled={busy} />
                <Pressable style={styles.switch} onPress={() => { setStep("identify"); setCode(""); setError(""); }}>
                  <Text style={styles.switchText}>Use a different email or number</Text>
                </Pressable>
              </>
            )
          ) : (
            <>
              <Field label="Email" value={pwEmail} onChangeText={setPwEmail} keyboardType="email-address" autoCapitalize="none" />
              <Field label="Password" value={pwPassword} onChangeText={setPwPassword} secureTextEntry />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PrimaryButton label={busy ? "Please wait…" : "Sign in"} onPress={() => void submitPassword()} disabled={busy} />
            </>
          )}

          <Pressable style={styles.switch} onPress={() => { setMode(mode === "otp" ? "password" : "otp"); setStep("identify"); setError(""); }}>
            <Text style={styles.switchText}>{mode === "otp" ? "Have a password instead? Sign in with it" : "Use OTP instead"}</Text>
          </Pressable>
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
      <TextInput style={styles.input} placeholderTextColor={colors.muted} autoCorrect={false} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  hero: { gap: spacing.xs },
  copy: { ...typography.body, color: colors.muted },
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
  error: { ...typography.caption, color: colors.error },
  hint: { ...typography.caption, color: colors.muted },
  switch: { alignItems: "center", paddingVertical: spacing.sm },
  switchText: { ...typography.captionStrong, color: colors.primary },
});
