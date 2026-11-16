import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { canMakeEditableCopy, freshQuotaState, grantRewardedImports, quotaStatus, recordSuccessfulImport, registerFreeAccount } from '../src/importQuota.ts';
import { copyBoardToCanvas, copyItemsToCanvas, makeEditableCopy, saveCollectionReference } from '../src/sharing.ts';

const url = (number) => `https://shop.example/products/item-${number}`;

test('guest import 10 succeeds, attempt 11 requires signup, and pending URL survives', () => {
  let state = freshQuotaState('guest', new Date('2026-09-20'));
  for (let index = 1; index <= 10; index += 1) {
    assert.equal(quotaStatus(state, url(index), new Date('2026-09-20')).allowed, true);
    state = recordSuccessfulImport(state, url(index), new Date('2026-09-20'));
  }
  const blocked = quotaStatus(state, url(11), new Date('2026-09-20'));
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'signup-required');
  const pending = { ...state, pendingUrl: url(11) };
  assert.equal(registerFreeAccount(pending).pendingUrl, url(11));
});

test('guest warnings begin at 8 and do not block the tenth import', () => {
  let state = freshQuotaState();
  for (let index = 1; index <= 8; index += 1) state = recordSuccessfulImport(state, url(index));
  assert.match(quotaStatus(state, url(9)).warning ?? '', /2 automatic imports remaining/);
  state = recordSuccessfulImport(state, url(9));
  assert.match(quotaStatus(state, url(10)).warning ?? '', /1 automatic import remaining/);
  assert.equal(quotaStatus(state, url(10)).allowed, true);
});

test('free account supports 30 monthly imports and four explicit five-import rewards up to 50', () => {
  let state = freshQuotaState('free', new Date('2026-09-20'));
  for (let index = 1; index <= 30; index += 1) state = recordSuccessfulImport(state, url(index), new Date('2026-09-20'));
  assert.equal(quotaStatus(state, url(31), new Date('2026-09-20')).allowed, false);
  for (let reward = 0; reward < 4; reward += 1) state = grantRewardedImports(state);
  assert.equal(state.rewardGrants, 4);
  for (let index = 31; index <= 50; index += 1) state = recordSuccessfulImport(state, url(index), new Date('2026-09-20'));
  assert.equal(quotaStatus(state, url(51), new Date('2026-09-20')).allowed, false);
  assert.equal(grantRewardedImports(state).rewardGrants, 4);
});

test('free warnings include 25 of 30 and one remaining at 29', () => {
  let state = freshQuotaState('free');
  for (let index = 1; index <= 25; index += 1) state = recordSuccessfulImport(state, url(index));
  assert.match(quotaStatus(state, url(26)).warning ?? '', /5 automatic imports remaining/);
  for (let index = 26; index <= 29; index += 1) state = recordSuccessfulImport(state, url(index));
  assert.match(quotaStatus(state, url(30)).warning ?? '', /1 automatic import remaining/);
  assert.equal(quotaStatus(state, url(30)).allowed, true);
});

test('known canonical product is not charged again and deletion cannot refund usage', () => {
  let state = recordSuccessfulImport(freshQuotaState(), 'https://www.shop.example/product/1?utm_source=first');
  const used = state.guestUsed;
  state = recordSuccessfulImport(state, 'https://shop.example/product/1?utm_source=again');
  assert.equal(state.guestUsed, used);
  assert.equal(state.importedProductKeys.length, 1);
});

test('monthly counters reset without erasing durable known-product keys', () => {
  const september = recordSuccessfulImport(freshQuotaState('free', new Date('2026-09-20')), url(1), new Date('2026-09-20'));
  const october = quotaStatus(september, url(2), new Date('2026-10-01'));
  assert.equal(october.used, 0);
  assert.equal(quotaStatus(september, url(1), new Date('2026-10-01')).remaining, Number.POSITIVE_INFINITY);
});

test('copy, save, board reuse and editable copies remain outside product-import accounting', () => {
  const item = { id: 'i1', sourceUrl: url(1), x: 10, y: 20, notes: '', createdAt: 'now' };
  const board = { items: [item], outfits: [{ id: 'b1', itemIds: ['i1'] }] };
  const quota = freshQuotaState();
  copyItemsToCanvas({ items: [], outfits: [] }, [item]);
  copyBoardToCanvas({ items: [], outfits: [] }, board, 'b1');
  makeEditableCopy(board, 'owner', 'shared');
  saveCollectionReference({ id: 'shared', title: 'Shared', ownerId: 'owner', createdAt: 'now', canvas: board }, []);
  assert.equal(quota.guestUsed, 0);
  assert.equal(canMakeEditableCopy(quota), true);
  assert.equal(canMakeEditableCopy({ ...quota, editableCopyLimit: 0 }), false);
});

test('quota checks remain fast with 200 canvas-scale canonical products and impose no hard cap', () => {
  let state = { ...freshQuotaState('free'), rewardGrants: 4 };
  const started = performance.now();
  for (let index = 1; index <= 200; index += 1) state = { ...state, importedProductKeys: [...state.importedProductKeys, url(index)] };
  for (let index = 1; index <= 200; index += 1) quotaStatus(state, url(index));
  assert.ok(performance.now() - started < 500);
  assert.equal(state.importedProductKeys.length, 200);
});
