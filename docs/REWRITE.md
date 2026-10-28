# How the rewritten code is organised

This is the working agreement for code under `src/`. The old game files at the repository root
keep running until each area is moved over; nothing under `src/` may depend on them.

## State
- All persistent game state is one plain-JSON object owned by `src/core/store.js`
  (shape: `src/game/new-game.js`). No Map, Set, Date or class instances in it.
- The `world` part keeps the record shapes the earlier version saved (so its saves convert as-is).
  A record shape may change only together with a step in `src/persist/` that converts old saves.
- Read state with `store.getState()` (frozen). Change it only inside `store.transact(label, change)`.
  `change(draft)` edits the draft freely; returning a failure (`fail(...)`) or throwing discards the
  whole draft. So a rule that fails part-way needs no undo code.

## Game areas (`src/domains/<area>/`)
Each area is a folder with plain ES modules, no globals, no `window`, no DOM:
- `rules.js` — the area's actions as functions on a draft: `doThing(draft, input, context)` returns
  `ok({...})` or `fail('area_reason', detail)`. Validate every input first. A caller that gets a
  failure returns it unchanged, so the whole transaction is discarded.
- `checks.js` — `checkArea(state)` returns `ok()` or `fail(...)` for that area's records; the area's
  `index.js` registers it with `registerAreaCheck` from `src/persist/schema.js`.
- `index.js` — re-exports what other code may use. Other areas import only from `index.js`.
- Areas may read each other's records through those exports, and change another area's records only
  through that area's rules.
- Daily work: export `dailySteps` = `[{ order, name, run(draft, day, context) }]`; the daily runner
  calls every step for each ended day in `order` and fails the whole day if one step fails.
- Randomness only through `draw(draft.rng)` from `src/core/rng.js`. Time only from `draft.calendar`.
  No `Math.random`, no `Date.now()` in rules.
- Failure codes are `area_reason` snake_case strings, stable once written.

## Tests (`tests/unit/<area>.test.mjs`, node:test)
- Every test name starts with its check id in brackets: `[finance.transfer.all-or-nothing] ...`.
  The id is `<area>.<thing>.<case>` in lowercase with dashes.
- Every id is listed in `tests/checks.json` (`kind: "unit"`); `npm test` fails on a missing or
  unlisted id.
- Test behaviour, not source text. For each rule, include the failure cases (bad input, not enough
  money, missing record) and assert that a failed rule changed nothing.
- Before relying on a test, break the code it guards once and see it fail.

## Style
- Plain, readable JavaScript; one statement per line; normal formatting (no compressed one-liners).
- Comments say why, not what. Keep files focused; split by meaning, not by line count.
