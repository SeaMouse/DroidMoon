import Phaser from 'phaser';
import { state, resetGameState } from '../state.js';

// Selectable starting levels. Order here is menu order; the first entry is
// the default selection.
const LEVELS = [
    { key: 'Level1Scene', label: 'LEVEL 1 — Manta surface run' },
    { key: 'GameScene',   label: 'LEVEL 2 — Clear the decks'   },
];

export class TitleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TitleScene' });
    }

    create() {
        resetGameState();

        this.index       = 0;
        this.items       = [];
        this.stickPrevY  = 0;
        this.confirmPrev = true;   // must see A released once before it can confirm
        this.ready       = false;

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
        this.add.text(cx, 116, 'Transfer into a droid to borrow its hull and gun.', {
            fontFamily: 'monospace', fontSize: '7px', fill: '#88ffcc'
        }).setOrigin(0.5);

        this.add.text(cx, 126, 'Move:          Left stick', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(cx, 137, 'Aim:           Right stick', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(cx, 148, 'Fire:          Right trigger / Space', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(cx, 159, 'Lift:          Hold F or right stick on a lift', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#aaaacc'
        }).setOrigin(0.5);
        this.add.text(cx, 170, 'Transfer mode: Hold R3 / T, then touch a droid', {
            fontFamily: 'monospace', fontSize: '6px', fill: '#88ffcc'
        }).setOrigin(0.5);

        // --- Level selection ---
        let yPos = 190;
        for (const level of LEVELS) {
            const txt = this.add.text(cx, yPos, level.label, {
                fontFamily: 'monospace', fontSize: '8px', fill: '#aaaacc'
            }).setOrigin(0.5);
            this.items.push({ text: txt, level: level });
            yPos += 16;
        }
        this.highlight(0);

        const prompt = this.add.text(cx, 228,
            'Up/Down or left stick: choose — Enter / A: start', {
                fontFamily: 'monospace', fontSize: '7px', fill: '#ffee00'
            }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt, alpha: 0.35,
            duration: 700, yoyo: true, repeat: -1
        });

        this.menuKeys = this.input.keyboard.addKeys({
            up: 'UP', down: 'DOWN', enter: 'ENTER', space: 'SPACE',
        });

        // Brief input gate so a key/button held over from a previous scene
        // (game over, restart) can't instantly confirm.
        this.time.delayedCall(150, () => { this.ready = true; });
    }

    highlight(index) {
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (i === index) {
                item.text.setStyle({ fill: '#ffffff', fontSize: '9px' });
                item.text.setText('▸ ' + item.level.label + ' ◂');
            } else {
                item.text.setStyle({ fill: '#aaaacc', fontSize: '8px' });
                item.text.setText(item.level.label);
            }
        }
    }

    update() {
        if (!this.ready) { return; }

        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.up)) {
            this.index = (this.index - 1 + this.items.length) % this.items.length;
            this.highlight(this.index);
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.down)) {
            this.index = (this.index + 1) % this.items.length;
            this.highlight(this.index);
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.enter) ||
            Phaser.Input.Keyboard.JustDown(this.menuKeys.space)) {
            this.startSelected();
            return;
        }

        const pad = this.input.gamepad.getPad(0);
        if (pad) {
            // Edge-detected stick flicks, same idiom as DeckSelectScene.
            const stickY = pad.leftStick.y;
            const T = 0.5;
            if (stickY < -T && this.stickPrevY >= -T) {
                this.index = (this.index - 1 + this.items.length) % this.items.length;
                this.highlight(this.index);
            }
            if (stickY > T && this.stickPrevY <= T) {
                this.index = (this.index + 1) % this.items.length;
                this.highlight(this.index);
            }
            this.stickPrevY = stickY;

            const aDown = pad.buttons[0] && pad.buttons[0].pressed;
            if (aDown && !this.confirmPrev) { this.startSelected(); return; }
            this.confirmPrev = aDown;
        }
    }

    startSelected() {
        this.scene.start(this.items[this.index].level.key);
    }
}
