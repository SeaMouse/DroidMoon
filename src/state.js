// ─────────────────────────────────────────────
//  SHARED MUTABLE STATE
// ─────────────────────────────────────────────
//  Everything in here is set during gameplay and read across
//  multiple modules. Other files import this object and mutate
//  its properties directly.
//
//  Long-term this state should live on the GameScene instance,
//  but that's a bigger refactor. For now: shared module state.
// ─────────────────────────────────────────────

import {
    PLAYER_MAX_HULL, PLAYER_MAX_SHIELD_BASE, REACTOR_BASE_OUTPUT,
} from './config.js';

export const state = {
    // --- Scene singletons (assigned in create) ---
    scene:         null,
    player:        null,
    playerTop:     null,
    wallLayer:     null,
    enemyGroup:    null,
    playerBullets: null,
    enemyBullets:  null,
    fogRT:         null,
    fogEraseGfx:   [],
    aimLaser:      null,
    keys:          null,

    // --- Game state ---
    gameOver:         false,
    playerInvincible: false,
    playerFacing:     0,
    lastShotTime:     0,
    killCount:        0,

    // --- Hull & shield ---
    // Hull is the old "energy" bar: no regen, death at 0. Shield is a
    // regenerating buffer that absorbs damage first; its ceiling and
    // regen rate depend on items and shield pips (see power.js).
    hull:          PLAYER_MAX_HULL,
    hullMax:       PLAYER_MAX_HULL,
    shield:        PLAYER_MAX_SHIELD_BASE,
    shieldMax:     PLAYER_MAX_SHIELD_BASE,
    shieldMaxBase: PLAYER_MAX_SHIELD_BASE,  // before pip multiplier (base + item bonuses)

    // --- Power distribution (reactor pips) ---
    power: { reactorOutput: REACTOR_BASE_OUTPUT, weapons: 2, shields: 2, drive: 2 },

    // --- Inventory ---
    inventory: {
        collectedIds:     new Set(),  // pickup ids ('deck1:cfg:0') — never respawn
        items:            [],         // [{ itemId, count }]
        equippedWeaponId: 'blaster',
    },
    currentWeaponStats: null,  // derived cache — see power.recomputePowerDerived()

    // --- Manta ship effects (from mantaCompatible items) ---
    mantaEffects: { speedMult: 1, damageMult: 1 },

    // --- HUD references ---
    hud: null,   // bag of HUD game objects, owned by systems.createHUD

    // --- Quest progress ---
    unlockedCodes: new Set(),   // door codeIds opened remotely (terminals)
    usedTerminals: new Set(),   // terminal ids already activated

    // --- Multi-deck system ---
    currentDeck:    'deck1',
    deckStates:     {},
    playerSpawnPos: null,
    lastDeck:       null,

    // --- Nav + lighting (populated when a deck loads) ---
    enemies:      [],
    navNodes:     [],
    wallSegments: [],
    wallCorners:  [],
};

// Resets game state when returning to the title screen.
// Called from TitleScene's create.
export function resetGameState() {
    state.deckStates     = {};
    state.currentDeck    = 'deck1';
    state.playerSpawnPos = null;
    state.lastDeck       = null;
    state.killCount        = 0;
    state.gameOver         = false;
    state.playerInvincible = false;

    state.hull          = PLAYER_MAX_HULL;
    state.hullMax       = PLAYER_MAX_HULL;
    state.shield        = PLAYER_MAX_SHIELD_BASE;
    state.shieldMax     = PLAYER_MAX_SHIELD_BASE;
    state.shieldMaxBase = PLAYER_MAX_SHIELD_BASE;

    state.power = { reactorOutput: REACTOR_BASE_OUTPUT, weapons: 2, shields: 2, drive: 2 };

    state.inventory = {
        collectedIds:     new Set(),
        items:            [],
        equippedWeaponId: 'blaster',
    };
    state.currentWeaponStats = null;
    state.mantaEffects       = { speedMult: 1, damageMult: 1 };

    state.unlockedCodes = new Set();
    state.usedTerminals = new Set();
}
