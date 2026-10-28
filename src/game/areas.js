// Loads every game area once, so each registers its state checks, and joins the pieces that
// cross areas: politics' definition kinds, the list of daily steps, and the hooks follow-ups use
// to reach character activity.
import { registerDefinitionDomain, hasDefinitionDomain } from '../domains/definitions/index.js';
import '../domains/characters/index.js';
import '../domains/groups/index.js';
import '../domains/control/index.js';
import { dailySteps as financeSteps } from '../domains/finance/index.js';
import '../domains/inventory/index.js';
import { DEFINITION_DOMAIN_SPECS } from '../domains/politics/index.js';
import '../domains/relations/index.js';
import '../domains/memories/index.js';
import { dailySteps as followupSteps } from '../domains/followups/index.js';
import { dailySteps as settlementSteps } from '../domains/settlements/index.js';
import '../domains/world/index.js';
import { applyRoleEffects, collectDueCharacters, processCharacter } from '../domains/characters/index.js';

for (const [domainId, spec] of Object.entries(DEFINITION_DOMAIN_SPECS)) {
  if (!hasDefinitionDomain(domainId)) registerDefinitionDomain(domainId, spec);
}

// Characters handled per day by the activity phase of follow-ups.
const ACTIVITY_BUDGET = 128;

// Settlements (orders 200-270), then finance (500), then follow-ups (900).
export const DAILY_STEPS = Object.freeze([...settlementSteps, ...financeSteps, ...followupSteps]);

export const DAILY_CONTEXT = Object.freeze({
  followups: {
    effectHandlers: {
      activity_roles: { touches: ['npcActivityProfiles'], apply: (draft, effect) => applyRoleEffects(draft, effect) },
    },
    activity: {
      dueCharacterIds: (state, day) => collectDueCharacters(state, day, ACTIVITY_BUDGET).map((profile) => profile.characterId),
      process: (draft, characterId, day) => processCharacter(draft, { characterId, currentDay: day }),
    },
  },
});
