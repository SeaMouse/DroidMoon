import Phaser from 'phaser';
import { state, resetGameState } from '../state.js';
import { PLAYER_MAX_ENERGY, INVINCIBILITY_MS } from '../config.js';
import { Turret } from '../turret.js';
import { BulletPool } from '../systems.js';
import {
    SHIP_SPEED_LEVELS, SHIP_GEAR_UP_MS, SHIP_GEAR_DOWN_MS,
    SHIP_VERTICAL_SPEED, SHIP_FLIP_DURATION, SHIP_BARREL_ROLL_DURATION,
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

        // Image layer (Starfield) — Phaser reads parallaxx/parallaxy from Tiled.
        map.createLayer('Starfield', tileset, 0, 0);

        // Hull (decorative, no collision).
        this.hullLayer = map.createLayer('Hull', tileset, 0, 0);

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

        // --- Ship texture  ---
        this.ship = this.physics.add.sprite(spawnX, spawnY, 'manta_flip_start', 0);

        // Cast shadow: a duplicate of the ship, tinted black and offset, masked to the hull.
        this.shipShadow = this.add.sprite(this.ship.x, this.ship.y, this.ship.texture.key, this.ship.frame.name);
        this.shipShadow.setTint(0x000000);
        this.shipShadow.setAlpha(SHIP_SHADOW_ALPHA);

        // Render above the tile layers (default depth 0) but below the ship.
        this.shipShadow.setDepth(10);
        this.ship.setDepth(11);

        // Mask the shadow to the hull's footprint so it never spills onto the starfield.
        this.shipShadow.enableFilters();
        this.shipShadow.filters.external.addMask(this.hullLayer, false, this.cameras.main, 'world');

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

        // ─── CHANGED ───
        this.cameras.main.startFollow(this.ship, true, 1, 1);

        this.cursors = this.input.keyboard.createCursorKeys();

        this.debugText = this.add.text(8, 8, '', {
            fontFamily: 'monospace', fontSize: '12px',
            fill: '#aaffcc',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 }
        }).setScrollFactor(0).setDepth(100);

        this.createShipHUD();
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
                    if (this.shipGear > 0) {
                        this.shipGear--;
                        this.shipGearShiftTimer = 0;
                    } else {
                        this.shipGearShiftTimer = 0;
                        this.startFlip();
                    }
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

        // Keep the shadow in lockstep with the ship.
        this.shipShadow.setTexture(this.ship.texture.key, this.ship.frame.name);
        this.shipShadow.setFlipX(this.ship.flipX);
        this.shipShadow.setRotation(this.ship.rotation);
        this.shipShadow.x = this.ship.x + SHIP_SHADOW_OFFSET_X;
        this.shipShadow.y = this.ship.y + SHIP_SHADOW_OFFSET_Y;

        // --- Twin laser fire ---
        const firing = this.shipFlipPhase !== 'yaw' && (
            this.cursors.space.isDown ||
            (pad && pad.buttons[7] && pad.buttons[7].value > 0.5)
        );
        if (firing && time - this.lastShotTime >= SHIP_BULLET_COOLDOWN_MS) {
            this.lastShotTime = time;
            const sx = this.ship.x + LASER_EMITTER_X_OFFSET * this.shipFacing;

            // Gun separation shrinks with the cosine of the roll angle.
            // During roll, angle goes from π (upside-down) at progress 0 to 0 (upright) at progress 1.
            // Outside roll, ship is upright so multiplier is just 1.
            const rollAngle = (this.shipFlipPhase === 'roll')
            ? (1 - this.shipFlipProgress) * Math.PI
            : 0;
            const dy = LASER_EMITTER_Y_OFFSET * Math.cos(rollAngle);

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

createShipHUD() {
    const BAR_W = 120;
    const BAR_H = 8;
    const BAR_X = 800 - 12 - BAR_W;   // 12px in from the right edge
    const BAR_Y = 24;

    this.add.text(BAR_X, BAR_Y - 12, 'ENERGY', {
        fontFamily: 'monospace', fontSize: '10px', fill: '#aaffcc'
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

    this.add.rectangle(400, 300, 460, 90, 0x000000, 0.75)
    .setScrollFactor(0).setDepth(200);
    this.add.text(400, 300, 'SHIP DESTROYED', {
        fontFamily: 'monospace', fontSize: '28px',
        fill: '#ff3344', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    this.cameras.main.fadeOut(1500, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('EndScene', { result: 'lost' });
    });
}

}
