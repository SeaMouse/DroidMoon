// src/turret.js
import Phaser from 'phaser';

const TURRET_HP     = 50;
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
        scene.add.circle(x, y, TURRET_RADIUS, 0xff0000, 0.2)
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

    update(target) {
        if (!this.alive) { return; }
        const angle = Phaser.Math.Angle.Between(
            this.cannon.x, this.cannon.y,
            target.x, target.y
        );
        this.cannon.rotation = angle + Math.PI / 2;
    }
}
