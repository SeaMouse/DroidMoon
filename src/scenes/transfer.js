// ─────────────────────────────────────────────
//  TRANSFER SCENE — the influence device's circuit duel
// ─────────────────────────────────────────────
//  Overlay scene launched by systems.updateTransferHold once the player has
//  clamped onto a droid for long enough. Mirrors the InventoryScene /
//  DeckSelectScene pattern: GameScene pauses itself, this runs on top, and
//  closing does scene.stop() + scene.resume('GameScene').
//
//  All simulation lives in transfer-board.js — this file only draws the
//  board, reads input, and reports the outcome back through
//  systems.resolveTransfer.
// ─────────────────────────────────────────────
import Phaser from 'phaser';
import { state } from './../state.js';
import {
    droidClasses, transferDifficulty, INPUT_DEAD_ZONE,
    TRANSFER_PLAYER_PULSER_BONUS,
} from './../config.js';
import { getHostClass } from './../power.js';
import { resolveTransfer } from './../systems.js';
import {
    BAR_SIZE, SIDE_COLS, TIMER_MS, SIDE_SELECT_MS,
    createBoard, chooseSide, firePulser, movePulser, step, countBar,
    createOpponentAI, stepOpponentAI,
} from './../transfer-board.js';

const FONT = 'monospace';
const RES  = 2;

// Paradroid's two circuit colours.
const COL_LEFT    = 0xffcc33;
const COL_RIGHT   = 0xcc66ff;
const COL_WIRE    = 0x445566;
const COL_HOSTILE = 0x884455;
const COL_USEFUL  = 0x55aa88;

// Layout, in the 640×512 internal resolution.
const CELL_H     = 18;
const CELL_W     = 22;
const BAR_W      = 44;
const TRACK_W    = 20;
const GAP        = 8;
const GRID_W     = SIDE_COLS * CELL_W;
const BOARD_TOP  = 138;

export class TransferScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TransferScene' });
    }

    init(data) {
        this.targetIndex = data && data.targetIndex;
        this.target      = state.enemies[this.targetIndex] || null;
        this.selectTimer = 0;
        this.hoverSide   = 'left';
        this.finished    = false;
        this.prevPadY    = 0;
        this.prevPadX    = 0;
        this.prevFire    = false;
    }

    create() {
        // The target can vanish between the hold completing and this scene
        // booting (a stray bullet, a deck restart) — bail out cleanly.
        if (!this.target) {
            this.close();
            return;
        }

        const targetClass = droidClasses[this.target.typeName];
        this.difficulty   = transferDifficulty(targetClass.classNo);
        this.hostClass    = getHostClass();

        this.newBoard();

        const W = this.scale.width;
        const H = this.scale.height;

        // Fully opaque: the paused deck's HUD sits at the same y as the title
        // here, and even a little bleed-through makes both unreadable.
        this.add.rectangle(0, 0, W, H, 0x000011, 1).setOrigin(0, 0).setScrollFactor(0);

        this.add.text(W / 2, 14, 'INFLUENCE DEVICE — TRANSFER', {
            fontFamily: FONT, fontSize: '15px', fill: '#88ffcc', resolution: RES,
        }).setOrigin(0.5, 0).setScrollFactor(0);

        this.add.text(W / 2, 36,
            this.hostClass.classNo + ' ' + this.hostClass.label +
            '   ▶   ' + targetClass.classNo + ' ' + targetClass.label, {
                fontFamily: FONT, fontSize: '11px', fill: '#aaaacc', resolution: RES,
            }).setOrigin(0.5, 0).setScrollFactor(0);

        this.promptText = this.add.text(W / 2, 58, '', {
            fontFamily: FONT, fontSize: '12px', fill: '#ffee00', resolution: RES,
        }).setOrigin(0.5, 0).setScrollFactor(0);

        this.scoreText = this.add.text(W / 2, H - 46, '', {
            fontFamily: FONT, fontSize: '12px', fill: '#ffffff', resolution: RES,
        }).setOrigin(0.5, 0).setScrollFactor(0);

        this.helpText = this.add.text(W / 2, H - 26,
            'LEFT/RIGHT pick side   UP/DOWN aim   SPACE fire', {
                fontFamily: FONT, fontSize: '10px', fill: '#666688', resolution: RES,
            }).setOrigin(0.5, 0).setScrollFactor(0);

        this.gfx = this.add.graphics().setScrollFactor(0);

        this.keys = this.input.keyboard.addKeys({
            up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
            space: 'SPACE', enter: 'ENTER',
        });

        this.redraw();
    }

    // A draw or a fresh attempt both want a brand-new circuit.
    newBoard() {
        this.board = createBoard({
            seed:            (Math.random() * 0xffffffff) >>> 0,
            // The device itself carries spare pulsers, so the human always
            // fields more than the bare chassis rating.
            playerPulsers:   this.hostClass.pulsers + TRANSFER_PLAYER_PULSER_BONUS,
            opponentPulsers: droidClasses[this.target.typeName].pulsers,
            difficulty:      this.difficulty,
        });
        this.ai          = null;
        this.selectTimer = 0;
        this.hoverSide   = 'left';
    }

    // ─────────────────────────────────────────────
    //  INPUT
    // ─────────────────────────────────────────────
    readInput(delta) {
        const pad = this.input.gamepad ? this.input.gamepad.getPad(0) : null;
        const jd  = Phaser.Input.Keyboard.JustDown;

        const padY = pad ? pad.leftStick.y : 0;
        const padX = pad ? pad.leftStick.x : 0;
        const padFire = !!(pad && pad.buttons[0] && pad.buttons[0].pressed);

        // Edge-detect the sticks so a held direction moves one row, not twelve.
        const stickDown  = padY >  INPUT_DEAD_ZONE && this.prevPadY <=  INPUT_DEAD_ZONE;
        const stickUp    = padY < -INPUT_DEAD_ZONE && this.prevPadY >= -INPUT_DEAD_ZONE;
        const stickRight = padX >  INPUT_DEAD_ZONE && this.prevPadX <=  INPUT_DEAD_ZONE;
        const stickLeft  = padX < -INPUT_DEAD_ZONE && this.prevPadX >= -INPUT_DEAD_ZONE;
        const fireEdge   = padFire && !this.prevFire;

        this.prevPadY = padY;
        this.prevPadX = padX;
        this.prevFire = padFire;

        return {
            up:    jd(this.keys.up)    || stickUp,
            down:  jd(this.keys.down)  || stickDown,
            left:  jd(this.keys.left)  || stickLeft,
            right: jd(this.keys.right) || stickRight,
            fire:  jd(this.keys.space) || jd(this.keys.enter) || fireEdge,
        };
    }

    update(time, delta) {
        if (this.finished || !this.board) { return; }

        const input = this.readInput(delta);

        if (this.board.phase === 'select') {
            this.updateSelect(input, time, delta);
        } else if (this.board.phase === 'running') {
            this.updateRunning(input, time, delta);
        }

        this.redraw();
    }

    updateSelect(input, time, delta) {
        if (input.left)  { this.hoverSide = 'left'; }
        if (input.right) { this.hoverSide = 'right'; }

        this.selectTimer += delta;

        // Committing early is allowed; running out of time commits for you.
        if (input.fire || this.selectTimer >= SIDE_SELECT_MS) {
            this.commitSide(this.hoverSide, time);
        }
    }

    commitSide(side, time) {
        chooseSide(this.board, side);
        this.ai = createOpponentAI(this.board, this.board.opponentSide, this.difficulty);
        // The AI's clock is the scene clock, so seed its first decision from now.
        this.ai.nextDecisionAt = time + this.ai.decisionDelay;
    }

    updateRunning(input, time, delta) {
        const side = this.board.playerSide;

        if (input.up)   { movePulser(this.board, side, -1); }
        if (input.down) { movePulser(this.board, side,  1); }
        if (input.fire) { firePulser(this.board, side, time); }

        if (this.ai) { stepOpponentAI(this.ai, this.board, time); }

        step(this.board, time, delta);

        if (this.board.phase === 'done') {
            this.onResolved();
        }
    }

    onResolved() {
        // A dead heat is replayed on a fresh circuit — neither droid wins and
        // neither is destroyed, exactly as the original handles it.
        if (this.board.result === 'draw') {
            this.promptText.setText('DEADLOCK — NEW CIRCUIT');
            this.finished = true;
            this.time.delayedCall(900, () => {
                this.finished = false;
                this.newBoard();
            });
            return;
        }

        this.finished = true;
        const result = this.board.result;
        this.promptText.setText(result === 'win' ? 'TRANSFER ACCEPTED' : 'OVERCHARGE — HOST BURNED OUT');

        this.time.delayedCall(1100, () => {
            resolveTransfer(result, this.target);
            this.close();
        });
    }

    close() {
        this.scene.stop();
        this.scene.resume('GameScene');
    }

    // ─────────────────────────────────────────────
    //  RENDERING
    // ─────────────────────────────────────────────
    // Geometry helpers. The right side is mirrored: its column 0 (nearest its
    // own side track) sits at the far right, so power visibly flows inward
    // on both halves.
    barX() {
        return Math.round(this.scale.width / 2 - BAR_W / 2);
    }

    cellRect(side, col, row) {
        const bx = this.barX();
        const y  = BOARD_TOP + row * CELL_H;
        const x  = side === 'left'
            ? bx - GAP - GRID_W + col * CELL_W
            : bx + BAR_W + GAP + (SIDE_COLS - 1 - col) * CELL_W;
        return { x, y, w: CELL_W, h: CELL_H };
    }

    trackX(side) {
        const bx = this.barX();
        return side === 'left'
            ? bx - GAP - GRID_W - GAP - TRACK_W
            : bx + BAR_W + GAP + GRID_W + GAP;
    }

    sideColour(side) {
        return side === 'left' ? COL_LEFT : COL_RIGHT;
    }

    redraw() {
        const g = this.gfx;
        const b = this.board;
        if (!g || !b) { return; }

        g.clear();

        this.drawTimer(g);
        for (const side of ['left', 'right']) {
            this.drawGrid(g, side);
            this.drawTrack(g, side);
        }
        this.drawPulses(g);
        this.drawBar(g);
        this.drawText();
    }

    drawTimer(g) {
        const W = this.scale.width;
        const barW = 320;
        const x = Math.round(W / 2 - barW / 2);
        const y = 88;

        g.fillStyle(0x222233, 1);
        g.fillRect(x, y, barW, 6);

        if (this.board.phase === 'select') {
            const pct = 1 - Math.min(1, this.selectTimer / SIDE_SELECT_MS);
            g.fillStyle(0x88ffcc, 1);
            g.fillRect(x, y, Math.round(barW * pct), 6);
        } else {
            const pct = 1 - Math.min(1, this.board.elapsed / TIMER_MS);
            g.fillStyle(pct > 0.25 ? 0x44aaff : 0xff4444, 1);
            g.fillRect(x, y, Math.round(barW * pct), 6);
        }
    }

    drawGrid(g, side) {
        const grid      = this.board.grids[side];
        const selecting = this.board.phase === 'select';
        const hovered   = this.hoverSide === side;
        const alpha     = (selecting && !hovered) ? 0.22 : 1;

        for (let col = 0; col < SIDE_COLS; col++) {
            for (let row = 0; row < BAR_SIZE; row++) {
                const r = this.cellRect(side, col, row);
                this.drawCell(g, grid[col][row], r, alpha, side);
            }
        }

        // Dimming the other half alone reads too weakly at this size, so the
        // half being considered also gets a frame in its own colour.
        if (selecting && hovered) {
            const first = this.cellRect(side, 0, 0);
            const last  = this.cellRect(side, SIDE_COLS - 1, BAR_SIZE - 1);
            const x0 = Math.min(first.x, last.x) - 4;
            const x1 = Math.max(first.x, last.x) + CELL_W + 4;
            g.lineStyle(2, this.sideColour(side), 0.9);
            g.strokeRect(x0, BOARD_TOP - 4, x1 - x0, BAR_SIZE * CELL_H + 8);
        }
    }

    // Each element gets a distinct silhouette rather than a colour alone —
    // at 18px tall on a CRT-ish canvas, shape reads faster than hue.
    drawCell(g, type, r, alpha, side) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const inward = side === 'left' ? 1 : -1;

        switch (type) {
            case 'wire':
                g.lineStyle(2, COL_WIRE, alpha);
                g.lineBetween(r.x, cy, r.x + r.w, cy);
                break;

            case 'splitter':
                g.lineStyle(2, COL_USEFUL, alpha);
                g.lineBetween(cx - inward * r.w / 2, cy, cx, cy);
                g.lineBetween(cx, cy, cx + inward * r.w / 2, cy - r.h);
                g.lineBetween(cx, cy, cx + inward * r.w / 2, cy + r.h);
                break;

            case 'joiner':
                g.lineStyle(2, COL_USEFUL, alpha);
                g.lineBetween(cx - inward * r.w / 2, cy - r.h, cx, cy);
                g.lineBetween(cx - inward * r.w / 2, cy + r.h, cx, cy);
                g.lineBetween(cx, cy, cx + inward * r.w / 2, cy);
                break;

            case 'auto':
                g.lineStyle(2, COL_WIRE, alpha);
                g.lineBetween(r.x, cy, r.x + r.w, cy);
                g.fillStyle(COL_USEFUL, alpha);
                g.fillCircle(cx, cy, 5);
                g.lineStyle(1, 0xffffff, alpha * 0.8);
                g.strokeCircle(cx, cy, 5);
                break;

            case 'terminator':
                g.lineStyle(2, COL_WIRE, alpha);
                g.lineBetween(r.x, cy, cx, cy);
                g.fillStyle(COL_HOSTILE, alpha);
                g.fillRect(cx - 4, cy - 5, 8, 10);
                break;

            case 'invert':
                g.lineStyle(2, COL_WIRE, alpha);
                g.lineBetween(r.x, cy, r.x + r.w, cy);
                g.fillStyle(COL_HOSTILE, alpha);
                g.fillPoints([
                    { x: cx,     y: cy - 6 },
                    { x: cx + 6, y: cy },
                    { x: cx,     y: cy + 6 },
                    { x: cx - 6, y: cy },
                ], true);
                break;

            case 'empty':
            default:
                g.fillStyle(0x1a1a26, alpha);
                g.fillRect(r.x + 2, cy - 1, r.w - 4, 2);
                break;
        }
    }

    drawTrack(g, side) {
        const x         = this.trackX(side);
        const colour    = this.sideColour(side);
        const selecting = this.board.phase === 'select';
        const active    = selecting ? this.hoverSide === side : true;

        g.lineStyle(1, colour, active ? 0.7 : 0.25);
        g.strokeRect(x + 0.5, BOARD_TOP + 0.5, TRACK_W - 1, BAR_SIZE * CELL_H - 1);

        // Pulsers only get dealt out by chooseSide, so during the select
        // phase show what each half *would* be worth — that is half the
        // information the choice is made on.
        const remaining = selecting
            ? (active ? this.board.pulserPool.player : this.board.pulserPool.opponent)
            : (this.board.pulsers[side] || 0);
        g.fillStyle(colour, active ? 0.55 : 0.2);
        for (let i = 0; i < Math.min(remaining, BAR_SIZE); i++) {
            g.fillRect(x + 4, BOARD_TOP + 3 + i * CELL_H, TRACK_W - 8, 5);
        }

        // The cursor only exists once a side is committed.
        if (this.board.phase !== 'select') {
            const row = this.board.pulserRow[side];
            const y   = BOARD_TOP + row * CELL_H;
            const isPlayer = side === this.board.playerSide;
            g.fillStyle(colour, 1);
            g.fillRect(x + 2, y + 3, TRACK_W - 4, CELL_H - 6);
            if (isPlayer) {
                g.lineStyle(2, 0xffffff, 1);
                g.strokeRect(x + 1.5, y + 2.5, TRACK_W - 3, CELL_H - 5);
            }
        }
    }

    drawPulses(g) {
        for (const p of this.board.pulses) {
            if (p.row < 0 || p.row >= BAR_SIZE) { continue; }
            const colour = this.sideColour(p.colour);

            // col -1 means the pulse is still in the side track.
            let cx, cy;
            if (p.col < 0) {
                cx = this.trackX(p.side) + TRACK_W / 2;
                cy = BOARD_TOP + p.row * CELL_H + CELL_H / 2;
            } else {
                const r = this.cellRect(p.side, p.col, p.row);
                cx = r.x + r.w / 2;
                cy = r.y + r.h / 2;
            }

            g.fillStyle(colour, 1);
            g.fillCircle(cx, cy, 4);
            g.lineStyle(1, 0xffffff, 0.9);
            g.strokeCircle(cx, cy, 4);
        }
    }

    drawBar(g) {
        const x = this.barX();
        for (let row = 0; row < BAR_SIZE; row++) {
            const y = BOARD_TOP + row * CELL_H;
            g.fillStyle(this.sideColour(this.board.bar[row]), 1);
            g.fillRect(x, y + 1, BAR_W, CELL_H - 2);
            g.lineStyle(1, 0x000011, 1);
            g.strokeRect(x + 0.5, y + 1.5, BAR_W - 1, CELL_H - 3);
        }

        // Outline in the colour currently holding the majority.
        const counts = countBar(this.board);
        const lead   = counts.left === counts.right
            ? 0x888899
            : this.sideColour(counts.left > counts.right ? 'left' : 'right');
        g.lineStyle(2, lead, 1);
        g.strokeRect(x - 2, BOARD_TOP - 1, BAR_W + 4, BAR_SIZE * CELL_H + 2);
    }

    drawText() {
        const counts = countBar(this.board);

        if (this.board.phase === 'select') {
            this.promptText.setText('CHOOSE YOUR SIDE — ' + this.hoverSide.toUpperCase());
            this.scoreText.setText('YOUR PULSERS ' + this.board.pulserPool.player +
                '     HOST ' + this.board.pulserPool.opponent);
            return;
        }

        if (!this.finished) {
            const mine   = counts[this.board.playerSide] || 0;
            const theirs = counts[this.board.opponentSide] || 0;
            this.promptText.setText('');
            this.scoreText.setText(
                'YOU ' + mine + '  —  ' + theirs + ' HOST     PULSERS ' +
                this.board.pulsers[this.board.playerSide]
            );
        }
    }
}
