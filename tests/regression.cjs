const {launchBrowser,localGameURL}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await launchBrowser();
 const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});
 await page.goto(localGameURL('成品/慢慢切.html'));await page.waitForFunction(()=>window.__jelly?.state.pieces===1);await page.locator('[data-action=sandbox]').click();await page.waitForTimeout(1600);
 const initial=await page.evaluate(()=>window.__jelly.state.bodies.reduce((s,b)=>s+b.area,0));
 await page.locator('#cut-tool').click();
 for(let i=0;i<18;i++){
   const targets=await page.evaluate(()=>{const s=window.__jelly.state;return window.__jelly.centers.map(p=>({...p,area:s.bodies.find(b=>b.id===p.id).area})).sort((a,b)=>b.area-a.area)});
   const p=targets.find(p=>p.x>350&&p.x<1140&&p.y>220&&p.y<740)||targets[0];
   await page.keyboard.press('e');await page.mouse.click(p.x,p.y);await page.waitForTimeout(1050);
   const state=await page.evaluate(()=>window.__jelly.state);assert.ok(state.bodies.every(b=>[...b.position,...b.velocity,b.deformation].every(Number.isFinite)));assert.ok(Math.abs(state.bodies.reduce((s,b)=>s+b.area,0)-initial)<1e-6);
 }
 const cutState=await page.evaluate(()=>window.__jelly.state);assert.ok(cutState.cuts>=12,`Expected repeated cuts; got ${cutState.cuts}`);assert.ok(cutState.pieces>=15);await page.screenshot({path:'qa/many-cuts.png'});
 await page.locator('#drag-tool').click();let p=(await page.evaluate(()=>window.__jelly.centers))[0];
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+75,p.y-45,{steps:15});assert.equal(await page.evaluate(()=>window.__jelly.state.dragging),true);await page.mouse.up();assert.equal(await page.evaluate(()=>window.__jelly.state.dragging),false);
 await page.locator('#jiggle').click();await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>window.__jelly.state.bodies.some(b=>b.position[1]>.08)));
 await page.locator('#settings-toggle').click();await page.locator('#softness').fill('98');assert.equal(await page.evaluate(()=>window.__jelly.state.softness),.98);await page.locator('#settings-toggle').click();
 await page.locator('#help').click();assert.equal(await page.locator('#help-dialog').evaluate(d=>d.open),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#help-dialog').evaluate(d=>d.open),false);
 await page.locator('#sound').click();assert.equal(await page.locator('#sound').getAttribute('aria-label'),'开启声音');
 await page.locator('#reset').click();await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>window.__jelly.state.pieces),1);assert.equal(await page.evaluate(()=>window.__jelly.state.cuts),0);
 await page.locator('#world').focus();await page.keyboard.down('Space');assert.equal(await page.evaluate(()=>window.__jelly.state.tool),'cut');await page.keyboard.up('Space');assert.equal(await page.evaluate(()=>window.__jelly.state.tool),'drag');
 for(const flavor of ['citrus','grape']){await page.locator(`[data-flavor=${flavor}]`).click();await page.waitForTimeout(1300);await page.locator('#cut-tool').click();p=(await page.evaluate(()=>window.__jelly.centers))[0];await page.mouse.click(p.x,p.y);await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>window.__jelly.state.pieces),2)}
 await page.setViewportSize({width:390,height:844});await page.locator('[data-flavor=melon]').click();await page.waitForTimeout(1400);await page.locator('#cut-tool').click();p=(await page.evaluate(()=>window.__jelly.centers))[0];await page.mouse.click(p.x,p.y);await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>window.__jelly.state.pieces),2);await page.screenshot({path:'qa/mobile-cut.png'});
 assert.deepEqual(external,[],'Offline file must make no network requests');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',offline:true,externalRequests:external.length,cuts:cutState.cuts,pieces:cutState.pieces,areaConserved:true,fps:cutState.metrics.fps,errors},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
