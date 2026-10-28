// Plain formatting helpers (no DOM), so they can be tested in Node.
import { getResource } from '../domains/settlements/index.js';

export const SPEED_CHOICES = Object.freeze([0, 1, 2, 4]);
export const speedLabel = (speed) => (speed === 0 ? '일시정지' : `${speed}배속`);

const pad2 = (n) => String(n).padStart(2, '0');

// "3일 14:05": the day number and the clock.
export const formatClock = (calendar) => `${calendar.day}일 ${pad2(calendar.hour)}:${pad2(calendar.minute)}`;

// Whole numbers with thousands separators written by hand, so the text never depends on the browser's locale.
export function formatInt(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return '0';
  return String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/^/, n < 0 ? '-' : '');
}

// Amounts of goods and gold may have decimals (stock is kept to 4 places); show at most 1.
export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(Math.abs(n) * 10) / 10;
  const [whole, fraction] = String(rounded).split('.');
  const sign = n < 0 && rounded !== 0 ? '-' : '';
  return `${sign}${formatInt(Number(whole))}${fraction ? `.${fraction}` : ''}`;
}

export const resourceName = (id) => getResource(id)?.name ?? id;

// { gold: 180, resources: { timber: 24 } } -> "금 180, 목재 24"
export function formatCost(cost) {
  const parts = [];
  if (cost?.gold > 0) parts.push(`금 ${formatAmount(cost.gold)}`);
  for (const [id, amount] of Object.entries(cost?.resources ?? {})) parts.push(`${resourceName(id)} ${formatAmount(amount)}`);
  return parts.length ? parts.join(', ') : '없음';
}

// Days of food: whole when whole, else one decimal rounded down (never promise more than there is).
export function formatDays(days) {
  if (days === null || days === undefined || !Number.isFinite(days)) return '-';
  const floored = Math.floor(days * 10) / 10;
  return Number.isInteger(floored) ? String(floored) : floored.toFixed(1);
}
