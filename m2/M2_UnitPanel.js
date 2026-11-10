// The player's formations on screen (the owner, 2026-11-02, for the phone): a small round "부대" button; tapped,
// a row along the top of the battalions he has made (대대: small boxes, wider than tall) and of every formation
// (a circle with a picture of what it carries: shield, spear, crossbow, bow, horse, and its name under it).
// Tapping a battalion or a formation selects it and opens its menu: 조작 (attack, hold, rally, retreat,
// pursuit), 전술 (the formation's orders), 진영 (its shape) and 기타 (battalions, the army's battle plan, the
// battle's speed, morale). In the tactical view a tap on a circle adds it to the selection or takes it out
// (several at once only there); in the view behind the player it selects that one alone.
// This module only draws and reports taps (M2_InputController.js gives the orders).
import { M2_UNIT_TYPES, m2UnitKindForFormation } from "./M2_UnitKinds.js";
import { M2_ORDERS } from "./M2_Orders.js";
import { M2_PLANS } from "./M2_Plans.js";

const svg = (body) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${body}</svg>`;
const ICONS = Object.freeze({
  shield: svg('<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M7 10h10" stroke="currentColor" stroke-width="2"/>'),
  spear: svg('<path d="M4 20 18 6" stroke="currentColor" stroke-width="2"/><path d="m15 3 6 0 0 6-3-1-2-2z" fill="currentColor"/>'),
  axe: svg('<path d="M6 21 17 6" stroke="currentColor" stroke-width="2"/><path d="M13 3c4 0 7 3 7 7l-5-1-3-3z" fill="currentColor"/>'),
  sword: svg('<path d="M5 19 18 6l1-3-3 1L3 17M4 14l6 6" fill="none" stroke="currentColor" stroke-width="2"/>'),
  crossbow: svg('<path d="M3 8c4-4 14-4 18 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4v17M3 8l9 3 9-3" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  bow: svg('<path d="M6 3c8 4 8 14 0 18" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 3v18M4 12h16m-3-3 3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  horse: svg('<path d="M5 21v-6c0-4 3-8 7-9l2-3 1 3c3 1 5 3 5 6l-3 1-2-2-2 2v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>')
});
// What each subtype carries, for its picture; without a subtype, its kind's.
const ICON_OF = Object.freeze({
  shield: "shield", pike: "spear", shock: "axe", skirmisher: "sword", crossbow: "crossbow", longbow: "bow",
  light_cav: "horse", heavy_cav: "horse", infantry: "spear", cavalry: "horse"
});
const KIND_LABELS = Object.freeze({ infantry: "보병", crossbow: "석궁병", cavalry: "기병" });

// Foot first, then crossbowmen and bowmen, then horse; within a kind, by name.
const KIND_ORDER = Object.freeze({ infantry: 0, crossbow: 1, cavalry: 2 });
const byKind = (a, b) => (KIND_ORDER[m2UnitKindForFormation(a.formationId)] ?? 3) - (KIND_ORDER[m2UnitKindForFormation(b.formationId)] ?? 3)
  || a.formationId.localeCompare(b.formationId);

const TABS = Object.freeze([["control", "조작"], ["tactic", "전술"], ["shape", "진영"], ["more", "기타"]]);

// A formation's name on screen: its subtype's (or kind's), numbered when two share it ("장창병 2").
export function formationNames(formations) {
  const base = (f) => M2_UNIT_TYPES[f.unitTypeId]?.label || KIND_LABELS[m2UnitKindForFormation(f.formationId)] || "부대";
  const counts = {};
  for (const f of formations) counts[base(f)] = (counts[base(f)] || 0) + 1;
  const seen = {};
  return new Map(formations.map((f) => {
    const name = base(f);
    seen[name] = (seen[name] || 0) + 1;
    return [f.formationId, counts[name] > 1 ? `${name} ${seen[name]}` : name];
  }));
}

function iconFor(formation) {
  return ICONS[ICON_OF[formation.unitTypeId] || ICON_OF[m2UnitKindForFormation(formation.formationId)] || "spear"];
}

export class M2UnitPanel {
  #el;
  #on;
  #open = false;
  #tab = "control";
  #picking = false;
  // What was last drawn (nothing is redrawn while it stays the same).
  #drawn = null;

  // elements: { toggle, strip, menu, title, tabs, panes: { control, tactic, shape, more }, tacticChips, planChips,
  // enemyPicker, pursuit }. on: { listen(target, type, handler), select(ids), selectGroup(groupId),
  // attackEnemy(formationId), command(name, value), redraw() }.
  constructor(elements, on) {
    this.#el = elements;
    this.#on = on;
    // (Through the controller's listen, so they go when it is disposed.)
    if (elements.toggle) on.listen(elements.toggle, "pointerdown", (event) => { event.preventDefault(); this.setOpen(!this.#open); });
    for (const button of elements.tabs?.querySelectorAll("[data-tab]") || []) {
      on.listen(button, "pointerdown", (event) => { event.preventDefault(); this.#tab = button.dataset.tab; this.#picking = false; this.#on.redraw(); });
    }
  }

  get open() { return this.#open; }
  get tab() { return this.#tab; }

  setOpen(open) {
    this.#open = Boolean(open);
    if (!this.#open) this.#picking = false;
    this.#el.toggle?.setAttribute("aria-expanded", String(this.#open));
    this.#on.redraw();
  }

  // The enemy row under the attack button: shown until one is tapped.
  pickEnemy(on = true) {
    this.#picking = on;
    this.#on.redraw();
  }

  // Draws everything from the battle (snapshot), the selection, the battalions and the player's side.
  draw({ snapshot, selected, groups, selectedGroupId, sideId }) {
    const el = this.#el;
    const key = JSON.stringify([this.#open, this.#tab, this.#picking, selected, groups, selectedGroupId, sideId,
      (snapshot?.formations || []).map((f) => [f.formationId, f.tactic, f.tactics, f.pursuit]),
      (snapshot?.units || []).filter((u) => u.hp > 0 && u.state !== "routing").map((u) => u.formationId).sort().join(),
      snapshot?.plans?.ally?.planId, snapshot?.plansAvailable?.ally]);
    if (key === this.#drawn) return;
    this.#drawn = key;
    const mine = (snapshot?.formations || []).filter((f) => f.sideId === sideId).sort(byKind);
    const theirs = (snapshot?.formations || []).filter((f) => f.sideId !== sideId).sort(byKind);
    const names = formationNames(mine);
    const standing = new Set((snapshot?.units || []).filter((u) => u.hp > 0 && u.state !== "routing" && u.state !== "dead" && u.state !== "incapacitated").map((u) => u.formationId));
    if (el.strip) {
      el.strip.hidden = !this.#open;
      el.strip.textContent = "";
      for (const group of groups) {
        const box = document.createElement("button");
        box.type = "button";
        box.className = "m2-group-box";
        box.dataset.group = group.groupId;
        box.setAttribute("aria-pressed", String(group.groupId === selectedGroupId));
        box.textContent = `${group.name} · ${group.members.map((id) => names.get(id)).filter(Boolean).join(" ")}`;
        box.addEventListener("pointerdown", (event) => { event.preventDefault(); this.#on.selectGroup(group.groupId); });
        el.strip.appendChild(box);
      }
      for (const formation of mine) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "m2-unit-dot";
        dot.dataset.formation = formation.formationId;
        dot.setAttribute("aria-pressed", String(selected.includes(formation.formationId)));
        dot.setAttribute("aria-label", names.get(formation.formationId));
        if (!standing.has(formation.formationId)) dot.classList.add("is-down");
        dot.innerHTML = `${iconFor(formation)}<small>${names.get(formation.formationId)}</small>`;
        dot.addEventListener("pointerdown", (event) => { event.preventDefault(); this.#on.select([formation.formationId]); });
        el.strip.appendChild(dot);
      }
    }
    const showMenu = this.#open && selected.length > 0;
    if (el.menu) el.menu.hidden = !showMenu;
    if (!showMenu) return;
    const group = groups.find((g) => g.groupId === selectedGroupId);
    const label = selected.map((id) => names.get(id)).join("·");
    if (el.title) el.title.textContent = group ? `${group.name} (${label})` : label;
    for (const button of el.tabs?.querySelectorAll("[data-tab]") || []) button.setAttribute("aria-selected", String(button.dataset.tab === this.#tab));
    for (const [id] of TABS) if (el.panes?.[id]) el.panes[id].hidden = id !== this.#tab;

    // 조작: the enemy to attack, picked from a row of their formations.
    if (el.enemyPicker) {
      el.enemyPicker.hidden = !this.#picking;
      el.enemyPicker.textContent = "";
      const theirNames = formationNames(theirs);
      for (const formation of theirs) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "m2-unit-dot is-enemy";
        dot.dataset.formation = formation.formationId;
        dot.setAttribute("aria-label", theirNames.get(formation.formationId));
        dot.innerHTML = `${iconFor(formation)}<small>${theirNames.get(formation.formationId)}</small>`;
        dot.addEventListener("pointerdown", (event) => { event.preventDefault(); this.#picking = false; this.#on.attackEnemy(formation.formationId); });
        el.enemyPicker.appendChild(dot);
      }
    }
    // 전술: the orders the (first) selected formation can be given, and none.
    const first = mine.find((f) => f.formationId === selected[0]);
    const chips = (container, rows, current, onPick) => {
      if (!container) return;
      container.textContent = "";
      for (const [value, text] of rows) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.dataset.value = value ?? "";
        chip.textContent = text;
        chip.setAttribute("aria-pressed", String((current ?? null) === (value ?? null)));
        chip.addEventListener("pointerdown", (event) => { event.preventDefault(); onPick(value ?? null); });
        container.appendChild(chip);
      }
    };
    chips(el.tacticChips, [[null, "없음"], ...(first?.tactics || []).map((id) => [id, M2_ORDERS[id].label])], first?.tactic, (value) => this.#on.command("tactic", value));
    // 기타: the army's battle plan.
    chips(el.planChips, [[null, "없음"], ...(snapshot?.plansAvailable?.ally || []).map((id) => [id, M2_PLANS[id].label])], snapshot?.plans?.ally?.planId, (value) => this.#on.command("plan", value));
    if (el.pursuit) {
      const pursue = Boolean(first?.pursuit);
      el.pursuit.textContent = pursue ? "추격: 켬" : "추격: 끔";
      el.pursuit.setAttribute("aria-pressed", String(pursue));
    }
  }
}
