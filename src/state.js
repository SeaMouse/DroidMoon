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

import { droidClasses, PLAYER_DROID_START } from './config.js';

const START = droidClasses[PLAYER_DROID_START];

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

    // --- Host chassis ---
    // Which droid class the influence device is currently wearing. Every
    // hull/shield/reactor/speed/weapon figure below derives from this, so a
    // successful transfer is just a reassignment plus a recompute. It lives
    // in the permanent half of state: saveDeckState never touches player
    // fields, so identity survives a lift and the scene restart it causes.
    playerDroidType: PLAYER_DROID_START,
    transferCount:   0,

    // --- Hull & shield ---
    // Hull is the old "energy" bar: no regen, death at 0. Shield is a
    // regenerating buffer that absorbs damage first; its ceiling and regen
    // rate come from the host chassis and the shield pips (see power.js).
    hull:          START.hullMax,
    hullMax:       START.hullMax,
    shield:        START.shieldMax,
    shieldMax:     START.shieldMax,
    shieldMaxBase: START.shieldMax,  // before pip multiplier (host + armour plating)

    // --- Power distribution (reactor pips) ---
    power: { reactorOutput: START.reactorOutput, weapons: 2, shields: 1, drive: 1 },

    // --- Inventory ---
    inventory: {
        collectedIds: new Set(),  // pickup ids ('deck1:cfg:0') — never respawn
        items:        [],         // [{ itemId, count }]
    },
    currentWeaponStats: null,  // derived cache — see power.recomputePowerDerived()

    // --- Armour plating carried by the influence device between hosts ---
    armourBonus: 0,

    // --- Manta ship effects (from 'manta'-scope cargo) ---
    mantaEffects: { speedMult: 1, damageMult: 1, fireRateMult: 1, hullBonus: 0 },

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

    state.playerDroidType = PLAYER_DROID_START;
    state.transferCount   = 0;

    state.hull          = START.hullMax;
    state.hullMax       = START.hullMax;
    state.shield        = START.shieldMax;
    state.shieldMax     = START.shieldMax;
    state.shieldMaxBase = START.shieldMax;

    state.power = { reactorOutput: START.reactorOutput, weapons: 2, shields: 1, drive: 1 };

    state.inventory = {
        collectedIds: new Set(),
        items:        [],
    };
    state.currentWeaponStats = null;
    state.armourBonus        = 0;
    state.mantaEffects       = { speedMult: 1, damageMult: 1, fireRateMult: 1, hullBonus: 0 };

    state.unlockedCodes = new Set();
    state.usedTerminals = new Set();
}
