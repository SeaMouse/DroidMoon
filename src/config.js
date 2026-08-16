// ─────────────────────────────────────────────
//  GAME CONFIG — constants and data definitions
// ─────────────────────────────────────────────

export const TILE_SIZE       = 32;
export const BULLET_SPEED    = 400;
export const BULLET_COOLDOWN = 200;
export const INPUT_DEAD_ZONE = 0.15;

export const NODE_CONNECT_DIST       = 250;
export const WANDER_BACKTRACK_CHANCE = 0.05;

export const INVINCIBILITY_MS  = 1200;

// The chassis the influence device starts in — the bare 001 unit.
export const PLAYER_DROID_START = 'droid_001';

// The gun the influence device carries itself. Any host chassis without a
// weapon of its own falls back to this, so the player is never defenceless.
export const DEVICE_WEAPON = 'id_pulse';

// ─────────────────────────────────────────────
//  POWER SYSTEM — reactor pips and multipliers
// ─────────────────────────────────────────────
// The reactor's output is allocated as discrete "pips" across three
// systems: weapons / shields / drive. Tables are indexed by pip count.
// Index 2 is the 1.0 baseline, so a 2/2/2 split leaves a chassis playing
// exactly to its droidClasses stat line.
//
// Reactor output is no longer a global — it belongs to the host chassis
// (droidClasses[*].reactorOutput), so hopping into a bigger droid is what
// buys you more pips to spend.
export const PIP_MAX             = 6;

export const SHIELD_REGEN_PER_PIP   = 3;   // extra pts/sec per shield pip, on top of the host's own rate

export const WEAPON_DAMAGE_MULT   = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8];
export const WEAPON_COOLDOWN_MULT = [1.6, 1.25, 1.0, 0.85, 0.72, 0.62, 0.55];
export const SHIELD_MAX_MULT      = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8];
export const DRIVE_SPEED_MULT     = [0.75, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4];

export const LIFT_HOLD_MS = 2000;

export const FOG_DARKNESS           = 0.85; // deck shut down — near-black outside the headlight
export const FOG_DARKNESS_LIT       = 0.30; // deck still powered — headlight reads as a subtle brightening
export const FOG_COLOUR             = 0x000011;
export const LIGHT_MAX_RANGE        = 550;
export const CONE_HALF_ANGLE        = Math.PI / 5;
export const LIGHT_BAND_ERASE_ALPHA     = 0.30; // beam strength on shut-down decks
export const LIGHT_BAND_ERASE_ALPHA_LIT = 0.15; // powered decks — just a soft brightening

export const DIM_COLOUR = 0x444466;

export const DEBUG_LOGS = false;

// ─────────────────────────────────────────────
//  DISPLAY / CANVAS
// ─────────────────────────────────────────────
export const GAME_WIDTH   = 640;   // internal render width  (classic Amiga res)
export const GAME_HEIGHT  = 512;   // internal render height
export const DISPLAY_ZOOM = 2;     // on-screen scale-up: 320×256 → 640×512 px
export const CAMERA_ZOOM  = 1;     // in-world magnification — leave at 1 for now

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
        // Placed on waypoint tiles so they're always reachable. Armour is
        // the only thing here that helps the droid; the rest is salvage.
        items: [
            { itemId: 'armour_plate_mk1',     startTile: {x: 22, y: 16} },
            { itemId: 'shield_capacitor_mk1', startTile: {x: 17, y: 8}  },
            { itemId: 'reactor_cell',         startTile: {x: 3,  y: 16} },
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
        items: [
            { itemId: 'keycode_bridge_01', startTile: {x: 27, y: 3}  },
            { itemId: 'armour_plate_mk1',  startTile: {x: 13, y: 16} },
            { itemId: 'reactor_core_mk2',  startTile: {x: 3,  y: 10} },
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
        items: [
            { itemId: 'securitycode_engineering', startTile: {x: 27, y: 10} },
            { itemId: 'armour_plate_mk2',         startTile: {x: 22, y: 10} },
            { itemId: 'weapon_heavy_cannon',      startTile: {x: 17, y: 3}  },
            { itemId: 'shield_capacitor_mk2',     startTile: {x: 7,  y: 16} },
            { itemId: 'manta_thruster_coil',      startTile: {x: 13, y: 16} },
        ],
    },
};

// ─────────────────────────────────────────────
//  WEAPON TYPE CATALOGUE
// ─────────────────────────────────────────────
//  One catalogue for every gun on the ship. A weapon behaves the same
//  whoever is holding it — the only split is rate of fire: `cooldown` is
//  what a player-driven chassis gets (further scaled by weapon pips),
//  `aiCooldown` is the far slower cadence the AI fires at, so being shot
//  at stays survivable while shooting back stays responsive.
export const weaponTypes = {
    // The influence device's own gun. It is never welded to a chassis — the
    // device carries it, and falls back to it whenever the host it is wearing
    // has no weapon of its own. Weak enough that riding an unarmed cleaner is
    // still a bad way to fight.
    id_pulse: {
        label:       'ID Pulse',
        cooldown:    420,
        aiCooldown:  2400,
        bulletSpeed: 300,
        damage:      2,
        colour:      0xccddee,
        textureKey:  'bullet_id',
    },
    pulse_laser: {
        label:       'Pulse Laser',
        cooldown:    300,
        aiCooldown:  1600,
        bulletSpeed: 380,
        damage:      5,
        colour:      0x66ffee,
        textureKey:  'bullet_pulse',
    },
    blaster: {
        label:       'Blaster',
        cooldown:    220,
        aiCooldown:  1500,
        bulletSpeed: 400,
        damage:      10,
        colour:      0xffee00,
        textureKey:  'bullet_blaster',
    },
    heavy_blaster: {
        label:       'Heavy Blaster',
        cooldown:    480,
        aiCooldown:  2800,
        bulletSpeed: 320,
        damage:      22,
        colour:      0xff66aa,
        textureKey:  'bullet_heavy',
    },
};

// ─────────────────────────────────────────────
//  DROID CLASS CATALOGUE
// ─────────────────────────────────────────────
//  Every droid on the ship — including whichever one the player is
//  currently wearing — is one of these. There is no separate "player"
//  stat block any more: a successful transfer just repoints
//  state.playerDroidType at another key in here.
//
//  classNo is the Paradroid-style serial; its leading digit is the power
//  rank, and it drives both `pulsers` (how much ammunition you bring to
//  the transfer game) and how sharply the opposing circuit plays.
//
//  hullMax doubles as an enemy's hit points, so one damage scale covers
//  both directions of fire.
export const droidClasses = {
    droid_001: {
        classNo:       '001',
        label:         'Influence Device',
        colour:        0xffffff,
        hullMax:       25,
        shieldMax:     10,
        shieldRegen:   3,    // pts/sec before shield pips are added
        reactorOutput: 4,
        speed:         220,
        weight:        1,
        contactDamage: 0,
        detectRange:   0,
        weaponType:    'id_pulse', // carried by the device itself, not the chassis
        dropChance:    0,
        pulsers:       2,
        transferable:  false,
    },
    cleaner: {
        classNo:       '123',
        label:         'Cleaning Bot',
        colour:        0x88ccff,
        hullMax:       20,
        shieldMax:     0,
        shieldRegen:   0,
        reactorOutput: 4,
        speed:         90,
        weight:        2,
        contactDamage: 3,
        detectRange:   0,
        weaponType:    null,
        dropChance:    0.04,
        pulsers:       3,
        transferable:  true,
    },
    patrol_drone: {
        classNo:       '247',
        label:         'Patrol Drone',
        colour:        0xff8800,
        hullMax:       35,
        shieldMax:     10,
        shieldRegen:   2,
        reactorOutput: 5,
        speed:         150,
        weight:        3,
        contactDamage: 5,
        detectRange:   180,
        weaponType:    'pulse_laser',
        dropChance:    0.07,
        pulsers:       4,
        transferable:  true,
    },
    security_light: {
        classNo:       '334',
        label:         'Security Droid (Light)',
        colour:        0xff3300,
        hullMax:       50,
        shieldMax:     25,
        shieldRegen:   3,
        reactorOutput: 6,
        speed:         170,
        weight:        5,
        contactDamage: 8,
        detectRange:   220,
        weaponType:    'blaster',
        dropChance:    0.12,
        pulsers:       5,
        transferable:  true,
    },
    security_heavy: {
        classNo:       '476',
        label:         'Security Droid (Heavy)',
        colour:        0xcc00ff,
        hullMax:       90,
        shieldMax:     45,
        shieldRegen:   4,
        reactorOutput: 8,
        speed:         120,
        weight:        8,
        contactDamage: 12,
        detectRange:   260,
        weaponType:    'heavy_blaster',
        dropChance:    0.22,
        pulsers:       6,
        transferable:  true,
    },
};

// Enemies are just droid classes that happen not to be the player's, so
// the spawn/AI code keeps reading `enemyTypes`.
export const enemyTypes = droidClasses;

// ─────────────────────────────────────────────
//  COMBAT TUNING
// ─────────────────────────────────────────────
export const AIM_LASER_MAX_RANGE       = 150;  // px — visual reach of the right-stick laser
export const PLAYER_SPRITE_RADIUS      = 16;   // px — matches the player texture radius

export const PLAYER_KNOCKBACK_SPEED    = 220;  // px/sec when bounced off an enemy
export const ENEMY_PUSH_MAX_SPEED      = 200;  // px/sec when player rams a lighter enemy
export const PLAYER_KNOCKBACK_MS       = 150;  // ms the enemy's AI pauses after a player ram

export const ENEMY_BOUNCE_SPEED        = 100;  // px/sec on enemy-enemy collision
export const ENEMY_BOUNCE_COOLDOWN_MS  = 220;  // ms before two enemies can bounce again

export const CONE_RAY_COUNT            = 24;   // resolution of the visibility cone

// Adaptive bisection — extra rays inserted between adjacent cone rays where
// they disagree about what they hit (fixes dark wedges along grazing walls).
export const CONE_BISECT_MAX_DEPTH     = 6;     // recursion limit per ray pair
export const CONE_BISECT_MIN_ANGLE     = 0.002; // rad — stop splitting below this gap
export const CONE_BISECT_TOLERANCE_PX  = 2;     // deviation below this = chord matches the wall

export const LOS_CHECK_INTERVAL_MS     = 120;  // ms between per-enemy line-of-sight checks

// Pickups are hidden until the player can actually see them. They never move,
// so their LOS can be sampled less often than the enemies'.
export const ITEM_LOS_CHECK_INTERVAL_MS = 200;  // ms between per-item line-of-sight checks
export const ITEM_FADE_RATE             = 0.10; // per-frame lerp toward the target alpha
export const ITEM_PULSE_MIN_ALPHA       = 0.55; // dimmest point of the idle pulse
export const ITEM_PULSE_PERIOD_MS       = 1400; // full bright→dim→bright cycle

// ─────────────────────────────────────────────
//  DOORS
// ─────────────────────────────────────────────
export const DOOR_PROXIMITY    = 90;   // px — unlocked doors open when someone is this close
export const DOOR_OPEN_MS      = 260;  // ms — full slide open (and closed) travel time
export const DOOR_LOCKED_TINT  = 0xff8888;  // reddish cast on locked door sprites

// ─────────────────────────────────────────────
//  INFLUENCE DEVICE / TRANSFER
// ─────────────────────────────────────────────
export const TRANSFER_HOLD_MS  = 1000; // ms of held input before transfer mode arms
export const TRANSFER_REACH    = 40;   // px — centre-to-centre range counted as contact
export const TRANSFER_DENY_MS  = 1200; // ms lockout after a refused or resolved attempt

// Extra pulsers handed to the human on top of the host chassis's own count.
// The bar starts 6/6, so a win needs a *net* gain of at least one cell while
// the opposing circuit is firing back; a bare 001's two pulsers cannot do
// that on most boards. The bonus is the player's, not the chassis's — an
// enemy class fielded as the opponent still fires its catalogue count.
export const TRANSFER_PLAYER_PULSER_BONUS = 2;

// Grace period after a borrowed chassis is shot out from under the device.
// Longer than INVINCIBILITY_MS: the 001 pops out standing in whatever
// crossfire killed the host, and needs time to walk out of it.
export const HOST_EJECT_INVULN_MS = 2200;

// Class rank (the leading digit of classNo) maps to how hard the opposing
// circuit plays: 0 = sluggish and sparse, 1 = fast and full of terminators.
//
// The /9 divisor is deliberate and must NOT be rescaled to the catalogue's
// current top rank. droidClasses only reaches 476 today, so difficulty caps
// around 0.44 — that is the game being unfinished, not the formula being
// wrong. Classes up to the 9xx series are planned, and they are what the
// upper half of the curve is reserved for.
export function transferDifficulty(classNo) {
    const rank = parseInt(String(classNo).charAt(0), 10) || 0;
    return Math.min(1, rank / 9);
}

// ─────────────────────────────────────────────
//  LEVEL 1 — MANTA
// ─────────────────────────────────────────────
// The Manta's own integrity, before any salvage carried off the ship is
// bolted on. Deck droids use their own class hull; state.hull holds
// whichever vehicle the player is currently in.
export const MANTA_BASE_HULL     = 100;
export const SHIP_SCALE          = 1.0; // sprite scale (1 = native 64px, 0.25 = 16px)
export const SHIP_VERTICAL_SPEED = 250;  // px/sec — vertical movement (no momentum)
export const SHIP_FLIP_DURATION  = 650;  // ms — visual flip tween length
export const SHIP_BARREL_ROLL_DURATION = 450;  // ms — phase 2 of the flip, visual only
export const SHIP_ROLL_DURATION = 200;  // ms to roll onto side (and back off again)
export const SHIP_INITIAL_FACING = 1;    // 1 = right, -1 = left
export const SHIP_SKY_MARGIN_TOP    = 60;   // px — ship can't fly into top sky strip
export const SHIP_SKY_MARGIN_BOTTOM = 60;   // px — or bottom sky strip
export const SHIP_SPEED_LEVELS  = [120, 180, 240, 300, 360, 420]; // px/sec, 6 gears
export const SHIP_GEAR_UP_MS   = 60;   // ms between gear-up ticks (acceleration)
export const SHIP_GEAR_DOWN_MS = 30;   // ms between gear-down ticks (braking)
export const SHIP_CAMERA_LEAD_MAX = 75;  // px — max camera offset at top speed
export const SHIP_EDGE_ZONE       = 250;  // px — auto-flip distance from map edge

// ─────────────────────────────────────────────
//  LEVEL 1 — MANTA BULLETS
// ─────────────────────────────────────────────
export const LASER_EMITTER_X_OFFSET = 35;   // px forward of ship centre (to the nose)
export const LASER_EMITTER_Y_OFFSET = 23;   // px above/below ship centre (twin guns)
export const SHIP_BULLET_COOLDOWN_MS = 80;    // ms between shots
export const SHIP_BULLET_SPEED       = 1200;  // px/sec
export const SHIP_BULLET_DAMAGE      = 1;
export const SHIP_BULLET_MAX_POOL    = 80;
// ─────────────────────────────────────────────
//  LEVEL 1 — MANTA SHADOW
// ─────────────────────────────────────────────
export const SHIP_SHADOW_OFFSET_X = 28;     // px right of ship
export const SHIP_SHADOW_OFFSET_Y = 28;    // px below ship
export const SHIP_SHADOW_ALPHA    = 0.45;  // 0 = invisible, 1 = solid black
// ─────────────────────────────────────────────
//  LEVEL 1 — TURRET BULLETS
// ─────────────────────────────────────────────
export const TURRET_FIRE_COOLDOWN_MS = 1800;  // ms between volleys
export const TURRET_TWIN_GAP_MS      = 0;   // ms between left & right gun of a volley
export const TURRET_FIRE_RANGE       = 600;   // px — don't fire if player further than this
export const TURRET_BULLET_SPEED     = 350;   // px/sec
export const TURRET_BULLET_DAMAGE    = 20;
export const TURRET_BULLET_MAX_POOL  = 40;
export const TURRET_BARREL_LENGTH    = 20;    // px — cannon pivot to barrel tip
export const TURRET_GUN_HALF_GAP     = 6;     // px — half-distance between the two barrels
