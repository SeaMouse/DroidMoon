import Phaser from 'phaser';

import {
    TILE_SIZE, PLAYER_SPEED, PLAYER_WEIGHT, BULLET_SPEED, BULLET_COOLDOWN,
    NODE_CONNECT_DIST, WANDER_BACKTRACK_CHANCE,
    PLAYER_MAX_ENERGY, INVINCIBILITY_MS,
    ENERGY_BAR_WIDTH, ENERGY_BAR_HEIGHT,
    LIFT_HOLD_MS,
    FOG_DARKNESS, FOG_COLOUR, LIGHT_MAX_RANGE, CONE_HALF_ANGLE, LIGHT_BAND_ERASE_ALPHA,
    DIM_COLOUR,
    deckDefinitions, weaponTypes, enemyTypes,
} from './config.js';
import { state, resetGameState } from './state.js';

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
//  SCENE: DECK SELECT  (overlay menu)
// ─────────────────────────────────────────────
class DeckSelectScene extends Phaser.Scene {
    constructor() {
        super({ key: 'DeckSelectScene' });
    }

    init(data) {
        this.lift        = data.lift;
        this.index       = 0;
        this.items       = [];
        this.dpadPrevY   = 0;
        this.confirmPrev = false;
        this.cancelPrev  = false;
        this.ready       = false;
    }

    create() {
        // Backdrop
        this.add.graphics()
        .fillStyle(0x000000, 0.75)
        .fillRect(0, 0, 800, 600)
        .setScrollFactor(0);

        this.add.text(400, 140, 'SELECT DECK', {
            fontFamily: 'monospace', fontSize: '32px',
            fill: '#44aaff', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setScrollFactor(0);

        this.add.text(400, 480,
                      'Arrow keys / D-pad to choose — Enter / A to confirm — Esc / B to cancel', {
                          fontFamily: 'monospace', fontSize: '11px', fill: '#666688'
                      }).setOrigin(0.5).setScrollFactor(0);

                      const connectedDecks = this.lift.decks;
                      const allOptions     = [state.currentDeck, ...connectedDecks.filter(d => d !== state.currentDeck)];

                      let yPos = 220;
                      for (const deckName of allOptions) {
                          const def    = deckDefinitions[deckName];
                          const label  = def ? def.label : deckName;
                          const suffix = (deckName === state.currentDeck) ? '  (current deck)' : '';

                          const txt = this.add.text(400, yPos, label + suffix, {
                              fontFamily: 'monospace', fontSize: '20px', fill: '#aaaacc'
                          }).setOrigin(0.5).setScrollFactor(0);

                          this.items.push({ text: txt, deckName: deckName });
                          yPos += 44;
                      }

                      this.menuKeys = this.input.keyboard.addKeys({
                          up: 'UP', down: 'DOWN', enter: 'ENTER', esc: 'ESC',
                      });

                      this.highlight(0);

                      this.time.delayedCall(150, () => { this.ready = true; });
    }

    highlight(index) {
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const label = deckDefinitions[item.deckName]?.label || item.deckName;
            const suffix = (item.deckName === state.currentDeck) ? '  (current deck)' : '';
            if (i === index) {
                item.text.setStyle({ fill: '#ffffff', fontSize: '22px' });
                item.text.setText('▸ ' + label + suffix);
            } else {
                item.text.setStyle({ fill: '#aaaacc', fontSize: '20px' });
                item.text.setText('  ' + label + suffix);
            }
        }
    }

    update() {
        if (!this.ready) { return; }

        const pad = this.input.gamepad.getPad(0);

        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.up)) {
            this.index = (this.index - 1 + this.items.length) % this.items.length;
            this.highlight(this.index);
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.down)) {
            this.index = (this.index + 1) % this.items.length;
            this.highlight(this.index);
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.enter)) {
            this.confirm();
            return;
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.esc)) {
            this.cancel();
            return;
        }

        if (pad) {
            const dpadY = pad.leftStick.y;
            const T = 0.5;

            if (dpadY < -T && this.dpadPrevY >= -T) {
                this.index = (this.index - 1 + this.items.length) % this.items.length;
                this.highlight(this.index);
            }
            if (dpadY > T && this.dpadPrevY <= T) {
                this.index = (this.index + 1) % this.items.length;
                this.highlight(this.index);
            }
            this.dpadPrevY = dpadY;

            const aDown = pad.buttons[0] && pad.buttons[0].pressed;
            if (aDown && !this.confirmPrev) { this.confirm(); return; }
            this.confirmPrev = aDown;

            const bDown = pad.buttons[1] && pad.buttons[1].pressed;
            if (bDown && !this.cancelPrev) { this.cancel(); return; }
            this.cancelPrev = bDown;
        }
    }

    confirm() {
        const selected = this.items[this.index];
        if (!selected || selected.deckName === state.currentDeck) {
            this.cancel();
            return;
        }
        this.scene.stop();
        this.scene.resume('GameScene');
        switchToDeck(selected.deckName);
    }

    cancel() {
        this.scene.stop();
        this.scene.resume('GameScene');
    }
}

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

                           this.add.text(400, 340, 'Droids destroyed: ' + state.killCount, {
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
    scene: [titleScene, gameScene, endScene, DeckSelectScene]
};

const game = new Phaser.Game(config);

const Debug = {
    nav:        null,   // dynamic enemy-target lines (was debugGraphics)
    navStatic:  null,   // static nav graph (was scene.debugStaticGfx)
    walls:      null,   // wall segments + corners (was scene.debugWallGfx)
    rays:       null,   // 360° raycast test (was scene.debugRayGfx)
    vis:        null,   // visibility polygon (was scene.debugVisGfx)
    nodeLabels: [],     // (was scene.debugNodeLabels)
};


// ─────────────────────────────────────────────
//  LIFT SYSTEM
// ─────────────────────────────────────────────
const Lifts = {
    zones:        [],     // [{zone, x, y, decks:[string]}]
    zoneGroup:    null,   // physics group for overlap detection
    playerOn:     null,   // the lift data object if overlapping, else null
    holdStart:    0,      // timestamp when hold began (0 = not holding)
    progressBg:   null,   // visual feedback — background bar
    progressFill: null,   // visual feedback — fill bar
    inputGated:   false,  // (moved from below — see step A2)
};


// ─────────────────────────────────────────────
//  BULLET POOL
// ─────────────────────────────────────────────
class BulletPool {
    constructor(scene, opts) {
        this.scene       = scene;
        this.textureKey  = opts.textureKey;
        this.defaultSpeed  = opts.defaultSpeed;
        this.defaultDamage = opts.defaultDamage;

        this.group = state.scene.physics.add.group({
            defaultKey: this.textureKey,
                maxSize:    opts.maxSize ?? 30,
        });
    }

    fire(x, y, dx, dy, opts = {}) {
        const bullet = this.group.get(x, y, opts.textureKey ?? this.textureKey);
        if (!bullet) { return null; }

        bullet.setActive(true);
        bullet.setVisible(true);
        bullet.body.enable = true;
        bullet.body.reset(x, y);
        bullet.setData('damage', opts.damage ?? this.defaultDamage);

        const speed = opts.speed ?? this.defaultSpeed;
        const angle = Math.atan2(dy, dx);
        bullet.setVelocityX(Math.cos(angle) * speed);
        bullet.setVelocityY(Math.sin(angle) * speed);

        return bullet;
    }

    deactivate(bullet) {
        bullet.setActive(false);
        bullet.setVisible(false);
        bullet.setVelocity(0);
        bullet.body.enable = false;
    }
}


// ─────────────────────────────────────────────
//  ENEMY CLASS
// ─────────────────────────────────────────────
class Enemy {
    constructor(scene, typeName, x, y, opts = {}) {
        const typeDef = enemyTypes[typeName];
        if (!typeDef) {
            throw new Error('Unknown enemy type: ' + typeName);
        }

        // --- Sprite setup ---
        const sprite = state.scene.physics.add.sprite(x, y, typeName);
        sprite.setAlpha(0);
        sprite.setCollideWorldBounds(true);
        state.scene.physics.add.collider(sprite, state.wallLayer);
        state.enemyGroup.add(sprite);
        sprite.setData('entity', this);

        // --- Nav state ---
        // If a node id was passed in (restored from save), trust it.
        // Otherwise pick the nearest node to our spawn position.
        let nodeId, target;
        if (opts.currentNodeId !== undefined && state.navNodes[opts.currentNodeId]) {
            const n = state.navNodes[opts.currentNodeId];
            nodeId = n.id;
            target = { x: n.x, y: n.y };
        } else {
            const nearest = findNearestNode(x, y);
            nodeId = nearest ? nearest.id : null;
            target = nearest ? { x: nearest.x, y: nearest.y } : null;
        }

        // --- Per-instance fields ---
        this.sprite         = sprite;
        this.typeName       = typeName;
        this.label          = typeDef.label;
        this.hp             = opts.hp ?? typeDef.hp;
        this.contactDamage  = typeDef.contactDamage;
        this.speed          = typeDef.speed;
        this.detectRange    = typeDef.detectRange;
        this.weaponType     = typeDef.weaponType;

        this.currentNodeId  = nodeId;
        this.previousNodeId = opts.previousNodeId ?? null;
        this.nodeTarget     = target;

        this.lastShotTime       = 0;
        this.lastStuckCheckTime = 0;
        this.lastStuckCheckPos  = { x: x, y: y };
        this.bounceCooldown     = 0;
        this.knockbackUntil     = 0;
    }

    update(time) {
        const sprite = this.sprite;

        const los          = hasLineOfSight(state.player.x, state.player.y, sprite.x, sprite.y);
        const distToPlayer = Phaser.Math.Distance.Between(sprite.x, sprite.y, state.player.x, state.player.y);
        const targetAlpha  = los ? 1 : 0;
        sprite.alpha += (targetAlpha - sprite.alpha) * 0.10;
        if (sprite.alpha < 0.01) { sprite.alpha = 0; }

        if (this.nodeTarget === null) {
            sprite.setVelocity(0);
            return;
        }

        if (time < this.knockbackUntil) {
            if (this.weaponType !== null && los && distToPlayer < this.detectRange) {
                enemyShoot(this, time);
            }
            return;
        }

        // ── Stuck detection ──────────────────────────────────────────────
        if (time > this.knockbackUntil && time > this.lastStuckCheckTime + 1000) {
            const movedDist = Phaser.Math.Distance.Between(
                sprite.x, sprite.y,
                this.lastStuckCheckPos.x, this.lastStuckCheckPos.y
            );
            if (movedDist < 8) {
                if (this.previousNodeId !== null) {
                    const prevNode = state.navNodes[this.previousNodeId];
                    this.currentNodeId  = this.previousNodeId;
                    this.previousNodeId = null;
                    this.nodeTarget     = { x: prevNode.x, y: prevNode.y };
                } else {
                    const nearestNode = findNearestNode(sprite.x, sprite.y);
                    if (nearestNode) {
                        this.currentNodeId = nearestNode.id;
                        this.nodeTarget    = { x: nearestNode.x, y: nearestNode.y };
                    }
                }
            }
            this.lastStuckCheckTime = time;
            this.lastStuckCheckPos  = { x: sprite.x, y: sprite.y };
        }

        // ── Arrived at target node? ─────────────────────────────────────
        const distToNode = Phaser.Math.Distance.Between(
            sprite.x, sprite.y, this.nodeTarget.x, this.nodeTarget.y
        );

        if (distToNode < 4) {
            let nextId = null;

            if (this.weaponType !== null) {
                if (los && distToPlayer < this.detectRange) {
                    const playerNode = findNearestNode(state.player.x, state.player.y);
                    if (playerNode) {
                        const path = bfsPath(this.currentNodeId, playerNode.id);
                        if (path && path.length > 0) {
                            nextId = path[0];
                        }
                    }
                }
            }

            if (nextId === null) {
                nextId = pickWanderNode(this);
            }

            if (nextId !== null) {
                this.previousNodeId = this.currentNodeId;
                this.currentNodeId  = nextId;
                this.nodeTarget     = { x: state.navNodes[nextId].x, y: state.navNodes[nextId].y };
            }
        }

        // ── Move toward current target node ──────────────────────────────
        const moveAngle = Phaser.Math.Angle.Between(
            sprite.x, sprite.y, this.nodeTarget.x, this.nodeTarget.y
        );
        sprite.setVelocityX(Math.cos(moveAngle) * this.speed);
        sprite.setVelocityY(Math.sin(moveAngle) * this.speed);

        // ── Ranged attack ────────────────────────────────────────────────
        if (this.weaponType !== null) {
            if (los && distToPlayer < this.detectRange) {
                enemyShoot(this, time);
            }
        }
    }

    serialise() {
        return {
            typeName:       this.typeName,
            x:              this.sprite.x,
            y:              this.sprite.y,
            hp:             this.hp,
            currentNodeId:  this.currentNodeId,
            previousNodeId: this.previousNodeId,
        };
    }
}

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
    state.scene = this;
    state.gameOver = false;
    state.playerEnergy    = (state.playerEnergy > 0) ? state.playerEnergy : PLAYER_MAX_ENERGY;
    state.playerFacing = 0;
    state.enemies         = [];
    state.playerInvincible = false;
    state.lastShotTime     = 0;
    state.rightStickReset  = true;
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
    state.wallLayer      = map.createLayer('Tile Layer 1', tileset, 0, 0);
    state.wallLayer.setCollision(1);
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
    const spawnX = state.playerSpawnPos ? state.playerSpawnPos.x : deckDef.playerStart.x;
    const spawnY = state.playerSpawnPos ? state.playerSpawnPos.y : deckDef.playerStart.y;
    state.playerSpawnPos = null;   // consumed — reset for next time

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
            defaultDamage: 1,           // player bullets do 1 hp damage to enemies
                maxSize:       20,
    });
    this.physics.add.collider(state.playerBullets.group, state.wallLayer, (bullet) => {
        state.playerBullets.deactivate(bullet);
    });

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

    // --- Enemy bullet pool ---
    // We pick blaster as the pool's default texture; per-shot overrides
    // supply heavy_blaster textures when needed.
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
        if (!this.textures.exists(typeKey)) {
            const gfx = this.add.graphics();
            gfx.fillStyle(typeDef.colour, 1);
            gfx.fillCircle(16, 16, 16);
            gfx.generateTexture(typeKey, 32, 32);
            gfx.destroy();
        }
    }

    // --- Enemy group ---
    state.enemyGroup = this.physics.add.group();

    // --- Spawn enemies (fresh or restored) ---
    spawnEnemiesForDeck(state.currentDeck);

    // --- Player-enemy collisions ---
    this.physics.add.collider(state.player, state.enemyGroup, onPlayerEnemyCollide);
    this.physics.add.collider(state.enemyGroup, state.enemyGroup, onEnemyEnemyCollide);
    this.physics.add.overlap(state.playerBullets.group, state.enemyGroup, bulletHitEnemy);

    // --- Lift zones ---
    Lifts.zoneGroup = this.physics.add.staticGroup();
    parseLiftZones(map);
    // --- Arrival: if we came from another deck via lift, snap to the matching lift ---
    if (state.lastDeck) {
        const arrivalLift = Lifts.zones.find(lift => lift.decks.includes(state.lastDeck));
        if (arrivalLift) {
            state.player.setPosition(arrivalLift.x, arrivalLift.y);
            Lifts.inputGated = true;   // don't re-trigger the lift menu we just closed
            console.log('LIFTS: Arrived on ' + state.currentDeck +
            ' at lift connecting to ' + state.lastDeck + '.');
        } else {
            console.warn('LIFTS: No lift on ' + state.currentDeck +
            ' connects back to ' + state.lastDeck +
            ' — falling back to default spawn. Check the "Decks" property on your lifts.');
        }
        state.lastDeck = null;
    }

    // --- Lift progress bar (hidden until needed) ---
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

    // --- HUD ---
    createHUD(this);

    // --- Dark overlay when Deck is shut down ---
    state.fogRT = this.add.renderTexture(0, 0, mapWidth, mapHeight);
    state.fogRT.setDepth(40);          // above gameplay, below HUD (HUD is depth 10-20)
    state.fogRT.setOrigin(0, 0);       // top-left, so world coords map directly

    // --- Cached keyboard keys (one place, populated once per scene) ---
    state.keys = this.input.keyboard.addKeys({
        f:     'F',
        up:    'UP',
        down:  'DOWN',
        enter: 'ENTER',
        esc:   'ESC',
        f1:    'F1',
        f2:    'F2',
        f3:    'F3',
        f4:    'F4',
    });

    // --- Debug nav overlay ---
    Debug.nav = this.add.graphics();
    Debug.nav.setDepth(50);
    drawDebugNavStatic();
    drawDebugWallSegments();
    Debug.rays = state.scene.add.graphics();
    Debug.rays.setDepth(48);
    Debug.rays.setVisible(false);
    Debug.vis = state.scene.add.graphics();
    Debug.vis.setDepth(47);
    Debug.vis.setVisible(false);
    // --- Re-apply shutdown dim if this deck was already cleared ---
    if (state.deckStates[state.currentDeck] && state.deckStates[state.currentDeck].cleared) {
        applyDeckDim();
    }
}

// ─────────────────────────────────────────────
//  UPDATE  (called every frame)
// ─────────────────────────────────────────────
function update(time) {
    if (state.gameOver) { return; }

    state.player.setVelocity(0);

    // --- Player movement ---
    const cursors = this.input.keyboard.createCursorKeys();
    const pad     = this.input.gamepad.getPad(0);
    const DEAD_ZONE = 0.15;

    if (pad) {
        if (Math.abs(pad.leftStick.x) > DEAD_ZONE) { state.player.setVelocityX(pad.leftStick.x * PLAYER_SPEED); }
        if (Math.abs(pad.leftStick.y) > DEAD_ZONE) { state.player.setVelocityY(pad.leftStick.y * PLAYER_SPEED); }
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
        state.playerFacing = Math.atan2(rsy, rsx);
    } else if (lsOut) {
        state.playerFacing = Math.atan2(pad.leftStick.y, pad.leftStick.x);
    }

    // Firing logic — only when the deck still has power
    if (!isDeckCleared()) {
        let aimX = 0, aimY = 0;
        if (!rsOut) {
            state.rightStickReset = true;
        } else if (state.rightStickReset) {
            aimX = rsx;
            aimY = rsy;
        }

        if ((aimX !== 0 || aimY !== 0) && time > state.lastShotTime + BULLET_COOLDOWN) {
            fireBullet(state.player.x, state.player.y, aimX, aimY);
            state.lastShotTime = time;
            state.rightStickReset = false;
        }
    }

    // --- Lift hold-to-activate ---
    updateLiftHold(time, pad);

    // --- Enemy AI ---
    for (const enemy of state.enemies) {
        enemy.update(time);
    }

    // --- Debug toggle ---
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

        const zone = state.scene.add.zone(cx, cy, w, h);
        state.scene.physics.add.existing(zone, true);  // true = static body
        Lifts.zoneGroup.add(zone);

        // Draw a subtle visual indicator so the player knows a lift is here
        const indicator = state.scene.add.graphics();
        indicator.lineStyle(2, 0x44aaff, 0.6);
        indicator.strokeRect(obj.x, obj.y, w, h);
        indicator.fillStyle(0x44aaff, 0.15);
        indicator.fillRect(obj.x, obj.y, w, h);

        const liftLabel = state.scene.add.text(cx, obj.y - 8, 'LIFT', {
            fontFamily: 'monospace', fontSize: '8px', fill: '#44aaff'
        }).setOrigin(0.5, 1);

        const liftData = {
            zone:  zone,
            x:     cx,
            y:     cy,
            decks: connectedDecks,
        };
        Lifts.zones.push(liftData);
    }

    console.log('LIFTS: Parsed ' + Lifts.zones.length + ' lift zone(s) on ' + state.currentDeck + '.');
}

// Checks player overlap against all lift zones directly (no callback timing issues)
function findPlayerLiftOverlap() {
    const pb = state.player.getBounds();
    for (const lift of Lifts.zones) {
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
    const DEAD_ZONE = 0.15;
    let holdInput = false;

    if (pad) {
        const RSX = pad.rightStick.x;
        const RSY = pad.rightStick.y;
        holdInput = (Math.abs(RSX) > DEAD_ZONE || Math.abs(RSY) > DEAD_ZONE);
    }

    if (state.keys.f.isDown) { holdInput = true; }

    // If we just arrived via lift, wait for the player to release the stick
    // before we start counting a new hold.
    if (Lifts.inputGated) {
        if (!holdInput) { Lifts.inputGated = false; }
        Lifts.playerOn = null;
        return;
    }

    Lifts.playerOn = findPlayerLiftOverlap();

    if (Lifts.playerOn && holdInput) {
        if (Lifts.holdStart === 0) {
            Lifts.holdStart = time;
        }

        const elapsed  = time - Lifts.holdStart;
        const progress = Math.min(elapsed / LIFT_HOLD_MS, 1);

        const barW = 120;
        const barH = 10;
        const barX = (800 - barW) / 2;
        const barY = 560;

        Lifts.progressBg.setVisible(true);
        Lifts.progressBg.clear();
        Lifts.progressBg.fillStyle(0x222244, 0.8);
        Lifts.progressBg.fillRect(barX, barY, barW, barH);

        Lifts.progressFill.setVisible(true);
        Lifts.progressFill.clear();
        Lifts.progressFill.fillStyle(0x44aaff, 1);
        Lifts.progressFill.fillRect(barX, barY, Math.round(barW * progress), barH);

        if (progress >= 1) {
            Lifts.holdStart = 0;
            Lifts.progressBg.setVisible(false);
            Lifts.progressFill.setVisible(false);
            showDeckSelection(Lifts.playerOn);
        }
    } else {
        if (Lifts.holdStart !== 0) {
            Lifts.holdStart = 0;
            Lifts.progressBg.setVisible(false);
            Lifts.progressFill.setVisible(false);
        }
    }
}


// ─────────────────────────────────────────────
//  DECK SELECTION SCREEN
// ─────────────────────────────────────────────
function showDeckSelection(liftData) {
    state.scene.scene.pause();
    state.scene.scene.launch('DeckSelectScene', { lift: liftData });
}


// ─────────────────────────────────────────────
//  DECK SWITCHING
// ─────────────────────────────────────────────
function switchToDeck(targetDeck) {
    saveDeckState(state.currentDeck);
    state.lastDeck       = state.currentDeck;   // remember source so create() can snap to a matching lift
    state.playerSpawnPos = null;
    state.currentDeck    = targetDeck;
    state.scene.scene.restart();
}

// ─────────────────────────────────────────────
//  DECK STATE — save / restore
// ─────────────────────────────────────────────
function saveDeckState(deckName) {
    const saved = state.enemies.map(e => e.serialise());

    const wasCleared = state.deckStates[deckName] && state.deckStates[deckName].cleared;
    state.deckStates[deckName] = {
        enemies: saved,
        cleared: wasCleared || false,
    };

    console.log('STATE: Saved ' + saved.length + ' enemy(s) for ' + deckName + '.');
}

function restoreEnemiesFromState(state) {
    for (const saved of state.enemies) {
        if (!enemyTypes[saved.typeName]) { continue; }

        state.enemies.push(new Enemy(state.scene, saved.typeName, saved.x, saved.y, {
            hp:             saved.hp,
            currentNodeId:  saved.currentNodeId,
            previousNodeId: saved.previousNodeId,
        }));
    }
}

function spawnFreshEnemies(enemyDefs) {
    for (const def of enemyDefs) {
        if (!enemyTypes[def.type]) {
            console.warn('Unknown enemy type "' + def.type + '" — skipping.');
            continue;
        }

        const x = def.startTile.x * TILE_SIZE + TILE_SIZE / 2;
        const y = def.startTile.y * TILE_SIZE + TILE_SIZE / 2;

        state.enemies.push(new Enemy(state.scene, def.type, x, y));
    }
}

// Decides whether to restore saved state or spawn fresh
function spawnEnemiesForDeck(deckName) {
    if (state.deckStates[deckName]) {
        console.log('STATE: Restoring saved enemies for ' + deckName + '.');
        restoreEnemiesFromState(state.deckStates[deckName]);
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

    state.scene.add.text(BAR_X, BAR_Y, 'ENERGY', {
        fontFamily: 'monospace',
        fontSize:   '10px',
        fill:       '#aaffcc'
    }).setScrollFactor(0).setDepth(50);

    const barBg = state.scene.add.graphics();
    barBg.fillStyle(0x222233, 1);
    barBg.fillRect(BAR_X, BAR_Y + 12, ENERGY_BAR_WIDTH, ENERGY_BAR_HEIGHT);
    barBg.setScrollFactor(0).setDepth(50);

    state.energyBarFill = state.scene.add.graphics();
    state.energyBarFill.setScrollFactor(0).setDepth(51);

    state.killText = state.scene.add.text(BAR_X, BAR_Y + 32, 'Destroyed: 0', {
        fontFamily: 'monospace',
        fontSize:   '12px',
        fill:       '#aaffcc'
    });
    state.killText.setScrollFactor(0).setDepth(50);

    // Deck name label
    const deckDef = deckDefinitions[state.currentDeck];
    state.deckLabel = state.scene.add.text(800 - 12, 12, deckDef ? deckDef.label : state.currentDeck, {
        fontFamily: 'monospace',
        fontSize:   '11px',
        fill:       '#44aaff',
        align:      'right'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(50);

    updateHUD();
}

function updateHUD() {
    const pct = state.playerEnergy / PLAYER_MAX_ENERGY;

    let colour;
    if      (pct > 0.5) { colour = 0x00dd55; }
    else if (pct > 0.25){ colour = 0xffcc00; }
    else                { colour = 0xff2244; }

    state.energyBarFill.clear();
    state.energyBarFill.fillStyle(colour, 1);
    state.energyBarFill.fillRect(12, 24, Math.round(ENERGY_BAR_WIDTH * pct), ENERGY_BAR_HEIGHT);

    state.killText.setText('Destroyed: ' + state.killCount);
}

// ─────────────────────────────────────────────
//  PLAYER ↔ ENEMY COLLISION
// ─────────────────────────────────────────────
function onPlayerEnemyCollide(playerSprite, enemySprite) {
    const enemy = enemySprite.getData('entity');
    if (!enemy) { return; }

    const wasInvincible = state.playerInvincible;
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

            enemy.knockbackUntil = state.scene.time.now + 150;
            reverseEnemyCourse(enemy);
        }
    }
}

// ─────────────────────────────────────────────
//  ENEMY ↔ ENEMY COLLISION
// ─────────────────────────────────────────────
function onEnemyEnemyCollide(spriteA, spriteB) {
    const enemyA = spriteA.getData('entity');
    const enemyB = spriteB.getData('entity');
    if (!enemyA || !enemyB) { return; }

    const now = state.scene.time.now;
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
    state.enemyBullets.deactivate(bullet);
    applyDamageToPlayer(damage);
}

// ─────────────────────────────────────────────
//  PLAYER DAMAGE — shared logic
// ─────────────────────────────────────────────
function applyDamageToPlayer(damage) {
    if (state.playerInvincible) { return; }

    state.playerEnergy = Math.max(0, state.playerEnergy - damage);
    updateHUD();

    if (state.playerEnergy <= 0) {
        triggerGameOver();
        return;
    }

    state.playerInvincible = true;

    state.scene.tweens.add({
        targets:    state.player,
        alpha:      0.2,
        duration:   100,
        yoyo:       true,
        repeat:     5,
        onComplete: () => { state.player.setAlpha(1); }
    });

    state.scene.time.delayedCall(INVINCIBILITY_MS, () => {
        state.playerInvincible = false;
    });
}

// ─────────────────────────────────────────────
//  GAME OVER
// ─────────────────────────────────────────────
function triggerGameOver() {
    state.gameOver = true;
    state.player.setVelocity(0);
    state.player.setAlpha(0.3);

    for (const enemy of state.enemies) { enemy.sprite.setVelocity(0); }

    state.scene.time.delayedCall(1200, () => {
        state.scene.scene.start('EndScene', { result: 'lost' });
    });
}

// ─────────────────────────────────────────────
//  PLAYER BULLETS
// ─────────────────────────────────────────────
function fireBullet(x, y, dx, dy) {
    state.playerBullets.fire(x, y, dx, dy);
}

function bulletHitEnemy(bullet, enemySprite) {
    const damage = bullet.getData('damage') ?? 1;
    state.playerBullets.deactivate(bullet);

    const enemy = enemySprite.getData('entity');
    if (!enemy) { return; }

    enemy.hp--;

    if (enemy.hp <= 0) {
        state.enemies = state.enemies.filter(e => e !== enemy);

        enemySprite.setActive(false);
        enemySprite.setVisible(false);
        enemySprite.body.enable = false;

        state.killCount++;
        updateHUD();

        state.scene.time.delayedCall(100, () => {
            enemySprite.destroy();
        });
        checkDeckClearance();
    } else {
        state.scene.tweens.add({
            targets:  enemySprite,
            alpha:    0.3,
            duration: 60,
            yoyo:     true
        });
    }
}

// ─────────────────────────────────────────────
//  ENEMY BULLETS
// ─────────────────────────────────────────────
function enemyShoot(enemy, time) {
    const weaponDef = weaponTypes[enemy.weaponType];
    if (!weaponDef) { return; }

    if (time < enemy.lastShotTime + weaponDef.cooldown) { return; }
    enemy.lastShotTime = time;

    const dx = state.player.x - enemy.sprite.x;
    const dy = state.player.y - enemy.sprite.y;

    state.enemyBullets.fire(enemy.sprite.x, enemy.sprite.y, dx, dy, {
        textureKey: 'ebullet_' + enemy.weaponType,
        speed:      weaponDef.bulletSpeed,
        damage:     weaponDef.damage,
    });
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
            const tile    = state.wallLayer.getTileAtWorldXY(sampleX, sampleY);
            if (tile && tile.collides) { return false; }
        }
    }
    return true;
}

// ─────────────────────────────────────────────
//  NAV GRAPH — build from Tiled object layer
// ─────────────────────────────────────────────
function buildNavGraph(map) {
    state.navNodes = [];

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
        state.navNodes.push({ id: index, x: obj.x, y: obj.y, neighbours: [] });
    });

    console.log('NAV: Found ' + state.navNodes.length + ' waypoint objects.');

    for (let i = 0; i < state.navNodes.length; i++) {
        for (let j = i + 1; j < state.navNodes.length; j++) {
            const a    = state.navNodes[i];
            const b    = state.navNodes[j];
            const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
            if (dist <= NODE_CONNECT_DIST && hasLineOfSight(a.x, a.y, b.x, b.y)) {
                a.neighbours.push(b.id);
                b.neighbours.push(a.id);
            }
        }
    }

    const totalLinks = state.navNodes.reduce((sum, n) => sum + n.neighbours.length, 0) / 2;
    console.log('NAV: Graph built — ' + state.navNodes.length + ' nodes, ' + totalLinks + ' connections.');

    if (totalLinks === 0 && state.navNodes.length > 1) {
        console.warn('NAV: No connections formed! Nodes may be more than ' + NODE_CONNECT_DIST + 'px apart, or walls are blocking LOS.');
    }
}

// ─────────────────────────────────────────────
//  NAV GRAPH — helpers
// ─────────────────────────────────────────────
function findNearestNode(x, y) {
    let best     = null;
    let bestDist = Infinity;
    for (const node of state.navNodes) {
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

        for (const neighbourId of state.navNodes[current].neighbours) {
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
    const node = state.navNodes[enemy.currentNodeId];
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
        const prevNode = state.navNodes[enemy.previousNodeId];
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
    return !!(state.deckStates[state.currentDeck] && state.deckStates[state.currentDeck].cleared);
}

function areAllDecksCleared() {
    for (const deckName of Object.keys(deckDefinitions)) {
        const def = deckDefinitions[deckName];
        // Decks with no enemies don't count — they can never be "cleared".
        if (!def.enemies || def.enemies.length === 0) { continue; }
        if (!state.deckStates[deckName] || !state.deckStates[deckName].cleared) {
            return false;
        }
    }
    return true;
}

// ─────────────────────────────────────────────
//  DECK SHUTDOWN — "lights out" when a deck is cleared
// ─────────────────────────────────────────────
function applyDeckDim() {
    state.wallLayer.forEachTile(tile => {
        const isLight = tile.properties && tile.properties.light;
        tile.tint = isLight ? 0xffffff : DIM_COLOUR;
    });
}

function checkDeckClearance() {
    // Already shut down? Nothing to do.
    if (state.deckStates[state.currentDeck] && state.deckStates[state.currentDeck].cleared) { return; }

    // Still enemies alive? Nothing to do.
    if (state.enemies.length > 0) { return; }

    // Did this deck originally have enemies? If it started empty, don't trigger.
    const deckDef = deckDefinitions[state.currentDeck];
    if (!deckDef || !deckDef.enemies || deckDef.enemies.length === 0) { return; }

    triggerDeckShutdown();

    // Was that the last deck with enemies on it?
    if (areAllDecksCleared()) {
        state.scene.time.delayedCall(2500, () => {
            state.scene.scene.start('EndScene', { result: 'won' });
        });
    }
}

function triggerDeckShutdown() {
    // Persist the cleared flag so it survives lifts, saves and restores.
    if (!state.deckStates[state.currentDeck]) {
        state.deckStates[state.currentDeck] = { enemies: [] };
    }
    state.deckStates[state.currentDeck].cleared = true;

    applyDeckDim();
    showDeckClearedMessage();

    console.log('SHUTDOWN: ' + state.currentDeck + ' cleared — lights out.');
}

function showDeckClearedMessage() {
    const msg = state.scene.add.text(400, 260, 'DECK POWER DOWN', {
        fontFamily: 'monospace', fontSize: '32px',
        fill: '#44aaff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(55).setAlpha(0);

    state.scene.tweens.add({
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
    state.wallSegments = [];
    const W = state.wallLayer.width;   // map width  in tiles
    const H = state.wallLayer.height;  // map height in tiles

    for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
            if (!isWallTile(state.wallLayer, tx, ty)) { continue; }

            const left   = tx * TILE_SIZE;
            const top    = ty * TILE_SIZE;
            const right  = left + TILE_SIZE;
            const bottom = top  + TILE_SIZE;

            // Only emit an edge if the neighbour on that side is NOT a wall.
            // This keeps the interior wall-to-wall seams out of the segment list.
            if (!isWallTile(state.wallLayer, tx, ty - 1)) {
                state.wallSegments.push({ x1: left,  y1: top,    x2: right, y2: top    });
            }
            if (!isWallTile(state.wallLayer, tx + 1, ty)) {
                state.wallSegments.push({ x1: right, y1: top,    x2: right, y2: bottom });
            }
            if (!isWallTile(state.wallLayer, tx, ty + 1)) {
               state.wallSegments.push({ x1: left,  y1: bottom, x2: right, y2: bottom });
            }
            if (!isWallTile(state.wallLayer, tx - 1, ty)) {
                state.wallSegments.push({ x1: left,  y1: top,    x2: left,  y2: bottom });
            }
        }
    }
}

function extractWallCorners() {
    state.wallCorners = [];
    const W = state.wallLayer.width;
    const H = state.wallLayer.height;

    // Grid vertices: one more in each dimension than there are tiles
    for (let vy = 0; vy <= H; vy++) {
        for (let vx = 0; vx <= W; vx++) {
            // The four tiles meeting at this vertex
            const tl = isWallTile(state.wallLayer, vx - 1, vy - 1);
            const tr = isWallTile(state.wallLayer, vx,     vy - 1);
            const bl = isWallTile(state.wallLayer, vx - 1, vy);
            const br = isWallTile(state.wallLayer, vx,     vy);

            const count = (tl?1:0) + (tr?1:0) + (bl?1:0) + (br?1:0);

            // Interior of open space or interior of solid wall — skip
            if (count === 0 || count === 4) { continue; }

            // Exactly 2 walls — only keep if they're diagonal
            if (count === 2) {
                const diagonal = (tl && br) || (tr && bl);
                if (!diagonal) { continue; }   // straight edge, no corner
            }

            // 1, 3, or diagonal-2 → real corner
            state.wallCorners.push({ x: vx * TILE_SIZE, y: vy * TILE_SIZE });
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

    for (const seg of state.wallSegments) {
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
    for (const seg of state.wallSegments) {
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
    for (const c of state.wallCorners) {
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

function updateFogOfWar() {
    if (!state.fogRT) { return; }

    // Lights only out when the deck has been cleared
    if (!isDeckCleared()) {
        state.fogRT.setVisible(false);
        return;
    }
    state.fogRT.setVisible(true);

    state.fogRT.clear();
    state.fogRT.fill(FOG_COLOUR, FOG_DARKNESS);

    // Outer → inner. Each pass erases a smaller cone on top of the
    // previous one, so alpha removal accumulates toward the centre.
    const ranges = [
        LIGHT_MAX_RANGE,
        LIGHT_MAX_RANGE * 2 / 3,
        LIGHT_MAX_RANGE * 1 / 3,
    ];

    for (const range of ranges) {
        const poly = computeConeVisibilityPolygon(
            state.player.x, state.player.y, state.playerFacing, CONE_HALF_ANGLE, range
        );
        if (poly.length < 3) { continue; }

        const eraseGfx = state.scene.make.graphics({ x: 0, y: 0 }, false);
        eraseGfx.fillStyle(0xffffff, LIGHT_BAND_ERASE_ALPHA);
        eraseGfx.beginPath();
        eraseGfx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
            eraseGfx.lineTo(poly[i].x, poly[i].y);
        }
        eraseGfx.closePath();
        eraseGfx.fillPath();

        state.fogRT.erase(eraseGfx);
        eraseGfx.destroy();
    }
}

// ─────────────────────────────────────────────
//  DEBUG — Draw wall boundaries for lights Raycasting
// ─────────────────────────────────────────────
function drawDebugWallSegments() {
    const gfx = state.scene.add.graphics();
    gfx.setDepth(49);

    // Segments — bright magenta so they stand out against any deck tint
    gfx.lineStyle(1.5, 0xff00ff, 0.9);
    for (const seg of state.wallSegments) {
        gfx.beginPath();
        gfx.moveTo(seg.x1, seg.y1);
        gfx.lineTo(seg.x2, seg.y2);
        gfx.strokePath();
    }

    // Corner dots — only the real corners we cast rays at
    gfx.fillStyle(0xff8800, 1);
    for (const c of state.wallCorners) {
        gfx.fillCircle(c.x, c.y, 3);
    }

    gfx.setVisible(false);
    Debug.walls = gfx;
}
// ─────────────────────────────────────────────
//  DEBUG — Draw 360 light raycasting test
// ─────────────────────────────────────────────
function drawDebugRays() {
    const gfx = Debug.rays;
    gfx.clear();

    const RAYS = 64;
    gfx.lineStyle(1, 0xffee00, 0.6);
    for (let i = 0; i < RAYS; i++) {
        const angle = (i / RAYS) * Math.PI * 2;
        const hit   = castRay(state.player.x, state.player.y, angle);
        gfx.beginPath();
        gfx.moveTo(state.player.x, state.player.y);
        gfx.lineTo(hit.x, hit.y);
        gfx.strokePath();
    }
}
// ─────────────────────────────────────────────
//  DEBUG — Draw light cone test
// ─────────────────────────────────────────────
function drawDebugVisibilityPolygon() {
    const gfx = Debug.vis;
    gfx.clear();

    const poly = computeVisibilityPolygon(state.player.x, state.player.y);
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
    const staticGfx = state.scene.add.graphics();
    staticGfx.setDepth(50);

    Debug.nodeLabels = [];

    staticGfx.lineStyle(2, 0x00ff88, 0.85);
    for (const node of state.navNodes) {
        for (const neighbourId of node.neighbours) {
            if (neighbourId > node.id) {
                staticGfx.beginPath();
                staticGfx.moveTo(node.x, node.y);
                staticGfx.lineTo(state.navNodes[neighbourId].x, state.navNodes[neighbourId].y);
                staticGfx.strokePath();
            }
        }
        staticGfx.fillStyle(0x00ccff, 0.85);
        staticGfx.fillCircle(node.x, node.y, 5);

        const label = state.scene.add.text(node.x + 6, node.y - 6, String(node.id), {
            fontFamily: 'monospace',
            fontSize:   '9px',
            fill:       '#00ccff'
        }).setDepth(51).setVisible(false);
        Debug.nodeLabels.push(label);
    }
    staticGfx.setVisible(false);
    Debug.nav.setVisible(false);
    Debug.navStatic = staticGfx;
}

function drawDebugNavDynamic() {
    if (!Debug.nav.visible) { return; }
    Debug.nav.clear();
    for (const enemy of state.enemies) {
        if (!enemy.nodeTarget) { continue; }
        Debug.nav.lineStyle(4, 0xffee00, 0.9);
        Debug.nav.beginPath();
        Debug.nav.moveTo(enemy.sprite.x, enemy.sprite.y);
        Debug.nav.lineTo(enemy.nodeTarget.x, enemy.nodeTarget.y);
        Debug.nav.strokePath();
        Debug.nav.fillStyle(0xffee00, 1);
        Debug.nav.fillCircle(enemy.nodeTarget.x, enemy.nodeTarget.y, 7);
    }
}
