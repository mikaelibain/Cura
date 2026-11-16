import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
const { chromium } = await import('playwright');
const baseURL = process.env.UX_BASE_URL ?? 'http://127.0.0.1:5173';
let vite;
const errors = [];

async function isUp() { try { return (await fetch(baseURL)).ok; } catch { return false; } }
if (!(await isUp())) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'], { stdio:'ignore', windowsHide:true });
  for (let i=0; i<60 && !(await isUp()); i++) await delay(300);
  if (!(await isUp())) throw new Error(`Vite did not become available at ${baseURL}`);
}

const browser = await chromium.launch({ headless:true });
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('cura-link-only-board-v3')));
async function useHair(page) {
  const direct = page.getByRole('button',{name:'Templates',exact:true});
  if (await direct.isVisible().catch(()=>false)) await direct.click();
  else {
    await page.getByRole('button',{name:/more/i}).click();
    await page.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:'Templates'}).click();
  }
  const picker=page.getByRole('dialog',{name:/canvas template/i});
  await picker.getByRole('button',{name:/preview hair routine/i}).click();
  await picker.getByRole('button',{name:/use template/i}).click();
  await page.locator('.canvas-section').waitFor({state:'visible'});
  await page.waitForTimeout(100);
}
async function makePage(options) {
  const page=await browser.newPage(options);
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'{}'}));
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:'domcontentloaded'});
  await useHair(page);
  return page;
}
const closeBoardEditor = async page => { const close=page.getByRole('button',{name:'Close inspector'}); if(await close.isVisible().catch(()=>false)) await close.click(); };
const touch = async (cdp,type,x,y,id=1) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id}]});

try {
  const desktop=await makePage({viewport:{width:1440,height:900}});
  let state=await saved(desktop);
  assert.equal(state.sections.length,1);
  assert.equal(state.outfits.length,5);
  assert.equal(state.sections[0].boardIds.length,5);
  const section=desktop.locator('.canvas-section').first();
  const heading=section.locator('.section-heading');
  const title=section.locator('.section-title');

  await title.click();
  assert.ok(await section.evaluate(el=>el.classList.contains('is-active')),'a single click selects the section');
  assert.equal(await section.locator('.section-heading-copy input').count(),0,'selection does not start text editing');
  assert.equal(await desktop.locator('.section-mobile-editor').count(),0,'selection does not open the mobile editor');
  await desktop.getByRole('button',{name:'Rename',exact:true}).click();
  const sectionTitle=desktop.getByRole('textbox',{name:'Section title'});
  assert.ok(await sectionTitle.isVisible());
  await sectionTitle.fill('My Hair Edit');
  await sectionTitle.press('Enter');
  state=await saved(desktop);
  assert.equal(state.sections[0].title,'My Hair Edit');

  await section.locator('.section-subtitle').dblclick();
  const subtitle=desktop.getByRole('textbox',{name:'Section subtitle'});
  assert.ok(await subtitle.isVisible(),'double-clicking the subtitle enters edit mode');
  await subtitle.fill('My optional steps');
  await subtitle.press('Enter');
  await desktop.getByRole('button',{name:'Style',exact:true}).click();
  await desktop.getByRole('combobox',{name:'Section style'}).selectOption('sage');
  state=await saved(desktop);
  assert.equal(state.sections[0].subtitle,'My optional steps');
  assert.equal(state.sections[0].style,'sage');

  const beforeMove=state;
  let band=await heading.boundingBox();
  const bandStartX=Math.min(band.x+band.width-10, desktop.viewportSize().width-20);
  await desktop.mouse.move(bandStartX,band.y+band.height/2);
  await desktop.mouse.down();
  await desktop.mouse.move(bandStartX+35,band.y+band.height/2+24,{steps:5});
  await desktop.mouse.up();
  await desktop.waitForTimeout(120);
  state=await saved(desktop);
  const dx=state.sections[0].x-beforeMove.sections[0].x;
  const dy=state.sections[0].y-beforeMove.sections[0].y;
  assert.ok(dx>0&&dy>0,'the section header band moves the section');
  assert.equal(state.sections[0].width,beforeMove.sections[0].width);
  assert.equal(state.sections[0].height,beforeMove.sections[0].height);
  const memberBoard=state.outfits.find(outfit=>beforeMove.sections[0].boardIds.includes(outfit.id));
  const oldBoard=beforeMove.outfits.find(outfit=>outfit.id===memberBoard.id);
  assert.equal(memberBoard.customLeft,oldBoard.customLeft+dx);
  const memberItem=state.items.find(item=>memberBoard.itemIds.includes(item.id));
  const oldItem=beforeMove.items.find(item=>item.id===memberItem.id);
  assert.equal(memberItem.x,oldItem.x+dx);

  await section.focus();
  await desktop.keyboard.press('Escape');
  assert.equal(await section.evaluate(el=>el.classList.contains('is-active')),false,'Escape clears section selection');
  await title.click();
  await desktop.locator('.section-toolbar .section-more summary').click();
  await desktop.getByRole('button',{name:'Remove frame',exact:true}).click();
  assert.equal((await saved(desktop)).sections.length,0,'removing the frame leaves board data available for separate selection');
  const boardTitle=desktop.getByRole('button',{name:'04 / POST-WASH',exact:true});
  await boardTitle.click({position:{x:12,y:12}});
  assert.equal(await boardTitle.getAttribute('aria-pressed'),'true','a board title click selects the board');
  assert.equal(await desktop.locator('.inspector:visible').count(),0,'selection does not open board editing');
  assert.ok(await desktop.locator('.unified-selection-bar').isVisible(),'the selected board exposes the shared selection toolbar');
  await desktop.locator('.unified-selection-bar .selection-more > summary').click();
  await desktop.getByRole('button',{name:'Edit board',exact:true}).click();
  assert.ok(await desktop.locator('.inspector').isVisible(),'Edit board opens board controls');
  assert.equal(await desktop.getByRole('tablist',{name:'Inspector sections'}).getByRole('tab').count(),2,'inspector has only Details and Look tabs');
  await desktop.getByRole('tab',{name:'Look'}).click();
  assert.ok(await desktop.locator('.inspector-look').isVisible(),'board Look tab contains its appearance controls');
  await desktop.getByRole('tab',{name:'Details'}).click();
  await closeBoardEditor(desktop);

  await boardTitle.dblclick({position:{x:12,y:12}});
  const boardName=desktop.getByRole('textbox',{name:'Board title'});
  assert.ok(await boardName.isVisible(),'double-clicking the board title enters rename mode');
  await boardName.fill('Pre-wash edit');
  await boardName.press('Enter');
  state=await saved(desktop);
  assert.equal(state.outfits.find(outfit=>outfit.name==='Pre-wash edit')?.name,'Pre-wash edit');
  await desktop.close();

  const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const phone=await phoneContext.newPage();
  phone.setDefaultTimeout(7000);
  phone.setDefaultNavigationTimeout(15000);
  phone.on('pageerror',error=>errors.push(error.message));
  await phone.route('**/api/**',route=>route.fulfill({status:503,body:'{}'}));
  await phone.goto(baseURL,{waitUntil:'domcontentloaded'});
  await phone.evaluate(()=>localStorage.clear());
  await phone.reload({waitUntil:'domcontentloaded'});
  await useHair(phone);
  const touchSection=phone.locator('.canvas-section').first();
  const touchTitle=touchSection.locator('.section-title');
  await touchTitle.tap({position:{x:20,y:12}});
  assert.ok(await touchSection.evaluate(el=>el.classList.contains('is-active')),'one tap selects a section');
  assert.equal(await phone.locator('.section-mobile-editor').count(),0,'one tap leaves the compact editor closed');
  const toolbar=phone.locator('.section-toolbar');
  for(const control of [toolbar.getByRole('button',{name:'Rename'}),toolbar.getByRole('button',{name:'Style'}),toolbar.locator('summary')]) {
    const box=await control.boundingBox();
    assert.ok(box&&box.width>=44&&box.height>=44,'section toolbar touch controls are at least 44 by 44 CSS pixels');
  }
  await toolbar.getByRole('button',{name:'Style'}).click();
  assert.ok(await phone.locator('.section-mobile-editor').isVisible(),'Style opens the compact mobile editor');
  await phone.getByRole('button',{name:'Close section editor'}).click();
  await toolbar.getByRole('button',{name:'Rename'}).click();
  assert.ok(await phone.locator('.section-mobile-editor').isVisible(),'Rename opens the compact mobile editor');
  const touchTitleInput=phone.getByRole('textbox',{name:'Section title'});
  await touchTitleInput.fill('Touch Hair Edit');
  await phone.getByRole('button',{name:'Close section editor'}).tap();
  state=await saved(phone);
  assert.equal(state.sections[0].title,'Touch Hair Edit');

  const header=touchSection.locator('.section-heading');
  await phone.locator('.workspace-menu-trigger').tap();
  await phone.getByRole('group',{name:/workspace actions/i}).getByRole('button',{name:'Select all boards',exact:true}).tap();
  assert.equal(await touchSection.evaluate(el=>el.classList.contains('is-active')),false,'board selection clears section activation');
  await phone.locator('.board-bulk-heading button[aria-label="Finish selecting boards"]').tap();
  await touchTitle.tap({position:{x:20,y:12}});
  assert.ok(await touchSection.evaluate(el=>el.classList.contains('is-active')),'a touch can select the section again');
  await phone.locator('.canvas-mode-select').tap();
  const headerBox=await header.boundingBox();
  assert.ok(headerBox.height>=44,'coarse-pointer section header remains a touch-sized move band');
  const cdp=await phoneContext.newCDPSession(phone);
  const tx=Math.min(headerBox.x+headerBox.width-12,phone.viewportSize().width-20),ty=headerBox.y+headerBox.height/2;
  const beforeTouchMove=state.sections[0].x;
  await touch(cdp,'touchStart',tx,ty);
  await touch(cdp,'touchMove',tx+35,ty+18);
  await touch(cdp,'touchEnd',tx+35,ty+18);
  await phone.waitForTimeout(120);
  state=await saved(phone);
  assert.ok(state.sections[0].x>beforeTouchMove,'a touch drag from the header band moves the section');

  assert.ok(await touchSection.evaluate(el=>el.classList.contains('is-active')),'the section remains selected after it is moved');
  assert.equal(await phone.locator('.section-mobile-editor').count(),0,'selecting a child board does not open section editing');
  assert.deepEqual(errors,[]);
  console.log('Section and board interaction checks passed: tap/select, explicit edit, touch-size toolbar, touch header move, snapshot coordinate preservation, Escape, section and board rename, board controls, and child selection isolation.');
  await phoneContext.close();
} finally {
  await browser.close();
  if(vite) vite.kill();
}
