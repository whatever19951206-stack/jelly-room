import test from 'node:test';
import assert from 'node:assert/strict';
import { JellyBlocksModel, COLS, ROWS, TYPES, SHAPES, cells, createRandom, LOCK_DELAY, MAX_LOCK_RESETS } from '../src/jelly-blocks-model.js';

const empty = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const filled = (x, y) => ({ type: 'Z', id: `fixture:${x}:${y}` });
function fixture(options = {}) {
  const events = [], model = new JellyBlocksModel({ seed: 'jelly-tests', onEvent: e => events.push(e), ...options });
  model.start();
  return { model, events };
}
function piece(model, type, rotation, x, y, id = 500) { model.active = { type, rotation, x, y, id }; model.lockElapsed = model.lockResets = model.gravityElapsed = 0; }
function clearWithI(model, count) {
  model.board = empty();
  for (let y = ROWS - count; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 4) model.board[y][x] = filled(x, y);
  piece(model, 'I', 1, 2, 16);
  assert.equal(model.hardDrop(), 0);
}

test('all seven shapes have four distinct connected minos and four stable rotations', () => {
  assert.equal(COLS, 10); assert.equal(ROWS, 20); assert.equal(TYPES.length, 7);
  for (const type of TYPES) for (let rotation = 0; rotation < 4; rotation++) {
    const local = SHAPES[type][rotation];
    assert.equal(local.length, 4);
    assert.equal(new Set(local.map(p => `${p.x}:${p.y}`)).size, 4);
    const visited = new Set([0]);
    for (let pass = 0; pass < 4; pass++) local.forEach((p, i) => { if ([...visited].some(j => Math.abs(p.x-local[j].x)+Math.abs(p.y-local[j].y) === 1)) visited.add(i); });
    assert.equal(visited.size, 4);
    assert.deepEqual(cells({ type, rotation, x: 3, y: -1 }), local.map(p => ({ x: p.x+3, y: p.y-1 })));
  }
});

test('seeded 7-bag randomizer is reproducible and never starves the next queue', () => {
  function sequence(seed) {
    const { model } = fixture({ seed }), result = [];
    for (let i = 0; i < 35; i++) {
      result.push(model.active.type); assert.ok(model.queue.length >= 5);
      model.hardDrop(); model.board = empty();
    }
    return result;
  }
  const sequenceA = sequence('morning');
  assert.deepEqual(sequenceA, sequence('morning'));
  assert.notDeepEqual(sequenceA, sequence('evening'));
  for (let i = 0; i < sequenceA.length; i += 7) assert.deepEqual([...sequenceA.slice(i, i+7)].sort(), [...TYPES].sort());
  const random = createRandom(123); for (let i = 0; i < 100; i++) { const v = random(); assert.ok(v >= 0 && v < 1); }
});

test('JLSTZ kick away from either wall and upward from the floor', () => {
  const { model, events } = fixture();
  piece(model, 'T', 1, -1, 6); assert.equal(model.rotate(-1), true);
  assert.deepEqual({ x: model.active.x, y: model.active.y, rotation: model.active.rotation }, { x: 0, y: 6, rotation: 0 });
  assert.deepEqual(events.at(-1).kick, { x: 1, y: 0 });
  piece(model, 'T', 3, 8, 6); assert.equal(model.rotate(1), true); assert.equal(model.active.x, 7);
  piece(model, 'T', 0, 3, 18); assert.equal(model.rotate(1), true);
  assert.deepEqual({ x: model.active.x, y: model.active.y }, { x: 2, y: 17 });
  assert.deepEqual(events.at(-1).kick, { x: -1, y: -1 });
  assert.ok(cells(model.active).every(p => p.x >= 0 && p.x < COLS && p.y < ROWS));
});

test('I uses its own two-cell wall and floor kicks', () => {
  const { model, events } = fixture();
  piece(model, 'I', 1, -2, 6); assert.equal(model.rotate(-1), true); assert.equal(model.active.x, 0);
  assert.deepEqual(events.at(-1).kick, { x: 2, y: 0 });
  piece(model, 'I', 0, 3, 18); assert.equal(model.rotate(1), true);
  assert.deepEqual({ x: model.active.x, y: model.active.y, rotation: model.active.rotation }, { x: 4, y: 16, rotation: 1 });
  assert.deepEqual(events.at(-1).kick, { x: 1, y: -2 });
});

test('blocked rotations are rejected atomically without extending the lock delay', () => {
  const { model, events } = fixture();
  model.board = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => filled(x,y)));
  piece(model, 'T', 0, 3, 8);
  for (const p of cells(model.active)) model.board[p.y][p.x] = null;
  const before = { ...model.active }, eventCount = events.length; model.lockElapsed = 320;
  assert.equal(model.rotate(), false); assert.deepEqual(model.active, before);
  assert.equal(model.lockElapsed, 320); assert.equal(model.lockResets, 0); assert.equal(events.length, eventCount);
});

test('soft drop scores per row; ghost predicts the exact immediate hard-drop lock', () => {
  const { model, events } = fixture();
  for (let i = 0; i < 4; i++) assert.equal(model.softDrop(), true);
  assert.equal(model.score, 4);
  const before = { ...model.active }, ghost = model.getGhostCells();
  assert.deepEqual(model.active, before, 'ghost calculation is read-only');
  const distance = ghost[0].y-cells(before)[0].y;
  assert.equal(model.hardDrop(), distance); assert.equal(model.piecesLocked, 1); assert.equal(model.score, 4+distance*2);
  const lock = events.findLast(e => e.type === 'lock');
  assert.deepEqual(lock.cells.map(({x,y}) => ({x,y})), ghost);
  for (const p of lock.cells) assert.deepEqual(model.board[p.y][p.x], { type: p.type, id: p.id });
  assert.ok(model.active.id !== before.id); assert.equal(new Set(lock.cells.map(p => p.id)).size, 4);
});

test('hold is limited to once per piece and swapping restores the spawn orientation', () => {
  const { model, events } = fixture(), first = model.active.type, second = model.queue[0];
  model.move(-1); model.rotate();
  assert.equal(model.hold(), true); assert.equal(model.held, first); assert.equal(model.active.type, second);
  assert.equal(model.holdUsed, true); assert.equal(model.hold(), false);
  model.hardDrop(); assert.equal(model.holdUsed, false);
  const outgoing = model.active.type, queue = [...model.queue];
  assert.equal(model.hold(), true); assert.equal(model.active.type, first); assert.equal(model.held, outgoing);
  assert.equal(model.active.rotation, 0); assert.equal(model.active.x, 3); assert.equal(model.active.y, -1);
  assert.deepEqual(model.queue, queue, 'swapping an occupied hold slot does not consume next');
  assert.equal(events.filter(e => e.type === 'hold').length, 2);
});

test('landing requires 500 ms and at most fifteen grounded movement resets', () => {
  const { model } = fixture(); piece(model, 'O', 0, 3, 18);
  model.tick(LOCK_DELAY-1); assert.equal(model.active.id, 500); assert.equal(model.lockElapsed, 499);
  model.tick(1); assert.equal(model.piecesLocked, 1);
  model.board = empty(); piece(model, 'O', 0, 3, 18, 700);
  for (let i = 0; i < MAX_LOCK_RESETS; i++) {
    model.tick(499); assert.equal(model.move(i%2 ? -1 : 1), true);
    assert.equal(model.lockElapsed, 0); assert.equal(model.lockResets, i+1);
  }
  model.tick(499); assert.equal(model.move(-1), true);
  assert.equal(model.lockResets, 15); assert.equal(model.lockElapsed, 499);
  model.tick(1); assert.equal(model.piecesLocked, 2); assert.notEqual(model.active.id, 700);
});

test('grounded rotations count toward the same reset cap; failed moves and soft drops do not reset it', () => {
  const { model } = fixture(); piece(model, 'O', 0, -1, 18);
  model.tick(400); assert.equal(model.move(-1), false); assert.equal(model.softDrop(), false);
  assert.equal(model.lockElapsed, 400); assert.equal(model.lockResets, 0);
  assert.equal(model.rotate(), true); assert.equal(model.lockElapsed, 0); assert.equal(model.lockResets, 1);
  model.tick(500); assert.equal(model.piecesLocked, 1);
});

test('1–4 completed rows clear with classic base scores and exact animation data', () => {
  for (let count = 1; count <= 4; count++) {
    const { model, events } = fixture(); clearWithI(model, count);
    assert.equal(model.lines, count); assert.equal(model.score, [0,100,300,500,800][count]);
    const event = events.findLast(e => e.type === 'clear');
    assert.equal(event.count, count); assert.equal(event.removedCells.length, count*COLS);
    assert.deepEqual(event.clearedRows, Array.from({ length: count }, (_, i) => ROWS-count+i));
    assert.equal(model.board.flat().filter(Boolean).length, 4-count);
  }
});

test('line collapse preserves existing cell IDs and reports their old and new positions', () => {
  const { model, events } = fixture();
  for (let x = 0; x < COLS; x++) if (x !== 4 && x !== 5) model.board[19][x] = filled(x,19);
  model.board[17][0] = { type: 'L', id: 'survivor' };
  piece(model, 'O', 0, 3, 18); model.hardDrop();
  assert.deepEqual(model.board[18][0], { type: 'L', id: 'survivor' });
  assert.deepEqual(model.board[19][4], { type: 'O', id: '500:0' });
  assert.deepEqual(model.board[19][5], { type: 'O', id: '500:1' });
  const event = events.findLast(e => e.type === 'clear');
  assert.deepEqual(event.movedCells.find(p => p.id === 'survivor'), { from: {x:0,y:17}, to: {x:0,y:18}, type:'L', id:'survivor' });
  assert.ok(event.removedCells.some(p => p.id === '500:2'));
});

test('combo rewards consecutive clears and ends on a lock with no line', () => {
  const { model, events } = fixture();
  clearWithI(model, 1); clearWithI(model, 1);
  assert.equal(model.score, 250); assert.equal(model.combo, 1);
  model.board = empty(); piece(model, 'O', 0, 3, 18); model.hardDrop(); assert.equal(model.combo, -1);
  clearWithI(model, 1); assert.equal(model.score, 350); assert.equal(events.findLast(e => e.type === 'clear').combo, 0);
});

test('back-to-back four-line clears survive non-clearing locks and end on smaller clears', () => {
  const { model, events } = fixture(); clearWithI(model, 4);
  assert.equal(model.score, 800); assert.equal(model.backToBack, true);
  assert.equal(events.findLast(e => e.type === 'clear').backToBack, false);
  model.board = empty(); piece(model, 'O', 0, 3, 18); model.hardDrop(); assert.equal(model.backToBack, true);
  clearWithI(model, 4); assert.equal(model.score, 2000);
  const second = events.findLast(e => e.type === 'clear'); assert.equal(second.backToBack, true); assert.equal(second.backToBackCount, 2); assert.equal(second.scoreDelta, 1200);
  clearWithI(model, 1); assert.equal(model.backToBack, false); assert.equal(model.backToBackCount, 0);
});

test('every ten lines increases level and gravity, scoring the crossing clear at its starting level', () => {
  const { model, events } = fixture(); model.lines = 9;
  const initialGravity = model.gravityMs; clearWithI(model, 1);
  assert.equal(model.lines, 10); assert.equal(model.level, 2); assert.equal(model.score, 100);
  assert.ok(model.gravityMs < initialGravity);
  clearWithI(model, 4); assert.equal(events.findLast(e => e.type === 'clear').scoreDelta, 1700);
  model.level = 100; assert.ok(Number.isFinite(model.gravityMs) && model.gravityMs >= 65);
});

test('blocked next spawn and a piece locking above the ceiling both top out without overwriting cells', () => {
  const a = fixture();
  for (let x = 3; x < 7; x++) a.model.board[0][x] = filled(x,0);
  a.model.queue[0] = 'I'; piece(a.model, 'O', 0, 0, 18); a.model.hardDrop();
  assert.equal(a.model.status, 'over'); assert.equal(a.model.active, null);
  assert.equal(a.events.at(-1).reason, 'spawn-blocked'); assert.equal(a.model.board[0][3].id, 'fixture:3:0');
  const b = fixture(); piece(b.model, 'O', 0, 3, -1);
  b.model.board[1][4] = filled(4,1); b.model.board[1][5] = filled(5,1);
  b.model.tick(500); assert.equal(b.model.status, 'over'); assert.equal(b.events.at(-1).reason, 'lock-out');
  assert.equal(b.model.board.flat().filter(Boolean).length, 2);
  assert.equal(b.model.move(1), false); assert.equal(b.model.hold(), false);
});

test('pause freezes input, gravity, score and lock timer, then resumes without catching up', () => {
  const { model, events } = fixture(); piece(model, 'O', 0, 3, 18); model.tick(250);
  assert.equal(model.pause(), true); const before = model.snapshot();
  model.tick(60000); assert.equal(model.move(1), false); assert.equal(model.rotate(), false); assert.equal(model.softDrop(), false); assert.equal(model.hardDrop(), 0); assert.equal(model.hold(), false);
  assert.deepEqual(model.snapshot(), before);
  assert.equal(model.resume(), true); model.tick(249); assert.equal(model.piecesLocked, 0); model.tick(1); assert.equal(model.piecesLocked, 1);
  assert.equal(events.filter(e => e.type === 'pause').length, 1);
});

test('gravity and landing delay are invariant to frame duration', () => {
  const a = fixture({ seed: 'timing' }).model, b = fixture({ seed: 'timing' }).model;
  a.tick(20000); for (let i = 0; i < 1000; i++) b.tick(20);
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.equal(a.piecesLocked, 1); assert.equal(a.elapsed, 20000);
});

test('constructor is silent, reset returns ready, and snapshots cannot mutate live gameplay', () => {
  const events = [], model = new JellyBlocksModel({ seed: 12, onEvent: e => events.push(e) });
  assert.deepEqual(events, []); assert.equal(model.status, 'ready'); assert.equal(model.active, null);
  model.start(); model.hardDrop();
  const copy = model.snapshot(), first = copy.board.flat().find(Boolean), liveId = first.id;
  first.type = 'BAD'; copy.active.x = 100; copy.queue.length = 0;
  assert.notEqual(model.board.flat().find(p => p?.id === liveId).type, 'BAD'); assert.ok(model.active.x < 10); assert.ok(model.queue.length >= 5);
  model.reset(); assert.equal(model.status, 'ready'); assert.equal(model.active, null); assert.equal(model.score, 0); assert.equal(model.lines, 0); assert.equal(model.piecesLocked, 0); assert.equal(model.board.flat().filter(Boolean).length, 0);
});

test('pausing in a clear animation callback leaves the next piece ready to resume', () => {
  let model;
  model = new JellyBlocksModel({ seed: 'animation', onEvent: event => { if (event.type === 'clear') model.pause(); } });
  model.start(); clearWithI(model, 1);
  assert.equal(model.status, 'paused'); assert.ok(model.active);
  const y = model.active.y; model.resume(); model.tick(model.gravityMs);
  assert.equal(model.active.y, y+1);
});

test('seeded mixed input sequences conserve minos and keep every legal piece inside the board', () => {
  const input = createRandom('many-real-inputs'), { model } = fixture({ seed: 'many-real-pieces' });
  for (let step = 0; step < 3500; step++) {
    if (model.status === 'over') model.start();
    const action = Math.floor(input()*8);
    if (action === 0) model.move(-1);
    else if (action === 1) model.move(1);
    else if (action === 2) model.rotate(1);
    else if (action === 3) model.rotate(-1);
    else if (action === 4) model.softDrop();
    else if (action === 5) model.hardDrop();
    else if (action === 6) model.hold();
    else model.tick(input()*1800);
    const occupied = model.board.flat().filter(Boolean);
    assert.equal(occupied.length, model.piecesLocked*4-model.lines*10);
    assert.equal(new Set(occupied.map(p => p.id)).size, occupied.length);
    assert.ok(occupied.every(p => TYPES.includes(p.type)));
    assert.ok(Number.isFinite(model.score) && model.score >= 0 && Number.isFinite(model.elapsed));
    if (model.active) for (const p of cells(model.active)) {
      assert.ok(p.x >= 0 && p.x < COLS && p.y >= -4 && p.y < ROWS);
      assert.ok(p.y < 0 || model.board[p.y][p.x] === null);
    }
  }
});
