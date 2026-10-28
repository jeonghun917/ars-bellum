// Plane geometry for roads. A road is the polyline start settlement -> bends -> end settlement.
// This is the only place that builds that polyline: terrain uses it to tell whether a point is on
// a road, and routing uses it for road length and waypoints.

export function distanceToSegment(px, py, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const lengthSquared = sx * sx + sy * sy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const along = ((px - ax) * sx + (py - ay) * sy) / lengthSquared;
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(px - (ax + sx * t), py - (ay + sy * t));
}

export function distanceToPolyline(px, py, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    best = Math.min(best, distanceToSegment(px, py, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y));
  }
  return best;
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  return total;
}

// Points of a road from its start settlement to its end settlement, or [] if a settlement is missing.
export function buildRoadPolyline(road, nodeById) {
  const from = nodeById.get(road.fromSettlementId);
  const to = nodeById.get(road.toSettlementId);
  if (!from || !to) return [];
  const bends = (road.waypoints ?? []).map((p) => ({ x: p.x, y: p.y }));
  return [{ x: from.x, y: from.y }, ...bends, { x: to.x, y: to.y }];
}
