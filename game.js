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
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

let player;
let cursors;
let wasdKeys;
let wallLayer;
let enemies = [];
let bullets;
let enemyGroup;           // Physics group so we can detect player-enemy collisions easily
let rightStickReset = true;
let scene;

// --- HUD ---
let energyBarFill;        // The coloured rectangle that shrinks as energy falls
let killText;             // Text showing how many enemies have been destroyed
let killCount = 0;

// --- Player energy ---
let playerEnergy;
const PLAYER_MAX_ENERGY = 100;
const ENERGY_BAR_WIDTH  = 150;    // Pixel width of a full bar
const ENERGY_BAR_HEIGHT = 14;
let playerInvincible    = false;  // True during the brief grace period after a hit
const INVINCIBILITY_MS  = 1200;   // How long the grace period lasts (milliseconds)

// --- Damage values ---
const ENEMY_BULLET_DAMAGE = 20;   // Damage dealt when an enemy bullet hits the player

// --- Game state ---
let gameOver = false;
let gameOverText;
let restartText;

const TILE_SIZE       = 32;
const PLAYER_SPEED    = 200;
const BULLET_SPEED    = 400;
const BULLET_COOLDOWN = 200;

let lastShotTime = 0;

// ─────────────────────────────────────────────
//  ENEMY TYPE CATALOGUE
// ─────────────────────────────────────────────
// This is the master list of every robot class in the game.
// To add a new type, add an entry here — nothing else needs changing.
//
// Fields:
//   label        - human-readable name (used in future UI / debug)
//   colour       - hex colour for the procedurally-generated sprite
//   speed        - movement speed in pixels per second
//   detectRange  - how close the player must be (in pixels) before this
//                  robot notices them and switches from PATROL to CHASE
//   hp           - number of bullet hits needed to destroy
//   contactDamage- player energy lost when bumping into this robot
//   weaponType   - null (unarmed) or a string naming the weapon.
//                  Unarmed robots flee or ignore the player when chasing;
//                  armed robots will shoot (logic added in a later step).
//                  Weapon strings defined so far:
//                    'blaster'       — single shot, moderate fire rate
//                    'heavy_blaster' — single shot, slow fire rate, more damage
//
const enemyTypes = {

    // ── Tier 0 ── Civilian / maintenance ──────────────────────────────────
    cleaner: {
        label:         'Cleaning Bot',
        colour:        0x88ccff,   // pale blue
        speed:         55,
        detectRange:   80,         // barely notices the player
        hp:            1,
        contactDamage: 5,
        weaponType:    null,
    },

    // ── Tier 1 ── Basic security ───────────────────────────────────────────
    patrol_drone: {
        label:         'Patrol Drone',
        colour:        0xff8800,   // orange
        speed:         100,
        detectRange:   180,
        hp:            2,
        contactDamage: 10,
        weaponType:    null,       // rams the player, no ranged attack
    },

    security_light: {
        label:         'Security Droid (Light)',
        colour:        0xff3300,   // red-orange
        speed:         120,
        detectRange:   220,
        hp:            2,
        contactDamage: 15,
        weaponType:    'blaster',
    },

    // ── Tier 2 ── Heavy security ───────────────────────────────────────────
    security_heavy: {
        label:         'Security Droid (Heavy)',
        colour:        0xcc00ff,   // purple
        speed:         75,         // slower but very tough
        detectRange:   260,
        hp:            4,
        contactDamage: 25,
        weaponType:    'heavy_blaster',
    },
};

// ─────────────────────────────────────────────
//  LEVEL LAYOUT  — enemy placements
// ─────────────────────────────────────────────
// Each entry says which type to spawn and where it patrols.
// All stats come from enemyTypes above; nothing is duplicated here.
//
//   type       - must match a key in enemyTypes exactly
//   startTile  - tile the robot spawns on
//   waypointA  - first patrol waypoint (tile coordinates)
//   waypointB  - second patrol waypoint (tile coordinates)
//
const enemyDefinitions = [
    { type: 'cleaner',        startTile: {x: 4,  y: 2},  waypointA: {x: 4,  y: 2},  waypointB: {x: 20, y: 2}  },
{ type: 'cleaner',        startTile: {x: 4,  y: 17}, waypointA: {x: 4,  y: 17}, waypointB: {x: 20, y: 17} },
{ type: 'patrol_drone',   startTile: {x: 12, y: 8},  waypointA: {x: 12, y: 8},  waypointB: {x: 16, y: 8}  },
{ type: 'security_light', startTile: {x: 1,  y: 10}, waypointA: {x: 1,  y: 10}, waypointB: {x: 9,  y: 10} },
];

// ─────────────────────────────────────────────
//  PRELOAD
// ─────────────────────────────────────────────
function preload() {
    this.load.tilemapTiledJSON('level1', 'assets/level1.tmj');
    this.load.image('tiles', 'assets/poc_tiles.png');
}

// ─────────────────────────────────────────────
//  CREATE
// ─────────────────────────────────────────────
function create() {
    scene = this;
    gameOver = false;
    playerEnergy = PLAYER_MAX_ENERGY;
    killCount = 0;
    enemies = [];

    // --- Tilemap ---
    const map      = this.make.tilemap({ key: 'level1' });
    const tileset  = map.addTilesetImage('tiles', 'tiles');
    wallLayer      = map.createLayer('Tile Layer 1', tileset, 0, 0);
    wallLayer.setCollision(1);

    // --- Player texture ---
    const playerGfx = this.add.graphics();
    playerGfx.fillStyle(0x00ff99, 1);
    playerGfx.fillCircle(16, 16, 16);
    playerGfx.generateTexture('player', 32, 32);
    playerGfx.destroy();

    player = this.physics.add.sprite(48, 48, 'player');
    player.setCollideWorldBounds(true);
    this.physics.add.collider(player, wallLayer);

    // --- Bullet texture ---
    const bulletGfx = this.add.graphics();
    bulletGfx.fillStyle(0xffee00, 1);
    bulletGfx.fillCircle(4, 4, 4);
    bulletGfx.generateTexture('bullet', 8, 8);
    bulletGfx.destroy();

    // --- Bullet group ---
    bullets = this.physics.add.group({
        defaultKey: 'bullet',
            maxSize: 20,
            runChildUpdate: true
    });
    this.physics.add.collider(bullets, wallLayer, bulletHitWall);

    // --- Generate one texture per enemy type ---
    // We only need to do this once.  Each texture is named after its type key
    // (e.g. 'cleaner', 'security_light') so sprites can reference it by name.
    for (const [typeKey, typeDef] of Object.entries(enemyTypes)) {
        const gfx = this.add.graphics();
        gfx.fillStyle(typeDef.colour, 1);
        gfx.fillCircle(16, 16, 16);
        gfx.generateTexture(typeKey, 32, 32);
        gfx.destroy();
    }

    // --- Enemy group ---
    enemyGroup = this.physics.add.group();

    // --- Spawn enemies ---
    for (const def of enemyDefinitions) {

        // Look up this placement's type in the catalogue.
        // If the type string is wrong, warn the developer clearly.
        const typeDef = enemyTypes[def.type];
        if (!typeDef) {
            console.warn(`Unknown enemy type "${def.type}" in enemyDefinitions — skipping.`);
            continue;
        }

        const startX = def.startTile.x * TILE_SIZE + TILE_SIZE / 2;
        const startY = def.startTile.y * TILE_SIZE + TILE_SIZE / 2;

        // Use the type key as the texture name (generated above)
        const sprite = this.physics.add.sprite(startX, startY, def.type);
        sprite.setCollideWorldBounds(true);
        this.physics.add.collider(sprite, wallLayer);
        enemyGroup.add(sprite);

        // Build the live enemy object by copying stats from the type catalogue.
        // This is the object the game logic works with at runtime.
        enemies.push({
            sprite:        sprite,
            typeName:      def.type,          // handy for debugging
            label:         typeDef.label,
            state:         'PATROL',
            waypointA:     tileToPixel(def.waypointA),
                     waypointB:     tileToPixel(def.waypointB),
                     target:        tileToPixel(def.waypointB),
                     // --- stats copied from the type ---
                     hp:            typeDef.hp,
                     contactDamage: typeDef.contactDamage,
                     speed:         typeDef.speed,
                     detectRange:   typeDef.detectRange,
                     weaponType:    typeDef.weaponType,
                     // --- per-instance shooting state (used when weaponType != null) ---
                     lastShotTime:  0,
        });

        this.physics.add.overlap(bullets, sprite, bulletHitEnemy);
    }

    // --- Player-enemy contact damage ---
    this.physics.add.overlap(player, enemyGroup, playerTouchedByEnemy);

    // --- Camera ---
    const mapWidth  = map.widthInPixels;
    const mapHeight = map.heightInPixels;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(player, true, 0.08, 0.08);

    // --- Input ---
    cursors  = this.input.keyboard.createCursorKeys();
    wasdKeys = this.input.keyboard.addKeys({
        up:    Phaser.Input.Keyboard.KeyCodes.W,
        down:  Phaser.Input.Keyboard.KeyCodes.S,
        left:  Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
    });

    // --- HUD ---
    createHUD(this);
}

// ─────────────────────────────────────────────
//  UPDATE  (called every frame)
// ─────────────────────────────────────────────
function update(time) {
    if (gameOver) { return; }

    player.setVelocity(0);

    // --- Movement ---
    const pad       = this.input.gamepad.getPad(0);
    const DEAD_ZONE = 0.15;

    if (wasdKeys.left.isDown)  { player.setVelocityX(-PLAYER_SPEED); }
    if (wasdKeys.right.isDown) { player.setVelocityX(PLAYER_SPEED);  }
    if (wasdKeys.up.isDown)    { player.setVelocityY(-PLAYER_SPEED); }
    if (wasdKeys.down.isDown)  { player.setVelocityY(PLAYER_SPEED);  }

    if (pad) {
        if (Math.abs(pad.leftStick.x) > DEAD_ZONE) { player.setVelocityX(pad.leftStick.x * PLAYER_SPEED); }
        if (Math.abs(pad.leftStick.y) > DEAD_ZONE) { player.setVelocityY(pad.leftStick.y * PLAYER_SPEED); }
    }

    // --- Aiming and shooting ---
    let aimX = 0;
    let aimY = 0;

    if (cursors.left.isDown)  { aimX = -1; }
    if (cursors.right.isDown) { aimX =  1; }
    if (cursors.up.isDown)    { aimY = -1; }
    if (cursors.down.isDown)  { aimY =  1; }

    if (pad) {
        const RSX      = pad.rightStick.x;
        const RSY      = pad.rightStick.y;
        const stickOut = Math.abs(RSX) > DEAD_ZONE || Math.abs(RSY) > DEAD_ZONE;
        if (!stickOut) {
            rightStickReset = true;
        } else if (rightStickReset) {
            aimX = RSX;
            aimY = RSY;
        }
    }

    if ((aimX !== 0 || aimY !== 0) && time > lastShotTime + BULLET_COOLDOWN) {
        fireBullet(player.x, player.y, aimX, aimY);
        lastShotTime = time;
        rightStickReset = false;
    }

    // --- Enemy AI ---
    for (const enemy of enemies) {
        updateEnemy(enemy, time);
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
    }).setScrollFactor(0).setDepth(10);

    const barBg = scene.add.graphics();
    barBg.fillStyle(0x222233, 1);
    barBg.fillRect(BAR_X, BAR_Y + 12, ENERGY_BAR_WIDTH, ENERGY_BAR_HEIGHT);
    barBg.setScrollFactor(0).setDepth(10);

    energyBarFill = scene.add.graphics();
    energyBarFill.setScrollFactor(0).setDepth(11);

    killText = scene.add.text(BAR_X, BAR_Y + 32, 'Destroyed: 0', {
        fontFamily: 'monospace',
        fontSize:   '12px',
        fill:       '#aaffcc'
    });
    killText.setScrollFactor(0).setDepth(10);

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
//  PLAYER DAMAGE
// ─────────────────────────────────────────────
function playerTouchedByEnemy(playerSprite, enemySprite) {
    if (playerInvincible) { return; }

    const enemy  = enemies.find(e => e.sprite === enemySprite);
    const damage = enemy ? enemy.contactDamage : 10;

    playerEnergy = Math.max(0, playerEnergy - damage);
    updateHUD();

    if (playerEnergy <= 0) {
        triggerGameOver();
        return;
    }

    playerInvincible = true;

    scene.tweens.add({
        targets:    playerSprite,
        alpha:      0.2,
        duration:   100,
        yoyo:       true,
        repeat:     5,
        onComplete: () => { playerSprite.setAlpha(1); }
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

    for (const enemy of enemies) {
        enemy.sprite.setVelocity(0);
    }

    const camX = scene.cameras.main.scrollX;
    const camY = scene.cameras.main.scrollY;
    const cx    = camX + 400;
    const cy    = camY + 300;

    gameOverText = scene.add.text(cx, cy - 40, 'GAME OVER', {
        fontFamily: 'monospace',
        fontSize:   '48px',
        fill:       '#ff2244',
        stroke:     '#000000',
        strokeThickness: 4
    }).setOrigin(0.5).setDepth(20);

    restartText = scene.add.text(cx, cy + 20, 'Press R to restart', {
        fontFamily: 'monospace',
        fontSize:   '20px',
        fill:       '#ffffff'
    }).setOrigin(0.5).setDepth(20);

    scene.input.keyboard.once('keydown-R', () => {
        scene.scene.restart();
    });
}

// ─────────────────────────────────────────────
//  BULLETS
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

function bulletHitEnemy(enemySprite, bullet) {
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
//  HELPERS
// ─────────────────────────────────────────────
function tileToPixel(tileCoord) {
    return {
        x: tileCoord.x * TILE_SIZE + TILE_SIZE / 2,
        y: tileCoord.y * TILE_SIZE + TILE_SIZE / 2
    };
}

function hasLineOfSight(x1, y1, x2, y2) {
    const dist  = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.ceil(dist / 16);

    for (let i = 1; i < steps; i++) {
        const t       = i / steps;
        const sampleX = x1 + (x2 - x1) * t;
        const sampleY = y1 + (y2 - y1) * t;
        const tile    = wallLayer.getTileAtWorldXY(sampleX, sampleY);
        if (tile && tile.index === 1) { return false; }
    }
    return true;
}

// ─────────────────────────────────────────────
//  ENEMY STATE MACHINE
// ─────────────────────────────────────────────
// 'time' is passed in from update() so that armed enemies can
// track their own shot cooldown independently of each other.
function updateEnemy(enemy, time) {
    const sprite = enemy.sprite;

    const distToPlayer = Phaser.Math.Distance.Between(
        sprite.x, sprite.y, player.x, player.y
    );

    const los = hasLineOfSight(player.x, player.y, sprite.x, sprite.y);
    sprite.setVisible(los);

    // Each enemy type has its own detectRange, so a cleaner bot won't
    // react until the player is almost on top of it, while a heavy
    // security droid spots the player from much further away.
    if (los && distToPlayer < enemy.detectRange) {
        enemy.state = 'CHASE';
    } else {
        enemy.state = 'PATROL';
    }

    if (enemy.state === 'CHASE') {
        const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, player.x, player.y);
        sprite.setVelocityX(Math.cos(angle) * enemy.speed);
        sprite.setVelocityY(Math.sin(angle) * enemy.speed);

        // ── Placeholder: armed enemy shooting ────────────────────────────
        // When weaponType is not null the enemy has a ranged weapon.
        // The actual firing logic will be added in a later step; for now
        // we just leave a clearly-labelled hook so it's obvious where it goes.
        //
        // if (enemy.weaponType !== null) {
        //     enemyShoot(enemy, time);
        // }
        // ─────────────────────────────────────────────────────────────────

    } else {
        // PATROL: walk back and forth between the two waypoints
        const distToTarget = Phaser.Math.Distance.Between(
            sprite.x, sprite.y, enemy.target.x, enemy.target.y
        );
        if (distToTarget < 4) {
            enemy.target = (enemy.target === enemy.waypointA)
            ? enemy.waypointB : enemy.waypointA;
        }
        const angle = Phaser.Math.Angle.Between(
            sprite.x, sprite.y, enemy.target.x, enemy.target.y
        );
        sprite.setVelocityX(Math.cos(angle) * enemy.speed);
        sprite.setVelocityY(Math.sin(angle) * enemy.speed);
    }
}
