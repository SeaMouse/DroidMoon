import Phaser from 'phaser';
import { state, resetGameState } from '../state.js';
import { PLAYER_MAX_ENERGY, INVINCIBILITY_MS } from '../config.js';
import { Turret } from '../turret.js';
import { BulletPool, createFpsCounter } from '../systems.js';
import {
    CAMERA_ZOOM, GAME_WIDTH, GAME_HEIGHT, SHIP_SCALE,
    SHIP_SPEED_LEVELS, SHIP_GEAR_UP_MS, SHIP_GEAR_DOWN_MS,
    SHIP_VERTICAL_SPEED, SHIP_FLIP_DURATION, SHIP_BARREL_ROLL_DURATION,SHIP_ROLL_DURATION,
    SHIP_INITIAL_FACING,
    SHIP_SHADOW_OFFSET_X, SHIP_SHADOW_OFFSET_Y,SHIP_SHADOW_ALPHA,
    SHIP_SKY_MARGIN_TOP, SHIP_SKY_MARGIN_BOTTOM,
    SHIP_CAMERA_LEAD_MAX, SHIP_EDGE_ZONE,
    LASER_EMITTER_X_OFFSET, LASER_EMITTER_Y_OFFSET,
    SHIP_BULLET_COOLDOWN_MS, SHIP_BULLET_SPEED, SHIP_BULLET_DAMAGE, SHIP_BULLET_MAX_POOL,
    TURRET_BULLET_SPEED, TURRET_BULLET_DAMAGE, TURRET_BULLET_MAX_POOL,
    INPUT_DEAD_ZONE
} from '../config.js';

export class Level1Scene extends Phaser.Scene {
    constructor() {
        super({ key: 'Level1Scene' });
    }

    preload() {
        this.load.image('tiles', 'assets/poc_tiles.png');
        this.load.image('starfield', 'assets/starfield.png');
        this.load.image('turret_base', 'assets/tower01_128.png');
        this.load.image('turret_cannon', 'assets/turret_01_mk2.png');
        this.load.tilemapTiledJSON('ship_exterior', 'assets/ship_exterior.tmj');
        this.load.spritesheet('manta_flip_start', 'assets/manta/manta_sheet_start-flip-90-0.png', {
            frameWidth: 64,
            frameHeight: 64,
        });
        this.load.spritesheet('manta_flip_end', 'assets/manta/manta_sheet_end-flip-0-90.png', {
            frameWidth: 64,
            frameHeight: 64,
        });
        this.load.spritesheet('manta_roll_start', 'assets/manta/manta_sheet_start-roll-90-0.png', {
            frameWidth: 64,
            frameHeight: 64,
        });
        this.load.spritesheet('manta_roll_end', 'assets/manta/manta_sheet_end-roll-0-90.png', {
            frameWidth: 64,
            frameHeight: 64,
        });
    }

    create() {
        // --- Run state ---
        state.playerEnergy    = PLAYER_MAX_ENERGY;   // explicit reset, in case we ever bypass TitleScene
        state.gameOver         = false;
        state.playerInvincible = false;

        // --- Tilemap ---
        const map     = this.make.tilemap({ key: 'ship_exterior' });
        const tileset = map.addTilesetImage('tiles', 'tiles');

        // Starfield backdrop — fixed to the screen (scrollFactor 0), not the world,
        // so the stars stay put while the ship hull scrolls past. Scaled to cover
        // the whole viewport regardless of the source image size.
        const starfield = this.add.image(0, 0, 'starfield')
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(-1);
        const coverScale = Math.max(
            GAME_WIDTH  / starfield.width,
            GAME_HEIGHT / starfield.height
        );
        starfield.setScale(coverScale);

        // Tile layers — iterate every one in the map, in Tiled's order.
        // (Scene instances are reused on restart, so clear stale layer refs first.)
        this.obstacleLayer = null;
        this.hullLayer     = null;
        let depth = 0;
        for (const layerData of map.layers) {
            const layer = map.createLayer(layerData.name, tileset, 0, 0);
            if (!layer) { continue; }
            layer.setDepth(depth++);
            if (layerData.name === 'Hull') {
                this.hullLayer = layer;
            }
            if (layerData.name === 'Obstacles') {
                this.obstacleLayer = layer;
                layer.setCollisionByProperty({ obstacle: true });
            }
        }

        if (!this.obstacleLayer) {
            console.error('Level1: map "ship_exterior" has no "Obstacles" tile layer — ' +
                'collision and bullet impacts depend on it. Check the layer name in Tiled.');
            return;
        }

        this.obstacleLayer.setDepth(11);  // ← above shadow (10), below ship

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

        // --- Ship texture  ---
        this.ship = this.physics.add.sprite(spawnX, spawnY, 'manta_flip_start', 0);
        this.ship.setScale(SHIP_SCALE);

        // Cast shadow: a duplicate of the ship, tinted black and offset.
        // It must only appear on the hull, never on the starfield. Phaser 4's
        // mask filter can't do that cleanly here: the mask and the masked sprite
        // are rendered at slightly different positions while moving (phaser#7096),
        // which smears the shadow in the direction of travel at speed. Instead we
        // composite it by hand each frame into a RenderTexture (same idiom as the
        // fog of war): stamp the shadow, then erase a baked "space" stencil.
        // Mask and shadow share a single draw, so they can never drift apart.
        this.shipShadow = this.make.sprite({
            x:     this.ship.x,
            y:     this.ship.y,
            key:   this.ship.texture.key,
            frame: this.ship.frame.name,
        }, false);   // never on the display list — only stamped into shadowRT
        this.shipShadow.setScale(SHIP_SCALE);
        this.shipShadow.setTint(0x000000);
        this.shipShadow.setAlpha(SHIP_SHADOW_ALPHA);

        this.ship.setDepth(100);

        // Baked stencil: opaque everywhere EXCEPT the hull footprint.
        // Erasing it from the shadow RT clips the shadow to the hull.
        this.spaceMask = this.make.renderTexture(
            { x: 0, y: 0, width: this.worldW, height: this.worldH }, false);
        this.spaceMask.setOrigin(0, 0);
        if (this.hullLayer) {
            this.spaceMask.fill(0xffffff, 1);
            this.spaceMask.erase(this.hullLayer);
            this.spaceMask.render();
        } else {
            console.warn('Level1: no "Hull" tile layer found — ship shadow will not be clipped to the hull.');
        }

        // The composited shadow — above the tile layers (default depth 0),
        // below obstacles (11) and the ship (100).
        this.shadowRT = this.add.renderTexture(0, 0, this.worldW, this.worldH);
        this.shadowRT.setOrigin(0, 0);
        this.shadowRT.setDepth(10);
        // 'all' mode flushes the queued draw commands during this RT's own
        // render pass — in-frame, atomic with its display. Calling .render()
        // manually from update() instead flushes outside the render pass,
        // which lands on the wrong side of the frame boundary every other
        // frame and makes the shadow flicker.
        this.shadowRT.setRenderMode('all');

        // Sync + compose on POST_UPDATE, not in update(): arcade physics moves
        // bodies before update() but only syncs body → sprite afterwards, so
        // ship.x read inside update() is one physics step stale. That constant
        // lag turns into visible flicker whenever render fps and the fixed
        // 60 Hz physics step don't line up (e.g. high-refresh monitors).
        // Physics registers its own postupdate listener first, so the sprite
        // is up to date by the time this runs.
        this.events.on('postupdate', this.composeShadow, this);

        // Neither helper is on the display list, so destroy them by hand.
        this.events.once('shutdown', () => {
            this.events.off('postupdate', this.composeShadow, this);
            this.shipShadow.destroy();
            this.spaceMask.destroy();
        });

        // Constrain physics world to the flight band (excludes sky margins + map edges).
        this.physics.world.setBounds(
            0,
            SHIP_SKY_MARGIN_TOP,
            this.worldW,
            this.worldH - SHIP_SKY_MARGIN_TOP - SHIP_SKY_MARGIN_BOTTOM
        );
        this.ship.body.setCollideWorldBounds(true);
        // Stop fast bullets tunneling through obstacle tiles.
        this.physics.world.TILE_BIAS = 64;

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

        // --- Bullet texture (short bright streak) ---
        if (!this.textures.exists('ship_bullet')) {
            const g = this.add.graphics();
            g.fillStyle(0x88ddff, 1);   // glow halo
            g.fillRect(0, 0, 10, 4);
            g.fillStyle(0xffffff, 1);   // bright core
            g.fillRect(1, 1, 8, 2);
            g.generateTexture('ship_bullet', 10, 4);
            g.destroy();
        }

        // --- Player bullet pool ---
        this.playerBullets = new BulletPool(this, {
            textureKey:    'ship_bullet',
            defaultSpeed:  SHIP_BULLET_SPEED,
            defaultDamage: SHIP_BULLET_DAMAGE,
            maxSize:       SHIP_BULLET_MAX_POOL,
        });

        // Bullets die on obstacle tiles. Destructable tiles also break.
        this.physics.add.collider(this.playerBullets.group, this.obstacleLayer, (bullet, tile) => {
            if (tile.properties && tile.properties.destructable) {
                this.destroyTile(tile);
            }
            this.playerBullets.deactivate(bullet);
        });

        // --- Turret bullet texture (small red orb) ---
        if (!this.textures.exists('turret_bullet')) {
            const g = this.add.graphics();
            g.fillStyle(0xff4444, 1);
            g.fillCircle(4, 4, 4);
            g.fillStyle(0xffddaa, 1);
            g.fillCircle(4, 4, 2);
            g.generateTexture('turret_bullet', 8, 8);
            g.destroy();
        }

        // --- Turret bullet pool ---
        this.turretBullets = new BulletPool(this, {
            textureKey:    'turret_bullet',
            defaultSpeed:  TURRET_BULLET_SPEED,
            defaultDamage: TURRET_BULLET_DAMAGE,
            maxSize:       TURRET_BULLET_MAX_POOL,
        });

        // Turret bullets die on obstacle tiles.
        this.physics.add.collider(this.turretBullets.group, this.obstacleLayer, (bullet) => {
            this.turretBullets.deactivate(bullet);
        });

        // Turret bullets hitting the ship → damage.
        this.physics.add.overlap(this.ship, this.turretBullets.group, (_ship, bullet) => {
            const dmg = bullet.getData('damage') ?? 1;
            this.turretBullets.deactivate(bullet);
            this.applyDamageToShip(dmg);
        });

        this.lastShotTime = 0;

        // --- Turrets ---
        this.turrets = [];
        const turretLayer = map.getObjectLayer('Turrets');
        if (turretLayer) {
            for (const obj of turretLayer.objects) {
                this.turrets.push(new Turret(this, obj.x, obj.y));
            }
        } else {
            console.warn('Level1: no "Turrets" object layer found in map.');
        }

        // --- Ship state ---
        this.shipGear           = 0;
        this.shipFacing         = SHIP_INITIAL_FACING;
        this.shipFlipping       = false;
        this.shipGearShiftTimer = 0;
        this.shipFlipProgress   = 0;
        this.shipFlipPhase      = 'idle';
        this.shipPrevHorizInput = 0;
        // Side-roll state (independent of flip)
        this.shipRollPhase      = 'idle';   // 'idle' | 'rolling-in' | 'side' | 'rolling-out'
        this.shipRollDir        = 0;        // -1 = rolled via UP, +1 = rolled via DOWN
        this.shipRollProgress   = 0;        // 0 = upright, 1 = fully on side
        this.shipPrevVertInputR = 0;        // for right-stick edge detection
        this.shipFlipPending = false;   // brake-while-sideways waits for rollback to finish

        this.cameras.main.startFollow(this.ship, true, 1, 1);
        this.cameras.main.setZoom(CAMERA_ZOOM);

        this.cursors = this.input.keyboard.createCursorKeys();

        this.debugText = this.add.text(8, 8, '', {
            fontFamily: 'monospace', fontSize: '12px',
            fill: '#aaffcc',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 }
        }).setScrollFactor(0).setDepth(100);

        this.createShipHUD();
        createFpsCounter(this);
    }

    update(time, delta) {
        if (this.landingTriggered) { return; }
        if (state.gameOver) { return; }

        // Defensive: if delta is missing or absurd, fall back to a sensible default.
        if (delta === undefined || isNaN(delta) || delta > 100) {
            delta = 16.67;
        }
        const dt = delta / 1000;

        // --- Read input as -1 / 0 / +1 on each axis ---
        const pad = this.input.gamepad ? this.input.gamepad.getPad(0) : null;

        let horizInput = 0;
        if (this.cursors.right.isDown) { horizInput += 1; }
        if (this.cursors.left.isDown)  { horizInput -= 1; }
        if (pad && Math.abs(pad.leftStick.x) > INPUT_DEAD_ZONE) {
            horizInput = pad.leftStick.x > 0 ? 1 : -1;
        }

        let vertInput = 0;
        if (this.cursors.down.isDown) { vertInput += 1; }
        if (this.cursors.up.isDown)   { vertInput -= 1; }
        if (pad && Math.abs(pad.leftStick.y) > INPUT_DEAD_ZONE) {
            vertInput = pad.leftStick.y > 0 ? 1 : -1;
        }

        // --- Read right stick Y (for side-roll) ---
        let vertInputR = 0;
        if (pad && Math.abs(pad.rightStick.y) > INPUT_DEAD_ZONE) {
            vertInputR = pad.rightStick.y > 0 ? 1 : -1;
        }

        // --- Side-roll state machine ---
        if (!this.shipFlipping) {
            const rstickEdge = vertInputR !== 0 && vertInputR !== this.shipPrevVertInputR;

            if (this.shipRollPhase === 'idle' && rstickEdge) {
                // Start rolling onto our side
                this.shipRollPhase    = 'rolling-in';
                this.shipRollDir      = vertInputR;
                this.shipRollProgress = 0;
            } else if (this.shipRollPhase === 'side') {
                // Only way back upright manually: opposite stick push.
                if (rstickEdge && vertInputR === -this.shipRollDir) {
                    this.shipRollPhase    = 'rolling-out';
                    this.shipRollProgress = 0;
                }
            }
        }
        this.shipPrevVertInputR = vertInputR;

        // --- Advance the roll animation if one's running ---
        if (this.shipRollPhase === 'rolling-in' || this.shipRollPhase === 'rolling-out') {
            this.shipRollProgress += delta / SHIP_ROLL_DURATION;

            // Frames 0..5 of manta_roll_start: 0 = top-view, 5 = fully on side.
            const t = this.shipRollPhase === 'rolling-in'
            ? this.shipRollProgress
            : 1 - this.shipRollProgress;
            const frame = Phaser.Math.Clamp(Math.floor(t * 6), 0, 5);
            this.ship.setTexture('manta_roll_start', frame);
            this.ship.setFlipY(this.shipRollDir > 0);  // mirror for the opposite direction

            if (this.shipRollProgress >= 1) {
                this.shipRollProgress = 0;
                if (this.shipRollPhase === 'rolling-in') {
                    this.shipRollPhase = 'side';
                } else {
                    this.shipRollPhase = 'idle';
                    this.shipRollDir   = 0;
                    this.ship.setFlipY(false);
                    this.ship.setTexture('manta_flip_start', 0);
                    if (this.shipFlipPending) {           // ← new
                        this.shipFlipPending = false;     // ← new
                        this.startFlip();                 // ← new
                    }
                }
            }
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
            if (horizInput !== this.shipPrevHorizInput) {
                this.shipGearShiftTimer = 0;
            }
            this.shipPrevHorizInput = horizInput;

            if (horizInput === this.shipFacing) {
                if (this.shipGear < SHIP_SPEED_LEVELS.length - 1) {
                    this.shipGearShiftTimer += delta;
                    if (this.shipGearShiftTimer >= SHIP_GEAR_UP_MS) {
                        this.shipGear++;
                        this.shipGearShiftTimer = 0;
                    }
                }
            } else if (horizInput === -this.shipFacing) {
                this.shipGearShiftTimer += delta;
                if (this.shipGearShiftTimer >= SHIP_GEAR_DOWN_MS) {
                    this.shipGearShiftTimer = 0;
                    if (this.shipGear > 0) {
                        this.shipGear--;
                    } else if (this.shipRollPhase === 'side') {
                        // Roll back upright first; flip kicks in once rolling-out completes.
                        this.shipRollPhase    = 'rolling-out';
                        this.shipRollProgress = 0;
                        this.shipFlipPending  = true;
                    } else if (this.shipRollPhase === 'idle') {
                        this.startFlip();
                    }
                    // If we're mid-roll, do nothing this tick — wait for it to settle.
                }
            }

            worldVx = SHIP_SPEED_LEVELS[this.shipGear] * this.shipFacing;
        } else if (this.shipFlipPhase === 'yaw') {
            this.shipFlipProgress += delta / SHIP_FLIP_DURATION;

            // Drive the sprite frame from progress: 13 unique frames across the yaw.
            // Frames 0–6 come from sheet 1, frames 7–12 from sheet 2 (its frame 0 is the
            // duplicate of sheet 1's frame 6, so we skip it by offsetting -6).
            const idx = Phaser.Math.Clamp(Math.floor(this.shipFlipProgress * 13), 0, 12);
            if (idx <= 6) {
                this.ship.setTexture('manta_flip_start', idx);
            } else {
                this.ship.setTexture('manta_flip_end', idx - 6);
            }
            this.ship.setFlipX(this.shipFlipStartFacing === -1);

            if (this.shipFlipProgress >= 1) {
                this.shipFlipProgress = 1;
                this.shipFacing      *= -1;
                this.shipGear         = 1;
                this.shipFlipPhase    = 'roll';
                this.shipFlipProgress = 0;
                this.ship.setTexture('manta_roll_end', 4);   // seed roll on its last forward frame (upside-down)
                this.startBarrelRoll();
            }

            const flipMultiplier = 1 - 2 * this.shipFlipProgress;
            worldVx = SHIP_SPEED_LEVELS[0] * this.shipFacing * flipMultiplier;
        } else {
            this.shipFlipProgress += delta / SHIP_BARREL_ROLL_DURATION;

            // Drive sprite frame from progress, played in REVERSE so the ship recovers
            // from upside-down (end of yaw) back to right-side-up.
            // 11 unique frames: 6 from sheet 1 (top-view → side-on) + 5 from sheet 2 (side-on → upside-down).
            const idx    = Phaser.Math.Clamp(Math.floor(this.shipFlipProgress * 11), 0, 10);
            const revIdx = 10 - idx;
            if (revIdx < 6) {
                this.ship.setTexture('manta_roll_start', revIdx);
            } else {
                this.ship.setTexture('manta_roll_end', revIdx - 6);
            }

            if (this.shipFlipProgress >= 1) {
                this.shipFlipPhase    = 'idle';
                this.shipFlipping     = false;
                this.shipFlipProgress = 0;
                this.ship.setTexture('manta_flip_start', 0);   // settle on canonical idle pose
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
        if (this.shipFlipPhase !== 'yaw') {
            this.ship.setFlipX(this.shipFacing === -1);
        }

        // --- Camera lead based on current velocity ---
        const maxSpeed = SHIP_SPEED_LEVELS[SHIP_SPEED_LEVELS.length - 1];
        const targetLead = -(worldVx / maxSpeed) * SHIP_CAMERA_LEAD_MAX;
        const LEAD_SMOOTH = 0.05;
        this.shipCameraLead = Phaser.Math.Linear(this.shipCameraLead, targetLead, LEAD_SMOOTH);
        this.cameras.main.setFollowOffset(this.shipCameraLead, 0);

        // --- Twin laser fire ---
        const firing = this.shipFlipPhase !== 'yaw' && (
            this.cursors.space.isDown ||
            (pad && pad.buttons[7] && pad.buttons[7].value > 0.5)
        );
        if (firing && time - this.lastShotTime >= SHIP_BULLET_COOLDOWN_MS) {
            this.lastShotTime = time;
            const sx = this.ship.x + LASER_EMITTER_X_OFFSET * SHIP_SCALE * this.shipFacing;

            // Gun separation shrinks with the cosine of the roll angle.
            // Two systems can roll the ship — only one is active at a time:
            //   • flip's barrel-roll phase: goes from π (upside-down) back to 0
            //   • side-roll: goes 0 → π/2, holds at π/2, then π/2 → 0
            let rollAngle = 0;
            if (this.shipFlipPhase === 'roll') {
                rollAngle = (1 - this.shipFlipProgress) * Math.PI;
            } else if (this.shipRollPhase === 'rolling-in') {
                rollAngle = this.shipRollProgress * (Math.PI / 2);
            } else if (this.shipRollPhase === 'side') {
                rollAngle = Math.PI / 2;
            } else if (this.shipRollPhase === 'rolling-out') {
                rollAngle = (1 - this.shipRollProgress) * (Math.PI / 2);
            }
            const dy = LASER_EMITTER_Y_OFFSET * SHIP_SCALE * Math.cos(rollAngle);

            this.playerBullets.fire(sx, this.ship.y - dy, this.shipFacing, 0);
            this.playerBullets.fire(sx, this.ship.y + dy, this.shipFacing, 0);
        }

        // --- Bullet bookkeeping: turret hits + offscreen cleanup ---
        for (const bullet of this.playerBullets.group.getChildren()) {
            if (!bullet.active) { continue; }

            // Did it hit a turret?
            let consumed = false;
            for (const t of this.turrets) {
                if (t.containsPoint(bullet.x, bullet.y)) {
                    t.hit(SHIP_BULLET_DAMAGE);
                    this.playerBullets.deactivate(bullet);
                    consumed = true;
                    break;
                }
            }
            if (consumed) { continue; }

            // Off camera? Recycle so the pool doesn't fill up.
            const cam    = this.cameras.main;
            const margin = 50;
            if (bullet.x < cam.scrollX - margin ||
                bullet.x > cam.scrollX + cam.width + margin) {
                this.playerBullets.deactivate(bullet);
                }
        }

        // --- Turrets
        for (const t of this.turrets) {
            t.update(this.ship, time);
        }

        // --- Turret bullet bookkeeping: offscreen cleanup ---
        {
            const cam    = this.cameras.main;
            const margin = 50;
            for (const bullet of this.turretBullets.group.getChildren()) {
                if (!bullet.active) { continue; }
                if (bullet.x < cam.scrollX - margin ||
                    bullet.x > cam.scrollX + cam.width + margin ||
                    bullet.y < cam.scrollY - margin ||
                    bullet.y > cam.scrollY + cam.height + margin) {
                    this.turretBullets.deactivate(bullet);
                    }
            }
        }

        // --- Debug overlay ---
        this.debugText.setText([
            'gear:     ' + this.shipGear + ' / ' + (SHIP_SPEED_LEVELS.length - 1),
                               'speed:    ' + SHIP_SPEED_LEVELS[this.shipGear],
                               'facing:   ' + (this.shipFacing === 1 ? 'right →' : '← left'),
                               'flipping: ' + (this.shipFlipping ? 'YES (' + this.shipFlipPhase + ' ' + this.shipFlipProgress.toFixed(2) + ')' : 'no'),
                               'shift:    ' + Math.round(this.shipGearShiftTimer) + ' ms',
                               'world vx: ' + worldVx.toFixed(1),
                               'turrets: ' + this.turrets.filter(t => t.alive).length + ' / ' + this.turrets.length,
        ].join('\n'));
    }

    // Runs on the scene's POST_UPDATE event — after arcade physics has synced
    // the ship sprite to its body — so the shadow uses this frame's rendered
    // ship position, not last frame's (see listener registration in create).
    composeShadow() {
        if (!this.ship || !this.ship.active || !this.shadowRT) { return; }

        // Keep the shadow in lockstep with the ship.
        this.shipShadow.setTexture(this.ship.texture.key, this.ship.frame.name);
        this.shipShadow.setFlipX(this.ship.flipX);
        this.shipShadow.setFlipY(this.ship.flipY);
        this.shipShadow.setRotation(this.ship.rotation);
        this.shipShadow.x = this.ship.x + SHIP_SHADOW_OFFSET_X * SHIP_SCALE;
        this.shipShadow.y = this.ship.y + SHIP_SHADOW_OFFSET_Y * SHIP_SCALE;

        // Composite: stamp the shadow, then cut away everything that isn't
        // hull. Commands are only queued here — renderMode 'all' flushes them
        // during the RT's render pass, so the update is frame-atomic.
        this.shadowRT.clear();
        this.shadowRT.draw(this.shipShadow);
        this.shadowRT.erase(this.spaceMask);
    }

    startFlip() {
        this.shipFlipping        = true;
        this.shipFlipPhase       = 'yaw';
        this.shipFlipProgress    = 0;
        this.shipFlipStartFacing = this.shipFacing;   // lock the orientation for the duration of the animation
    }

    startBarrelRoll() {
        // Frame-driven from update() now; no setup needed.

    }


    isLandingUnlocked() {
        return this.turrets.every(t => !t.alive);
    }

    destroyTile(tile) {
        const idx = tile.properties.destroyedIndex;

        // No replacement specified → clear the tile entirely.
        if (idx === undefined || idx < 0) {
            this.obstacleLayer.removeTileAt(tile.x, tile.y);
            return;
        }

        // Tiled tile IDs are 0-indexed within the tileset; Phaser map indexes
        // are firstgid-offset across the whole map. Translate before placing.
        const firstgid = tile.tileset ? tile.tileset.firstgid : 1;
        const newTile  = this.obstacleLayer.putTileAt(idx + firstgid, tile.x, tile.y);

        if (newTile) {
            // putTileAt swaps the tile index but leaves stale properties behind.
            // Pull fresh properties straight from the tileset.
            const tileset = tile.tileset;
            const tsProps = (tileset && tileset.getTileProperties)
            ? tileset.getTileProperties(idx + firstgid)
            : null;
            newTile.properties = tsProps ? { ...tsProps } : {};

            const isObstacle = !!newTile.properties.obstacle;
            newTile.collideLeft  = isObstacle;
            newTile.collideRight = isObstacle;
            newTile.collideUp    = isObstacle;
            newTile.collideDown  = isObstacle;
            newTile.faceLeft     = isObstacle;
            newTile.faceRight    = isObstacle;
            newTile.faceTop      = isObstacle;
            newTile.faceBottom   = isObstacle;

            this.obstacleLayer.calculateFacesAt(newTile.x, newTile.y);
        }
    }

triggerLanding(zone) {
    this.landingTriggered = true;
    this.ship.body.setVelocity(0, 0);

    const def      = zone.targetDeck;
    const labelTxt = 'LANDING — ' + def.toUpperCase();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add.rectangle(cx, cy, 210, 40, 0x000000, 0.75)
    .setScrollFactor(0).setDepth(200);
    this.add.text(cx, cy, labelTxt, {
        fontFamily: 'monospace', fontSize: '11px',
        fill: '#44aaff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    this.cameras.main.fadeOut(800, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
        resetGameState();           // wipes deckStates etc. — fresh start.
        state.currentDeck = zone.targetDeck;
        this.scene.start('GameScene');
    });
}

createShipHUD() {
    const BAR_W = 80;
    const BAR_H = 6;
    const BAR_X = this.scale.width - 12 - BAR_W;
    const BAR_Y = 16;

    this.add.text(BAR_X, BAR_Y - 8, 'ENERGY', {
        fontFamily: 'monospace', fontSize: '6px', fill: '#aaffcc'
    }).setScrollFactor(0).setDepth(100);

    const bg = this.add.graphics();
    bg.fillStyle(0x222233, 1);
    bg.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);
    bg.setScrollFactor(0).setDepth(100);

    this.energyBarFill = this.add.graphics();
    this.energyBarFill.setScrollFactor(0).setDepth(101);

    // Stash geometry so updateShipHUD doesn't need to recompute it.
    this._hudBar = { x: BAR_X, y: BAR_Y, w: BAR_W, h: BAR_H };

    this.updateShipHUD();
}

updateShipHUD() {
    if (!this.energyBarFill) { return; }
    const pct = Math.max(0, state.playerEnergy / PLAYER_MAX_ENERGY);

    let colour;
    if      (pct > 0.5)  { colour = 0x00dd55; }
    else if (pct > 0.25) { colour = 0xffcc00; }
    else                 { colour = 0xff2244; }

    const b = this._hudBar;
    this.energyBarFill.clear();
    this.energyBarFill.fillStyle(colour, 1);
    this.energyBarFill.fillRect(b.x, b.y, Math.round(b.w * pct), b.h);
}

applyDamageToShip(damage) {
    if (state.playerInvincible || state.gameOver) { return; }

    state.playerEnergy = Math.max(0, state.playerEnergy - damage);
    this.updateShipHUD();

    if (state.playerEnergy <= 0) {
        this.triggerShipGameOver();
        return;
    }

    // Hit-flash + brief invincibility.
    state.playerInvincible = true;
    this.tweens.add({
        targets:    this.ship,
        alpha:      0.3,
        duration:   100,
        yoyo:       true,
        repeat:     5,
        onComplete: () => { this.ship.setAlpha(1); },
    });
    this.time.delayedCall(INVINCIBILITY_MS, () => {
        state.playerInvincible = false;
    });
}

triggerShipGameOver() {
    state.gameOver = true;
    this.tweens.killTweensOf(this.ship);
    this.ship.body.setVelocity(0, 0);
    this.ship.setAlpha(0.3);

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add.rectangle(cx, cy, 220, 44, 0x000000, 0.75)
    .setScrollFactor(0).setDepth(200);
    this.add.text(cx, cy, 'SHIP DESTROYED', {
        fontFamily: 'monospace', fontSize: '13px',
        fill: '#ff3344', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    this.cameras.main.fadeOut(1500, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('EndScene', { result: 'lost' });
    });
}

}
