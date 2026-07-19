// ─────────────────────────────────────────────
//  INVENTORY SYSTEM
// ─────────────────────────────────────────────
//  Item collection, derived-stat recomputation, weapon equipping and
//  world pickups. Item placements come from the map's "Items" object
//  layer when present, else from deckDefinitions[deck].items.
//  Collected pickup ids live in state.inventory.collectedIds so an item
//  never respawns when a deck is revisited.
// ─────────────────────────────────────────────
import {
    TILE_SIZE, PLAYER_MAX_HULL, PLAYER_MAX_SHIELD_BASE, REACTOR_BASE_OUTPUT,
    deckDefinitions,
} from './config.js';
import { state } from './state.js';
import { itemTypes, playerWeaponTypes } from './items-config.js';
import { recomputePowerDerived } from './power.js';
import {
    tileToPixel, applyUnlockedDoors, showHudMessage, updateHUD,
} from './systems.js';

export const Items = {
    group: null,   // static physics group of uncollected pickups on this deck
};

const CATEGORY_COLOURS = {
    weapon:     0xff8844,
    shield:     0x44ddff,
    armour:     0x99aabb,
    power:      0x55ee77,
    quest_key:  0xffcc44,
    quest_code: 0xcc88ff,
};

// ─────────────────────────────────────────────
//  QUERIES
// ─────────────────────────────────────────────
export function hasQuestItem(codeId) {
    return state.inventory.items.some(entry => {
        const def = itemTypes[entry.itemId];
        return def && def.codeId === codeId;
    });
}

// The default blaster is built in; other weapons must be found first.
export function playerHasWeapon(weaponId) {
    if (weaponId === 'blaster') { return true; }
    return state.inventory.items.some(entry => {
        const def = itemTypes[entry.itemId];
        return def && def.weaponId === weaponId;
    });
}

// ─────────────────────────────────────────────
//  MUTATIONS
// ─────────────────────────────────────────────
export function addItemToInventory(itemId) {
    const existing = state.inventory.items.find(e => e.itemId === itemId);
    if (existing) { existing.count++; }
    else          { state.inventory.items.push({ itemId, count: 1 }); }
}

// Rebuilds every stat that derives from held items, then lets power.js
// re-derive the pip-dependent values on top.
export function recomputeDerivedStats() {
    let hullBonus = 0, shieldBonus = 0, reactorBonus = 0;
    const manta = { speedMult: 1, damageMult: 1 };

    for (const entry of state.inventory.items) {
        const def = itemTypes[entry.itemId];
        if (!def) { continue; }
        const fx = def.effects || {};
        hullBonus    += (fx.hullMaxBonus       || 0) * entry.count;
        shieldBonus  += (fx.shieldMaxBonus     || 0) * entry.count;
        reactorBonus += (fx.reactorOutputBonus || 0) * entry.count;

        if (def.mantaCompatible && def.mantaEffects) {
            for (let i = 0; i < entry.count; i++) {
                manta.speedMult  *= def.mantaEffects.speedMult  || 1;
                manta.damageMult *= def.mantaEffects.damageMult || 1;
            }
        }
    }

    // New armour plating arrives intact — grow current hull with the max.
    const prevHullMax = state.hullMax;
    state.hullMax = PLAYER_MAX_HULL + hullBonus;
    if (state.hullMax > prevHullMax) {
        state.hull += state.hullMax - prevHullMax;
    }
    state.hull = Math.min(state.hull, state.hullMax);

    state.shieldMaxBase       = PLAYER_MAX_SHIELD_BASE + shieldBonus;
    state.power.reactorOutput = REACTOR_BASE_OUTPUT + reactorBonus;
    state.mantaEffects        = manta;

    recomputePowerDerived();
}

export function equipWeapon(weaponId) {
    const def = playerWeaponTypes[weaponId];
    if (!def) { return false; }
    if (!playerHasWeapon(weaponId)) { return false; }
    if ((def.minReactorOutput || 0) > state.power.reactorOutput) { return false; }

    state.inventory.equippedWeaponId = weaponId;
    recomputePowerDerived();
    return true;
}

// ─────────────────────────────────────────────
//  WORLD PICKUPS
// ─────────────────────────────────────────────
function makeItemTexture(scene, category) {
    const key = 'item_' + category;
    if (scene.textures.exists(key)) { return key; }

    const colour = CATEGORY_COLOURS[category] ?? 0xffffff;
    const g = scene.add.graphics();
    g.fillStyle(colour, 1);
    g.fillRect(3, 3, 8, 8);
    g.lineStyle(1, 0xffffff, 0.8);
    g.strokeRect(2.5, 2.5, 9, 9);
    g.generateTexture(key, 14, 14);
    g.destroy();
    return key;
}

export function spawnItemsForDeck(map, deckName) {
    Items.group = state.scene.physics.add.staticGroup();

    const candidates = [];

    // A hand-placed Tiled "Items" layer overrides the config placements.
    let objLayer = map.getObjectLayer('Items');
    if (!objLayer) {
        const raw = map.objects ? map.objects.find(l => l.name === 'Items') : null;
        if (raw) { objLayer = raw; }
    }
    if (objLayer) {
        for (const obj of objLayer.objects) {
            const props = {};
            for (const p of (obj.properties || [])) { props[p.name] = p.value; }
            if (!props.itemId) { continue; }
            candidates.push({
                itemId:   props.itemId,
                x:        obj.x + (obj.width  || TILE_SIZE) / 2,
                y:        obj.y + (obj.height || TILE_SIZE) / 2,
                pickupId: deckName + ':obj:' + obj.id,
            });
        }
    } else {
        const defs = (deckDefinitions[deckName] && deckDefinitions[deckName].items) || [];
        defs.forEach((def, i) => {
            const p = tileToPixel(def.startTile);
            candidates.push({
                itemId: def.itemId, x: p.x, y: p.y,
                pickupId: deckName + ':cfg:' + i,
            });
        });
    }

    let placed = 0;
    for (const c of candidates) {
        const def = itemTypes[c.itemId];
        if (!def) {
            console.warn('ITEMS: unknown itemId "' + c.itemId + '" — skipping.');
            continue;
        }
        if (state.inventory.collectedIds.has(c.pickupId)) { continue; }

        const spr = Items.group.create(c.x, c.y, makeItemTexture(state.scene, def.category));
        spr.setDepth(20);   // above the floor, below fog (40) — hidden until lit
        spr.setData('itemId',   c.itemId);
        spr.setData('pickupId', c.pickupId);

        state.scene.tweens.add({
            targets: spr, alpha: 0.55, duration: 700, yoyo: true, repeat: -1,
        });
        placed++;
    }
    return placed;
}

export function onPlayerItemPickup(playerSprite, itemSprite) {
    const itemId   = itemSprite.getData('itemId');
    const pickupId = itemSprite.getData('pickupId');
    const def      = itemTypes[itemId];
    itemSprite.destroy();

    if (!def || state.inventory.collectedIds.has(pickupId)) { return; }

    state.inventory.collectedIds.add(pickupId);
    addItemToInventory(itemId);
    recomputeDerivedStats();

    // A fresh key may open doors on this very deck.
    if (def.category === 'quest_key') { applyUnlockedDoors(); }

    showHudMessage('ACQUIRED: ' + def.name.toUpperCase(), '#aaffcc');
    updateHUD();
}
