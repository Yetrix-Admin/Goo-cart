import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Brand } from "@/components/Brand";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError } from "@/services/apiClient";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;

type Mode = "login" | "signup";

export default function LoginScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = params.returnTo && typeof params.returnTo === "string" ? params.returnTo : "/(tabs)/home";

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);

  const goToApp = () => router.replace(returnTo as any);
  const continueAsGuest = () => router.replace("/(tabs)/home");

  const submit = async () => {
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (mode === "signup") {
      if (name.trim().length < 2) return setError("Enter your full name.");
      if (!USERNAME_RE.test(username.trim())) return setError("Username must be 3–30 letters, numbers, dots or underscores.");
      if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
      if (!PHONE_RE.test(phone.trim())) return setError("Enter a valid mobile number.");
      if (password !== confirmPassword) return setError("Passwords do not match.");
    } else {
      const id = identifier.trim();
      if (!id) return setError("Enter your email, phone number or username.");
    }

    setBusy(true);
    try {
      if (mode === "signup") await signUp({ email: email.trim(), phone: phone.trim(), username: username.trim().toLowerCase(), password, name: name.trim() });
      else await signIn(identifier.trim(), password);
      goToApp();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
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
            <Text style={typography.h1}>{mode === "signup" ? "Create your account" : "Sign in to continue"}</Text>
            <Text style={styles.copy}>Browse as a guest now. Sign in only when you’re ready to order.</Text>
          </View>

          {mode === "login" ? (
            <Field label="Email / phone / username" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" keyboardType="email-address" />
          ) : (
            <>
              <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
              <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
              <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            </>
          )}
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {mode === "signup" ? <Field label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry /> : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {mode === "login" ? <PrimaryButton label="Login as guest" onPress={continueAsGuest} disabled={busy} /> : null}
          <PrimaryButton label={busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"} onPress={() => void submit()} disabled={busy} />

          <Pressable style={styles.switch} onPress={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}>
            <Text style={styles.switchText}>{mode === "signup" ? "Already have an account? Sign in" : "New to Goocart? Create an account"}</Text>
          </Pressable>

          {mode === "signup" ? (
            <Pressable style={styles.switch} onPress={continueAsGuest}>
              <Text style={styles.switchText}>Not now — continue as guest</Text>
            </Pressable>
          ) : null}
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
  switch: { alignItems: "center", paddingVertical: spacing.sm },
  switchText: { ...typography.captionStrong, color: colors.primary },
});
