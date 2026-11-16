export type ItemStyle = 'clean' | 'minimal' | 'soft' | 'compact' | 'bold' | 'modern' | 'playful' | 'elegant' | 'technical' | 'sticker' | 'polaroid' | 'editorial';
export type ImageShape = 'none' | 'square' | 'rounded' | 'circle' | 'oval' | 'pill' | 'arch' | 'tag';
export type ImageFit = 'contain' | 'cover';
export type LabelPlacement = 'below' | 'overlay';
export type ItemPresentation = {
  preset?: ItemStyle;
  shape?: ImageShape;
  imageFit?: ImageFit;
  labelPlacement?: LabelPlacement;
  textAlign?: 'left' | 'center';
  showBrand?: boolean;
  showSource?: boolean;
  showAvailability?: boolean;
  titleSize?: 'regular' | 'large';
  priceSize?: 'regular' | 'large';
  textColor?: string;
  routinePhase?: 'none' | 'AM' | 'PM';
};
export type BoardTemplateId = 'default' | 'beauty' | 'skincare' | 'clothing' | 'mixed' | 'wishlist' | 'collage' | 'moodboard' | 'reveal' | 'capsule';
export type LayoutPreset = 'freeform' | 'grid' | 'category-rows' | 'routine-steps' | 'editorial' | 'capsule' | 'masonry' | 'collage';
export type PatternPreset = 'none' | 'dots' | 'grid' | 'stripes' | 'checks' | 'sparkles' | 'paper';
export type BoardPresentation = {
  templateId?: BoardTemplateId;
  layoutPreset?: LayoutPreset;
  defaultItemPresentation?: ItemPresentation;
  backgroundPreset?: 'paper' | 'white' | 'blush' | 'cream' | 'grey' | 'charcoal' | 'sage' | 'blue' | 'lavender' | 'yellow';
  customBackgroundColor?: string;
  patternPreset?: PatternPreset;
  backgroundImage?: string;
  backgroundImageFit?: 'cover' | 'contain';
  backgroundImagePosition?: 'center' | 'top' | 'bottom';
  headingPreset?: 'sans' | 'soft' | 'technical' | 'elegant' | 'serif';
};

export type BoardStyleOverrides = {
  titleFont?: 'sans' | 'serif' | 'mono' | 'soft';
  titleColor?: string;
  titleSize?: 'small' | 'medium' | 'large';
  titleWeight?: 'regular' | 'medium' | 'semibold' | 'bold';
  titleStyle?: 'normal' | 'italic';
  titleAlign?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  borderColor?: string;
  borderStyle?: 'none' | 'solid' | 'dashed';
  borderWidth?: 'thin' | 'regular';
  corners?: 'square' | 'soft' | 'rounded';
};

export const resolveBoardStyle = (presentation?: BoardPresentation, overrides: BoardStyleOverrides = {}) => ({
  titleFont: overrides.titleFont ?? (presentation?.headingPreset === 'technical' ? 'mono' : ['elegant', 'serif'].includes(presentation?.headingPreset ?? '') ? 'serif' : presentation?.headingPreset === 'soft' ? 'soft' : 'sans'),
  titleColor: overrides.titleColor,
  titleSize: overrides.titleSize ?? 'medium',
  titleWeight: overrides.titleWeight ?? 'semibold',
  titleStyle: overrides.titleStyle ?? 'normal',
  titleAlign: overrides.titleAlign ?? 'left',
  backgroundColor: overrides.backgroundColor,
  borderColor: overrides.borderColor,
  borderStyle: overrides.borderStyle ?? 'solid',
  borderWidth: overrides.borderWidth ?? 'thin',
  corners: overrides.corners ?? 'rounded',
});

export const itemStyles: { id: ItemStyle; name: string }[] = [
  { id: 'clean', name: 'Clean' }, { id: 'minimal', name: 'Minimal' },
  { id: 'soft', name: 'Soft' }, { id: 'compact', name: 'Compact' },
  { id: 'bold', name: 'Bold' }, { id: 'modern', name: 'Modern' },
  { id: 'playful', name: 'Playful' }, { id: 'elegant', name: 'Elegant' },
  { id: 'technical', name: 'Technical' }, { id: 'sticker', name: 'Sticker' },
  { id: 'polaroid', name: 'Photo label' },
];
export const imageShapes: { id: ImageShape; name: string }[] = [
  { id: 'none', name: 'None' }, { id: 'square', name: 'Square' },
  { id: 'rounded', name: 'Rounded' }, { id: 'circle', name: 'Circle' },
  { id: 'oval', name: 'Oval' }, { id: 'pill', name: 'Pill' },
  { id: 'arch', name: 'Arch' }, { id: 'tag', name: 'Tag' },
];
export const layoutPresets: { id: LayoutPreset; name: string }[] = [
  { id: 'freeform', name: 'Freeform' }, { id: 'grid', name: 'Grid' },
  { id: 'category-rows', name: 'Category rows' }, { id: 'routine-steps', name: 'Routine steps' },
  { id: 'editorial', name: 'Fashion spread' }, { id: 'capsule', name: 'Capsule' },
  { id: 'masonry', name: 'Masonry' }, { id: 'collage', name: 'Collage' },
];
export const boardTemplates: { id: BoardTemplateId; name: string; description: string; width?: number; height?: number; presentation: BoardPresentation }[] = [
  { id: 'default', name: 'Clean Grid', description: 'A light, highly legible product collection.', width: 780, height: 620, presentation: { templateId: 'default', layoutPreset: 'grid', backgroundPreset: 'paper', patternPreset: 'none', headingPreset: 'sans', defaultItemPresentation: { preset: 'clean' } } },
  { id: 'clothing', name: 'Fashion Board', description: 'Tall garment photography, open spacing and contemporary labels.', width: 760, height: 760, presentation: { templateId: 'clothing', layoutPreset: 'editorial', backgroundPreset: 'grey', patternPreset: 'none', headingPreset: 'elegant', defaultItemPresentation: { preset: 'modern' } } },
  { id: 'beauty', name: 'Beauty Board', description: 'A polished product-haul composition with soft grouping.', width: 820, height: 650, presentation: { templateId: 'beauty', layoutPreset: 'category-rows', backgroundPreset: 'blush', patternPreset: 'sparkles', headingPreset: 'soft', defaultItemPresentation: { preset: 'soft', shape: 'rounded' } } },
  { id: 'skincare', name: 'Skincare Board', description: 'Restrained routine steps with clinical clarity.', width: 780, height: 650, presentation: { templateId: 'skincare', layoutPreset: 'routine-steps', backgroundPreset: 'white', patternPreset: 'grid', headingPreset: 'technical', defaultItemPresentation: { preset: 'technical', shape: 'rounded' } } },
  { id: 'mixed', name: 'Mixed Haul', description: 'A forgiving masonry layout for products with different proportions.', width: 820, height: 700, presentation: { templateId: 'mixed', layoutPreset: 'masonry', backgroundPreset: 'sage', patternPreset: 'none', headingPreset: 'sans', defaultItemPresentation: { preset: 'minimal' } } },
  { id: 'wishlist', name: 'Wishlist', description: 'Compact, friendly and quick to scan.', width: 720, height: 560, presentation: { templateId: 'wishlist', layoutPreset: 'grid', backgroundPreset: 'lavender', patternPreset: 'dots', headingPreset: 'soft', defaultItemPresentation: { preset: 'compact' } } },
  { id: 'collage', name: 'Collage Board', description: 'A flexible composition with varied image sizes.', width: 820, height: 720, presentation: { templateId: 'collage', layoutPreset: 'collage', backgroundPreset: 'cream', patternPreset: 'paper', headingPreset: 'sans', defaultItemPresentation: { preset: 'playful', labelPlacement: 'overlay' } } },
  { id: 'moodboard', name: 'Moodboard', description: 'Image-led, spacious and designed for decorations.', width: 850, height: 760, presentation: { templateId: 'moodboard', layoutPreset: 'collage', backgroundPreset: 'yellow', patternPreset: 'none', headingPreset: 'elegant', defaultItemPresentation: { preset: 'minimal', labelPlacement: 'overlay', showBrand: false } } },
  { id: 'reveal', name: 'Hover Reveal', description: 'Product imagery first; details appear on hover, focus or tap.', width: 800, height: 650, presentation: { templateId: 'reveal', layoutPreset: 'masonry', backgroundPreset: 'charcoal', patternPreset: 'none', headingPreset: 'sans', defaultItemPresentation: { preset: 'modern', labelPlacement: 'overlay', showBrand: true, showAvailability: true } } },
  { id: 'capsule', name: 'Capsule Wardrobe', description: 'Category groups arranged like a coordinated wardrobe.', width: 780, height: 720, presentation: { templateId: 'capsule', layoutPreset: 'capsule', backgroundPreset: 'cream', patternPreset: 'none', headingPreset: 'elegant', defaultItemPresentation: { preset: 'elegant' } } },
];

export const resolveItemPresentation = (board?: BoardPresentation, item?: ItemPresentation): Required<ItemPresentation> => ({
  preset: (item?.preset ?? board?.defaultItemPresentation?.preset) === 'editorial' ? 'modern' : item?.preset ?? board?.defaultItemPresentation?.preset ?? 'compact',
  shape: item?.shape ?? board?.defaultItemPresentation?.shape ?? 'none',
  imageFit: item?.imageFit ?? board?.defaultItemPresentation?.imageFit ?? 'contain',
  labelPlacement: item?.labelPlacement ?? board?.defaultItemPresentation?.labelPlacement ?? 'below',
  textAlign: item?.textAlign ?? board?.defaultItemPresentation?.textAlign ?? 'center',
  showBrand: item?.showBrand ?? board?.defaultItemPresentation?.showBrand ?? false,
  showSource: item?.showSource ?? board?.defaultItemPresentation?.showSource ?? false,
  showAvailability: item?.showAvailability ?? board?.defaultItemPresentation?.showAvailability ?? true,
  titleSize: item?.titleSize ?? board?.defaultItemPresentation?.titleSize ?? 'regular',
  priceSize: item?.priceSize ?? board?.defaultItemPresentation?.priceSize ?? 'regular',
  textColor: item?.textColor ?? board?.defaultItemPresentation?.textColor ?? '',
  routinePhase: item?.routinePhase ?? 'none',
});

export const productCategory = (title: string): string => {
  const value = title.toLowerCase();
  if (/shampoo|conditioner|hair|scalp/.test(value)) return 'Hair';
  if (/serum|cleanser|moistur|sunscreen|toner|skin|retinol/.test(value)) return 'Skincare';
  if (/perfume|fragrance|parfum|cologne|eau de/.test(value)) return 'Fragrance';
  if (/lip|mascara|foundation|blush|concealer|bronzer|makeup|primer/.test(value)) return 'Makeup';
  if (/dress|gown|jumpsuit/.test(value)) return 'Dresses';
  if (/skirt|pant|jean|short|trouser/.test(value)) return 'Bottoms';
  if (/shirt|blouse|top|cardigan|sweater|coat|jacket/.test(value)) return 'Tops & layers';
  if (/shoe|boot|heel|sneaker|sandal/.test(value)) return 'Shoes';
  if (/bag|purse|tote|jewel|necklace|earring/.test(value)) return 'Accessories';
  return 'Other finds';
};

export const closetCategories = [
  'All', 'Skincare', 'Makeup', 'Haircare', 'Fragrance', 'Body Care', 'Nails', 'Beauty Tools', 'Other Beauty',
];

export const closetCategoryFor = (description: string): string => {
  const value = description.toLowerCase();
  if (/\b(perfume|fragrance|cologne|parfum|eau de|body mist|scent)\b/.test(value)) return 'Fragrance';
  if (/\b(hair|shampoo|conditioner|scalp|leave.in|rinse.off)\b/.test(value)) return 'Haircare';
  if (/\b(skincare|skin care|serum|cleanser|moisturi[sz]er|sunscreen|retinol|toner|face cream|exfoliant|spf)\b/.test(value)) return 'Skincare';
  if (/\b(makeup|cosmetic|lipstick|lip gloss|lip oil|foundation|concealer|blush|mascara|eyeshadow|eyeliner|bronzer|primer|powder|highlighter)\b/.test(value)) return 'Makeup';
  if (/\b(body care|body wash|body lotion|body cream|deodorant|bath|hand cream)\b/.test(value)) return 'Body Care';
  if (/\b(nail|polish|manicure|pedicure|cuticle)\b/.test(value)) return 'Nails';
  if (/\b(beauty tool|brush|sponge|applicator|curler|dryer|straightener|styler|mirror)\b/.test(value)) return 'Beauty Tools';
  return 'Other Beauty';
};
