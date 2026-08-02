class Soldier {
 constructor(squad) {
 this.squad = squad;
 this.x = squad.x + (Math.random() - 0.5) * 20;
 this.y = squad.y + (Math.random() - 0.5) * 20;
 this.attackCooldown = 0;
 this.chargeDamage = 0; 

 let sub = squad.subType;
 if (sub === 'shield') { this.hp = 180; this.armor = 8; this.dmg = 1.5; this.baseMass = 5.0; this.radius = 9; this.projectileResist = 0.8; }
 else if (sub === 'shock') { this.hp = 55; this.armor = 3; this.dmg = 9; this.baseMass = 1.5; this.radius = 8; }
 else if (sub === 'pike') { this.hp = 45; this.armor = 2; this.dmg = 5; this.baseMass = 3.5; this.radius = 8; }
 else if (sub === 'heavy_cav') { this.hp = 250; this.armor = 8; this.dmg = 2.5; this.baseMass = 12.0; this.radius = 13; }
 else if (sub === 'light_cav') { this.hp = 45; this.armor = 2; this.dmg = 3; this.baseMass = 2.0; this.radius = 10; }
 else if (sub === 'crossbow') { this.hp = 35; this.armor = 2; this.dmg = 4; this.baseMass = 1.0; this.radius = 7; this.ammo = 15; this.rangedDmg = 12; this.armorPierce = 0.8; }
 else if (sub === 'archer') { this.hp = 25; this.armor = 0; this.dmg = 4; this.baseMass = 0.8; this.radius = 7; this.ammo = 40; this.rangedDmg = 8; this.armorPierce = 0; }
 else { this.hp = 30; this.armor = 1; this.dmg = 3; this.baseMass = 1.0; this.radius = 8; }
 
 this.mass = this.baseMass;
 this.maxHp = this.hp;
 }

 update(targetX, targetY, dt, terrain, isRouting) {
 if (this.hp <= 0) return; 
 if (this.attackCooldown > 0) this.attackCooldown -= dt;

 this.chargeDamage = 0; 
 this.mass = this.baseMass;

 let speedMultiplier = isRouting ? 1.5 : 1.0;
 let form = this.squad.currentFormation;

 if (form === 'column') speedMultiplier *= 1.15; 
 else if (form === 'square' || form === 'shield_wall') {
 speedMultiplier *= 0.3; 
 this.mass = this.baseMass * 2.5; 
 } 
 else if (form === 'phalanx') {
 speedMultiplier *= 0.4;
 this.mass = this.baseMass * 2.0;
 }
 else if (form === 'wedge') {
 this.mass = this.baseMass * 1.5;
 }

 if (this.squad.type === 'cavalry') {
 let ratio = this.squad.momentum / 100;
 if (this.squad.subType === 'light_cav') {
 speedMultiplier *= (2.0 + (ratio * ratio * 2.8)); 
 this.chargeDamage = (ratio * ratio) * 45; 
 } else if (this.squad.subType === 'heavy_cav') {
 speedMultiplier *= (0.7 + (ratio * 0.2)); 
 }
 }

 if (this.squad.subType === 'light_cav' && this.squad.targetSquad && this.squad.targetSquad.subType === 'pike' && this.squad.targetSquad.currentFormation === 'phalanx') {
 let distToPike = Math.hypot(this.x - this.squad.targetSquad.centerX, this.y - this.squad.targetSquad.centerY);
 if (distToPike < 120) { speedMultiplier *= 0.1; this.squad.momentum = 0; }
 }

 if (isRouting) {
 let escapeLimitX = terrain ? (terrain.width / 2) + 50 : 2500;
 targetX = this.squad.team === 'ally' ? -escapeLimitX : escapeLimitX; 

 if (this.squad.team === 'ally' && this.x <= -escapeLimitX + 70) { this.hp = 0; return; }
 else if (this.squad.team === 'enemy' && this.x >= escapeLimitX - 70) { this.hp = 0; return; }
 }
 
 let isStationary = this.squad.waypoints.length === 0 && this.squad.state !== 'combat' && !this.squad.targetSquad;

 let tx = targetX;
 let ty = targetY;
 if (!isStationary && (this.squad.state === 'combat' || this.squad.targetSquad)) {
 if (this.target && this.target.hp > 0) {
 tx = this.target.x; ty = this.target.y;
 } else if (this.squad.targetSquad) {
 tx = this.squad.targetSquad.centerX; ty = this.squad.targetSquad.centerY;
 }
 }

 let sepX = 0, sepY = 0, neighbors = 0;
 if (!isStationary) {
 this.squad.units.forEach(other => {
 if (other !== this && other.hp > 0) {
 let d = Math.hypot(this.x - other.x, this.y - other.y);
 if (d > 0 && d < this.radius * 1.2) {
 sepX += (this.x - other.x) / d; sepY += (this.y - other.y) / d; neighbors++;
 }
 }
 });
 }
 
 let dx = tx - this.x; let dy = ty - this.y;
 if (neighbors > 0) { dx += (sepX / neighbors) * 8; dy += (sepY / neighbors) * 8; }

 let dist = Math.hypot(dx, dy);
 let deadzone = isStationary ? 2.0 : 0.5; 
 if (form === 'shield_wall' || form === 'square') deadzone = 4.0; 

 if (dist > deadzone) {
 let currentCell = terrain ? terrain.getAt(this.x, this.y) : null;
 if (currentCell) {
 if (currentCell.type === 'forest') speedMultiplier *= 0.5;
 else if (currentCell.type === 'hill') speedMultiplier *= 0.8;
 }

 let baseSpeed = isRouting ? (this.squad.speed * 80) : (this.squad.speed * 60);
 let moveDist = Math.min(baseSpeed * speedMultiplier * dt, dist);
 let nextX = this.x + (dx / dist) * moveDist; 
 let nextY = this.y + (dy / dist) * moveDist;

 if (!isRouting && terrain) {
 let limitX = (terrain.width / 2) - this.radius;
 let limitY = (terrain.height / 2) - this.radius;
 if (nextX < -limitX) nextX = -limitX;
 if (nextX > limitX) nextX = limitX;
 if (nextY < -limitY) nextY = -limitY;
 if (nextY > limitY) nextY = limitY;
 }

 let checkValid = (nx, ny) => {
 if (!terrain) return true;
 let nextCell = terrain.getAt(nx, ny);
 if (!nextCell || nextCell.type === 'wall' || nextCell.type === 'cliff') return false;
 if (!currentCell) return true;
 let curH = currentCell.h || 0; let nxtH = nextCell.h || 0;
 if (Math.abs(nxtH - curH) > 1 && currentCell.type !== 'stairs' && nextCell.type !== 'stairs') return false;
 return true;
 };

 if (checkValid(nextX, nextY)) { this.x = nextX; this.y = nextY; }
 else if (checkValid(nextX, this.y)) { this.x = nextX; }
 else if (checkValid(this.x, nextY)) { this.y = nextY; }
 }
 }
}

class Squad {
 constructor(id, team, type, subType, tier, x, y) {
 this.id = id; this.team = team; this.type = type; this.subType = subType;
 this.tier = tier; 
 this.x = x; this.y = y; this.angle = 0;
 this.morale = 100; this.state = 'idle';
 this.selected = false; this.waypoints = [];
 this.targetSquad = null; 
 this.formationWidth = 120; this.momentum = 0;
 this.visible = true;
 this.lastUnitCount = 12;
 
 this.aiRole = null;
 if (team === 'enemy') {
 if (subType === 'light_cav' || type === 'archer') this.aiRole = 'skirmisher'; 
 else if (subType === 'heavy_cav') this.aiRole = 'flanker'; 
 else this.aiRole = 'anvil'; 
 }

 this.currentFormation = 'line';
 if (subType === 'light_cav' || subType === 'heavy_cav') this.specialFormation = 'wedge';
 else if (subType === 'shield') this.specialFormation = 'shield_wall';
 else if (subType === 'pike') this.specialFormation = 'phalanx'; 
 else if (subType === 'shock') this.specialFormation = 'oblique'; 
 else if (subType === 'archer' || subType === 'crossbow') this.specialFormation = 'skirmish';
 else this.specialFormation = 'line'; 

 if (type === 'cavalry') { this.speed = subType === 'heavy_cav' ? 0.80 : 1.10; this.vision = 300; }
 else if (type === 'archer') { this.speed = 0.6; this.vision = 450; }
 else { this.speed = 0.5; this.vision = 250; }

 this.units = Array.from({length: 12}, () => new Soldier(this));
 }

 get centerX() {
 if (this.units.length === 0) return this.x;
 let sumX = 0, sumY = 0;
 for (let u of this.units) { sumX += u.x; sumY += u.y; }
 return sumX / this.units.length;
 }

 get centerY() {
 if (this.units.length === 0) return this.y;
 let sumX = 0, sumY = 0;
 for (let u of this.units) { sumX += u.x; sumY += u.y; }
 return sumY / this.units.length;
 }

 update(dt, terrain) {
 this.units = this.units.filter(u => u.hp > 0);
 let count = this.units.length;
 if (count === 0) return; 

 if (count < this.lastUnitCount) {
 let deadCount = this.lastUnitCount - count;
 this.morale -= deadCount * 20; 
 this.lastUnitCount = count;
 }
 
 if (this.tier === 1 && this.morale < 30) {
 this.state = 'routing'; this.selected = false; this.targetSquad = null;
 }

 if (this.state === 'routing') {
 this.units.forEach(u => u.update(0, 0, dt, terrain, true)); return;
 }

 if (window.isPreparationPhase) {
 this.targetSquad = null; 
 if (this.state === 'combat') this.state = 'idle';
 
 this.units.forEach(u => {
 u.target = null;
 u.attackCooldown = 2.0; 
 });

 // 💡 [수정됨] 적군은 이동/공격만 막고 진형 배치 로직은 실행되도록 변경
 if (this.team === 'enemy') {
     this.waypoints = []; 
     // 기존에 있던 return; 을 삭제하여 아래의 대형 형성 코드로 넘어감
 }
 }


 if (!window.isPreparationPhase && this.team === 'enemy' && window.currentSquads) {
 let playerSquads = window.currentSquads.filter(sq => sq.team === 'ally' && sq.units.length > 0 && sq.state !== 'routing');

 if (playerSquads.length > 0) {
 if (this.aiRole === 'skirmisher') {
 let closestAlly = playerSquads.reduce((prev, curr) => 
 Math.hypot(this.centerX - prev.centerX, this.centerY - prev.centerY) < Math.hypot(this.centerX - curr.centerX, this.centerY - curr.centerY) ? prev : curr
 );
 let dist = Math.hypot(this.centerX - closestAlly.centerX, this.centerY - closestAlly.centerY);
 
 if (dist < 120) { 
 let fleeAngle = Math.atan2(this.centerY - closestAlly.centerY, this.centerX - closestAlly.centerX);
 this.waypoints = [{x: this.centerX + Math.cos(fleeAngle)*150, y: this.centerY + Math.sin(fleeAngle)*150}];
 this.targetSquad = null;
 this.state = 'idle'; 
 } else if (dist < this.vision * 0.9) {
 this.targetSquad = closestAlly;
 } else {
 this.waypoints = [{x: closestAlly.centerX, y: closestAlly.centerY}];
 this.targetSquad = null;
 }
 } 
 else if (this.aiRole === 'flanker') {
 let target = playerSquads.find(sq => sq.type === 'archer') || playerSquads.reduce((prev, curr) => 
 Math.hypot(this.centerX - prev.centerX, this.centerY - prev.centerY) < Math.hypot(this.centerX - curr.centerX, this.centerY - curr.centerY) ? prev : curr
 );
 this.targetSquad = target;
 }
 else {
 if (!this.targetSquad || this.targetSquad.units.length === 0 || this.targetSquad.state === 'routing') {
 this.targetSquad = playerSquads.reduce((prev, curr) => 
 Math.hypot(this.centerX - prev.centerX, this.centerY - prev.centerY) < Math.hypot(this.centerX - curr.centerX, this.centerY - curr.centerY) ? prev : curr
 );
 }
 }
 } else {
 this.targetSquad = null;
 }
 }

 if (this.targetSquad) {
 if (this.targetSquad.units.length === 0 || this.targetSquad.state === 'routing') {
 this.targetSquad = null; this.state = 'idle';
 } else {
 let distToTarget = Math.hypot(this.centerX - this.targetSquad.centerX, this.centerY - this.targetSquad.centerY);
 if (distToTarget < (this.vision * 0.8)) {
 this.waypoints = []; this.state = 'combat';
 } else {
 this.waypoints = [{x: this.targetSquad.centerX, y: this.targetSquad.centerY}];
 }
 }
 }

 if (this.waypoints.length > 0) {
 let wp = this.waypoints[0];
 let dist = Math.hypot(wp.x - this.x, wp.y - this.y);
 if (dist > 5) {
 this.angle = Math.atan2(wp.y - this.y, wp.x - this.x);
 
 let currentSquadSpeed = this.speed;
 if (this.currentFormation === 'shield_wall' || this.currentFormation === 'square') currentSquadSpeed *= 0.3;
 else if (this.currentFormation === 'column') currentSquadSpeed *= 1.15;

 let moveDist = currentSquadSpeed * dt * 60;
 let nextX = this.x + Math.cos(this.angle) * moveDist;
 let nextY = this.y + Math.sin(this.angle) * moveDist;

 if (terrain) {
 let limitX = (terrain.width / 2) - 15;
 let limitY = (terrain.height / 2) - 15;
 if (nextX < -limitX) nextX = -limitX;
 if (nextX > limitX) nextX = limitX;
 if (nextY < -limitY) nextY = -limitY;
 if (nextY > limitY) nextY = limitY;
 }

 let checkValidSquad = (nx, ny) => {
 if (!terrain) return true;
 let nextCell = terrain.getAt(nx, ny);
 let currentCell = terrain.getAt(this.x, this.y);
 if (!nextCell || nextCell.type === 'wall' || nextCell.type === 'cliff') return false;
 if (!currentCell) return true;
 let curH = currentCell.h || 0; let nxtH = nextCell.h || 0;
 if (Math.abs(nxtH - curH) > 1 && currentCell.type !== 'stairs' && nextCell.type !== 'stairs') return false;
 return true;
 };

 if (checkValidSquad(nextX, nextY)) { this.x = nextX; this.y = nextY; }
 else if (checkValidSquad(nextX, this.y)) { this.x = nextX; }
 else if (checkValidSquad(this.x, nextY)) { this.y = nextY; }

 if (this.type === 'cavalry') {
 this.momentum = Math.min(100, this.momentum + dt * (this.subType === 'light_cav' ? 50 : 25));
 }
 } else {
 this.formationWidth = wp.width || this.formationWidth;
 if (!this.targetSquad) this.waypoints.shift(); 
 }
 } else {
 if (this.momentum > 0 && this.state !== 'combat') this.momentum -= dt * 100;
 if (this.momentum < 0) this.momentum = 0;
 }

 let positions = [];
 let form = this.currentFormation;

 if (form === 'loose') { 
 let spacing = 35; let cols = Math.max(1, Math.floor(this.formationWidth / spacing));
 if (cols > count) cols = Math.max(1, count);
 let rows = Math.ceil(count / cols);
 for (let i = 0; i < count; i++) {
 let r = Math.floor(i / cols); let c = i % cols;
 let offset = (r % 2 === 0) ? 0 : spacing * 0.5;
 positions.push({ x: (c - (cols - 1) / 2) * spacing + offset, y: -(r - (rows - 1) / 2) * spacing });
 }
 }
 else if (form === 'column') {
 let spacing = 20; let cols = 3; 
 let rows = Math.ceil(count / cols);
 for (let i = 0; i < count; i++) {
 let r = Math.floor(i / cols); let c = i % cols;
 positions.push({ x: (c - (cols - 1) / 2) * spacing, y: -(r - (rows - 1) / 2) * spacing });
 }
 } 
 else if (form === 'square') {
 let spacing = 16; let cols = Math.ceil(Math.sqrt(count)); 
 let rows = Math.ceil(count / cols);
 for (let i = 0; i < count; i++) {
 let r = Math.floor(i / cols); let c = i % cols;
 positions.push({ x: (c - (cols - 1) / 2) * spacing, y: -(r - (rows - 1) / 2) * spacing });
 }
 }
 else if (form === 'oblique') {
 let spacing = 20; let layout = [4, 4, 2, 2]; let placed = 0;
 for (let c = 0; c < layout.length; c++) {
 for (let r = 0; r < layout[c] && placed < count; r++) {
 positions.push({ x: (c - 1.5) * spacing, y: -r * spacing }); placed++;
 }
 }
 }
 else if (form === 'skirmish') {
 let spacing = 35; let cols = Math.ceil(count / 2);
 for (let i=0; i<count; i++) {
 let r = Math.floor(i/cols); let c = i%cols;
 let offset = r % 2 === 0 ? 0 : spacing * 0.5;
 positions.push({ x: (c - (cols - 1) / 2) * spacing + offset, y: -r * spacing });
 }
 }
 else if (form === 'wedge') {
 let spacing = 26; let placed = 0;
 let totalRows = Math.ceil((-1 + Math.sqrt(1 + 8 * count)) / 2); 
 let yOffset = (totalRows * spacing) / 2; 
 for (let r = 0; r < 10 && placed < count; r++) {
 for (let c = 0; c <= r && placed < count; c++) {
 positions.push({ x: (c - r / 2) * spacing, y: -r * spacing + yOffset }); placed++;
 }
 }
 } 
 else if (form === 'shield_wall' || form === 'phalanx') {
 let spacing = 18; let cols = Math.max(3, Math.floor(this.formationWidth / spacing));
 let rows = Math.ceil(count / cols);
 for (let i = 0; i < count; i++) {
 let r = Math.floor(i / cols); let c = i % cols;
 positions.push({ x: (c - (cols - 1) / 2) * spacing, y: -(r - (rows - 1) / 2) * spacing });
 }
 } 
 else {
 let spacing = 24; let cols = Math.max(1, Math.floor(this.formationWidth / spacing));
 if (cols > count) cols = Math.max(1, count);
 let rows = Math.ceil(count / cols);
 for (let i = 0; i < count; i++) {
 let r = Math.floor(i / cols); let c = i % cols;
 positions.push({ x: (c - (cols - 1) / 2) * spacing, y: -(r - (rows - 1) / 2) * spacing });
 }
 }
 
 for (let i = 0; i < count; i++) {
 let cos = Math.cos(this.angle - Math.PI/2); 
 let sin = Math.sin(this.angle - Math.PI/2);
 let targetX = this.x + (positions[i].x * cos - positions[i].y * sin);
 let targetY = this.y + (positions[i].x * sin + positions[i].y * cos);
 this.units[i].update(targetX, targetY, dt, terrain, false); 
 }
 }
}
