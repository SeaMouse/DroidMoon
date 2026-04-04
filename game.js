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
// How much energy different things cost the player.
// contactDamage for each enemy is set in enemyDefinitions below.
const ENEMY_BULLET_DAMAGE = 20;   // Ready for when enemies shoot back

// --- Game state ---
let gameOver = false;
let gameOverText;
let restartText;

const TILE_SIZE       = 32;
const ENEMY_SPEED     = 100;
const PLAYER_SPEED    = 200;
const DETECT_RANGE    = 200;
const BULLET_SPEED    = 400;
const BULLET_COOLDOWN = 200;

let lastShotTime = 0;

// hp:            bullet hits needed to destroy this enemy
// contactDamage: energy drained when the player bumps into it
const enemyDefinitions = [
    { startTile: {x: 4,  y: 2},  waypointA: {x: 4,  y: 2},  waypointB: {x: 20, y: 2},  hp: 1, contactDamage:  8 },
{ startTile: {x: 4,  y: 17}, waypointA: {x: 4,  y: 17}, waypointB: {x: 20, y: 17}, hp: 1, contactDamage:  8 },
{ startTile: {x: 12, y: 8},  waypointA: {x: 12, y: 8},  waypointB: {x: 16, y: 8},  hp: 2, contactDamage: 18 },
{ startTile: {x: 1,  y: 10}, waypointA: {x: 1,  y: 10}, waypointB: {x: 9,  y: 10},  hp: 2, contactDamage: 18 },
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

    // --- Enemy texture ---
    const enemyGfx = this.add.graphics();
    enemyGfx.fillStyle(0xff4500, 1);
    enemyGfx.fillCircle(16, 16, 16);
    enemyGfx.generateTexture('enemy', 32, 32);
    enemyGfx.destroy();

    // --- Enemy group ---
    // Having all enemy sprites in one group lets us detect
    // player-enemy contact with a single overlap call.
    enemyGroup = this.physics.add.group();

    // --- Spawn enemies ---
    for (const def of enemyDefinitions) {
        const startX = def.startTile.x * TILE_SIZE + TILE_SIZE / 2;
        const startY = def.startTile.y * TILE_SIZE + TILE_SIZE / 2;
        const sprite = this.physics.add.sprite(startX, startY, 'enemy');
        sprite.setCollideWorldBounds(true);
        this.physics.add.collider(sprite, wallLayer);
        enemyGroup.add(sprite);

        enemies.push({
            sprite:        sprite,
            state:         'PATROL',
            waypointA:     tileToPixel(def.waypointA),
                     waypointB:     tileToPixel(def.waypointB),
                     target:        tileToPixel(def.waypointB),
                     hp:            def.hp,
                     contactDamage: def.contactDamage,
        });

        this.physics.add.overlap(bullets, sprite, bulletHitEnemy);
    }

    // --- Player-enemy contact damage ---
    // When the player touches any enemy sprite, playerTouchedEnemy is called.
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
    // Hearts and text are created after everything else so they draw on top.
    createHUD(this);
}

// ─────────────────────────────────────────────
//  UPDATE  (called every frame)
// ─────────────────────────────────────────────
function update(time) {
    // Do nothing if the game is over
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
        updateEnemy(enemy);
    }
}

// ─────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────

// Build the energy bar and kill counter.
// setScrollFactor(0) pins everything to the screen, not the world.
function createHUD(scene) {
    const BAR_X = 12;   // Left edge of the bar on screen
    const BAR_Y = 12;   // Top edge of the bar on screen

    // --- Label ---
    scene.add.text(BAR_X, BAR_Y, 'ENERGY', {
        fontFamily: 'monospace',
        fontSize:   '10px',
        fill:       '#aaffcc'
    }).setScrollFactor(0).setDepth(10);

    // --- Background track (dark rectangle, always full width) ---
    const barBg = scene.add.graphics();
    barBg.fillStyle(0x222233, 1);
    barBg.fillRect(BAR_X, BAR_Y + 12, ENERGY_BAR_WIDTH, ENERGY_BAR_HEIGHT);
    barBg.setScrollFactor(0).setDepth(10);

    // --- Coloured fill (width shrinks as energy falls) ---
    // We store this as a global so updateHUD() can redraw it each hit.
    energyBarFill = scene.add.graphics();
    energyBarFill.setScrollFactor(0).setDepth(11);

    // --- Kill counter ---
    killText = scene.add.text(BAR_X, BAR_Y + 32, 'Destroyed: 0', {
        fontFamily: 'monospace',
        fontSize:   '12px',
        fill:       '#aaffcc'
    });
    killText.setScrollFactor(0).setDepth(10);

    // Draw the bar at full energy to start
    updateHUD();
}

// Redraws the energy bar fill and updates the kill counter text.
// Call this whenever playerEnergy or killCount changes.
function updateHUD() {
    const pct = playerEnergy / PLAYER_MAX_ENERGY;  // 0.0 → 1.0

    // Colour shifts: green above 50%, yellow 25–50%, red below 25%
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

// Called by Phaser whenever the player sprite overlaps an enemy sprite.
function playerTouchedByEnemy(playerSprite, enemySprite) {
    // Ignore if already in the invincibility window
    if (playerInvincible) { return; }

    // Look up how much damage this particular enemy deals
    const enemy = enemies.find(e => e.sprite === enemySprite);
    const damage = enemy ? enemy.contactDamage : 10;

    playerEnergy = Math.max(0, playerEnergy - damage);
    updateHUD();

    if (playerEnergy <= 0) {
        triggerGameOver();
        return;
    }

    // --- Brief invincibility + visual flash ---
    playerInvincible = true;

    // Tween makes the player flicker so you know you've been hit
    scene.tweens.add({
        targets:    playerSprite,
        alpha:      0.2,
        duration:   100,
        yoyo:       true,       // ping-pong between alpha 1 and 0.2
        repeat:     5,          // flicker 5 times
        onComplete: () => { playerSprite.setAlpha(1); }
    });

    // After the grace period, the player can be hit again
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

    // Stop all enemies moving
    for (const enemy of enemies) {
        enemy.sprite.setVelocity(0);
    }

    // --- Game over text, centred on screen ---
    // The camera may have scrolled, so we use the camera's current scroll
    // position to work out the centre of the visible screen.
    const camX = scene.cameras.main.scrollX;
    const camY = scene.cameras.main.scrollY;
    const cx    = camX + 400;   // 400 = half of 800px viewport width
    const cy    = camY + 300;   // 300 = half of 600px viewport height

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

    // Listen for R key to restart the whole scene
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

// Called when a bullet overlaps an enemy sprite.
// Note: Phaser passes arguments in the same order as physics.add.overlap(A, B, ...)
// so here the first arg is from 'bullets' and the second is the enemy sprite.
function bulletHitEnemy(enemySprite, bullet) {
    deactivateBullet(bullet);

    // Find the data object that owns this sprite
    const enemy = enemies.find(e => e.sprite === enemySprite);
    if (!enemy) { return; }

    enemy.hp--;

    if (enemy.hp <= 0) {
        // Remove from the tracking array so updateEnemy no longer runs on it
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
        // Flash white briefly to show a hit that didn't kill
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
