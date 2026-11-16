import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { instantiateTemplate, isTemplatePlaceholder, previewGeometry, productItems, replaceTemplatePlaceholder, starterTemplates, templateCategories } from '../src/templates.ts';
import { moveSectionFromSnapshot, removeSection, sectionSnapshot } from '../src/sections.ts';
import { makeEditableCopy } from '../src/sharing.ts';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const makeIds = () => { let next = 0; return () => `instance-${++next}`; };
const byId = (id) => starterTemplates.find((entry) => entry.id === id);

test('the curated library has eighteen unique starters in the requested categories', () => {
  assert.equal(starterTemplates.length, 18);
  assert.equal(new Set(starterTemplates.map((template) => template.id)).size, 18);
  assert.deepEqual(templateCategories, ['Fashion', 'Beauty', 'Home', 'Travel', 'Planning', 'Layouts']);
  assert.deepEqual(new Set(starterTemplates.map((template) => template.category)), new Set(templateCategories));
  for (const id of ['capsule-wardrobe', 'hair-routine', 'am-pm-skincare', 'outfit-builder', 'vacation-packing', 'dream-room',
    'beauty-restock', 'compare-before-buying', 'priority-wishlist', 'makeup-routine', 'event-look', 'fragrance-wardrobe',
    'new-apartment', 'gift-planner', 'clean-grid', 'editorial-collage', 'gallery', 'scrapbook-moodboard']) assert.ok(byId(id), id);
});

test('each template instantiates normal positioned boards and non-product placeholders within its bounds', () => {
  for (const template of starterTemplates) {
    const created = instantiateTemplate(template, { x: 200, y: 300 }, makeIds());
    assert.equal(created.outfits.length, template.boards.length, template.id);
    assert.ok(created.items.length >= template.boards.length, template.id);
    assert.equal(new Set(created.outfits.map((board) => board.id)).size, created.outfits.length, template.id);
    assert.equal(new Set(created.items.map((item) => item.id)).size, created.items.length, template.id);
    assert.equal(productItems(created.items).length, 0, template.id);
    for (const board of created.outfits) {
      assert.ok(board.customLeft >= 200 && board.customTop >= 300, template.id);
      assert.ok(board.itemIds.every((id) => created.items.some((item) => item.id === id)), template.id);
      assert.equal(board.preserveWhenEmpty, true);
    }
    for (const item of created.items) {
      assert.equal(isTemplatePlaceholder(item), true);
      assert.equal(item.price, null);
      assert.equal(item.availability, '');
      assert.equal(item.bought, false);
      assert.equal(item.sourceUrl, '');
      assert.ok(item.x >= created.bounds.left && item.y >= created.bounds.top, template.id);
      assert.ok(item.x + item.templateCardSize.width <= created.bounds.left + created.bounds.width + 2, template.id);
      assert.ok(item.y + item.templateCardSize.imageHeight + 100 <= created.bounds.top + created.bounds.height + 4, template.id);
    }
  }
});

test('the category layouts express the intended board relationships', () => {
  assert.deepEqual(byId('capsule-wardrobe').boards.map((board) => board.title), ['Tops', 'Bottoms', 'Layers', 'Shoes', 'Accessories']);
  assert.deepEqual(byId('beauty-restock').boards.map((board) => board.title), ['RUNNING LOW', 'REPURCHASE', 'TRY NEXT', 'NOT AGAIN']);
  assert.equal(byId('hair-routine').boards.length, 5);
  assert.equal(byId('hair-routine').boards.reduce((total, board) => total + board.children.filter((child) => child.kind === 'placeholder').length, 0), 15);
  assert.deepEqual(byId('am-pm-skincare').boards.map((board) => board.title), ['AM / MORNING', 'PM / EVENING', 'OCCASIONAL TREATMENTS']);
  assert.equal(byId('vacation-packing').boards.length, 6);
  assert.equal(byId('makeup-routine').boards.length, 6);
  assert.equal(byId('new-apartment').boards.length, 6);
  assert.equal(byId('compare-before-buying').boards.length, 3);
  assert.equal(byId('gift-planner').boards.length, 3);
});

test('sections are optional grouping frames with real board references and no shopping fields', () => {
  for (const id of ['capsule-wardrobe', 'hair-routine', 'vacation-packing', 'new-apartment']) {
    const template = byId(id);
    const created = instantiateTemplate(template, { x: 100, y: 200 }, makeIds());
    assert.equal(created.sections.length, template.sections.length);
    assert.ok(created.sections.length > 0);
    for (const section of created.sections) {
      assert.ok(section.boardIds.every((boardId) => created.outfits.some((board) => board.id === boardId)));
      assert.ok(section.x >= created.bounds.left && section.y >= created.bounds.top);
      assert.ok(section.x + section.width <= created.bounds.left + created.bounds.width);
      assert.ok(section.y + section.height <= created.bounds.top + created.bounds.height);
      assert.equal(Object.hasOwn(section, 'budget'), false);
      assert.equal(Object.hasOwn(section, 'itemIds') && section.itemIds.length, 0);
    }
  }
  assert.equal(instantiateTemplate(byId('clean-grid'), { x: 0, y: 0 }, makeIds()).sections.length, 0);
  assert.equal(byId('vacation-packing').sections.length, 3);
  assert.equal(byId('new-apartment').sections.length, 3);
  for (const id of ['capsule-wardrobe', 'hair-routine', 'vacation-packing', 'new-apartment']) {
    const template = byId(id);
    for (const section of template.sections) {
      for (const board of template.boards.filter((entry) => section.boardIds.includes(entry.id))) {
        assert.ok(board.x >= section.x + section.padding - 1 && board.y >= section.y + section.padding, `${id}: ${board.id}`);
        assert.ok(board.x + board.width <= section.x + section.width && board.y + board.height <= section.y + section.height, `${id}: ${board.id}`);
      }
    }
    for (const [index, section] of template.sections.entries()) for (const other of template.sections.slice(index + 1)) {
      assert.equal(section.x < other.x + other.width && section.x + section.width > other.x
        && section.y < other.y + other.height && section.y + section.height > other.y, false, `${id}: overlapping sections`);
    }
  }
});

test('moving a section carries referenced boards and items while preserving independent board coordinates', () => {
  const created = instantiateTemplate(byId('hair-routine'), { x: 0, y: 0 }, makeIds());
  const state = { items: created.items, outfits: created.outfits, sections: created.sections };
  const section = created.sections[0];
  const firstBoard = created.outfits[0];
  const firstItem = created.items.find((item) => firstBoard.itemIds.includes(item.id));
  const snapshot = sectionSnapshot(state, section);
  const moved = moveSectionFromSnapshot(state, section.id, 85, 42, snapshot);
  assert.equal(moved.sections[0].x, section.x + 85);
  assert.equal(moved.sections[0].y, section.y + 42);
  assert.equal(moved.sections[0].width, section.width);
  assert.equal(moved.sections[0].height, section.height);
  assert.equal(moved.outfits[0].customLeft, firstBoard.customLeft + 85);
  assert.equal(moved.outfits[0].customWidth, firstBoard.customWidth);
  assert.equal(moved.outfits[0].customHeight, firstBoard.customHeight);
  assert.equal(moved.items.find((item) => item.id === firstItem.id).x, firstItem.x + 85);
  assert.deepEqual(moved.outfits[0].itemIds, firstBoard.itemIds);
  const independentlyMoved = { ...moved, outfits: moved.outfits.map((board) => board.id === firstBoard.id ? { ...board, customLeft: board.customLeft + 30 } : board) };
  assert.equal(independentlyMoved.sections[0].x, moved.sections[0].x);
  const restored = moveSectionFromSnapshot(moved, section.id, 0, 0, snapshot);
  assert.equal(restored.outfits[0].customLeft, firstBoard.customLeft);
  assert.equal(restored.items.find((item) => item.id === firstItem.id).x, firstItem.x);
});

test('removing a frame keeps contents; deleting a section and contents removes only its references', () => {
  const created = instantiateTemplate(byId('vacation-packing'), { x: 0, y: 0 }, makeIds());
  const state = { items: created.items, outfits: created.outfits, sections: created.sections };
  const section = created.sections.find((entry) => entry.title === 'Beauty + Care');
  const unframed = removeSection(state, section.id);
  assert.equal(unframed.sections.length, state.sections.length - 1);
  assert.equal(unframed.outfits.length, state.outfits.length);
  assert.equal(unframed.items.length, state.items.length);
  const removed = removeSection(state, section.id, true);
  assert.equal(removed.outfits.length, state.outfits.length - 1);
  assert.ok(removed.items.length < state.items.length);
  assert.equal(removed.sections.length, state.sections.length - 1);
  assert.equal(removed.sections[0].boardIds.every((id) => removed.outfits.some((board) => board.id === id)), true);
});

test('a section can place a placeholder directly without adding Board membership or totals', () => {
  const template = { ...byId('clean-grid'), sections: [{ id: 'outer', title: 'My Section', x: 0, y: 0, width: 940, height: 700, style: 'paper', boardIds: ['grid'],
    children: [{ id: 'loose', kind: 'placeholder', x: 20, y: 30, width: 140, imageHeight: 130, label: 'Add detail' }] }] };
  const created = instantiateTemplate(template, { x: 0, y: 0 }, makeIds());
  assert.equal(created.sections[0].itemIds.length, 1);
  assert.equal(created.outfits[0].itemIds.includes(created.sections[0].itemIds[0]), false);
  assert.equal(created.items.length, byId('clean-grid').boards[0].children.filter((child) => child.kind === 'placeholder').length + 1);
  assert.equal(productItems(created.items).length, 0);
});

test('editable collection copies retain section layout with remapped board and item references', () => {
  const created = instantiateTemplate(byId('hair-routine'), { x: 0, y: 0 }, makeIds());
  const copy = makeEditableCopy({ items: created.items, outfits: created.outfits, sections: created.sections }, 'new-owner', 'source');
  assert.equal(copy.sections.length, 1);
  assert.notEqual(copy.sections[0].id, created.sections[0].id);
  assert.equal(copy.sections[0].title, created.sections[0].title);
  assert.ok(copy.sections[0].boardIds.every((id) => copy.outfits.some((board) => board.id === id)));
  assert.ok(copy.sections[0].boardIds.every((id) => !created.outfits.some((board) => board.id === id)));
});

test('outfit, wishlist, and collage layouts use visibly different item hierarchy', () => {
  const children = (id) => byId(id).boards[0].children.filter((child) => child.kind === 'placeholder');
  const outfit = children('outfit-builder');
  const mainColumn = outfit.filter((item) => ['Outerwear', 'Top', 'Bottom', 'Shoes'].includes(item.label));
  assert.equal(new Set(mainColumn.map((item) => item.x)).size, 1);
  assert.ok(mainColumn.every((item, index) => index === 0 || item.y > mainColumn[index - 1].y));
  assert.ok(children('event-look').find((item) => item.label === 'Primary outfit').width > children('event-look').find((item) => item.label === 'Shoes').width);
  assert.ok(byId('priority-wishlist').boards.find((board) => board.id === 'must').width > byId('priority-wishlist').boards.find((board) => board.id === 'maybe').width);
  assert.ok(new Set(children('dream-room').map((item) => item.width)).size > 3);
  assert.ok(new Set(children('scrapbook-moodboard').map((item) => item.imageHeight)).size > 3);
  assert.equal(byId('gallery').boards.length, 1);
});

test('comparison notes, pros, and cons are editable board text elements', () => {
  const created = instantiateTemplate(byId('compare-before-buying'), { x: 0, y: 0 }, makeIds());
  created.outfits.forEach((board) => {
    assert.equal(board.itemIds.length, 1);
    assert.deepEqual(board.elements.map((element) => element.content), ['Notes / what matters', 'Pros /', 'Cons /']);
  });
});

test('preview geometry reflects each real composition and stays inside the preview canvas', () => {
  for (const template of starterTemplates) {
    const preview = previewGeometry(template);
    assert.equal(preview.length, template.boards.length);
    preview.forEach((board) => {
      assert.ok(board.x >= 0 && board.y >= 0 && board.width > 0 && board.height > 0, template.id);
      assert.ok(board.x + board.width <= 101 && board.y + board.height <= 101, template.id);
      assert.equal(board.items.length, template.boards.find((entry) => entry.id === board.id).children.filter((child) => child.kind === 'placeholder').length);
    });
  }
});

test('starter board frames and placeholder cards do not collide', () => {
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const template of starterTemplates) {
    for (const [index, board] of template.boards.entries()) {
      for (const other of template.boards.slice(index + 1)) assert.equal(overlaps(board, other), false, `${template.id}: ${board.id} and ${other.id}`);
      const cards = board.children.filter((child) => child.kind === 'placeholder').map((child) =>
        ({ x: child.x, y: child.y, width: child.width, height: child.imageHeight + 96, label: child.label }));
      for (const [cardIndex, card] of cards.entries()) {
        for (const other of cards.slice(cardIndex + 1)) assert.equal(overlaps(card, other), false, `${template.id}: ${card.label} and ${other.label}`);
      }
    }
  }
});

test('replacing a placeholder keeps its board position and removes placeholder state', () => {
  const created = instantiateTemplate(byId('clean-grid'), { x: 0, y: 0 }, makeIds());
  const item = created.items[0];
  const replaced = replaceTemplatePlaceholder(item, { title: 'Real item', sourceUrl: 'https://shop.example/product', price: 35 });
  assert.equal(replaced.id, item.id);
  assert.equal(replaced.x, item.x);
  assert.equal(replaced.y, item.y);
  assert.deepEqual(replaced.templateCardSize, item.templateCardSize);
  assert.equal(Object.hasOwn(replaced, 'placeholder'), false);
  assert.ok(created.outfits[0].itemIds.includes(replaced.id));
  assert.equal(productItems([replaced]).length, 1);
});

test('picker, touch replacement, empty board creation, and totals use the shared canvas paths', () => {
  const picker = readFileSync(new URL('../src/TemplatePicker.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('<TemplatePicker onClose={() => setTemplatePickerOpen(false)} onUse={createStarterCanvas} />'));
  assert.ok(picker.includes("['For You', ...templateCategories]"));
  assert.ok(picker.includes('template.boards.map((board)'));
  assert.ok(picker.includes('board.children.map((child)'));
  assert.ok(picker.includes('setSelectedId(template.id); setMobileDetail(true)'));
  assert.ok(picker.includes('onClick={() => onUse(selected.id)}'));
  assert.ok(picker.includes('Use template'));
  assert.ok(source.includes('openPlaceholder(item)'));
  assert.ok(source.includes('className="empty-canvas-start"'));
  assert.ok(source.includes('Paste or add a product'));
  assert.ok(source.includes('Use a template'));
  assert.ok(source.includes('>New board</button>'));
  assert.doesNotMatch(source, /<button[^>]*>Add product<\/button>/);
  assert.doesNotMatch(source, /item\.placeholder\.helperText &&/);
  assert.ok(source.includes('section-parent-${containingSection.style}'));
  assert.ok(source.includes('template-board-title'));
  assert.ok(source.includes('replacePlaceholderWithUrl()'));
  assert.ok(source.includes('replacePlaceholderManually'));
  assert.ok(source.includes('productItems(items).forEach'));
  assert.ok(source.includes('onClick={() => createNewBoard()}>New board'));
});

test('picker has phone, tablet, desktop geometry and touch selection states', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.template-options \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 14rem\), 1fr\)\)/);
  assert.match(css, /\.app-shell\[data-layout-state="compact"\] \.template-gallery \{/);
  assert.match(css, /\.app-shell\[data-layout-state="compact"\] \.template-use-button \{ position: sticky; bottom: 0/);
  assert.match(css, /@container cura-gallery \(max-width: 48rem\)/);
  assert.match(css, /@container cura-gallery \(min-width: 48\.001rem\)/);
  assert.match(css, /\.template-gallery\.has-mobile-detail \.template-browse \{ display: none; \}/);
  assert.match(css, /\.template-gallery\.has-mobile-detail \.template-detail \{ display: block; \}/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /\.template-placeholder:hover \.placeholder-card, \.template-placeholder:focus-visible \.placeholder-card/);
  assert.match(css, /\.outfit-frame\.in-template-section\.is-board-selected/);
});
