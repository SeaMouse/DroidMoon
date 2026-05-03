import Phaser from 'phaser';
import {
    SHIP_SPEED_LEVELS, SHIP_GEAR_SHIFT_MS,
    SHIP_VERTICAL_SPEED, SHIP_FLIP_DURATION, SHIP_BARREL_ROLL_DURATION,
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
        this.shipGear           = 0;                      // 0 = slowest forward gear
        this.shipFacing         = SHIP_INITIAL_FACING;    // 1 right, -1 left
        this.shipFlipping       = false;
        this.shipGearShiftTimer = 0;                      // ms accumulator
        this.shipFlipProgress   = 0;                      // 0..1, advanced manually during flip
        this.shipFlipPhase = 'idle';                      // 'idle' | 'yaw' | 'roll'
        this.shipPrevHorizInput = 0;                      // for resetting timer on input change

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
        let worldVx;

        if (!this.shipFlipping) {
            // Reset the gear-shift timer if input direction changed or went to zero.
            // This stops players from accumulating ticks across separate presses.
            if (horizInput !== this.shipPrevHorizInput) {
                this.shipGearShiftTimer = 0;
            }
            this.shipPrevHorizInput = horizInput;

            // Tick the timer while a directional input is held.
            if (horizInput === this.shipFacing) {
                // Forward input — gear up if not already at max.
                if (this.shipGear < SHIP_SPEED_LEVELS.length - 1) {
                    this.shipGearShiftTimer += delta;
                    if (this.shipGearShiftTimer >= SHIP_GEAR_SHIFT_MS) {
                        this.shipGear++;
                        this.shipGearShiftTimer = 0;
                    }
                }
            } else if (horizInput === -this.shipFacing) {
                // Backward input — gear down, or flip at gear 0.
                this.shipGearShiftTimer += delta;
                if (this.shipGearShiftTimer >= SHIP_GEAR_SHIFT_MS) {
                    if (this.shipGear > 0) {
                        this.shipGear--;
                        this.shipGearShiftTimer = 0;
                    } else {
                        this.shipGearShiftTimer = 0;
                        this.startFlip();
                    }
                }
            }

            // Cruising: velocity is gear's speed, in facing direction.
            worldVx = SHIP_SPEED_LEVELS[this.shipGear] * this.shipFacing;
        } else if (this.shipFlipPhase === 'yaw') {
            // Phase 1: yaw. Velocity interpolates from +min through 0 to -min
            // (in the *old* facing). At the end, swap facing and start the roll.
            this.shipFlipProgress += delta / SHIP_FLIP_DURATION;

            if (this.shipFlipProgress >= 1) {
                this.shipFlipProgress = 1;
                this.shipFacing      *= -1;
                this.shipGear         = 0;
                // Stay in flipping state, but transition to the roll phase.
                this.shipFlipPhase    = 'roll';
                this.shipFlipProgress = 0;
                this.startBarrelRoll();
            }

            const flipMultiplier = 1 - 2 * this.shipFlipProgress;
            // Note: shipFacing here is still the *old* facing — the swap above
            // only fires on the final frame, when multiplier is exactly -1.
            worldVx = SHIP_SPEED_LEVELS[0] * this.shipFacing * flipMultiplier;
        } else {
            // Phase 2: roll. Gameplay-wise the ship is already cruising at gear 0
            // in the new facing — inputs are simply locked while the visual roll plays.
            this.shipFlipProgress += delta / SHIP_BARREL_ROLL_DURATION;

            if (this.shipFlipProgress >= 1) {
                this.shipFlipPhase    = 'idle';
                this.shipFlipping     = false;
                this.shipFlipProgress = 0;
            }

            worldVx = SHIP_SPEED_LEVELS[0] * this.shipFacing;
        }

        // --- Apply motion to position manually ---
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
            'gear:     ' + this.shipGear + ' / ' + (SHIP_SPEED_LEVELS.length - 1),
                               'speed:    ' + SHIP_SPEED_LEVELS[this.shipGear],
                               'facing:   ' + (this.shipFacing === 1 ? 'right →' : '← left'),
                               'flipping: ' + (this.shipFlipping ? 'YES (' + this.shipFlipPhase + ' ' + this.shipFlipProgress.toFixed(2) + ')' : 'no'),
                               'shift:    ' + Math.round(this.shipGearShiftTimer) + ' / ' + SHIP_GEAR_SHIFT_MS + ' ms',
                               'world vx: ' + worldVx.toFixed(1),
        ].join('\n'));
    }

    startFlip() {
        this.shipFlipping     = true;
        this.shipFlipPhase    = 'yaw';
        this.shipFlipProgress = 0;

        // Phase 1 visual: horizontal flip (yaw).
        this.tweens.add({
            targets:  this.ship,
            scaleX:   -this.ship.scaleX,
            duration: SHIP_FLIP_DURATION,
            ease:     'Sine.easeInOut',
        });
    }

    startBarrelRoll() {
        // Phase 2 visual: vertical flip (barrel roll), starts when phase 1 ends.
        this.tweens.add({
            targets:  this.ship,
            scaleY:   -this.ship.scaleY,
            duration: SHIP_BARREL_ROLL_DURATION,
            ease:     'Sine.easeInOut',
        });
    }
}
