import { Image } from "react-native";

// Real artwork (see assets/images/logo-full.png), not a CSS-drawn stand-in —
// `size` is the rendered height; width follows the logo's own aspect ratio
// so it never looks stretched at any scale it's used at across the app.
const ASPECT_RATIO = 960 / 161;

export function Brand({ size = 32 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/images/logo-full.png")}
      style={{ height: size, width: size * ASPECT_RATIO }}
      resizeMode="contain"
      accessibilityLabel="Goocart"
    />
  );
}
