import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartNewOver, describeFailure, describeUnreadableSave } from '../../src/ui/messages.js';
import { openFresh } from './ui-helpers.mjs';
import { enqueueConstruction, previewConstruction } from '../../src/domains/settlements/index.js';

test('[ui.messages.failure-keeps-code] every message names the failure code, also for wrapped and unknown failures', () => {
  assert.match(describeFailure({ ok: false, error: 'save_conflict' }), /\(save_conflict\)$/);
  const wrapped = describeFailure({ ok: false, error: 'daily_step_failed', detail: { day: 4, step: 'x.y', cause: { ok: false, error: 'finance_invalid_amount' } } });
  assert.match(wrapped, /4일/);
  assert.match(wrapped, /\(daily_step_failed > finance_invalid_amount\)$/);
  assert.match(describeFailure({ ok: false, error: 'something_new_and_unknown' }), /\(something_new_and_unknown\)$/);
  assert.match(describeFailure(undefined), /알 수 없는 오류/);
});

test('[ui.messages.settlement-refusals-explain] a real construction refusal is explained with what is missing', () => {
  const { campaign } = openFresh();
  const state = campaign.getState();
  const preview = previewConstruction(state, { settlementId: 'test_city', buildingId: 'farmland_expansion' });
  assert.equal(preview.ok, true);
  const refused = campaign.store.transact('enqueue', (draft) => enqueueConstruction(draft, { settlementId: 'test_city', buildingId: 'farmland_expansion' }));
  assert.equal(refused.ok, false);
  const text = describeFailure(refused);
  assert.match(text, /목재 16/, text);
  assert.match(text, /settlements_insufficient_cost/);
  const blocked = campaign.store.transact('enqueue', (draft) => enqueueConstruction(draft, { settlementId: 'test_city', buildingId: 'iron_mine' }));
  assert.match(describeFailure(blocked), /철광석 광산|iron_mine|지을 수 없습니다/);
  assert.match(describeFailure(blocked), /mountain/);
});

test('[ui.messages.save-failures-explain] conflict, newer version and damaged saves each get their own reason', () => {
  const conflict = describeFailure({ ok: false, error: 'save_conflict', detail: { stored: 5, known: 2 } });
  const newer = describeFailure({ ok: false, error: 'save_refused_newer_version_stored' });
  const damaged = describeFailure({ ok: false, error: 'save_refused_stored_save_unreadable', detail: { cause: 'save_not_json' } });
  assert.equal(new Set([conflict, newer, damaged]).size, 3);
  assert.match(conflict, /다른 곳/);
  assert.match(newer, /새로운 버전/);
  assert.match(damaged, /손상/);
  assert.match(describeUnreadableSave({ ok: false, error: 'save_not_json' }), /JSON/);
  assert.match(describeUnreadableSave({ ok: false, error: 'save_state_invalid', detail: ['calendar'] }), /calendar/);
});

test('[ui.messages.new-start-not-offered-over-newer-save] starting over is offered for damaged saves but never over a newer version\'s save', () => {
  assert.equal(canStartNewOver({ ok: false, error: 'save_not_json' }), true);
  assert.equal(canStartNewOver({ ok: false, error: 'save_digest_mismatch' }), true);
  assert.equal(canStartNewOver({ ok: false, error: 'save_from_newer_version' }), false);
  assert.equal(canStartNewOver({ ok: false, error: 'v1_key_holds_newer_version' }), false);
  assert.equal(canStartNewOver({ ok: false, error: 'storage_unavailable' }), false);
});
