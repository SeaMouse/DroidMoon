// src/turret.js
import Phaser from 'phaser';
import {
    TURRET_FIRE_COOLDOWN_MS, TURRET_TWIN_GAP_MS, TURRET_FIRE_RANGE,
    TURRET_BARREL_LENGTH,    TURRET_GUN_HALF_GAP,
} from './config.js';

const TURRET_HP     = 25;
const TURRET_RADIUS = 24;  // hit-circle radius around the base, in px

export class Turret {
    constructor(scene, x, y) {
        this.scene  = scene;
        this.x      = x;
        this.y      = y;
        this.base   = scene.add.image(x, y, 'turret_base');
        this.cannon = scene.add.image(x, y, 'turret_cannon');
        this.cannon.setDepth(this.base.depth + 1);
        this.cannon.setOrigin(0.5, 0.6);

        this.hp     = TURRET_HP;
        this.radius = TURRET_RADIUS;
        this.alive  = true;
        // Firing state: volleyStep 0 = ready, 1 = waiting to fire second gun.
        this.lastVolleyTime = scene.time.now - Phaser.Math.Between(0, TURRET_FIRE_COOLDOWN_MS);
        this.volleyStep     = 0;
    }

    // True if a world point (px, py) is inside this turret's hit circle.
    containsPoint(px, py) {
        if (!this.alive) { return false; }
        const dx = px - this.x;
        const dy = py - this.y;
        return dx * dx + dy * dy <= this.radius * this.radius;
    }

    // Called by the laser. Returns true if this hit destroyed it.
    hit(damage) {
        if (!this.alive) { return false; }
        this.hp -= damage;

        // Quick flash so you can see hits land.
        this.scene.tweens.add({
            targets:  [this.base, this.cannon],
            alpha:    0.3,
            duration: 40,
            yoyo:     true,
        });

        if (this.hp <= 0) {
            this.alive = false;
            this.scene.tweens.add({
                targets:    [this.base, this.cannon],
                alpha:      0,
                duration:   300,
                onComplete: () => {
                    this.base.destroy();
                    this.cannon.destroy();
                },
            });
            return true;
        }
        return false;
    }

    update(target, time) {
        if (!this.alive) { return; }

        const angle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
        this.cannon.rotation = angle + Math.PI / 2;

        // Range gate (squared, no sqrt needed).
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const inRange = (dx * dx + dy * dy) <= TURRET_FIRE_RANGE * TURRET_FIRE_RANGE;

        // Step 0: cooldown done + player in range → fire first gun.
        if (this.volleyStep === 0 && inRange &&
            time - this.lastVolleyTime >= TURRET_FIRE_COOLDOWN_MS) {
            this.fireGun(0, angle);
            this.lastVolleyTime = time;
            this.volleyStep = 1;
            }
            // Step 1: 250ms after first gun → fire second gun (range no longer matters,
            //         the volley commits once it starts).
            else if (this.volleyStep === 1 &&
                time - this.lastVolleyTime >= TURRET_TWIN_GAP_MS) {
                this.fireGun(1, angle);
            this.volleyStep = 0;
                }
    }

    fireGun(which, angle) {
        const pool = this.scene.turretBullets;
        if (!pool) { return; }

        // Forward = toward player.  Side = 90° clockwise from forward.
        const fwdX  =  Math.cos(angle);
        const fwdY  =  Math.sin(angle);
        const sideX = -Math.sin(angle);
        const sideY =  Math.cos(angle);

        const side = (which === 0) ? 1 : -1;   // 0 = "right" barrel, 1 = "left"
        const sx = this.x + fwdX * TURRET_BARREL_LENGTH + sideX * TURRET_GUN_HALF_GAP * side;
        const sy = this.y + fwdY * TURRET_BARREL_LENGTH + sideY * TURRET_GUN_HALF_GAP * side;

        pool.fire(sx, sy, fwdX, fwdY);
    }
}
