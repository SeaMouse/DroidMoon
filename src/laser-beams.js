import Phaser from 'phaser';
import {
    LASER_FIRE_INTERVAL_MS, LASER_PULSE_LIFE_MS,
    LASER_EMITTER_X_OFFSET, LASER_EMITTER_Y_OFFSET,
    LASER_RAYCAST_STEP,
    LASER_COLOUR_CORE, LASER_COLOUR_MID, LASER_COLOUR_GLOW,
} from './config.js';

export class LaserBeams {
    constructor(scene, ship, obstacleLayer) {
        this.scene         = scene;
        this.ship          = ship;
        this.obstacleLayer = obstacleLayer;

        // One Graphics object, cleared and redrawn every frame.
        this.gfx = scene.add.graphics();
        this.gfx.setDepth(60);  // above ship and tiles

        // Active pulses. Each: { bornAt, isTop }.
        this.pulses = [];
        this.lastFireTime = 0;
    }

    update(time, firing, facing) {
        // 1. Spawn a new pulse pair if firing and the interval has elapsed.
        if (firing && time - this.lastFireTime >= LASER_FIRE_INTERVAL_MS) {
            this.lastFireTime = time;
            this.pulses.push({ bornAt: time, isTop: true  });
            this.pulses.push({ bornAt: time, isTop: false });
        }

        // 2. Drop expired pulses.
        this.pulses = this.pulses.filter(p => time - p.bornAt < LASER_PULSE_LIFE_MS);

        // 3. Redraw every live pulse from the ship's *current* position,
        //    each at its own fading alpha. Overlapping pulses pile up
        //    additively, giving the brightness "pulse" effect.
        this.gfx.clear();
        if (this.pulses.length === 0) { return; }

        const cam    = this.scene.cameras.main;
        const limitX = facing > 0 ? cam.scrollX + cam.width : cam.scrollX;
        const sx     = this.ship.x + LASER_EMITTER_X_OFFSET * facing;

        for (const p of this.pulses) {
            const age   = time - p.bornAt;
            const alpha = 1 - age / LASER_PULSE_LIFE_MS;
            const sy    = this.ship.y + (p.isTop ? -LASER_EMITTER_Y_OFFSET : LASER_EMITTER_Y_OFFSET);
            const endX  = this.raycast(sx, sy, facing, limitX);
            this.drawBeam(sx, sy, endX, sy, alpha);
        }
    }

    // Walk forward in small steps until we hit an obstacle tile or the screen edge.
    // Beam is horizontal, so we only need to step X.
    raycast(startX, startY, facing, limitX) {
        let x = startX;
        while ((facing > 0 && x < limitX) || (facing < 0 && x > limitX)) {
            x += facing * LASER_RAYCAST_STEP;
            const tile = this.obstacleLayer.getTileAtWorldXY(x, startY);
            if (tile && tile.properties && tile.properties.obstacle) {
                return x;  // hit point — close enough for visuals
            }
        }
        return limitX;
    }

    // Three concentric strokes: wide+dim glow, medium mid, thin+bright core.
    // Gives a cheap "energy weapon" bloom without any shaders.
    drawBeam(x1, y1, x2, y2, alpha) {
        this.gfx.lineStyle(5, LASER_COLOUR_GLOW, 0.20 * alpha);
        this.gfx.lineBetween(x1, y1, x2, y2);
        this.gfx.lineStyle(2, LASER_COLOUR_MID,  0.55 * alpha);
        this.gfx.lineBetween(x1, y1, x2, y2);
        this.gfx.lineStyle(1, LASER_COLOUR_CORE, 1.00 * alpha);
        this.gfx.lineBetween(x1, y1, x2, y2);
    }
}
