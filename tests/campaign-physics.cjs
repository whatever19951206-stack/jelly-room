// Real browser integration stress, using a separate ephemeral storage context.
// Run after `npm run build` with the local preview server on port 4173.
const {launchBrowser,serverGameURL}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');

(async()=>{
  const browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],report={undoCycles:0,mixedOrderLoads:0,cutAttempts:0};
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('jelly-room.progress.v1',JSON.stringify({version:1,completed:Object.fromEntries(Array.from({length:24},(_,i)=>[`order-${String(i+1).padStart(2,'0')}`,{stars:3,score:900,bestSeconds:60,plays:1,accuracy:100}]))})));
  await page.goto(serverGameURL);await page.waitForFunction(()=>window.__jelly?.state.uiState==='menu');
  const state=()=>page.evaluate(()=>window.__jelly.state);
  const mass=s=>s.bodies.reduce((sum,b)=>sum+b.mass,0);
  const identity=s=>s.bodies.map(b=>({id:b.id,poly:b.poly,recipeScale:b.recipeScale,height:b.height,slot:b.slot}));
  const validate=s=>{assert.ok(s.bodies.every(b=>[...b.position,...b.velocity,b.mass,b.height,b.volume,b.kinetic].every(Number.isFinite)),'finite physics state');assert.ok(s.bodies.every(b=>b.volumeRatio>.75&&b.volumeRatio<1.25),'volume stays close to rest under gameplay');assert.ok(s.pieces<=36,'fragment count is bounded');};
  async function openOrder(number){
    const id=`order-${String(number).padStart(2,'0')}`;
    if((await state()).uiState!=='menu')await page.locator('.order-actions [data-action="menu"]').click();
    await page.locator(`.level-button[data-level="${id}"]`).click();
    if(await page.locator('[data-action="begin"]').isVisible())await page.locator('[data-action="begin"]').click();
    await page.waitForFunction(id=>window.__jelly.state.mode==='order'&&window.__jelly.state.order.id===id,id);
    await page.waitForTimeout(160);validate(await state());
  }
  async function clickBody(id){
    const p=await page.evaluate(id=>window.__jelly.centers.find(p=>p.id===id),id);
    assert.ok(p&&p.x>0&&p.x<1440&&p.y>0&&p.y<960,'piece center remains on screen');
    const hit=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,p);
    assert.equal(hit,'world','the campaign UI must not cover the source fruit');
    await page.mouse.click(p.x,p.y);
  }
  async function cutLargest(){
    const before=await state(),target=before.bodies.filter(b=>b.slot===null).sort((a,b)=>b.area-a.area)[0];
    await page.locator('#cut-tool').click();await page.keyboard.press('e');await clickBody(target.id);
    const started=(await state()).cutting;
    if(started)await page.waitForFunction(()=>!window.__jelly.state.cutting,null,{timeout:7000});
    else await page.waitForTimeout(100);
    const after=await state();validate(after);assert.ok(Math.abs(mass(after)-mass(before))<1e-6,'cuts conserve physical mass');return after.cuts>before.cuts;
  }
  await openOrder(22);
  const initial=await state();assert.equal(initial.pieces,2);assert.ok(initial.bodies.every(b=>b.recipeScale===initial.order.source.find(s=>s.flavor===b.flavor).scale));
  report.mixedInitialMass=mass(initial);
  await page.screenshot({path:'qa/campaign-physics-mixed.png'});

  // Serve a whole source, retrieve it, and undo both transitions repeatedly.
  await page.locator('#drag-tool').click();
  for(let i=0;i<10;i++){
    const before=await state(),body=before.bodies[0];await clickBody(body.id);
    await page.waitForFunction(id=>window.__jelly.state.selectedId===id,body.id);
    await page.locator('.serving-slot[data-slot="0"]').click();
    const served=await state(),placed=served.bodies.find(b=>b.id===body.id);assert.equal(placed.slot,0);assert.ok(Math.abs(mass(served)-mass(before))<1e-8);assert.equal(placed.kinetic,0);
    await page.waitForTimeout(50);const still=(await state()).bodies.find(b=>b.id===body.id);assert.deepEqual(still.position,placed.position,'served pieces are excluded from physics and collisions');
    await page.locator('.serving-slot[data-slot="0"]').click();const returned=await state();assert.equal(returned.bodies.find(b=>b.id===body.id).slot,null);assert.ok(Math.abs(mass(returned)-mass(before))<1e-8);
    await page.locator('#order-undo').click();assert.equal((await state()).bodies.find(b=>b.id===body.id).slot,0);
    await page.locator('#order-undo').click();const undone=await state();assert.deepEqual(identity(undone),identity(before));validate(undone);report.undoCycles++;
  }
  console.log('Serving, retrieval and 20 undo operations passed.');

  // A cut/undo also exercises actual remeshing and scaled source restoration.
  for(let i=0;i<4;i++){
    const before=await state();assert.ok(await cutLargest(),'center cut should split a source');await page.locator('#order-undo').click();const undone=await state();assert.deepEqual(identity(undone),identity(before));assert.equal(undone.cuts,before.cuts);validate(undone);
  }

  // Repeated mixed orders should release old geometry, canvases and particle arrays.
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  async function heap(){await cdp.send('HeapProfiler.collectGarbage');return(await cdp.send('Performance.getMetrics')).metrics.find(x=>x.name==='JSHeapUsedSize').value}
  for(let i=0;i<4;i++)await openOrder([22,23,24][i%3]);
  report.heapBefore=await heap();
  for(let i=0;i<20;i++){await openOrder([22,23,24][i%3]);const s=await state();assert.equal(s.pieces,2);assert.equal(s.historyDepth,0);assert.ok(s.bodies.every(b=>b.recipeScale===s.order.source.find(source=>source.flavor===b.flavor).scale));report.mixedOrderLoads++}
  report.heapAfter=await heap();report.heapGrowth=report.heapAfter-report.heapBefore;
  assert.ok(report.heapGrowth<12*1024*1024,'20 order replacements must not retain old boards');
  console.log(`20 mixed order replacements passed; heap growth ${Math.round(report.heapGrowth/1024)} KiB.`);

  await openOrder(22);
  const originalMass=mass(await state());
  for(let i=0;i<37;i++){await cutLargest();report.cutAttempts++;if(i%8===7)console.log(`Repeated cut attempts: ${i+1}`)}
  const cutState=await state();assert.ok(cutState.pieces>=20,'repeated cuts must keep producing real fragments');assert.ok(Math.abs(mass(cutState)-originalMass)<1e-6);report.finalPieces=cutState.pieces;report.finalCuts=cutState.cuts;report.physicsMs=cutState.metrics.physicsMs;report.fps=cutState.metrics.fps;
  await page.screenshot({path:'qa/campaign-physics-many-cuts.png'});
  await page.locator('.order-actions [data-action="retry"]').click();const reset=await state();assert.equal(reset.pieces,2);assert.equal(reset.cuts,0);assert.equal(reset.historyDepth,0);validate(reset);
  assert.deepEqual(errors,[]);report.errors=errors;report.result='PASS';await fs.writeFile('qa/campaign-physics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
