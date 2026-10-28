// Slot layouts: where each of `count` soldiers stands relative to the squad anchor, before the
// squad's facing is applied. +y is the back of the squad.
function grid(count, columns, spacing, rowsCentered = true) {
  const rows = Math.ceil(count / columns);
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns);
    const column = i % columns;
    const rowPosition = rowsCentered ? row - (rows - 1) / 2 : row;
    slots.push({ x: (column - (columns - 1) / 2) * spacing, y: -rowPosition * spacing });
  }
  return slots;
}

function staggered(count, columns, spacing, rowsCentered) {
  const rows = Math.ceil(count / columns);
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns);
    const column = i % columns;
    const offset = row % 2 === 0 ? 0 : spacing * 0.5;
    const rowPosition = rowsCentered ? row - (rows - 1) / 2 : row;
    slots.push({ x: (column - (columns - 1) / 2) * spacing + offset, y: -rowPosition * spacing });
  }
  return slots;
}

export function formationSlots(formation, count, formationWidth) {
  if (formation === 'loose') {
    const spacing = 35;
    let columns = Math.max(1, Math.floor(formationWidth / spacing));
    if (columns > count) columns = Math.max(1, count);
    return staggered(count, columns, spacing, true);
  }
  if (formation === 'column') return grid(count, 3, 20);
  if (formation === 'square') return grid(count, Math.ceil(Math.sqrt(count)), 16);
  if (formation === 'oblique') {
    const spacing = 20;
    const layout = [4, 4, 2, 2];
    const slots = [];
    for (let c = 0; c < layout.length; c += 1) {
      for (let r = 0; r < layout[c] && slots.length < count; r += 1) {
        slots.push({ x: (c - 1.5) * spacing, y: -r * spacing });
      }
    }
    return slots;
  }
  if (formation === 'skirmish') return staggered(count, Math.ceil(count / 2), 35, false);
  if (formation === 'wedge') {
    const spacing = 26;
    const totalRows = Math.ceil((-1 + Math.sqrt(1 + 8 * count)) / 2);
    const yOffset = (totalRows * spacing) / 2;
    const slots = [];
    for (let r = 0; r < 10 && slots.length < count; r += 1) {
      for (let c = 0; c <= r && slots.length < count; c += 1) {
        slots.push({ x: (c - r / 2) * spacing, y: -r * spacing + yOffset });
      }
    }
    return slots;
  }
  if (formation === 'shield_wall' || formation === 'phalanx') {
    return grid(count, Math.max(3, Math.floor(formationWidth / 18)), 18);
  }
  let columns = Math.max(1, Math.floor(formationWidth / 24));
  if (columns > count) columns = Math.max(1, count);
  return grid(count, columns, 24);
}
