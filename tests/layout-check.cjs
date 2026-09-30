const {launchBrowser,serverGameURL}=require('./browser-runtime.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');

// Run after npm run build with npm start serving on 127.0.0.1:4173.
// Settings may scroll on a short screen; every control must remain reachable.
const viewports=[
 {name:'desktop',width:1440,height:960},
 {name:'portrait',width:390,height:844},
 {name:'landscape',width:844,height:390},
];
const alwaysVisible=['#sound','#help','[data-flavor="melon"]','[data-flavor="citrus"]','[data-flavor="grape"]','#settings-toggle','#jiggle','#drag-tool','#cut-tool','#reset'];
const settingsControls=['#softness','#damping','#slow-mode','#mesh-mode','#pause-mode'];

async function inspectControl(page,selector){
 const locator=page.locator(selector);
 assert(await locator.isVisible(),`${selector} must be visible`);
 return locator.evaluate(element=>{
  const r=element.getBoundingClientRect();
  const points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  const hits=points.map(([x,y])=>document.elementFromPoint(r.left+r.width*x,r.top+r.height*y));
  const blocker=hits.find(hit=>hit!==element&&!element.contains(hit));
  const effectiveFont=parseFloat(getComputedStyle(element).fontSize)*r.width/element.offsetWidth;
  return {selector:element.id||element.getAttribute('data-flavor'),left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,effectiveFont,readable:element.tagName==='INPUT'||!element.textContent.trim()||effectiveFont>=8,withinViewport:r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,receivesPointer:!blocker,blockedBy:blocker?.id||blocker?.className||blocker?.tagName};
 });
}

(async()=>{
 fs.mkdirSync('qa',{recursive:true});
 const browser=await launchBrowser({args:['--allow-file-access-from-files']});
 const reports=[];
 try{
  for(const viewport of viewports){
   const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1,reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(serverGameURL);
   await page.waitForFunction(()=>window.__jelly?.state.pieces===1&&document.querySelector('#loading').classList.contains('done'));
   await page.locator('[data-action=sandbox]').click();
   await page.waitForTimeout(700);
   const report={viewport,normal:[],settings:[],angles:[],errors};
   await page.screenshot({path:`qa/layout-${viewport.name}-normal.png`});
   for(const selector of alwaysVisible)report.normal.push(await inspectControl(page,selector));
   await page.locator('#cut-tool').click();
   for(const selector of ['#rotate-left','#rotate-right'])report.angles.push(await inspectControl(page,selector));
   await page.locator('#drag-tool').click();
   await page.locator('#settings-toggle').click();
   await page.screenshot({path:`qa/layout-${viewport.name}-settings.png`});
   report.panel=await page.locator('.settings-body').evaluate(element=>{const r=element.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,withinViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}});
   for(const selector of alwaysVisible)report.settings.push(await inspectControl(page,selector));
   for(const selector of settingsControls){
    await page.locator(selector).scrollIntoViewIfNeeded();
    report.settings.push(await inspectControl(page,selector));
   }
   if(report.panel.scrollHeight>report.panel.clientHeight+1){
    await page.locator('.settings-body').evaluate(element=>{element.scrollTop=element.scrollHeight});
    await page.screenshot({path:`qa/layout-${viewport.name}-settings-bottom.png`});
   }
   report.documentFits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight);
   reports.push(report);
   await page.close();
  }
  fs.writeFileSync('qa/layout-report.json',JSON.stringify(reports,null,2));
  const failures=[];
  for(const report of reports){
   if(!report.documentFits)failures.push(`${report.viewport.name}: document overflow`);
   if(!report.panel.withinViewport)failures.push(`${report.viewport.name}: settings panel outside viewport`);
   for(const mode of ['normal','settings','angles'])for(const control of report[mode]){
    if(!control.withinViewport)failures.push(`${report.viewport.name}/${mode}: ${control.selector} outside viewport`);
    if(!control.receivesPointer)failures.push(`${report.viewport.name}/${mode}: ${control.selector} blocked by ${control.blockedBy}`);
    if(!control.readable)failures.push(`${report.viewport.name}/${mode}: ${control.selector} scaled text below 8px`);
   }
   failures.push(...report.errors.map(error=>`${report.viewport.name}: ${error}`));
  }
  console.log(JSON.stringify({screens:viewports.map(({name})=>name),failures,report:'qa/layout-report.json'},null,2));
  assert.equal(failures.length,0,failures.join('\n'));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
