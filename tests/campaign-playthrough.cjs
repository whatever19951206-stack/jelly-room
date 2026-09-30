/* Browser acceptance test. All gameplay uses real pointer/keyboard/DOM input.
 * The only fixture mutation is localStorage progress, to open a chosen order.
 * __jelly inspection and its preview/project helpers are read-only.
 */
const {launchBrowser,serverGameURL}=require('./browser-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const gameURL=serverGameURL;
const reportPath=path.resolve('qa/campaign-playthrough.json');
const state=page=>page.evaluate(()=>window.__jelly.state);

(async()=>{
  const {ORDERS,defaultProfile,STORAGE_KEY}=await import(pathToFileURL(path.resolve('src/progression.js')));
  const {area,centroid,clip}=await import(pathToFileURL(path.resolve('src/geometry.js')));
  const browser=await launchBrowser();
  const selected=process.env.CAMPAIGN_LEVELS?process.env.CAMPAIGN_LEVELS.split(',').map(Number):ORDERS.map(o=>o.number);
  let report={generatedAt:new Date().toISOString(),gameURL,buildSHA256:crypto.createHash('sha256').update(fs.readFileSync('index.html')).digest('hex'),fixture:'Prior orders are marked passed only to unlock access; each reported order starts incomplete and is cut/plated/submitted through real UI input.',results:[]};
  if(process.env.CAMPAIGN_RESUME==='1'&&fs.existsSync(reportPath)){
    const prior=JSON.parse(fs.readFileSync(reportPath));assert.equal(prior.buildSHA256,report.buildSHA256,'cannot merge acceptance results from different builds');
    report={...prior,results:prior.results.filter(result=>!selected.includes(Number(result.id.slice(-2)))),reruns:[...(prior.reruns||[]),{at:report.generatedAt,levels:selected}]};
  }
  const save=()=>{fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2))};

  async function setAngle(page,desired){
    const current=(await state(page)).knife.angle;
    let delta=desired-current;while(delta>Math.PI/2)delta-=Math.PI;while(delta<-Math.PI/2)delta+=Math.PI;
    const steps=Math.round(delta/(Math.PI/12));
    for(let i=0;i<Math.abs(steps);i++)await page.keyboard.press(steps>0?'e':'q');
    const actual=(await state(page)).knife.angle;
    assert.ok(Math.abs(Math.sin(actual-desired))<1e-6,'requested blade direction must be reached by keyboard');
    return actual;
  }
  function pointOnChord(poly,axis,boundary){
    const other=axis==='x'?'z':'x',values=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=a[axis]-boundary,db=b[axis]-boundary;
      if(Math.abs(da)<1e-8)values.push(a[other]);
      if(da*db<0){const t=da/(da-db);values.push(a[other]+(b[other]-a[other])*t)}
    }
    const middle=values.length?(Math.min(...values)+Math.max(...values))/2:centroid(poly)[other];
    return {[axis]:boundary,[other]:middle};
  }
  function idealBoundary(body,targetMass,axis){
    let low=Math.min(...body.poly.map(p=>p[axis])),high=Math.max(...body.poly.map(p=>p[axis]));
    const normal=axis==='x'?{x:1,z:0}:{x:0,z:1};
    for(let i=0;i<55;i++){const boundary=(low+high)/2,p=axis==='x'?{x:boundary,z:0}:{x:0,z:boundary};if(area(clip(body.poly,p,normal,-1))*body.height<targetMass)low=boundary;else high=boundary}
    return (low+high)/2;
  }
  async function cutPortion(page,bodyId,targetShare,axis,actions,{spanAll=false}={}){
    // Read the new pose after rebound: a fragment may naturally turn over.
    await page.waitForFunction(id=>window.__jelly.state.bodies.find(b=>b.id===id)?.kinetic<.015,bodyId,{timeout:6000}).catch(()=>{});
    await page.locator('#cut-tool').click();const angle=await setAngle(page,axis==='x'?Math.PI/2:0);
    let s=await state(page);const body=s.bodies.find(b=>b.id===bodyId);assert.ok(body&&body.slot===null);
    const targetMass=s.initialMasses[body.flavor]*targetShare/100;
    let low=Math.min(...body.poly.map(p=>p[axis])),high=Math.max(...body.poly.map(p=>p[axis]));
    let boundary=idealBoundary(body,targetMass,axis),best=null;const aiming=[];
    for(let attempt=0;attempt<12;attempt++){
      const material=pointOnChord(body.poly,axis,boundary);
      const current=(await state(page)).bodies.find(b=>b.id===bodyId),inverted=current.rotation.x**2+current.rotation.z**2>.5;
      const point=await page.evaluate(({id,p,y})=>window.__jelly.projectRest(id,p.x,y,p.z),{id:bodyId,p:material,y:inverted?.035:body.height+.075});
      assert.ok(point.x>20&&point.x<1580&&point.y>120&&point.y<830,`cut target is outside usable canvas: ${JSON.stringify(point)}`);
      await page.mouse.move(point.x,point.y);await page.waitForTimeout(attempt?180:400);
      const allPreviews=await page.evaluate(angle=>{const s=window.__jelly.state;return window.__jelly.preview({x:s.knife.x,y:.5,z:s.knife.z},angle)},angle),preview=allPreviews.find(p=>p.id===bodyId);
      aiming.push({boundary,point,knife:(await state(page)).knife,plans:allPreviews.map(plan=>({id:plan.id,shares:plan.parts.map(part=>part.share)}))});
      if(!preview){boundary=(boundary+centroid(body.poly)[axis])/2;continue}
      const small=preview.parts.slice().sort((a,b)=>centroid(a.poly)[axis]-centroid(b.poly)[axis])[0],error=Math.abs(small.share-targetShare);
      if(!best||error<best.error)best={point,boundary,error,share:small.share};
      if(error<.3)break;
      if(small.share<targetShare)low=boundary;else high=boundary;
      boundary=(low+high)/2;
    }
    actions.push({type:'aim',bodyId,axis,targetShare,attempts:aiming});
    assert.ok(best,`no valid finite blade plan for body ${bodyId}`);
    assert.ok(best.error<Math.max(1,targetShare*.09),`could not aim requested ${targetShare}% portion: preview ${best.share}%`);
    await page.mouse.move(best.point.x,best.point.y);await page.waitForTimeout(250);
    if(spanAll){
      const s=await state(page),unserved=s.bodies.filter(b=>b.slot===null);
      // Empty-space blade placement uses the recipe's unscaled reference
      // height. A piece's physical thickness is scaled independently.
      const point={x:unserved.reduce((sum,b)=>sum+b.position[0],0)/unserved.length,y:{melon:1.22,citrus:1.3,grape:1.42}[body.flavor]*.6,z:s.knife.z};
      best.point=await page.evaluate(p=>window.__jelly.project(p.x,p.y,p.z),point);
      await page.mouse.move(best.point.x,best.point.y);await page.waitForTimeout(300);
      const plans=await page.evaluate(angle=>{const s=window.__jelly.state;return window.__jelly.preview({x:s.knife.x,y:.5,z:s.knife.z},angle)},angle);
      actions.push({type:'span-all',point,plans:plans.map(p=>({id:p.id,shares:p.parts.map(q=>q.share)}))});
      assert.equal(plans.length,unserved.length,'a centered blade must preview both halves before a double cut');
    }
    const before=await state(page),beforeIds=new Set(before.bodies.map(b=>b.id));
    await page.mouse.click(best.point.x,best.point.y);
    await page.waitForFunction(cuts=>window.__jelly.state.cuts>cuts,before.cuts,{timeout:6000});
    await page.waitForFunction(()=>!window.__jelly.state.cutting,{},{timeout:6000});await page.waitForTimeout(300);
    s=await state(page);const children=s.bodies.filter(b=>!beforeIds.has(b.id)&&b.flavor===body.flavor);
    assert.ok(children.length>=2,'cut must create real independently selectable fragments');
    const portion=children.slice().sort((a,b)=>centroid(a.poly)[axis]-centroid(b.poly)[axis])[0];
    actions.push({type:'cut',axis,targetShare,previewShare:best.share,actualShare:portion.share,cuts:s.cuts,children:children.map(b=>({id:b.id,share:b.share,rindFraction:b.rindFraction}))});
    return {portion,children};
  }
  async function plate(page,bodyId,index,actions){
    await page.locator('#drag-tool').click();
    const body=(await state(page)).bodies.find(b=>b.id===bodyId);assert.ok(body&&body.slot===null,'only a real unserved piece may be selected');
    const center=centroid(body.poly),materialPoints=[center,...body.poly.filter((_,i)=>i%Math.max(1,Math.floor(body.poly.length/6))===0).map(p=>({x:center.x*.55+p.x*.45,z:center.z*.55+p.z*.45}))];
    let picked=false;
    for(const material of materialPoints){
      const current=(await state(page)).bodies.find(b=>b.id===bodyId),inverted=current.rotation.x**2+current.rotation.z**2>.5;
      const point=await page.evaluate(({id,p,y})=>window.__jelly.projectRest(id,p.x,y,p.z),{id:bodyId,p:material,y:inverted?.035:body.height+.06});
      await page.mouse.click(point.x,point.y);if((await state(page)).selectedId===bodyId){picked=true;break}
    }
    assert.ok(picked,`could not select actual piece ${bodyId}`);
    await page.locator(`[data-slot="${index}"]`).click();
    await page.waitForFunction(({id,index})=>window.__jelly.state.bodies.find(b=>b.id===id)?.slot===index,{id:bodyId,index},{timeout:3000});
    const served=(await state(page)).bodies.find(b=>b.id===bodyId);actions.push({type:'plate',slot:index,id:bodyId,flavor:served.flavor,share:served.share,rindFraction:served.rindFraction});
  }

  for(const number of selected){
    const order=ORDERS.find(o=>o.number===number);assert.ok(order,`unknown level ${number}`);
    const entry={id:order.id,title:order.title,status:'RUNNING',buildSHA256:crypto.createHash('sha256').update(fs.readFileSync('index.html')).digest('hex'),actions:[]};report.results.push(entry);save();let context,page;
    try{
      context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1});
      const fixture=defaultProfile();for(const previous of ORDERS.filter(o=>o.number<number))fixture.completed[previous.id]={stars:1,score:0,bestSeconds:null,plays:1,accuracy:0};fixture.selectedOrderId=order.id;
      await context.addInitScript(({key,profile})=>localStorage.setItem(key,JSON.stringify(profile)),{key:STORAGE_KEY,profile:fixture});
      page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(gameURL);await page.waitForFunction(()=>window.__jelly?.state.uiState==='menu');
      await page.locator(`.level-button[data-level="${order.id}"]`).click();
      if(await page.locator('[data-action="begin"]').isVisible())await page.locator('[data-action="begin"]').click();
      await page.waitForFunction(id=>window.__jelly.state.order?.id===id&&window.__jelly.state.mode==='order',order.id);await page.waitForTimeout(900);
      assert.equal((await state(page)).profile.completed[order.id],undefined,'target order must start incomplete');
      if(number===10){
        let s=await state(page);await cutPortion(page,s.bodies[0].id,50,'x',entry.actions);s=await state(page);
        await cutPortion(page,s.bodies[0].id,25,'z',entry.actions,{spanAll:true});s=await state(page);
        assert.equal(s.cuts,2);assert.equal(s.bodies.length,4,'second real stroke must cut both halves');
        for(let i=0;i<4;i++)await plate(page,s.bodies[i].id,i,entry.actions);
      }else{
        for(const source of order.source){
          const slots=order.slots.map((slot,index)=>({...slot,index})).filter(slot=>slot.flavor===source.flavor),axis=slots.some(slot=>slot.rindMin!==undefined||slot.rindMax!==undefined)?'z':'x';
          for(const slot of slots){
            const s=await state(page),available=s.bodies.filter(b=>b.flavor===source.flavor&&b.slot===null).sort((a,b)=>b.mass-a.mass),body=available[0];assert.ok(body);
            let portion=body;
            // A valid last portion should be served. Trying to shave a tiny
            // fraction merely to chase three stars can be below cut minArea.
            const serveTolerance=Math.max(order.absoluteTolerance??2,slot.share*(order.relativeTolerance??.16));
            if(Math.abs(body.share-slot.share)>serveTolerance)portion=(await cutPortion(page,body.id,slot.share,axis,entry.actions)).portion;
            await plate(page,portion.id,slot.index,entry.actions);
          }
        }
      }
      const beforeServe=await state(page);entry.actualCuts=beforeServe.cuts;entry.board=beforeServe.bodies.map(({id,flavor,share,rindFraction,slot})=>({id,flavor,share,rindFraction,slot}));
      assert.ok(beforeServe.cuts<=order.cutBudget);await page.locator('[data-action="submit"]').click();
      await page.waitForFunction(()=>window.__jelly.state.mode==='result');
      const resultState=await state(page);entry.resultText=await page.locator('#game-dialog').innerText().catch(()=>page.locator('dialog[open]').innerText());
      assert.ok(resultState.profile.completed[order.id]?.stars>=1,entry.resultText);
      assert.deepEqual(errors,[]);entry.status='PASS';entry.stars=resultState.profile.completed[order.id].stars;entry.score=resultState.profile.completed[order.id].score;entry.elapsed=resultState.elapsed;
      console.log('PASS',order.id,order.title,`${entry.stars} stars`,`${entry.actualCuts} cuts`);
    }catch(error){entry.status='FAIL';entry.error=error.message;if(page)entry.failureState=await state(page).catch(()=>null);console.error('FAIL',order.id,error.stack)}
    finally{await context?.close();save()}
  }
  await browser.close();report.completedAt=new Date().toISOString();report.pass=report.results.filter(r=>r.status==='PASS').length;report.fail=report.results.filter(r=>r.status==='FAIL').length;save();
  console.log(JSON.stringify({pass:report.pass,fail:report.fail,report:reportPath}));if(report.fail)process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1)});
