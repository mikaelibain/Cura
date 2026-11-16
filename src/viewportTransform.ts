export type ViewportTransform = { x: number; y: number; zoom: number };
export type ViewportPoint = { x: number; y: number };

export const MIN_CANVAS_ZOOM = 0.02;
export const MAX_CANVAS_ZOOM = 2;

export type SemanticZoom = 'far' | 'mid' | 'near';

export const semanticZoomState = (zoom: number): SemanticZoom => (
  zoom < 0.4 ? 'far' : zoom <= 0.75 ? 'mid' : 'near'
);

export const zoomViewportAt = (
  viewport: ViewportTransform,
  anchor: ViewportPoint,
  zoom: number,
): ViewportTransform => {
  const nextZoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
  const ratio = nextZoom / viewport.zoom;
  return {
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
    zoom: nextZoom,
  };
};

/** Compute every pinch update from its initial snapshot to avoid cumulative drift. */
export const pinchViewport = (
  initial: ViewportTransform,
  initialMidpoint: ViewportPoint,
  currentMidpoint: ViewportPoint,
  initialDistance: number,
  currentDistance: number,
): ViewportTransform => {
  if (initialDistance <= 0 || currentDistance <= 0) return initial;
  const zoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, initial.zoom * currentDistance / initialDistance));
  const worldX = (initialMidpoint.x - initial.x) / initial.zoom;
  const worldY = (initialMidpoint.y - initial.y) / initial.zoom;
  return {
    x: currentMidpoint.x - worldX * zoom,
    y: currentMidpoint.y - worldY * zoom,
    zoom,
  };
};

export const pinchGeometry = (first: ViewportPoint, second: ViewportPoint) => ({
  midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
  distance: Math.hypot(second.x - first.x, second.y - first.y),
});
