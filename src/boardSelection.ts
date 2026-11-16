import type { Board } from './App';

export const toggleBoardSelection = (selectedIds: string[], boardId: string, availableIds: string[]) => {
  const available = new Set(availableIds);
  const selected = selectedIds.filter((id) => available.has(id));
  if (!available.has(boardId)) return selected;
  return selected.includes(boardId) ? selected.filter((id) => id !== boardId) : [...selected, boardId];
};

export const bulkBoardDeleteLabel = (selectedCount: number, totalCount: number) => {
  if (!selectedCount || !totalCount || (selectedCount < 2 && selectedCount !== totalCount)) return null;
  return selectedCount === totalCount ? 'Delete all boards' : 'Delete selected boards';
};

export const dissolveBoardsPreservingItems = (board: Board, boardIds: string[]): Board => {
  const removed = new Set(boardIds.filter((id) => board.outfits.some((outfit) => outfit.id === id)));
  if (!removed.size) return board;
  return {
    ...board,
    // Item records already use absolute canvas coordinates; removing Board membership
    // leaves each Item at the same position and keeps every product field intact.
    items: board.items,
    outfits: board.outfits.filter((outfit) => !removed.has(outfit.id)),
    sections: board.sections?.map((section) => ({ ...section, boardIds: section.boardIds.filter((id) => !removed.has(id)) })),
  };
};

export const deleteBoardsAndContents = (board: Board, boardIds: string[]): Board => {
  const removedBoards = new Set(boardIds.filter((id) => board.outfits.some((outfit) => outfit.id === id)));
  if (!removedBoards.size) return board;
  const removedItems = new Set(board.outfits.filter((outfit) => removedBoards.has(outfit.id)).flatMap((outfit) => outfit.itemIds));
  return {
    ...board,
    items: board.items.filter((item) => !removedItems.has(item.id)),
    outfits: board.outfits.flatMap((outfit) => {
      if (removedBoards.has(outfit.id)) return [];
      const itemIds = outfit.itemIds.filter((id) => !removedItems.has(id));
      return itemIds.length || outfit.preserveWhenEmpty ? [{ ...outfit, itemIds }] : [];
    }),
    sections: board.sections?.map((section) => ({
      ...section,
      boardIds: section.boardIds.filter((id) => !removedBoards.has(id)),
      itemIds: section.itemIds.filter((id) => !removedItems.has(id)),
    })),
  };
};
