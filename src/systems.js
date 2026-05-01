// ─────────────────────────────────────────────
//  GAMEPLAY SYSTEMS
// ─────────────────────────────────────────────
//  Wave 1: classes, nav graph, raycasting, lighting, tile helpers.
//  Wave 2 will add lifts, HUD, deck state, combat handlers, debug.
// ─────────────────────────────────────────────

import Phaser from 'phaser';
import {
    TILE_SIZE,
    NODE_CONNECT_DIST, WANDER_BACKTRACK_CHANCE,
    FOG_DARKNESS, FOG_COLOUR, LIGHT_MAX_RANGE, CONE_HALF_ANGLE, LIGHT_BAND_ERASE_ALPHA,
    enemyTypes,
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

    if (!isDeckClearedInline()) {
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

// Temporary inline copy — `isDeckCleared` lives in main.js until wave 2.
// Will be removed when wave 2 moves the real one here.
function isDeckClearedInline() {
    return !!(state.deckStates[state.currentDeck] && state.deckStates[state.currentDeck].cleared);
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
                enemyShootInline(this, time);
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
                enemyShootInline(this, time);
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

// Temporary inline copy of enemyShoot — moves out in wave 2.
import { weaponTypes } from './config.js';
function enemyShootInline(enemy, time) {
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
