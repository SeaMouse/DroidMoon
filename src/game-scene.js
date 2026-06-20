import Phaser from 'phaser';
import { state } from './state.js';
import {
    CAMERA_ZOOM,PLAYER_SPEED, BULLET_COOLDOWN, BULLET_SPEED,
    PLAYER_MAX_ENERGY, INPUT_DEAD_ZONE,
    deckDefinitions, weaponTypes, enemyTypes,
} from './config.js';
import {
    BulletPool, makeCircleTexture,
    Lifts, Debug,
    buildNavGraph, extractWallSegments, extractWallCorners,
    parseLiftZones, updateLiftHold,
    spawnEnemiesForDeck, isDeckCleared,
    applyDeckDim, checkDeckClearance,
    createHUD,
    fireBullet,
    bulletHitEnemy, playerHitByEnemyBullet,
    onPlayerEnemyCollide, onEnemyEnemyCollide,
    updateFogOfWar,
    drawDebugWallSegments, drawDebugRays, drawDebugVisibilityPolygon,
    drawDebugNavStatic, drawDebugNavDynamic,
    drawAimLaser,
    debugLog
} from './systems.js';

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    preload() {
        this.load.image('tiles', 'assets/poc_tiles.png');

        for (const [deckName, def] of Object.entries(deckDefinitions)) {
            this.load.tilemapTiledJSON(def.mapKey, def.mapFile);
        }
    }

    create() {
        state.scene = this;
        state.gameOver = false;
        state.playerEnergy    = (state.playerEnergy > 0) ? state.playerEnergy : PLAYER_MAX_ENERGY;
        state.playerFacing    = 0;
        state.enemies         = [];
        state.playerInvincible = false;
        state.lastShotTime    = 0;
        Lifts.zones      = [];
        Lifts.playerOn   = null;
        Lifts.holdStart  = 0;
        Lifts.inputGated = false;

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
        buildNavGraph(map);
        extractWallSegments();
        extractWallCorners();

        // --- Player texture ---
        makeCircleTexture(this, 'player', 0x00ff99, 32);

        // --- Player spawn ---
        const spawnX = state.playerSpawnPos ? state.playerSpawnPos.x : deckDef.playerStart.x;
        const spawnY = state.playerSpawnPos ? state.playerSpawnPos.y : deckDef.playerStart.y;
        state.playerSpawnPos = null;

        state.player = this.physics.add.sprite(spawnX, spawnY, 'player');
        state.player.setCollideWorldBounds(true);
        this.physics.add.collider(state.player, state.wallLayer);

        // --- Player bullet texture ---
        if (!this.textures.exists('bullet')) {
            const bulletGfx = this.add.graphics();
            bulletGfx.fillStyle(0xffee00, 1);
            bulletGfx.fillCircle(4, 4, 4);
            bulletGfx.generateTexture('bullet', 8, 8);
            bulletGfx.destroy();
        }

        // --- Player bullet pool ---
        state.playerBullets = new BulletPool(this, {
            textureKey:    'bullet',
            defaultSpeed:  BULLET_SPEED,
                defaultDamage: 1,
                    maxSize:       20,
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

        // --- Lift zones ---
        Lifts.zoneGroup = this.physics.add.staticGroup();
        parseLiftZones(map);

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

        // --- HUD ---
        createHUD(this);

        // --- Fog render texture ---
        state.fogRT = this.add.renderTexture(0, 0, mapWidth, mapHeight);
        state.fogRT.setDepth(40);
        state.fogRT.setOrigin(0, 0);

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
        });

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

    update(time) {
        if (state.gameOver) { return; }

        state.player.setVelocity(0);

        const pad = this.input.gamepad.getPad(0);

        if (pad) {
            if (Math.abs(pad.leftStick.x) > INPUT_DEAD_ZONE) { state.player.setVelocityX(pad.leftStick.x * PLAYER_SPEED); }
            if (Math.abs(pad.leftStick.y) > INPUT_DEAD_ZONE) { state.player.setVelocityY(pad.leftStick.y * PLAYER_SPEED); }
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

        if (!isDeckCleared()) {
            const firePressed = state.keys.space.isDown ||
            (pad && pad.buttons[7] && pad.buttons[7].pressed);

            if (firePressed && (lsOut || rsOut) && time > state.lastShotTime + BULLET_COOLDOWN) {
                const aimX = Math.cos(state.playerFacing);
                const aimY = Math.sin(state.playerFacing);
                fireBullet(state.player.x, state.player.y, aimX, aimY);
                state.lastShotTime = time;
            }
        }

        drawAimLaser(rsOut, rsx, rsy);

        updateLiftHold(time, pad);

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
        updateFogOfWar();
        drawDebugNavDynamic();
    }
}
