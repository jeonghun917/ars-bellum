export const M2_CONFIG = Object.freeze({
  schemaVersion: 1,
  phase: "M2-1/01",
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
  backgroundColor: 0x172026,
  groundColor: 0x4f5845,
  allyColor: 0x4f7fa4,
  enemyColor: 0xa4524c,
  playerMarkerColor: 0xd7b85b,
  camera: Object.freeze({ fov: 48, near: 0.1, far: 250, x: 11, y: 9, z: 15 }),
  baseTree: "57fbd34c729ddf2ee16506270a272f415f94fb1e"
});

export function m2Receipt(ok, data = {}) {
  return Object.freeze({ ok: Boolean(ok), ...data });
}
