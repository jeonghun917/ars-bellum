// The starting state of a new campaign: one wandering player character with a travel group,
// 10 travel rations and 500 gold. Record shapes match what the earlier version saved, so its saves
// load into the same structure.
import { seedFrom } from '../core/rng.js';

export const SCHEMA_VERSION = 2;
export const PLAYER_CHARACTER_ID = 'legacy_player_character';
export const PLAYER_GROUP_ID = 'legacy_player_group';
export const PLAYER_INVENTORY_ID = 'legacy_player_group_inventory';
export const PLAYER_ACCOUNT_ID = 'legacy_player_personal_account';

export const SKILL_IDS = Object.freeze([
  'athletics', 'bow', 'charm', 'command', 'crossbow', 'diplomacy', 'engineering', 'intrigue', 'leadership', 'learning',
  'logistics', 'medicine', 'one_handed', 'polearm', 'riding', 'scouting', 'stewardship', 'tactics', 'throwing', 'trade', 'two_handed',
]);
export const APTITUDE_IDS = Object.freeze(['administration', 'combat', 'command', 'mobility', 'scholarship', 'social']);

const zeroes = (ids) => Object.fromEntries(ids.map((id) => [id, 0]));
const characterRef = (id) => ({ id, type: 'character' });

export function newCharacter({ id, name, mobileGroupId = null, personalAccountId = null, birthDay = 0 }) {
  return {
    id, version: 1, revision: 0,
    identity: { alive: true, birthDay, cultureId: null, deathDay: null, faithId: null, name },
    affiliations: { clanId: null, factionId: null, legalStatusId: null },
    aptitudes: Object.fromEntries(APTITUDE_IDS.map((aptitude) => [aptitude, 1])),
    skills: zeroes(SKILL_IDS),
    progression: { records: [], repetition: {}, skillExperience: zeroes(SKILL_IDS), sourceTotals: { action: 0, education: 0, event: 0, role: 0 } },
    condition: { fatigue: 0, health: 100, incapacitated: false, injuries: [], wounded: false },
    location: { mode: mobileGroupId ? 'mobile_group' : 'none', mobileGroupId, prisonerOfId: null, settlementId: null },
    standing: { legitimacy: 0, prestige: 0, reputation: 0 },
    claimIds: [], offices: [], titleIds: [], traits: [],
    personalAccountId, personalInventoryId: null, customData: {},
  };
}

export function newGameState({ seed = 1, createdAt = '1970-01-01T00:00:00.000Z' } = {}) {
  const name = '이름 없는 방랑자';
  const character = newCharacter({ id: PLAYER_CHARACTER_ID, name, mobileGroupId: PLAYER_GROUP_ID, personalAccountId: PLAYER_ACCOUNT_ID });
  character.customData = { migrationIdentity: 'legacy_player' };
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    saveId: 'campaign_default',
    createdAt,
    calendar: { day: 1, hour: 8, minute: 0 },
    lastProcessedDay: 0,
    clock: { speed: 1, realMsPerGameMinute: 1000 },
    prefs: { worldScale: 1, battleScale: 1 },
    rng: seedFrom(seed),
    playerControl: {
      version: 1, revision: 0, controlStatus: 'active', currentCharacterId: PLAYER_CHARACTER_ID,
      campaignClanId: null, designatedSuccessorIds: [], permanentlyReleasedCharacterIds: [],
    },
    world: {
      characters: { [PLAYER_CHARACTER_ID]: character },
      mobileGroups: {
        [PLAYER_GROUP_ID]: {
          id: PLAYER_GROUP_ID, version: 1, revision: 0, name, groupTypeId: 'character_group',
          memberCharacterIds: [PLAYER_CHARACTER_ID], memberRefs: [],
          legalOwnerRef: characterRef(PLAYER_CHARACTER_ID), legalCommanderRef: characterRef(PLAYER_CHARACTER_ID),
          actingCommanderRef: characterRef(PLAYER_CHARACTER_ID), commandAuthorityRef: null, commandStructureId: 'single_commander',
          employerRef: null, paymasterRef: null, loyaltyAnchorRefs: [], cohesion: 100,
          inventoryId: PLAYER_INVENTORY_ID, treasuryAccountId: null,
          worldPosition: { x: 1000, y: 1000 },
          movement: { baseSpeed: 180, currentSpeed: 180, targetNode: null, targetX: 1000, targetY: 1000 },
          transport: { assetRefs: [], capacityVolumeL: 0, capacityWeightKg: 0 },
          specializedState: {}, customData: {},
        },
      },
      inventories: {
        [PLAYER_INVENTORY_ID]: {
          id: PLAYER_INVENTORY_ID, version: 1, revision: 0, ownerRef: { id: PLAYER_GROUP_ID, type: 'mobile_group' },
          bulkItems: { travel_rations: 10 }, equipmentItems: [], assignedCargo: [], capacity: { volumeL: 0, weightKg: 0 }, customData: {},
        },
      },
      finance: {
        accounts: {
          [PLAYER_ACCOUNT_ID]: {
            id: PLAYER_ACCOUNT_ID, version: 1, revision: 0, accountTypeId: 'personal', currencyId: 'gold', balance: 500,
            ownerRef: characterRef(PLAYER_CHARACTER_ID), authorizedSpenders: [], budgetPolicyId: null, frozen: false,
            lastTransactionId: null, legalRegimeId: null, reserveTarget: 0,
            customData: { m18CampaignMetrics: { manpower: 0, territory: 0, version: 1 } },
          },
        },
        debts: {},
        transfers: {},
      },
      clans: {}, factions: {}, titles: {}, landRights: {}, settlements: {},
      customDefinitions: { version: 1, revision: 0, records: {} },
      relationships: { version: 1, revision: 0, records: {}, indexes: { from: {}, to: {} }, appliedEffects: {} },
      memories: { version: 1, revision: 0, records: {}, ownerIndex: {} },
      npcActivityProfiles: { version: 1, revision: 0, records: {} },
      m1Followups: {
        version: 1, revision: 0, maxRecords: 8192, records: {},
        orchestration: { activityProcessedCharacterIds: [], catchUpTargetDay: null, cursorDay: null, cursorPhase: null, followupCursorKey: null, lastOrchestratedDay: 0 },
      },
    },
    legacy: {},
  };
}
