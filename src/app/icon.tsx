import { renderAppIcon } from "./icons/render";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Browser-tab icon (generated). */
export default function Icon() {
  return renderAppIcon(size.width, "any");
}
