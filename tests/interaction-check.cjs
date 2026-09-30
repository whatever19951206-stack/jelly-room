const {launchBrowser,localGameURL}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');

const gameURL=localGameURL();
const state=page=>page.evaluate(()=>window.__jelly.state);
const poseDistance=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)));
async function fruitTop(page){
  return page.evaluate(()=>{const p=window.__jelly.state.bodies[0].position;return window.__jelly.project(p[0],p[1]+.58,p[2])});
}
async function openGame(browser,touch=false){
  const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:960},hasTouch:touch,isMobile:touch,deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(gameURL);await page.waitForFunction(()=>window.__jelly?.state.pieces===1);await page.locator('[data-action=sandbox]').click();
  await page.waitForTimeout(1900);
  return {context,page,errors};
}

(async()=>{
  const browser=await launchBrowser();
  const results=[];
  async function check(name,callback,touch=false){
    if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;
    let fixture;
    try{
      fixture=await openGame(browser,touch);
      const evidence=await callback(fixture.page,fixture.context);
      assert.deepEqual(fixture.errors,[],'interaction must not throw browser errors');
      results.push({name,result:'PASS',...evidence});console.log('PASS',name,JSON.stringify(evidence));
    }catch(error){results.push({name,result:'FAIL',error:error.message});console.error('FAIL',name,error.stack)}
    finally{await fixture?.context.close()}
  }

  await check('draw stroke waits for release',async page=>{
    await page.locator('#cut-tool').click();const c=await fruitTop(page);
    await page.mouse.move(c.x-65,c.y);await page.mouse.down();
    await page.waitForTimeout(1100);
    let s=await state(page);assert.equal(s.stroking,true);assert.equal(s.cutting,false);assert.equal(s.cuts,0);assert.equal(s.pieces,1);
    await page.mouse.move(c.x+65,c.y,{steps:16});await page.waitForTimeout(350);
    s=await state(page);assert.equal(s.stroking,true);assert.equal(s.cutting,false);assert.equal(s.cuts,0,'drawing must not initiate cutting before pointerup');
    const preview={...s.knife};await page.mouse.up();await page.waitForTimeout(70);
    s=await state(page);assert.equal(s.stroking,false);assert.equal(s.cutting,true);
    const shift=Math.hypot(s.knife.x-preview.x,s.knife.z-preview.z);
    assert.ok(shift<.025,`releasing a stroke moved its knife plane by ${shift}`);
    await page.waitForFunction(()=>window.__jelly.state.cuts===1,{},{timeout:5000});
    assert.equal((await state(page)).pieces,2);return {previewCommitShift:shift,pieces:2};
  });

  await check('click fallback preserves hover placement',async page=>{
    await page.locator('#cut-tool').click();const c=await fruitTop(page);
    await page.mouse.move(c.x,c.y);await page.waitForTimeout(550);
    const hover=(await state(page)).knife;
    await page.mouse.down();await page.waitForTimeout(200);
    let s=await state(page);assert.equal(s.stroking,true);assert.equal(s.cutting,false);
    await page.mouse.up();await page.waitForTimeout(60);
    s=await state(page);assert.equal(s.cutting,true,'a click must remain a valid cut');
    const shift=Math.hypot(s.knife.x-hover.x,s.knife.z-hover.z);
    assert.ok(shift<.035,`hover-to-click knife plane moved by ${shift}`);
    await page.waitForFunction(()=>window.__jelly.state.cuts===1,{},{timeout:5000});
    assert.equal((await state(page)).pieces,2);return {hoverCommitShift:shift,pieces:2};
  });

  await check('pointer cancellation never commits a stroke',async page=>{
    await page.locator('#cut-tool').click();const c=await fruitTop(page);
    await page.locator('#world').evaluate(canvas=>canvas.addEventListener('pointerdown',e=>canvas.dataset.testPointerId=String(e.pointerId),{once:true}));
    await page.mouse.move(c.x-65,c.y);await page.mouse.down();await page.mouse.move(c.x+65,c.y,{steps:12});
    assert.equal((await state(page)).stroking,true);
    const pointerId=Number(await page.locator('#world').getAttribute('data-test-pointer-id'));
    await page.locator('#world').dispatchEvent('pointercancel',{pointerId,pointerType:'mouse',isPrimary:true});
    await page.mouse.up();await page.waitForTimeout(1200);
    const s=await state(page);assert.equal(s.stroking,false);assert.equal(s.cutting,false);assert.equal(s.cuts,0);assert.equal(s.pieces,1);
    return {cuts:s.cuts,pieces:s.pieces};
  });

  await check('wheel rotates a held fruit in three dimensions',async page=>{
    // Grip a rim and pull it clear of its original support before twisting;
    // a fruit lying flat on the table is physically prevented from rolling.
    const c=await page.evaluate(()=>{const p=window.__jelly.state.bodies[0].position;return window.__jelly.project(p[0]+1.8,p[1]+.58,p[2]+.15)});
    await page.mouse.move(c.x,c.y);await page.mouse.down();
    assert.equal((await state(page)).dragging,true);
    await page.mouse.move(c.x+100,c.y-80,{steps:18});await page.waitForTimeout(400);
    const initial=(await state(page)).bodies[0].rotation;
    for(let i=0;i<6;i++){await page.mouse.wheel(0,80);await page.waitForTimeout(150)}
    await page.waitForTimeout(600);
    const held=await state(page),rotation=held.bodies[0].rotation,angle=poseDistance(initial,rotation);
    assert.ok(Math.abs(held.twist-Math.PI/2)<1e-6,`expected 90 degree requested twist, got ${held.twist}`);
    assert.ok(angle>.08,`wheel changed the control but actual body rotated by only ${angle} radians`);
    assert.ok(Math.hypot(rotation.x,rotation.z)>.025,`body should pitch or roll, not merely yaw: ${JSON.stringify(rotation)}`);
    await page.mouse.up();assert.equal((await state(page)).dragging,false);
    return {requestedTwist:held.twist,actualPoseChange:angle,rotation};
  });

  await check('second finger twists without moving primary grab target',async(page,context)=>{
    const c=await fruitTop(page),cdp=await context.newCDPSession(page);
    const primary={x:c.x,y:c.y,id:1},radius=62;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[primary]});
    let s=await state(page);assert.equal(s.dragging,true);
    assert.ok(Array.isArray(s.grabTarget),'read-only grabTarget is required to distinguish an anchor move from legitimate torque');
    const target=s.grabTarget,initial=s.bodies[0].rotation;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[primary,{x:c.x+radius,y:c.y,id:2}]});
    for(let i=1;i<=12;i++){
      const angle=i/12*Math.PI/2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[primary,{x:c.x+radius*Math.cos(angle),y:c.y+radius*Math.sin(angle),id:2}]});
      await page.waitForTimeout(70);
      s=await state(page);assert.deepEqual(s.grabTarget,target,'second finger must not translate the primary grip');
    }
    await page.waitForTimeout(450);s=await state(page);
    assert.ok(Math.abs(s.twist-Math.PI/2)<.02,`expected quarter-turn from the second finger, got ${s.twist}`);
    const angle=poseDistance(initial,s.bodies[0].rotation);assert.ok(angle>.08,`touch twist did not rotate actual body: ${angle}`);
    // CDP lists the points being released for a partial touchEnd, rather than
    // the contacts that remain down (verified with the emitted pointer IDs).
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:c.x,y:c.y+radius,id:2}]});
    assert.equal((await state(page)).dragging,true,'lifting second finger must preserve the primary grab');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal((await state(page)).dragging,false);
    return {grabTargetUnchanged:true,requestedTwist:s.twist,actualPoseChange:angle};
  },true);

  await browser.close();console.log(JSON.stringify({gameURL,results},null,2));
  if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1)});
