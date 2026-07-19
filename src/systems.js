// ─────────────────────────────────────────────
//  GAMEPLAY SYSTEMS
// ─────────────────────────────────────────────
//  Shared classes and helpers: bullets, nav graph, raycasting,
//  lighting, lifts, HUD, deck state, combat, debug overlays.
// ─────────────────────────────────────────────
import Phaser from 'phaser';
import {
    TILE_SIZE, PLAYER_WEIGHT,
    NODE_CONNECT_DIST, WANDER_BACKTRACK_CHANCE,
    INVINCIBILITY_MS,
    LIFT_HOLD_MS, PIP_MAX,
    FOG_DARKNESS, FOG_DARKNESS_LIT, FOG_COLOUR, LIGHT_MAX_RANGE, CONE_HALF_ANGLE,
    LIGHT_BAND_ERASE_ALPHA, LIGHT_BAND_ERASE_ALPHA_LIT,
    DIM_COLOUR,
    deckDefinitions, weaponTypes, enemyTypes,
    AIM_LASER_MAX_RANGE, PLAYER_KNOCKBACK_SPEED, ENEMY_PUSH_MAX_SPEED,
    PLAYER_KNOCKBACK_MS, ENEMY_BOUNCE_SPEED, ENEMY_BOUNCE_COOLDOWN_MS, CONE_RAY_COUNT,
    CONE_BISECT_MAX_DEPTH, CONE_BISECT_MIN_ANGLE, CONE_BISECT_TOLERANCE_PX,
    LOS_CHECK_INTERVAL_MS,
    DOOR_PROXIMITY, DOOR_OPEN_MS, DOOR_LOCKED_TINT,
    INPUT_DEAD_ZONE,
    DEBUG_LOGS
} from './config.js';
import { state } from './state.js';
import { hasQuestItem, maybeDropItem } from './inventory.js';

// ─────────────────────────────────────────────
//  TILE HELPERS
// ─────────────────────────────────────────────
export function tileToPixel(tileCoord) {
    return {
        x: tileCoord.x * TILE_SIZE + TILE_SIZE / 2,
        y: tileCoord.y * TILE_SIZE + TILE_SIZE / 2
    };
}

export function debugLog(...args) {
    if (DEBUG_LOGS) { console.log(...args); }
}

export function makeCircleTexture(scene, key, colour, diameter) {
    if (scene.textures.exists(key)) { return; }
    const g = scene.add.graphics();
    g.fillStyle(colour, 1);
    g.fillCircle(diameter / 2, diameter / 2, diameter / 2);
    g.generateTexture(key, diameter, diameter);
    g.destroy();
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
        // Optional render depth applied per-shot — bullets are created lazily by
        // group.get(), so a one-time group.setDepth() would miss future bullets.
        this.depth         = opts.depth;

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
        if (this.depth !== undefined) { bullet.setDepth(this.depth); }
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

    debugLog('NAV: All layers found by Phaser:');
    map.layers.forEach(l => debugLog('  tile layer:', l.name));
    if (map.objects) {
        map.objects.forEach(l => debugLog('  object layer:', l.name));
    }

    let objLayer = map.getObjectLayer('Waypoints');

    if (!objLayer) {
        const raw = map.objects
        ? map.objects.find(l => l.name === 'Waypoints')
        : null;
        if (raw) {
            debugLog('NAV: Found Waypoints via map.objects fallback.');
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

    debugLog('NAV: Found ' + state.navNodes.length + ' waypoint objects.');

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
    debugLog('NAV: Graph built — ' + state.navNodes.length + ' nodes, ' + totalLinks + ' connections.');

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

    // Doors block sight like walls do, but they're segments, not tiles.
    // (Doors.segments is empty during buildNavGraph — parseDoors runs after
    // it — so waypoint links form through doorways; only live LOS is cut.)
    for (const seg of Doors.segments) {
        if (segmentsIntersect(x1, y1, x2, y2, seg.x1, seg.y1, seg.x2, seg.y2)) {
            return false;
        }
    }
    return true;
}

// Segment-segment intersection test — used for door occlusion, where the
// blocker is a thin moving segment rather than a grid of tiles.
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay;
    const d2x = dx - cx, d2y = dy - cy;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) { return false; }
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
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
export function castRay(originX, originY, angle, segments = state.wallSegments) {
    const rdx = Math.cos(angle);
    const rdy = Math.sin(angle);

    let closestT = Infinity;
    let hitX = originX + rdx * 10000;
    let hitY = originY + rdy * 10000;

    for (const seg of segments) {
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

// Squared distance from a point to a line segment — the broad-phase test for
// culling wall segments that can't affect a range-clamped cone.
function segmentDistSq(px, py, x1, y1, x2, y2) {
    const dx    = x2 - x1;
    const dy    = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
    const cx = x1 + t * dx - px;
    const cy = y1 + t * dy - py;
    return cx * cx + cy * cy;
}

// Persistent scratch list for the cone's culled segments — reused every frame
// instead of allocating a new array (same GC-avoidance idiom as fogEraseGfx).
const coneNearSegments = [];

// Enemies occlude light too. Each circular sprite is approximated by a
// "billboard" chord: a segment through its centre, perpendicular to the
// sight-line from the origin, spanning the sprite's silhouette. The chord's
// orientation depends on where the light comes from, so the list must be
// rebuilt per origin — callers build it and consume it in the same pass.
const enemyOccluders    = [];
const enemyOccluderPool = [];

function buildEnemyOccluders(originX, originY) {
    enemyOccluders.length = 0;
    for (const enemy of state.enemies) {
        const sprite = enemy.sprite;
        if (!sprite || !sprite.active) { continue; }

        const r    = sprite.displayWidth / 2;
        const dx   = sprite.x - originX;
        const dy   = sprite.y - originY;
        const dist = Math.hypot(dx, dy);
        if (dist <= r) { continue; }   // origin inside the enemy — no meaningful chord

        // Unit perpendicular to the sight-line.
        const px = -dy / dist;
        const py =  dx / dist;

        let seg = enemyOccluderPool[enemyOccluders.length];
        if (!seg) {
            seg = { x1: 0, y1: 0, x2: 0, y2: 0 };
            enemyOccluderPool[enemyOccluders.length] = seg;
        }
        seg.x1 = sprite.x - px * r;
        seg.y1 = sprite.y - py * r;
        seg.x2 = sprite.x + px * r;
        seg.y2 = sprite.y + py * r;
        enemyOccluders.push(seg);
    }
    return enemyOccluders;
}

// Casts the cone's rays and returns the sorted hit list. Callers can build a
// polygon from this directly, or re-clamp the same hits to a shorter range via
// clampConeHitsToRange() — the geometry only differs by the clamp, so multiple
// concentric bands never need more than one set of raycasts.
export function computeConeHits(originX, originY, facing, halfAngle, range) {
    const EPS      = 0.0001;
    const RANGE    = range;
    const RANGE_SQ = RANGE * RANGE;

    // --- Broad-phase cull, once per cone ---
    // Every hit past RANGE gets clamped onto the range arc below, so a segment
    // whose closest point is beyond RANGE can only ever produce clamped hits —
    // identical output to not testing it at all. Cull those once here, then
    // every ray (uniform, corner and bisection alike) casts against the small
    // survivor list instead of the whole map: O(segments + rays·near) instead
    // of O(rays·segments).
    coneNearSegments.length = 0;
    for (const seg of state.wallSegments) {
        if (segmentDistSq(originX, originY, seg.x1, seg.y1, seg.x2, seg.y2) <= RANGE_SQ) {
            coneNearSegments.push(seg);
        }
    }
    // Closed (or closing) doors occlude light exactly like walls; their
    // segments are rebuilt each frame by updateDoors so a sliding slab
    // shortens its shadow as it opens.
    for (const seg of Doors.segments) {
        if (segmentDistSq(originX, originY, seg.x1, seg.y1, seg.x2, seg.y2) <= RANGE_SQ) {
            coneNearSegments.push(seg);
        }
    }
    // Enemy bodies block the beam as well — the shadow edges come out of the
    // same adaptive bisection that sharpens wall silhouettes.
    for (const seg of buildEnemyOccluders(originX, originY)) {
        if (segmentDistSq(originX, originY, seg.x1, seg.y1, seg.x2, seg.y2) <= RANGE_SQ) {
            coneNearSegments.push(seg);
        }
    }

    function relAngle(a) {
        let d = a - facing;
        while (d >  Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
    }

    function castClamped(angle) {
        const hit = castRay(originX, originY, angle, coneNearSegments);
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

    for (let i = 1; i < CONE_RAY_COUNT; i++) {
        const rel = -halfAngle + (i / CONE_RAY_COUNT) * (2 * halfAngle);
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

    // --- Adaptive bisection ---
    // Uniform rays are a few degrees apart, which is far too coarse for walls
    // seen at grazing angles: hit spacing along the wall goes as 1/tan(gap),
    // so looking down a corridor the polygon would cut a straight chord from
    // the last wall hit to the range arc, leaving a visible dark wedge.
    // Corner rays can't rescue this case — a corridor face that runs past
    // `range` has its corners culled above. So wherever two adjacent rays
    // disagree about what they hit, keep splitting the angle between them
    // until the chord matches the surface (or we hit the depth/angle floor).
    const refined = [];

    function bisect(a, distA, b, distB, depth) {
        if (depth <= 0 || (b.rel - a.rel) < CONE_BISECT_MIN_ANGLE) { return; }
        // Hits at near-identical distance are the same feature (or both on
        // the arc) — the chord is already right, skip the midpoint cast.
        if (Math.abs(distA - distB) < CONE_BISECT_TOLERANCE_PX) { return; }

        const relMid  = (a.rel + b.rel) / 2;
        const hitMid  = castClamped(facing + relMid);
        const distMid = Math.hypot(hitMid.x - originX, hitMid.y - originY);

        // Midpoint ray landed on the chord between a and b → the chord
        // already matches the surface (e.g. one flat wall seen at a slant).
        const devX = hitMid.x - (a.x + b.x) / 2;
        const devY = hitMid.y - (a.y + b.y) / 2;
        if (devX * devX + devY * devY <
            CONE_BISECT_TOLERANCE_PX * CONE_BISECT_TOLERANCE_PX) { return; }

        const mid = { x: hitMid.x, y: hitMid.y, rel: relMid };
        refined.push(mid);
        bisect(a, distA, mid, distMid, depth - 1);
        bisect(mid, distMid, b, distB, depth - 1);
    }

    const dists = hits.map(h => Math.hypot(h.x - originX, h.y - originY));
    for (let i = 0; i < hits.length - 1; i++) {
        bisect(hits[i], dists[i], hits[i + 1], dists[i + 1], CONE_BISECT_MAX_DEPTH);
    }

    if (refined.length > 0) {
        hits.push(...refined);
        hits.sort((a, b) => a.rel - b.rel);
    }

    return hits;
}

// Builds a fan polygon from cone hits, pulling any hit beyond `range` back
// onto the arc. Reusing one hit list for several ranges skips re-raycasting.
export function clampConeHitsToRange(hits, originX, originY, facing, range) {
    const rangeSq = range * range;
    const poly = [{ x: originX, y: originY }];
    for (const hit of hits) {
        const dx = hit.x - originX;
        const dy = hit.y - originY;
        if (dx * dx + dy * dy > rangeSq) {
            const angle = facing + hit.rel;
            poly.push({
                x: originX + Math.cos(angle) * range,
                y: originY + Math.sin(angle) * range,
            });
        } else {
            poly.push({ x: hit.x, y: hit.y });
        }
    }
    return poly;
}

export function computeConeVisibilityPolygon(originX, originY, facing, halfAngle, range) {
    const hits = computeConeHits(originX, originY, facing, halfAngle, range);
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

    // The headlight is always on; the deck's own lights decide how much it
    // matters. Powered deck → a subtle ambient dim the cone cuts through;
    // shut-down deck → near-black fog and the cone is your only vision.
    const darkness   = isDeckCleared() ? FOG_DARKNESS : FOG_DARKNESS_LIT;
    // On powered decks the beam barely registers — it's competing with the
    // deck's own lights, so it only faintly brightens what it sweeps over.
    const eraseAlpha = isDeckCleared() ? LIGHT_BAND_ERASE_ALPHA : LIGHT_BAND_ERASE_ALPHA_LIT;

    state.fogRT.setVisible(true);
    state.fogRT.clear();
    state.fogRT.fill(FOG_COLOUR, darkness);

    // Cast the cone's rays ONCE at max range; the inner bands are the same
    // rays clamped shorter, so they don't need their own raycast pass.
    const hits = computeConeHits(
        state.player.x, state.player.y, state.playerFacing, CONE_HALF_ANGLE, LIGHT_MAX_RANGE
    );

    const ranges = [
        LIGHT_MAX_RANGE,
        LIGHT_MAX_RANGE * 2 / 3,
        LIGHT_MAX_RANGE * 1 / 3,
    ];

    // One persistent brush per band (created in GameScene.create), reused every
    // frame instead of allocating/destroying Graphics objects — avoids GC churn.
    // Kept separate per band because erase ops are only queued here — they
    // aren't executed until the RT's render pass flushes the command buffer.
    for (let i = 0; i < ranges.length; i++) {
        const eraseGfx = state.fogEraseGfx[i];
        if (!eraseGfx) { continue; }

        const poly = clampConeHitsToRange(
            hits, state.player.x, state.player.y, state.playerFacing, ranges[i]
        );
        if (poly.length < 3) { continue; }

        eraseGfx.clear();
        eraseGfx.fillStyle(0xffffff, eraseAlpha);
        eraseGfx.beginPath();
        eraseGfx.moveTo(poly[0].x, poly[0].y);
        for (let j = 1; j < poly.length; j++) {
            eraseGfx.lineTo(poly[j].x, poly[j].y);
        }
        eraseGfx.closePath();
        eraseGfx.fillPath();

        state.fogRT.erase(eraseGfx);
    }
    // No manual render() — the RT is in renderMode 'all', which flushes the
    // queued commands inside its own render pass. Flushing from update()
    // lands across the frame boundary and flickers on alternate frames.
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

        // LOS is expensive (tile sampling along 3 lines), so it's checked on a
        // timer rather than every frame. Random jitter de-syncs the enemies so
        // their checks don't all land on the same frame.
        this.losVisible       = false;
        this.lastLosCheckTime = 0;
        this.losCheckInterval = LOS_CHECK_INTERVAL_MS + Math.random() * 60;
    }

    update(time) {
        const sprite = this.sprite;
        const player = state.player;

        if (time >= this.lastLosCheckTime + this.losCheckInterval) {
            this.losVisible       = hasLineOfSight(player.x, player.y, sprite.x, sprite.y);
            this.lastLosCheckTime = time;
        }
        const los          = this.losVisible;
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
        debugLog('LIFTS: No "Lifts" object layer found on this deck.');
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

    debugLog('LIFTS: Parsed ' + Lifts.zones.length + ' lift zone(s) on ' + state.currentDeck + '.');
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
    let holdInput = false;

    if (pad) {
        const RSX = pad.rightStick.x;
        const RSY = pad.rightStick.y;
        holdInput = (Math.abs(RSX) > INPUT_DEAD_ZONE || Math.abs(RSY) > INPUT_DEAD_ZONE);
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

        const barW = 80;
        const barH = 7;
        const barX = (state.scene.scale.width - barW) / 2;
        const barY = state.scene.scale.height - 28;

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
//  DOOR SYSTEM
// ─────────────────────────────────────────────
//  Sliding doors from the map's "Doors" object layer. Each marker sits at
//  the pocket edge the slab slides in and out of: the LEFT end of a horiz
//  door, the TOP end of a vert door. The doorway length is measured from
//  the gap in the Obstacles layer, so doors fit whatever opening they're
//  placed in. Unlocked doors open for anyone (player or enemy) nearby;
//  locked doors never open and are solid to everything.
export const Doors = {
    list:       [],   // door records
    segments:   [],   // live occluder segments (rebuilt each frame — LOS, fog, laser)
    blockGroup: null, // every door body — bullets collide with these
    solidGroup: null, // locked doors only — player + enemies collide with these
};

// Clear module state from a previous deck. Must run before buildNavGraph so
// stale door segments can't block waypoint linking on the new deck.
export function resetDoors() {
    Doors.list       = [];
    Doors.segments   = [];
    Doors.blockGroup = null;
    Doors.solidGroup = null;
}

export function parseDoors(map) {
    resetDoors();

    let objLayer = map.getObjectLayer('Doors');
    if (!objLayer) {
        const raw = map.objects ? map.objects.find(l => l.name === 'Doors') : null;
        if (raw) { objLayer = raw; }
    }
    if (!objLayer) {
        debugLog('DOORS: No "Doors" object layer on this deck.');
        return;
    }

    const scene = state.scene;
    // Physics groups re-apply their default body config to every child added
    // (PhysicsGroup.createCallbackHandler), so immovable/gravity MUST be set
    // here in the group config — flags set on the body before add() get wiped.
    Doors.blockGroup = scene.physics.add.group({ immovable: true, allowGravity: false });
    Doors.solidGroup = scene.physics.add.group({ immovable: true, allowGravity: false });

    for (const obj of objLayer.objects) {
        const props  = {};
        for (const p of (obj.properties || [])) { props[p.name] = p.value; }

        const horiz  = props.orientation !== 'vert';
        const locked = !!props.locked;

        // Snap the hand-placed marker to the grid. Along the slide axis it
        // marks the pocket mouth → nearest tile edge. Across the doorway it
        // marks the door's centre line → nearest HALF-tile step, so it lands
        // on a tile boundary for walls two tiles thick (this map) and on a
        // tile centre for walls one tile thick.
        const HALF = TILE_SIZE / 2;
        let ax, ay, cx, cy, startTx, startTy;
        if (horiz) {
            ax      = Math.round(obj.x / TILE_SIZE) * TILE_SIZE;
            startTx = ax / TILE_SIZE;
            startTy = Math.floor(obj.y / TILE_SIZE);
            cy      = Math.round(obj.y / HALF) * HALF;
        } else {
            ay      = Math.round(obj.y / TILE_SIZE) * TILE_SIZE;
            startTy = ay / TILE_SIZE;
            startTx = Math.floor(obj.x / TILE_SIZE);
            cx      = Math.round(obj.x / HALF) * HALF;
        }

        // Measure the doorway: walk from the pocket mouth until the far jamb.
        let gapTiles = 0;
        while (gapTiles < 16 && !isWallTile(state.wallLayer,
            horiz ? startTx + gapTiles : startTx,
            horiz ? startTy : startTy + gapTiles)) {
            gapTiles++;
        }
        if (gapTiles === 0 || gapTiles >= 16) {
            console.warn('DOORS: marker at (' + obj.x + ',' + obj.y + ') is not at ' +
                'the edge of an Obstacles gap — skipping.');
            continue;
        }
        const length  = gapTiles * TILE_SIZE;
        const centerX = horiz ? ax + length / 2 : cx;
        const centerY = horiz ? cy : ay + length / 2;

        // Door sprite. Origin (0,0) with a floor()ed cross-axis position
        // keeps the static edges on whole pixels — with roundPixels on, a
        // half-pixel edge rounds at a different camera scroll than the
        // tilemap does and the door appears to wiggle against the map.
        const img = scene.add.image(0, 0, horiz ? 'door_horiz' : 'door_vert');
        img.setOrigin(0, 0);
        img.setDepth(30);   // above floor + entities, below fog (40) and laser (45)
        const texLen   = horiz ? img.width  : img.height;
        const texThick = horiz ? img.height : img.width;
        let cross0;   // fixed cross-axis top/left of the slab
        if (horiz) {
            cross0 = cy - Math.floor(texThick / 2);
            img.setPosition(ax, cross0);
            if (texLen !== length) { img.scaleX = length / texLen; }
        } else {
            cross0 = cx - Math.floor(texThick / 2);
            img.setPosition(cross0, ay);
            if (texLen !== length) { img.scaleY = length / texLen; }
        }
        if (locked) { img.setTint(DOOR_LOCKED_TINT); }

        // Invisible rectangle carrying the arcade body. The body is resized
        // to the visible slab whenever the door animates.
        const blocker = scene.add.rectangle(
            centerX, centerY,
            horiz ? length : texThick,
            horiz ? texThick : length
        ).setVisible(false);
        scene.physics.add.existing(blocker);
        Doors.blockGroup.add(blocker);
        if (locked) { Doors.solidGroup.add(blocker); }
        // After the group adds (their defaults run last). pushable isn't in
        // the group defaults, but immovable already prevents displacement —
        // this is belt-and-braces so a door body can never be nudged.
        blocker.body.pushable = false;

        Doors.list.push({
            horiz, locked, codeId: props.codeId || null,
            ax, ay, cx, cy, length, centerX, centerY,
            img, texLen, texThick, cross0,
            openT:     0,      // 0 = closed, 1 = slid fully into the pocket
            prevOpenT: -1,     // forces the first pose sync
            blocker,
            seg: { x1: 0, y1: 0, x2: 0, y2: 0 },   // reused occluder segment
        });
    }

    debugLog('DOORS: Parsed ' + Doors.list.length + ' door(s) on ' + state.currentDeck + '.');
    updateDoors(0);   // sync bodies, segments and visuals to the closed state
}

// Unlocks any locked door whose codeId is satisfied — either the player
// carries the matching quest key, or a terminal unlocked it remotely.
// Called after parseDoors on deck load, and again whenever a key is picked
// up or a terminal fires. Doors locked without a codeId stay locked forever.
export function applyUnlockedDoors() {
    let unlocked = 0;
    for (const door of Doors.list) {
        if (!door.locked || !door.codeId) { continue; }
        if (!hasQuestItem(door.codeId) && !state.unlockedCodes.has(door.codeId)) { continue; }

        door.locked = false;
        Doors.solidGroup.remove(door.blocker);
        door.img.clearTint();
        if (isDeckCleared()) { door.img.setTint(DIM_COLOUR); }
        unlocked++;
    }
    return unlocked;
}

// Locked doors never open, so waypoint links that cross them are dead ends —
// drop them so pathing enemies don't pile into a sealed doorway.
export function pruneNavLinksBlockedByDoors() {
    const lockedDoors = Doors.list.filter(d => d.locked);
    if (lockedDoors.length === 0) { return; }

    for (const node of state.navNodes) {
        node.neighbours = node.neighbours.filter(id => {
            const nb = state.navNodes[id];
            return !lockedDoors.some(d => segmentsIntersect(
                node.x, node.y, nb.x, nb.y,
                d.horiz ? d.ax : d.cx,            d.horiz ? d.cy : d.ay,
                d.horiz ? d.ax + d.length : d.cx, d.horiz ? d.cy : d.ay + d.length
            ));
        });
    }
}

export function updateDoors(delta) {
    if (Doors.list.length === 0) { return; }

    const step   = DOOR_OPEN_MS > 0 ? delta / DOOR_OPEN_MS : 1;
    const proxSq = DOOR_PROXIMITY * DOOR_PROXIMITY;

    Doors.segments.length = 0;

    for (const door of Doors.list) {
        // --- Proximity: anyone close to an unlocked door opens it ---
        let wantOpen = false;
        if (!door.locked) {
            const pdx = state.player.x - door.centerX;
            const pdy = state.player.y - door.centerY;
            wantOpen = pdx * pdx + pdy * pdy <= proxSq;
            if (!wantOpen) {
                for (const enemy of state.enemies) {
                    const edx = enemy.sprite.x - door.centerX;
                    const edy = enemy.sprite.y - door.centerY;
                    if (edx * edx + edy * edy <= proxSq) { wantOpen = true; break; }
                }
            }
        }

        door.openT = Phaser.Math.Clamp(door.openT + (wantOpen ? step : -step), 0, 1);

        // Visible slab: anchored at the pocket mouth, retracting toward it.
        const vis  = door.length * (1 - door.openT);
        const open = vis < 1;

        // --- Occluder segment (slab centre line) for LOS / fog / laser ---
        if (!open) {
            const seg = door.seg;
            if (door.horiz) {
                seg.x1 = door.ax;       seg.y1 = door.cy;
                seg.x2 = door.ax + vis; seg.y2 = door.cy;
            } else {
                seg.x1 = door.cx;       seg.y1 = door.ay;
                seg.x2 = door.cx;       seg.y2 = door.ay + vis;
            }
            Doors.segments.push(seg);
        }

        // --- Sprite + physics body follow the slab (only when it moved) ---
        if (door.openT !== door.prevOpenT) {
            door.prevOpenT = door.openT;
            syncDoorPose(door, vis, open);
        }
    }
}

// Positions the door sprite and body for the current slide. The slab moves
// into the pocket and the pocketed part is cropped away (in texture space,
// so the art never squashes), leaving the visible run anchored in the
// doorway at [pocket mouth, pocket mouth + vis].
function syncDoorPose(door, vis, open) {
    const img  = door.img;
    const body = door.blocker.body;

    if (open) {
        img.setVisible(false);
        body.enable = false;
        return;
    }

    const slide   = door.length  * door.openT;   // world px into the pocket
    const cropOfs = door.texLen  * door.openT;   // same, in texture px
    const cropLen = door.texLen  - cropOfs;

    img.setVisible(true);
    body.enable = true;

    if (door.horiz) {
        img.x = door.ax - slide;
        img.setCrop(cropOfs, 0, cropLen, door.texThick);
        body.setSize(vis, door.texThick, true);
        body.reset(door.ax + vis / 2, door.cross0 + door.texThick / 2);
    } else {
        img.y = door.ay - slide;
        img.setCrop(0, cropOfs, door.texThick, cropLen);
        body.setSize(door.texThick, vis, true);
        body.reset(door.cross0 + door.texThick / 2, door.ay + vis / 2);
    }
}

// ─────────────────────────────────────────────
//  COMPUTER TERMINALS
// ─────────────────────────────────────────────
//  Interactive consoles from the map's "Terminals" object layer. Hold F
//  on one (same gesture as lifts) to access it. A terminal may require a
//  security-code quest item (codeId) and fires its effect once:
//    effect: 'unlock_doors' — effectTarget lists door codeIds to unlock
//    effect: 'lore'         — message shows a one-shot text readout
export const Terminals = {
    zones:        [],
    playerOn:     null,
    holdStart:    0,
    deniedUntil:  0,
    progressBg:   null,
    progressFill: null,
};

export function parseTerminals(map) {
    Terminals.zones     = [];
    Terminals.playerOn  = null;
    Terminals.holdStart = 0;

    let objLayer = map.getObjectLayer('Terminals');
    if (!objLayer) {
        const raw = map.objects ? map.objects.find(l => l.name === 'Terminals') : null;
        if (raw) { objLayer = raw; }
    }
    if (!objLayer) {
        debugLog('TERMINALS: No "Terminals" object layer on this deck.');
        return;
    }

    for (const obj of objLayer.objects) {
        const props = {};
        for (const p of (obj.properties || [])) { props[p.name] = p.value; }

        const w  = obj.width  || TILE_SIZE;
        const h  = obj.height || TILE_SIZE;
        const cx = obj.x + w / 2;
        const cy = obj.y + h / 2;
        const id = state.currentDeck + ':term:' + obj.id;
        const used = state.usedTerminals.has(id);

        const zone = state.scene.add.zone(cx, cy, w, h);
        state.scene.physics.add.existing(zone, true);

        const tint = used ? 0x667788 : 0xffcc44;
        const indicator = state.scene.add.graphics();
        indicator.lineStyle(2, tint, 0.6);
        indicator.strokeRect(obj.x, obj.y, w, h);
        indicator.fillStyle(tint, 0.15);
        indicator.fillRect(obj.x, obj.y, w, h);

        state.scene.add.text(cx, obj.y - 8, 'TERMINAL', {
            fontFamily: 'monospace', fontSize: '10px', resolution: 2,
            fill: used ? '#667788' : '#ffcc44',
        }).setOrigin(0.5, 1);

        Terminals.zones.push({
            zone, id, used, indicator,
            x: cx, y: cy,
            codeId:       props.codeId       || null,
            effect:       props.effect       || 'lore',
            effectTarget: props.effectTarget || '',
            message:      props.message      || '',
        });
    }

    Terminals.progressBg = state.scene.add.graphics();
    Terminals.progressBg.setScrollFactor(0).setDepth(52).setVisible(false);
    Terminals.progressFill = state.scene.add.graphics();
    Terminals.progressFill.setScrollFactor(0).setDepth(53).setVisible(false);

    debugLog('TERMINALS: Parsed ' + Terminals.zones.length + ' terminal(s) on ' + state.currentDeck + '.');
}

function findPlayerTerminalOverlap() {
    const pb = state.player.getBounds();
    for (const t of Terminals.zones) {
        if (t.used) { continue; }
        const zb = t.zone.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(pb, zb)) {
            return t;
        }
    }
    return null;
}

function hideTerminalProgress() {
    Terminals.holdStart = 0;
    Terminals.progressBg.setVisible(false);
    Terminals.progressFill.setVisible(false);
}

export function updateTerminalHold(time, pad) {
    if (Terminals.zones.length === 0) { return; }

    let holdInput = false;
    if (pad) {
        holdInput = Math.abs(pad.rightStick.x) > INPUT_DEAD_ZONE ||
                    Math.abs(pad.rightStick.y) > INPUT_DEAD_ZONE;
    }
    if (state.keys.f.isDown) { holdInput = true; }

    if (time < Terminals.deniedUntil) { return; }

    Terminals.playerOn = findPlayerTerminalOverlap();

    if (!Terminals.playerOn || !holdInput) {
        if (Terminals.holdStart !== 0) { hideTerminalProgress(); }
        return;
    }

    if (Terminals.holdStart === 0) { Terminals.holdStart = time; }

    const progress = Math.min((time - Terminals.holdStart) / LIFT_HOLD_MS, 1);

    const barW = 80, barH = 7;
    const barX = (state.scene.scale.width - barW) / 2;
    const barY = state.scene.scale.height - 28;

    Terminals.progressBg.setVisible(true);
    Terminals.progressBg.clear();
    Terminals.progressBg.fillStyle(0x443311, 0.8);
    Terminals.progressBg.fillRect(barX, barY, barW, barH);

    Terminals.progressFill.setVisible(true);
    Terminals.progressFill.clear();
    Terminals.progressFill.fillStyle(0xffcc44, 1);
    Terminals.progressFill.fillRect(barX, barY, Math.round(barW * progress), barH);

    if (progress >= 1) {
        hideTerminalProgress();
        activateTerminal(Terminals.playerOn, time);
    }
}

function activateTerminal(t, time) {
    if (t.codeId && !hasQuestItem(t.codeId)) {
        showHudMessage('ACCESS DENIED — SECURITY CODE REQUIRED', '#ff2244');
        Terminals.deniedUntil = time + 1500;
        return;
    }

    t.used = true;
    state.usedTerminals.add(t.id);
    t.indicator.clear();
    t.indicator.lineStyle(2, 0x667788, 0.6);
    t.indicator.strokeRect(t.x - t.zone.width / 2, t.y - t.zone.height / 2, t.zone.width, t.zone.height);

    if (t.effect === 'unlock_doors') {
        for (const codeId of t.effectTarget.split(',').map(s => s.trim()).filter(Boolean)) {
            state.unlockedCodes.add(codeId);
        }
        const n = applyUnlockedDoors();
        showHudMessage(n > 0 ? 'REMOTE DOOR OVERRIDE ACCEPTED' : 'DOOR OVERRIDE STORED', '#ffcc00');
    } else {
        showHudMessage(t.message || 'DATA ACCESSED', '#ffcc00');
    }
}

// ─────────────────────────────────────────────
//  DECK STATE
// ─────────────────────────────────────────────
export function saveDeckState(deckName) {
    const saved = state.enemies.map(e => e.serialise());

    const prev       = state.deckStates[deckName];
    const wasCleared = prev && prev.cleared;
    state.deckStates[deckName] = {
        enemies: saved,
        cleared: wasCleared || false,
        // Enemy drops exist nowhere else — carry them across the rebuild or
        // the salvage vanishes the moment the player takes a lift.
        drops:   (prev && prev.drops) || [],
    };

    debugLog('STATE: Saved ' + saved.length + ' enemy(s) for ' + deckName + '.');
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
    // A deck record can exist without an enemy roster — a drop on a deck the
    // player has not yet left creates one. Only a saved roster means "restore".
    if (state.deckStates[deckName] && state.deckStates[deckName].enemies) {
        debugLog('STATE: Restoring saved enemies for ' + deckName + '.');
        restoreEnemiesFromState(state.deckStates[deckName]);
    } else {
        const deckDef = deckDefinitions[deckName];
        debugLog('STATE: Spawning ' + deckDef.enemies.length + ' fresh enemy(s) for ' + deckName + '.');
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
    // Door sprites dim with the deck (lock tint reads as unpowered too).
    for (const door of Doors.list) {
        door.img.setTint(DIM_COLOUR);
    }
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

    debugLog('SHUTDOWN: ' + state.currentDeck + ' cleared — lights out.');
}

function showDeckClearedMessage() {
    showHudMessage('DECK POWER DOWN');
}

// ─────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────
//  Translucent band across the top of the screen: hull + shield bars on
//  the left, equipped weapon (name + weapon-power pips) in the centre,
//  W/S/D power-pip clusters and deck label on the right. Kill counter
//  is a backed chip bottom-right, clear of the FPS counter.
//  All text is >=11px at resolution 2 — smaller sizes rasterize into
//  mush once the canvas is scaled up by DISPLAY_ZOOM.

const HUD_BAND_H = 44;
const HUD_BAR_X  = 64;
const HUD_BAR_W  = 140;
const HUD_BAR_H  = 10;
const HUD_DEPTH  = 50;

const PIP_W = 7, PIP_H = 7, PIP_GAP = 3;
const PIP_ROW_X = 392;   // x of the W/S/D pip rows (letters sit just left)

export function hudText(scene, x, y, str, size, colour) {
    return scene.add.text(x, y, str, {
        fontFamily: 'monospace', fontSize: size + 'px', fill: colour,
        resolution: 2,
    }).setScrollFactor(0).setDepth(HUD_DEPTH + 1);
}

export function createHUD(scene) {
    const W = scene.scale.width;

    const band = scene.add.graphics();
    band.fillStyle(0x000011, 0.55);
    band.fillRect(0, 0, W, HUD_BAND_H);
    band.setScrollFactor(0).setDepth(HUD_DEPTH);

    // --- Left: hull + shield bars with numeric readouts ---
    hudText(scene, 12, 6,  'HULL', 11, '#aaffcc');
    hudText(scene, 12, 24, 'SHLD', 11, '#88ccff');

    const barBg = scene.add.graphics();
    barBg.fillStyle(0x222233, 1);
    barBg.fillRect(HUD_BAR_X, 6,  HUD_BAR_W, HUD_BAR_H);
    barBg.fillRect(HUD_BAR_X, 24, HUD_BAR_W, HUD_BAR_H);
    barBg.setScrollFactor(0).setDepth(HUD_DEPTH);

    const hullFill   = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH + 1);
    const shieldFill = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH + 1);
    const hullNum    = hudText(scene, HUD_BAR_X + HUD_BAR_W + 8, 6,  '', 11, '#aaffcc');
    const shieldNum  = hudText(scene, HUD_BAR_X + HUD_BAR_W + 8, 24, '', 11, '#88ccff');

    // --- Centre: equipped weapon name + weapon-power pips beneath it ---
    const weaponText = hudText(scene, W / 2, 5, '', 12, '#ffee00').setOrigin(0.5, 0);
    const weaponPips = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH + 1);

    // --- Right: W/S/D pip clusters, deck label at the far edge ---
    hudText(scene, PIP_ROW_X - 12, 3,  'W', 11, '#ffaa33');
    hudText(scene, PIP_ROW_X - 12, 17, 'S', 11, '#44ddff');
    hudText(scene, PIP_ROW_X - 12, 31, 'D', 11, '#55ee77');
    const powerPips = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH + 1);

    const deckDef   = deckDefinitions[state.currentDeck];
    const deckLabel = hudText(scene, W - 12, 6,
        deckDef ? deckDef.label : state.currentDeck, 12, '#44aaff').setOrigin(1, 0);

    // --- Bottom-right: kill counter chip ---
    const killText = scene.add.text(W - 8, scene.scale.height - 8, 'Destroyed: 0', {
        fontFamily: 'monospace', fontSize: '11px', fill: '#aaffcc',
        backgroundColor: '#000000aa', padding: { x: 4, y: 2 },
        resolution: 2,
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(HUD_DEPTH + 1);

    state.hud = {
        band, barBg, hullFill, shieldFill, hullNum, shieldNum,
        weaponText, weaponPips, powerPips, deckLabel, killText,
        centerX: W / 2,
    };

    updateHUD();
}

function drawBar(gfx, y, value, max, colour) {
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    gfx.clear();
    gfx.fillStyle(colour, 1);
    gfx.fillRect(HUD_BAR_X, y, Math.round(HUD_BAR_W * pct), HUD_BAR_H);
}

export function updateHullBar() {
    const h = state.hud;
    if (!h) { return; }
    const pct = state.hullMax > 0 ? state.hull / state.hullMax : 0;
    let colour;
    if      (pct > 0.5) { colour = 0x00dd55; }
    else if (pct > 0.25){ colour = 0xffcc00; }
    else                { colour = 0xff2244; }
    drawBar(h.hullFill, 6, state.hull, state.hullMax, colour);
    h.hullNum.setText(Math.ceil(state.hull) + '/' + state.hullMax);
}

export function updateShieldBar() {
    const h = state.hud;
    if (!h) { return; }
    const colour = state.shield > 0 ? 0x44aaff : 0x334455;
    drawBar(h.shieldFill, 24, state.shield, state.shieldMax, colour);
    h.shieldNum.setText(Math.round(state.shield) + '/' + state.shieldMax);
}

// One row of power pips: filled up to `count`, outlined up to `avail`.
function drawPipRow(gfx, x, y, count, avail, colour) {
    const slots = Math.min(PIP_MAX, Math.max(avail, count));
    for (let i = 0; i < slots; i++) {
        const px = x + i * (PIP_W + PIP_GAP);
        if (i < count) {
            gfx.fillStyle(colour, 1);
            gfx.fillRect(px, y, PIP_W, PIP_H);
        } else {
            gfx.lineStyle(1, colour, 0.45);
            gfx.strokeRect(px + 0.5, y + 0.5, PIP_W - 1, PIP_H - 1);
        }
    }
}

export function updateWeaponText() {
    const h = state.hud;
    if (!h) { return; }
    const w = state.currentWeaponStats;
    h.weaponText.setText(w ? w.label : 'Blaster');
}

export function updatePowerPips() {
    const h = state.hud;
    if (!h) { return; }
    const out = state.power.reactorOutput;

    h.powerPips.clear();
    drawPipRow(h.powerPips, PIP_ROW_X, 5,  state.power.weapons, out, 0xffaa33);
    drawPipRow(h.powerPips, PIP_ROW_X, 19, state.power.shields, out, 0x44ddff);
    drawPipRow(h.powerPips, PIP_ROW_X, 33, state.power.drive,   out, 0x55ee77);

    // Weapon-power pips centred under the weapon name.
    h.weaponPips.clear();
    const rowW = Math.min(PIP_MAX, out) * (PIP_W + PIP_GAP) - PIP_GAP;
    drawPipRow(h.weaponPips, Math.round(h.centerX - rowW / 2), 24,
        state.power.weapons, out, 0xffee00);
}

export function updateKillText() {
    const h = state.hud;
    if (!h) { return; }
    h.killText.setText('Destroyed: ' + state.killCount);
}

export function updateHUD() {
    updateHullBar();
    updateShieldBar();
    updateWeaponText();
    updatePowerPips();
    updateKillText();
}

// Brief centre-screen announcement (item pickups, terminal results, ...).
export function showHudMessage(text, colour = '#44aaff') {
    const msg = state.scene.add.text(
        state.scene.scale.width / 2,
        state.scene.scale.height / 2,
        text, {
            fontFamily: 'monospace', fontSize: '14px', resolution: 2,
            fill: colour, stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(55).setAlpha(0);

    state.scene.tweens.add({
        targets:    msg,
        alpha:      1,
        duration:   400,
        yoyo:       true,
        hold:       1400,
        onComplete: () => msg.destroy(),
    });
}

// ─────────────────────────────────────────────
//  FPS COUNTER
// ─────────────────────────────────────────────
// Bottom-left frame-rate readout, shared by every scene that wants one.
// Samples Phaser's smoothed actualFps a few times a second — rewriting the
// text every frame would cost frame time and make the number unreadable.
export function createFpsCounter(scene) {
    const txt = scene.add.text(8, scene.scale.height - 8, '-- fps', {
        fontFamily: 'monospace', fontSize: '8px', fill: '#ffee00',
        backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
    }).setOrigin(0, 1).setScrollFactor(0).setDepth(250);

    scene.time.addEvent({
        delay:    250,
        loop:     true,
        callback: () => {
            txt.setText(scene.game.loop.actualFps.toFixed(1) + ' fps');
        },
    });
    // Both the text object and the timer are owned by the scene, so they're
    // cleaned up automatically on shutdown — no manual teardown needed.

    return txt;
}

// ─────────────────────────────────────────────
//  COMBAT — bullets and damage
// ─────────────────────────────────────────────
export function fireBullet(x, y, dx, dy) {
    // Equipped-weapon stats (cooldown is applied by the caller's fire gate).
    const w = state.currentWeaponStats;
    state.playerBullets.fire(x, y, dx, dy, w ? {
        textureKey: w.textureKey,
        speed:      w.bulletSpeed,
        damage:     w.damage,
    } : {});
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

        // Salvage is left at the wreck before the sprite goes away.
        maybeDropItem(enemySprite.x, enemySprite.y, enemy.typeName);

        state.killCount++;
        updateKillText();

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

    // Shield absorbs first; only the remainder chips the hull.
    let remaining = damage;
    if (state.shield > 0) {
        const absorbed = Math.min(state.shield, remaining);
        state.shield -= absorbed;
        remaining    -= absorbed;
    }
    if (remaining > 0) {
        state.hull = Math.max(0, state.hull - remaining);
    }
    updateHullBar();
    updateShieldBar();

    if (state.hull <= 0) {
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
    // postUpdateVisuals stops mirroring once gameOver is set, so fade the cap here.
    if (state.playerTop) { state.playerTop.setAlpha(0.3); }

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

        playerSprite.setVelocity(
            -nx * PLAYER_KNOCKBACK_SPEED * (wEnemy / total),
                                 -ny * PLAYER_KNOCKBACK_SPEED * (wEnemy / total)
        );

        if (wEnemy < PLAYER_WEIGHT) {
            const pushFactor = (PLAYER_WEIGHT - wEnemy) / PLAYER_WEIGHT;
            enemySprite.setVelocity(
                nx * pushFactor * ENEMY_PUSH_MAX_SPEED,
                ny * pushFactor * ENEMY_PUSH_MAX_SPEED
            );

            enemy.knockbackUntil = state.scene.time.now + PLAYER_KNOCKBACK_MS;
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

    spriteA.setVelocity(-nx * ENEMY_BOUNCE_SPEED * (wB / total), -ny * ENEMY_BOUNCE_SPEED * (wB / total));
    spriteB.setVelocity( nx * ENEMY_BOUNCE_SPEED * (wA / total),  ny * ENEMY_BOUNCE_SPEED * (wA / total));

    enemyA.bounceCooldown = now + ENEMY_BOUNCE_COOLDOWN_MS;
    enemyB.bounceCooldown = now + ENEMY_BOUNCE_COOLDOWN_MS;

    enemyA.knockbackUntil = now + ENEMY_BOUNCE_COOLDOWN_MS;
    enemyB.knockbackUntil = now + ENEMY_BOUNCE_COOLDOWN_MS;

    reverseEnemyCourse(enemyA);
    reverseEnemyCourse(enemyB);
}

// ─────────────────────────────────────────────
//  AIM LASER
// ─────────────────────────────────────────────
export function drawAimLaser(rsOut, rsx, rsy) {
    if (!state.aimLaser) { return; }
    state.aimLaser.clear();

    if (!rsOut) { return; }

    const angle         = Math.atan2(rsy, rsx);

    // Start at the centre: the beam (depth 45) draws over the chassis but
    // under the dome cap (46), so it visibly emerges from beneath the dome.
    const startX = state.player.x;
    const startY = state.player.y;

    // Find where the beam should end: AIM_LASER_MAX_RANGE, or sooner if a
    // wall, a closed door, or an enemy blocks it.
    let hit = castRay(startX, startY, angle);
    if (Doors.segments.length > 0) {
        const doorHit = castRay(startX, startY, angle, Doors.segments);
        if (doorHit.dist < hit.dist) { hit = doorHit; }
    }
    const enemySegs = buildEnemyOccluders(startX, startY);
    if (enemySegs.length > 0) {
        const enemyHit = castRay(startX, startY, angle, enemySegs);
        if (enemyHit.dist < hit.dist) { hit = enemyHit; }
    }
    const distToWall = Phaser.Math.Distance.Between(startX, startY, hit.x, hit.y);
    const drawLength = Math.min(AIM_LASER_MAX_RANGE, distToWall);

    // Fade is anchored to AIM_LASER_MAX_RANGE so the gradient rate stays constant
    // even when the beam is cut short by a wall. Two passes per segment: a wide
    // faint glow under a thin core — with the Graphics in ADD blend mode the
    // overlap reads as light rather than a painted stripe.
    const SEGMENTS = 20;
    for (let i = 0; i < SEGMENTS; i++) {
        const d1 = (i / SEGMENTS) * drawLength;
        const d2 = ((i + 1) / SEGMENTS) * drawLength;
        if (d1 >= drawLength) { break; }

        const x1 = startX + Math.cos(angle) * d1;
        const y1 = startY + Math.sin(angle) * d1;
        const x2 = startX + Math.cos(angle) * d2;
        const y2 = startY + Math.sin(angle) * d2;

        // Alpha is based on absolute distance / AIM_LASER_MAX_RANGE, not segment index.
        const fade = 1 - d1 / AIM_LASER_MAX_RANGE;

        state.aimLaser.lineStyle(3, 0xff2222, fade * 0.10);
        state.aimLaser.beginPath();
        state.aimLaser.moveTo(x1, y1);
        state.aimLaser.lineTo(x2, y2);
        state.aimLaser.strokePath();

        state.aimLaser.lineStyle(1, 0xff7755, fade * 0.35);
        state.aimLaser.beginPath();
        state.aimLaser.moveTo(x1, y1);
        state.aimLaser.lineTo(x2, y2);
        state.aimLaser.strokePath();
    }

    // Impact dot where the beam actually reaches a wall inside its range.
    if (distToWall <= AIM_LASER_MAX_RANGE) {
        const fade = 1 - distToWall / AIM_LASER_MAX_RANGE;
        state.aimLaser.fillStyle(0xffaa88, 0.25 + fade * 0.45);
        state.aimLaser.fillCircle(hit.x, hit.y, 1.5);
    }
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
