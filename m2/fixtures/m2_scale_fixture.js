// A larger battle for measuring how the 3D battle scales (M2_SPEC: 100 against 100 is measured, not required
// to pass a frame-rate gate). The same kinds as the 20-against-20 fixture, more of them: each side has two
// lines of foot, two loose bands of crossbowmen and one body of horse (the "column" formation, drawn up in a
// line on the flank so the horses stand inside the field). Built, not written out, so any size
// can be asked for; the 20-against-20 fixture (m2_technical_fixture_v1.js) stays as it is.
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from "./m2_technical_fixture_v1.js";

export { M2_TECHNICAL_COMBAT_PROFILES as M2_SCALE_COMBAT_PROFILES };

// How a side's men are shared out: two lines, two bands of crossbowmen, one column of horse.
const SHARES = Object.freeze([
  { suffix: "line", share: 0.3, type: "line", at: { x: -6, z: 0 } },
  { suffix: "line_2", share: 0.3, type: "line", at: { x: 6, z: 0 } },
  { suffix: "loose", share: 0.15, type: "loose", at: { x: -6, z: -6 } },
  { suffix: "loose_2", share: 0.15, type: "loose", at: { x: 6, z: -6 } },
  { suffix: "column", share: 0.1, type: "line", at: { x: -24, z: -2 } }
]);

function rotate(x, z, facing) {
  return { x: x * Math.cos(facing) + z * Math.sin(facing), z: -x * Math.sin(facing) + z * Math.cos(facing) };
}

// Formation places as the battle lays them out (the fixture's own rule for line, column and loose).
function places(ids, type, anchor, facing, spacing) {
  const sorted = [...ids].sort();
  const out = new Map();
  if (type === "line" || type === "column") {
    const centre = (sorted.length - 1) / 2;
    sorted.forEach((id, i) => {
      const o = type === "line" ? rotate((i - centre) * spacing, 0, facing) : rotate(0, (centre - i) * spacing, facing);
      out.set(id, { x: anchor.x + o.x, z: anchor.z + o.z });
    });
  } else {
    const columns = Math.ceil(Math.sqrt(sorted.length));
    const rows = Math.ceil(sorted.length / columns);
    const loose = spacing * 1.6;
    sorted.forEach((id, i) => {
      const o = rotate(((i % columns) - (columns - 1) / 2) * loose, ((rows - 1) / 2 - Math.floor(i / columns)) * loose, facing);
      out.set(id, { x: anchor.x + o.x, z: anchor.z + o.z });
    });
  }
  return out;
}

// A battle of perSide against perSide (20 to 100: larger armies would stand past the retreat edges), the two lines `gap` metres apart (each side's
// crossbowmen and horse behind its lines, inside its retreat edge at 18 m).
export function buildScaleSnapshot({ perSide = 100, gap = 16 } = {}) {
  const formations = [];
  const characters = [];
  for (const side of ["ally", "enemy"]) {
    const facing = side === "ally" ? Math.PI : 0;
    const back = side === "ally" ? 1 : -1;
    let made = 0;
    SHARES.forEach((share, index) => {
      const count = index === SHARES.length - 1 ? perSide - made : Math.round(perSide * share.share);
      made += count;
      const formationId = `${side}_${share.suffix}`;
      const ids = Array.from({ length: count }, (_, i) => `scale_${side}_${share.suffix}_${String(i + 1).padStart(3, "0")}`);
      if (side === "ally" && index === 0) ids[0] = M2_TECHNICAL_SNAPSHOT.playerCharacterId;
      const anchor = { x: share.at.x * (side === "ally" ? -1 : 1), z: back * (gap / 2 - share.at.z) };
      formations.push({ formationId, sideId: side, commanderUnitId: ids[ids.length > 1 ? 1 : 0], memberUnitIds: ids, anchor, facing, formationTypeId: share.type, spacing: 1.25, order: "hold" });
      const at = places(ids, share.type, anchor, facing, 1.25);
      ids.forEach((id, i) => {
        characters.push({
          characterId: id,
          displayName: id,
          sideId: side,
          formationId,
          roleId: id === M2_TECHNICAL_SNAPSHOT.playerCharacterId ? "player_commander" : (i === 1 ? "major_npc" : "unit_test"),
          combatProfileId: side === "ally"
            ? (id === M2_TECHNICAL_SNAPSHOT.playerCharacterId ? "profile_player_test" : "profile_ally_captain_test")
            : (i === 1 ? "profile_enemy_commander_test" : "profile_enemy_guard_test"),
          spawn: { ...at.get(id), heading: facing }
        });
      });
    });
  }
  return {
    schemaVersion: 1,
    battleId: `m2_scale_${perSide}v${perSide}`,
    seed: M2_TECHNICAL_SNAPSHOT.seed,
    sourceScope: "M2_TEST_ONLY",
    canonical: false,
    playerCharacterId: M2_TECHNICAL_SNAPSHOT.playerCharacterId,
    source: { ...M2_TECHNICAL_SNAPSHOT.source },
    formations,
    characters
  };
}
