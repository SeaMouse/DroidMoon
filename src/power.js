// ─────────────────────────────────────────────
//  POWER DISTRIBUTION SYSTEM
// ─────────────────────────────────────────────
//  Manages reactor power allocation to weapons, shields, and drive.
//  Recomputes weapon/shield stats based on pip distribution and presets.
//
//  Reactor output belongs to the host chassis, not to the player, so the
//  number of pips there are to spend changes every time the influence
//  device hops into a different droid.
// ─────────────────────────────────────────────

import { state } from './state.js';
import {
    PIP_MAX,
    WEAPON_DAMAGE_MULT,
    WEAPON_COOLDOWN_MULT,
    SHIELD_MAX_MULT,
    DRIVE_SPEED_MULT,
    SHIELD_REGEN_PER_PIP,
    droidClasses,
    weaponTypes,
    DEVICE_WEAPON,
} from './config.js';

const POWER_SYSTEMS = ['weapons', 'shields', 'drive'];

// ─────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────

export function clampPip(n) {
    return Math.max(0, Math.min(PIP_MAX, Math.round(n)));
}

// The droid class the influence device is currently wearing.
export function getHostClass() {
    return droidClasses[state.playerDroidType] || droidClasses.droid_001;
}

// ─────────────────────────────────────────────
//  MULTIPLIER GETTERS
// ─────────────────────────────────────────────

export function getDriveSpeedMultiplier() {
    return DRIVE_SPEED_MULT[clampPip(state.power.drive)];
}

// A chassis's own top speed, geared by whatever is routed to the drive.
export function getPlayerSpeed() {
    return getHostClass().speed * getDriveSpeedMultiplier();
}

// Used by the ram/knockback split — a heavy chassis shoves lighter droids.
export function getPlayerWeight() {
    return getHostClass().weight;
}

export function getShieldRegenRate() {
    return getHostClass().shieldRegen + SHIELD_REGEN_PER_PIP * clampPip(state.power.shields);
}

// ─────────────────────────────────────────────
//  PIP RECOMPUTATION
// ─────────────────────────────────────────────

export function recomputePowerDerived() {
    // Weapon stats come from whatever gun is welded to the host chassis. An
    // unarmed chassis (a cleaner, say) does not leave the player defenceless:
    // the influence device brings its own weak gun along and falls back to it,
    // so there is always something to shoot with.
    const host = getHostClass();
    const def  = weaponTypes[host.weaponType || DEVICE_WEAPON] || null;
    const p    = clampPip(state.power.weapons);

    state.currentWeaponStats = def ? {
        cooldown:    Math.round(def.cooldown * WEAPON_COOLDOWN_MULT[p]),
        damage:      def.damage * WEAPON_DAMAGE_MULT[p],
        bulletSpeed: def.bulletSpeed,
        textureKey:  def.textureKey,
        colour:      def.colour,
        label:       def.label,
    } : null;

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
//  PIP DISTRIBUTION
// ─────────────────────────────────────────────
//  Splits `output` pips across weapons/shields/drive in the given ratio,
//  handing out the leftovers by largest fractional remainder. Shared by
//  the presets and by a transfer, which carries the player's current
//  split onto a chassis with a different-sized reactor.
export function distributePips(weights, output) {
    const totalWeight = POWER_SYSTEMS.reduce((sum, s) => sum + (weights[s] || 0), 0);
    const floors      = {};
    const remainders  = {};

    for (const system of POWER_SYSTEMS) {
        // An all-zero ratio would divide by zero — fall back to an even split.
        const share  = totalWeight > 0 ? (weights[system] || 0) / totalWeight : 1 / POWER_SYSTEMS.length;
        const target = share * output;
        floors[system]     = Math.min(PIP_MAX, Math.floor(target));
        remainders[system] = target - Math.floor(target);
    }

    let remaining = output - (floors.weapons + floors.shields + floors.drive);
    const order = POWER_SYSTEMS.slice().sort((a, b) => {
        const diff = remainders[b] - remainders[a];
        if (diff !== 0) { return diff; }
        // Tie-breaker: weapons, shields, drive order
        return POWER_SYSTEMS.indexOf(a) - POWER_SYSTEMS.indexOf(b);
    });

    // Several passes, because one pass can only add a single pip per system
    // and a big reactor may have more spare pips than there are systems.
    while (remaining > 0) {
        let placed = false;
        for (const system of order) {
            if (remaining <= 0) { break; }
            if (floors[system] >= PIP_MAX) { continue; }
            floors[system]++;
            remaining--;
            placed = true;
        }
        if (!placed) { break; }   // everything is capped; the rest stays unallocated
    }

    return floors;
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

    const split = distributePips(preset, state.power.reactorOutput);
    state.power.weapons = split.weapons;
    state.power.shields = split.shields;
    state.power.drive   = split.drive;
    recomputePowerDerived();
    return true;
}

// Carries the player's current ratio onto a reactor of a different size —
// called when a transfer swaps the host chassis underneath them.
export function rescalePipsToReactor() {
    const split = distributePips({
        weapons: state.power.weapons,
        shields: state.power.shields,
        drive:   state.power.drive,
    }, state.power.reactorOutput);

    state.power.weapons = split.weapons;
    state.power.shields = split.shields;
    state.power.drive   = split.drive;
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
