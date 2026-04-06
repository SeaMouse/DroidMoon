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

let debugGraphics;
let f1Key;

let player;
let cursors;
let wasdKeys;
let wallLayer;
let enemies = [];
let navNodes = [];  // [{id, x, y, neighbours:[ids]}]
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
    cleaner: {
        label:         'Cleaning Bot',
        colour:        0x88ccff,
        speed:         55,
        detectRange:   0,
        hp:            1,
        contactDamage: 5,
        weaponType:    null,
        weight:        10,
    },
    patrol_drone: {
        label:         'Patrol Drone',
        colour:        0xff8800,
        speed:         100,
        detectRange:   0,
        hp:            2,
        contactDamage: 10,
        weaponType:    null,
        weight:        2,
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
//  LEVEL LAYOUT — enemy placements
// ─────────────────────────────────────────────
const enemyDefinitions = [
    { type: 'cleaner',        startTile: {x: 4,  y: 2}  },
    { type: 'cleaner',        startTile: {x: 4,  y: 17} },
    { type: 'patrol_drone',   startTile: {x: 12, y: 8}  },
    { type: 'security_light', startTile: {x: 1,  y: 10} },
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
    playerInvincible = false;
    lastShotTime     = 0;
    rightStickReset  = true;

    // --- Tilemap ---
    const map      = this.make.tilemap({ key: 'level1' });
    const tileset  = map.addTilesetImage('tiles', 'tiles');
    wallLayer      = map.createLayer('Tile Layer 1', tileset, 0, 0);
    wallLayer.setCollision(1);
    buildNavGraph(map);

    // --- Player texture ---
    const playerGfx = this.add.graphics();
    playerGfx.fillStyle(0x00ff99, 1);
    playerGfx.fillCircle(16, 16, 16);
    playerGfx.generateTexture('player', 32, 32);
    playerGfx.destroy();

    player = this.physics.add.sprite(82, 82, 'player');
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

        const startNode = findNearestNode(startX, startY);
        const initNodeId = startNode ? startNode.id : null;
        const initTarget = startNode ? { x: startNode.x, y: startNode.y } : null;

        enemies.push({
            sprite:        sprite,
            typeName:      def.type,
            label:         typeDef.label,
            currentNodeId: initNodeId,
            previousNodeId: null,
            nodeTarget:    initTarget,
            hp:            typeDef.hp,
            contactDamage: typeDef.contactDamage,
            speed:         typeDef.speed,
            detectRange:   typeDef.detectRange,
            weaponType:    typeDef.weaponType,
            lastShotTime:  0,
            lastStuckCheckTime: 0,
            lastStuckCheckPos:  { x: startX, y: startY },
            bounceCooldown: 0
        });

        this.physics.add.overlap(bullets, sprite, bulletHitEnemy);
    }

    // --- Player-enemy contact damage ---
    this.physics.add.collider(player, enemyGroup, onPlayerEnemyCollide);
    this.physics.add.collider(enemyGroup, enemyGroup, onEnemyEnemyCollide);

    // --- Camera ---
    const mapWidth  = map.widthInPixels;
    const mapHeight = map.heightInPixels;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(player, true, 0.08, 0.08);

    // --- HUD ---
    createHUD(this);

    // --- Debug nav overlay ---
    f1Key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F1);
    debugGraphics = this.add.graphics();
    debugGraphics.setDepth(50);   // draw on top of everything
    drawDebugNavStatic();   // nodes + connections — drawn once
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
    if (pad) {
        if (Math.abs(pad.leftStick.x) > DEAD_ZONE) { player.setVelocityX(pad.leftStick.x * PLAYER_SPEED); }
        if (Math.abs(pad.leftStick.y) > DEAD_ZONE) { player.setVelocityY(pad.leftStick.y * PLAYER_SPEED); }
    }

    // --- Player aiming and shooting ---
    let aimX = 0;
    let aimY = 0;
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

    if (Phaser.Input.Keyboard.JustDown(f1Key)) {
        const visible = !debugGraphics.visible;
        debugGraphics.setVisible(visible);
        scene.debugStaticGfx.setVisible(visible);
        scene.debugNodeLabels.forEach(label => label.setVisible(visible));
    }

    // --- Debug nav overlay (redrawn each frame so enemy lines stay live) ---
    drawDebugNavDynamic();  // enemy→target lines only
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
//  PLAYER ↔ ENEMY COLLISION  (replaces overlap-based playerTouchedByEnemy)
// ─────────────────────────────────────────────
// The physics collider already separates the bodies; this callback handles
// damage, player knock-back, and the enemy's reversal pause.
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
        }
    }
}

// ─────────────────────────────────────────────
//  ENEMY ↔ ENEMY COLLISION
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  ENEMY ↔ ENEMY COLLISION
// ─────────────────────────────────────────────
function onEnemyEnemyCollide(spriteA, spriteB) {
    const enemyA = enemies.find(e => e.sprite === spriteA);
    const enemyB = enemies.find(e => e.sprite === spriteB);
    if (!enemyA || !enemyB) { return; }

    const now = scene.time.now;

    // If either enemy is still in its bounce window, do nothing.
    // This prevents the callback firing every frame from turning
    // a single ricochet into a sustained push.
    if (now < enemyA.bounceCooldown || now < enemyB.bounceCooldown) { return; }

    const wA    = enemyTypes[enemyA.typeName].weight;
    const wB    = enemyTypes[enemyB.typeName].weight;
    const total = wA + wB;

    const dx   = spriteB.x - spriteA.x;
    const dy   = spriteB.y - spriteA.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx   = dx / dist;
    const ny   = dy / dist;

    const BOUNCE = 180;
    spriteA.setVelocity(-nx * BOUNCE * (wB / total), -ny * BOUNCE * (wB / total));
    spriteB.setVelocity( nx * BOUNCE * (wA / total),  ny * BOUNCE * (wA / total));

    // Lock out further bounces for both until they've had time to separate
    const COOLDOWN_MS = 400;
    enemyA.bounceCooldown = now + COOLDOWN_MS;
    enemyB.bounceCooldown = now + COOLDOWN_MS;
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

    for (const enemy of enemies) { enemy.sprite.setVelocity(0); }

    gameOverText = scene.add.text(400, 260, 'GAME OVER', {
        fontFamily: 'monospace', fontSize: '48px',
        fill: '#ff2244', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    restartText = scene.add.text(400, 320, 'Press R to restart', {
        fontFamily: 'monospace', fontSize: '20px', fill: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    scene.input.keyboard.once('keydown-R', () => { scene.scene.restart(); });
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

function hasLineOfSight(x1, y1, x2, y2, width) {
    // Default to droid radius so the corridor matches the sprite
    const halfWidth = (width !== undefined ? width : 12);

    const dx  = x2 - x1;
    const dy  = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) { return true; }

    // Unit vector perpendicular to the ray direction
    const perpX = -dy / len;
    const perpY =  dx / len;

    // Three offsets: left edge, centre, right edge
    const offsets = [0, -halfWidth, halfWidth];

    for (const offset of offsets) {
        const ox = perpX * offset;
        const oy = perpY * offset;

        const steps = Math.ceil(len / 8);   // finer step for edge rays
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
    sprite.setVisible(los);

    if (enemy.nodeTarget === null) {
        sprite.setVelocity(0);
        return;
    }

    // ── Stuck detection ─────────────────────────────────────────────────
    // ... rest of function unchanged

    // ── Stuck detection ──────────────────────────────────────────────────
    if (time > enemy.lastStuckCheckTime + 1000) {
        const movedDist = Phaser.Math.Distance.Between(
            sprite.x, sprite.y,
            enemy.lastStuckCheckPos.x, enemy.lastStuckCheckPos.y
        );
        if (movedDist < 8) {
            // Just go back to where we came from
            if (enemy.previousNodeId !== null) {
                const prevNode = navNodes[enemy.previousNodeId];
                enemy.currentNodeId  = enemy.previousNodeId;
                enemy.previousNodeId = null;
                enemy.nodeTarget     = { x: prevNode.x, y: prevNode.y };
            } else {
                // No previous node recorded — snap to nearest as a last resort
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

    // Diagnostic — log every layer Phaser can see
    console.log('NAV: All layers found by Phaser:');
    map.layers.forEach(l => console.log('  tile layer:', l.name));
    if (map.objects) {
        map.objects.forEach(l => console.log('  object layer:', l.name));
    }

    // Try the standard API first, fall back to raw map.objects array
    let objLayer = map.getObjectLayer('Waypoints');

    if (!objLayer) {
        // Phaser sometimes stores object layers in map.objects rather than
        // making them available via getObjectLayer, depending on version
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

    console.log(`NAV: Found ${navNodes.length} waypoint objects.`);

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
    console.log(`NAV: Graph built — ${navNodes.length} nodes, ${totalLinks} connections.`);

    if (totalLinks === 0 && navNodes.length > 1) {
        console.warn(`NAV: No connections formed! Nodes may be more than ${NODE_CONNECT_DIST}px apart, or walls are blocking LOS.`);
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

// BFS from startId to goalId.
// Returns an ordered array of node IDs to traverse (not including startId),
// or null if no path exists.
function bfsPath(startId, goalId) {
    if (startId === goalId) { return []; }

    const visited = new Set([startId]);
    const queue   = [[startId]];   // each entry is the path taken so far

    while (queue.length > 0) {
        const path    = queue.shift();
        const current = path[path.length - 1];

        for (const neighbourId of navNodes[current].neighbours) {
            if (neighbourId === goalId) {
                // Drop the start node; caller only needs what's ahead
                return [...path.slice(1), neighbourId];
            }
            if (!visited.has(neighbourId)) {
                visited.add(neighbourId);
                queue.push([...path, neighbourId]);
            }
        }
    }
    return null;   // no route found (disconnected graph)
}

// Semi-random next node for wandering.
// Avoids the previous node most of the time, but not always.
function pickWanderNode(enemy) {
    if (enemy.currentNodeId === null) { return null; }
    const node = navNodes[enemy.currentNodeId];
    if (!node || node.neighbours.length === 0) { return null; }

    let candidates = node.neighbours;

    // Prefer not to backtrack — but allow it occasionally
    if (enemy.previousNodeId !== null && candidates.length > 1) {
        const noBacktrack = candidates.filter(id => id !== enemy.previousNodeId);
        if (Math.random() > WANDER_BACKTRACK_CHANCE) {
            candidates = noBacktrack;
        }
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
}

// ─────────────────────────────────────────────
//  DEBUG — nav graph + enemy target lines
// ─────────────────────────────────────────────
function drawDebugNav() {
    debugGraphics.clear();

    // ── Node connections (thin grey lines) ──────────────────────────────
    debugGraphics.lineStyle(1, 0x446688, 0.5);
    for (const node of navNodes) {
        for (const neighbourId of node.neighbours) {
            // Only draw each edge once (when our id is the smaller one)
            if (neighbourId > node.id) {
                debugGraphics.beginPath();
                debugGraphics.moveTo(node.x, node.y);
                debugGraphics.lineTo(navNodes[neighbourId].x, navNodes[neighbourId].y);
                debugGraphics.strokePath();
            }
        }
    }

    // ── Nav nodes (small filled circles) ────────────────────────────────
    for (const node of navNodes) {
        debugGraphics.fillStyle(0x00ccff, 0.85);
        debugGraphics.fillCircle(node.x, node.y, 5);

        // Node ID label — useful for spotting gaps in the graph
        scene.debugNodeLabels = [];   // ← added at the top of the function

        const label = scene.add.text(node.x + 6, node.y - 6, String(node.id), {
            fontFamily: 'monospace',
            fontSize:   '9px',
            fill:       '#00ccff'
        }).setDepth(51).setVisible(false);   // ← starts hidden
        scene.debugNodeLabels.push(label);  // ← stored so F1 can reach it
    }

    // ── Enemy → target-node lines (bright yellow) ────────────────────────
    for (const enemy of enemies) {
        if (!enemy.nodeTarget) { continue; }
        debugGraphics.lineStyle(2, 0xffee00, 0.9);
        debugGraphics.beginPath();
        debugGraphics.moveTo(enemy.sprite.x, enemy.sprite.y);
        debugGraphics.lineTo(enemy.nodeTarget.x, enemy.nodeTarget.y);
        debugGraphics.strokePath();

        // Small dot at the target node so it's obvious which one is chosen
        debugGraphics.fillStyle(0xffee00, 1);
        debugGraphics.fillCircle(enemy.nodeTarget.x, enemy.nodeTarget.y, 7);
    }
}

function drawDebugNavStatic() {
    // Use a separate graphics object so it's never cleared
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
    staticGfx.setVisible(false); // hidden until F1 toggles it
    debugGraphics.setVisible(false); // dynamic lines also start hidden
    // store reference so F1 can toggle both
    scene.debugStaticGfx = staticGfx;
}

function drawDebugNavDynamic() {
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
