const {launchBrowser,serverGameURL}=require('./browser-runtime.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await launchBrowser();
 const reports=[];
 try{
  for(const viewport of [{width:1440,height:960},{width:390,height:844},{width:844,height:390}]){
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(serverGameURL);await page.waitForFunction(()=>window.__jelly?.state.mode==='menu');
   await page.screenshot({path:`qa/demo-${viewport.width}-menu.png`});
   await page.locator('.menu-continue').click();await page.locator('[data-action=begin]').click();
   assert.equal(await page.locator('#order-number').textContent(),'ORDER 01 / 24');
   await page.waitForTimeout(900);await page.screenshot({path:`qa/demo-${viewport.width}-order.png`});
   const before=await page.evaluate(()=>window.__jelly.state);await page.locator('[data-action=hint]').click();await page.waitForTimeout(250);await page.locator('#game-dialog [data-action=close]').last().click();assert.equal((await page.evaluate(()=>window.__jelly.state)).bodies[0].id,before.bodies[0].id,'hint must not reset scene');
   await page.locator('#cut-tool').click();for(let i=0;i<6;i++)await page.locator('#rotate-right').click();
   const id=before.bodies[0].id;const center=await page.evaluate(id=>window.__jelly.projectRest(id,0,window.__jelly.state.bodies[0].height,0),id);
   await page.mouse.click(center.x,center.y);await page.waitForFunction(()=>window.__jelly.state.cuts===1);await page.waitForFunction(()=>!window.__jelly.state.cutting);await page.waitForTimeout(500);
   await page.locator('#drag-tool').click();let state=await page.evaluate(()=>window.__jelly.state);assert.equal(state.pieces,2);
   for(let index=0;index<2;index++){
    const body=state.bodies[index];let point=await page.evaluate(id=>{const b=window.__jelly.state.bodies.find(b=>b.id===id);return window.__jelly.project(b.position[0],b.position[1]+b.height*.35,b.position[2]);},body.id);
    await page.mouse.click(point.x,point.y);assert.equal((await page.evaluate(()=>window.__jelly.state)).selectedId,body.id);
    await page.locator(`.serving-slot[data-slot="${index}"]`).click();
   }
   await page.screenshot({path:`qa/demo-${viewport.width}-plated.png`});await page.locator('#order-submit').click();
   assert.equal((await page.evaluate(()=>window.__jelly.state)).mode,'result');const resultText=await page.locator('#game-dialog').innerText();assert.match(resultText,/这一单，刚刚好/);
   await page.screenshot({path:`qa/demo-${viewport.width}-result.png`});
   await page.locator('#game-dialog [data-action=menu]').click();const earned=(await page.evaluate(()=>window.__jelly.state)).profile.completed['order-01'].stars;assert.ok(earned>=1);
   await page.reload();await page.waitForFunction(()=>window.__jelly?.state.mode==='menu');assert.equal((await page.evaluate(()=>window.__jelly.state)).profile.completed['order-01'].stars,earned);
   await page.locator('[data-action=practice]').click();assert.equal((await page.evaluate(()=>window.__jelly.state)).order.mode,'practice');await page.locator('[data-action=menu]').click();await page.locator('[data-action=sandbox]').click();assert.equal((await page.evaluate(()=>window.__jelly.state)).mode,'sandbox');
   reports.push({viewport,passed:true,errors});assert.deepEqual(errors,[]);await page.close();
  }
  fs.writeFileSync('qa/shop-smoke.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
