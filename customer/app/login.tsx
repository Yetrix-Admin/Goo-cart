import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Brand } from "@/components/Brand";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore, type OtpPurpose } from "@/store/useAuthStore";
import { ApiError } from "@/services/apiClient";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

type Mode = "mobile" | "email" | "password";
type Step = "identify" | "verify";

export default function LoginScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = params.returnTo && typeof params.returnTo === "string" ? params.returnTo : "/(tabs)/home";

  const [mode, setMode] = useState<Mode>("mobile");
  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<OtpPurpose>("LOGIN");
  const [hint, setHint] = useState("");

  // Password fallback (spec section 4: OTP is primary, password is optional).
  const [pwMode, setPwMode] = useState<"login" | "signup">("login");
  const [pwEmail, setPwEmail] = useState("");
  const [pwPassword, setPwPassword] = useState("");
  const [pwName, setPwName] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const requestOtp = useAuthStore((s) => s.requestOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);

  const goToApp = () => router.replace(returnTo as any);

  const submitIdentifier = async () => {
    setError("");
    const trimmed = identifier.trim();
    const valid = mode === "email" ? EMAIL_RE.test(trimmed) : PHONE_RE.test(trimmed);
    if (!valid) {
      setError(mode === "email" ? "Enter a valid email address." : "Enter a valid mobile number.");
      return;
    }
    setBusy(true);
    try {
      const result = await requestOtp(trimmed);
      setPurpose(result.purpose);
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
    if (purpose === "SIGNUP" && name.trim().length < 2) {
      setError("Enter your full name to finish creating your account.");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(identifier.trim(), purpose, code.trim(), name.trim() || undefined);
      goToApp();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That code is incorrect or has expired.");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setError("");
    if (!EMAIL_RE.test(pwEmail.trim())) return setError("Enter a valid email address.");
    if (pwPassword.length < 8) return setError("Password must be at least 8 characters.");
    if (pwMode === "signup" && pwName.trim().length < 2) return setError("Enter your full name.");

    setBusy(true);
    try {
      if (pwMode === "signup") await signUp(pwEmail.trim(), pwPassword, pwName.trim());
      else await signIn(pwEmail.trim(), pwPassword);
      goToApp();
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
            <Text style={typography.h1}>{purpose === "SIGNUP" && step === "verify" ? "Almost there" : "Sign in to continue"}</Text>
            <Text style={styles.copy}>Your cart is saved — sign in to place your order.</Text>
          </View>

          {mode !== "password" ? (
            <>
              <View style={styles.tabs}>
                <Tab label="Mobile OTP" active={mode === "mobile"} onPress={() => { setMode("mobile"); setStep("identify"); setError(""); }} />
                <Tab label="Email OTP" active={mode === "email"} onPress={() => { setMode("email"); setStep("identify"); setError(""); }} />
              </View>

              {step === "identify" ? (
                <>
                  <Field
                    label={mode === "email" ? "Email" : "Mobile number"}
                    value={identifier}
                    onChangeText={setIdentifier}
                    keyboardType={mode === "email" ? "email-address" : "phone-pad"}
                    autoCapitalize="none"
                  />
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  <PrimaryButton label={busy ? "Please wait…" : "Send code"} onPress={() => void submitIdentifier()} disabled={busy} />
                </>
              ) : (
                <>
                  {hint ? <Text style={styles.hint}>{hint}</Text> : null}
                  {purpose === "SIGNUP" ? <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" /> : null}
                  <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  <PrimaryButton label={busy ? "Verifying…" : "Verify & continue"} onPress={() => void submitCode()} disabled={busy} />
                  <Pressable style={styles.switch} onPress={() => { setStep("identify"); setCode(""); setError(""); }}>
                    <Text style={styles.switchText}>Use a different {mode === "email" ? "email" : "number"}</Text>
                  </Pressable>
                </>
              )}

              <Pressable style={styles.switch} onPress={() => { setMode("password"); setError(""); }}>
                <Text style={styles.switchText}>Use email & password instead</Text>
              </Pressable>
            </>
          ) : (
            <>
              {pwMode === "signup" ? <Field label="Full name" value={pwName} onChangeText={setPwName} autoCapitalize="words" /> : null}
              <Field label="Email" value={pwEmail} onChangeText={setPwEmail} keyboardType="email-address" autoCapitalize="none" />
              <Field label="Password" value={pwPassword} onChangeText={setPwPassword} secureTextEntry />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PrimaryButton label={busy ? "Please wait…" : pwMode === "signup" ? "Create account" : "Sign in"} onPress={() => void submitPassword()} disabled={busy} />
              <Pressable style={styles.switch} onPress={() => { setPwMode(pwMode === "signup" ? "login" : "signup"); setError(""); }}>
                <Text style={styles.switchText}>{pwMode === "signup" ? "Already have an account? Sign in" : "New to Goocart? Create an account"}</Text>
              </Pressable>
              <Pressable style={styles.switch} onPress={() => { setMode("mobile"); setStep("identify"); setError(""); }}>
                <Text style={styles.switchText}>Use OTP instead</Text>
              </Pressable>
            </>
          )}

          <Pressable style={styles.switch} onPress={() => router.back()}>
            <Text style={styles.switchText}>Not now — keep browsing</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
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
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  tabText: { ...typography.captionStrong, color: colors.muted },
  tabTextActive: { color: colors.primary },
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
