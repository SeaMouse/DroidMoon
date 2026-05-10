import Phaser from 'phaser';
import { state, resetGameState } from '../state.js';
import {
    SHIP_SPEED_LEVELS, SHIP_GEAR_UP_MS, SHIP_GEAR_DOWN_MS,
    SHIP_VERTICAL_SPEED, SHIP_FLIP_DURATION, SHIP_BARREL_ROLL_DURATION,
    SHIP_INITIAL_FACING,
    SHIP_SKY_MARGIN_TOP, SHIP_SKY_MARGIN_BOTTOM,
    SHIP_CAMERA_LEAD_MAX, SHIP_EDGE_ZONE,
} from '../config.js';

export class Level1Scene extends Phaser.Scene {
    constructor() {
        super({ key: 'Level1Scene' });
    }

    preload() {
        this.load.image('tiles', 'assets/poc_tiles.png');
        this.load.image('starfield', 'assets/starfield.png');
        this.load.tilemapTiledJSON('ship_exterior', 'assets/ship_exterior.tmj');
    }

    create() {
        // --- Tilemap ---
        const map     = this.make.tilemap({ key: 'ship_exterior' });
        const tileset = map.addTilesetImage('tiles', 'tiles');

        // Image layer (Starfield) — Phaser reads parallaxx/parallaxy from Tiled.
        map.createLayer('Starfield', tileset, 0, 0);

        // Hull (decorative, no collision).
        map.createLayer('Hull', tileset, 0, 0);

        // Obstacles (collidable).
        this.obstacleLayer = map.createLayer('Obstacles', tileset, 0, 0);
        this.obstacleLayer.setCollisionByProperty({ obstacle: true });

        // World dimensions come from the map.
        this.worldW = map.widthInPixels;
        this.worldH = map.heightInPixels;
        this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
        this.shipCameraLead = 0;

        // --- Player spawn from PlayerStart object layer ---
        const startLayer = map.getObjectLayer('PlayerStart');
        const startPoint = startLayer ? startLayer.objects[0] : null;
        const spawnX = startPoint ? startPoint.x : 200;
        const spawnY = startPoint ? startPoint.y : this.worldH / 2;

        // --- Ship texture (placeholder) ---
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

        this.ship = this.physics.add.sprite(spawnX, spawnY, 'ship');

        // Constrain physics world to the flight band (excludes sky margins + map edges).
        this.physics.world.setBounds(
            0,
            SHIP_SKY_MARGIN_TOP,
            this.worldW,
            this.worldH - SHIP_SKY_MARGIN_TOP - SHIP_SKY_MARGIN_BOTTOM
        );
        this.ship.body.setCollideWorldBounds(true);

        // Bump into tagged obstacle tiles.
        this.physics.add.collider(this.ship, this.obstacleLayer);

        // --- Landing zones ---
        this.landingZones = [];
        const landingLayer = map.getObjectLayer('LandingZones');
        if (landingLayer) {
            for (const obj of landingLayer.objects) {
                const props = obj.properties || [];
                const target = props.find(p => p.name === 'targetDeck');
                if (!target) {
                    console.warn('Landing zone "' + obj.name + '" has no targetDeck property; defaulting to deck1.');
                }
                this.landingZones.push({
                    name:       obj.name,
                    rect:       new Phaser.Geom.Rectangle(obj.x, obj.y, obj.width, obj.height),
                                       targetDeck: target ? target.value : 'deck1',
                });
            }
        }
        this.landingTriggered = false;

        // --- Ship state ---
        this.shipGear           = 0;
        this.shipFacing         = SHIP_INITIAL_FACING;
        this.shipFlipping       = false;
        this.shipGearShiftTimer = 0;
        this.shipFlipProgress   = 0;
        this.shipFlipPhase      = 'idle';
        this.shipPrevHorizInput = 0;

        this.cameras.main.startFollow(this.ship, true, 1, 1);

        this.cursors = this.input.keyboard.createCursorKeys();

        this.debugText = this.add.text(8, 8, '', {
            fontFamily: 'monospace', fontSize: '12px',
            fill: '#aaffcc',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 }
        }).setScrollFactor(0).setDepth(100);
    }

    update(time, delta) {
        if (this.landingTriggered) { return; }
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

        // --- Auto-flip near map edges ---
        const inLeftEdge  = this.ship.x < SHIP_EDGE_ZONE;
        const inRightEdge = this.ship.x > this.worldW - SHIP_EDGE_ZONE;
        if ((inLeftEdge  && this.shipFacing === -1) ||
            (inRightEdge && this.shipFacing ===  1)) {
            horizInput = -this.shipFacing;  // synthesize a brake input
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
                    if (this.shipGearShiftTimer >= SHIP_GEAR_UP_MS) {
                        this.shipGear++;
                        this.shipGearShiftTimer = 0;
                    }
                }
            } else if (horizInput === -this.shipFacing) {
                // Backward input — gear down, or flip at gear 0.
                this.shipGearShiftTimer += delta;
                if (this.shipGearShiftTimer >= SHIP_GEAR_DOWN_MS) {
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
                this.shipGear         = 1;
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

        // --- Landing zone check ---
        if (this.isLandingUnlocked()) {
            const sb = this.ship.getBounds();
            for (const zone of this.landingZones) {
                if (Phaser.Geom.Intersects.RectangleToRectangle(sb, zone.rect)) {
                    this.triggerLanding(zone);
                    return;
                }
            }
        }

        // --- Apply motion via the physics body so collisions resolve automatically ---
        const worldVy = vertInput * SHIP_VERTICAL_SPEED;
        this.ship.body.setVelocity(worldVx, worldVy);

        // --- Camera lead based on current velocity ---
        const maxSpeed = SHIP_SPEED_LEVELS[SHIP_SPEED_LEVELS.length - 1];
        const targetLead = -(worldVx / maxSpeed) * SHIP_CAMERA_LEAD_MAX;
        const LEAD_SMOOTH = 0.1;  // lower = floatier, higher = snappier
        this.shipCameraLead = Phaser.Math.Linear(this.shipCameraLead, targetLead, LEAD_SMOOTH);
        this.cameras.main.setFollowOffset(this.shipCameraLead, 0);

        // --- Debug overlay ---
        const drifting = this.shipVelocity < 0;
        this.debugText.setText([
            'gear:     ' + this.shipGear + ' / ' + (SHIP_SPEED_LEVELS.length - 1),
                               'speed:    ' + SHIP_SPEED_LEVELS[this.shipGear],
                               'facing:   ' + (this.shipFacing === 1 ? 'right →' : '← left'),
                               'flipping: ' + (this.shipFlipping ? 'YES (' + this.shipFlipPhase + ' ' + this.shipFlipProgress.toFixed(2) + ')' : 'no'),
                               'shift:    ' + Math.round(this.shipGearShiftTimer) + ' ms',
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


isLandingUnlocked() {
    // Future: return false until ship defenses are destroyed.
    return true;
}

triggerLanding(zone) {
    this.landingTriggered = true;
    this.ship.body.setVelocity(0, 0);

    const def      = zone.targetDeck;
    const labelTxt = 'LANDING — ' + def.toUpperCase();
    this.add.rectangle(400, 300, 420, 80, 0x000000, 0.75)
    .setScrollFactor(0).setDepth(200);
    this.add.text(400, 300, labelTxt, {
        fontFamily: 'monospace', fontSize: '24px',
        fill: '#44aaff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    this.cameras.main.fadeOut(800, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
        resetGameState();           // wipes deckStates etc. — fresh start.
        state.currentDeck = zone.targetDeck;
        this.scene.start('GameScene');
    });
}
}
