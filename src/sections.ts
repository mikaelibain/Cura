import type { Board, Item, Outfit } from './App';

export type SectionStyle = 'paper' | 'sage' | 'blush' | 'cream' | 'outline';
export type CanvasSection = {
  id: string;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  padding?: number;
  style: SectionStyle;
  boardIds: string[];
  itemIds: string[];
};

export const moveSectionFromSnapshot = (board: Board, sectionId: string, dx: number, dy: number,
  snapshot: { section: CanvasSection; outfits: Outfit[]; items: Item[] }): Board => {
  const outfitPositions = new Map(snapshot.outfits.map((outfit) => [outfit.id, outfit]));
  const itemPositions = new Map(snapshot.items.map((item) => [item.id, item]));
  return {
    ...board,
    sections: (board.sections ?? []).map((section) => section.id === sectionId
      ? { ...section, x: snapshot.section.x + dx, y: snapshot.section.y + dy } : section),
    outfits: board.outfits.map((outfit) => {
      const original = outfitPositions.get(outfit.id);
      return original ? { ...outfit, customLeft: (original.customLeft ?? 0) + dx, customTop: (original.customTop ?? 0) + dy } : outfit;
    }),
    items: board.items.map((item) => {
      const original = itemPositions.get(item.id);
      return original ? { ...item, x: original.x + dx, y: original.y + dy } : item;
    }),
  };
};

export const sectionSnapshot = (board: Board, section: CanvasSection) => {
  const boardIds = new Set(section.boardIds);
  const outfits = board.outfits.filter((outfit) => boardIds.has(outfit.id));
  const itemIds = new Set([...section.itemIds, ...outfits.flatMap((outfit) => outfit.itemIds)]);
  return { section: { ...section }, outfits: outfits.map((outfit) => ({ ...outfit })),
    items: board.items.filter((item) => itemIds.has(item.id)).map((item) => ({ ...item })) };
};

export const removeSection = (board: Board, sectionId: string, deleteContents = false): Board => {
  const section = board.sections?.find((entry) => entry.id === sectionId);
  if (!section) return board;
  const sections = board.sections?.filter((entry) => entry.id !== sectionId);
  if (!deleteContents) return { ...board, sections };
  const boardIds = new Set(section.boardIds);
  const itemIds = new Set([...section.itemIds, ...board.outfits.filter((outfit) => boardIds.has(outfit.id)).flatMap((outfit) => outfit.itemIds)]);
  return { ...board, sections,
    outfits: board.outfits.filter((outfit) => !boardIds.has(outfit.id)).map((outfit) => ({ ...outfit, itemIds: outfit.itemIds.filter((id) => !itemIds.has(id)) })),
    items: board.items.filter((item) => !itemIds.has(item.id)),
  };
};
