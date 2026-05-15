// ─────────────────────────────────────────────
//  GAME CONFIG — constants and data definitions
// ─────────────────────────────────────────────

export const TILE_SIZE       = 32;
export const PLAYER_SPEED    = 200;
export const PLAYER_WEIGHT   = 2;
export const BULLET_SPEED    = 400;
export const BULLET_COOLDOWN = 200;

export const NODE_CONNECT_DIST       = 250;
export const WANDER_BACKTRACK_CHANCE = 0.05;

export const PLAYER_MAX_ENERGY = 100;
export const INVINCIBILITY_MS  = 1200;

export const ENERGY_BAR_WIDTH  = 150;
export const ENERGY_BAR_HEIGHT = 14;

export const LIFT_HOLD_MS = 2000;

export const FOG_DARKNESS           = 0.85;
export const FOG_COLOUR             = 0x000011;
export const LIGHT_MAX_RANGE        = 550;
export const CONE_HALF_ANGLE        = Math.PI / 5;
export const LIGHT_BAND_ERASE_ALPHA = 0.35;

export const DIM_COLOUR = 0x444466;

// ─────────────────────────────────────────────
//  DECK DEFINITIONS
// ─────────────────────────────────────────────
export const deckDefinitions = {
    deck1: {
        mapKey:      'ship_deck_1',
        mapFile:     'assets/ship_deck_1.tmj',
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
        mapKey:      'ship_deck_2',
        mapFile:     'assets/ship_deck_2.tmj',
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
        mapKey:      'ship_deck_3',
        mapFile:     'assets/ship_deck_3.tmj',
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
//  WEAPON TYPE CATALOGUE
// ─────────────────────────────────────────────
export const weaponTypes = {
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
export const enemyTypes = {
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
//  LEVEL 1 — URIDIUM-STYLE SHIP
// ─────────────────────────────────────────────
export const SHIP_VERTICAL_SPEED = 250;  // px/sec — vertical movement (no momentum)
export const SHIP_FLIP_DURATION  = 450;  // ms — visual flip tween length
export const SHIP_BARREL_ROLL_DURATION = 450;  // ms — phase 2 of the flip, visual only
export const SHIP_INITIAL_FACING = 1;    // 1 = right, -1 = left
export const SHIP_SKY_MARGIN_TOP    = 60;   // px — ship can't fly into top sky strip
export const SHIP_SKY_MARGIN_BOTTOM = 60;   // px — or bottom sky strip
export const SHIP_SPEED_LEVELS  = [120, 180, 240, 360, 600, 720]; // px/sec, 6 gears
export const SHIP_GEAR_UP_MS   = 60;   // ms between gear-up ticks (acceleration)
export const SHIP_GEAR_DOWN_MS = 30;   // ms between gear-down ticks (braking)
export const SHIP_CAMERA_LEAD_MAX = 75;  // px — max camera offset at top speed
export const SHIP_EDGE_ZONE       = 250;  // px — auto-flip distance from map edge

// ─────────────────────────────────────────────
//  LEVEL 1 — TWIN LASER BLASTERS
// ─────────────────────────────────────────────
export const LASER_FIRE_INTERVAL_MS = 40;   // ms between pulses (≈25/sec)
export const LASER_PULSE_LIFE_MS    = 20;   // ms each pulse stays visible
export const LASER_EMITTER_X_OFFSET = 5;   // px forward of ship centre (to the nose)
export const LASER_EMITTER_Y_OFFSET = 12;   // px above/below ship centre (twin guns)
export const LASER_RAYCAST_STEP     = 4;    // px per raycast step
export const LASER_COLOUR_CORE  = 0xffffff;  // hot white core
export const LASER_COLOUR_MID   = 0x88ddff;  // cyan-blue mid
export const LASER_COLOUR_GLOW  = 0x00aaff;  // deep blue outer glow
