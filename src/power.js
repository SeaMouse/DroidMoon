// ─────────────────────────────────────────────
//  POWER DISTRIBUTION SYSTEM
// ─────────────────────────────────────────────
//  Manages reactor power allocation to weapons, shields, and drive.
//  Recomputes weapon/shield stats based on pip distribution and presets.
// ─────────────────────────────────────────────

import { state } from './state.js';
import {
    PIP_MAX,
    WEAPON_DAMAGE_MULT,
    WEAPON_COOLDOWN_MULT,
    SHIELD_MAX_MULT,
    DRIVE_SPEED_MULT,
    SHIELD_REGEN_BASE,
    SHIELD_REGEN_PER_PIP,
} from './config.js';
import { playerWeaponTypes } from './items-config.js';

// ─────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────

export function clampPip(n) {
    return Math.max(0, Math.min(PIP_MAX, Math.round(n)));
}

// ─────────────────────────────────────────────
//  MULTIPLIER GETTERS
// ─────────────────────────────────────────────

export function getDriveSpeedMultiplier() {
    return DRIVE_SPEED_MULT[clampPip(state.power.drive)];
}

export function getShieldRegenRate() {
    return SHIELD_REGEN_BASE + SHIELD_REGEN_PER_PIP * clampPip(state.power.shields);
}

// ─────────────────────────────────────────────
//  PIP RECOMPUTATION
// ─────────────────────────────────────────────

export function recomputePowerDerived() {
    // Weapon stats
    const def = playerWeaponTypes[state.inventory.equippedWeaponId];
    const p = clampPip(state.power.weapons);
    state.currentWeaponStats = {
        cooldown:    Math.round(def.cooldown * WEAPON_COOLDOWN_MULT[p]),
        damage:      def.damage * WEAPON_DAMAGE_MULT[p],
        bulletSpeed: def.bulletSpeed,
        textureKey:  def.textureKey,
        colour:      def.colour,
        label:       def.label,
    };

    // Shield stats
    state.shieldMax = Math.round(state.shieldMaxBase * SHIELD_MAX_MULT[clampPip(state.power.shields)]);
    state.shield = Math.min(state.shield, state.shieldMax);
}

// ─────────────────────────────────────────────
//  PIP ADJUSTMENT
// ─────────────────────────────────────────────

export function adjustPip(system, delta) {
    const next = clampPip(state.power[system] + delta);

    // Reject if unchanged
    if (next === state.power[system]) {
        return false;
    }

    // Reject if we don't have enough reactor capacity
    if (delta > 0) {
        const current = state.power[system];
        const newSum = state.power.weapons + state.power.shields + state.power.drive - current + next;
        if (newSum > state.power.reactorOutput) {
            return false;
        }
    }

    // Accept the change
    state.power[system] = next;
    recomputePowerDerived();
    return true;
}

// ─────────────────────────────────────────────
//  POWER PRESETS
// ─────────────────────────────────────────────

export const powerPresets = {
    combat:   { weapons: 3, shields: 2, drive: 1 },
    balanced: { weapons: 2, shields: 2, drive: 2 },
    defense:  { weapons: 1, shields: 3, drive: 2 },
    cruise:   { weapons: 1, shields: 2, drive: 3 },
};

export function applyPreset(name) {
    const preset = powerPresets[name];
    if (!preset) {
        return false;
    }

    // Scale preset weights to actual reactor output
    const totalWeight = 6; // presets assume a 6-pip reactor
    const floors = {};
    const remainders = {};

    ['weapons', 'shields', 'drive'].forEach((system) => {
        const target = (preset[system] / totalWeight) * state.power.reactorOutput;
        floors[system] = Math.floor(target);
        remainders[system] = target - floors[system];
    });

    // Distribute remaining pips by largest fractional remainder
    let remaining = state.power.reactorOutput - (floors.weapons + floors.shields + floors.drive);
    const systems = ['weapons', 'shields', 'drive'].sort((a, b) => {
        const diff = remainders[b] - remainders[a];
        if (diff !== 0) return diff;
        // Tie-breaker: weapons, shields, drive order
        return ['weapons', 'shields', 'drive'].indexOf(a) - ['weapons', 'shields', 'drive'].indexOf(b);
    });

    for (const system of systems) {
        if (remaining <= 0) break;
        const canAdd = Math.min(1, PIP_MAX - floors[system]);
        floors[system] += canAdd;
        remaining -= canAdd;
    }

    // Assign and recompute
    state.power.weapons = floors.weapons;
    state.power.shields = floors.shields;
    state.power.drive = floors.drive;
    recomputePowerDerived();
    return true;
}

// ─────────────────────────────────────────────
//  SHIELD REGENERATION
// ─────────────────────────────────────────────

export function updateShieldRegen(deltaMs) {
    if (state.gameOver || state.playerInvincible || state.shield >= state.shieldMax) {
        return false;
    }

    state.shield = Math.min(state.shieldMax, state.shield + getShieldRegenRate() * deltaMs / 1000);
    return true;
}
