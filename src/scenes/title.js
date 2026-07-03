import Phaser from 'phaser';
import { state, resetGameState } from '../state.js';

export class TitleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TitleScene' });
    }

    create() {
        resetGameState();

        const cx = this.scale.width / 2;

        this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0a0a18).setOrigin(0);

        this.add.text(cx, 45, 'DROID MOON', {
            fontFamily: 'monospace', fontSize: '22px',
            fill: '#44ffaa', stroke: '#000000', strokeThickness: 2
        }).setOrigin(0.5);

        this.add.text(cx, 74, '— a Paradroid-style POC —', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#88bbdd'
        }).setOrigin(0.5);

        this.add.text(cx, 96, 'Clear every deck of hostile droids.', {
            fontFamily: 'monospace', fontSize: '7px', fill: '#ffffff'
        }).setOrigin(0.5);
        this.add.text(cx, 107, 'Use lifts to move between decks.', {
            fontFamily: 'monospace', fontSize: '7px', fill: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(cx, 130, 'Move:          Left stick', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(cx, 142, 'Aim:           Right stick', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(cx, 154, 'Fire:          Right trigger / Space', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(cx, 166, 'Lift:          Hold F or right stick on a lift', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);

        const prompt = this.add.text(cx, 210, 'Press any key or button to begin', {
            fontFamily: 'monospace', fontSize: '8px', fill: '#ffee00'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt, alpha: 0.35,
            duration: 700, yoyo: true, repeat: -1
        });

        this.input.keyboard.once('keydown', () => this.scene.start('Level1Scene'));   // 'GameScene'
        this._padStarted = false;
    }

    update() {
        if (this._padStarted) { return; }
        const pad = this.input.gamepad.getPad(0);
        if (!pad) { return; }
        for (const btn of pad.buttons) {
            if (btn && btn.pressed) {
                this._padStarted = true;
                this.scene.start('Level1Scene');   //'GameScene'
                return;
            }
        }
    }
}
