import test from 'node:test';
import assert from 'node:assert/strict';
import {area,centroid,splitPolygon,contains,overlapSAT,bladeCrossing,splitPolygonByBlade,worldPointToLocal,localPointToWorld,splitPolygonByWorldBlade} from '../src/geometry.js';
const square=[{x:-2,z:-2},{x:2,z:-2},{x:2,z:2},{x:-2,z:2}];
test('cuts conserve area and produce usable independently centered pieces',()=>{const parts=splitPolygon(square,{x:.4,z:0},{x:1,z:0});assert.equal(parts.length,2);assert.ok(Math.abs(parts.reduce((s,p)=>s+area(p),0)-16)<1e-9);assert.ok(centroid(parts[0]).x>.4);assert.ok(centroid(parts[1]).x<.4)});
test('a diagonal through existing corners does not duplicate vertices',()=>{const parts=splitPolygon(square,{x:0,z:0},{x:Math.SQRT1_2,z:Math.SQRT1_2});assert.equal(parts[0].length,3);assert.equal(parts[1].length,3);assert.equal(area(parts[0]),8)});
test('tangent cuts and tiny slivers are rejected',()=>{assert.equal(splitPolygon(square,{x:2,z:0},{x:1,z:0}),null);assert.equal(splitPolygon(square,{x:1.99,z:0},{x:1,z:0}),null);assert.equal(splitPolygon(square,{x:3,z:0},{x:1,z:0}),null)});
test('a fruit supports repeated angled cuts without losing mass or convexity',()=>{const fruit=[{x:0,z:0},...Array.from({length:41},(_,i)=>({x:3.48*Math.cos(.1+(Math.PI-.2)*i/40),z:3.48*Math.sin(.1+(Math.PI-.2)*i/40)}))];let pieces=[fruit];for(let i=0;i<30;i++){let index=pieces.reduce((best,p,j)=>area(p)>area(pieces[best])?j:best,0);const poly=pieces[index],c=centroid(poly),angle=i*1.731;const cut=splitPolygon(poly,c,{x:Math.cos(angle),z:Math.sin(angle)},.1);if(cut)pieces.splice(index,1,...cut)}assert.ok(pieces.length>20);assert.ok(Math.abs(pieces.reduce((s,p)=>s+area(p),0)-area(fruit))<1e-7);for(const p of pieces){assert.ok(contains(p,centroid(p)));for(const q of p)assert.ok(Number.isFinite(q.x)&&Number.isFinite(q.z))}});
test('SAT separates overlaps and leaves distant pieces alone',()=>{const shifted=square.map(p=>({x:p.x+3,z:p.z}));const hit=overlapSAT(square,shifted);assert.ok(hit);assert.equal(hit.depth,1);assert.equal(hit.normal.x,1);assert.equal(overlapSAT(square,square.map(p=>({x:p.x+5,z:p.z}))),null)});

test('a finite blade must reach both sides before it can divide a fruit',()=>{
  assert.equal(splitPolygonByBlade(square,{x:-1,z:0},{x:1,z:0}),null,'a short blade inside the fruit cannot sever the whole fruit');
  assert.equal(splitPolygonByBlade(square,{x:-3,z:0},{x:1.9,z:0}),null,'a blade entering only one side cannot sever the whole fruit');
  assert.equal(splitPolygonByBlade(square,{x:3,z:0},{x:6,z:0}),null,'a remote blade cannot cut with its infinite extension');
  const parts=splitPolygonByBlade(square,{x:-2,z:0},{x:2,z:0});
  assert.equal(parts.length,2);assert.equal(area(parts[0]),8);assert.equal(area(parts[1]),8);
  const crossing=bladeCrossing(square,{x:-3,z:0},{x:3,z:0});
  assert.deepEqual(crossing.entry,{x:-2,z:0});assert.deepEqual(crossing.exit,{x:2,z:0});
});

test('finite blades reject tangents and zero strokes while allowing a cut through corners',()=>{
  assert.equal(bladeCrossing(square,{x:-3,z:2},{x:3,z:2}),null,'an edge touch is not a cut');
  assert.equal(bladeCrossing(square,{x:-3,z:1},{x:-1,z:3}),null,'a single corner touch is not a cut');
  assert.equal(bladeCrossing(square,{x:0,z:0},{x:0,z:0}),null,'a click has no blade direction');
  const parts=splitPolygonByBlade(square,{x:-2,z:-2},{x:2,z:2});
  assert.equal(parts.length,2);assert.ok(parts.every(p=>p.length===3&&area(p)===8));
  assert.equal(splitPolygonByBlade(square,{x:-3,z:1.99},{x:3,z:1.99}),null,'minimum fragment area still applies');
});

test('world strokes cut the same material after translation and rotation about its retained centroid',()=>{
  const polygon=square.map(p=>({x:p.x+4,z:p.z-3}));
  const pose={position:{x:-7,z:5},angle:1.173,center:centroid(polygon)};
  const localStart={x:1,z:-2.6},localEnd={x:7,z:-2.6};
  const start=localPointToWorld(localStart,pose),end=localPointToWorld(localEnd,pose);
  const roundTrip=worldPointToLocal(start,pose);
  assert.ok(Math.hypot(roundTrip.x-localStart.x,roundTrip.z-localStart.z)<1e-10);
  const parts=splitPolygonByWorldBlade(polygon,start,end,pose);
  assert.equal(parts.length,2);assert.ok(Math.abs(parts.reduce((s,p)=>s+area(p),0)-16)<1e-9);
  assert.ok(Math.abs(Math.min(...parts.map(area))-6.4)<1e-9);
  const shortEnd=localPointToWorld({x:5.9,z:-2.6},pose);
  assert.equal(splitPolygonByWorldBlade(polygon,start,shortEnd,pose),null);
});

test('contained polygons receive enough SAT displacement to stop intersecting',()=>{
  const inner=[{x:.5,z:-.5},{x:1.5,z:-.5},{x:1.5,z:.5},{x:.5,z:.5}];
  const hit=overlapSAT(square,inner);
  assert.equal(hit.depth,1.5);assert.equal(hit.normal.x,1);
  const escaped=inner.map(p=>({x:p.x+hit.normal.x*hit.depth,z:p.z+hit.normal.z*hit.depth}));
  assert.equal(overlapSAT(square,escaped),null,'one full reported displacement must remove the overlap');
  const swapped=overlapSAT(inner,square);
  assert.equal(swapped.depth,hit.depth);assert.equal(swapped.normal.x,-1);
});
