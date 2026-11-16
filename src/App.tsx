import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { itemsWithVerifiedPrices } from './commercePricing.mjs';
import { defaultCropForPiece, makePieceSearchImage, makeSearchImage } from './imageProcessing';
import type { ImageCrop } from './imageProcessing';
import { convertCurrencyAmount, convertSize, formatCurrency } from './sizeConversion';
import { boardTemplates, closetCategories, closetCategoryFor, imageShapes, itemStyles, layoutPresets, productCategory, resolveBoardStyle, resolveItemPresentation } from './presentation';
import type { BoardPresentation, BoardStyleOverrides, BoardTemplateId, ItemPresentation, LayoutPreset } from './presentation';
import { hasDetachIntent, moveItemsBetweenBoards, nudgeBoardAndItems } from './boardUx';
import { bulkBoardDeleteLabel, deleteBoardsAndContents, dissolveBoardsPreservingItems, toggleBoardSelection } from './boardSelection';
import { advanceCanvasGesture, CANVAS_TOUCH_DRAG_THRESHOLD, canStartObjectGesture, canvasWheelPan, clearCanvasGesture, gestureMatches, selectionAfterItemTap, startCanvasGesture } from './canvasGesture';
import type { CanvasGesture, CanvasGestureKind } from './canvasGesture';
import { MAX_CANVAS_ZOOM, pinchGeometry, pinchViewport, semanticZoomState, zoomViewportAt } from './viewportTransform';
import { canvasSelectionAnnouncement, emptyCanvasSelection, marqueeCanvasSelection, normalizeCanvasSelection } from './canvasSelection';
import type { CanvasSelection, ItemSelectionBounds } from './canvasSelection';
import { canvasActivationIntent } from './canvasActivation';
import { copyBoardToCanvas, copyItemsToCanvas, createSharedCollection, makeEditableCopy, saveCollectionReference, sharedIntentFor } from './sharing';
import type { SavedCollectionReference, SharedCollection, SharedIntent } from './sharing';
import { normalizeBrandDisplay, normalizeRetailerDisplay, retailerFromProductUrl } from './commerceRegistry';
import { hasValidProductPrice } from './pricePresentation';
import { canonicalImportKey, freshQuotaState, grantRewardedImports, normalizeQuotaState, quotaStatus, recordSuccessfulImport, registerFreeAccount } from './importQuota';
import type { ImportQuotaState } from './importQuota';
import { instantiateTemplate, isTemplatePlaceholder, productItems, replaceTemplatePlaceholder, starterTemplates } from './templates';
import { TemplatePicker } from './TemplatePicker';
import { moveSectionFromSnapshot, removeSection, sectionSnapshot } from './sections';
import type { CanvasSection, SectionStyle } from './sections';

type Availability = '' | 'Normal availability' | 'Low in stock' | 'Plenty in stock' | 'Out of stock';

export type Item = {
  id: string;
  title: string;
  brand: string;
  retailer?: string;
  sourceUrl: string;
  canonicalProductId?: string;
  variantId?: string;
  resolutionStatus?: 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED';
  currencyAssumed?: boolean;
  fieldSources?: Record<string, string>;
  fieldConfidence?: Record<string, string>;
  imageUrl: string;
  imageIsGuess?: boolean;
  imageOptions?: string[];
  brokenImages?: Record<string, number>;
  price: number | null;
  purchasePrice?: number;
  priceEstimated?: boolean;
  priceStale?: boolean;
  priceInfo?: Record<string, unknown>;
  estimateLow?: number;
  estimateHigh?: number;
  priceManual?: boolean;
  titleManual?: boolean;
  brandManual?: boolean;
  colorManual?: boolean;
  sizeManual?: boolean;
  priceReference?: string;
  currency: string;
  color: string;
  size: string;
  colorOptions: string[];
  sizeOptions: string[];
  availability: Availability;
  availabilityVerified?: boolean;
  scale?: number;
  templateCardSize?: { width: number; imageHeight: number };
  placeholder?: { label: string; helperText?: string; category?: string; treatment?: 'product' | 'hero' | 'compact' };
  locked?: boolean;
  bought?: boolean;
  isLoading?: boolean;
  isUserImage?: boolean;
  autoPlaced?: boolean;
  lastChecked?: string;
  priceHistory?: { checkedAt: string; price: number }[];
  presentation?: ItemPresentation;
  notes: string;
  unsure: boolean;
  x: number;
  y: number;
  createdAt: string;
};

export type BoardElement = {
  id: string;
  type: 'image' | 'text' | 'shape' | 'decoration';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
  content?: string;
  imageUrl?: string;
  color?: string;
  shape?: 'rectangle' | 'circle' | 'line' | 'sparkle' | 'stroke';
  textPreset?: 'clean' | 'soft' | 'bold' | 'technical' | 'elegant';
  textSize?: 'small' | 'medium' | 'large';
  textAlign?: 'left' | 'center' | 'right';
};

export type Outfit = {
  id: string;
  name: string;
  itemIds: string[];
  budget: number | null;
  budgetCurrency?: string;
  color?: string;
  customWidth?: number;
  customHeight?: number;
  customLeft?: number;
  customTop?: number;
  presentation?: BoardPresentation;
  styleOverrides?: BoardStyleOverrides;
  elements?: BoardElement[];
  preserveWhenEmpty?: boolean;
};

export type Board = {
  items: Item[];
  outfits: Outfit[];
  sections?: CanvasSection[];
  collectionId?: string;
  ownerId?: string;
  sourceCollectionId?: string;
};

type SizeSystem = 'US/CA' | 'UK' | 'EU' | 'AU';
type SizePreference = { system: SizeSystem; value: string };
type SizePreferences = {
  generalClothing?: SizePreference;
  tops?: SizePreference;
  bottoms?: SizePreference;
  dresses?: SizePreference;
  shoes?: SizePreference;
};

type UserSettings = {
  height: string;
  weight: string;
  age: string;
  bust: string;
  waist: string;
  hips: string;
  location: string;
  preferredCurrency: string;
  measurementSystem: string;
  skipBulkDeleteConfirmation: boolean;
  convertItemPrices: boolean;
  sizePreferences: SizePreferences;
  preferredSize?: string;
  sizeRegion?: SizeSystem;
  topSize?: string;
  bottomSize?: string;
  dressSize?: string;
  shoeSize?: string;
};

type Viewport = { x: number; y: number; zoom: number };
type PointerPosition = { x: number; y: number };
type PinchGesture = { pointerIds: [number, number]; viewport: Viewport; midpoint: PointerPosition; distance: number };
type DragState = {
  id: string;
  start: PointerPosition;
  itemX: number;
  itemY: number;
  sourceOutfitId?: string;
  sourceBounds?: { left: number; top: number; width: number; height: number };
  members: { id: string; x: number; y: number }[];
};
type ResizeState = { id: string; startX: number; startY: number; scale: number };
type OutfitResizeState = { id: string; startX: number; startY: number; left: number; top: number; width: number; height: number; original: Pick<Outfit, 'customLeft' | 'customTop' | 'customWidth' | 'customHeight'> };
type LayoutSizes = Record<string, number>;
type OutfitDragState = { id: string; start: PointerPosition; frameLeft?: number; frameTop?: number; members: { id: string; x: number; y: number }[] };
type BoardElementTarget = { outfitId: string; elementId: string };
type BoardElementDragState = { outfitId: string; elementId: string; start: PointerPosition; x: number; y: number };
type BoardElementResizeState = { outfitId: string; elementId: string; start: PointerPosition; width: number; height: number };
type SelectionState = { start: PointerPosition; current: PointerPosition; base: CanvasSelection; additive: boolean };
type CanvasMode = 'pan' | 'select';
type VisualMatch = { title: string; link: string; source: string; thumbnail: string; price: string; currency?: string; priceEstimated?: boolean; priceStatus?: 'checking' | 'ready' | 'unavailable' };
type MatchPicker = { itemId: string; status: 'loading' | 'ready' | 'error'; matches: VisualMatch[]; message: string };
type ImageIntentPicker = { itemId: string; pieces: string[] };
type PieceSearchReview = { sourceItemId: string; sourceImageUrl: string; searchImageUrl?: string; pieces: string[]; index: number; createdIds: string[]; status: 'loading' | 'ready' | 'error'; matches: VisualMatch[]; message: string; matchKind?: 'original' | 'alternatives'; crop?: ImageCrop; adjustingCrop?: boolean };
type QuickAdd = { x: number; y: number; position: PointerPosition };
type SelectionMenu = { x: number; y: number };
type ItemMenu = { id: string; x: number; y: number };
type BoardMenu = { id: string; x: number; y: number };
type ImagePicker = { itemId: string; imageUrls: string[]; status: 'ready' | 'loading' | 'error'; message: string };
type DeletionRequest = { itemIds: string[]; outfitId?: string; boardIds?: string[] };
type DetachIntent = { sourceOutfitId: string; itemIds: string[]; sourceBounds: { left: number; top: number; width: number; height: number } };
type QuotaPrompt = { reason: 'signup-required' | 'monthly-limit'; pendingUrl: string };

// v3 intentionally starts with a clean board and removes every earlier board store.
const storageKey = 'cura-link-only-board-v3';
const retiredStorageKeys = ['thread-shopping-canvas-v1', 'thread-shopping-canvas-v2', 'thread-shopping-canvas-v3', 'cura-link-only-board-v1', 'cura-link-only-board-v2'];
const userSettingsKey = 'thread-shopping-canvas-user-settings';
const exchangeRateCacheKey = 'cura-exchange-rates-v1';
const sharedCollectionsKey = 'cura-shared-collections-v1';
const savedCollectionsKey = 'cura-saved-collection-references-v1';
const sharedIntentKey = 'cura-pending-shared-intent-v1';
const visitorIdKey = 'cura-local-owner-id-v1';
const importQuotaKey = 'cura-import-quota-v1';
const cardWidth = 218;
const cardHeight = 390;
const boardPalette = ['#849c72', '#b28b79', '#7f98ab', '#a58091', '#9d956b'];
const clothingPartOptions = ['Top', 'Skirt', 'Pants / jeans', 'Shorts', 'Dress / jumpsuit', 'Outerwear', 'Shoes', 'Bag', 'Accessories'];
// ISO 4217 currencies, excluding currencies issued by broadly sanctioned jurisdictions.
const currencyOptions = [
  'AED', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BZD',
  'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS',
  'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KRW',
  'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR',
  'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RWF', 'SAR', 'SBD',
  'SCR', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'STN', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD',
  'UYU', 'UZS', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW',
].sort();
const alphaSizes = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL'];
const sizeSystems: SizeSystem[] = ['US/CA', 'UK', 'EU', 'AU'];
const regionalClothingSizes: Record<SizeSystem, string[]> = {
  'US/CA': ['00', '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20'],
  UK: ['2', '4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24'],
  EU: ['30', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54'],
  AU: ['2', '4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24'],
};
const regionalShoeSizes: Record<SizeSystem, string[]> = {
  'US/CA': ['4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12', '13', '14'],
  UK: ['2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '9', '10', '11', '12'],
  EU: ['34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48'],
  AU: ['4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '11', '12', '13', '14'],
};

const emptyBoard: Board = { items: [], outfits: [] };

const defaultSettings: UserSettings = {
  height: '',
  weight: '',
  age: '',
  bust: '',
  waist: '',
  hips: '',
  location: '',
  preferredCurrency: 'USD',
  measurementSystem: 'imperial',
  skipBulkDeleteConfirmation: false,
  convertItemPrices: false,
  sizePreferences: {},
};

const blankDraft = {
  title: '',
  brand: '',
  sourceUrl: '',
  imageUrl: '',
  price: '',
  currency: 'USD',
  color: '',
  size: '',
  availability: '' as Availability,
  notes: '',
};

const loadBoard = (): Board => {
  retiredStorageKeys.forEach((key) => window.localStorage.removeItem(key));
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return emptyBoard;

  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed.items) && Array.isArray(parsed.outfits)) return {
      ...parsed,
      items: parsed.items.map((item: Item) => ({
        ...item,
        isLoading: false,
        title: !item.titleManual && /^(?:www\d*|shop|store|m|mobile) product$/i.test(item.title)
          ? (retailerFromProductUrl(item.sourceUrl) ? `${retailerFromProductUrl(item.sourceUrl)} product` : 'Product') : item.title,
        brand: normalizeBrandDisplay(item.brand),
        retailer: normalizeRetailerDisplay(/^(?:www\d*|shop|store|m|mobile)$/i.test(item.retailer ?? '')
          ? retailerFromProductUrl(item.sourceUrl) : item.retailer),
      })),
    };
  } catch {
    // Standard silent fallback
  }

  return emptyBoard;
};

const loadSharedCollections = (): Record<string, SharedCollection<Board>> => {
  try {
    const saved = window.localStorage.getItem(sharedCollectionsKey);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const loadSavedCollectionReferences = (): SavedCollectionReference[] => {
  try {
    const saved = window.localStorage.getItem(savedCollectionsKey);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const localOwnerId = (): string => {
  const existing = window.localStorage.getItem(visitorIdKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(visitorIdKey, id);
  return id;
};

const sharedCollectionFromLocation = (): SharedCollection<Board> | null => {
  const id = new URLSearchParams(window.location.search).get('collection');
  return id ? loadSharedCollections()[id] ?? null : null;
};

const mergeSavedUserSettings = (saved: string): UserSettings => {
  return { ...defaultSettings, ...JSON.parse(saved) };
};

const loadUserSettings = (): UserSettings => {
  const saved = window.localStorage.getItem(userSettingsKey);
  if (!saved) return defaultSettings;
  try {
    const loaded = mergeSavedUserSettings(saved);
    if (loaded.sizePreferences && Object.keys(loaded.sizePreferences).length) return loaded;
    const legacySystem: SizeSystem = loaded.sizeRegion === 'UK' ? 'UK' : loaded.sizeRegion === 'EU' ? 'EU' : loaded.sizeRegion === 'AU' ? 'AU' : 'US/CA';
    return {
      ...loaded,
      sizePreferences: {
        generalClothing: loaded.preferredSize ? { system: legacySystem, value: loaded.preferredSize } : undefined,
        tops: loaded.topSize ? { system: legacySystem, value: loaded.topSize } : undefined,
        bottoms: loaded.bottomSize ? { system: legacySystem, value: loaded.bottomSize } : undefined,
        dresses: loaded.dressSize ? { system: legacySystem, value: loaded.dressSize } : undefined,
        shoes: loaded.shoeSize ? { system: legacySystem, value: loaded.shoeSize } : undefined,
      },
    };
  } catch {
    return defaultSettings;
  }
};

const loadImportQuota = (): ImportQuotaState => {
  try {
    const saved = window.localStorage.getItem(importQuotaKey);
    return saved ? normalizeQuotaState({ ...freshQuotaState(), ...JSON.parse(saved) }) : freshQuotaState();
  } catch { return freshQuotaState(); }
};

const loadExchangeRateCache = (): Record<string, number> => {
  try {
    const saved = window.localStorage.getItem(exchangeRateCacheKey);
    if (!saved) return {};
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return {};
    if (!('savedAt' in parsed) || typeof parsed.savedAt !== 'number') return {};
    // Keep the last valid rates even when stale. Age controls refresh behavior, not usability.
    if (!('rates' in parsed) || !parsed.rates || typeof parsed.rates !== 'object') return {};
    const rates = Object.fromEntries(Object.entries(parsed.rates).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0));
    return rates.USD ? rates : {};
  } catch {
    return {};
  }
};

const priceBand = (value: number | null, currency = 'USD', preferredCurrency = 'USD', isLoading = false): string => {
  if (value === null) return isLoading ? 'Still looking…' : 'Price unavailable';
  if (value === 0) return formatCurrency(0, currency, preferredCurrency);
  const lower = Math.max(1, Math.floor((value * 0.82) / 5) * 5);
  const upper = Math.ceil((value * 1.18) / 5) * 5;
  const lowerFmt = formatCurrency(lower, currency, preferredCurrency);
  const upperFmt = formatCurrency(upper, currency, preferredCurrency);
  return `${lowerFmt}–${upperFmt}`;
};

const convertKnownCurrencyAmount = (
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates?: Record<string, number>,
): number => {
  // A known price never needs exchange-rate data when no currency conversion is required.
  if (fromCurrency === toCurrency) return amount;
  return convertCurrencyAmount(amount, fromCurrency, toCurrency, rates);
};

const itemPriceLabel = (item: Item, preferredCurrency: string, convertItemPrices = false, rates?: Record<string, number>): string => {
  if (!hasValidProductPrice(item.price, item.currency)) return item.isLoading ? 'Still looking…' : 'Price unavailable';
  const itemCurrency = item.currency || preferredCurrency;
  if (convertItemPrices && itemCurrency !== preferredCurrency) {
    const convertedPrice = convertKnownCurrencyAmount(item.price, itemCurrency, preferredCurrency, rates);
    if (!Number.isFinite(convertedPrice)) return 'Currency conversion unavailable';
    if (item.priceEstimated && Number.isFinite(item.estimateLow) && Number.isFinite(item.estimateHigh)) {
      const convertedLow = convertKnownCurrencyAmount(item.estimateLow!, itemCurrency, preferredCurrency, rates);
      const convertedHigh = convertKnownCurrencyAmount(item.estimateHigh!, itemCurrency, preferredCurrency, rates);
      if (![convertedLow, convertedHigh].every(Number.isFinite)) return 'Currency conversion unavailable';
      return `Est. ${formatCurrency(convertedLow, preferredCurrency, preferredCurrency)}–${formatCurrency(convertedHigh, preferredCurrency, preferredCurrency)}`;
    }
    return `${item.priceEstimated ? 'Est. ' : ''}${formatCurrency(convertedPrice, preferredCurrency, preferredCurrency)}`;
  }
  if (item.priceEstimated && Number.isFinite(item.estimateLow) && Number.isFinite(item.estimateHigh)) {
    return `Est. ${formatCurrency(item.estimateLow!, itemCurrency, itemCurrency)}–${formatCurrency(item.estimateHigh!, itemCurrency, itemCurrency)}`;
  }
  return item.priceEstimated
    ? `Est. ${/reference/i.test(item.priceReference ?? '') ? formatCurrency(item.price, itemCurrency, itemCurrency) : priceBand(item.price, itemCurrency, itemCurrency)}`
    : formatCurrency(item.price, itemCurrency, itemCurrency);
};

const priceSummary = (items: Item[], preferredCurrency: string, rates?: Record<string, number>) => {
  let total = 0;
  let low = 0;
  let high = 0;
  let estimated = false;
  let banded = false;
  let missing = 0;
  let conversionMissing = false;
  const unique = new Map<string, Item>();
  productItems(items).forEach((item) => unique.set(item.sourceUrl.trim().toLowerCase() || `item:${item.id}`, item));
  const relevantItems = [...unique.values()];
  const verifiedPriceItems = itemsWithVerifiedPrices(relevantItems);
  missing = relevantItems.length - verifiedPriceItems.length;
  verifiedPriceItems.forEach((item) => {
    const currency = item.currency || preferredCurrency;
    const bounded = Boolean(item.priceEstimated) && Number.isFinite(item.estimateLow) && Number.isFinite(item.estimateHigh);
    const legacyBand = Boolean(item.priceEstimated) && !bounded && !/reference/i.test(item.priceReference ?? '');
    const convertedTotal = convertKnownCurrencyAmount(item.price, currency, preferredCurrency, rates);
    const convertedLow = convertKnownCurrencyAmount(bounded ? item.estimateLow! : legacyBand ? Math.max(0, item.price * 0.82) : item.price, currency, preferredCurrency, rates);
    const convertedHigh = convertKnownCurrencyAmount(bounded ? item.estimateHigh! : legacyBand ? item.price * 1.18 : item.price, currency, preferredCurrency, rates);
    if (![convertedTotal, convertedLow, convertedHigh].every(Number.isFinite)) { conversionMissing = true; return; }
    total += convertedTotal;
    low += convertedLow;
    high += convertedHigh;
    estimated = estimated || Boolean(item.priceEstimated) || currency !== preferredCurrency;
    banded = banded || bounded || legacyBand;
  });
  return {
    value: conversionMissing ? 'Currency conversion unavailable' : relevantItems.length - missing > 0
      ? banded
        ? `${formatCurrency(Math.floor(low), preferredCurrency, preferredCurrency)}–${formatCurrency(Math.ceil(high), preferredCurrency, preferredCurrency)}`
        : formatCurrency(total, preferredCurrency, preferredCurrency)
      : missing ? 'Price unavailable' : formatCurrency(0, preferredCurrency, preferredCurrency),
    estimated,
    missing,
    amount: total,
    conversionMissing,
  };
};

const spentSummary = (items: Item[], preferredCurrency: string, rates?: Record<string, number>) => priceSummary(
  items.filter((item) => item.bought).map((item) => Number.isFinite(item.purchasePrice)
    ? { ...item, price: item.purchasePrice!, priceEstimated: false, estimateLow: undefined, estimateHigh: undefined }
    : item),
  preferredCurrency,
  rates,
);

const trackerAmount = (summary: ReturnType<typeof priceSummary>, currency: string) => summary.conversionMissing ? summary.value : `${summary.value} ${currency}`;

const visualMatchPrice = (match: VisualMatch, preferredCurrency: string): string => {
  if (match.priceStatus === 'checking') return 'Checking price…';
  const value = Number.parseFloat(match.price.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value)) return 'Price unavailable';
  return match.priceEstimated
    ? priceBand(value, match.currency || preferredCurrency, preferredCurrency)
    : formatCurrency(value, match.currency || preferredCurrency, preferredCurrency);
};

const availabilityFrom = (value: string | undefined, fallback: Availability = '', stockCount?: string): Availability => {
  const count = stockCount?.trim() ? Number(stockCount) : NaN;
  if (Number.isFinite(count)) {
    if (count <= 0) return 'Out of stock';
    if (count <= 3) return 'Low in stock';
    if (count >= 10) return 'Plenty in stock';
    return 'Normal availability';
  }
  const normalized = value?.toLowerCase().replaceAll(/[^a-z]/g, '') ?? '';
  if (normalized.includes('outofstock') || normalized.includes('soldout') || normalized.includes('discontinued')) return 'Out of stock';
  if (normalized.includes('instock')) return 'Normal availability';
  if (normalized.includes('lowstock') || normalized.includes('limitedavailability') || normalized.includes('fewleft')) return 'Low in stock';
  if (normalized.includes('plenty') || normalized.includes('highstock')) return 'Plenty in stock';
  return fallback;
};

const visibleAvailability = (item: Item): string => {
  if (item.unsure || !item.availabilityVerified) return '';
  if (item.availability === 'Out of stock') return 'Sold out';
  if (item.availability === 'Low in stock') return 'Low stock';
  if (item.availability === 'Normal availability' || item.availability === 'Plenty in stock') return 'In stock';
  return '';
};

const isSizedProduct = (item: Item): boolean => /\b(top|shirt|blouse|crop|bra|sweater|cardigan|jacket|coat|dress|jumpsuit|romper|gown|skirt|short|pant|trouser|jean|legging|bottom|shoe|sneaker|boot|heel|sandal|loafer|flat|activewear)\b/i.test(`${item.title} ${item.notes}`) || item.sizeOptions.length > 1;

const estimatedPiecePrice = (label: string): number => {
  const value = label.toLowerCase();
  if (/(shoe|boot|sneaker|heel)/.test(value)) return 110;
  if (/(bag|purse|handbag)/.test(value)) return 95;
  if (/(jewell|earring|necklace|watch|accessor)/.test(value)) return 35;
  if (/(coat|jacket|outerwear)/.test(value)) return 135;
  if (/dress/.test(value)) return 95;
  if (/(skirt|pant|trouser|short|bottom)/.test(value)) return 65;
  return 55;
};

const brandPriceEstimate = (title: string, brand: string, sourceUrl: string): number | null => {
  const identity = `${brand} ${sourceUrl}`.toLowerCase();
  const item = title.toLowerCase();
  if (identity.includes('reformation') || identity.includes('thereformation')) {
    if (/dress|gown|jumpsuit/.test(item)) return 248;
    if (/jacket|coat|outerwear/.test(item)) return 278;
    if (/jean|pant|trouser|skirt/.test(item)) return 178;
    if (/top|blouse|shirt|sweater|cardigan/.test(item)) return 128;
    return 178;
  }
  if (identity.includes('aritzia')) {
    if (/skirt/.test(item)) return 128;
    if (/dress|gown|jumpsuit/.test(item)) return 198;
    if (/jacket|coat|outerwear/.test(item)) return 248;
    if (/pant|trouser|jean/.test(item)) return 148;
    if (/top|blouse|shirt|sweater|cardigan/.test(item)) return 98;
    return 128;
  }
  return null;
};

const normaliseProductUrl = (value: string): string => {
  const text = value.trim().replace(/^[[(<{]+/, '').replace(/[\])}>.,;]+$/, '');
  if (/^https?:\/\//i.test(text)) return text;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/?#].*)?$/i.test(text) ? `https://${text}` : '';
};

const pastedUrls = (value: string): string[] => {
  const candidates = value.match(/https?:\/\/[^\s<>"']+|(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>"']*)?/gi) ?? [];
  return [...new Set(candidates.map(normaliseProductUrl).filter(Boolean))];
};

const sourceBrand = (url: string): string => {
  return retailerFromProductUrl(url);
};
const fallbackProductTitle = (retailer: string): string => retailer ? `${retailer} product` : 'Product';
const cardProductTitle = (item: Item): string => {
  if (item.title && (item.titleManual || !/^(?:www\d*|shop|store|m|mobile) product$/i.test(item.title))) return item.title;
  const retailer = /^(?:www\d*|shop|store|m|mobile)$/i.test(item.retailer ?? '')
    ? sourceBrand(item.sourceUrl) : normalizeRetailerDisplay(item.retailer || sourceBrand(item.sourceUrl));
  return fallbackProductTitle(retailer);
};

const productLink = (value: string): string => normaliseProductUrl(value);
const floatingPosition = (x: number, y: number, width: number, height: number) => ({
  left: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
  top: Math.max(12, Math.min(y, window.innerHeight - height - 12)),
});
const isDirectImageUrl = (value: string): boolean => /\.(?:png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/i.test(value);
const displayedImage = (value: string): string => /^https?:\/\//i.test(value) ? `/api/image-proxy?url=${encodeURIComponent(value)}` : value;
const productPlaceholder = (title: string): string => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="360" viewBox="0 0 320 360"><rect width="320" height="360" fill="#f5f0e9"/><rect x="20" y="20" width="280" height="320" rx="14" fill="#fffaf4" stroke="#ddd2c5"/><path d="M133 156l27-38 27 38m-27-38v97m-80 0h160" stroke="#b4a38f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="160" y="258" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="16" fill="#766b5e">Preview unavailable</text><text x="160" y="285" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="12" fill="#9a8e80">Open product link for photos</text></svg>`)}`;

const boardBackgroundStyle = (outfit: Outfit): React.CSSProperties => {
  const presentation = outfit.presentation;
  return {
    backgroundColor: presentation?.customBackgroundColor || undefined,
    backgroundImage: presentation?.backgroundImage ? `url(${presentation.backgroundImage})` : undefined,
    backgroundSize: presentation?.backgroundImageFit ?? 'cover',
    backgroundPosition: presentation?.backgroundImagePosition ?? 'center',
    backgroundRepeat: presentation?.backgroundImageFit === 'contain' ? 'no-repeat' : undefined,
  };
};
const sectionTintColors: Record<SectionStyle, string> = {
  paper: 'var(--color-surface-muted)', sage: 'var(--color-sage)', blush: 'var(--color-blush)',
  cream: 'var(--color-cream)', outline: 'var(--color-border-strong)',
};

const alternativeSearches = (item: Item, preferredCurrency: string) => {
  const identity = `${item.title} ${item.notes} ${item.sourceUrl}`.toLowerCase();
  const category = /\b(perfume|fragrance|cologne|parfum|eau de|body mist|scent)\b/.test(identity) ? 'fragrance'
    : /\b(shampoo|conditioner|haircare|hair care|hair mask|hair oil|scalp|leave-in|curl cream|hair spray)\b/.test(identity) ? 'haircare'
      : /\b(skincare|skin care|serum|cleanser|moisturiz\w*|sunscreen|spf|retinol|toner|face cream|acne|exfoliat\w*|hyaluronic|niacinamide|salicylic|peptide)\b/.test(identity) ? 'skincare'
        : /\b(makeup|cosmetic|lipstick|lip gloss|lip oil|foundation|concealer|blush|mascara|eyeshadow|eyeliner|highlighter|primer|bronzer|palette|brow|lashes)\b/.test(identity) ? 'makeup'
          : /sephora\.|shoppersdrugmart\.|ulta\.|lookfantastic\.|beauty|cosmetics/.test(identity) ? 'beauty'
            : /\b(dress|skirt|jeans|pants|trousers|shirt|blouse|jacket|coat|cardigan|sneakers|boots|handbag|tote|earrings|necklace)\b|aritzia\.|zara\.|nordstrom\.|reformation\./.test(identity) ? 'fashion'
              : 'general';
  const productName = [item.brand, item.title].filter(Boolean).join(' ').trim();
  const query = encodeURIComponent(productName);
  if (category === 'fashion') return {
    category,
    links: [
      { name: 'Depop', url: `https://www.depop.com/search/?q=${query}` },
      { name: 'eBay', url: `https://www.ebay.com/sch/i.html?_nkw=${query}` },
      { name: 'Poshmark', url: `https://poshmark.com/search?query=${query}&type=listings` },
    ],
  };
  if (category === 'general') return {
    category,
    links: [
      { name: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${productName} alternatives`)}` },
      { name: 'Product search', url: `https://www.google.com/search?q=${encodeURIComponent(`${productName} similar products`)}` },
    ],
  };

  const isCanadian = item.currency === 'CAD' || preferredCurrency === 'CAD';
  const sephoraUrl = isCanadian ? 'https://www.sephora.com/ca/en/search?keyword=' : 'https://www.sephora.com/search?keyword=';
  const retailers = category === 'haircare' ? [
    { name: 'Sephora', url: `${sephoraUrl}${query}` },
    { name: 'LOOKFANTASTIC', url: `https://www.lookfantastic.com/search/?q=${query}` },
    { name: 'Ulta Beauty', url: `https://www.ulta.com/search?search=${query}` },
  ] : category === 'skincare' ? [
    { name: 'Sephora', url: `${sephoraUrl}${query}` },
    { name: 'Shoppers Drug Mart', url: `https://www.shoppersdrugmart.ca/search?query=${query}` },
    { name: 'LOOKFANTASTIC', url: `https://www.lookfantastic.com/search/?q=${query}` },
  ] : [
    { name: 'Sephora', url: `${sephoraUrl}${query}` },
    { name: 'Shoppers Drug Mart', url: `https://www.shoppersdrugmart.ca/search?query=${query}` },
    { name: 'Ulta Beauty', url: `https://www.ulta.com/search?search=${query}` },
  ];
  return {
    category,
    links: [...retailers, { name: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${productName} ${category} alternatives`)}` }],
  };
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image file could not be read.'));
    reader.readAsDataURL(file);
  });

const itemScale = (item: Item) => Math.min(2, Math.max(0.75, item.scale ?? 1));
const itemCardWidth = (item: Item, outfit?: Outfit) => {
  if (item.templateCardSize) return item.templateCardSize.width;
  const preset = resolveItemPresentation(outfit?.presentation, item.presentation).preset;
  if (outfit?.presentation?.templateId === 'moodboard') return 276;
  if (outfit?.presentation?.templateId === 'reveal') return 230;
  if (preset === 'compact') return 190;
  if (outfit?.presentation?.templateId === 'clothing' || outfit?.presentation?.templateId === 'capsule') return 252;
  if (preset === 'editorial') return 236;
  return cardWidth;
};
const itemArtworkHeight = (item: Item, outfit?: Outfit) => {
  if (item.templateCardSize) return item.templateCardSize.imageHeight;
  const preset = resolveItemPresentation(outfit?.presentation, item.presentation).preset;
  if (outfit?.presentation?.templateId === 'moodboard') return 330;
  if (outfit?.presentation?.templateId === 'reveal') return 290;
  if (outfit?.presentation?.templateId === 'beauty') return 225;
  if (outfit?.presentation?.templateId === 'skincare') return 205;
  if (outfit?.presentation?.templateId === 'wishlist') return 165;
  if (preset === 'compact') return 176;
  if (outfit?.presentation?.templateId === 'clothing' || outfit?.presentation?.templateId === 'capsule') return 316;
  if (preset === 'editorial') return 272;
  return 244;
};
const itemHeight = (item: Item, heights: LayoutSizes, outfit?: Outfit) => heights[`item:${item.id}`] ?? Math.max(300, itemArtworkHeight(item, outfit) * itemScale(item) + 120);

const getOutfitBounds = (outfit: Outfit, items: Item[], heights: LayoutSizes = {}) => {
  const members = items.filter((item) => outfit.itemIds.includes(item.id));
  const elementWidth = Math.max(0, ...(outfit.elements ?? []).map((element) => element.x + element.width + 28));
  const elementHeight = Math.max(0, ...(outfit.elements ?? []).map((element) => element.y + element.height + 48));
  if (!members.length) return outfit.customLeft === undefined || outfit.customTop === undefined ? null : {
    left: outfit.customLeft, top: outfit.customTop, width: Math.max(outfit.customWidth ?? 600, elementWidth),
    height: Math.max(outfit.customHeight ?? 460, elementHeight), members,
  };
  const left = Math.min(Math.min(...members.map((item) => item.x)) - 28, outfit.customLeft ?? Infinity);
  const headerSpace = Math.max(92, (heights[`header:${outfit.id}`] ?? 68) + 32);
  const top = Math.min(Math.min(...members.map((item) => item.y)) - headerSpace, outfit.customTop ?? Infinity);
  const right = Math.max(...members.map((item) => item.x + itemCardWidth(item, outfit) * itemScale(item))) + 28;
  const bottom = Math.max(...members.map((item) => item.y + itemHeight(item, heights, outfit))) + 32;
  const computedWidth = right - left;
  const computedHeight = bottom - top;
  return {
    left,
    top,
    width: Math.max(300, computedWidth, elementWidth, outfit.customWidth ?? 0),
    height: Math.max(computedHeight, elementHeight, outfit.customHeight ?? 0),
    members,
  };
};

const positionForBoardItem = (outfit: Outfit, items: Item[], incoming: Item, heights: LayoutSizes): PointerPosition => {
  const members = items.filter((item) => outfit.itemIds.includes(item.id));
  const bounds = getOutfitBounds(outfit, items, heights);
  if (!bounds) return { x: incoming.x, y: incoming.y };
  const baseX = bounds.left + 34;
  const baseY = bounds.top + Math.max(126, (heights[`header:${outfit.id}`] ?? 70) + 56);
  if (!members.length) return { x: baseX, y: baseY };
  const layout = outfit.presentation?.layoutPreset ?? 'freeform';
  const width = Math.max(itemCardWidth(incoming, outfit), ...members.map((item) => itemCardWidth(item, outfit) * itemScale(item)));
  const gapX = width + (layout === 'editorial' || layout === 'capsule' ? 44 : 26);
  const gapY = Math.max(itemHeight(incoming, heights, outfit), ...members.map((item) => itemHeight(item, heights, outfit))) + 54;
  if (layout === 'category-rows' || layout === 'capsule') {
    const sameCategory = members.filter((item) => productCategory(item.title) === productCategory(incoming.title));
    if (!sameCategory.length) return { x: baseX, y: Math.max(...members.map((item) => item.y + itemHeight(item, heights, outfit))) + 60 };
    const last = sameCategory[sameCategory.length - 1];
    const column = Math.round((last.x - baseX) / gapX);
    if (column < 2) return { x: last.x + gapX, y: last.y };
    return { x: baseX, y: Math.max(...members.map((item) => item.y + itemHeight(item, heights, outfit))) + 60 };
  }
  const columns = layout === 'editorial' ? 2 : 3;
  for (let slot = members.length; slot < members.length + 100; slot += 1) {
    const x = baseX + slot % columns * gapX + (layout === 'editorial' && slot % 2 ? 28 : 0);
    const y = baseY + Math.floor(slot / columns) * gapY;
    const collides = members.some((item) => x < item.x + itemCardWidth(item, outfit) * itemScale(item) + 12
      && x + itemCardWidth(incoming, outfit) > item.x - 12
      && y < item.y + itemHeight(item, heights, outfit) + 12
      && y + itemHeight(incoming, heights, outfit) > item.y - 12);
    if (!collides) return { x, y };
  }
  return { x: baseX, y: Math.max(...members.map((item) => item.y + itemHeight(item, heights, outfit))) + 60 };
};

export const App = () => {
  const [board, setBoard] = useState<Board>(loadBoard);
  const [userSettings, setUserSettings] = useState<UserSettings>(loadUserSettings);
  const [importQuota, setImportQuota] = useState<ImportQuotaState>(loadImportQuota);
  const [quotaPrompt, setQuotaPrompt] = useState<QuotaPrompt | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 120, y: 64, zoom: 1 });
  const viewportRef = useRef(viewport);
  const [canvasSelection, setCanvasSelection] = useState<CanvasSelection>(emptyCanvasSelection);
  const [canvasActionAnnouncement, setCanvasActionAnnouncement] = useState('');
  const selectedIds = canvasSelection.itemIds;
  const selectedBoardIds = canvasSelection.boardIds;
  const activeSectionId = canvasSelection.sectionIds[0] ?? null;
  const resolveSelectionUpdate = (current: string[], update: string[] | ((current: string[]) => string[])) => typeof update === 'function' ? update(current) : update;
  const setSelectedIds = (update: string[] | ((current: string[]) => string[])) => setCanvasSelection((current) => ({ ...current, itemIds: resolveSelectionUpdate(current.itemIds, update), boardIds: [], sectionIds: [] }));
  const setSelectedBoardIds = (update: string[] | ((current: string[]) => string[])) => setCanvasSelection((current) => {
    const boardIds = resolveSelectionUpdate(current.boardIds, update);
    const children = new Set(board.outfits.filter((outfit) => boardIds.includes(outfit.id)).flatMap((outfit) => outfit.itemIds));
    return { ...current, itemIds: current.itemIds.filter((id) => !children.has(id)), boardIds, sectionIds: [] };
  });
  const setActiveSectionId = (id: string | null) => setCanvasSelection((current) => id
    ? { itemIds: [], boardIds: [], sectionIds: [id] }
    : { ...current, sectionIds: [] });
  const announceCanvasAction = (message: string) => {
    setCanvasActionAnnouncement('');
    window.setTimeout(() => setCanvasActionAnnouncement(message), 0);
  };
  const [itemDetailsOpenId, setItemDetailsOpenId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'look'>('details');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [replacingPlaceholderId, setReplacingPlaceholderId] = useState<string | null>(null);
  const [placeholderDraft, setPlaceholderDraft] = useState({ url: '', title: '', brand: '', price: '', imageUrl: '' });
  const [layoutChoice, setLayoutChoice] = useState<LayoutPreset>('freeform');
  const [activeOutfitId, setActiveOutfitId] = useState<string | null>(null);
  const [boardSelectionOpen, setBoardSelectionOpen] = useState(false);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [sectionStyleOpenId, setSectionStyleOpenId] = useState<string | null>(null);
  const [sectionMobileEditorId, setSectionMobileEditorId] = useState<string | null>(null);
  const [renamingOutfitId, setRenamingOutfitId] = useState<string | null>(null);
  const [outfitNameDraft, setOutfitNameDraft] = useState('');
  const [selectedBoardElement, setSelectedBoardElement] = useState<BoardElementTarget | null>(null);
  const [boardElementInspectorOpen, setBoardElementInspectorOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isManual, setIsManual] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSizingOpen, setIsSizingOpen] = useState(false);
  const [sharedCollection, setSharedCollection] = useState<SharedCollection<Board> | null>(sharedCollectionFromLocation);
  const [sharedSelectedIds, setSharedSelectedIds] = useState<string[]>([]);
  const [savedCollections, setSavedCollections] = useState<SavedCollectionReference[]>(loadSavedCollectionReferences);
  const [isSavedCollectionsOpen, setIsSavedCollectionsOpen] = useState(false);
  const [lastShareLink, setLastShareLink] = useState('');
  const [confirmClearBoard, setConfirmClearBoard] = useState(false);
  const [isClosetOpen, setIsClosetOpen] = useState(false);
  const [closetCategory, setClosetCategory] = useState<string>('All');
  const [draft, setDraft] = useState(blankDraft);
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  const [alternativeItemId, setAlternativeItemId] = useState<string | null>(null);
  const [matchPicker, setMatchPicker] = useState<MatchPicker | null>(null);
  const [imageIntentPicker, setImageIntentPicker] = useState<ImageIntentPicker | null>(null);
  const [pieceSearchReview, setPieceSearchReview] = useState<PieceSearchReview | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAdd | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const [itemMenu, setItemMenu] = useState<ItemMenu | null>(null);
  const [boardMenu, setBoardMenu] = useState<BoardMenu | null>(null);
  const [imagePicker, setImagePicker] = useState<ImagePicker | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionState | null>(null);
  const [budgetEditorId, setBudgetEditorId] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [budgetCurrencyDraft, setBudgetCurrencyDraft] = useState('USD');
  const [budgetError, setBudgetError] = useState('');
  const [addUrlError, setAddUrlError] = useState('');
  const [editProductUrlError, setEditProductUrlError] = useState('');
  const [showPrices, setShowPrices] = useState(true);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>(loadExchangeRateCache);
  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(null);
  const [detachIntent, setDetachIntent] = useState<DetachIntent | null>(null);
  const [neverAskBulkDelete, setNeverAskBulkDelete] = useState(false);
  const [quickAddUrl, setQuickAddUrl] = useState('');
  const [isPanning, setIsPanning] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'pan' : 'select');
  const navigationMode = canvasMode === 'pan';
  const multiSelectMode = canvasMode === 'select';
  const setNavigationMode = (enabled: boolean) => setCanvasMode(enabled ? 'pan' : 'select');
  const setMultiSelectMode = (enabled: boolean) => setCanvasMode(enabled ? 'select' : 'pan');
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [layoutHeights, setLayoutHeights] = useState<LayoutSizes>({});
  const appShellRef = useRef<HTMLElement>(null);
  const lastOutsideSurfaceFocusRef = useRef<HTMLElement | null>(null);
  const accessibleSurfaceWasOpenRef = useRef(false);
  const lastAccessibleSurfaceVersionRef = useRef('');
  const boardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const detachIntentRef = useRef<DetachIntent | null>(null);
  const importQuotaRef = useRef(importQuota);
  const pendingImportKeysRef = useRef(new Set<string>());
  const panRef = useRef<PointerPosition | null>(null);
  const canvasGestureRef = useRef<CanvasGesture | null>(null);
  const touchPointersRef = useRef(new Map<number, PointerPosition>());
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const longPressRef = useRef<{ timer: number; target: HTMLElement; start: PointerPosition; pointerId: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const wheelPanRef = useRef({ x: 0, y: 0 });
  const wheelFrameRef = useRef<number | null>(null);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const pendingWheelZoomRef = useRef<{ anchor: PointerPosition; factor: number } | null>(null);
  const pinchFrameRef = useRef<number | null>(null);
  const pendingPinchViewportRef = useRef<Viewport | null>(null);
  const pendingPanRef = useRef({ x: 0, y: 0 });
  const panFrameRef = useRef<number | null>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const outfitResizeRef = useRef<OutfitResizeState | null>(null);
  const outfitDragRef = useRef<OutfitDragState | null>(null);
  const sectionDragRef = useRef<{ id: string; start: PointerPosition; snapshot: ReturnType<typeof sectionSnapshot> } | null>(null);
  const sectionResizeRef = useRef<{ id: string; start: PointerPosition; width: number; height: number } | null>(null);
  const sectionTapRef = useRef<{ id: string; at: number } | null>(null);
  const outfitTapRef = useRef<{ id: string; at: number } | null>(null);
  const itemTapRef = useRef<{ id: string; at: number } | null>(null);
  if (!panRef.current && !pinchGestureRef.current && wheelFrameRef.current === null && wheelCommitTimerRef.current === null) viewportRef.current = viewport;
  const writeWorldViewport = (next: Viewport) => {
    viewportRef.current = next;
    const world = worldRef.current;
    if (!world) return;
    world.style.setProperty('--world-x', `${next.x}px`);
    world.style.setProperty('--world-y', `${next.y}px`);
    world.style.setProperty('--world-zoom', String(next.zoom));
  };
  const flushPanFrame = () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current);
    panFrameRef.current = null;
    const delta = pendingPanRef.current;
    pendingPanRef.current = { x: 0, y: 0 };
    if (delta.x || delta.y) writeWorldViewport({ ...viewportRef.current, x: viewportRef.current.x + delta.x, y: viewportRef.current.y + delta.y });
  };
  const flushPinchFrame = () => {
    if (pinchFrameRef.current !== null) window.cancelAnimationFrame(pinchFrameRef.current);
    pinchFrameRef.current = null;
    if (pendingPinchViewportRef.current) writeWorldViewport(pendingPinchViewportRef.current);
    pendingPinchViewportRef.current = null;
  };
  const scheduleWheelCommit = () => {
    if (wheelCommitTimerRef.current !== null) window.clearTimeout(wheelCommitTimerRef.current);
    wheelCommitTimerRef.current = window.setTimeout(() => {
      wheelCommitTimerRef.current = null;
      setViewport(viewportRef.current);
    }, 90);
  };
  useLayoutEffect(() => { writeWorldViewport(viewport); }, [viewport]);
  const canvasStartTargetRef = useRef<EventTarget | null>(null);
  const suppressSectionClickRef = useRef(false);
  const sectionGestureMovedRef = useRef(false);
  const boardElementDragRef = useRef<BoardElementDragState | null>(null);
  const boardElementResizeRef = useRef<BoardElementResizeState | null>(null);
  const selectionRef = useRef<SelectionState | null>(null);
  const cropDrawRef = useRef<PointerPosition | null>(null);
  const itemMovedRef = useRef(false);
  const enrichmentAttempts = useRef(new Set<string>());
  const enrichmentActive = useRef(0);

  useLayoutEffect(() => {
    const canvas = boardRef.current;
    if (!canvas) return;
    const zoom = viewport.zoom;
    canvas.style.setProperty('--canvas-zoom', String(zoom));
    canvas.style.setProperty('--canvas-inverse-zoom', String(1 / zoom));
    canvas.style.setProperty('--canvas-outline-width', `${2 / zoom}px`);
    canvas.style.setProperty('--canvas-outline-offset', `${7 / zoom}px`);
    canvas.style.setProperty('--canvas-badge-offset', `${5 / zoom}px`);
    canvas.style.setProperty('--canvas-indicator-offset', `${13 / zoom}px`);
    canvas.style.setProperty('--canvas-handle-offset', `${4 / zoom}px`);
    canvas.dataset.zoom = semanticZoomState(zoom);
  }, [viewport.zoom]);

  useEffect(() => {
    const shell = appShellRef.current;
    if (!shell) return;
    const updateLayoutState = () => {
      const { width, height } = shell.getBoundingClientRect();
      const styles = getComputedStyle(shell);
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const threshold = (token: string) => (Number.parseFloat(styles.getPropertyValue(token)) || 0) * rem;
      const compactMax = threshold('--layout-compact-max');
      const mediumMax = threshold('--layout-medium-max');
      const expandedMax = threshold('--layout-expanded-max');
      const shortHeightMax = threshold('--layout-short-height-max');
      shell.dataset.layoutState = width < compactMax ? 'compact' : width < mediumMax ? 'medium' : width < expandedMax ? 'expanded' : 'large';
      shell.dataset.shortHeight = String(height < shortHeightMax);
      shell.dataset.pointer = window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine';
      shell.dataset.hover = window.matchMedia('(hover: hover)').matches ? 'capable' : 'none';
      shell.dataset.orientation = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
    };
    const observer = new ResizeObserver(updateLayoutState);
    const updateKeyboardInset = () => {
      const visual = window.visualViewport;
      const focusedField = document.activeElement instanceof HTMLElement
        && Boolean(document.activeElement.closest('input, textarea, select, [contenteditable="true"]'));
      const inset = focusedField && visual ? Math.max(0, window.innerHeight - visual.height - visual.offsetTop) : 0;
      shell.style.setProperty('--virtual-keyboard-inset', `${inset}px`);
      if (inset > 0 && focusedField && visual) requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!(field instanceof HTMLElement)) return;
        const top = visual.offsetTop;
        const bottom = top + visual.height;
        const rect = field.getBoundingClientRect();
        if (rect.bottom > bottom - 12 || rect.top < top + 12) field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    observer.observe(shell);
    window.addEventListener('resize', updateLayoutState);
    window.visualViewport?.addEventListener('resize', updateKeyboardInset);
    window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
    document.addEventListener('focusin', updateKeyboardInset);
    document.addEventListener('focusout', updateKeyboardInset);
    window.matchMedia('(pointer: coarse)').addEventListener('change', updateLayoutState);
    window.matchMedia('(hover: hover)').addEventListener('change', updateLayoutState);
    window.matchMedia('(orientation: portrait)').addEventListener('change', updateLayoutState);
    updateLayoutState();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateLayoutState);
      window.visualViewport?.removeEventListener('resize', updateKeyboardInset);
      window.visualViewport?.removeEventListener('scroll', updateKeyboardInset);
      document.removeEventListener('focusin', updateKeyboardInset);
      document.removeEventListener('focusout', updateKeyboardInset);
      window.matchMedia('(pointer: coarse)').removeEventListener('change', updateLayoutState);
      window.matchMedia('(hover: hover)').removeEventListener('change', updateLayoutState);
      window.matchMedia('(orientation: portrait)').removeEventListener('change', updateLayoutState);
    };
  }, []);

  const accessibleSurfaceOpen = Boolean(
    isAdding || replacingPlaceholderId || isSettingsOpen || isSizingOpen || budgetEditorId
    || deletionRequest || sharedCollection || templatePickerOpen || isSavedCollectionsOpen
    || isClosetOpen || imagePicker || imageIntentPicker || pieceSearchReview || matchPicker,
  );
  const accessibleSurfaceVersion = [
    isAdding && 'add', replacingPlaceholderId && `replace:${replacingPlaceholderId}`,
    isSettingsOpen && 'settings', isSizingOpen && 'sizing', budgetEditorId && `budget:${budgetEditorId}`,
    deletionRequest && 'delete', sharedCollection?.id && `shared:${sharedCollection.id}`,
    templatePickerOpen && 'templates', isSavedCollectionsOpen && 'saved', isClosetOpen && 'purchases',
    imagePicker?.itemId && `images:${imagePicker.itemId}`,
    imageIntentPicker?.itemId && `image-intent:${imageIntentPicker.itemId}`,
    pieceSearchReview && `piece-review:${pieceSearchReview.index}:${pieceSearchReview.adjustingCrop}`,
    matchPicker?.itemId && `matches:${matchPicker.itemId}`,
  ].filter(Boolean).join('|');

  useEffect(() => {
    const app = appShellRef.current;
    if (!app) return;
    const surfaceChanged = accessibleSurfaceVersion !== lastAccessibleSurfaceVersionRef.current;
    if (accessibleSurfaceOpen && surfaceChanged) {
      if (!accessibleSurfaceWasOpenRef.current) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement
          && active.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
          && !active.closest('[aria-modal="true"], .saved-collections-panel, .template-gallery, .closet-drawer, .share-link-toast, .inspector')) {
          lastOutsideSurfaceFocusRef.current = active;
        }
      }
      requestAnimationFrame(() => {
        const surface = Array.from(app.querySelectorAll<HTMLElement>('[aria-modal="true"], .saved-collections-panel, .template-gallery, .closet-drawer'))
          .filter((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; })
          .at(-1);
        if (!surface || surface.contains(document.activeElement)) return;
        const firstControl = surface.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
        (firstControl ?? surface).focus({ preventScroll: true });
      });
    } else if (!accessibleSurfaceOpen && accessibleSurfaceWasOpenRef.current) {
      const target = lastOutsideSurfaceFocusRef.current;
      const fallback = app.querySelector<HTMLButtonElement>('.workspace-menu-trigger');
      lastOutsideSurfaceFocusRef.current = null;
      requestAnimationFrame(() => {
        const returnTarget = target?.isConnected ? target : fallback;
      returnTarget?.focus({ preventScroll: true });
      });
    }
    accessibleSurfaceWasOpenRef.current = accessibleSurfaceOpen;
    lastAccessibleSurfaceVersionRef.current = accessibleSurfaceVersion;
  }, [accessibleSurfaceOpen, accessibleSurfaceVersion]);

  useEffect(() => {
    for (const item of board.items) {
      if (enrichmentActive.current >= 2) break;
      if (!item.sourceUrl || item.placeholder || item.isLoading || enrichmentAttempts.current.has(item.id)) continue;
      const needsImage = !item.isUserImage && (!item.imageUrl || item.imageIsGuess);
      const needsPrice = !item.priceManual && (!hasValidProductPrice(item.price, item.currency) || item.priceStale
        || !item.lastChecked || Date.now() - Date.parse(item.lastChecked) > 24 * 60 * 60_000);
      if (!needsImage && !needsPrice) continue;
      enrichmentAttempts.current.add(item.id);
      enrichmentActive.current += 1;
      void hydrateItemFromUrl(item.id, item.sourceUrl, false, true).finally(() => { enrichmentActive.current -= 1; });
    }
  }, [board.items]);

  useEffect(() => {
    let active = true;
    void fetch('/api/exchange-rates')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Exchange rates unavailable')))
      .then((data) => {
        if (!active || !data?.rates || typeof data.rates !== 'object') return;
        const rates: Record<string, number> = {};
        Object.entries(data.rates).forEach(([code, value]) => {
          if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code] = value;
        });
        if (!rates.USD) return;
        setExchangeRates(rates);
        window.localStorage.setItem(exchangeRateCacheKey, JSON.stringify({ savedAt: Date.now(), rates }));
      })
      .catch(() => { /* Totals remain pending instead of using an unsafe 1:1 conversion. */ });
    return () => { active = false; };
  }, []);

  // Observe unscaled DOM heights so wrapping text and font/image loads stay inside boards.
  const layoutIds = `${board.items.map((item) => item.id).join(',')}|${board.outfits.map((outfit) => outfit.id).join(',')}`;
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      setLayoutHeights((previous) => {
        const next = { ...previous };
        let changed = false;
        entries.forEach(({ target }) => {
          if (!(target instanceof HTMLElement)) return;
          const key = target.dataset.layoutKey;
          if (key && next[key] !== target.offsetHeight) {
            next[key] = target.offsetHeight;
            changed = true;
          }
        });
        return changed ? next : previous;
      });
    });
    boardRef.current?.querySelectorAll('[data-layout-key]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [layoutIds]);

  useLayoutEffect(() => {
    const canvas = boardRef.current;
    if (!canvas) return;
    let previous = canvas.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = canvas.getBoundingClientRect();
      if (Math.abs(next.width - previous.width) < 1 && Math.abs(next.height - previous.height) < 1) return;
      const focusedFormControl = document.activeElement instanceof HTMLElement
        && Boolean(document.activeElement.closest('input, textarea, select, [contenteditable="true"]'));
      if (focusedFormControl && next.height < previous.height) { previous = next; return; }
      const frame = viewportRef.current;
      const worldCenterX = (previous.width / 2 - frame.x) / frame.zoom;
      const worldCenterY = (previous.height / 2 - frame.y) / frame.zoom;
      previous = next;
      setViewport((current) => ({
        ...current,
        x: next.width / 2 - worldCenterX * current.zoom,
        y: next.height / 2 - worldCenterY * current.zoom,
      }));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(board)); } catch { /* Keep the live canvas usable if browser storage is full. */ }
  }, [board]);

  useEffect(() => {
    window.localStorage.setItem(userSettingsKey, JSON.stringify(userSettings));
  }, [userSettings]);

  useEffect(() => {
    importQuotaRef.current = importQuota;
    window.localStorage.setItem(importQuotaKey, JSON.stringify(importQuota));
  }, [importQuota]);

  useEffect(() => {
    window.localStorage.setItem(savedCollectionsKey, JSON.stringify(savedCollections));
  }, [savedCollections]);

  useEffect(() => {
    if (!sharedCollection) return;
    const action = new URLSearchParams(window.location.search).get('action');
    const intendedAction: SharedIntent['action'] = action === 'editable-copy' ? 'editable-copy' : action === 'start-fresh' ? 'start-fresh' : 'save';
    window.localStorage.setItem(sharedIntentKey, JSON.stringify(sharedIntentFor(sharedCollection.id, intendedAction, savedCollections)));
  }, [sharedCollection, savedCollections]);

  useEffect(() => {
    if (!isSettingsOpen) setConfirmClearBoard(false);
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !workspaceMenuRef.current?.contains(event.target)) setWorkspaceMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [workspaceMenuOpen]);

  useEffect(() => () => {
    if (wheelFrameRef.current !== null) window.cancelAnimationFrame(wheelFrameRef.current);
  }, []);


  const selectedItem = board.items.find((item) => item.id === selectedIds[0] && !item.placeholder) ?? null;
  useEffect(() => { setEditProductUrlError(''); }, [selectedItem?.id]);
  const activeOutfit = board.outfits.find((outfit) => outfit.id === activeOutfitId) ?? null;
  const validSelectedBoardIds = selectedBoardIds.filter((id) => board.outfits.some((outfit) => outfit.id === id));
  const boardDeleteLabel = bulkBoardDeleteLabel(validSelectedBoardIds.length, board.outfits.length);
  const activeSection = board.sections?.find((section) => section.id === activeSectionId) ?? null;
  const activeBoardElement = selectedBoardElement
    ? board.outfits.find((outfit) => outfit.id === selectedBoardElement.outfitId)?.elements?.find((element) => element.id === selectedBoardElement.elementId) ?? null
    : null;
  const canvasObjectTabStop = selectedIds[0] ? `item:${selectedIds[0]}`
    : validSelectedBoardIds[0] ? `board:${validSelectedBoardIds[0]}`
      : canvasSelection.sectionIds[0] ? `section:${canvasSelection.sectionIds[0]}`
        : activeBoardElement && selectedBoardElement ? `element:${selectedBoardElement.outfitId}:${selectedBoardElement.elementId}`
          : board.sections?.[0] ? `section:${board.sections[0].id}`
            : board.outfits[0] ? `board:${board.outfits[0].id}`
              : board.items[0] ? `item:${board.items[0].id}`
                : board.outfits.flatMap((outfit) => (outfit.elements ?? []).map((element) => `element:${outfit.id}:${element.id}`))[0] ?? null;
  const inspectorOpen = Boolean((selectedItem && itemDetailsOpenId === selectedItem.id) || (boardElementInspectorOpen && activeBoardElement) || (activeOutfit && !selectedItem && !selectedBoardElement));
  useEffect(() => {
    if (!inspectorOpen) return;
    requestAnimationFrame(() => {
      const inspector = appShellRef.current?.querySelector<HTMLElement>('.inspector');
      if (!inspector || inspector.contains(document.activeElement)) return;
      const firstControl = inspector.querySelector<HTMLElement>('button[aria-label="Close inspector"], input:not([type="checkbox"]):not([type="file"]), select, textarea');
      firstControl?.focus({ preventScroll: true });
    });
  }, [inspectorOpen]);
  const selectedItemPresentation = selectedItem ? resolveItemPresentation(board.outfits.find((outfit) => outfit.itemIds.includes(selectedItem.id))?.presentation, selectedItem.presentation) : null;
  const selectedBoardForToolbar = board.outfits.find((outfit) => outfit.id === selectedBoardIds[0]) ?? null;
  const selectionSummary = [
    validSelectedBoardIds.length ? `${validSelectedBoardIds.length} ${validSelectedBoardIds.length === 1 ? 'board' : 'boards'}` : '',
    selectedIds.length ? `${selectedIds.length} ${selectedIds.length === 1 ? 'product' : 'products'}` : '',
    canvasSelection.sectionIds.length ? `${canvasSelection.sectionIds.length} ${canvasSelection.sectionIds.length === 1 ? 'section' : 'sections'}` : '',
  ].filter(Boolean).join(' · ');

  useEffect(() => {
    setLayoutChoice(activeOutfit?.presentation?.layoutPreset ?? 'freeform');
  }, [activeOutfitId]);

  const boughtItems = useMemo(() => {
    const unique = new Map<string, Item>();
    board.items.filter((item) => item.bought).forEach((item) => unique.set(item.sourceUrl.trim().toLowerCase() || `item:${item.id}`, item));
    return [...unique.values()];
  }, [board.items]);

  const closetFilteredItems = useMemo(() => {
    if (closetCategory === 'All') return boughtItems;
    return boughtItems.filter((item) => closetCategoryFor(`${item.title} ${item.brand} ${item.notes}`) === closetCategory);
  }, [boughtItems, closetCategory]);

  const closetTotal = useMemo(() => spentSummary(boughtItems, userSettings.preferredCurrency, exchangeRates), [boughtItems, userSettings.preferredCurrency, exchangeRates]);

  const allowNewExternalImport = (url: string): boolean => {
    const key = canonicalImportKey(url);
    if (importQuotaRef.current.importedProductKeys.includes(key) || pendingImportKeysRef.current.has(key)) return true;
    const pending = pendingImportKeysRef.current.size;
    const reservedState = importQuotaRef.current.tier === 'guest'
      ? { ...importQuotaRef.current, guestUsed: importQuotaRef.current.guestUsed + pending }
      : { ...importQuotaRef.current, monthlyUsed: importQuotaRef.current.monthlyUsed + pending };
    const status = quotaStatus(reservedState, url);
    if (status.allowed) return true;
    importQuotaRef.current = { ...importQuotaRef.current, pendingUrl: url };
    setImportQuota(importQuotaRef.current);
    setQuotaPrompt({ reason: status.reason ?? 'monthly-limit', pendingUrl: url });
    return false;
  };

  const completeExternalImport = (url: string) => {
    pendingImportKeysRef.current.delete(canonicalImportKey(url));
    setImportQuota((current) => {
      const next = recordSuccessfulImport(current, url);
      importQuotaRef.current = next;
      const status = quotaStatus(next, 'https://quota-warning.invalid/new-product');
      if (status.warning) {
        setProcessingLabel(status.warning);
        window.setTimeout(() => setProcessingLabel(null), 2600);
      }
      return next;
    });
  };

  const reserveExternalImport = (url: string): boolean => {
    if (!allowNewExternalImport(url)) return false;
    const key = canonicalImportKey(url);
    if (!importQuotaRef.current.importedProductKeys.includes(key)) pendingImportKeysRef.current.add(key);
    return true;
  };

  const releaseExternalImport = (url: string) => pendingImportKeysRef.current.delete(canonicalImportKey(url));

  const openAddLink = (event?: React.MouseEvent<HTMLElement>) => {
    if (event?.currentTarget instanceof HTMLElement) lastOutsideSurfaceFocusRef.current = event.currentTarget;
    setAddUrlError('');
    setIsAdding(true);
  };

  const addItem = async (position?: PointerPosition) => {
    const sourceUrl = draft.sourceUrl.trim();
    const resolverUrl = normaliseProductUrl(sourceUrl);
    if (!resolverUrl || isDirectImageUrl(sourceUrl)) {
      setAddUrlError(!sourceUrl ? 'Enter a product page URL.' : isDirectImageUrl(sourceUrl) ? 'Use a product page URL rather than a direct image link.' : 'Enter a valid http or https product page URL.');
      return;
    }
    setAddUrlError('');
    const wasManualEntry = isManual;
    const parsedPrice = Number.parseFloat(draft.price);
    const itemPosition = position ?? { x: 360 + (board.items.length % 3) * 252, y: 170 + (board.items.length % 2) * 312 };
    const duplicate = board.items.find((item) => item.sourceUrl === sourceUrl || productLink(item.sourceUrl) === resolverUrl);
    if (duplicate) {
      setSelectedIds([duplicate.id]);
      setIsAdding(false);
      return;
    }
    if (!reserveExternalImport(resolverUrl)) return;
    let extracted: { title?: string; brand?: string; retailer?: string; imageUrl?: string; imageIsGuess?: boolean; imageUrls?: string[]; price?: string; estimateLow?: string; estimateHigh?: string; priceEstimated?: boolean; priceStale?: boolean; priceReference?: string; currency?: string; currencyAssumed?: boolean; priceInfo?: Record<string, unknown> | null; availability?: string; availabilityVerified?: boolean; stockCount?: string; colors?: string[]; sizes?: string[]; productId?: string; variantId?: string; resolutionStatus?: Item['resolutionStatus']; fieldSources?: Record<string, string>; fieldConfidence?: Record<string, string> } = {};
    if (draft.sourceUrl.trim()) {
      setProcessingLabel('Checking retailer details and trusted product results…');
      try {
        const response = await fetch('/api/extract-product', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: sourceUrl, preferredCurrency: userSettings.preferredCurrency, preferredSize: userSettings.sizePreferences.generalClothing?.value ?? '', sizePreferences: userSettings.sizePreferences }) });
        if (response.ok) { extracted = await response.json(); completeExternalImport(resolverUrl); }
        else releaseExternalImport(resolverUrl);
      } catch {
        releaseExternalImport(resolverUrl);
        // Safe extraction fallback
      }
    }
    const extractedPrice = Number.parseFloat(extracted.price ?? '');
    let stickerImage = draft.imageUrl.trim();
    if (!stickerImage && extracted.imageUrl) stickerImage = extracted.imageUrl;
    const titleVerified = Boolean(draft.title.trim() || (extracted.title && extracted.fieldSources?.title !== 'url_slug' && extracted.fieldConfidence?.title !== 'LOW'));
    const priceFresh = Number.isFinite(parsedPrice) && parsedPrice > 0 && /^[A-Z]{3}$/.test((draft.currency || 'USD').toUpperCase())
      || Number.isFinite(extractedPrice) && extractedPrice > 0 && /^[A-Z]{3}$/.test((extracted.currency || '').toUpperCase()) && !extracted.priceStale;

    const newItem: Item = {
      id: crypto.randomUUID(),
      title: draft.title.trim() || extracted.title || fallbackProductTitle(normalizeRetailerDisplay(extracted.retailer || sourceBrand(draft.sourceUrl))),
      brand: normalizeBrandDisplay(draft.brand.trim() || extracted.brand),
      retailer: normalizeRetailerDisplay(extracted.retailer || sourceBrand(draft.sourceUrl)),
      sourceUrl,
      canonicalProductId: extracted.productId,
      variantId: extracted.variantId,
      resolutionStatus: titleVerified && priceFresh ? 'RESOLVED' : titleVerified || stickerImage || priceFresh ? 'PARTIAL' : 'UNRESOLVED',
      currencyAssumed: Number.isFinite(parsedPrice) ? false : Boolean(extracted.currencyAssumed),
      priceInfo: Number.isFinite(parsedPrice) ? { amount: parsedPrice, currency: wasManualEntry ? draft.currency : extracted.currency, source: 'user', updatedAt: new Date().toISOString(), currencyAssumed: false } : extracted.priceInfo ?? undefined,
      fieldSources: {
        ...(extracted.fieldSources ?? {}),
        ...(draft.title.trim() ? { title: 'user_edit' } : {}),
        ...(Number.isFinite(parsedPrice) ? { price: 'user_edit', currency: 'user_edit' } : {}),
        ...(draft.imageUrl.trim() ? { imageUrl: 'user_edit' } : {}),
      },
      fieldConfidence: extracted.fieldConfidence,
      imageUrl: stickerImage,
      imageIsGuess: Boolean(extracted.imageIsGuess && stickerImage === extracted.imageUrl),
      imageOptions: extracted.imageUrls ?? [],
      price: Number.isFinite(parsedPrice) ? parsedPrice : Number.isFinite(extractedPrice) ? extractedPrice : null,
      priceManual: Number.isFinite(parsedPrice),
      titleManual: Boolean(draft.title.trim()),
      brandManual: Boolean(draft.brand.trim()),
      colorManual: Boolean(draft.color.trim()),
      sizeManual: Boolean(draft.size.trim()),
      priceEstimated: !Number.isFinite(parsedPrice) && Boolean(extracted.priceEstimated),
      priceStale: Number.isFinite(parsedPrice) ? false : Boolean(extracted.priceStale),
      estimateLow: !Number.isFinite(parsedPrice) && extracted.estimateLow ? Number(extracted.estimateLow) : undefined,
      estimateHigh: !Number.isFinite(parsedPrice) && extracted.estimateHigh ? Number(extracted.estimateHigh) : undefined,
      priceReference: Number.isFinite(parsedPrice) ? 'Manually entered price' : extracted.priceReference,
      currency: (wasManualEntry ? draft.currency : extracted.currency) || userSettings.preferredCurrency || 'USD',
      color: draft.color.trim() || extracted.colors?.[0] || '',
      size: draft.size.trim() || extracted.sizes?.[0] || '',
      colorOptions: extracted.colors ?? [],
      sizeOptions: extracted.sizes ?? [],
      availability: availabilityFrom(extracted.availability, draft.availability, extracted.stockCount),
      availabilityVerified: Boolean(extracted.availabilityVerified),
      bought: false,
      isLoading: false,
      lastChecked: new Date().toISOString(),
      priceHistory: Number.isFinite(parsedPrice) || (Number.isFinite(extractedPrice) && !extracted.priceEstimated) ? [{ checkedAt: new Date().toISOString(), price: Number.isFinite(parsedPrice) ? parsedPrice : extractedPrice }] : [],
      notes: draft.notes.trim(),
      unsure: false,
      x: itemPosition.x,
      y: itemPosition.y,
      createdAt: new Date().toISOString(),
    };

    setBoard((current) => {
      const destination = current.outfits.find((outfit) => outfit.id === activeOutfitId);
      if (!destination) return { ...current, items: [...current.items, newItem] };
      const placed = { ...newItem, ...positionForBoardItem(destination, current.items, newItem, layoutHeights) };
      return { items: [...current.items, placed], outfits: current.outfits.map((outfit) => outfit.id === destination.id ? { ...outfit, itemIds: [...outfit.itemIds, newItem.id] } : outfit) };
    });
    setSelectedIds([newItem.id]);
    setItemDetailsOpenId(wasManualEntry ? newItem.id : null);
    setDraft(blankDraft);
    setIsManual(false);
    setIsAdding(false);
    setProcessingLabel(null);
  };

  const clientToBoard = (clientX: number, clientY: number): PointerPosition => {
    const rectangle = boardRef.current?.getBoundingClientRect();
    if (!rectangle) return { x: 360, y: 170 };
    return {
      x: (clientX - rectangle.left - viewport.x) / viewport.zoom - cardWidth / 2,
      y: (clientY - rectangle.top - viewport.y) / viewport.zoom - cardHeight / 2,
    };
  };

  const addImage = async (file: File, position: PointerPosition) => {
    if (!file.type.startsWith('image/')) return;
    setProcessingLabel('Preparing outfit image…');
    try {
      const imageUrl = await fileToDataUrl(file);
      const title = file.name.replace(/\.[^.]+$/, '').replaceAll(/[-_]/g, ' ');
      const savedItem = addSticker(imageUrl, position, title || 'Saved piece', '', { isUserImage: true });
      if (savedItem) setImageIntentPicker({ itemId: savedItem.id, pieces: [] });
    } finally {
      setProcessingLabel(null);
    }
  };

  const addSticker = (imageUrl: string, position: PointerPosition, title: string, label = '', extras: Partial<Item> = {}): Item | null => {
    const existing = board.items.find((item) => item.imageUrl === imageUrl);
    if (existing) {
      setSelectedIds([existing.id]);
      return null;
    }
    const newItem: Item = {
      id: crypto.randomUUID(),
      title,
      brand: '',
      sourceUrl: '',
      imageUrl,
      price: null,
      currency: userSettings.preferredCurrency || 'USD',
      color: '',
      size: '',
      colorOptions: [],
      sizeOptions: [],
      availability: '',
      availabilityVerified: false,
      notes: label ? 'Detected: ' + label : '',
      unsure: true,
      x: position.x,
      y: position.y,
      createdAt: new Date().toISOString(),
      resolutionStatus: 'PARTIAL',
      fieldSources: extras.fieldSources ?? (extras.isUserImage ? { imageUrl: 'user_edit' } : {}),
      ...extras,
    };

    setBoard((current) => ({ ...current, items: [...current.items, newItem] }));
    setSelectedIds([newItem.id]);
    return newItem;
  };

  const addLink = (rawUrl: string, position: PointerPosition, targetBoardId?: string) => {
    const sourceUrl = rawUrl.trim();
    const normalizedUrl = normaliseProductUrl(rawUrl);
    if (!normalizedUrl || isDirectImageUrl(normalizedUrl)) return;

    const existing = board.items.find((item) => productLink(item.sourceUrl) === normalizedUrl);
    if (existing) {
      setSelectedIds([existing.id]);
      void hydrateItemFromUrl(existing.id, sourceUrl);
      return;
    }
    if (!reserveExternalImport(normalizedUrl)) return;

    const newItem: Item = {
      id: crypto.randomUUID(),
      title: sourceBrand(normalizedUrl) ? sourceBrand(normalizedUrl) + ' product' : 'Saved product link',
      brand: '',
      retailer: normalizeRetailerDisplay(sourceBrand(normalizedUrl)),
      sourceUrl,
      imageUrl: '',
      price: null,
      currency: userSettings.preferredCurrency || 'USD',
      color: '',
      size: '',
      colorOptions: [],
      sizeOptions: [],
      availability: '',
      availabilityVerified: false,
      notes: '',
      unsure: false,
      isLoading: true,
      x: position.x,
      y: position.y,
      createdAt: new Date().toISOString(),
    };

    setBoard((current) => {
      const destination = current.outfits.find((outfit) => outfit.id === (targetBoardId ?? activeOutfitId));
      if (!destination) return { ...current, items: [...current.items, newItem] };
      const placed = { ...newItem, ...positionForBoardItem(destination, current.items, newItem, layoutHeights), autoPlaced: true };
      return { items: [...current.items, placed], outfits: current.outfits.map((outfit) => outfit.id === destination.id ? { ...outfit, itemIds: [...outfit.itemIds, newItem.id] } : outfit) };
    });
    setSelectedIds([newItem.id]);
    void hydrateItemFromUrl(newItem.id, sourceUrl, true);
  };

  const addImageAddress = (rawUrl: string, position: PointerPosition) => {
    const normalizedUrl = normaliseProductUrl(rawUrl);
    if (!normalizedUrl) return;
    const newItem = addSticker(normalizedUrl, position, 'Pasted image', '', { isUserImage: true });
    if (newItem) setImageIntentPicker({ itemId: newItem.id, pieces: [] });
  };

  const hydrateItemFromUrl = async (itemId: string, url: string, countsAsNewImport = false, background = false) => {
    if (countsAsNewImport && !reserveExternalImport(url)) return;
    const currentItem = board.items.find((candidate) => candidate.id === itemId);
    const lockedFields = currentItem ? [
      currentItem.titleManual && 'title',
      currentItem.brandManual && 'brand',
      currentItem.priceManual && 'price',
      currentItem.priceManual && 'currency',
      currentItem.isUserImage && 'imageUrl',
      currentItem.colorManual && 'color',
      currentItem.sizeManual && 'size',
    ].filter((field): field is string => Boolean(field)) : [];
    setBoard((current) => ({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, isLoading: true } : item) }));
    if (!background) setProcessingLabel('Checking retailer details and trusted product results…');
    try {
      const response = await fetch('/api/extract-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          preferredCurrency: userSettings.preferredCurrency,
          preferredSize: userSettings.sizePreferences.generalClothing?.value ?? '',
          sizePreferences: userSettings.sizePreferences,
          lockedFields,
          rejectedImages: Object.entries(currentItem?.brokenImages ?? {}).filter(([, at]) => Date.now() - at < 15 * 60_000).map(([image]) => image),
          existing: currentItem ? {
            title: currentItem.title,
            brand: currentItem.brand,
            price: currentItem.price,
            currency: currentItem.currency,
            imageUrl: currentItem.imageUrl,
            color: currentItem.color,
            size: currentItem.size,
          } : {},
        }),
      });
      if (!response.ok) return;
      if (countsAsNewImport) completeExternalImport(url);
      const extracted: { title?: string; brand?: string; retailer?: string; imageUrl?: string; imageIsGuess?: boolean; imageUrls?: string[]; price?: string; estimateLow?: string; estimateHigh?: string; priceEstimated?: boolean; priceStale?: boolean; currency?: string; currencyAssumed?: boolean; priceInfo?: Record<string, unknown> | null; availability?: string; availabilityVerified?: boolean; stockCount?: string; colors?: string[]; sizes?: string[]; priceReference?: string; imageFallbackTried?: boolean; productId?: string; variantId?: string; resolutionStatus?: Item['resolutionStatus']; fieldSources?: Record<string, string>; fieldConfidence?: Record<string, string> } = await response.json();
      const price = Number.parseFloat(extracted.price ?? '');
      const change: Partial<Item> = {};
      if (extracted.title && !currentItem?.titleManual) change.title = extracted.title;
      if (extracted.brand && !currentItem?.brandManual) change.brand = normalizeBrandDisplay(extracted.brand);
      if (extracted.retailer) change.retailer = normalizeRetailerDisplay(extracted.retailer);
      if (hasValidProductPrice(price, extracted.currency || '')) { change.price = price; change.priceEstimated = extracted.priceEstimated ?? false; }
      if (hasValidProductPrice(price, extracted.currency || '')) {
        change.priceStale = Boolean(extracted.priceStale);
        if (extracted.priceInfo) change.priceInfo = extracted.priceInfo;
      }
      change.estimateLow = extracted.estimateLow ? Number(extracted.estimateLow) : undefined;
      change.estimateHigh = extracted.estimateHigh ? Number(extracted.estimateHigh) : undefined;
      if (extracted.priceReference) change.priceReference = extracted.priceReference;
      if (extracted.currency && (hasValidProductPrice(price, extracted.currency) || !currentItem?.price)) change.currency = extracted.currency;
      change.canonicalProductId = extracted.productId;
      change.variantId = extracted.variantId;
      if (Number.isFinite(price) && !currentItem?.priceManual) change.currencyAssumed = extracted.currencyAssumed;
      change.fieldSources = extracted.fieldSources;
      change.fieldConfidence = extracted.fieldConfidence;
      change.availability = availabilityFrom(extracted.availability, '', extracted.stockCount);
      change.availabilityVerified = Boolean(extracted.availabilityVerified);
      if (extracted.imageUrls?.length) change.imageOptions = extracted.imageUrls;
      if (extracted.colors?.length) { change.colorOptions = extracted.colors; if (!currentItem?.colorManual) change.color = extracted.colors[0]; }
      if (extracted.sizes?.length) { change.sizeOptions = extracted.sizes; if (!currentItem?.sizeManual) change.size = extracted.sizes[0]; }
      const checkedAt = new Date().toISOString();
      setBoard((current) => ({
        ...current,
        items: current.items.map((item) => {
          if (item.id !== itemId) return item;
          const history = Number.isFinite(price) && !extracted.priceStale
            ? [...(item.priceHistory ?? []), { checkedAt, price }].slice(-24)
            : item.priceHistory;
          const fieldSources = { ...(item.fieldSources ?? {}), ...(extracted.fieldSources ?? {}) };
          if (item.titleManual) fieldSources.title = 'user_edit';
          if (item.priceManual) { fieldSources.price = 'user_edit'; fieldSources.currency = 'user_edit'; }
          if (item.isUserImage) fieldSources.imageUrl = 'user_edit';
          const confidenceRank = (value?: string) => value === 'HIGH' ? 3 : value === 'MEDIUM' ? 2 : value === 'LOW' ? 1 : 0;
          const keepTitle = item.titleManual || Boolean(item.title && confidenceRank(item.fieldConfidence?.title) > confidenceRank(extracted.fieldConfidence?.title));
          const nextTitle = keepTitle ? item.title : extracted.title || item.title;
          if (keepTitle && item.fieldSources?.title) fieldSources.title = item.fieldSources.title;
          const titleConfidence = extracted.title ? extracted.fieldConfidence?.title : item.fieldConfidence?.title;
          const titleVerified = Boolean(item.titleManual || (nextTitle && fieldSources.title !== 'url_slug' && titleConfidence !== 'LOW'));
          const priceFresh = Boolean(item.priceManual && hasValidProductPrice(item.price, item.currency)
            || Number.isFinite(price) && price! > 0 && /^[A-Z]{3}$/.test((extracted.currency || '').toUpperCase()) && !extracted.priceStale);
          const updated: Item = { ...item, ...change, fieldSources,
            title: nextTitle,
            fieldConfidence: { ...item.fieldConfidence, ...extracted.fieldConfidence,
              ...(keepTitle && item.fieldConfidence?.title ? { title: item.fieldConfidence.title } : {}) },
            ...(item.brandManual ? { brand: item.brand } : {}),
            ...(item.colorManual ? { color: item.color } : {}),
            ...(item.sizeManual ? { size: item.size } : {}),
            ...(!item.isUserImage && (!background || !item.imageUrl || item.imageIsGuess) && extracted.imageUrl && !(item.brokenImages?.[extracted.imageUrl] && Date.now() - item.brokenImages[extracted.imageUrl] < 15 * 60_000)
              ? { imageUrl: extracted.imageUrl, imageIsGuess: Boolean(extracted.imageIsGuess) } : {}),
            resolutionStatus: titleVerified && priceFresh && (item.priceManual ? item.currency : extracted.currency || item.currency) ? 'RESOLVED'
              : titleVerified || item.imageUrl || extracted.imageUrl || priceFresh ? 'PARTIAL' : 'UNRESOLVED',
            ...(item.priceManual ? { price: item.price, currency: item.currency, currencyAssumed: item.currencyAssumed, priceInfo: item.priceInfo, priceStale: false, priceEstimated: item.priceEstimated, priceReference: item.priceReference, estimateLow: item.estimateLow, estimateHigh: item.estimateHigh } : {}),
            lastChecked: checkedAt, priceHistory: history };
          if (background || !item.autoPlaced) return updated;
          const outfit = current.outfits.find((candidate) => candidate.itemIds.includes(item.id));
          if (!outfit) return { ...updated, autoPlaced: false };
          return { ...updated, ...positionForBoardItem(outfit, current.items.filter((candidate) => candidate.id !== item.id), updated, layoutHeights), autoPlaced: false };
        }),
      }));
    } catch {
      // Preserve the card and its fields on transient enrichment failures.
    } finally {
      if (countsAsNewImport) releaseExternalImport(url);
      setBoard((current) => ({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, isLoading: false } : item) }));
      if (!background) setProcessingLabel(null);
    }
  };

  const updateItem = (id: string, change: Partial<Item>) => {
    setBoard((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    }));
  };

  const openPlaceholder = (item: Item) => {
    setReplacingPlaceholderId(item.id);
    setPlaceholderDraft({ url: '', title: '', brand: '', price: '', imageUrl: '' });
    setSelectedIds([item.id]);
    setActiveOutfitId(null);
    setItemMenu(null);
  };

  const replacePlaceholderWithUrl = () => {
    const id = replacingPlaceholderId;
    const url = normaliseProductUrl(placeholderDraft.url);
    if (!id || !url || isDirectImageUrl(url) || !allowNewExternalImport(url)) return;
    setBoard((current) => ({ ...current, items: current.items.map((item) => item.id === id && isTemplatePlaceholder(item)
      ? replaceTemplatePlaceholder(item, { title: sourceBrand(url) ? `${sourceBrand(url)} product` : 'Saved product',
        sourceUrl: url, retailer: sourceBrand(url), isLoading: true }) : item) }));
    setReplacingPlaceholderId(null);
    void hydrateItemFromUrl(id, url, true);
  };

  const replacePlaceholderManually = () => {
    const id = replacingPlaceholderId;
    const title = placeholderDraft.title.trim();
    if (!id || !title) return;
    const price = Number.parseFloat(placeholderDraft.price);
    setBoard((current) => ({ ...current, items: current.items.map((item) => item.id === id && isTemplatePlaceholder(item)
      ? replaceTemplatePlaceholder(item, { title, brand: placeholderDraft.brand.trim(), imageUrl: placeholderDraft.imageUrl,
        isUserImage: Boolean(placeholderDraft.imageUrl), titleManual: true, brandManual: Boolean(placeholderDraft.brand.trim()),
        price: Number.isFinite(price) ? price : null, priceManual: Number.isFinite(price), currency: userSettings.preferredCurrency }) : item) }));
    setReplacingPlaceholderId(null);
  };

  const updateItemPresentation = (item: Item, change: ItemPresentation) => {
    updateItem(item.id, { presentation: { ...item.presentation, ...change } });
  };

  const toggleBought = (item: Item) => {
    updateItem(item.id, { bought: !item.bought });
  };

  const findVisualMatches = async (item: Item | null) => {
    if (item === null) return;
    setMatchPicker({ itemId: item.id, status: 'loading', matches: [], message: 'Looking for visual matches…' });
    try {
      const searchImage = item.imageUrl.startsWith('data:image/') ? await makeSearchImage(item.imageUrl) : '';
      const response = await fetch('/api/visual-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchImage ? { imageDataUrl: searchImage } : { imageUrl: item.imageUrl }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMatchPicker({ itemId: item.id, status: 'error', matches: [], message: result.error ?? 'Visual search could not find a match.' });
        return;
      }
      const matches = Array.isArray(result.matches) ? result.matches : [];
      setMatchPicker({ itemId: item.id, status: 'ready', matches, message: matches.length ? 'Choose the closest product.' : 'No close product matches were returned.' });
    } catch {
      setMatchPicker({ itemId: item.id, status: 'error', matches: [], message: 'Visual search is unavailable right now.' });
    }
  };

  const beginImageSearch = () => {
    if (!imageIntentPicker?.pieces.length) return;
    const source = board.items.find((item) => item.id === imageIntentPicker.itemId);
    if (!source?.imageUrl) return;
    const review: PieceSearchReview = {
      sourceItemId: source.id,
      sourceImageUrl: source.imageUrl,
      pieces: imageIntentPicker.pieces,
      index: 0,
      createdIds: [],
      status: 'loading',
      matches: [],
      message: 'Zooming in on ' + imageIntentPicker.pieces[0] + '…',
    };
    setImageIntentPicker(null);
    setPieceSearchReview(review);
    void loadPieceMatches(review.sourceItemId, review.pieces[0], review.sourceImageUrl);
  };

  const openCropAdjustment = () => {
    setPieceSearchReview((current) => current ? {
      ...current,
      adjustingCrop: true,
      crop: current.crop ?? defaultCropForPiece(current.pieces[current.index]),
    } : null);
  };

  const cropPointerPosition = (event: React.PointerEvent<HTMLElement>): PointerPosition => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rectangle.top) / rectangle.height)),
    };
  };

  const startCropDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = cropPointerPosition(event);
    cropDrawRef.current = start;
    setPieceSearchReview((current) => current ? { ...current, crop: { x: start.x, y: start.y, width: 0.01, height: 0.01 } } : null);
  };

  const moveCropDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = cropDrawRef.current;
    if (!start) return;
    const currentPosition = cropPointerPosition(event);
    setPieceSearchReview((current) => current ? {
      ...current,
      crop: {
        x: Math.min(start.x, currentPosition.x),
        y: Math.min(start.y, currentPosition.y),
        width: Math.max(0.01, Math.abs(currentPosition.x - start.x)),
        height: Math.max(0.01, Math.abs(currentPosition.y - start.y)),
      },
    } : null);
  };

  const endCropDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cropDrawRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    cropDrawRef.current = null;
  };

  const searchAdjustedCrop = () => {
    if (!pieceSearchReview?.crop) return;
    const piece = pieceSearchReview.pieces[pieceSearchReview.index];
    setPieceSearchReview((current) => current ? { ...current, adjustingCrop: false } : null);
    void loadPieceMatches(pieceSearchReview.sourceItemId, piece, pieceSearchReview.sourceImageUrl, pieceSearchReview.crop);
  };

  const enrichPiecePrices = async (sourceItemId: string, reviewIndex: number, matches: VisualMatch[]) => {
    const pending = matches.filter((match) => !Number.isFinite(Number.parseFloat(match.price.replace(/[^0-9.]/g, '')))).slice(0, 10);
    let cursor = 0;
    const checkNext = async (): Promise<void> => {
      const match = pending[cursor];
      cursor += 1;
      if (!match) return;
      let update: Partial<VisualMatch> = { priceStatus: 'unavailable' };
      try {
        const response = await fetch('/api/extract-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: match.link }),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const product: { price?: string; currency?: string; priceEstimated?: boolean } = await response.json();
          const found = Number.parseFloat(product.price ?? '');
          if (Number.isFinite(found)) update = { price: String(found), currency: product.currency, priceEstimated: product.priceEstimated ?? false, priceStatus: 'ready' };
        }
      } catch {
        // The brand estimate below is still useful when a retailer blocks us.
      }
      if (update.priceStatus === 'unavailable') {
        const estimate = brandPriceEstimate(match.title, match.source, match.link);
        if (estimate !== null) update = { price: String(estimate), currency: userSettings.preferredCurrency, priceEstimated: true, priceStatus: 'ready' };
      }
      setPieceSearchReview((current) => current && current.sourceItemId === sourceItemId && current.index === reviewIndex ? {
        ...current,
        matches: current.matches.map((candidate) => candidate.link === match.link ? { ...candidate, ...update } : candidate),
      } : current);
      await checkNext();
    };
    await Promise.allSettled([checkNext(), checkNext()]);
  };

  const loadPieceMatches = async (sourceItemId: string, piece: string, originalImageUrl?: string, selectedCrop?: ImageCrop) => {
    const source = board.items.find((item) => item.id === sourceItemId);
    const sourceImage = originalImageUrl || pieceSearchReview?.sourceImageUrl || source?.imageUrl;
    if (!sourceImage) return;
    setPieceSearchReview((current) => current ? { ...current, status: 'loading', matches: [], adjustingCrop: false, message: 'Looking for ' + piece + '…' } : null);
    try {
      const searchImage = await makePieceSearchImage(sourceImage, piece, selectedCrop);
      setPieceSearchReview((current) => current ? { ...current, searchImageUrl: searchImage, message: `Searching the zoomed ${piece.toLowerCase()} area…` } : null);
      const response = await fetch('/api/visual-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: searchImage, piece }),
      });
      const result = await response.json();
      const matches: VisualMatch[] = response.ok && Array.isArray(result.matches) ? result.matches.map((match: VisualMatch) => ({
        ...match,
        priceStatus: Number.isFinite(Number.parseFloat(match.price.replace(/[^0-9.]/g, ''))) ? 'ready' : 'checking',
      })) : [];
      const matchKind = result.matchKind === 'original' ? 'original' : 'alternatives';
      const reviewIndex = pieceSearchReview?.pieces.indexOf(piece) ?? 0;
      setPieceSearchReview((current) => current ? {
        ...current,
        status: matches.length ? 'ready' : 'error',
        matches,
        matchKind,
        message: matches.length
          ? matchKind === 'original'
            ? `These shopping listings may be the original ${piece.toLowerCase()}. They are ranked by visual similarity; select the correct one.`
            : `Cura could not find a purchasable original. These ${piece.toLowerCase()} alternatives are ranked by color, pattern, silhouette, and visible texture.`
          : ('No purchasable original or close shopping alternative was found for this ' + piece + '.'),
      } : null);
      if (matches.length) void enrichPiecePrices(sourceItemId, reviewIndex, matches);
    } catch {
      setPieceSearchReview((current) => current ? { ...current, status: 'error', matches: [], message: 'Visual search is unavailable right now.' } : null);
    }
  };

  const choosePieceMatch = (match: VisualMatch | null) => {
    if (!pieceSearchReview) return;
    if (match && !allowNewExternalImport(match.link)) return;
    const source = board.items.find((item) => item.id === pieceSearchReview.sourceItemId);
    if (!source) return;
    const piece = pieceSearchReview.pieces[pieceSearchReview.index];
    const parsedPrice = Number.parseFloat(match?.price.replace(/[^0-9.]/g, '') ?? '');
    const itemId = crypto.randomUUID();
    const change: Partial<Item> = {
      title: match?.title || piece,
      brand: '',
      retailer: normalizeRetailerDisplay(match?.source),
      sourceUrl: match?.link || '',
      price: Number.isFinite(parsedPrice) ? parsedPrice : match ? null : estimatedPiecePrice(piece),
      priceEstimated: match ? Boolean(match.priceEstimated) : true,
      currency: match?.currency || userSettings.preferredCurrency || 'USD',
      notes: match ? 'Found while looking for ' + piece + '.' : 'No exact match found. Added as ' + piece + '.',
      unsure: !match,
      imageUrl: pieceSearchReview.searchImageUrl || pieceSearchReview.sourceImageUrl,
    };

    const copy: Item = {
      ...source,
      ...change,
      id: itemId,
      x: source.x + (pieceSearchReview.index + 1) * 36,
      y: source.y + (pieceSearchReview.index + 1) * 28,
      locked: false,
      isUserImage: false,
      createdAt: new Date().toISOString(),
    };
    setBoard((current) => ({ ...current, items: [...current.items, copy] }));
    if (match) void hydrateItemFromUrl(itemId, match.link, true);
    const createdIds = [...pieceSearchReview.createdIds, itemId];
    const nextIndex = pieceSearchReview.index + 1;
    if (nextIndex >= pieceSearchReview.pieces.length) {
      setBoard((current) => ({
        items: current.items.filter((item) => item.id !== pieceSearchReview.sourceItemId),
        outfits: current.outfits.map((outfit) => ({ ...outfit, itemIds: outfit.itemIds.filter((id) => id !== pieceSearchReview.sourceItemId) })),
      }));
      setSelectedIds(createdIds);
      setPieceSearchReview(null);
      return;
    }
    const nextPiece = pieceSearchReview.pieces[nextIndex];
    setPieceSearchReview({ ...pieceSearchReview, index: nextIndex, createdIds, status: 'loading', matches: [], matchKind: undefined, crop: undefined, adjustingCrop: false, searchImageUrl: undefined, message: 'Looking for ' + nextPiece + '…' });
    void loadPieceMatches(source.id, nextPiece, pieceSearchReview.sourceImageUrl);
  };

  const chooseVisualMatch = (itemId: string, match: VisualMatch) => {
    if (!allowNewExternalImport(match.link)) return;
    const number = Number.parseFloat(match.price.replace(/[^0-9.]/g, ''));
    updateItem(itemId, {
      title: match.title,
      brand: '',
      retailer: normalizeRetailerDisplay(match.source),
      sourceUrl: match.link,
      price: Number.isFinite(number) ? number : null,
      priceEstimated: false,
      unsure: false,
    });
    setMatchPicker(null);
    setSelectedIds([itemId]);
    void hydrateItemFromUrl(itemId, match.link, true);
  };

  function removeItem(id: string) {
    setBoard((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== id),
      outfits: current.outfits.flatMap((outfit) => {
        const itemIds = outfit.itemIds.filter((itemId) => itemId !== id);
        return outfit.itemIds.includes(id) && itemIds.length === 0 && !outfit.preserveWhenEmpty ? [] : [{ ...outfit, itemIds }];
      }),
      sections: current.sections?.map((section) => ({ ...section, itemIds: section.itemIds.filter((itemId) => itemId !== id) })),
    }));
    setSelectedIds((current) => current.filter((itemId) => itemId !== id));
    if (itemDetailsOpenId === id) setItemDetailsOpenId(null);
    if (alternativeItemId === id) setAlternativeItemId(null);
  }

  const duplicateItem = (item: Item) => {
    const copy: Item = {
      ...item,
      id: crypto.randomUUID(),
      x: item.x + 28,
      y: item.y + 28,
      locked: false,
      createdAt: new Date().toISOString(),
    };
    setBoard((current) => ({ ...current, items: [...current.items, copy] }));
    setSelectedIds([copy.id]);
    setItemMenu(null);
  };

  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    const idMap = new Map<string, string>();
    const copies = board.items.filter((item) => selected.has(item.id)).map((item) => {
      const id = crypto.randomUUID();
      idMap.set(item.id, id);
      return { ...item, id, x: item.x + 28, y: item.y + 28, locked: false, createdAt: new Date().toISOString() };
    });
    setBoard((current) => ({
      items: [...current.items, ...copies],
      outfits: current.outfits.map((outfit) => ({
        ...outfit,
        itemIds: [...outfit.itemIds, ...outfit.itemIds.flatMap((id) => idMap.has(id) ? [idMap.get(id)!] : [])],
      })),
    }));
    setSelectedIds(copies.map((item) => item.id));
    setSelectionMenu(null);
  };

  const updateSelectedPresentation = (preset: ItemPresentation['preset']) => {
    const selected = new Set(selectedIds);
    setBoard((current) => ({
      ...current,
      items: current.items.map((item) => selected.has(item.id)
        ? { ...item, presentation: { ...item.presentation, preset } }
        : item),
    }));
  };

  const performDeletion = (itemIds: string[], outfitId?: string) => {
    const ids = new Set(itemIds);
    setBoard((current) => {
      return {
        ...current,
        items: current.items.filter((item) => !ids.has(item.id)),
        outfits: current.outfits.flatMap((candidate) => {
          if (candidate.id === outfitId) return [];
          const remainingIds = candidate.itemIds.filter((itemId) => !ids.has(itemId));
          return candidate.itemIds.some((itemId) => ids.has(itemId)) && remainingIds.length === 0 && !candidate.preserveWhenEmpty ? [] : [{ ...candidate, itemIds: remainingIds }];
        }),
        sections: current.sections?.map((section) => ({ ...section,
          boardIds: section.boardIds.filter((id) => id !== outfitId), itemIds: section.itemIds.filter((id) => !ids.has(id)) })),
      };
    });
    setSelectedIds([]);
    setActiveOutfitId(null);
    if (outfitId) setSelectedBoardIds((current) => current.filter((id) => id !== outfitId));
    setBoardMenu(null);
    setSelectionMenu(null);
    setDeletionRequest(null);
    announceCanvasAction(`${itemIds.length} ${itemIds.length === 1 ? 'product' : 'products'} deleted.`);
  };

  const requestDeletion = (itemIds: string[], outfitId?: string) => {
    if (itemIds.length <= 1 || userSettings.skipBulkDeleteConfirmation) {
      performDeletion(itemIds, outfitId);
      return;
    }
    setNeverAskBulkDelete(false);
    setDeletionRequest({ itemIds, outfitId });
  };

  const deleteBoardAndContents = (outfitId: string) => {
    const outfit = board.outfits.find((candidate) => candidate.id === outfitId);
    if (!outfit) return;
    setNeverAskBulkDelete(false);
    setDeletionRequest({ itemIds: [], boardIds: [outfitId] });
  };

  const selectBoard = (boardId: string, additive = false, keepBulkSelectionOpen = false) => {
    const coarseSelectTap = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && canvasMode === 'select';
    const toggling = additive || coarseSelectTap;
    const boardIds = toggling
      ? toggleBoardSelection(canvasSelection.boardIds, boardId, board.outfits.map((outfit) => outfit.id))
      : [boardId];
    const childIds = new Set(board.outfits.filter((outfit) => boardIds.includes(outfit.id)).flatMap((outfit) => outfit.itemIds));
    setCanvasSelection((current) => normalizeCanvasSelection({
      itemIds: toggling ? current.itemIds.filter((id) => !childIds.has(id)) : [],
      boardIds,
      sectionIds: [],
    }, board.outfits.flatMap((outfit) => {
      const bounds = getOutfitBounds(outfit, board.items, layoutHeights);
      return bounds ? [{ id: outfit.id, left: bounds.left, top: bounds.top, right: bounds.left + bounds.width,
        bottom: bounds.top + bounds.height, itemIds: outfit.itemIds }] : [];
    })));
    if (!keepBulkSelectionOpen) setBoardSelectionOpen(false);
    setActiveOutfitId(null);
    setActiveSectionId(null);
    setRenamingOutfitId(null);
    setRenamingSectionId(null);
    setSectionMobileEditorId(null);
    setSectionStyleOpenId(null);
    setSelectedBoardElement(null);
  };

  const selectAllBoards = () => {
    const boardIds = board.outfits.map((outfit) => outfit.id);
    setCanvasSelection({ itemIds: [], boardIds, sectionIds: [] });
    setBoardSelectionOpen(true);
    setActiveOutfitId(null);
    setActiveSectionId(null);
    setWorkspaceMenuOpen(false);
  };

  const deleteSelectedBoardContainers = () => {
    if (!validSelectedBoardIds.length) return;
    const count = validSelectedBoardIds.length;
    setBoard((current) => dissolveBoardsPreservingItems(current, validSelectedBoardIds));
    setSelectedBoardIds([]);
    setBoardSelectionOpen(false);
    setActiveOutfitId(null);
    setBoardMenu(null);
    setBudgetEditorId(null);
    announceCanvasAction(`${count} ${count === 1 ? 'board' : 'boards'} deleted; products preserved.`);
  };

  const requestDeleteSelectedBoardsAndContents = () => {
    const boardIds = [...validSelectedBoardIds];
    if (!boardIds.length) return;
    setNeverAskBulkDelete(false);
    setDeletionRequest({ itemIds: [...selectedIds], boardIds });
  };

  const requestDeleteCanvasSelection = () => {
    if (validSelectedBoardIds.length) { requestDeleteSelectedBoardsAndContents(); return; }
    deleteMultiple();
  };

  const deleteBoardsKeepProducts = (request: DeletionRequest) => {
    const boardIds = request.boardIds ?? [];
    const preservedCount = new Set(board.outfits.filter((outfit) => boardIds.includes(outfit.id)).flatMap((outfit) => outfit.itemIds)).size;
    setBoard((current) => dissolveBoardsPreservingItems(current, boardIds));
    if (request.itemIds.length) performDeletion(request.itemIds);
    else {
      setCanvasSelection(emptyCanvasSelection());
      setBoardSelectionOpen(false);
      setDeletionRequest(null);
    }
    const separateDeletion = request.itemIds.length ? ` ${request.itemIds.length} separately selected ${request.itemIds.length === 1 ? 'product' : 'products'} deleted.` : '';
    announceCanvasAction(`${boardIds.length} ${boardIds.length === 1 ? 'board' : 'boards'} deleted; ${preservedCount} ${preservedCount === 1 ? 'product' : 'products'} preserved.${separateDeletion}`);
  };

  const deleteBoardsAndSelectedProducts = (request: DeletionRequest) => {
    const boardIds = request.boardIds ?? [];
    performDeleteSelectedBoardsAndContents(boardIds);
    if (request.itemIds.length) performDeletion(request.itemIds);
  };

  const performDeleteSelectedBoardsAndContents = (boardIds: string[]) => {
    const productCount = new Set(board.outfits.filter((outfit) => boardIds.includes(outfit.id)).flatMap((outfit) => outfit.itemIds)).size;
    setBoard((current) => deleteBoardsAndContents(current, boardIds));
    setSelectedIds([]);
    setSelectedBoardIds([]);
    setBoardSelectionOpen(false);
    setActiveOutfitId(null);
    setBoardMenu(null);
    setBudgetEditorId(null);
    setDeletionRequest(null);
    announceCanvasAction(`${boardIds.length} ${boardIds.length === 1 ? 'board' : 'boards'} and ${productCount} ${productCount === 1 ? 'product' : 'products'} deleted.`);
  };

  const dissolveBoard = (outfitId: string) => {
    setBoard((current) => dissolveBoardsPreservingItems(current, [outfitId]));
    if (activeOutfitId === outfitId) setActiveOutfitId(null);
    setSelectedBoardIds((current) => current.filter((id) => id !== outfitId));
    setBoardMenu(null);
    setItemMenu(null);
    announceCanvasAction('Board deleted; products preserved.');
  };

  const addToBoard = (itemId: string, outfitId: string, keepPosition = false) => {
    setBoard((current) => {
      const destination = current.outfits.find((outfit) => outfit.id === outfitId);
      const incoming = current.items.find((item) => item.id === itemId);
      const position = !keepPosition && destination && incoming
        ? positionForBoardItem(destination, current.items.filter((item) => item.id !== itemId), incoming, layoutHeights)
        : null;
      return {
        ...current,
        items: position
          ? current.items.map((item) => item.id === itemId ? { ...item, ...position, autoPlaced: false } : item)
          : current.items,
        outfits: current.outfits.flatMap((outfit) => {
          const itemIds = outfit.id === outfitId
            ? [...new Set([...outfit.itemIds, itemId])]
            : outfit.itemIds.filter((id) => id !== itemId);
          if (outfit.id !== outfitId && outfit.itemIds.includes(itemId) && itemIds.length === 0) return [];
          return [{ ...outfit, itemIds, preserveWhenEmpty: outfit.id === outfitId ? false : outfit.preserveWhenEmpty }];
        }),
      };
    });
    setItemMenu(null);
  };

  const moveSelectedToBoard = (outfitId: string, itemIds = selectedIds) => {
    if (!itemIds.length) return;
    setBoard((current) => ({
      ...current,
      outfits: moveItemsBetweenBoards(current.outfits, outfitId, itemIds),
    }));
    setSelectionMenu(null);
  };

  const nudgeBoard = (outfitId: string, dx: number, dy: number) => {
    setBoard((current) => ({ ...current, ...nudgeBoardAndItems(current.items, current.outfits, outfitId, dx, dy) }));
  };

  const removeFromCurrentBoard = (itemId: string) => {
    removeItemsFromBoards([itemId]);
    setItemMenu(null);
  };

  const removeItemsFromBoards = (itemIdsToRemove: string[]) => {
    const removing = new Set(itemIdsToRemove);
    setBoard((current) => ({
      ...current,
      outfits: current.outfits.flatMap((outfit) => {
        const itemIds = outfit.itemIds.filter((id) => !removing.has(id));
        return outfit.itemIds.some((id) => removing.has(id)) && itemIds.length === 0 && !outfit.preserveWhenEmpty ? [] : [{ ...outfit, itemIds }];
      }),
    }));
  };

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      const selectedBoard = board.outfits.find((outfit) => outfit.id === activeOutfitId);
      const pastedImage = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
      if (selectedBoard && pastedImage) {
        event.preventDefault();
        void fileToDataUrl(pastedImage).then((imageUrl) => addDecorativeImage(selectedBoard, imageUrl));
        return;
      }
      const position = clientToBoard(window.innerWidth / 2, window.innerHeight / 2);
      const text = [event.clipboardData?.getData('text/uri-list'), event.clipboardData?.getData('text/plain')].filter(Boolean).join('\n');
      const urls = pastedUrls(text).filter((url) => !isDirectImageUrl(url));
      if (urls.length) {
        event.preventDefault();
        urls.forEach((url, index) => addLink(url, { x: position.x + index * 35, y: position.y + index * 35 }));
      }
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  });

  const deleteMultiple = () => {
    if (!selectedIds.length) return;
    requestDeletion(selectedIds);
  };

  const createOutfit = () => {
    if (selectedIds.length < 1) return;
    const outfit: Outfit = {
      id: crypto.randomUUID(),
      name: `Board ${board.outfits.length + 1}`,
      itemIds: selectedIds,
      budget: null,
      color: boardPalette[board.outfits.length % boardPalette.length],
      presentation: boardTemplates[0].presentation,
      elements: [],
      preserveWhenEmpty: false,
    };
    const selected = new Set(selectedIds);
    setBoard((current) => ({
      ...current,
      outfits: [
        ...current.outfits.flatMap((candidate) => {
          const itemIds = candidate.itemIds.filter((id) => !selected.has(id));
          return candidate.itemIds.some((id) => selected.has(id)) && itemIds.length === 0 ? [] : [{ ...candidate, itemIds }];
        }),
        outfit,
      ],
    }));
    setActiveOutfitId(outfit.id);
    setCanvasSelection({ itemIds: [], boardIds: [outfit.id], sectionIds: [] });
  };

  const createNewBoard = () => {
    const template = boardTemplates[0];
    const center = clientToBoard(window.innerWidth / 2, window.innerHeight / 2);
    const outfit: Outfit = {
      id: crypto.randomUUID(), name: `Board ${board.outfits.length + 1}`,
      itemIds: [], budget: null, color: boardPalette[board.outfits.length % boardPalette.length],
      customLeft: center.x - (template.width ?? 600) / 2, customTop: center.y - (template.height ?? 460) / 2,
      customWidth: template.width ?? 600, customHeight: template.height ?? 460,
      presentation: template.presentation,
      elements: [],
      preserveWhenEmpty: true,
    };
    setBoard((current) => ({ ...current, outfits: [...current.outfits, outfit] }));
    setActiveOutfitId(outfit.id);
    setCanvasSelection({ itemIds: [], boardIds: [outfit.id], sectionIds: [] });
    setBoardSelectionOpen(false);
    setSelectedBoardElement(null);
    setTemplatePickerOpen(false);
  };

  const createStarterCanvas = (templateId: string) => {
    const template = starterTemplates.find((choice) => choice.id === templateId);
    if (!template) return;
    const center = clientToBoard(window.innerWidth / 2, window.innerHeight / 2);
    const instance = instantiateTemplate(template, { x: center.x - template.bounds.width / 2, y: center.y - template.bounds.height / 2 });
    setBoard((current) => ({ ...current, items: [...current.items, ...instance.items], outfits: [...current.outfits, ...instance.outfits], sections: [...(current.sections ?? []), ...instance.sections] }));
    setActiveOutfitId(null);
    setSelectedBoardIds([]);
    setBoardSelectionOpen(false);
    setActiveSectionId(null);
    setSelectedBoardElement(null);
    setSelectedIds([]);
    setTemplatePickerOpen(false);
    const canvas = boardRef.current?.getBoundingClientRect();
    if (canvas) {
      const visibleTop = Math.max(0, (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? canvas.top) - canvas.top) + 24;
      const availableWidth = Math.max(100, canvas.width - 48);
      const availableHeight = Math.max(100, canvas.height - visibleTop - 72);
      const zoom = Math.min(1.2, availableWidth / instance.bounds.width, availableHeight / instance.bounds.height);
      setViewport({ x: 24 + (availableWidth - instance.bounds.width * zoom) / 2 - instance.bounds.left * zoom,
        y: visibleTop + (availableHeight - instance.bounds.height * zoom) / 2 - instance.bounds.top * zoom, zoom });
    }
  };

  const restyleBoard = (outfit: Outfit, templateId: BoardTemplateId) => {
    const template = boardTemplates.find((choice) => choice.id === templateId) ?? boardTemplates[0];
    updateOutfit(outfit.id, { presentation: { ...outfit.presentation, ...template.presentation, layoutPreset: outfit.presentation?.layoutPreset ?? 'freeform' } });
  };

  const moveRoutineStep = (outfit: Outfit, itemId: string, offset: number) => {
    const index = outfit.itemIds.indexOf(itemId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= outfit.itemIds.length) return;
    const itemIds = [...outfit.itemIds];
    [itemIds[index], itemIds[nextIndex]] = [itemIds[nextIndex], itemIds[index]];
    updateOutfit(outfit.id, { itemIds });
  };

  const relayoutBoard = (outfit: Outfit, layout: LayoutPreset) => {
    if (layout === 'freeform') { updateOutfit(outfit.id, { presentation: { ...outfit.presentation, layoutPreset: layout } }); return; }
    const members = outfit.itemIds.map((id) => board.items.find((item) => item.id === id)).filter((item) => item !== undefined);
    const bounds = getOutfitBounds(outfit, board.items, layoutHeights);
    if (!bounds) return;
    const startX = bounds.left + 34;
    const startY = bounds.top + Math.max(110, (layoutHeights[`header:${outfit.id}`] ?? 70) + 42);
    if (layout === 'masonry' || layout === 'collage') {
      const positions = new Map<string, PointerPosition>();
      const scales = new Map<string, number>();
      if (layout === 'masonry') {
        const columns = [startY, startY, startY];
        members.forEach((item, index) => {
          const column = columns.indexOf(Math.min(...columns));
          const scale = index % 4 === 0 ? 1.08 : index % 3 === 0 ? .9 : 1;
          positions.set(item.id, { x: startX + column * 244, y: columns[column] });
          scales.set(item.id, scale);
          columns[column] += itemHeight({ ...item, scale }, layoutHeights, outfit) + 28;
        });
        updateOutfit(outfit.id, { presentation: { ...outfit.presentation, layoutPreset: layout }, customWidth: Math.max(outfit.customWidth ?? 0, 790), customHeight: Math.max(outfit.customHeight ?? 0, Math.max(...columns) - bounds.top + 40) });
      } else {
        const slots = [
          { x: 35, y: 125, scale: 1.2 }, { x: 360, y: 105, scale: .88 }, { x: 575, y: 210, scale: 1.05 },
          { x: 90, y: 470, scale: .86 }, { x: 330, y: 430, scale: 1.16 }, { x: 635, y: 520, scale: .82 },
        ];
        members.forEach((item, index) => {
          const slot = slots[index % slots.length];
          const page = Math.floor(index / slots.length);
          positions.set(item.id, { x: bounds.left + slot.x, y: bounds.top + slot.y + page * 610 });
          scales.set(item.id, slot.scale);
        });
        updateOutfit(outfit.id, { presentation: { ...outfit.presentation, layoutPreset: layout }, customWidth: Math.max(outfit.customWidth ?? 0, 880), customHeight: Math.max(outfit.customHeight ?? 0, Math.ceil(members.length / slots.length) * 610 + 120) });
      }
      setBoard((current) => ({
        ...current,
        items: current.items.map((item) => positions.has(item.id) ? { ...item, ...positions.get(item.id), scale: scales.get(item.id) } : item),
        outfits: current.outfits.map((candidate) => candidate.id === outfit.id ? { ...candidate, presentation: { ...candidate.presentation, layoutPreset: layout } } : candidate),
      }));
      return;
    }
    const groups = new Map<string, Item[]>();
    members.forEach((item) => {
      const category = productCategory(item.title);
      groups.set(category, [...(groups.get(category) ?? []), item]);
    });
    const ordered = layout === 'category-rows' || layout === 'capsule' ? [...groups.values()].flat() : members;
    const positions = new Map<string, PointerPosition>();
    let row = 0;
    let column = 0;
    let previousCategory = '';
    ordered.forEach((item, index) => {
      const category = productCategory(item.title);
      if ((layout === 'category-rows' || layout === 'capsule') && previousCategory && category !== previousCategory) { row += 1; column = 0; }
      if (column >= (layout === 'editorial' ? 2 : 3)) { row += 1; column = 0; }
      const gapX = layout === 'editorial' || layout === 'capsule' ? 282 : 244;
      const gapY = layout === 'editorial' ? 405 : 375;
      const offsetX = layout === 'editorial' && index % 2 ? 28 : 0;
      positions.set(item.id, { x: startX + column * gapX + offsetX, y: startY + row * gapY });
      column += 1;
      previousCategory = category;
    });
    setBoard((current) => ({
      ...current,
      items: current.items.map((item) => positions.has(item.id) ? { ...item, ...positions.get(item.id) } : item),
      outfits: current.outfits.map((candidate) => candidate.id === outfit.id ? {
        ...candidate,
        presentation: { ...candidate.presentation, layoutPreset: layout },
        customWidth: Math.max(candidate.customWidth ?? 0, Math.min(3, ordered.length) * 244 + 68),
        customHeight: Math.max(candidate.customHeight ?? 0, (row + 1) * 375 + 145),
      } : candidate),
    }));
  };

  const createBoardFromSelection = () => {
    createOutfit();
    setSelectionMenu(null);
  };

  const updateOutfit = (id: string, change: Partial<Outfit>) => {
    setBoard((current) => ({
      ...current,
      outfits: current.outfits.map((outfit) => (outfit.id === id ? { ...outfit, ...change } : outfit)),
    }));
  };

  const updateBoardStyleOverride = <K extends keyof BoardStyleOverrides>(outfit: Outfit, key: K, value: BoardStyleOverrides[K] | undefined) => {
    const styleOverrides = { ...(outfit.styleOverrides ?? {}), [key]: value };
    if (value === undefined) delete styleOverrides[key];
    updateOutfit(outfit.id, { styleOverrides: Object.keys(styleOverrides).length ? styleOverrides : undefined });
  };

  const openBudgetEditor = (outfit: Outfit) => {
    setBudgetDraft(outfit.budget === null ? '' : String(outfit.budget));
    setBudgetCurrencyDraft(outfit.budgetCurrency || userSettings.preferredCurrency);
    setBudgetError('');
    setBudgetEditorId(outfit.id);
    setBoardMenu(null);
  };

  const closeSizingEditor = () => {
    setIsSizingOpen(false);
    setIsSettingsOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => appShellRef.current?.querySelector<HTMLButtonElement>('.sizing-settings-button')?.focus({ preventScroll: true })));
  };

  const closeShareToast = () => {
    setLastShareLink('');
    const target = lastOutsideSurfaceFocusRef.current;
    const fallback = appShellRef.current?.querySelector<HTMLButtonElement>('.workspace-menu-trigger');
    requestAnimationFrame(() => {
      const returnTarget = target?.isConnected ? target : fallback;
      returnTarget?.focus({ preventScroll: true });
    });
  };

  const closeInspectorSurface = () => {
    setItemDetailsOpenId(null);
    setActiveOutfitId(null);
    setSelectedBoardElement(null);
    setBoardElementInspectorOpen(false);
    const target = lastOutsideSurfaceFocusRef.current;
    requestAnimationFrame(() => {
      if (target?.isConnected) { target.focus({ preventScroll: true }); return; }
      const selectedObject = appShellRef.current?.querySelector<HTMLElement>('.sticker.is-selected:not(.template-placeholder), .outfit-label[aria-pressed="true"], .canvas-section.is-active');
      selectedObject?.focus({ preventScroll: true });
    });
  };

  const updateSizePreference = (category: keyof SizePreferences, system: SizeSystem, value: string) => {
    setUserSettings((settings) => {
      const sizePreferences = { ...settings.sizePreferences };
      if (value) sizePreferences[category] = { system, value };
      else delete sizePreferences[category];
      return { ...settings, sizePreferences };
    });
    setBoard((current) => ({
      ...current,
      items: current.items.map((item) => isSizedProduct(item) ? { ...item, availability: '', availabilityVerified: false } : item),
    }));
  };

  const sizingPreferenceRow = (category: keyof SizePreferences, label: string, kind: 'clothing' | 'bottoms' | 'shoes', general = false) => {
    const preference = userSettings.sizePreferences[category];
    const inherited = userSettings.sizePreferences.generalClothing;
    const system = preference?.system ?? inherited?.system ?? 'US/CA';
    const numericSizes = kind === 'shoes' ? regionalShoeSizes[system] : regionalClothingSizes[system];
    const waistSizes = kind === 'bottoms' && system === 'US/CA' ? Array.from({ length: 18 }, (_, index) => String(index + 23)) : [];
    return <fieldset className="size-preference-row" key={category}>
      <legend>{label}</legend>
      <label>System<select value={system} onChange={(event) => updateSizePreference(category, event.target.value === 'UK' ? 'UK' : event.target.value === 'EU' ? 'EU' : event.target.value === 'AU' ? 'AU' : 'US/CA', preference?.value ?? '')}>{sizeSystems.map((value) => <option key={value} value={value}>{value === 'US/CA' ? 'United States / Canada' : value}</option>)}</select></label>
      <label>Size<select value={preference?.value ?? ''} onChange={(event) => updateSizePreference(category, system, event.target.value)}>
        <option value="">{general ? 'Not set' : 'Use general clothing size'}</option>
        {kind !== 'shoes' && <optgroup label="Letter sizes">{alphaSizes.map((size) => <option key={size} value={size}>{size}</option>)}</optgroup>}
        <optgroup label={`${system} ${kind === 'shoes' ? 'shoe' : 'numeric'} sizes`}>{numericSizes.map((size) => <option key={`numeric-${size}`} value={size}>{size}</option>)}</optgroup>
        {waistSizes.length > 0 && <optgroup label="Waist sizes (inches)">{waistSizes.map((size) => <option key={`waist-${size}`} value={`${size}W`}>{size}W</option>)}</optgroup>}
      </select></label>
    </fieldset>;
  };

  const updateBoardElement = (outfitId: string, elementId: string, change: Partial<BoardElement>) => {
    setBoard((current) => ({
      ...current,
      outfits: current.outfits.map((outfit) => outfit.id === outfitId
        ? { ...outfit, elements: (outfit.elements ?? []).map((element) => element.id === elementId ? { ...element, ...change } : element) }
        : outfit),
    }));
  };

  const addTextElement = (outfit: Outfit) => {
    const element: BoardElement = {
      id: crypto.randomUUID(), type: 'text', content: 'Add a short note', x: 42, y: 120,
      width: 240, height: 58, color: '#443b34', textPreset: 'clean', textSize: 'medium', textAlign: 'left',
      zIndex: Math.max(0, ...(outfit.elements ?? []).map((entry) => entry.zIndex ?? 0)) + 1,
    };
    updateOutfit(outfit.id, { elements: [...(outfit.elements ?? []), element] });
    setSelectedBoardElement({ outfitId: outfit.id, elementId: element.id });
  };

  const addDecorativeImage = (outfit: Outfit, imageUrl: string) => {
    const element: BoardElement = {
      id: crypto.randomUUID(), type: 'image', imageUrl, x: 48, y: 130, width: 230, height: 210,
      zIndex: Math.max(0, ...(outfit.elements ?? []).map((entry) => entry.zIndex ?? 0)) + 1,
    };
    updateOutfit(outfit.id, { elements: [...(outfit.elements ?? []), element] });
    setSelectedBoardElement({ outfitId: outfit.id, elementId: element.id });
  };

  const duplicateBoardElement = (outfit: Outfit, element: BoardElement) => {
    const duplicate = { ...element, id: crypto.randomUUID(), x: element.x + 24, y: element.y + 24, zIndex: Math.max(0, ...(outfit.elements ?? []).map((entry) => entry.zIndex ?? 0)) + 1 };
    updateOutfit(outfit.id, { elements: [...(outfit.elements ?? []), duplicate] });
    setSelectedBoardElement({ outfitId: outfit.id, elementId: duplicate.id });
  };

  const removeBoardElement = (outfitId: string, elementId: string) => {
    const outfit = board.outfits.find((entry) => entry.id === outfitId);
    if (outfit) updateOutfit(outfitId, { elements: (outfit.elements ?? []).filter((element) => element.id !== elementId) });
    setSelectedBoardElement(null);
  };

  const clearCanvasSelection = () => {
    setCanvasSelection(emptyCanvasSelection());
    setBoardSelectionOpen(false);
    setActiveOutfitId(null);
    setSelectedBoardElement(null);
    setBoardElementInspectorOpen(false);
    setItemDetailsOpenId(null);
    setAlternativeItemId(null);
    setRenamingSectionId(null);
    setSectionStyleOpenId(null);
    setSectionMobileEditorId(null);
    setRenamingOutfitId(null);
    setBudgetEditorId(null);
    setItemMenu(null);
    announceCanvasAction('Board deleted; products preserved.');
    setBoardMenu(null);
    setSelectionMenu(null);
    setQuickAdd(null);
    setWorkspaceMenuOpen(false);
    setDeletionRequest(null);
    setCanvasMode('pan');
  };

  const beginGesture = (event: React.PointerEvent, kind: CanvasGestureKind): boolean => {
    if (canvasGestureRef.current) return false;
    canvasGestureRef.current = startCanvasGesture(kind, event.pointerId, event.pointerType, event.clientX, event.clientY);
    return true;
  };

  const advanceGesture = (event: React.PointerEvent, kind: CanvasGestureKind): boolean => {
    const gesture = canvasGestureRef.current;
    if (!gestureMatches(gesture, kind, event.pointerId)) return false;
    const next = advanceCanvasGesture(gesture, event.pointerId, event.clientX, event.clientY);
    canvasGestureRef.current = next;
    return next.dragging;
  };

  const finishGesture = (event: React.PointerEvent, kind: CanvasGestureKind): CanvasGesture | null => {
    const gesture = canvasGestureRef.current;
    if (!gestureMatches(gesture, kind, event.pointerId)) return null;
    canvasGestureRef.current = clearCanvasGesture(gesture, kind, event.pointerId);
    return gesture;
  };

  const clearLongPress = () => {
    const pending = longPressRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.target.classList.remove('long-press-pending');
    longPressRef.current = null;
  };

  const handleCanvasPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const contextTarget = target?.closest<HTMLElement>('.sticker, .outfit-frame, .canvas-section');
    if (contextTarget && !target?.closest('button, a, input, textarea, select, summary, [contenteditable="true"]')) {
      clearLongPress();
      longPressTriggeredRef.current = false;
      contextTarget.classList.add('long-press-pending');
      const timer = window.setTimeout(() => {
        contextTarget.classList.remove('long-press-pending');
        longPressRef.current = null;
        longPressTriggeredRef.current = true;
        contextTarget.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY,
        }));
      }, 450);
      longPressRef.current = { timer, target: contextTarget, start: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId };
    }

    if (target?.closest('button, a, input, textarea, select, summary, [contenteditable="true"], .item-menu, .board-menu, .selection-menu, .quick-add, .selection-actions, .zoom-controls')) return;
    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointersRef.current.size < 2) return;
    const objectGestureStarted = Boolean(dragRef.current || resizeRef.current || outfitDragRef.current
      || outfitResizeRef.current || sectionDragRef.current || sectionResizeRef.current
      || boardElementDragRef.current || boardElementResizeRef.current);
    if (objectGestureStarted) {
      // Keep the first pointer's object gesture. A second finger never steals it.
      touchPointersRef.current.clear();
      return;
    }
    const pointers = [...touchPointersRef.current.entries()].slice(0, 2);
    if (pointers.length < 2) return;
    const geometry = pinchGeometry(pointers[0][1], pointers[1][1]);
    if (!geometry.distance) return;
    clearLongPress();
    selectionRef.current = null;
    panRef.current = null;
    canvasGestureRef.current = null;
    setSelectionBox(null);
    setIsPanning(true);
    pinchGestureRef.current = {
      pointerIds: [pointers[0][0], pointers[1][0]],
      viewport: viewportRef.current,
      midpoint: geometry.midpoint,
      distance: geometry.distance,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer may already be captured by a nested control. */ }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleCanvasPointerMoveCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && longPressRef.current?.pointerId === event.pointerId) {
      const { start } = longPressRef.current;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= CANVAS_TOUCH_DRAG_THRESHOLD) clearLongPress();
    }
    if (!pinchGestureRef.current || !pinchGestureRef.current.pointerIds.includes(event.pointerId)) return;
    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchGestureRef.current;
    const first = touchPointersRef.current.get(pinch.pointerIds[0]);
    const second = touchPointersRef.current.get(pinch.pointerIds[1]);
    if (!first || !second) return;
    const geometry = pinchGeometry(first, second);
    pendingPinchViewportRef.current = pinchViewport(pinch.viewport, pinch.midpoint, geometry.midpoint, pinch.distance, geometry.distance);
    if (pinchFrameRef.current === null) pinchFrameRef.current = window.requestAnimationFrame(() => {
      pinchFrameRef.current = null;
      if (pendingPinchViewportRef.current) writeWorldViewport(pendingPinchViewportRef.current);
      pendingPinchViewportRef.current = null;
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const handleCanvasPointerUpCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (longPressRef.current?.pointerId === event.pointerId) clearLongPress();
    if (longPressTriggeredRef.current) window.setTimeout(() => { longPressTriggeredRef.current = false; }, 700);
    if (pinchGestureRef.current?.pointerIds.includes(event.pointerId)) {
      event.preventDefault();
      event.stopPropagation();
      flushPinchFrame();
      setViewport(viewportRef.current);
      pinchGestureRef.current = null;
      canvasGestureRef.current = null;
      selectionRef.current = null;
      panRef.current = null;
      touchPointersRef.current.clear();
      setSelectionBox(null);
      setIsPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    touchPointersRef.current.delete(event.pointerId);
  };

  const handleCanvasClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!longPressTriggeredRef.current) return;
    longPressTriggeredRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    suppressSectionClickRef.current = false;
    canvasStartTargetRef.current = target;
    if (target instanceof Element) {
      if (!target.closest('.item-menu, .board-menu, .selection-menu, .quick-add, .alternatives-popover')) {
        setItemMenu(null);
        setBoardMenu(null);
        setSelectionMenu(null);
        setQuickAdd(null);
        setAlternativeItemId(null);
      }
    }
    if ((event.button !== 0 && event.button !== 1) || (target instanceof Element && target.closest('button, a, input, textarea, select, [contenteditable="true"], .zoom-controls, .canvas-add, .inspector, .topbar, .closet-drawer, .selection-actions'))) return;
    const sectionSurface = target instanceof Element ? target.closest('.canvas-section') : null;
    const isSectionBackground = sectionSurface === target;
    if (target instanceof Element && target.closest('.sticker, .outfit-frame, .board-element') && !navigationMode) return;
    if (sectionSurface && !isSectionBackground) return;
    if (!sectionSurface && !(event.shiftKey || event.ctrlKey || event.metaKey)) {
      setActiveSectionId(null);
      setRenamingSectionId(null);
      setSectionMobileEditorId(null);
      setSectionStyleOpenId(null);
    }
    const coarse = event.pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches;
    const kind = event.button === 0 && !event.altKey && (coarse ? canvasMode === 'select' : !navigationMode) ? 'select' : 'pan';
    if (!beginGesture(event, kind)) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rectangle = event.currentTarget.getBoundingClientRect();
    if (kind === 'select') {
      const start = { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
      selectionRef.current = { start, current: start, base: canvasSelection, additive: event.shiftKey || event.ctrlKey || event.metaKey };
      return;
    }
    panRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleBoardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionRef.current) {
      if (!advanceGesture(event, 'select')) return;
      if (canvasStartTargetRef.current instanceof Element && canvasStartTargetRef.current.closest('.canvas-section')) suppressSectionClickRef.current = true;
      const rectangle = event.currentTarget.getBoundingClientRect();
      const next = { ...selectionRef.current, current: { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top } };
      selectionRef.current = next;
      if (selectionFrameRef.current === null) selectionFrameRef.current = window.requestAnimationFrame(() => {
        selectionFrameRef.current = null;
        if (selectionRef.current) setSelectionBox(selectionRef.current);
      });
      return;
    }
    if (!panRef.current) return;
    if (!advanceGesture(event, 'pan')) return;
    if (canvasStartTargetRef.current instanceof Element && canvasStartTargetRef.current.closest('.canvas-section')) suppressSectionClickRef.current = true;
    if (!isPanning) setIsPanning(true);
    const deltaX = event.clientX - panRef.current.x;
    const deltaY = event.clientY - panRef.current.y;
    panRef.current = { x: event.clientX, y: event.clientY };
    pendingPanRef.current.x += deltaX;
    pendingPanRef.current.y += deltaY;
    if (panFrameRef.current === null) panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = null;
      const delta = pendingPanRef.current;
      pendingPanRef.current = { x: 0, y: 0 };
      writeWorldViewport({ ...viewportRef.current, x: viewportRef.current.x + delta.x, y: viewportRef.current.y + delta.y });
    });
  };

  const endBoardPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectionRef.current) {
      flushPanFrame();
      if (panRef.current) setViewport(viewportRef.current);
    }
    const selection = selectionRef.current;
    const kind = selection ? 'select' : 'pan';
    const gesture = finishGesture(event, kind);
    if (!gesture) return;
    if (gesture.dragging && canvasStartTargetRef.current instanceof Element && canvasStartTargetRef.current.closest('.canvas-section')) suppressSectionClickRef.current = true;
    if (selection && gesture.dragging) {
      const left = Math.min(selection.start.x, selection.current.x);
      const right = Math.max(selection.start.x, selection.current.x);
      const top = Math.min(selection.start.y, selection.current.y);
      const bottom = Math.max(selection.start.y, selection.current.y);
      const worldRect = {
        left: (left - viewport.x) / viewport.zoom,
        top: (top - viewport.y) / viewport.zoom,
        right: (right - viewport.x) / viewport.zoom,
        bottom: (bottom - viewport.y) / viewport.zoom,
      };
      const itemBounds: ItemSelectionBounds[] = board.items.map((item) => {
        const scale = itemScale(item);
        const outfit = board.outfits.find((candidate) => candidate.itemIds.includes(item.id));
        return { id: item.id, left: item.x, top: item.y,
          right: item.x + itemCardWidth(item, outfit) * scale,
          bottom: item.y + itemHeight(item, layoutHeights, outfit), boardId: outfit?.id };
      });
      const boardBounds = board.outfits.flatMap((outfit) => {
        const bounds = getOutfitBounds(outfit, board.items, layoutHeights);
        return bounds ? [{ id: outfit.id, left: bounds.left, top: bounds.top, right: bounds.left + bounds.width,
          bottom: bounds.top + bounds.height, itemIds: outfit.itemIds }] : [];
      });
      const nextSelection = marqueeCanvasSelection(worldRect, itemBounds, boardBounds, selection.base, selection.additive);
      setCanvasSelection(normalizeCanvasSelection(nextSelection, boardBounds));
      setActiveOutfitId(null);
      setBoardSelectionOpen(false);
      setSelectedBoardElement(null);
    } else if (selection) {
      clearCanvasSelection();
    } else if (!gesture.dragging && canvasStartTargetRef.current === event.currentTarget) {
      clearCanvasSelection();
    }
    selectionRef.current = null;
    if (selectionFrameRef.current !== null) window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = null;
    setSelectionBox(null);
    panRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelBoardPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = canvasGestureRef.current;
    if (!gesture || !gestureMatches(gesture, gesture.kind, event.pointerId) || (gesture.kind !== 'select' && gesture.kind !== 'pan')) return;
    canvasGestureRef.current = null;
    selectionRef.current = null;
    if (selectionFrameRef.current !== null) window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = null;
    flushPanFrame();
    if (panRef.current) setViewport(viewportRef.current);
    panRef.current = null;
    setSelectionBox(null);
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleBoardWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.format-toolbar, .selection-actions, .zoom-controls, .canvas-add, .product-board-reveal .sticker-meta, .alternatives-popover, .quick-add, .item-menu, .board-menu, .selection-menu, input, textarea, select, [contenteditable="true"]')) return;
    if (event.ctrlKey || event.metaKey) {
      // Modifier-wheel zoom is scoped to the canvas; browser zoom remains available
      // from the usual keyboard shortcut and everywhere outside this surface.
      if (event.cancelable) event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const delta = event.deltaY || event.deltaX;
      const pending = pendingWheelZoomRef.current;
      pendingWheelZoomRef.current = { anchor, factor: (pending?.factor ?? 1) * Math.exp(-delta * 0.002) };
      if (wheelFrameRef.current === null) wheelFrameRef.current = window.requestAnimationFrame(() => {
        wheelFrameRef.current = null;
        const zoom = pendingWheelZoomRef.current;
        pendingWheelZoomRef.current = null;
        if (zoom) writeWorldViewport(zoomViewportAt(viewportRef.current, zoom.anchor, viewportRef.current.zoom * zoom.factor));
        scheduleWheelCommit();
      });
      return;
    }
    if (event.cancelable) event.preventDefault();
    const delta = canvasWheelPan(event.deltaX, event.deltaY, event.deltaMode, event.currentTarget.clientHeight, event.shiftKey);
    wheelPanRef.current.x += delta.x;
    wheelPanRef.current.y += delta.y;
    if (wheelFrameRef.current !== null) return;
    wheelFrameRef.current = window.requestAnimationFrame(() => {
      const delta = wheelPanRef.current;
      wheelPanRef.current = { x: 0, y: 0 };
      wheelFrameRef.current = null;
      writeWorldViewport({ ...viewportRef.current, x: viewportRef.current.x + delta.x, y: viewportRef.current.y + delta.y });
      scheduleWheelCommit();
    });
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const position = clientToBoard(event.clientX, event.clientY);
    const targetBoardId = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.outfit-frame')?.dataset.outfitId;
    const url = event.dataTransfer.getData('text/uri-list').split('\n').find((value) => value.trim() && !value.startsWith('#'))
      || event.dataTransfer.getData('text/plain');
    if (url && !isDirectImageUrl(url)) addLink(url, position, targetBoardId);
  };

  const openQuickAdd = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target;
    // Once the quick-add input is open, preserve the browser's native context
    // menu so right-click Paste works inside the field.
    if (target instanceof HTMLElement && target.closest('.quick-add input')) return;
    event.preventDefault();
    const sticker = target instanceof HTMLElement ? target.closest<HTMLElement>('.sticker') : null;
    if (sticker?.dataset.itemId) {
      setItemDetailsOpenId(null); setActiveOutfitId(null); setSelectedBoardElement(null); setBoardElementInspectorOpen(false);
      setItemMenu({ id: sticker.dataset.itemId, x: event.clientX, y: event.clientY });
      setQuickAdd(null);
      setSelectionMenu(null);
      return;
    }
    const outfitFrame = target instanceof HTMLElement ? target.closest<HTMLElement>('.outfit-frame') : null;
    if (outfitFrame?.dataset.outfitId) {
      setItemDetailsOpenId(null); setActiveOutfitId(null); setSelectedBoardElement(null); setBoardElementInspectorOpen(false);
      setBoardMenu({ id: outfitFrame.dataset.outfitId, x: event.clientX, y: event.clientY });
      setItemMenu(null);
      setQuickAdd(null);
      return;
    }
    const section = target instanceof HTMLElement ? target.closest<HTMLElement>('.canvas-section') : null;
    if (section?.dataset.sectionId) {
      setItemMenu(null); setBoardMenu(null); setQuickAdd(null); setSelectionMenu(null);
      selectSection(section.dataset.sectionId);
      return;
    }
    if (target instanceof HTMLElement && target.closest('.zoom-controls, .canvas-add, .inspector, .topbar, .selection-actions')) return;
    if (selectedIds.length > 0) {
      setItemDetailsOpenId(null); setActiveOutfitId(null); setSelectedBoardElement(null); setBoardElementInspectorOpen(false);
      setSelectionMenu({ x: event.clientX, y: event.clientY });
      setQuickAdd(null);
      return;
    }
    setQuickAdd({ x: event.clientX, y: event.clientY, position: clientToBoard(event.clientX, event.clientY) });
    setQuickAddUrl('');
  };

  const startItemDrag = (event: React.PointerEvent<HTMLElement>, item: Item) => {
    if (!canStartObjectGesture(event.button, navigationMode, event.target instanceof Element && Boolean(event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')))) return;
    event.stopPropagation();
    itemMovedRef.current = false;
    setItemMenu(null);
    setActiveOutfitId(null);
    setBoardSelectionOpen(false);
    setSelectedBoardElement(null);
    const coarseSelect = event.pointerType === 'touch' && canvasMode === 'select';
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    const toggleItem = () => setCanvasSelection((current) => {
      const containingBoards = new Set(board.outfits.filter((outfit) => outfit.itemIds.includes(item.id)).map((outfit) => outfit.id));
      const nextBoards = current.boardIds.filter((id) => !containingBoards.has(id));
      return {
        ...current,
        itemIds: selectionAfterItemTap(current.itemIds, item.id, true),
        boardIds: nextBoards,
        sectionIds: [],
      };
    });
    if (coarseSelect && !selectedIds.includes(item.id)) {
      toggleItem();
      return;
    }
    if (additive) {
      toggleItem();
      return;
    }
    if (!item.locked && !beginGesture(event, 'item')) return;
    setSelectedIds((current) => current.includes(item.id) ? current : selectionAfterItemTap(current, item.id, false));
    if (item.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const movingIds = selectedIds.includes(item.id) ? selectedIds : [item.id];
    const members = board.items.filter((candidate) => movingIds.includes(candidate.id) && !candidate.locked)
      .map((candidate) => ({ id: candidate.id, x: candidate.x, y: candidate.y }));
    const sourceOutfit = board.outfits.find((outfit) => outfit.itemIds.includes(item.id));
    const sourceBounds = sourceOutfit ? getOutfitBounds(sourceOutfit, board.items, layoutHeights) ?? undefined : undefined;
    dragRef.current = {
      id: item.id,
      start: { x: event.clientX, y: event.clientY },
      itemX: item.x,
      itemY: item.y,
      sourceOutfitId: sourceOutfit?.id,
      sourceBounds,
      members,
    };
  };

  const startOutfitDrag = (event: React.PointerEvent<HTMLDivElement>, outfit: Outfit) => {
    const target = event.target instanceof Element ? event.target : null;
    const interactive = Boolean(target?.closest('button, a, input, textarea, select, [contenteditable="true"], .board-element'));
    const boardTitle = Boolean(target?.closest('.outfit-label'));
    if (!canStartObjectGesture(event.button, navigationMode, interactive && !boardTitle)) return;
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    itemMovedRef.current = false;
    const coarseSelect = event.pointerType === 'touch' && canvasMode === 'select';
    if (!beginGesture(event, 'board')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    outfitDragRef.current = {
      id: outfit.id,
      start: { x: event.clientX, y: event.clientY },
      frameLeft: outfit.customLeft,
      frameTop: outfit.customTop,
      members: board.items.filter((item) => outfit.itemIds.includes(item.id)).map((item) => ({ id: item.id, x: item.x, y: item.y })),
    };
    setActiveOutfitId(null);
    if (!coarseSelect) setCanvasSelection({ itemIds: [], boardIds: [outfit.id], sectionIds: [] });
    setBoardSelectionOpen(false);
    setRenamingSectionId(null);
    setSectionMobileEditorId(null);
    setSectionStyleOpenId(null);
    setRenamingOutfitId(null);
    setSelectedBoardElement(null);
    setBoardElementInspectorOpen(false);
  };

  const updateSection = (id: string, change: Partial<CanvasSection>) => setBoard((current) => ({ ...current,
    sections: (current.sections ?? []).map((section) => section.id === id ? { ...section, ...change } : section),
  }));

  const startOutfitRename = (outfit: Outfit) => {
    selectBoard(outfit.id);
    setOutfitNameDraft(outfit.name);
    setRenamingOutfitId(outfit.id);
  };
  const finishOutfitRename = (outfitId: string, commit: boolean) => {
    if (commit) {
      const name = outfitNameDraft.trim();
      if (name) updateOutfit(outfitId, { name });
    }
    setRenamingOutfitId(null);
  };
  const activateOutfitTitle = (event: React.MouseEvent<HTMLElement>, outfit: Outfit) => {
    const now = Date.now();
    const previous = outfitTapRef.current;
    const doubleActivate = event.detail > 1 || (previous?.id === outfit.id && now - previous.at < 400);
    outfitTapRef.current = doubleActivate ? null : { id: outfit.id, at: now };
    const intent = canvasActivationIntent(doubleActivate ? 'double-activate' : 'click', validSelectedBoardIds.includes(outfit.id));
    if (intent === 'edit') startOutfitRename(outfit);
    else selectBoard(outfit.id, event.metaKey || event.ctrlKey || event.shiftKey);
  };
  const selectSection = (id: string) => {
    setActiveSectionId(id);
    setActiveOutfitId(null);
    setBoardSelectionOpen(false);
    setSelectedBoardElement(null);
    setBoardElementInspectorOpen(false);
    setSectionMobileEditorId(null);
    setSectionStyleOpenId(null);
    setRenamingSectionId(null);
    setRenamingOutfitId(null);
  };
  const toggleSectionSelection = (id: string) => {
    if (canvasSelection.sectionIds.includes(id)) {
      setCanvasSelection((current) => ({ ...current, sectionIds: current.sectionIds.filter((sectionId) => sectionId !== id) }));
      setActiveSectionId(null);
    } else selectSection(id);
  };
  const compactSectionViewport = () => typeof window !== 'undefined'
    && window.matchMedia('(max-width: 40rem), (pointer: coarse)').matches;
  const startSectionRename = (section: CanvasSection) => {
    selectSection(section.id);
    if (compactSectionViewport()) setSectionMobileEditorId(section.id);
    else setRenamingSectionId(section.id);
  };
  const showSectionStyle = (section: CanvasSection) => {
    selectSection(section.id);
    if (compactSectionViewport()) setSectionMobileEditorId(section.id);
    else setSectionStyleOpenId(section.id);
  };
  const activateSectionTitle = (event: React.MouseEvent<HTMLElement>, section: CanvasSection) => {
    if (suppressSectionClickRef.current) { suppressSectionClickRef.current = false; return; }
    const now = Date.now();
    const previous = sectionTapRef.current;
    const doubleActivate = event.detail > 1 || (previous?.id === section.id && now - previous.at < 400);
    sectionTapRef.current = doubleActivate ? null : { id: section.id, at: now };
    const coarseSelect = window.matchMedia('(pointer: coarse)').matches && canvasMode === 'select';
    const intent = canvasActivationIntent(doubleActivate ? 'double-activate' : 'click', activeSectionId === section.id);
    if (intent === 'edit') startSectionRename(section);
    else if (coarseSelect) toggleSectionSelection(section.id);
    else selectSection(section.id);
  };
  const sectionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, section: CanvasSection) => {
    if (event.key !== 'Escape' && event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const intent = canvasActivationIntent('enter', activeSectionId === section.id);
      if (intent === 'edit') startSectionRename(section);
      else selectSection(section.id);
    } else if (event.key === ' ') {
      event.preventDefault();
      toggleSectionSelection(section.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setRenamingSectionId(null);
      setSectionMobileEditorId(null);
      setSectionStyleOpenId(null);
      setActiveSectionId(null);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && activeSectionId === section.id) {
      event.preventDefault();
      setBoard((current) => removeSection(current, section.id, true));
      setActiveSectionId(null);
      setSectionMobileEditorId(null);
      announceCanvasAction(`${section.title} group deleted.`);
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if (activeSectionId !== section.id) { focusAdjacentCanvasObject(event.currentTarget, event.key); return; }
      const step = event.shiftKey ? 32 : 16;
      nudgeSection(section.id, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
    }
  };
  const focusAdjacentCanvasObject = (current: HTMLElement, key: string) => {
    const objects = Array.from(boardRef.current?.querySelectorAll<HTMLElement>('[data-canvas-keyboard-object]') ?? []);
    if (objects.length < 2) return;
    const index = objects.indexOf(current);
    if (index < 0) return;
    const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    objects[(index + delta + objects.length) % objects.length]?.focus({ preventScroll: true });
  };
  const handleInspectorTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: 'details' | 'look') => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'Home' ? 'details' : event.key === 'End' ? 'look' : tab === 'details' ? 'look' : 'details';
    setInspectorTab(nextTab);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#inspector-tab-${nextTab}`)?.focus({ preventScroll: true });
  };
  const nudgeSection = (id: string, dx: number, dy: number) => setBoard((current) => {
    const section = current.sections?.find((entry) => entry.id === id);
    return section ? moveSectionFromSnapshot(current, id, dx, dy, sectionSnapshot(current, section)) : current;
  });

  const startSectionDrag = (event: React.PointerEvent<HTMLElement>, section: CanvasSection) => {
    const interactiveTarget = event.target instanceof Element && Boolean(event.target.closest('button, a, input, textarea, select, summary, [contenteditable="true"]'));
    if (!canStartObjectGesture(event.button, navigationMode, interactiveTarget)) return;
    event.preventDefault(); event.stopPropagation();
    if (!beginGesture(event, 'section')) return;
    sectionGestureMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    sectionDragRef.current = { id: section.id, start: { x: event.clientX, y: event.clientY }, snapshot: sectionSnapshot(board, section) };
    const coarseSelect = event.pointerType === 'touch' && canvasMode === 'select';
    if (!coarseSelect) selectSection(section.id);
    if (!coarseSelect) {
      setActiveOutfitId(null);
      setBoardSelectionOpen(false);
    }
  };

  const startSectionResize = (event: React.PointerEvent<HTMLElement>, section: CanvasSection) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (!beginGesture(event, 'section-resize')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sectionResizeRef.current = { id: section.id, start: { x: event.clientX, y: event.clientY }, width: section.width, height: section.height };
    setActiveSectionId(section.id);
  };

  const moveSectionPointer = (event: React.PointerEvent<HTMLElement>) => {
    const drag = sectionDragRef.current;
    const resize = sectionResizeRef.current;
    if (drag) {
      if (!advanceGesture(event, 'section')) return;
      sectionGestureMovedRef.current = true;
      const dx = (event.clientX - drag.start.x) / viewport.zoom;
      const dy = (event.clientY - drag.start.y) / viewport.zoom;
      setBoard((current) => moveSectionFromSnapshot(current, drag.id, dx, dy, drag.snapshot));
    } else if (resize) {
      if (!advanceGesture(event, 'section-resize')) return;
      updateSection(resize.id, { width: Math.max(240, resize.width + (event.clientX - resize.start.x) / viewport.zoom),
        height: Math.max(160, resize.height + (event.clientY - resize.start.y) / viewport.zoom) });
    }
  };

  const endSectionPointer = (event: React.PointerEvent<HTMLElement>, cancel = false) => {
    const drag = sectionDragRef.current;
    const resize = sectionResizeRef.current;
    const gesture = finishGesture(event, drag ? 'section' : 'section-resize');
    if (!gesture) return;
    if (drag && gesture.dragging) suppressSectionClickRef.current = true;
    if (drag && gesture.dragging) selectSection(drag.id);
    if (cancel && gesture.dragging && drag) setBoard((current) => moveSectionFromSnapshot(current, drag.id, 0, 0, drag.snapshot));
    if (cancel && gesture.dragging && resize) updateSection(resize.id, { width: resize.width, height: resize.height });
    sectionDragRef.current = null;
    sectionResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startBoardElementDrag = (event: React.PointerEvent<HTMLElement>, outfit: Outfit, element: BoardElement) => {
    if (!canStartObjectGesture(event.button, navigationMode, event.target instanceof Element && Boolean(event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')))) return;
    event.preventDefault();
    event.stopPropagation();
    if (!beginGesture(event, 'element')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    boardElementDragRef.current = { outfitId: outfit.id, elementId: element.id, start: { x: event.clientX, y: event.clientY }, x: element.x, y: element.y };
    setActiveOutfitId(outfit.id);
    setSelectedBoardElement({ outfitId: outfit.id, elementId: element.id });
    setBoardElementInspectorOpen(false);
    setSelectedIds([]);
  };

  const startBoardElementResize = (event: React.PointerEvent<HTMLButtonElement>, outfit: Outfit, element: BoardElement) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!beginGesture(event, 'element-resize')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    boardElementResizeRef.current = { outfitId: outfit.id, elementId: element.id, start: { x: event.clientX, y: event.clientY }, width: element.width, height: element.height };
  };

  const moveBoardElement = (event: React.PointerEvent<HTMLElement>) => {
    const resize = boardElementResizeRef.current;
    if (resize) {
      if (!advanceGesture(event, 'element-resize')) return;
      updateBoardElement(resize.outfitId, resize.elementId, {
        width: Math.max(44, resize.width + (event.clientX - resize.start.x) / viewport.zoom),
        height: Math.max(34, resize.height + (event.clientY - resize.start.y) / viewport.zoom),
      });
      return;
    }
    const drag = boardElementDragRef.current;
    if (!drag) return;
    if (!advanceGesture(event, 'element')) return;
    updateBoardElement(drag.outfitId, drag.elementId, {
      x: drag.x + (event.clientX - drag.start.x) / viewport.zoom,
      y: drag.y + (event.clientY - drag.start.y) / viewport.zoom,
    });
  };

  const endBoardElementMove = (event: React.PointerEvent<HTMLElement>) => {
    const kind = boardElementDragRef.current ? 'element' : 'element-resize';
    if (!finishGesture(event, kind)) return;
    boardElementDragRef.current = null;
    boardElementResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelBoardElementMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = boardElementDragRef.current;
    const resize = boardElementResizeRef.current;
    const gesture = finishGesture(event, drag ? 'element' : 'element-resize');
    if (!gesture) return;
    if (gesture.dragging && drag) updateBoardElement(drag.outfitId, drag.elementId, { x: drag.x, y: drag.y });
    if (gesture.dragging && resize) updateBoardElement(resize.outfitId, resize.elementId, { width: resize.width, height: resize.height });
    boardElementDragRef.current = null;
    boardElementResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startOutfitResize = (event: React.PointerEvent<HTMLButtonElement>, outfit: Outfit, bounds: { left: number; top: number; width: number; height: number }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!beginGesture(event, 'board-resize')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    outfitResizeRef.current = { id: outfit.id, startX: event.clientX, startY: event.clientY, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, original: { customLeft: outfit.customLeft, customTop: outfit.customTop, customWidth: outfit.customWidth, customHeight: outfit.customHeight } };
    outfitDragRef.current = null;
    setActiveOutfitId(outfit.id);
  };

  const moveOutfit = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = outfitResizeRef.current;
    if (resize) {
      if (!advanceGesture(event, 'board-resize')) return;
      const deltaX = (event.clientX - resize.startX) / viewport.zoom;
      const deltaY = (event.clientY - resize.startY) / viewport.zoom;
      updateOutfit(resize.id, {
        customLeft: resize.left,
        customTop: resize.top,
        customWidth: Math.max(300, resize.width + deltaX),
        customHeight: Math.max(250, resize.height + deltaY),
      });
      return;
    }
    const drag = outfitDragRef.current;
    if (!drag) return;
    if (!advanceGesture(event, 'board')) return;
    itemMovedRef.current = true;
    const deltaX = (event.clientX - drag.start.x) / viewport.zoom;
    const deltaY = (event.clientY - drag.start.y) / viewport.zoom;
    const positions = new Map(drag.members.map((member) => [member.id, member]));
    setBoard((current) => ({
      ...current,
      outfits: current.outfits.map((outfit) => outfit.id === drag.id ? {
        ...outfit,
        customLeft: drag.frameLeft === undefined ? undefined : drag.frameLeft + deltaX,
        customTop: drag.frameTop === undefined ? undefined : drag.frameTop + deltaY,
      } : outfit),
      items: current.items.map((item) => {
        const original = positions.get(item.id);
        return original ? { ...item, x: original.x + deltaX, y: original.y + deltaY } : item;
      }),
    }));
  };

  const endOutfitDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const kind = outfitDragRef.current ? 'board' : 'board-resize';
    const gesture = finishGesture(event, kind);
    if (!gesture) return;
    if (gesture.dragging && outfitDragRef.current) setSelectedBoardIds([outfitDragRef.current.id]);
    outfitDragRef.current = null;
    outfitResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelOutfitDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = outfitDragRef.current;
    const resize = outfitResizeRef.current;
    const gesture = finishGesture(event, drag ? 'board' : 'board-resize');
    if (!gesture) return;
    if (gesture.dragging && drag) {
      const originals = new Map(drag.members.map((member) => [member.id, member]));
      setBoard((current) => ({
        ...current,
        outfits: current.outfits.map((outfit) => outfit.id === drag.id ? { ...outfit, customLeft: drag.frameLeft, customTop: drag.frameTop } : outfit),
        items: current.items.map((item) => {
          const original = originals.get(item.id);
          return original ? { ...item, x: original.x, y: original.y } : item;
        }),
      }));
    }
    if (gesture.dragging && resize) updateOutfit(resize.id, resize.original);
    outfitDragRef.current = null;
    outfitResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const moveItem = (event: React.PointerEvent<HTMLElement>) => {
    const resize = resizeRef.current;
    if (resize) {
      if (!advanceGesture(event, 'item-resize')) return;
      const deltaX = (event.clientX - resize.startX) / viewport.zoom;
      const deltaY = (event.clientY - resize.startY) / viewport.zoom;
      const deltaScale = (deltaX * cardWidth + deltaY * 244) / (cardWidth ** 2 + 244 ** 2);
      const next = Math.min(2, Math.max(0.75, resize.scale + deltaScale));
      itemMovedRef.current = true;
      updateItem(resize.id, { scale: next });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (!advanceGesture(event, 'item')) return;
    itemMovedRef.current = true;
    const x = drag.itemX + (event.clientX - drag.start.x) / viewport.zoom;
    const y = drag.itemY + (event.clientY - drag.start.y) / viewport.zoom;
    const deltaX = x - drag.itemX;
    const deltaY = y - drag.itemY;
    if (!drag.sourceOutfitId) {
      const memberIds = new Set(drag.members.map((member) => member.id));
      boardRef.current?.querySelectorAll<HTMLElement>('.sticker').forEach((sticker) => {
        if (!memberIds.has(sticker.dataset.itemId ?? '')) return;
        sticker.classList.add('is-dragging');
        sticker.style.setProperty('--drag-offset-x', `${deltaX}px`);
        sticker.style.setProperty('--drag-offset-y', `${deltaY}px`);
      });
      return;
    }
    const positions = new Map(drag.members.map((member) => [member.id, member]));
    if (drag.sourceOutfitId && drag.sourceBounds) {
      const point = clientToBoard(event.clientX, event.clientY);
      const alreadyDetached = detachIntent?.sourceOutfitId === drag.sourceOutfitId;
      const nextDetached = hasDetachIntent(point, drag.sourceBounds, alreadyDetached);
      const nextIntent = nextDetached ? { sourceOutfitId: drag.sourceOutfitId, itemIds: drag.members.map((member) => member.id), sourceBounds: drag.sourceBounds } : null;
      detachIntentRef.current = nextIntent;
      setDetachIntent(nextIntent);
    }
    setBoard((current) => ({
      ...current,
      items: current.items.map((candidate) => {
        const origin = positions.get(candidate.id);
        return origin ? { ...candidate, x: origin.x + deltaX, y: origin.y + deltaY, autoPlaced: false } : candidate;
      }),
    }));
  };

  const endItemDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const kind = drag ? 'item' : 'item-resize';
    const gesture = finishGesture(event, kind);
    if (!gesture) return;
    if (drag && event.pointerType === 'touch' && canvasMode === 'select' && !gesture.dragging) {
      setCanvasSelection((current) => ({ ...current, itemIds: current.itemIds.filter((id) => id !== drag.id) }));
    }
    const draggedId = drag?.id;
    if (drag && !drag.sourceOutfitId && gesture.dragging) {
      const deltaX = (event.clientX - drag.start.x) / viewport.zoom;
      const deltaY = (event.clientY - drag.start.y) / viewport.zoom;
      const memberIds = new Set(drag.members.map((member) => member.id));
      boardRef.current?.querySelectorAll<HTMLElement>('.sticker').forEach((sticker) => {
        if (!memberIds.has(sticker.dataset.itemId ?? '')) return;
        sticker.classList.remove('is-dragging');
        sticker.style.removeProperty('--drag-offset-x');
        sticker.style.removeProperty('--drag-offset-y');
      });
      setBoard((current) => ({ ...current, items: current.items.map((item) => memberIds.has(item.id)
        ? { ...item, x: item.x + deltaX, y: item.y + deltaY, autoPlaced: false } : item) }));
    } else if (drag && !drag.sourceOutfitId) {
      boardRef.current?.querySelectorAll<HTMLElement>('.sticker.is-dragging').forEach((sticker) => {
        sticker.classList.remove('is-dragging');
        sticker.style.removeProperty('--drag-offset-x');
        sticker.style.removeProperty('--drag-offset-y');
      });
    }
    if (draggedId && gesture.dragging) {
      const rectangle = boardRef.current?.getBoundingClientRect();
      if (rectangle) {
        const x = (event.clientX - rectangle.left - viewport.x) / viewport.zoom;
        const y = (event.clientY - rectangle.top - viewport.y) / viewport.zoom;
        const destination = [...board.outfits].reverse().find((outfit) => {
          if (outfit.id === drag?.sourceOutfitId) return false;
          const bounds = getOutfitBounds(outfit, board.items, layoutHeights);
          return bounds && x >= bounds.left && x <= bounds.left + bounds.width && y >= bounds.top && y <= bounds.top + bounds.height;
        });
        const movedIds = drag?.members.map((member) => member.id) ?? [draggedId];
        if (destination && movedIds.some((id) => !destination.itemIds.includes(id))) {
          moveSelectedToBoard(destination.id, movedIds);
        } else if (drag?.sourceOutfitId && detachIntentRef.current?.sourceOutfitId === drag.sourceOutfitId) {
          removeItemsFromBoards(movedIds);
        }
      }
    }
    setDetachIntent(null);
    detachIntentRef.current = null;
    dragRef.current = null;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelItemDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const resize = resizeRef.current;
    const kind = drag ? 'item' : 'item-resize';
    const gesture = finishGesture(event, kind);
    if (!gesture) return;
    if (drag && !drag.sourceOutfitId) boardRef.current?.querySelectorAll<HTMLElement>('.sticker.is-dragging').forEach((sticker) => {
      sticker.classList.remove('is-dragging');
      sticker.style.removeProperty('--drag-offset-x');
      sticker.style.removeProperty('--drag-offset-y');
    });
    if (drag && gesture.dragging) {
      const originals = new Map(drag.members.map((member) => [member.id, member]));
      setBoard((current) => ({ ...current, items: current.items.map((item) => {
        const original = originals.get(item.id);
        return original ? { ...item, x: original.x, y: original.y } : item;
      }) }));
    }
    if (resize && gesture.dragging) updateItem(resize.id, { scale: resize.scale });
    setDetachIntent(null);
    detachIntentRef.current = null;
    dragRef.current = null;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startItemResize = (event: React.PointerEvent<HTMLButtonElement>, item: Item) => {
    if (event.button !== 0 || item.locked) return;
    event.preventDefault();
    event.stopPropagation();
    if (!beginGesture(event, 'item-resize')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { id: item.id, startX: event.clientX, startY: event.clientY, scale: itemScale(item) };
    dragRef.current = null;
    setSelectedIds((current) => current.includes(item.id) ? current : [item.id]);
  };

  const zoomBy = (amount: number) => {
    const bounds = boardRef.current?.getBoundingClientRect();
    const anchor = bounds ? { x: bounds.width / 2, y: bounds.height / 2 } : { x: 0, y: 0 };
    setViewport((current) => zoomViewportAt(current, anchor, current.zoom * (amount > 0 ? 1.15 : 1 / 1.15)));
  };

  const setZoomLevel = (zoom: number) => {
    const bounds = boardRef.current?.getBoundingClientRect();
    const anchor = bounds ? { x: bounds.width / 2, y: bounds.height / 2 } : { x: 0, y: 0 };
    setViewport((current) => zoomViewportAt(current, anchor, zoom));
  };

  const canvasFitArea = (canvas: DOMRect) => {
    let left = canvas.left + 24;
    let right = canvas.right - 24;
    let top = canvas.top + 24;
    let bottom = canvas.bottom - 24;
    const visible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    });
    visible('.topbar').forEach((element) => { top = Math.max(top, element.getBoundingClientRect().bottom + 20); });
    visible('.canvas-toolbar, .canvas-add, .format-toolbar')
      .forEach((element) => { bottom = Math.min(bottom, element.getBoundingClientRect().top - 16); });
    visible('.selection-actions, .board-bulk-actions, .section-toolbar, .board-toolbar, .element-toolbar').forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.top < canvas.top + canvas.height / 2) top = Math.max(top, rect.bottom + 16);
      else bottom = Math.min(bottom, rect.top - 16);
    });
    visible('.inspector, .section-mobile-editor, .closet-drawer, .workspace-menu').forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < canvas.width * 0.55 && rect.height > canvas.height * 0.58) {
        if (rect.left >= canvas.left + canvas.width / 2) right = Math.min(right, rect.left - 20);
        else left = Math.max(left, rect.right + 20);
      } else if (rect.bottom >= canvas.bottom - 12) bottom = Math.min(bottom, rect.top - 16);
      else if (rect.top <= canvas.top + 12) top = Math.max(top, rect.bottom + 16);
    });
    return { left, top, right, bottom, width: Math.max(100, right - left), height: Math.max(100, bottom - top) };
  };

  const fitBounds = (bounds: { left: number; top: number; width: number; height: number }[], maxZoom: number) => {
    if (!bounds.length) return;
    const left = Math.min(...bounds.map((entry) => entry.left));
    const top = Math.min(...bounds.map((entry) => entry.top));
    const width = Math.max(1, Math.max(...bounds.map((entry) => entry.left + entry.width)) - left);
    const height = Math.max(1, Math.max(...bounds.map((entry) => entry.top + entry.height)) - top);
    const canvas = boardRef.current?.getBoundingClientRect();
    if (!canvas) return;
    const area = canvasFitArea(canvas);
    const zoom = Math.min(maxZoom, (area.width - 24) / width, (area.height - 24) / height);
    setViewport({
      x: area.left - canvas.left + (area.width - width * zoom) / 2 - left * zoom,
      y: area.top - canvas.top + (area.height - height * zoom) / 2 - top * zoom,
      zoom,
    });
  };

  const fitCanvas = () => {
    if (!board.items.length && !board.outfits.length && !board.sections?.length) { setViewport({ x: 120, y: 64, zoom: 1 }); return; }
    const bounds = [
      ...board.items.map((item) => { const outfit = board.outfits.find((candidate) => candidate.itemIds.includes(item.id)); return { left: item.x, top: item.y, width: itemCardWidth(item, outfit) * itemScale(item), height: itemHeight(item, layoutHeights, outfit) }; }),
      ...board.outfits.flatMap((outfit) => { const bounds = getOutfitBounds(outfit, board.items, layoutHeights); return bounds ? [bounds] : []; }),
      ...(board.sections ?? []).map((section) => ({ left: section.x, top: section.y, width: section.width, height: section.height })),
    ];
    fitBounds(bounds, 1.2);
  };

  const zoomToSelection = () => {
    const selectedItems = board.items.filter((item) => selectedIds.includes(item.id));
    const selectedOutfits = board.outfits.filter((outfit) => selectedBoardIds.includes(outfit.id));
    const selectedSections = (board.sections ?? []).filter((section) => canvasSelection.sectionIds.includes(section.id));
    const bounds = [
      ...selectedItems.map((item) => {
        const outfit = board.outfits.find((candidate) => candidate.itemIds.includes(item.id));
        return { left: item.x, top: item.y, width: itemCardWidth(item, outfit) * itemScale(item), height: itemHeight(item, layoutHeights, outfit) };
      }),
      ...selectedOutfits.flatMap((outfit) => { const frame = getOutfitBounds(outfit, board.items, layoutHeights); return frame ? [frame] : []; }),
      ...selectedSections.map((section) => ({ left: section.x, top: section.y, width: section.width, height: section.height })),
    ];
    fitBounds(bounds, MAX_CANVAS_ZOOM);
  };

  const handleCanvasZoomKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === '+' || (event.key === '=' && event.shiftKey)) { event.preventDefault(); zoomBy(1); }
    else if (event.key === '-') { event.preventDefault(); zoomBy(-1); }
    else if (event.key === '0') { event.preventDefault(); setZoomLevel(1); }
    else if (event.key === '1') { event.preventDefault(); fitCanvas(); }
  };

  const rememberOutsideSurfaceFocus = (event: React.FocusEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && !target.closest('[aria-modal="true"], .saved-collections-panel, .template-gallery, .closet-drawer, .share-link-toast')) {
      lastOutsideSurfaceFocusRef.current = target;
    }
  };

  const rememberOutsideSurfacePointer = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('[aria-modal="true"], .saved-collections-panel, .template-gallery, .closet-drawer, .share-link-toast, .inspector')) return;
    const control = target.closest<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (control) lastOutsideSurfaceFocusRef.current = control;
  };

  const handleAccessibleSurfaceKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && (accessibleSurfaceOpen || Boolean(lastShareLink) || inspectorOpen)) {
      event.preventDefault();
      event.stopPropagation();
      const visibleModals = Array.from(appShellRef.current?.querySelectorAll<HTMLElement>('[aria-modal="true"]') ?? [])
        .filter((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; });
      const topModal = visibleModals.at(-1);
      if (topModal?.classList.contains('budget-modal')) setBudgetEditorId(null);
      else if (topModal?.classList.contains('sizing-modal')) closeSizingEditor();
      else if (topModal?.classList.contains('settings-modal')) setIsSettingsOpen(false);
      else if (topModal?.classList.contains('saved-collections-panel')) setIsSavedCollectionsOpen(false);
      else if (topModal?.classList.contains('template-gallery')) setTemplatePickerOpen(false);
      else if (topModal?.classList.contains('shared-collection-view')) { setSharedCollection(null); setSharedSelectedIds([]); }
      else if (topModal?.classList.contains('delete-confirmation')) setDeletionRequest(null);
      else if (topModal?.classList.contains('placeholder-replace-modal')) setReplacingPlaceholderId(null);
      else if (quotaPrompt) setQuotaPrompt(null);
      else if (topModal?.classList.contains('add-modal')) setIsAdding(false);
      else if (topModal?.getAttribute('role') === 'alertdialog') setDeletionRequest(null);
      else if (topModal) setQuotaPrompt(null);
      else if (sharedCollection) { setSharedCollection(null); setSharedSelectedIds([]); }
      else if (imagePicker) setImagePicker(null);
      else if (imageIntentPicker) setImageIntentPicker(null);
      else if (pieceSearchReview) setPieceSearchReview(null);
      else if (matchPicker) setMatchPicker(null);
      else if (deletionRequest) setDeletionRequest(null);
      else if (budgetEditorId) setBudgetEditorId(null);
      else if (replacingPlaceholderId) setReplacingPlaceholderId(null);
      else if (isAdding) setIsAdding(false);
      else if (isSizingOpen) closeSizingEditor();
      else if (isSettingsOpen) setIsSettingsOpen(false);
      else if (templatePickerOpen) setTemplatePickerOpen(false);
      else if (isSavedCollectionsOpen) setIsSavedCollectionsOpen(false);
      else if (isClosetOpen) setIsClosetOpen(false);
      else if (lastShareLink) closeShareToast();
      else if (inspectorOpen) closeInspectorSurface();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = Array.from(appShellRef.current?.querySelectorAll<HTMLElement>('[aria-modal="true"]') ?? [])
      .filter((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; })
      .at(-1);
    if (!dialog) return;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((control) => control.getClientRects().length > 0);
    if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  };

  const outfitTotals = useMemo(() => new Map(board.outfits.map((outfit) => [
    outfit.id, board.items.filter((item) => outfit.itemIds.includes(item.id)),
  ])), [board]);

  const totalSummary = useMemo(() => priceSummary(board.items, userSettings.preferredCurrency, exchangeRates), [board.items, userSettings.preferredCurrency, exchangeRates]);
  const canvasSpentSummary = useMemo(() => spentSummary(board.items, userSettings.preferredCurrency, exchangeRates), [board.items, userSettings.preferredCurrency, exchangeRates]);

  const clearEntireBoard = () => {
    window.localStorage.removeItem(storageKey);
    retiredStorageKeys.forEach((key) => window.localStorage.removeItem(key));
    setBoard({ items: [], outfits: [] });
    setSelectedIds([]);
    setActiveOutfitId(null);
    setSelectedBoardIds([]);
    setBoardSelectionOpen(false);
    setSelectedBoardElement(null);
    setItemDetailsOpenId(null);
    setAlternativeItemId(null);
    setIsClosetOpen(false);
    setConfirmClearBoard(false);
    setIsSettingsOpen(false);
  };

  const publishCollection = async () => {
    const ownerId = localOwnerId();
    const title = board.outfits[0]?.name || 'My Cura collection';
    const collection: SharedCollection<Board> = createSharedCollection(board, title, ownerId);
    const collections = loadSharedCollections();
    collections[collection.id] = collection;
    window.localStorage.setItem(sharedCollectionsKey, JSON.stringify(collections));
    const link = `${window.location.origin}${window.location.pathname}?collection=${encodeURIComponent(collection.id)}`;
    setLastShareLink(link);
    try {
      await navigator.clipboard.writeText(link);
      setProcessingLabel('Share link copied.');
      window.setTimeout(() => setProcessingLabel(null), 1800);
    } catch {
      setProcessingLabel('Share link ready to copy.');
    }
  };

  const saveActiveCollection = () => {
    if (!sharedCollection) return;
    setSavedCollections((references) => {
      const next = saveCollectionReference(sharedCollection, references);
      window.localStorage.setItem(sharedIntentKey, JSON.stringify(sharedIntentFor(sharedCollection.id, 'save', next)));
      return next;
    });
  };

  const copySharedItems = () => {
    if (!sharedCollection || !sharedSelectedIds.length) return;
    const selected = new Set(sharedSelectedIds);
    setBoard((current) => copyItemsToCanvas(current, sharedCollection.canvas.items.filter((item) => selected.has(item.id))));
    setSharedSelectedIds([]);
    window.localStorage.removeItem(sharedIntentKey);
  };

  const copySharedBoard = (outfitId: string) => {
    if (!sharedCollection) return;
    setBoard((current) => copyBoardToCanvas(current, sharedCollection.canvas, outfitId));
    window.localStorage.removeItem(sharedIntentKey);
  };

  const makeSharedEditable = () => {
    if (!sharedCollection) return;
    window.localStorage.setItem(sharedIntentKey, JSON.stringify(sharedIntentFor(sharedCollection.id, 'editable-copy', savedCollections)));
    setBoard(makeEditableCopy(sharedCollection.canvas, localOwnerId(), sharedCollection.id));
    setSelectedBoardIds([]);
    setBoardSelectionOpen(false);
    setSharedCollection(null);
    setSharedSelectedIds([]);
    window.localStorage.removeItem(sharedIntentKey);
  };

  const startFreshFromShared = () => {
    if (sharedCollection) window.localStorage.setItem(sharedIntentKey, JSON.stringify(sharedIntentFor(sharedCollection.id, 'start-fresh', savedCollections)));
    setBoard({ items: [], outfits: [], collectionId: crypto.randomUUID(), ownerId: localOwnerId(), sourceCollectionId: undefined });
    setSelectedBoardIds([]);
    setBoardSelectionOpen(false);
    setSharedCollection(null);
    setSharedSelectedIds([]);
    window.localStorage.removeItem(sharedIntentKey);
  };

  const openSavedCollection = (reference: SavedCollectionReference) => {
    const collection = loadSharedCollections()[reference.sharedCollectionId];
    if (!collection) return;
    setSharedCollection(collection);
    setSharedSelectedIds([]);
    setIsSavedCollectionsOpen(false);
  };

  const reportSharedContent = async (targetType: 'item' | 'board', targetId: string) => {
    if (!sharedCollection) return;
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collectionId: sharedCollection.id, targetType, targetId, reason: 'User report' }) });
      setProcessingLabel(response.ok ? 'Report received. Thank you.' : 'This report could not be submitted.');
    } catch { setProcessingLabel('This report could not be submitted.'); }
    window.setTimeout(() => setProcessingLabel(''), 2200);
  };

  const continueWithFreeAccount = () => {
    const pendingUrl = quotaPrompt?.pendingUrl ?? importQuota.pendingUrl ?? '';
    setImportQuota((current) => registerFreeAccount({ ...current, pendingUrl }));
    setQuotaPrompt(null);
    if (pendingUrl) {
      setDraft((current) => ({ ...current, sourceUrl: pendingUrl }));
      openAddLink();
    }
  };

  const requestRewardedAd = () => {
    const complete = () => {
      setImportQuota((current) => grantRewardedImports(current));
      setQuotaPrompt(null);
      setProcessingLabel('5 automatic imports added.');
      window.setTimeout(() => setProcessingLabel(null), 2200);
    };
    window.dispatchEvent(new CustomEvent('cura:rewarded-ad-request', { detail: { complete } }));
    setProcessingLabel('Waiting for the rewarded ad to complete…');
  };

  const pasteLinkFromClipboard = async () => {
    const field = document.querySelector<HTMLInputElement>('.add-modal .primary-link-field input');
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard reading is unavailable');
      const text = await navigator.clipboard.readText();
      const value = pastedUrls(text)[0] ?? text.trim();
      if (value) setDraft((current) => ({ ...current, sourceUrl: value }));
      else field?.focus();
    } catch {
      field?.focus();
      setProcessingLabel('Paste the product link into the URL field.');
      window.setTimeout(() => setProcessingLabel(null), 2500);
    }
  };

  return (
    <main className="app-shell" ref={appShellRef} onPointerDownCapture={rememberOutsideSurfacePointer} onFocusCapture={rememberOutsideSurfaceFocus} onKeyDownCapture={(event) => { handleAccessibleSurfaceKeyDown(event); if (!event.defaultPrevented) handleCanvasZoomKeyDown(event); }}>
      <h1 className="sr-only">Cura shopping canvas</h1>
      <header className={showPrices ? 'topbar' : 'topbar prices-hidden'}>
        <div className="topbar-inner">
          <div className="wordmark"><span>cura</span><i /> shopping canvas</div>
          <nav className="topbar-actions" aria-label="Canvas and workspace actions">
            <button type="button" className="nav-tab new-board-button" onClick={() => createNewBoard()}>New board</button>
            <button type="button" className="nav-tab topbar-medium-action" onClick={() => { setIsSavedCollectionsOpen(false); setIsClosetOpen(false); setTemplatePickerOpen((current) => !current); }}>Templates</button>
            <button type="button" className="nav-tab topbar-medium-action" onClick={() => void publishCollection()}>Share</button>
            <button type="button" className="nav-tab topbar-wide-action" onClick={() => { setTemplatePickerOpen(false); setIsSavedCollectionsOpen(false); setIsClosetOpen((current) => !current); }}>My Purchases ({boughtItems.length})</button>
            <button type="button" className="nav-tab topbar-wide-action" onClick={() => { setTemplatePickerOpen(false); setIsClosetOpen(false); setIsSavedCollectionsOpen((current) => !current); }}>Saved collections ({savedCollections.length})</button>
            <div className="workspace-menu-wrap" ref={workspaceMenuRef} onKeyDown={(event) => { if (event.key === 'Escape') { setWorkspaceMenuOpen(false); event.currentTarget.querySelector<HTMLButtonElement>('.workspace-menu-trigger')?.focus(); event.stopPropagation(); } }}>
              <button type="button" className="nav-tab workspace-menu-trigger" aria-expanded={workspaceMenuOpen} onClick={() => { setTemplatePickerOpen(false); setIsClosetOpen(false); setIsSavedCollectionsOpen(false); setWorkspaceMenuOpen((current) => !current); }}>More <span aria-hidden="true">⌄</span></button>
              {workspaceMenuOpen && <div className="workspace-menu" role="group" aria-label="Workspace actions">
                {showPrices && <div className="workspace-menu-total" aria-label={`Total and spent in ${userSettings.preferredCurrency}`}>
                  <strong>{trackerAmount(totalSummary, userSettings.preferredCurrency)} <i>/</i> {trackerAmount(canvasSpentSummary, userSettings.preferredCurrency)} spent</strong>
                  {(totalSummary.missing > 0 || canvasSpentSummary.missing > 0) && <small>Some prices are missing</small>}
                </div>}
                <button type="button" className="workspace-menu-medium" onClick={() => { createNewBoard(); setWorkspaceMenuOpen(false); }}>Create board</button>
                <button type="button" className="workspace-menu-medium" onClick={() => { setTemplatePickerOpen(true); setWorkspaceMenuOpen(false); }}>Templates</button>
                <button type="button" className="workspace-menu-medium" onClick={() => { void publishCollection(); setWorkspaceMenuOpen(false); }}>Share canvas</button>
                <button type="button" className="workspace-menu-wide" onClick={() => { setIsClosetOpen(true); setWorkspaceMenuOpen(false); }}>My Purchases ({boughtItems.length})</button>
                <button type="button" className="workspace-menu-wide" onClick={() => { setIsSavedCollectionsOpen(true); setWorkspaceMenuOpen(false); }}>Saved collections ({savedCollections.length})</button>
                {board.items.length > 0 && <button type="button" onClick={() => { setSelectedIds(board.items.map((item) => item.id)); setWorkspaceMenuOpen(false); }}>Select all products</button>}
                {board.items.length > 0 && <button type="button" onClick={() => { setNavigationMode(false); setMultiSelectMode(true); setWorkspaceMenuOpen(false); }}>Select multiple products</button>}
                <button type="button" onClick={() => { setCanvasMode('select'); setWorkspaceMenuOpen(false); }}>Select mode</button>
                {board.outfits.length > 0 && <button type="button" onClick={selectAllBoards}>Select all boards</button>}
                <button type="button" onClick={() => { setShowPrices((current) => !current); setWorkspaceMenuOpen(false); }}>{showPrices ? 'Hide prices' : 'Show prices'}</button>
                <button type="button" onClick={() => { setIsSettingsOpen(true); setWorkspaceMenuOpen(false); }}>Settings</button>
              </div>}
            </div>
          </nav>
          <div className="board-total" aria-label={`Total and spent in ${userSettings.preferredCurrency}`}>
            <strong>{trackerAmount(totalSummary, userSettings.preferredCurrency)} <i>/</i> {trackerAmount(canvasSpentSummary, userSettings.preferredCurrency)} <span>spent</span></strong>
            {(totalSummary.missing > 0 || canvasSpentSummary.missing > 0) && <small>{totalSummary.missing > 0 ? `${totalSummary.missing} total ${totalSummary.missing === 1 ? 'price' : 'prices'} missing` : ''}{totalSummary.missing > 0 && canvasSpentSummary.missing > 0 ? ' · ' : ''}{canvasSpentSummary.missing > 0 ? `${canvasSpentSummary.missing} purchased ${canvasSpentSummary.missing === 1 ? 'price' : 'prices'} missing` : ''}</small>}
          </div>
        </div>
      </header>

      {lastShareLink && <div className="share-link-toast" role="status"><label>Share link<input type="url" autoComplete="off" readOnly value={lastShareLink} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" autoFocus onClick={closeShareToast}>Done</button></div>}

      {quotaPrompt && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setQuotaPrompt(null); }}>
        <section className="add-modal" role="dialog" aria-modal="true" aria-labelledby="quota-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-heading"><div><span className="eyebrow">AUTOMATIC IMPORTS</span><h2 id="quota-title">{quotaPrompt.reason === 'signup-required' ? 'Keep building with a free account' : 'Monthly automatic imports used'}</h2></div><button type="button" onClick={() => setQuotaPrompt(null)} aria-label="Close">×</button></div>
          <p className="modal-note">{quotaPrompt.reason === 'signup-required' ? 'You have used your 10 guest automatic imports. Your pending product link will be kept while you continue with a free account.' : "You've used your 30 automatic imports plus any rewards currently available this month."}</p>
          {quotaPrompt.reason === 'signup-required'
            ? <button className="submit-button" type="button" onClick={continueWithFreeAccount}>Continue with a free account</button>
            : importQuota.rewardGrants < 4 && <button className="submit-button" type="button" onClick={requestRewardedAd}>Watch a short ad → +5 imports</button>}
          {quotaPrompt.reason === 'monthly-limit' && importQuota.rewardGrants >= 4 && <p className="modal-note">You have reached the free maximum of 50 automatic imports this month.</p>}
        </section>
      </div>}

      {isSavedCollectionsOpen && <div className="saved-collections-panel" role="dialog" aria-modal="true" aria-labelledby="saved-collections-title" tabIndex={-1}>
        <div><strong id="saved-collections-title">Saved collections</strong><button type="button" onClick={() => setIsSavedCollectionsOpen(false)} aria-label="Close saved collections">×</button></div>
        {savedCollections.map((reference) => <button type="button" key={reference.sharedCollectionId} onClick={() => openSavedCollection(reference)}><strong>{reference.title}</strong><small>Original collection · saved {new Date(reference.savedAt).toLocaleDateString()}</small></button>)}
        {!savedCollections.length && <p>Collections you save will remain available on this device.</p>}
      </div>}

      {sharedCollection && <div className="modal-backdrop shared-collection-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) { setSharedCollection(null); setSharedSelectedIds([]); } }}>
        <section className="shared-collection-view" role="dialog" aria-modal="true" aria-label={`Shared collection ${sharedCollection.title}`}>
          <div className="shared-collection-heading"><div><span className="eyebrow">SHARED COLLECTION</span><h2>{sharedCollection.title}</h2><small>View the original, save a reference, or reuse resolved products without importing them again.</small></div><button type="button" onClick={() => { setSharedCollection(null); setSharedSelectedIds([]); }} aria-label="Close shared collection">×</button></div>
          <div className="shared-collection-actions">
            <button type="button" onClick={saveActiveCollection}>{savedCollections.some((reference) => reference.sharedCollectionId === sharedCollection.id) ? '♥ Collection saved' : '♡ Save collection'}</button>
            <button type="button" onClick={makeSharedEditable}>Make editable copy</button>
            <button type="button" onClick={startFreshFromShared}>Start fresh</button>
          </div>
          <div className="shared-copy-grid">
            <section><div className="shared-section-heading"><strong>Products</strong>{sharedSelectedIds.length > 0 && <button type="button" onClick={copySharedItems}>Copy {sharedSelectedIds.length === 1 ? 'item' : `${sharedSelectedIds.length} items`} to my canvas</button>}</div>
              <div className="shared-product-list">{sharedCollection.canvas.items.map((item) => <div key={item.id}><label className={sharedSelectedIds.includes(item.id) ? 'is-selected' : ''}><input type="checkbox" checked={sharedSelectedIds.includes(item.id)} onChange={() => setSharedSelectedIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])} /><img src={item.imageUrl ? displayedImage(item.imageUrl) : productPlaceholder(item.title)} alt="" /><span><strong>{item.title}</strong><small>{item.brand}</small></span></label><button type="button" onClick={() => void reportSharedContent('item', item.id)}>Report item</button></div>)}</div>
            </section>
            <section><div className="shared-section-heading"><strong>Boards</strong></div><div className="shared-board-list">{sharedCollection.canvas.outfits.map((outfit) => <div key={outfit.id}><span><strong>{outfit.name}</strong><small>{outfit.itemIds.length} {outfit.itemIds.length === 1 ? 'item' : 'items'}</small></span><button type="button" onClick={() => copySharedBoard(outfit.id)}>Copy board to my canvas</button><button type="button" onClick={() => void reportSharedContent('board', outfit.id)}>Report board</button></div>)}</div></section>
          </div>
        </section>
      </div>}

      {templatePickerOpen && <TemplatePicker onClose={() => setTemplatePickerOpen(false)} onUse={createStarterCanvas} />}

      <section
        ref={boardRef}
        className={`board ${isPanning ? 'is-panning' : ''} ${navigationMode ? 'navigation-mode' : ''} ${!board.items.length && !board.outfits.length && !board.sections?.length ? 'is-empty' : ''}`}
        onPointerDownCapture={handleCanvasPointerDownCapture}
        onPointerMoveCapture={handleCanvasPointerMoveCapture}
        onPointerUpCapture={handleCanvasPointerUpCapture}
        onPointerCancelCapture={handleCanvasPointerUpCapture}
        onClickCapture={handleCanvasClickCapture}
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={endBoardPointer}
        onPointerCancel={cancelBoardPointer}
        onLostPointerCapture={cancelBoardPointer}
        onWheel={handleBoardWheel}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onContextMenuCapture={openQuickAdd}
        tabIndex={canvasObjectTabStop ? -1 : 0}
        aria-label="Shopping canvas"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); clearCanvasSelection(); }
          else if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            const firstObject = event.currentTarget.querySelector<HTMLElement>('[data-canvas-keyboard-object]');
            if (firstObject) { event.preventDefault(); firstObject.focus({ preventScroll: true }); }
          }
        }}
      >
        {!board.items.length && !board.outfits.length && !(board.sections?.length) && <section className="empty-canvas-start" aria-labelledby="empty-canvas-title">
          <h2 id="empty-canvas-title">Start your canvas</h2>
          <div className="empty-canvas-routes" role="group" aria-label="Ways to get started">
            <button type="button" className="empty-canvas-primary" onClick={openAddLink}>Paste or add a product</button>
            <button type="button" onClick={() => setTemplatePickerOpen(true)}>Use a template</button>
            <button type="button" onClick={createNewBoard}>New board</button>
          </div>
        </section>}
        <div ref={worldRef} className="world" style={{ transform: 'translate(var(--world-x), var(--world-y)) scale(var(--world-zoom))', '--world-x': `${viewport.x}px`, '--world-y': `${viewport.y}px`, '--world-zoom': viewport.zoom } as CSSProperties}>
          {(board.sections ?? []).map((section) => <div key={section.id}
            data-section-id={section.id}
            className={`canvas-section section-style-${section.style} ${activeSectionId === section.id ? 'is-active' : ''}`}
            style={{ left: section.x, top: section.y, width: section.width, height: section.height }}
            role="group" tabIndex={canvasObjectTabStop === `section:${section.id}` ? 0 : -1} data-canvas-keyboard-object={`section:${section.id}`} aria-describedby="canvas-keyboard-help" aria-label={`Section ${section.title}`}
            onClick={(event) => { if (event.target === event.currentTarget) { if (suppressSectionClickRef.current) suppressSectionClickRef.current = false; else if (window.matchMedia('(pointer: coarse)').matches && canvasMode === 'select') toggleSectionSelection(section.id); else selectSection(section.id); } }}
            onKeyDown={(event) => sectionKeyDown(event, section)}>
            <div className="section-heading" style={{ transform: `scale(${1 / viewport.zoom})` }}
              onPointerDown={(event) => startSectionDrag(event, section)} onPointerMove={moveSectionPointer}
              onPointerUp={endSectionPointer} onPointerCancel={(event) => endSectionPointer(event, true)} onLostPointerCapture={(event) => endSectionPointer(event, true)}
              onClick={(event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (target?.closest('button, a, input, textarea, select, summary')) return;
                activateSectionTitle(event, section);
              }}>
              <button type="button" className="section-move" style={{ display: 'none' }} title={`Move ${section.title} and its contents`} aria-label={`Move section ${section.title}`}
                onPointerDown={(event) => startSectionDrag(event, section)} onPointerMove={moveSectionPointer}
                onPointerUp={endSectionPointer} onPointerCancel={(event) => endSectionPointer(event, true)} onLostPointerCapture={(event) => endSectionPointer(event, true)}
                onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault();
                  nudgeSection(section.id, event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0,
                    event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0); }}>⠿</button>
              <div className="section-heading-copy">
                {renamingSectionId === section.id ? <>
                  <input autoFocus aria-label="Section title" value={section.title} onChange={(event) => updateSection(section.id, { title: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); setRenamingSectionId(null); } }}
                    onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setRenamingSectionId((current) => current === section.id ? null : current); }} />
                  <input aria-label="Section subtitle" placeholder="Add a subtitle" value={section.subtitle ?? ''} onChange={(event) => updateSection(section.id, { subtitle: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); setRenamingSectionId(null); } }}
                    onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setRenamingSectionId((current) => current === section.id ? null : current); }} />
                </> : <>
                  <strong className="section-title" onDoubleClick={() => { if (canvasActivationIntent('double-activate', activeSectionId === section.id) === 'edit') startSectionRename(section); }}>{section.title}</strong>
                  {section.subtitle && <small className="section-subtitle" onDoubleClick={() => { if (canvasActivationIntent('double-activate', activeSectionId === section.id) === 'edit') startSectionRename(section); }}>{section.subtitle}</small>}
                </>}
              </div>
            </div>
            {activeSectionId === section.id && <button type="button" className="section-resize corner-grip" aria-label={`Resize section ${section.title}`}
              onPointerDown={(event) => startSectionResize(event, section)} onPointerMove={moveSectionPointer}
              onPointerUp={endSectionPointer} onPointerCancel={(event) => endSectionPointer(event, true)} onLostPointerCapture={(event) => endSectionPointer(event, true)}
              onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault();
                updateSection(section.id, { width: Math.max(240, section.width + (event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0)),
                  height: Math.max(160, section.height + (event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0)) }); }} />}
          </div>)}
          {board.outfits.map((outfit) => {
            const hiddenDuringDetach = detachIntent?.sourceOutfitId === outfit.id ? new Set(detachIntent.itemIds) : null;
            const bounds = getOutfitBounds(outfit, hiddenDuringDetach ? board.items.filter((item) => !hiddenDuringDetach.has(item.id)) : board.items, layoutHeights) ?? (detachIntent?.sourceOutfitId === outfit.id ? { ...detachIntent.sourceBounds, members: [] } : null);
            if (!bounds) return null;
            const containingSection = board.sections?.find((section) => section.boardIds.includes(outfit.id));
            const isTemplateBoard = Boolean(containingSection || outfit.presentation?.templateId && outfit.presentation.templateId !== 'default'
              || outfit.itemIds.some((itemId) => board.items.find((item) => item.id === itemId)?.placeholder));
            const effectiveStyle = resolveBoardStyle(outfit.presentation, outfit.styleOverrides);
            const sectionTint = containingSection ? sectionTintColors[containingSection.style] : null;
            const templateBoardSurface = sectionTint && !effectiveStyle.backgroundColor && !outfit.presentation?.backgroundImage
              ? `color-mix(in srgb, ${sectionTint} 12%, var(--color-surface-raised))` : undefined;
            const templateBoardBorder = sectionTint && !effectiveStyle.borderColor
              ? `color-mix(in srgb, ${sectionTint} 32%, var(--color-border))` : undefined;
            const itemsForBoard = outfitTotals.get(outfit.id) ?? [];
            const total = priceSummary(itemsForBoard, userSettings.preferredCurrency, exchangeRates);
            const spent = spentSummary(itemsForBoard, userSettings.preferredCurrency, exchangeRates);
            const budgetCurrency = outfit.budgetCurrency || userSettings.preferredCurrency;
            const convertedBudget = outfit.budget === null ? null : convertKnownCurrencyAmount(outfit.budget, budgetCurrency, userSettings.preferredCurrency, exchangeRates);
            const isOverBudget = outfit.budget !== null
              && !total.conversionMissing
              && convertedBudget !== null
              && Number.isFinite(convertedBudget)
              && total.amount > convertedBudget;
            return (
              <div
                className={`outfit-frame board-background-${outfit.presentation?.backgroundPreset ?? 'paper'} board-pattern-${outfit.presentation?.patternPreset ?? 'none'} board-heading-${outfit.presentation?.headingPreset ?? 'sans'} board-template-${outfit.presentation?.templateId ?? 'default'} ${isTemplateBoard ? 'template-composition-board' : ''} ${containingSection ? `in-template-section section-parent-${containingSection.style}` : ''} ${activeOutfitId === outfit.id ? 'is-active' : ''} ${validSelectedBoardIds.includes(outfit.id) ? 'is-board-selected' : ''}`}
                key={outfit.id}
                data-outfit-id={outfit.id}
                onPointerMove={moveOutfit}
                onPointerUp={endOutfitDrag}
                onPointerCancel={cancelOutfitDrag}
                onLostPointerCapture={cancelOutfitDrag}
                onClick={(event) => { if (itemMovedRef.current) { itemMovedRef.current = false; return; } const target = event.target instanceof Element ? event.target : null; if (!target?.closest('.outfit-header, .sticker, .board-element, .outfit-label, button, a, input, select, textarea, [contenteditable="true"]')) selectBoard(outfit.id, event.metaKey || event.ctrlKey || event.shiftKey); }}
                style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, borderColor: templateBoardBorder ?? effectiveStyle.borderColor ?? outfit.color ?? boardPalette[0], borderStyle: isTemplateBoard && !outfit.styleOverrides?.borderStyle && effectiveStyle.borderStyle !== 'none' ? 'solid' : effectiveStyle.borderStyle, borderWidth: effectiveStyle.borderStyle === 'none' ? 0 : isTemplateBoard && !outfit.styleOverrides?.borderWidth ? 1 : effectiveStyle.borderWidth === 'regular' ? 2 : 1, borderRadius: isTemplateBoard && !outfit.styleOverrides?.corners ? 'var(--radius-medium)' : effectiveStyle.corners === 'square' ? 2 : effectiveStyle.corners === 'soft' ? 10 : 18, ...boardBackgroundStyle(outfit), backgroundColor: effectiveStyle.backgroundColor ?? templateBoardSurface ?? boardBackgroundStyle(outfit).backgroundColor }}
                >
                <div className="outfit-header" data-layout-key={`header:${outfit.id}`} style={{ transform: `scale(${1 / viewport.zoom})` }} onPointerDown={(event) => startOutfitDrag(event, outfit)} onClick={(event) => {
                  if (itemMovedRef.current) { itemMovedRef.current = false; return; }
                  const target = event.target instanceof Element ? event.target : null;
                  if (target?.closest('input, select, textarea, .board-edit-action, .outfit-select-toggle, .set-budget-label')) return;
                  activateOutfitTitle(event, outfit);
                }}>
                {renamingOutfitId === outfit.id
                  ? <input className="outfit-label outfit-name-edit" autoFocus aria-label="Board title" value={outfitNameDraft} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setOutfitNameDraft(event.target.value)} onBlur={() => finishOutfitRename(outfit.id, true)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finishOutfitRename(outfit.id, true); } if (event.key === 'Escape') { event.preventDefault(); finishOutfitRename(outfit.id, false); } }} />
                  : <button type="button"
                    className="outfit-label"
                    data-canvas-keyboard-object={`board:${outfit.id}`}
                    tabIndex={canvasObjectTabStop === `board:${outfit.id}` ? 0 : -1}
                    aria-describedby="canvas-keyboard-help"
                    onClick={(event) => { event.preventDefault(); }}
                    onKeyDown={(event) => {
                      const selected = validSelectedBoardIds.includes(outfit.id);
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (selected) startOutfitRename(outfit);
                        else selectBoard(outfit.id);
                      } else if (event.key === ' ') {
                        event.preventDefault();
                        selectBoard(outfit.id, true);
                      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
                        event.preventDefault();
                        requestDeleteSelectedBoardsAndContents();
                      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                        event.preventDefault();
                        if (selected) {
                          const step = event.shiftKey ? 16 : 8;
                          nudgeBoard(outfit.id, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
                            event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
                        } else focusAdjacentCanvasObject(event.currentTarget, event.key);
                      }
                    }}
                    aria-pressed={validSelectedBoardIds.includes(outfit.id)}
                  >
                    <strong className={`board-title-font-${effectiveStyle.titleFont} board-title-size-${effectiveStyle.titleSize} ${isTemplateBoard ? 'template-board-title' : ''}`} aria-label={outfit.name} style={{ color: effectiveStyle.titleColor, fontFamily: isTemplateBoard ? 'var(--font-ui)' : undefined, fontWeight: isTemplateBoard ? 600 : effectiveStyle.titleWeight === 'regular' ? 400 : effectiveStyle.titleWeight === 'medium' ? 500 : effectiveStyle.titleWeight === 'bold' ? 700 : 600, fontStyle: isTemplateBoard ? 'normal' : effectiveStyle.titleStyle, textAlign: effectiveStyle.titleAlign }}>{/^([0-9]{1,2}\s*\/\s*)(.*)$/.test(outfit.name) ? <><span className="board-title-number" aria-hidden="true">{outfit.name.match(/^([0-9]{1,2}\s*\/\s*)/)?.[1]}</span>{outfit.name.replace(/^[0-9]{1,2}\s*\/\s*/, '')}</> : outfit.name}</strong>
                  </button>}
                  {boardSelectionOpen && <button type="button" tabIndex={canvasObjectTabStop === `board:${outfit.id}` ? 0 : -1} className={`outfit-select-toggle ${validSelectedBoardIds.includes(outfit.id) ? 'is-selected' : ''}`}
                    onPointerDown={(event) => event.stopPropagation()} onClick={() => selectBoard(outfit.id, true)}
                    aria-label={`${validSelectedBoardIds.includes(outfit.id) ? 'Remove' : 'Add'} ${outfit.name} ${validSelectedBoardIds.includes(outfit.id) ? 'from' : 'to'} board selection`}
                    aria-pressed={validSelectedBoardIds.includes(outfit.id)}>{validSelectedBoardIds.includes(outfit.id) ? 'Selected' : 'Select'}</button>}
                  {showPrices && <div className={`outfit-price ${isOverBudget ? 'over-budget' : ''}`}>
                    <strong>{trackerAmount(total, userSettings.preferredCurrency)} <i>/</i> {trackerAmount(spent, userSettings.preferredCurrency)} <span>spent</span></strong>
                    {(total.missing > 0 || spent.missing > 0) && <small>{total.missing > 0 ? `${total.missing} total ${total.missing === 1 ? 'price' : 'prices'} missing` : ''}{total.missing > 0 && spent.missing > 0 ? ' · ' : ''}{spent.missing > 0 ? `${spent.missing} purchased ${spent.missing === 1 ? 'price' : 'prices'} missing` : ''}</small>}
                    {outfit.budget !== null && <small>Budget: {formatCurrency(outfit.budget, budgetCurrency, budgetCurrency)} {budgetCurrency}{isOverBudget ? ' · Over budget' : ''}</small>}
                  </div>}
                </div>
                {!outfit.itemIds.length && <p className="empty-board-copy">No products added yet.</p>}
                <button className="outfit-resize corner-grip"
                  tabIndex={-1}
                  onPointerDown={(event) => startOutfitResize(event, outfit, bounds)}
                  onPointerCancel={cancelOutfitDrag}
                  onLostPointerCapture={cancelOutfitDrag}
                  onDoubleClick={() => updateOutfit(outfit.id, outfit.itemIds.length ? { customWidth: undefined, customHeight: undefined, customLeft: undefined, customTop: undefined } : { customWidth: 600, customHeight: 460 })}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault(); event.stopPropagation();
                    updateOutfit(outfit.id, { customWidth: Math.max(300, bounds.width + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0)), customHeight: Math.max(250, bounds.height + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0)) });
                  }}
                  title="Drag to resize; double-click to fit products"
                  aria-label={`Resize board ${outfit.name}`} />
              </div>
            );
          })}

          {board.outfits.flatMap((outfit) => {
            const hiddenDuringDetach = detachIntent?.sourceOutfitId === outfit.id ? new Set(detachIntent.itemIds) : null;
            const bounds = getOutfitBounds(outfit, hiddenDuringDetach ? board.items.filter((item) => !hiddenDuringDetach.has(item.id)) : board.items, layoutHeights) ?? (detachIntent?.sourceOutfitId === outfit.id ? { ...detachIntent.sourceBounds, members: [] } : null);
            if (!bounds) return [];
            return (outfit.elements ?? []).map((element) => {
              const selected = selectedBoardElement?.outfitId === outfit.id && selectedBoardElement.elementId === element.id;
              return <div
                key={element.id}
                className={`board-element board-element-${element.type} element-shape-${element.shape ?? 'none'} text-preset-${element.textPreset ?? 'clean'} text-size-${element.textSize ?? 'medium'} ${selected ? 'is-selected' : ''}`}
                data-canvas-keyboard-object={`element:${outfit.id}:${element.id}`}
                style={{ left: bounds.left + element.x, top: bounds.top + element.y, width: element.width, height: element.height, zIndex: selected ? 6 : Math.max(1, element.zIndex ?? 1), transform: `rotate(${element.rotation ?? 0}deg)`, color: element.color, '--element-color': element.color } as React.CSSProperties}
                onPointerDown={(event) => startBoardElementDrag(event, outfit, element)}
                onPointerMove={moveBoardElement}
                onPointerUp={endBoardElementMove}
                onPointerCancel={cancelBoardElementMove}
                onLostPointerCapture={cancelBoardElementMove}
                onDoubleClick={() => { setInspectorTab('details'); setBoardElementInspectorOpen(true); }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === ' ') { event.preventDefault(); setSelectedBoardElement(selected ? null : { outfitId: outfit.id, elementId: element.id }); return; }
                  if (event.key === 'Enter') { event.preventDefault(); setInspectorTab('details'); setBoardElementInspectorOpen(true); return; }
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(event.key)) return;
                  event.preventDefault();
                  if (event.key === 'Delete' || event.key === 'Backspace') removeBoardElement(outfit.id, element.id);
                  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    if (!selected) { focusAdjacentCanvasObject(event.currentTarget, event.key); return; }
                    const step = event.shiftKey ? 16 : 8;
                    updateBoardElement(outfit.id, element.id, { x: element.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: element.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
                  }
                }}
                tabIndex={canvasObjectTabStop === `element:${outfit.id}:${element.id}` ? 0 : -1}
                role="group"
                aria-describedby="canvas-keyboard-help"
                aria-label={element.type === 'text' ? `Board text: ${element.content}` : `${element.type} board decoration`}
              >
                {element.type === 'image' && element.imageUrl && <img src={element.imageUrl} alt="" />}
                {element.type === 'text' && <span style={{ textAlign: element.textAlign ?? 'left' }}>{element.content}</span>}
                {!['image', 'text'].includes(element.type) && <span aria-hidden="true" />}
                {selected && <button className="board-element-resize corner-grip" onPointerDown={(event) => startBoardElementResize(event, outfit, element)} onPointerCancel={cancelBoardElementMove} onLostPointerCapture={cancelBoardElementMove} aria-label="Resize selected board element" />}
              </div>;
            });
          })}

          {board.items.map((item) => {
            const containingOutfit = board.outfits.find((outfit) => outfit.itemIds.includes(item.id));
            const presentation = resolveItemPresentation(containingOutfit?.presentation, item.presentation);
            const availability = visibleAvailability(item);
            const layout = containingOutfit?.presentation?.layoutPreset ?? 'freeform';
            const sectionLabel = layout === 'routine-steps' ? `${presentation.routinePhase === 'none' ? '' : `${presentation.routinePhase} · `}Step ${(containingOutfit?.itemIds.indexOf(item.id) ?? 0) + 1}`
              : layout === 'category-rows' || layout === 'capsule' ? productCategory(item.title) : '';
            return (
            <article
              className={`sticker product-style-${presentation.preset} product-board-${containingOutfit?.presentation?.templateId ?? 'none'} image-shape-${presentation.shape} label-${presentation.labelPlacement} title-${presentation.titleSize} price-${presentation.priceSize} ${item.placeholder ? 'template-placeholder' : ''} ${selectedIds.includes(item.id) ? 'is-selected' : ''} ${item.bought ? 'is-bought' : ''} ${detachIntent?.itemIds.includes(item.id) ? 'is-detaching' : ''}`}
              data-canvas-keyboard-object={`item:${item.id}`}
              aria-describedby="canvas-keyboard-help"
              key={item.id}
              data-item-id={item.id}
              data-layout-key={`item:${item.id}`}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              style={{ left: item.x, top: item.y, width: itemCardWidth(item, containingOutfit) * itemScale(item) }}
              onPointerDown={(event) => startItemDrag(event, item)}
              onPointerMove={moveItem}
              onPointerUp={endItemDrag}
              onPointerCancel={cancelItemDrag}
              onLostPointerCapture={cancelItemDrag}
              onClick={(event) => { if (itemMovedRef.current) { itemMovedRef.current = false; return; } if (item.placeholder) { openPlaceholder(item); return; } const now=Date.now(),previous=itemTapRef.current,doubleActivate=event.detail>1||(previous?.id===item.id&&now-previous.at<400); itemTapRef.current=doubleActivate?null:{id:item.id,at:now}; if(doubleActivate&&selectedIds.includes(item.id)){setInspectorTab('details');setItemDetailsOpenId(item.id);} }}
              onDoubleClick={() => { if(!item.placeholder&&selectedIds.includes(item.id)){setInspectorTab('details');setItemDetailsOpenId(item.id);} }}
              tabIndex={canvasObjectTabStop === `item:${item.id}` ? 0 : -1}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                const selected = selectedIds.includes(item.id);
                if (event.key === 'Enter') { event.preventDefault(); if (item.placeholder) openPlaceholder(item); else if(canvasActivationIntent('enter', selected)==='edit'){setInspectorTab('details');setItemDetailsOpenId(item.id);} else { setSelectedIds([item.id]); setActiveOutfitId(null); } return; }
                if (event.key === ' ') { event.preventDefault(); if (item.placeholder) openPlaceholder(item); else setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); return; }
                if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); requestDeletion(selectedIds); return; }
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  event.preventDefault();
                  if (!selected) { focusAdjacentCanvasObject(event.currentTarget, event.key); return; }
                  if (item.locked) return;
                  const step = event.shiftKey ? 16 : 8;
                  updateItem(item.id, { x: item.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: item.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
                }
              }}
              aria-label={item.placeholder ? `Replace ${item.placeholder.label}` : `${item.title}, ${itemPriceLabel(item, userSettings.preferredCurrency, userSettings.convertItemPrices, exchangeRates)}`}
            >
              {item.placeholder ? <div className="placeholder-card" style={{ minHeight: itemArtworkHeight(item, containingOutfit) + 96 }}>
                <span className="placeholder-card-icon" aria-hidden="true">+</span>
                <strong>{item.placeholder.label}</strong>
              </div> : <>
              {detachIntent?.itemIds.includes(item.id) && <span className="detach-feedback" role="status">Remove from board</span>}
              {presentation.showAvailability && availability && <span className={`stock-dot ${availability === 'Sold out' ? 'out-of-stock' : availability === 'Low stock' ? 'low-in-stock' : 'plenty-in-stock'}`} role="img" aria-label={`Availability: ${availability}`} />}
              <div className="sticker-art" style={{ height: itemArtworkHeight(item, containingOutfit) * itemScale(item) }}>
                <div className="product-image-shell">{item.isLoading && !item.imageUrl
                  ? <div className="product-image-skeleton" role="status" aria-label="Finding product image" />
                  : <img width={400} height={400} loading="lazy" decoding="async" style={{ objectFit: presentation.imageFit }} src={item.imageUrl ? displayedImage(item.imageUrl) : productPlaceholder(item.title)} onError={(event) => {
                    if (!item.imageUrl) return;
                    event.currentTarget.src = productPlaceholder(item.title);
                    if (item.isUserImage) return;
                    const brokenImages = { ...item.brokenImages, [item.imageUrl]: Date.now() };
                    const next = item.imageOptions?.find((url) => !brokenImages[url] || Date.now() - brokenImages[url] >= 15 * 60_000) || '';
                    updateItem(item.id, { imageUrl: next, brokenImages });
                    if (!next && !item.isUserImage) enrichmentAttempts.current.delete(item.id);
                  }} alt={item.imageUrl ? item.title : `Preview unavailable for ${item.title}`} />}</div>
                {item.imageIsGuess && <span className="best-guess-tag">Best guess image</span>}
                {item.unsure && <span className="unsure-tag">Unsure</span>}
                {item.bought && <span className="bought-tag">Bought</span>}
                {item.locked && <span className="locked-tag">Locked</span>}
              </div>
              <div className="sticker-meta" style={{ textAlign: presentation.textAlign }}>
                {sectionLabel && <small className="product-section-label" style={{ color: presentation.textColor || undefined }}>{sectionLabel}</small>}
                <strong className="product-name" style={{ color: presentation.textColor || undefined }} title={cardProductTitle(item)}>{cardProductTitle(item)}</strong>
                <strong className="product-price" style={{ color: presentation.textColor || undefined }}>{showPrices ? itemPriceLabel(item, userSettings.preferredCurrency, userSettings.convertItemPrices, exchangeRates) : 'Price hidden'}</strong>
                {item.priceStale && <small className="resolution-status">Price may be out of date</small>}
                {item.isLoading && <small className="resolution-status" role="status">Finding product details…</small>}
                {presentation.showBrand && item.brand && <small className="product-brand" style={{ color: presentation.textColor || undefined }}>{item.brand}</small>}
                {presentation.showAvailability && (item.color || availability) && <small className="product-availability" style={{ color: presentation.textColor || undefined }}>{[item.color, availability].filter(Boolean).join(' · ')}</small>}
                {containingOutfit?.presentation?.templateId === 'reveal' && <div className="reveal-details">
                  {item.size && <small style={{ color: presentation.textColor || undefined }}>Size: {item.size}</small>}
                  {item.color && <small style={{ color: presentation.textColor || undefined }}>Colour: {item.color}</small>}
                  {availability && <small style={{ color: presentation.textColor || undefined }}>Stock: {availability}</small>}
                  {item.notes && <small className="reveal-notes" style={{ color: presentation.textColor || undefined }}>{item.notes}</small>}
                  {productLink(item.sourceUrl) && <a href={productLink(item.sourceUrl)} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>Open product ↗</a>}
                </div>}
                {!hasValidProductPrice(item.price, item.currency) && !item.isLoading && <button className="add-price-action" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedIds([item.id]); setActiveOutfitId(null); setInspectorTab('details'); setItemDetailsOpenId(item.id); }}>Add price</button>}
              </div>
              {!item.locked && <button className="sticker-resize corner-grip" tabIndex={-1} onPointerDown={(event) => startItemResize(event, item)} onPointerCancel={cancelItemDrag} onLostPointerCapture={cancelItemDrag}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault(); event.stopPropagation();
                  updateItem(item.id, { scale: Math.min(2, Math.max(0.75, itemScale(item) + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 0.05 : -0.05))) });
                }} title="Drag to resize product" aria-label={`Resize ${item.title}`} />}
              </>}
            </article>
          ); })}

          {alternativeItemId && board.items.map((item) => {
            if (item.id !== alternativeItemId) return null;
            const alternatives = alternativeSearches(item, userSettings.preferredCurrency);
            const otherColors = item.availabilityVerified && item.availability === 'Out of stock' && item.colorOptions.length > 1
              ? `${item.color || 'This colour'} is unavailable. Try ${item.colorOptions.filter((color) => color !== item.color).join(', ')}.`
              : '';
            const guidance = alternatives.category === 'fashion'
              ? 'Search for this piece secondhand first.'
              : alternatives.category === 'fragrance'
                ? 'Compare new fragrances by notes, concentration, and bottle size.'
                : alternatives.category === 'skincare' || alternatives.category === 'haircare'
                  ? `Explore new ${alternatives.category} products and compare ingredients before choosing.`
                  : alternatives.category === 'makeup'
                    ? 'Explore new makeup and check the shade before choosing.'
                    : alternatives.category === 'beauty'
                      ? 'Explore new products from beauty retailers.'
                      : 'Explore comparable new products.';
            return (
              <div className="alternatives-popover" key={`${item.id}-alternatives`} style={{ left: item.x + cardWidth + 12, top: item.y + 35 }} onPointerDown={(event) => event.stopPropagation()}>
                <div><span>{alternatives.category.toUpperCase()} ALTERNATIVES</span><button onClick={() => setAlternativeItemId(null)}>×</button></div>
                <p>{otherColors} {guidance}</p>
                {alternatives.links.map((option) => <a href={option.url} target="_blank" rel="noreferrer" key={option.name}>{option.name}<b>Search ↗</b></a>)}
              </div>
            );
          })}

        </div>

        {selectionBox && <div className="selection-box" style={{ left: Math.min(selectionBox.start.x, selectionBox.current.x), top: Math.min(selectionBox.start.y, selectionBox.current.y), width: Math.abs(selectionBox.current.x - selectionBox.start.x), height: Math.abs(selectionBox.current.y - selectionBox.start.y) }} />}

        <div className="legacy-zoom-controls" aria-label="Canvas navigation controls">
          <button onClick={() => zoomBy(0.1)} aria-label="Zoom in">+</button>
          <button onClick={() => zoomBy(-0.1)} aria-label="Zoom out">−</button>
          <button className="fit-canvas" onClick={fitCanvas} aria-label="Fit canvas">Fit</button>
          <button className={`pan-canvas ${navigationMode ? 'is-active' : ''}`} onClick={() => setNavigationMode(!navigationMode)} aria-pressed={navigationMode} aria-label={navigationMode ? 'Finish moving canvas' : 'Grab canvas'}>{navigationMode ? 'Done' : 'Pan'}</button>
        </div>
        {(selectedIds.length > 0 || multiSelectMode) && !inspectorOpen && !itemMenu && !boardMenu && !selectionMenu && <div className="legacy-selection-actions" onPointerDown={(event) => event.stopPropagation()} aria-label="Selected product actions">
          <span className="selection-count">{multiSelectMode ? `Select products · ${selectedIds.length} selected` : `${selectedIds.length} selected`}</span>
          {selectedIds.length > 0 && <>
            {selectedIds.length === 1 && <button onClick={() => { setInspectorTab('details'); setItemDetailsOpenId(selectedIds[0]); setActiveOutfitId(null); setItemMenu(null); }}>Edit</button>}
            {board.outfits.length > 0 && <label className="selection-action-select"><span className="sr-only">Add or move selected products to a board</span><select defaultValue="" onChange={(event) => { if (event.target.value) moveSelectedToBoard(event.target.value); event.target.value = ''; }}><option value="" disabled>Add / Move</option>{board.outfits.map((outfit) => <option key={outfit.id} value={outfit.id}>{outfit.name}</option>)}</select></label>}
            {selectedIds.length === 1 && <button onClick={() => { if(selectedItem)toggleBought(selectedItem); }}>Bought</button>}
          </>}
          <details className="selection-more"><summary>More</summary><div>
            <button onClick={() => setMultiSelectMode(!multiSelectMode)}>{multiSelectMode ? 'Finish selecting' : 'Select multiple'}</button>
            <button onClick={createOutfit}>Create board with {selectedIds.length} selected</button>
            {board.outfits.some(outfit=>outfit.itemIds.some(id=>selectedIds.includes(id))) && <button onClick={()=>removeItemsFromBoards(selectedIds)}>Remove from board</button>}
            <button onClick={duplicateSelected}>Duplicate {selectedIds.length===1?'product':'products'}</button>
            {selectedIds.length===1 && selectedItem?.sourceUrl && <a href={productLink(selectedItem.sourceUrl)} target="_blank" rel="noreferrer">Open product</a>}
            <button className="menu-danger" onClick={deleteMultiple}>{selectedIds.length>1?'Delete products':'Delete product'}</button>
          </div></details>
        </div>}
        {boardSelectionOpen && board.outfits.length > 0 && <div className="board-bulk-actions" role="group" aria-label="Board selection" onPointerDown={(event) => event.stopPropagation()}>
          <div className="board-bulk-heading"><strong>{validSelectedBoardIds.length} {validSelectedBoardIds.length === 1 ? 'board' : 'boards'} selected</strong><button type="button" onClick={() => { setBoardSelectionOpen(false); setSelectedBoardIds([]); setActiveOutfitId(null); }} aria-label="Finish selecting boards">Done</button></div>
          <div className="board-bulk-choices" aria-label="Choose boards">
            {board.outfits.map((outfit) => <button type="button" key={outfit.id} aria-pressed={validSelectedBoardIds.includes(outfit.id)}
              className={validSelectedBoardIds.includes(outfit.id) ? 'is-selected' : ''} onClick={() => selectBoard(outfit.id, true, true)}>{outfit.name}</button>)}
          </div>
          <div className="board-bulk-footer"><button type="button" onClick={selectAllBoards} disabled={validSelectedBoardIds.length === board.outfits.length}>Select all boards</button>
            {boardDeleteLabel && <button type="button" className="board-bulk-delete" onClick={deleteSelectedBoardContainers}>{boardDeleteLabel}</button>}
            {boardDeleteLabel && <button type="button" className="board-bulk-delete" onClick={requestDeleteSelectedBoardsAndContents}>{validSelectedBoardIds.length === board.outfits.length ? 'Delete all boards and contents' : 'Delete selected boards and contents'}</button>}</div>
          {boardDeleteLabel && <small>Deleting boards alone keeps their items. Deleting boards and contents removes their items from this canvas.</small>}
        </div>}
        <button className="canvas-add" onClick={openAddLink} aria-label="Add a product link">+</button>
        <div className="zoom-controls canvas-toolbar" aria-label="Canvas controls" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className="canvas-add" onClick={openAddLink}>Add</button>
          <button type="button" className="canvas-mode-select" aria-pressed={canvasMode === 'select'} onClick={() => canvasMode === 'select' ? clearCanvasSelection() : setCanvasMode('select')}>{canvasMode === 'select' ? 'Done' : 'Select'}</button>
          <button type="button" className="pan-canvas" aria-pressed={canvasMode === 'pan'} onClick={() => setCanvasMode('pan')}>Pan</button>
          <button type="button" className="fit-canvas" onClick={fitCanvas}>Fit</button>
          <button type="button" className="zoom-to-selection" aria-label="Zoom to selection" title="Zoom to selection" disabled={!selectedIds.length && !selectedBoardIds.length && !canvasSelection.sectionIds.length} onClick={zoomToSelection}><span aria-hidden="true">⌖</span></button>
          <details className="canvas-zoom-more" onToggle={(event) => {
            const popup = event.currentTarget.querySelector<HTMLDivElement>(':scope > div[popover]');
            if (!popup) return;
            if (event.currentTarget.open && !popup.matches(':popover-open')) popup.showPopover();
            else if (!event.currentTarget.open && popup.matches(':popover-open')) popup.hidePopover();
          }}><summary aria-label={`Zoom level ${Math.round(viewport.zoom * 100)} percent`}>{Math.round(viewport.zoom * 100)}%</summary><div popover="auto" onToggle={(event) => {
            if (!event.currentTarget.matches(':popover-open')) {
              const details = event.currentTarget.closest('details');
              if (details) details.open = false;
            }
          }}>
            <label className="zoom-preset-label">Zoom level<select aria-label="Set zoom level" value={[0.25, 0.5, 1, 2].find((level) => Math.abs(viewport.zoom - level) < 0.001)?.toString() ?? ''} onChange={(event) => { if (event.target.value) setZoomLevel(Number(event.target.value)); }}>
              <option value="">Custom</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option>
            </select></label>
            <button type="button" onClick={() => zoomBy(0.1)} aria-label="Zoom in">+</button><button type="button" onClick={() => zoomBy(-0.1)} aria-label="Zoom out">−</button>
            <button type="button" onClick={fitCanvas}>Fit</button>
            <small className="zoom-key-hint">+ / − zoom · 0 actual size · 1 Fit</small>
          </div></details>
        </div>
        <span id="canvas-keyboard-help" className="sr-only">Use Enter to select, then Enter again to edit. Space toggles selection. Arrow keys move between unselected objects and nudge a selected object; Shift and an arrow nudges farther. Delete or Backspace removes the selected object. Escape clears selection.</span>
        <span className="sr-only" role="status" aria-live="polite">{canvasSelectionAnnouncement(canvasSelection)}</span>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{canvasActionAnnouncement}</span>
        {(selectedIds.length > 0 || validSelectedBoardIds.length > 0) && !inspectorOpen && !itemMenu && !boardMenu && !selectionMenu && <div className="selection-actions unified-selection-bar" onPointerDown={(event) => event.stopPropagation()} role="toolbar" aria-label="Selection actions">
          <span className="selection-count">{selectionSummary}</span>
          {selectedIds.length === 1 && selectedItem && <button type="button" onClick={() => { setInspectorTab('details'); setItemDetailsOpenId(selectedItem.id); setActiveOutfitId(null); }}>Edit</button>}
          {selectedIds.length > 0 && board.outfits.length > 0 && <label className="selection-action-select"><span className="sr-only">Move selected products to a board</span><select defaultValue="" onChange={(event) => { if (event.target.value) moveSelectedToBoard(event.target.value); event.target.value = ''; }}><option value="" disabled>Move to board</option>{board.outfits.map((outfit) => <option key={outfit.id} value={outfit.id}>{outfit.name}</option>)}</select></label>}
          {selectedIds.length > 0 && <button type="button" onClick={createOutfit}>Make board</button>}
          {(selectedIds.length > 0 || validSelectedBoardIds.length > 0) && <button type="button" className="delete-selection" onClick={requestDeleteCanvasSelection}>Delete</button>}
          <details className="selection-more"><summary>More</summary><div>
            {selectedIds.length > 0 && <button type="button" onClick={duplicateSelected}>Duplicate products</button>}
            {selectedIds.length === 1 && <button type="button" onClick={() => { if (selectedItem) toggleBought(selectedItem); }}>Mark as bought</button>}
            {selectedIds.length === 1 && selectedItem?.sourceUrl && <a href={productLink(selectedItem.sourceUrl)} target="_blank" rel="noreferrer">Open product</a>}
            {selectedBoardForToolbar && <button type="button" onClick={() => { setInspectorTab('details'); setActiveOutfitId(selectedBoardForToolbar.id); }}>Edit board</button>}
            {selectedBoardForToolbar && <button type="button" onClick={() => startOutfitRename(selectedBoardForToolbar)}>Rename board</button>}
            {selectedBoardForToolbar && <button type="button" onClick={() => openBudgetEditor(selectedBoardForToolbar)}>Set budget</button>}
            {selectedBoardForToolbar && <button type="button" onClick={() => dissolveBoard(selectedBoardForToolbar.id)}>Dissolve board, keep products</button>}
          </div></details>
          <button type="button" onClick={clearCanvasSelection}>Done</button>
        </div>}
      </section>
      {activeSection && !inspectorOpen && !itemMenu && !boardMenu && <div className="section-toolbar" aria-label={`${activeSection.title} section actions`}>
        <button type="button" onClick={() => startSectionRename(activeSection)}>Rename</button>
        <button type="button" onClick={() => showSectionStyle(activeSection)}>Style</button>
        {sectionStyleOpenId === activeSection.id && !compactSectionViewport() && <select aria-label="Section style" autoFocus value={activeSection.style} onChange={(event) => { updateSection(activeSection.id, { style: event.target.value as SectionStyle }); setSectionStyleOpenId(null); }} onKeyDown={(event) => { if (event.key === 'Escape') setSectionStyleOpenId(null); }} onBlur={() => setSectionStyleOpenId(null)}>
          <option value="paper">Paper</option><option value="sage">Sage</option><option value="blush">Blush</option><option value="cream">Cream</option><option value="outline">Outline</option>
        </select>}
        <details className="section-more"><summary>More</summary><div>
          <button type="button" onClick={() => { setBoard((current) => removeSection(current, activeSection.id)); setActiveSectionId(null); setSectionMobileEditorId(null); }}>Remove frame</button>
          <button type="button" className="menu-danger" onClick={() => { setBoard((current) => removeSection(current, activeSection.id, true)); setActiveSectionId(null); setSectionMobileEditorId(null); }}>Delete group</button>
        </div></details>
      </div>}
      {activeBoardElement && selectedBoardElement && !boardElementInspectorOpen && !itemMenu && !boardMenu && <div className="element-toolbar" aria-label="Board element actions">
        <button type="button" onClick={()=>{setInspectorTab('details');setBoardElementInspectorOpen(true);}}>Edit</button>
        <details className="board-toolbar-more"><summary>More</summary><div>
          {activeOutfit&&<button type="button" onClick={()=>duplicateBoardElement(activeOutfit,activeBoardElement)}>Duplicate</button>}
          <button type="button" className="menu-danger" onClick={()=>removeBoardElement(selectedBoardElement.outfitId,selectedBoardElement.elementId)}>Delete</button>
        </div></details>
      </div>}
      {activeSection && sectionMobileEditorId === activeSection.id && <aside className="section-mobile-editor" aria-label={`Edit section ${activeSection.title}`}>
        <div><strong>Section</strong><button type="button" onClick={() => setSectionMobileEditorId(null)} aria-label="Close section editor">×</button></div>
        <label>Title<input aria-label="Section title" value={activeSection.title} onChange={(event) => updateSection(activeSection.id, { title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') setSectionMobileEditorId(null); if (event.key === 'Escape') { setSectionMobileEditorId(null); setActiveSectionId(null); } }} /></label>
        <label>Subtitle<input aria-label="Section subtitle" value={activeSection.subtitle ?? ''} placeholder="Optional" onChange={(event) => updateSection(activeSection.id, { subtitle: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') setSectionMobileEditorId(null); if (event.key === 'Escape') { setSectionMobileEditorId(null); setActiveSectionId(null); } }} /></label>
        <label>Style<select value={activeSection.style} onChange={(event) => updateSection(activeSection.id, { style: event.target.value as SectionStyle })}>
          <option value="paper">Paper</option><option value="sage">Sage</option><option value="blush">Blush</option><option value="cream">Cream</option><option value="outline">Outline</option>
        </select></label>
        <div className="section-mobile-actions">
          <button type="button" onClick={() => { setBoard((current) => removeSection(current, activeSection.id)); setActiveSectionId(null); setSectionMobileEditorId(null); }}>Remove frame</button>
          <button type="button" onClick={() => { setBoard((current) => removeSection(current, activeSection.id, true)); setActiveSectionId(null); setSectionMobileEditorId(null); }}>Delete group</button>
        </div>
      </aside>}

      {isClosetOpen && (
        <aside className="closet-drawer">
          <div className="closet-header">
            <div>
              <h2>🛍 My Purchases</h2>
              <p>{boughtItems.length} purchased product{boughtItems.length === 1 ? '' : 's'} · {closetTotal.estimated ? 'Estimated spent' : 'Spent'}: <strong>{closetTotal.value}</strong>{closetTotal.missing > 0 && ` · ${closetTotal.missing} price missing`}</p>
            </div>
            <button onClick={() => setIsClosetOpen(false)}>×</button>
          </div>

          <div className="closet-tabs">
            {closetCategories.map((cat) => (
              <button key={cat} className={closetCategory === cat ? 'is-active' : ''} onClick={() => setClosetCategory(cat)}>
                {cat}
              </button>
            ))}
          </div>

          <div className="closet-grid">
            {closetFilteredItems.map((item) => (
              <div className="closet-card" key={item.id} onClick={() => { setSelectedIds([item.id]); setItemDetailsOpenId(item.id); }}>
                {item.imageUrl ? <img src={displayedImage(item.imageUrl)} alt="" /> : <div className="closet-placeholder">⌁</div>}
                <div className="closet-card-info">
                  <strong>{item.title}</strong>
                  <span>{item.brand}</span>
                  <small>{itemPriceLabel(item, userSettings.preferredCurrency, userSettings.convertItemPrices, exchangeRates)}</small>
                </div>
                <button
                  className="unbought-btn"
                  title="Move back to wishlist"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBought(item);
                  }}
                >
                  Move to board
                </button>
              </div>
            ))}
            {!closetFilteredItems.length && (
              <div className="closet-empty">
                <p>No acquired products in this category yet. Right-click a card to mark it as bought.</p>
              </div>
            )}
          </div>
        </aside>
      )}

      {isSettingsOpen && (
        <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsSettingsOpen(false); }}>
          <div className="add-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
          <form onSubmit={(event) => { event.preventDefault(); setIsSettingsOpen(false); }}>
            <div className="modal-heading">
              <div>
                <span className="eyebrow">PREFERENCES</span>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button type="button" onClick={() => setIsSettingsOpen(false)}>×</button>
            </div>

            <div className="two-col">
              <label>Preferred Currency
                <select value={userSettings.preferredCurrency} onChange={(e) => setUserSettings((s) => ({ ...s, preferredCurrency: e.target.value }))}>
                  {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Measurement System
                <select value={userSettings.measurementSystem} onChange={(e) => setUserSettings((s) => ({ ...s, measurementSystem: e.target.value }))}>
                  <option value="imperial">Imperial (in, lb)</option>
                  <option value="metric">Metric (cm, kg)</option>
                </select>
              </label>
            </div>

            <label className="switch-row"><input type="checkbox" checked={userSettings.convertItemPrices} onChange={(event) => setUserSettings((settings) => ({ ...settings, convertItemPrices: event.target.checked }))} /> Display item prices in my preferred currency</label>
            <p className="modal-note">When enabled, individual product prices are converted for display. When disabled, products keep their original currency while board and canvas totals are shown in your preferred currency.</p>

            <label>Location
              <input autoComplete="address-level2" value={userSettings.location} onChange={(e) => setUserSettings((s) => ({ ...s, location: e.target.value }))} placeholder="e.g. New York, US" />
            </label>

            <button className="sizing-settings-button" type="button" onClick={() => { setIsSettingsOpen(false); setIsSizingOpen(true); }}>Sizing preferences</button>
            <p className="modal-note">Set category-specific clothing and shoe sizes for more relevant availability.</p>

            <label className="switch-row"><input type="checkbox" checked={!userSettings.skipBulkDeleteConfirmation} onChange={(event) => setUserSettings((settings) => ({ ...settings, skipBulkDeleteConfirmation: !event.target.checked }))} /> Confirm before deleting multiple items</label>

            <button className="submit-button" type="submit">Save settings</button>
            <button className="clear-board-button" type="button" onClick={confirmClearBoard ? clearEntireBoard : () => setConfirmClearBoard(true)}>
              {confirmClearBoard ? 'Confirm: delete all items and boards' : 'Clear all items and boards'}
            </button>
          </form>
          </div>
        </div>
      )}

      {isSizingOpen && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeSizingEditor(); }}>
        <div className="add-modal sizing-modal" role="dialog" aria-modal="true" aria-labelledby="sizing-title" onMouseDown={(event) => event.stopPropagation()}>
        <form onSubmit={(event) => { event.preventDefault(); closeSizingEditor(); }}>
          <div className="modal-heading"><div><span className="eyebrow">SIZE PROFILE</span><h2 id="sizing-title">Sizing preferences</h2></div><button type="button" autoFocus aria-label="Close sizing preferences" onClick={closeSizingEditor}>×</button></div>
          <p className="modal-note">Cura uses these only when a retailer provides a confident size-level inventory match. Otherwise, availability stays hidden.</p>
          <div className="size-preference-list">
            {sizingPreferenceRow('generalClothing', 'General clothing', 'clothing', true)}
            {sizingPreferenceRow('tops', 'Tops and activewear', 'clothing')}
            {sizingPreferenceRow('bottoms', 'Bottoms, skirts and trousers', 'bottoms')}
            {sizingPreferenceRow('dresses', 'Dresses and jumpsuits', 'clothing')}
            {sizingPreferenceRow('shoes', 'Shoes', 'shoes')}
          </div>
          <button className="submit-button" type="submit">Save sizing preferences</button>
        </form>
        </div>
      </div>}

      {inspectorOpen && <aside className="inspector" aria-label={activeBoardElement ? 'Board element inspector' : activeOutfit && !selectedItem ? 'Board inspector' : 'Product inspector'}>
        <div className="inspector-heading"><span>{activeBoardElement ? 'Element details' : activeOutfit && !selectedItem ? 'Board details' : 'Product details'}</span><button type="button" onClick={closeInspectorSurface} aria-label="Close inspector">×</button></div>
        <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
          <button id="inspector-tab-details" type="button" role="tab" aria-controls="inspector-panel-details" aria-selected={inspectorTab==='details'} tabIndex={inspectorTab==='details'?0:-1} className={inspectorTab==='details'?'is-active':''} onClick={()=>setInspectorTab('details')} onKeyDown={(event) => handleInspectorTabKeyDown(event, 'details')}>Details</button>
          <button id="inspector-tab-look" type="button" role="tab" aria-controls="inspector-panel-look" aria-selected={inspectorTab==='look'} tabIndex={inspectorTab==='look'?0:-1} className={inspectorTab==='look'?'is-active':''} onClick={()=>setInspectorTab('look')} onKeyDown={(event) => handleInspectorTabKeyDown(event, 'look')}>Look</button>
        </div>
        {selectedItem && itemDetailsOpenId === selectedItem.id && inspectorTab === 'details' && (
          <section id="inspector-panel-details" className="inspector-tabpanel" role="tabpanel" aria-labelledby="inspector-tab-details">
            <details className="inspector-advanced"><summary>Move and size</summary><div className="board-format-section manipulation-alternatives"><div className="nudge-controls">
              <button type="button" onClick={() => updateItem(selectedItem.id, { x: selectedItem.x - 16 })} aria-label="Move product left">←</button>
              <button type="button" onClick={() => updateItem(selectedItem.id, { y: selectedItem.y - 16 })} aria-label="Move product up">↑</button>
              <button type="button" onClick={() => updateItem(selectedItem.id, { y: selectedItem.y + 16 })} aria-label="Move product down">↓</button>
              <button type="button" onClick={() => updateItem(selectedItem.id, { x: selectedItem.x + 16 })} aria-label="Move product right">→</button>
            </div><label>Product size<select value={itemScale(selectedItem)} onChange={(event) => updateItem(selectedItem.id, { scale: Number(event.target.value) })}>{![0.75, 1, 1.25, 1.5, 2].includes(itemScale(selectedItem)) && <option value={itemScale(selectedItem)}>Custom size</option>}<option value={0.75}>Small</option><option value={1}>Regular</option><option value={1.25}>Large</option><option value={1.5}>Extra large</option><option value={2}>Maximum</option></select></label>
            {board.outfits.some((outfit) => outfit.itemIds.includes(selectedItem.id)) && <button type="button" className="relayout-button" onClick={() => removeFromCurrentBoard(selectedItem.id)}>Remove from board</button>}</div></details>
            <label>Title<input value={selectedItem.title} onChange={(event) => updateItem(selectedItem.id, { title: event.target.value, titleManual: true, fieldSources: { ...selectedItem.fieldSources, title: 'user_edit' } })} /></label>
            <label>Brand<input value={selectedItem.brand} onChange={(event) => updateItem(selectedItem.id, { brand: event.target.value, brandManual: true })} onBlur={(event) => updateItem(selectedItem.id, { brand: normalizeBrandDisplay(event.target.value), brandManual: true })} placeholder="Optional" /></label>
            <div className="two-col">
              <label>Price
                <input type="number" min="0" step="any" inputMode="decimal" value={selectedItem.price ?? ''} onChange={(event) => {
                  const value = event.target.value;
                  const price = value === '' ? null : Number(value);
                  if (price !== null && (!Number.isFinite(price) || price < 0)) return;
                  const updatedAt = new Date().toISOString();
                  updateItem(selectedItem.id, { price, priceManual: price !== null, priceStale: false, currencyAssumed: false, priceEstimated: false, estimateLow: undefined, estimateHigh: undefined, priceReference: price === null ? undefined : 'Manually entered price', priceInfo: price === null ? undefined : { ...(selectedItem.priceInfo ?? {}), amount: price, currency: selectedItem.currency, source: 'user', updatedAt, verifiedAt: updatedAt, currencyAssumed: false, variantVerified: true }, resolutionStatus: price !== null && selectedItem.title && selectedItem.currency ? 'RESOLVED' : selectedItem.title || selectedItem.imageUrl ? 'PARTIAL' : 'UNRESOLVED', fieldSources: { ...selectedItem.fieldSources, ...(price === null ? {} : { price: 'user_edit', currency: 'user_edit' }) } });
                }} placeholder="Enter product price" />
              </label>
              <label>Currency
                <select value={selectedItem.currency} onChange={(event) => updateItem(selectedItem.id, { currency: event.target.value, currencyAssumed: false, priceManual: selectedItem.price !== null, fieldSources: { ...selectedItem.fieldSources, currency: 'user_edit' } })}>
                  {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <small>Changes save automatically. A manually entered price shows exactly and updates your totals. Clear it to allow store updates again.</small>
            <label className="upload-action">Listing image
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const imageUrl = await fileToDataUrl(file);
                  updateItem(selectedItem.id, { imageUrl, imageIsGuess: false, imageOptions: [imageUrl, ...(selectedItem.imageOptions ?? []).filter((url) => url !== imageUrl)], isUserImage: true, fieldSources: { ...selectedItem.fieldSources, imageUrl: 'user_edit' } });
                } finally {
                  event.target.value = '';
                }
              }} />
              <span>{selectedItem.imageUrl ? 'Upload a replacement image' : 'Upload your own image'}</span>
            </label>
            <div className="two-col">
              <label>Colour{selectedItem.colorOptions.length > 0 ? <select value={selectedItem.color} onChange={(event) => updateItem(selectedItem.id, { color: event.target.value, colorManual: true })}>{selectedItem.colorOptions.map((color) => <option key={color} value={color}>{color}</option>)}</select> : <input value={selectedItem.color} onChange={(event) => updateItem(selectedItem.id, { color: event.target.value, colorManual: true })} placeholder="Optional" />}</label>
              <label>Size{selectedItem.sizeOptions.length > 0 ? <select value={selectedItem.size} onChange={(event) => updateItem(selectedItem.id, { size: event.target.value, sizeManual: true })}>{selectedItem.sizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select> : <input value={selectedItem.size} onChange={(event) => updateItem(selectedItem.id, { size: event.target.value, sizeManual: true })} placeholder="Optional" />}</label>
            </div>
            {selectedItem.size && <small className="size-hint">{convertSize(selectedItem.size, 'US')}</small>}
            <label>Product link<input type="url" inputMode="url" autoComplete="url" aria-invalid={Boolean(editProductUrlError)} aria-describedby={editProductUrlError ? 'edit-product-url-error' : 'edit-product-url-hint'} value={selectedItem.sourceUrl} onChange={(event) => { setEditProductUrlError(''); updateItem(selectedItem.id, { sourceUrl: event.target.value }); }} onBlur={(event) => setEditProductUrlError(event.target.value.trim() && !normaliseProductUrl(event.target.value) ? 'Enter a valid http or https product page URL.' : '')} placeholder="https://..." />{editProductUrlError ? <span id="edit-product-url-error" className="field-error" role="alert">{editProductUrlError}</span> : <small id="edit-product-url-hint" className="form-hint">Use the retailer product page address.</small>}</label>
            <label>Notes<textarea value={selectedItem.notes} onChange={(event) => updateItem(selectedItem.id, { notes: event.target.value })} placeholder="Fit, fabric, what you’d wear it with…" /></label>
            <label className="switch-row"><input type="checkbox" checked={selectedItem.unsure} onChange={(event) => updateItem(selectedItem.id, { unsure: event.target.checked })} /> Still unsure</label>
            <label className="switch-row"><input type="checkbox" checked={Boolean(selectedItem.locked)} onChange={(event) => updateItem(selectedItem.id, { locked: event.target.checked })} /> Lock position</label>
            <label className="switch-row"><input type="checkbox" checked={Boolean(selectedItem.bought)} onChange={() => toggleBought(selectedItem)} /> Bought (Purchased)</label>
          </section>
        )}

        {selectedItem && itemDetailsOpenId === selectedItem.id && inspectorTab === 'look' && <section id="inspector-panel-look" className="inspector-look inspector-tabpanel" role="tabpanel" aria-labelledby="inspector-tab-look">
          <h3>Style</h3>
          <div className="format-options">{itemStyles.map(style=><button key={style.id} className={selectedItemPresentation?.preset===style.id?'is-active':''} onClick={()=>updateItemPresentation(selectedItem,{preset:style.id})}>{style.name}</button>)}</div>
          <label>Image shape<select value={selectedItemPresentation?.shape??'none'} onChange={event=>updateItemPresentation(selectedItem,{shape:event.target.value as ItemPresentation['shape']})}>{imageShapes.map(shape=><option key={shape.id} value={shape.id}>{shape.name}</option>)}</select></label>
          <label>Text alignment<select value={selectedItemPresentation?.textAlign??'center'} onChange={event=>updateItemPresentation(selectedItem,{textAlign:event.target.value==='left'?'left':'center'})}><option value="left">Left</option><option value="center">Centre</option></select></label>
          <label>Text size<select value={selectedItemPresentation?.titleSize??'regular'} onChange={event=>{const size=event.target.value==='large'?'large':'regular';updateItemPresentation(selectedItem,{titleSize:size,priceSize:size});}}><option value="regular">Regular</option><option value="large">Large</option></select></label>
          <details className="inspector-advanced"><summary>Advanced</summary><div>
            <label>Font colour<input type="color" value={selectedItemPresentation?.textColor||'#2f2925'} onChange={event=>updateItemPresentation(selectedItem,{textColor:event.target.value})}/></label>
            <button type="button" onClick={()=>updateItemPresentation(selectedItem,{textColor:''})}>Use style default</button>
            <label>Image fit<select value={selectedItemPresentation?.imageFit??'contain'} onChange={event=>updateItemPresentation(selectedItem,{imageFit:event.target.value==='cover'?'cover':'contain'})}><option value="contain">Natural fit</option><option value="cover">Fill frame</option></select></label>
            <label>Label placement<select value={selectedItemPresentation?.labelPlacement??'below'} onChange={event=>updateItemPresentation(selectedItem,{labelPlacement:event.target.value==='overlay'?'overlay':'below'})}><option value="below">Below image</option><option value="overlay">On image</option></select></label>
            <label><input type="checkbox" checked={Boolean(selectedItemPresentation?.showBrand)} onChange={event=>updateItemPresentation(selectedItem,{showBrand:event.target.checked})}/> Show brand</label>
            <label><input type="checkbox" checked={Boolean(selectedItemPresentation?.showAvailability)} onChange={event=>updateItemPresentation(selectedItem,{showAvailability:event.target.checked})}/> Show availability</label>
            <label>Routine phase<select value={selectedItemPresentation?.routinePhase??'none'} onChange={event=>updateItemPresentation(selectedItem,{routinePhase:event.target.value==='AM'?'AM':event.target.value==='PM'?'PM':'none'})}><option value="none">None</option><option value="AM">AM</option><option value="PM">PM</option></select></label>
          </div></details>
          {selectedItem.imageOptions&&selectedItem.imageOptions.length>1&&<details className="inspector-advanced"><summary>Image options</summary><div><button className="match-button" onClick={()=>setImagePicker({itemId:selectedItem.id,imageUrls:selectedItem.imageOptions??[],status:'ready',message:'Choose the product image you want on your board.'})}>Choose image</button></div></details>}
          {selectedItem.sourceUrl&&<details className="inspector-advanced"><summary>Advanced product actions</summary><div><button className="match-button" onClick={()=>void hydrateItemFromUrl(selectedItem.id,selectedItem.sourceUrl)}>Refresh product details</button><button className="match-button" onClick={()=>setAlternativeItemId(selectedItem.id)}>Find alternatives</button></div></details>}
        </section>}

        {activeBoardElement && selectedBoardElement && activeOutfit && inspectorTab === 'details' && (
          <section id="inspector-panel-details" className="inspector-tabpanel" role="tabpanel" aria-labelledby="inspector-tab-details">
            {activeBoardElement.type === 'text' && <>
              <label>Text<textarea value={activeBoardElement.content ?? ''} maxLength={180} onChange={(event) => updateBoardElement(activeOutfit.id, activeBoardElement.id, { content: event.target.value })} /></label>
            </>}
            <details className="inspector-advanced"><summary>Advanced</summary><div>
            <div className="two-col"><label>Width<input type="number" min="44" value={Math.round(activeBoardElement.width)} onChange={(event) => updateBoardElement(activeOutfit.id, activeBoardElement.id, { width: Math.max(44, Number(event.target.value) || 44) })} /></label><label>Height<input type="number" min="34" value={Math.round(activeBoardElement.height)} onChange={(event) => updateBoardElement(activeOutfit.id, activeBoardElement.id, { height: Math.max(34, Number(event.target.value) || 34) })} /></label></div>
            <label>Rotation<input type="range" min="-180" max="180" value={activeBoardElement.rotation ?? 0} onChange={(event) => updateBoardElement(activeOutfit.id, activeBoardElement.id, { rotation: Number(event.target.value) })} /></label>
            <div className="element-actions">
              <button onClick={() => updateBoardElement(activeOutfit.id, activeBoardElement.id, { zIndex: Math.min(20, (activeBoardElement.zIndex ?? 1) + 1) })}>Move forward</button>
              <button onClick={() => updateBoardElement(activeOutfit.id, activeBoardElement.id, { zIndex: Math.max(0, (activeBoardElement.zIndex ?? 1) - 1) })}>Move backward</button>
              <button onClick={() => updateBoardElement(activeOutfit.id, activeBoardElement.id, { zIndex: 20 })}>Bring to front</button>
              <button onClick={() => updateBoardElement(activeOutfit.id, activeBoardElement.id, { zIndex: 0 })}>Send to back</button>
            </div>
            </div></details>
          </section>
        )}

        {activeBoardElement && selectedBoardElement && activeOutfit && inspectorTab === 'look' && <section id="inspector-panel-look" className="inspector-look inspector-tabpanel" role="tabpanel" aria-labelledby="inspector-tab-look">
          <h3>Look</h3>
          {activeBoardElement.type==='text'&&<>
            <label>Font style<select value={activeBoardElement.textPreset??'clean'} onChange={event=>updateBoardElement(activeOutfit.id,activeBoardElement.id,{textPreset:event.target.value as BoardElement['textPreset']})}><option value="clean">Clean</option><option value="soft">Soft</option><option value="bold">Bold</option><option value="technical">Technical</option><option value="elegant">Elegant</option></select></label>
            <label>Text size<select value={activeBoardElement.textSize??'medium'} onChange={event=>updateBoardElement(activeOutfit.id,activeBoardElement.id,{textSize:event.target.value as BoardElement['textSize']})}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
            <label>Alignment<select value={activeBoardElement.textAlign??'left'} onChange={event=>updateBoardElement(activeOutfit.id,activeBoardElement.id,{textAlign:event.target.value as BoardElement['textAlign']})}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
          </>}
          {activeBoardElement.type!=='image'&&<label>Colour<input type="color" value={activeBoardElement.color??'#51473f'} onChange={event=>updateBoardElement(activeOutfit.id,activeBoardElement.id,{color:event.target.value})}/></label>}
        </section>}

        {activeOutfit && !selectedItem && !activeBoardElement && inspectorTab === 'details' && (
          <section id="inspector-panel-details" className="inspector-tabpanel" role="tabpanel" aria-labelledby="inspector-tab-details">
            <div className="board-format-section manipulation-alternatives"><strong>Move board and products</strong><div className="nudge-controls">
              <button type="button" onClick={() => nudgeBoard(activeOutfit.id, -16, 0)} aria-label="Move board left">←</button>
              <button type="button" onClick={() => nudgeBoard(activeOutfit.id, 0, -16)} aria-label="Move board up">↑</button>
              <button type="button" onClick={() => nudgeBoard(activeOutfit.id, 0, 16)} aria-label="Move board down">↓</button>
              <button type="button" onClick={() => nudgeBoard(activeOutfit.id, 16, 0)} aria-label="Move board right">→</button>
            </div></div>
            <label>Board title<input value={activeOutfit.name} onChange={(event) => updateOutfit(activeOutfit.id, { name: event.target.value })} /></label>
            <div className="board-format-section"><strong>Add board elements</strong><small>These stay independent and editable.</small>
              <div className="element-actions"><button onClick={() => addTextElement(activeOutfit)}>Add text</button><label className="upload-action">Decorative image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; addDecorativeImage(activeOutfit, await fileToDataUrl(file)); event.target.value = ''; }} /><span>Upload decoration</span></label></div>
            </div>
            <div className="board-format-section"><strong>Re-layout products</strong><small>Moves products only when you click Re-layout.</small>
              <select aria-label="Board layout" value={layoutChoice} onChange={(event) => setLayoutChoice(event.target.value as LayoutPreset)}>{layoutPresets.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select>
              <button className="relayout-button" onClick={() => relayoutBoard(activeOutfit, layoutChoice)}>Re-layout</button>
            </div>
            {activeOutfit.presentation?.layoutPreset === 'routine-steps' && activeOutfit.itemIds.length > 0 && <div className="board-format-section routine-order"><strong>Your routine steps</strong>{activeOutfit.itemIds.map((id, index) => {
              const item = board.items.find((candidate) => candidate.id === id);
              if (!item) return null;
              return <div key={id}><span>{index + 1}. {item.title}</span><button disabled={index === 0} onClick={() => moveRoutineStep(activeOutfit, id, -1)} aria-label={`Move ${item.title} up`}>↑</button><button disabled={index === activeOutfit.itemIds.length - 1} onClick={() => moveRoutineStep(activeOutfit, id, 1)} aria-label={`Move ${item.title} down`}>↓</button></div>;
            })}</div>}
            <button className="set-budget-inspector" onClick={() => openBudgetEditor(activeOutfit)}>{activeOutfit.budget === null ? 'Set budget' : 'Change budget'}</button>
            {activeOutfit.budget !== null && <button className="remove-budget" onClick={() => { updateOutfit(activeOutfit.id, { budget: null, budgetCurrency: undefined }); setBudgetEditorId(null); }}>Remove budget</button>}
            <p className="hint">Holds {activeOutfit.itemIds.length} pieces.</p>
          </section>
        )}

        {activeOutfit && !selectedItem && !activeBoardElement && inspectorTab === 'look' && <section id="inspector-panel-look" className="inspector-look inspector-tabpanel" role="tabpanel" aria-labelledby="inspector-tab-look">
          <h3>Board look</h3>
          <label>Theme<select value={activeOutfit.presentation?.templateId ?? 'default'} onChange={event=>restyleBoard(activeOutfit,event.target.value as BoardTemplateId)}>{boardTemplates.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <label>Background<select value={activeOutfit.presentation?.backgroundPreset ?? 'paper'} onChange={event=>updateOutfit(activeOutfit.id,{presentation:{...activeOutfit.presentation,backgroundPreset:event.target.value as BoardPresentation['backgroundPreset'],customBackgroundColor:undefined}})}><option value="paper">Paper</option><option value="white">White</option><option value="blush">Pale pink</option><option value="cream">Cream</option><option value="grey">Soft grey</option><option value="charcoal">Charcoal</option><option value="sage">Muted green</option><option value="blue">Pale blue</option><option value="lavender">Lavender</option><option value="yellow">Soft yellow</option></select></label>
          <label>Pattern<select value={activeOutfit.presentation?.patternPreset ?? 'none'} onChange={event=>updateOutfit(activeOutfit.id,{presentation:{...activeOutfit.presentation,patternPreset:event.target.value as BoardPresentation['patternPreset']}})}><option value="none">None</option><option value="dots">Tiny dots</option><option value="grid">Fine grid</option><option value="stripes">Thin stripes</option><option value="checks">Subtle checks</option><option value="sparkles">Tiny sparkles</option><option value="paper">Paper texture</option></select></label>
          <details className="inspector-advanced"><summary>Advanced</summary><div>
            <div className="two-col"><label>Title font<select value={activeOutfit.styleOverrides?.titleFont ?? ''} onChange={event=>updateBoardStyleOverride(activeOutfit,'titleFont',event.target.value?event.target.value as BoardStyleOverrides['titleFont']:undefined)}><option value="">Theme default</option><option value="sans">Clean sans</option><option value="soft">Soft sans</option><option value="serif">Elegant serif</option><option value="mono">Technical mono</option></select></label><label>Title size<select value={activeOutfit.styleOverrides?.titleSize ?? ''} onChange={event=>updateBoardStyleOverride(activeOutfit,'titleSize',event.target.value?event.target.value as BoardStyleOverrides['titleSize']:undefined)}><option value="">Theme default</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label></div>
            <label>Title alignment<select value={activeOutfit.styleOverrides?.titleAlign ?? ''} onChange={event=>updateBoardStyleOverride(activeOutfit,'titleAlign',event.target.value?event.target.value as BoardStyleOverrides['titleAlign']:undefined)}><option value="">Theme default</option><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
            <div className="board-color-row"><label>Title colour<input type="color" value={activeOutfit.styleOverrides?.titleColor ?? '#342d29'} onChange={event=>updateBoardStyleOverride(activeOutfit,'titleColor',event.target.value)}/></label><button onClick={()=>updateBoardStyleOverride(activeOutfit,'titleColor',undefined)}>Use theme</button></div>
            <div className="board-color-row"><label>Border colour<input type="color" value={activeOutfit.styleOverrides?.borderColor ?? activeOutfit.color ?? boardPalette[0]} onChange={event=>updateBoardStyleOverride(activeOutfit,'borderColor',event.target.value)}/></label><button onClick={()=>updateBoardStyleOverride(activeOutfit,'borderColor',undefined)}>Use theme</button></div>
            <div className="two-col"><label>Border<select value={activeOutfit.styleOverrides?.borderStyle ?? ''} onChange={event=>updateBoardStyleOverride(activeOutfit,'borderStyle',event.target.value?event.target.value as BoardStyleOverrides['borderStyle']:undefined)}><option value="">Theme default</option><option value="none">None</option><option value="solid">Solid</option><option value="dashed">Dashed</option></select></label><label>Corners<select value={activeOutfit.styleOverrides?.corners ?? ''} onChange={event=>updateBoardStyleOverride(activeOutfit,'corners',event.target.value?event.target.value as BoardStyleOverrides['corners']:undefined)}><option value="">Theme default</option><option value="square">Square</option><option value="soft">Soft</option><option value="rounded">Rounded</option></select></label></div>
            <label>Default product style<select value={activeOutfit.presentation?.defaultItemPresentation?.preset ?? 'compact'} onChange={event=>updateOutfit(activeOutfit.id,{presentation:{...activeOutfit.presentation,defaultItemPresentation:{...activeOutfit.presentation?.defaultItemPresentation,preset:event.target.value as ItemPresentation['preset']}}})}>{itemStyles.map(style=><option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
            <label>Default image shape<select value={activeOutfit.presentation?.defaultItemPresentation?.shape ?? 'none'} onChange={event=>updateOutfit(activeOutfit.id,{presentation:{...activeOutfit.presentation,defaultItemPresentation:{...activeOutfit.presentation?.defaultItemPresentation,shape:event.target.value as ItemPresentation['shape']}}})}>{imageShapes.map(shape=><option key={shape.id} value={shape.id}>{shape.name}</option>)}</select></label>
            <label className="upload-action">Board background image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;const backgroundImage=await fileToDataUrl(file);updateOutfit(activeOutfit.id,{presentation:{...activeOutfit.presentation,backgroundImage}});event.target.value='';}}/><span>{activeOutfit.presentation?.backgroundImage?'Replace background image':'Upload background image'}</span></label>
            {activeOutfit.presentation?.backgroundImage&&<button type="button" onClick={()=>updateOutfit(activeOutfit.id,{presentation:{...activeOutfit.presentation,backgroundImage:undefined}})}>Remove background image</button>}
          </div></details>
        </section>}

        {selectedIds.length > 0 && (
          <button className="make-look" onClick={createOutfit}>✦ Make a board with {selectedIds.length} pieces</button>
        )}
      </aside>}

      {isAdding && (
        <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsAdding(false); }}>
          <div className="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-product-title" onMouseDown={(event) => event.stopPropagation()}>
          <form noValidate onSubmit={(event) => { event.preventDefault(); addItem(); }}>
            <div className="modal-heading"><div><span className="eyebrow">ADD A PRODUCT</span><h2 id="add-product-title">Paste a product link.</h2></div><button type="button" aria-label="Close add product" onClick={() => setIsAdding(false)}>×</button></div>
            <label className="primary-link-field">Product link<input autoFocus required type="url" inputMode="url" autoComplete="url" aria-invalid={Boolean(addUrlError)} aria-describedby={addUrlError ? 'add-url-error' : 'add-url-hint'} value={draft.sourceUrl} onChange={(event) => { setAddUrlError(''); setDraft((current) => ({ ...current, sourceUrl: event.target.value })); }} placeholder="https://www.zara.com/…" />{addUrlError ? <span id="add-url-error" className="field-error" role="alert">{addUrlError}</span> : <span id="add-url-hint" className="form-hint">Paste or type the full retailer product page link.</span>}</label>
            {'clipboard' in navigator && typeof navigator.clipboard?.readText === 'function' && <button className="clipboard-paste-button" type="button" onClick={() => void pasteLinkFromClipboard()}>Paste link</button>}
            <p className="modal-note">We’ll read product details automatically. You can also edit details manually below.</p>
            <button className="submit-button" type="submit">Add to board</button>
            <button className="manual-toggle" type="button" onClick={() => setIsManual((current) => !current)}>{isManual ? 'Hide manual details' : 'Add details manually instead'}</button>
            {isManual && <div className="manual-fields">
              <div className="two-col"><label>Name<input autoComplete="off" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Linen trousers" /></label><label>Brand<input autoComplete="organization" value={draft.brand} onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))} placeholder="Zara" /></label></div>
              <div className="two-col"><label>Price<input type="number" min="0" step="any" inputMode="decimal" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="89" /></label><label>Currency<select aria-label="Currency" value={draft.currency} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))}>{currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select></label></div>
              <div className="two-col"><label>Colour<input value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} placeholder="Navy" /></label><label>Size<input value={draft.size} onChange={(event) => setDraft((current) => ({ ...current, size: event.target.value }))} placeholder="M" /></label></div>
            </div>}
          </form>
          </div>
        </div>
      )}
      {replacingPlaceholderId && (() => {
        const placeholderItem = board.items.find((item) => item.id === replacingPlaceholderId && item.placeholder);
        if (!placeholderItem) return null;
        return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setReplacingPlaceholderId(null); }}>
          <div className="add-modal placeholder-replace-modal" role="dialog" aria-modal="true" aria-label={`Replace ${placeholderItem.placeholder?.label}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span className="eyebrow">FILL THIS SPOT</span><h2>{placeholderItem.placeholder?.label}</h2></div><button type="button" onClick={() => setReplacingPlaceholderId(null)} aria-label="Close placeholder">×</button></div>
            <form onSubmit={(event) => { event.preventDefault(); replacePlaceholderWithUrl(); }}>
              <label className="primary-link-field">Paste product link<input autoFocus value={placeholderDraft.url} onChange={(event) => setPlaceholderDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://retailer.com/product" /></label>
              <button className="submit-button" type="submit" disabled={!normaliseProductUrl(placeholderDraft.url)}>Use product link</button>
            </form>
            <div className="placeholder-manual-fields">
              <strong>Or add manually</strong>
              <label>Product name<input value={placeholderDraft.title} onChange={(event) => setPlaceholderDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Product name" /></label>
              <label>Brand<input value={placeholderDraft.brand} onChange={(event) => setPlaceholderDraft((current) => ({ ...current, brand: event.target.value }))} placeholder="Optional" /></label>
              <label>Price<input inputMode="decimal" value={placeholderDraft.price} onChange={(event) => setPlaceholderDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Optional" /></label>
              <label className="upload-action">Product image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { const imageUrl = await fileToDataUrl(file); setPlaceholderDraft((current) => ({ ...current, imageUrl })); } }} /><span>{placeholderDraft.imageUrl ? 'Image ready' : 'Upload image'}</span></label>
              <button className="submit-button" type="button" disabled={!placeholderDraft.title.trim()} onClick={replacePlaceholderManually}>Add manually</button>
            </div>
          </div>
        </div>;
      })()}
      {processingLabel && <div className="processing-toast" role="status" aria-live="polite">✦ {processingLabel}</div>}
      {quickAdd && <form className="quick-add" style={floatingPosition(quickAdd.x, quickAdd.y, 310, 60)} onSubmit={(event) => { event.preventDefault(); addLink(quickAddUrl, quickAdd.position); setQuickAdd(null); }}>
        <input autoFocus value={quickAddUrl} onChange={(event) => setQuickAddUrl(event.target.value)} placeholder="Paste product link" onBlur={() => { if (!quickAddUrl) setQuickAdd(null); }} />
        <button type="submit">Add link</button>
      </form>}
      {itemMenu && (() => {
        const item = board.items.find((candidate) => candidate.id === itemMenu.id);
        if (!item) return null;
        if (item.placeholder) return <div className="item-menu" role="group" aria-label="Empty product actions" style={floatingPosition(itemMenu.x, itemMenu.y, 240, 200)}>
          <span>{item.placeholder.label}</span>
          <button onClick={() => openPlaceholder(item)}>Replace item</button>
          <button className="delete-selection" onClick={() => { removeItem(item.id); setItemMenu(null); }}>Delete placeholder</button>
        </div>;
        const currentBoard = board.outfits.find((outfit) => outfit.itemIds.includes(item.id));
        const isInBoard = Boolean(currentBoard);
        const scale = itemScale(item);
        const availableBoards = board.outfits.filter((outfit) => !outfit.itemIds.includes(item.id));
        return <div className="item-menu" role="group" aria-label="Product actions" style={floatingPosition(itemMenu.x, itemMenu.y, 240, 420)}>
          <span>{item.title}</span>
          <button onClick={() => { setSelectedIds([item.id]); setInspectorTab('details'); setItemDetailsOpenId(item.id); setItemMenu(null); }}>Edit details</button>
          <button onClick={() => duplicateItem(item)}>Duplicate</button>
          {isInBoard ? <button onClick={() => removeFromCurrentBoard(item.id)}>Remove from board</button> : availableBoards.length > 0 && <label className="board-select"><select aria-label="Add to board" defaultValue="" onChange={(event) => { if (event.target.value) { addToBoard(item.id, event.target.value); setItemMenu(null); } }}><option value="" disabled>Add to board</option>{availableBoards.map((outfit) => <option key={outfit.id} value={outfit.id}>{outfit.name}</option>)}</select></label>}
          {productLink(item.sourceUrl) && <a href={productLink(item.sourceUrl)} target="_blank" rel="noreferrer">Open product</a>}
          <button onClick={() => { toggleBought(item); setItemMenu(null); }}>{item.bought ? 'Move to wishlist' : 'Mark as bought'}</button>
          <button onClick={() => { updateItem(item.id, { locked: !item.locked }); setItemMenu(null); }}>{item.locked ? 'Unlock' : 'Lock'}</button>
          <details className="menu-advanced"><summary>More</summary><div>
            {item.imageUrl && <button onClick={() => { void navigator.clipboard.writeText(item.imageUrl); setItemMenu(null); }}>Copy image address</button>}
            {item.sourceUrl && <button onClick={() => { void navigator.clipboard.writeText(item.sourceUrl); setItemMenu(null); }}>Copy raw product link</button>}
          </div></details>
          <button className="menu-danger" onClick={() => { selectedIds.length > 1 ? deleteMultiple() : removeItem(item.id); setItemMenu(null); }}>Delete</button>
        </div>;
      })()}
      {boardMenu && (() => {
        const outfit = board.outfits.find((candidate) => candidate.id === boardMenu.id);
        if (!outfit) return null;
        return <div className="board-menu" role="group" aria-label="Board actions" style={floatingPosition(boardMenu.x, boardMenu.y, 250, 190)}>
          <span>{outfit.name}</span>
          <button onClick={() => { startOutfitRename(outfit); setBoardMenu(null); }}>Rename</button>
          <button onClick={() => { openBudgetEditor(outfit); setBoardMenu(null); }}>{outfit.budget === null ? 'Set budget' : 'Set budget'}</button>
          <button onClick={() => { dissolveBoard(outfit.id); setBoardMenu(null); }}>Dissolve board, keep products</button>
          <button className="menu-danger" onClick={() => { deleteBoardAndContents(outfit.id); setBoardMenu(null); }}>Delete board and products</button>
        </div>;
      })()}
      {selectionMenu && <div className="selection-menu" role="group" aria-label="Selected product actions" style={floatingPosition(selectionMenu.x, selectionMenu.y, 220, 280)}><span>{selectedIds.length} {selectedIds.length === 1 ? 'item' : 'items'} selected</span><button onClick={createBoardFromSelection}>Make board</button>{board.outfits.length > 0 && <label className="board-select"><select defaultValue="" onChange={(event) => { if (event.target.value) moveSelectedToBoard(event.target.value); }}><option value="" disabled>Move to board…</option>{board.outfits.map((outfit) => <option key={outfit.id} value={outfit.id}>{outfit.name}</option>)}</select></label>}<button onClick={duplicateSelected}>Duplicate {selectedIds.length === 1 ? 'item' : 'selected'}</button><button className="delete-selection" onClick={deleteMultiple}>{selectedIds.length > 1 ? 'Delete all items' : 'Delete this item'}</button></div>}
      {budgetEditorId && (() => {
        const outfit = board.outfits.find((candidate) => candidate.id === budgetEditorId);
        if (!outfit) return null;
        return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setBudgetEditorId(null); }}>
          <div className="add-modal budget-modal" role="dialog" aria-modal="true" aria-labelledby="budget-title" onMouseDown={(event) => event.stopPropagation()}>
          <form noValidate onSubmit={(event) => {
            event.preventDefault();
            const amount = Number.parseFloat(budgetDraft);
            if (!Number.isFinite(amount) || amount <= 0) { setBudgetError('Enter a budget greater than zero.'); return; }
            setBudgetError('');
            updateOutfit(outfit.id, { budget: amount, budgetCurrency: budgetCurrencyDraft });
            setBudgetEditorId(null);
          }}>
            <div className="modal-heading"><div><span className="eyebrow">BOARD BUDGET</span><h2 id="budget-title">{outfit.budget === null ? 'Set a budget' : 'Change budget'}</h2></div><button type="button" onClick={() => setBudgetEditorId(null)} aria-label="Close budget">×</button></div>
            <p className="modal-note">Set the planned spending limit for “{outfit.name}”. This remains separate from its total and spent amounts.</p>
            <div className="two-col"><label>Budget amount<input autoFocus required min="0.01" step="0.01" inputMode="decimal" type="number" aria-invalid={Boolean(budgetError)} aria-describedby={budgetError ? 'budget-error' : 'budget-hint'} value={budgetDraft} onChange={(event) => { setBudgetError(''); setBudgetDraft(event.target.value); }} placeholder="250" />{budgetError ? <span id="budget-error" className="field-error" role="alert">{budgetError}</span> : <span id="budget-hint" className="form-hint">Enter an amount greater than zero.</span>}</label><label>Budget currency<select autoComplete="off" value={budgetCurrencyDraft} onChange={(event) => setBudgetCurrencyDraft(event.target.value)}>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label></div>
            <button className="submit-button" type="submit">Save budget</button>
            {outfit.budget !== null && <button className="manual-toggle" type="button" onClick={() => { updateOutfit(outfit.id, { budget: null, budgetCurrency: undefined }); setBudgetEditorId(null); }}>Remove budget</button>}
          </form>
          </div>
        </div>;
      })()}
      {deletionRequest && <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setDeletionRequest(null); }}>
        <section className="add-modal delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-heading"><div><span className="eyebrow">CONFIRM DELETION</span><h2 id="delete-confirmation-title">{deletionRequest.boardIds ? 'Delete selected boards?' : deletionRequest.outfitId ? 'Delete board and items?' : 'Delete all selected items?'}</h2></div><button onClick={() => setDeletionRequest(null)} aria-label="Cancel deletion">×</button></div>
          <p>{deletionRequest.boardIds ? `Choose what to do with ${deletionRequest.boardIds.length} selected ${deletionRequest.boardIds.length === 1 ? 'board' : 'boards'}.${deletionRequest.itemIds.length ? ` ${deletionRequest.itemIds.length} separately selected ${deletionRequest.itemIds.length === 1 ? 'product' : 'products'} will also be removed.` : ''}` : deletionRequest.outfitId ? `This will remove the board and its ${deletionRequest.itemIds.length} items from this canvas.` : 'This will remove the selected items from this canvas.'}</p>
          {!deletionRequest.boardIds && <label className="switch-row"><input type="checkbox" checked={neverAskBulkDelete} onChange={(event) => setNeverAskBulkDelete(event.target.checked)} /> Never ask again</label>}
          {deletionRequest.boardIds
            ? <div className="delete-confirmation-actions board-delete-choices"><button onClick={() => setDeletionRequest(null)}>Cancel</button><button onClick={() => deleteBoardsKeepProducts(deletionRequest)}>Delete board(s), keep products</button><button className="confirm-delete" onClick={() => deleteBoardsAndSelectedProducts(deletionRequest)}>Delete board(s) and products</button></div>
            : <div className="delete-confirmation-actions"><button onClick={() => setDeletionRequest(null)}>Cancel</button><button className="confirm-delete" onClick={() => {
              if (neverAskBulkDelete) setUserSettings((settings) => ({ ...settings, skipBulkDeleteConfirmation: true }));
              if (deletionRequest.outfitId) performDeletion(deletionRequest.itemIds, deletionRequest.outfitId);
              else performDeletion(deletionRequest.itemIds);
            }}>{deletionRequest.outfitId ? 'Delete board and items' : 'Delete all'}</button></div>}
        </section>
      </div>}
      {imagePicker && <div className="modal-backdrop match-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setImagePicker(null); }}>
        <section className="match-picker" role="dialog" aria-modal="true" aria-label="Product image picker" tabIndex={-1}>
          <div className="modal-heading"><div><span className="eyebrow">PRODUCT GALLERY</span><h2>Choose the image.</h2></div><button onClick={() => setImagePicker(null)}>×</button></div>
          <p className="modal-note">{imagePicker.message}</p>
          {imagePicker.status === 'loading' && <div className="match-loading"><span>✦</span> Preparing selected sticker.</div>}
          {imagePicker.status !== 'loading' && <div className="image-choice-grid">{imagePicker.imageUrls.map((imageUrl, index) => <button className="image-choice" onClick={() => { updateItem(imagePicker.itemId, { imageUrl, isUserImage: true }); setImagePicker(null); }} key={imageUrl}><img src={`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`} alt={`Product ${index + 1}`} /><span>Use image {index + 1}</span></button>)}</div>}
        </section>
      </div>}
      {imageIntentPicker && <div className="modal-backdrop match-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setImageIntentPicker(null); }}>
        <section className="match-picker image-intent-picker" role="dialog" aria-modal="true" aria-label="Choose clothing items to find" tabIndex={-1}>
          <div className="modal-heading"><div><span className="eyebrow">IMAGE SEARCH</span><h2>Which pieces should Cura find?</h2></div><button onClick={() => setImageIntentPicker(null)}>×</button></div>
          <img className="intent-preview" src={board.items.find((item) => item.id === imageIntentPicker.itemId)?.imageUrl} alt="Image you pasted" />
          <p className="modal-note">Select every item you want. Cura will zoom into each selected area and show its closest visual matches one at a time.</p>
          <div className="part-choice-grid">
            {clothingPartOptions.map((part) => <label key={part}><input type="checkbox" checked={imageIntentPicker.pieces.includes(part)} onChange={() => setImageIntentPicker((current) => current ? { ...current, pieces: current.pieces.includes(part) ? current.pieces.filter((piece) => piece !== part) : [...current.pieces, part] } : null)} />{part}</label>)}
          </div>
          <button className="submit-button image-search-submit" disabled={!imageIntentPicker.pieces.length} onClick={beginImageSearch}>Find {imageIntentPicker.pieces.length || ''} selected {imageIntentPicker.pieces.length === 1 ? 'piece' : 'pieces'}</button>
        </section>
      </div>}
      {pieceSearchReview && <div className="modal-backdrop match-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setPieceSearchReview(null); }}>
        <section className="match-picker" role="dialog" aria-modal="true" aria-label="Piece-by-piece product review" tabIndex={-1}>
          <div className="modal-heading"><div><span className="eyebrow">ITEM {pieceSearchReview.index + 1} OF {pieceSearchReview.pieces.length}{pieceSearchReview.matchKind === 'original' ? ' · POSSIBLE ORIGINALS' : pieceSearchReview.matchKind === 'alternatives' ? ' · SHOPPING ALTERNATIVES' : ''}</span><h2>{pieceSearchReview.adjustingCrop ? `Frame the ${pieceSearchReview.pieces[pieceSearchReview.index]}.` : pieceSearchReview.matchKind === 'original' ? `Is one of these the original ${pieceSearchReview.pieces[pieceSearchReview.index]}?` : pieceSearchReview.matchKind === 'alternatives' ? 'Original not found. Choose an alternative.' : `Finding this ${pieceSearchReview.pieces[pieceSearchReview.index]}…`}</h2></div><button onClick={() => setPieceSearchReview(null)}>×</button></div>
          {pieceSearchReview.adjustingCrop ? <div className="crop-editor">
            <p>Drag a tight box around only the {pieceSearchReview.pieces[pieceSearchReview.index].toLowerCase()}, like the selection box in Google Lens.</p>
            <div className="crop-editor-stage">
              <img src={pieceSearchReview.sourceImageUrl} alt="Original pasted image" />
              <div className="crop-draw-layer" onPointerDown={startCropDraw} onPointerMove={moveCropDraw} onPointerUp={endCropDraw} onPointerCancel={endCropDraw}>
                {pieceSearchReview.crop && <span className="crop-selection" style={{ left: `${pieceSearchReview.crop.x * 100}%`, top: `${pieceSearchReview.crop.y * 100}%`, width: `${pieceSearchReview.crop.width * 100}%`, height: `${pieceSearchReview.crop.height * 100}%` }} />}
              </div>
            </div>
            <button className="submit-button" onClick={searchAdjustedCrop}>Search this exact area</button>
          </div> : <>
            <p className="modal-note">{pieceSearchReview.message}</p>
            {pieceSearchReview.searchImageUrl && <div className="piece-search-crop"><span>Searching this area</span><img src={pieceSearchReview.searchImageUrl} alt={`Zoomed ${pieceSearchReview.pieces[pieceSearchReview.index]} search area`} /></div>}
            {pieceSearchReview.status === 'loading' && <div className="match-loading"><span>✦</span> Google Lens is checking options for this item.</div>}
            {pieceSearchReview.status === 'ready' && <div className="match-grid">{pieceSearchReview.matches.map((match) => <button key={match.link} className="match-option" onClick={() => choosePieceMatch(match)}>{match.thumbnail && <img src={match.thumbnail} alt="" />}<span><strong>{match.title}</strong><small>{match.source}</small><small className={`match-price ${match.priceStatus === 'checking' ? 'is-checking' : ''}`}>{visualMatchPrice(match, userSettings.preferredCurrency)}</small></span></button>)}</div>}
            {pieceSearchReview.status !== 'loading' && <div className="piece-review-fallback"><button onClick={openCropAdjustment}>Adjust search area</button><button onClick={() => choosePieceMatch(null)}>No match — add this {pieceSearchReview.pieces[pieceSearchReview.index]} anyway</button></div>}
          </>}
        </section>
      </div>}
      {matchPicker && <div className="modal-backdrop match-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setMatchPicker(null); }}>
        <section className="match-picker" role="dialog" aria-modal="true" aria-label="Visual product matches" tabIndex={-1}>
          <div className="modal-heading"><div><span className="eyebrow">VISUAL MATCHES</span><h2>{matchPicker.status === 'loading' ? 'Finding the piece…' : 'Which one is it?'}</h2></div><button onClick={() => setMatchPicker(null)}>×</button></div>
          <p className="modal-note">{matchPicker.message}</p>
          {matchPicker.status === 'loading' && <div className="match-loading"><span>✦</span> Google Lens is checking similar products.</div>}
          {matchPicker.status === 'ready' && <div className="match-grid">{matchPicker.matches.map((match) => <button key={match.link} className="match-option" onClick={() => chooseVisualMatch(matchPicker.itemId, match)}>{match.thumbnail && <img src={match.thumbnail} alt="" />}<span><strong>{match.title}</strong><small>{[match.source, priceBand(Number.parseFloat(match.price.replace(/[^0-9.]/g, '')) || null, userSettings.preferredCurrency, userSettings.preferredCurrency)].filter(Boolean).join(' · ')}</small></span></button>)}</div>}
          {matchPicker.status === 'error' && <div className="match-error"><p>{matchPicker.message}</p><button onClick={() => setMatchPicker(null)}>Keep this sticker</button></div>}
        </section>
      </div>}
    </main>
  );
};
