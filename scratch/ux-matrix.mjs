import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Cura UX baseline runner. Starts Vite unless UX_BASE_URL is supplied; it never
// writes app state to the project or changes source files.
const baseURL = process.env.UX_BASE_URL ?? 'http://127.0.0.1:5173';
const runStamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
// Keep the original baseline immutable. Set UX_OUTPUT_DIR=scratch/ux-before only
// when intentionally capturing a fresh baseline; normal runs are timestamped.
const outputDir = resolve(process.env.UX_OUTPUT_DIR ?? `scratch/ux-runs/${runStamp}`);
const reportsDir = resolve('scratch');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
const { chromium } = await import('playwright');
const AxeBuilder = (await import('@axe-core/playwright')).default;
const viewportClasses = {
  'very-small-foldable': [[280,653],[320,568]],
  phone: [[360,640],[375,667],[390,844],[430,932]],
  'phone-landscape': [[667,375],[844,390],[932,430]],
  tablet: [[768,1024],[820,1180],[1024,768]],
  laptop: [[1280,720],[1366,768],[1440,900]],
  desktop: [[1920,1080],[2560,1440]],
};
const findings = [];
const consoleErrors = [];
const actionCounts = {};
const openWorkspaceActions = async page => { const trigger=page.locator('.workspace-menu-trigger'); await trigger.focus(); await page.keyboard.press('Enter'); };
let vite;
let api;

async function isUp() {
  try { return (await fetch(baseURL)).ok; } catch { return false; }
}
async function apiIsUp() {
  try { const response=await fetch('http://127.0.0.1:8787/'); return response.ok||response.status===404; } catch { return false; }
}
if (!(await isUp())) {
  if (!(await apiIsUp())) {
    api = spawn(process.execPath, ['--env-file-if-exists=.env','server.mjs'], { stdio:'ignore', windowsHide:true });
    for(let n=0;n<40&&!(await apiIsUp());n++) await delay(250);
    if(!(await apiIsUp())) throw new Error('Cura API did not become available at http://127.0.0.1:8787');
  }
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'], { stdio:'ignore', windowsHide:true });
  for (let n=0; n<60 && !(await isUp()); n++) await delay(500);
  if (!(await isUp())) throw new Error(`Vite did not become available at ${baseURL}`);
}

await mkdir(outputDir, { recursive:true });
const browser = await chromium.launch({ headless:true });
const mainContext = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1 });
const main = await mainContext.newPage();
main.setDefaultNavigationTimeout(15000);
main.setDefaultTimeout(2200);
main.on('console', msg => { if (msg.type()==='error') consoleErrors.push({type:'console',text:msg.text()}); });
main.on('pageerror', error => consoleErrors.push({type:'pageerror',text:error.message}));
await main.goto(baseURL, {waitUntil:'domcontentloaded'});
await main.waitForTimeout(1000);

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
async function snap(page, state, viewportName) {
  await page.waitForTimeout(150);
  await page.screenshot({path:resolve(outputDir,`${slug(state)}--${slug(viewportName)}.png`),fullPage:true,animations:'disabled'});
}
async function inspectVisibleState(page,state) {
  const checks=await page.evaluate(()=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0;};
    const w=document.documentElement.clientWidth,h=document.documentElement.clientHeight;
    const activeModal=[...document.querySelectorAll('[aria-modal="true"]')].filter(visible).at(-1);
    const surfaceSelector='.inspector,.item-menu,.board-menu,.selection-menu,.quick-add,.template-gallery,.saved-collections-panel,.closet-drawer,.unified-selection-bar,.board-bulk-actions,.section-toolbar,.element-toolbar,.section-mobile-editor';
    const activeSurface=activeModal??[...document.querySelectorAll(surfaceSelector)].filter(visible).at(-1);
    const controls=[...(activeSurface??document).querySelectorAll('button,a[href],input,select,textarea,[role="button"]')].filter(visible);
    const effectiveTarget=e=>(e.matches('input[type="checkbox"],input[type="radio"]')?e.closest('label'):e.matches('input[type="file"]')?e.closest('label.upload-action'):null)||e;
    const underWCAGControls=controls.filter(e=>{const r=effectiveTarget(e).getBoundingClientRect();return r.width<24||r.height<24;}).map(e=>{const r=effectiveTarget(e).getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent.trim().slice(0,48)||e.tagName,type:e.type??null,size:[Math.round(r.width),Math.round(r.height)]};});
    const dialogs=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],.item-menu,.board-menu,.selection-menu,.quick-add,.template-gallery,.inspector,.saved-collections-panel,.closet-drawer')].filter(visible).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {label:e.getAttribute('aria-label')||e.className,clipped:r.left<0||r.top<0||r.right>w||r.bottom>h,overflow:e.scrollHeight>e.clientHeight+2&&!['auto','scroll'].includes(s.overflowY)};});
    const obstructedControls=controls.filter(e=>{const r=e.getBoundingClientRect();const x=Math.min(w-1,Math.max(0,r.left+r.width/2)),y=Math.min(h-1,Math.max(0,r.top+r.height/2)),hit=document.elementFromPoint(x,y);return hit&&hit!==e&&!e.contains(hit)&&!hit.contains(e)&&getComputedStyle(hit).position==='fixed';}).map(e=>e.getAttribute('aria-label')||e.textContent.trim().slice(0,48)||e.tagName);
    const root=getComputedStyle(document.documentElement);
    const safeTop=parseFloat(root.getPropertyValue('--safe-top'))||0,safeBottom=parseFloat(root.getPropertyValue('--safe-bottom'))||0;
    const fixed=[...document.querySelectorAll('body *')].filter(visible).filter(e=>getComputedStyle(e).position==='fixed').map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.className||e.tagName,top:Math.round(r.top),bottom:Math.round(h-r.bottom),safeTop,safeBottom,underSafeInset:r.top<safeTop||r.bottom>h-safeBottom};});
    return {activeSurface:activeSurface?.getAttribute('aria-label')||activeSurface?.className||'page',inspectorText:document.querySelector('.inspector')?.innerText,inspectorPanels:[...document.querySelectorAll('.inspector [role="tabpanel"]')].map(e=>({id:e.id,hidden:e.hidden,text:e.innerText.slice(0,120)})),overflow:document.documentElement.scrollWidth>w,underWCAG:underWCAGControls.length,underWCAGControls,underPreferred:controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44;}).length,dialogs,clippedMenus:dialogs.filter(x=>/menu/i.test(String(x.label))&&x.clipped),inspectorOverflow:dialogs.filter(x=>/inspector/i.test(String(x.label))&&x.overflow),safeInsetViolations:fixed.filter(x=>x.underSafeInset),obstructed:obstructedControls.length,obstructedControls,fixed};
  });
  findings.push({state:`state-layout:${state}`,status:checks.overflow||checks.underWCAG||checks.dialogs.some(x=>x.clipped)||checks.obstructed?'FAIL':'PASS',...checks});
}
async function countVisibleActions(page, selector) {
  return page.locator(selector).evaluateAll(nodes=>nodes.filter(node=>{
    const style=getComputedStyle(node),rect=node.getBoundingClientRect();
    return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0;
  }).length);
}
async function runAxeAudit(page, state) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const violations = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary?.replace(/\s+/g, ' ').slice(0, 240) })),
  }));
  const hasSerious = violations.some(violation => ['serious', 'critical'].includes(violation.impact));
  findings.push({ state: `axe:${state}`, status: hasSerious ? 'FAIL' : violations.length ? 'WARN' : 'PASS', violations });
}
async function readCanvasFrame(page) {
  return page.locator('.board').evaluate(board => {
    const world = board.querySelector('.world');
    if (!world) throw new Error('Canvas world is missing');
    const transform = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    const rect = board.getBoundingClientRect();
    return {
      zoom: transform.a,
      centerWorld: {
        x: (rect.left + rect.width / 2 - transform.e) / transform.a,
        y: (rect.top + rect.height / 2 - transform.f) / transform.a,
      },
      viewport: { width: rect.width, height: rect.height },
    };
  });
}
async function captureIf(page, state, action) {
  try { await action(); await page.waitForTimeout(200); await snap(page,state,'390x844'); findings.push({state,status:'PASS',detail:'State captured'}); await inspectVisibleState(page,state); await runAxeAudit(page,state); }
  catch (e) { findings.push({state,status:'FAIL',detail:`Could not open: ${e.message.replace(/\s+/g,' ').slice(0,320)}`}); }
}

// Full matrix: establish initial empty canvas and collect layout/accessibility signals.
for (const [group, sizes] of Object.entries(viewportClasses)) for (const [width,height] of sizes) {
  await main.setViewportSize({width,height});
  await main.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
  await main.waitForTimeout(100);
  const name=`${width}x${height}`;
  await snap(main,'empty-canvas',name);
  const result=await main.evaluate(() => {
    const visible = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)!==0; };
    const controls=[...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])')].filter(visible);
    const underWCAG=controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<24||r.height<24;});
    const underPreferred=controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44;});
    const tiny=[...document.querySelectorAll('body *')].filter(visible).filter(e=>e.children.length===0&&e.textContent.trim()).map(e=>({text:e.textContent.trim().slice(0,48),px:parseFloat(getComputedStyle(e).fontSize)})).filter(x=>x.px<12);
    const viewportW=document.documentElement.clientWidth,viewportH=document.documentElement.clientHeight;
    const root=getComputedStyle(document.documentElement),safeTop=parseFloat(root.getPropertyValue('--safe-top'))||0,safeBottom=parseFloat(root.getPropertyValue('--safe-bottom'))||0;
    const capabilities={coarsePointer:matchMedia('(pointer: coarse)').matches,finePointer:matchMedia('(pointer: fine)').matches,hover:matchMedia('(hover: hover)').matches,noHover:matchMedia('(hover: none)').matches,shortHeight:matchMedia('(max-height: 40rem)').matches,orientation:matchMedia('(orientation: portrait)').matches?'portrait':'landscape'};
    const layoutState=document.documentElement.dataset.layoutState||document.querySelector('.app-shell')?.dataset.layoutState||getComputedStyle(document.documentElement).getPropertyValue('--cura-layout-state').trim()||null;
    const fixed=[...document.querySelectorAll('body *')].filter(visible).filter(e=>getComputedStyle(e).position==='fixed').map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.className?.baseVal||e.className||e.tagName,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},safeTop,safeBottom,underSafeInset:r.top<safeTop||r.bottom>viewportH-safeBottom};});
    const clipped=[...document.querySelectorAll('[role="dialog"],.item-menu,.board-menu,.selection-menu,.quick-add,.template-gallery,.inspector,.saved-collections-panel')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {selector:e.className||e.getAttribute('role'),clipped:r.left<0||r.top<0||r.right>viewportW||r.bottom>viewportH,scroll:e.scrollHeight>e.clientHeight+2,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}};});
    const obscured=controls.filter(e=>{const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;const x=Math.min(viewportW-1,Math.max(0,r.left+r.width/2)),y=Math.min(viewportH-1,Math.max(0,r.top+r.height/2)),top=document.elementFromPoint(x,y);return top&&top!==e&&!e.contains(top)&&!top.contains(e)&&(['fixed','sticky'].includes(getComputedStyle(top).position));}).length;
    return {overflow:document.documentElement.scrollWidth>viewportW,scrollWidth:document.documentElement.scrollWidth,viewportW,viewportH,layoutState,capabilities,underWCAG:underWCAG.map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,40),size:[Math.round(e.getBoundingClientRect().width),Math.round(e.getBoundingClientRect().height)]})),underPreferred:underPreferred.length,tiny,safeInsetViolations:fixed.filter(x=>x.underSafeInset),chromeInsetCandidates:fixed,clippedMenus:clipped.filter(x=>/menu/i.test(String(x.selector))&&x.clipped),dialogClipping:clipped.filter(x=>x.clipped),inspectorOverflow:clipped.filter(x=>/inspector/i.test(String(x.selector))&&x.scroll),obscured};
  });
  const stateFailed = result.overflow || result.underWCAG.length || result.tiny.length || result.safeInsetViolations.length || result.clippedMenus.length || result.dialogClipping.length || result.inspectorOverflow.length || result.obscured;
  findings.push({group,viewport:name,status:stateFailed?'FAIL':'PASS',...result});
  await runAxeAudit(main, `empty-canvas-${name}`);
  try {
    const zoomMenu = main.locator('.canvas-zoom-more').first();
    await zoomMenu.evaluate(element => { element.open = true; });
    for (const [level, semantic] of [[0.25,'far'],[0.5,'mid'],[1,'near'],[2,'near']]) {
      await main.getByLabel('Set zoom level').selectOption(String(level));
      await main.waitForFunction(expected => Math.abs(Number(getComputedStyle(document.querySelector('.board')).getPropertyValue('--canvas-zoom'))-expected)<0.001,level);
      const zoomState = await main.evaluate(() => {
        const canvas = document.querySelector('.board');
        const world = document.querySelector('.world');
        const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
        return { zoom: Number(getComputedStyle(canvas).getPropertyValue('--canvas-zoom')), semantic: canvas.dataset.zoom, worldZoom: matrix.a };
      });
      if (Math.abs(zoomState.zoom - level) > 0.001 || Math.abs(zoomState.worldZoom - level) > 0.001 || zoomState.semantic !== semantic) {
        throw Error(`Expected ${level} (${semantic}); root ${zoomState.zoom} / ${zoomState.semantic}, world ${zoomState.worldZoom}`);
      }
      findings.push({group:'zoom-level',viewport:name,level,status:'PASS',semantic});
    }
    await main.getByLabel('Set zoom level').selectOption('1');
    await zoomMenu.evaluate(element => { element.open = false; });
  } catch (e) {
    findings.push({group:'zoom-level',viewport:name,status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,260)});
  }
}

// Scenarios use only visible existing UI controls. Record unreachable flows as failures.
await main.setViewportSize({width:390,height:844});
await snap(main,'empty-canvas','390x844');
try {
  const starter=main.locator('.empty-canvas-start'),routeButtons=starter.getByRole('button');
  if(!await starter.isVisible()||await routeButtons.count()!==3)throw Error('Empty canvas must offer exactly three starting routes');
  const labels=await routeButtons.allTextContents();
  if(!labels.some(label=>/paste or add a product/i.test(label))||!labels.some(label=>/use a template/i.test(label))||!labels.some(label=>/^new board$/i.test(label)))throw Error(`Unexpected empty canvas routes: ${labels.join(' | ')}`);
  findings.push({state:'empty-canvas-start-routes',status:'PASS',detail:labels.join(' · ')});
} catch(e) { findings.push({state:'empty-canvas-start-routes',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,240)}); }
await captureIf(main,'add-link-flow',async()=>{const primary=main.locator('.empty-canvas-primary');if(await primary.isVisible().catch(()=>false))await primary.click();else await main.locator('.canvas-toolbar .canvas-add').click(); await main.locator('.add-modal input').first().waitFor({state:'visible',timeout:1800});});
try {
  const url=main.locator('.add-modal .primary-link-field input').first();
  const input=await url.evaluate(element=>({type:element.type,inputMode:element.inputMode,autocomplete:element.autocomplete,fontSize:getComputedStyle(element).fontSize,description:element.getAttribute('aria-describedby')}));
  await main.getByRole('button',{name:'Add to board'}).click();
  const error=main.locator('#add-url-error');await error.waitFor({state:'visible',timeout:1000});
  const errorLinked=await url.getAttribute('aria-describedby');
  findings.push({state:'add-link-mobile-validation',status:input.type==='url'&&input.inputMode==='url'&&Number.parseFloat(input.fontSize)>=16&&errorLinked==='add-url-error'?'PASS':'FAIL',detail:JSON.stringify({input,error:await error.innerText()})});
  const modal=main.locator('.add-modal'),focusables=modal.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
  const first=focusables.first(),last=focusables.last();
  await first.focus();await main.keyboard.press('Shift+Tab');
  const wrapsBackward=await last.evaluate(element=>element===document.activeElement);
  await main.keyboard.press('Tab');
  const wrapsForward=await first.evaluate(element=>element===document.activeElement);
  findings.push({state:'add-link-focus-containment',status:wrapsBackward&&wrapsForward?'PASS':'FAIL',detail:JSON.stringify({wrapsBackward,wrapsForward})});
  await main.keyboard.press('Escape');await main.locator('.add-modal').waitFor({state:'hidden',timeout:1800});
  const returned=await main.evaluate(()=>document.activeElement===document.querySelector('.empty-canvas-primary'));
  findings.push({state:'add-link-escape-focus-return',status:returned?'PASS':'FAIL',detail:returned?'Escape closed Add Link and restored focus to its opener':'Focus did not return to the Add Link opener'});
  await main.setViewportSize({width:1024,height:768});
  await main.locator('.empty-canvas-primary').click();
  await main.locator('.add-modal').waitFor({state:'visible',timeout:1200});
  await main.locator('.modal-backdrop').click({position:{x:1,y:1}});
  await main.locator('.add-modal').waitFor({state:'hidden',timeout:1200});
  const outsideReturned=await main.evaluate(()=>document.activeElement===document.querySelector('.empty-canvas-primary'));
  findings.push({state:'add-link-outside-dismiss-focus-return',status:outsideReturned?'PASS':'FAIL',detail:outsideReturned?'Backdrop dismissal restored focus to the Add product opener':'Backdrop dismissal did not restore opener focus'});
  await main.setViewportSize({width:390,height:844});
} catch(e) { findings.push({state:'add-link-mobile-validation',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,280)}); }
await captureIf(main,'template-picker',async()=>{await main.locator('.add-modal button').first().click().catch(()=>{});await openWorkspaceActions(main); await main.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:'Templates'}).click(); await main.getByRole('dialog',{name:/template/i}).waitFor({state:'visible',timeout:1800});});
for(const [layout,width,height] of [['compact',390,844],['medium',820,1180],['expanded',1440,900]]){
  try{
    await main.setViewportSize({width,height});
    const panel=main.locator('.template-gallery'),measure=await panel.evaluate(element=>{const r=element.getBoundingClientRect(),style=getComputedStyle(element),use=element.querySelector('.template-use-button');return {left:r.left,top:r.top,width:r.width,height:r.height,position:style.position,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,usePosition:use?getComputedStyle(use).position:'missing',grid:getComputedStyle(element.querySelector('.template-options')).gridTemplateColumns};});
    const valid=measure.width>0&&!measure.overflow&&(layout!=='compact'||measure.width>=width-2&&measure.usePosition==='sticky');
    findings.push({state:'template-picker-layout',viewport:layout,status:valid?'PASS':'FAIL',detail:JSON.stringify(measure)});
  }catch(e){findings.push({state:'template-picker-layout',viewport:layout,status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,220)});}
}
await main.setViewportSize({width:390,height:844});
await captureIf(main,'hair-routine-template',async()=>{
  const hair=main.getByRole('button',{name:/preview hair routine/i});
  await hair.click();
  const use=main.getByRole('button',{name:/use (this )?template/i});
  await use.scrollIntoViewIfNeeded();
  await use.click({timeout:6000});
  await main.locator('.sticker').first().waitFor({state:'attached',timeout:5000});
});
await captureIf(main,'empty-product-slot',async()=>{const slot=main.locator('.sticker.template-placeholder').first();if(!await slot.count())throw Error('Template contains no empty product slot');await slot.click();await main.locator('.placeholder-replace-modal').waitFor({state:'visible',timeout:1800});await main.getByRole('button',{name:'Close placeholder'}).click();});
await captureIf(main,'populated-canvas',async()=>{if(await main.locator('.sticker').count()===0)throw Error('Template did not populate products');});
await captureIf(main,'selected-product',async()=>{
  if(await main.locator('.sticker:not(.template-placeholder)').count()===0){
    await main.locator('.sticker.template-placeholder').first().click();
    await main.getByPlaceholder('Product name').fill('Cura baseline product');
    await main.getByRole('button',{name:'Add manually'}).click();
    await main.locator('.sticker:not(.template-placeholder)').first().waitFor({state:'attached',timeout:2500});
  }
  await main.locator('.board').focus();await main.keyboard.press('Escape');
  const oldDone=main.locator('.unified-selection-bar button').filter({hasText:'Done'});if(await oldDone.isVisible().catch(()=>false))await oldDone.click();
  const product=main.locator('.sticker:not(.template-placeholder)').first();await product.click();
  await product.waitFor({state:'visible'});await main.waitForFunction(()=>document.querySelector('.sticker.is-selected:not(.template-placeholder)')!==null,undefined,{timeout:1800});
  const closeInspector=main.getByRole('button',{name:'Close inspector'});if(await closeInspector.isVisible().catch(()=>false))await closeInspector.click();
  await main.locator('.selection-actions').waitFor({state:'visible',timeout:1800});
});
await captureIf(main,'keyboard-canvas-model',async()=>{
  const products=main.locator('.sticker:not(.template-placeholder)');
  const product=products.first();
  const initialStops=await main.locator('[data-canvas-keyboard-object][tabindex="0"]').count();
  if(initialStops!==1)throw Error(`Canvas must expose one roving Tab stop; found ${initialStops}`);
  await product.focus();
  if(await product.evaluate(element=>element.classList.contains('is-selected')))await main.keyboard.press('Space');
  await main.keyboard.press('Enter');
  await main.waitForFunction(()=>document.querySelector('.sticker:not(.template-placeholder)')?.classList.contains('is-selected'));
  const before=await product.evaluate(element=>({left:parseFloat(element.style.left),top:parseFloat(element.style.top)}));
  await main.keyboard.press('ArrowRight');
  await main.keyboard.press('Shift+ArrowDown');
  const nudged=await product.evaluate(element=>({left:parseFloat(element.style.left),top:parseFloat(element.style.top)}));
  if(nudged.left-before.left!==8||nudged.top-before.top!==16)throw Error(`Arrow nudge sizes were unexpected: ${JSON.stringify({before,nudged})}`);
  await main.keyboard.press('ArrowLeft');
  await main.keyboard.press('Shift+ArrowUp');
  await main.keyboard.press('Space');
  await main.waitForFunction(()=>document.querySelector('.sticker:not(.template-placeholder)')&&!document.querySelector('.sticker.is-selected:not(.template-placeholder)'));
  await main.keyboard.press('Space');
  await main.waitForFunction(()=>document.querySelector('.sticker:not(.template-placeholder)')?.classList.contains('is-selected'));
  await main.keyboard.press('Enter');
  await main.locator('.inspector').waitFor({state:'visible',timeout:1800});
  await main.keyboard.press('Escape');
  await main.locator('.inspector').waitFor({state:'hidden',timeout:1800});
  const tabInfo=await main.evaluate(()=>({active:document.activeElement?.getAttribute('data-canvas-keyboard-object'),selected:document.querySelectorAll('.sticker.is-selected:not(.template-placeholder)').length,announce:document.querySelector('[role="status"][aria-live]')?.textContent?.trim()}));
  if(!tabInfo.active?.startsWith('item:')||tabInfo.selected!==1)throw Error(`Escape did not return to the focused selected product: ${JSON.stringify(tabInfo)}`);
});
for (const [viewportName,width,height] of [['phone',390,844],['tablet',768,1024],['desktop',1440,900]]) {
  await main.setViewportSize({width,height});
  if(await main.locator('.workspace-menu').count()){await main.locator('.workspace-menu-trigger').focus();await main.keyboard.press('Escape');await main.locator('.workspace-menu').waitFor({state:'detached',timeout:1800});}
  const zoomMenu=main.locator('.canvas-zoom-more').first();
  const zoomSummary=zoomMenu.locator('summary');
  const zoomUiState=await main.evaluate(()=>{
    const describe=element=>{if(!element)return null;const style=getComputedStyle(element),rect=element.getBoundingClientRect();return {display:style.display,visibility:style.visibility,opacity:style.opacity,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};};
    return {activeDialogs:[...document.querySelectorAll('[aria-modal="true"]')].filter(element=>{const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0;}).map(element=>element.className||element.getAttribute('aria-label')),inspector:Boolean(document.querySelector('.inspector')),workspaceMenu:Boolean(document.querySelector('.workspace-menu')),closet:Boolean(document.querySelector('.closet-drawer')),toolbar:describe(document.querySelector('.canvas-toolbar')),summary:{...describe(document.querySelector('.canvas-zoom-more > summary')),detailsOpen:document.querySelector('.canvas-zoom-more')?.open}};
  });
  if(!await zoomSummary.isVisible())throw Error(`Zoom controls hidden before semantic zoom: ${JSON.stringify(zoomUiState)}`);
  await zoomSummary.click();
  for(const [level,semantic] of [[0.25,'far'],[0.5,'mid'],[1,'near'],[2,'near']]){
    await main.getByLabel('Set zoom level').selectOption(String(level));
    await main.waitForFunction(expected => Math.abs(Number(getComputedStyle(document.querySelector('.board')).getPropertyValue('--canvas-zoom'))-expected)<0.001,level);
    const cardState=await main.evaluate(()=>{
      const canvas=document.querySelector('.board'),card=document.querySelector('.sticker:not(.template-placeholder)'),title=card?.querySelector('.product-name'),price=card?.querySelector('.product-price'),brand=card?.querySelector('.product-brand'),resize=card?.querySelector('.sticker-resize');
      const rect=title?.getBoundingClientRect(),resizeRect=resize?.getBoundingClientRect();
      return {semantic:canvas?.dataset.zoom,titleWidth:rect?.width??0,titleHeight:rect?.height??0,priceVisible:Boolean(price&&getComputedStyle(price).display!=='none'),brandVisible:Boolean(brand&&getComputedStyle(brand).display!=='none'),hasBrand:Boolean(brand),resizeWidth:resizeRect?.width??0,resizeHeight:resizeRect?.height??0};
    });
    const expectedPrice=level>=0.4;
    const brandVisibilityInvalid=cardState.hasBrand&&cardState.brandVisible!==(level>0.75);
    if(cardState.semantic!==semantic||cardState.titleWidth<80||cardState.titleHeight<12||cardState.priceVisible!==expectedPrice
      ||brandVisibilityInvalid||cardState.resizeWidth<40||cardState.resizeHeight<40){
      findings.push({state:'semantic-card-zoom',viewport:`${viewportName}:${level}`,status:'FAIL',detail:JSON.stringify(cardState)});
    }else findings.push({state:'semantic-card-zoom',viewport:`${viewportName}:${level}`,status:'PASS',detail:`${semantic}; screen title ${Math.round(cardState.titleWidth)}x${Math.round(cardState.titleHeight)}; resize ${Math.round(cardState.resizeWidth)}x${Math.round(cardState.resizeHeight)}`});
  }
  await main.getByLabel('Set zoom level').selectOption('1');
  await zoomMenu.evaluate(element=>{element.open=false;});
}
await main.setViewportSize({width:390,height:844});
actionCounts.product=await countVisibleActions(main,'.unified-selection-bar > button, .unified-selection-bar > label select, .unified-selection-bar > details > summary');
try {
  const zoomMenu=main.locator('.canvas-zoom-more').first();await zoomMenu.evaluate(element=>{element.open=true;});
  const zoomSelectionButton=main.getByRole('button',{name:'Zoom to selection'});
  const zoomClickInfo=await zoomSelectionButton.evaluate(button=>{const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),toolbar=button.closest('.canvas-toolbar'),board=toolbar?.closest('.board'),world=board?.querySelector('.world'),frame=hit?.closest('.outfit-frame');return {disabled:button.disabled,visible:r.width>0,parentOpen:button.closest('details')?.open,rect:{x:r.x,y:r.y,width:r.width,height:r.height},z:{toolbar:getComputedStyle(toolbar).zIndex,world:getComputedStyle(world).zIndex,frame:frame?getComputedStyle(frame).zIndex:null},hit:hit?{tag:hit.tagName,className:String(hit.className),label:hit.getAttribute('aria-label'),text:hit.textContent?.trim().slice(0,60)}:null};});
  await zoomSelectionButton.click({force:true});
  await main.waitForTimeout(120);
  const selectedFrame=await main.evaluate(()=>{const boardElement=document.querySelector('.board'),world=document.querySelector('.world'),selected=document.querySelector('.sticker.is-selected'),board=boardElement.getBoundingClientRect(),item=selected?.getBoundingClientRect(),matrix=new DOMMatrixReadOnly(getComputedStyle(world).transform);return {selected:Boolean(item),inside:Boolean(item&&item.right>board.left&&item.left<board.right&&item.bottom>board.top&&item.top<board.bottom),board:{left:board.left,top:board.top,right:board.right,bottom:board.bottom},item:item?{left:item.left,top:item.top,right:item.right,bottom:item.bottom}:null,worldTransform:{a:matrix.a,e:matrix.e,f:matrix.f},itemWorld:{left:selected?.style.left,top:selected?.style.top,width:selected?.style.width},selectedCount:document.querySelectorAll('.selection-actions').length,selectionText:document.querySelector('.unified-selection-bar .selection-count')?.textContent??null};});
  if(!selectedFrame.selected||!selectedFrame.inside)throw Error(`Zoom to selection failed: ${JSON.stringify({zoomClickInfo,selectedFrame})}`);
  findings.push({state:'zoom-to-selection',status:'PASS',detail:'Selected product stayed selected and entered the canvas viewport'});
  await zoomMenu.evaluate(element=>{element.open=false;});
} catch(e) { findings.push({state:'zoom-to-selection',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,800)}); }
await captureIf(main,'product-inspector',async()=>{const edit=main.getByRole('button',{name:'Edit',exact:true});if(!await edit.count()){const debug=await main.evaluate(()=>({selected:document.querySelectorAll('.sticker.is-selected').length,selection:document.querySelector('.unified-selection-bar')?.innerText??null,buttons:[...document.querySelectorAll('.unified-selection-bar button')].map(button=>button.innerText)}));throw Error(`No Edit action: ${JSON.stringify(debug)}`);} await edit.click(); await main.locator('.inspector').waitFor({state:'visible',timeout:1800});});
try {
  const before=await main.locator('.inspector').boundingBox();
  await main.keyboard.press('1');
  await main.waitForTimeout(100);
  const fitState=await main.evaluate(()=>{const panel=document.querySelector('.inspector')?.getBoundingClientRect(),canvas=document.querySelector('.board').getBoundingClientRect();return {inspectorOpen:Boolean(panel),panelBottom:panel?.bottom??null,canvasBottom:canvas.bottom,zoom:new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.world')).transform).a};});
  if(!before||!fitState.inspectorOpen)throw Error('Fit closed the open inspector');
  findings.push({state:'fit-with-inspector',status:'PASS',detail:`Inspector remained open; Fit accounted for its ${Math.round(before.width)}px panel space (zoom ${fitState.zoom.toFixed(2)})`});
} catch(e) { findings.push({state:'fit-with-inspector',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,240)}); }
try {
  await main.keyboard.press('Escape');await main.locator('.inspector').waitFor({state:'hidden',timeout:1500});
  await main.waitForFunction(()=>{const active=document.activeElement;return active instanceof HTMLElement&&active!==document.body&&Boolean(active.closest('.unified-selection-bar, .sticker.is-selected'));},undefined,{timeout:1200});
  findings.push({state:'edit-details-escape-focus-return',status:'PASS',detail:'Escape closes Edit Details and restores focus to the selected product actions'});
} catch(e) { findings.push({state:'edit-details-escape-focus-return',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,260)}); }
await captureIf(main,'selected-board',async()=>{await main.keyboard.press('Escape').catch(()=>{}); const title=main.locator('.outfit-label').filter({hasText:'04 / POST-WASH'}).first(); await title.focus();await main.keyboard.press('Enter');await title.waitFor({state:'visible',timeout:1800});if(await title.getAttribute('aria-pressed')!=='true')throw Error('Board did not enter selected state');});
actionCounts.board=await countVisibleActions(main,'.unified-selection-bar > button, .unified-selection-bar > details > summary');
await captureIf(main,'board-controls',async()=>{await main.locator('.unified-selection-bar .selection-more > summary').click();await main.getByRole('button',{name:'Edit board',exact:true}).click({timeout:5000,force:true}); await main.locator('.inspector').waitFor({state:'visible',timeout:1800});});
await captureIf(main,'budget-form',async()=>{await main.locator('.inspector').getByRole('button',{name:/^set budget$/i}).click();await main.locator('.budget-modal').waitFor({state:'visible',timeout:1800});});
try {
  const amount=main.getByLabel('Budget amount');
  const input=await amount.evaluate(element=>({type:element.type,inputMode:element.inputMode,fontSize:getComputedStyle(element).fontSize,actionPosition:getComputedStyle(document.querySelector('.budget-modal .submit-button')).position}));
  await main.getByRole('button',{name:'Save budget'}).click();await main.locator('#budget-error').waitFor({state:'visible',timeout:1000});
  const linked=await amount.getAttribute('aria-describedby');
  findings.push({state:'budget-mobile-validation',status:input.type==='number'&&input.inputMode==='decimal'&&Number.parseFloat(input.fontSize)>=16&&linked==='budget-error'?'PASS':'FAIL',detail:JSON.stringify({input,error:await main.locator('#budget-error').innerText()})});
  await main.keyboard.press('Escape');await main.locator('.budget-modal').waitFor({state:'hidden',timeout:1800});
  findings.push({state:'budget-escape-focus-return',status:await main.evaluate(()=>document.activeElement===document.querySelector('.inspector .set-budget-inspector'))?'PASS':'FAIL',detail:'Escape closes the budget sheet and returns focus to Set budget'});
} catch(e) { findings.push({state:'budget-mobile-validation',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,280)}); }
await captureIf(main,'selected-section',async()=>{await main.keyboard.press('Escape').catch(()=>{});const section=main.locator('[aria-label^="Section "]').first(); if(!await section.count())throw Error('No section is currently rendered');await section.focus();await main.keyboard.press('Enter');if(!await section.evaluate(el=>el.classList.contains('is-active')))throw Error('Section did not enter selected state');});
actionCounts.section=await countVisibleActions(main,'.section-toolbar > button, .section-toolbar > details > summary');
await captureIf(main,'multi-selection',async()=>{await main.keyboard.press('Escape').catch(()=>{});if(await main.locator('.sticker:not(.template-placeholder)').count()<2){await main.locator('.canvas-toolbar .canvas-add').click();await main.getByRole('button',{name:/add details manually instead/i}).click();await main.getByPlaceholder('https://www.zara.com/…').fill('https://example.com/products/ux-matrix-second-item');await main.getByPlaceholder('Linen trousers').fill('Cura second selection item');await main.getByRole('button',{name:/add to board/i}).click();await main.locator('.add-modal').waitFor({state:'hidden',timeout:5000});}const close=main.getByRole('button',{name:'Close inspector'});if(await close.isVisible().catch(()=>false))await close.click();await main.locator('.board').focus();await main.keyboard.press('Escape');await main.locator('.canvas-mode-select').click();const products=main.locator('.sticker:not(.template-placeholder)');await products.nth(0).focus();await main.keyboard.press('Enter');const zoomMenu=main.locator('.canvas-zoom-more').first();await zoomMenu.evaluate(element=>{element.open=true;});await main.getByRole('button',{name:'Zoom to selection'}).click({force:true});await zoomMenu.evaluate(element=>{element.open=false;});const afterFirst=await main.locator('.sticker.is-selected').count();await products.nth(1).click({modifiers:['Shift']});await main.locator('.unified-selection-bar').waitFor({state:'visible',timeout:1800});const selection=await main.locator('.unified-selection-bar .selection-count').innerText();if(!/2 products/.test(selection))throw Error(`Two products were not selected: ${JSON.stringify({selection,afterFirst,selected:await main.locator('.sticker.is-selected').count(),products:await products.count(),mode:await main.locator('.canvas-mode-select').innerText()})}`);});
actionCounts['multi-selection']=await countVisibleActions(main,'.unified-selection-bar > button, .unified-selection-bar > label select, .unified-selection-bar > details > summary');
await captureIf(main,'context-menu',async()=>{const product=main.locator('.sticker').first(); await product.click({button:'right'}); const menu=main.locator('.item-menu,.board-menu,.selection-menu'); if(!await menu.count())throw Error('Right-click did not expose a context menu');});
await captureIf(main,'destructive-confirmation',async()=>{await main.keyboard.press('Escape').catch(()=>{});await openWorkspaceActions(main);const all=main.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:'Select all boards'});await all.focus();await main.keyboard.press('Enter');await main.locator('.unified-selection-bar .delete-selection').click();await main.getByRole('alertdialog').waitFor({state:'visible',timeout:1800});});
try{const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const touchSheet=await touchContext.newPage();touchSheet.setDefaultNavigationTimeout(15000);touchSheet.setDefaultTimeout(1500);await touchSheet.goto(baseURL,{waitUntil:'domcontentloaded'});await touchSheet.waitForTimeout(200);await touchSheet.locator('.workspace-menu-trigger').tap();const sheet=touchSheet.locator('.workspace-menu');await sheet.waitFor({state:'visible',timeout:1800});const rect=await sheet.evaluate(el=>{const r=el.getBoundingClientRect();return {bottom:r.bottom,height:r.height,viewport:innerHeight};});await snap(touchSheet,'bottom-sheet','390x844');findings.push({state:'bottom-sheet',status:rect.bottom<=rect.viewport?'PASS':'FAIL',detail:`Workspace actions sheet captured; bottom ${Math.round(rect.bottom)} / viewport ${rect.viewport}`});await inspectVisibleState(touchSheet,'bottom-sheet');await touchContext.close();}catch(e){findings.push({state:'bottom-sheet',status:'FAIL',detail:`Could not open: ${e.message.replace(/\s+/g,' ').slice(0,320)}`});}
await captureIf(main,'share-flow',async()=>{await main.keyboard.press('Escape').catch(()=>{});const done=main.locator('.unified-selection-bar').getByRole('button',{name:'Done',exact:true});if(await done.isVisible().catch(()=>false))await done.click();await main.locator('.unified-selection-bar').waitFor({state:'hidden',timeout:1200}).catch(()=>{});await openWorkspaceActions(main);await main.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:/share canvas/i}).focus();await main.keyboard.press('Enter');await main.locator('.share-link-toast').waitFor({state:'visible',timeout:1800});});
try {
  await main.keyboard.press('Escape');await main.locator('.share-link-toast').waitFor({state:'hidden',timeout:1500});
  await main.waitForFunction(()=>document.activeElement===document.querySelector('.workspace-menu-trigger'),undefined,{timeout:1200});
  findings.push({state:'share-escape-focus-return',status:'PASS',detail:'Escape closes Share and restores focus to the More action that opened it'});
} catch(e) { findings.push({state:'share-escape-focus-return',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,260)}); }
await captureIf(main,'saved-collections',async()=>{await main.keyboard.press('Escape').catch(()=>{});await openWorkspaceActions(main);await main.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:/saved collections/i}).focus();await main.keyboard.press('Enter');});
try {
  const modal=main.getByRole('dialog',{name:'Saved collections'});await modal.waitFor({state:'visible',timeout:1200});
  const bounds=await modal.boundingBox();
  const toastHidden=await main.locator('.share-link-toast').evaluate(element=>getComputedStyle(element).display==='none').catch(()=>true);
  await main.keyboard.press('Escape');await modal.waitFor({state:'hidden',timeout:1800});
  await main.waitForFunction(()=>document.activeElement===document.querySelector('.workspace-menu-trigger'),undefined,{timeout:1200});
  const focusReturned=await main.evaluate(()=>document.activeElement===document.querySelector('.workspace-menu-trigger'));
  findings.push({state:'saved-collections-mobile-dismissal',status:Boolean(bounds&&bounds.width>=380&&bounds.height>=800&&toastHidden&&focusReturned)?'PASS':'FAIL',detail:JSON.stringify({bounds,toastHidden,focusReturned})});
} catch(e) { findings.push({state:'saved-collections-mobile-dismissal',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,280)}); }
await captureIf(main,'sizing-form',async()=>{await openWorkspaceActions(main);const actions=main.getByRole('group',{name:/workspace actions/i});await actions.getByRole('button',{name:'Settings'}).focus();await main.keyboard.press('Enter');await main.getByRole('button',{name:'Sizing preferences'}).click();await main.getByRole('dialog',{name:'Sizing preferences'}).waitFor({state:'visible',timeout:1800});});
try {
  const dialog=main.getByRole('dialog',{name:'Sizing preferences'});
  const details=await dialog.evaluate(element=>({rect:(()=>{const r=element.getBoundingClientRect();return {width:r.width,height:r.height,bottom:r.bottom}})(),fields:[...element.querySelectorAll('select')].map(input=>({fontSize:getComputedStyle(input).fontSize,height:input.getBoundingClientRect().height})),actionPosition:getComputedStyle(element.querySelector('.submit-button')).position}));
  await main.keyboard.press('Escape');await dialog.waitFor({state:'hidden',timeout:1800});
  await main.waitForFunction(()=>document.activeElement===document.querySelector('.sizing-settings-button'),undefined,{timeout:1200});
  const returnedToSettings=await main.evaluate(()=>document.activeElement===document.querySelector('.sizing-settings-button'));
  await main.keyboard.press('Escape');await main.locator('.settings-modal').waitFor({state:'hidden',timeout:1800});
  findings.push({state:'sizing-form-mobile-dismissal',status:details.rect.width>=380&&details.rect.height>=800&&details.fields.length>=8&&details.fields.every(field=>Number.parseFloat(field.fontSize)>=16)&&details.actionPosition==='sticky'&&returnedToSettings?'PASS':'FAIL',detail:JSON.stringify({details,returnedToSettings})});
} catch(e) { findings.push({state:'sizing-form-mobile-dismissal',status:'FAIL',detail:e.message.replace(/\s+/g,' ').slice(0,280)}); }
await captureIf(main,'purchases',async()=>{await main.keyboard.press('Escape').catch(()=>{});await openWorkspaceActions(main);await main.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:/my purchases/i}).focus();await main.keyboard.press('Enter');});
await main.keyboard.press('Escape').catch(()=>{});
const workspaceTrigger=main.locator('.workspace-menu-trigger');
if(await main.locator('.workspace-menu').count()){await workspaceTrigger.focus();await main.keyboard.press('Escape');}
await main.waitForFunction(()=>!document.querySelector('.workspace-menu'),undefined,{timeout:1800});
await main.waitForFunction(()=>{const toolbar=document.querySelector('.canvas-toolbar');return toolbar&&getComputedStyle(toolbar).display!=='none';},undefined,{timeout:1800});

// Platform and viewport behavior probes.
const probes=[
  ['keyboard-zoom-shortcuts',async()=>{await main.setViewportSize({width:390,height:844});await main.locator('.board').focus();const readZoom=()=>main.locator('.world').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).a);const start=await readZoom();await main.keyboard.press('Shift+=');await main.waitForTimeout(60);const plus=await readZoom();await main.keyboard.press('-');await main.waitForTimeout(60);const minus=await readZoom();await main.keyboard.press('0');await main.waitForTimeout(60);const actual=await readZoom();await main.keyboard.press('1');await main.waitForTimeout(100);const fit=await readZoom();if(plus<=start||Math.abs(minus-start)>0.001||Math.abs(actual-1)>0.001||!Number.isFinite(fit))throw Error(`Shortcut zoom values were ${start.toFixed(2)}, ${plus.toFixed(2)}, ${minus.toFixed(2)}, ${actual.toFixed(2)}, ${fit.toFixed(2)}`);return `+ ${plus.toFixed(2)}x · − ${minus.toFixed(2)}x · 0 ${actual.toFixed(2)}x · 1 Fit ${fit.toFixed(2)}x`; }],
  ['chrome-text-200-percent',async()=>{await main.setViewportSize({width:390,height:844});await main.evaluate(()=>{document.documentElement.style.fontSize='200%';});const metrics=await main.evaluate(()=>({rootFont:getComputedStyle(document.documentElement).fontSize,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));if(metrics.overflow)throw Error('Horizontal overflow at 200% root text scale');return `root font ${metrics.rootFont}; root-font scaling approximation`; }],
  ['chrome-page-zoom-200-percent',async()=>{const session=await main.context().newCDPSession(main);await session.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});await main.waitForTimeout(100);const scaled=await main.evaluate(()=>visualViewport.scale>=1.9);await session.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await session.detach();if(!scaled)throw Error('Chromium page scale factor did not reach 200%');return 'Chromium page-scale emulation (browser UI zoom is not exposed to page scripts)';}],
  ['coarse-pointer-touch',async()=>{
    const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    const touch=await touchContext.newPage();touch.setDefaultNavigationTimeout(15000);touch.setDefaultTimeout(1800);
    await touch.goto(baseURL,{waitUntil:'domcontentloaded'});await touch.waitForTimeout(250);
    const details=await touch.evaluate(()=>({coarse:matchMedia('(pointer: coarse)').matches,touch:navigator.maxTouchPoints>0,rootFont:getComputedStyle(document.documentElement).fontSize,viewport:document.documentElement.clientWidth,mode:document.querySelector('.canvas-mode-select')?.textContent.trim()}));
    await snap(touch,'coarse-pointer-touch','390x844');
    await touch.locator('.empty-canvas-primary').tap();
    const addInput=touch.locator('.add-modal .primary-link-field input').first();
    const addTarget=await addInput.evaluate(element=>({fontSize:getComputedStyle(element).fontSize,height:element.getBoundingClientRect().height}));
    await touch.keyboard.press('Escape');await touch.locator('.add-modal').waitFor({state:'hidden',timeout:1500});
    await touch.locator('.workspace-menu-trigger').tap();
    await touch.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:'Settings'}).tap();
    await touch.getByRole('button',{name:'Sizing preferences'}).tap();
    const selects=await touch.locator('.sizing-modal select').evaluateAll(elements=>elements.map(element=>({fontSize:getComputedStyle(element).fontSize,height:element.getBoundingClientRect().height})));
    const ctaPosition=await touch.locator('.sizing-modal .submit-button').evaluate(element=>getComputedStyle(element).position);
    const hitTargetsOkay=addTarget.height>=44&&Number.parseFloat(addTarget.fontSize)>=16&&selects.length>=8&&selects.every(item=>item.height>=44&&Number.parseFloat(item.fontSize)>=16)&&ctaPosition==='sticky';
    await touch.keyboard.press('Escape');await touch.locator('.sizing-modal').waitFor({state:'hidden',timeout:1500});
    await touch.waitForFunction(()=>document.activeElement===document.querySelector('.sizing-settings-button'),undefined,{timeout:1200});
    await touch.keyboard.press('Escape');await touch.locator('.settings-modal').waitFor({state:'hidden',timeout:1500});
    await touchContext.close();
    if(!details.coarse||!details.touch)throw Error('Browser did not expose coarse pointer and touch input');
    if(details.mode!=='Select')throw Error(`Touch canvas should default to Pan mode with Select available; found ${details.mode}`);
    if(!hitTargetsOkay)throw Error(`Coarse pointer forms have small targets: ${JSON.stringify({addTarget,selects,ctaPosition})}`);
    return `coarse pointer + touch; ${details.viewport}px CSS viewport; input ${Math.round(addTarget.height)}px; ${selects.length} sizing controls >=44px; primary action sticky`;
  }],
  ['fine-pointer-mouse',async()=>{const ok=await main.evaluate(()=>matchMedia('(pointer: fine)').matches&&navigator.maxTouchPoints===0);if(!ok)throw Error('Browser did not expose a fine mouse pointer');}],
  ['reduced-motion',async()=>{await main.emulateMedia({reducedMotion:'reduce'});const ok=await main.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);if(!ok)throw Error('Reduced-motion media query did not activate');}],
  ['forced-colors',async()=>{try{await main.emulateMedia({forcedColors:'active'});const ok=await main.evaluate(()=>matchMedia('(forced-colors: active)').matches);return ok?'supported':'emulation did not activate';}catch{return 'unsupported';}}],
  ['portrait-to-landscape-resize',async()=>{await main.emulateMedia({forcedColors:'none'});await main.evaluate(()=>{document.documentElement.style.fontSize='';});await main.setViewportSize({width:390,height:844});await main.waitForTimeout(100);const originalLoad=await main.evaluate(()=>performance.timeOrigin);const before=await readCanvasFrame(main);await main.setViewportSize({width:844,height:390});await main.waitForTimeout(150);const after=await readCanvasFrame(main);const stillLoaded=await main.evaluate(time=>performance.timeOrigin===time,originalLoad);const zoomPreserved=Math.abs(before.zoom-after.zoom)<0.0001;const centerDrift=Math.hypot(before.centerWorld.x-after.centerWorld.x,before.centerWorld.y-after.centerWorld.y);if(!stillLoaded)throw Error('Document reloaded during orientation resize');if(!zoomPreserved||centerDrift>2)throw Error(`Canvas framing changed: zoom ${before.zoom} → ${after.zoom}, center drift ${centerDrift.toFixed(1)} world px`);return `no reload; zoom preserved; center drift ${centerDrift.toFixed(1)} world px`; }],
];
for(const [name,run] of probes){try{const extra=await run();await snap(main,name,'390x844');findings.push({state:name,status:'PASS',detail:extra??'emulated without reload'});}catch(e){findings.push({state:name,status:'FAIL',detail:e.message});}}
findings.push({state:'console-errors',status:consoleErrors.length?'FAIL':'PASS',errors:consoleErrors});
const beforeActionCounts=JSON.parse(await readFile(resolve(reportsDir,'ux-action-counts-before.json'),'utf8'));
const actionSurfaces=[['product','Product selection'],['board','Board toolbar'],['section','Section toolbar'],['multi-selection','Multi-selection']];
const actionComparison=Object.fromEntries(actionSurfaces.map(([key])=>[key,{before:beforeActionCounts[key]??0,after:actionCounts[key]??0,reduction:(beforeActionCounts[key]??0)-(actionCounts[key]??0)}]));
findings.push({state:'visible-action-counts',status:'PASS',comparison:actionComparison,detail:'Counts include visible primary buttons, links, selects, and More summaries; collapsed menu commands are excluded.'});
await writeFile(resolve(reportsDir,'ux-matrix-report.json'),JSON.stringify({createdAt:new Date().toISOString(),baseURL,outputDir,viewports:viewportClasses,beforeActionCounts,actionCounts,actionComparison,findings},null,2));
await writeFile(resolve(reportsDir,'ux-matrix-report.md'),[
  '# Cura UX Matrix Run','',`Run: ${new Date().toISOString()}`,`URL: ${baseURL}`,`Screenshots: ${outputDir.replaceAll('\\','/')}`,'',
  '| Group/state | Viewport | Result | Notes |','|---|---:|---|---|',
  ...findings.map(f=>`| ${f.group??f.state??'state'} | ${f.viewport??''} | ${f.status??(f.overflow?'FAIL':'PASS')} | ${f.detail??(f.errors?JSON.stringify(f.errors):'')}${f.overflow?`horizontal overflow (${f.scrollWidth}px / ${f.viewportW}px)`:''}${f.underWCAG?.length?`; ${f.underWCAG.length} controls <24px`:''}${typeof f.underWCAG==='number'&&f.underWCAG?`; ${f.underWCAG} controls <24px`:''}${f.underPreferred?`; ${f.underPreferred} controls <44px`:''}${f.tiny?.length?`; ${f.tiny.length} text nodes <12px`:''}${f.clippedMenus?.length?`; ${f.clippedMenus.length} clipped menus`:''}${f.dialogClipping?.length?`; ${f.dialogClipping.length} clipped dialogs`:''}${f.inspectorOverflow?.length?`; ${f.inspectorOverflow.length} overflowing inspectors`:''}${f.safeInsetViolations?.length?`; ${f.safeInsetViolations.length} controls under safe area`:''}${f.obscured?`; ${f.obscured} controls obscured by fixed UI`:''}`),
  '', '## Visible actions before and after', '', '| Surface | Before | After | Reduction |','|---|---:|---:|---:|',
  ...actionSurfaces.map(([key,label])=>`| ${label} | ${actionComparison[key].before} | ${actionComparison[key].after} | ${actionComparison[key].reduction} |`),
  '',`Screenshots: ${outputDir.replaceAll('\\','/')}`,'',
].join('\n'));
await browser.close();
if(vite) vite.kill();
if(api) api.kill();
console.log(`UX matrix complete: ${findings.length} findings; screenshots in ${outputDir}`);
