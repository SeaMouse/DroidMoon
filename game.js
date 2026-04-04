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
let arrowKeys;
let wallLayer;
let enemies = [];
let bullets;
let rightStickReset = true;  // Tracks whether right stick has returned to centre
let scene;  // Global reference to the Phaser scene

const TILE_SIZE    = 32;
const ENEMY_SPEED  = 100;
const PLAYER_SPEED = 200;
const DETECT_RANGE = 200;
const BULLET_SPEED = 400;
const BULLET_COOLDOWN = 200;  // Milliseconds between shots

let lastShotTime = 0;  // Tracks when the player last fired

const enemyDefinitions = [
    { startTile: {x: 4,  y: 2},  waypointA: {x: 4,  y: 2},  waypointB: {x: 20, y: 2}  },
    { startTile: {x: 4,  y: 17}, waypointA: {x: 4,  y: 17}, waypointB: {x: 20, y: 17} },
    { startTile: {x: 12, y: 8},  waypointA: {x: 12, y: 8},  waypointB: {x: 16, y: 8}  },
    { startTile: {x: 1,  y: 10}, waypointA: {x: 1,  y: 10}, waypointB: {x: 9,  y: 10} },
];

function preload() {
    this.load.tilemapTiledJSON('level1', 'assets/level1.tmj');
    this.load.image('tiles', 'assets/poc_tiles.png');
}

function create() {
    scene = this;

    // Remove all the tileGfx / generateTexture('tiles') block, and replace with:
    const map = this.make.tilemap({ key: 'level1' });
    const tileset = map.addTilesetImage('tiles', 'tiles');  // name in Tiled, then the image key
    wallLayer = map.createLayer('Tile Layer 1', tileset, 0, 0);  // must match your layer name in Tiled
    wallLayer.setCollision(1);  // tile index 1 = wall

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
    // A small bright yellow circle
    const bulletGfx = this.add.graphics();
    bulletGfx.fillStyle(0xffee00, 1);
    bulletGfx.fillCircle(4, 4, 4);
    bulletGfx.generateTexture('bullet', 8, 8);
    bulletGfx.destroy();

    // --- Bullet group ---
    // A static pool of 20 bullets. 'runChildUpdate' means each bullet's
    // update() method is called automatically every frame.
    bullets = this.physics.add.group({
        defaultKey: 'bullet',
            maxSize: 20,
            runChildUpdate: true
    });

    // Bullets are stopped by walls
    this.physics.add.collider(bullets, wallLayer, bulletHitWall);

    // --- Enemy texture ---
    const enemyGfx = this.add.graphics();
    enemyGfx.fillStyle(0xff4500, 1);
    enemyGfx.fillCircle(16, 16, 16);
    enemyGfx.generateTexture('enemy', 32, 32);
    enemyGfx.destroy();

    // --- Spawn enemies ---
    for (const def of enemyDefinitions) {
        const startX = def.startTile.x * TILE_SIZE + TILE_SIZE / 2;
        const startY = def.startTile.y * TILE_SIZE + TILE_SIZE / 2;
        const sprite = this.physics.add.sprite(startX, startY, 'enemy');
        sprite.setCollideWorldBounds(true);
        this.physics.add.collider(sprite, wallLayer);

        enemies.push({
            sprite:    sprite,
            state:     'PATROL',
            waypointA: tileToPixel(def.waypointA),
            waypointB: tileToPixel(def.waypointB),
            target:    tileToPixel(def.waypointB),
        });

        // Each enemy is hit by bullets
        this.physics.add.overlap(bullets, sprite, bulletHitEnemy);
    }

    // --- Camera ---
    const mapWidth  = map.widthInPixels;
    const mapHeight = map.heightInPixels;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(player, true, 0.08, 0.08);

    // --- Input ---
    // WASD for movement, arrow keys for aiming/shooting
    cursors = this.input.keyboard.createCursorKeys();
    wasdKeys = this.input.keyboard.addKeys({
        up:    Phaser.Input.Keyboard.KeyCodes.W,
        down:  Phaser.Input.Keyboard.KeyCodes.S,
        left:  Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
    });
}

function update(time) {
    player.setVelocity(0);

    // --- Movement: WASD or gamepad left stick ---
    const pad = this.input.gamepad.getPad(0);
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

    // Keyboard arrow keys — behaviour unchanged
    if (cursors.left.isDown)  { aimX = -1; }
    if (cursors.right.isDown) { aimX =  1; }
    if (cursors.up.isDown)    { aimY = -1; }
    if (cursors.down.isDown)  { aimY =  1; }

    if (pad) {
        const RSX = pad.rightStick.x;
        const RSY = pad.rightStick.y;
        const stickOut = Math.abs(RSX) > DEAD_ZONE || Math.abs(RSY) > DEAD_ZONE;

        if (!stickOut) {
            // Stick is at centre — mark it as reset and ready to fire again
            rightStickReset = true;
        } else if (rightStickReset) {
            // Stick is pushed out AND has been reset since the last shot
            aimX = RSX;
            aimY = RSY;
        }
    }

    if ((aimX !== 0 || aimY !== 0) && time > lastShotTime + BULLET_COOLDOWN) {
        fireBullet(player.x, player.y, aimX, aimY);
        lastShotTime = time;
        rightStickReset = false;  // Block further shots until stick returns to centre
    }

    // --- Enemy AI ---
    for (const enemy of enemies) {
        updateEnemy(enemy);
    }
}

// --- Fire a bullet from (x,y) in direction (dx,dy) ---
function fireBullet(x, y, dx, dy) {
    const bullet = bullets.get(x, y, 'bullet');
    if (!bullet) { return; }

    bullet.setActive(true);
    bullet.setVisible(true);
    bullet.body.enable = true;
    bullet.body.reset(x, y);  // ← sync body position to the new spawn point

    const angle = Math.atan2(dy, dx);
    bullet.setVelocityX(Math.cos(angle) * BULLET_SPEED);
    bullet.setVelocityY(Math.sin(angle) * BULLET_SPEED);
}

// --- Called when a bullet overlaps a wall ---
function bulletHitWall(bullet) {
    deactivateBullet(bullet);
}

// --- Called when a bullet overlaps an enemy ---
function bulletHitEnemy(enemySprite, bullet) {  // ← swapped
    deactivateBullet(bullet);
    enemies = enemies.filter(e => e.sprite !== enemySprite);

    enemySprite.setActive(false);
    enemySprite.setVisible(false);
    enemySprite.body.enable = false;

    scene.time.delayedCall(100, () => {
        enemySprite.destroy();
    });
}

// --- Return a bullet to the pool ---
function deactivateBullet(bullet) {
    bullet.setActive(false);
    bullet.setVisible(false);
    bullet.setVelocity(0);
    bullet.body.enable = false;
}

// --- Helper: tile coordinates to pixel centre ---
function tileToPixel(tileCoord) {
    return {
        x: tileCoord.x * TILE_SIZE + TILE_SIZE / 2,
        y: tileCoord.y * TILE_SIZE + TILE_SIZE / 2
    };
}

// --- Line of sight check ---
function hasLineOfSight(x1, y1, x2, y2) {
    const dist  = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.ceil(dist / 16);

    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const sampleX = x1 + (x2 - x1) * t;
        const sampleY = y1 + (y2 - y1) * t;
        const tile = wallLayer.getTileAtWorldXY(sampleX, sampleY);
        if (tile && tile.index === 1) { return false; }
    }
    return true;
}

// --- Enemy state machine ---
function updateEnemy(enemy) {
    const sprite = enemy.sprite;

    const distToPlayer = Phaser.Math.Distance.Between(
        sprite.x, sprite.y, player.x, player.y
    );

    const los = hasLineOfSight(player.x, player.y, sprite.x, sprite.y);
    sprite.setVisible(los);

    if (los && distToPlayer < DETECT_RANGE) {
        enemy.state = 'CHASE';
    } else {
        enemy.state = 'PATROL';
    }

    if (enemy.state === 'CHASE') {
        const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, player.x, player.y);
        sprite.setVelocityX(Math.cos(angle) * ENEMY_SPEED);
        sprite.setVelocityY(Math.sin(angle) * ENEMY_SPEED);
    } else {
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
        sprite.setVelocityX(Math.cos(angle) * ENEMY_SPEED);
        sprite.setVelocityY(Math.sin(angle) * ENEMY_SPEED);
    }
}
