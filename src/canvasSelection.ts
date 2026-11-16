export type SelectionRect = { left: number; top: number; right: number; bottom: number };
export type BoardSelectionBounds = SelectionRect & { id: string; itemIds: string[] };
export type ItemSelectionBounds = SelectionRect & { id: string; boardId?: string };
export type CanvasSelection = { itemIds: string[]; boardIds: string[]; sectionIds: string[] };

export const emptyCanvasSelection = (): CanvasSelection => ({ itemIds: [], boardIds: [], sectionIds: [] });

export const boardsEnclosedBy = (
  rect: SelectionRect,
  boardBounds: readonly BoardSelectionBounds[],
): string[] => boardBounds
  .filter((board) => rect.left <= board.left && rect.top <= board.top
    && rect.right >= board.right && rect.bottom >= board.bottom)
  .map((board) => board.id);

const toggleIds = (current: string[], incoming: string[]) => {
  const next = new Set(current);
  incoming.forEach((id) => next.has(id) ? next.delete(id) : next.add(id));
  return [...next];
};

export const normalizeCanvasSelection = (
  selection: CanvasSelection,
  boardBounds: readonly BoardSelectionBounds[],
): CanvasSelection => {
  const selectedBoards = new Set(selection.boardIds);
  const selectedChildren = new Set(boardBounds
    .filter((board) => selectedBoards.has(board.id))
    .flatMap((board) => board.itemIds));
  return {
    itemIds: selection.itemIds.filter((id) => !selectedChildren.has(id)),
    boardIds: [...selectedBoards],
    sectionIds: [...new Set(selection.sectionIds)],
  };
};

export const marqueeCanvasSelection = (
  rect: SelectionRect,
  itemBounds: readonly ItemSelectionBounds[],
  boardBounds: readonly BoardSelectionBounds[],
  current: CanvasSelection = emptyCanvasSelection(),
  additive = false,
): CanvasSelection => {
  const boardIds = boardsEnclosedBy(rect, boardBounds);
  const enclosedBoardIds = new Set(boardIds);
  const itemIds = itemBounds
    .filter((item) => item.left <= rect.right && item.right >= rect.left
      && item.top <= rect.bottom && item.bottom >= rect.top
      && (!item.boardId || !enclosedBoardIds.has(item.boardId)))
    .map((item) => item.id);
  const incoming = { itemIds, boardIds, sectionIds: [] };
  const merged = additive ? {
    itemIds: toggleIds(current.itemIds, itemIds),
    boardIds: toggleIds(current.boardIds, boardIds),
    sectionIds: current.sectionIds,
  } : incoming;
  return normalizeCanvasSelection(merged, boardBounds);
};

export const canvasSelectionAnnouncement = (selection: CanvasSelection): string => {
  const parts = [
    selection.boardIds.length ? `${selection.boardIds.length} ${selection.boardIds.length === 1 ? 'board' : 'boards'}` : '',
    selection.itemIds.length ? `${selection.itemIds.length} ${selection.itemIds.length === 1 ? 'product' : 'products'}` : '',
    selection.sectionIds.length ? `${selection.sectionIds.length} ${selection.sectionIds.length === 1 ? 'section' : 'sections'}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' and ')} selected.` : 'Selection cleared.';
};
