import { renderAppIcon } from "../render";

/** GET /icons/icon-192.png — generated PWA icon (prerendered at build time). */
export function GET() {
  return renderAppIcon(192, "any");
}
