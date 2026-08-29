import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Brand } from "@/components/Brand";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radius, spacing, typography } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// No self-signup: an admin creates every Delivery Partner App account, with
// a password. Sign-in is email + that password.
export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = useAuthStore((s) => s.signIn);

  const submit = async () => {
    setError("");
    if (!EMAIL_RE.test(email.trim()) || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Brand size={32} />

          <View style={styles.hero}>
            <Text style={typography.h1}>Delivery partner sign in</Text>
            <Text style={styles.copy}>Sign in with the account your admin set up for you.</Text>
          </View>

          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton label={busy ? "Please wait…" : "Sign in"} onPress={() => void submit()} disabled={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  secureTextEntry,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={typography.captionStrong}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={[styles.input, secureTextEntry ? styles.inputWithIcon : null]}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          secureTextEntry={secureTextEntry && !visible}
          {...props}
        />
        {secureTextEntry ? (
          <Pressable
            style={styles.visibilityToggle}
            hitSlop={8}
            onPress={() => setVisible((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={visible ? "Hide password" : "Show password"}
          >
            <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
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
  inputWrap: { justifyContent: "center" },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    ...typography.body,
  },
  inputWithIcon: { paddingRight: 44 },
  visibilityToggle: { position: "absolute", right: 0, height: 50, width: 44, alignItems: "center", justifyContent: "center" },
  error: { ...typography.caption, color: colors.error },
  switch: { alignItems: "center", paddingVertical: spacing.sm },
  switchText: { ...typography.captionStrong, color: colors.primary },
});
