import { renderAppIcon } from "../render";

/** GET /icons/icon-512.png — generated PWA icon (prerendered at build time). */
export function GET() {
  return renderAppIcon(512, "any");
}
