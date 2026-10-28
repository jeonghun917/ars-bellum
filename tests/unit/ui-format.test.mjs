import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount, formatClock, formatCost, formatDays, formatInt, speedLabel } from '../../src/ui/format.js';

test('[ui.format.clock-and-numbers] the clock shows day and hour with two digits; numbers read the same in every locale', () => {
  assert.equal(formatClock({ day: 3, hour: 7, minute: 5 }), '3일 07:05');
  assert.equal(formatClock({ day: 120, hour: 23, minute: 59 }), '120일 23:59');
  assert.equal(formatInt(1500), '1,500');
  assert.equal(formatInt(2499.9), '2,499');
  assert.equal(formatInt(-1234567), '-1,234,567');
  assert.equal(formatInt(0), '0');
  assert.equal(formatAmount(12.34), '12.3');
  assert.equal(formatAmount(1800), '1,800');
  assert.equal(formatAmount(0.04), '0');
  assert.equal(speedLabel(0), '일시정지');
  assert.equal(speedLabel(4), '4배속');
});

test('[ui.format.days-never-promise-more-than-there-is] days of food are rounded down, and unknown shows a dash', () => {
  assert.equal(formatDays(10), '10');
  assert.equal(formatDays(2.99), '2.9');
  assert.equal(formatDays(0.05), '0');
  assert.equal(formatDays(null), '-');
});

test('[ui.format.cost-names-goods] a cost is written with the goods\' Korean names, gold first', () => {
  assert.equal(formatCost({ gold: 180, resources: { timber: 24, planks: 12 } }), '금 180, 목재 24, 판재 12');
  assert.equal(formatCost({ gold: 0, resources: {} }), '없음');
});
