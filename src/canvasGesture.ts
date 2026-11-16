export type CanvasGestureKind = 'pan' | 'select' | 'item' | 'item-resize' | 'board' | 'board-resize' | 'element' | 'element-resize' | 'section' | 'section-resize';

export type CanvasGesture = {
  kind: CanvasGestureKind;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  dragging: boolean;
};

export const CANVAS_TOUCH_DRAG_THRESHOLD = 9;

export const startCanvasGesture = (kind: CanvasGestureKind, pointerId: number, pointerType: string, x: number, y: number): CanvasGesture => ({
  kind, pointerId, pointerType, startX: x, startY: y, dragging: false,
});

export const gestureMatches = (gesture: CanvasGesture | null, kind: CanvasGestureKind, pointerId: number): gesture is CanvasGesture => (
  gesture?.kind === kind && gesture.pointerId === pointerId
);

export const clearCanvasGesture = (gesture: CanvasGesture | null, kind: CanvasGestureKind, pointerId: number): CanvasGesture | null => (
  gestureMatches(gesture, kind, pointerId) ? null : gesture
);

export const canStartObjectGesture = (button: number, navigationMode: boolean, interactiveChild: boolean): boolean => (
  button === 0 && !navigationMode && !interactiveChild
);

export const advanceCanvasGesture = (gesture: CanvasGesture, pointerId: number, x: number, y: number): CanvasGesture => {
  if (gesture.pointerId !== pointerId || gesture.dragging) return gesture;
  // A coarse pointer needs more travel to separate an intentional drag from tap jitter.
  const threshold = gesture.pointerType === 'touch' ? CANVAS_TOUCH_DRAG_THRESHOLD : 5;
  return Math.hypot(x - gesture.startX, y - gesture.startY) >= threshold ? { ...gesture, dragging: true } : gesture;
};

export const selectionAfterItemTap = (selected: string[], id: string, additive: boolean): string[] => {
  if (!additive) return selected.length === 1 && selected[0] === id ? selected : [id];
  return selected.includes(id) ? selected.filter((selectedId) => selectedId !== id) : [...selected, id];
};

export const canvasWheelPan = (deltaX: number, deltaY: number, deltaMode: number, viewportHeight: number, shiftKey: boolean): { x: number; y: number } => {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1;
  const horizontal = shiftKey && !deltaX ? deltaY : deltaX;
  const vertical = shiftKey && !deltaX ? 0 : deltaY;
  return {
    x: horizontal === 0 ? 0 : -horizontal * unit,
    y: vertical === 0 ? 0 : -vertical * unit,
  };
};
