import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftBody } from '../src/softbody.js';

const rectangle=(x0=-2,x1=2,z0=-1.5,z1=1.5)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected} by at least ${tolerance}`);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const finite=b=>assert.ok([...b.positions,...b.velocities].every(Number.isFinite),'all particle state must remain finite');

test('tetrahedral mesh fills a prism exactly, has a closed shell and practical default resolution',()=>{
  const b=new SoftBody(rectangle(),1.2);
  assert.ok(b.count>=300&&b.count<=650,`${b.count} particles`);
  near(b.restVolume,4*3*1.2);
  assert.ok(b.restVolumes.every(v=>v>0));
  const surfaceEdges=new Map();
  for(let f=0;f<b.surfaceTriangles.length;f+=3){const ids=[...b.surfaceTriangles.subarray(f,f+3)];for(let i=0;i<3;i++){const key=[ids[i],ids[(i+1)%3]].sort((a,b)=>a-b).join(':');surfaceEdges.set(key,(surfaceEdges.get(key)??0)+1)}}
  assert.ok([...surfaceEdges.values()].every(count=>count===2),'every shell edge has two adjacent triangles');
  assert.equal(b.inverseMasses,b.invMass);
});

test('rest bindings reproduce affine deformation, velocity and rounded surface overhangs',()=>{
  const b=new SoftBody(rectangle(),1.2,{targetParticles:150});
  for(let j=0;j<b.rest.length;j+=3){const x=b.rest[j],y=b.rest[j+1],z=b.rest[j+2];b.positions.set([2*x+.2*y+3,y+.1*z+4,z-.3*x-2],j);b.velocities.set([y,x,z],j)}
  for(const p of [{x:.43,y:.51,z:-.73},{x:2.01,y:1.3,z:.27},{x:-1.95,y:-.03,z:1.51}]){
    const binding=b.bindPoint(p),v=b.sampleVelocity(binding),out=b.sample(binding);
    near(out.x,2*p.x+.2*p.y+3);near(out.y,p.y+.1*p.z+4);near(out.z,p.z-.3*p.x-2);
    near(v.x,p.y);near(v.y,p.x);near(v.z,p.z);
  }
});

test('gravity produces a fall, floor contacts settle, and the jelly retains volume',()=>{
  const b=new SoftBody(rectangle(-1.5,1.5,-1,1),1.1,{targetParticles:220,offset:{y:2}}),initial=b.center().y;
  for(let i=0;i<30;i++)b.step(1/120);
  assert.ok(b.center().y<initial-.2,'center of mass falls under gravity');
  for(let i=0;i<330;i++)b.step(1/120);
  const m=b.metrics();finite(b);
  assert.ok(m.minY>=b.floor-1e-9);
  assert.ok(Math.abs(m.volumeRatio-1)<.02,`settled volume ratio ${m.volumeRatio}`);
  assert.equal(m.inverted,0);
  assert.ok(m.kinetic<.1,`floor settles instead of perpetually adding energy: ${m.kinetic}`);
});

test('a small grab creates local stretch and releases into a damped volume-preserving response',()=>{
  const b=new SoftBody(rectangle(),1.2,{targetParticles:240,offset:{y:.025}}),nearBinding=b.bindPoint(1.8,1.2,0),farBinding=b.bindPoint(-1.8,1.2,0),initialNear=b.sample(nearBinding),initialFar=b.sample(farBinding);
  const grab=b.createGrab(initialNear,{radius:.6});
  grab.target={x:initialNear.x+.8,y:initialNear.y+1.2,z:initialNear.z};
  for(let i=0;i<12;i++)b.step(1/120,{grab,gravity:0,firmness:.15});
  const nearMove=distance(b.sample(nearBinding),initialNear),farMove=distance(b.sample(farBinding),initialFar);
  assert.ok(nearMove>.4,'the grabbed patch follows the hand');
  assert.ok(nearMove>farMove*1.5,'the patch deforms locally instead of translating every vertex equally');
  const before=b.metrics();assert.ok(before.kinetic>.1,'release preserves dynamic velocity');
  for(let i=0;i<360;i++)b.step(1/120,{damping:1});
  const after=b.metrics();finite(b);assert.ok(Math.abs(after.volumeRatio-1)<.025);assert.equal(after.inverted,0);assert.ok(after.kinetic<before.kinetic*.5,'floor impacts dissipate release energy while free flight is preserved');
});

test('damping removes deformation energy without damping rigid-body translation',()=>{
  const velocities=[],deformationEnergy=[];
  for(const damping of [0,1]){
    const b=new SoftBody(rectangle(-1,1,-1,1),1,{targetParticles:120,offset:{y:4}});
    b.applyImpulse({x:3,y:2,z:-1});
    for(let i=0;i<30;i++)b.step(1/120,{gravity:0,floor:-Infinity,damping});
    velocities.push(b.sampleVelocity(b.bindPoint(0,.5,0)));
    const d=new SoftBody(rectangle(-1,1,-1,1),1,{targetParticles:120,offset:{y:4}});
    for(let j=0;j<d.positions.length;j+=3)d.positions[j+1]=4.5+(d.rest[j+1]-.5)*1.25;
    for(let i=0;i<24;i++)d.step(1/120,{gravity:0,floor:-Infinity,damping,firmness:.1});
    deformationEnergy.push(d.metrics().kinetic);
  }
  assert.ok(distance(velocities[0],velocities[1])<1e-7,'the damping slider must not alter a rigidly translating object');
  assert.ok(deformationEnergy[1]<deformationEnergy[0]*.8,'higher damping reduces local vibration energy');
});

test('a flying fragment tumbles freely without an upright restoring constraint',()=>{
  const b=new SoftBody(rectangle(-.8,.8,-.6,.6),1,{targetParticles:120,offset:{y:4}}),start=b.center();
  b.applyImpulse({x:0,y:0,z:0},{x:0,y:0,z:3});
  for(let i=0;i<90;i++)b.step(1/120,{gravity:0,damping:0,floor:-Infinity});
  const pose=b.getPose();finite(b);
  assert.ok(Math.abs(pose.quaternion.z)>.6,`expected a substantial roll, got ${JSON.stringify(pose.quaternion)}`);
  assert.ok(distance(pose.center,start)<.06,'internal constraints preserve the center of mass');
  assert.ok(Math.abs(b.volume()/b.restVolume-1)<.03);
});

test('best-fit pose recovers known rotations including exact upside-down placement',()=>{
  for(const angle of [.83,Math.PI]){
    const b=new SoftBody(rectangle(),1.2,{targetParticles:120}),c=b.restCenter,co=Math.cos(angle),si=Math.sin(angle);
    for(let j=0;j<b.rest.length;j+=3){const x=b.rest[j]-c.x,y=b.rest[j+1]-c.y,z=b.rest[j+2]-c.z;b.positions.set([x+3,co*y-si*z+4,si*y+co*z-2],j)}
    const q=b.getPose().quaternion;
    near(Math.abs(q.x),Math.abs(Math.sin(angle/2)),1e-7);near(Math.abs(q.w),Math.abs(Math.cos(angle/2)),1e-7);
    const world={x:3.6,y:4+co*.2-si*.4,z:-2+si*.2+co*.4},rest=b.worldToRest(world);
    near(rest.x,c.x+.6,1e-7);near(rest.y,c.y+.2,1e-7);near(rest.z,c.z+.4,1e-7);
  }
});

test('split initialization preserves current deformation and velocity instead of resetting pose',()=>{
  const parent=new SoftBody(rectangle(),1.2,{targetParticles:180});
  for(let j=0;j<parent.rest.length;j+=3){const x=parent.rest[j],y=parent.rest[j+1],z=parent.rest[j+2];parent.positions.set([x+2,-z+3,y+1],j);parent.velocities.set([y+1,z-2,x*.3],j)}
  const initialize=p=>{const binding=parent.sampleRest(p);return{position:parent.sample(binding),velocity:parent.sampleVelocity(binding)}};
  const children=[new SoftBody(rectangle(-2,0),1.2,{spacing:parent.spacing,initializer:initialize}),new SoftBody(rectangle(0,2),1.2,{spacing:parent.spacing,initializer:initialize})];
  near(children.reduce((sum,b)=>sum+b.restVolume,0),parent.restVolume);
  for(const child of children)for(let j=0;j<child.rest.length;j+=3){const x=child.rest[j],y=child.rest[j+1],z=child.rest[j+2];near(child.positions[j],x+2);near(child.positions[j+1],-z+3);near(child.positions[j+2],y+1);near(child.velocities[j],y+1);near(child.velocities[j+1],z-2);near(child.velocities[j+2],x*.3)}
  for(const child of children){for(let i=0;i<30;i++)child.step(1/120,{floor:-Infinity});finite(child);assert.equal(child.metrics().inverted,0)}
});

test('knife pressure is confined to its finite contact span and stays numerically stable',()=>{
  const b=new SoftBody(rectangle(),1.2,{targetParticles:240}),nearBinding=b.bindPoint(0,1.2,0),farBinding=b.bindPoint(1.8,1.2,0);
  for(let i=0;i<15;i++)b.step(1/120,{gravity:0,knife:{point:{x:0,y:.8,z:0},normal:{x:0,z:1},edgeY:.8,radius:.4,halfLength:.7}});
  assert.ok(b.sample(nearBinding).y<b.sample(farBinding).y-.1,'knife makes a localized dent');
  finite(b);assert.ok(Math.abs(b.volume()/b.restVolume-1)<.05);
});

test('rest-space material stiffness is cached and reduces stretch under the same load',()=>{
  let materialCalls=0;
  const material=new SoftBody(rectangle(-1,1,-1,1),1.2,{targetParticles:100,stiffnessAt:p=>{materialCalls++;return p.x>.25?3:1}});
  assert.equal(materialCalls,material.edgeLengths.length);
  for(let e=0;e<material.edges.length/2;e++){
    const a=material.edges[e*2]*3,b=material.edges[e*2+1]*3;
    assert.equal(material.edgeStiffness[e],(material.rest[a]+material.rest[b])/2>.25?3:1);
  }
  material.translate({x:10,y:4,z:0});material.step(1/120);
  assert.equal(materialCalls,material.edgeLengths.length,'a world-space move must not resample the material property');
  const extension=[];
  for(const stiffness of [1,3]){
    const b=new SoftBody(rectangle(-1,1,-1,1),1.2,{targetParticles:160,stiffnessAt:()=>stiffness});
    for(let i=0;i<b.count;i++)if(b.rest[i*3]<-.999)b.invMass[i]=0;
    for(let i=0;i<120;i++)b.step(1/120,{gravity:{x:12,y:0,z:0},firmness:0,floor:-Infinity,damping:.8});
    extension.push(b.sample(b.bindPoint(1,.6,0)).x-1);
    finite(b);assert.equal(b.metrics().inverted,0);
  }
  assert.ok(extension[0]>.005,'the applied load measurably stretches the material');
  assert.ok(extension[1]<extension[0]*.7,'three-times-stiffer material resists the same load more strongly');
});

test('persistent rounded-surface bindings survive a large lifted grab with a half-turn twist',()=>{
  const b=new SoftBody(rectangle(),1.2,{targetParticles:240}),bindings=[];
  for(let x=-2;x<=2;x+=.5)for(let z=-1.5;z<=1.5;z+=.5)bindings.push(b.bindPoint(x,1.3,z));
  const grab=b.createGrab({x:1.7,y:1.2,z:0},{radius:.8});
  for(let i=0;i<180;i++){
    const t=Math.min(1,i/120),angle=t*Math.PI;
    grab.target={x:1.7+t*2.2,y:1.2+t*3.4,z:Math.sin(i/40)};
    grab.rotation={x:Math.sin(angle/2),y:0,z:0,w:Math.cos(angle/2)};
    b.step(1/120,{grab,firmness:.15});
  }
  finite(b);
  assert.ok(Math.abs(b.getPose().quaternion.x)>.6,'twisting a held patch rotates the freely suspended body');
  assert.equal(b.metrics().inverted,0);assert.ok(Math.abs(b.volume()/b.restVolume-1)<.025);
  const center=b.center();let radius=0;
  for(let j=0;j<b.positions.length;j+=3)radius=Math.max(radius,Math.hypot(b.positions[j]-center.x,b.positions[j+1]-center.y,b.positions[j+2]-center.z));
  for(const binding of bindings){const point=b.sample(binding);assert.ok(Number.isFinite(point.x+point.y+point.z));assert.ok(distance(point,center)<radius+b.spacing*2,'rounding overhangs remain near their deformed material without rebinding')}
});
