import { describe, expect, it } from "vitest";
import {
  highlightedPinId,
  mapFitPadding,
  mapListItemId,
  showsPreviewSheet,
} from "@/components/customer/map/map-layout";

describe("/map layout logic", () => {
  it("keeps the phone fit padding for the floating header and cart bar", () => {
    expect(mapFitPadding({ desktop: false, hasCart: false })).toEqual({ top: 130, bottom: 16 });
    expect(mapFitPadding({ desktop: false, hasCart: true })).toEqual({ top: 130, bottom: 96 });
  });

  it("uses no overlay padding on desktop (controls live in the side panel)", () => {
    expect(mapFitPadding({ desktop: true, hasCart: true })).toEqual({ top: 0, bottom: 0 });
  });

  it("highlights the hovered list row's pin on desktop only", () => {
    expect(highlightedPinId({ desktop: true, hoveredId: "a", selectedId: "b" })).toBe("a");
    expect(highlightedPinId({ desktop: true, hoveredId: null, selectedId: "b" })).toBe("b");
    expect(highlightedPinId({ desktop: false, hoveredId: "a", selectedId: "b" })).toBe("b");
    expect(highlightedPinId({ desktop: false, hoveredId: "a", selectedId: null })).toBeNull();
  });

  it("opens the bottom sheet preview on phones only", () => {
    expect(showsPreviewSheet({ desktop: false, selectedId: "a" })).toBe(true);
    expect(showsPreviewSheet({ desktop: false, selectedId: null })).toBe(false);
    expect(showsPreviewSheet({ desktop: true, selectedId: "a" })).toBe(false);
  });

  it("builds stable DOM ids for the side panel rows", () => {
    expect(mapListItemId("m-1")).toBe("peta-warung-m-1");
  });
});
