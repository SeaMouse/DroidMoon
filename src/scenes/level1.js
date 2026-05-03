import Phaser from 'phaser';
import {
    SHIP_THRUST_RATE, SHIP_BRAKE_RATE, SHIP_MAX_SPEED, SHIP_MIN_SPEED,
    SHIP_VERTICAL_SPEED, SHIP_FLIP_DURATION,
    SHIP_INITIAL_FACING,
    SHIP_SKY_MARGIN_TOP, SHIP_SKY_MARGIN_BOTTOM,
} from '../config.js';

export class Level1Scene extends Phaser.Scene {
    constructor() {
        super({ key: 'Level1Scene' });
    }

    create() {
        // World dimensions — wider than camera so we can scroll.
        // Real tilemap replaces this in the next commit.
        this.worldW = 3200;
        this.worldH = 600;
        this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);

        // Backdrop + reference grid so motion is visible.
        this.add.rectangle(0, 0, this.worldW, this.worldH, 0x1a1a2e).setOrigin(0);
        const grid = this.add.graphics();
        grid.lineStyle(1, 0x2a2a4e, 1);
        for (let x = 0; x < this.worldW; x += 200) {
            grid.beginPath(); grid.moveTo(x, 0); grid.lineTo(x, this.worldH); grid.strokePath();
        }

        // Placeholder ship texture — green triangle pointing right with a
        // dark dot near the nose, so the flip is visually obvious.
        if (!this.textures.exists('ship')) {
            const g = this.add.graphics();
            g.fillStyle(0x44ffaa, 1);
            g.beginPath();
            g.moveTo(0, 0); g.lineTo(48, 16); g.lineTo(0, 32);
            g.closePath();
            g.fillPath();
            g.fillStyle(0x000000, 1);
            g.fillCircle(36, 16, 3);
            g.generateTexture('ship', 48, 32);
            g.destroy();
        }

        // Plain (non-physics) sprite — we'll move it manually each frame.
        this.ship = this.add.sprite(200, this.worldH / 2, 'ship');

        // --- Ship state (the heart of the momentum mechanic) ---
        this.shipVelocity = SHIP_MIN_SPEED;       // signed: + = forward, - = backward
        this.shipFacing   = SHIP_INITIAL_FACING;  // 1 = right, -1 = left
        this.shipFlipping = false;

        // Camera follows the ship.
        this.cameras.main.startFollow(this.ship, true, 0.08, 0.08);

        // Input.
        this.cursors = this.input.keyboard.createCursorKeys();

        // Debug overlay, pinned to camera.
        this.debugText = this.add.text(8, 8, '', {
            fontFamily: 'monospace', fontSize: '12px',
            fill: '#aaffcc',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 }
        }).setScrollFactor(0).setDepth(100);
    }

    update(time, delta) {
        // Defensive: if delta is missing or absurd, fall back to a sensible default.
        if (delta === undefined || isNaN(delta) || delta > 100) {
            delta = 16.67;
        }
        const dt = delta / 1000;

        // --- Read input as -1 / 0 / +1 on each axis ---
        const pad = this.input.gamepad ? this.input.gamepad.getPad(0) : null;
        const DEAD_ZONE = 0.15;

        let horizInput = 0;
        if (this.cursors.right.isDown) { horizInput += 1; }
        if (this.cursors.left.isDown)  { horizInput -= 1; }
        if (pad && Math.abs(pad.leftStick.x) > DEAD_ZONE) {
            horizInput = pad.leftStick.x > 0 ? 1 : -1;
        }

        let vertInput = 0;
        if (this.cursors.down.isDown) { vertInput += 1; }
        if (this.cursors.up.isDown)   { vertInput -= 1; }
        if (pad && Math.abs(pad.leftStick.y) > DEAD_ZONE) {
            vertInput = pad.leftStick.y > 0 ? 1 : -1;
        }

        // --- Momentum logic (skipped while flip tween runs) ---
        if (!this.shipFlipping) {
            if (horizInput === this.shipFacing) {
                this.shipVelocity += SHIP_THRUST_RATE * dt;
            } else if (horizInput === -this.shipFacing) {
                this.shipVelocity -= SHIP_BRAKE_RATE * dt;
            }

            // Normal flight: cap at MAX_SPEED.
            if (this.shipVelocity > SHIP_MIN_SPEED) {
                this.shipVelocity = Math.min(this.shipVelocity, SHIP_MAX_SPEED);
            } else if (this.shipVelocity >= 0) {
                // Decelerated to (or below) MIN_SPEED while above zero.
                this.shipVelocity = SHIP_MIN_SPEED;
                if (horizInput === -this.shipFacing) {
                    this.startFlip();
                }
            }
            // If shipVelocity is negative, we're in post-flip drift.
            // Thrust above will gradually push it back up through zero.
        }

        // --- Apply motion to position manually ---
        const worldVx = this.shipVelocity * this.shipFacing;
        const worldVy = vertInput * SHIP_VERTICAL_SPEED;
        this.ship.x += worldVx * dt;
        this.ship.y += worldVy * dt;

        // --- Clamp to world bounds and sky margins ---
        const halfW = this.ship.displayWidth  / 2;
        const halfH = this.ship.displayHeight / 2;
        this.ship.x = Phaser.Math.Clamp(this.ship.x, halfW, this.worldW - halfW);
        this.ship.y = Phaser.Math.Clamp(this.ship.y,
                                        SHIP_SKY_MARGIN_TOP + halfH,
                                        this.worldH - SHIP_SKY_MARGIN_BOTTOM - halfH);

        // --- Debug overlay ---
        const drifting = this.shipVelocity < 0;
        this.debugText.setText([
            'velocity: ' + this.shipVelocity.toFixed(1) + (drifting ? '  (drifting!)' : ''),
                               'facing:   ' + (this.shipFacing === 1 ? 'right →' : '← left'),
                               'flipping: ' + (this.shipFlipping ? 'YES' : 'no'),
                               'world vx: ' + worldVx.toFixed(1),
                               'pos:      ' + this.ship.x.toFixed(0) + ', ' + this.ship.y.toFixed(0),
        ].join('\n'));
    }

    startFlip() {
        this.shipFlipping = true;

        this.tweens.add({
            targets:  this.ship,
            scaleX:   -this.ship.scaleX,
            duration: SHIP_FLIP_DURATION,
            ease:     'Sine.easeInOut',
            onComplete: () => {
                this.shipFacing   *= -1;
                this.shipVelocity  = -this.shipVelocity;
                this.shipFlipping  = false;
            }
        });
    }
}
