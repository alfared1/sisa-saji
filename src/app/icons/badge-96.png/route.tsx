import { renderAppIcon } from "../render";

/** GET /icons/badge-96.png — generated PWA icon (prerendered at build time). */
export function GET() {
  return renderAppIcon(96, "badge");
}
