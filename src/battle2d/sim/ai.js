// Enemy squad behaviour by role. Called every step with the battle's current squad list, so the
// enemy always looks at the squads that exist now (not at a list captured earlier).
//   skirmisher: ranged and light cavalry keep their distance, shoot, and back away when pressed.
//   flanker: heavy cavalry goes for the archers, otherwise the nearest squad.
//   anvil: everyone else holds one target until it is gone or breaks, then takes the nearest.

function distanceBetween(a, b) {
  return Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY);
}

// Ties go to the later squad, as the original reduce did.
function nearestTo(squad, candidates) {
  return candidates.reduce((best, candidate) => (distanceBetween(squad, best) < distanceBetween(squad, candidate) ? best : candidate));
}

export function updateEnemyAi(squad, squads) {
  const opponents = squads.filter((other) => other.team === 'ally' && other.units.length > 0 && other.state !== 'routing');
  if (opponents.length === 0) {
    squad.targetSquad = null;
    return;
  }
  if (squad.aiRole === 'skirmisher') {
    const closest = nearestTo(squad, opponents);
    const distance = distanceBetween(squad, closest);
    if (distance < 120) {
      const fleeAngle = Math.atan2(squad.centerY - closest.centerY, squad.centerX - closest.centerX);
      squad.waypoints = [{ x: squad.centerX + Math.cos(fleeAngle) * 150, y: squad.centerY + Math.sin(fleeAngle) * 150 }];
      squad.targetSquad = null;
      squad.state = 'idle';
    } else if (distance < squad.vision * 0.9) {
      squad.targetSquad = closest;
    } else {
      squad.waypoints = [{ x: closest.centerX, y: closest.centerY }];
      squad.targetSquad = null;
    }
  } else if (squad.aiRole === 'flanker') {
    squad.targetSquad = opponents.find((other) => other.type === 'archer') || nearestTo(squad, opponents);
  } else if (!squad.targetSquad || squad.targetSquad.units.length === 0 || squad.targetSquad.state === 'routing') {
    squad.targetSquad = nearestTo(squad, opponents);
  }
}
