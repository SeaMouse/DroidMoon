import Phaser from 'phaser';
import { state } from '../state.js';

export class EndScene extends Phaser.Scene {
    constructor() {
        super({ key: 'EndScene' });
    }

    init(data) {
        this.result = (data && data.result) ? data.result : 'lost';
    }

    create() {
        const won = (this.result === 'won');

        this.add.rectangle(0, 0, 800, 600,
                           won ? 0x0a1a10 : 0x1a0a0a).setOrigin(0);

                           this.add.text(400, 200, won ? 'SHIP CLEARED' : 'GAME OVER', {
                               fontFamily: 'monospace', fontSize: '64px',
                               fill: won ? '#44ff88' : '#ff3344',
                               stroke: '#000000', strokeThickness: 4
                           }).setOrigin(0.5);

                           const msg = won
                           ? 'Every deck is quiet. Every droid is scrap.'
                           : 'The droids won this round.';
                           this.add.text(400, 290, msg, {
                               fontFamily: 'monospace', fontSize: '16px', fill: '#ffffff'
                           }).setOrigin(0.5);

                           this.add.text(400, 340, 'Droids destroyed: ' + state.killCount, {
                               fontFamily: 'monospace', fontSize: '14px', fill: '#aaaacc'
                           }).setOrigin(0.5);

                           const prompt = this.add.text(400, 460, 'Press any key or button to return to title', {
                               fontFamily: 'monospace', fontSize: '16px', fill: '#ffee00'
                           }).setOrigin(0.5);

                           this.tweens.add({
                               targets: prompt, alpha: 0.35,
                               duration: 700, yoyo: true, repeat: -1
                           });

                           this._ready = false;
                           this.time.delayedCall(600, () => {
                               this._ready = true;
                               this.input.keyboard.once('keydown', () => this.scene.start('TitleScene'));
                           });
                           this._padAdvanced = false;
    }

    update() {
        if (!this._ready || this._padAdvanced) { return; }
        const pad = this.input.gamepad.getPad(0);
        if (!pad) { return; }
        for (const btn of pad.buttons) {
            if (btn && btn.pressed) {
                this._padAdvanced = true;
                this.scene.start('TitleScene');
                return;
            }
        }
    }
}
