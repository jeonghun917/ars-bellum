// One animation frame of the campaign: move the player's group, then let game time run.
//
// Movement first: stepMovement reads the group and returns what this frame changes. Only a patch
// is committed, in one transaction; a frame that changes nothing (standing still, paused) commits
// nothing. Time then advances through campaign.advanceMinutes, which runs every game day that ended.
import { moveGroup, stepMovement, defaultWorld } from '../domains/world/index.js';
import { MAX_FRAME_MS } from './pacer.js';

// Returns { event, minutes, processedDays, failure }.
//   event          the 'arrived' / 'blocked' event of the movement step, or null
//   minutes        game minutes handed to advanceMinutes this frame
//   processedDays  days the daily processing finished this frame
//   failure        the first failure met (movement or daily processing), or null
export function runFrame({ campaign, groupId, realDtMs, pacer, world = defaultWorld, retryDays = false }) {
  const out = { event: null, minutes: 0, processedDays: [], failure: null };
  const state = campaign.getState();
  const speed = state.clock.speed;

  if (speed > 0 && realDtMs > 0 && groupId) {
    const group = state.world.mobileGroups[groupId];
    const dtSeconds = (Math.min(realDtMs, MAX_FRAME_MS) / 1000) * speed;
    const step = group ? stepMovement(group, dtSeconds, world) : { ok: false, error: 'world_unknown_group' };
    if (!step.ok) {
      out.failure = step;
    } else {
      out.event = step.event;
      if (step.patch) {
        const stored = campaign.store.transact('move group', (draft) => moveGroup(draft, { groupId, patch: step.patch }, { world }));
        if (!stored.ok) {
          out.failure = stored;
          out.event = null;
        }
      }
    }
  }

  // After a failed day, advanceMinutes(0) tries the unprocessed days again.
  const minutes = pacer.take(realDtMs, speed, state.clock.realMsPerGameMinute);
  if (minutes > 0 || retryDays) {
    out.minutes = minutes;
    const advanced = campaign.advanceMinutes(minutes);
    if (advanced.ok) out.processedDays = advanced.processed;
    else {
      out.processedDays = advanced.processed ?? [];
      out.failure = out.failure ?? advanced;
    }
  }
  return out;
}
