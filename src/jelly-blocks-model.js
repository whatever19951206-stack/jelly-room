/** Pure falling-block rules. Coordinates increase rightward/downward. */
export const COLS = 10;
export const ROWS = 20;
export const TYPES = Object.freeze(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
export const LOCK_DELAY = 500;
export const MAX_LOCK_RESETS = 15;

const spawnShapes = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]]
};

// Keep each mino's index through rotation, so renderers can animate its identity.
export const SHAPES = Object.freeze(Object.fromEntries(TYPES.map(type => {
  const rotations = [spawnShapes[type].map(([x, y]) => ({ x, y }))];
  const size = type === 'I' ? 4 : 3;
  for (let r = 1; r < 4; r++) {
    rotations.push(rotations[r - 1].map(p => type === 'O' ? { ...p } : { x: size - 1 - p.y, y: p.x }));
  }
  return [type, Object.freeze(rotations.map(shape => Object.freeze(shape.map(Object.freeze))))];
})));

export function cells(piece) {
  if (!piece || !SHAPES[piece.type]) return [];
  const rotation = ((piece.rotation ?? 0) % 4 + 4) % 4;
  return SHAPES[piece.type][rotation].map(p => ({ x: piece.x + p.x, y: piece.y + p.y }));
}

/** Deterministic random source for replays and reproducible tests. */
export function createRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

// Standard SRS offsets in its published positive-Y-up coordinate convention.
// Conversion to screen coordinates happens when applying each candidate kick.
const JLSTZ_KICKS = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
};
const I_KICKS = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
};

const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const clonePiece = piece => piece ? { ...piece } : null;
const sameCell = cell => cell ? { type: cell.type, id: cell.id } : null;

export class JellyBlocksModel {
  constructor({ random, seed, onEvent = () => {} } = {}) {
    this.random = random ?? (seed === undefined ? Math.random : createRandom(seed));
    this.onEvent = onEvent;
    // Do not invoke a renderer callback before its model variable is assigned.
    this._reset(false);
  }

  get gravityMs() { return Math.max(65, 1000 * Math.pow(Math.max(.05, .8 - (this.level - 1) * .007), this.level - 1)); }
  get grounded() { return Boolean(this.active && !this._fits({ ...this.active, y: this.active.y + 1 })); }
  get state() { return this.snapshot(); }
  cells(piece = this.active) { return cells(piece); }

  _emit(type, data = {}) { this.onEvent({ type, ...data }); }

  _reset(emit = true) {
    this.board = emptyBoard();
    this.active = null;
    this.queue = [];
    this.held = null;
    this.holdUsed = false;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.status = 'ready';
    this.combo = -1;
    this.backToBack = false;
    this.backToBackCount = 0;
    this.elapsed = 0;
    this.piecesLocked = 0;
    this.lockElapsed = 0;
    this.lockResets = 0;
    this.gravityElapsed = 0;
    this._pieceId = 0;
    this._fillQueue();
    if (emit) this._emit('reset', { status: this.status, queue: [...this.queue] });
    return this;
  }

  reset() { return this._reset(); }
  start() {
    this._reset();
    this.status = 'playing';
    this._emit('start', { status: this.status });
    this._spawn();
    return this;
  }

  _fillQueue() {
    while (this.queue.length < 7) {
      const bag = [...TYPES];
      for (let i = bag.length - 1; i > 0; i--) {
        const value = this.random();
        const j = Math.floor(Math.min(.9999999999999999, Math.max(0, Number.isFinite(value) ? value : 0)) * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.queue.push(...bag);
    }
  }

  _spawn(type = null, fromHold = false) {
    if (type === null) { type = this.queue.shift(); this._fillQueue(); }
    const piece = { type, rotation: 0, x: 3, y: -1, id: ++this._pieceId };
    this.active = piece;
    this.lockElapsed = 0;
    this.lockResets = 0;
    this.gravityElapsed = 0;
    if (!fromHold) this.holdUsed = false;
    if (!this._fits(piece)) { this._gameOver('spawn-blocked', piece); return false; }
    this._emit('spawn', { piece: clonePiece(piece), cells: cells(piece), queue: [...this.queue], held: this.held, holdUsed: this.holdUsed });
    return true;
  }

  _fits(piece) {
    return cells(piece).every(({ x, y }) => x >= 0 && x < COLS && y >= -4 && y < ROWS && (y < 0 || this.board[y][x] === null));
  }

  _resetLock(wasGrounded) {
    if (wasGrounded && this.lockResets < MAX_LOCK_RESETS) {
      this.lockElapsed = 0;
      this.lockResets++;
    }
  }

  move(dx) {
    if (this.status !== 'playing' || !this.active || !Number.isFinite(dx) || dx === 0) return false;
    dx = Math.sign(dx);
    const next = { ...this.active, x: this.active.x + dx }, wasGrounded = this.grounded;
    if (!this._fits(next)) return false;
    const fromCells = cells(this.active);
    this.active = next;
    this._resetLock(wasGrounded);
    this._emit('move', { piece: clonePiece(next), fromCells, cells: cells(next), dx, dy: 0, source: 'input', scoreDelta: 0, score: this.score });
    return true;
  }

  rotate(dir = 1) {
    if (this.status !== 'playing' || !this.active || !Number.isFinite(dir) || dir === 0) return false;
    dir = Math.sign(dir);
    const fromRotation = this.active.rotation, rotation = (fromRotation + dir + 4) % 4;
    const offsets = this.active.type === 'O' ? [[0, 0]] : (this.active.type === 'I' ? I_KICKS : JLSTZ_KICKS)[`${fromRotation}>${rotation}`];
    const wasGrounded = this.grounded, fromCells = cells(this.active);
    for (let index = 0; index < offsets.length; index++) {
      const [dx, up] = offsets[index], next = { ...this.active, rotation, x: this.active.x + dx, y: this.active.y - up };
      if (!this._fits(next)) continue;
      this.active = next;
      this._resetLock(wasGrounded);
      this._emit('rotate', { piece: clonePiece(next), fromCells, cells: cells(next), dir, fromRotation, kick: { x: dx, y: up === 0 ? 0 : -up }, kickIndex: index });
      return true;
    }
    return false;
  }

  _down(source) {
    const next = { ...this.active, y: this.active.y + 1 };
    if (!this._fits(next)) return false;
    const fromCells = cells(this.active), scoreDelta = source === 'softDrop' ? 1 : 0;
    this.active = next;
    this.score += scoreDelta;
    this._emit('move', { piece: clonePiece(next), fromCells, cells: cells(next), dx: 0, dy: 1, source, softDrop: source === 'softDrop', scoreDelta, score: this.score });
    return true;
  }

  softDrop() {
    if (this.status !== 'playing' || !this.active) return false;
    const moved = this._down('softDrop');
    if (moved) this.gravityElapsed = 0;
    return moved;
  }

  getGhostCells() {
    if (!this.active || !this._fits(this.active)) return [];
    const ghost = { ...this.active };
    while (this._fits({ ...ghost, y: ghost.y + 1 })) ghost.y++;
    return cells(ghost);
  }

  hardDrop() {
    if (this.status !== 'playing' || !this.active) return 0;
    const fromCells = cells(this.active), ghost = this.getGhostCells();
    if (!ghost.length) { this._gameOver('active-blocked', this.active); return 0; }
    const distance = ghost[0].y - fromCells[0].y;
    this.active = { ...this.active, y: this.active.y + distance };
    this.score += distance * 2;
    this._emit('hardDrop', { piece: clonePiece(this.active), fromCells, cells: cells(this.active), distance, scoreDelta: distance * 2, score: this.score });
    this._lock('hardDrop');
    return distance;
  }

  hold() {
    if (this.status !== 'playing' || !this.active || this.holdUsed) return false;
    const previous = clonePiece(this.active), incoming = this.held;
    this.held = previous.type;
    this.holdUsed = true;
    this._emit('hold', { piece: previous, cells: cells(previous), held: this.held, incoming, holdUsed: true });
    this._spawn(incoming, true);
    return true;
  }

  _lock(reason) {
    const piece = this.active, occupied = cells(piece);
    if (!piece || !this._fits(piece)) { this._gameOver('active-blocked', piece); return; }
    if (occupied.some(p => p.y < 0)) { this._gameOver('lock-out', piece); return; }
    const lockedCells = occupied.map((p, index) => ({ ...p, type: piece.type, id: `${piece.id}:${index}` }));
    for (const p of lockedCells) this.board[p.y][p.x] = { type: p.type, id: p.id };
    this.active = null;
    this.piecesLocked++;
    this._emit('lock', { piece: clonePiece(piece), cells: lockedCells, reason, piecesLocked: this.piecesLocked });
    this._clearLines();
    // A renderer may pause in a lock/clear callback; the next piece still has
    // to exist when it resumes, while a reset or game-over must stay terminal.
    if (this.status === 'playing' || this.status === 'paused') this._spawn();
  }

  _clearLines() {
    const clearedRows = [];
    for (let y = 0; y < ROWS; y++) if (this.board[y].every(Boolean)) clearedRows.push(y);
    if (!clearedRows.length) { this.combo = -1; return; }
    const removedCells = [], movedCells = [], removed = new Set(clearedRows), collapsed = emptyBoard();
    let targetY = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (removed.has(y)) {
        for (let x = 0; x < COLS; x++) removedCells.push({ x, y, ...this.board[y][x] });
        continue;
      }
      for (let x = 0; x < COLS; x++) {
        const cell = this.board[y][x];
        collapsed[targetY][x] = cell;
        if (cell && targetY !== y) movedCells.push({ from: { x, y }, to: { x, y: targetY }, ...cell });
      }
      targetY--;
    }
    this.board = collapsed;
    const count = clearedRows.length, scoringLevel = this.level, four = count === 4, backToBack = four && this.backToBack;
    this.combo++;
    this.backToBackCount = four ? this.backToBackCount + 1 : 0;
    this.backToBack = four;
    const baseScore = [0, 100, 300, 500, 800][count] ?? 800;
    const scoreDelta = baseScore * scoringLevel * (backToBack ? 1.5 : 1) + 50 * this.combo * scoringLevel;
    this.score += scoreDelta;
    this.lines += count;
    this.level = 1 + Math.floor(this.lines / 10);
    this._emit('clear', {
      clearedRows, removedCells, movedCells, cells: removedCells.map(p => ({ ...p })), count,
      combo: this.combo, backToBack, backToBackCount: this.backToBackCount,
      scoreDelta, score: this.score, lines: this.lines, level: this.level, previousLevel: scoringLevel
    });
  }

  /** Advance milliseconds exactly; time after a top-out is not counted. */
  tick(dtMs) {
    if (this.status !== 'playing' || !Number.isFinite(dtMs) || dtMs <= 0) return;
    let remaining = dtMs;
    while (remaining > 1e-8 && this.status === 'playing' && this.active) {
      if (this.grounded) {
        const slice = Math.min(remaining, Math.max(0, LOCK_DELAY - this.lockElapsed));
        this.lockElapsed += slice;
        this.elapsed += slice;
        remaining -= slice;
        if (this.lockElapsed >= LOCK_DELAY - 1e-8) this._lock('timeout');
      } else {
        const slice = Math.min(remaining, Math.max(0, this.gravityMs - this.gravityElapsed));
        this.gravityElapsed += slice;
        this.elapsed += slice;
        remaining -= slice;
        if (this.gravityElapsed >= this.gravityMs - 1e-8) { this.gravityElapsed = 0; this._down('gravity'); }
      }
    }
  }

  update(dtMs) { return this.tick(dtMs); }
  pause() {
    if (this.status !== 'playing') return false;
    this.status = 'paused';
    this._emit('pause', { status: this.status });
    return true;
  }
  resume() {
    if (this.status !== 'paused') return false;
    this.status = 'playing';
    this._emit('resume', { status: this.status });
    return true;
  }
  _gameOver(reason, piece = this.active) {
    this.status = 'over';
    this.active = null;
    this._emit('gameover', { reason, piece: clonePiece(piece), cells: cells(piece), score: this.score, lines: this.lines, level: this.level, elapsed: this.elapsed });
  }

  snapshot() {
    return {
      board: this.board.map(row => row.map(sameCell)), active: clonePiece(this.active),
      queue: [...this.queue], held: this.held, holdUsed: this.holdUsed,
      score: this.score, lines: this.lines, level: this.level, status: this.status,
      combo: this.combo, backToBack: this.backToBack, backToBackCount: this.backToBackCount,
      elapsed: this.elapsed, piecesLocked: this.piecesLocked, ghostCells: this.getGhostCells(),
      grounded: this.grounded, gravityMs: this.gravityMs, gravityElapsed: this.gravityElapsed,
      lockElapsed: this.lockElapsed, lockResets: this.lockResets
    };
  }
}

export default JellyBlocksModel;
