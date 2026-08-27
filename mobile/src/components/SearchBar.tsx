import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";
import { Icon } from "@/components/Icon";

type Props = {
  placeholder: string;
  value?: string;
  onChangeText?: (text: string) => void;
  editable?: boolean;
  onPress?: () => void;
};

export function SearchBar({ placeholder, value, onChangeText, editable = true, onPress }: Props) {
  const content = (
    <View style={styles.wrap}>
      <Icon name="search" size={19} color={colors.muted} />
      <TextInput
        pointerEvents={editable ? "auto" : "none"}
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    height: 52,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  input: { flex: 1, ...typography.body, padding: 0 },
});
