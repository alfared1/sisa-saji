import { renderAppIcon } from "./icons/render";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon: full-bleed square (iOS applies its own mask). */
export default function AppleIcon() {
  return renderAppIcon(size.width, "maskable");
}
