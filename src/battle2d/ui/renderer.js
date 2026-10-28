// Draws the battlefield on a canvas: terrain, soldiers, effects and the fog of war.
// It reads the battle and never changes it. Effects are made from the engine's events, and their
// randomness comes from the cosmetic generator so that drawing can not change a fight.
import { worldToScreen } from './camera.js';

const FX_LIFE_RATE = 1.5;

export function createRenderer({ canvas, doc, view, camera, terrain, cosmeticRandom }) {
  const ctx = canvas.getContext('2d');
  const fogCanvas = doc.createElement('canvas');
  const fogCtx = fogCanvas.getContext('2d');
  const effects = [];
  const size = { width: 0, height: 0 };

  function resize() {
    const ratio = view.devicePixelRatio || 1;
    size.width = canvas.clientWidth;
    size.height = canvas.clientHeight;
    const pixelWidth = Math.max(1, Math.round(size.width * ratio));
    const pixelHeight = Math.max(1, Math.round(size.height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      fogCanvas.width = pixelWidth;
      fogCanvas.height = pixelHeight;
    }
    return ratio;
  }

  function addEvent(event) {
    // chance < 1 means "show only some of these", so a crowded melee is not buried in numbers.
    if (event.chance < 1 && cosmeticRandom.next() >= event.chance) return;
    effects.push({
      type: event.type,
      x: event.x,
      y: event.y,
      text: event.text,
      color: event.color,
      life: 1.0,
      vx: (cosmeticRandom.next() - 0.5) * 20,
      vy: -30,
    });
  }

  function drawTerrain(bounds) {
    const cs = terrain.cellSize;
    const colStart = Math.max(0, Math.floor((bounds.left + terrain.width / 2) / cs));
    const colEnd = Math.min(terrain.cols - 1, Math.floor((bounds.right + terrain.width / 2) / cs));
    const rowStart = Math.max(0, Math.floor((bounds.top + terrain.height / 2) / cs));
    const rowEnd = Math.min(terrain.rows - 1, Math.floor((bounds.bottom + terrain.height / 2) / cs));
    const forests = [];
    for (let r = rowStart; r <= rowEnd; r += 1) {
      for (let c = colStart; c <= colEnd; c += 1) {
        const type = terrain.grid[r][c].type;
        const px = c * cs - terrain.width / 2;
        const py = r * cs - terrain.height / 2;
        if (type === 'plain') continue;
        if (type === 'forest') {
          forests.push({ px, py });
        } else if (type === 'hill') {
          ctx.fillStyle = '#8BC34A';
          ctx.fillRect(px, py, cs, cs);
          ctx.fillStyle = 'rgba(0, 100, 0, 0.25)';
          ctx.font = '16px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('▲', px + cs / 2, py + cs / 2);
        } else if (type === 'highland') {
          ctx.fillStyle = '#D7CCC8';
          ctx.fillRect(px, py, cs, cs);
          ctx.strokeStyle = '#BCAAA4';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 1, py + 1, cs - 2, cs - 2);
        } else if (type === 'cliff') {
          ctx.fillStyle = '#454545';
          ctx.fillRect(px, py, cs, cs);
          ctx.strokeStyle = '#292929';
          ctx.lineWidth = 2;
          for (let i = 0; i < cs; i += 10) {
            ctx.beginPath();
            ctx.moveTo(px + i, py);
            ctx.lineTo(px, py + i);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px + cs, py + i);
            ctx.lineTo(px + i, py + cs);
            ctx.stroke();
          }
        } else if (type === 'wall') {
          ctx.fillStyle = '#9E9E9E';
          ctx.fillRect(px, py, cs, cs);
          ctx.strokeStyle = '#616161';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px, py, cs, cs);
          ctx.beginPath();
          ctx.moveTo(px, py + cs / 2);
          ctx.lineTo(px + cs, py + cs / 2);
          ctx.moveTo(px + cs / 2, py);
          ctx.lineTo(px + cs / 2, py + cs / 2);
          ctx.moveTo(px + cs / 4, py + cs / 2);
          ctx.lineTo(px + cs / 4, py + cs);
          ctx.moveTo(px + cs * 0.75, py + cs / 2);
          ctx.lineTo(px + cs * 0.75, py + cs);
          ctx.stroke();
        } else if (type === 'stairs') {
          ctx.fillStyle = '#8B5A2B';
          ctx.fillRect(px, py, cs, cs);
          ctx.strokeStyle = '#3E2723';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 2, py + 2, cs - 4, cs - 4);
          ctx.beginPath();
          ctx.moveTo(px, py + cs * 0.3);
          ctx.lineTo(px + cs, py + cs * 0.3);
          ctx.moveTo(px, py + cs * 0.7);
          ctx.lineTo(px + cs, py + cs * 0.7);
          ctx.stroke();
          ctx.fillStyle = '#111';
          ctx.fillRect(px + 4, py + 4, 3, 3);
          ctx.fillRect(px + cs - 7, py + 4, 3, 3);
          ctx.fillRect(px + 4, py + cs - 7, 3, 3);
          ctx.fillRect(px + cs - 7, py + cs - 7, 3, 3);
        }
      }
    }
    // Trees are drawn after the ground so they overlap the neighbouring cells.
    for (const { px, py } of forests) {
      const tree = (tx, ty, radius) => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.arc(tx + 2, ty + 2, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        ctx.arc(tx, ty, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        ctx.arc(tx - 1.5, ty - 1.5, radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
      };
      tree(px + cs * 0.25, py + cs * 0.3, cs * 0.3);
      tree(px + cs * 0.75, py + cs * 0.4, cs * 0.32);
      tree(px + cs * 0.5, py + cs * 0.7, cs * 0.35);
    }
  }

  function drawSelection(squad) {
    ctx.beginPath();
    ctx.arc(squad.centerX, squad.centerY, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(241, 196, 15, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (squad.waypoints.length === 0) return;
    ctx.strokeStyle = '#ffdd59';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(squad.centerX, squad.centerY);
    for (const waypoint of squad.waypoints) ctx.lineTo(waypoint.x, waypoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
    squad.waypoints.forEach((waypoint, index) => {
      ctx.fillStyle = '#ffdd59';
      ctx.beginPath();
      ctx.arc(waypoint.x, waypoint.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e272e';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), waypoint.x, waypoint.y);
    });
  }

  function drawSoldier(squad, unit, colors) {
    ctx.save();
    ctx.translate(unit.x, unit.y);
    ctx.rotate(squad.angle);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1.5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2c3e50';

    if (squad.subType === 'heavy_cav') {
      ctx.fillStyle = '#7f8c8d';
      ctx.beginPath();
      ctx.ellipse(0, 0, unit.radius * 1.1, unit.radius * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (squad.subType === 'light_cav') {
      ctx.fillStyle = '#8B4513';
      ctx.beginPath();
      ctx.ellipse(0, 0, unit.radius * 1.1, unit.radius * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    const bodyRadius = unit.radius * (squad.type === 'cavalry' ? 0.7 : 1.0);
    ctx.beginPath();
    ctx.arc(0, 0, bodyRadius, 0, Math.PI * 2);
    ctx.fillStyle = colors.surcoat;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2c3e50';
    ctx.stroke();

    ctx.fillStyle = colors.cross;
    ctx.fillRect(-bodyRadius * 0.6, -1.5, bodyRadius * 1.2, 3);
    ctx.fillRect(-1.5, -bodyRadius * 0.6, 3, bodyRadius * 1.2);

    ctx.fillStyle = '#bdc3c7';
    ctx.strokeStyle = '#34495e';
    ctx.lineWidth = 1.5;
    if (squad.subType === 'heavy_cav' || squad.subType === 'shock') {
      ctx.fillRect(-2, -3, 6, 6);
      ctx.strokeRect(-2, -3, 6, 6);
      if (squad.subType === 'heavy_cav') {
        ctx.fillStyle = '#d35400';
        ctx.beginPath();
        ctx.moveTo(-1, -3);
        ctx.lineTo(-4, -7);
        ctx.lineTo(2, -3);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-1, 3);
        ctx.lineTo(-4, 7);
        ctx.lineTo(2, 3);
        ctx.fill();
      }
    } else if (squad.subType === 'light_cav') {
      ctx.fillStyle = '#95a5a6';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(1, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#95a5a6';
    if (squad.subType === 'shield') {
      ctx.beginPath();
      ctx.moveTo(unit.radius - 2, -unit.radius - 1);
      ctx.lineTo(unit.radius + 6, 0);
      ctx.lineTo(unit.radius - 2, unit.radius + 1);
      ctx.lineTo(unit.radius - 5, 0);
      ctx.fillStyle = colors.surcoat;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.cross;
      ctx.fillRect(unit.radius - 2, -1, 4, 2);
      ctx.fillRect(unit.radius - 1, -2, 2, 4);
    } else if (squad.subType === 'pike') {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(2, 2, 30, 1.5);
      ctx.fillStyle = '#bdc3c7';
      ctx.beginPath();
      ctx.moveTo(32, 1.5);
      ctx.lineTo(36, 2.75);
      ctx.lineTo(32, 4);
      ctx.fill();
    } else if (squad.subType === 'shock') {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(4, -4, 12, 2);
      ctx.fillStyle = '#bdc3c7';
      ctx.beginPath();
      ctx.moveTo(14, -8);
      ctx.lineTo(16, -2);
      ctx.lineTo(14, -4);
      ctx.fill();
    } else if (squad.subType === 'heavy_cav' || squad.subType === 'light_cav') {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(4, 3, 16, 2);
      ctx.fillStyle = '#bdc3c7';
      ctx.beginPath();
      ctx.moveTo(20, 2);
      ctx.lineTo(26, 4);
      ctx.lineTo(20, 6);
      ctx.fill();
    } else if (squad.subType === 'crossbow') {
      ctx.fillStyle = '#5c4033';
      ctx.fillRect(4, -1, 10, 2);
      ctx.strokeStyle = '#bdc3c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, -5);
      ctx.lineTo(10, 5);
      ctx.stroke();
    } else if (squad.subType === 'archer') {
      ctx.fillStyle = '#5c4033';
      ctx.fillRect(4, -1, 8, 2);
      ctx.beginPath();
      ctx.arc(10, 0, 6, -Math.PI / 1.8, Math.PI / 1.8);
      ctx.stroke();
    }

    if (squad.selected) {
      ctx.rotate(-squad.angle);
      const ratio = unit.hp / unit.maxHp;
      const barWidth = unit.radius * 2;
      ctx.fillStyle = 'rgba(231, 76, 60, 0.8)';
      ctx.fillRect(-unit.radius, -unit.radius - 8, barWidth, 3);
      ctx.fillStyle = 'rgba(46, 204, 113, 0.9)';
      ctx.fillRect(-unit.radius, -unit.radius - 8, barWidth * ratio, 3);
    }
    ctx.restore();
  }

  function drawEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const effect = effects[i];
      effect.life -= dt * FX_LIFE_RATE;
      if (effect.life <= 0) {
        effects.splice(i, 1);
        continue;
      }
      if (effect.type === 'text') {
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        ctx.fillStyle = effect.color;
        ctx.globalAlpha = effect.life;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(effect.text, effect.x, effect.y);
        ctx.globalAlpha = 1.0;
      } else if (effect.type === 'impact') {
        ctx.strokeStyle = `rgba(255, 221, 89, ${effect.life})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, (1.0 - effect.life) * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // The map is dimmed except around allied squads, within their sight.
  function drawFog(squads, ratio) {
    fogCtx.setTransform(1, 0, 0, 1, 0, 0);
    fogCtx.scale(ratio, ratio);
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.clearRect(0, 0, size.width, size.height);
    fogCtx.fillStyle = 'rgba(25, 40, 60, 0.4)';
    fogCtx.fillRect(0, 0, size.width, size.height);
    fogCtx.globalCompositeOperation = 'destination-out';
    for (const squad of squads) {
      if (squad.team !== 'ally' || squad.units.length === 0) continue;
      const screen = worldToScreen(camera, size, squad.centerX, squad.centerY);
      const sight = squad.vision * camera.zoom;
      const gradient = fogCtx.createRadialGradient(screen.x, screen.y, sight * 0.3, screen.x, screen.y, sight);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      fogCtx.fillStyle = gradient;
      fogCtx.beginPath();
      fogCtx.arc(screen.x, screen.y, sight, 0, Math.PI * 2);
      fogCtx.fill();
    }
    fogCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(fogCanvas, 0, 0, size.width, size.height);
  }

  // dt: real seconds since the last frame (effects fade in real time). drawing: the line being dragged, or null.
  function draw(squads, dt, drawing) {
    const ratio = resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#689F38';
    ctx.fillRect(0, 0, size.width, size.height);

    ctx.save();
    ctx.translate(size.width / 2, size.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(camera.x, camera.y);
    const bounds = {
      left: -size.width / 2 / camera.zoom - camera.x,
      right: size.width / 2 / camera.zoom - camera.x,
      top: -size.height / 2 / camera.zoom - camera.y,
      bottom: size.height / 2 / camera.zoom - camera.y,
    };
    drawTerrain(bounds);

    for (const squad of squads) {
      if (squad.units.length === 0 || (squad.team === 'enemy' && !squad.visible)) continue;
      if (squad.selected) drawSelection(squad);
      const isAlly = squad.team === 'ally';
      const colors = { surcoat: isAlly ? '#ecf0f1' : '#c0392b', cross: isAlly ? '#111111' : '#f1c40f' };
      for (const unit of squad.units) {
        if (unit.hp > 0) drawSoldier(squad, unit, colors);
      }
    }
    drawEffects(dt);
    ctx.restore();

    drawFog(squads, ratio);

    if (drawing) {
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(drawing.startX, drawing.startY);
      ctx.lineTo(drawing.currentX, drawing.currentY);
      ctx.stroke();
    }
  }

  return {
    draw,
    addEvent,
    resize,
    getEffectCount: () => effects.length,
    dispose() {
      effects.length = 0;
    },
  };
}
