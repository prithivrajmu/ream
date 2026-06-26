import { describe, expect, it } from "vitest";
import {
  calculateExpandedOverlayBounds,
  getTopRightOverlayBounds,
  OVERLAY_COMPACT_SIZE,
  OVERLAY_EXPANDED_SIZE
} from "../shared/overlayBounds";

describe("overlay bounds", () => {
  it("places the compact overlay at the top center of the work area", () => {
    expect(getTopRightOverlayBounds({ x: 0, y: 0, width: 1440, height: 900 })).toEqual({
      width: OVERLAY_COMPACT_SIZE.width,
      height: OVERLAY_COMPACT_SIZE.height,
      x: 440,
      y: 34
    });
  });

  it("preserves dragged coordinates when expansion fits", () => {
    expect(
      calculateExpandedOverlayBounds(
        { x: 240, y: 20, width: OVERLAY_COMPACT_SIZE.width, height: OVERLAY_COMPACT_SIZE.height },
        { x: 0, y: 0, width: 1440, height: 900 }
      )
    ).toEqual({
      width: OVERLAY_EXPANDED_SIZE.width,
      height: 832,
      x: 240,
      y: 34
    });
  });

  it("expands inward when the compact bar is near screen edges", () => {
    expect(
      calculateExpandedOverlayBounds(
        { x: 1350, y: 820, width: OVERLAY_COMPACT_SIZE.width, height: OVERLAY_COMPACT_SIZE.height },
        { x: 0, y: 0, width: 1440, height: 900 }
      )
    ).toEqual({
      width: OVERLAY_EXPANDED_SIZE.width,
      height: 832,
      x: 846,
      y: 34
    });
  });

  it("keeps expansion inside a non-origin work area", () => {
    expect(
      calculateExpandedOverlayBounds(
        { x: 1810, y: 60, width: OVERLAY_COMPACT_SIZE.width, height: OVERLAY_COMPACT_SIZE.height },
        { x: 1440, y: 24, width: 900, height: 700 }
      )
    ).toEqual({
      width: 560,
      height: 632,
      x: 1746,
      y: 58
    });
  });

  it("shrinks the expanded overlay when the work area is smaller than the preferred size", () => {
    expect(
      calculateExpandedOverlayBounds(
        { x: 40, y: 50, width: OVERLAY_COMPACT_SIZE.width, height: OVERLAY_COMPACT_SIZE.height },
        { x: 0, y: 0, width: 480, height: 360 }
      )
    ).toEqual({
      width: 412,
      height: 292,
      x: 34,
      y: 34
    });
  });
});
