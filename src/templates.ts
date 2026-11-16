import type { BoardElement, Item, Outfit } from './App';
import type { BoardPresentation, BoardStyleOverrides } from './presentation';
import type { CanvasSection, SectionStyle } from './sections';

export type TemplatePlaceholder = {
  id: string; kind: 'placeholder'; x: number; y: number; width: number; imageHeight: number;
  label: string; helperText?: string; category?: string; treatment?: 'product' | 'hero' | 'compact';
};
export type TemplateText = {
  id: string; kind: 'text'; x: number; y: number; width: number; height: number; content: string;
  textPreset?: BoardElement['textPreset']; textSize?: BoardElement['textSize']; textAlign?: BoardElement['textAlign']; color?: string;
};
export type TemplateBoard = {
  id: string; x: number; y: number; width: number; height: number; title: string;
  presentation: BoardPresentation; styleOverrides?: BoardStyleOverrides; budget?: { amount: number; currency: string };
  children: (TemplatePlaceholder | TemplateText)[];
};
export type TemplateCategory = 'Fashion' | 'Beauty' | 'Home' | 'Travel' | 'Planning' | 'Layouts';
export type CanvasTemplate = {
  id: string; name: string; description: string; category: TemplateCategory; tags: string[];
  preview: { accent: string }; bounds: { width: number; height: number }; boards: TemplateBoard[];
  sections?: TemplateSection[];
};
export type TemplateSection = Pick<CanvasSection, 'id' | 'title' | 'subtitle' | 'x' | 'y' | 'width' | 'height' | 'style' | 'boardIds' | 'padding'> & {
  children?: TemplatePlaceholder[];
};

export const templateCategories: TemplateCategory[] = ['Fashion', 'Beauty', 'Home', 'Travel', 'Planning', 'Layouts'];

const p = (id: string, label: string, x: number, y: number, width = 180, imageHeight = 165, helperText = ''): TemplatePlaceholder =>
  ({ id, kind: 'placeholder', label, x, y, width, imageHeight, helperText });
const note = (id: string, content: string, x: number, y: number, width: number, height = 36,
  textPreset: TemplateText['textPreset'] = 'clean', textSize: TemplateText['textSize'] = 'medium'): TemplateText =>
  ({ id, kind: 'text', content, x, y, width, height, textPreset, textSize });
const slots = (labels: string[], columns = 2, x = 38, y = 140, width = 180, imageHeight = 165, gapX = 22, gapY = 275) =>
  labels.map((label, index) => p(`slot-${index + 1}`, label, x + (index % columns) * (width + gapX), y + Math.floor(index / columns) * gapY, width, imageHeight));

const looks = {
  fashion: { templateId: 'capsule', layoutPreset: 'freeform', backgroundPreset: 'cream', patternPreset: 'none', headingPreset: 'elegant', defaultItemPresentation: { preset: 'elegant' } },
  editorial: { templateId: 'clothing', layoutPreset: 'freeform', backgroundPreset: 'grey', patternPreset: 'none', headingPreset: 'elegant', defaultItemPresentation: { preset: 'modern' } },
  blush: { templateId: 'beauty', layoutPreset: 'freeform', backgroundPreset: 'blush', patternPreset: 'none', headingPreset: 'soft', defaultItemPresentation: { preset: 'soft' } },
  clinical: { templateId: 'skincare', layoutPreset: 'freeform', backgroundPreset: 'white', patternPreset: 'grid', headingPreset: 'technical', defaultItemPresentation: { preset: 'technical' } },
  night: { templateId: 'skincare', layoutPreset: 'freeform', backgroundPreset: 'lavender', patternPreset: 'none', headingPreset: 'technical', defaultItemPresentation: { preset: 'technical' } },
  sage: { templateId: 'mixed', layoutPreset: 'freeform', backgroundPreset: 'sage', patternPreset: 'none', headingPreset: 'sans', defaultItemPresentation: { preset: 'minimal' } },
  lavender: { templateId: 'wishlist', layoutPreset: 'freeform', backgroundPreset: 'lavender', patternPreset: 'dots', headingPreset: 'soft', defaultItemPresentation: { preset: 'compact' } },
  paper: { templateId: 'default', layoutPreset: 'freeform', backgroundPreset: 'paper', patternPreset: 'none', headingPreset: 'sans', defaultItemPresentation: { preset: 'clean' } },
  collage: { templateId: 'collage', layoutPreset: 'freeform', backgroundPreset: 'cream', patternPreset: 'paper', headingPreset: 'elegant', defaultItemPresentation: { preset: 'playful' } },
  yellow: { templateId: 'moodboard', layoutPreset: 'freeform', backgroundPreset: 'yellow', patternPreset: 'none', headingPreset: 'elegant', defaultItemPresentation: { preset: 'minimal' } },
  gallery: { templateId: 'moodboard', layoutPreset: 'freeform', backgroundPreset: 'white', patternPreset: 'none', headingPreset: 'elegant', defaultItemPresentation: { preset: 'minimal', labelPlacement: 'overlay', showBrand: false, showAvailability: false } },
} satisfies Record<string, BoardPresentation>;
type Look = keyof typeof looks;
const b = (id: string, title: string, x: number, y: number, width: number, height: number, look: Look,
  children: TemplateBoard['children']): TemplateBoard => ({ id, title, x, y, width, height, presentation: looks[look], children });
type SectionPlan = { id: string; title: string; subtitle?: string; style: SectionStyle; boardIds: string[] };
const sectionPlans: Record<string, { groups: SectionPlan[]; positions?: Record<string, { x: number; y: number }> }> = {
  'capsule-wardrobe': { groups: [{ id: 'wardrobe', title: 'Your Wardrobe', subtitle: 'Build a collection that works together.', style: 'cream', boardIds: ['tops', 'bottoms', 'layers', 'shoes', 'accessories'] }] },
  'hair-routine': { groups: [{ id: 'routine', title: 'Hair Routine', subtitle: 'An editable sequence. Keep the steps that suit you.', style: 'blush', boardIds: ['pre-wash', 'cleanse', 'condition', 'post-wash', 'finish'] }] },
  'vacation-packing': { groups: [
    { id: 'clothing', title: 'Clothing', subtitle: 'Looks for each part of the trip.', style: 'cream', boardIds: ['day', 'night', 'activity'] },
    { id: 'care', title: 'Beauty + Care', style: 'sage', boardIds: ['toiletries'] },
    { id: 'essentials', title: 'Travel Essentials', style: 'paper', boardIds: ['airport', 'accessories'] },
  ], positions: { day: { x: 0, y: 0 }, night: { x: 540, y: 0 }, activity: { x: 1080, y: 0 }, toiletries: { x: 0, y: 850 }, airport: { x: 590, y: 850 }, accessories: { x: 1130, y: 850 } } },
  'new-apartment': { groups: [
    { id: 'living', title: 'Living Spaces', style: 'cream', boardIds: ['room-0', 'room-3'] },
    { id: 'daily', title: 'Daily Essentials', style: 'sage', boardIds: ['room-1', 'room-2'] },
    { id: 'first-week', title: 'First-Week Setup', style: 'paper', boardIds: ['room-4', 'room-5'] },
  ], positions: { 'room-0': { x: 0, y: 0 }, 'room-3': { x: 770, y: 0 }, 'room-1': { x: 0, y: 620 }, 'room-2': { x: 770, y: 620 }, 'room-4': { x: 0, y: 1240 }, 'room-5': { x: 770, y: 1240 } } },
};
const tpl = (id: string, name: string, category: TemplateCategory, description: string, accent: string,
  width: number, height: number, sourceBoards: TemplateBoard[], tags: string[] = []): CanvasTemplate => {
  const plan = sectionPlans[id];
  if (!plan) return { id, name, category, description, tags, preview: { accent }, bounds: { width, height }, boards: sourceBoards };
  const boards = sourceBoards.map((board) => ({ ...board, x: (plan.positions?.[board.id]?.x ?? board.x) + 40, y: (plan.positions?.[board.id]?.y ?? board.y) + 100 }));
  const sections: TemplateSection[] = plan.groups.map((group) => {
    const members = boards.filter((board) => group.boardIds.includes(board.id));
    const left = Math.min(...members.map((board) => board.x));
    const top = Math.min(...members.map((board) => board.y));
    const right = Math.max(...members.map((board) => board.x + board.width));
    const bottom = Math.max(...members.map((board) => board.y + board.height));
    return { ...group, x: left - 34, y: top - 84, width: right - left + 68, height: bottom - top + 118, padding: 34 };
  });
  return { id, name, category, description, tags, preview: { accent },
    bounds: { width: Math.max(width + 80, ...sections.map((section) => section.x + section.width + 20)),
      height: Math.max(height + 130, ...sections.map((section) => section.y + section.height + 20)) }, boards, sections };
};

export const starterTemplates: CanvasTemplate[] = [
  tpl('capsule-wardrobe', 'Capsule Wardrobe', 'Fashion', 'A balanced wardrobe across five editable groups.', '#9b907b', 1590, 1480, [
    b('tops', 'Tops', 0, 0, 510, 720, 'fashion', slots(['Tee', 'Tank', 'Blouse', 'Knit'], 2, 46, 148, 180, 170)),
    b('bottoms', 'Bottoms', 540, 0, 510, 720, 'paper', slots(['Jeans', 'Trouser', 'Skirt'], 2, 46, 148, 180, 170)),
    b('layers', 'Layers', 1080, 0, 510, 720, 'editorial', slots(['Jacket', 'Coat'], 2, 46, 148, 180, 215)),
    b('shoes', 'Shoes', 265, 760, 510, 650, 'paper', slots(['Everyday shoe', 'Dressy shoe'], 2, 46, 148, 180, 220)),
    b('accessories', 'Accessories', 805, 760, 510, 650, 'fashion', slots(['Bag', 'Belt / jewelry'], 2, 46, 148, 180, 220)),
  ], ['capsule', 'wardrobe']),

  tpl('hair-routine', 'Hair Routine', 'Beauty', 'An adaptable sequence from pre-wash to between-wash care.', '#c39c8f', 1480, 1600, [
    b('pre-wash', '01 / PRE-WASH', 0, 0, 470, 760, 'blush', [note('optional', 'Choose the steps that suit your hair.', 36, 92, 392), ...slots(['Bond / treatment', 'Pre-shampoo oil'], 2, 36, 160, 184, 170)]),
    b('cleanse', '02 / CLEANSE', 505, 0, 470, 760, 'clinical', slots(['Clarifying shampoo', 'Regular shampoo', 'Optional scalp / medicated cleanser'], 2, 36, 160, 184, 170)),
    b('condition', '03 / CONDITION / TREAT', 1010, 0, 470, 760, 'blush', slots(['Conditioner', 'Mask / gloss', 'Treatment'], 2, 36, 160, 184, 170)),
    b('post-wash', '04 / POST-WASH', 245, 805, 470, 760, 'clinical', slots(['Leave-in', 'Heat protectant', 'Styling product'], 2, 36, 160, 184, 170)),
    b('finish', '05 / FINISH / MAINTAIN', 750, 805, 470, 760, 'blush', slots(['Serum', 'Cream', 'Oil', 'Between-wash product'], 2, 36, 160, 184, 170)),
  ], ['hair', 'routine']),

  tpl('am-pm-skincare', 'AM / PM Skincare', 'Beauty', 'Parallel morning and evening routines, with optional treatments.', '#9aaca6', 1240, 1260, [
    b('am', 'AM / MORNING', 0, 0, 590, 760, 'clinical', [note('am-note', 'Start the day', 42, 100, 480, 34, 'technical'), ...slots(['01 / Cleanser', '02 / Moisturizer', '03 / Sunscreen'], 2, 42, 168, 220, 180, 26, 292)]),
    b('pm', 'PM / EVENING', 625, 0, 590, 760, 'night', [note('pm-note', 'Wind down', 42, 100, 480, 34, 'technical'), ...slots(['01 / Cleanser', '02 / Treatment', '03 / Moisturizer'], 2, 42, 168, 220, 180, 26, 292)]),
    b('occasional', 'OCCASIONAL TREATMENTS', 200, 815, 840, 390, 'sage', [note('optional', 'Use only when it fits your routine.', 40, 96, 700), ...slots(['Add occasional treatment', 'Add another treatment'], 2, 40, 150, 230, 140, 42)]),
  ], ['skincare', 'routine']),

  tpl('outfit-builder', 'Outfit Builder', 'Fashion', 'Build one look vertically, then add the details around it.', '#a7938c', 1150, 1160, [
    b('look', 'THE OUTFIT', 0, 0, 1150, 1120, 'editorial', [
      note('look-note', 'One look / many possibilities', 66, 100, 1010, 42, 'elegant', 'large'),
      p('outerwear', 'Outerwear', 425, 170, 300, 120), p('top', 'Top', 425, 390, 300, 120),
      p('bottom', 'Bottom', 425, 610, 300, 120), p('shoes', 'Shoes', 425, 830, 300, 120),
      p('bag', 'Bag', 85, 360, 210, 195), p('jewelry', 'Jewelry / accessories', 855, 310, 210, 195),
      p('alternate', 'Alternate option', 855, 650, 210, 195),
    ]),
  ], ['outfit', 'vertical']),

  tpl('vacation-packing', 'Vacation Packing', 'Travel', 'Plan what to wear and bring by moment of the trip.', '#8baba8', 1580, 1320, [
    b('airport', 'AIRPORT', 0, 0, 500, 700, 'sage', [note('trip', 'Destination / dates / notes', 38, 92, 420), ...slots(['Travel outfit', 'Carry-on', 'Comfort item'], 2, 38, 150, 192, 150)]),
    b('day', 'DAY', 540, 0, 500, 540, 'paper', slots(['Day outfit', 'Walking shoe'], 2, 38, 145, 192, 185)),
    b('night', 'NIGHT', 1080, 0, 500, 540, 'editorial', slots(['Dinner look', 'Evening shoe'], 2, 38, 145, 192, 185)),
    b('activity', 'BEACH / ACTIVITY', 0, 745, 500, 540, 'yellow', slots(['Activity outfit', 'Swim / gear'], 2, 38, 145, 192, 185)),
    b('toiletries', 'TOILETRIES', 540, 745, 500, 540, 'clinical', slots(['Skincare', 'Haircare'], 2, 38, 145, 192, 185)),
    b('accessories', 'ACCESSORIES', 1080, 745, 500, 540, 'fashion', slots(['Bag', 'Sunglasses / extras'], 2, 38, 145, 192, 185)),
  ], ['packing', 'trip']),

  tpl('dream-room', 'Dream Room', 'Home', 'An image-first room collage with varied furniture scale.', '#a49a83', 1260, 1110, [
    b('room', 'A ROOM TO COME HOME TO', 0, 0, 1240, 1080, 'collage', [
      note('room-note', 'Furniture / texture / light', 50, 102, 1110, 46, 'elegant', 'large'),
      p('sofa', 'Sofa / main furniture', 55, 185, 390, 365), p('rug', 'Rug', 510, 195, 300, 235),
      p('table', 'Table', 875, 195, 285, 225), p('lighting', 'Lighting', 500, 560, 210, 210),
      p('art', 'Art', 755, 535, 190, 220), p('textiles', 'Textiles', 970, 540, 190, 220),
      p('decor', 'Decor', 80, 690, 275, 165),
    ]),
  ], ['room', 'furniture', 'collage']),

  tpl('beauty-restock', 'Beauty Restock', 'Beauty', 'Sort what to replenish, repeat, try, or skip.', '#bd9a9b', 1240, 1120, [
    b('low', 'RUNNING LOW', 0, 0, 580, 520, 'blush', slots(['Add running-low item', 'Add another item'], 2, 40, 150, 222, 175, 26)),
    b('repurchase', 'REPURCHASE', 620, 0, 580, 520, 'clinical', slots(['Add reliable favorite', 'Add another favorite'], 2, 40, 150, 222, 175, 26)),
    b('try', 'TRY NEXT', 0, 565, 580, 520, 'lavender', slots(['Add a new option', 'Add another option'], 2, 40, 150, 222, 175, 26)),
    b('skip', 'NOT AGAIN', 620, 565, 580, 520, 'paper', slots(['Add one to skip', 'Add another to skip'], 2, 40, 150, 222, 175, 26)),
  ], ['restock', 'decisions']),

  tpl('compare-before-buying', 'Compare Before Buying', 'Planning', 'Compare three candidates with editable notes, pros, and cons.', '#8799a2', 1190, 850, [
    ...['A', 'B', 'C'].map((letter, index) => b(`candidate-${letter.toLowerCase()}`, `CANDIDATE ${letter}`, index * 400, 0, 365, 810, index === 1 ? 'clinical' : 'paper', [
      p('product', 'Add product', 60, 135, 245, 240),
      note('notes', 'Notes / what matters', 36, 515, 290, 36, 'clean'),
      note('pros', 'Pros /', 36, 580, 290, 36, 'clean'),
      note('cons', 'Cons /', 36, 645, 290, 36, 'clean'),
    ])),
  ], ['comparison', 'decision']),

  tpl('priority-wishlist', 'Priority Wishlist', 'Planning', 'Give your top priorities more room.', '#aa9ab7', 1470, 1140, [
    b('must', 'MUST HAVE', 0, 0, 660, 1080, 'lavender', [note('priority', 'The pieces you are saving for first', 42, 100, 560), p('first', 'Add top priority', 70, 180, 500, 365), p('second', 'Add another priority', 70, 680, 500, 225)]),
    b('want', 'REALLY WANT', 710, 0, 720, 500, 'fashion', slots(['Add a strong contender', 'Add another want'], 2, 40, 155, 285, 185, 35)),
    b('maybe', 'MAYBE', 710, 540, 340, 500, 'paper', [p('maybe-item', 'Add a maybe', 65, 145, 205, 190)]),
    b('sale', 'WAIT FOR SALE', 1090, 540, 340, 500, 'clinical', [p('sale-item', 'Add a sale watch', 65, 145, 205, 190)]),
  ], ['wishlist', 'priorities']),

  tpl('makeup-routine', 'Makeup Routine', 'Beauty', 'Move through six customizable makeup stages.', '#bb9b88', 1680, 1190, [
    ...[
      ['PREP', ['Moisturizer', 'Primer']], ['BASE', ['Foundation / tint', 'Concealer']], ['FACE', ['Blush', 'Bronzer / highlight']],
      ['EYES', ['Shadow', 'Mascara / liner']], ['LIPS', ['Lip color', 'Lip liner / balm']], ['SET', ['Powder', 'Setting spray']],
    ].map(([stage, labels], index) => b(`stage-${index}`, `${String(index + 1).padStart(2, '0')} / ${stage}`, (index % 3) * 500 + (index >= 3 ? 170 : 0), Math.floor(index / 3) * 610, 470, 530, index % 2 ? 'blush' : 'clinical', slots(labels as string[], 2, 35, 145, 180, 165, 25))),
  ], ['makeup', 'routine']),

  tpl('event-look', 'Event Look', 'Fashion', 'A statement piece at the center, with every finishing detail.', '#a994a0', 1240, 1080, [
    b('event', 'THE EVENT LOOK', 0, 0, 1220, 1040, 'editorial', [
      note('event-notes', 'Occasion / date / budget notes', 44, 100, 1120, 44, 'elegant', 'large'),
      p('main', 'Primary outfit', 435, 180, 345, 475),
      p('shoes', 'Shoes', 80, 220, 235, 200), p('bag', 'Bag', 80, 590, 235, 190),
      p('jewelry', 'Jewelry', 900, 205, 230, 190), p('hair', 'Hair', 900, 505, 230, 170),
      p('makeup', 'Makeup', 900, 790, 230, 140),
    ]),
  ], ['event', 'outfit']),

  tpl('fragrance-wardrobe', 'Fragrance Wardrobe', 'Beauty', 'Group scents by the mood and moment they bring.', '#aa9c89', 1430, 1200, [
    ...[
      ['FRESH', 'Fresh scent'], ['FLORAL', 'Floral scent'], ['SWEET', 'Sweet scent'],
      ['WOODY / WARM', 'Woody or warm scent'], ['SPECIAL OCCASION', 'Occasion scent'],
    ].map(([title, label], index) => b(`scent-${index}`, title, index < 3 ? index * 480 : 240 + (index - 3) * 480,
      index < 3 ? 0 : 610, 440, 570, index % 2 ? 'blush' : 'fashion', [p('scent', `Add ${label.toLowerCase()}`, 116, 150, 205, 280)])),
  ], ['fragrance', 'collection']),

  tpl('new-apartment', 'New Apartment', 'Home', 'Plan the rooms and first-week essentials together.', '#9ca28e', 1520, 1510, [
    ...[
      ['BEDROOM', ['Bed / mattress', 'Bedding']], ['BATHROOM', ['Towels', 'Storage']], ['KITCHEN', ['Cookware', 'Dining basics']],
      ['LIVING ROOM', ['Sofa / seating', 'Lighting']], ['CLEANING', ['Cleaning kit', 'Laundry basics']], ['FIRST-WEEK ESSENTIALS', ['Daily essential', 'Tool / utility']],
    ].map(([title, labels], index) => b(`room-${index}`, title as string, (index % 2) * 770, Math.floor(index / 2) * 500, 720, 460,
      index % 3 === 1 ? 'sage' : index % 3 === 2 ? 'paper' : 'fashion', slots(labels as string[], 2, 42, 145, 275, 170, 42))),
  ], ['apartment', 'home']),

  tpl('gift-planner', 'Gift Planner', 'Planning', 'Give each recipient a main idea and a backup.', '#bb9d8d', 1430, 600, [
    ...[0, 1, 2].map((index) => b(`recipient-${index + 1}`, `RECIPIENT ${index + 1}`, index * 480, 0, 440, 550,
      index === 1 ? 'lavender' : 'paper', [note('person', 'Rename this board for your person', 36, 100, 360),
        p('main', 'Main idea', 36, 175, 176, 185), p('backup', 'Backup idea', 228, 175, 176, 185)])),
  ], ['gifts', 'recipients']),

  tpl('clean-grid', 'Clean Grid', 'Layouts', 'A regular, aligned collection for anything.', '#7f98ab', 940, 700, [
    b('grid', 'My edit', 0, 0, 940, 700, 'paper', [note('intro', 'A few things worth keeping together', 38, 92, 840),
      p('one', 'Add first find', 38, 160, 184, 190), p('two', 'Add second find', 260, 160, 184, 190),
      p('three', 'Add third find', 482, 160, 184, 190), p('four', 'Add fourth find', 704, 160, 184, 190)]),
  ], ['grid']),

  tpl('editorial-collage', 'Editorial Collage', 'Layouts', 'Two large visual anchors with supporting finds.', '#a89a89', 1210, 1020, [
    b('editorial', 'THE EDIT', 0, 0, 1190, 990, 'collage', [note('heading', 'Collected with intention', 50, 102, 1080, 46, 'elegant', 'large'),
      p('hero-one', 'Add first hero', 52, 185, 340, 370), p('hero-two', 'Add second hero', 435, 270, 300, 315),
      p('support-one', 'Add supporting find', 795, 180, 250, 190), p('support-two', 'Add another find', 800, 555, 250, 180),
      p('detail', 'Add a detail', 80, 735, 220, 130)]),
  ], ['collage', 'editorial']),

  tpl('gallery', 'Gallery', 'Layouts', 'Large image-led cards with generous space.', '#8c9692', 1140, 880, [
    b('gallery', 'GALLERY', 0, 0, 1120, 850, 'gallery', [note('gallery-heading', 'The visual collection', 50, 90, 1000, 40, 'elegant', 'large'),
      p('image-one', 'Add first image', 48, 170, 315, 445), p('image-two', 'Add second image', 402, 170, 315, 445),
      p('image-three', 'Add third image', 756, 170, 315, 445)]),
  ], ['gallery', 'images']),

  tpl('scrapbook-moodboard', 'Scrapbook / Moodboard', 'Layouts', 'An organic image-first canvas with varied spacing.', '#c1af7f', 1230, 1070, [
    b('mood', 'MOOD / COLOUR / TEXTURE', 0, 0, 1210, 1040, 'yellow', [note('mood-heading', 'Gather the feeling first', 55, 98, 1040, 50, 'elegant', 'large'),
      p('anchor', 'Add anchor image', 70, 190, 340, 370), p('detail-one', 'Add a texture', 475, 190, 210, 180),
      p('detail-two', 'Add a color note', 745, 235, 235, 235), p('detail-three', 'Add another image', 495, 580, 285, 205),
      p('detail-four', 'Add a detail', 865, 590, 220, 175), p('last', 'Add inspiration', 90, 745, 265, 155)]),
  ], ['moodboard', 'scrapbook']),
];

export const previewGeometry = (template: CanvasTemplate) => template.boards.map((board) => ({
  id: board.id, x: board.x / template.bounds.width * 100, y: board.y / template.bounds.height * 100,
  width: board.width / template.bounds.width * 100, height: board.height / template.bounds.height * 100,
  items: board.children.filter((child): child is TemplatePlaceholder => child.kind === 'placeholder').map((item) => ({
    id: item.id, x: item.x / board.width * 100, y: item.y / board.height * 100,
    width: item.width / board.width * 100, height: (item.imageHeight + 90) / board.height * 100,
  })),
}));

export const instantiateTemplate = (template: CanvasTemplate, origin: { x: number; y: number },
  makeId: () => string = () => crypto.randomUUID(), createdAt = new Date().toISOString()): { items: Item[]; outfits: Outfit[]; sections: CanvasSection[]; bounds: { left: number; top: number; width: number; height: number } } => {
  const items: Item[] = [];
  const boardIdBySource = new Map<string, string>();
  const outfits: Outfit[] = template.boards.map((source) => {
    const boardId = makeId();
    boardIdBySource.set(source.id, boardId);
    const itemIds: string[] = [];
    const elements: BoardElement[] = [];
    for (const child of source.children) {
      if (child.kind === 'text') {
        elements.push({ id: makeId(), type: 'text', x: child.x, y: child.y, width: child.width, height: child.height,
          content: child.content, textPreset: child.textPreset, textSize: child.textSize, textAlign: child.textAlign, color: child.color });
        continue;
      }
      const itemId = makeId();
      itemIds.push(itemId);
      items.push({ id: itemId, title: child.label, brand: '', sourceUrl: '', imageUrl: '', price: null, currency: '', color: '', size: '',
        colorOptions: [], sizeOptions: [], availability: '', notes: '', unsure: false, bought: false,
        x: origin.x + source.x + child.x, y: origin.y + source.y + child.y, createdAt,
        templateCardSize: { width: child.width, imageHeight: child.imageHeight },
        placeholder: { label: child.label, helperText: child.helperText, category: child.category, treatment: child.treatment },
      });
    }
    return { id: boardId, name: source.title, itemIds, budget: source.budget?.amount ?? null,
      budgetCurrency: source.budget?.currency, customLeft: origin.x + source.x, customTop: origin.y + source.y,
      customWidth: source.width, customHeight: source.height, presentation: structuredClone(source.presentation),
      styleOverrides: source.styleOverrides ? structuredClone(source.styleOverrides) : undefined,
      elements, preserveWhenEmpty: true };
  });
  const sections: CanvasSection[] = (template.sections ?? []).map((source) => {
    const itemIds: string[] = [];
    for (const child of source.children ?? []) {
      const itemId = makeId();
      itemIds.push(itemId);
      items.push({ id: itemId, title: child.label, brand: '', sourceUrl: '', imageUrl: '', price: null, currency: '', color: '', size: '',
        colorOptions: [], sizeOptions: [], availability: '', notes: '', unsure: false, bought: false,
        x: origin.x + source.x + child.x, y: origin.y + source.y + child.y, createdAt,
        templateCardSize: { width: child.width, imageHeight: child.imageHeight },
        placeholder: { label: child.label, helperText: child.helperText, category: child.category, treatment: child.treatment },
      });
    }
    return { id: makeId(), title: source.title, subtitle: source.subtitle,
      x: origin.x + source.x, y: origin.y + source.y, width: source.width, height: source.height, padding: source.padding,
      style: source.style, boardIds: source.boardIds.flatMap((id) => boardIdBySource.get(id) ?? []), itemIds };
  });
  return { items, outfits, sections, bounds: { left: origin.x, top: origin.y, width: template.bounds.width, height: template.bounds.height } };
};

export const isTemplatePlaceholder = (item: Pick<Item, 'placeholder'>) => Boolean(item.placeholder);
export const productItems = (items: Item[]) => items.filter((item) => !isTemplatePlaceholder(item));
export const replaceTemplatePlaceholder = (item: Item, fields: Partial<Item>): Item => {
  const { placeholder: _placeholder, ...normalItem } = item;
  return { ...normalItem, price: null, availability: '', availabilityVerified: false, bought: false,
    ...fields, x: item.x, y: item.y, templateCardSize: item.templateCardSize };
};
