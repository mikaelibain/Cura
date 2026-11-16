import assert from 'node:assert/strict';
import test from 'node:test';
import { itemsWithVerifiedPrices } from '../src/commercePricing.mjs';

test('estimated listing values are excluded from board and spent totals until confirmed', () => {
  const items = [
    { id: 'verified', price: 30, priceEstimated: false },
    { id: 'estimate', price: 130, priceEstimated: true },
    { id: 'missing', price: null, priceEstimated: false },
  ];
  const included = itemsWithVerifiedPrices(items);
  assert.deepEqual(included.map((item) => item.id), ['verified']);
  assert.equal(included.reduce((sum, item) => sum + item.price, 0), 30);
});
