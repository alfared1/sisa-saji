/**
 * Pure layout decisions for /map (unit-tested in tests/unit/dp1-map-layout.test.ts).
 *
 * Phones: the floating header covers the top of the map and the floating cart
 * bar the bottom, so fitting the radius keeps those areas clear; the pin
 * preview is a bottom sheet.
 * Laptops (lg+): the controls live in the side panel, so the map has no
 * overlays to avoid; the preview opens inline in the side panel list and a
 * hovered list item highlights its pin.
 */
export type MapFitPadding = { top: number; bottom: number };

export function mapFitPadding({ desktop, hasCart }: { desktop: boolean; hasCart: boolean }): MapFitPadding {
  if (desktop) return { top: 0, bottom: 0 };
  return { top: 130, bottom: hasCart ? 96 : 16 };
}

/** Pin to emphasise on the map: hovering a list item wins on desktop. */
export function highlightedPinId({
  desktop,
  hoveredId,
  selectedId,
}: {
  desktop: boolean;
  hoveredId: string | null;
  selectedId: string | null;
}): string | null {
  return desktop ? (hoveredId ?? selectedId) : selectedId;
}

/** The phone bottom sheet is only used below lg; on desktop the side panel shows the preview. */
export function showsPreviewSheet({ desktop, selectedId }: { desktop: boolean; selectedId: string | null }): boolean {
  return !desktop && selectedId !== null;
}

/** DOM id of a merchant row in the desktop side panel (for scrollIntoView). */
export function mapListItemId(merchantId: string): string {
  return `peta-warung-${merchantId}`;
}
