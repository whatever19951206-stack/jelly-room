import test from 'node:test';
import assert from 'node:assert/strict';
import {area,clip,splitPolygon} from '../src/geometry.js';
import {CHAPTERS,ORDERS,ACHIEVEMENTS,CAMPAIGN_EXPECTED_SECONDS,getOrder,evaluateOrder,generateOrder,defaultProfile,sanitizeProfile,loadProfile,saveProfile,completeOrder,recordGeneratedResult,isUnlocked,nextOrderId,polygonCircleArea,rindFraction,STORAGE_KEY} from '../src/progression.js';

const clone=value=>JSON.parse(JSON.stringify(value));
// These are the actual game's material outlines, not arbitrary ideal masses.
function recipe(flavor,scale=1){
  let polygon;
  if(flavor==='melon')polygon=[{x:0,z:-2.1},...Array.from({length:41},(_,i)=>{const angle=.74+(Math.PI-1.48)*i/40;return {x:Math.cos(angle)*4.25,z:Math.sin(angle)*4.25-2.1}})];
  else if(flavor==='citrus')polygon=Array.from({length:56},(_,i)=>({x:Math.cos(i/56*Math.PI*2)*3.05,z:Math.sin(i/56*Math.PI*2)*2.66}));
  else{polygon=[];for(let j=0;j<4;j++){const a0=-Math.PI/2+j*Math.PI/2,cx=j===0||j===1?1.5:-1.5,cz=j<2?(j===0?-1.5:1.5):(j===2?1.5:-1.5);for(let i=0;i<=10;i++){const a=a0+i/10*Math.PI/2;polygon.push({x:cx+Math.cos(a)*1.04,z:cz+Math.sin(a)*1.04})}}}
  return polygon.map(point=>({x:point.x*scale,z:point.z*scale}));
}
function takeMass(polygon,mass,axis){
  // geometry.js deliberately merges vertices within 1e-7; finishing the last
  // piece at that precision must not request a spurious microscopic extra cut.
  if(Math.abs(area(polygon)-mass)<1e-6)return {piece:polygon,remaining:null};
  let low=Math.min(...polygon.map(p=>p[axis])),high=Math.max(...polygon.map(p=>p[axis]));
  const normal=axis==='x'?{x:1,z:0}:{x:0,z:1};
  for(let i=0;i<65;i++){const boundary=(low+high)/2,point=axis==='x'?{x:boundary,z:0}:{x:0,z:boundary},part=clip(polygon,point,normal,-1);if(area(part)<mass)low=boundary;else high=boundary}
  const boundary=(low+high)/2,point=axis==='x'?{x:boundary,z:0}:{x:0,z:boundary};
  const parts=splitPolygon(polygon,point,normal,1e-9);assert.ok(parts,'solution must be an actual straight cut');
  return {piece:parts[1],remaining:parts[0]};
}
function geometricSolution(order){
  const pieces=[],flavorMasses={};let cuts=0,id=0;
  for(const source of order.source){
    const original=recipe(source.flavor,source.scale);flavorMasses[source.flavor]=area(original);
    const slots=order.slots.filter(slot=>slot.flavor===source.flavor);
    const axis=slots.some(slot=>slot.rindMin!==undefined||slot.rindMax!==undefined)?'z':'x';
    let remaining=original;
    // A first diameter and its perpendicular cross BOTH halves in two strokes.
    const quadrants=order.id==='order-10'?splitPolygon(original,{x:0,z:0},{x:1,z:0}).flatMap(half=>splitPolygon(half,{x:0,z:0},{x:0,z:1})):null;
    for(let i=0;i<slots.length;i++){
      const slot=slots[i];let polygon;
      if(quadrants){polygon=quadrants[i];remaining=null}
      else{const result=takeMass(remaining,flavorMasses[source.flavor]*slot.share/100,axis);polygon=result.piece;remaining=result.remaining;if(remaining)cuts++}
      pieces.push({id:++id,flavor:source.flavor,mass:area(polygon),polygon,rindFraction:rindFraction(polygon,source.flavor,source.scale),slot:slot.id,settled:true,height:.65,speed:0,position:{...slot.position},tossed:!!(slot.tossRequired||slot.tossBonus)});
    }
    if(quadrants)cuts+=2;
    if(remaining)pieces.push({id:++id,flavor:source.flavor,mass:area(remaining),polygon:remaining,rindFraction:rindFraction(remaining,source.flavor,source.scale),slot:null,settled:true,height:.65,speed:0});
  }
  return {pieces,cuts,elapsed:order.parSeconds,totalMass:Object.values(flavorMasses).reduce((a,b)=>a+b,0),flavorMasses};
}

test('campaign has 24 distinct orders, six chapters and estimates without time gates',()=>{
  assert.equal(ORDERS.length,24);assert.equal(CHAPTERS.length,6);assert.equal(new Set(ORDERS.map(o=>o.id)).size,24);
  for(const chapter of CHAPTERS)assert.equal(ORDERS.filter(order=>order.chapter===chapter.id).length,4);
  assert.ok(CAMPAIGN_EXPECTED_SECONDS>=1800);
  assert.ok(ORDERS.every(order=>order.expectedSeconds>=60&&!order.minimumSeconds),'expected durations do not impose a waiting gate');
  assert.ok(ORDERS.slice(0,20).every(order=>order.source.length===1));assert.ok(ORDERS.slice(20).every(order=>order.source.length===2));
  assert.ok(ORDERS.some(order=>order.slots.some(slot=>slot.rindMin)));assert.ok(ORDERS.some(order=>order.arrangement));
  assert.ok(ORDERS.some(order=>order.cutBudget<order.slots.length-1));
});

for(const order of ORDERS)test(`${order.id} ${order.title}: physically realizable straight-cut solution earns three stars`,()=>{
  const snapshot=geometricSolution(order),result=evaluateOrder(order,snapshot);
  assert.ok(snapshot.cuts<=order.cutBudget,'ideal geometry must obey the actual cut budget');
  assert.ok(Math.abs(snapshot.pieces.reduce((sum,p)=>sum+p.mass,0)-snapshot.totalMass)<1e-7,'solution must conserve material');
  assert.equal(result.passed,true,JSON.stringify(result.checks.filter(check=>!check.optional&&!check.passed),null,2));
  assert.equal(result.stars,3);assert.ok(result.accuracy>99.999);assert.ok(result.score>=999);
});

test('circle/polygon intersection is exact for containment, half circles and tangency',()=>{
  const square=[{x:-2,z:-2},{x:2,z:-2},{x:2,z:2},{x:-2,z:2}];
  assert.ok(Math.abs(polygonCircleArea(square,{x:0,z:0},1)-Math.PI)<1e-12);
  assert.ok(Math.abs(polygonCircleArea(square,{x:0,z:0},5)-16)<1e-12);
  const upper=[{x:-2,z:0},{x:2,z:0},{x:2,z:2},{x:-2,z:2}];
  assert.ok(Math.abs(polygonCircleArea(upper,{x:0,z:0},1)-Math.PI/2)<1e-12);
  assert.ok(Math.abs(polygonCircleArea([...upper].reverse(),{x:0,z:0},1)-Math.PI/2)<1e-12);
  const tangent=[{x:1,z:-2},{x:2,z:-2},{x:2,z:2},{x:1,z:2}];assert.ok(polygonCircleArea(tangent,{x:0,z:0},1)<1e-12);
  const shifted=square.map(p=>({x:p.x+20,z:p.z-15}));assert.ok(Math.abs(polygonCircleArea(shifted,{x:20,z:-15},1)-Math.PI)<1e-12);
});

test('rind classification conserves material and survives source scaling',()=>{
  for(const flavor of ['melon','citrus','grape']){
    const poly=recipe(flavor),parts=splitPolygon(poly,{x:.2,z:0},{x:1,z:0}),rind=rindFraction(poly,flavor),rindMass=parts.reduce((sum,p)=>sum+area(p)*rindFraction(p,flavor),0);
    assert.ok(Math.abs(rindMass-area(poly)*rind)<1e-8);
    assert.ok(Math.abs(rindFraction(recipe(flavor,.58),flavor,.58)-rind)<1e-10);
  }
  assert.ok(rindFraction(recipe('melon'),'melon')>.20&&rindFraction(recipe('melon'),'melon')<.24);
});

test('actual mass controls scoring, supplied share labels cannot fake a pass',()=>{
  const order=ORDERS[0],s=geometricSolution(order),mass=s.totalMass;
  s.pieces[0].mass=mass*.2;s.pieces[1].mass=mass*.8;s.pieces.forEach(p=>p.share=50);
  const result=evaluateOrder(order,s);assert.equal(result.passed,false);assert.equal(result.stars,0);assert.ok(result.checks.some(c=>c.id.endsWith(':share')&&!c.passed));
});

test('serve rejects empty, duplicated, airborne, moving, misplaced and fabricated pieces',()=>{
  const order=ORDERS[0],baseline=geometricSolution(order);
  const mutations=[
    s=>s.pieces[0].slot=null,
    s=>s.pieces[1].slot=s.pieces[0].slot,
    s=>s.pieces[1].id=s.pieces[0].id,
    s=>s.pieces[0].settled=false,
    s=>s.pieces[0].height=8,
    s=>s.pieces[0].speed=3,
    s=>s.pieces[0].mass=NaN,
    s=>s.pieces[0].mass=s.totalMass,
    s=>s.pieces[0].flavor='grape',
    s=>s.pieces[0].slot='imaginary-plate',
    s=>s.cuts=order.cutBudget+1,
    s=>s.elapsed=-1
  ];
  for(const mutate of mutations){const s=clone(baseline);mutate(s);assert.equal(evaluateOrder(order,s).passed,false,mutate.toString())}
});

test('mixed shares use each flavor denominator and wrong flavors cannot impersonate equal weights',()=>{
  const order=getOrder('order-21'),s=geometricSolution(order);
  assert.ok(Math.abs(s.flavorMasses.melon-s.flavorMasses.citrus)>.1);
  assert.equal(evaluateOrder(order,s).passed,true);
  const missingLedger=clone(s);delete missingLedger.flavorMasses;assert.equal(evaluateOrder(order,missingLedger).passed,false);
  const wrong=clone(s);[wrong.pieces[0].slot,wrong.pieces[2].slot]=[wrong.pieces[2].slot,wrong.pieces[0].slot];assert.equal(evaluateOrder(order,wrong).passed,false);
});

test('broad one-star tolerance and tighter two/three-star standards are fair and distinct',()=>{
  const order=ORDERS[0],baseline=geometricSolution(order);
  for(const [share,stars] of [[42,1],[46,2],[49,3]]){const s=clone(baseline);s.pieces[0].mass=s.totalMass*share/100;s.pieces[1].mass=s.totalMass*(100-share)/100;assert.equal(evaluateOrder(order,s).stars,stars)}
  const over=clone(baseline);over.pieces[0].mass=over.totalMass*.40;over.pieces[1].mass=over.totalMass*.60;assert.equal(evaluateOrder(order,over).passed,false);
  const slower=clone(baseline);slower.elapsed=5000;assert.equal(evaluateOrder(order,slower).stars,3,'campaign time adds points, never forces rushing');
  const extraCut=clone(baseline);extraCut.cuts=2;assert.equal(evaluateOrder(order,extraCut).stars,2);
});

test('rind, arrangement and optional toss have real independent consequences',()=>{
  const rindOrder=getOrder('order-14'),rind=geometricSolution(rindOrder);rind.pieces[1].rindFraction=0;assert.equal(evaluateOrder(rindOrder,rind).passed,false);
  const plateOrder=getOrder('order-17'),plate=geometricSolution(plateOrder);plate.pieces[0].position.x+=1;assert.equal(evaluateOrder(plateOrder,plate).passed,false);
  const tossOrder=getOrder('order-19'),toss=geometricSolution(tossOrder);toss.pieces.forEach(p=>p.tossed=false);let result=evaluateOrder(tossOrder,toss);assert.equal(result.passed,true);assert.equal(result.tossBonus,0);
  toss.pieces[0].tossed=true;result=evaluateOrder(tossOrder,toss);assert.equal(result.passed,true);assert.equal(result.tossBonus,25);
});

test('numeric slot indices are supported but a selected piece still must physically settle',()=>{
  const order=ORDERS[0],s=geometricSolution(order);s.pieces.forEach((piece,index)=>piece.slot=index);
  assert.equal(evaluateOrder(order,s).passed,true);delete s.pieces[0].settled;assert.equal(evaluateOrder(order,s).passed,false);
});

test('seeded practice and challenge orders are reproducible, varied and geometrically solvable',()=>{
  const signatures=new Set();
  for(let i=0;i<40;i++)for(const mode of ['practice','challenge']){
    const order=generateOrder(`customer-${i}`,{mode,difficulty:1+i%12});assert.deepEqual(order,generateOrder(`customer-${i}`,{mode,difficulty:1+i%12}));
    signatures.add(JSON.stringify([order.flavor,order.slots.map(s=>s.share),order.arrangement]));
    assert.equal(evaluateOrder(order,geometricSolution(order)).passed,true,order.id);
    if(mode==='challenge'){const s=geometricSolution(order);s.elapsed=order.timeLimit+1;assert.equal(evaluateOrder(order,s).passed,false)}
  }
  assert.ok(signatures.size>40,'replay content must vary more than its title');
});

test('campaign unlocks only the next order and replay never erases earned stars or records',()=>{
  let profile=defaultProfile();assert.equal(isUnlocked(profile,'order-01'),true);assert.equal(isUnlocked(profile,'order-02'),false);
  const result=evaluateOrder(ORDERS[0],geometricSolution(ORDERS[0]));
  profile=completeOrder(profile,'order-24',result);assert.equal(Object.keys(profile.completed).length,0,'a locked final cannot be completed');
  profile=completeOrder(profile,'order-01',result);assert.equal(isUnlocked(profile,'order-02'),true);assert.equal(isUnlocked(profile,'order-03'),false);assert.equal(nextOrderId(profile),'order-02');
  profile=completeOrder(profile,'order-01',{...result,stars:1,score:400,elapsed:400,accuracy:50});
  assert.equal(profile.completed['order-01'].stars,3);assert.equal(profile.completed['order-01'].score,1000);assert.equal(profile.completed['order-01'].bestSeconds,ORDERS[0].parSeconds);assert.equal(profile.completed['order-01'].plays,2);
  const before=clone(profile);profile=completeOrder(profile,'order-02',{...result,passed:false,stars:0});assert.deepEqual(profile,before);
});

test('all campaign achievements are attainable, generated scores and failure streaks persist correctly',()=>{
  let profile=defaultProfile();
  for(const order of ORDERS)profile=completeOrder(profile,order.id,evaluateOrder(order,geometricSolution(order)));
  assert.equal(Object.keys(profile.completed).length,24);assert.ok(profile.achievements.includes('graduate'));assert.ok(profile.achievements.includes('sixty-stars'));assert.ok(profile.achievements.includes('soft-landing'));
  for(let i=0;i<10;i++){const order=generateOrder(i);profile=recordGeneratedResult(profile,order,evaluateOrder(order,geometricSolution(order)))}
  for(let i=0;i<5;i++){const order=generateOrder(i,{mode:'challenge'});profile=recordGeneratedResult(profile,order,evaluateOrder(order,geometricSolution(order)),{streak:i})}
  assert.equal(profile.practice.completed,10);assert.equal(profile.challenge.bestStreak,5);assert.ok(ACHIEVEMENTS.every(a=>profile.achievements.includes(a.id)));
  profile=recordGeneratedResult(profile,generateOrder(9,{mode:'challenge'}),{passed:false},{streak:5});assert.equal(profile.resume.streak,0);assert.equal(profile.challenge.bestStreak,5);
});

test('storage restores resume and high scores; corrupt or unavailable storage has a safe fallback',()=>{
  const store=new Map(),storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  let profile=completeOrder(defaultProfile(),ORDERS[0].id,evaluateOrder(ORDERS[0],geometricSolution(ORDERS[0])));profile.resume={mode:'practice',orderId:'order-02',seed:'same-seed',streak:0};
  assert.equal(saveProfile(profile,storage),true);assert.deepEqual(loadProfile(storage),sanitizeProfile(profile));
  store.set(STORAGE_KEY,'{broken');assert.deepEqual(loadProfile(storage),defaultProfile());
  const unavailable={getItem(){throw Error('blocked')},setItem(){throw Error('quota')}};assert.deepEqual(loadProfile(unavailable),defaultProfile());assert.equal(saveProfile(profile,unavailable),false);
  const bad=sanitizeProfile({completed:{'order-01':{stars:99},'order-24':{stars:3}},selectedOrderId:'order-24',practice:{completed:-3,bestScore:Infinity},achievements:['fake']});
  assert.equal(bad.selectedOrderId,'order-01');assert.equal(isUnlocked(bad,'order-24'),false);assert.equal(bad.practice.completed,0);assert.equal(bad.practice.bestScore,0);assert.ok(!bad.achievements.includes('fake'));
});
