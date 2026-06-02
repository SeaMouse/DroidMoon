import Phaser from 'phaser';
import { state } from '../state.js';
import { deckDefinitions } from '../config.js';
import { switchToDeck } from '../systems.js';

export class DeckSelectScene extends Phaser.Scene {
    constructor() {
        super({ key: 'DeckSelectScene' });
    }

    init(data) {
        this.lift        = data.lift;
        this.index       = 0;
        this.items       = [];
        this.dpadPrevY   = 0;
        this.confirmPrev = false;
        this.cancelPrev  = false;
        this.ready       = false;
    }

    create() {
        const cx = this.scale.width / 2;

        this.add.graphics()
        .fillStyle(0x000000, 0.75)
        .fillRect(0, 0, this.scale.width, this.scale.height)
        .setScrollFactor(0);

        this.add.text(cx, 56, 'SELECT DECK', {
            fontFamily: 'monospace', fontSize: '13px',
            fill: '#44aaff', stroke: '#000000', strokeThickness: 1
        }).setOrigin(0.5).setScrollFactor(0);

        this.add.text(cx, 195,
                      'Arrow / D-pad: choose — Enter / A: confirm — Esc / B: cancel', {
                          fontFamily: 'monospace', fontSize: '5px', fill: '#666688'
                      }).setOrigin(0.5).setScrollFactor(0);

                      const connectedDecks = this.lift.decks;
                      const allOptions     = [state.currentDeck, ...connectedDecks.filter(d => d !== state.currentDeck)];

                      let yPos = 95;
                      for (const deckName of allOptions) {
                          const def    = deckDefinitions[deckName];
                          const label  = def ? def.label : deckName;
                          const suffix = (deckName === state.currentDeck) ? '  (current)' : '';

                          const txt = this.add.text(cx, yPos, label + suffix, {
                              fontFamily: 'monospace', fontSize: '8px', fill: '#aaaacc'
                          }).setOrigin(0.5).setScrollFactor(0);

                          this.items.push({ text: txt, deckName: deckName });
                          yPos += 18;
                      }

                      this.menuKeys = this.input.keyboard.addKeys({
                          up: 'UP', down: 'DOWN', enter: 'ENTER', esc: 'ESC',
                      });

                      this.highlight(0);

                      this.time.delayedCall(150, () => { this.ready = true; });
    }

    highlight(index) {
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const label = deckDefinitions[item.deckName]?.label || item.deckName;
            const suffix = (item.deckName === state.currentDeck) ? '  (current deck)' : '';
            if (i === index) {
                item.text.setStyle({ fill: '#ffffff', fontSize: '9px' });
                item.text.setText('▸ ' + label + suffix);
            } else {
                item.text.setStyle({ fill: '#aaaacc', fontSize: '8px' });
                item.text.setText('  ' + label + suffix);
            }
        }
    }

    update() {
        if (!this.ready) { return; }

        const pad = this.input.gamepad.getPad(0);

        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.up)) {
            this.index = (this.index - 1 + this.items.length) % this.items.length;
            this.highlight(this.index);
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.down)) {
            this.index = (this.index + 1) % this.items.length;
            this.highlight(this.index);
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.enter)) {
            this.confirm();
            return;
        }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.esc)) {
            this.cancel();
            return;
        }

        if (pad) {
            const dpadY = pad.leftStick.y;
            const T = 0.5;

            if (dpadY < -T && this.dpadPrevY >= -T) {
                this.index = (this.index - 1 + this.items.length) % this.items.length;
                this.highlight(this.index);
            }
            if (dpadY > T && this.dpadPrevY <= T) {
                this.index = (this.index + 1) % this.items.length;
                this.highlight(this.index);
            }
            this.dpadPrevY = dpadY;

            const aDown = pad.buttons[0] && pad.buttons[0].pressed;
            if (aDown && !this.confirmPrev) { this.confirm(); return; }
            this.confirmPrev = aDown;

            const bDown = pad.buttons[1] && pad.buttons[1].pressed;
            if (bDown && !this.cancelPrev) { this.cancel(); return; }
            this.cancelPrev = bDown;
        }
    }

    confirm() {
        const selected = this.items[this.index];
        if (!selected || selected.deckName === state.currentDeck) {
            this.cancel();
            return;
        }
        this.scene.stop();
        this.scene.resume('GameScene');
        switchToDeck(selected.deckName);
    }

    cancel() {
        this.scene.stop();
        this.scene.resume('GameScene');
    }
}
