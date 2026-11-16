import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
const { chromium } = await import('playwright');

const baseURL = process.env.CURA_PERF_BASE_URL ?? 'http://127.0.0.1:5173';
const outPath = resolve(process.env.CURA_PERF_OUTPUT ?? 'scratch/canvas-performance-latest.json');
const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#e6e1dc"/><circle cx="200" cy="175" r="95" fill="#849c72"/><rect x="100" y="285" width="200" height="35" rx="12" fill="#b28b79"/></svg>')}`;
const items = Array.from({ length: 200 }, (_, index) => ({
  id: `perf-${index + 1}`, title: `Stress product ${index + 1}`, brand: 'Cura test', retailer: '',
  sourceUrl: '', imageUrl: svg, price: 28 + index % 70, currency: 'CAD', color: 'Sage', size: 'M',
  colorOptions: [], sizeOptions: [], availability: '', notes: '', unsure: false,
  x: 100 + (index % 10) * 280, y: 100 + Math.floor(index / 10) * 420,
  scale: 1, isLoading: false, createdAt: new Date(0).toISOString(),
}));
const fixture = JSON.stringify({ items, outfits: [], sections: [] });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(value => {
  localStorage.setItem('cura-link-only-board-v3', value);
  window.__curaPerf = { active: false, frames: [], longTasks: [], shifts: [], worldMutations: 0, cardMutations: 0, startedAt: 0 };
  const perf = window.__curaPerf;
  try { new PerformanceObserver(list => { if (perf.active) for (const e of list.getEntries()) perf.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver(list => { if (perf.active) for (const e of list.getEntries()) if (!e.hadRecentInput) perf.shifts.push({ start: e.startTime, value: e.value }); }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  let previous = 0;
  const sample = time => { if (perf.active) { if (previous) perf.frames.push(time - previous); previous = time; } else previous = 0; requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
  const watch = () => {
    if (!document.documentElement) return;
    new MutationObserver(records => {
      if (!perf.active) return;
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!target) continue;
        if (target.matches('.world')) perf.worldMutations++;
        if (target.matches('.sticker') || target.closest('.sticker')) perf.cardMutations++;
      }
    }).observe(document.documentElement, { attributes: true, subtree: true, childList: true, attributeFilter: ['style', 'class'] });
  };
  if (document.documentElement) watch(); else addEventListener('DOMContentLoaded', watch, { once: true });
  window.__startCuraPerf = () => { Object.assign(perf, { active: true, frames: [], longTasks: [], shifts: [], worldMutations: 0, cardMutations: 0, startedAt: performance.now() }); };
  window.__stopCuraPerf = () => { perf.active = false; return { durationMs: performance.now() - perf.startedAt, frames: perf.frames.slice(), longTasks: perf.longTasks.slice(), shifts: perf.shifts.slice(), worldMutations: perf.worldMutations, cardMutations: perf.cardMutations }; };
}, fixture);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const consoleErrors = [];
page.on('pageerror', error => consoleErrors.push(error.message));
await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.sticker').length === 200, null, { timeout: 30000 });
await page.waitForTimeout(1200);

const runGesture = async (kind) => {
  const board = page.locator('.board');
  if (kind === 'pan') await page.locator('.pan-canvas').first().evaluate(button => button.click());
  if (kind === 'drag' && await page.locator('.pan-canvas').first().getAttribute('aria-pressed') === 'true') {
    await page.locator('.pan-canvas').first().evaluate(button => button.click());
  }
  const target = kind === 'pan' ? board : page.locator('.sticker').first();
  const rect = await target.boundingBox();
  if (!rect) throw new Error(`Missing ${kind} target`);
  const start = kind === 'pan' ? { x: 1100, y: 780 } : { x: rect.x + rect.width / 2, y: rect.y + 35 };
  await page.evaluate(() => window.__startCuraPerf());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 48;
  const dx = kind === 'pan' ? -240 : 144;
  const dy = kind === 'pan' ? -120 : 96;
  const began = performance.now();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + dx * i / steps, start.y + dy * i / steps);
    await new Promise(resolve => setTimeout(resolve, 8));
  }
  await page.mouse.up();
  const elapsedMs = performance.now() - began;
  await page.waitForTimeout(120);
  const raw = await page.evaluate(() => window.__stopCuraPerf());
  const sorted = raw.frames.slice().sort((a, b) => a - b);
  const percentile = p => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10 : 0;
  return {
    inputEvents: steps, elapsedMs: Math.round(elapsedMs), framesObserved: raw.frames.length,
    frameGapMedianMs: percentile(.5), frameGapP95Ms: percentile(.95), framesOver32ms: raw.frames.filter(v => v > 32).length,
    longTasks: raw.longTasks, layoutShiftCount: raw.shifts.length, layoutShiftScore: Number(raw.shifts.reduce((sum, entry) => sum + entry.value, 0).toFixed(5)),
    worldStyleMutations: raw.worldMutations, cardMutations: raw.cardMutations,
  };
};

const result = {
  createdAt: new Date().toISOString(), viewport: { width: 1440, height: 900 }, products: items.length,
  method: 'Isolated Chromium context seeded through localStorage; 48 mouse input steps per pan and item drag; local SVG fixture images; PerformanceObserver long-task/layout-shift plus RAF-gap and DOM mutation counters.',
  pan: await runGesture('pan'),
  itemDrag: await runGesture('drag'),
  errors: consoleErrors,
};
await mkdir(resolve(outPath, '..'), { recursive: true });
await writeFile(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
await browser.close();
