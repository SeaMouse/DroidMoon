// ─────────────────────────────────────────────
//  ITEM TYPES CATALOGUE
// ─────────────────────────────────────────────
//  Pure data: item definitions for inventory, cargo and quest systems.
//
//  Every item carries a `scope`:
//
//    'droid' — fitted to the chassis the influence device is wearing, and
//              re-fitted automatically to each new host after a transfer.
//              Armour plating is the only thing that qualifies: a droid's
//              hull, shields, reactor and gun are properties of the
//              chassis itself, taken by transferring, not by looting.
//
//    'manta' — salvage. Does nothing on the decks; it is stowed as cargo
//              and bolted onto the Manta for the surface runs in level1.
//
//  Quest keys and codes carry no scope — they are neither fitted nor cargo.
// ─────────────────────────────────────────────

export const itemTypes = {
    // ── Droid-scope: armour plating, carried between hosts ──
    armour_plate_mk1: {
        id:          'armour_plate_mk1',
        name:        'Armour Plating Mk1',
        category:    'armour',
        scope:       'droid',
        description: 'Welded to the host chassis. +25 hull.',
        effects:     { hullMaxBonus: 25 },
    },
    armour_plate_mk2: {
        id:          'armour_plate_mk2',
        name:        'Armour Plating Mk2',
        category:    'armour',
        scope:       'droid',
        description: 'Welded to the host chassis. +40 hull.',
        effects:     { hullMaxBonus: 40 },
    },

    // ── Manta-scope cargo: recovered for the ship, inert on the decks ──
    weapon_rapid_coil: {
        id:          'weapon_rapid_coil',
        name:        'Rapid Coil Assembly',
        category:    'weapon',
        scope:       'manta',
        description: 'Manta cargo. Ship guns cycle 25% faster.',
        mantaEffects: { fireRateMult: 0.75 },
    },
    weapon_heavy_cannon: {
        id:          'weapon_heavy_cannon',
        name:        'Heavy Cannon Core',
        category:    'weapon',
        scope:       'manta',
        description: 'Manta cargo. Ship guns hit 80% harder.',
        mantaEffects: { damageMult: 1.8 },
    },
    shield_capacitor_mk1: {
        id:          'shield_capacitor_mk1',
        name:        'Shield Capacitor Mk1',
        category:    'shield',
        scope:       'manta',
        description: 'Manta cargo. +30 ship integrity.',
        mantaEffects: { hullBonus: 30 },
    },
    shield_capacitor_mk2: {
        id:          'shield_capacitor_mk2',
        name:        'Shield Capacitor Mk2',
        category:    'shield',
        scope:       'manta',
        description: 'Manta cargo. +55 ship integrity.',
        mantaEffects: { hullBonus: 55 },
    },
    reactor_cell: {
        id:          'reactor_cell',
        name:        'Auxiliary Reactor Cell',
        category:    'power',
        scope:       'manta',
        description: 'Manta cargo. Ship runs 8% faster.',
        mantaEffects: { speedMult: 1.08 },
    },
    reactor_core_mk2: {
        id:          'reactor_core_mk2',
        name:        'Reactor Core Mk2',
        category:    'power',
        scope:       'manta',
        description: 'Manta cargo. Ship runs 20% faster and hits 20% harder.',
        mantaEffects: { speedMult: 1.2, damageMult: 1.2 },
    },
    manta_thruster_coil: {
        id:          'manta_thruster_coil',
        name:        'Manta Thruster Coil',
        category:    'power',
        scope:       'manta',
        description: 'Manta cargo. Ship runs 10% faster and hits 50% harder.',
        mantaEffects: { speedMult: 1.1, damageMult: 1.5 },
    },

    // ── Quest items ──
    keycode_bridge_01: {
        id:          'keycode_bridge_01',
        name:        'Bridge Access Key',
        category:    'quest_key',
        description: 'Unlocks the bridge blast door.',
        codeId:      'bridge_01',
    },
    securitycode_engineering: {
        id:          'securitycode_engineering',
        name:        'Engineering Security Code',
        category:    'quest_code',
        description: 'Grants access to engineering terminal.',
        codeId:      'eng_terminal_01',
    },
};

// Weighted table of salvage a destroyed droid can leave behind. All of it
// is Manta cargo — a wreck yields parts worth shipping out, never a better
// chassis, because the only way to get a better chassis is to take one.
export const enemyDropTable = [
    { itemId: 'reactor_cell',         weight: 3 },
    { itemId: 'shield_capacitor_mk1', weight: 3 },
    { itemId: 'armour_plate_mk1',     weight: 2 },
];
