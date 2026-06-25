export type OverlayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const OVERLAY_COMPACT_SIZE = { width: 420, height: 72 };
export const OVERLAY_EXPANDED_SIZE = { width: 520, height: 420 };
export const OVERLAY_SCREEN_MARGIN = 18;

type WorkArea = Pick<OverlayBounds, "x" | "y" | "width" | "height">;

export function getTopRightOverlayBounds(
  workArea: WorkArea,
  compactSize = OVERLAY_COMPACT_SIZE,
  margin = OVERLAY_SCREEN_MARGIN
): OverlayBounds {
  return {
    width: compactSize.width,
    height: compactSize.height,
    x: workArea.x + workArea.width - compactSize.width - margin,
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
