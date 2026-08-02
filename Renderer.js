class Renderer {
 constructor(canvas) {
 this.canvas = canvas;
 this.ctx = canvas.getContext('2d');
 this.vfxList = []; 
 this.fowCanvas = document.createElement('canvas');
 this.fowCtx = this.fowCanvas.getContext('2d');
 
 // 💡 마지막에 그린 선택 상태를 기억하는 변수 (최적화용)
 this.lastSelectedState = false; 

 // ⭐ 캔버스가 무한정 팽창해서 우글거리거나 잘리는 걸 방지
 this.canvas.style.width = '100vw';
 this.canvas.style.height = '100vh';
 this.canvas.style.display = 'block';
 }

 addVFX(type, x, y, text, color) {
 this.vfxList.push({ type, x, y, text, color, life: 1.0, vx: (Math.random()-0.5)*20, vy: -30 });
 }

 draw(squads, inputHandler, dt, terrain) {
 window.currentSquads = squads;

 const dpr = window.devicePixelRatio || 1;
 // ⭐ 실제 화면에 표시되는 크기를 가져와서 오차 없앰
 const cssW = this.canvas.clientWidth;
 const cssH = this.canvas.clientHeight;

 const targetW = Math.round(cssW * dpr);
 const targetH = Math.round(cssH * dpr);

 if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
 this.canvas.width = targetW;
 this.canvas.height = targetH;
 this.fowCanvas.width = targetW;
 this.fowCanvas.height = targetH;
 }

 let ctx = this.ctx;
 
 ctx.setTransform(1, 0, 0, 1, 0, 0);
 ctx.scale(dpr, dpr);
 ctx.imageSmoothingEnabled = true;

 ctx.fillStyle = '#689F38'; 
 ctx.fillRect(0, 0, cssW, cssH);
 
 let cs = terrain ? terrain.cellSize : 40;
 ctx.save();
 ctx.translate(cssW/2, cssH/2);
 ctx.scale(inputHandler.cam.zoom, inputHandler.cam.zoom);
 ctx.translate(inputHandler.cam.x, inputHandler.cam.y);

 if (terrain) {
 let tw = terrain.cols; let th = terrain.rows;
 for(let r=0; r<th; r++) {
 for(let c=0; c<tw; c++) {
 let cell = terrain.grid[r][c];
 let px = c * cs - terrain.width/2;
 let py = r * cs - terrain.height/2;

 if (cell.type === 'plain' || cell.type === 'forest') continue;

 if (cell.type === 'hill') {
 ctx.fillStyle = '#8BC34A'; ctx.fillRect(px, py, cs, cs);
 ctx.fillStyle = 'rgba(0, 100, 0, 0.25)'; ctx.font = '16px Arial';
 ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('▲', px + cs/2, py + cs/2);
 } else if (cell.type === 'highland') {
 ctx.fillStyle = '#D7CCC8'; ctx.fillRect(px, py, cs, cs);
 ctx.strokeStyle = '#BCAAA4'; ctx.lineWidth = 1; ctx.strokeRect(px + 1, py + 1, cs - 2, cs - 2);
 } else if (cell.type === 'cliff') {
 ctx.fillStyle = '#454545'; ctx.fillRect(px, py, cs, cs);
 ctx.strokeStyle = '#292929'; ctx.lineWidth = 2;
 for(let i=0; i<cs; i+=10) {
 ctx.beginPath(); ctx.moveTo(px+i, py); ctx.lineTo(px, py+i); ctx.stroke();
 ctx.beginPath(); ctx.moveTo(px+cs, py+i); ctx.lineTo(px+i, py+cs); ctx.stroke();
 }
 } else if (cell.type === 'wall') {
 ctx.fillStyle = '#9E9E9E'; ctx.fillRect(px, py, cs, cs);
 ctx.strokeStyle = '#616161'; ctx.lineWidth = 1.5; ctx.strokeRect(px, py, cs, cs);
 ctx.beginPath();
 ctx.moveTo(px, py + cs/2); ctx.lineTo(px + cs, py + cs/2);
 ctx.moveTo(px + cs/2, py); ctx.lineTo(px + cs/2, py + cs/2);
 ctx.moveTo(px + cs/4, py + cs/2); ctx.lineTo(px + cs/4, py + cs);
 ctx.moveTo(px + cs*0.75, py + cs/2); ctx.lineTo(px + cs*0.75, py + cs);
 ctx.stroke();
 } else if (cell.type === 'stairs') {
 ctx.fillStyle = '#8B5A2B'; ctx.fillRect(px, py, cs, cs);
 ctx.strokeStyle = '#3E2723'; ctx.lineWidth = 2; ctx.strokeRect(px + 2, py + 2, cs - 4, cs - 4);
 ctx.beginPath();
 ctx.moveTo(px, py + cs*0.3); ctx.lineTo(px + cs, py + cs*0.3);
 ctx.moveTo(px, py + cs*0.7); ctx.lineTo(px + cs, py + cs*0.7);
 ctx.stroke();
 ctx.fillStyle = '#111'; 
 ctx.fillRect(px + 4, py + 4, 3, 3); ctx.fillRect(px + cs - 7, py + 4, 3, 3);
 ctx.fillRect(px + 4, py + cs - 7, 3, 3); ctx.fillRect(px + cs - 7, py + cs - 7, 3, 3);
 }
 }
 }
 for(let r=0; r<th; r++) {
 for(let c=0; c<tw; c++) {
 if (terrain.grid[r][c].type === 'forest') {
 let px = c * cs - terrain.width/2; let py = r * cs - terrain.height/2;
 const drawTree = (tx, ty, radius) => {
 ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; ctx.beginPath(); ctx.arc(tx + 2, ty + 2, radius, 0, Math.PI * 2); ctx.fill();
 ctx.fillStyle = '#2E7D32'; ctx.beginPath(); ctx.arc(tx, ty, radius, 0, Math.PI * 2); ctx.fill();
 ctx.fillStyle = '#4CAF50'; ctx.beginPath(); ctx.arc(tx - 1.5, ty - 1.5, radius * 0.6, 0, Math.PI * 2); ctx.fill();
 };
 drawTree(px + cs*0.25, py + cs*0.3, cs*0.3); drawTree(px + cs*0.75, py + cs*0.4, cs*0.32); drawTree(px + cs*0.5, py + cs*0.7, cs*0.35);
 }
 }
 }
 }

 squads.forEach(sq => {
 if (sq.units.length === 0 || (sq.team === 'enemy' && !sq.visible)) return;

 if (sq.selected) {
 ctx.beginPath(); ctx.arc(sq.centerX, sq.centerY, 18, 0, Math.PI * 2);
 ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fill();
 ctx.strokeStyle = 'rgba(241, 196, 15, 0.8)'; ctx.lineWidth = 1.5; ctx.stroke();

 if (sq.waypoints && sq.waypoints.length > 0) {
 ctx.strokeStyle = '#ffdd59'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]);
 ctx.beginPath(); ctx.moveTo(sq.centerX, sq.centerY);
 sq.waypoints.forEach(wp => ctx.lineTo(wp.x, wp.y));
 ctx.stroke(); ctx.setLineDash([]);
 sq.waypoints.forEach((wp, idx) => {
 ctx.fillStyle = '#ffdd59'; ctx.beginPath(); ctx.arc(wp.x, wp.y, 9, 0, Math.PI * 2); ctx.fill();
 ctx.fillStyle = '#1e272e'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(idx + 1, wp.x, wp.y);
 });
 }
 }

 let isAlly = sq.team === 'ally';
 let surcoatColor = isAlly ? '#ecf0f1' : '#c0392b'; 
 let crossColor = isAlly ? '#111111' : '#f1c40f'; 

 sq.units.forEach(u => {
 if (u.hp <= 0) return;
 ctx.save();
 ctx.translate(u.x, u.y);
 
 let angle = sq.angle;
 if (sq.state === 'combat' && u.target) angle = Math.atan2(u.target.y - u.y, u.target.x - u.x);
 ctx.rotate(angle); 

 ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1.5;
 
 if (sq.subType === 'heavy_cav') {
 ctx.fillStyle = '#7f8c8d';
 ctx.beginPath(); ctx.ellipse(0, 0, u.radius*1.1, u.radius*0.8, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
 } else if (sq.subType === 'light_cav' || sq.subType === 'horse_archer') {
 ctx.fillStyle = '#8B4513';
 ctx.beginPath(); ctx.ellipse(0, 0, u.radius*1.1, u.radius*0.7, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
 }

 ctx.beginPath(); ctx.arc(0, 0, u.radius * (sq.type === 'cavalry' ? 0.7 : 1.0), 0, Math.PI * 2);
 ctx.fillStyle = surcoatColor; ctx.fill();
 ctx.shadowColor = 'transparent'; 
 ctx.lineWidth = 1; ctx.strokeStyle = '#2c3e50'; ctx.stroke();

 let cRad = u.radius * (sq.type === 'cavalry' ? 0.7 : 1.0);
 ctx.fillStyle = crossColor;
 ctx.fillRect(-cRad*0.6, -1.5, cRad*1.2, 3);
 ctx.fillRect(-1.5, -cRad*0.6, 3, cRad*1.2);

 ctx.fillStyle = '#bdc3c7'; 
 ctx.strokeStyle = '#34495e';
 ctx.lineWidth = 1.5;
 
 if (sq.subType === 'heavy_cav' || sq.subType === 'shock') {
 ctx.fillRect(-2, -3, 6, 6); ctx.strokeRect(-2, -3, 6, 6);
 if (sq.subType === 'heavy_cav') { 
 ctx.fillStyle = '#d35400'; 
 ctx.beginPath(); ctx.moveTo(-1, -3); ctx.lineTo(-4, -7); ctx.lineTo(2, -3); ctx.fill();
 ctx.beginPath(); ctx.moveTo(-1, 3); ctx.lineTo(-4, 7); ctx.lineTo(2, 3); ctx.fill();
 }
 } else if (sq.subType === 'light_cav') {
 ctx.fillStyle = '#95a5a6';
 ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
 } else {
 ctx.beginPath(); ctx.arc(1, 0, 4.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
 }

 ctx.fillStyle = '#95a5a6';
 if (sq.subType === 'shield') {
 ctx.beginPath();
 ctx.moveTo(u.radius - 2, -u.radius - 1); ctx.lineTo(u.radius + 6, 0);
 ctx.lineTo(u.radius - 2, u.radius + 1); ctx.lineTo(u.radius - 5, 0);
 ctx.fillStyle = surcoatColor; ctx.fill(); ctx.stroke();
 ctx.fillStyle = crossColor;
 ctx.fillRect(u.radius - 2, -1, 4, 2); ctx.fillRect(u.radius - 1, -2, 2, 4);
 } 
 else if (sq.subType === 'pike') {
 ctx.fillStyle = '#8B4513'; ctx.fillRect(2, 2, 30, 1.5); 
 ctx.fillStyle = '#bdc3c7'; ctx.beginPath(); ctx.moveTo(32, 1.5); ctx.lineTo(36, 2.75); ctx.lineTo(32, 4); ctx.fill();
 }
 else if (sq.subType === 'spear') {
 ctx.fillStyle = '#8B4513'; ctx.fillRect(4, 3, 14, 2); 
 ctx.fillStyle = '#bdc3c7'; ctx.beginPath(); ctx.moveTo(18, 2); ctx.lineTo(24, 4); ctx.lineTo(18, 6); ctx.fill(); 
 } 
 else if (sq.subType === 'heavy_cav' || sq.subType === 'light_cav') {
 ctx.fillStyle = '#8B4513'; ctx.fillRect(4, 3, 16, 2); 
 ctx.fillStyle = '#bdc3c7'; ctx.beginPath(); ctx.moveTo(20, 2); ctx.lineTo(26, 4); ctx.lineTo(20, 6); ctx.fill(); 
 }
 else if (sq.subType === 'shock') {
 ctx.fillStyle = '#8B4513'; ctx.fillRect(4, -4, 12, 2); 
 ctx.fillStyle = '#bdc3c7'; ctx.beginPath(); ctx.moveTo(14, -8); ctx.lineTo(16, -2); ctx.lineTo(14, -4); ctx.fill();
 } 
 else if (sq.subType === 'crossbow') {
 ctx.fillStyle = '#5c4033'; ctx.fillRect(4, -1, 10, 2); 
 ctx.strokeStyle = '#bdc3c7'; ctx.lineWidth = 2;
 ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(10, 5); ctx.stroke(); 
 }
 else if (sq.subType === 'archer') {
 ctx.fillStyle = '#5c4033'; ctx.fillRect(4, -1, 8, 2); 
 ctx.beginPath(); ctx.arc(10, 0, 6, -Math.PI/1.8, Math.PI/1.8); ctx.stroke(); 
 }
 
 if (sq.selected) {
 ctx.rotate(-angle); 
 const hpRatio = u.hp / u.maxHp;
 const barWidth = u.radius * 2;
 ctx.fillStyle = 'rgba(231, 76, 60, 0.8)'; ctx.fillRect(-u.radius, -u.radius - 8, barWidth, 3);
 ctx.fillStyle = 'rgba(46, 204, 113, 0.9)'; ctx.fillRect(-u.radius, -u.radius - 8, barWidth * hpRatio, 3);
 }
 ctx.restore();
 });
 });

 for (let i = this.vfxList.length - 1; i >= 0; i--) {
 let v = this.vfxList[i];
 v.life -= dt * 1.5;
 if (v.life <= 0) { this.vfxList.splice(i, 1); continue; }
 if (v.type === 'text') { 
 v.x += v.vx * dt; v.y += v.vy * dt;
 ctx.fillStyle = v.color; ctx.globalAlpha = v.life;
 ctx.font = 'bold 14px sans-serif'; ctx.fillText(v.text, v.x, v.y);
 ctx.globalAlpha = 1.0;
 } else if (v.type === 'impact') { 
 ctx.strokeStyle = `rgba(255, 221, 89, ${v.life})`; ctx.lineWidth = 3;
 ctx.beginPath(); ctx.arc(v.x, v.y, (1.0 - v.life) * 22, 0, Math.PI*2); ctx.stroke();
 }
 }
 ctx.restore(); 

 let fCtx = this.fowCtx;
 fCtx.setTransform(1, 0, 0, 1, 0, 0);
 fCtx.scale(dpr, dpr);
 fCtx.clearRect(0, 0, cssW, cssH);
 
 fCtx.fillStyle = 'rgba(25, 40, 60, 0.4)'; 
 fCtx.fillRect(0, 0, cssW, cssH);
 fCtx.globalCompositeOperation = 'destination-out'; 

 squads.forEach(sq => {
 if (sq.team === 'ally' && sq.units.length > 0) {
 let screenX = (sq.centerX + inputHandler.cam.x) * inputHandler.cam.zoom + cssW/2;
 let screenY = (sq.centerY + inputHandler.cam.y) * inputHandler.cam.zoom + cssH/2;
 let screenVision = sq.vision * inputHandler.cam.zoom;
 let gradient = fCtx.createRadialGradient(screenX, screenY, screenVision * 0.3, screenX, screenY, screenVision);
 gradient.addColorStop(0, 'rgba(0, 0, 0, 1)'); gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
 fCtx.fillStyle = gradient;
 fCtx.beginPath(); fCtx.arc(screenX, screenY, screenVision, 0, Math.PI*2); fCtx.fill();
 }
 });
 fCtx.globalCompositeOperation = 'source-over'; 

 ctx.drawImage(this.fowCanvas, 0, 0, cssW, cssH);

 if (inputHandler.actionData && inputHandler.actionData.type === 'drawing') {
 ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 3;
 ctx.beginPath(); ctx.moveTo(inputHandler.startX, inputHandler.startY); 
 ctx.lineTo(inputHandler.currentX, inputHandler.currentY); ctx.stroke();
 }

 let hasSelectedSquad = false;
 squads.forEach(sq => {
 if (sq.selected) hasSelectedSquad = true;
 });
 
 // 💡 [최적화 반영] 불필요한 UI 갱신 방지
 if (window.updateUISelectionState) {
     if (this.lastSelectedState !== hasSelectedSquad) {
         window.updateUISelectionState(hasSelectedSquad);
         this.lastSelectedState = hasSelectedSquad;
     }
 }
 }
}
