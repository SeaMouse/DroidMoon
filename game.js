// ─────────────────────────────────────────────
//  SCENE: TITLE
// ─────────────────────────────────────────────
const titleScene = {
    key: 'TitleScene',
    create: function() {
        // Fresh state every time we land on the title
        resetGameState();

        this.add.rectangle(0, 0, 800, 600, 0x0a0a18).setOrigin(0);

        this.add.text(400, 150, 'DECK RUNNER', {
            fontFamily: 'monospace', fontSize: '56px',
            fill: '#44ffaa', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5);

        this.add.text(400, 210, '— a Paradroid-style POC —', {
            fontFamily: 'monospace', fontSize: '14px', fill: '#88bbdd'
        }).setOrigin(0.5);

        this.add.text(400, 300, 'Clear every deck of hostile droids.', {
            fontFamily: 'monospace', fontSize: '16px', fill: '#ffffff'
        }).setOrigin(0.5);
        this.add.text(400, 330, 'Use lifts to move between decks.', {
            fontFamily: 'monospace', fontSize: '16px', fill: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(400, 410, 'Move:          Left stick', {
            fontFamily: 'monospace', fontSize: '12px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(400, 430, 'Aim & Fire:    Right stick', {
            fontFamily: 'monospace', fontSize: '12px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(400, 450, 'Lift activate: Hold F or right stick while on a lift', {
            fontFamily: 'monospace', fontSize: '12px', fill: '#aaaacc'
        }).setOrigin(0.5);

        const prompt = this.add.text(400, 530, 'Press any key or button to begin', {
            fontFamily: 'monospace', fontSize: '20px', fill: '#ffee00'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt, alpha: 0.35,
            duration: 700, yoyo: true, repeat: -1
        });

        this.input.keyboard.once('keydown', () => this.scene.start('GameScene'));
        this._padStarted = false;
    },
    update: function() {
        if (this._padStarted) { return; }
        const pad = this.input.gamepad.getPad(0);
        if (!pad) { return; }
        for (const btn of pad.buttons) {
            if (btn && btn.pressed) {
                this._padStarted = true;
                this.scene.start('GameScene');
                return;
            }
        }
    }
};

// ─────────────────────────────────────────────
//  SCENE: GAMEPLAY  (wraps your existing preload/create/update)
// ─────────────────────────────────────────────
const gameScene = {
    key: 'GameScene',
    preload: preload,
    create:  create,
    update:  update
};

// ─────────────────────────────────────────────
//  SCENE: END  (handles both win and lose)
// ─────────────────────────────────────────────
const endScene = {
    key: 'EndScene',
    init: function(data) {
        this.result = (data && data.result) ? data.result : 'lost';
    },
    create: function() {
        const won = (this.result === 'won');

        this.add.rectangle(0, 0, 800, 600,
                           won ? 0x0a1a10 : 0x1a0a0a).setOrigin(0);

                           this.add.text(400, 200, won ? 'SHIP CLEARED' : 'GAME OVER', {
                               fontFamily: 'monospace', fontSize: '64px',
                               fill: won ? '#44ff88' : '#ff3344',
                               stroke: '#000000', strokeThickness: 4
                           }).setOrigin(0.5);

                           const msg = won
                           ? 'Every deck is quiet. Every droid is scrap.'
                           : 'The droids won this round.';
                           this.add.text(400, 290, msg, {
                               fontFamily: 'monospace', fontSize: '16px', fill: '#ffffff'
                           }).setOrigin(0.5);

                           this.add.text(400, 340, 'Droids destroyed: ' + killCount, {
                               fontFamily: 'monospace', fontSize: '14px', fill: '#aaaacc'
                           }).setOrigin(0.5);

                           const prompt = this.add.text(400, 460, 'Press any key or button to return to title', {
                               fontFamily: 'monospace', fontSize: '16px', fill: '#ffee00'
                           }).setOrigin(0.5);

                           this.tweens.add({
                               targets: prompt, alpha: 0.35,
                               duration: 700, yoyo: true, repeat: -1
                           });

                           // Brief input lockout so a held button doesn't instantly skip the screen
                           this._ready = false;
                           this.time.delayedCall(600, () => {
                               this._ready = true;
                               this.input.keyboard.once('keydown', () => this.scene.start('TitleScene'));
                           });
                           this._padAdvanced = false;
    },
    update: function() {
        if (!this._ready || this._padAdvanced) { return; }
        const pad = this.input.gamepad.getPad(0);
        if (!pad) { return; }
        for (const btn of pad.buttons) {
            if (btn && btn.pressed) {
                this._padAdvanced = true;
                this.scene.start('TitleScene');
                return;
            }
        }
    }
};

// ─────────────────────────────────────────────
//  GAME CONFIG
// ─────────────────────────────────────────────
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#1a1a2e',
    pixelArt: true,
    physics: {
        default: 'arcade',
            arcade: { debug: false }
    },
    input: {
        gamepad: true
    },
    scene: [titleScene, gameScene, endScene]
};

const game = new Phaser.Game(config);

let debugGraphics;
let f1Key;

let player;
let wallLayer;
let enemies = [];
let navNodes = [];  // [{id, x, y, neighbours:[ids]}]

let wallSegments = [];   // [{x1, y1, x2, y2}] — exposed wall edges for raycasting
let wallCorners = [];
let fogRT;
const FOG_DARKNESS = 0.85;   // 0 = no fog, 1 = pitch black
const FOG_COLOUR   = 0x000011;
const LIGHT_MAX_RANGE = 550;   // pixels — tweak to taste
let playerFacing = 0;   // angle in radians (0 = right, PI/2 = down)
const CONE_HALF_ANGLE = Math.PI / 5;   // 36° each side → ~72° cone

let f2Key;
let f3Key;
let f4Key;

let bullets;          // player bullets
let enemyBullets;     // enemy bullets — separate group so overlaps are unambiguous
let enemyGroup;
let rightStickReset = true;
let scene;

// --- HUD ---
let energyBarFill;
let killText;
let killCount = 0;
const ENERGY_BAR_WIDTH  = 150;
const ENERGY_BAR_HEIGHT = 14;
let deckLabel;   // shows current deck name on HUD

// --- Player energy ---
let playerEnergy;
const PLAYER_MAX_ENERGY = 100;
let playerInvincible    = false;
const INVINCIBILITY_MS  = 1200;

// --- Game state ---
let gameOver = false;
let gameOverText;
let restartText;

const TILE_SIZE       = 32;
const PLAYER_SPEED    = 200;
const PLAYER_WEIGHT   = 2;
const BULLET_SPEED    = 400;
const BULLET_COOLDOWN = 200;

const NODE_CONNECT_DIST     = 250;   // px — max distance to auto-link two nodes
const WANDER_BACKTRACK_CHANCE = 0.05; // odds of returning to previous node

let lastShotTime = 0;

// ─────────────────────────────────────────────
//  MULTI-DECK SYSTEM
// ─────────────────────────────────────────────
// currentDeck  – which deck is active right now
// deckStates   – saved enemy snapshots, keyed by deck name
// playerSpawnPos – where to place the player on the next create()
//
// These three variables live outside the scene so they survive
// scene.restart() calls.
// ─────────────────────────────────────────────

let currentDeck    = 'deck1';           // starting deck
let deckStates     = {};                // persisted between deck switches
let playerSpawnPos = null;              // set before switching; null = use default

// ─────────────────────────────────────────────
//  DECK DEFINITIONS
// ─────────────────────────────────────────────
// Each deck has its own Tiled map and a fresh set of enemy placements.
// The mapKey must match the key used in preload().
//
// To add a new deck:
//   1. Create the .tmj in Tiled (same tileset, include a Waypoints layer
//      and a Lifts object layer — see LIFT SYSTEM notes below).
//   2. Add an entry here.
//   3. The preload loop picks it up automatically.
//
const deckDefinitions = {
    deck1: {
        mapKey:      'level1',
        mapFile:     'assets/level1.tmj',
        label:       'Deck 1 - Bridge',
        playerStart: { x: 82, y: 82 },
        enemies: [
            { type: 'cleaner',        startTile: {x: 4,  y: 2}  },
            { type: 'cleaner',        startTile: {x: 4,  y: 17} },
            { type: 'patrol_drone',   startTile: {x: 12, y: 8}  },
            { type: 'security_light', startTile: {x: 1,  y: 10} },
        ],
    },
    deck2: {
        mapKey:      'level2',
        mapFile:     'assets/level2.tmj',
        label:       'Deck 2 - Engineering',
        playerStart: { x: 82, y: 82 },
        enemies: [
            { type: 'cleaner',         startTile: {x: 6,  y: 4}  },
            { type: 'patrol_drone',    startTile: {x: 10, y: 10} },
            { type: 'patrol_drone',    startTile: {x: 3,  y: 14} },
            { type: 'security_light',  startTile: {x: 14, y: 6}  },
            { type: 'security_heavy',  startTile: {x: 8,  y: 16} },
        ],
    },
    deck3: {
        mapKey:      'level3',
        mapFile:     'assets/level3.tmj',
        label:       'Deck 3 - Cargo Bay',
        playerStart: { x: 82, y: 82 },
        enemies: [
            { type: 'cleaner',         startTile: {x: 5,  y: 5}  },
            { type: 'security_light',  startTile: {x: 8,  y: 12} },
            { type: 'security_light',  startTile: {x: 16, y: 3}  },
            { type: 'security_heavy',  startTile: {x: 11, y: 15} },
            { type: 'security_heavy',  startTile: {x: 2,  y: 8}  },
        ],
    },
};

// ─────────────────────────────────────────────
//  LIFT SYSTEM
// ─────────────────────────────────────────────
// In each Tiled map, create an object layer called "Lifts".
// Place rectangle objects wherever a lift should appear.
// Each lift object needs a custom string property called "decks"
// containing a comma-separated list of deck names the lift
// connects to, e.g.:   decks = "deck1,deck2,deck3"
//
// The player holds the right stick (or the F key) for 2 seconds
// while overlapping a lift to open the deck selection screen.
// ─────────────────────────────────────────────

let liftZones       = [];     // [{sprite, decks:[string]}]
let liftZoneGroup;            // physics group for overlap detection
let playerOnLift    = null;   // the lift data object if overlapping, else null
let liftHoldStart   = 0;      // timestamp when hold began (0 = not holding)
let liftProgressBg  = null;   // visual feedback — background bar
let liftProgressFill = null;  // visual feedback — fill bar
const LIFT_HOLD_MS  = 2000;   // hold duration to activate

// --- Deck selection screen ---
let deckSelectionActive = false;
let deckSelectionItems  = [];  // [{text, deckName}]
let deckSelectionIndex  = 0;
let deckSelectBg;
let deckSelectTitle;
let deckSelectHint;
let dpadPrevY           = 0;  // for gamepad d-pad edge detection
let confirmButtonPrev   = false;
let cancelButtonPrev    = false;

// ─────────────────────────────────────────────
//  WEAPON TYPE CATALOGUE
// ─────────────────────────────────────────────
const weaponTypes = {
    blaster: {
        cooldown:    1500,
        bulletSpeed: 350,
        damage:      20,
        colour:      0xff4444,
    },
    heavy_blaster: {
        cooldown:    2800,
        bulletSpeed: 280,
        damage:      35,
        colour:      0xff00ff,
    },
};

// ─────────────────────────────────────────────
//  ENEMY TYPE CATALOGUE
// ─────────────────────────────────────────────
const enemyTypes = {
    cleaner: {
        label:         'Cleaning Bot',
        colour:        0x88ccff,
        speed:         55,
        detectRange:   0,
        hp:            1,
        contactDamage: 5,
        weaponType:    null,
        weight:        2,
    },
    patrol_drone: {
        label:         'Patrol Drone',
        colour:        0xff8800,
        speed:         100,
        detectRange:   0,
        hp:            2,
        contactDamage: 10,
        weaponType:    null,
        weight:        3,
    },
    security_light: {
        label:         'Security Droid (Light)',
        colour:        0xff3300,
        speed:         120,
        detectRange:   220,
        hp:            2,
        contactDamage: 15,
        weaponType:    'blaster',
        weight:        5,
    },
    security_heavy: {
        label:         'Security Droid (Heavy)',
        colour:        0xcc00ff,
        speed:         75,
        detectRange:   260,
        hp:            4,
        contactDamage: 25,
        weaponType:    'heavy_blaster',
        weight:        8,
    },
};

// ─────────────────────────────────────────────
//  PRELOAD
// ─────────────────────────────────────────────
function preload() {
    // Load the shared tileset (all decks use the same one for now)
    this.load.image('tiles', 'assets/poc_tiles.png');

    // Load every deck map listed in deckDefinitions
    for (const [deckName, def] of Object.entries(deckDefinitions)) {
        this.load.tilemapTiledJSON(def.mapKey, def.mapFile);
    }
}

// ─────────────────────────────────────────────
//  CREATE
// ─────────────────────────────────────────────
function create() {
    scene = this;
    gameOver = false;
    playerEnergy    = (playerEnergy > 0) ? playerEnergy : PLAYER_MAX_ENERGY;
    playerFacing = 0;
    enemies         = [];
    playerInvincible = false;
    lastShotTime     = 0;
    rightStickReset  = true;
    liftZones        = [];
    playerOnLift     = null;
    liftHoldStart    = 0;
    deckSelectionActive = false;
    deckSelectionItems  = [];
    deckSelectionIndex  = 0;
    dpadPrevY        = 0;
    confirmButtonPrev = false;
    cancelButtonPrev  = false;

    const deckDef = deckDefinitions[currentDeck];
    if (!deckDef) {
        console.error('No deck definition for "' + currentDeck + '"');
        return;
    }

    // --- Tilemap ---
    const map      = this.make.tilemap({ key: deckDef.mapKey });
    const tileset  = map.addTilesetImage('tiles', 'tiles');
    wallLayer      = map.createLayer('Tile Layer 1', tileset, 0, 0);
    wallLayer.setCollision(1);
    buildNavGraph(map);
    extractWallSegments();
    extractWallCorners();

    // --- Player texture (only generate once) ---
    if (!this.textures.exists('player')) {
        const playerGfx = this.add.graphics();
        playerGfx.fillStyle(0x00ff99, 1);
        playerGfx.fillCircle(16, 16, 16);
        playerGfx.generateTexture('player', 32, 32);
        playerGfx.destroy();
    }

    // --- Player spawn position ---
    const spawnX = playerSpawnPos ? playerSpawnPos.x : deckDef.playerStart.x;
    const spawnY = playerSpawnPos ? playerSpawnPos.y : deckDef.playerStart.y;
    playerSpawnPos = null;   // consumed — reset for next time

    player = this.physics.add.sprite(spawnX, spawnY, 'player');
    player.setCollideWorldBounds(true);
    this.physics.add.collider(player, wallLayer);

    // --- Player bullet texture ---
    if (!this.textures.exists('bullet')) {
        const bulletGfx = this.add.graphics();
        bulletGfx.fillStyle(0xffee00, 1);
        bulletGfx.fillCircle(4, 4, 4);
        bulletGfx.generateTexture('bullet', 8, 8);
        bulletGfx.destroy();
    }

    // --- Player bullet group ---
    bullets = this.physics.add.group({
        defaultKey: 'bullet',
            maxSize:    20,
    });
    this.physics.add.collider(bullets, wallLayer, bulletHitWall);

    // --- Enemy bullet textures ---
    for (const [weaponKey, weaponDef] of Object.entries(weaponTypes)) {
        const texKey = 'ebullet_' + weaponKey;
        if (!this.textures.exists(texKey)) {
            const gfx = this.add.graphics();
            gfx.fillStyle(weaponDef.colour, 1);
            gfx.fillCircle(4, 4, 4);
            gfx.generateTexture(texKey, 8, 8);
            gfx.destroy();
        }
    }

    // --- Enemy bullet group ---
    enemyBullets = this.physics.add.group({ maxSize: 60 });
    this.physics.add.collider(enemyBullets, wallLayer, enemyBulletHitWall);
    this.physics.add.overlap(player, enemyBullets, playerHitByEnemyBullet);

    // --- Enemy sprite textures ---
    for (const [typeKey, typeDef] of Object.entries(enemyTypes)) {
        if (!this.textures.exists(typeKey)) {
            const gfx = this.add.graphics();
            gfx.fillStyle(typeDef.colour, 1);
            gfx.fillCircle(16, 16, 16);
            gfx.generateTexture(typeKey, 32, 32);
            gfx.destroy();
        }
    }

    // --- Enemy group ---
    enemyGroup = this.physics.add.group();

    // --- Spawn enemies (fresh or restored) ---
    spawnEnemiesForDeck(currentDeck);

    // --- Player-enemy collisions ---
    this.physics.add.collider(player, enemyGroup, onPlayerEnemyCollide);
    this.physics.add.collider(enemyGroup, enemyGroup, onEnemyEnemyCollide);
    this.physics.add.overlap(bullets, enemyGroup, bulletHitEnemy);

    // --- Lift zones ---
    liftZoneGroup = this.physics.add.staticGroup();
    parseLiftZones(map);

    // --- Lift progress bar (hidden until needed) ---
    liftProgressBg = this.add.graphics();
    liftProgressBg.setScrollFactor(0).setDepth(52).setVisible(false);
    liftProgressFill = this.add.graphics();
    liftProgressFill.setScrollFactor(0).setDepth(53).setVisible(false);

    // --- Camera ---
    const mapWidth  = map.widthInPixels;
    const mapHeight = map.heightInPixels;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(player, true, 0.08, 0.08);

    // --- HUD ---
    createHUD(this);

    // --- Dark overlay when Deck is shut down ---
    fogRT = this.add.renderTexture(0, 0, mapWidth, mapHeight);
    fogRT.setDepth(40);          // above gameplay, below HUD (HUD is depth 10-20)
    fogRT.setOrigin(0, 0);       // top-left, so world coords map directly

    // --- Debug nav overlay ---
    f1Key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F1);
    f2Key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F2);
    f3Key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F3);
    f4Key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F4);
    debugGraphics = this.add.graphics();
    debugGraphics.setDepth(50);
    drawDebugNavStatic();
    drawDebugWallSegments();
    scene.debugRayGfx = scene.add.graphics();
    scene.debugRayGfx.setDepth(48);
    scene.debugRayGfx.setVisible(false);
    scene.debugVisGfx = scene.add.graphics();
    scene.debugVisGfx.setDepth(47);
    scene.debugVisGfx.setVisible(false);
    // --- Re-apply shutdown dim if this deck was already cleared ---
    if (deckStates[currentDeck] && deckStates[currentDeck].cleared) {
        applyDeckDim();
    }
}

// ─────────────────────────────────────────────
//  UPDATE  (called every frame)
// ─────────────────────────────────────────────
function update(time) {
    if (gameOver) { return; }

    // --- Deck selection screen has its own input loop ---
    if (deckSelectionActive) {
        updateDeckSelection(time);
        return;
    }

    player.setVelocity(0);

    // --- Player movement ---
    const cursors = this.input.keyboard.createCursorKeys();
    const pad     = this.input.gamepad.getPad(0);
    const DEAD_ZONE = 0.15;

    if (pad) {
        if (Math.abs(pad.leftStick.x) > DEAD_ZONE) { player.setVelocityX(pad.leftStick.x * PLAYER_SPEED); }
        if (Math.abs(pad.leftStick.y) > DEAD_ZONE) { player.setVelocityY(pad.leftStick.y * PLAYER_SPEED); }
    }

    // --- Player aiming and shooting ---
    let rsx = 0, rsy = 0;
    if (pad) {
        rsx = pad.rightStick.x;
        rsy = pad.rightStick.y;
    }
    const rsOut = Math.abs(rsx) > DEAD_ZONE || Math.abs(rsy) > DEAD_ZONE;
    const lsOut = pad && (Math.abs(pad.leftStick.x) > DEAD_ZONE || Math.abs(pad.leftStick.y) > DEAD_ZONE);

    // Update facing — right stick wins, movement is fallback, otherwise keep last
    if (rsOut) {
        playerFacing = Math.atan2(rsy, rsx);
    } else if (lsOut) {
        playerFacing = Math.atan2(pad.leftStick.y, pad.leftStick.x);
    }

    // Firing logic — only when the deck still has power
    if (!isDeckCleared()) {
        let aimX = 0, aimY = 0;
        if (!rsOut) {
            rightStickReset = true;
        } else if (rightStickReset) {
            aimX = rsx;
            aimY = rsy;
        }

        if ((aimX !== 0 || aimY !== 0) && time > lastShotTime + BULLET_COOLDOWN) {
            fireBullet(player.x, player.y, aimX, aimY);
            lastShotTime = time;
            rightStickReset = false;
        }
    }

    // --- Lift hold-to-activate ---
    updateLiftHold(time, pad);

    // --- Enemy AI ---
    for (const enemy of enemies) {
        updateEnemy(enemy, time);
    }

    // --- Debug toggle ---
    if (Phaser.Input.Keyboard.JustDown(f1Key)) {
        const visible = !debugGraphics.visible;
        debugGraphics.setVisible(visible);
        scene.debugStaticGfx.setVisible(visible);
        scene.debugNodeLabels.forEach(label => label.setVisible(visible));
    }
    if (Phaser.Input.Keyboard.JustDown(f2Key)) {
        const v = !scene.debugWallGfx.visible;
        scene.debugWallGfx.setVisible(v);
    }
    if (Phaser.Input.Keyboard.JustDown(f3Key)) {
        scene.debugRayGfx.setVisible(!scene.debugRayGfx.visible);
    }
    if (Phaser.Input.Keyboard.JustDown(f4Key)) {
        scene.debugVisGfx.setVisible(!scene.debugVisGfx.visible);
    }
    if (scene.debugVisGfx.visible) {
        drawDebugVisibilityPolygon();
    }
    if (scene.debugRayGfx.visible) {
        drawDebugRays();
    }
    updateFogOfWar();
    drawDebugNavDynamic();
}

// ─────────────────────────────────────────────
//  LIFT SYSTEM — parsing and overlap
// ─────────────────────────────────────────────
function parseLiftZones(map) {
    let objLayer = map.getObjectLayer('Lifts');

    if (!objLayer) {
        const raw = map.objects
        ? map.objects.find(l => l.name === 'Lifts')
        : null;
        if (raw) { objLayer = raw; }
    }

    if (!objLayer) {
        console.log('LIFTS: No "Lifts" object layer found on this deck.');
        return;
    }

    for (const obj of objLayer.objects) {
        // Read the "decks" custom property (comma-separated deck names)
        let connectedDecks = [];
        if (obj.properties) {
            const decksProp = obj.properties.find(p => p.name === 'Decks');
            if (decksProp) {
                connectedDecks = decksProp.value.split(',').map(s => s.trim());
            }
        }

        if (connectedDecks.length === 0) {
            console.warn('LIFTS: Lift object at (' + obj.x + ',' + obj.y + ') has no "decks" property — skipping.');
            continue;
        }

        // Create an invisible physics sprite for overlap detection.
        // Tiled rectangles have x,y at top-left and width/height.
        const w = obj.width  || TILE_SIZE;
        const h = obj.height || TILE_SIZE;
        const cx = obj.x + w / 2;
        const cy = obj.y + h / 2;

        const zone = scene.add.zone(cx, cy, w, h);
        scene.physics.add.existing(zone, true);  // true = static body
        liftZoneGroup.add(zone);

        // Draw a subtle visual indicator so the player knows a lift is here
        const indicator = scene.add.graphics();
        indicator.lineStyle(2, 0x44aaff, 0.6);
        indicator.strokeRect(obj.x, obj.y, w, h);
        indicator.fillStyle(0x44aaff, 0.15);
        indicator.fillRect(obj.x, obj.y, w, h);

        const liftLabel = scene.add.text(cx, obj.y - 8, 'LIFT', {
            fontFamily: 'monospace', fontSize: '8px', fill: '#44aaff'
        }).setOrigin(0.5, 1);

        const liftData = {
            zone:  zone,
            x:     cx,
            y:     cy,
            decks: connectedDecks,
        };
        liftZones.push(liftData);
    }

    console.log('LIFTS: Parsed ' + liftZones.length + ' lift zone(s) on ' + currentDeck + '.');
}

// Checks player overlap against all lift zones directly (no callback timing issues)
function findPlayerLiftOverlap() {
    const pb = player.getBounds();
    for (const lift of liftZones) {
        const zb = lift.zone.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(pb, zb)) {
            return lift;
        }
    }
    return null;
}

// ─────────────────────────────────────────────
//  LIFT SYSTEM — hold-to-activate
// ─────────────────────────────────────────────
function updateLiftHold(time, pad) {
    // Determine if the "activate" input is held.
    // Gamepad: right stick held past dead zone in any direction
    // Keyboard: F key held
    const DEAD_ZONE = 0.15;
    let holdInput = false;

    if (pad) {
        const RSX = pad.rightStick.x;
        const RSY = pad.rightStick.y;
        holdInput = (Math.abs(RSX) > DEAD_ZONE || Math.abs(RSY) > DEAD_ZONE);
    }

    const fKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    if (fKey.isDown) { holdInput = true; }

    playerOnLift = findPlayerLiftOverlap();

    if (playerOnLift && holdInput) {
        // Start or continue the hold timer
        if (liftHoldStart === 0) {
            liftHoldStart = time;
        }

        const elapsed  = time - liftHoldStart;
        const progress = Math.min(elapsed / LIFT_HOLD_MS, 1);

        // Draw progress bar centred at bottom of screen
        const barW = 120;
        const barH = 10;
        const barX = (800 - barW) / 2;
        const barY = 560;

        liftProgressBg.setVisible(true);
        liftProgressBg.clear();
        liftProgressBg.fillStyle(0x222244, 0.8);
        liftProgressBg.fillRect(barX, barY, barW, barH);

        liftProgressFill.setVisible(true);
        liftProgressFill.clear();
        liftProgressFill.fillStyle(0x44aaff, 1);
        liftProgressFill.fillRect(barX, barY, Math.round(barW * progress), barH);

        if (progress >= 1) {
            // Activated!
            liftHoldStart = 0;
            liftProgressBg.setVisible(false);
            liftProgressFill.setVisible(false);
            showDeckSelection(playerOnLift);
        }
    } else {
        // Not on lift or not holding — reset
        if (liftHoldStart !== 0) {
            liftHoldStart = 0;
            liftProgressBg.setVisible(false);
            liftProgressFill.setVisible(false);
        }
    }
}

// ─────────────────────────────────────────────
//  DECK SELECTION SCREEN
// ─────────────────────────────────────────────
function showDeckSelection(liftData) {
    deckSelectionActive = true;
    deckSelectionIndex  = 0;
    deckSelectionItems  = [];

    // Pause physics so nothing moves while the menu is open
    scene.physics.pause();
    player.setVelocity(0);

    // Semi-transparent backdrop
    deckSelectBg = scene.add.graphics();
    deckSelectBg.fillStyle(0x000000, 0.75);
    deckSelectBg.fillRect(0, 0, 800, 600);
    deckSelectBg.setScrollFactor(0).setDepth(100);

    deckSelectTitle = scene.add.text(400, 140, 'SELECT DECK', {
        fontFamily: 'monospace', fontSize: '32px',
        fill: '#44aaff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    deckSelectHint = scene.add.text(400, 480, 'Arrow keys / D-pad to choose — Enter / A to confirm — Esc / B to cancel', {
        fontFamily: 'monospace', fontSize: '11px', fill: '#666688'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    // Build list: current deck first (labelled "Stay"), then connected decks
    const connectedDecks = liftData.decks;
    const allOptions     = [currentDeck, ...connectedDecks.filter(d => d !== currentDeck)];

    let yPos = 220;
    for (const deckName of allOptions) {
        const def   = deckDefinitions[deckName];
        const label = def ? def.label : deckName;
        const suffix = (deckName === currentDeck) ? '  (current deck)' : '';

        const txt = scene.add.text(400, yPos, label + suffix, {
            fontFamily: 'monospace', fontSize: '20px', fill: '#aaaacc'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

        deckSelectionItems.push({ text: txt, deckName: deckName });
        yPos += 44;
    }

    highlightDeckOption(0);
}

function highlightDeckOption(index) {
    for (let i = 0; i < deckSelectionItems.length; i++) {
        const item = deckSelectionItems[i];
        if (i === index) {
            item.text.setStyle({ fill: '#ffffff', fontSize: '22px' });
            item.text.setText('▸ ' + (deckDefinitions[item.deckName]?.label || item.deckName) +
            (item.deckName === currentDeck ? '  (current deck)' : ''));
        } else {
            item.text.setStyle({ fill: '#aaaacc', fontSize: '20px' });
            item.text.setText('  ' + (deckDefinitions[item.deckName]?.label || item.deckName) +
            (item.deckName === currentDeck ? '  (current deck)' : ''));
        }
    }
}

function updateDeckSelection(time) {
    const pad = scene.input.gamepad.getPad(0);

    // --- Navigation (keyboard) ---
    const upKey    = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    const downKey  = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    const enterKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    const escKey   = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    if (Phaser.Input.Keyboard.JustDown(upKey)) {
        deckSelectionIndex = (deckSelectionIndex - 1 + deckSelectionItems.length) % deckSelectionItems.length;
        highlightDeckOption(deckSelectionIndex);
    }
    if (Phaser.Input.Keyboard.JustDown(downKey)) {
        deckSelectionIndex = (deckSelectionIndex + 1) % deckSelectionItems.length;
        highlightDeckOption(deckSelectionIndex);
    }
    if (Phaser.Input.Keyboard.JustDown(enterKey)) {
        confirmDeckSelection();
        return;
    }
    if (Phaser.Input.Keyboard.JustDown(escKey)) {
        cancelDeckSelection();
        return;
    }

    // --- Navigation (gamepad) ---
    if (pad) {
        // D-pad or left stick for navigation (edge-triggered)
        const dpadY = pad.leftStick.y;
        const DPAD_THRESH = 0.5;

        if (dpadY < -DPAD_THRESH && dpadPrevY >= -DPAD_THRESH) {
            deckSelectionIndex = (deckSelectionIndex - 1 + deckSelectionItems.length) % deckSelectionItems.length;
            highlightDeckOption(deckSelectionIndex);
        }
        if (dpadY > DPAD_THRESH && dpadPrevY <= DPAD_THRESH) {
            deckSelectionIndex = (deckSelectionIndex + 1) % deckSelectionItems.length;
            highlightDeckOption(deckSelectionIndex);
        }
        dpadPrevY = dpadY;

        // A button (index 0) to confirm
        const aDown = pad.buttons[0] && pad.buttons[0].pressed;
        if (aDown && !confirmButtonPrev) { confirmDeckSelection(); return; }
        confirmButtonPrev = aDown;

        // B button (index 1) to cancel
        const bDown = pad.buttons[1] && pad.buttons[1].pressed;
        if (bDown && !cancelButtonPrev) { cancelDeckSelection(); return; }
        cancelButtonPrev = bDown;
    }
}

function confirmDeckSelection() {
    const selected = deckSelectionItems[deckSelectionIndex];
    if (!selected) { cancelDeckSelection(); return; }

    if (selected.deckName === currentDeck) {
        // Staying on the same deck — just close the menu
        cancelDeckSelection();
        return;
    }

    switchToDeck(selected.deckName);
}

function cancelDeckSelection() {
    // Tear down the menu UI
    deckSelectBg.destroy();
    deckSelectTitle.destroy();
    deckSelectHint.destroy();
    for (const item of deckSelectionItems) { item.text.destroy(); }
    deckSelectionItems  = [];
    deckSelectionActive = false;

    // Resume physics
    scene.physics.resume();
}

// ─────────────────────────────────────────────
//  DECK SWITCHING
// ─────────────────────────────────────────────
function switchToDeck(targetDeck) {
    // 1. Save current deck's enemy state
    saveDeckState(currentDeck);

    // 2. Find where the player should spawn on the target deck.
    //    We look for a lift on the TARGET deck whose "decks" list
    //    includes the deck we're coming FROM.  Since we can't read
    //    the target map's objects without loading it, we store the
    //    default start for now.  After the map loads in create(),
    //    we'll adjust if a matching lift is found.
    //
    //    For the POC we simply use the target deck's default start
    //    position. A later enhancement can scan the loaded map for
    //    matching lift objects and snap to one.
    playerSpawnPos = null;   // will fall back to deckDef.playerStart

    // 3. Switch
    currentDeck = targetDeck;
    scene.scene.restart();
}

// ─────────────────────────────────────────────
//  DECK STATE — save / restore
// ─────────────────────────────────────────────
function saveDeckState(deckName) {
    const saved = enemies.map(e => ({
        typeName:      e.typeName,
        x:             e.sprite.x,
        y:             e.sprite.y,
        hp:            e.hp,
        currentNodeId: e.currentNodeId,
        previousNodeId: e.previousNodeId,
    }));

    const wasCleared = deckStates[deckName] && deckStates[deckName].cleared;
    deckStates[deckName] = {
        enemies: saved,
        cleared: wasCleared || false,
    };

    console.log('STATE: Saved ' + saved.length + ' enemy(s) for ' + deckName + '.');
}

function restoreEnemiesFromState(state) {
    for (const saved of state.enemies) {
        const typeDef = enemyTypes[saved.typeName];
        if (!typeDef) { continue; }

        const sprite = scene.physics.add.sprite(saved.x, saved.y, saved.typeName);
        sprite.setAlpha(0);
        sprite.setCollideWorldBounds(true);
        scene.physics.add.collider(sprite, wallLayer);
        enemyGroup.add(sprite);

        const node   = navNodes[saved.currentNodeId] || findNearestNode(saved.x, saved.y);
        const nodeId = node ? node.id : null;
        const target = node ? { x: node.x, y: node.y } : null;

        enemies.push({
            sprite:         sprite,
            typeName:       saved.typeName,
            label:          typeDef.label,
            currentNodeId:  nodeId,
            previousNodeId: saved.previousNodeId,
            nodeTarget:     target,
            hp:             saved.hp,
            contactDamage:  typeDef.contactDamage,
            speed:          typeDef.speed,
            detectRange:    typeDef.detectRange,
            weaponType:     typeDef.weaponType,
            lastShotTime:   0,
            lastStuckCheckTime: 0,
            lastStuckCheckPos:  { x: saved.x, y: saved.y },
            bounceCooldown: 0,
            knockbackUntil: 0,
        });
    }
}

function spawnFreshEnemies(enemyDefs) {
    for (const def of enemyDefs) {
        const typeDef = enemyTypes[def.type];
        if (!typeDef) {
            console.warn('Unknown enemy type "' + def.type + '" — skipping.');
            continue;
        }

        const startX = def.startTile.x * TILE_SIZE + TILE_SIZE / 2;
        const startY = def.startTile.y * TILE_SIZE + TILE_SIZE / 2;

        const sprite = scene.physics.add.sprite(startX, startY, def.type);
        sprite.setAlpha(0);
        sprite.setCollideWorldBounds(true);
        scene.physics.add.collider(sprite, wallLayer);
        enemyGroup.add(sprite);

        const startNode = findNearestNode(startX, startY);
        const initNodeId = startNode ? startNode.id : null;
        const initTarget = startNode ? { x: startNode.x, y: startNode.y } : null;

        enemies.push({
            sprite:         sprite,
            typeName:       def.type,
            label:          typeDef.label,
            currentNodeId:  initNodeId,
            previousNodeId: null,
            nodeTarget:     initTarget,
            hp:             typeDef.hp,
            contactDamage:  typeDef.contactDamage,
            speed:          typeDef.speed,
            detectRange:    typeDef.detectRange,
            weaponType:     typeDef.weaponType,
            lastShotTime:   0,
            lastStuckCheckTime: 0,
            lastStuckCheckPos:  { x: startX, y: startY },
            bounceCooldown: 0,
            knockbackUntil: 0,
        });
    }
}

// Decides whether to restore saved state or spawn fresh
function spawnEnemiesForDeck(deckName) {
    if (deckStates[deckName]) {
        console.log('STATE: Restoring saved enemies for ' + deckName + '.');
        restoreEnemiesFromState(deckStates[deckName]);
    } else {
        const deckDef = deckDefinitions[deckName];
        console.log('STATE: Spawning ' + deckDef.enemies.length + ' fresh enemy(s) for ' + deckName + '.');
        spawnFreshEnemies(deckDef.enemies);
    }
}

// ─────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────
function createHUD(scene) {
    const BAR_X = 12;
    const BAR_Y = 12;

    scene.add.text(BAR_X, BAR_Y, 'ENERGY', {
        fontFamily: 'monospace',
        fontSize:   '10px',
        fill:       '#aaffcc'
    }).setScrollFactor(0).setDepth(50);

    const barBg = scene.add.graphics();
    barBg.fillStyle(0x222233, 1);
    barBg.fillRect(BAR_X, BAR_Y + 12, ENERGY_BAR_WIDTH, ENERGY_BAR_HEIGHT);
    barBg.setScrollFactor(0).setDepth(50);

    energyBarFill = scene.add.graphics();
    energyBarFill.setScrollFactor(0).setDepth(51);

    killText = scene.add.text(BAR_X, BAR_Y + 32, 'Destroyed: 0', {
        fontFamily: 'monospace',
        fontSize:   '12px',
        fill:       '#aaffcc'
    });
    killText.setScrollFactor(0).setDepth(50);

    // Deck name label
    const deckDef = deckDefinitions[currentDeck];
    deckLabel = scene.add.text(800 - 12, 12, deckDef ? deckDef.label : currentDeck, {
        fontFamily: 'monospace',
        fontSize:   '11px',
        fill:       '#44aaff',
        align:      'right'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(50);

    updateHUD();
}

function updateHUD() {
    const pct = playerEnergy / PLAYER_MAX_ENERGY;

    let colour;
    if      (pct > 0.5) { colour = 0x00dd55; }
    else if (pct > 0.25){ colour = 0xffcc00; }
    else                { colour = 0xff2244; }

    energyBarFill.clear();
    energyBarFill.fillStyle(colour, 1);
    energyBarFill.fillRect(12, 24, Math.round(ENERGY_BAR_WIDTH * pct), ENERGY_BAR_HEIGHT);

    killText.setText('Destroyed: ' + killCount);
}

// ─────────────────────────────────────────────
//  PLAYER ↔ ENEMY COLLISION
// ─────────────────────────────────────────────
function onPlayerEnemyCollide(playerSprite, enemySprite) {
    const enemy = enemies.find(e => e.sprite === enemySprite);
    if (!enemy) { return; }

    const wasInvincible = playerInvincible;
    applyDamageToPlayer(enemy.contactDamage);

    if (!wasInvincible) {
        const wEnemy = enemyTypes[enemy.typeName].weight;
        const total  = PLAYER_WEIGHT + wEnemy;

        const dx   = enemySprite.x - playerSprite.x;
        const dy   = enemySprite.y - playerSprite.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx   = dx / dist;
        const ny   = dy / dist;

        const PLAYER_BOUNCE = 220;
        playerSprite.setVelocity(
            -nx * PLAYER_BOUNCE * (wEnemy / total),
                                 -ny * PLAYER_BOUNCE * (wEnemy / total)
        );

        if (wEnemy < PLAYER_WEIGHT) {
            const MAX_PUSH   = 200;
            const pushFactor = (PLAYER_WEIGHT - wEnemy) / PLAYER_WEIGHT;
            enemySprite.setVelocity(
                nx * pushFactor * MAX_PUSH,
                ny * pushFactor * MAX_PUSH
            );

            enemy.knockbackUntil = scene.time.now + 150;
            reverseEnemyCourse(enemy);
        }
    }
}

// ─────────────────────────────────────────────
//  ENEMY ↔ ENEMY COLLISION
// ─────────────────────────────────────────────
function onEnemyEnemyCollide(spriteA, spriteB) {
    const enemyA = enemies.find(e => e.sprite === spriteA);
    const enemyB = enemies.find(e => e.sprite === spriteB);
    if (!enemyA || !enemyB) { return; }

    const now = scene.time.now;
    if (now < enemyA.bounceCooldown || now < enemyB.bounceCooldown) { return; }

    const wA    = enemyTypes[enemyA.typeName].weight;
    const wB    = enemyTypes[enemyB.typeName].weight;
    const total = wA + wB;

    const dx   = spriteB.x - spriteA.x;
    const dy   = spriteB.y - spriteA.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx   = dx / dist;
    const ny   = dy / dist;

    const BOUNCE = 100;
    spriteA.setVelocity(-nx * BOUNCE * (wB / total), -ny * BOUNCE * (wB / total));
    spriteB.setVelocity( nx * BOUNCE * (wA / total),  ny * BOUNCE * (wA / total));

    const COOLDOWN_MS = 220;
    enemyA.bounceCooldown = now + COOLDOWN_MS;
    enemyB.bounceCooldown = now + COOLDOWN_MS;

    enemyA.knockbackUntil = now + COOLDOWN_MS;
    enemyB.knockbackUntil = now + COOLDOWN_MS;

    reverseEnemyCourse(enemyA);
    reverseEnemyCourse(enemyB);
}

// ─────────────────────────────────────────────
//  PLAYER DAMAGE — enemy bullets
// ─────────────────────────────────────────────
function playerHitByEnemyBullet(playerSprite, bullet) {
    const damage = bullet.getData('damage') ?? 20;
    deactivateEnemyBullet(bullet);
    applyDamageToPlayer(damage);
}

// ─────────────────────────────────────────────
//  PLAYER DAMAGE — shared logic
// ─────────────────────────────────────────────
function applyDamageToPlayer(damage) {
    if (playerInvincible) { return; }

    playerEnergy = Math.max(0, playerEnergy - damage);
    updateHUD();

    if (playerEnergy <= 0) {
        triggerGameOver();
        return;
    }

    playerInvincible = true;

    scene.tweens.add({
        targets:    player,
        alpha:      0.2,
        duration:   100,
        yoyo:       true,
        repeat:     5,
        onComplete: () => { player.setAlpha(1); }
    });

    scene.time.delayedCall(INVINCIBILITY_MS, () => {
        playerInvincible = false;
    });
}

// ─────────────────────────────────────────────
//  GAME OVER
// ─────────────────────────────────────────────
function triggerGameOver() {
    gameOver = true;
    player.setVelocity(0);
    player.setAlpha(0.3);

    for (const enemy of enemies) { enemy.sprite.setVelocity(0); }

    scene.time.delayedCall(1200, () => {
        scene.scene.start('EndScene', { result: 'lost' });
    });
}

// ─────────────────────────────────────────────
//  PLAYER BULLETS
// ─────────────────────────────────────────────
function fireBullet(x, y, dx, dy) {
    const bullet = bullets.get(x, y, 'bullet');
    if (!bullet) { return; }

    bullet.setActive(true);
    bullet.setVisible(true);
    bullet.body.enable = true;
    bullet.body.reset(x, y);

    const angle = Math.atan2(dy, dx);
    bullet.setVelocityX(Math.cos(angle) * BULLET_SPEED);
    bullet.setVelocityY(Math.sin(angle) * BULLET_SPEED);
}

function bulletHitWall(bullet) {
    deactivateBullet(bullet);
}

function bulletHitEnemy(bullet, enemySprite) {
    deactivateBullet(bullet);

    const enemy = enemies.find(e => e.sprite === enemySprite);
    if (!enemy) { return; }

    enemy.hp--;

    if (enemy.hp <= 0) {
        enemies = enemies.filter(e => e !== enemy);

        enemySprite.setActive(false);
        enemySprite.setVisible(false);
        enemySprite.body.enable = false;

        killCount++;
        updateHUD();

        scene.time.delayedCall(100, () => {
            enemySprite.destroy();
        });
        checkDeckClearance();
    } else {
        scene.tweens.add({
            targets:  enemySprite,
            alpha:    0.3,
            duration: 60,
            yoyo:     true
        });
    }
}

function deactivateBullet(bullet) {
    bullet.setActive(false);
    bullet.setVisible(false);
    bullet.setVelocity(0);
    bullet.body.enable = false;
}

// ─────────────────────────────────────────────
//  ENEMY BULLETS
// ─────────────────────────────────────────────
function enemyShoot(enemy, time) {
    const weaponDef = weaponTypes[enemy.weaponType];
    if (!weaponDef) { return; }

    if (time < enemy.lastShotTime + weaponDef.cooldown) { return; }
    enemy.lastShotTime = time;

    const textureKey = 'ebullet_' + enemy.weaponType;
    const bullet     = enemyBullets.get(enemy.sprite.x, enemy.sprite.y, textureKey);
    if (!bullet) { return; }

    bullet.setActive(true);
    bullet.setVisible(true);
    bullet.body.enable = true;
    bullet.body.reset(enemy.sprite.x, enemy.sprite.y);
    bullet.setData('damage', weaponDef.damage);

    const angle = Phaser.Math.Angle.Between(
        enemy.sprite.x, enemy.sprite.y, player.x, player.y
    );
    bullet.setVelocityX(Math.cos(angle) * weaponDef.bulletSpeed);
    bullet.setVelocityY(Math.sin(angle) * weaponDef.bulletSpeed);
}

function enemyBulletHitWall(bullet) {
    deactivateEnemyBullet(bullet);
}

function deactivateEnemyBullet(bullet) {
    bullet.setActive(false);
    bullet.setVisible(false);
    bullet.setVelocity(0);
    bullet.body.enable = false;
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function tileToPixel(tileCoord) {
    return {
        x: tileCoord.x * TILE_SIZE + TILE_SIZE / 2,
        y: tileCoord.y * TILE_SIZE + TILE_SIZE / 2
    };
}

function hasLineOfSight(x1, y1, x2, y2, width) {
    const halfWidth = (width !== undefined ? width : 12);

    const dx  = x2 - x1;
    const dy  = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) { return true; }

    const perpX = -dy / len;
    const perpY =  dx / len;

    const offsets = [0, -halfWidth, halfWidth];

    for (const offset of offsets) {
        const ox = perpX * offset;
        const oy = perpY * offset;

        const steps = Math.ceil(len / 8);
        for (let i = 1; i < steps; i++) {
            const t       = i / steps;
            const sampleX = x1 + ox + dx * t;
            const sampleY = y1 + oy + dy * t;
            const tile    = wallLayer.getTileAtWorldXY(sampleX, sampleY);
            if (tile && tile.collides) { return false; }
        }
    }
    return true;
}

// ─────────────────────────────────────────────
//  ENEMY AI  (node-based patrol + pursuit)
// ─────────────────────────────────────────────
function updateEnemy(enemy, time) {
    const sprite = enemy.sprite;

    const los          = hasLineOfSight(player.x, player.y, sprite.x, sprite.y);
    const distToPlayer = Phaser.Math.Distance.Between(sprite.x, sprite.y, player.x, player.y);
    const targetAlpha = los ? 1 : 0;
    sprite.alpha += (targetAlpha - sprite.alpha) * 0.10;
    if (sprite.alpha < 0.01) { sprite.alpha = 0; }

    if (enemy.nodeTarget === null) {
        sprite.setVelocity(0);
        return;
    }

    if (time < enemy.knockbackUntil) {
        if (enemy.weaponType !== null && los && distToPlayer < enemy.detectRange) {
            enemyShoot(enemy, time);
        }
        return;
    }

    // ── Stuck detection ──────────────────────────────────────────────────
    if (time > enemy.knockbackUntil && time > enemy.lastStuckCheckTime + 1000) {
        const movedDist = Phaser.Math.Distance.Between(
            sprite.x, sprite.y,
            enemy.lastStuckCheckPos.x, enemy.lastStuckCheckPos.y
        );
        if (movedDist < 8) {
            if (enemy.previousNodeId !== null) {
                const prevNode = navNodes[enemy.previousNodeId];
                enemy.currentNodeId  = enemy.previousNodeId;
                enemy.previousNodeId = null;
                enemy.nodeTarget     = { x: prevNode.x, y: prevNode.y };
            } else {
                const nearestNode = findNearestNode(sprite.x, sprite.y);
                if (nearestNode) {
                    enemy.currentNodeId = nearestNode.id;
                    enemy.nodeTarget    = { x: nearestNode.x, y: nearestNode.y };
                }
            }
        }
        enemy.lastStuckCheckTime = time;
        enemy.lastStuckCheckPos  = { x: sprite.x, y: sprite.y };
    }

    // ── Arrived at target node? ──────────────────────────────────────────
    const distToNode = Phaser.Math.Distance.Between(
        sprite.x, sprite.y, enemy.nodeTarget.x, enemy.nodeTarget.y
    );

    if (distToNode < 4) {
        let nextId = null;

        if (enemy.weaponType !== null) {
            if (los && distToPlayer < enemy.detectRange) {
                const playerNode = findNearestNode(player.x, player.y);
                if (playerNode) {
                    const path = bfsPath(enemy.currentNodeId, playerNode.id);
                    if (path && path.length > 0) {
                        nextId = path[0];
                    }
                }
            }
        }

        if (nextId === null) {
            nextId = pickWanderNode(enemy);
        }

        if (nextId !== null) {
            enemy.previousNodeId = enemy.currentNodeId;
            enemy.currentNodeId  = nextId;
            enemy.nodeTarget     = { x: navNodes[nextId].x, y: navNodes[nextId].y };
        }
    }

    // ── Move toward current target node ─────────────────────────────────
    const moveAngle = Phaser.Math.Angle.Between(
        sprite.x, sprite.y, enemy.nodeTarget.x, enemy.nodeTarget.y
    );
    sprite.setVelocityX(Math.cos(moveAngle) * enemy.speed);
    sprite.setVelocityY(Math.sin(moveAngle) * enemy.speed);

    // ── Ranged attack ────────────────────────────────────────────────────
    if (enemy.weaponType !== null) {
        if (los && distToPlayer < enemy.detectRange) {
            enemyShoot(enemy, time);
        }
    }
}

// ─────────────────────────────────────────────
//  NAV GRAPH — build from Tiled object layer
// ─────────────────────────────────────────────
function buildNavGraph(map) {
    navNodes = [];

    console.log('NAV: All layers found by Phaser:');
    map.layers.forEach(l => console.log('  tile layer:', l.name));
    if (map.objects) {
        map.objects.forEach(l => console.log('  object layer:', l.name));
    }

    let objLayer = map.getObjectLayer('Waypoints');

    if (!objLayer) {
        const raw = map.objects
        ? map.objects.find(l => l.name === 'Waypoints')
        : null;
        if (raw) {
            console.log('NAV: Found Waypoints via map.objects fallback.');
            objLayer = raw;
        }
    }

    if (!objLayer) {
        console.warn('NAV: "Waypoints" layer not found by either method. Check layer name exactly.');
        return;
    }

    objLayer.objects.forEach((obj, index) => {
        navNodes.push({ id: index, x: obj.x, y: obj.y, neighbours: [] });
    });

    console.log('NAV: Found ' + navNodes.length + ' waypoint objects.');

    for (let i = 0; i < navNodes.length; i++) {
        for (let j = i + 1; j < navNodes.length; j++) {
            const a    = navNodes[i];
            const b    = navNodes[j];
            const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
            if (dist <= NODE_CONNECT_DIST && hasLineOfSight(a.x, a.y, b.x, b.y)) {
                a.neighbours.push(b.id);
                b.neighbours.push(a.id);
            }
        }
    }

    const totalLinks = navNodes.reduce((sum, n) => sum + n.neighbours.length, 0) / 2;
    console.log('NAV: Graph built — ' + navNodes.length + ' nodes, ' + totalLinks + ' connections.');

    if (totalLinks === 0 && navNodes.length > 1) {
        console.warn('NAV: No connections formed! Nodes may be more than ' + NODE_CONNECT_DIST + 'px apart, or walls are blocking LOS.');
    }
}

// ─────────────────────────────────────────────
//  NAV GRAPH — helpers
// ─────────────────────────────────────────────
function findNearestNode(x, y) {
    let best     = null;
    let bestDist = Infinity;
    for (const node of navNodes) {
        const d = Phaser.Math.Distance.Between(x, y, node.x, node.y);
        if (d < bestDist) { bestDist = d; best = node; }
    }
    return best;
}

function bfsPath(startId, goalId) {
    if (startId === goalId) { return []; }

    const visited = new Set([startId]);
    const queue   = [[startId]];

    while (queue.length > 0) {
        const path    = queue.shift();
        const current = path[path.length - 1];

        for (const neighbourId of navNodes[current].neighbours) {
            if (neighbourId === goalId) {
                return [...path.slice(1), neighbourId];
            }
            if (!visited.has(neighbourId)) {
                visited.add(neighbourId);
                queue.push([...path, neighbourId]);
            }
        }
    }
    return null;
}

function pickWanderNode(enemy) {
    if (enemy.currentNodeId === null) { return null; }
    const node = navNodes[enemy.currentNodeId];
    if (!node || node.neighbours.length === 0) { return null; }

    let candidates = node.neighbours;

    if (enemy.previousNodeId !== null && candidates.length > 1) {
        const noBacktrack = candidates.filter(id => id !== enemy.previousNodeId);
        if (Math.random() > WANDER_BACKTRACK_CHANCE) {
            candidates = noBacktrack;
        }
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
}

function reverseEnemyCourse(enemy) {
    if (enemy.previousNodeId !== null) {
        const prevNode = navNodes[enemy.previousNodeId];
        const oldCurrent = enemy.currentNodeId;
        enemy.currentNodeId  = enemy.previousNodeId;
        enemy.previousNodeId = oldCurrent;
        enemy.nodeTarget     = { x: prevNode.x, y: prevNode.y };
    } else {
        const nearest = findNearestNode(enemy.sprite.x, enemy.sprite.y);
        if (nearest) {
            enemy.currentNodeId = nearest.id;
            enemy.nodeTarget    = { x: nearest.x, y: nearest.y };
        }
    }
}

// ─────────────────────────────────────────────
//  HELPER - is deck cleared?
// ─────────────────────────────────────────────
function isDeckCleared() {
    return !!(deckStates[currentDeck] && deckStates[currentDeck].cleared);
}

function resetGameState() {
    deckStates     = {};
    currentDeck    = 'deck1';
    playerSpawnPos = null;
    playerEnergy   = PLAYER_MAX_ENERGY;
    killCount      = 0;
}

function areAllDecksCleared() {
    for (const deckName of Object.keys(deckDefinitions)) {
        const def = deckDefinitions[deckName];
        // Decks with no enemies don't count — they can never be "cleared".
        if (!def.enemies || def.enemies.length === 0) { continue; }
        if (!deckStates[deckName] || !deckStates[deckName].cleared) {
            return false;
        }
    }
    return true;
}

// ─────────────────────────────────────────────
//  DECK SHUTDOWN — "lights out" when a deck is cleared
// ─────────────────────────────────────────────
const DIM_COLOUR = 0x444466;   // cool blue-grey

function applyDeckDim() {
    wallLayer.forEachTile(tile => {
        const isLight = tile.properties && tile.properties.light;
        tile.tint = isLight ? 0xffffff : DIM_COLOUR;
    });
}

function checkDeckClearance() {
    // Already shut down? Nothing to do.
    if (deckStates[currentDeck] && deckStates[currentDeck].cleared) { return; }

    // Still enemies alive? Nothing to do.
    if (enemies.length > 0) { return; }

    // Did this deck originally have enemies? If it started empty, don't trigger.
    const deckDef = deckDefinitions[currentDeck];
    if (!deckDef || !deckDef.enemies || deckDef.enemies.length === 0) { return; }

    triggerDeckShutdown();

    // Was that the last deck with enemies on it?
    if (areAllDecksCleared()) {
        scene.time.delayedCall(2500, () => {
            scene.scene.start('EndScene', { result: 'won' });
        });
    }
}

function triggerDeckShutdown() {
    // Persist the cleared flag so it survives lifts, saves and restores.
    if (!deckStates[currentDeck]) {
        deckStates[currentDeck] = { enemies: [] };
    }
    deckStates[currentDeck].cleared = true;

    applyDeckDim();
    showDeckClearedMessage();

    console.log('SHUTDOWN: ' + currentDeck + ' cleared — lights out.');
}

function showDeckClearedMessage() {
    const msg = scene.add.text(400, 260, 'DECK POWER DOWN', {
        fontFamily: 'monospace', fontSize: '32px',
        fill: '#44aaff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(55).setAlpha(0);

    scene.tweens.add({
        targets:    msg,
        alpha:      1,
        duration:   500,
        yoyo:       true,
        hold:       1500,
        onComplete: () => msg.destroy(),
    });
}

// ─────────────────────────────────────────────
//  WALL SEGMENT EXTRACTION  (for light raycasting)
// ─────────────────────────────────────────────
function isWallTile(layer, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= layer.width || ty >= layer.height) {
        return false;
    }
    const tile = layer.getTileAt(tx, ty);
    return tile !== null && tile.collides;
}

function extractWallSegments() {
    wallSegments = [];
    const W = wallLayer.width;   // map width  in tiles
    const H = wallLayer.height;  // map height in tiles

    for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
            if (!isWallTile(wallLayer, tx, ty)) { continue; }

            const left   = tx * TILE_SIZE;
            const top    = ty * TILE_SIZE;
            const right  = left + TILE_SIZE;
            const bottom = top  + TILE_SIZE;

            // Only emit an edge if the neighbour on that side is NOT a wall.
            // This keeps the interior wall-to-wall seams out of the segment list.
            if (!isWallTile(wallLayer, tx, ty - 1)) {
                wallSegments.push({ x1: left,  y1: top,    x2: right, y2: top    });
            }
            if (!isWallTile(wallLayer, tx + 1, ty)) {
                wallSegments.push({ x1: right, y1: top,    x2: right, y2: bottom });
            }
            if (!isWallTile(wallLayer, tx, ty + 1)) {
                wallSegments.push({ x1: left,  y1: bottom, x2: right, y2: bottom });
            }
            if (!isWallTile(wallLayer, tx - 1, ty)) {
                wallSegments.push({ x1: left,  y1: top,    x2: left,  y2: bottom });
            }
        }
    }
}

function extractWallCorners() {
    wallCorners = [];
    const W = wallLayer.width;
    const H = wallLayer.height;

    // Grid vertices: one more in each dimension than there are tiles
    for (let vy = 0; vy <= H; vy++) {
        for (let vx = 0; vx <= W; vx++) {
            // The four tiles meeting at this vertex
            const tl = isWallTile(wallLayer, vx - 1, vy - 1);
            const tr = isWallTile(wallLayer, vx,     vy - 1);
            const bl = isWallTile(wallLayer, vx - 1, vy);
            const br = isWallTile(wallLayer, vx,     vy);

            const count = (tl?1:0) + (tr?1:0) + (bl?1:0) + (br?1:0);

            // Interior of open space or interior of solid wall — skip
            if (count === 0 || count === 4) { continue; }

            // Exactly 2 walls — only keep if they're diagonal
            if (count === 2) {
                const diagonal = (tl && br) || (tr && bl);
                if (!diagonal) { continue; }   // straight edge, no corner
            }

            // 1, 3, or diagonal-2 → real corner
            wallCorners.push({ x: vx * TILE_SIZE, y: vy * TILE_SIZE });
        }
    }
}

// ─────────────────────────────────────────────
//  RAYCASTING  (line-vs-segment intersection)
// ─────────────────────────────────────────────
// Casts a ray from (originX, originY) at the given angle and returns the
// nearest intersection with any wall segment as { x, y, dist }.
// If no wall is hit (shouldn't happen inside a closed map), returns a point
// far along the ray.
function castRay(originX, originY, angle) {
    const rdx = Math.cos(angle);
    const rdy = Math.sin(angle);

    let closestT = Infinity;
    let hitX = originX + rdx * 10000;
    let hitY = originY + rdy * 10000;

    for (const seg of wallSegments) {
        const sdx = seg.x2 - seg.x1;
        const sdy = seg.y2 - seg.y1;

        // Denominator of the linear system. Near-zero means the ray is
        // parallel to this segment — no intersection.
        const denom = sdx * rdy - rdx * sdy;
        if (Math.abs(denom) < 1e-9) { continue; }

        const rhsX = seg.x1 - originX;
        const rhsY = seg.y1 - originY;

        // t = how far along the ray the hit is (must be > 0, i.e. forward)
        // u = how far along the segment the hit is (must be within [0, 1])
        const t = (sdx * rhsY - sdy * rhsX) / denom;
        const u = (rdx * rhsY - rdy * rhsX) / denom;

        if (t > 0 && u >= 0 && u <= 1 && t < closestT) {
            closestT = t;
            hitX = originX + rdx * t;
            hitY = originY + rdy * t;
        }
    }

    return { x: hitX, y: hitY, dist: closestT };
}

// ─────────────────────────────────────────────
//  VISIBILITY POLYGON
// ─────────────────────────────────────────────
// Returns an array of points {x, y, angle} sorted by angle around the
// origin. Connecting them in order forms the polygon of what's visible
// from (originX, originY).
function computeVisibilityPolygon(originX, originY) {
    const EPS = 0.0001;   // angular offset for the two flanking rays

    // Collect unique corners. Many segments share endpoints — especially
    // long straight walls, which contribute duplicates at every tile seam.
    // Deduping saves a lot of rays.
    const seen    = new Set();
    const corners = [];
    for (const seg of wallSegments) {
        const k1 = seg.x1 + ',' + seg.y1;
        if (!seen.has(k1)) { seen.add(k1); corners.push({ x: seg.x1, y: seg.y1 }); }
        const k2 = seg.x2 + ',' + seg.y2;
        if (!seen.has(k2)) { seen.add(k2); corners.push({ x: seg.x2, y: seg.y2 }); }
    }

    // Three rays per corner: slightly left, at the corner, slightly right.
    const hits = [];
    for (const c of corners) {
        const baseAngle = Math.atan2(c.y - originY, c.x - originX);
        const angles    = [baseAngle - EPS, baseAngle, baseAngle + EPS];
        for (const a of angles) {
            const hit = castRay(originX, originY, a);
            hits.push({ x: hit.x, y: hit.y, angle: a });
        }
    }

    // Sort by angle so the polygon winds cleanly around the origin.
    hits.sort((a, b) => a.angle - b.angle);
    return hits;
}

// ─────────────────────────────────────────────
//  VISIBILITY POLYGON — cone version (optimised)
// ─────────────────────────────────────────────
// Reads the cached `wallCorners` list (built once in extractWallSegments),
// culls corners that are outside the light's range or outside the cone
// angle, and clamps any ray hit that lands past the range so the polygon
// edges fade at a fixed distance instead of trailing off to infinity.
function computeConeVisibilityPolygon(originX, originY, facing, halfAngle, range) {
    const EPS      = 0.0001;
    const RANGE    = range;
    const RANGE_SQ = RANGE * RANGE;

    // Returns angle a − facing, wrapped into [-PI, PI]
    function relAngle(a) {
        let d = a - facing;
        while (d >  Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
    }

    // Casts a ray and clamps the hit point to LIGHT_MAX_RANGE if it
    // would otherwise land further away than the light reaches.
    function castClamped(angle) {
        const hit = castRay(originX, originY, angle);
        const dx  = hit.x - originX;
        const dy  = hit.y - originY;
        if (dx * dx + dy * dy > RANGE_SQ) {
            hit.x = originX + Math.cos(angle) * RANGE;
            hit.y = originY + Math.sin(angle) * RANGE;
        }
        return hit;
    }

    const hits = [];

    // Two rays defining the cone edges
    let h = castClamped(facing - halfAngle);
    hits.push({ x: h.x, y: h.y, rel: -halfAngle });
    h = castClamped(facing + halfAngle);
    hits.push({ x: h.x, y: h.y, rel:  halfAngle });

    // Arc-filling rays across the cone — in open space these all clamp to
    // LIGHT_MAX_RANGE, so connecting them produces a curved leading edge
    // instead of a straight line between the two cone-edge rays.
    const ARC_RAY_COUNT = 24;
    for (let i = 1; i < ARC_RAY_COUNT; i++) {
        const rel = -halfAngle + (i / ARC_RAY_COUNT) * (2 * halfAngle);
        const hit = castClamped(facing + rel);
        hits.push({ x: hit.x, y: hit.y, rel: rel });
    }

    // Rays at corners that are (a) within range and (b) inside the cone
    for (const c of wallCorners) {
        const dx = c.x - originX;
        const dy = c.y - originY;
        if (dx * dx + dy * dy > RANGE_SQ) { continue; }   // out of range — skip

        const baseAngle = Math.atan2(dy, dx);
        const baseRel   = relAngle(baseAngle);
        if (Math.abs(baseRel) >= halfAngle) { continue; }  // outside cone — skip

        for (const offset of [-EPS, 0, EPS]) {
            const rel = baseRel + offset;
            if (Math.abs(rel) > halfAngle) { continue; }   // ray would leave the cone
            const hit = castClamped(baseAngle + offset);
            hits.push({ x: hit.x, y: hit.y, rel: rel });
        }
    }

    // Sort hits by angle so the polygon winds cleanly
    hits.sort((a, b) => a.rel - b.rel);

    // Build the polygon: apex at the player, then sorted hits
    const poly = [{ x: originX, y: originY }];
    for (const hit of hits) {
        poly.push({ x: hit.x, y: hit.y });
    }
    return poly;
}

// ─────────────────────────────────────────────
//  FOG OF WAR — three-band light cone
// ─────────────────────────────────────────────
// Draws three nested cones and erases each with the same partial alpha.
// Because erasures stack, the innermost area is erased three times
// (brightest), the middle ring twice, and the outer ring only once
// (dimmest) — giving the stepped falloff shown in the design sketch.
const LIGHT_BAND_ERASE_ALPHA = 0.35;   // tune for contrast between bands

function updateFogOfWar() {
    if (!fogRT) { return; }

    // Lights only out when the deck has been cleared
    if (!isDeckCleared()) {
        fogRT.setVisible(false);
        return;
    }
    fogRT.setVisible(true);

    fogRT.clear();
    fogRT.fill(FOG_COLOUR, FOG_DARKNESS);

    // Outer → inner. Each pass erases a smaller cone on top of the
    // previous one, so alpha removal accumulates toward the centre.
    const ranges = [
        LIGHT_MAX_RANGE,
        LIGHT_MAX_RANGE * 2 / 3,
        LIGHT_MAX_RANGE * 1 / 3,
    ];

    for (const range of ranges) {
        const poly = computeConeVisibilityPolygon(
            player.x, player.y, playerFacing, CONE_HALF_ANGLE, range
        );
        if (poly.length < 3) { continue; }

        const eraseGfx = scene.make.graphics({ x: 0, y: 0 }, false);
        eraseGfx.fillStyle(0xffffff, LIGHT_BAND_ERASE_ALPHA);
        eraseGfx.beginPath();
        eraseGfx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
            eraseGfx.lineTo(poly[i].x, poly[i].y);
        }
        eraseGfx.closePath();
        eraseGfx.fillPath();

        fogRT.erase(eraseGfx);
        eraseGfx.destroy();
    }
}

// ─────────────────────────────────────────────
//  DEBUG — Draw wall boundaries for lights Raycasting
// ─────────────────────────────────────────────
function drawDebugWallSegments() {
    const gfx = scene.add.graphics();
    gfx.setDepth(49);

    // Segments — bright magenta so they stand out against any deck tint
    gfx.lineStyle(1.5, 0xff00ff, 0.9);
    for (const seg of wallSegments) {
        gfx.beginPath();
        gfx.moveTo(seg.x1, seg.y1);
        gfx.lineTo(seg.x2, seg.y2);
        gfx.strokePath();
    }

    // Corner dots — only the real corners we cast rays at
    gfx.fillStyle(0xff8800, 1);
    for (const c of wallCorners) {
        gfx.fillCircle(c.x, c.y, 3);
    }

    gfx.setVisible(false);
    scene.debugWallGfx = gfx;
}
// ─────────────────────────────────────────────
//  DEBUG — Draw 360 light raycasting test
// ─────────────────────────────────────────────
function drawDebugRays() {
    const gfx = scene.debugRayGfx;
    gfx.clear();

    const RAYS = 64;
    gfx.lineStyle(1, 0xffee00, 0.6);
    for (let i = 0; i < RAYS; i++) {
        const angle = (i / RAYS) * Math.PI * 2;
        const hit   = castRay(player.x, player.y, angle);
        gfx.beginPath();
        gfx.moveTo(player.x, player.y);
        gfx.lineTo(hit.x, hit.y);
        gfx.strokePath();
    }
}
// ─────────────────────────────────────────────
//  DEBUG — Draw light cone test
// ─────────────────────────────────────────────
function drawDebugVisibilityPolygon() {
    const gfx = scene.debugVisGfx;
    gfx.clear();

    const poly = computeVisibilityPolygon(player.x, player.y);
    if (poly.length < 3) { return; }

    // Filled polygon — soft warm tint
    gfx.fillStyle(0xffee88, 0.30);
    gfx.fillPoints(poly, true);

    // Outline
    gfx.lineStyle(1, 0xffcc00, 0.8);
    gfx.strokePoints(poly, true);

    // Hit points — one orange dot per ray hit
    gfx.fillStyle(0xff6600, 1);
    for (const p of poly) {
        gfx.fillCircle(p.x, p.y, 2);
    }
}

// ─────────────────────────────────────────────
//  DEBUG — nav graph + enemy target lines
// ─────────────────────────────────────────────
function drawDebugNavStatic() {
    const staticGfx = scene.add.graphics();
    staticGfx.setDepth(50);

    scene.debugNodeLabels = [];

    staticGfx.lineStyle(2, 0x00ff88, 0.85);
    for (const node of navNodes) {
        for (const neighbourId of node.neighbours) {
            if (neighbourId > node.id) {
                staticGfx.beginPath();
                staticGfx.moveTo(node.x, node.y);
                staticGfx.lineTo(navNodes[neighbourId].x, navNodes[neighbourId].y);
                staticGfx.strokePath();
            }
        }
        staticGfx.fillStyle(0x00ccff, 0.85);
        staticGfx.fillCircle(node.x, node.y, 5);

        const label = scene.add.text(node.x + 6, node.y - 6, String(node.id), {
            fontFamily: 'monospace',
            fontSize:   '9px',
            fill:       '#00ccff'
        }).setDepth(51).setVisible(false);
        scene.debugNodeLabels.push(label);
    }
    staticGfx.setVisible(false);
    debugGraphics.setVisible(false);
    scene.debugStaticGfx = staticGfx;
}

function drawDebugNavDynamic() {
    if (!debugGraphics.visible) { return; }
    debugGraphics.clear();
    for (const enemy of enemies) {
        if (!enemy.nodeTarget) { continue; }
        debugGraphics.lineStyle(4, 0xffee00, 0.9);
        debugGraphics.beginPath();
        debugGraphics.moveTo(enemy.sprite.x, enemy.sprite.y);
        debugGraphics.lineTo(enemy.nodeTarget.x, enemy.nodeTarget.y);
        debugGraphics.strokePath();
        debugGraphics.fillStyle(0xffee00, 1);
        debugGraphics.fillCircle(enemy.nodeTarget.x, enemy.nodeTarget.y, 7);
    }
}
