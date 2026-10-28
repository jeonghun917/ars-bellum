// Turns mouse, touch and pen into battle orders on the canvas, with one set of Pointer Events.
//
//   Mouse:  left drag pans, left click selects/moves, right drag draws a line (a front, or a selection box),
//           right click is a click, wheel zooms, middle drag pans.
//   Touch:  one finger pans, a tap selects/moves, a tap followed at once by a drag draws a line,
//           two fingers pinch to zoom.
// What a click means depends on the command mode: 'move', 'attack' or 'direction'.
import { clampZoom, screenToWorld, zoomAt } from './camera.js';

const TAP_DISTANCE = 15;
// A drag that starts this soon after a finger lifted draws a line instead of panning.
const DOUBLE_TAP_MS = 250;
const WHEEL_ZOOM_RATE = 0.0015;

export function createInput({ canvas, camera, getCommandMode, setCommandMode, onAction }) {
  const pointers = new Map();
  let gesture = null;
  let lastTouchEnd = -Infinity;
  let drawing = null;

  const canvasPosition = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const viewSize = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });
  const toWorld = (point) => screenToWorld(camera, viewSize(), point.x, point.y);

  function startKind(event) {
    const mode = getCommandMode();
    if (event.pointerType === 'mouse') {
      if (event.button === 2) return 'line';
      if (event.button === 1) return 'pan-only';
      return mode === 'direction' ? 'direction' : 'pan';
    }
    if (event.timeStamp - lastTouchEnd < DOUBLE_TAP_MS) return 'line';
    return mode === 'direction' ? 'direction' : 'pan';
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button > 2) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Capture is only a convenience (moves outside the canvas keep coming).
    }
    const position = canvasPosition(event);
    pointers.set(event.pointerId, position);
    if (pointers.size === 1) {
      gesture = { kind: startKind(event), start: position, current: position, multi: false, touch: event.pointerType !== 'mouse' };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture.kind = 'pinch';
      gesture.multi = true;
      gesture.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.pinchZoom = camera.zoom;
      drawing = null;
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    event.preventDefault();
    const position = canvasPosition(event);
    pointers.set(event.pointerId, position);
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2 || !(gesture.pinchDistance > 0)) return;
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(camera, viewSize(), (a.x + b.x) / 2, (a.y + b.y) / 2, gesture.pinchZoom * (distance / gesture.pinchDistance));
      return;
    }
    const previous = gesture.current;
    gesture.current = position;
    if (gesture.kind === 'line' || gesture.kind === 'direction') {
      drawing = { startX: gesture.start.x, startY: gesture.start.y, currentX: position.x, currentY: position.y };
    } else {
      camera.x += (position.x - previous.x) / camera.zoom;
      camera.y += (position.y - previous.y) / camera.zoom;
    }
  }

  function pointAction(point) {
    if (getCommandMode() === 'attack') {
      onAction({ type: 'attack', point });
      setCommandMode('move');
    } else {
      onAction({ type: 'tap', point });
    }
  }

  // The last pointer lifted: decide what the gesture was.
  function finishGesture() {
    const { kind, start, current, multi } = gesture;
    if (multi || kind === 'pan-only') return;
    const distance = Math.hypot(current.x - start.x, current.y - start.y);
    const worldStart = toWorld(start);
    const worldEnd = toWorld(current);
    if (kind === 'direction') {
      if (distance > TAP_DISTANCE) {
        onAction({ type: 'direction', angle: Math.atan2(worldEnd.y - worldStart.y, worldEnd.x - worldStart.x) });
      }
      setCommandMode('move');
    } else if (kind === 'line') {
      if (distance > TAP_DISTANCE) onAction({ type: 'drag', start: worldStart, end: worldEnd });
      else pointAction(worldEnd);
    } else if (distance < TAP_DISTANCE) {
      pointAction(worldEnd);
    } else if (getCommandMode() === 'attack') {
      setCommandMode('move');
    }
  }

  function onPointerUp(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    event.preventDefault();
    pointers.set(event.pointerId, canvasPosition(event));
    if (pointers.size === 1) {
      gesture.current = pointers.get(event.pointerId);
      finishGesture();
      if (gesture.touch) lastTouchEnd = event.timeStamp;
      gesture = null;
      drawing = null;
    } else if (pointers.size === 2) {
      // One finger left after a pinch: it keeps panning, but can no longer give an order.
      pointers.delete(event.pointerId);
      const [remaining] = [...pointers.values()];
      gesture.kind = 'pan-only';
      gesture.current = remaining;
      return;
    }
    pointers.delete(event.pointerId);
  }

  function onPointerCancel(event) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      gesture = null;
      drawing = null;
    }
  }

  function onWheel(event) {
    event.preventDefault();
    const position = canvasPosition(event);
    zoomAt(camera, viewSize(), position.x, position.y, clampZoom(camera.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE)));
  }

  const onContextMenu = (event) => event.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    // The line being dragged, in canvas pixels, for the renderer; null when there is none.
    getDrawing: () => drawing,
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      pointers.clear();
      gesture = null;
      drawing = null;
    },
  };
}
