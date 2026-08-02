class GameManager {
    constructor() {
        this.state = 'INIT';
        this.timeScale = 1.0; 
        this.lastTime = 0;
        this.deltaTime = 0;
    }

    init() {
        this.state = 'PLAYING';
        this.timeScale = 1.0;
        console.log("> [GameManager] 시스템 초기화 및 전장 생성 완료.");
    }

    setTimeScale(scale) {
        this.timeScale = scale;
        if (scale === 0) {
            this.state = 'PAUSED';
            console.log("> [GameManager] 전술적 일시정지 가동.");
        } else {
            this.state = 'PLAYING';
            console.log(`> [GameManager] 전장 배속 변경: ${scale}배속`);
        }
    }

    update(timestamp) {
        if (!this.lastTime) this.lastTime = timestamp;
        const realDelta = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        this.deltaTime = realDelta * this.timeScale;
        // GameManager.js 의 update() 또는 렌더링 루프 내부
        if (typeof checkBattleEnd === 'function') {
             checkBattleEnd();
}
    }
}
const gameManager = new GameManager();
