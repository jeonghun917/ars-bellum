const canvas = document.getElementById('battlefield');
function resizeCanvas() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const inputHandler = new InputHandler(canvas);
const battleEngine = new BattleEngine();
const renderer = new Renderer(canvas);
const terrain = new MapManager(2000, 2000, 40);

window.isWaypointMode = false;
let gameMode = 'none'; // 'practice' | 'maingame'
let squads = [];


let economyNewGameInitialized = false;

const recordDiplomacyBaseline = (targetSquads) => {
    if (!Array.isArray(targetSquads)) return;
    const sumAliveUnits = (team) => targetSquads.reduce((total, squad) => {
        if (!squad || squad.team !== team) return total;
        const units = Array.isArray(squad.units) ? squad.units : [];
        return total + units.filter(unit => unit && Number(unit.hp) > 0).length;
    }, 0);
    Object.defineProperty(targetSquads, '__arsDiplomacyBaseline', {
        value: Object.freeze({
            allyStart: sumAliveUnits('ally'),
            enemyStart: sumAliveUnits('enemy'),
            createdAt: Date.now()
        }),
        enumerable: false,
        writable: false,
        configurable: true
    });
};

function initializeNewGameEconomyOnce() {
    if (economyNewGameInitialized) {
        return { ok: true, skipped: true, reason: "already_initialized_for_current_runtime" };
    }
    const bootstrap = window.ArsSettlementEconomyBootstrap;
    if (!bootstrap || typeof bootstrap.initializeAll !== "function") {
        return { ok: false, reason: "economy_bootstrap_missing" };
    }
    const result = bootstrap.initializeAll();
    if (result && result.ok) economyNewGameInitialized = true;
    return result;
}

function resetSquads() {
    squads = [
        new Squad('아군 방패병', 'ally', 'infantry', 'shield', 2, -200, -50), 
        new Squad('아군 충격보병', 'ally', 'infantry', 'shock', 2, -200, 100), 
        new Squad('아군 궁병대', 'ally', 'archer', 'archer', 1, -300, -50),  
        new Squad('아군 척후병', 'ally', 'skirmisher', 'skirmisher', 1, -300, 100),
        new Squad('아군 중기병', 'ally', 'cavalry', 'heavy_cav', 3, -400, -100),  
        new Squad('아군 경기병', 'ally', 'cavalry', 'light_cav', 2, -400, 150),

        new Squad('적군 방패병', 'enemy', 'infantry', 'shield', 2, 200, -50), 
        new Squad('적군 충격보병', 'enemy', 'infantry', 'shock', 2, 200, 100), 
        new Squad('적군 궁병대', 'enemy', 'archer', 'archer', 1, 300, -50),    
        new Squad('적군 척후병', 'enemy', 'skirmisher', 'skirmisher', 1, 300, 100),
        new Squad('적군 중기병', 'enemy', 'cavalry', 'heavy_cav', 3, 400, -100),
        new Squad('적군 경기병', 'enemy', 'cavalry', 'light_cav', 2, 400, 150)
    ];
}

function resetBattleRuntimeState() {
    window.isGameOver = false;
    window.isPreparationPhase = true;
    window.isWaypointMode = false;
    window.currentCommandMode = 'move';

    inputHandler.action = null;
    inputHandler.actionData = null;
    inputHandler.isDoubleTapHold = false;
    inputHandler.isPanning = false;
    inputHandler.initialPinchDist = null;

    inputHandler.cam.x = 0;
    inputHandler.cam.y = 0;
    inputHandler.cam.zoom = 1.0;

    renderer.vfxList.length = 0;
    renderer.lastSelectedState = false;

    gameManager.lastTime = 0;
    gameManager.deltaTime = 0;

    const prepUI =
        document.getElementById(
            'prepUI'
        );

    if (prepUI) {
        prepUI.style.display =
            'block';
    }

    const worldMapLayer =
        document.getElementById(
            'world-map-layer'
        );

    if (worldMapLayer) {
        worldMapLayer.style.display =
            'none';
    }

    const gameContainer =
        document.getElementById(
            'game-container'
        );

    if (gameContainer) {
        gameContainer.style.display =
            'block';
    }

    const menuModal =
        document.getElementById(
            'menuModal'
        );

    if (menuModal) {
        menuModal.classList.remove(
            'active'
        );
    }

    const diplomacyModal =
        document.getElementById(
            'diplomacyModal'
        );

    if (diplomacyModal) {
        diplomacyModal.classList.remove(
            'active'
        );
    }

    const waypointButton =
        document.getElementById(
            'btn-waypoint'
        );

    if (waypointButton) {
        waypointButton.style.background =
            '';

        waypointButton.innerText =
            '📍 경로예약';
    }

    if (
        typeof window
            .updateUISelectionState ===
        'function'
    ) {
        window
            .updateUISelectionState(
                false
            );
    }
}

// 💡 연습장 모드 실행 (무작위 맵)
window.startPracticeMode = function() {
    resetBattleRuntimeState();

    gameMode = 'practice';

    terrain.initMap(
        'practice'
    );

    resetSquads();

    window.currentSquads =
        squads;
    recordDiplomacyBaseline(window.currentSquads);

    document
        .getElementById(
            'main-menu'
        )
        .style.display =
        'none';

    document
        .getElementById(
            'ui-layer'
        )
        .style.display =
        'block';

    updateUI();
};

// 💡 본게임 모드 실행 (고정 맵)
window.startMainGameMode = function() {
    const economyInitialization = initializeNewGameEconomyOnce();
    if (!economyInitialization || !economyInitialization.ok) {
        console.error("[Ars Bellum] 새 게임 경제 초기화 실패:", economyInitialization);
        return;
    }

    resetBattleRuntimeState();

    gameMode = 'maingame';

    terrain.initMap(
        'maingame'
    );

    resetSquads();

    window.currentSquads =
        squads;
    recordDiplomacyBaseline(window.currentSquads);

    document
        .getElementById(
            'main-menu'
        )
        .style.display =
        'none';

    document
        .getElementById(
            'ui-layer'
        )
        .style.display =
        'block';

    updateUI();
};

// 💡 메인 메뉴로 돌아가기
window.returnToMainMenu = function() {
    gameMode = 'none';

    window.isPreparationPhase =
        true;

    window.currentSquads =
        [];

    document
        .getElementById(
            'ui-layer'
        )
        .style.display =
        'none';

    document
        .getElementById(
            'main-menu'
        )
        .style.display =
        'flex';
};

window.toggleWaypointMode = function() {
    window.isWaypointMode = !window.isWaypointMode;
    let btn = document.getElementById('btn-waypoint');
    
    if (window.isWaypointMode) {
        btn.style.background = '#e67e22'; // 켜졌을 때 주황색으로 강조
        btn.innerText = '📍 예약중(ON)';
    } else {
        btn.style.background = ''; // 껐을 때 원래 색상(CSS 설정)으로 복구
        btn.innerText = '📍 경로예약';
    }
    
    // 예약 버튼을 누르면, 공격/방향 지정 모드를 취소하고 자동으로 '이동(move)' 모드로 변경
    if (typeof window.setCommandMode === 'function') {
        window.setCommandMode('move');
    }
};


window.clearWaypoints = function() {
    squads.filter(s => s.selected).forEach(sq => { sq.waypoints = []; });
};

window.updateUI = function() {
    let selectedSquads = squads.filter(s => s.selected);
    let panel = document.getElementById('skill-panel');
    let btnSpecial = document.getElementById('btn-special');
    let btnLoose = document.getElementById('btn-loose');
    
    if (selectedSquads.length > 0) {
        panel.style.display = 'flex';
        let isLoose = selectedSquads.every(sq => sq.currentFormation === 'loose');
        btnLoose.innerText = isLoose ? '밀집 대열' : '〰️ 산개 대열';
        btnLoose.style.background = isLoose ? '#e74c3c' : '#27ae60';

        let types = [...new Set(selectedSquads.map(s => s.specialFormation))];
        if (types.length === 1 && types[0] !== 'line') {
            btnSpecial.style.display = 'block';
            let sq = selectedSquads[0];
            if(sq.specialFormation === 'shield_wall') {
                btnSpecial.innerText = sq.currentFormation === 'shield_wall' ? '🛡️ 방패진 해제' : '🛡️ 방패진 배치';
                btnSpecial.style.background = sq.currentFormation === 'shield_wall' ? '#e74c3c' : '#2980b9';
            } else if(sq.specialFormation === 'wedge') {
                btnSpecial.innerText = sq.currentFormation === 'wedge' ? '🐎 쐐기진 해제' : '🐎 쐐기 돌격';
                btnSpecial.style.background = sq.currentFormation === 'wedge' ? '#e74c3c' : '#8e44ad';
            }
        } else {
            btnSpecial.style.display = 'none';
        }
    } else {
        panel.style.display = 'none';
    }
}

window.toggleLoose = function() {
    squads.filter(s => s.selected).forEach(sq => {
        sq.currentFormation = (sq.currentFormation === 'loose') ? 'line' : 'loose';
    });
    updateUI();
};

window.selectBySubType = function(subType) {
    squads.forEach(sq => { sq.selected = (sq.team === 'ally' && sq.subType === subType); });
    updateUI();
};

window.deselectAll = function() {
    squads.forEach(sq => sq.selected = false);
    updateUI();
};

window.activateSkill = function() {
    squads.filter(s => s.selected).forEach(sq => {
        sq.currentFormation = (sq.currentFormation === 'line' || sq.currentFormation === 'loose') ? sq.specialFormation : 'line';
    });
    updateUI(); 
};

function processInputs() {
    if (gameMode === 'none') return;
    const actionObj = inputHandler.consumeAction();
    const selectedAllies = squads.filter(s => s.selected);

    if (actionObj.type === 'tap') {
        let clicked = squads.find(sq => sq.team === 'ally' && Math.hypot(sq.centerX - actionObj.data.pos.x, sq.centerY - actionObj.data.pos.y) < 50);
        if (clicked) {
            squads.forEach(s => s.selected = false); 
            clicked.selected = true;
            updateUI();
        } else if (selectedAllies.length > 0) {
            let tapX = actionObj.data.pos.x;
            let tapY = actionObj.data.pos.y;
            
            if (window.isWaypointMode) {
                selectedAllies.forEach(sq => {
                    sq.waypoints.push({ x: tapX, y: tapY, width: sq.formationWidth, angle: sq.angle });
                });
            } else {
                let n = selectedAllies.length;
                let spacing = 140; 
                selectedAllies.forEach((sq, index) => {
                    let offsetX = (index - (n - 1) / 2) * spacing;
                    sq.waypoints = [{ x: tapX + offsetX, y: tapY, width: sq.formationWidth, angle: sq.angle }];
                });
            }
        }
    } 
    else if (actionObj.type === 'drag') {
        if (selectedAllies.length > 0) {
            let n = selectedAllies.length;
            let startX = actionObj.data.start.x;
            let startY = actionObj.data.start.y;
            let endX = actionObj.data.end.x;
            let endY = actionObj.data.end.y;
            let angle = Math.atan2(endY - startY, endX - startX);
            let totalDist = actionObj.data.dist;
            let subWidth = Math.max(30, totalDist / n); 
            
            selectedAllies.forEach((sq, index) => {
                let t = n === 1 ? 0.5 : index / (n - 1);
                let targetX = startX + (endX - startX) * t;
                let targetY = startY + (endY - startY) * t;
                
                if (window.isWaypointMode) {
                    sq.waypoints.push({ x: targetX, y: targetY, width: subWidth, angle: angle + Math.PI/2 });
                } else {
                    sq.formationWidth = subWidth; 
                    sq.waypoints = [{ x: targetX, y: targetY, width: subWidth, angle: angle + Math.PI/2 }];
                }
            });
        } else {
            let minX = Math.min(actionObj.data.start.x, actionObj.data.end.x);
            let maxX = Math.max(actionObj.data.start.x, actionObj.data.end.x);
            let minY = Math.min(actionObj.data.start.y, actionObj.data.end.y);
            let maxY = Math.max(actionObj.data.start.y, actionObj.data.end.y);
            
            squads.forEach(sq => {
                sq.selected = (sq.team === 'ally' && sq.units.length > 0 && sq.centerX > minX && sq.centerX < maxX && sq.centerY > minY && sq.centerY < maxY);
            });
            updateUI();
        }
    }
}

function gameLoop(timestamp) {
    gameManager.update(timestamp);
    let dt = gameManager.deltaTime;

    if (gameMode !== 'none') {
        processInputs();
        
        if (dt > 0) {
            battleEngine.update(squads, dt, renderer, terrain);
            squads.forEach(sq => sq.update(dt, terrain));
        }
        
        squads = squads.filter(sq => {
            if (sq.units.length === 0) {
                if (sq.selected) { sq.selected = false; updateUI(); }
                return false;
            }
            return true;
        });

        battleEngine.updateVision(squads, terrain);
        renderer.draw(squads, inputHandler, dt, terrain);
    }
    
    requestAnimationFrame(gameLoop);
}

gameManager.init();
requestAnimationFrame(gameLoop);
