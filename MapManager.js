class PerlinNoise {
    constructor() {
        this.p = new Uint8Array(512);
        this.init(Math.random());
    }

    init(seed) {
        let perm = new Uint8Array(256);
        for (let i = 0; i < 256; i++) perm[i] = i;
        let s = seed * 10000;
        for (let i = 255; i > 0; i--) {
            s = (s * 9301 + 49297) % 233280;
            let j = Math.floor((s / 233280) * (i + 1));
            let tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
        }
        for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    }

    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(t, a, b) { return a + t * (b - a); }
    grad(hash, x, y) {
        let h = hash & 7;
        let u = h < 4 ? x : y;
        let v = h < 4 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    get(x, y) {
        let X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        let u = this.fade(x), v = this.fade(y);
        let A = this.p[X] + Y, B = this.p[X + 1] + Y;
        return this.lerp(v,
            this.lerp(u, this.grad(this.p[A], x, y), this.grad(this.p[B], x - 1, y)),
            this.lerp(u, this.grad(this.p[A + 1], x, y - 1), this.grad(this.p[B + 1], x - 1, y - 1))
        );
    }
}

class MapManager {
    constructor(width, height, cellSize) {
        // 💡 맵 3배 확장 적용
        this.width = width * 3; 
        this.height = height * 3; 
        this.cellSize = cellSize;
        this.cols = Math.ceil(this.width / cellSize);
        // 💡 오타 수정: Math.ceil8 -> Math.ceil
        this.rows = Math.ceil(this.height / cellSize); 
        this.grid = [];
    }

    initMap(mode = 'maingame') {
        if (mode === 'practice') this.initRandomMap(); 
        else this.initFixedMap();  
    }

    initFixedMap() {
        this.grid = [];
        // 💡 맵이 3배 커졌으므로, 고정 지형이 중앙에 오도록 오프셋 계산 (기존 40x40 기준)
        let rOff = Math.floor((this.rows - 40) / 2);
        let cOff = Math.floor((this.cols - 40) / 2);

        for(let r = 0; r < this.rows; r++) {
            let row = [];
            for(let c = 0; c < this.cols; c++) {
                let type = 'plain';
                let origR = r - rOff;
                let origC = c - cOff;

                if ((origR >= 4 && origR <= 16 && origC >= 4 && origC <= 16)) type = 'forest';
                let isRidge = (origC >= 12 && origC <= 38 && origR === Math.floor(24 + Math.sin(origC * 0.3) * 5));
                if (isRidge && origC !== 25) type = 'hill';
                if (origR >= 10 && origR <= 40 && origC >= 38 && origC <= 48) {
                    type = (origR === 10 || origR === 40 || origC === 38 || origC === 48) ? 'cliff' : 'highland';
                }
                if (origC === 25 && origR >= 5 && origR <= 45) {
                    if ((origR >= 22 && origR <= 24) || (origR >= 26 && origR <= 28)) type = 'stairs';
                    else type = 'wall';
                }
                row.push({ type: type });
            }
            this.grid.push(row);
        }
    }

    initRandomMap() {
        this.grid = [];
        let elevNoise = new PerlinNoise();
        let forestNoise = new PerlinNoise();
        
        const themes = ['forest', 'mountain', 'plains'];
        const currentTheme = themes[Math.floor(Math.random() * themes.length)];

        let elevThreshold = 0.55; 
        let forestThreshold = 0.55; 

        if (currentTheme === 'forest') {
            elevThreshold = 0.80;    
            forestThreshold = 0.3;   
        } else if (currentTheme === 'mountain') {
            elevThreshold = 0.35;    
            forestThreshold = 0.80;  
        }

        for(let r = 0; r < this.rows; r++) {
            let row = [];
            for(let c = 0; c < this.cols; c++) {
                let type = 'plain';

                let eVal = elevNoise.get(c * 0.08, r * 0.08) + 0.3 * elevNoise.get(c * 0.2, r * 0.2);
                let fVal = forestNoise.get(c * 0.1, r * 0.1);

                let isSpawnZone = (c < 8) || (c > this.cols - 8);
                let distToCenter = Math.hypot(c - this.cols/2, r - this.rows/2);
                let centerSoften = Math.max(0, 1 - distToCenter / 8) * 0.15; 

                if (!isSpawnZone) {
                    let finalE = eVal - centerSoften;
                    let finalF = fVal - centerSoften;

                    if (finalE > elevThreshold + 0.22) {
                        type = 'highland'; 
                    } else if (finalE > elevThreshold + 0.12) {
                        type = 'cliff';    
                    } else if (finalE > elevThreshold) {
                        type = 'hill';     
                    } else if (finalF > forestThreshold) {
                        type = 'forest';
                    }
                }
                row.push({ type: type });
            }
            this.grid.push(row);
        }

        let pathNoise = new PerlinNoise();
        for(let r = 2; r < this.rows - 2; r++) {
            for(let c = 2; c < this.cols - 2; c++) {
                if (this.grid[r][c].type === 'cliff') {
                    if (pathNoise.get(c * 0.15, r * 0.15) > 0.6) {
                        this.grid[r][c].type = 'hill';
                    }
                }
            }
        }
    }

    getCR(x, y) {
        let c = Math.floor((x + this.width/2) / this.cellSize);
        let r = Math.floor((y + this.height/2) / this.cellSize);
        return { c, r };
    }

    getAt(x, y) {
        let p = this.getCR(x, y);
        if(p.c >= 0 && p.c < this.cols && p.r >= 0 && p.r < this.rows) {
            let tile = this.grid[p.r][p.c];
            // 지형 데이터가 존재하는지 확인 후 리턴 (TerrainTypes 객체 의존)
            return { type: tile.type, ...(typeof TerrainTypes !== 'undefined' && TerrainTypes[tile.type] ? TerrainTypes[tile.type] : {obs: false, h: 0}) };
        }
        return { type: 'plain', obs: false, h: 0 };
    }

    buildAt(x, y, newType) {
        let p = this.getCR(x, y);
        if(p.c >= 0 && p.c < this.cols && p.r >= 0 && p.r < this.rows) {
            if (typeof TerrainTypes !== 'undefined' && TerrainTypes[newType]) {
                this.grid[p.r][p.c].type = newType;
                return true;
            }
        }
        return false;
    }

    canMoveTo(x1, y1, x2, y2) {
        let cellFrom = this.getAt(x1, y1);
        let cellTo = this.getAt(x2, y2);
        if (cellTo.obs) return false;
        let hDiff = Math.abs(cellTo.h - cellFrom.h);
        if (hDiff > 1 && cellFrom.type !== 'stairs' && cellTo.type !== 'stairs') {
            return false;
        }
        return true;
    }

    raycast(x1, y1, x2, y2) {
        let p1 = this.getCR(x1, y1); let p2 = this.getCR(x2, y2);
        let dx = Math.abs(p2.c - p1.c), sx = p1.c < p2.c ? 1 : -1;
        let dy = -Math.abs(p2.r - p1.r), sy = p1.r < p2.r ? 1 : -1;
        let err = dx + dy, e2;
        let currC = p1.c, currR = p1.r;
        let observerH = this.getAt(x1, y1).h;
        
        while(true) {
            if(currC >= 0 && currC < this.cols && currR >= 0 && currR < this.rows) {
                let cell = this.getAt((currC - this.cols/2) * this.cellSize, (currR - this.rows/2) * this.cellSize);
                if (cell.obs && cell.h >= observerH) return false;
            }
            if (currC === p2.c && currR === p2.r) break;
            e2 = 2 * err;
            if (e2 >= dy) { err += dy; currC += sx; }
            if (e2 <= dx) { err += dx; currR += sy; }
        }
        return true;
    }
}
