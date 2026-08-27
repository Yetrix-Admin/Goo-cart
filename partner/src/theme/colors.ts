export const colors = {
  primary: "#FF6B35",
  primaryMuted: "#FFE8DD",
  secondary: "#FF8A4C",
  dark: "#18181B",
  text: "#27272A",
  muted: "#71717A",
  border: "#E7E4E1",
  surface: "#FFFFFF",
  background: "#FAFAFA",
  success: "#16A34A",
  successMuted: "#DCFCE7",
  warning: "#F59E0B",
  warningMuted: "#FEF3C7",
  error: "#DC2626",
  errorMuted: "#FEE2E2",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export type ColorToken = keyof typeof colors;
