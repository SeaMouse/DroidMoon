// ─────────────────────────────────────────────
//  GAMEPLAY SYSTEMS
// ─────────────────────────────────────────────
//  Wave 1: classes, nav graph, raycasting, lighting, tile helpers.
//  Wave 2 will add lifts, HUD, deck state, combat handlers, debug.
// ─────────────────────────────────────────────

import Phaser from 'phaser';
import {
    TILE_SIZE, PLAYER_WEIGHT,
    NODE_CONNECT_DIST, WANDER_BACKTRACK_CHANCE,
    PLAYER_MAX_ENERGY, INVINCIBILITY_MS,
    ENERGY_BAR_WIDTH, ENERGY_BAR_HEIGHT,
    LIFT_HOLD_MS,
    FOG_DARKNESS, FOG_COLOUR, LIGHT_MAX_RANGE, CONE_HALF_ANGLE, LIGHT_BAND_ERASE_ALPHA,
    DIM_COLOUR,
    deckDefinitions, weaponTypes, enemyTypes,
} from './config.js';
import { state } from './state.js';

// ─────────────────────────────────────────────
//  TILE HELPERS
// ─────────────────────────────────────────────
export function tileToPixel(tileCoord) {
    return {
        x: tileCoord.x * TILE_SIZE + TILE_SIZE / 2,
        y: tileCoord.y * TILE_SIZE + TILE_SIZE / 2
    };
}

// ─────────────────────────────────────────────
//  BULLET POOL
// ─────────────────────────────────────────────
export class BulletPool {
    constructor(scene, opts) {
        this.scene       = scene;
        this.textureKey  = opts.textureKey;
        this.defaultSpeed  = opts.defaultSpeed;
        this.defaultDamage = opts.defaultDamage;

        this.group = scene.physics.add.group({
            defaultKey: this.textureKey,
                maxSize:    opts.maxSize ?? 30,
        });
    }

    fire(x, y, dx, dy, opts = {}) {
        const bullet = this.group.get(x, y, opts.textureKey ?? this.textureKey);
        if (!bullet) { return null; }

        bullet.setActive(true);
        bullet.setVisible(true);
        bullet.body.enable = true;
        bullet.body.reset(x, y);
        bullet.setData('damage', opts.damage ?? this.defaultDamage);

        const speed = opts.speed ?? this.defaultSpeed;
        const angle = Math.atan2(dy, dx);
        bullet.setVelocityX(Math.cos(angle) * speed);
        bullet.setVelocityY(Math.sin(angle) * speed);

        return bullet;
    }

    deactivate(bullet) {
        bullet.setActive(false);
        bullet.setVisible(false);
        bullet.setVelocity(0);
        bullet.body.enable = false;
    }
}

// ─────────────────────────────────────────────
//  NAV GRAPH
// ─────────────────────────────────────────────
export function buildNavGraph(map) {
    state.navNodes = [];

    console.log('NAV: All layers found by Phaser:');
    map.layers.forEach(l => console.log('  tile layer:', l.name));
    if (map.objects) {
        map.objects.forEach(l => console.log('  object layer:', l.name));
    }

    let objLayer = map.getObjectLayer('Waypoints');

    if (!objLayer) {
        const raw = map.objects
        ? map.objects.find(l => l.name === 'Waypoints')
        : null;
        if (raw) {
            console.log('NAV: Found Waypoints via map.objects fallback.');
            objLayer = raw;
        }
    }

    if (!objLayer) {
        console.warn('NAV: "Waypoints" layer not found by either method. Check layer name exactly.');
        return;
    }

    objLayer.objects.forEach((obj, index) => {
        state.navNodes.push({ id: index, x: obj.x, y: obj.y, neighbours: [] });
    });

    console.log('NAV: Found ' + state.navNodes.length + ' waypoint objects.');

    for (let i = 0; i < state.navNodes.length; i++) {
        for (let j = i + 1; j < state.navNodes.length; j++) {
            const a    = state.navNodes[i];
            const b    = state.navNodes[j];
            const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
            if (dist <= NODE_CONNECT_DIST && hasLineOfSight(a.x, a.y, b.x, b.y)) {
                a.neighbours.push(b.id);
                b.neighbours.push(a.id);
            }
        }
    }

    const totalLinks = state.navNodes.reduce((sum, n) => sum + n.neighbours.length, 0) / 2;
    console.log('NAV: Graph built — ' + state.navNodes.length + ' nodes, ' + totalLinks + ' connections.');

    if (totalLinks === 0 && state.navNodes.length > 1) {
        console.warn('NAV: No connections formed! Nodes may be more than ' + NODE_CONNECT_DIST + 'px apart, or walls are blocking LOS.');
    }
}

export function findNearestNode(x, y) {
    let best     = null;
    let bestDist = Infinity;
    for (const node of state.navNodes) {
        const d = Phaser.Math.Distance.Between(x, y, node.x, node.y);
        if (d < bestDist) { bestDist = d; best = node; }
    }
    return best;
}

export function bfsPath(startId, goalId) {
    if (startId === goalId) { return []; }

    const visited = new Set([startId]);
    const queue   = [[startId]];

    while (queue.length > 0) {
        const path    = queue.shift();
        const current = path[path.length - 1];

        for (const neighbourId of state.navNodes[current].neighbours) {
            if (neighbourId === goalId) {
                return [...path.slice(1), neighbourId];
            }
            if (!visited.has(neighbourId)) {
                visited.add(neighbourId);
                queue.push([...path, neighbourId]);
            }
        }
    }
    return null;
}

export function pickWanderNode(enemy) {
    if (enemy.currentNodeId === null) { return null; }
    const node = state.navNodes[enemy.currentNodeId];
    if (!node || node.neighbours.length === 0) { return null; }

    let candidates = node.neighbours;

    if (enemy.previousNodeId !== null && candidates.length > 1) {
        const noBacktrack = candidates.filter(id => id !== enemy.previousNodeId);
        if (Math.random() > WANDER_BACKTRACK_CHANCE) {
            candidates = noBacktrack;
        }
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
}

export function reverseEnemyCourse(enemy) {
    if (enemy.previousNodeId !== null) {
        const prevNode = state.navNodes[enemy.previousNodeId];
        const oldCurrent = enemy.currentNodeId;
        enemy.currentNodeId  = enemy.previousNodeId;
        enemy.previousNodeId = oldCurrent;
        enemy.nodeTarget     = { x: prevNode.x, y: prevNode.y };
    } else {
        const nearest = findNearestNode(enemy.sprite.x, enemy.sprite.y);
        if (nearest) {
            enemy.currentNodeId = nearest.id;
            enemy.nodeTarget    = { x: nearest.x, y: nearest.y };
        }
    }
}

// ─────────────────────────────────────────────
//  RAYCASTING — line of sight
// ─────────────────────────────────────────────
export function hasLineOfSight(x1, y1, x2, y2, width) {
    const halfWidth = (width !== undefined ? width : 12);

    const dx  = x2 - x1;
    const dy  = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) { return true; }

    const perpX = -dy / len;
    const perpY =  dx / len;

    const offsets = [0, -halfWidth, halfWidth];

    for (const offset of offsets) {
        const ox = perpX * offset;
        const oy = perpY * offset;

        const steps = Math.ceil(len / 8);
        for (let i = 1; i < steps; i++) {
            const t       = i / steps;
            const sampleX = x1 + ox + dx * t;
            const sampleY = y1 + oy + dy * t;
            const tile    = state.wallLayer.getTileAtWorldXY(sampleX, sampleY);
            if (tile && tile.collides) { return false; }
        }
    }
    return true;
}

// ─────────────────────────────────────────────
//  WALL SEGMENT EXTRACTION
// ─────────────────────────────────────────────
function isWallTile(layer, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= layer.width || ty >= layer.height) {
        return false;
    }
    const tile = layer.getTileAt(tx, ty);
    return tile !== null && tile.collides;
}

export function extractWallSegments() {
    state.wallSegments = [];
    const layer = state.wallLayer;
    const W = layer.width;
    const H = layer.height;

    for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
            if (!isWallTile(layer, tx, ty)) { continue; }

            const left   = tx * TILE_SIZE;
            const top    = ty * TILE_SIZE;
            const right  = left + TILE_SIZE;
            const bottom = top  + TILE_SIZE;

            if (!isWallTile(layer, tx, ty - 1)) {
                state.wallSegments.push({ x1: left,  y1: top,    x2: right, y2: top    });
            }
            if (!isWallTile(layer, tx + 1, ty)) {
                state.wallSegments.push({ x1: right, y1: top,    x2: right, y2: bottom });
            }
            if (!isWallTile(layer, tx, ty + 1)) {
                state.wallSegments.push({ x1: left,  y1: bottom, x2: right, y2: bottom });
            }
            if (!isWallTile(layer, tx - 1, ty)) {
                state.wallSegments.push({ x1: left,  y1: top,    x2: left,  y2: bottom });
            }
        }
    }
}

export function extractWallCorners() {
    state.wallCorners = [];
    const layer = state.wallLayer;
    const W = layer.width;
    const H = layer.height;

    for (let vy = 0; vy <= H; vy++) {
        for (let vx = 0; vx <= W; vx++) {
            const tl = isWallTile(layer, vx - 1, vy - 1);
            const tr = isWallTile(layer, vx,     vy - 1);
            const bl = isWallTile(layer, vx - 1, vy);
            const br = isWallTile(layer, vx,     vy);

            const count = (tl?1:0) + (tr?1:0) + (bl?1:0) + (br?1:0);

            if (count === 0 || count === 4) { continue; }

            if (count === 2) {
                const diagonal = (tl && br) || (tr && bl);
                if (!diagonal) { continue; }
            }

            state.wallCorners.push({ x: vx * TILE_SIZE, y: vy * TILE_SIZE });
        }
    }
}

// ─────────────────────────────────────────────
//  RAYCASTING — line vs segment intersection
// ─────────────────────────────────────────────
export function castRay(originX, originY, angle) {
    const rdx = Math.cos(angle);
    const rdy = Math.sin(angle);

    let closestT = Infinity;
    let hitX = originX + rdx * 10000;
    let hitY = originY + rdy * 10000;

    for (const seg of state.wallSegments) {
        const sdx = seg.x2 - seg.x1;
        const sdy = seg.y2 - seg.y1;

        const denom = sdx * rdy - rdx * sdy;
        if (Math.abs(denom) < 1e-9) { continue; }

        const rhsX = seg.x1 - originX;
        const rhsY = seg.y1 - originY;

        const t = (sdx * rhsY - sdy * rhsX) / denom;
        const u = (rdx * rhsY - rdy * rhsX) / denom;

        if (t > 0 && u >= 0 && u <= 1 && t < closestT) {
            closestT = t;
            hitX = originX + rdx * t;
            hitY = originY + rdy * t;
        }
    }

    return { x: hitX, y: hitY, dist: closestT };
}

// ─────────────────────────────────────────────
//  VISIBILITY POLYGON
// ─────────────────────────────────────────────
export function computeVisibilityPolygon(originX, originY) {
    const EPS = 0.0001;

    const seen    = new Set();
    const corners = [];
    for (const seg of state.wallSegments) {
        const k1 = seg.x1 + ',' + seg.y1;
        if (!seen.has(k1)) { seen.add(k1); corners.push({ x: seg.x1, y: seg.y1 }); }
        const k2 = seg.x2 + ',' + seg.y2;
        if (!seen.has(k2)) { seen.add(k2); corners.push({ x: seg.x2, y: seg.y2 }); }
    }

    const hits = [];
    for (const c of corners) {
        const baseAngle = Math.atan2(c.y - originY, c.x - originX);
        const angles    = [baseAngle - EPS, baseAngle, baseAngle + EPS];
        for (const a of angles) {
            const hit = castRay(originX, originY, a);
            hits.push({ x: hit.x, y: hit.y, angle: a });
        }
    }

    hits.sort((a, b) => a.angle - b.angle);
    return hits;
}

export function computeConeVisibilityPolygon(originX, originY, facing, halfAngle, range) {
    const EPS      = 0.0001;
    const RANGE    = range;
    const RANGE_SQ = RANGE * RANGE;

    function relAngle(a) {
        let d = a - facing;
        while (d >  Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
    }

    function castClamped(angle) {
        const hit = castRay(originX, originY, angle);
        const dx  = hit.x - originX;
        const dy  = hit.y - originY;
        if (dx * dx + dy * dy > RANGE_SQ) {
            hit.x = originX + Math.cos(angle) * RANGE;
            hit.y = originY + Math.sin(angle) * RANGE;
        }
        return hit;
    }

    const hits = [];

    let h = castClamped(facing - halfAngle);
    hits.push({ x: h.x, y: h.y, rel: -halfAngle });
    h = castClamped(facing + halfAngle);
    hits.push({ x: h.x, y: h.y, rel:  halfAngle });

    const ARC_RAY_COUNT = 24;
    for (let i = 1; i < ARC_RAY_COUNT; i++) {
        const rel = -halfAngle + (i / ARC_RAY_COUNT) * (2 * halfAngle);
        const hit = castClamped(facing + rel);
        hits.push({ x: hit.x, y: hit.y, rel: rel });
    }

    for (const c of state.wallCorners) {
        const dx = c.x - originX;
        const dy = c.y - originY;
        if (dx * dx + dy * dy > RANGE_SQ) { continue; }

        const baseAngle = Math.atan2(dy, dx);
        const baseRel   = relAngle(baseAngle);
        if (Math.abs(baseRel) >= halfAngle) { continue; }

        for (const offset of [-EPS, 0, EPS]) {
            const rel = baseRel + offset;
            if (Math.abs(rel) > halfAngle) { continue; }
            const hit = castClamped(baseAngle + offset);
            hits.push({ x: hit.x, y: hit.y, rel: rel });
        }
    }

    hits.sort((a, b) => a.rel - b.rel);

    const poly = [{ x: originX, y: originY }];
    for (const hit of hits) {
        poly.push({ x: hit.x, y: hit.y });
    }
    return poly;
}

// ─────────────────────────────────────────────
//  FOG OF WAR
// ─────────────────────────────────────────────
export function updateFogOfWar() {
    if (!state.fogRT) { return; }

    if (!isDeckCleared()) {
        state.fogRT.setVisible(false);
        return;
    }
    state.fogRT.setVisible(true);

    state.fogRT.clear();
    state.fogRT.fill(FOG_COLOUR, FOG_DARKNESS);

    const ranges = [
        LIGHT_MAX_RANGE,
        LIGHT_MAX_RANGE * 2 / 3,
        LIGHT_MAX_RANGE * 1 / 3,
    ];

    for (const range of ranges) {
        const poly = computeConeVisibilityPolygon(
            state.player.x, state.player.y, state.playerFacing, CONE_HALF_ANGLE, range
        );
        if (poly.length < 3) { continue; }

        const eraseGfx = state.scene.make.graphics({ x: 0, y: 0 }, false);
        eraseGfx.fillStyle(0xffffff, LIGHT_BAND_ERASE_ALPHA);
        eraseGfx.beginPath();
        eraseGfx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
            eraseGfx.lineTo(poly[i].x, poly[i].y);
        }
        eraseGfx.closePath();
        eraseGfx.fillPath();

        state.fogRT.erase(eraseGfx);
        eraseGfx.destroy();
    }
}

// ─────────────────────────────────────────────
//  ENEMY CLASS
// ─────────────────────────────────────────────
export class Enemy {
    constructor(scene, typeName, x, y, opts = {}) {
        const typeDef = enemyTypes[typeName];
        if (!typeDef) {
            throw new Error('Unknown enemy type: ' + typeName);
        }

        const sprite = scene.physics.add.sprite(x, y, typeName);
        sprite.setAlpha(0);
        sprite.setCollideWorldBounds(true);
        scene.physics.add.collider(sprite, state.wallLayer);
        state.enemyGroup.add(sprite);
        sprite.setData('entity', this);

        let nodeId, target;
        if (opts.currentNodeId !== undefined && state.navNodes[opts.currentNodeId]) {
            const n = state.navNodes[opts.currentNodeId];
            nodeId = n.id;
            target = { x: n.x, y: n.y };
        } else {
            const nearest = findNearestNode(x, y);
            nodeId = nearest ? nearest.id : null;
            target = nearest ? { x: nearest.x, y: nearest.y } : null;
        }

        this.sprite         = sprite;
        this.typeName       = typeName;
        this.label          = typeDef.label;
        this.hp             = opts.hp ?? typeDef.hp;
        this.contactDamage  = typeDef.contactDamage;
        this.speed          = typeDef.speed;
        this.detectRange    = typeDef.detectRange;
        this.weaponType     = typeDef.weaponType;

        this.currentNodeId  = nodeId;
        this.previousNodeId = opts.previousNodeId ?? null;
        this.nodeTarget     = target;

        this.lastShotTime       = 0;
        this.lastStuckCheckTime = 0;
        this.lastStuckCheckPos  = { x: x, y: y };
        this.bounceCooldown     = 0;
        this.knockbackUntil     = 0;
    }

    update(time) {
        const sprite = this.sprite;
        const player = state.player;

        const los          = hasLineOfSight(player.x, player.y, sprite.x, sprite.y);
        const distToPlayer = Phaser.Math.Distance.Between(sprite.x, sprite.y, player.x, player.y);
        const targetAlpha  = los ? 1 : 0;
        sprite.alpha += (targetAlpha - sprite.alpha) * 0.10;
        if (sprite.alpha < 0.01) { sprite.alpha = 0; }

        if (this.nodeTarget === null) {
            sprite.setVelocity(0);
            return;
        }

        if (time < this.knockbackUntil) {
            if (this.weaponType !== null && los && distToPlayer < this.detectRange) {
                enemyShoot(this, time);
            }
            return;
        }

        if (time > this.knockbackUntil && time > this.lastStuckCheckTime + 1000) {
            const movedDist = Phaser.Math.Distance.Between(
                sprite.x, sprite.y,
                this.lastStuckCheckPos.x, this.lastStuckCheckPos.y
            );
            if (movedDist < 8) {
                if (this.previousNodeId !== null) {
                    const prevNode = state.navNodes[this.previousNodeId];
                    this.currentNodeId  = this.previousNodeId;
                    this.previousNodeId = null;
                    this.nodeTarget     = { x: prevNode.x, y: prevNode.y };
                } else {
                    const nearestNode = findNearestNode(sprite.x, sprite.y);
                    if (nearestNode) {
                        this.currentNodeId = nearestNode.id;
                        this.nodeTarget    = { x: nearestNode.x, y: nearestNode.y };
                    }
                }
            }
            this.lastStuckCheckTime = time;
            this.lastStuckCheckPos  = { x: sprite.x, y: sprite.y };
        }

        const distToNode = Phaser.Math.Distance.Between(
            sprite.x, sprite.y, this.nodeTarget.x, this.nodeTarget.y
        );

        if (distToNode < 4) {
            let nextId = null;

            if (this.weaponType !== null) {
                if (los && distToPlayer < this.detectRange) {
                    const playerNode = findNearestNode(player.x, player.y);
                    if (playerNode) {
                        const path = bfsPath(this.currentNodeId, playerNode.id);
                        if (path && path.length > 0) {
                            nextId = path[0];
                        }
                    }
                }
            }

            if (nextId === null) {
                nextId = pickWanderNode(this);
            }

            if (nextId !== null) {
                this.previousNodeId = this.currentNodeId;
                this.currentNodeId  = nextId;
                this.nodeTarget     = { x: state.navNodes[nextId].x, y: state.navNodes[nextId].y };
            }
        }

        const moveAngle = Phaser.Math.Angle.Between(
            sprite.x, sprite.y, this.nodeTarget.x, this.nodeTarget.y
        );
        sprite.setVelocityX(Math.cos(moveAngle) * this.speed);
        sprite.setVelocityY(Math.sin(moveAngle) * this.speed);

        if (this.weaponType !== null) {
            if (los && distToPlayer < this.detectRange) {
                enemyShoot(this, time);
            }
        }
    }

    serialise() {
        return {
            typeName:       this.typeName,
            x:              this.sprite.x,
            y:              this.sprite.y,
            hp:             this.hp,
            currentNodeId:  this.currentNodeId,
            previousNodeId: this.previousNodeId,
        };
    }
}

// ─────────────────────────────────────────────
//  LIFT SYSTEM
// ─────────────────────────────────────────────
export const Lifts = {
    zones:        [],
    zoneGroup:    null,
    playerOn:     null,
    holdStart:    0,
    progressBg:   null,
    progressFill: null,
    inputGated:   false,
};

export function parseLiftZones(map) {
    let objLayer = map.getObjectLayer('Lifts');

    if (!objLayer) {
        const raw = map.objects
        ? map.objects.find(l => l.name === 'Lifts')
        : null;
        if (raw) { objLayer = raw; }
    }

    if (!objLayer) {
        console.log('LIFTS: No "Lifts" object layer found on this deck.');
        return;
    }

    for (const obj of objLayer.objects) {
        let connectedDecks = [];
        if (obj.properties) {
            const decksProp = obj.properties.find(p => p.name === 'Decks');
            if (decksProp) {
                connectedDecks = decksProp.value.split(',').map(s => s.trim());
            }
        }

        if (connectedDecks.length === 0) {
            console.warn('LIFTS: Lift object at (' + obj.x + ',' + obj.y + ') has no "decks" property — skipping.');
            continue;
        }

        const w = obj.width  || TILE_SIZE;
        const h = obj.height || TILE_SIZE;
        const cx = obj.x + w / 2;
        const cy = obj.y + h / 2;

        const zone = state.scene.add.zone(cx, cy, w, h);
        state.scene.physics.add.existing(zone, true);
        Lifts.zoneGroup.add(zone);

        const indicator = state.scene.add.graphics();
        indicator.lineStyle(2, 0x44aaff, 0.6);
        indicator.strokeRect(obj.x, obj.y, w, h);
        indicator.fillStyle(0x44aaff, 0.15);
        indicator.fillRect(obj.x, obj.y, w, h);

        state.scene.add.text(cx, obj.y - 8, 'LIFT', {
            fontFamily: 'monospace', fontSize: '8px', fill: '#44aaff'
        }).setOrigin(0.5, 1);

        Lifts.zones.push({
            zone:  zone,
            x:     cx,
            y:     cy,
            decks: connectedDecks,
        });
    }

    console.log('LIFTS: Parsed ' + Lifts.zones.length + ' lift zone(s) on ' + state.currentDeck + '.');
}

export function findPlayerLiftOverlap() {
    const pb = state.player.getBounds();
    for (const lift of Lifts.zones) {
        const zb = lift.zone.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(pb, zb)) {
            return lift;
        }
    }
    return null;
}

export function updateLiftHold(time, pad) {
    const DEAD_ZONE = 0.15;
    let holdInput = false;

    if (pad) {
        const RSX = pad.rightStick.x;
        const RSY = pad.rightStick.y;
        holdInput = (Math.abs(RSX) > DEAD_ZONE || Math.abs(RSY) > DEAD_ZONE);
    }

    if (state.keys.f.isDown) { holdInput = true; }

    if (Lifts.inputGated) {
        if (!holdInput) { Lifts.inputGated = false; }
        Lifts.playerOn = null;
        return;
    }

    Lifts.playerOn = findPlayerLiftOverlap();

    if (Lifts.playerOn && holdInput) {
        if (Lifts.holdStart === 0) {
            Lifts.holdStart = time;
        }

        const elapsed  = time - Lifts.holdStart;
        const progress = Math.min(elapsed / LIFT_HOLD_MS, 1);

        const barW = 120;
        const barH = 10;
        const barX = (800 - barW) / 2;
        const barY = 560;

        Lifts.progressBg.setVisible(true);
        Lifts.progressBg.clear();
        Lifts.progressBg.fillStyle(0x222244, 0.8);
        Lifts.progressBg.fillRect(barX, barY, barW, barH);

        Lifts.progressFill.setVisible(true);
        Lifts.progressFill.clear();
        Lifts.progressFill.fillStyle(0x44aaff, 1);
        Lifts.progressFill.fillRect(barX, barY, Math.round(barW * progress), barH);

        if (progress >= 1) {
            Lifts.holdStart = 0;
            Lifts.progressBg.setVisible(false);
            Lifts.progressFill.setVisible(false);
            showDeckSelection(Lifts.playerOn);
        }
    } else {
        if (Lifts.holdStart !== 0) {
            Lifts.holdStart = 0;
            Lifts.progressBg.setVisible(false);
            Lifts.progressFill.setVisible(false);
        }
    }
}

export function showDeckSelection(liftData) {
    state.scene.scene.pause();
    state.scene.scene.launch('DeckSelectScene', { lift: liftData });
}

export function switchToDeck(targetDeck) {
    saveDeckState(state.currentDeck);
    state.lastDeck       = state.currentDeck;
    state.playerSpawnPos = null;
    state.currentDeck    = targetDeck;
    state.scene.scene.restart();
}

// ─────────────────────────────────────────────
//  DECK STATE
// ─────────────────────────────────────────────
export function saveDeckState(deckName) {
    const saved = state.enemies.map(e => e.serialise());

    const wasCleared = state.deckStates[deckName] && state.deckStates[deckName].cleared;
    state.deckStates[deckName] = {
        enemies: saved,
        cleared: wasCleared || false,
    };

    console.log('STATE: Saved ' + saved.length + ' enemy(s) for ' + deckName + '.');
}

function restoreEnemiesFromState(deckState) {
    for (const saved of deckState.enemies) {
        if (!enemyTypes[saved.typeName]) { continue; }

        state.enemies.push(new Enemy(state.scene, saved.typeName, saved.x, saved.y, {
            hp:             saved.hp,
            currentNodeId:  saved.currentNodeId,
            previousNodeId: saved.previousNodeId,
        }));
    }
}

function spawnFreshEnemies(enemyDefs) {
    for (const def of enemyDefs) {
        if (!enemyTypes[def.type]) {
            console.warn('Unknown enemy type "' + def.type + '" — skipping.');
            continue;
        }

        const x = def.startTile.x * TILE_SIZE + TILE_SIZE / 2;
        const y = def.startTile.y * TILE_SIZE + TILE_SIZE / 2;

        state.enemies.push(new Enemy(state.scene, def.type, x, y));
    }
}

export function spawnEnemiesForDeck(deckName) {
    if (state.deckStates[deckName]) {
        console.log('STATE: Restoring saved enemies for ' + deckName + '.');
        restoreEnemiesFromState(state.deckStates[deckName]);
    } else {
        const deckDef = deckDefinitions[deckName];
        console.log('STATE: Spawning ' + deckDef.enemies.length + ' fresh enemy(s) for ' + deckName + '.');
        spawnFreshEnemies(deckDef.enemies);
    }
}

export function isDeckCleared() {
    return !!(state.deckStates[state.currentDeck] && state.deckStates[state.currentDeck].cleared);
}

export function areAllDecksCleared() {
    for (const deckName of Object.keys(deckDefinitions)) {
        const def = deckDefinitions[deckName];
        if (!def.enemies || def.enemies.length === 0) { continue; }
        if (!state.deckStates[deckName] || !state.deckStates[deckName].cleared) {
            return false;
        }
    }
    return true;
}

// ─────────────────────────────────────────────
//  DECK SHUTDOWN
// ─────────────────────────────────────────────
export function applyDeckDim() {
    state.wallLayer.forEachTile(tile => {
        const isLight = tile.properties && tile.properties.light;
        tile.tint = isLight ? 0xffffff : DIM_COLOUR;
    });
}

export function checkDeckClearance() {
    if (state.deckStates[state.currentDeck] && state.deckStates[state.currentDeck].cleared) { return; }
    if (state.enemies.length > 0) { return; }

    const deckDef = deckDefinitions[state.currentDeck];
    if (!deckDef || !deckDef.enemies || deckDef.enemies.length === 0) { return; }

    triggerDeckShutdown();

    if (areAllDecksCleared()) {
        state.scene.time.delayedCall(2500, () => {
            state.scene.scene.start('EndScene', { result: 'won' });
        });
    }
}

function triggerDeckShutdown() {
    if (!state.deckStates[state.currentDeck]) {
        state.deckStates[state.currentDeck] = { enemies: [] };
    }
    state.deckStates[state.currentDeck].cleared = true;

    applyDeckDim();
    showDeckClearedMessage();

    console.log('SHUTDOWN: ' + state.currentDeck + ' cleared — lights out.');
}

function showDeckClearedMessage() {
    const msg = state.scene.add.text(400, 260, 'DECK POWER DOWN', {
        fontFamily: 'monospace', fontSize: '32px',
        fill: '#44aaff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(55).setAlpha(0);

    state.scene.tweens.add({
        targets:    msg,
        alpha:      1,
        duration:   500,
        yoyo:       true,
        hold:       1500,
        onComplete: () => msg.destroy(),
    });
}

// ─────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────
export function createHUD(scene) {
    const BAR_X = 12;
    const BAR_Y = 12;

    scene.add.text(BAR_X, BAR_Y, 'ENERGY', {
        fontFamily: 'monospace', fontSize: '10px', fill: '#aaffcc'
    }).setScrollFactor(0).setDepth(50);

    const barBg = scene.add.graphics();
    barBg.fillStyle(0x222233, 1);
    barBg.fillRect(BAR_X, BAR_Y + 12, ENERGY_BAR_WIDTH, ENERGY_BAR_HEIGHT);
    barBg.setScrollFactor(0).setDepth(50);

    state.energyBarFill = scene.add.graphics();
    state.energyBarFill.setScrollFactor(0).setDepth(51);

    state.killText = scene.add.text(BAR_X, BAR_Y + 32, 'Destroyed: 0', {
        fontFamily: 'monospace', fontSize: '12px', fill: '#aaffcc'
    });
    state.killText.setScrollFactor(0).setDepth(50);

    const deckDef = deckDefinitions[state.currentDeck];
    state.deckLabel = scene.add.text(800 - 12, 12, deckDef ? deckDef.label : state.currentDeck, {
        fontFamily: 'monospace', fontSize: '11px', fill: '#44aaff', align: 'right'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(50);

    updateHUD();
}

export function updateHUD() {
    const pct = state.playerEnergy / PLAYER_MAX_ENERGY;

    let colour;
    if      (pct > 0.5) { colour = 0x00dd55; }
    else if (pct > 0.25){ colour = 0xffcc00; }
    else                { colour = 0xff2244; }

    state.energyBarFill.clear();
    state.energyBarFill.fillStyle(colour, 1);
    state.energyBarFill.fillRect(12, 24, Math.round(ENERGY_BAR_WIDTH * pct), ENERGY_BAR_HEIGHT);

    state.killText.setText('Destroyed: ' + state.killCount);
}

// ─────────────────────────────────────────────
//  COMBAT — bullets and damage
// ─────────────────────────────────────────────
export function fireBullet(x, y, dx, dy) {
    state.playerBullets.fire(x, y, dx, dy);
}

export function enemyShoot(enemy, time) {
    const weaponDef = weaponTypes[enemy.weaponType];
    if (!weaponDef) { return; }

    if (time < enemy.lastShotTime + weaponDef.cooldown) { return; }
    enemy.lastShotTime = time;

    const dx = state.player.x - enemy.sprite.x;
    const dy = state.player.y - enemy.sprite.y;

    state.enemyBullets.fire(enemy.sprite.x, enemy.sprite.y, dx, dy, {
        textureKey: 'ebullet_' + enemy.weaponType,
        speed:      weaponDef.bulletSpeed,
        damage:     weaponDef.damage,
    });
}

export function bulletHitEnemy(bullet, enemySprite) {
    const damage = bullet.getData('damage') ?? 1;
    state.playerBullets.deactivate(bullet);

    const enemy = enemySprite.getData('entity');
    if (!enemy) { return; }

    enemy.hp -= damage;

    if (enemy.hp <= 0) {
        state.enemies = state.enemies.filter(e => e !== enemy);

        enemySprite.setActive(false);
        enemySprite.setVisible(false);
        enemySprite.body.enable = false;

        state.killCount++;
        updateHUD();

        state.scene.time.delayedCall(100, () => {
            enemySprite.destroy();
        });
        checkDeckClearance();
    } else {
        state.scene.tweens.add({
            targets:  enemySprite,
            alpha:    0.3,
            duration: 60,
            yoyo:     true
        });
    }
}

export function playerHitByEnemyBullet(playerSprite, bullet) {
    const damage = bullet.getData('damage') ?? 20;
    state.enemyBullets.deactivate(bullet);
    applyDamageToPlayer(damage);
}

export function applyDamageToPlayer(damage) {
    if (state.playerInvincible) { return; }

    state.playerEnergy = Math.max(0, state.playerEnergy - damage);
    updateHUD();

    if (state.playerEnergy <= 0) {
        triggerGameOver();
        return;
    }

    state.playerInvincible = true;

    state.scene.tweens.add({
        targets:    state.player,
        alpha:      0.2,
        duration:   100,
        yoyo:       true,
        repeat:     5,
        onComplete: () => { state.player.setAlpha(1); }
    });

    state.scene.time.delayedCall(INVINCIBILITY_MS, () => {
        state.playerInvincible = false;
    });
}

export function triggerGameOver() {
    state.gameOver = true;
    state.player.setVelocity(0);
    state.player.setAlpha(0.3);

    for (const enemy of state.enemies) { enemy.sprite.setVelocity(0); }

    state.scene.time.delayedCall(1200, () => {
        state.scene.scene.start('EndScene', { result: 'lost' });
    });
}

export function onPlayerEnemyCollide(playerSprite, enemySprite) {
    const enemy = enemySprite.getData('entity');
    if (!enemy) { return; }

    const wasInvincible = state.playerInvincible;
    applyDamageToPlayer(enemy.contactDamage);

    if (!wasInvincible) {
        const wEnemy = enemyTypes[enemy.typeName].weight;
        const total  = PLAYER_WEIGHT + wEnemy;

        const dx   = enemySprite.x - playerSprite.x;
        const dy   = enemySprite.y - playerSprite.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx   = dx / dist;
        const ny   = dy / dist;

        const PLAYER_BOUNCE = 220;
        playerSprite.setVelocity(
            -nx * PLAYER_BOUNCE * (wEnemy / total),
                                 -ny * PLAYER_BOUNCE * (wEnemy / total)
        );

        if (wEnemy < PLAYER_WEIGHT) {
            const MAX_PUSH   = 200;
            const pushFactor = (PLAYER_WEIGHT - wEnemy) / PLAYER_WEIGHT;
            enemySprite.setVelocity(
                nx * pushFactor * MAX_PUSH,
                ny * pushFactor * MAX_PUSH
            );

            enemy.knockbackUntil = state.scene.time.now + 150;
            reverseEnemyCourse(enemy);
        }
    }
}

export function onEnemyEnemyCollide(spriteA, spriteB) {
    const enemyA = spriteA.getData('entity');
    const enemyB = spriteB.getData('entity');
    if (!enemyA || !enemyB) { return; }

    const now = state.scene.time.now;
    if (now < enemyA.bounceCooldown || now < enemyB.bounceCooldown) { return; }

    const wA    = enemyTypes[enemyA.typeName].weight;
    const wB    = enemyTypes[enemyB.typeName].weight;
    const total = wA + wB;

    const dx   = spriteB.x - spriteA.x;
    const dy   = spriteB.y - spriteA.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx   = dx / dist;
    const ny   = dy / dist;

    const BOUNCE = 100;
    spriteA.setVelocity(-nx * BOUNCE * (wB / total), -ny * BOUNCE * (wB / total));
    spriteB.setVelocity( nx * BOUNCE * (wA / total),  ny * BOUNCE * (wA / total));

    const COOLDOWN_MS = 220;
    enemyA.bounceCooldown = now + COOLDOWN_MS;
    enemyB.bounceCooldown = now + COOLDOWN_MS;

    enemyA.knockbackUntil = now + COOLDOWN_MS;
    enemyB.knockbackUntil = now + COOLDOWN_MS;

    reverseEnemyCourse(enemyA);
    reverseEnemyCourse(enemyB);
}

// ─────────────────────────────────────────────
//  DEBUG
// ─────────────────────────────────────────────
export const Debug = {
    nav:        null,
    navStatic:  null,
    walls:      null,
    rays:       null,
    vis:        null,
    nodeLabels: [],
};

export function drawDebugWallSegments() {
    const gfx = state.scene.add.graphics();
    gfx.setDepth(49);

    gfx.lineStyle(1.5, 0xff00ff, 0.9);
    for (const seg of state.wallSegments) {
        gfx.beginPath();
        gfx.moveTo(seg.x1, seg.y1);
        gfx.lineTo(seg.x2, seg.y2);
        gfx.strokePath();
    }

    gfx.fillStyle(0xff8800, 1);
    for (const c of state.wallCorners) {
        gfx.fillCircle(c.x, c.y, 3);
    }

    gfx.setVisible(false);
    Debug.walls = gfx;
}

export function drawDebugRays() {
    const gfx = Debug.rays;
    gfx.clear();

    const RAYS = 64;
    gfx.lineStyle(1, 0xffee00, 0.6);
    for (let i = 0; i < RAYS; i++) {
        const angle = (i / RAYS) * Math.PI * 2;
        const hit   = castRay(state.player.x, state.player.y, angle);
        gfx.beginPath();
        gfx.moveTo(state.player.x, state.player.y);
        gfx.lineTo(hit.x, hit.y);
        gfx.strokePath();
    }
}

export function drawDebugVisibilityPolygon() {
    const gfx = Debug.vis;
    gfx.clear();

    const poly = computeVisibilityPolygon(state.player.x, state.player.y);
    if (poly.length < 3) { return; }

    gfx.fillStyle(0xffee88, 0.30);
    gfx.fillPoints(poly, true);

    gfx.lineStyle(1, 0xffcc00, 0.8);
    gfx.strokePoints(poly, true);

    gfx.fillStyle(0xff6600, 1);
    for (const p of poly) {
        gfx.fillCircle(p.x, p.y, 2);
    }
}

export function drawDebugNavStatic() {
    const staticGfx = state.scene.add.graphics();
    staticGfx.setDepth(50);

    Debug.nodeLabels = [];

    staticGfx.lineStyle(2, 0x00ff88, 0.85);
    for (const node of state.navNodes) {
        for (const neighbourId of node.neighbours) {
            if (neighbourId > node.id) {
                staticGfx.beginPath();
                staticGfx.moveTo(node.x, node.y);
                staticGfx.lineTo(state.navNodes[neighbourId].x, state.navNodes[neighbourId].y);
                staticGfx.strokePath();
            }
        }
        staticGfx.fillStyle(0x00ccff, 0.85);
        staticGfx.fillCircle(node.x, node.y, 5);

        const label = state.scene.add.text(node.x + 6, node.y - 6, String(node.id), {
            fontFamily: 'monospace', fontSize: '9px', fill: '#00ccff'
        }).setDepth(51).setVisible(false);
        Debug.nodeLabels.push(label);
    }
    staticGfx.setVisible(false);
    Debug.nav.setVisible(false);
    Debug.navStatic = staticGfx;
}

export function drawDebugNavDynamic() {
    if (!Debug.nav.visible) { return; }
    Debug.nav.clear();
    for (const enemy of state.enemies) {
        if (!enemy.nodeTarget) { continue; }
        Debug.nav.lineStyle(4, 0xffee00, 0.9);
        Debug.nav.beginPath();
        Debug.nav.moveTo(enemy.sprite.x, enemy.sprite.y);
        Debug.nav.lineTo(enemy.nodeTarget.x, enemy.nodeTarget.y);
        Debug.nav.strokePath();
        Debug.nav.fillStyle(0xffee00, 1);
        Debug.nav.fillCircle(enemy.nodeTarget.x, enemy.nodeTarget.y, 7);
    }
}
