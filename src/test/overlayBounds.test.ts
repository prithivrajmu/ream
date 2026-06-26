import { describe, expect, it } from "vitest";
import {
  calculateExpandedOverlayBounds,
  getTopRightOverlayBounds,
  OVERLAY_COMPACT_SIZE,
  OVERLAY_EXPANDED_SIZE
} from "../shared/overlayBounds";

describe("overlay bounds", () => {
  it("places the compact overlay in the top-right work area", () => {
    expect(getTopRightOverlayBounds({ x: 0, y: 0, width: 1440, height: 900 })).toEqual({
      width: OVERLAY_COMPACT_SIZE.width,
      height: OVERLAY_COMPACT_SIZE.height,
      x: 1350,
      y: 18
    });
  });

  it("preserves dragged coordinates when expansion fits", () => {
    expect(
      calculateExpandedOverlayBounds(
        { x: 240, y: 140, width: OVERLAY_COMPACT_SIZE.width, height: OVERLAY_COMPACT_SIZE.height },
        { x: 0, y: 0, width: 1440, height: 900 }
      )
    ).toEqual({
      width: OVERLAY_EXPANDED_SIZE.width,
      height: OVERLAY_EXPANDED_SIZE.height,
      x: 240,
      y: 140
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
      height: OVERLAY_EXPANDED_SIZE.height,
      x: 902,
      y: 462
    });
  });

  it("keeps expansion inside a non-origin work area", () => {
    expect(
      calculateExpandedOverlayBounds(
        { x: 1810, y: 60, width: OVERLAY_COMPACT_SIZE.width, height: OVERLAY_COMPACT_SIZE.height },
        { x: 1440, y: 24, width: 900, height: 700 }
      )
    ).toEqual({
      width: OVERLAY_EXPANDED_SIZE.width,
      height: OVERLAY_EXPANDED_SIZE.height,
      x: 1802,
      y: 60
    });
  });

  it("shrinks the expanded overlay when the work area is smaller than the preferred size", () => {
    expect(
      calculateExpandedOverlayBounds(
        { x: 40, y: 50, width: OVERLAY_COMPACT_SIZE.width, height: OVERLAY_COMPACT_SIZE.height },
        { x: 0, y: 0, width: 480, height: 360 }
      )
    ).toEqual({
      width: 444,
      height: 324,
      x: 18,
      y: 18
    });
  });
});
