// ─────────────────────────────────────────────
//  TRANSFER BOARD — Paradroid-style circuit duel simulation
// ─────────────────────────────────────────────
//  Pure sim, no rendering. Two sides ('left'/'right') fight over a 12-cell
//  bar via pulses that travel inward through a small circuit grid, mutated
//  by the cell they pass through. A Phaser scene renders board state; this
//  file only advances it. No imports, no console output.
// ─────────────────────────────────────────────

export const BAR_SIZE         = 12;
export const SIDE_COLS        = 5;      // circuit columns between side track and bar
export const PULSE_STEP_MS    = 110;    // power advances one cell this often
export const PULSE_LIFE_MS    = 3000;   // a pulse burns out this long after firing
export const AUTO_PERIOD_MS   = 900;    // auto-pulser re-emit interval
export const JOINER_WINDOW_MS = 400;    // both joiner inputs must arrive within this
export const TIMER_MS         = 15000;  // duration of one round
export const SIDE_SELECT_MS   = 2500;   // pick-a-side phase before the timer starts

// A cell that isn't laid out during generation reads as 'empty'.
const CELL_TYPES = ['empty', 'wire', 'splitter', 'joiner', 'auto', 'terminator', 'invert'];

// ─────────────────────────────────────────────
//  SEEDED PRNG
// ─────────────────────────────────────────────
//  mulberry32 — small, fast, and deterministic so a board can be replayed
//  from its seed for debugging.

function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Regeneration needs a fresh but deterministic seed per attempt, without
// re-using the same rng stream (that would just repeat the same board).
function deriveSeed(seed, attempt) {
    const rng = mulberry32((seed ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0);
    return Math.floor(rng() * 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────
//  GRID GENERATION
// ─────────────────────────────────────────────

function allWireGrid() {
    const grid = [];
    for (let col = 0; col < SIDE_COLS; col += 1) {
        grid.push(new Array(BAR_SIZE).fill('wire'));
    }
    return grid;
}

// Scatters `count` cells of the given type(s) onto still-plain-wire cells.
// Bounded retry guard so a near-full grid can't spin forever.
function placeCells(grid, rng, typeOrTypes, count) {
    const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
    const maxAttempts = count * 20 + 50;
    let placed = 0;
    let attempts = 0;

    while (placed < count && attempts < maxAttempts) {
        attempts += 1;
        const col = Math.floor(rng() * SIDE_COLS);
        const row = Math.floor(rng() * BAR_SIZE);
        if (grid[col][row] !== 'wire') {
            continue;
        }
        grid[col][row] = types[Math.floor(rng() * types.length)];
        placed += 1;
    }
}

// Both halves are generated from the same distribution. Choosing a side is
// meant to be a real read of the circuit — if one half were always the
// punishing one, the choice would collapse into "always take the right".
// The asymmetry that makes the decision interesting comes from the rng,
// not from a fixed bias, and difficulty raises the hostile element count on
// both halves alike.
// How many bar cells a side must still be able to claim. Falls with
// difficulty, but never below the 7 it takes to actually win — a board you
// cannot win on is a bug, not a hard fight.
export function targetReach(difficulty) {
    return Math.round(9 - 2 * difficulty);
}

// A lane is five cells deep, so scattering blockers freely wipes out almost
// every route: at 18 blockers in 60 cells barely two lanes survive. Elements
// are therefore laid down first and then *repaired* — the worst-cluttered
// rows are cleared back to plain wire until the grid provably clears
// targetReach. That keeps the look of a dense circuit without ever handing
// out a board that cannot be won.
export function generateGrid(rng, difficulty) {
    const grid = allWireGrid();
    const totalCells = SIDE_COLS * BAR_SIZE;

    const emptyCount   = Math.round(totalCells * (0.06 + 0.04 * difficulty));
    const specialCount = Math.round(totalCells * (0.14 + 0.22 * difficulty));

    // Hostile elements (terminator/invert) grow with difficulty; the useful
    // ones (splitter/auto/joiner) stay roughly constant, so a high-class
    // droid's board is a maze rather than a different game.
    const hostileShare = 0.35 + 0.30 * difficulty;
    const hostileCount = Math.round(specialCount * hostileShare);

    placeCells(grid, rng, 'empty', emptyCount);
    placeCells(grid, rng, ['terminator', 'invert'], hostileCount);
    placeCells(grid, rng, ['splitter', 'auto', 'joiner'], specialCount - hostileCount);

    repairGrid(grid, difficulty);
    return grid;
}

// Cells that stop a lone pulse dead. Splitters and autos are not blockers —
// they redirect or amplify — so clearing them would waste the interesting
// parts of the circuit.
const BLOCKING_TYPES = new Set(['empty', 'terminator', 'invert', 'joiner']);

function rowBlockerCount(grid, row) {
    let n = 0;
    for (let col = 0; col < SIDE_COLS; col += 1) {
        if (BLOCKING_TYPES.has(grid[col][row])) { n += 1; }
    }
    return n;
}

function repairGrid(grid, difficulty) {
    const target = targetReach(difficulty);
    const wrapper = { grids: { left: grid, right: grid } };

    // Worst case every row is cleared, so this always terminates.
    for (let pass = 0; pass < BAR_SIZE; pass += 1) {
        if (reachableBarCells(wrapper, 'left') >= target) { return; }

        // Clear the most cluttered still-dirty row — it is the cheapest
        // single edit that can open a new route.
        let worstRow = -1;
        let worstCount = 0;
        for (let row = 0; row < BAR_SIZE; row += 1) {
            const n = rowBlockerCount(grid, row);
            if (n > worstCount) { worstCount = n; worstRow = row; }
        }
        if (worstRow < 0) { return; }   // nothing left to clear

        for (let col = 0; col < SIDE_COLS; col += 1) {
            if (BLOCKING_TYPES.has(grid[col][worstRow])) { grid[col][worstRow] = 'wire'; }
        }
    }
}

function makeStartingBar() {
    const bar = new Array(BAR_SIZE);
    for (let i = 0; i < BAR_SIZE; i += 1) {
        bar[i] = i % 2 === 0 ? 'left' : 'right';
    }
    return bar;
}

// ─────────────────────────────────────────────
//  PULSE PROPAGATION CORE
// ─────────────────────────────────────────────
//  Shared by the live board (step) and the throwaway validation/AI sims
//  (reachableBarCells, pickBestRow), so behaviour never drifts between them.

function opposite(colour) {
    return colour === 'left' ? 'right' : 'left';
}

function withStep(pulse, overrides, now) {
    return {
        side: pulse.side,
        colour: pulse.colour,
        col: pulse.col,
        row: pulse.row,
        firedAt: pulse.firedAt,
        nextStepAt: now + PULSE_STEP_MS,
        ...overrides,
    };
}

// A joiner cell needs two separate arrivals within JOINER_WINDOW_MS. The
// map is keyed by cell position only (side:col:row) — which diagonal a
// pulse arrived from doesn't matter, only that two showed up in time.
function handleJoiner(board, side, col, pulse, now, outList) {
    const key = `${side}:${col}:${pulse.row}`;
    const waiting = board.joinerWait.get(key);

    if (waiting && (now - waiting.time) <= JOINER_WINDOW_MS) {
        board.joinerWait.delete(key);
        outList.push({
            side,
            colour: pulse.colour, // later arrival's colour wins
            col,
            row: pulse.row,
            firedAt: now,
            nextStepAt: now + PULSE_STEP_MS,
        });
        return;
    }

    // First arrival, or the previous one went stale — (re)start the wait.
    board.joinerWait.set(key, { time: now, colour: pulse.colour });
}

// An auto-pulser latches to whichever colour last activated it and keeps
// emitting on its own schedule (tracked in board.autos) for the rest of
// the round — that emission loop is independent of any single pulse's
// PULSE_LIFE_MS.
function handleAuto(board, side, col, pulse, now, outList) {
    const key = `${side}:${col}:${pulse.row}`;
    let auto = board.autos.find((a) => a.key === key);

    if (!auto) {
        auto = { key, side, col, row: pulse.row, colour: pulse.colour, nextEmitAt: now + AUTO_PERIOD_MS };
        board.autos.push(auto);
    } else {
        auto.colour = pulse.colour; // re-latch to whichever colour just activated it
        auto.nextEmitAt = now + AUTO_PERIOD_MS;
    }

    outList.push({
        side,
        colour: auto.colour,
        col,
        row: pulse.row,
        firedAt: now,
        nextStepAt: now + PULSE_STEP_MS,
    });
}

// Advances one pulse by exactly one cell, applying the cell it enters.
// Pushes 0-2 resulting pulses onto outList; paints board.bar directly when
// a pulse steps past the last column.
function advancePulse(board, pulse, now, outList) {
    const side = pulse.side;
    const grid = board.grids[side];
    const newCol = pulse.col + 1;

    if (newCol >= SIDE_COLS) {
        if (pulse.row >= 0 && pulse.row < BAR_SIZE) {
            board.bar[pulse.row] = pulse.colour;
        }
        return;
    }

    if (pulse.row < 0 || pulse.row >= BAR_SIZE) {
        return; // out-of-range guard — dies rather than reading past the grid
    }

    const column = grid[newCol];
    const cellType = (column && column[pulse.row]) || 'empty';

    switch (cellType) {
        case 'wire':
            outList.push(withStep(pulse, { col: newCol }, now));
            break;

        case 'invert':
            outList.push(withStep(pulse, { col: newCol, colour: opposite(pulse.colour) }, now));
            break;

        case 'splitter':
            for (const dr of [-1, 1]) {
                const row = pulse.row + dr;
                if (row >= 0 && row < BAR_SIZE) {
                    outList.push(withStep(pulse, { col: newCol, row }, now));
                }
            }
            break;

        case 'joiner':
            handleJoiner(board, side, newCol, pulse, now, outList);
            break;

        case 'auto':
            handleAuto(board, side, newCol, pulse, now, outList);
            break;

        case 'terminator':
        case 'empty':
        default:
            break; // absorbed
    }
}

// Runs a self-contained sim (its own bar/autos/joinerWait) to completion
// from a set of starting pulses, without touching the real board. Used by
// both board validation and the opponent AI's row scoring.
function runThrowawaySim(grids, startingPulses) {
    const sandbox = {
        grids,
        bar: new Array(BAR_SIZE).fill(null),
        pulses: startingPulses,
        autos: [],
        joinerWait: new Map(),
    };

    let now = 0;
    const maxTicks = SIDE_COLS + 4; // enough for the longest possible chain to drain

    for (let i = 0; i < maxTicks; i += 1) {
        now += PULSE_STEP_MS;

        for (const auto of sandbox.autos) {
            if (auto.nextEmitAt <= now) {
                sandbox.pulses.push({
                    side: auto.side,
                    colour: auto.colour,
                    col: auto.col,
                    row: auto.row,
                    firedAt: now,
                    nextStepAt: now + PULSE_STEP_MS,
                });
                auto.nextEmitAt += AUTO_PERIOD_MS;
            }
        }

        const due = [];
        const notDue = [];
        for (const pulse of sandbox.pulses) {
            (pulse.nextStepAt <= now ? due : notDue).push(pulse);
        }

        const advanced = [];
        for (const pulse of due) {
            advancePulse(sandbox, pulse, now, advanced);
        }

        sandbox.pulses = notDue.concat(advanced);
    }

    return sandbox.bar;
}

// ─────────────────────────────────────────────
//  BOARD VALIDATION
// ─────────────────────────────────────────────

/** Counts the distinct bar cells `side` could ever paint, unopposed, choosing its own firing order. */
export function reachableBarCells(board, side) {
    // Each lane is simulated on its own and the results unioned. Firing every
    // row at once would understate the answer: two lanes landing on the same
    // cell in the same tick let the loser overwrite the winner, and the
    // player controls firing order, so that collision is avoidable.
    const claimed = new Array(BAR_SIZE).fill(false);

    for (let row = 0; row < BAR_SIZE; row += 1) {
        const bar = runThrowawaySim(board.grids, [
            { side, colour: side, col: -1, row, firedAt: 0, nextStepAt: PULSE_STEP_MS },
        ]);
        for (let i = 0; i < BAR_SIZE; i += 1) {
            if (bar[i] === side) { claimed[i] = true; }
        }
    }

    return claimed.reduce((n, hit) => n + (hit ? 1 : 0), 0);
}

const MAX_GENERATION_ATTEMPTS = 50;
const MIN_REACHABLE_CELLS = 7;

/** Builds a deterministic, mutually-winnable board from `opts` (seed, pulser counts, difficulty). */
export function createBoard(opts) {
    const { seed, playerPulsers, opponentPulsers, difficulty } = opts;
    const clampedDifficulty = Math.max(0, Math.min(1, typeof difficulty === 'number' ? difficulty : 0.5));

    let attemptSeed = seed >>> 0;
    let grids = null;

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
        const rng = mulberry32(attemptSeed);
        const candidate = {
            left:  generateGrid(rng, clampedDifficulty),
            right: generateGrid(rng, clampedDifficulty),
        };

        const leftReach = reachableBarCells({ grids: candidate }, 'left');
        const rightReach = reachableBarCells({ grids: candidate }, 'right');

        if (leftReach >= MIN_REACHABLE_CELLS && rightReach >= MIN_REACHABLE_CELLS) {
            grids = candidate;
            break;
        }

        attemptSeed = deriveSeed(attemptSeed, attempt);
    }

    // Every generation attempt failed the reachability bar — fall back to a
    // trivially solvable board rather than ever hand out an unwinnable one.
    if (!grids) {
        grids = { left: allWireGrid(), right: allWireGrid() };
    }

    return {
        seed,
        grids,
        bar: makeStartingBar(),
        // Pulser counts follow whoever ends up on each side, so they can
        // only be assigned once chooseSide has run.
        pulserPool: { player: playerPulsers ?? 0, opponent: opponentPulsers ?? 0 },
        pulsers: { left: 0, right: 0 },
        pulserRow: { left: 0, right: 0 },
        pulses: [],
        autos: [],
        joinerWait: new Map(),
        elapsed: 0,
        phase: 'select',
        playerSide: null,
        result: null,
    };
}

// ─────────────────────────────────────────────
//  PLAYER CONTROLS
// ─────────────────────────────────────────────

/** Commits the human to a side, hands each side its pulsers, and starts the round timer. */
export function chooseSide(board, side) {
    const other = opposite(side);
    board.playerSide     = side;
    board.opponentSide   = other;
    board.pulsers[side]  = board.pulserPool.player;
    board.pulsers[other] = board.pulserPool.opponent;
    board.phase          = 'running';
    board.elapsed        = 0; // the select phase doesn't count against the round timer
}

/** Consumes one pulser at pulserRow[side] and spawns a pulse into the side track. Returns false if none remain. */
export function firePulser(board, side, now) {
    if (board.pulsers[side] <= 0) {
        return false;
    }

    board.pulsers[side] -= 1;
    const row = board.pulserRow[side];
    board.pulses.push({ side, colour: side, col: -1, row, firedAt: now, nextStepAt: now + PULSE_STEP_MS });
    return true;
}

/** Moves the side-track cursor by `delta` rows, clamped to the bar's range. */
export function movePulser(board, side, delta) {
    const next = board.pulserRow[side] + delta;
    board.pulserRow[side] = Math.max(0, Math.min(BAR_SIZE - 1, next));
}

// ─────────────────────────────────────────────
//  ROUND STEP / RESOLUTION
// ─────────────────────────────────────────────

/** Advances the whole sim by one tick: autos, pulse movement, expiry, and timer resolution. */
export function step(board, now, deltaMs) {
    if (board.phase !== 'running') {
        return board;
    }

    board.elapsed += deltaMs;

    // Due auto-pulsers re-emit first, so their fresh pulses are subject to
    // the same single-cell advance as everything else this tick.
    for (const auto of board.autos) {
        while (auto.nextEmitAt <= now) {
            board.pulses.push({
                side: auto.side,
                colour: auto.colour,
                col: auto.col,
                row: auto.row,
                firedAt: now,
                nextStepAt: now + PULSE_STEP_MS,
            });
            auto.nextEmitAt += AUTO_PERIOD_MS;
        }
    }

    const due = [];
    const notDue = [];
    for (const pulse of board.pulses) {
        (pulse.nextStepAt <= now ? due : notDue).push(pulse);
    }

    const advanced = [];
    for (const pulse of due) {
        advancePulse(board, pulse, now, advanced);
    }

    board.pulses = notDue.concat(advanced)
        .filter((pulse) => now - pulse.firedAt <= PULSE_LIFE_MS);

    if (board.elapsed >= TIMER_MS) {
        resolve(board);
    }

    return board;
}

/** Counts bar ownership: { left, right }. */
export function countBar(board) {
    const counts = { left: 0, right: 0 };
    for (const owner of board.bar) {
        if (owner === 'left' || owner === 'right') {
            counts[owner] += 1;
        }
    }
    return counts;
}

/** Tallies the bar, sets result relative to playerSide, and marks the board done. */
export function resolve(board) {
    // Resolving before a side was picked has no meaningful answer — treat it
    // as a draw so the caller replays rather than silently scoring a loss.
    if (board.playerSide !== 'left' && board.playerSide !== 'right') {
        board.result = 'draw';
        board.phase  = 'done';
        return board;
    }

    const counts = countBar(board);
    const mine = counts[board.playerSide];

    if (mine > BAR_SIZE / 2) {
        board.result = 'win';
    } else if (mine === BAR_SIZE / 2) {
        board.result = 'draw';
    } else {
        board.result = 'lose';
    }

    board.phase = 'done';
    return board;
}

// ─────────────────────────────────────────────
//  OPPONENT AI
// ─────────────────────────────────────────────

// Same throwaway-sim trick as reachableBarCells, but for a single starting
// row so the AI can compare lanes against each other.
function simulateLaneOutcome(board, side, row) {
    const startingPulses = [{ side, colour: side, col: -1, row, firedAt: 0, nextStepAt: PULSE_STEP_MS }];
    return runThrowawaySim(board.grids, startingPulses);
}

// Scores every row by how many bar cells it would newly claim for `side`,
// and returns the best one.
function pickBestRow(board, side) {
    let bestRow = board.pulserRow[side];
    let bestScore = -1;

    for (let row = 0; row < BAR_SIZE; row += 1) {
        const outcome = simulateLaneOutcome(board, side, row);
        let score = 0;
        for (let i = 0; i < BAR_SIZE; i += 1) {
            if (outcome[i] === side && board.bar[i] !== side) {
                score += 1;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestRow = row;
        }
    }

    return bestRow;
}

const AI_DELAY_MIN_MS  = 250;  // decision cadence at difficulty 1
const AI_DELAY_MAX_MS  = 900;  // decision cadence at difficulty 0
const AI_ROWS_MIN      = 2;    // rows the cursor covers per decision at difficulty 0
const AI_ROWS_MAX      = 5;    // ...and at difficulty 1

/** Creates opponent AI state for `side`, with reaction speed scaled by difficulty (0..1). */
export function createOpponentAI(board, side, difficulty) {
    const clamped = Math.max(0, Math.min(1, typeof difficulty === 'number' ? difficulty : 0.5));
    return {
        side,
        difficulty:     clamped,
        decisionDelay:  AI_DELAY_MAX_MS - (AI_DELAY_MAX_MS - AI_DELAY_MIN_MS) * clamped,
        rowsPerMove:    Math.round(AI_ROWS_MIN + (AI_ROWS_MAX - AI_ROWS_MIN) * clamped),
        nextDecisionAt: 0,
        targetRow:      null,
    };
}

/** Runs one AI decision tick: picks a lane, walks the cursor toward it, and fires on arrival. */
export function stepOpponentAI(ai, board, now) {
    if (board.phase !== 'running' || board.pulsers[ai.side] <= 0) {
        return ai;
    }
    if (now < ai.nextDecisionAt) {
        return ai;
    }
    ai.nextDecisionAt = now + ai.decisionDelay;

    // Re-score only when there is no lane in hand. Re-picking every tick lets
    // the cursor oscillate between two similar lanes and never arrive.
    if (ai.targetRow === null) {
        ai.targetRow = pickBestRow(board, ai.side);
    }

    const current = board.pulserRow[ai.side];
    if (current !== ai.targetRow) {
        const dir  = ai.targetRow > current ? 1 : -1;
        const dist = Math.min(ai.rowsPerMove, Math.abs(ai.targetRow - current));
        movePulser(board, ai.side, dir * dist);
    }

    // Arriving and firing in the same decision keeps the AI competitive
    // inside a 15-second round.
    if (board.pulserRow[ai.side] === ai.targetRow) {
        firePulser(board, ai.side, now);
        ai.targetRow = null;   // pick a fresh lane next time
    }

    return ai;
}
