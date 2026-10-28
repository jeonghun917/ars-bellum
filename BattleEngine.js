class BattleEngine {
    constructor() {}

    getDamageMultiplier(attacker, defender) {
        if (defender.squad.subType !== 'shield') return 1.0;

        let angleToAttacker = Math.atan2(
            attacker.y - defender.y,
            attacker.x - defender.x
        );

        let facingAngle = defender.squad.angle;
        let angleDiff = Math.abs(angleToAttacker - facingAngle);

        angleDiff = Math.abs(
            Math.atan2(
                Math.sin(angleDiff),
                Math.cos(angleDiff)
            )
        );

        if (angleDiff < Math.PI / 3) return 0.2;

        return 1.0;
    }

    getRangedProfile(soldier) {
        if (!soldier || !soldier.squad) {
            return null;
        }

        if (soldier.squad.subType === 'archer') {
            return {
                range: 250,
                heightRangeBonus: 50,
                cooldownMin: 1.5,
                cooldownMax: 2.0,
                damage: Number(soldier.rangedDmg) || Number(soldier.dmg) || 1,
                armorPierce: Math.max(
                    0,
                    Math.min(
                        1,
                        Number(soldier.armorPierce) || 0
                    )
                ),
                vfxColor: '#e67e22'
            };
        }

        if (soldier.squad.subType === 'crossbow') {
            return {
                range: 220,
                heightRangeBonus: 35,
                cooldownMin: 2.4,
                cooldownMax: 3.0,
                damage: Number(soldier.rangedDmg) || Number(soldier.dmg) || 1,
                armorPierce: Math.max(
                    0,
                    Math.min(
                        1,
                        Number(soldier.armorPierce) || 0.8
                    )
                ),
                vfxColor: '#9b59b6'
            };
        }

        return null;
    }

    updateRangedAttacks(
        squads,
        allSoldiers,
        renderer,
        terrain
    ) {
        allSoldiers.forEach(
            (attacker) => {
                if (
                    attacker.hp <= 0 ||
                    attacker.attackCooldown > 0
                ) {
                    return;
                }

                const rangedProfile =
                    this.getRangedProfile(attacker);

                if (!rangedProfile) {
                    return;
                }

                const ammo =
                    Number(attacker.ammo);

                if (
                    Number.isFinite(ammo) &&
                    ammo <= 0
                ) {
                    return;
                }

                const enemyUnits =
                    squads
                        .filter(
                            squad =>
                                squad.team !==
                                    attacker.squad.team &&
                                squad.units.length > 0
                        )
                        .flatMap(
                            squad =>
                                squad.units.filter(
                                    unit =>
                                        unit.hp > 0
                                )
                        );

                let target = null;
                let minimumDistance =
                    Infinity;

                enemyUnits.forEach(
                    enemy => {
                        const distance =
                            Math.hypot(
                                enemy.x -
                                    attacker.x,
                                enemy.y -
                                    attacker.y
                            );

                        if (
                            distance <
                            minimumDistance
                        ) {
                            minimumDistance =
                                distance;

                            target =
                                enemy;
                        }
                    }
                );

                if (!target) {
                    return;
                }

                const attackerCell =
                    terrain
                        ? terrain.getAt(
                            attacker.x,
                            attacker.y
                        )
                        : {
                            h: 0
                        };

                const targetCell =
                    terrain
                        ? terrain.getAt(
                            target.x,
                            target.y
                        )
                        : {
                            h: 0
                        };

                const heightBonus =
                    Math.max(
                        0,
                        Number(attackerCell.h || 0) -
                            Number(targetCell.h || 0)
                    );

                const maximumRange =
                    rangedProfile.range +
                    heightBonus *
                        rangedProfile
                            .heightRangeBonus;

                const distance =
                    Math.hypot(
                        target.x -
                            attacker.x,
                        target.y -
                            attacker.y
                    );

                const hasLineOfSight =
                    !terrain ||
                    typeof terrain.raycast !==
                        'function' ||
                    terrain.raycast(
                        attacker.x,
                        attacker.y,
                        target.x,
                        target.y
                    );

                if (
                    distance >= maximumRange ||
                    !hasLineOfSight
                ) {
                    return;
                }

                const blockMultiplier =
                    this.getDamageMultiplier(
                        attacker,
                        target
                    );

                const targetArmor =
                    Math.max(
                        0,
                        Number(target.armor) ||
                            0
                    );

                const effectiveArmor =
                    targetArmor *
                    (
                        1 -
                        rangedProfile
                            .armorPierce
                    );

                const heightDamageMultiplier =
                    1 +
                    heightBonus *
                        0.5;

                const actualDamage =
                    Math.max(
                        1,
                        rangedProfile.damage -
                            effectiveArmor
                    ) *
                    blockMultiplier *
                    heightDamageMultiplier;

                target.hp -=
                    actualDamage;

                if (
                    Number.isFinite(ammo)
                ) {
                    attacker.ammo =
                        Math.max(
                            0,
                            ammo - 1
                        );
                }

                attacker.attackCooldown =
                    rangedProfile.cooldownMin +
                    Math.random() *
                    (
                        rangedProfile.cooldownMax -
                        rangedProfile.cooldownMin
                    );

                if (
                    renderer &&
                    typeof renderer.addVFX ===
                        'function'
                ) {
                    if (
                        Math.random() <
                        0.4
                    ) {
                        if (
                            blockMultiplier <
                            1
                        ) {
                            renderer.addVFX(
                                'text',
                                target.x,
                                target.y,
                                'BLOCKED!',
                                '#bdc3c7'
                            );
                        } else {
                            renderer.addVFX(
                                'text',
                                target.x,
                                target.y,
                                `-${actualDamage.toFixed(1)}`,
                                rangedProfile
                                    .vfxColor
                            );
                        }
                    }

                    renderer.addVFX(
                        'impact',
                        target.x,
                        target.y
                    );
                }
            }
        );
    }

    update(
        squads,
        dt,
        renderer,
        terrain
    ) {
        if (dt === 0) return;

        let allSoldiers =
            squads.flatMap(
                squad =>
                    squad.units.length > 0
                        ? squad.units
                        : []
            );

        this.updateRangedAttacks(
            squads,
            allSoldiers,
            renderer,
            terrain
        );

        for (
            let i = 0;
            i < allSoldiers.length;
            i++
        ) {
            for (
                let j = i + 1;
                j < allSoldiers.length;
                j++
            ) {
                let u1 =
                    allSoldiers[i];

                let u2 =
                    allSoldiers[j];

                // A soldier killed earlier this frame (by arrows or an earlier pair) neither strikes,
                // charges, is struck nor pushes others.
                if (u1.hp <= 0 || u2.hp <= 0) continue;

                let dx =
                    u2.x -
                    u1.x;

                let dy =
                    u2.y -
                    u1.y;

                let dist =
                    Math.hypot(
                        dx,
                        dy
                    );

                let engageDist =
                    u1.radius +
                    u2.radius +
                    2;

                if (
                    dist <
                        engageDist &&
                    dist > 0
                ) {
                    let overlap =
                        engageDist -
                        dist;

                    if (
                        u1.squad.team !==
                        u2.squad.team
                    ) {
                        let isU1Charge =
                            u1.squad.type ===
                                'cavalry' &&
                            u1.squad.momentum >
                                20;

                        let isU2Charge =
                            u2.squad.type ===
                                'cavalry' &&
                            u2.squad.momentum >
                                20;

                        let u1WedgeBonus =
                            u1.squad
                                .currentFormation ===
                            'wedge'
                                ? 1.5
                                : 1.0;

                        let u2WedgeBonus =
                            u2.squad
                                .currentFormation ===
                            'wedge'
                                ? 1.5
                                : 1.0;

                        if (isU1Charge && u1.hp > 0 && u2.hp > 0) {
                            let blockMult =
                                this.getDamageMultiplier(
                                    u1,
                                    u2
                                );

                            let dmg =
                                15 *
                                blockMult *
                                u1WedgeBonus;

                            u2.hp -=
                                dmg;

                            u2.squad.morale -=
                                2;

                            u1.squad.momentum -=
                                u2.mass *
                                0.5;

                            if (
                                Math.random() <
                                    0.3 &&
                                renderer &&
                                typeof renderer
                                    .addVFX ===
                                    'function'
                            ) {
                                renderer.addVFX(
                                    'impact',
                                    u2.x,
                                    u2.y
                                );
                            }
                        }

                        if (isU2Charge && u1.hp > 0 && u2.hp > 0) {
                            let blockMult =
                                this.getDamageMultiplier(
                                    u2,
                                    u1
                                );

                            let dmg =
                                15 *
                                blockMult *
                                u2WedgeBonus;

                            u1.hp -=
                                dmg;

                            u1.squad.morale -=
                                2;

                            u2.squad.momentum -=
                                u1.mass *
                                0.5;

                            if (
                                Math.random() <
                                    0.3 &&
                                renderer &&
                                typeof renderer
                                    .addVFX ===
                                    'function'
                            ) {
                                renderer.addVFX(
                                    'impact',
                                    u1.x,
                                    u1.y
                                );
                            }
                        }

                        if (
                            u1.attackCooldown <=
                                0 &&
                            u1.hp > 0 &&
                            u2.hp > 0
                        ) {
                            let blockMult =
                                this.getDamageMultiplier(
                                    u1,
                                    u2
                                );

                            let actualDmg =
                                Math.max(
                                    1,
                                    u1.dmg -
                                        u2.armor
                                ) *
                                blockMult;

                            u2.hp -=
                                actualDmg;

                            u1.attackCooldown =
                                1.0 +
                                Math.random() *
                                    0.5;

                            let repX =
                                u1.x -
                                (
                                    dx /
                                    dist
                                ) *
                                4;

                            let repY =
                                u1.y -
                                (
                                    dy /
                                    dist
                                ) *
                                4;

                            if (
                                !terrain ||
                                typeof terrain
                                    .canMoveTo !==
                                    'function' ||
                                terrain.canMoveTo(
                                    u1.x,
                                    u1.y,
                                    repX,
                                    repY
                                )
                            ) {
                                u1.x =
                                    repX;

                                u1.y =
                                    repY;
                            }

                            if (
                                Math.random() <
                                    0.3 &&
                                renderer &&
                                typeof renderer
                                    .addVFX ===
                                    'function'
                            ) {
                                renderer.addVFX(
                                    'text',
                                    u2.x,
                                    u2.y,
                                    `-${actualDmg.toFixed(1)}`,
                                    '#ff7675'
                                );
                            }
                        }

                        if (
                            u2.attackCooldown <=
                                0 &&
                            u2.hp > 0 &&
                            u1.hp > 0
                        ) {
                            let blockMult =
                                this.getDamageMultiplier(
                                    u2,
                                    u1
                                );

                            let actualDmg =
                                Math.max(
                                    1,
                                    u2.dmg -
                                        u1.armor
                                ) *
                                blockMult;

                            u1.hp -=
                                actualDmg;

                            u2.attackCooldown =
                                1.0 +
                                Math.random() *
                                    0.5;

                            let repX =
                                u2.x +
                                (
                                    dx /
                                    dist
                                ) *
                                4;

                            let repY =
                                u2.y +
                                (
                                    dy /
                                    dist
                                ) *
                                4;

                            if (
                                !terrain ||
                                typeof terrain
                                    .canMoveTo !==
                                    'function' ||
                                terrain.canMoveTo(
                                    u2.x,
                                    u2.y,
                                    repX,
                                    repY
                                )
                            ) {
                                u2.x =
                                    repX;

                                u2.y =
                                    repY;
                            }

                            if (
                                Math.random() <
                                    0.3 &&
                                renderer &&
                                typeof renderer
                                    .addVFX ===
                                    'function'
                            ) {
                                renderer.addVFX(
                                    'text',
                                    u1.x,
                                    u1.y,
                                    `-${actualDmg.toFixed(1)}`,
                                    '#ff7675'
                                );
                            }
                        }
                    }

                    let m1 =
                        u1.squad
                            .currentFormation ===
                        'shield_wall'
                            ? u1.mass *
                                5
                            : u1.mass;

                    let m2 =
                        u2.squad
                            .currentFormation ===
                        'shield_wall'
                            ? u2.mass *
                                5
                            : u2.mass;

                    let push1 =
                        (
                            m2 /
                            (
                                m1 +
                                m2
                            )
                        ) *
                        overlap;

                    let push2 =
                        (
                            m1 /
                            (
                                m1 +
                                m2
                            )
                        ) *
                        overlap;

                    let testX1 =
                        u1.x -
                        (
                            dx /
                            dist
                        ) *
                        push1;

                    let testY1 =
                        u1.y -
                        (
                            dy /
                            dist
                        ) *
                        push1;

                    if (
                        !terrain ||
                        typeof terrain
                            .canMoveTo !==
                            'function' ||
                        terrain.canMoveTo(
                            u1.x,
                            u1.y,
                            testX1,
                            testY1
                        )
                    ) {
                        u1.x =
                            testX1;

                        u1.y =
                            testY1;
                    }

                    let testX2 =
                        u2.x +
                        (
                            dx /
                            dist
                        ) *
                        push2;

                    let testY2 =
                        u2.y +
                        (
                            dy /
                            dist
                        ) *
                        push2;

                    if (
                        !terrain ||
                        typeof terrain
                            .canMoveTo !==
                            'function' ||
                        terrain.canMoveTo(
                            u2.x,
                            u2.y,
                            testX2,
                            testY2
                        )
                    ) {
                        u2.x =
                            testX2;

                        u2.y =
                            testY2;
                    }
                }
            }
        }
    }

    updateVision(
        squads,
        terrain
    ) {
        let allies =
            squads.filter(
                squad =>
                    squad.team ===
                        'ally' &&
                    squad.units.length >
                        0
            );

        let enemies =
            squads.filter(
                squad =>
                    squad.team ===
                        'enemy' &&
                    squad.units.length >
                        0
            );

        enemies.forEach(
            enemySquad => {
                enemySquad.visible =
                    false;

                for (
                    let enemyUnit of
                    enemySquad.units
                ) {
                    for (
                        let allySquad of
                        allies
                    ) {
                        if (
                            Math.hypot(
                                enemyUnit.x -
                                    allySquad.centerX,
                                enemyUnit.y -
                                    allySquad.centerY
                            ) <
                            allySquad.vision
                        ) {
                            if (
                                !terrain ||
                                typeof terrain
                                    .raycast !==
                                    'function' ||
                                terrain.raycast(
                                    allySquad.centerX,
                                    allySquad.centerY,
                                    enemyUnit.x,
                                    enemyUnit.y
                                )
                            ) {
                                enemySquad.visible =
                                    true;

                                break;
                            }
                        }
                    }

                    if (
                        enemySquad.visible
                    ) {
                        break;
                    }
                }
            }
        );
    }
}
