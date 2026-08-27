import { TextStyle } from "react-native";
import { colors } from "./colors";

export const typography = {
  display: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.5 } satisfies TextStyle,
  h1: { fontSize: 24, fontWeight: "700", color: colors.text } satisfies TextStyle,
  h2: { fontSize: 19, fontWeight: "700", color: colors.text } satisfies TextStyle,
  h3: { fontSize: 15, fontWeight: "700", color: colors.text } satisfies TextStyle,
  body: { fontSize: 14, fontWeight: "400", color: colors.text } satisfies TextStyle,
  bodyStrong: { fontSize: 14, fontWeight: "600", color: colors.text } satisfies TextStyle,
  caption: { fontSize: 12, fontWeight: "400", color: colors.muted } satisfies TextStyle,
  captionStrong: { fontSize: 12, fontWeight: "700", color: colors.muted } satisfies TextStyle,
  eyebrow: { fontSize: 11, fontWeight: "800", color: colors.primary, letterSpacing: 1.2, textTransform: "uppercase" } satisfies TextStyle,
  button: { fontSize: 15, fontWeight: "700", color: colors.white } satisfies TextStyle,
} as const;
