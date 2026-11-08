import { renderAppIcon } from "../render";

/** GET /icons/maskable-512.png — generated PWA icon (prerendered at build time). */
export function GET() {
  return renderAppIcon(512, "maskable");
}
