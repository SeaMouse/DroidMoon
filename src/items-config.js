// ─────────────────────────────────────────────
//  ITEM TYPES & PLAYER WEAPONS CATALOGUE
// ─────────────────────────────────────────────
//  Pure data: item definitions for inventory, equipment, and quest systems.
//  Player weapon types are distinct from enemy weapons in config.js.
// ─────────────────────────────────────────────

export const itemTypes = {
    weapon_rapid_coil: {
        id:          'weapon_rapid_coil',
        name:        'Rapid Coil Blaster',
        category:    'weapon',
        description: 'High-rate-of-fire energy weapon.',
        equip:       true,
        weaponId:    'rapid_blaster',
    },
    weapon_heavy_cannon: {
        id:          'weapon_heavy_cannon',
        name:        'Heavy Cannon',
        category:    'weapon',
        description: 'Devastating payload. Slow rate of fire.',
        equip:       true,
        weaponId:    'heavy_cannon',
    },
    shield_capacitor_mk1: {
        id:          'shield_capacitor_mk1',
        name:        'Shield Capacitor Mk1',
        category:    'shield',
        description: 'Boosts shield capacity by 20 points.',
        effects:     { shieldMaxBonus: 20 },
    },
    shield_capacitor_mk2: {
        id:          'shield_capacitor_mk2',
        name:        'Shield Capacitor Mk2',
        category:    'shield',
        description: 'Boosts shield capacity by 35 points.',
        effects:     { shieldMaxBonus: 35 },
    },
    armour_plate_mk1: {
        id:          'armour_plate_mk1',
        name:        'Armour Plating Mk1',
        category:    'armour',
        description: 'Reinforces hull integrity by 25 points.',
        effects:     { hullMaxBonus: 25 },
    },
    armour_plate_mk2: {
        id:          'armour_plate_mk2',
        name:        'Armour Plating Mk2',
        category:    'armour',
        description: 'Reinforces hull integrity by 40 points.',
        effects:     { hullMaxBonus: 40 },
    },
    reactor_core_mk2: {
        id:          'reactor_core_mk2',
        name:        'Reactor Core Mk2',
        category:    'power',
        description: 'Increases power output by 2 pips.',
        effects:     { reactorOutputBonus: 2 },
    },
    reactor_cell: {
        id:          'reactor_cell',
        name:        'Auxiliary Reactor Cell',
        category:    'power',
        description: 'Increases power output by 1 pip.',
        effects:     { reactorOutputBonus: 1 },
    },
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
    manta_thruster_coil: {
        id:          'manta_thruster_coil',
        name:        'Manta Thruster Coil',
        category:    'power',
        description: 'Boosts reactor output and ship performance.',
        effects:     { reactorOutputBonus: 1 },
        mantaCompatible: true,
        mantaEffects: { speedMult: 1.1, damageMult: 1.5 },
    },
};

export const playerWeaponTypes = {
    blaster: {
        label:            'Blaster',
        cooldown:         200,
        bulletSpeed:      400,
        damage:           1,
        colour:           0xffee00,
        textureKey:       'bullet',
        minReactorOutput: 0,
    },
    rapid_blaster: {
        label:            'Rapid Coil',
        cooldown:         110,
        bulletSpeed:      430,
        damage:           0.7,
        colour:           0x66ffee,
        textureKey:       'bullet_rapid',
        minReactorOutput: 0,
    },
    heavy_cannon: {
        label:            'Heavy Cannon',
        cooldown:         450,
        bulletSpeed:      320,
        damage:           3,
        colour:           0xff66aa,
        textureKey:       'bullet_heavy',
        minReactorOutput: 8,
    },
};
