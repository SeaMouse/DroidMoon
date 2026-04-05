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
let bullets;          // player bullets
let enemyBullets;     // enemy bullets — separate group so overlaps are unambiguous
let enemyGroup;
let rightStickReset = true;
let scene;

// --- HUD ---
let energyBarFill;
let killText;
let killCount = 0;

// --- Player energy ---
let playerEnergy;
const PLAYER_MAX_ENERGY = 100;
const ENERGY_BAR_WIDTH  = 150;
const ENERGY_BAR_HEIGHT = 14;
let playerInvincible    = false;
const INVINCIBILITY_MS  = 1200;

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
//  WEAPON TYPE CATALOGUE
// ─────────────────────────────────────────────
// Defines the properties of each ranged weapon an enemy can carry.
// enemyTypes references these by name via the weaponType field.
//
//   cooldown    - milliseconds between shots
//   bulletSpeed - pixels per second
//   damage      - player energy lost per hit
//   colour      - hex colour of this weapon's bullet sprite
//
const weaponTypes = {
    blaster: {
        cooldown:    1500,
        bulletSpeed: 350,
        damage:      20,
        colour:      0xff4444,   // red
    },
    heavy_blaster: {
        cooldown:    2800,
        bulletSpeed: 280,        // slower but hits harder
        damage:      35,
        colour:      0xff00ff,   // magenta
    },
};

// ─────────────────────────────────────────────
//  ENEMY TYPE CATALOGUE
// ─────────────────────────────────────────────
// Master list of every robot class.
//
//   label        - human-readable name
//   colour       - hex colour for the procedurally-generated sprite
//   speed        - patrol speed in pixels per second
//   detectRange  - distance (pixels) at which an armed enemy opens fire;
//                  unarmed enemies ignore this field
//   hp           - bullet hits needed to destroy
//   contactDamage- player energy lost on physical contact
//   weaponType   - null (unarmed) or a key from weaponTypes above
//
const enemyTypes = {

    // ── Tier 0 ── Civilian / maintenance ──────────────────────────────────
    cleaner: {
        label:         'Cleaning Bot',
        colour:        0x88ccff,   // pale blue
        speed:         55,
        detectRange:   0,          // unarmed — field unused
        hp:            1,
        contactDamage: 5,
        weaponType:    null,
    },

    // ── Tier 1 ── Basic security ───────────────────────────────────────────
    patrol_drone: {
        label:         'Patrol Drone',
        colour:        0xff8800,   // orange
        speed:         100,
        detectRange:   0,          // unarmed — rams on contact only
        hp:            2,
        contactDamage: 10,
        weaponType:    null,
    },

    security_light: {
        label:         'Security Droid (Light)',
        colour:        0xff3300,   // red-orange
        speed:         120,
        detectRange:   220,        // shooting range in pixels
        hp:            2,
        contactDamage: 15,
        weaponType:    'blaster',
    },

    // ── Tier 2 ── Heavy security ───────────────────────────────────────────
    security_heavy: {
        label:         'Security Droid (Heavy)',
        colour:        0xcc00ff,   // purple
        speed:         75,
        detectRange:   260,
        hp:            4,
        contactDamage: 25,
        weaponType:    'heavy_blaster',
    },
};

// ─────────────────────────────────────────────
//  LEVEL LAYOUT — enemy placements
// ─────────────────────────────────────────────
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

    // --- Player bullet texture ---
    const bulletGfx = this.add.graphics();
    bulletGfx.fillStyle(0xffee00, 1);
    bulletGfx.fillCircle(4, 4, 4);
    bulletGfx.generateTexture('bullet', 8, 8);
    bulletGfx.destroy();

    // --- Player bullet group ---
    bullets = this.physics.add.group({
        defaultKey:      'bullet',
            maxSize:         20,
            runChildUpdate:  true
    });
    this.physics.add.collider(bullets, wallLayer, bulletHitWall);

    // --- Enemy bullet textures (one per weapon type, each its own colour) ---
    for (const [weaponKey, weaponDef] of Object.entries(weaponTypes)) {
        const gfx = this.add.graphics();
        gfx.fillStyle(weaponDef.colour, 1);
        gfx.fillCircle(4, 4, 4);
        gfx.generateTexture('ebullet_' + weaponKey, 8, 8);
        gfx.destroy();
    }

    // --- Enemy bullet group ---
    enemyBullets = this.physics.add.group({
        maxSize:        60,
        runChildUpdate: true
    });
    this.physics.add.collider(enemyBullets, wallLayer, enemyBulletHitWall);
    this.physics.add.overlap(player, enemyBullets, playerHitByEnemyBullet);

    // --- Enemy sprite textures (one per type) ---
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
        const typeDef = enemyTypes[def.type];
        if (!typeDef) {
            console.warn(`Unknown enemy type "${def.type}" — skipping.`);
            continue;
        }

        const startX = def.startTile.x * TILE_SIZE + TILE_SIZE / 2;
        const startY = def.startTile.y * TILE_SIZE + TILE_SIZE / 2;

        const sprite = this.physics.add.sprite(startX, startY, def.type);
        sprite.setCollideWorldBounds(true);
        this.physics.add.collider(sprite, wallLayer);
        enemyGroup.add(sprite);

        enemies.push({
            sprite:        sprite,
            typeName:      def.type,
            label:         typeDef.label,
            waypointA:     tileToPixel(def.waypointA),
                     waypointB:     tileToPixel(def.waypointB),
                     target:        tileToPixel(def.waypointB),
                     hp:            typeDef.hp,
                     contactDamage: typeDef.contactDamage,
                     speed:         typeDef.speed,
                     detectRange:   typeDef.detectRange,
                     weaponType:    typeDef.weaponType,
                     lastShotTime:  0,   // each enemy tracks its own shot cooldown
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

    // --- Player movement ---
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

    // --- Player aiming and shooting ---
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
//  PLAYER DAMAGE — contact
// ─────────────────────────────────────────────
function playerTouchedByEnemy(playerSprite, enemySprite) {
    const enemy  = enemies.find(e => e.sprite === enemySprite);
    const damage = enemy ? enemy.contactDamage : 10;
    applyDamageToPlayer(damage);
}

// ─────────────────────────────────────────────
//  PLAYER DAMAGE — enemy bullets
// ─────────────────────────────────────────────
function playerHitByEnemyBullet(playerSprite, bullet) {
    // The damage value was stored on the bullet at the moment it was fired
    const damage = bullet.getData('damage') ?? 20;
    deactivateEnemyBullet(bullet);
    applyDamageToPlayer(damage);
}

// ─────────────────────────────────────────────
//  PLAYER DAMAGE — shared logic
// ─────────────────────────────────────────────
// Both contact damage and bullet damage funnel here so the invincibility
// window, flash tween, and game-over check are never duplicated.
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
//  ENEMY BULLETS
// ─────────────────────────────────────────────
// Fires one bullet from the enemy toward the player's current position.
// The bullet's damage is baked in as Phaser "data" so playerHitByEnemyBullet
// can read it without any extra lookup.
function enemyShoot(enemy, time) {
    const weaponDef = weaponTypes[enemy.weaponType];
    if (!weaponDef) { return; }

    // Each enemy has its own timer so they don't all fire simultaneously
    if (time < enemy.lastShotTime + weaponDef.cooldown) { return; }
    enemy.lastShotTime = time;

    const textureKey = 'ebullet_' + enemy.weaponType;
    const bullet     = enemyBullets.get(enemy.sprite.x, enemy.sprite.y, textureKey);
    if (!bullet) { return; }   // pool exhausted — skip this shot silently

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
//  ENEMY AI  (patrol + ranged attack)
// ─────────────────────────────────────────────
function updateEnemy(enemy, time) {
    const sprite = enemy.sprite;

    // ── Visibility ──────────────────────────────────────────────────────
    // Only draw enemies the player has line of sight to.
    const los = hasLineOfSight(player.x, player.y, sprite.x, sprite.y);
    sprite.setVisible(los);

    // ── Patrol ──────────────────────────────────────────────────────────
    // Enemies always walk their waypoint route — they never chase.
    const distToTarget = Phaser.Math.Distance.Between(
        sprite.x, sprite.y, enemy.target.x, enemy.target.y
    );
    if (distToTarget < 4) {
        enemy.target = (enemy.target === enemy.waypointA)
        ? enemy.waypointB : enemy.waypointA;
    }
    const patrolAngle = Phaser.Math.Angle.Between(
        sprite.x, sprite.y, enemy.target.x, enemy.target.y
    );
    sprite.setVelocityX(Math.cos(patrolAngle) * enemy.speed);
    sprite.setVelocityY(Math.sin(patrolAngle) * enemy.speed);

    // ── Ranged attack ────────────────────────────────────────────────────
    // Armed enemies shoot when the player is within detectRange AND there
    // is a clear line of sight (no wall in between).
    if (enemy.weaponType !== null) {
        const distToPlayer = Phaser.Math.Distance.Between(
            sprite.x, sprite.y, player.x, player.y
        );
        if (los && distToPlayer < enemy.detectRange) {
            enemyShoot(enemy, time);
        }
    }
}
