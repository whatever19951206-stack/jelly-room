/** Fruit merge rules and an independent fixed-step circle rigid-body simulation. */
export const WIDTH = 10;
export const HEIGHT = 14;
export const DANGER_Y = 12.2;
export const FIXED_STEP = 1 / 120;
export const DROP_COOLDOWN = .45;
export const OVERFLOW_GRACE = 2;
export const GRAVITY = 23;

const names = ['樱桃', '草莓', '葡萄', '柠檬', '蜜橙', '苹果', '梨', '蜜桃', '菠萝', '蜜瓜', '西瓜'];
const radii = [.32, .42, .54, .67, .82, 1.02, 1.24, 1.48, 1.77, 2.08, 2.5];
const colors = ['#ed4361', '#fa637d', '#9663d0', '#f4d650', '#ff9b39', '#ee6852', '#b6d85b', '#ffb6a0', '#f5c45a', '#badd84', '#4ead71'];
const accents = ['#9f173c', '#b5254e', '#60388f', '#dfb523', '#e26c19', '#a62a25', '#779f32', '#e97b85', '#bb8d26', '#76a951', '#24764b'];
export const FRUITS = Object.freeze(names.map((name, level) => Object.freeze({
  level, name, radius: radii[level], color: colors[level], accent: accents[level],
  score: (level + 1) * (level + 2) / 2, mass: radii[level] ** 2 * 3.2,
})));

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const EPSILON = 1e-7;
const cloneBody = body => ({ ...body,
  contacts: body.contacts.map(contact => ({ ...contact, normal: { ...contact.normal } })),
  deform: { ...body.deform },
});

export function createRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class FruitMergeModel {
  constructor({ random = Math.random, seed, onEvent = () => {} } = {}) {
    this.random = seed === undefined ? (typeof random === 'function' ? random : Math.random) : createRandom(seed);
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.status = 'ready';
    this.bodies = [];
    this.score = this.merges = this.drops = this.watermelons = 0;
    this.highestLevel = 0;
    this.currentLevel = this._nextLevel();
    this.nextLevel = this._nextLevel();
    this.aimX = WIDTH / 2;
    this.dropCooldown = this.overflowTime = this.elapsed = this._accumulator = 0;
    this._nextId = 1;
    this._eventTimes = new Map();
    this._contactCache = new Map();
    this._lastMergeTime = -Infinity;
    this._mergeCombo = 0;
    return this.snapshot();
  }

  start() { this.reset(); this.status = 'playing'; this._emit('start'); return this.snapshot(); }
  pause() { if (this.status !== 'playing') return false; this.status = 'paused'; this._emit('pause'); return true; }
  resume() { if (this.status !== 'paused') return false; this.status = 'playing'; this._emit('resume'); return true; }
  _emit(type, detail = {}) { this.onEvent({ type, ...detail }); }
  _randomValue() { const value = this.random(); return Number.isFinite(value) ? clamp(value, 0, 1) : .5; }
  _nextLevel() { return clamp(Math.floor(this._randomValue() * 5), 0, 4); }

  setAim(x) {
    if (this.status === 'paused' || this.status === 'over') return this.aimX;
    if (!Number.isFinite(x)) return this.aimX;
    const radius = FRUITS[this.currentLevel].radius;
    this.aimX = clamp(x, radius + .02, WIDTH - radius - .02);
    return this.aimX;
  }

  get canDrop() { return this.status === 'playing' && this.dropCooldown <= EPSILON && !this._entryBlocked(this.aimX); }
  get state() { return this.snapshot(); }
  get overflowRemaining() { return Math.max(0, OVERFLOW_GRACE - this.overflowTime); }

  _entryBlocked(x) {
    const radius = FRUITS[this.currentLevel].radius, y = HEIGHT - radius - .08;
    return this.bodies.some(body => (body.x - x) ** 2 + (body.y - y) ** 2 < (body.radius + radius + .025) ** 2);
  }

  drop(x = this.aimX) {
    this.setAim(x);
    if (!this.canDrop) return false;
    const level = this.currentLevel, radius = FRUITS[level].radius;
    const body = this._body(level, this.aimX, HEIGHT - radius - .08, 0, -.45);
    body.angle = (this._randomValue() - .5) * .3;
    body.angularVelocity = (this._randomValue() - .5) * .5;
    this.bodies.push(body);
    this.drops++;
    this.highestLevel = Math.max(this.highestLevel, level);
    this.currentLevel = this.nextLevel;
    this.nextLevel = this._nextLevel();
    this.setAim(this.aimX);
    this.dropCooldown = DROP_COOLDOWN;
    this._emit('drop', { body: cloneBody(body), currentLevel: this.currentLevel, nextLevel: this.nextLevel });
    return true;
  }

  _body(level, x, y, vx = 0, vy = 0) {
    const { radius, mass } = FRUITS[level];
    return { id: this._nextId++, level, x, y, vx, vy, radius, mass,
      angle: 0, angularVelocity: 0, age: 0, contacts: [], settled: false,
      deform: { x: 0, y: 0, amount: 0 },
    };
  }

  /** Elapsed seconds; the accumulator makes results independent of display refresh rate. */
  tick(dtSeconds) {
    if (this.status !== 'playing' || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    this._accumulator += Math.min(dtSeconds, .5);
    while (this._accumulator + EPSILON >= FIXED_STEP && this.status === 'playing') {
      this._accumulator -= FIXED_STEP;
      this._step(FIXED_STEP);
    }
  }

  _step(dt) {
    this.elapsed += dt;
    this.dropCooldown = Math.max(0, this.dropCooldown - dt);
    for (const body of this.bodies) {
      body.age += dt;
      body.contacts = [];
      body.deform = { x: 0, y: 0, amount: 0 };
      body.vx *= Math.exp(-.13 * dt);
      body.vy = (body.vy - GRAVITY * dt) * Math.exp(-.08 * dt);
      body.angularVelocity *= Math.exp(-.6 * dt);
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.angle += body.angularVelocity * dt;
    }
    this._mergeContacts();
    this._stepContacts = new Map();
    this._warmContacts();
    // Sequential impulses resolve unequal masses, normal restitution, and rolling friction.
    // Position correction is deliberately separate from velocity: packed fruit do not gain
    // fictitious launch velocity from correcting a small overlap under their own weight.
    for (let iteration = 0; iteration < 9; iteration++) {
      for (const body of this.bodies) this._walls(body, iteration === 0);
      for (let a = 0; a < this.bodies.length; a++) {
        for (let b = a + 1; b < this.bodies.length; b++) this._pair(this.bodies[a], this.bodies[b], iteration === 0);
      }
    }
    for (const body of this.bodies) {
      this._walls(body, false);
      body.vx = clamp(body.vx, -22, 22);
      body.vy = clamp(body.vy, -28, 22);
      body.angularVelocity = clamp(body.angularVelocity, -16, 16);
      body.settled = body.age > .4 && body.contacts.length > 0 && Math.hypot(body.vx, body.vy) < .25 && Math.abs(body.angularVelocity) < .45;
      if (body.settled && Math.abs(body.vx) < .012) body.vx = 0;
      if (body.settled && Math.abs(body.angularVelocity) < .016) body.angularVelocity = 0;
    }
    this._contactCache = this._stepContacts;
    const overflow = this.bodies.some(body => body.age > 1.05 && body.y + body.radius > DANGER_Y + .025);
    this.overflowTime = overflow ? this.overflowTime + dt : Math.max(0, this.overflowTime - dt * 3);
    if (this.overflowTime + EPSILON >= OVERFLOW_GRACE) {
      this.overflowTime = OVERFLOW_GRACE;
      this.status = 'over';
      this._emit('gameover', { score: this.score, highestLevel: this.highestLevel, watermelons: this.watermelons });
    }
    if (this._eventTimes.size > 500) for (const [key, time] of this._eventTimes) if (this.elapsed - time > 2) this._eventTimes.delete(key);
  }

  _mergeContacts() {
    const consumed = new Set(), replacements = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.bodies[i];
      if (a.level === FRUITS.length - 1 || consumed.has(a.id)) continue;
      for (let j = i + 1; j < this.bodies.length; j++) {
        const b = this.bodies[j];
        if (a.level !== b.level || consumed.has(b.id)) continue;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > (a.radius + b.radius + .008) ** 2) continue;
        const parents = [cloneBody(a), cloneBody(b)], level = a.level + 1;
        const totalMass = a.mass + b.mass;
        const body = this._body(level, (a.x * a.mass + b.x * b.mass) / totalMass,
          (a.y * a.mass + b.y * b.mass) / totalMass);
        body.x = clamp(body.x, body.radius + .002, WIDTH - body.radius - .002);
        body.y = Math.max(body.radius + .002, body.y);
        body.vx = (a.vx * a.mass + b.vx * b.mass) / body.mass;
        body.vy = (a.vy * a.mass + b.vy * b.mass) / body.mass;
        body.angle = (a.angle + b.angle) / 2;
        body.angularVelocity = (a.angularVelocity * a.mass * a.radius ** 2 + b.angularVelocity * b.mass * b.radius ** 2) / (body.mass * body.radius ** 2);
        body.age = Math.min(a.age, b.age);
        consumed.add(a.id); consumed.add(b.id); replacements.push(body);
        const scoreDelta = FRUITS[level].score;
        this.score += scoreDelta; this.merges++;
        this.highestLevel = Math.max(this.highestLevel, level);
        const chain = this.elapsed - this._lastMergeTime <= .8 ? this._mergeCombo + 1 : 1;
        this._lastMergeTime = this.elapsed; this._mergeCombo = chain;
        this._emit('merge', { parents, body: cloneBody(body), level, scoreDelta, chain });
        if (level === FRUITS.length - 1) {
          this.watermelons++;
          this._emit('watermelon', { body: cloneBody(body), count: this.watermelons });
        }
        break;
      }
    }
    if (consumed.size) this.bodies = this.bodies.filter(body => !consumed.has(body.id)).concat(replacements);
  }

  _record(body, otherId, nx, ny, depth, impulse, impactSpeed, point, wall) {
    const existing = body.contacts.find(contact => contact.otherId === otherId && contact.wall === wall);
    if (existing) {
      existing.impulse = Math.max(existing.impulse, impulse);
      existing.depth = existing.penetration = Math.max(existing.depth, depth);
    } else {
      const contact = { otherId, nx, ny, normal: { x: nx, y: ny }, depth, penetration: depth, impulse, wall };
      body.contacts.push(contact);
      const amount = Math.min(.16, depth / body.radius * .55 + impulse / body.mass * .014);
      if (amount > body.deform.amount) body.deform = { x: nx, y: ny, amount };
    }
    if (impactSpeed < .7) return;
    const key = otherId === null ? `${body.id}:${wall}` : `${Math.min(body.id, otherId)}:${Math.max(body.id, otherId)}`;
    if (this.elapsed - (this._eventTimes.get(key) ?? -Infinity) < .12) return;
    this._eventTimes.set(key, this.elapsed);
    this._emit('contact', { bodyId: body.id, otherId, nx, ny, normal: { x: nx, y: ny },
      impulse, impactSpeed, intensity: clamp(impactSpeed / 11, .05, 1), point, wall,
    });
  }

  _walls(body, record) {
    const { radius } = body;
    if (body.x <= radius + .0021) this._wall(body, 1, 0, Math.max(0, radius + .002 - body.x), 'left', record);
    if (body.x >= WIDTH - radius - .0021) this._wall(body, -1, 0, Math.max(0, body.x - (WIDTH - radius - .002)), 'right', record);
    if (body.y <= radius + .0021) this._wall(body, 0, 1, Math.max(0, radius + .002 - body.y), 'floor', record);
  }

  _warmContacts() {
    const actions = [];
    const prepare = (key, nx, ny, vn, restitution, apply) => {
      const previous = this._contactCache.get(key), compatible = previous && previous.nx * nx + previous.ny * ny > .9;
      const constraint = { nx, ny, normalImpulse: compatible ? previous.normalImpulse : 0,
        frictionImpulse: compatible ? previous.frictionImpulse : 0,
        impactSpeed: Math.max(0, -vn), bias: vn < -2 ? -vn * restitution : 0 };
      this._stepContacts.set(key, constraint);
      actions.push(() => apply(constraint.normalImpulse, constraint.frictionImpulse));
    };
    for (const body of this.bodies) {
      const wall = (nx, ny, name) => prepare(`${body.id}:${name}`, nx, ny, body.vx * nx + body.vy * ny, .12,
        (normal, friction) => this._wallImpulse(body, nx, ny, normal, friction));
      if (body.x <= body.radius + .0021) wall(1, 0, 'left');
      if (body.x >= WIDTH - body.radius - .0021) wall(-1, 0, 'right');
      if (body.y <= body.radius + .0021) wall(0, 1, 'floor');
    }
    for (let i = 0; i < this.bodies.length; i++) for (let j = i + 1; j < this.bodies.length; j++) {
      const a = this.bodies[i], b = this.bodies[j], dx = a.x - b.x, dy = a.y - b.y;
      const distance = Math.hypot(dx, dy);
      if (distance > a.radius + b.radius + .002) continue;
      const nx = distance > EPSILON ? dx / distance : (a.id < b.id ? -1 : 1), ny = distance > EPSILON ? dy / distance : 0;
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      prepare(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`, nx, ny, vn, .09,
        (normal, friction) => this._pairImpulse(a, b, nx, ny, normal, friction));
    }
    // All cached impulses must be applied together before solving. Applying and solving
    // one contact at a time removes a floor's support before the fruit above pushes on it.
    for (const apply of actions) apply();
  }

  _wall(body, nx, ny, depth, wall, record) {
    body.x += nx * depth; body.y += ny * depth;
    const key = `${body.id}:${wall}`, initialVn = body.vx * nx + body.vy * ny;
    let constraint = this._stepContacts.get(key);
    if (!constraint) {
      constraint = { nx, ny, normalImpulse: 0, frictionImpulse: 0,
        impactSpeed: Math.max(0, -initialVn), bias: initialVn < -2 ? -initialVn * .12 : 0 };
      this._stepContacts.set(key, constraint);
    }
    const vn = body.vx * nx + body.vy * ny;
    const normalImpulse = Math.max(0, constraint.normalImpulse + (constraint.bias - vn) * body.mass);
    const deltaNormal = normalImpulse - constraint.normalImpulse;
    constraint.normalImpulse = normalImpulse;
    this._wallImpulse(body, nx, ny, deltaNormal, 0);
    const tx = -ny, ty = nx;
    const vt = body.vx * tx + body.vy * ty - body.angularVelocity * body.radius;
    const frictionImpulse = clamp(constraint.frictionImpulse - vt * body.mass / 3, -normalImpulse * .48, normalImpulse * .48);
    this._wallImpulse(body, nx, ny, 0, frictionImpulse - constraint.frictionImpulse);
    constraint.frictionImpulse = frictionImpulse;
    this._record(body, null, nx, ny, depth, normalImpulse, constraint.impactSpeed, { x: body.x - nx * body.radius, y: body.y - ny * body.radius }, wall);
  }

  _wallImpulse(body, nx, ny, normal, friction) {
    body.vx += (nx * normal - ny * friction) / body.mass;
    body.vy += (ny * normal + nx * friction) / body.mass;
    body.angularVelocity -= 2 * friction / (body.mass * body.radius);
  }

  _pairImpulse(a, b, nx, ny, normal, friction) {
    const ix = nx * normal - ny * friction, iy = ny * normal + nx * friction;
    a.vx += ix / a.mass; a.vy += iy / a.mass;
    b.vx -= ix / b.mass; b.vy -= iy / b.mass;
    a.angularVelocity -= 2 * friction / (a.mass * a.radius);
    b.angularVelocity -= 2 * friction / (b.mass * b.radius);
  }

  _pair(a, b, record) {
    const dx = a.x - b.x, dy = a.y - b.y, radius = a.radius + b.radius;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > (radius + .002) ** 2) return;
    const distance = Math.sqrt(distanceSquared), nx = distance > EPSILON ? dx / distance : (a.id < b.id ? -1 : 1), ny = distance > EPSILON ? dy / distance : 0;
    const depth = Math.max(0, radius - distance), inverseA = 1 / a.mass, inverseB = 1 / b.mass, inverseTotal = inverseA + inverseB;
    let ax = nx * inverseA, ay = ny * inverseA, bx = -nx * inverseB, by = -ny * inverseB;
    // Project position corrections onto free directions. A fruit already touching the
    // floor cannot absorb an upper fruit's overlap by repeatedly sinking into the floor.
    // Its horizontal direction remains free, so a heavy fruit can still push it sideways.
    if ((a.x <= a.radius + .0021 && ax < 0) || (a.x >= WIDTH - a.radius - .0021 && ax > 0)) ax = 0;
    if (a.y <= a.radius + .0021 && ay < 0) ay = 0;
    if ((b.x <= b.radius + .0021 && bx < 0) || (b.x >= WIDTH - b.radius - .0021 && bx > 0)) bx = 0;
    if (b.y <= b.radius + .0021 && by < 0) by = 0;
    const movable = nx * (ax - bx) + ny * (ay - by);
    const correction = movable > EPSILON ? Math.max(0, depth - .0015) * .62 / movable : 0;
    a.x += ax * correction; a.y += ay * correction;
    b.x += bx * correction; b.y += by * correction;
    const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
    const initialVn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    let constraint = this._stepContacts.get(key);
    if (!constraint) {
      constraint = { nx, ny, normalImpulse: 0, frictionImpulse: 0,
        impactSpeed: Math.max(0, -initialVn), bias: initialVn < -2 ? -initialVn * .09 : 0 };
      this._stepContacts.set(key, constraint);
    }
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    const normalImpulse = Math.max(0, constraint.normalImpulse + (constraint.bias - vn) / inverseTotal);
    this._pairImpulse(a, b, nx, ny, normalImpulse - constraint.normalImpulse, 0);
    constraint.normalImpulse = normalImpulse;
    constraint.nx = nx; constraint.ny = ny;
    const tx = -ny, ty = nx;
    const vt = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty - a.angularVelocity * a.radius - b.angularVelocity * b.radius;
    const frictionImpulse = clamp(constraint.frictionImpulse - vt / (3 * inverseTotal), -normalImpulse * .35, normalImpulse * .35);
    this._pairImpulse(a, b, nx, ny, 0, frictionImpulse - constraint.frictionImpulse);
    constraint.frictionImpulse = frictionImpulse;
    const point = { x: a.x - nx * a.radius, y: a.y - ny * a.radius };
    this._record(a, b.id, nx, ny, depth, normalImpulse, constraint.impactSpeed, point);
    this._record(b, a.id, -nx, -ny, depth, normalImpulse, constraint.impactSpeed, point);
  }

  snapshot() {
    return { status: this.status, bodies: this.bodies.map(cloneBody), score: this.score,
      merges: this.merges, drops: this.drops, highestLevel: this.highestLevel, watermelons: this.watermelons,
      currentLevel: this.currentLevel, nextLevel: this.nextLevel, aimX: this.aimX,
      canDrop: this.canDrop, dropCooldown: this.dropCooldown, overflowTime: this.overflowTime,
      overflowRemaining: this.overflowRemaining, elapsed: this.elapsed,
    };
  }
}
