export type ShareItem = {
  id: string;
  sourceUrl: string;
  canonicalProductId?: string;
  x: number;
  y: number;
  bought?: boolean;
  purchasePrice?: number;
  notes: string;
  createdAt: string;
};

export type ShareBoardElement = { id: string };

export type ShareOutfit = {
  id: string;
  itemIds: string[];
  elements?: ShareBoardElement[];
  customLeft?: number;
  customTop?: number;
};
export type ShareSection = { id: string; boardIds: string[]; itemIds: string[]; x: number; y: number };

export type ShareCanvas<TItem extends ShareItem = ShareItem, TOutfit extends ShareOutfit = ShareOutfit> = {
  items: TItem[];
  outfits: TOutfit[];
  sections?: ShareSection[];
  collectionId?: string;
  ownerId?: string;
  sourceCollectionId?: string;
};

export type SharedCollection<TCanvas extends ShareCanvas = ShareCanvas> = {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  canvas: TCanvas;
};

export type SavedCollectionReference = {
  sharedCollectionId: string;
  title: string;
  ownerId: string;
  savedAt: string;
};

export type SharedIntent = {
  sharedCollectionId: string;
  action: 'save' | 'editable-copy' | 'start-fresh';
  savedReferences: string[];
};

export type ImportAccounting = {
  productImports: number;
  editableCopies: number;
};

export const reuseAccounting: ImportAccounting = { productImports: 0, editableCopies: 0 };

const clonePublicItem = <TItem extends ShareItem>(item: TItem, offsetX = 0, offsetY = 0): TItem => {
  const copy = structuredClone(item);
  delete copy.purchasePrice;
  copy.id = crypto.randomUUID();
  copy.canonicalProductId = item.canonicalProductId || item.sourceUrl.trim().toLowerCase() || item.id;
  copy.x += offsetX;
  copy.y += offsetY;
  copy.bought = false;
  copy.notes = '';
  copy.createdAt = new Date().toISOString();
  return copy;
};

const publicItemSnapshot = <TItem extends ShareItem>(item: TItem): TItem => {
  const copy = structuredClone(item);
  delete copy.purchasePrice;
  copy.bought = false;
  copy.notes = '';
  copy.canonicalProductId = item.canonicalProductId || item.sourceUrl.trim().toLowerCase() || item.id;
  return copy;
};

const cloneOutfit = <TOutfit extends ShareOutfit>(outfit: TOutfit, itemIds: string[], offset = 0): TOutfit => {
  const copy = structuredClone(outfit);
  copy.id = crypto.randomUUID();
  copy.itemIds = itemIds;
  copy.elements = copy.elements?.map((element) => ({ ...element, id: crypto.randomUUID() }));
  if (copy.customLeft !== undefined) copy.customLeft += offset;
  if (copy.customTop !== undefined) copy.customTop += offset;
  return copy;
};

export const copyItemsToCanvas = <TCanvas extends ShareCanvas>(target: TCanvas, sourceItems: TCanvas['items']): TCanvas => {
  if (!sourceItems.length) return target;
  const left = Math.min(...sourceItems.map((item) => item.x));
  const top = Math.min(...sourceItems.map((item) => item.y));
  const copies = sourceItems.map((item) => clonePublicItem(item, 120 - left, 120 - top));
  return { ...target, items: [...target.items, ...copies] } as TCanvas;
};

export const copyBoardToCanvas = <TCanvas extends ShareCanvas>(target: TCanvas, source: TCanvas, boardId: string): TCanvas => {
  const sourceBoard = source.outfits.find((outfit) => outfit.id === boardId);
  if (!sourceBoard) return target;
  const sourceItems = sourceBoard.itemIds.flatMap((id) => {
    const item = source.items.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });
  const idMap = new Map<string, string>();
  const items = sourceItems.map((item) => {
    const copy = clonePublicItem(item, 60, 60);
    idMap.set(item.id, copy.id);
    return copy;
  });
  const outfit = cloneOutfit(sourceBoard, sourceBoard.itemIds.flatMap((id) => {
    const mappedId = idMap.get(id);
    return mappedId ? [mappedId] : [];
  }), 60);
  return { ...target, items: [...target.items, ...items], outfits: [...target.outfits, outfit] } as TCanvas;
};

export const makeEditableCopy = <TCanvas extends ShareCanvas>(source: TCanvas, ownerId: string, sourceCollectionId: string): TCanvas => {
  const idMap = new Map<string, string>();
  const items = source.items.map((item) => {
    const copy = clonePublicItem(item);
    idMap.set(item.id, copy.id);
    return copy;
  });
  const boardIdMap = new Map<string, string>();
  const outfits = source.outfits.map((outfit) => {
    const copy = cloneOutfit(outfit, outfit.itemIds.flatMap((id) => {
    const mappedId = idMap.get(id);
    return mappedId ? [mappedId] : [];
    }));
    boardIdMap.set(outfit.id, copy.id);
    return copy;
  });
  const sections = source.sections?.map((section) => ({ ...structuredClone(section), id: crypto.randomUUID(),
    boardIds: section.boardIds.flatMap((id) => boardIdMap.get(id) ?? []),
    itemIds: section.itemIds.flatMap((id) => idMap.get(id) ?? []),
  }));
  return { ...source, items, outfits, sections, collectionId: crypto.randomUUID(), ownerId, sourceCollectionId } as TCanvas;
};

export const createSharedCollection = <TCanvas extends ShareCanvas>(source: TCanvas, title: string, ownerId: string): SharedCollection<TCanvas> => {
  const id = crypto.randomUUID();
  return {
    id,
    title: title.trim() || 'Untitled collection',
    ownerId,
    createdAt: new Date().toISOString(),
    canvas: {
      ...structuredClone(source),
      items: source.items.map(publicItemSnapshot),
      collectionId: id,
      ownerId,
      sourceCollectionId: undefined,
    } as TCanvas,
  };
};

export const saveCollectionReference = (collection: SharedCollection, references: SavedCollectionReference[]): SavedCollectionReference[] => {
  if (references.some((reference) => reference.sharedCollectionId === collection.id)) return references;
  return [...references, {
    sharedCollectionId: collection.id,
    title: collection.title,
    ownerId: collection.ownerId,
    savedAt: new Date().toISOString(),
  }];
};

export const sharedIntentFor = (collectionId: string, action: SharedIntent['action'], references: SavedCollectionReference[]): SharedIntent => ({
  sharedCollectionId: collectionId,
  action,
  savedReferences: references.map((reference) => reference.sharedCollectionId),
});
