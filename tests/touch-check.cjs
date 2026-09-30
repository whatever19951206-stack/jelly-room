const {launchBrowser,localGameURL}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await launchBrowser();
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});const page=await context.newPage();await page.goto(localGameURL());await page.waitForFunction(()=>window.__jelly?.state.pieces===1);await page.locator('[data-action=sandbox]').click();await page.waitForTimeout(1600);
 const c=(await page.evaluate(()=>window.__jelly.centers))[0],cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:c.x,y:c.y,id:1}]});
 for(let i=1;i<=15;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:c.x+60*i/15,y:c.y-30*i/15,id:1}]});await page.waitForTimeout(20)}
 assert.equal(await page.evaluate(()=>window.__jelly.state.dragging),true);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(1600);assert.equal(await page.evaluate(()=>window.__jelly.state.dragging),false);
 await page.locator('#reset').tap();await page.waitForTimeout(1500);await page.locator('#cut-tool').tap();await page.locator('#rotate-right').tap();const target=(await page.evaluate(()=>window.__jelly.centers))[0];await page.touchscreen.tap(target.x,target.y);await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__jelly.state.pieces),2);await page.screenshot({path:'qa/touch-final.png'});
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(600);await page.screenshot({path:'qa/landscape-final.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log('PASS: real touch drag, release, rotate, cut, portrait and landscape resize');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
