import Phaser from 'phaser';
import { state, resetGameState } from '../state.js';

export class TitleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TitleScene' });
    }

    create() {
        resetGameState();

        this.add.rectangle(0, 0, 800, 600, 0x0a0a18).setOrigin(0);

        this.add.text(400, 150, 'DECK RUNNER', {
            fontFamily: 'monospace', fontSize: '56px',
            fill: '#44ffaa', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5);

        this.add.text(400, 210, '— a Paradroid-style POC —', {
            fontFamily: 'monospace', fontSize: '14px', fill: '#88bbdd'
        }).setOrigin(0.5);

        this.add.text(400, 300, 'Clear every deck of hostile droids.', {
            fontFamily: 'monospace', fontSize: '16px', fill: '#ffffff'
        }).setOrigin(0.5);
        this.add.text(400, 330, 'Use lifts to move between decks.', {
            fontFamily: 'monospace', fontSize: '16px', fill: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(400, 410, 'Move:          Left stick', {
            fontFamily: 'monospace', fontSize: '12px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(400, 430, 'Aim:           Right stick', {
            fontFamily: 'monospace', fontSize: '12px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(400, 450, 'Fire:          Right trigger / Space', {
            fontFamily: 'monospace', fontSize: '12px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(400, 470, 'Lift activate: Hold F or right stick while on a lift', {
            fontFamily: 'monospace', fontSize: '12px', fill: '#aaaacc'
        }).setOrigin(0.5);

        const prompt = this.add.text(400, 530, 'Press any key or button to begin', {
            fontFamily: 'monospace', fontSize: '20px', fill: '#ffee00'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt, alpha: 0.35,
            duration: 700, yoyo: true, repeat: -1
        });

        this.input.keyboard.once('keydown', () => this.scene.start('Level1Scene'));
        this._padStarted = false;
    }

    update() {
        if (this._padStarted) { return; }
        const pad = this.input.gamepad.getPad(0);
        if (!pad) { return; }
        for (const btn of pad.buttons) {
            if (btn && btn.pressed) {
                this._padStarted = true;
                this.scene.start('Level1Scene');
                return;
            }
        }
    }
}
