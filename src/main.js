import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DISPLAY_ZOOM } from './config.js';
import { state } from './state.js';
import { TitleScene } from './scenes/title.js';
import { GameScene } from './game-scene.js';
import { EndScene } from './scenes/end.js';
import { DeckSelectScene } from './scenes/deck-select.js';
import { Level1Scene } from './scenes/level1.js';
import { InventoryScene } from './scenes/inventory.js';


const config = {
    type: Phaser.AUTO,
    backgroundColor: '#1a1a2e',
    pixelArt: true,
    scale: {
        mode: Phaser.Scale.NONE,            // fixed size — don't stretch to fill the window
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GAME_WIDTH,                  // 320 internal
        height: GAME_HEIGHT,               // 256 internal
        zoom: DISPLAY_ZOOM,                // displayed at 640×512
    },
    physics: {
        default: 'arcade',
            arcade: { debug: false, fps: 60, fixedStep: true }
    },
    input: { gamepad: true },
    scene: [TitleScene, Level1Scene, GameScene, EndScene, DeckSelectScene, InventoryScene]
};

const game = new Phaser.Game(config);

// Dev-only handle so browser-automation checks can reach the live game
// (scenes, renderer) without a module-instance mismatch. Stripped in builds.
if (import.meta.env.DEV) {
    window.__game  = game;
    window.__state = state;
}
