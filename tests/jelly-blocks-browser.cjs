/* Jelly Blocks acceptance: real keyboard, pointer and touch input; model state is read-only.
 * Headless Chromium has no background-tab visibility. Lifecycle cases explicitly emulate
 * browser blur/visibility events, never alter the game/model, and report that distinction.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {launchBrowser,localGameURL,serverGameURL}=require('./browser-runtime.cjs');

const gameURL=process.env.GAME_URL?serverGameURL:localGameURL();
const state=page=>page.evaluate(()=>window.__jellyBlocks.state);
const shopState=page=>page.evaluate(()=>window.__jelly.state);
const occupied=board=>board.flat().filter(Boolean).length;
const pausedSnapshot=s=>({board:s.board,active:s.active,held:s.held,holdUsed:s.holdUsed,score:s.score,lines:s.lines,elapsed:s.elapsed,piecesLocked:s.piecesLocked});
const report={generatedAt:new Date().toISOString(),gameURL,results:[],errors:[]};
const save=()=>fs.writeFileSync('qa/jelly-blocks-browser.json',JSON.stringify(report,null,2)+'\n');

async function tap(page,selector,touch){
  const locator=page.locator(selector);
  if(touch)await locator.tap();else await locator.click();
}
async function enter(page,status='ready'){
  await page.locator('[data-action="blocks"]').click();
  await page.waitForFunction(()=>window.__jellyBlocks?.state.activeMode===true);
  assert.equal((await state(page)).status,status);
  await page.waitForFunction(()=>window.__jellyBlocks.state.render?.ready);
}

// Plan from a read-only snapshot. The plan is executed exclusively with real keys.
function landingOptions(board,type,shapes){
  const options=[];
  for(let rotation=0;rotation<4;rotation++)for(let x=-3;x<10;x++){
    const shape=shapes[type][rotation];
    const fits=y=>shape.every(p=>{const bx=x+p.x,by=y+p.y;return bx>=0&&bx<10&&by<20&&(by<0||!board[by][bx])});
    let y=-2;if(!fits(y))continue;while(fits(y+1))y++;
    if(shape.some(p=>y+p.y<0))continue;
    let next=board.map(row=>row.map(Boolean));for(const p of shape)next[y+p.y][x+p.x]=true;
    const lines=next.filter(row=>row.every(Boolean)).length;
    next=next.filter(row=>!row.every(Boolean));while(next.length<20)next.unshift(Array(10).fill(false));
    const heights=[],holes=[];
    for(let col=0;col<10;col++){const top=next.findIndex(row=>row[col]);heights.push(top<0?0:20-top);holes.push(top<0?0:next.slice(top).filter(row=>!row[col]).length)}
    const aggregate=heights.reduce((a,b)=>a+b,0),holeCount=holes.reduce((a,b)=>a+b,0),bump=heights.slice(1).reduce((sum,h,i)=>sum+Math.abs(h-heights[i]),0);
    const quality=lines*3.2-aggregate*.51-holeCount*4.5-bump*.18-Math.max(...heights)*.3;
    options.push({x,y,rotation,next,lines,quality});
  }
  return options;
}
async function clearTenLines(page){
  const {SHAPES}=await import(pathToFileURL(path.resolve('src/jelly-blocks-model.js')).href);
  const drops=[];
  while((await state(page)).lines<10&&drops.length<160){
    const before=await state(page);
    assert.equal(before.status,'playing','planner must remain in a live game');
    const plans=landingOptions(before.board,before.active.type,SHAPES).map(plan=>{
      const next=landingOptions(plan.next,before.queue[0],SHAPES);
      return {...plan,lookahead:plan.quality+(next.length?Math.max(...next.map(p=>p.quality))*.75:-10000)};
    }).sort((a,b)=>b.lookahead-a.lookahead);
    assert.ok(plans.length,'at least one legal landing exists');
    const plan=plans[0];
    const turns=(plan.rotation-before.active.rotation+4)%4;
    for(let i=0;i<turns;i++)await page.keyboard.press('ArrowUp');
    let current=await state(page);
    for(let i=0;i<12&&current.active.x!==plan.x;i++){
      const oldX=current.active.x;
      await page.keyboard.press(current.active.x<plan.x?'ArrowRight':'ArrowLeft');
      current=await state(page);
      assert.notEqual(current.active.x,oldX,'planned horizontal key must move actual piece');
    }
    assert.equal(current.active.rotation,plan.rotation);assert.equal(current.active.x,plan.x);
    await page.keyboard.press('Space');
    const after=await state(page);
    assert.equal(after.piecesLocked,before.piecesLocked+1,'planned hard drop commits actual piece');
    drops.push({type:before.active.type,x:plan.x,rotation:plan.rotation,lines:after.lines,score:after.score});
    if(drops.length===18){
      await page.waitForTimeout(350);
      await page.screenshot({path:'qa/jelly-blocks-preview.png'});
    }
  }
  const after=await state(page);
  assert.ok(after.lines>=10,`real inputs must clear at least ten lines; got ${after.lines}`);
  assert.ok(after.level>=2,'ten cleared lines increase level');
  assert.ok(after.score>0);
  await page.screenshot({path:'qa/jelly-blocks-ten-lines.png'});
  return {drops,lines:after.lines,level:after.level,score:after.score};
}
async function start(page,touch=false){
  await tap(page,'#jb-start',touch);
  await page.waitForFunction(()=>window.__jellyBlocks.state.status==='playing');
  const s=await state(page);
  assert.ok(s.active,'start must spawn an actual falling piece');
  assert.equal(occupied(s.board),0);
  assert.equal(s.piecesLocked,0);
  return s;
}
async function inspectLayout(page){
  const selectors=['#jb-canvas','#jb-left','#jb-right','#jb-rotate','#jb-down','#jb-drop','#jb-hold','#jb-pause','#jb-restart-top','#jb-exit'];
  const controls=await page.evaluate(selectors=>selectors.map(selector=>{
    const element=document.querySelector(selector);
    if(!element)return {selector,missing:true};
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
    const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
    return {selector,width:rect.width,height:rect.height,visible:style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0,withinViewport:rect.left>=-.5&&rect.top>=-.5&&rect.right<=innerWidth+.5&&rect.bottom<=innerHeight+.5,receivesPointer:hit===element||element.contains(hit),hit:hit?.id||hit?.className};
  }),selectors);
  for(const c of controls){
    assert.ok(!c.missing&&c.visible,`${c.selector} visible`);
    assert.ok(c.withinViewport,`${c.selector} inside viewport: ${JSON.stringify(c)}`);
    assert.ok(c.receivesPointer,`${c.selector} not obscured: ${JSON.stringify(c)}`);
    if(c.selector!=='#jb-canvas')assert.ok(c.width>=30&&c.height>=30,`${c.selector} usable touch size`);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal page overflow');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+1),false,'game fits viewport vertically');
  const render=(await state(page)).render;
  assert.ok(render.frames>0&&render.blocks>0,'3D renderer must draw actual pieces');
  const canvas=controls.find(c=>c.selector==='#jb-canvas');
  assert.ok(canvas.width>=100&&canvas.height>=180,'board has usable rendered area');
  return {controls,render};
}

async function desktop(page){
  await enter(page);
  const frozenShop=await shopState(page);
  await page.waitForTimeout(220);
  const idleShop=await shopState(page);
  assert.deepEqual(idleShop.bodies.map(b=>b.position),frozenShop.bodies.map(b=>b.position),'old jelly simulation must stop behind blocks');
  let before=await start(page);
  await page.keyboard.press('ArrowLeft');let after=await state(page);
  assert.equal(after.active.x,before.active.x-1,'keyboard left moves actual piece');
  await page.keyboard.press('ArrowRight');after=await state(page);
  assert.equal(after.active.x,before.active.x,'keyboard right moves actual piece');
  await page.keyboard.press('ArrowUp');after=await state(page);
  assert.notEqual(after.active.rotation,before.active.rotation,'rotation changes actual model orientation');
  before=after;await page.keyboard.press('ArrowDown');after=await state(page);
  assert.ok(after.active.y>before.active.y,'soft drop moves actual piece');
  assert.ok(after.score>before.score,'soft drop awards score');
  before=after;await page.keyboard.press('KeyC');after=await state(page);
  assert.equal(after.held,before.active.type,'hold stores previous actual piece');
  assert.equal(after.holdUsed,true);
  assert.notEqual(after.active.id,before.active.id,'hold spawns another piece');
  const heldOnce=after;await page.keyboard.press('KeyC');after=await state(page);
  assert.equal(after.active.id,heldOnce.active.id,'cannot hold twice before locking');
  assert.equal(after.held,heldOnce.held);
  before=after;await page.keyboard.press('Space');after=await state(page);
  assert.equal(after.piecesLocked,before.piecesLocked+1,'hard drop locks actual piece');
  assert.equal(occupied(after.board),4,'first hard drop populates four board cells');
  assert.ok(after.score>before.score,'hard drop awards points');
  assert.equal(after.holdUsed,false,'locking restores hold');
  assert.equal((await shopState(page)).cuts,frozenShop.cuts,'blocks keys never cut old jelly');
  const layout=await inspectLayout(page);
  await page.screenshot({path:'qa/jelly-blocks-desktop-playing.png'});

  await page.locator('#jb-pause').click();
  assert.equal((await state(page)).status,'paused');
  before=await state(page);
  for(const key of ['ArrowLeft','ArrowUp','ArrowDown','Space','KeyC'])await page.keyboard.press(key);
  await page.waitForTimeout(Math.min(1500,Math.max(800,before.gravityMs+100)));
  assert.deepEqual(pausedSnapshot(await state(page)),pausedSnapshot(before),'paused model must ignore gameplay and time');
  await page.locator('#jb-resume').click();
  assert.equal((await state(page)).status,'playing');
  before=await state(page);await page.waitForTimeout(140);
  assert.ok((await state(page)).elapsed>before.elapsed,'resume advances actual simulation');

  await page.keyboard.down('ArrowLeft');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('ArrowLeft');
  after=await state(page);
  assert.equal(after.status,'paused','blur pauses game');
  assert.deepEqual(after.heldInputs,[],'blur clears held keyboard/button sources');
  before=after;await page.waitForTimeout(180);
  assert.deepEqual(pausedSnapshot(await state(page)),pausedSnapshot(before),'blur pause remains stable');
  await page.locator('#jb-resume').click();
  await page.keyboard.down('ArrowRight');
  // Emulate browser visibility only; do not call a model method or alter game state.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
  await page.keyboard.up('ArrowRight');
  after=await state(page);
  assert.equal(after.status,'paused','hidden visibility pauses game');
  assert.deepEqual(after.heldInputs,[],'hidden visibility clears held input');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
  assert.equal((await state(page)).status,'paused','returning visible does not resume without consent');
  await page.locator('#jb-resume').click();

  await page.locator('#jb-restart-top').click();
  after=await state(page);
  if(after.status==='ready')after=await start(page);
  assert.equal(after.status,'playing');assert.equal(after.score,0);assert.equal(after.piecesLocked,0);assert.equal(occupied(after.board),0);assert.equal(after.held,null);
  await page.keyboard.press('KeyC');await page.keyboard.press('Space');
  await page.locator('#jb-exit').click();
  await page.waitForFunction(()=>window.__jelly.state.mode==='menu');
  assert.equal((await state(page)).activeMode,false);
  const closed=pausedSnapshot(await state(page));await page.keyboard.press('ArrowLeft');await page.keyboard.press('Space');
  assert.deepEqual(pausedSnapshot(await state(page)),closed,'closed blocks ignores keys');

  // Re-entry catches duplicate listeners and forgotten held inputs.
  await enter(page,'paused');
  assert.deepEqual(pausedSnapshot(await state(page)),closed,'re-entry preserves board, score, held piece and falling piece');
  await page.locator('#jb-resume').click();before=await state(page);await page.keyboard.press('ArrowLeft');
  assert.equal((await state(page)).active.x,before.active.x-1,'re-entry installs no duplicate controls');
  const clears=await clearTenLines(page);
  const peak=(await state(page)).score;
  assert.ok((await state(page)).bestScore>=peak,'best score includes live score');
  await page.reload();await page.waitForFunction(()=>window.__jelly?.state.mode==='menu');
  await enter(page);assert.ok((await state(page)).bestScore>=peak,'best score survives page reload');
  await start(page);
  let drops=0;
  while((await state(page)).status==='playing'&&drops<30){await page.keyboard.press('Space');drops++}
  after=await state(page);
  assert.equal(after.status,'over','real repeated locking eventually reaches game over');
  assert.ok(after.piecesLocked>0&&occupied(after.board)>0);
  await page.locator('#jb-restart').waitFor({state:'visible'});
  assert.ok(await page.locator('#jb-restart').isVisible(),'game-over restart is visible');
  await page.screenshot({path:'qa/jelly-blocks-gameover.png'});
  await page.locator('#jb-restart').click();
  after=await state(page);
  if(after.status==='ready')after=await start(page);
  assert.equal(after.status,'playing');assert.equal(after.piecesLocked,0);assert.equal(occupied(after.board),0);
  await page.locator('#jb-exit').click();
  await page.locator('.menu-continue').click();
  if(await page.locator('[data-action="begin"]').isVisible())await page.locator('[data-action="begin"]').click();
  await page.waitForFunction(()=>window.__jelly.state.mode==='order'&&window.__jelly.state.uiState==='order');
  await page.waitForTimeout(1300);
  await page.locator('#cut-tool').click();
  const target=await page.evaluate(()=>{const s=window.__jelly.state,b=s.bodies[0];return window.__jelly.projectRest(b.id,0,b.height,.2)});
  const oldCuts=(await shopState(page)).cuts;
  await page.mouse.click(target.x,target.y);
  await page.waitForFunction(cuts=>window.__jelly.state.cuts>cuts,oldCuts);
  assert.ok((await shopState(page)).pieces>=2,'real original-order cutting works after exit');
  return {layout,lockedCells:4,clears,gameoverDrops:drops,persistedBest:peak,lifecycle:'Controlled blur and hidden/visible browser events; headless Chromium does not expose real background-tab visibility.',originalOrderRestored:true};
}

async function mobile(page,viewport){
  await enter(page);let before=await start(page,true);
  const layout=await inspectLayout(page);
  await tap(page,'#jb-left',true);let after=await state(page);
  assert.equal(after.active.x,before.active.x-1,'touch left moves model');
  await tap(page,'#jb-right',true);after=await state(page);
  assert.equal(after.active.x,before.active.x,'touch right moves model');
  before=after;await tap(page,'#jb-rotate',true);after=await state(page);
  assert.notEqual(after.active.rotation,before.active.rotation,'touch rotate changes model');
  before=after;await tap(page,'#jb-down',true);after=await state(page);
  assert.ok(after.active.y>before.active.y,'touch soft drop moves model');
  before=after;await tap(page,'#jb-hold',true);after=await state(page);
  assert.equal(after.held,before.active.type,'touch hold stores piece');
  before=after;await tap(page,'#jb-drop',true);after=await state(page);
  assert.equal(after.piecesLocked,before.piecesLocked+1,'touch drop locks piece');
  assert.equal(occupied(after.board),4);
  const right=await page.locator('#jb-right').boundingBox();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:right.x+right.width/2,y:right.y+right.height/2,id:1}]});
  await page.waitForTimeout(70);
  assert.ok((await state(page)).heldInputs.length>0,'touch press is held before cancellation');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  before=await state(page);
  assert.deepEqual(before.heldInputs,[],'real touchCancel clears held input');
  await page.waitForTimeout(220);
  assert.equal((await state(page)).active.x,before.active.x,'cancelled touch does not continue repeating');
  await cdp.detach();
  await page.screenshot({path:`qa/jelly-blocks-${viewport.width}x${viewport.height}.png`});
  await tap(page,'#jb-pause',true);assert.equal((await state(page)).status,'paused');
  await tap(page,'#jb-resume',true);assert.equal((await state(page)).status,'playing');
  await tap(page,'#jb-exit',true);await page.waitForFunction(()=>window.__jelly.state.mode==='menu');
  return {layout,lockedCells:4};
}

(async()=>{
  const browser=await launchBrowser();
  try{
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
      const touch=viewport.width!==1440;
      const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,deviceScaleFactor:1});
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.setDefaultTimeout(10000);
      try{
        await page.goto(gameURL);await page.waitForFunction(()=>window.__jelly?.state.mode==='menu');
        const evidence=touch?await mobile(page,viewport):await desktop(page);
        assert.deepEqual(errors,[],'no browser runtime errors');
        report.results.push({viewport,passed:true,...evidence,errors});
        console.log('PASS',`${viewport.width}x${viewport.height}`);
      }catch(error){
        report.results.push({viewport,passed:false,error:error.message,errors});
        console.error('FAIL',`${viewport.width}x${viewport.height}`,error.stack);
        await page.screenshot({path:`qa/jelly-blocks-${viewport.width}x${viewport.height}-failure.png`}).catch(()=>{});
      }finally{await context.close();save()}
    }
  }finally{await browser.close()}
  report.passed=report.results.length===3&&report.results.every(r=>r.passed);save();
  if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);report.errors.push(error.message);save();process.exitCode=1});
