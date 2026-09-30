/** Fruit merge rules and independent fixed-step convex slice rigid-body simulation. */
export const WIDTH = 10;
export const HEIGHT = 14;
export const DANGER_Y = 12.2;
export const FIXED_STEP = 1 / 120;
export const DROP_COOLDOWN = .45;
export const OVERFLOW_GRACE = 2;
export const GRAVITY = 23;

const names = ['葡萄小片', '蜜橙小片', '西瓜小片', '葡萄中片', '蜜橙中片', '西瓜中片', '葡萄大片', '蜜橙大片', '西瓜大片', '蜜橙厚片', '大西瓜片'];
const radii = [.32, .42, .54, .67, .82, 1.02, 1.24, 1.48, 1.77, 2.08, 2.5];
const sliceFlavors = ['grape', 'citrus', 'melon', 'grape', 'citrus', 'melon', 'grape', 'citrus', 'melon', 'citrus', 'melon'];
const palette = { grape: { color: '#8856b8', accent: '#ac82cb' }, citrus: { color: '#f18c08', accent: '#ffe6a0' }, melon: { color: '#c71940', accent: '#3d7736' } };

function profile(flavor) {
  let points;
  if (flavor === 'melon') {
    points = [{ x: 0, y: -2.1 }];
    for (let i = 0; i <= 16; i++) { const angle = .74 + (Math.PI - 1.48) * i / 16; points.push({ x: Math.cos(angle) * 4.25, y: Math.sin(angle) * 4.25 - 2.1 }); }
  } else if (flavor === 'citrus') points = Array.from({ length: 28 }, (_, i) => ({ x: Math.cos(i / 28 * Math.PI * 2) * 3.05, y: Math.sin(i / 28 * Math.PI * 2) * 2.66 }));
  else {
    points = [];
    for (let j = 0; j < 4; j++) {
      const angle = -Math.PI / 2 + j * Math.PI / 2, cx = j < 2 ? 1.5 : -1.5, cy = j === 0 || j === 3 ? -1.5 : 1.5;
      for (let i = 0; i <= 4; i++) { const a = angle + i / 4 * Math.PI / 2; points.push({ x: cx + Math.cos(a) * 1.04, y: cy + Math.sin(a) * 1.04 }); }
    }
  }
  let twiceArea = 0, centerX = 0, centerY = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length], cross = a.x * b.y - b.x * a.y; twiceArea += cross; centerX += (a.x + b.x) * cross; centerY += (a.y + b.y) * cross; }
  const sourceCenter = Object.freeze({ x: centerX / (3 * twiceArea), y: centerY / (3 * twiceArea) });
  const sourceRadius = Math.max(...points.map(point => Math.hypot(point.x - sourceCenter.x, point.y - sourceCenter.y)));
  const outline = Object.freeze(points.map(point => Object.freeze({ x: (point.x - sourceCenter.x) / sourceRadius, y: (point.y - sourceCenter.y) / sourceRadius })));
  let area2 = 0, inertiaSum = 0; const axes = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length], cross = a.x * b.y - b.x * a.y;
    area2 += cross; inertiaSum += cross * (a.x*a.x + a.x*b.x + b.x*b.x + a.y*a.y + a.y*b.y + b.y*b.y);
    const length = Math.hypot(b.x-a.x, b.y-a.y), nx = -(b.y-a.y)/length, ny = (b.x-a.x)/length;
    if (!axes.some(axis => Math.abs(axis.x*nx + axis.y*ny) > .99999)) axes.push(Object.freeze({ x: nx, y: ny }));
  }
  return Object.freeze({ flavor, outline, sourceCenter, sourceRadius, area: Math.abs(area2)/2,
    inertiaFactor: Math.abs(inertiaSum/(6*area2)), axes: Object.freeze(axes),
    bounds: Object.freeze({ minX: Math.min(...outline.map(p=>p.x)), maxX: Math.max(...outline.map(p=>p.x)), minY: Math.min(...outline.map(p=>p.y)), maxY: Math.max(...outline.map(p=>p.y)) }),
  });
}
export const SLICE_PROFILES = Object.freeze(Object.fromEntries(['grape', 'citrus', 'melon'].map(flavor => [flavor, profile(flavor)])));
export const SLICE_OUTLINES = Object.freeze(Object.fromEntries(Object.entries(SLICE_PROFILES).map(([flavor, shape])=>[flavor, shape.outline])));
export function sliceOutline(levelOrFlavor) { return SLICE_PROFILES[typeof levelOrFlavor === 'string' ? levelOrFlavor : sliceFlavors[levelOrFlavor]].outline; }
export const FRUITS = Object.freeze(names.map((name, level) => Object.freeze({
  level, name, type: sliceFlavors[level], sliceFlavor: sliceFlavors[level], radius: radii[level], ...palette[sliceFlavors[level]],
  score: (level + 1) * (level + 2) / 2, mass: radii[level] ** 2 * 3.2, inertiaFactor: SLICE_PROFILES[sliceFlavors[level]].inertiaFactor,
})));

export function bodyOutline(body) {
  const radius = body.radius ?? FRUITS[body.level].radius, c = Math.cos(body.angle || 0), s = Math.sin(body.angle || 0);
  return sliceOutline(body.level).map(point => ({ x: body.x + radius*(c*point.x-s*point.y), y: body.y + radius*(s*point.x+c*point.y) }));
}
export function bodyBounds(body) {
  const points = bodyOutline(body); return { minX: Math.min(...points.map(p=>p.x)), maxX: Math.max(...points.map(p=>p.x)), minY: Math.min(...points.map(p=>p.y)), maxY: Math.max(...points.map(p=>p.y)) };
}
export function spawnAngle(level) { return sliceFlavors[level] === 'melon' ? Math.PI : 0; }
export function spawnY(level, angle = spawnAngle(level)) {
  const radius = FRUITS[level].radius, c = Math.cos(angle), s = Math.sin(angle);
  return HEIGHT - .08 - radius*Math.max(...sliceOutline(level).map(point=>s*point.x+c*point.y));
}

function geometryFor(body, cached) {
  if (cached && cached.x === body.x && cached.y === body.y && cached.angle === body.angle && cached.level === body.level) return cached;
  const shape = SLICE_PROFILES[sliceFlavors[body.level]], radius = body.radius ?? FRUITS[body.level].radius;
  const result = cached ?? { vertices: shape.outline.map(()=>({x:0,y:0})), axes: shape.axes.map(()=>({x:0,y:0})), bounds: {} };
  if (result.vertices.length !== shape.outline.length) result.vertices = shape.outline.map(()=>({x:0,y:0}));
  if (result.axes.length !== shape.axes.length) result.axes = shape.axes.map(()=>({x:0,y:0}));
  const c = Math.cos(body.angle || 0), s = Math.sin(body.angle || 0);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (let i=0;i<shape.outline.length;i++) {
    const local=shape.outline[i],point=result.vertices[i];point.x=body.x+radius*(c*local.x-s*local.y);point.y=body.y+radius*(s*local.x+c*local.y);
    minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
  }
  for(let i=0;i<shape.axes.length;i++){const axis=shape.axes[i],world=result.axes[i];world.x=c*axis.x-s*axis.y;world.y=s*axis.x+c*axis.y;}
  Object.assign(result.bounds,{minX,minY,maxX,maxY});result.x=body.x;result.y=body.y;result.angle=body.angle;result.level=body.level;
  return result;
}

function polygonContact(a,b,tolerance=.002) {
  const boxA=a.bounds,boxB=b.bounds;
  if(boxA.maxX<boxB.minX-tolerance||boxB.maxX<boxA.minX-tolerance||boxA.maxY<boxB.minY-tolerance||boxB.maxY<boxA.minY-tolerance)return null;
  let depth=Infinity,nx=0,ny=0;
  for(const axes of [a.axes,b.axes])for(const axis of axes){
    let minA=Infinity,maxA=-Infinity,minB=Infinity,maxB=-Infinity;
    for(const p of a.vertices){const d=p.x*axis.x+p.y*axis.y;minA=Math.min(minA,d);maxA=Math.max(maxA,d);}
    for(const p of b.vertices){const d=p.x*axis.x+p.y*axis.y;minB=Math.min(minB,d);maxB=Math.max(maxB,d);}
    const forward=maxA-minB,backward=maxB-minA;
    if(forward < -tolerance||backward < -tolerance)return null;
    const overlap=Math.min(forward,backward);
    if(overlap<depth){const sign=forward<backward?-1:forward>backward?1:((a.x-b.x)*axis.x+(a.y-b.y)*axis.y>=0?1:-1);depth=overlap;nx=axis.x*sign;ny=axis.y*sign;}
  }
  if(!Number.isFinite(depth))return null;
  // Average the overlapping support features, not the circles' hidden center line.
  const tx=-ny,ty=nx;let supportA=Infinity,supportB=-Infinity;
  for(const p of a.vertices)supportA=Math.min(supportA,p.x*nx+p.y*ny);
  for(const p of b.vertices)supportB=Math.max(supportB,p.x*nx+p.y*ny);
  let aMin=Infinity,aMax=-Infinity,bMin=Infinity,bMax=-Infinity;
  for(const p of a.vertices)if(p.x*nx+p.y*ny<=supportA+.012){const t=p.x*tx+p.y*ty;aMin=Math.min(aMin,t);aMax=Math.max(aMax,t);}
  for(const p of b.vertices)if(p.x*nx+p.y*ny>=supportB-.012){const t=p.x*tx+p.y*ty;bMin=Math.min(bMin,t);bMax=Math.max(bMax,t);}
  const low=Math.max(aMin,bMin),high=Math.min(aMax,bMax),along=low<=high?(low+high)/2:(aMin+aMax+bMin+bMax)/4,normal=(supportA+supportB)/2;
  return {nx,ny,depth:Math.max(0,depth),gap:Math.max(0,-depth),point:{x:nx*normal+tx*along,y:ny*normal+ty*along}};
}

export function sliceContact(a,b,tolerance=.002){return polygonContact(geometryFor(a),geometryFor(b),tolerance);}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const EPSILON = 1e-7;
const cloneBody = body => ({ ...body,
  contacts: body.contacts.map(contact => ({ ...contact, normal: { ...contact.normal }, ...(contact.point ? {point:{...contact.point}} : {}) })),
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
    this._geometryCache = new WeakMap();
    this._entryBody = null;
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
    const radius = FRUITS[this.currentLevel].radius, shape=SLICE_PROFILES[sliceFlavors[this.currentLevel]],angle=spawnAngle(this.currentLevel),c=Math.cos(angle),s=Math.sin(angle);
    const xs=shape.outline.map(p=>radius*(c*p.x-s*p.y));
    this.aimX = clamp(x, -Math.min(...xs)+.02, WIDTH-Math.max(...xs)-.02);
    return this.aimX;
  }

  get canDrop() { return this.status === 'playing' && this.dropCooldown <= EPSILON && !this._entryBlocked(this.aimX); }
  get state() { return this.snapshot(); }
  get overflowRemaining() { return Math.max(0, OVERFLOW_GRACE - this.overflowTime); }

  _entryBlocked(x) {
    const level=this.currentLevel,radius=FRUITS[level].radius,y=spawnY(level),angle=spawnAngle(level);
    const candidate=this._entryBody??(this._entryBody={id:-1});Object.assign(candidate,{level,radius,x,y,angle});
    return this.bodies.some(body=>this._collision(candidate,body,.006));
  }

  drop(x = this.aimX) {
    this.setAim(x);
    if (!this.canDrop) return false;
    const level = this.currentLevel, radius = FRUITS[level].radius;
    const body = this._body(level, this.aimX, spawnY(level), 0, -.45);
    body.angle = spawnAngle(level);
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
    const inertia=mass*radius*radius*FRUITS[level].inertiaFactor;
    return { id: this._nextId++, level, x, y, vx, vy, radius, mass, inertia,
      angle: 0, angularVelocity: 0, age: 0, contacts: [], settled: false,
      deform: { x: 0, y: 0, amount: 0 },
    };
  }

  _geometry(body) {const previous=this._geometryCache.get(body),shape=geometryFor(body,previous);if(!previous)this._geometryCache.set(body,shape);return shape;}
  _collision(a,b,tolerance=.002){const sum=a.radius+b.radius+tolerance;if((a.x-b.x)**2+(a.y-b.y)**2>sum*sum)return null;return polygonContact(this._geometry(a),this._geometry(b),tolerance);}
  _fitBody(body){let box=this._geometry(body).bounds;if(box.minX<.002)body.x+=.002-box.minX;else if(box.maxX>WIDTH-.002)body.x-=box.maxX-WIDTH+.002;box=this._geometry(body).bounds;if(box.minY<.002)body.y+=.002-box.minY;}
  _supportPoint(body,nx,ny){
    const points=this._geometry(body).vertices;let extreme=Infinity,x=0,y=0,count=0;
    for(const p of points)extreme=Math.min(extreme,p.x*nx+p.y*ny);
    for(const p of points)if(p.x*nx+p.y*ny<extreme+.008){x+=p.x;y+=p.y;count++;}
    return {x:x/count,y:y/count};
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
    this._stepPairs = [];
    this._warmContacts();
    // Sequential impulses resolve unequal masses, normal restitution, and rolling friction.
    // Position correction is deliberately separate from velocity: packed fruit do not gain
    // fictitious launch velocity from correcting a small overlap under their own weight.
    for (let iteration = 0; iteration < 9; iteration++) {
      for (const body of this.bodies) this._walls(body, iteration === 0);
      for (const pair of this._stepPairs) this._pair(pair.a,pair.b,pair);
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
    const overflow = this.bodies.some(body => body.age > 1.05 && this._geometry(body).bounds.maxY > DANGER_Y + .025);
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
        if (!this._collision(a,b,.0015)) continue;
        const parents = [cloneBody(a), cloneBody(b)], level = a.level + 1;
        const totalMass = a.mass + b.mass;
        const body = this._body(level, (a.x * a.mass + b.x * b.mass) / totalMass,
          (a.y * a.mass + b.y * b.mass) / totalMass);
        body.angle=spawnAngle(level);
        this._fitBody(body);
        body.vx = (a.vx * a.mass + b.vx * b.mass) / body.mass;
        body.vy = (a.vy * a.mass + b.vy * b.mass) / body.mass;
        const orbitalA=(a.x-body.x)*a.mass*a.vy-(a.y-body.y)*a.mass*a.vx,orbitalB=(b.x-body.x)*b.mass*b.vy-(b.y-body.y)*b.mass*b.vx;
        body.angularVelocity=(a.inertia*a.angularVelocity+b.inertia*b.angularVelocity+orbitalA+orbitalB)/body.inertia;
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
      const contact = { otherId, nx, ny, normal: { x: nx, y: ny }, depth, penetration: depth, impulse, point:{...point}, wall };
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

  _walls(body) {
    let box=this._geometry(body).bounds;
    if(box.minX<=.0021)this._wall(body,1,0,Math.max(0,.002-box.minX),'left');
    box=this._geometry(body).bounds;
    if(box.maxX>=WIDTH-.0021)this._wall(body,-1,0,Math.max(0,box.maxX-WIDTH+.002),'right');
    box=this._geometry(body).bounds;
    if(box.minY<=.0021)this._wall(body,0,1,Math.max(0,.002-box.minY),'floor');
  }

  _velocityAt(body,point,nx,ny) {
    const rx=point.x-body.x,ry=point.y-body.y;
    return (body.vx-body.angularVelocity*ry)*nx+(body.vy+body.angularVelocity*rx)*ny;
  }
  _effectiveMass(body,point,nx,ny) {
    const cross=(point.x-body.x)*ny-(point.y-body.y)*nx;
    return 1/body.mass+cross*cross/body.inertia;
  }
  _newConstraint(nx,ny,point,vn,restitution,previous) {
    const compatible=previous&&previous.nx*nx+previous.ny*ny>.94;
    return {nx,ny,point:{...point},normalImpulse:compatible?previous.normalImpulse:0,
      frictionImpulse:compatible?previous.frictionImpulse:0,
      impactSpeed:Math.max(0,-vn),bias:vn<-2?-vn*restitution:0};
  }
  _warmContacts() {
    const actions=[];
    const prepare=(key,nx,ny,point,vn,restitution,apply)=>{
      const constraint=this._newConstraint(nx,ny,point,vn,restitution,this._contactCache.get(key));
      this._stepContacts.set(key,constraint);
      actions.push(()=>apply(constraint.normalImpulse,constraint.frictionImpulse));
    };
    for(const body of this.bodies) {
      const box=this._geometry(body).bounds;
      const wall=(nx,ny,name)=>{
        const point=this._supportPoint(body,nx,ny),vn=this._velocityAt(body,point,nx,ny);
        prepare(body.id+':'+name,nx,ny,point,vn,.08,
          (normal,friction)=>this._wallImpulse(body,nx,ny,normal,friction,point));
      };
      if(box.minX<=.0021)wall(1,0,'left');
      if(box.maxX>=WIDTH-.0021)wall(-1,0,'right');
      if(box.minY<=.0021)wall(0,1,'floor');
    }
    for(let i=0;i<this.bodies.length;i++)for(let j=i+1;j<this.bodies.length;j++) {
      const a=this.bodies[i],b=this.bodies[j],contact=this._collision(a,b);
      if(!contact)continue;
      const {nx,ny,point}=contact,vn=this._velocityAt(a,point,nx,ny)-this._velocityAt(b,point,nx,ny);
      this._stepPairs.push({a,b,nx,ny,depth:contact.depth,point:{...point},ax:a.x,ay:a.y,bx:b.x,by:b.y});
      prepare(Math.min(a.id,b.id)+':'+Math.max(a.id,b.id),nx,ny,point,vn,.06,
        (normal,friction)=>this._pairImpulse(a,b,nx,ny,normal,friction,point));
    }
    // Apply the whole manifold before solving: the floor and the upper slice must
    // supply their cached support together, especially for very unequal masses.
    for(const apply of actions)apply();
  }

  _wall(body,nx,ny,depth,wall) {
    body.x+=nx*depth;body.y+=ny*depth;
    const point=this._supportPoint(body,nx,ny),key=body.id+':'+wall;
    let constraint=this._stepContacts.get(key);
    if(!constraint) {
      constraint=this._newConstraint(nx,ny,point,this._velocityAt(body,point,nx,ny),.08);
      this._stepContacts.set(key,constraint);
    }
    constraint.point={...point};
    const vn=this._velocityAt(body,point,nx,ny);
    const normalImpulse=Math.max(0,constraint.normalImpulse+(constraint.bias-vn)/this._effectiveMass(body,point,nx,ny));
    this._wallImpulse(body,nx,ny,normalImpulse-constraint.normalImpulse,0,point);
    constraint.normalImpulse=normalImpulse;
    const tx=-ny,ty=nx,vt=this._velocityAt(body,point,tx,ty);
    const frictionImpulse=clamp(constraint.frictionImpulse-vt/this._effectiveMass(body,point,tx,ty),-normalImpulse*.48,normalImpulse*.48);
    this._wallImpulse(body,nx,ny,0,frictionImpulse-constraint.frictionImpulse,point);
    constraint.frictionImpulse=frictionImpulse;
    this._record(body,null,nx,ny,depth,normalImpulse,constraint.impactSpeed,point,wall);
  }

  _wallImpulse(body,nx,ny,normal,friction,point) {
    const ix=nx*normal-ny*friction,iy=ny*normal+nx*friction;
    body.vx+=ix/body.mass;body.vy+=iy/body.mass;
    body.angularVelocity+=((point.x-body.x)*iy-(point.y-body.y)*ix)/body.inertia;
  }
  _pairImpulse(a,b,nx,ny,normal,friction,point) {
    const ix=nx*normal-ny*friction,iy=ny*normal+nx*friction;
    a.vx+=ix/a.mass;a.vy+=iy/a.mass;b.vx-=ix/b.mass;b.vy-=iy/b.mass;
    a.angularVelocity+=((point.x-a.x)*iy-(point.y-a.y)*ix)/a.inertia;
    b.angularVelocity-=((point.x-b.x)*iy-(point.y-b.y)*ix)/b.inertia;
  }

  _pair(a,b,manifold) {
    // The shapes do not rotate during an individual solver step. Cache its real
    // SAT manifold once, then update separation and contact anchors by translation.
    // This removes nine repeated polygon scans per contact without substituting a
    // circular collision shape; a fresh exact manifold is built at the next 120 Hz step.
    const contact=manifold?{nx:manifold.nx,ny:manifold.ny,
      depth:Math.max(0,manifold.depth-(a.x-manifold.ax-b.x+manifold.bx)*manifold.nx-(a.y-manifold.ay-b.y+manifold.by)*manifold.ny),
      point:{x:manifold.point.x+(a.x-manifold.ax+b.x-manifold.bx)/2,y:manifold.point.y+(a.y-manifold.ay+b.y-manifold.by)/2},
    }:this._collision(a,b);if(!contact)return;
    const {nx,ny,depth}=contact,point=contact.point;
    const inverseA=1/a.mass,inverseB=1/b.mass;
    let ax=nx*inverseA,ay=ny*inverseA,bx=-nx*inverseB,by=-ny*inverseB;
    const boxA=this._geometry(a).bounds,boxB=this._geometry(b).bounds;
    // Project the correction onto directions that are actually free. Real hull
    // boundaries replace the old circle radius for all floor and wall support.
    if((boxA.minX<=.0021&&ax<0)||(boxA.maxX>=WIDTH-.0021&&ax>0))ax=0;
    if(boxA.minY<=.0021&&ay<0)ay=0;
    if((boxB.minX<=.0021&&bx<0)||(boxB.maxX>=WIDTH-.0021&&bx>0))bx=0;
    if(boxB.minY<=.0021&&by<0)by=0;
    const movable=nx*(ax-bx)+ny*(ay-by);
    let correction=movable>EPSILON?Math.max(0,depth-.0015)*.62/movable:0;
    const longest=Math.max(Math.hypot(ax*correction,ay*correction),Math.hypot(bx*correction,by*correction));
    if(longest>.22)correction*=.22/longest;
    a.x+=ax*correction;a.y+=ay*correction;b.x+=bx*correction;b.y+=by*correction;
    point.x+=(ax+bx)*correction/2;point.y+=(ay+by)*correction/2;
    const key=Math.min(a.id,b.id)+':'+Math.max(a.id,b.id);
    let constraint=this._stepContacts.get(key);
    if(constraint&&constraint.nx*nx+constraint.ny*ny<.94) {
      this._pairImpulse(a,b,constraint.nx,constraint.ny,-constraint.normalImpulse,-constraint.frictionImpulse,constraint.point);
      constraint=null;
    }
    if(!constraint) {
      const vn=this._velocityAt(a,point,nx,ny)-this._velocityAt(b,point,nx,ny);
      constraint=this._newConstraint(nx,ny,point,vn,.06);
      this._stepContacts.set(key,constraint);
    }
    constraint.nx=nx;constraint.ny=ny;constraint.point={...point};
    const vn=this._velocityAt(a,point,nx,ny)-this._velocityAt(b,point,nx,ny);
    const inverseNormal=this._effectiveMass(a,point,nx,ny)+this._effectiveMass(b,point,nx,ny);
    const normalImpulse=Math.max(0,constraint.normalImpulse+(constraint.bias-vn)/inverseNormal);
    this._pairImpulse(a,b,nx,ny,normalImpulse-constraint.normalImpulse,0,point);
    constraint.normalImpulse=normalImpulse;
    const tx=-ny,ty=nx,vt=this._velocityAt(a,point,tx,ty)-this._velocityAt(b,point,tx,ty);
    const inverseTangent=this._effectiveMass(a,point,tx,ty)+this._effectiveMass(b,point,tx,ty);
    const frictionImpulse=clamp(constraint.frictionImpulse-vt/inverseTangent,-normalImpulse*.40,normalImpulse*.40);
    this._pairImpulse(a,b,nx,ny,0,frictionImpulse-constraint.frictionImpulse,point);
    constraint.frictionImpulse=frictionImpulse;
    this._record(a,b.id,nx,ny,depth,normalImpulse,constraint.impactSpeed,point);
    this._record(b,a.id,-nx,-ny,depth,normalImpulse,constraint.impactSpeed,point);
  }

  /** First real hull contact when this slice is lowered vertically from above. */
  getLandingY(x=this.aimX,level=this.currentLevel) {
    const shape={level,radius:FRUITS[level].radius,x,y:0,angle:spawnAngle(level)},a=geometryFor(shape);
    let highest=.002-a.bounds.minY;
    for(const body of this.bodies) {
      const b=this._geometry(body);let low=-Infinity,high=Infinity,possible=true;
      for(const axes of [a.axes,b.axes])for(const axis of axes) {
        let minA=Infinity,maxA=-Infinity,minB=Infinity,maxB=-Infinity;
        for(const p of a.vertices){const d=p.x*axis.x+p.y*axis.y;minA=Math.min(minA,d);maxA=Math.max(maxA,d);}
        for(const p of b.vertices){const d=p.x*axis.x+p.y*axis.y;minB=Math.min(minB,d);maxB=Math.max(maxB,d);}
        if(Math.abs(axis.y)<1e-8){if(maxA<minB||maxB<minA){possible=false;break;}continue;}
        const first=(minB-maxA)/axis.y,last=(maxB-minA)/axis.y;
        low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last));
        if(low>high){possible=false;break;}
      }
      if(possible&&low<=high)highest=Math.max(highest,high);
    }
    return highest;
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
