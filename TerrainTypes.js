const TerrainTypes = {
    plain: { name: '평지', h: 0, obs: false, speedMult: 1.0, buildable: true },
    forest: { name: '숲', h: 0, obs: false, speedMult: 0.5, buildable: false }, // 💡 통과 가능, 속도만 50% 감속!
    hill: { name: '능선', h: 1, obs: false, speedMult: 0.8, buildable: true },
    highland: { name: '고원', h: 2, obs: false, speedMult: 0.9, buildable: true },
    cliff: { name: '절벽', h: 2, obs: true, speedMult: 0.0, buildable: false },
    wall: { name: '성벽', h: 3, obs: true, speedMult: 0.0, buildable: true, destructible: true },
    stairs: { name: '계단/성문', h: 1, obs: false, speedMult: 1.0, buildable: false }
};
