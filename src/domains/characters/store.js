// Finding and touching character records in a draft, shared by the character rules.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { isStoredId } from '../definitions/index.js';
import { isCount } from './shape.js';

export function loadCharacter(draft, characterId, expectedRevision) {
  if (!isStoredId(characterId)) return fail('characters_invalid_character_id');
  if (expectedRevision !== undefined && !isCount(expectedRevision)) return fail('characters_invalid_expected_revision');
  const character = draft.world.characters[characterId];
  if (!Object.hasOwn(draft.world.characters, characterId) || !isRecord(character)) return fail('characters_missing_character', { characterId });
  if (expectedRevision !== undefined && character.revision !== expectedRevision) {
    return fail('characters_revision_conflict', { characterId, revision: character.revision });
  }
  return ok({ character });
}

// Every successful change to a character raises its revision by one.
export function touch(character) {
  character.revision += 1;
}
