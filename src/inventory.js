// ─────────────────────────────────────────────
//  INVENTORY SYSTEM
// ─────────────────────────────────────────────
//  Item collection, derived-stat recomputation, weapon equipping and
//  world pickups. Item placements come from the map's "Items" object
//  layer when present, else from deckDefinitions[deck].items; enemies
//  can also drop salvage where they die.
//
//  Persistence has two halves. Collected pickup ids live in
//  state.inventory.collectedIds so an item never respawns once taken;
//  enemy drops — which exist nowhere in the map or config — are recorded
//  in state.deckStates[deck].drops so they are still lying where they
//  fell when the player comes back to that deck.
//
//  Pickups are only drawn while the player has line of sight to them,
//  mirroring how enemies fade in and out in systems.js.
// ─────────────────────────────────────────────
import {
    TILE_SIZE, PLAYER_MAX_HULL, PLAYER_MAX_SHIELD_BASE, REACTOR_BASE_OUTPUT,
    ITEM_LOS_CHECK_INTERVAL_MS, ITEM_FADE_RATE,
    ITEM_PULSE_MIN_ALPHA, ITEM_PULSE_PERIOD_MS,
    deckDefinitions, enemyTypes,
} from './config.js';
import { state } from './state.js';
import { itemTypes, playerWeaponTypes, enemyDropTable } from './items-config.js';
import { recomputePowerDerived } from './power.js';
import {
    tileToPixel, applyUnlockedDoors, showHudMessage, updateHUD, hasLineOfSight,
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

// One pickup in the world. Starts fully transparent: the LOS pass in
// updateItemVisibility fades it in only once the player can see it.
function createItemSprite(itemId, x, y, pickupId) {
    const def = itemTypes[itemId];
    if (!def) {
        console.warn('ITEMS: unknown itemId "' + itemId + '" — skipping.');
        return null;
    }

    const spr = Items.group.create(x, y, makeItemTexture(state.scene, def.category));
    spr.setDepth(20);   // above the floor, below fog (40) — hidden until lit
    spr.setAlpha(0);
    spr.setData('itemId',   itemId);
    spr.setData('pickupId', pickupId);

    // Same idiom as Enemy: LOS is expensive, so it runs on a jittered timer
    // rather than every frame, and the result drives a smooth alpha lerp.
    spr.setData('losVisible',       false);
    spr.setData('losAlpha',         0);
    spr.setData('lastLosCheckTime', 0);
    spr.setData('losCheckInterval', ITEM_LOS_CHECK_INTERVAL_MS + Math.random() * 80);
    spr.setData('pulsePhase',       Math.random() * Math.PI * 2);
    return spr;
}

// Fades every pickup toward visible-or-not based on line of sight, then
// applies the idle pulse on top. Called once per frame from GameScene.
export function updateItemVisibility(time) {
    if (!Items.group) { return; }

    const player = state.player;
    if (!player) { return; }

    const pulse = (phase) => {
        const t = Math.sin(time / ITEM_PULSE_PERIOD_MS * Math.PI * 2 + phase) * 0.5 + 0.5;
        return ITEM_PULSE_MIN_ALPHA + (1 - ITEM_PULSE_MIN_ALPHA) * t;
    };

    for (const spr of Items.group.getChildren()) {
        if (!spr.active) { continue; }

        if (time >= spr.getData('lastLosCheckTime') + spr.getData('losCheckInterval')) {
            spr.setData('losVisible', hasLineOfSight(player.x, player.y, spr.x, spr.y));
            spr.setData('lastLosCheckTime', time);
        }

        const target = spr.getData('losVisible') ? 1 : 0;
        let losAlpha = spr.getData('losAlpha');
        losAlpha += (target - losAlpha) * ITEM_FADE_RATE;
        if (losAlpha < 0.01) { losAlpha = 0; }
        spr.setData('losAlpha', losAlpha);

        spr.setAlpha(losAlpha * pulse(spr.getData('pulsePhase')));
    }
}

// ─────────────────────────────────────────────
//  ENEMY DROPS
// ─────────────────────────────────────────────
// Drops are appended to the deck's record and never removed from it —
// collectedIds is what decides whether one still exists. Keeping the array
// append-only means a drop's index, and so its pickup id, stays stable
// across visits.
function getDeckDrops(deckName) {
    if (!state.deckStates[deckName]) {
        state.deckStates[deckName] = { drops: [] };
    }
    const deckState = state.deckStates[deckName];
    if (!deckState.drops) { deckState.drops = []; }
    return deckState.drops;
}

function rollDropItemId() {
    const total = enemyDropTable.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * total;
    for (const entry of enemyDropTable) {
        roll -= entry.weight;
        if (roll <= 0) { return entry.itemId; }
    }
    return enemyDropTable[enemyDropTable.length - 1].itemId;
}

// Rolls the dead enemy's drop chance and, on a hit, leaves salvage at the
// wreck. Called from systems.bulletHitEnemy.
export function maybeDropItem(x, y, enemyTypeName) {
    const typeDef = enemyTypes[enemyTypeName];
    if (!typeDef || !typeDef.dropChance) { return null; }
    if (Math.random() >= typeDef.dropChance) { return null; }

    const itemId   = rollDropItemId();
    const deckName = state.currentDeck;
    const drops    = getDeckDrops(deckName);
    const pickupId = deckName + ':drop:' + drops.length;

    drops.push({ itemId, x, y, pickupId });

    const spr = createItemSprite(itemId, x, y, pickupId);
    if (spr) { showHudMessage('SALVAGE DETECTED', '#aaffcc'); }
    return spr;
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

    // Salvage dropped by enemies killed here on an earlier visit.
    const drops = (state.deckStates[deckName] && state.deckStates[deckName].drops) || [];
    for (const d of drops) {
        candidates.push({ itemId: d.itemId, x: d.x, y: d.y, pickupId: d.pickupId });
    }

    let placed = 0;
    for (const c of candidates) {
        if (state.inventory.collectedIds.has(c.pickupId)) { continue; }
        if (createItemSprite(c.itemId, c.x, c.y, c.pickupId)) { placed++; }
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
