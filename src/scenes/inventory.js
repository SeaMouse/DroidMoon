// ─────────────────────────────────────────────
//  INVENTORY SCENE
// ─────────────────────────────────────────────
//  Pause overlay launched over a paused GameScene (mirrors the
//  DeckSelectScene pattern). Five tabs: WEAPONS, DEFENCE, POWER,
//  QUEST, MANTA. Content is rebuilt from scratch on every change —
//  simplest approach given the small row counts involved.
// ─────────────────────────────────────────────
import Phaser from 'phaser';
import { state } from '../state.js';
import { PIP_MAX } from '../config.js';
import { itemTypes, playerWeaponTypes } from '../items-config.js';
import { adjustPip } from '../power.js';
import { equipWeapon, playerHasWeapon } from '../inventory.js';
import { updateHUD } from '../systems.js';

const TABS = ['WEAPONS', 'DEFENCE', 'POWER', 'QUEST', 'MANTA'];

const POWER_SYSTEMS = ['weapons', 'shields', 'drive'];
const POWER_COLOURS = { weapons: '#ffaa33', shields: '#44ddff', drive: '#55ee77' };
const POWER_LABELS  = { weapons: 'WEAPONS', shields: 'SHIELDS', drive: 'DRIVE' };

const FONT       = 'monospace';
const RES        = 2;
const ROW_COLOUR = '#aaaacc';
const DIM_COLOUR = '#666688';

export class InventoryScene extends Phaser.Scene {
    constructor() {
        super({ key: 'InventoryScene' });
    }

    init() {
        this.tabIndex = 0;
        this.rowIndex = 0;
        this.ready    = false;

        // Edge-detection flags for the analogue stick.
        this.dpadPrevY = 0;
        this.dpadPrevX = 0;

        // Edge-detection flags for buttons (A / B / L-shoulder / R-shoulder / Select).
        this.padPrevBtn0 = false;
        this.padPrevBtn1 = false;
        this.padPrevBtn4 = false;
        this.padPrevBtn5 = false;
        // The scene is opened by pressing button 8 (Select) on GameScene, so the
        // first frame here would otherwise instantly re-close it.
        this.padPrevBtn8 = true;
    }

    create() {
        const cx = this.scale.width / 2;

        this.add.graphics()
            .fillStyle(0x000000, 0.8)
            .fillRect(0, 0, this.scale.width, this.scale.height)
            .setScrollFactor(0);

        this.add.text(cx, 28, 'INVENTORY', {
            fontFamily: FONT, fontSize: '16px', fill: '#ffee00', resolution: RES,
        }).setOrigin(0.5).setScrollFactor(0);

        this.add.text(cx, 470,
            'Q/E: tabs   Up/Down: select   Left/Right: power pips   Enter/A: equip   I/Esc/B: close', {
                fontFamily: FONT, fontSize: '11px', fill: DIM_COLOUR, resolution: RES,
            }).setOrigin(0.5).setScrollFactor(0);

        this.tabTexts     = [];
        this.contentTexts = [];

        this.menuKeys = this.input.keyboard.addKeys({
            q: 'Q', e: 'E', i: 'I', tab: 'TAB', esc: 'ESC', enter: 'ENTER',
            up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
        });
        this.input.keyboard.addCapture('TAB');

        this.redraw();

        this.time.delayedCall(150, () => { this.ready = true; });
    }

    // ─────────────────────────────────────────
    //  ROW DATA
    // ─────────────────────────────────────────
    buildRowsForTab(tab) {
        if (tab === 'WEAPONS') {
            const rows = [];
            for (const id in playerWeaponTypes) {
                if (!playerHasWeapon(id)) { continue; }
                const def   = playerWeaponTypes[id];
                const gated = (def.minReactorOutput || 0) > state.power.reactorOutput;

                let label = def.label + '   DMG x' + def.damage + '  RATE ' + def.cooldown + 'ms';
                if (gated) { label += '  [NEEDS REACTOR ' + def.minReactorOutput + ']'; }
                if (id === state.inventory.equippedWeaponId) { label += '  [EQUIPPED]'; }

                let colour = ROW_COLOUR;
                let forceWhiteOnSelect = true;
                if (gated) { colour = '#555566'; forceWhiteOnSelect = false; }
                else if (id === state.inventory.equippedWeaponId) { colour = '#ffee00'; forceWhiteOnSelect = false; }

                rows.push({ label, colour, forceWhiteOnSelect, weaponId: id });
            }
            if (rows.length === 0) {
                rows.push({ label: 'No weapons available.', colour: DIM_COLOUR, forceWhiteOnSelect: false });
            }
            return { rows, footer: null };
        }

        if (tab === 'DEFENCE') {
            const rows = [];
            for (const entry of state.inventory.items) {
                const def = itemTypes[entry.itemId];
                if (!def || (def.category !== 'shield' && def.category !== 'armour')) { continue; }
                rows.push({
                    label:  def.name + ' x' + entry.count + '   ' + def.description,
                    colour: ROW_COLOUR, forceWhiteOnSelect: true,
                });
            }
            if (rows.length === 0) {
                rows.push({ label: 'No defensive modules fitted.', colour: DIM_COLOUR, forceWhiteOnSelect: false });
            }
            return { rows, footer: null };
        }

        if (tab === 'POWER') {
            const displayMax = Math.min(state.power.reactorOutput, PIP_MAX);
            const rows = POWER_SYSTEMS.map((system) => {
                const filled  = state.power[system];
                const squares = '■'.repeat(filled) + '□'.repeat(Math.max(0, displayMax - filled));
                return {
                    label:  POWER_LABELS[system].padEnd(7) + '  ' + squares,
                    colour: POWER_COLOURS[system], forceWhiteOnSelect: true, system,
                };
            });
            const allocated = state.power.weapons + state.power.shields + state.power.drive;
            const footer     = 'UNALLOCATED: ' + (state.power.reactorOutput - allocated);
            return { rows, footer };
        }

        if (tab === 'QUEST') {
            const rows = [];
            for (const entry of state.inventory.items) {
                const def = itemTypes[entry.itemId];
                if (!def || (def.category !== 'quest_key' && def.category !== 'quest_code')) { continue; }
                rows.push({
                    label:  def.name + '   ' + def.description,
                    colour: ROW_COLOUR, forceWhiteOnSelect: true,
                });
            }
            if (rows.length === 0) {
                rows.push({ label: 'No mission items.', colour: DIM_COLOUR, forceWhiteOnSelect: false });
            }
            return { rows, footer: null };
        }

        // MANTA
        const rows = [];
        for (const entry of state.inventory.items) {
            const def = itemTypes[entry.itemId];
            if (!def || !def.mantaCompatible) { continue; }
            const fx = def.mantaEffects || {};
            rows.push({
                label:  def.name + '   speed x' + (fx.speedMult ?? 1) + ' dmg x' + (fx.damageMult ?? 1),
                colour: ROW_COLOUR, forceWhiteOnSelect: true,
            });
        }
        if (rows.length === 0) {
            rows.push({ label: 'No Manta-compatible equipment.', colour: DIM_COLOUR, forceWhiteOnSelect: false });
        }
        return { rows, footer: 'Fitted to the Manta for surface runs.' };
    }

    // ─────────────────────────────────────────
    //  RENDER
    // ─────────────────────────────────────────
    redraw() {
        this.tabTexts.forEach(t => t.destroy());
        this.tabTexts = [];
        this.contentTexts.forEach(t => t.destroy());
        this.contentTexts = [];

        // --- Tab bar ---
        const segW = this.scale.width / TABS.length;
        TABS.forEach((name, i) => {
            const active = (i === this.tabIndex);
            const label  = active ? '▸ ' + name : '  ' + name;
            const txt = this.add.text(segW * i + segW / 2, 60, label, {
                fontFamily: FONT, fontSize: '12px',
                fill: active ? '#ffffff' : '#8888aa', resolution: RES,
            }).setOrigin(0.5).setScrollFactor(0);
            this.tabTexts.push(txt);
        });

        // --- Content ---
        const tab = TABS[this.tabIndex];
        const { rows, footer } = this.buildRowsForTab(tab);
        this.currentRows = rows;
        if (this.rowIndex >= rows.length) { this.rowIndex = 0; }

        let y = 90;
        rows.forEach((row, i) => {
            const selected = (i === this.rowIndex);
            const prefix   = selected ? '▸ ' : '  ';
            const colour   = (selected && row.forceWhiteOnSelect) ? '#ffffff' : row.colour;
            const txt = this.add.text(60, y, prefix + row.label, {
                fontFamily: FONT, fontSize: '12px', fill: colour, resolution: RES,
            }).setScrollFactor(0);
            this.contentTexts.push(txt);
            y += 22;
        });

        if (footer) {
            const footerY = (tab === 'POWER') ? y + 4 : 410;
            const txt = this.add.text(60, footerY, footer, {
                fontFamily: FONT, fontSize: '12px', fill: DIM_COLOUR, resolution: RES,
            }).setScrollFactor(0);
            this.contentTexts.push(txt);
        }

        // --- Status line ---
        const allocated = state.power.weapons + state.power.shields + state.power.drive;
        const statusStr = 'HULL ' + Math.round(state.hull) + '/' + Math.round(state.hullMax) +
            '   SHIELD ' + Math.round(state.shield) + '/' + Math.round(state.shieldMax) +
            '   REACTOR ' + allocated + '/' + state.power.reactorOutput + ' pips';
        const statusTxt = this.add.text(60, 444, statusStr, {
            fontFamily: FONT, fontSize: '11px', fill: '#88ccff', resolution: RES,
        }).setScrollFactor(0);
        this.contentTexts.push(statusTxt);
    }

    // Selection highlight is simplest to express by rebuilding the row
    // texts, so this is a thin alias kept for parity with DeckSelectScene.
    highlight() {
        this.redraw();
    }

    // ─────────────────────────────────────────
    //  NAVIGATION / ACTIONS
    // ─────────────────────────────────────────
    switchTab(index) {
        this.tabIndex = (index + TABS.length) % TABS.length;
        this.rowIndex = 0;
        this.redraw();
    }

    prevTab() { this.switchTab(this.tabIndex - 1); }
    nextTab() { this.switchTab(this.tabIndex + 1); }

    moveSelection(delta) {
        const count = this.currentRows ? this.currentRows.length : 0;
        if (count === 0) { return; }
        this.rowIndex = (this.rowIndex + delta + count) % count;
        this.highlight();
    }

    handleLeft() {
        if (TABS[this.tabIndex] === 'POWER') {
            this.adjustSelectedPip(-1);
        } else {
            this.prevTab();
        }
    }

    handleRight() {
        if (TABS[this.tabIndex] === 'POWER') {
            this.adjustSelectedPip(1);
        } else {
            this.nextTab();
        }
    }

    adjustSelectedPip(delta) {
        const row = this.currentRows && this.currentRows[this.rowIndex];
        if (!row || !row.system) { return; }
        if (adjustPip(row.system, delta)) {
            updateHUD();
            this.redraw();
        }
    }

    handleConfirm() {
        if (TABS[this.tabIndex] !== 'WEAPONS') { return; }
        const row = this.currentRows && this.currentRows[this.rowIndex];
        if (!row || !row.weaponId) { return; }
        if (equipWeapon(row.weaponId)) {
            updateHUD();
            this.redraw();
        }
    }

    close() {
        this.scene.stop();
        this.scene.resume('GameScene');
    }

    // ─────────────────────────────────────────
    //  UPDATE LOOP
    // ─────────────────────────────────────────
    update() {
        if (!this.ready) { return; }

        const pad = this.input.gamepad.getPad(0);
        const T   = 0.5;

        // --- Tab switching ---
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.q)) { this.prevTab(); }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.e)) { this.nextTab(); }
        if (pad) {
            const b4 = !!(pad.buttons[4] && pad.buttons[4].pressed);
            if (b4 && !this.padPrevBtn4) { this.prevTab(); }
            this.padPrevBtn4 = b4;

            const b5 = !!(pad.buttons[5] && pad.buttons[5].pressed);
            if (b5 && !this.padPrevBtn5) { this.nextTab(); }
            this.padPrevBtn5 = b5;
        }

        // --- Row selection ---
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.up)) { this.moveSelection(-1); }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.down)) { this.moveSelection(1); }
        if (pad) {
            const y = pad.leftStick.y;
            if (y < -T && this.dpadPrevY >= -T) { this.moveSelection(-1); }
            if (y > T && this.dpadPrevY <= T) { this.moveSelection(1); }
            this.dpadPrevY = y;
        }

        // --- Left / Right: power pips (POWER tab) or tab switch (elsewhere) ---
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.left)) { this.handleLeft(); }
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.right)) { this.handleRight(); }
        if (pad) {
            const x = pad.leftStick.x;
            if (x < -T && this.dpadPrevX >= -T) { this.handleLeft(); }
            if (x > T && this.dpadPrevX <= T) { this.handleRight(); }
            this.dpadPrevX = x;
        }

        // --- Confirm / equip ---
        if (Phaser.Input.Keyboard.JustDown(this.menuKeys.enter)) { this.handleConfirm(); }
        if (pad) {
            const a = !!(pad.buttons[0] && pad.buttons[0].pressed);
            if (a && !this.padPrevBtn0) { this.handleConfirm(); }
            this.padPrevBtn0 = a;
        }

        // --- Close ---
        let closePressed = Phaser.Input.Keyboard.JustDown(this.menuKeys.i) ||
                            Phaser.Input.Keyboard.JustDown(this.menuKeys.tab) ||
                            Phaser.Input.Keyboard.JustDown(this.menuKeys.esc);
        if (pad) {
            const b1 = !!(pad.buttons[1] && pad.buttons[1].pressed);
            if (b1 && !this.padPrevBtn1) { closePressed = true; }
            this.padPrevBtn1 = b1;

            const b8 = !!(pad.buttons[8] && pad.buttons[8].pressed);
            if (b8 && !this.padPrevBtn8) { closePressed = true; }
            this.padPrevBtn8 = b8;
        }
        if (closePressed) {
            this.close();
            return;
        }
    }
}
