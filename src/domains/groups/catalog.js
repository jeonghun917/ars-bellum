// The built-in kinds of mobile group and command structure. Approved custom definitions in
// world.customDefinitions add to them.
import { registerDefinitionDomain } from '../definitions/index.js';

export const GROUP_TYPES = Object.freeze([
  { id: 'character_group', capabilityTags: ['named_members', 'travel'] },
  { id: 'military_party', capabilityTags: ['named_members', 'troops', 'combat', 'travel'] },
  { id: 'caravan', capabilityTags: ['cargo', 'travel'] },
  { id: 'envoy_group', capabilityTags: ['diplomacy', 'travel'] },
  { id: 'civilian_group', capabilityTags: ['civilian', 'travel'] },
]);

export const COMMAND_STRUCTURES = Object.freeze([{ id: 'single_commander' }, { id: 'delegated_command' }]);

const isTagList = (tags) => Array.isArray(tags) && tags.every((tag) => typeof tag === 'string' && tag.length > 0);

registerDefinitionDomain('mobile_group_type', {
  validate: (data) => (data.capabilityTags === undefined || isTagList(data.capabilityTags) ? [] : ['invalid_capability_tags']),
  defaults: GROUP_TYPES.map((type) => ({ ...type, capabilityTags: [...type.capabilityTags] })),
});

registerDefinitionDomain('command_structure', {
  defaults: COMMAND_STRUCTURES.map((structure) => ({ ...structure })),
});
