export type OverlayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OverlayMode = "default" | "mini" | "tiny" | "expanded";

export const OVERLAY_DEFAULT_SIZE = { width: 700, height: 200 };
export const OVERLAY_COMPACT_SIZE = OVERLAY_DEFAULT_SIZE;
export const OVERLAY_MINI_SIZE = { width: 500, height: 66 };
export const OVERLAY_TINY_SIZE = { width: 196, height: 58 };
export const OVERLAY_EXPANDED_SIZE = { width: 700, height: 900 };
export const OVERLAY_SCREEN_MARGIN = 34;

export function getOverlaySize(mode: OverlayMode): Pick<OverlayBounds, "width" | "height"> {
  if (mode === "expanded") {
    return OVERLAY_EXPANDED_SIZE;
  }

  if (mode === "mini") {
    return OVERLAY_MINI_SIZE;
  }

  if (mode === "tiny") {
    return OVERLAY_TINY_SIZE;
  }

  return OVERLAY_DEFAULT_SIZE;
}

type WorkArea = Pick<OverlayBounds, "x" | "y" | "width" | "height">;

export function getTopRightOverlayBounds(
  workArea: WorkArea,
  compactSize = OVERLAY_COMPACT_SIZE,
  margin = OVERLAY_SCREEN_MARGIN
): OverlayBounds {
  const width = Math.min(compactSize.width, Math.max(1, workArea.width - margin * 2));
  const height = Math.min(compactSize.height, Math.max(1, workArea.height - margin * 2));

  return {
    width,
    height,
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + margin
  };
}

export function calculateExpandedOverlayBounds(
  anchor: OverlayBounds,
  workArea: WorkArea,
  expandedSize = OVERLAY_EXPANDED_SIZE,
  margin = OVERLAY_SCREEN_MARGIN
): OverlayBounds {
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const width = Math.min(expandedSize.width, Math.max(1, workArea.width - margin * 2));
  const height = Math.min(expandedSize.height, Math.max(1, workArea.height - margin * 2));

  return {
    width,
    height,
    x: Math.max(workArea.x + margin, Math.min(anchor.x, right - width - margin)),
    y: Math.max(workArea.y + margin, Math.min(anchor.y, bottom - height - margin))
  };
}
