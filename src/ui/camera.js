// The map view: where the world sits on the screen. screen = world * zoom + offset.
// Pure functions on { zoom, x, y } so panning and zooming can be tested without a browser.
export const MAX_ZOOM = 2;

export function fitZoom(map, viewport) {
  return Math.min(viewport.width / map.width, viewport.height / map.height);
}

// Keeps the map on screen: if it is smaller than the viewport on an axis it is centred there,
// otherwise its edges may not move inside the viewport.
export function clampView(view, map, viewport) {
  const axis = (offset, mapSize, viewSize) => {
    const scaled = mapSize * view.zoom;
    if (scaled <= viewSize) return (viewSize - scaled) / 2;
    return Math.min(0, Math.max(viewSize - scaled, offset));
  };
  return { zoom: view.zoom, x: axis(view.x, map.width, viewport.width), y: axis(view.y, map.height, viewport.height) };
}

// The first view: the whole map, or (when `focus` { x, y, width, height } is given) that part of it
// centred and as large as fits, but never smaller than the whole map.
export function fitView(map, viewport, focus = null) {
  const whole = fitZoom(map, viewport);
  if (!focus) return clampView({ zoom: whole, x: 0, y: 0 }, map, viewport);
  const zoom = Math.max(whole, Math.min(MAX_ZOOM, viewport.width / focus.width, viewport.height / focus.height));
  const centre = { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 };
  return clampView({ zoom, x: viewport.width / 2 - centre.x * zoom, y: viewport.height / 2 - centre.y * zoom }, map, viewport);
}

// The box around some points, grown by `margin` on every side.
export function boundsOf(points, margin) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, width: Math.max(...xs) + margin - x, height: Math.max(...ys) + margin - y };
}

export const worldToScreen = (view, point) => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y });
export const screenToWorld = (view, point) => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom });

export const panBy = (view, dx, dy, map, viewport) => clampView({ ...view, x: view.x + dx, y: view.y + dy }, map, viewport);

// Zooms by `factor` keeping the world point under `anchor` (a screen point) where it is.
export function zoomAt(view, anchor, factor, map, viewport) {
  const zoom = Math.max(fitZoom(map, viewport), Math.min(MAX_ZOOM, view.zoom * factor));
  const world = screenToWorld(view, anchor);
  return clampView({ zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom }, map, viewport);
}

export function centerOn(view, worldPoint, map, viewport, zoom = view.zoom) {
  const z = Math.max(fitZoom(map, viewport), Math.min(MAX_ZOOM, zoom));
  return clampView({ zoom: z, x: viewport.width / 2 - worldPoint.x * z, y: viewport.height / 2 - worldPoint.y * z }, map, viewport);
}

// The settlement under a screen point: its circle, but at least minPx wide so small ones are easy to hit.
export function hitNode(view, nodes, screenPoint, minPx = 16) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const at = worldToScreen(view, node);
    const distance = Math.hypot(at.x - screenPoint.x, at.y - screenPoint.y);
    if (distance <= Math.max(node.radius * view.zoom, minPx) && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}
