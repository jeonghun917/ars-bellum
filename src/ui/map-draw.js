// Draws the world map on a canvas: terrain, roads, settlements, the planned route and the party.
// It only reads (the world data, the player's group record, the view); it changes nothing.
import { BASE_TYPES } from '../domains/world/index.js';

const BASE_COLORS = {
  plain: '#47633f', forest: '#2f5a37', hill: '#6a6b45', highland: '#6e6556', mountain: '#5b5b5b',
  snow: '#d8e2e8', desert: '#b79a5d', marsh: '#3f5f56', river: '#2c5f8a', sea: '#16324a',
};
const ROAD_COLORS = { main_road: '#b99a62', mountain_pass: '#8d7f6c', bridge: '#a98f6a' };

function zonePath(ctx, view, shape) {
  ctx.beginPath();
  if (shape.type === 'rect') ctx.rect(shape.x * view.zoom + view.x, shape.y * view.zoom + view.y, shape.width * view.zoom, shape.height * view.zoom);
  else ctx.arc(shape.x * view.zoom + view.x, shape.y * view.zoom + view.y, shape.radius * view.zoom, 0, Math.PI * 2);
}

export function drawWorld(ctx, { view, viewport, world, group, castleImage, selectedNodeId = null }) {
  const sx = (x) => x * view.zoom + view.x;
  const sy = (y) => y * view.zoom + view.y;
  ctx.fillStyle = BASE_COLORS.sea;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = BASE_COLORS.plain;
  ctx.fillRect(sx(0), sy(0), world.map.width * view.zoom, world.map.height * view.zoom);

  // Faint grid every 512 world pixels, so distances can be judged.
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let g = 0; g <= world.map.width; g += 512) { ctx.moveTo(sx(g), sy(0)); ctx.lineTo(sx(g), sy(world.map.height)); }
  for (let g = 0; g <= world.map.height; g += 512) { ctx.moveTo(sx(0), sy(g)); ctx.lineTo(sx(world.map.width), sy(g)); }
  ctx.stroke();

  for (const zone of world.zones) {
    if (zone.baseId && BASE_TYPES[zone.baseId]) {
      ctx.fillStyle = BASE_COLORS[zone.baseId] ?? BASE_COLORS.plain;
      zonePath(ctx, view, zone.shape);
      ctx.fill();
    }
    if (zone.routeId) {
      ctx.fillStyle = 'rgba(185,154,98,0.85)';
      zonePath(ctx, view, zone.shape);
      ctx.fill();
    }
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of world.roads) {
    if (road.enabled === false) continue;
    const points = world.polylines.get(road.id);
    ctx.strokeStyle = ROAD_COLORS[road.type] ?? ROAD_COLORS.main_road;
    ctx.lineWidth = Math.max(3, world.roadHalfWidth * 2 * view.zoom);
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y))));
    ctx.stroke();
  }

  // Where the group is heading: the rest of its road route, or a straight line to its target.
  if (group) {
    const mv = group.movement;
    const here = group.worldPosition;
    const heading = [{ x: here.x, y: here.y }];
    if (mv.route) heading.push(...mv.route.waypoints.slice(mv.route.index));
    else if (Math.hypot(mv.targetX - here.x, mv.targetY - here.y) > 2) heading.push({ x: mv.targetX, y: mv.targetY });
    if (heading.length > 1) {
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      heading.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y))));
      ctx.stroke();
      ctx.setLineDash([]);
      const end = heading[heading.length - 1];
      ctx.beginPath();
      ctx.arc(sx(end.x), sy(end.y), 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  for (const node of world.nodes) {
    const radius = Math.max(node.radius * view.zoom, 6);
    const x = sx(node.x);
    const y = sy(node.y);
    if (node.type === 'castle' && castleImage && castleImage.complete && castleImage.naturalWidth > 0) {
      const size = Math.max(radius * 2.4, 22);
      ctx.drawImage(castleImage, x - size / 2, y - size / 2, size, size);
    } else {
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (node.id === selectedNodeId) {
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(node.name, x, y - radius - 8);
    ctx.fillText(node.name, x, y - radius - 8);
  }

  if (group) {
    const x = sx(group.worldPosition.x);
    const y = sy(group.worldPosition.y);
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 8, y + 7);
    ctx.lineTo(x - 8, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(group.name, x, y + 24);
    ctx.fillText(group.name, x, y + 24);
  }
}
