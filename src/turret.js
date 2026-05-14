// src/turret.js
import Phaser from 'phaser';

export class Turret {
    constructor(scene, x, y) {
        this.scene = scene;
        this.base = scene.add.image(x, y, 'turret_base');
        this.cannon = scene.add.image(x, y, 'turret_cannon');
        this.cannon.setDepth(this.base.depth + 1);
        this.cannon.setOrigin(0.5, 0.6);  // pivot near the base end
    }

    update(target) {
        const angle = Phaser.Math.Angle.Between(
            this.cannon.x, this.cannon.y,
            target.x, target.y
        );
        this.cannon.rotation = angle + Math.PI / 2;
    }
}
