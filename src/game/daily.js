// Runs daily processing for every day that has ended and not been processed yet, in order.
// Each day is one transaction: if any step fails, that day (and every later one) stays unprocessed
// and lastProcessedDay does not move, so the next attempt resumes at the same day.
import { ok, fail } from '../core/result.js';

export function sortSteps(steps) {
  const names = new Set();
  for (const step of steps) {
    if (names.has(step.name)) throw new Error(`duplicate daily step: ${step.name}`);
    names.add(step.name);
  }
  return [...steps].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function runDueDays(store, steps, context = {}) {
  const ordered = sortSteps(steps);
  const processed = [];
  for (;;) {
    const state = store.getState();
    const day = state.lastProcessedDay + 1;
    if (day >= state.calendar.day) return ok({ processed });
    const result = store.transact(`day ${day}`, (draft) => {
      for (const step of ordered) {
        const outcome = step.run(draft, day, context);
        if (outcome && outcome.ok === false) return fail('daily_step_failed', { day, step: step.name, cause: outcome });
      }
      draft.lastProcessedDay = day;
      return ok();
    });
    if (!result.ok) return { ...result, processed };
    processed.push(day);
  }
}
