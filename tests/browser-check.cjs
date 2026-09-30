const {launchBrowser,serverGameURL}=require('./browser-runtime.cjs');
const fs=require('node:fs');
(async()=>{
 const browser=await launchBrowser({args:['--allow-file-access-from-files']});
 const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(serverGameURL);await page.waitForFunction(()=>window.__jelly?.state.pieces===1);await page.locator('[data-action=sandbox]').click();await page.waitForTimeout(2200);
 fs.mkdirSync('qa',{recursive:true});await page.screenshot({path:'qa/desktop-initial.png'});console.log('INITIAL',await page.evaluate(()=>window.__jelly.state));
 await page.locator('#cut-tool').click();let center=(await page.evaluate(()=>window.__jelly.centers))[0];await page.mouse.move(center.x,center.y);await page.screenshot({path:'qa/knife-hover.png'});await page.mouse.click(center.x,center.y);await page.waitForTimeout(350);await page.screenshot({path:'qa/press.png'});await page.waitForTimeout(950);
 console.log('AFTER CUT',await page.evaluate(()=>window.__jelly.state));await page.screenshot({path:'qa/first-cut.png'});
 await page.locator('#drag-tool').click();center=(await page.evaluate(()=>window.__jelly.centers))[0];await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x-200,center.y-85,{steps:24});await page.waitForTimeout(200);await page.screenshot({path:'qa/dragging.png'});console.log('DRAG',await page.evaluate(()=>window.__jelly.state));await page.mouse.up();await page.waitForTimeout(1600);
 await page.locator('[data-flavor=citrus]').click();await page.waitForTimeout(1800);await page.screenshot({path:'qa/citrus.png'});
 await page.locator('[data-flavor=grape]').click();await page.waitForTimeout(1800);await page.screenshot({path:'qa/grape.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('[data-flavor=melon]').click();await page.waitForTimeout(1800);await page.screenshot({path:'qa/mobile.png'});
 console.log('ERRORS',errors);await browser.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
