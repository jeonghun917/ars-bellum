// The player's character in battle: a hero of his own, not one of a formation's men (the owner's design,
// after Bannerlord). How he fights comes from his sheet: his skills (0-100, the campaign's skill ids) and what
// he carries in each slot (the campaign's equipment slots: main_hand, off_hand, body, mount, and a ranged
// weapon). The battle launch snapshot carries the sheet as `heroSheet`; the campaign side builds it from the
// character and his equipped items. Without one (the technical fixture), DEFAULT_HERO_SHEET is used.

export const DEFAULT_HERO_SHEET = Object.freeze({
  skills: Object.freeze({ one_handed: 40, two_handed: 20, polearm: 40, bow: 30, crossbow: 10, riding: 30, athletics: 40 }),
  equipment: Object.freeze({
    main_hand: Object.freeze({ itemId: "spear", weaponClass: "polearm", damage: 8, reach: 2.0, cooldownTicks: 16 }),
    off_hand: Object.freeze({ itemId: "round_shield", kind: "shield", block: 0.4 }),
    ranged: Object.freeze({ itemId: "hunting_bow", weaponClass: "bow", damage: 10, reloadTicks: 20, speed: 12, range: 22 }),
    body: Object.freeze({ itemId: "mail_shirt", armor: 15 }),
    mount: null
  })
});

const WEAPON_SKILLS = new Set(["one_handed", "two_handed", "polearm"]);
const RANGED_SKILLS = new Set(["bow", "crossbow"]);
const skill = (sheet, id) => Math.max(0, Math.min(100, Number(sheet?.skills?.[id]) || 0));
const number = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);

// Bare hands, when nothing is carried in the main hand.
const FISTS = Object.freeze({ itemId: null, weaponClass: "one_handed", damage: 2, reach: 1.0, cooldownTicks: 20 });

// What the hero can do in battle, worked out once when the battle starts.
export function heroCombat(sheet = DEFAULT_HERO_SHEET) {
  const equipment = sheet?.equipment || {};
  const main = equipment.main_hand && WEAPON_SKILLS.has(equipment.main_hand.weaponClass) ? equipment.main_hand : FISTS;
  const mainSkill = skill(sheet, main.weaponClass);
  const shield = equipment.off_hand?.kind === "shield" ? equipment.off_hand : null;
  const ranged = equipment.ranged && RANGED_SKILLS.has(equipment.ranged.weaponClass) ? equipment.ranged : null;
  const rangedSkill = ranged ? skill(sheet, ranged.weaponClass) : 0;
  const mount = equipment.mount || null;
  const athletics = skill(sheet, "athletics");
  const riding = skill(sheet, "riding");
  return Object.freeze({
    // A trained man stands longer; a horse carries him further before he falls.
    maxHp: Math.round(200 + athletics + (mount ? number(mount.hpBonus, 100) : 0)),
    // Armor takes a share of every blow: armor 20 halves it.
    armor: number(equipment.body?.armor, 0),
    melee: Object.freeze({
      itemId: main.itemId,
      weaponClass: main.weaponClass,
      // Skill makes the blow up to twice as hard and up to 40% quicker.
      damage: Math.round(number(main.damage, 2) * (1 + mainSkill / 100)),
      reach: number(main.reach, 1.0),
      cooldownTicks: Math.max(4, Math.round(number(main.cooldownTicks, 20) * (1 - mainSkill / 250)))
    }),
    // Blocking with a shield keeps out more than parrying with the weapon alone.
    blockMultiplier: shield ? number(shield.block, 0.4) : 0.7,
    ranged: ranged ? Object.freeze({
      itemId: ranged.itemId,
      weaponClass: ranged.weaponClass,
      damage: Math.round(number(ranged.damage, 8) * (1 + rangedSkill / 100)),
      reloadTicks: Math.max(6, Math.round(number(ranged.reloadTicks, 20) * (1 - rangedSkill / 200))),
      speed: number(ranged.speed, 12),
      range: number(ranged.range, 20)
    }) : null,
    mounted: Boolean(mount),
    // Running speed (m/s): on foot 3.2, quicker with athletics; on a horse its pace, better ridden with skill.
    moveSpeed: mount ? number(mount.speed, 5.6) * (1 + riding / 400) : 3.2 * (1 + athletics / 400),
    // How he looks (the soldier model's clip sets in M2_RendererThree.js).
    appearance: mount ? (main.weaponClass === "polearm" ? "cav" : "cavs")
      : main.weaponClass === "two_handed" ? "great"
        : main.weaponClass === "polearm" ? (shield ? "spear" : "spear_free")
          : (shield ? "sword" : "sword_free")
  });
}

// The damage left after armor.
export function damageThroughArmor(damage, armor) {
  return armor > 0 ? damage * 20 / (20 + armor) : damage;
}
