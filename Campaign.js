// ==========================================
// 🌍 Campaign.js : 월드맵
// 고화질 타일링, 카메라 드래그, 핀치 줌,
// 거점 이동, 도로 경로, 지형 이동 시스템 연결
// ==========================================

const mapTiles = {};

const castleImg = new Image();
castleImg.src = 'castle_icon.png';

const MAP_CONFIG = {
    folder: 'map_tiles',
    rows: 4,
    cols: 4,
    tileSize: 1024
};

// GameState.js가 먼저 연결된 경우 그 객체를 그대로 사용한다.
// GameState.js가 없을 때만 기본 객체를 만든다.
if (!window.playerParty || typeof window.playerParty !== 'object') {
    window.playerParty = {};
}

const PLAYER_DEFAULTS = {
    name: '이름 없는 방랑자',
    gold: 500,
    food: 10,
    worldX: 1000,
    worldY: 1000,
    targetX: 1000,
    targetY: 1000,
    speed: 180,
    targetNode: null
};

Object.keys(PLAYER_DEFAULTS).forEach(function (key) {
    if (
        window.playerParty[key] === undefined ||
        window.playerParty[key] === null
    ) {
        window.playerParty[key] = PLAYER_DEFAULTS[key];
    }
});

// W_Data.js가 뒤에서 이 배열을 교체한다.
// 해당 파일이 없을 때도 월드맵이 실행되도록 기본 거점을 남긴다.
if (!Array.isArray(window.worldNodes)) {
    window.worldNodes = [
        {
            id: 'test_city',
            name: '아우구스투스',
            type: 'city',
            x: 2000,
            y: 1500,
            radius: 25,
            color: '#e74c3c'
        },
        {
            id: 'test_castle',
            name: '카멜롯 성',
            type: 'castle',
            x: 800,
            y: 1200,
            radius: 18,
            color: '#3498db'
        },
        {
            id: 'test_village',
            name: '초원 마을',
            type: 'village',
            x: 3500,
            y: 1800,
            radius: 12,
            color: '#e67e22'
        }
    ];
}

let worldCanvas = null;
let worldCtx = null;
let worldMapInterval = null;

// 카메라와 줌
let camX = 0;
let camY = 0;
let mapZoom = 0.5;

// 포인터 입력 상태
let startDragX = null;
let startDragY = null;

let isDraggingMap = false;
let isZoomingMap = false;

let initialPinchDist = null;
let initialZoom = null;

let suppressNextMapTap = false;

// 0이면 플레이어 자동 추적 가능.
// Infinity이면 사용자가 지도를 직접 드래그한 상태라서
// 다음 이동 명령을 내릴 때까지 자동 추적을 멈춘다.
let manualCameraUntil = 0;

function getMapWidth() {
    return MAP_CONFIG.cols * MAP_CONFIG.tileSize;
}

function getMapHeight() {
    return MAP_CONFIG.rows * MAP_CONFIG.tileSize;
}

// ==========================================
// 맵 타일 미리 불러오기
// ==========================================

function preloadMapTiles() {
    for (
        let row = 1;
        row <= MAP_CONFIG.rows;
        row += 1
    ) {
        for (
            let col = 1;
            col <= MAP_CONFIG.cols;
            col += 1
        ) {
            const key = `${row}_${col}`;

            if (mapTiles[key]) {
                continue;
            }

            const img = new Image();
            img.src = `${MAP_CONFIG.folder}/${row}.${col}.png`;

            mapTiles[key] = img;
        }
    }
}

// ==========================================
// 캔버스 크기 설정
// ==========================================

function resizeWorldCanvas() {
    if (!worldCanvas) {
        return;
    }

    const dpr = Math.min(
        window.devicePixelRatio || 1,
        1.5
    );

    worldCanvas.width = Math.round(
        window.innerWidth * dpr
    );

    worldCanvas.height = Math.round(
        window.innerHeight * dpr
    );

    worldCanvas.style.width =
        `${window.innerWidth}px`;

    worldCanvas.style.height =
        `${window.innerHeight}px`;

    // 모바일 브라우저가 터치를 스크롤로 가져가지 않게 한다.
    worldCanvas.style.touchAction = 'none';

    worldCtx = worldCanvas.getContext(
        '2d',
        {
            alpha: false
        }
    );

    if (!worldCtx) {
        return;
    }

    worldCtx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
    );

    worldCtx.imageSmoothingEnabled = true;
}

// ==========================================
// 기본 입력 보조 함수
// ==========================================

function preventCanvasDefault(event) {
    if (
        event &&
        event.cancelable
    ) {
        event.preventDefault();
    }
}

function getCanvasClientPoint(event) {
    if (
        event.touches &&
        event.touches.length > 0
    ) {
        return {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY
        };
    }

    if (
        event.changedTouches &&
        event.changedTouches.length > 0
    ) {
        return {
            x: event.changedTouches[0].clientX,
            y: event.changedTouches[0].clientY
        };
    }

    if (
        Number.isFinite(event.clientX) &&
        Number.isFinite(event.clientY)
    ) {
        return {
            x: event.clientX,
            y: event.clientY
        };
    }

    return null;
}

// ==========================================
// 카메라를 지도 안에 제한
// ==========================================

function clampWorldCamera() {
    if (!worldCanvas) {
        return;
    }

    const mapWidth = getMapWidth();
    const mapHeight = getMapHeight();

    const rect =
        worldCanvas.getBoundingClientRect();

    const screenWidth =
        rect.width ||
        window.innerWidth;

    const screenHeight =
        rect.height ||
        window.innerHeight;

    const safeZoom =
        Math.max(
            0.1,
            mapZoom
        );

    const halfViewWidth =
        screenWidth /
        (
            2 *
            safeZoom
        );

    const halfViewHeight =
        screenHeight /
        (
            2 *
            safeZoom
        );

    /*
     * 화면을 크게 축소해서 지도 전체가 화면 안에 들어오면
     * 카메라를 지도의 중앙에 고정한다.
     *
     * 이 상태에서는 이미 지도 전체가 보이므로
     * 좌우 드래그가 되지 않는 것이 정상이다.
     */
    if (
        halfViewWidth * 2 >=
        mapWidth
    ) {
        camX =
            mapWidth / 2;
    } else {
        camX = Math.max(
            halfViewWidth,
            Math.min(
                camX,
                mapWidth -
                    halfViewWidth
            )
        );
    }

    if (
        halfViewHeight * 2 >=
        mapHeight
    ) {
        camY =
            mapHeight / 2;
    } else {
        camY = Math.max(
            halfViewHeight,
            Math.min(
                camY,
                mapHeight -
                    halfViewHeight
            )
        );
    }
}

// ==========================================
// 터치·마우스 상태 초기화
// ==========================================

function resetWorldPointerState() {
    startDragX = null;
    startDragY = null;

    isDraggingMap = false;
    isZoomingMap = false;

    initialPinchDist = null;
    initialZoom = null;

    suppressNextMapTap = false;
}

// ==========================================
// 화면 좌표를 월드 좌표로 변환하고 이동 명령
// ==========================================

function issueWorldMapClick(
    clientX,
    clientY
) {
    if (
        !worldCanvas ||
        !window.playerParty
    ) {
        return;
    }

    const rect =
        worldCanvas.getBoundingClientRect();

    const screenX =
        clientX -
        rect.left;

    const screenY =
        clientY -
        rect.top;

    let clickWorldX =
        camX +
        (
            screenX -
            rect.width / 2
        ) /
        mapZoom;

    let clickWorldY =
        camY +
        (
            screenY -
            rect.height / 2
        ) /
        mapZoom;

    // 지도 바깥을 눌러도 목적지는 지도 안으로 제한한다.
    clickWorldX = Math.max(
        0,
        Math.min(
            clickWorldX,
            getMapWidth()
        )
    );

    clickWorldY = Math.max(
        0,
        Math.min(
            clickWorldY,
            getMapHeight()
        )
    );

    const nodes =
        Array.isArray(
            window.worldNodes
        )
            ? window.worldNodes
            : [];

    let clickedNode = null;

    for (
        let index = 0;
        index < nodes.length;
        index += 1
    ) {
        const node =
            nodes[index];

        const distance =
            Math.hypot(
                Number(node.x) -
                    clickWorldX,
                Number(node.y) -
                    clickWorldY
            );

        /*
         * 멀리 축소하더라도 거점 클릭 범위가
         * 화면상 최소 약 16픽셀은 되도록 확대한다.
         */
        const hitRadius =
            Math.max(
                Number(node.radius) ||
                    12,
                16 /
                    mapZoom
            );

        if (
            distance <=
            hitRadius
        ) {
            clickedNode =
                node;

            break;
        }
    }

    if (clickedNode) {
        // 거점을 누르면 도로 경로 우선 이동
        if (
            window.ArsWorldMapCommands &&
            typeof window
                .ArsWorldMapCommands
                .moveToSettlement ===
                'function'
        ) {
            window
                .ArsWorldMapCommands
                .moveToSettlement(
                    clickedNode,
                    window.playerParty
                );
        } else {
            window.playerParty.targetX =
                clickedNode.x;

            window.playerParty.targetY =
                clickedNode.y;

            window.playerParty.targetNode =
                clickedNode;
        }
    } else {
        /*
         * 빈 땅을 누르면 자동 도로 경로를 취소하고
         * 해당 위치로 자유 이동한다.
         */
        if (
            window.ArsWorldMapCommands &&
            typeof window
                .ArsWorldMapCommands
                .moveToGround ===
                'function'
        ) {
            window
                .ArsWorldMapCommands
                .moveToGround(
                    clickWorldX,
                    clickWorldY,
                    window.playerParty
                );
        } else {
            window.playerParty.targetX =
                clickWorldX;

            window.playerParty.targetY =
                clickWorldY;

            window.playerParty.targetNode =
                null;
        }
    }

    // 새 이동 명령을 내리면 카메라가 다시 플레이어를 따라간다.
    manualCameraUntil = 0;
}

// ==========================================
// 월드맵 입력 연결
// ==========================================

function bindWorldMapInput() {
    if (!worldCanvas) {
        return;
    }

    // ------------------------------------------
    // 마우스 휠 줌
    // ------------------------------------------

    worldCanvas.onwheel =
    function (event) {
        preventCanvasDefault(event);

        mapZoom -=
            event.deltaY *
            0.001;

        mapZoom = Math.max(
            0.1,
            Math.min(
                mapZoom,
                2.5
            )
        );

        // 줌 직후 잠시 자동 카메라 추적을 멈춘다.
        manualCameraUntil =
            performance.now() +
            1200;

        clampWorldCamera();
    };

    // ------------------------------------------
    // 터치 또는 마우스 누르기
    // ------------------------------------------

    worldCanvas.onmousedown =
    worldCanvas.ontouchstart =
    function (event) {
        preventCanvasDefault(event);

        // 두 손가락이면 핀치 줌 시작
        if (
            event.touches &&
            event.touches.length === 2
        ) {
            isDraggingMap = false;
            isZoomingMap = true;

            suppressNextMapTap = true;

            startDragX = null;
            startDragY = null;

            const dx =
                event.touches[0].clientX -
                event.touches[1].clientX;

            const dy =
                event.touches[0].clientY -
                event.touches[1].clientY;

            initialPinchDist =
                Math.hypot(
                    dx,
                    dy
                );

            initialZoom =
                mapZoom;

            return;
        }

        const point =
            getCanvasClientPoint(
                event
            );

        if (!point) {
            return;
        }

        /*
         * 새로운 한 손가락 입력이 들어오면
         * 혹시 남아 있던 줌 상태를 해제한다.
         */
        isZoomingMap = false;
        isDraggingMap = false;

        suppressNextMapTap = false;

        startDragX =
            point.x;

        startDragY =
            point.y;
    };

    // ------------------------------------------
    // 터치 또는 마우스 이동
    // ------------------------------------------

    worldCanvas.onmousemove =
    worldCanvas.ontouchmove =
    function (event) {
        preventCanvasDefault(event);

        // 두 손가락 핀치 줌
        if (
            event.touches &&
            event.touches.length === 2
        ) {
            isZoomingMap = true;
            isDraggingMap = false;

            suppressNextMapTap = true;

            const dx =
                event.touches[0].clientX -
                event.touches[1].clientX;

            const dy =
                event.touches[0].clientY -
                event.touches[1].clientY;

            const distance =
                Math.hypot(
                    dx,
                    dy
                );

            if (
                initialPinchDist &&
                initialZoom
            ) {
                mapZoom =
                    initialZoom *
                    (
                        distance /
                        initialPinchDist
                    );

                mapZoom = Math.max(
                    0.1,
                    Math.min(
                        mapZoom,
                        2.5
                    )
                );

                manualCameraUntil =
                    performance.now() +
                    1500;

                clampWorldCamera();
            }

            return;
        }

        const point =
            getCanvasClientPoint(
                event
            );

        if (!point) {
            return;
        }

        /*
         * 핀치 중 손가락 하나만 남았을 때
         * 남은 손가락을 드래그 시작점으로 다시 등록한다.
         */
        if (isZoomingMap) {
            isZoomingMap = false;

            suppressNextMapTap = true;

            startDragX =
                point.x;

            startDragY =
                point.y;

            return;
        }

        if (
            startDragX === null ||
            startDragY === null
        ) {
            startDragX =
                point.x;

            startDragY =
                point.y;

            return;
        }

        const dx =
            point.x -
            startDragX;

        const dy =
            point.y -
            startDragY;

        const dragDistance =
            Math.hypot(
                dx,
                dy
            );

        /*
         * 5픽셀 이하의 흔들림은 드래그가 아니라
         * 일반 클릭으로 처리한다.
         */
        if (
            !isDraggingMap &&
            dragDistance <= 5
        ) {
            return;
        }

        isDraggingMap = true;

        camX -=
            dx /
            mapZoom;

        camY -=
            dy /
            mapZoom;

        clampWorldCamera();

        startDragX =
            point.x;

        startDragY =
            point.y;

        /*
         * 사용자가 직접 화면을 옮겼다면
         * 다음 이동 명령이 들어오기 전까지 카메라를 유지한다.
         */
        manualCameraUntil =
            Number.POSITIVE_INFINITY;
    };

    // ------------------------------------------
    // 터치 또는 마우스 떼기
    // ------------------------------------------

    worldCanvas.onmouseup =
    worldCanvas.ontouchend =
    function (event) {
        preventCanvasDefault(event);

        const remainingTouches =
            event.touches
                ? event.touches.length
                : 0;

        /*
         * 핀치 중 손가락 하나만 뗀 상태.
         * 남은 손가락으로 바로 드래그할 수 있게 한다.
         */
        if (
            remainingTouches === 1
        ) {
            isZoomingMap = false;
            isDraggingMap = false;

            suppressNextMapTap = true;

            startDragX =
                event.touches[0].clientX;

            startDragY =
                event.touches[0].clientY;

            initialPinchDist = null;
            initialZoom = null;

            return;
        }

        if (
            remainingTouches > 1
        ) {
            return;
        }

        const wasDragging =
            isDraggingMap;

        const wasZooming =
            isZoomingMap;

        const wasSuppressed =
            suppressNextMapTap;

        const point =
            getCanvasClientPoint(
                event
            );

        /*
         * 클릭 성공 여부와 관계없이
         * 터치·줌 상태를 무조건 초기화한다.
         *
         * 기존 코드에서 줌 후 이동이 먹통이 된 핵심 원인이다.
         */
        resetWorldPointerState();

        if (
            !wasDragging &&
            !wasZooming &&
            !wasSuppressed &&
            point
        ) {
            issueWorldMapClick(
                point.x,
                point.y
            );
        }
    };

    // 운영체제나 브라우저가 터치를 취소한 경우
    worldCanvas.ontouchcancel =
    function () {
        resetWorldPointerState();
    };

    // 캔버스 밖에서 마우스를 놓은 경우
    worldCanvas.onmouseleave =
    function (event) {
        if (
            !event.touches &&
            startDragX !== null
        ) {
            resetWorldPointerState();
        }
    };
}

// ==========================================
// 월드맵 캔버스 시작
// ==========================================

window.initWorldMapCanvas =
function () {
    worldCanvas =
        document.getElementById(
            'worldCanvas'
        );

    if (!worldCanvas) {
        return;
    }

    preloadMapTiles();
    resizeWorldCanvas();

    if (!worldCtx) {
        console.error(
            '[Ars Bellum] worldCanvas 2D 컨텍스트를 만들 수 없습니다.'
        );

        return;
    }

    camX =
        Number(
            window.playerParty.worldX
        ) ||
        0;

    camY =
        Number(
            window.playerParty.worldY
        ) ||
        0;

    clampWorldCamera();
    resetWorldPointerState();
    bindWorldMapInput();

    if (worldMapInterval) {
        cancelAnimationFrame(
            worldMapInterval
        );
    }

    function renderLoop() {
        updateAndRenderWorld();

        worldMapInterval =
            requestAnimationFrame(
                renderLoop
            );
    }

    renderLoop();
};

// 화면 크기나 방향이 바뀌었을 때 캔버스 다시 맞춤
window.addEventListener(
    'resize',
    function () {
        if (!worldCanvas) {
            return;
        }

        resizeWorldCanvas();
        clampWorldCamera();
    }
);

// ==========================================
// 월드맵 갱신
// ==========================================

function updateAndRenderWorld() {
    if (
        !worldCtx ||
        !worldCanvas ||
        !window.playerParty
    ) {
        return;
    }

    const dt = window.ArsSimulationTime ? window.ArsSimulationTime.getDeltaSeconds(1 / 60) : 1 / 60;
    const party = window.playerParty;

    // 도로 자동 경로의 다음 경유점을 지정한다.
    if (
        window.ArsWorldRoutePlanner &&
        typeof window
            .ArsWorldRoutePlanner
            .update ===
            'function'
    ) {
        window
            .ArsWorldRoutePlanner
            .update(
                party
            );
    }

    // 현재 지형과 도로에 맞춰 속도를 계산한다.
    if (
        window.ArsWorldMapSystem &&
        typeof window
            .ArsWorldMapSystem
            .prepareMovement ===
            'function'
    ) {
        window
            .ArsWorldMapSystem
            .prepareMovement(
                party,
                dt
            );
    }

    let dx =
        Number(
            party.targetX
        ) -
        Number(
            party.worldX
        );

    let dy =
        Number(
            party.targetY
        ) -
        Number(
            party.worldY
        );

    let distance =
        Math.hypot(
            dx,
            dy
        );

    if (
        distance > 2
    ) {
        const step =
            Math.min(
                distance,
                Math.max(
                    0,
                    Number(
                        party.speed
                    ) ||
                    0
                ) *
                dt
            );

        if (
            step > 0
        ) {
            party.worldX +=
                (
                    dx /
                    distance
                ) *
                step;

            party.worldY +=
                (
                    dy /
                    distance
                ) *
                step;
        }
    } else {
        /*
         * 목적지에 거의 도착하면 좌표를 정확히 맞춘다.
         * 소수점 오차로 도착 판정이 반복되는 것을 막는다.
         */
        party.worldX =
            Number(
                party.targetX
            );

        party.worldY =
            Number(
                party.targetY
            );

        if (
            party.targetNode
        ) {
            const node =
                party.targetNode;

            // 중복 도착창 방지
            party.targetNode =
                null;

            setTimeout(
                function () {
                    if (
                        confirm(
                            `[${node.name}]에 도착했습니다. 입장하시겠습니까?`
                        )
                    ) {
                        console.log(
                            `입장 완료: ${node.name}`
                        );

                        // TODO: 향후 거점 UI 호출 함수 연결
                    }
                },
                50
            );
        }
    }

    // 이동한 뒤의 실제 남은 거리로 다시 계산
    dx =
        Number(
            party.targetX
        ) -
        Number(
            party.worldX
        );

    dy =
        Number(
            party.targetY
        ) -
        Number(
            party.worldY
        );

    distance =
        Math.hypot(
            dx,
            dy
        );

    const isManualCameraActive =
        performance.now() <
        manualCameraUntil;

    /*
     * 사용자가 화면을 직접 드래그하지 않았고,
     * 핀치 줌 중이 아니며,
     * 수동 카메라 상태도 아닐 때만
     * 플레이어를 부드럽게 추적한다.
     */
    if (
        !isDraggingMap &&
        !isZoomingMap &&
        !isManualCameraActive &&
        distance > 2
    ) {
        camX +=
            (
                Number(
                    party.worldX
                ) -
                camX
            ) *
            5 *
            dt;

        camY +=
            (
                Number(
                    party.worldY
                ) -
                camY
            ) *
            5 *
            dt;

        clampWorldCamera();
    }

    renderWorldMap(
        party,
        distance
    );
}

// ==========================================
// 월드맵 전체 렌더링
// ==========================================

function renderWorldMap(
    party,
    distance
) {
    worldCtx.fillStyle =
        '#0a0a0c';

    worldCtx.fillRect(
        0,
        0,
        window.innerWidth,
        window.innerHeight
    );

    worldCtx.save();

    worldCtx.translate(
        window.innerWidth / 2,
        window.innerHeight / 2
    );

    worldCtx.scale(
        mapZoom,
        mapZoom
    );

    worldCtx.translate(
        -Math.round(camX),
        -Math.round(camY)
    );

    drawVisibleMapTiles();
    drawWorldNodes();
    drawMovementLine(
        party,
        distance
    );
    drawPlayerParty(
        party
    );

    // 개발용 도로·경로·지형 표시
    if (
        window.ArsWorldMapDebugOverlay &&
        typeof window
            .ArsWorldMapDebugOverlay
            .draw ===
            'function'
    ) {
        window
            .ArsWorldMapDebugOverlay
            .draw(
                worldCtx,
                party
            );
    }

    worldCtx.restore();
}

// ==========================================
// 화면 안에 보이는 지도 타일만 렌더링
// ==========================================

function drawVisibleMapTiles() {
    const viewWidth =
        window.innerWidth /
        mapZoom;

    const viewHeight =
        window.innerHeight /
        mapZoom;

    const viewLeft =
        camX -
        viewWidth / 2;

    const viewTop =
        camY -
        viewHeight / 2;

    worldCtx.save();

    worldCtx.filter =
        'brightness(1.25) contrast(1.1) saturate(1.1)';

    for (
        let row = 1;
        row <= MAP_CONFIG.rows;
        row += 1
    ) {
        for (
            let col = 1;
            col <= MAP_CONFIG.cols;
            col += 1
        ) {
            const img =
                mapTiles[
                    `${row}_${col}`
                ];

            if (
                !img ||
                !img.complete ||
                img.naturalWidth <= 0
            ) {
                continue;
            }

            const tileX =
                Math.round(
                    (
                        col -
                        1
                    ) *
                    MAP_CONFIG.tileSize
                );

            const tileY =
                Math.round(
                    (
                        row -
                        1
                    ) *
                    MAP_CONFIG.tileSize
                );

            const isVisible =
                tileX +
                    MAP_CONFIG.tileSize >
                    viewLeft &&
                tileX <
                    viewLeft +
                    viewWidth &&
                tileY +
                    MAP_CONFIG.tileSize >
                    viewTop &&
                tileY <
                    viewTop +
                    viewHeight;

            if (!isVisible) {
                continue;
            }

            worldCtx.drawImage(
                img,
                tileX,
                tileY,
                MAP_CONFIG.tileSize,
                MAP_CONFIG.tileSize
            );
        }
    }

    worldCtx.restore();
}

// ==========================================
// 거점 렌더링
// ==========================================

function drawWorldNodes() {
    const nodes =
        Array.isArray(
            window.worldNodes
        )
            ? window.worldNodes
            : [];

    nodes.forEach(
        function (node) {
            const nodeX =
                Math.round(
                    Number(
                        node.x
                    )
                );

            const nodeY =
                Math.round(
                    Number(
                        node.y
                    )
                );

            const radius =
                Number(
                    node.radius
                ) ||
                12;

            const color =
                node.color ||
                '#e67e22';

            worldCtx.save();

            worldCtx.translate(
                nodeX,
                nodeY
            );

            // 거점 바닥 상호작용 영역
            worldCtx.beginPath();

            worldCtx.ellipse(
                0,
                0,
                radius * 2.2,
                radius * 1.3,
                0,
                0,
                Math.PI * 2
            );

            worldCtx.fillStyle =
                'rgba(0, 0, 0, 0.15)';

            worldCtx.fill();

            worldCtx.strokeStyle =
                node.team === 'ally'
                    ? 'rgba(52, 152, 219, 0.4)'
                    : 'rgba(231, 76, 60, 0.4)';

            worldCtx.lineWidth = 2;
            worldCtx.stroke();

            worldCtx.shadowColor =
                'transparent';

            if (
                node.type === 'city'
            ) {
                drawCityNode(
                    color
                );
            } else if (
                node.type === 'castle'
            ) {
                drawCastleNode();
            } else {
                drawVillageNode(
                    color
                );
            }

            worldCtx.restore();

            drawNodeNameplate(
                node,
                nodeX,
                nodeY,
                color
            );
        }
    );
}

// ==========================================
// 도시 모양
// ==========================================

function drawCityNode(color) {
    // 후면 탑
    worldCtx.fillStyle =
        '#7f8c8d';

    worldCtx.fillRect(
        -15,
        -25,
        10,
        20
    );

    worldCtx.fillRect(
        5,
        -25,
        10,
        20
    );

    // 중앙 성채
    worldCtx.fillStyle =
        '#bdc3c7';

    worldCtx.beginPath();

    worldCtx.moveTo(
        -20,
        -10
    );

    worldCtx.lineTo(
        0,
        -18
    );

    worldCtx.lineTo(
        20,
        -10
    );

    worldCtx.lineTo(
        20,
        5
    );

    worldCtx.lineTo(
        -20,
        5
    );

    worldCtx.fill();

    // 지붕
    worldCtx.fillStyle =
        color;

    worldCtx.beginPath();

    worldCtx.moveTo(
        -20,
        -10
    );

    worldCtx.lineTo(
        0,
        -25
    );

    worldCtx.lineTo(
        20,
        -10
    );

    worldCtx.lineTo(
        0,
        -2
    );

    worldCtx.fill();

    // 지붕 명암
    worldCtx.save();

    worldCtx.globalAlpha =
        0.3;

    worldCtx.fillStyle =
        '#000000';

    worldCtx.beginPath();

    worldCtx.moveTo(
        0,
        -25
    );

    worldCtx.lineTo(
        20,
        -10
    );

    worldCtx.lineTo(
        0,
        -2
    );

    worldCtx.fill();
    worldCtx.restore();

    // 성문
    worldCtx.fillStyle =
        '#2c3e50';

    worldCtx.beginPath();

    worldCtx.arc(
        0,
        5,
        4,
        Math.PI,
        0
    );

    worldCtx.fill();
}

// ==========================================
// 성 이미지
// ==========================================

function drawCastleNode() {
    if (
        !castleImg.complete ||
        castleImg.naturalWidth <= 0
    ) {
        return;
    }

    const imageWidth = 100;
    const imageHeight = 80;

    worldCtx.drawImage(
        castleImg,
        -imageWidth / 2,
        -imageHeight / 2 - 10,
        imageWidth,
        imageHeight
    );
}

// ==========================================
// 마을 모양
// ==========================================

function drawVillageNode(color) {
    function drawHouse(
        houseX,
        houseY,
        scale,
        isMain
    ) {
        // 벽
        worldCtx.fillStyle =
            '#d35400';

        worldCtx.fillRect(
            houseX -
                5 *
                scale,
            houseY -
                2 *
                scale,
            10 *
                scale,
            6 *
                scale
        );

        // 지붕
        worldCtx.fillStyle =
            isMain
                ? color
                : '#e67e22';

        worldCtx.beginPath();

        worldCtx.moveTo(
            houseX -
                6 *
                scale,
            houseY -
                2 *
                scale
        );

        worldCtx.lineTo(
            houseX,
            houseY -
                8 *
                scale
        );

        worldCtx.lineTo(
            houseX +
                6 *
                scale,
            houseY -
                2 *
                scale
        );

        worldCtx.fill();

        // 지붕 명암
        worldCtx.fillStyle =
            'rgba(0, 0, 0, 0.2)';

        worldCtx.beginPath();

        worldCtx.moveTo(
            houseX,
            houseY -
                8 *
                scale
        );

        worldCtx.lineTo(
            houseX +
                6 *
                scale,
            houseY -
                2 *
                scale
        );

        worldCtx.lineTo(
            houseX,
            houseY -
                2 *
                scale
        );

        worldCtx.fill();
    }

    drawHouse(
        -8,
        -4,
        0.9,
        false
    );

    drawHouse(
        10,
        2,
        0.8,
        false
    );

    drawHouse(
        0,
        5,
        1.2,
        true
    );
}

// ==========================================
// 거점 이름표
// ==========================================

function drawNodeNameplate(
    node,
    nodeX,
    nodeY,
    color
) {
    const fontSize =
        node.type === 'city'
            ? 16
            : node.type === 'castle'
                ? 14
                : 12;

    const textYOffset =
        node.type === 'city'
            ? 45
            : 35;

    const nodeName =
        node.name ||
        node.id ||
        '이름 없는 거점';

    worldCtx.font =
        `bold ${fontSize}px sans-serif`;

    worldCtx.textAlign =
        'center';

    const textWidth =
        worldCtx
            .measureText(
                nodeName
            )
            .width;

    const plateX =
        nodeX -
        textWidth / 2 -
        8;

    const plateY =
        nodeY -
        textYOffset -
        fontSize;

    const plateWidth =
        textWidth +
        16;

    const plateHeight =
        fontSize +
        8;

    worldCtx.fillStyle =
        'rgba(20, 25, 30, 0.7)';

    worldCtx.beginPath();

    if (
        typeof worldCtx.roundRect ===
        'function'
    ) {
        worldCtx.roundRect(
            plateX,
            plateY,
            plateWidth,
            plateHeight,
            4
        );
    } else {
        worldCtx.rect(
            plateX,
            plateY,
            plateWidth,
            plateHeight
        );
    }

    worldCtx.fill();

    worldCtx.fillStyle =
        '#ecf0f1';

    worldCtx.fillText(
        nodeName,
        nodeX,
        nodeY -
            textYOffset -
            2
    );

    // 세력 방패 점
    worldCtx.fillStyle =
        color;

    worldCtx.beginPath();

    worldCtx.arc(
        nodeX,
        nodeY -
            textYOffset -
            fontSize -
            6,
        4,
        0,
        Math.PI * 2
    );

    worldCtx.fill();

    worldCtx.lineWidth = 1;
    worldCtx.strokeStyle =
        '#ffffff';

    worldCtx.stroke();
}

// ==========================================
// 현재 목표까지의 점선
// ==========================================

function drawMovementLine(
    party,
    distance
) {
    if (
        distance <= 2
    ) {
        return;
    }

    worldCtx.strokeStyle =
        'rgba(241, 196, 15, 0.6)';

    worldCtx.lineWidth = 3;

    worldCtx.setLineDash(
        [
            8,
            8
        ]
    );

    worldCtx.beginPath();

    worldCtx.moveTo(
        Math.round(
            Number(
                party.worldX
            )
        ),
        Math.round(
            Number(
                party.worldY
            )
        )
    );

    worldCtx.lineTo(
        Math.round(
            Number(
                party.targetX
            )
        ),
        Math.round(
            Number(
                party.targetY
            )
        )
    );

    worldCtx.stroke();

    worldCtx.setLineDash(
        []
    );
}

// ==========================================
// 플레이어 부대 표시
// ==========================================

function drawPlayerParty(party) {
    worldCtx.fillStyle =
        '#f1c40f';

    worldCtx.beginPath();

    worldCtx.arc(
        Math.round(
            Number(
                party.worldX
            )
        ),
        Math.round(
            Number(
                party.worldY
            )
        ),
        10,
        0,
        Math.PI * 2
    );

    worldCtx.fill();

    worldCtx.strokeStyle =
        '#222222';

    worldCtx.lineWidth = 3;
    worldCtx.stroke();
}