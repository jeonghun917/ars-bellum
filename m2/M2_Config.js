export const M2_CONFIG = Object.freeze({
  schemaVersion: 1,
  phase: "M2-1/03",
  fixedTickHz: 20,
  fixedTickMs: 50,
  maxFrameDeltaMs: 250,
  maxCatchUpTicks: 5,
  defaultTimeScale: 1,
  spatialCellSize: 3.5,
  unitMaxSpeed: 3.2,
  formationDefaultSpacing: 1.25,
  arrivalEpsilon: 0.025,
  qualityProfile: "PROFILE_A",
  backgroundColor: 0xc4d3d6,
  groundColor: 0x5d7343,
  allyColor: 0x3f78b0,
  enemyColor: 0xb54a3f,
  playerMarkerColor: 0xd7b85b,
  projectileAllyColor: 0xe8d58b,
  projectileEnemyColor: 0xe29b8f,
  camera: Object.freeze({ fov: 48, near: 0.1, far: 250, x: 11, y: 9, z: 15 }),
  baseTree: "57fbd34c729ddf2ee16506270a272f415f94fb1e"
});

export function m2Receipt(ok, data = {}) {
  return Object.freeze({ ok: Boolean(ok), ...data });
}
