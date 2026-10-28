// The view onto the battlefield: where the centre of the screen looks and how far it is zoomed in.
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 3.0;

export function createCamera() {
  return { x: 0, y: 0, zoom: 1.0 };
}

export function clampZoom(zoom) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

// view: { width, height } of the canvas in CSS pixels.
export function screenToWorld(camera, view, screenX, screenY) {
  return {
    x: (screenX - view.width / 2) / camera.zoom - camera.x,
    y: (screenY - view.height / 2) / camera.zoom - camera.y,
  };
}

export function worldToScreen(camera, view, worldX, worldY) {
  return {
    x: (worldX + camera.x) * camera.zoom + view.width / 2,
    y: (worldY + camera.y) * camera.zoom + view.height / 2,
  };
}

// Zooms so that the world point under (screenX, screenY) stays under it.
export function zoomAt(camera, view, screenX, screenY, zoom) {
  const anchor = screenToWorld(camera, view, screenX, screenY);
  camera.zoom = clampZoom(zoom);
  camera.x = (screenX - view.width / 2) / camera.zoom - anchor.x;
  camera.y = (screenY - view.height / 2) / camera.zoom - anchor.y;
}
