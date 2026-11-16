export type CommerceCategory = { id: string; displayName: string; parentId?: string };
export type CommerceRecord = { id: string; displayName: string; aliases?: readonly string[]; categoryIds?: readonly string[] };

export const brandRegistry: readonly CommerceRecord[] = [
  { id: 'banana-republic', displayName: 'Banana Republic', aliases: ['Bananarepublic'] },
  { id: 'charlotte-tilbury', displayName: 'Charlotte Tilbury', aliases: ['charlottetilbury'] },
  { id: 'la-roche-posay', displayName: 'La Roche-Posay', aliases: ['larocheposay'] },
  { id: 'rare-beauty', displayName: 'Rare Beauty', aliases: ['rarebeauty'] },
  { id: 'victorias-secret', displayName: "Victoria's Secret", aliases: ['victoriassecret'] },
] as const;

export const retailerRegistry: readonly CommerceRecord[] = [{ id: 'sephora', displayName: 'Sephora' }] as const;
export const marketplaceRegistry: readonly CommerceRecord[] = [{ id: 'amazon', displayName: 'Amazon' }] as const;
export const categoryMetadata: readonly CommerceCategory[] = [] as const;

export const commerceLookupKey = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[\s\p{P}\p{S}]+/gu, '');

export const createCommerceIndex = (records: readonly CommerceRecord[]): ReadonlyMap<string, CommerceRecord> => {
  const index = new Map<string, CommerceRecord>();
  records.forEach((record) => [record.displayName, ...(record.aliases ?? [])].forEach((name) => {
    const key = commerceLookupKey(name);
    if (key && !index.has(key)) index.set(key, record);
  }));
  return index;
};

const brandIndex = createCommerceIndex(brandRegistry);
const retailerIndex = createCommerceIndex(retailerRegistry);
const marketplaceIndex = createCommerceIndex(marketplaceRegistry);

const displayFrom = (value: string | undefined, index: ReadonlyMap<string, CommerceRecord>): string => {
  if (!value) return '';
  const preserved = value.trim();
  return index.get(commerceLookupKey(preserved))?.displayName ?? preserved;
};

export const normalizeBrandDisplay = (value?: string): string => displayFrom(value, brandIndex);
export const normalizeMarketplaceDisplay = (value?: string): string => displayFrom(value, marketplaceIndex);
export const normalizeRetailerDisplay = (value?: string): string => {
  if (!value) return '';
  const preserved = value.trim();
  const key = commerceLookupKey(preserved);
  return retailerIndex.get(key)?.displayName ?? marketplaceIndex.get(key)?.displayName ?? preserved;
};
export const normalizeCommerceDisplay = (value: { brand?: string; retailer?: string }) => ({
  brand: normalizeBrandDisplay(value.brand),
  retailer: normalizeRetailerDisplay(value.retailer),
});

export const retailerFromProductUrl = (value: string): string => {
  try {
    const labels = new URL(value).hostname.toLowerCase().split('.').filter(Boolean);
    const withoutPrefix = labels.filter((label, index) => index > 0 || !/^(?:www\d*|shop|store|m|mobile)$/.test(label));
    const countrySuffix = withoutPrefix.length >= 3 && withoutPrefix.at(-1)?.length === 2 && /^(?:co|com|net|org)$/.test(withoutPrefix.at(-2) ?? '');
    const domain = withoutPrefix.at(countrySuffix ? -3 : -2) ?? withoutPrefix[0] ?? '';
    if (domain === 'hm') return 'H&M';
    if (!domain || /^(?:www\d*|shop|store|m|mobile)$/.test(domain)) return '';
    return normalizeRetailerDisplay(domain.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()));
  } catch { return ''; }
};
