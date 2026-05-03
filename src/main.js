import Phaser from 'phaser';
import { TitleScene } from './scenes/title.js';
import { GameScene } from './game-scene.js';
import { EndScene } from './scenes/end.js';
import { DeckSelectScene } from './scenes/deck-select.js';
import { Level1Scene } from './scenes/level1.js';

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#1a1a2e',
    pixelArt: true,
    physics: {
        default: 'arcade',
            arcade: { debug: false }
    },
    input: {
        gamepad: true
    },
    scene: [TitleScene, Level1Scene, GameScene, EndScene, DeckSelectScene]
};

new Phaser.Game(config);
