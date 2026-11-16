export type Bounds = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

export const distanceOutsideBounds = (point: Point, bounds: Bounds): number => Math.max(
  bounds.left - point.x,
  point.x - (bounds.left + bounds.width),
  bounds.top - point.y,
  point.y - (bounds.top + bounds.height),
  0,
);

export const hasDetachIntent = (point: Point, bounds: Bounds, alreadyDetached: boolean, enterThreshold = 96, returnThreshold = 48): boolean => (
  distanceOutsideBounds(point, bounds) > (alreadyDetached ? returnThreshold : enterThreshold)
);

export const moveItemsBetweenBoards = <T extends { id: string; itemIds: string[]; preserveWhenEmpty?: boolean }>(
  outfits: T[], destinationId: string, itemIds: string[],
): T[] => {
  const moving = new Set(itemIds);
  return outfits.flatMap((outfit) => {
    if (outfit.id === destinationId) {
      return [{ ...outfit, itemIds: [...new Set([...outfit.itemIds, ...itemIds])], preserveWhenEmpty: false }];
    }
    const remainingIds = outfit.itemIds.filter((id) => !moving.has(id));
    return outfit.itemIds.some((id) => moving.has(id)) && remainingIds.length === 0
      ? []
      : [{ ...outfit, itemIds: remainingIds }];
  });
};

export const nudgeBoardAndItems = <I extends { id: string; x: number; y: number }, O extends { id: string; itemIds: string[]; customLeft?: number; customTop?: number }>(
  items: I[], outfits: O[], boardId: string, dx: number, dy: number,
): { items: I[]; outfits: O[] } => {
  const board = outfits.find((outfit) => outfit.id === boardId);
  if (!board) return { items, outfits };
  const members = new Set(board.itemIds);
  return {
    items: items.map((item) => members.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item),
    outfits: outfits.map((outfit) => outfit.id === boardId ? {
      ...outfit,
      customLeft: outfit.customLeft === undefined ? undefined : outfit.customLeft + dx,
      customTop: outfit.customTop === undefined ? undefined : outfit.customTop + dy,
    } : outfit),
  };
};
