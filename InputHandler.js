class InputHandler {
    constructor(canvas) {
        this.canvas = canvas;
        this.cam = { x: 0, y: 0, zoom: 1.0 }; 
        this.startX = 0; this.startY = 0;
        this.currentX = 0; this.currentY = 0;
        
        this.initialPinchDist = null;
        this.initialCamZoom = 1.0;
        
        this.lastTouchendTime = 0; 
        this.isDoubleTapHold = false;
        this.isPanning = false;

        this.action = null; 
        this.actionData = null;
        this.initEvents();
    }

    initEvents() {
        // ⭐ passive: false를 유지하되, 하단 UI 영역 터치는 캔버스가 무시하도록 처리
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
    }

    getCanvasPos(touch) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    // 💡 핵심 방어막: 터치한 위치가 화면 맨 아래(하단 UI 바 영역)라면 캔버스가 이벤트를 무시함
    isTouchOnUI(touch) {
        const screenH = window.innerHeight;
        // 화면 아래쪽 100픽셀 내외는 하단 바 영역으로 간주하여 캔버스 조작 차단
        if (touch.clientY > screenH - 120) {
            return true;
        }
        return false;
    }

    getWorldCoords(canvasX, canvasY) {
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        return {
            x: (canvasX - cw / 2) / this.cam.zoom - this.cam.x,
            y: (canvasY - ch / 2) / this.cam.zoom - this.cam.y
        };
    }

    onTouchStart(e) {
        if (e.touches.length > 0 && this.isTouchOnUI(e.touches[0])) {
            return; // 💡 하단 메뉴를 누른 거라면 캔버스가 터치를 아예 가로채지 않음!
        }

        e.preventDefault(); 
        if (e.touches.length === 1) {
            const pos = this.getCanvasPos(e.touches[0]); 
            this.startX = pos.x; this.startY = pos.y;
            this.currentX = pos.x; this.currentY = pos.y;
            
            const now = Date.now();
            if (now - this.lastTouchendTime < 90) {
                this.isDoubleTapHold = true;
                this.isPanning = false;
                this.actionData = { type: 'drawing', current: pos }; 
            } else {
                this.isDoubleTapHold = false;
                this.isPanning = true;
                this.actionData = null;
            }
        } else if (e.touches.length === 2) {
            this.isDoubleTapHold = false;
            this.isPanning = false;
            this.actionData = null; 
            const pos1 = this.getCanvasPos(e.touches[0]);
            const pos2 = this.getCanvasPos(e.touches[1]);
            this.initialPinchDist = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
            this.initialCamZoom = this.cam.zoom;
            this.currentX = (pos1.x + pos2.x) / 2;
            this.currentY = (pos1.y + pos2.y) / 2;
        }
    }

    onTouchMove(e) {
        if (e.touches.length > 0 && this.isTouchOnUI(e.touches[0])) {
            return;
        }

        e.preventDefault();
        if (e.touches.length === 1) {
            const pos = this.getCanvasPos(e.touches[0]);
            let currentMode = window.currentCommandMode || 'move';

            if (this.isDoubleTapHold || currentMode === 'direction') {
                this.currentX = pos.x; this.currentY = pos.y;
                this.actionData = { type: 'drawing', current: pos }; 
            } else if (this.isPanning) {
                const dx = pos.x - this.currentX;
                const dy = pos.y - this.currentY;
                this.cam.x += dx / this.cam.zoom;
                this.cam.y += dy / this.cam.zoom;
                this.currentX = pos.x; this.currentY = pos.y;
            }
        } else if (e.touches.length === 2) {
            const pos1 = this.getCanvasPos(e.touches[0]);
            const pos2 = this.getCanvasPos(e.touches[1]);
            const currentPinchDist = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
            const centerPosX = (pos1.x + pos2.x) / 2;
            const centerPosY = (pos1.y + pos2.y) / 2;

            if (this.initialPinchDist && this.initialPinchDist > 0) {
                const cw = this.canvas.clientWidth;
                const ch = this.canvas.clientHeight;
                const worldCenter = this.getWorldCoords(centerPosX, centerPosY);

                this.cam.zoom = this.initialCamZoom * (currentPinchDist / this.initialPinchDist);
                this.cam.zoom = Math.max(0.3, Math.min(this.cam.zoom, 3.0)); 

                this.cam.x = (centerPosX - cw / 2) / this.cam.zoom - worldCenter.x;
                this.cam.y = (centerPosY - ch / 2) / this.cam.zoom - worldCenter.y;
            }
            this.currentX = centerPosX;
            this.currentY = centerPosY;
        }
    }

    onTouchEnd(e) {
        if (e.changedTouches.length > 0 && this.isTouchOnUI(e.changedTouches[0])) {
            return;
        }

        e.preventDefault();
        if (e.touches.length === 0) {
            const dist = Math.hypot(this.currentX - this.startX, this.currentY - this.startY);
            const worldStart = this.getWorldCoords(this.startX, this.startY);
            const worldEnd = this.getWorldCoords(this.currentX, this.currentY);
            
            let currentMode = window.currentCommandMode || 'move';

            if (currentMode === 'direction') {
                if (dist > 15) {
                    let angle = Math.atan2(worldEnd.y - worldStart.y, worldEnd.x - worldStart.x);
                    this.action = 'direction';
                    this.actionData = { angle: angle };
                }
                if (window.setCommandMode) window.setCommandMode('move');
            } 
            else if (this.isDoubleTapHold) {
                if (dist > 15) {
                    let angle = Math.atan2(worldEnd.y - worldStart.y, worldEnd.x - worldStart.x) - Math.PI/2;
                    this.action = 'drag'; 
                    this.actionData = { start: worldStart, end: worldEnd, dist: dist, angle: angle };
                } else {
                    this.action = currentMode === 'attack' ? 'attack' : 'tap';
                    this.actionData = { pos: worldEnd };
                    if (currentMode === 'attack' && window.setCommandMode) window.setCommandMode('move');
                }
            } 
            else if (this.isPanning) {
                if (dist < 15) {
                    this.action = currentMode === 'attack' ? 'attack' : 'tap';
                    this.actionData = { pos: worldEnd };
                }
                if (currentMode === 'attack' && window.setCommandMode) window.setCommandMode('move');
            }
            
            this.lastTouchendTime = Date.now(); 
            this.isDoubleTapHold = false;
            this.isPanning = false;
            
            if (!['drag', 'tap', 'attack', 'direction'].includes(this.action)) {
                this.actionData = null; 
            }
        }
        if (e.touches.length < 2) {
            this.initialPinchDist = null;
            if (e.touches.length === 1) {
                const pos = this.getCanvasPos(e.touches[0]);
                this.currentX = pos.x;
                this.currentY = pos.y;
                this.isPanning = true;
            }
        }
    }

    consumeAction() {
        const result = { type: this.action, data: this.actionData };
        
        if (this.action === 'attack' && typeof window.handleAttackCommand === 'function') {
            window.handleAttackCommand(this.actionData.pos);
            this.action = null; this.actionData = null; return { type: null, data: null };
        }
        if (this.action === 'direction' && typeof window.handleDirectionCommand === 'function') {
            window.handleDirectionCommand(this.actionData.angle);
            this.action = null; this.actionData = null; return { type: null, data: null };
        }

        if ((this.action === 'tap' || this.action === 'drag') && window.currentSquads) {
            window.currentSquads.forEach(sq => {
                if (sq.selected && sq.team === 'ally') {
                    sq.targetSquad = null; 
                    if (sq.state === 'combat') sq.state = 'idle';
                }
            });
        }

        this.action = null; 
        if (result.type !== null) this.actionData = null;
        return result;
    }
}
