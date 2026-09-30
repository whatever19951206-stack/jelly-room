/* Fruit Merge acceptance uses real mouse/keyboard/CDP touch input.
 * Read-only debug snapshots plan drops; no browser model is seeded or modified.
 * Headless blur/visibility cases are explicitly reported as lifecycle emulation.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {launchBrowser,localGameURL,serverGameURL}=require('./browser-runtime.cjs');

const gameURL=process.env.GAME_URL?serverGameURL:localGameURL();
const state=page=>page.evaluate(()=>window.__fruitMerge.state);
const shopState=page=>page.evaluate(()=>window.__jelly.state);
const preliminary=process.env.FRUIT_PRELIMINARY==='1';
const skipOverflow=preliminary||process.env.FRUIT_SKIP_OVER==='1';
const bundlePath=process.env.GAME_FILE?path.resolve(process.env.GAME_FILE):path.resolve('index.html');
const report={generatedAt:new Date().toISOString(),gameURL,localBundleSha256:crypto.createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex'),modelSha256:crypto.createHash('sha256').update(fs.readFileSync('src/fruit-merge-model.js')).digest('hex'),preliminary,overflowPending:skipOverflow,results:[],errors:[]};
const save=()=>fs.writeFileSync('qa/fruit-merge-browser.json',JSON.stringify(report,null,2)+'\n');
const stable=s=>({status:s.status,bodies:s.bodies,score:s.score,merges:s.merges,watermelons:s.watermelons,currentLevel:s.currentLevel,nextLevel:s.nextLevel,aimX:s.aimX,dropCooldown:s.dropCooldown,overflowTime:s.overflowTime,elapsed:s.elapsed,drops:s.drops});

async function tap(page,selector,touch=false){if(touch)await page.locator(selector).tap();else await page.locator(selector).click();}
async function enter(page,expected='ready',touch=false){
 await tap(page,'[data-action="fruitMerge"]',touch);
 await page.waitForFunction(()=>window.__fruitMerge?.state.activeMode===true&&window.__fruitMerge.state.render?.ready);
 assert.equal((await state(page)).status,expected);
}
async function start(page,touch=false){
 await tap(page,'#fm-start',touch);
 await page.waitForFunction(()=>window.__fruitMerge.state.status==='playing');
 const s=await state(page);assert.equal(s.bodies.length,0);assert.equal(s.score,0);assert.equal(s.merges,0);return s;
}
async function readyToDrop(page){
 await page.waitForFunction(()=>{const s=window.__fruitMerge.state;return s.status==='over'||s.status==='playing'&&s.canDrop;},null,{timeout:20000});
 return state(page);
}
async function projected(page,x,y=8){
 const p=await page.evaluate(({x,y})=>window.__fruitMerge.project(x,y),{x,y});
 assert.ok(Number.isFinite(p?.x)&&Number.isFinite(p?.y),'read-only projection returns a real canvas coordinate');
 const r=await page.locator('#fm-canvas').boundingBox();
 assert.ok(p.x>r.x&&p.x<r.x+r.width&&p.y>r.y&&p.y<r.y+r.height,'aim coordinate must be inside canvas');
 return p;
}
async function mouseDrop(page,x){
 const before=await readyToDrop(page);assert.equal(before.status,'playing');
 const p=await projected(page,x);
 await page.mouse.move(p.x,p.y);
 const aiming=await state(page);
 if(aiming.status==='over')return{before,after:aiming,terminal:true};
 assert.ok(Math.abs(aiming.aimX-x)<.12||aiming.aimX<=.85||aiming.aimX>=9.15,'mouse position aims at the requested world location or physical wall clamp');
 await page.mouse.down();await page.mouse.up();
 await page.waitForFunction(({drops,ids})=>{const s=window.__fruitMerge.state;return s.status==='over'||s.dropCooldown>0||s.drops>drops||s.bodies.some(b=>!ids.includes(b.id));},{drops:before.drops??-1,ids:before.bodies.map(b=>b.id)});
 const after=await state(page);
 if(after.status==='over'&&after.drops===before.drops)return{before,after,terminal:true};
 if(before.drops!==undefined)assert.equal(after.drops,before.drops+1,'one pointer release must produce exactly one fruit');
 return {before,after};
}
async function touchDrop(page,cdp,fromX,toX){
 const before=await readyToDrop(page);assert.equal(before.status,'playing');
 const from=await projected(page,fromX),to=await projected(page,toX);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
 assert.equal((await state(page)).bodies.length,before.bodies.length,'pressing fruit glass only starts aiming');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...to,id:1}]});
 const aiming=await state(page);assert.ok(Math.abs(aiming.aimX-toX)<.12||aiming.aimX<=.85||aiming.aimX>=9.15,'touch drag moves real aim');
 if(before.drops!==undefined)assert.equal(aiming.drops,before.drops,'drag must not drop before release');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const after=await state(page);
 if(before.drops!==undefined)assert.equal(after.drops,before.drops+1,'touch release drops once');
 else assert.ok(after.dropCooldown>0,'touch release starts drop cooldown');
 return {before,after};
}
async function touchPauseAcrossCooldown(page,cdp){
 const before=await state(page),icon=await page.locator('#fm-pause svg').elementHandle();
 assert.ok(before.dropCooldown>0,'pause regression begins during a real dropped slice cooldown');
 const button=await page.locator('#fm-pause').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:button.x+button.width/2,y:button.y+button.height/2,id:3}]});
 await waitSimulation(page,.65);
 assert.equal(await icon.evaluate(node=>node.isConnected),true,'cooldown HUD updates retain the touched pause icon');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>window.__fruitMerge.state.status==='paused');
 await tap(page,'#fm-resume',true);await page.waitForFunction(()=>window.__fruitMerge.state.status==='playing');
 await icon.dispose();
 return{realTouch:true,crossedCooldown:true,pausedOnRelease:true};
}
async function inspectLayout(page){
 const selectors=['#fm-canvas','#fm-left','#fm-right','#fm-drop','#fm-sound','#fm-pause','#fm-restart-top','#fm-exit'];
 const controls=await page.evaluate(selectors=>selectors.map(selector=>{
  const e=document.querySelector(selector);if(!e)return{selector,missing:true};
  const r=e.getBoundingClientRect(),css=getComputedStyle(e),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return{selector,width:r.width,height:r.height,visible:css.display!=='none'&&css.visibility!=='hidden'&&r.width>0&&r.height>0,withinViewport:r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,receivesPointer:hit===e||e.contains(hit),hit:hit?.id||hit?.className};
 }),selectors);
 for(const c of controls){
  assert.ok(!c.missing&&c.visible,`${c.selector} visible`);
  assert.ok(c.withinViewport,`${c.selector} in viewport: ${JSON.stringify(c)}`);
  assert.ok(c.receivesPointer,`${c.selector} receives input: ${JSON.stringify(c)}`);
  if(c.selector!=='#fm-canvas')assert.ok(c.width>=30&&c.height>=30,`${c.selector} usable touch target`);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal overflow');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+1),false,'game fits height');
 const render=(await state(page)).render;
 assert.ok(render.ready&&render.frames>0&&render.fruits>0,'3D renderer draws actual fruits');
 return{controls,render};
}
function chooseAim(s,index){
 const same=s.bodies.filter(b=>b.level===s.currentLevel&&b.y+b.radius<11.5).sort((a,b)=>a.y-b.y);
 if(same.length)return same[0].x;
 const options=[.95,2.35,3.75,5.15,6.55,7.95,9.05];
 const occupied=x=>Math.max(0,...s.bodies.filter(b=>Math.abs(b.x-x)<b.radius+.83).map(b=>b.y+b.radius));
 return options.map((x,i)=>({x,h:occupied(x),tie:(i-index%options.length+options.length)%options.length})).sort((a,b)=>a.h-b.h||a.tie-b.tie)[0].x;
}
// Explore hypothetical placements in an isolated model, then execute the chosen
// placement through actual browser input. The real game's state remains read-only.
function planOverflow(s,FruitMergeModel,FRUITS,bodyBounds){
 const radius=FRUITS[s.currentLevel].radius;
 const positions=Array.from({length:5},(_,i)=>radius+.03+(10-2*radius-.06)*i/4);
 let best={quality:-Infinity,x:5};
 for(const x of positions){
  const candidate=new FruitMergeModel({random:()=>.5});
  candidate.status='playing';candidate.currentLevel=s.currentLevel;candidate.nextLevel=s.nextLevel;
  candidate.bodies=s.bodies.map(body=>structuredClone(body));candidate._nextId=Math.max(0,...candidate.bodies.map(body=>body.id))+1;
  candidate.elapsed=s.elapsed;candidate.overflowTime=s.overflowTime;candidate.dropCooldown=0;candidate.merges=s.merges;
  const landing=candidate.getLandingY(x);
  if(!candidate.drop(x))continue;
  for(let f=0;f<24;f++)candidate.tick(.05);
  const height=Math.max(...candidate.bodies.map(body=>bodyBounds(body).maxY));
  // Stack against real hulls. Avoid a matching slice immediately consuming the
  // new piece so the danger-line case is reached through ordinary input sooner.
  const quality=(candidate.status==='over'?1e5:0)+candidate.overflowTime*50+height*10+landing*3-(candidate.merges-s.merges)*100;
  if(quality>best.quality)best={quality,x};
 }
 return best.x;
}
async function waitSimulation(page,seconds){
 const before=await state(page);
 await page.waitForFunction(({elapsed,seconds})=>{const s=window.__fruitMerge.state;return s.status==='over'||s.elapsed>=elapsed+seconds;},{elapsed:before.elapsed,seconds},{timeout:20000});
}
async function playForMerges(page,{touch=false,cdp=null,viewport,maxDrops=45,targetMerges=4}={}){
 const drops=[];let maxIndent=0,maxDeformations=0,maxVertexDisplacement=0,screenshotSaved=false;
 const wallStart=Date.now(),frameStart=(await state(page)).render.frames;
 for(let i=0;i<maxDrops;i++){
  const s=await readyToDrop(page);if(s.status!=='playing')break;
  const x=chooseAim(s,i);
  const drop=touch?await touchDrop(page,cdp,5,x):await mouseDrop(page,x);
  const targetElapsed=drop.after.elapsed+1.7;
  const sampleDeadline=Date.now()+20000;
  // Sample real contact deformation while the new fruit lands. Capture geometry at contact.
  while((await state(page)).status==='playing'&&(await state(page)).elapsed<targetElapsed){
   assert.ok(Date.now()<sampleDeadline,'real fruit simulation continues while sampling contact');
   const sample=await state(page),liveDeformations=sample.render.deformationBodies||sample.render.deformations;
   const indent=Array.isArray(liveDeformations)?Math.max(0,...liveDeformations.map(d=>d.indent)):Number(sample.render.maxIndent)||0;
   const deformations=Array.isArray(sample.render.deformations)?sample.render.deformations.filter(d=>d.indent>.001).length:Number(sample.render.deformations)||0;
   maxDeformations=Math.max(maxDeformations,deformations);
   if(sample.render.deformationBodies)maxVertexDisplacement=Math.max(maxVertexDisplacement,...sample.render.deformationBodies.map(d=>d.indent));
   maxIndent=Math.max(maxIndent,indent);
   if(!touch&&indent>.08&&!screenshotSaved&&sample.bodies.length>=3){
    await page.screenshot({path:'qa/fruit-merge-contact.png'});
    const left=await projected(page,.6,3.9),right=await projected(page,9.4,.1);
    await page.screenshot({path:'qa/fruit-merge-contact-detail.png',clip:{x:Math.max(0,left.x-18),y:Math.max(0,left.y-18),width:Math.min(right.x-left.x+36,viewport.width-left.x),height:Math.min(right.y-left.y+36,viewport.height-left.y)}});
    screenshotSaved=true;
   }
   await page.waitForTimeout(80);
  }
  const after=await state(page);
  drops.push({level:s.currentLevel,x,score:after.score,merges:after.merges,levels:[...new Set(after.bodies.map(b=>b.level))],bodies:after.bodies.length});
  if(after.merges>=targetMerges&&after.bodies.length>=4&&new Set(after.bodies.map(b=>b.level)).size>=3)break;
 }
 const s=await state(page);
 assert.equal(s.status,'playing','matching-drop planner keeps a real live game');
 assert.ok(s.merges>=1,`normal drops must really merge; got ${s.merges}`);
 assert.ok(s.score>0,'real merging awards points');
 assert.ok(s.highestLevel>=1,'same-level merge creates a larger fruit');
 assert.ok(s.bodies.length>=3,'actual multicolor pile is present');
 assert.ok(new Set(s.bodies.map(b=>b.level)).size>=3,'pile shows at least three real fruit varieties');
 assert.ok(maxIndent>.001,'actual collision produces local vertex indentation');
 assert.ok(maxDeformations>0,'renderer reports actual locally deformed surfaces');
 if(!preliminary)assert.ok(maxVertexDisplacement>.001,'actual local mesh vertices move, beyond whole-fruit scaling');
 const suffix=touch?`${viewport.width}x${viewport.height}`:'desktop';
 await page.screenshot({path:`qa/fruit-merge-${suffix}.png`});
 return{drops,merges:s.merges,score:s.score,highestLevel:s.highestLevel,maxIndent,maxDeformations,maxVertexDisplacement,geometryMetricPending:preliminary&&!maxVertexDisplacement,instrumentedFps:(s.render.frames-frameStart)/(Date.now()-wallStart)*1000,render:s.render};
}
async function lifecycleAndPersistence(page,touch=false){
 await tap(page,'#fm-pause',touch);await page.waitForFunction(()=>window.__fruitMerge.state.status==='paused');
 // Native pause/resume buttons remain keyboard accessible. Gameplay key checks
 // target the canvas so native button activation is not mistaken for a drop.
 await page.locator('#fm-canvas').focus();
 let before=await state(page);
 for(const key of ['ArrowLeft','ArrowRight','Space','Enter'])await page.keyboard.press(key);
 await page.waitForTimeout(850);
 assert.deepEqual(stable(await state(page)),stable(before),'pause freezes real physics and rejects gameplay');
 await tap(page,'#fm-resume',touch);await page.waitForFunction(()=>window.__fruitMerge.state.status==='playing');
 await waitSimulation(page,.15);
 await page.keyboard.down('ArrowLeft');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await page.keyboard.up('ArrowLeft');
 let after=await state(page);assert.equal(after.status,'paused');assert.deepEqual(after.heldInputs,[],'blur releases held sources');
 before=after;await page.waitForTimeout(200);assert.deepEqual(stable(await state(page)),stable(before));
 await tap(page,'#fm-resume',touch);
 await page.waitForFunction(()=>window.__fruitMerge.state.status==='playing');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 after=await state(page);assert.equal(after.status,'paused');assert.deepEqual(after.heldInputs,[]);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal((await state(page)).status,'paused','visibility return never silently resumes');
 await tap(page,'#fm-resume',touch);
 await page.waitForFunction(()=>window.__fruitMerge.state.status==='playing');
 const session=await state(page);
 await tap(page,'#fm-exit',touch);await page.waitForFunction(()=>window.__jelly.state.mode==='menu');
 after=await state(page);assert.equal(after.activeMode,false);assert.equal(after.status,'paused');
 await enter(page,'paused',touch);
 after=await state(page);assert.equal(after.score,session.score);assert.equal(after.merges,session.merges);assert.equal(after.bodies.length,session.bodies.length,'exit/re-enter preserves real session');
 await tap(page,'#fm-resume',touch);
 const best=(await state(page)).bestScore;assert.ok(best>=session.score,'best score follows played score');
 return{score:session.score,bestScore:best,lifecycleCases:'Emulated browser blur/visibility events in headless Chromium; real pause controls also checked'};
}
async function gameOver(page){
 const {FruitMergeModel,FRUITS,bodyBounds}=await import(pathToFileURL(path.resolve('src/fruit-merge-model.js')).href);
 const drops=[];let dangerSeen=false,maxFruits=0,maxDrawCalls=0;
 const wallStart=Date.now(),frameStart=(await state(page)).render.frames;
 const deadline=Date.now()+12*60*1000;
 for(let i=0;i<300;i++){
  assert.ok(Date.now()<deadline,'normal stacking reaches a terminal state within the acceptance time limit');
  let s=await state(page);if(s.status==='over')break;
  if(!s.canDrop){await waitSimulation(page,.6);s=await state(page);if(s.status==='over')break;}
  if(s.canDrop){const d=await mouseDrop(page,planOverflow(s,FruitMergeModel,FRUITS,bodyBounds));if(d.terminal)break;drops.push({level:d.before.currentLevel,score:d.after.score,bodies:d.after.bodies.length});}
  await waitSimulation(page,1.25);
  s=await state(page);dangerSeen||=s.overflowTime>0;
  maxFruits=Math.max(maxFruits,s.render.fruits);maxDrawCalls=Math.max(maxDrawCalls,s.render.drawCalls);
  if(drops.length>0&&drops.length%25===0){
   report.progress={phase:'real-input overflow stacking',drops:drops.length,score:s.score,merges:s.merges,bodies:s.bodies.length,instrumentedFps:(s.render.frames-frameStart)/(Date.now()-wallStart)*1000};save();console.log('FRUIT STACK',JSON.stringify(report.progress));
   if([25,50,75,100].includes(drops.length))await page.screenshot({path:`qa/fruit-merge-pile-${drops.length}.png`});
  }
  if(s.overflowTime>0){await waitSimulation(page,2.3);if((await state(page)).status==='over')break;}
 }
 const s=await state(page);
 assert.equal(s.status,'over','normal fruit stacking must trigger danger-line game over');
 assert.ok(dangerSeen||s.overflowTime>0,'danger timer observed before game over');
 await page.screenshot({path:'qa/fruit-merge-game-over.png'});
 await page.keyboard.press('Space');assert.deepEqual(stable(await state(page)),stable(s),'over state ignores drop key');
 await page.locator('#fm-restart').click();
 const fresh=await state(page);assert.equal(fresh.status,'playing');assert.equal(fresh.bodies.length,0);assert.equal(fresh.score,0);assert.equal(fresh.merges,0);
 return{drops,score:s.score,merges:s.merges,bestScore:s.bestScore,overflowTime:s.overflowTime,maxFruits,maxDrawCalls,instrumentedFps:(s.render.frames-frameStart)/(Date.now()-wallStart)*1000};
}
async function verifyOtherGames(page){
 await page.locator('#fm-exit').click();await page.waitForFunction(()=>window.__jelly.state.mode==='menu');
 await page.locator('[data-action="blocks"]').click();await page.locator('#jb-start').click();
 let s=await page.evaluate(()=>window.__jellyBlocks.state);const x=s.active.x;
 await page.keyboard.press('ArrowLeft');assert.equal((await page.evaluate(()=>window.__jellyBlocks.state)).active.x,x-1);
 await page.keyboard.press('Space');s=await page.evaluate(()=>window.__jellyBlocks.state);assert.equal(s.board.flat().filter(Boolean).length,4,'old blocks still receives input');
 await page.locator('#jb-exit').click();
 await page.locator('.menu-continue').click();await page.locator('[data-action="begin"]').click();await page.waitForTimeout(800);
 const shop=await shopState(page);await page.locator('#cut-tool').click();for(let i=0;i<6;i++)await page.locator('#rotate-right').click();
 const center=await page.evaluate(id=>window.__jelly.projectRest(id,0,window.__jelly.state.bodies[0].height,0),shop.bodies[0].id);
 await page.mouse.click(center.x,center.y);await page.waitForFunction(()=>window.__jelly.state.cuts===1&&!window.__jelly.state.cutting);
 assert.equal((await shopState(page)).pieces,2,'original shop cut is still functional');
 return{blocksLockedCells:4,shopCuts:1,shopPieces:2};
}
async function desktop(page,viewport){
 await enter(page);const frozenShop=await shopState(page);await page.waitForTimeout(180);
 assert.deepEqual((await shopState(page)).bodies.map(b=>b.position),frozenShop.bodies.map(b=>b.position),'shop physics is inactive behind fruit mode');
 let s=await start(page),oldAim=s.aimX;
 await page.keyboard.press('ArrowLeft');assert.ok((await state(page)).aimX<oldAim,'keyboard left aims');
 await page.keyboard.press('ArrowRight');assert.ok((await state(page)).aimX>oldAim-.2,'keyboard right aims');
 await page.keyboard.down('Space');await page.keyboard.down('Space');await page.waitForTimeout(1100);await page.keyboard.down('Space');
 s=await state(page);assert.equal(s.bodies.length,1,'held/repeated Space creates just one fruit');
 if(s.drops!==undefined)assert.equal(s.drops,1);
 await page.keyboard.up('Space');
 const evidence=await playForMerges(page,{viewport});
 const layout=await inspectLayout(page);
 const lifecycle=await lifecycleAndPersistence(page);
 const terminal=skipOverflow?{skipped:true,reason:'This controls run omits the long natural overflow session; report any prior overflow evidence separately'}:await gameOver(page);
 const best=(await state(page)).bestScore;
 await page.reload();await page.waitForFunction(()=>window.__jelly?.state.mode==='menu');await enter(page);
 assert.equal((await state(page)).bestScore,best,'reload preserves actual earned best');
 await start(page);const before=await state(page);await page.keyboard.press('Space');s=await state(page);
 if(s.drops!==undefined)assert.equal(s.drops,before.drops+1,'re-enter has no duplicated drop handler');
 else assert.equal(s.bodies.length,1);
 const otherGames=await verifyOtherGames(page);
 return{...evidence,layout,lifecycle,terminal,bestScoreAfterReload:best,otherGames};
}
async function mobile(page,viewport){
 await enter(page,'ready',true);await start(page,true);
 const cdp=await page.context().newCDPSession(page);
 try{
  await touchDrop(page,cdp,7.5,2.2);
  const nativePause=await touchPauseAcrossCooldown(page,cdp);await waitSimulation(page,.85);
  let before=await readyToDrop(page),p=await projected(page,7.5);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...await projected(page,8.5),id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  let after=await state(page);
  if(before.drops!==undefined)assert.equal(after.drops,before.drops,'touchCancel never drops');
  else assert.equal(after.bodies.length,before.bodies.length,'touchCancel never drops');
  assert.deepEqual(after.heldInputs,[],'touchCancel releases inputs');
  before=await state(page);p=await projected(page,6.5);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1},{...await projected(page,7.5),id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  after=await state(page);
  if(before.drops!==undefined)assert.equal(after.drops,before.drops,'second finger cancels gesture rather than dropping');
  else assert.equal(after.bodies.length,before.bodies.length);
  const evidence=await playForMerges(page,{touch:true,cdp,viewport,maxDrops:25,targetMerges:2});
  const layout=await inspectLayout(page);
  const lifecycle=await lifecycleAndPersistence(page,true);
  return{...evidence,layout,lifecycle,nativePause,realTouchCases:['drag and release','touchCancel','second finger cancellation','pause held across a cooldown HUD update']};
 }finally{await cdp.detach();}
}

(async()=>{
 const browser=await launchBrowser();
 try{
  const viewports=[{width:1440,height:900},{width:390,height:844},{width:844,height:390}];
  for(const viewport of viewports){
   if(process.env.FRUIT_VIEWPORT&&process.env.FRUIT_VIEWPORT!==`${viewport.width}x${viewport.height}`)continue;
   const touch=viewport.width!==1440;
   const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,deviceScaleFactor:1});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
   try{
    const navigation=await page.goto(gameURL);
    const executedBundleSha256=crypto.createHash('sha256').update(await navigation.body()).digest('hex');
    if(report.executedBundleSha256)assert.equal(executedBundleSha256,report.executedBundleSha256,'every viewport executes the same verified game build');
    else report.executedBundleSha256=executedBundleSha256;
    await page.waitForFunction(()=>window.__jelly?.state.mode==='menu');
    const evidence=touch?await mobile(page,viewport):await desktop(page,viewport);
    assert.deepEqual(errors,[],'no browser runtime errors');report.results.push({viewport,passed:true,...evidence,errors});save();console.log('PASS',`${viewport.width}x${viewport.height}`);
   }catch(error){
    const snapshot=await state(page).catch(()=>null);report.results.push({viewport,passed:false,error:error.stack,state:snapshot,errors});save();
    await page.screenshot({path:`qa/fruit-merge-failure-${viewport.width}x${viewport.height}.png`}).catch(()=>{});throw error;
   }finally{await context.close();}
  }
  save();
 }finally{await browser.close();}
})().catch(error=>{report.errors.push(error.stack);save();console.error(error);process.exitCode=1;});
