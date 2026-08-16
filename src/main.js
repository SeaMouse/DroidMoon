import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DISPLAY_ZOOM } from './config.js';
import { state } from './state.js';
import { Items } from './inventory.js';
import * as Inventory from './inventory.js';
import * as Systems from './systems.js';
import * as TransferBoard from './transfer-board.js';
import { TitleScene } from './scenes/title.js';
import { GameScene } from './game-scene.js';
import { EndScene } from './scenes/end.js';
import { DeckSelectScene } from './scenes/deck-select.js';
import { Level1Scene } from './scenes/level1.js';
import { InventoryScene } from './scenes/inventory.js';
import { TransferScene } from './scenes/transfer.js';


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
    scene: [TitleScene, Level1Scene, GameScene, EndScene, DeckSelectScene, InventoryScene, TransferScene]
};

const game = new Phaser.Game(config);

// Dev-only handle so browser-automation checks can reach the live game
// (scenes, renderer) without a module-instance mismatch. Stripped in builds.
if (import.meta.env.DEV) {
    window.__game     = game;
    window.__state    = state;
    window.__items    = Items;
    window.__transfer = TransferBoard;
    // Namespaces, not copies: a dynamic import() from a debugger gets a second
    // module instance once Vite starts serving `?t=` URLs, and its module-level
    // flags are always the defaults. These are the running instances.
    window.__systems   = Systems;
    window.__inventory = Inventory;
}
