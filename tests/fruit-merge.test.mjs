import test from 'node:test';
import assert from 'node:assert/strict';
import { FruitMergeModel, FRUITS, SLICE_PROFILES, bodyOutline, bodyBounds, sliceContact, spawnY, spawnAngle, WIDTH, HEIGHT, DANGER_Y, DROP_COOLDOWN, OVERFLOW_GRACE, FIXED_STEP, createRandom } from '../src/fruit-merge-model.js';

function fixture(options = {}) {
  const events = [], model = new FruitMergeModel({ seed: 'fruit-tests', onEvent: event => events.push(event), ...options });
  model.start();
  return { model, events };
}
function advance(model, seconds, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) model.tick(dt);
}
function fruit(model, level, x, y, options = {}) {
  const body = model._body(level, x, y);
  Object.assign(body, { age: 2 }, options);
  model.bodies.push(body);
  return body;
}
function watermelonTower(model, fresh = false) {
  for (let row = 0; row < 5; row++) {
    fruit(model, 10, 2.5, 2.5 + row * 5, { age: fresh ? 0 : 2 });
    fruit(model, 10, 7.5, 2.5 + row * 5, { age: fresh ? 0 : 2 });
  }
}
function finite(model) {
  for (const body of model.bodies) {
    for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'angularVelocity', 'mass', 'radius']) assert.ok(Number.isFinite(body[key]), `${body.id}.${key}`);
    const box=bodyBounds(body);
    assert.ok(box.minX >= -1e-6 && box.maxX <= WIDTH + 1e-6, 'real hull is inside both walls');
    assert.ok(box.minY >= -1e-6, 'real hull does not pass through floor');
  }
}

test('eleven jelly slice levels grow from a grape slice to a large watermelon slice with well-formed material values', () => {
  assert.equal(FRUITS.length, 11); assert.equal(FRUITS[0].name, '葡萄小片'); assert.equal(FRUITS.at(-1).name, '大西瓜片');
  assert.deepEqual(FRUITS.map(fruit => fruit.sliceFlavor), ['grape', 'citrus', 'melon', 'grape', 'citrus', 'melon', 'grape', 'citrus', 'melon', 'citrus', 'melon']);
  FRUITS.forEach((type, index) => {
    assert.equal(type.level, index); assert.ok(type.radius > 0 && type.mass > 0 && type.score > 0);
    assert.equal(type.type, type.sliceFlavor); assert.ok(['grape', 'citrus', 'melon'].includes(type.type));
    assert.match(type.color, /^#[a-f0-9]{6}$/i);
    if (index) assert.ok(type.radius > FRUITS[index - 1].radius);
  });
  assert.ok(FRUITS.at(-1).radius * 2 <= WIDTH); assert.ok(DANGER_Y < HEIGHT);
});

test('seeded draws are reproducible, always small fruit, and malformed random functions stay safe', () => {
  const sample = seed => { const random = createRandom(seed); return Array.from({ length: 5000 }, random); };
  assert.deepEqual(sample('same'), sample('same')); assert.notDeepEqual(sample('same'), sample('other'));
  for (const value of sample('bounded')) assert.ok(value >= 0 && value < 1);
  for (const value of [NaN, Infinity, -10, 10]) {
    const { model } = fixture({ seed: undefined, random: () => value });
    for (let i = 0; i < 8; i++) {
      assert.ok(model.currentLevel >= 0 && model.currentLevel <= 4);
      assert.ok(model.drop(5)); model.bodies = []; advance(model, .5);
    }
    finite(model);
  }
});

test('accepted drops advance the preview once, clamp the aim and enforce both cooldown and ingress clearance', () => {
  const { model, events } = fixture({ seed: undefined, random: () => 0 });
  const preview = model.nextLevel;
  assert.ok(model.drop(-100)); assert.equal(model.drops, 1); assert.equal(model.currentLevel, preview);
  assert.equal(events.filter(event => event.type === 'drop').length, 1);
  const body = model.bodies[0]; assert.ok(bodyBounds(body).minX >= 0); assert.ok(bodyBounds(body).maxY < HEIGHT);
  assert.equal(model.drop(9), false); assert.equal(model.drops, 1);
  advance(model, DROP_COOLDOWN + FIXED_STEP);
  assert.ok(model.drop(100)); assert.equal(model.drops, 2); finite(model);
  advance(model, .5); model.bodies = [];
  fruit(model, model.currentLevel, model.aimX, spawnY(model.currentLevel),{angle:spawnAngle(model.currentLevel)});
  assert.equal(model.canDrop, false); assert.equal(model.drop(), false); assert.equal(model.drops, 2);
});

test('gravity lands a single fruit with real floor contacts and a stable resting height', () => {
  const { model } = fixture({ seed: undefined, random: () => .8 });
  model.drop(5); advance(model, 5);
  assert.equal(model.bodies.length, 1); const body = model.bodies[0];
  assert.ok(Math.abs(bodyBounds(body).minY) < .01); assert.ok(Math.abs(body.vy) < .05);
  assert.ok(body.settled); assert.ok(body.contacts.some(contact => contact.wall === 'floor' && contact.ny === 1));
  assert.equal(model.overflowTime, 0); assert.equal(model.status, 'playing'); finite(model);
});

test('different levels stack without merging and preserve independent bodies and contact normals', () => {
  const { model, events } = fixture();
  const lower = fruit(model, 3, 5, -SLICE_PROFILES.grape.bounds.minY*FRUITS[3].radius+.002);
  const upper = fruit(model, 6, 5, bodyBounds(lower).maxY-SLICE_PROFILES.grape.bounds.minY*FRUITS[6].radius);
  advance(model, 5);
  assert.equal(model.bodies.length, 2); assert.equal(model.score, 0);
  assert.equal(events.some(event => event.type === 'merge'), false);
  assert.ok(upper.y > lower.y); assert.ok((sliceContact(upper,lower)?.depth??0) < .015);
  assert.ok(upper.contacts.some(contact => contact.otherId === lower.id && contact.ny > .9));
  assert.ok(lower.contacts.some(contact => contact.otherId === upper.id && contact.ny < -.9)); finite(model);
});

test('equal fruit merge only on contact and report parents, new identity and score', () => {
  const { model, events } = fixture();
  fruit(model, 0, 3, .322); fruit(model, 0, 7, .322);
  advance(model, .25); assert.equal(model.merges, 0);
  model.bodies[1].x = 3.49; model.tick(FIXED_STEP);
  assert.equal(model.bodies.length, 1); assert.equal(model.bodies[0].level, 1);
  assert.equal(model.score, FRUITS[1].score); assert.equal(model.merges, 1);
  const event = events.find(event => event.type === 'merge');
  assert.equal(event.parents.length, 2); assert.ok(event.parents.every(parent => parent.id !== event.body.id));
  assert.equal(event.level, 1); assert.equal(event.scoreDelta, model.score); assert.equal(model.highestLevel, 1);
});

test('a touching pair is consumed once even when three identical fruit overlap', () => {
  const { model, events } = fixture();
  for (let i = 0; i < 3; i++) fruit(model, 1, 5 + i * .3, 4);
  model.tick(FIXED_STEP);
  assert.equal(model.merges, 1); assert.equal(model.bodies.length, 2);
  assert.deepEqual(model.bodies.map(body => body.level).sort(), [1, 2]);
  assert.equal(events.filter(event => event.type === 'merge').length, 1);
  assert.equal(new Set(model.bodies.map(body => body.id)).size, model.bodies.length);
});

test('four equal fruit produce two pairs and a physical follow-on chain with cumulative points', () => {
  const { model, events } = fixture();
  for (const x of [4.2, 4.55, 4.9, 5.25]) fruit(model, 0, x, 4);
  advance(model, 2);
  assert.equal(model.bodies.length, 1); assert.equal(model.bodies[0].level, 2);
  assert.equal(model.merges, 3); assert.equal(model.score, FRUITS[1].score * 2 + FRUITS[2].score);
  assert.ok(events.filter(event => event.type === 'merge').some(event => event.chain === 3)); finite(model);
});

test('merge chains count closely timed contact reactions and reset after an idle interval', () => {
  const { model, events } = fixture();
  fruit(model, 0, 4.75, 4); fruit(model, 0, 5.25, 4); model.tick(FIXED_STEP);
  advance(model, 1);
  fruit(model, 2, 4.5, 5); fruit(model, 2, 5.5, 5); model.tick(FIXED_STEP);
  assert.deepEqual(events.filter(event => event.type === 'merge').map(event => event.chain), [1, 1]);
});

test('fusion conserves parent linear momentum instead of assigning a decorative launch velocity', () => {
  const { model, events } = fixture();
  const a = fruit(model, 5, 4.5, 4, { vx: 1.4, vy: -.4 });
  const b = fruit(model, 5, 5.5, 4, { vx: -.2, vy: .6 });
  const px = a.mass * a.vx + b.mass * b.vx, py = a.mass * a.vy + b.mass * b.vy;
  model._mergeContacts();
  const merged = events.find(event => event.type === 'merge').body;
  assert.ok(Math.abs(merged.mass * merged.vx - px) < 1e-9);
  assert.ok(Math.abs(merged.mass * merged.vy - py) < 1e-9);
});

test('two melons make a watermelon, and the final level remains present rather than disappearing', () => {
  const { model, events } = fixture();
  fruit(model, 9, 3, 4.5); fruit(model, 9, 7, 4.5);
  model.tick(FIXED_STEP);
  assert.equal(model.bodies.length, 1); assert.equal(model.bodies[0].level, 10);
  assert.equal(model.watermelons, 1); assert.equal(events.filter(event => event.type === 'watermelon').length, 1);
  model.bodies = []; fruit(model, 10, 2.5, 2.502); fruit(model, 10, 7.5, 2.502);
  advance(model, 5); assert.equal(model.bodies.length, 2); assert.equal(model.watermelons, 1); finite(model);
});

test('pause freezes every public gameplay value and refuses input until resume', () => {
  const { model } = fixture(); model.drop(4); advance(model, .3);
  assert.ok(model.pause()); const paused = model.snapshot();
  model.tick(10); model.setAim(8); assert.equal(model.drop(8), false);
  assert.deepEqual(model.snapshot(), paused); assert.equal(model.pause(), false);
  assert.ok(model.resume()); model.tick(.1); assert.ok(model.elapsed > paused.elapsed);
});

test('a fresh drop above the danger line gets a grace period and a recoverable crossing never ends play', () => {
  const { model } = fixture(); assert.ok(model.drop());
  assert.ok(model.bodies[0].y + model.bodies[0].radius > DANGER_Y);
  advance(model, .5); assert.equal(model.overflowTime, 0);
  advance(model, 4); assert.equal(model.status, 'playing'); assert.equal(model.overflowTime, 0);
  watermelonTower(model); advance(model, .5); assert.ok(model.overflowTime > 0 && model.overflowTime < OVERFLOW_GRACE);
  model.bodies = model.bodies.filter(body => body.y < 6); advance(model, .3);
  assert.equal(model.status, 'playing'); assert.equal(model.overflowTime, 0);
});

test('persistent supported overflow shows the full countdown and ends once, then freezes', () => {
  const { model, events } = fixture(); watermelonTower(model, true);
  advance(model, .9); assert.equal(model.overflowTime, 0); assert.equal(model.status, 'playing');
  advance(model, 1); assert.ok(model.overflowTime > .8 && model.overflowTime < 1.1); assert.equal(model.status, 'playing');
  advance(model, 1.3); assert.equal(model.status, 'over'); assert.equal(model.overflowRemaining, 0);
  assert.equal(events.filter(event => event.type === 'gameover').length, 1); finite(model);
  const ended = model.snapshot(); model.tick(.5); assert.equal(model.drop(5), false); model.setAim(1);
  assert.deepEqual(model.snapshot(), ended);
});

test('wall impulses reflect fast fruit inward and rolling contacts retain angular motion', () => {
  const { model, events } = fixture();
  const body = fruit(model, 2, .56, 3, { vx: -10, vy: 0, angularVelocity: 1 });
  model.tick(FIXED_STEP); finite(model);
  assert.ok(events.some(event => event.type === 'contact' && event.wall === 'left' && event.nx === 1));
  const hit=body.contacts.find(contact=>contact.wall==='left');assert.ok(model._velocityAt(body,hit.point,1,0)>=-.1);
  body.x = 5; body.y = body.radius + .02; body.vx = 6; body.vy = -1;
  advance(model, .5); assert.ok(Math.abs(body.angularVelocity) > .2); finite(model);
});

test('the fixed simulation gives matching results at 30, 60 and 120 Hz', () => {
  const run = dt => {
    const { model } = fixture(); model.drop(3); advance(model, 3, dt); return model.snapshot();
  };
  const fast = run(1 / 120), medium = run(1 / 60), slow = run(1 / 30);
  for (const result of [medium, slow]) {
    assert.equal(result.bodies.length, fast.bodies.length);
    for (const key of ['x', 'y', 'vx', 'vy', 'angle']) assert.ok(Math.abs(result.bodies[0][key] - fast.bodies[0][key]) < 1e-10, key);
    assert.ok(Math.abs(result.elapsed - fast.elapsed) < 1e-10);
  }
});

test('80 mixed fruit survive dense contacts, merges and pressure without escaping the box or producing NaN', () => {
  const { model } = fixture({ seed: 'dense-stress' });
  for (let i = 0; i < 80; i++) {
    const level = i % 6, radius = FRUITS[level].radius;
    fruit(model, level, clampFixture(.7 + (i % 8) * 1.2, radius + .01, WIDTH - radius - .01),
      radius + Math.floor(i / 8) * 1.3, { vx: (i % 3 - 1) * 2, vy: 0 });
  }
  for (let i = 0; i < 1200; i++) {
    model.tick(FIXED_STEP); finite(model);
    if (model.status === 'over') break;
  }
  assert.ok(model.merges > 0); assert.ok(model.bodies.length <= 80);
  assert.equal(new Set(model.bodies.map(body => body.id)).size, model.bodies.length);
  assert.ok(model.elapsed > 1);
});
function clampFixture(value, min, max) { return Math.max(min, Math.min(max, value)); }

test('a large watermelon slice resting on a small grape slice stays supported for 60 seconds across a 61:1 mass ratio', () => {
  const { model } = fixture();
  const lower = fruit(model, 0, 5, -SLICE_PROFILES.grape.bounds.minY*FRUITS[0].radius+.002);
  const upper = fruit(model, 10, 5, bodyBounds(lower).maxY-SLICE_PROFILES.melon.bounds.minY*FRUITS[10].radius);
  let maximumOverlap = 0;
  for (let i = 0; i < 7200; i++) {
    model.tick(FIXED_STEP); finite(model);
    maximumOverlap = Math.max(maximumOverlap, sliceContact(lower,upper)?.depth??0);
  }
  assert.equal(model.status, 'playing'); assert.equal(model.bodies.length, 2);
  assert.ok(maximumOverlap < .003, `maximum overlap ${maximumOverlap}`);
  assert.ok(Math.abs(lower.vy) < .01 && Math.abs(upper.vy) < .01);
  assert.ok(lower.settled && upper.settled);
});

test('128 real timed drops keep rolling, merging and scoring for more than two minutes without deleting fruit', () => {
  const { model, events } = fixture({ seed: undefined, random: () => .1 });
  let accepted = 0;
  for (let i = 0; i < 128; i++) {
    assert.ok(model.drop(5)); accepted++;
    advance(model, 1.3); finite(model);
  }
  assert.equal(model.status, 'playing'); assert.equal(model.drops, accepted);
  assert.ok(model.elapsed > 160); assert.ok(model.merges > 100); assert.ok(model.highestLevel >= 5);
  assert.equal(model.bodies.reduce((total, body) => total + 2 ** body.level, 0), accepted);
  assert.equal(events.filter(event => event.type === 'merge').reduce((total, event) => total + event.scoreDelta, 0), model.score);
});

test('snapshots and event parent material values are detached from authoritative physics state', () => {
  const { model } = fixture(); model.drop(); advance(model, 2);
  const state = model.snapshot(); state.bodies[0].x = -100;
  state.bodies[0].contacts[0].normal.y = -5; state.bodies[0].deform.amount = 9;
  assert.ok(model.bodies[0].x > 0); assert.notEqual(model.bodies[0].contacts[0].normal.y, -5);
  assert.notEqual(model.bodies[0].deform.amount, 9);
  for (const value of [NaN, Infinity, -1, 0]) { const before = model.snapshot(); model.tick(value); assert.deepEqual(model.snapshot(), before); }
});

test('the shared hulls retain the reference fan, ellipse and rounded square with centered normalized bounds', () => {
  for(const profile of Object.values(SLICE_PROFILES)){
    assert.ok(profile.outline.length>=16);assert.ok(profile.inertiaFactor>0&&profile.area>0);
    assert.ok(Math.abs(Math.max(...profile.outline.map(p=>Math.hypot(p.x,p.y)))-1)<1e-10);
    let centerX=0,centerY=0,crossSum=0;
    for(let i=0;i<profile.outline.length;i++){
      const a=profile.outline[i],b=profile.outline[(i+1)%profile.outline.length],cross=a.x*b.y-b.x*a.y;
      crossSum+=cross;centerX+=(a.x+b.x)*cross;centerY+=(a.y+b.y)*cross;
    }
    assert.ok(Math.abs(centerX/crossSum)<1e-10&&Math.abs(centerY/crossSum)<1e-10);
  }
  const fan=SLICE_PROFILES.melon,ellipse=SLICE_PROFILES.citrus,square=SLICE_PROFILES.grape;
  assert.ok(fan.bounds.maxY-fan.bounds.minY<1.5);assert.ok(fan.bounds.maxX-fan.bounds.minX>1.9);
  assert.ok(ellipse.bounds.maxX>ellipse.bounds.maxY);assert.ok(square.bounds.maxX<.85);
  assert.equal(spawnAngle(2),Math.PI);assert.equal(spawnAngle(0),0);
});

test('same-level bounding circles may overlap while separated fan hulls never merge', () => {
  const {model}=fixture();const a=fruit(model,2,4,4),b=fruit(model,2,4,4.75);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<a.radius+b.radius);
  assert.equal(sliceContact(a,b),null);model._mergeContacts();assert.equal(model.merges,0);
  advance(model,.1);assert.equal(model.merges,0);assert.equal(model.bodies.length,2);
  b.y=a.y+.65;assert.ok(sliceContact(a,b));model._mergeContacts();assert.equal(model.merges,1);
});

test('actual hull walls allow the empty circumscribed-circle margin without an invisible obstacle', () => {
  const {model}=fixture();const body=fruit(model,3,.55,2,{vx:-3});
  advance(model,.1);finite(model);
  assert.ok(body.x<body.radius);assert.ok(bodyBounds(body).minX>=0);
});

test('a fan tip landing off center creates normal-contact angular momentum and tumbles', () => {
  const {model}=fixture();const body=fruit(model,2,5,.5,{angle:.4,vy:-3});
  const angle=body.angle;advance(model,.25);finite(model);
  assert.ok(Math.abs(body.angle-angle)>.05);assert.ok(Math.abs(body.angularVelocity)>.2);
  assert.ok(body.contacts.some(contact=>contact.wall==='floor'));
});

test('the danger line follows rotated hull edges rather than the unused enclosing circle', () => {
  const {model}=fixture();const body=fruit(model,10,5,10.6,{angle:0});
  assert.ok(body.y+body.radius>DANGER_Y);assert.ok(bodyBounds(body).maxY<DANGER_Y);
  model.tick(FIXED_STEP);assert.equal(model.overflowTime,0);
  body.angle=Math.PI;assert.ok(bodyBounds(body).maxY>DANGER_Y);
  model.tick(FIXED_STEP);assert.ok(model.overflowTime>0);
});

test('vertical landing prediction meets the actual hull and includes its real floor extent', () => {
  const {model}=fixture({seed:undefined,random:()=>0});
  const floorY=model.getLandingY(5);assert.ok(floorY<FRUITS[0].radius);
  const lower=fruit(model,3,5,-SLICE_PROFILES.grape.bounds.minY*FRUITS[3].radius+.002);
  const landing=model.getLandingY(5),probe={level:0,radius:FRUITS[0].radius,x:5,y:landing,angle:0};
  const contact=sliceContact(probe,lower);assert.ok(contact&&contact.depth<1e-6);
  probe.y+=.02;assert.equal(sliceContact(probe,lower),null);
});
