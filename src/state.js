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

import { PLAYER_MAX_ENERGY } from './config.js';

export const state = {
    // --- Scene singletons (assigned in create) ---
    scene:         null,
    player:        null,
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
    playerEnergy:     PLAYER_MAX_ENERGY,
    playerInvincible: false,
    playerFacing:     0,
    lastShotTime:     0,
    killCount:        0,

    // --- HUD references ---
    energyBarFill: null,
    killText:      null,
    deckLabel:     null,

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
    state.playerEnergy     = PLAYER_MAX_ENERGY;
    state.killCount        = 0;
    state.gameOver         = false;
    state.playerInvincible = false;
}
