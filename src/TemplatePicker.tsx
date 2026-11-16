import { useState } from 'react';
import type { CanvasTemplate, TemplateCategory } from './templates';
import { starterTemplates, templateCategories } from './templates';

type PickerCategory = 'For You' | TemplateCategory;
const categories: PickerCategory[] = ['For You', ...templateCategories];
const featuredIds = ['capsule-wardrobe', 'hair-routine', 'dream-room', 'compare-before-buying', 'vacation-packing', 'clean-grid'];

export const templatesInCategory = (category: PickerCategory) => category === 'For You'
  ? featuredIds.map((id) => starterTemplates.find((template) => template.id === id)).filter((template): template is CanvasTemplate => Boolean(template))
  : starterTemplates.filter((template) => template.category === category);

const previewColors: Record<string, string> = {
  cream: 'var(--color-cream-soft)', grey: 'var(--color-surface-muted)', blush: 'var(--color-blush-soft)', white: 'var(--color-surface-raised)', lavender: 'var(--color-lavender-soft)',
  sage: 'var(--color-sage-soft)', paper: 'var(--color-surface)', yellow: 'var(--color-butter-soft)',
};

function TemplateMiniature({ template, large = false }: { template: CanvasTemplate; large?: boolean }) {
  const width = template.bounds.width;
  const height = template.bounds.height;
  return <span className={`template-miniature ${large ? 'is-large' : ''}`} style={{ '--template-accent': template.preview.accent } as React.CSSProperties} aria-hidden="true">
    <svg viewBox={`-18 -18 ${width + 36} ${height + 36}`} preserveAspectRatio="xMidYMid meet" focusable="false">
      {template.sections?.map((section) => <g key={section.id}>
        <rect x={section.x} y={section.y} width={section.width} height={section.height} rx="28" fill={previewColors[section.style] ?? 'var(--color-surface)'} stroke={template.preview.accent} strokeOpacity=".45" strokeWidth="5" />
        <rect x={section.x + 24} y={section.y + 30} width={Math.min(section.width * .3, 190)} height="13" rx="6" fill={template.preview.accent} opacity=".65" />
        {section.subtitle && <rect x={section.x + 24} y={section.y + 54} width={Math.min(section.width * .5, 300)} height="6" rx="3" fill={template.preview.accent} opacity=".28" />}
        {section.children?.map((child) => <rect key={child.id} x={section.x + child.x} y={section.y + child.y} width={child.width} height={child.imageHeight} rx="10" fill="var(--color-surface-raised)" stroke={template.preview.accent} strokeOpacity=".5" strokeWidth="4" />)}
      </g>)}
      {template.boards.map((board) => {
        const parentSection = template.sections?.find((section) => section.boardIds.includes(board.id));
        const fill = previewColors[board.presentation.backgroundPreset ?? 'paper'] ?? previewColors.paper;
        const titleHeight = Math.min(52, board.height * .16);
        return <g key={board.id} transform={`translate(${board.x} ${board.y})`}>
          <rect x="0" y="0" width={board.width} height={board.height} rx="18" fill={parentSection ? 'var(--color-surface-raised)' : fill} stroke={template.preview.accent} strokeOpacity={parentSection ? '.2' : '.42'} strokeWidth={parentSection ? '3' : '4'} />
          <rect x="0" y="0" width={board.width} height={titleHeight} rx="18" fill={template.preview.accent} opacity={parentSection ? '.08' : '.14'} />
          <rect x="24" y={titleHeight * .38} width={Math.min(board.width * .44, 155)} height="8" rx="4" fill={template.preview.accent} opacity=".62" />
          {board.children.map((child) => child.kind === 'placeholder'
            ? <g key={child.id}>
              <rect x={child.x} y={child.y} width={child.width} height={child.imageHeight} rx="10" fill="var(--color-surface-raised)" stroke={template.preview.accent} strokeOpacity=".57" strokeWidth="4" />
              <rect x={child.x + child.width * .13} y={child.y + child.imageHeight * .12} width={child.width * .74} height={child.imageHeight * .57} rx="7" fill={template.preview.accent} opacity=".28" />
              <rect x={child.x + child.width * .13} y={child.y + child.imageHeight * .79} width={child.width * .57} height="7" rx="3.5" fill={template.preview.accent} opacity=".42" />
            </g>
            : <rect key={child.id} x={child.x} y={child.y} width={child.width * .64} height={Math.min(child.height, 12)} rx="5" fill={template.preview.accent} opacity=".36" />)}
        </g>;
      })}
    </svg>
  </span>;
}

export function TemplatePicker({ onClose, onUse }: { onClose: () => void; onUse: (templateId: string) => void }) {
  const [category, setCategory] = useState<PickerCategory>('For You');
  const [selectedId, setSelectedId] = useState(featuredIds[0]);
  const [mobileDetail, setMobileDetail] = useState(false);
  const selected = starterTemplates.find((template) => template.id === selectedId) ?? starterTemplates[0];
  const shown = templatesInCategory(category);
  const spotCount = (template: CanvasTemplate) => template.boards.reduce((count, board) => count + board.children.filter((child) => child.kind === 'placeholder').length, 0)
    + (template.sections ?? []).reduce((count, section) => count + (section.children?.length ?? 0), 0);

  return <section className={`template-gallery ${mobileDetail ? 'has-mobile-detail' : ''}`} role="dialog" aria-modal="true" aria-label="Choose a canvas template" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
    <header className="template-gallery-heading">
      <div><span className="template-kicker">START WITH A CANVAS</span><strong>Choose a template</strong><small>See the layout before you make it yours.</small></div>
      <button type="button" onClick={onClose} aria-label="Close templates">×</button>
    </header>
    <nav className="template-filters" aria-label="Template categories">
      {categories.map((choice) => <button type="button" key={choice} className={category === choice ? 'is-active' : ''} aria-pressed={category === choice} onClick={() => { setCategory(choice); setSelectedId(templatesInCategory(choice)[0]?.id ?? selectedId); setMobileDetail(false); }}>{choice}</button>)}
    </nav>
    <div className="template-gallery-body">
      <div className="template-browse">
        <div className="template-result-heading"><span>{category}</span><small>{shown.length} {shown.length === 1 ? 'canvas' : 'canvases'}</small></div>
        <div className="template-options">
          {shown.map((template) => <button type="button" className={`template-option ${selectedId === template.id ? 'is-selected' : ''}`} key={template.id} onClick={() => { setSelectedId(template.id); setMobileDetail(true); }} aria-label={`Preview ${template.name}, ${template.boards.length} ${template.boards.length === 1 ? 'board' : 'boards'}`} aria-pressed={selectedId === template.id}>
            <TemplateMiniature template={template} />
            <span className="template-option-copy"><span className="template-option-category">{template.category}</span><strong>{template.name}</strong><small>{template.description}</small><span className="template-option-count">{template.boards.length} {template.boards.length === 1 ? 'board' : 'boards'} · {spotCount(template)} spots</span></span>
          </button>)}
        </div>
      </div>
      <aside className="template-detail" aria-label={`${selected.name} preview`}>
        <button className="template-detail-back" type="button" onClick={() => setMobileDetail(false)}>← All templates</button>
        <span className="template-detail-eyebrow">{selected.category} / STARTER CANVAS</span>
        <h3>{selected.name}</h3>
        <p>{selected.description}</p>
        <TemplateMiniature template={selected} large />
        <div className="template-detail-summary"><span>{selected.boards.length} {selected.boards.length === 1 ? 'editable board' : 'editable boards'}</span><span>{spotCount(selected)} product spots</span></div>
        <div className="template-detail-boards"><strong>Included boards</strong><span>{selected.boards.map((board) => board.title).join(' · ')}</span></div>
        <button className="template-use-button" type="button" onClick={() => onUse(selected.id)}>Use template <span aria-hidden="true">→</span></button>
        <small className="template-detail-footnote">Every board and spot can be changed after creation.</small>
      </aside>
    </div>
  </section>;
}
