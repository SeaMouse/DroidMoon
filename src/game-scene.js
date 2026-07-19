import Phaser from 'phaser';
import { state } from './state.js';
import {
    CAMERA_ZOOM,PLAYER_SPEED, BULLET_COOLDOWN, BULLET_SPEED,
    INPUT_DEAD_ZONE,
    deckDefinitions, weaponTypes, enemyTypes,
} from './config.js';
import {
    BulletPool, makeCircleTexture,
    Lifts, Debug,
    buildNavGraph, extractWallSegments, extractWallCorners,
    parseLiftZones, updateLiftHold,
    Doors, resetDoors, parseDoors, updateDoors, pruneNavLinksBlockedByDoors,
    applyUnlockedDoors, parseTerminals, updateTerminalHold,
    spawnEnemiesForDeck,
    applyDeckDim, checkDeckClearance,
    createHUD, createFpsCounter, updateShieldBar, updateHUD, showHudMessage,
    fireBullet,
    bulletHitEnemy, playerHitByEnemyBullet,
    onPlayerEnemyCollide, onEnemyEnemyCollide,
    updateFogOfWar,
    drawDebugWallSegments, drawDebugRays, drawDebugVisibilityPolygon,
    drawDebugNavStatic, drawDebugNavDynamic,
    drawAimLaser,
    debugLog
} from './systems.js';
import { playerWeaponTypes } from './items-config.js';
import {
    getDriveSpeedMultiplier, updateShieldRegen, applyPreset, recomputePowerDerived,
} from './power.js';
import { spawnItemsForDeck, onPlayerItemPickup, Items } from './inventory.js';

// Quick power presets: keys 1-4 / D-pad left, up, right, down.
const PRESET_KEYS = [
    { key: 'one',   padButton: 14, preset: 'combat',   label: 'POWER: COMBAT'   },
    { key: 'two',   padButton: 12, preset: 'balanced', label: 'POWER: BALANCED' },
    { key: 'three', padButton: 15, preset: 'defense',  label: 'POWER: DEFENSE'  },
    { key: 'four',  padButton: 13, preset: 'cruise',   label: 'POWER: CRUISE'   },
];

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    preload() {
        this.load.image('tiles', 'assets/poc_tiles.png');
        this.load.image('door_horiz', 'assets/door_horiz.png');
        this.load.image('door_vert', 'assets/door_vert.png');
        // Player droid is two layers: the chassis (base) and the dome (top).
        // Its emissions — torch cone, aim laser, bullets — draw between them.
        this.load.image('droid_player_base', 'assets/droid_player_base.png');
        this.load.image('droid_player_top', 'assets/droid_player_top.png');

        for (const [deckName, def] of Object.entries(deckDefinitions)) {
            this.load.tilemapTiledJSON(def.mapKey, def.mapFile);
        }
    }

    create() {
        state.scene = this;
        state.wallLayer = null;   // cleared so a missing Obstacles layer is caught below
        state.gameOver = false;
        state.hull            = (state.hull > 0) ? state.hull : state.hullMax;
        state.playerFacing    = 0;
        // Derive weapon stats / shield ceiling from current items + pips
        // before anything (HUD, fire gate) reads them.
        recomputePowerDerived();
        state.enemies         = [];
        state.playerInvincible = false;
        state.lastShotTime    = 0;
        Lifts.zones      = [];
        Lifts.playerOn   = null;
        Lifts.holdStart  = 0;
        Lifts.inputGated = false;
        // Must clear before buildNavGraph — stale door segments from the
        // previous deck would block waypoint linking via hasLineOfSight.
        resetDoors();

        const deckDef = deckDefinitions[state.currentDeck];
        if (!deckDef) {
            console.error('No deck definition for "' + state.currentDeck + '"');
            return;
        }

        // --- Tilemap ---
        const map      = this.make.tilemap({ key: deckDef.mapKey });
        const tileset  = map.addTilesetImage('tiles', 'tiles');
        for (const layerData of map.layers) {
            const layer = map.createLayer(layerData.name, tileset, 0, 0);
            if (!layer) { continue; }
            if (layerData.name === 'Obstacles') {
                state.wallLayer = layer;
                layer.setCollisionByProperty({ obstacle: true });
            }
        }

        if (!state.wallLayer) {
            console.error('GameScene: map "' + deckDef.mapKey + '" has no "Obstacles" tile layer — ' +
                'collision, nav graph and line-of-sight all depend on it. Check the layer name in Tiled.');
            return;
        }

        buildNavGraph(map);
        extractWallSegments();
        extractWallCorners();

        // --- Player spawn ---
        const spawnX = state.playerSpawnPos ? state.playerSpawnPos.x : deckDef.playerStart.x;
        const spawnY = state.playerSpawnPos ? state.playerSpawnPos.y : deckDef.playerStart.y;
        state.playerSpawnPos = null;

        // The chassis is the physics body and sits below the emission layer
        // (fog cone 40, aim laser 45, player bullets 42). The dome cap draws
        // above all of them so the beam/laser/bullets read as coming out from
        // under the top of the droid.
        state.player = this.physics.add.sprite(spawnX, spawnY, 'droid_player_base');
        state.player.setDepth(10);
        state.player.setCollideWorldBounds(true);
        this.physics.add.collider(state.player, state.wallLayer);

        // Origin (0,0) + integer offsets from the player centre (set every
        // frame in postUpdateVisuals): the cap's edges then carry the same
        // sub-pixel fraction as the 32×32 base, so roundPixels rounds both
        // identically and the cap can't wiggle against the chassis. With the
        // default centre origin the 20×19 texture puts an edge on a half-pixel,
        // which rounds inconsistently as the lerped camera scroll drifts —
        // the same bug the door art had.
        state.playerTop = this.add.image(spawnX, spawnY, 'droid_player_top');
        state.playerTop.setOrigin(0, 0);
        state.playerTop.setDepth(46);

        // --- Player bullet textures (one per equippable weapon) ---
        for (const def of Object.values(playerWeaponTypes)) {
            makeCircleTexture(this, def.textureKey, def.colour, 8);
        }

        // --- Player bullet pool ---
        // Depth 42: above the fog (40) so shots read over the lit floor, below
        // the dome cap (46) so they emerge from under the top of the droid.
        state.playerBullets = new BulletPool(this, {
            textureKey:    'bullet',
            defaultSpeed:  BULLET_SPEED,
                defaultDamage: 1,
                    maxSize:       20,
                    depth:         42,
        });
        this.physics.add.collider(state.playerBullets.group, state.wallLayer, (bullet) => {
            state.playerBullets.deactivate(bullet);
        });

        // --- Enemy bullet textures ---
        for (const [weaponKey, weaponDef] of Object.entries(weaponTypes)) {
            makeCircleTexture(this, 'ebullet_' + weaponKey, weaponDef.colour, 8);
        }

        // --- Enemy bullet pool ---
        state.enemyBullets = new BulletPool(this, {
            textureKey:    'ebullet_blaster',
            defaultSpeed:  weaponTypes.blaster.bulletSpeed,
                defaultDamage: weaponTypes.blaster.damage,
                    maxSize:       60,
        });
        this.physics.add.collider(state.enemyBullets.group, state.wallLayer, (bullet) => {
            state.enemyBullets.deactivate(bullet);
        });
        this.physics.add.overlap(state.player, state.enemyBullets.group, playerHitByEnemyBullet);

        // --- Enemy sprite textures ---
        for (const [typeKey, typeDef] of Object.entries(enemyTypes)) {
            makeCircleTexture(this, typeKey, typeDef.colour, 32);
        }

        // --- Enemy group ---
        state.enemyGroup = this.physics.add.group();

        // --- Spawn enemies ---
        spawnEnemiesForDeck(state.currentDeck);

        // --- Player-enemy collisions ---
        this.physics.add.collider(state.player, state.enemyGroup, onPlayerEnemyCollide);
        this.physics.add.collider(state.enemyGroup, state.enemyGroup, onEnemyEnemyCollide);
        this.physics.add.overlap(state.playerBullets.group, state.enemyGroup, bulletHitEnemy);

        // --- Doors ---
        // Parsed after the nav graph so waypoint links form through (closed)
        // doorways, and after player/enemies so the initial sync can run.
        parseDoors(map);
        // Unlock code-doors the player already has keys/overrides for BEFORE
        // pruning nav links, so enemies can still path through them.
        applyUnlockedDoors();
        pruneNavLinksBlockedByDoors();
        if (Doors.blockGroup) {
            // Bullets always collide with door slabs...
            this.physics.add.collider(state.playerBullets.group, Doors.blockGroup, (bullet) => {
                state.playerBullets.deactivate(bullet);
            });
            this.physics.add.collider(state.enemyBullets.group, Doors.blockGroup, (bullet) => {
                state.enemyBullets.deactivate(bullet);
            });
            // ...but bodies only stop the player/enemies when a door is locked;
            // unlocked doors open before anyone reaches them.
            this.physics.add.collider(state.player, Doors.solidGroup);
            this.physics.add.collider(state.enemyGroup, Doors.solidGroup);
        }

        // --- Lift zones ---
        Lifts.zoneGroup = this.physics.add.staticGroup();
        parseLiftZones(map);

        // --- Computer terminals ---
        parseTerminals(map);

        // --- Item pickups ---
        spawnItemsForDeck(map, state.currentDeck);
        this.physics.add.overlap(state.player, Items.group, onPlayerItemPickup);

        // --- Arrival snap ---
        if (state.lastDeck) {
            const arrivalLift = Lifts.zones.find(lift => lift.decks.includes(state.lastDeck));
            if (arrivalLift) {
                state.player.setPosition(arrivalLift.x, arrivalLift.y);
                Lifts.inputGated = true;
                debugLog('LIFTS: Arrived on ' + state.currentDeck +
                ' at lift connecting to ' + state.lastDeck + '.');
            } else {
                console.warn('LIFTS: No lift on ' + state.currentDeck +
                ' connects back to ' + state.lastDeck +
                ' — falling back to default spawn.');
            }
            state.lastDeck = null;
        }

        // --- Lift progress bar ---
        Lifts.progressBg = this.add.graphics();
        Lifts.progressBg.setScrollFactor(0).setDepth(52).setVisible(false);
        Lifts.progressFill = this.add.graphics();
        Lifts.progressFill.setScrollFactor(0).setDepth(53).setVisible(false);

        // --- Camera ---
        const mapWidth  = map.widthInPixels;
        const mapHeight = map.heightInPixels;
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
        this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
        this.cameras.main.startFollow(state.player, true, 0.08, 0.08);
        this.cameras.main.setZoom(CAMERA_ZOOM);

        // --- Aim laser ---
        state.aimLaser = this.add.graphics();
        state.aimLaser.setDepth(45);
        // Additive blend so the glow+core passes in drawAimLaser sum into a
        // light-like beam instead of stacking as opaque red paint.
        state.aimLaser.setBlendMode(Phaser.BlendModes.ADD);

        // --- HUD ---
        createHUD(this);
        createFpsCounter(this);

        // --- Fog render texture ---
        state.fogRT = this.add.renderTexture(0, 0, mapWidth, mapHeight);
        state.fogRT.setDepth(40);
        state.fogRT.setOrigin(0, 0);
        // Flush queued draw commands inside the RT's own render pass (frame-
        // atomic) rather than via a manual render() call from update().
        state.fogRT.setRenderMode('all');

        // Persistent erase brushes for the fog light bands — reused every frame
        // by updateFogOfWar instead of allocating/destroying Graphics per frame.
        // Never added to the display list, so they must be destroyed by hand.
        state.fogEraseGfx = [
            this.make.graphics({ x: 0, y: 0 }, false),
            this.make.graphics({ x: 0, y: 0 }, false),
            this.make.graphics({ x: 0, y: 0 }, false),
        ];

        // Aim input captured in update(), consumed by the POST_UPDATE pass.
        this.aimInput = { out: false, x: 0, y: 0 };

        // Player-anchored visuals (fog cone, aim laser) are drawn on
        // POST_UPDATE — after arcade physics syncs body → sprite — so they
        // use this frame's rendered player position, not last frame's.
        // (Same fix as Level1's composeShadow; reading player.x in update()
        // is one physics step stale and shimmers on non-60Hz displays.)
        this.events.on('postupdate', this.postUpdateVisuals, this);

        this.events.once('shutdown', () => {
            this.events.off('postupdate', this.postUpdateVisuals, this);
            for (const gfx of state.fogEraseGfx) { gfx.destroy(); }
            state.fogEraseGfx = [];
        });

        // --- Cached keyboard keys ---
        state.keys = this.input.keyboard.addKeys({
            f:     'F',
            space: 'SPACE',
            up:    'UP',
            down:  'DOWN',
            enter: 'ENTER',
            esc:   'ESC',
            f1:    'F1',
            f2:    'F2',
            f3:    'F3',
            f4:    'F4',
            i:     'I',
            tab:   'TAB',
            one:   'ONE',
            two:   'TWO',
            three: 'THREE',
            four:  'FOUR',
        });
        // Without a capture, TAB moves browser focus off the canvas.
        this.input.keyboard.addCapture('TAB');

        // Edge-detect state for pad buttons the update loop polls directly
        // (button 8 = Select toggles the inventory; D-pad = power presets).
        this.invTogglePrev = false;
        this.padPresetPrev = {};

        // --- Debug overlays ---
        Debug.nav = this.add.graphics();
        Debug.nav.setDepth(50);
        drawDebugNavStatic();
        drawDebugWallSegments();
        Debug.rays = this.add.graphics();
        Debug.rays.setDepth(48);
        Debug.rays.setVisible(false);
        Debug.vis = this.add.graphics();
        Debug.vis.setDepth(47);
        Debug.vis.setVisible(false);

        // --- Re-apply shutdown dim if this deck was already cleared ---
        if (state.deckStates[state.currentDeck] && state.deckStates[state.currentDeck].cleared) {
            applyDeckDim();
        }
    }

    update(time, delta) {
        if (state.gameOver) { return; }

        state.player.setVelocity(0);

        const pad = this.input.gamepad.getPad(0);

        // --- Inventory toggle (I / TAB / pad Select) ---
        const invPadDown = !!(pad && pad.buttons[8] && pad.buttons[8].pressed);
        const invPressed = Phaser.Input.Keyboard.JustDown(state.keys.i) ||
                           Phaser.Input.Keyboard.JustDown(state.keys.tab) ||
                           (invPadDown && !this.invTogglePrev);
        this.invTogglePrev = invPadDown;
        if (invPressed) {
            this.scene.pause();
            this.scene.launch('InventoryScene');
            return;
        }

        // --- Quick power presets (1-4 / D-pad) ---
        for (const p of PRESET_KEYS) {
            const padDown = !!(pad && pad.buttons[p.padButton] && pad.buttons[p.padButton].pressed);
            const pressed = Phaser.Input.Keyboard.JustDown(state.keys[p.key]) ||
                            (padDown && !this.padPresetPrev[p.padButton]);
            this.padPresetPrev[p.padButton] = padDown;
            if (pressed && applyPreset(p.preset)) {
                updateHUD();
                showHudMessage(p.label, '#88ccff');
            }
        }

        const moveSpeed = PLAYER_SPEED * getDriveSpeedMultiplier();
        if (pad) {
            if (Math.abs(pad.leftStick.x) > INPUT_DEAD_ZONE) { state.player.setVelocityX(pad.leftStick.x * moveSpeed); }
            if (Math.abs(pad.leftStick.y) > INPUT_DEAD_ZONE) { state.player.setVelocityY(pad.leftStick.y * moveSpeed); }
        }

        let rsx = 0, rsy = 0;
        if (pad) {
            rsx = pad.rightStick.x;
            rsy = pad.rightStick.y;
        }
        const rsOut = Math.abs(rsx) > INPUT_DEAD_ZONE || Math.abs(rsy) > INPUT_DEAD_ZONE;
        const lsOut = pad && (Math.abs(pad.leftStick.x) > INPUT_DEAD_ZONE || Math.abs(pad.leftStick.y) > INPUT_DEAD_ZONE);

        if (rsOut) {
            state.playerFacing = Math.atan2(rsy, rsx);
        } else if (lsOut) {
            state.playerFacing = Math.atan2(pad.leftStick.y, pad.leftStick.x);
        }

        const firePressed = state.keys.space.isDown ||
            (pad && pad.buttons[7] && pad.buttons[7].pressed);

        const fireCooldown = state.currentWeaponStats ? state.currentWeaponStats.cooldown : BULLET_COOLDOWN;
        if (firePressed && (lsOut || rsOut) && time > state.lastShotTime + fireCooldown) {
            const aimX = Math.cos(state.playerFacing);
            const aimY = Math.sin(state.playerFacing);
            fireBullet(state.player.x, state.player.y, aimX, aimY);
            state.lastShotTime = time;
        }

        this.aimInput.out = rsOut;
        this.aimInput.x   = rsx;
        this.aimInput.y   = rsy;

        updateLiftHold(time, pad);
        updateTerminalHold(time, pad);

        // --- Shield regeneration (redraws only the shield bar) ---
        if (updateShieldRegen(delta)) { updateShieldBar(); }

        // Before the enemy loop so their LOS checks see this frame's slabs.
        updateDoors(delta);

        for (const enemy of state.enemies) {
            enemy.update(time);
        }

        if (Phaser.Input.Keyboard.JustDown(state.keys.f1)) {
            const visible = !Debug.nav.visible;
            Debug.nav.setVisible(visible);
            Debug.navStatic.setVisible(visible);
            Debug.nodeLabels.forEach(label => label.setVisible(visible));
        }
        if (Phaser.Input.Keyboard.JustDown(state.keys.f2)) {
            Debug.walls.setVisible(!Debug.walls.visible);
        }
        if (Phaser.Input.Keyboard.JustDown(state.keys.f3)) {
            Debug.rays.setVisible(!Debug.rays.visible);
        }
        if (Phaser.Input.Keyboard.JustDown(state.keys.f4)) {
            Debug.vis.setVisible(!Debug.vis.visible);
        }
        if (Debug.vis.visible) {
            drawDebugVisibilityPolygon();
        }
        if (Debug.rays.visible) {
            drawDebugRays();
        }
        drawDebugNavDynamic();
    }

    // Runs on the scene's POST_UPDATE event — player sprite is synced to its
    // physics body by then, so these draw at the rendered position.
    postUpdateVisuals() {
        if (state.gameOver || !state.player) { return; }
        // Keep the dome cap on the chassis, mirroring any alpha change (the
        // invincibility flash and game-over fade tween state.player).
        if (state.playerTop) {
            state.playerTop.setPosition(
                state.player.x - Math.floor(state.playerTop.width / 2),
                state.player.y - Math.floor(state.playerTop.height / 2)
            );
            state.playerTop.setAlpha(state.player.alpha);
        }
        drawAimLaser(this.aimInput.out, this.aimInput.x, this.aimInput.y);
        updateFogOfWar();
    }
}
