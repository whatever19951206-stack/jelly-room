/**
 * Gameplay rules have no renderer, DOM or physics dependency.
 * A slot's `share` is a percentage (0..100) of its FLAVOR'S starting mass.
 * Mixed orders therefore deliberately have slot shares summing to 200.
 * `flavorMasses` must contain the initial masses, before any cuts or waste.
 * Plate coordinates are normalized X/Z coordinates, not screen pixels.
 */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const EPS=1e-7;
const FLAVORS=['melon','citrus','grape'];
const copy=value=>JSON.parse(JSON.stringify(value));
function deepFreeze(value){Object.freeze(value);for(const child of Object.values(value))if(child&&typeof child==='object'&&!Object.isFrozen(child))deepFreeze(child);return value}

export const CHAPTERS=deepFreeze([
  {id:1,title:'一起分着吃',subtitle:'先切开，再把每一份送到盘子里。',unlockTitle:'分食学徒'},
  {id:2,title:'眼睛就是秤',subtitle:'从一样大，到每个人都刚刚好。',unlockTitle:'分量行家'},
  {id:3,title:'每一刀都算数',subtitle:'先想路线，再动刀。',unlockTitle:'利落刀手'},
  {id:4,title:'瓜心与果皮',subtitle:'看清切面，留下客人想要的部分。',unlockTitle:'果皮侦探'},
  {id:5,title:'一盘小风景',subtitle:'摆准位置，轻轻落下。',unlockTitle:'摆盘艺人'},
  {id:6,title:'最后一桌客人',subtitle:'两种口味，一次完成。',unlockTitle:'果冻主厨'}
]);

const layouts={
  two:[[-.55,0],[.55,0]],
  triangle:[[-.58,.42],[0,-.52],[.58,.42]],
  square:[[-.52,-.4],[.52,-.4],[-.52,.4],[.52,.4]],
  row4:[[-.78,0],[-.26,0],[.26,0],[.78,0]],
  arc5:[[-.8,.35],[-.45,-.18],[0,-.42],[.45,-.18],[.8,.35]],
  six:[[-.65,-.4],[0,-.4],[.65,-.4],[-.65,.4],[0,.4],[.65,.4]]
};
function makeOrder(number,chapter,title,brief,flavor,shares,options={}){
  const flavors=Array.isArray(flavor)?flavor:[flavor];
  const mixed=flavors.length>1;
  const slots=shares.map((share,index)=>({id:`p${index+1}`,index,label:`第 ${index+1} 份`,flavor:flavors[0],share,...options.slotRules?.[index]}));
  const layout=options.layout||({2:'two',3:'triangle',4:'square',5:'arc5',6:'six'}[slots.length]);
  for(let i=0;i<slots.length;i++){
    const coords=layouts[layout]?.[i]||[0,0];
    slots[i].position={x:coords[0],z:coords[1]};
    if(options.arrangement)slots[i].tolerance=options.positionTolerance??.28;
  }
  return {
    id:`order-${String(number).padStart(2,'0')}`,number,chapter,title,brief,
    flavor:flavors[0],source:flavors.map(f=>({flavor:f,scale:mixed?.58:.77})),slots,
    cutBudget:options.cutBudget??shares.length+1,parCuts:options.parCuts??shares.length-flavors.length,
    maxWaste:options.maxWaste??.07,parSeconds:options.parSeconds??80,
    expectedSeconds:options.expectedSeconds??90,
    relativeTolerance:options.relativeTolerance??({1:.18,2:.16,3:.14,4:.16,5:.14,6:.12}[chapter]),
    absoluteTolerance:2,arrangement:!!options.arrangement,
    hint:options.hint||'先按目标分量切开，切好的每一块都可以继续修整。把每份拖进对应盘子，等它落稳后上菜。',
    unlockTitle:CHAPTERS[chapter-1].unlockTitle,
    ...options.extra
  };
}

export const ORDERS=deepFreeze([
  makeOrder(1,1,'第一位客人','一块西瓜，两个人分享。切成差不多大的两份，分别放进两个盘子。','melon',[50,50],{cutBudget:3,parCuts:1,parSeconds:65,expectedSeconds:65,hint:'沿西瓜尖角朝圆弧中点切一刀，左右两份会很接近。'}),
  makeOrder(2,1,'橙香下午茶','蜜橙也要对半分。送餐时轻一点，让两份在盘中停稳。','citrus',[50,50],{cutBudget:3,parCuts:1,parSeconds:60,expectedSeconds:60,hint:'圆心附近下刀。按住切下的果冻拖向盘子，松手后再检查分量。'}),
  makeOrder(3,1,'三人小聚','三个人都想尝一口葡萄。分成三份，每份约占整块的三分之一。','grape',[100/3,100/3,100/3],{cutBudget:4,parCuts:2,parSeconds:70,expectedSeconds:75}),
  makeOrder(4,1,'四人一桌','做四份西瓜。每只盘子只放一块，桌上尽量不留碎屑。','melon',[25,25,25,25],{cutBudget:5,parCuts:3,parSeconds:85,expectedSeconds:85,hint:'先对半，再把两半分别对半。先移开已切好的部分，会更容易瞄准。'}),

  makeOrder(5,2,'大胃口与小胃口','这次不用平均分：大份 60%，小份 40%。','melon',[60,40],{cutBudget:3,parCuts:1,parSeconds:75,expectedSeconds:80}),
  makeOrder(6,2,'一大两小','给蜜橙做一份正餐、一份下午茶和一份试吃：50%、30%、20%。','citrus',[50,30,20],{cutBudget:4,parCuts:2,parSeconds:85,expectedSeconds:90,hint:'先取一半，再把剩余的一半按三比二分开。比例都是相对于最初那整块蜜橙。'}),
  makeOrder(7,2,'给主角留大份','葡萄大份占 40%，另外三份各 20%。先把最难估计的大份留出来。','grape',[40,20,20,20],{cutBudget:5,parCuts:3,parSeconds:90,expectedSeconds:95}),
  makeOrder(8,2,'四种胃口','10%、20%、30%、40%，谁也不一样。小份可以少一点，不能把盘子留空。','melon',[10,20,30,40],{cutBudget:5,parCuts:3,parSeconds:100,expectedSeconds:105,hint:'先切出约四成，再从剩下的六成里取三成、两成，最后留下小份。'}),

  makeOrder(9,3,'只用一刀','这次只有一次切割机会。想好方向，再做两份各 50% 的西瓜。','melon',[50,50],{cutBudget:1,parCuts:1,parSeconds:65,expectedSeconds:80,hint:'刀数按一次落刀计数。还没松手时可以调整切线，松手后就会下刀。'}),
  makeOrder(10,3,'十字刀法','两刀、四份蜜橙。试试让第二刀同时穿过两块。','citrus',[25,25,25,25],{cutBudget:2,parCuts:2,parSeconds:85,expectedSeconds:100,hint:'第一刀经过圆心，第二刀与它垂直。暂时别拉开两半，让第二刀同时切到它们。'}),
  makeOrder(11,3,'先留一半','两刀完成葡萄的 50%、25%、25%。第二刀只切需要分小的那一半。','grape',[50,25,25],{cutBudget:2,parCuts:2,parSeconds:80,expectedSeconds:95}),
  makeOrder(12,3,'五份不多刀','最多四刀，把西瓜分成五份各 20%。用完刀数后仍然可以自由摆盘。','melon',[20,20,20,20,20],{cutBudget:4,parCuts:4,parSeconds:115,expectedSeconds:120,hint:'先估出一份两成的大小，后面的切口再参照它。切好的块先移开，避免被下一刀再次切到。'}),

  makeOrder(13,4,'只要瓜心','只上一份占整块 35% 的瓜心。白边与绿皮合计不能超过这份的 3%；其余留在桌上。','melon',[35],{cutBudget:3,parCuts:1,maxWaste:.67,parSeconds:85,expectedSeconds:100,slotRules:[{label:'无皮瓜心',rindMax:.03}],hint:'尖角附近是瓜心，圆弧外缘是果皮。横向切下靠近尖角的约三分之一，剩下的无需上盘。'}),
  makeOrder(14,4,'皮肉分开','70% 的大份偏瓜心，30% 的小份保留更多果皮。两份都要上盘。','melon',[70,30],{cutBudget:3,parCuts:1,parSeconds:100,expectedSeconds:110,slotRules:[{label:'大份瓜心',rindMax:.19},{label:'带皮小份',rindMin:.32}],hint:'沿着圆弧内侧横切。小份要从圆弧外侧取，不能只按重量随意切。'}),
  makeOrder(15,4,'一圈清脆','取 80% 的西瓜主体和 20% 的带皮边。小份至少一半是白边或绿皮。','melon',[80,20],{cutBudget:3,parCuts:1,parSeconds:100,expectedSeconds:115,slotRules:[{label:'西瓜主体',rindMax:.18},{label:'清脆带皮边',rindMin:.50}],hint:'把刀向圆弧外侧再挪一点。白色过渡层也算果皮。'}),
  makeOrder(16,4,'从瓜心到果皮','35% 的纯瓜心、40% 的过渡部分、25% 的带皮边，三层各有味道。','melon',[35,40,25],{cutBudget:3,parCuts:2,parSeconds:115,expectedSeconds:125,slotRules:[{label:'瓜心',rindMax:.03},{label:'过渡部分',rindMax:.30},{label:'带皮边',rindMin:.40}],hint:'用两条大致平行的横切线，从尖角到圆弧依次取三层。'}),

  makeOrder(17,5,'三角下午茶','三份等重葡萄，摆成一个三角形。每份的中心要落在盘面标记附近。','grape',[100/3,100/3,100/3],{arrangement:true,layout:'triangle',cutBudget:4,parCuts:2,parSeconds:100,expectedSeconds:110,hint:'先分量，再摆盘。抓住靠近中心的位置慢慢拖，松手后让果冻停稳。'}),
  makeOrder(18,5,'从小到大','四份蜜橙按 15%、20%、30%、35% 从左向右排好。','citrus',[15,20,30,35],{arrangement:true,layout:'row4',positionTolerance:.25,cutBudget:5,parCuts:3,parSeconds:110,expectedSeconds:120}),
  makeOrder(19,5,'轻轻一抛','两份各 50% 的西瓜，落稳后即可上菜。试着带一点速度松手，让果冻轻轻落进盘子，可获得轻抛加分。','melon',[50,50],{cutBudget:3,parCuts:1,parSeconds:110,expectedSeconds:120,slotRules:[{label:'左份 · 轻抛加分',tossBonus:true},{label:'右份 · 轻抛加分',tossBonus:true}],hint:'抓住一份移向盘子，稍微带一点速度松手。只需轻抛，不用甩很远；轻抛不是过关要求。'}),
  makeOrder(20,5,'月牙小宴','五份等重西瓜沿月牙形排开。让摆盘和分量一样整齐。','melon',[20,20,20,20,20],{arrangement:true,layout:'arc5',positionTolerance:.25,cutBudget:5,parCuts:4,parSeconds:120,expectedSeconds:130}),

  makeOrder(21,6,'双色分享','西瓜和蜜橙分别对半，四份各归其位。每种口味的百分比都从它自己的整块算起。',['melon','citrus'],[50,50,50,50],{cutBudget:3,parCuts:2,parSeconds:115,expectedSeconds:120,slotRules:[{flavor:'melon',label:'西瓜 A'},{flavor:'melon',label:'西瓜 B'},{flavor:'citrus',label:'蜜橙 A'},{flavor:'citrus',label:'蜜橙 B'}],hint:'先完成一种口味再动另一种。50% 西瓜就是最初那块西瓜的一半，与蜜橙的大小无关。'}),
  makeOrder(22,6,'双味六人桌','西瓜与葡萄都分成 50%、30%、20%，共六份。别把口味送错盘。',['melon','grape'],[50,30,20,50,30,20],{layout:'six',cutBudget:5,parCuts:4,parSeconds:125,expectedSeconds:135,slotRules:[{flavor:'melon',label:'西瓜大份'},{flavor:'melon',label:'西瓜中份'},{flavor:'melon',label:'西瓜小份'},{flavor:'grape',label:'葡萄大份'},{flavor:'grape',label:'葡萄中份'},{flavor:'grape',label:'葡萄小份'}]}),
  makeOrder(23,6,'五色位，三刀法','蜜橙分 40% 与 60%；葡萄分 25%、25%、50%。三刀完成，再摆成月牙。',['citrus','grape'],[40,60,25,25,50],{arrangement:true,layout:'arc5',positionTolerance:.25,cutBudget:3,parCuts:3,parSeconds:125,expectedSeconds:140,slotRules:[{flavor:'citrus',label:'蜜橙小份'},{flavor:'citrus',label:'蜜橙大份'},{flavor:'grape',label:'葡萄小份 A'},{flavor:'grape',label:'葡萄小份 B'},{flavor:'grape',label:'葡萄大份'}]}),
  makeOrder(24,6,'最后一桌，刚刚好','西瓜做 35% 瓜心、40% 过渡、25% 带皮；蜜橙对半。四刀以内，五份摆准，完成毕业宴。',['melon','citrus'],[35,40,25,50,50],{arrangement:true,layout:'arc5',positionTolerance:.24,cutBudget:4,parCuts:3,parSeconds:145,expectedSeconds:160,slotRules:[{flavor:'melon',label:'瓜心',rindMax:.03},{flavor:'melon',label:'过渡部分',rindMax:.30},{flavor:'melon',label:'带皮边',rindMin:.40},{flavor:'citrus',label:'蜜橙 A'},{flavor:'citrus',label:'蜜橙 B'}],hint:'先用两刀完成西瓜的三层，再对半切蜜橙。分量、果皮、口味与位置都检查好再上菜。'})
]);

export function getOrder(id){return ORDERS.find(order=>order.id===id)||null}
export const CAMPAIGN_EXPECTED_SECONDS=ORDERS.reduce((sum,order)=>sum+order.expectedSeconds,0);

function massLedger(order,snapshot){
  const initial=snapshot.flavorMasses||(snapshot.totalMass&&typeof snapshot.totalMass==='object'?snapshot.totalMass:null);
  const flavors=[...new Set(order.source.map(source=>source.flavor))];
  if(initial){
    const ledger=Object.fromEntries(flavors.map(flavor=>[flavor,initial[flavor]]));
    if(Object.values(ledger).some(mass=>!finite(mass)||mass<=0))return null;
    if(finite(snapshot.totalMass)&&Math.abs(Object.values(ledger).reduce((a,b)=>a+b,0)-snapshot.totalMass)>Math.max(EPS,snapshot.totalMass*1e-5))return null;
    return ledger;
  }
  return flavors.length===1&&finite(snapshot.totalMass)&&snapshot.totalMass>0?{[flavors[0]]:snapshot.totalMass}:null;
}
function actualSlot(piece,slots){
  if(piece.slot===null||piece.slot===undefined||piece.slot===-1||piece.slot==='')return null;
  if(Number.isInteger(piece.slot))return slots[piece.slot]?.id??'invalid';
  return slots.some(slot=>slot.id===piece.slot)?piece.slot:'invalid';
}
function distance(a,b){return Math.hypot(a.x-b.x,a.z-b.z)}

/** Pieces must describe the real board, including unserved scraps. */
export function evaluateOrder(order,snapshot={}){
  const checks=[];
  const add=(id,label,passed,detail,extra={})=>checks.push({id,label,passed:!!passed,detail,...extra});
  const failed=(reason)=>({passed:false,stars:0,score:0,reason,checks,accuracy:0,waste:1,timeBonus:0,elapsed:finite(snapshot.elapsed)?snapshot.elapsed:0,cuts:finite(snapshot.cuts)?snapshot.cuts:0});
  if(!order||!Array.isArray(order.slots)||!Array.isArray(order.source)||!Array.isArray(snapshot.pieces))return failed('这张订单或桌面状态不完整，请重新开始这一单。');
  const ledger=massLedger(order,snapshot);
  add('ledger','初始分量',!!ledger,'无法确认每种口味最初的分量。');
  if(!ledger)return failed(checks[0].detail);
  const totalMass=Object.values(ledger).reduce((a,b)=>a+b,0),pieces=snapshot.pieces;
  const ids=new Set(),valid=pieces.every(piece=>{
    if(!piece||piece.id===null||piece.id===undefined||ids.has(String(piece.id))||!finite(piece.mass)||piece.mass<=0||!Object.hasOwn(ledger,piece.flavor))return false;
    ids.add(String(piece.id));return true;
  });
  add('pieces','真实分块',valid,'果冻的编号、口味或分量无效。请使用桌上真实存在的果冻。');
  if(!valid)return failed(checks.at(-1).detail);
  const massByFlavor=Object.fromEntries(Object.keys(ledger).map(flavor=>[flavor,0]));
  for(const piece of pieces)massByFlavor[piece.flavor]+=piece.mass;
  add('conservation','分量守恒',Object.keys(ledger).every(flavor=>massByFlavor[flavor]<=ledger[flavor]*(1+1e-5)),'当前分块超过了原始分量，请重新开始这一单。');
  add('cuts','刀数',Number.isInteger(snapshot.cuts)&&snapshot.cuts>=0&&snapshot.cuts<=order.cutBudget,`这单最多 ${order.cutBudget} 刀，已经用了 ${snapshot.cuts} 刀。`,{actual:snapshot.cuts,target:order.cutBudget});
  add('clock','用时',finite(snapshot.elapsed)&&snapshot.elapsed>=0,'用时记录无效。');
  if(finite(order.timeLimit))add('deadline','挑战时限',snapshot.elapsed<=order.timeLimit,`本轮需要在 ${order.timeLimit} 秒内上菜。`);
  const assignments=new Map(order.slots.map(slot=>[slot.id,[]]));
  let servedMass=0,unknown=false;
  for(const piece of pieces){const slot=actualSlot(piece,order.slots);if(slot==='invalid')unknown=true;else if(slot!==null){assignments.get(slot).push(piece);servedMass+=piece.mass}}
  add('known-plates','盘子位置',!unknown,'有果冻放在了这张订单以外的盘位。');
  const errors=[];
  for(const slot of order.slots){
    const selected=assignments.get(slot.id),label=slot.label||slot.id;
    add(`${slot.id}:count`,label,selected.length===1,selected.length===0?`「${label}」还没有果冻。`:`「${label}」只能放一块，先把多余的移开。`,{actual:selected.length,target:1});
    if(selected.length!==1)continue;
    const piece=selected[0],share=piece.mass/ledger[slot.flavor]*100;
    const tolerance=Math.max(order.absoluteTolerance??2,slot.share*(order.relativeTolerance??.16));
    const error=Math.abs(share-slot.share);errors.push({error,target:slot.share});
    add(`${slot.id}:flavor`,label,piece.flavor===slot.flavor,`「${label}」的口味不对。`,{actual:piece.flavor,target:slot.flavor});
    add(`${slot.id}:share`,label,finite(share)&&error<=tolerance+EPS,`「${label}」目标 ${formatShare(slot.share)}%，现在是 ${formatShare(share)}%。`,{actual:share,target:slot.share,tolerance});
    add(`${slot.id}:settled`,label,piece.settled===true&&finite(piece.height)&&piece.height>=-.05&&piece.height<=(order.maxServeHeight??2.6)&&finite(piece.speed)&&piece.speed>=0&&piece.speed<=(order.maxServeSpeed??.65),`「${label}」还没落稳，等它停下来再上菜。`);
    if(finite(slot.rindMin)||finite(slot.rindMax)){
      const rind=piece.rindFraction;
      add(`${slot.id}:rind`,label,finite(rind)&&rind>=0&&rind<=1&&(!finite(slot.rindMin)||rind+EPS>=slot.rindMin)&&(!finite(slot.rindMax)||rind-EPS<=slot.rindMax),`「${label}」的果皮比例不合适。${finite(slot.rindMin)?`至少需要 ${Math.round(slot.rindMin*100)}% 果皮。`:`果皮不能超过 ${Math.round(slot.rindMax*100)}%。`}`,{actual:rind,min:slot.rindMin,max:slot.rindMax});
    }
    if(order.arrangement||finite(slot.tolerance)){
      const position=piece.position,validPosition=position&&finite(position.x)&&finite(position.z),offset=validPosition?distance(position,slot.position):Infinity;
      add(`${slot.id}:position`,label,offset<=(slot.tolerance??.28)+EPS,`「${label}」离盘面标记有点远，再往中心挪一点。`,{actual:offset,target:slot.tolerance??.28});
    }
    if(slot.tossRequired)add(`${slot.id}:toss`,label,piece.tossed===true,`「${label}」还需要一次轻抛：带一点速度松手，再让它落稳。`);
    else if(slot.tossBonus)add(`${slot.id}:toss`,label,piece.tossed===true,piece.tossed?'轻抛落盘，加分！':'可选加分：带一点速度松手，再让果冻落稳。',{optional:true});
  }
  const waste=clamp((totalMass-servedMass)/totalMass,0,1);
  add('waste','剩余分量',waste<=(order.maxWaste??.07)+EPS,`桌上还有 ${Math.round(waste*100)}% 没有上盘，这单最多可留 ${Math.round((order.maxWaste??.07)*100)}%。`,{actual:waste,target:order.maxWaste??.07});
  const relativeError=errors.length===order.slots.length?errors.reduce((sum,e)=>sum+e.error/Math.max(e.target,1),0)/errors.length:1;
  const accuracy=clamp(100-relativeError*200,0,100);
  const passed=checks.every(check=>check.optional||check.passed);
  const timeBonus=finite(snapshot.elapsed)?Math.round(50*clamp(2-snapshot.elapsed/Math.max(1,order.parSeconds||90),0,1)):0;
  const cutBonus=Number.isInteger(snapshot.cuts)?Math.round(100*clamp(1-Math.max(0,snapshot.cuts-(order.parCuts??order.cutBudget))/Math.max(1,order.cutBudget),0,1)):0;
  let stars=0;
  if(passed){
    stars=1;
    if(errors.every(e=>e.error<=Math.max(1.25,e.target*.09)+EPS))stars=2;
    if(errors.every(e=>e.error<=Math.max(.7,e.target*.045)+EPS)&&snapshot.cuts<=(order.parCuts??order.cutBudget))stars=3;
  }
  const tossBonus=checks.filter(check=>check.optional&&check.passed).length*25;
  const score=Math.round(clamp(accuracy*8.5+cutBonus+timeBonus+tossBonus,0,1000));
  return {passed,stars,score,reason:passed?(stars===3?'分量、刀法、摆盘都刚刚好。':stars===2?'上菜成功！分量已经很接近了。':'上菜成功！下一次可以再精确一点。'):checks.find(check=>!check.optional&&!check.passed).detail,checks,accuracy,waste,timeBonus,tossBonus,elapsed:snapshot.elapsed,cuts:snapshot.cuts};
}
export function formatShare(value){return finite(value)?Number(value.toFixed(1)).toString():'—'}

function seedValue(seed){const text=String(seed);let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}return hash>>>0}
function seeded(seed){let value=seedValue(seed);return ()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}

/** A seed identifies a reproducible order; difficulty increases variety, not waiting. */
export function generateOrder(seed,{mode='practice',difficulty=1}={}){
  mode=mode==='challenge'?'challenge':'practice';difficulty=clamp(Math.floor(Number(difficulty)||1),1,12);
  const random=seeded(`${mode}:${seed}:${difficulty}`),flavor=FLAVORS[Math.floor(random()*FLAVORS.length)];
  const count=clamp(2+Math.floor(random()*(2+Math.floor(difficulty/4))),2,5);
  const equal=random()<.35,weights=Array.from({length:count},()=>1+Math.floor(random()*4)),sum=weights.reduce((a,b)=>a+b,0);
  const shares=equal?weights.map(()=>100/count):weights.map(weight=>weight/sum*100);
  const arrangement=difficulty>=4&&random()<.55;
  const order=makeOrder(1,mode==='challenge'?3:2,mode==='challenge'?`连单挑战 · 第 ${difficulty} 档`:'今日练习单',`把${{melon:'西瓜',citrus:'蜜橙',grape:'葡萄'}[flavor]}分成 ${count} 份，送入对应盘子。${arrangement?'这一单还要摆准位置。':''}`,flavor,shares,{cutBudget:count-1+(mode==='practice'?2:difficulty>=5?0:1),parCuts:count-1,arrangement,relativeTolerance:mode==='practice'?.16:Math.max(.10,.16-difficulty*.005),parSeconds:60+count*16,expectedSeconds:70+count*18});
  order.id=`${mode}-${seedValue(seed).toString(36)}-${difficulty}`;order.mode=mode;order.seed=String(seed);order.difficulty=difficulty;order.chapter=0;order.number=0;order.unlockTitle='自由练习';
  if(mode==='challenge')order.timeLimit=150+count*15;
  return deepFreeze(order);
}

export const ACHIEVEMENTS=deepFreeze([
  {id:'first-order',title:'开门营业',description:'完成第一张订单。'},
  {id:'first-perfect',title:'刚刚好',description:'任意一单获得三星。'},
  {id:'sharing',title:'大家都有份',description:'完成「一起分着吃」四单。'},
  {id:'rind-expert',title:'看得见瓜心',description:'完成全部果皮分拣订单。'},
  {id:'soft-landing',title:'轻手轻脚',description:'在「轻轻一抛」中获得轻抛加分并成功上菜。'},
  {id:'plating',title:'一盘小风景',description:'完成全部摆盘章节订单。'},
  {id:'graduate',title:'果冻主厨',description:'完成全部 24 张订单。'},
  {id:'sixty-stars',title:'满天小星星',description:'累计获得 60 颗订单星星。'},
  {id:'practice-five',title:'手感越来越好',description:'成功完成 5 张练习单。'},
  {id:'practice-ten',title:'忙而不乱',description:'成功完成 10 张练习单。'},
  {id:'no-waste',title:'一块也不浪费',description:'3 次上菜留下的分量不超过 1%。'}
]);

export const STORAGE_KEY='jelly-room.progress.v1';
export function defaultProfile(){return {version:1,completed:{},achievements:[],selectedOrderId:ORDERS[0].id,resume:{mode:'campaign',orderId:ORDERS[0].id,seed:'1',streak:0},practice:{completed:0,bestScore:0},challenge:{completed:0,bestScore:0,bestStreak:0},stats:{ordersServed:0,totalCuts:0,lowWasteOrders:0,tossOrders:0}}}
const safeInt=(value,max=1e9)=>finite(value)?clamp(Math.floor(value),0,max):0;
export function isUnlocked(profile,id){const index=ORDERS.findIndex(order=>order.id===id);return index>=0&&ORDERS.slice(0,index).every(order=>(profile?.completed?.[order.id]?.stars||0)>=1)}
export function nextOrderId(profile){return ORDERS.find(order=>!(profile?.completed?.[order.id]?.stars>=1))?.id||ORDERS.at(-1).id}
function earnedAchievements(profile){
  const done=profile.completed,chapterComplete=chapter=>ORDERS.filter(order=>order.chapter===chapter).every(order=>done[order.id]?.stars>=1);
  const earned=[];
  if(done[ORDERS[0].id])earned.push('first-order');
  if(Object.values(done).some(record=>record.stars===3))earned.push('first-perfect');
  if(chapterComplete(1))earned.push('sharing');
  if(chapterComplete(4))earned.push('rind-expert');
  if(profile.stats.tossOrders>0)earned.push('soft-landing');
  if(chapterComplete(5))earned.push('plating');
  if(ORDERS.every(order=>done[order.id]))earned.push('graduate');
  if(Object.values(done).reduce((sum,record)=>sum+record.stars,0)>=60)earned.push('sixty-stars');
  if(profile.practice.completed>=5)earned.push('practice-five');
  if(profile.practice.completed>=10)earned.push('practice-ten');
  if(profile.stats.lowWasteOrders>=3)earned.push('no-waste');
  return earned;
}
export function sanitizeProfile(input){
  const profile=defaultProfile();if(!input||typeof input!=='object')return profile;
  for(const order of ORDERS){
    const record=input.completed?.[order.id];
    if(!record||!Number.isInteger(record.stars)||record.stars<1||record.stars>3)continue;
    profile.completed[order.id]={stars:record.stars,score:safeInt(record.score,1000),bestSeconds:finite(record.bestSeconds)&&record.bestSeconds>=0?record.bestSeconds:null,plays:Math.max(1,safeInt(record.plays)),accuracy:finite(record.accuracy)?clamp(record.accuracy,0,100):0};
  }
  for(const mode of ['practice','challenge'])for(const key of Object.keys(profile[mode]))profile[mode][key]=safeInt(input[mode]?.[key],key==='bestScore'?1000:1e9);
  for(const key of Object.keys(profile.stats))profile.stats[key]=safeInt(input.stats?.[key]);
  profile.selectedOrderId=isUnlocked(profile,input.selectedOrderId)?input.selectedOrderId:nextOrderId(profile);
  const resume=input.resume;
  if(resume&&['campaign','practice','challenge','sandbox'].includes(resume.mode))profile.resume={mode:resume.mode,orderId:isUnlocked(profile,resume.orderId)?resume.orderId:profile.selectedOrderId,seed:typeof resume.seed==='string'?resume.seed.slice(0,100):'1',streak:safeInt(resume.streak,10000)};
  else profile.resume.orderId=profile.selectedOrderId;
  const validIds=new Set(ACHIEVEMENTS.map(achievement=>achievement.id));
  profile.achievements=[...new Set([...(Array.isArray(input.achievements)?input.achievements.filter(id=>validIds.has(id)):[]),...earnedAchievements(profile)])];
  return profile;
}
export function loadProfile(storage){try{return sanitizeProfile(JSON.parse((storage??globalThis.localStorage).getItem(STORAGE_KEY)||'null'))}catch{return defaultProfile()}}
export function saveProfile(profile,storage){try{(storage??globalThis.localStorage).setItem(STORAGE_KEY,JSON.stringify(sanitizeProfile(profile)));return true}catch{return false}}

/** Call once when a real serve succeeds. Replays never erase prior stars/scores. */
export function completeOrder(input,id,result){
  const profile=sanitizeProfile(input),order=getOrder(id);
  if(!order||!isUnlocked(profile,id)||!result?.passed||!Number.isInteger(result.stars)||result.stars<1||result.stars>3)return profile;
  const previous=profile.completed[id],seconds=finite(result.elapsed)&&result.elapsed>=0?result.elapsed:null;
  profile.completed[id]={stars:Math.max(previous?.stars||0,result.stars),score:Math.max(previous?.score||0,safeInt(result.score,1000)),bestSeconds:previous?.bestSeconds==null?seconds:seconds==null?previous.bestSeconds:Math.min(previous.bestSeconds,seconds),plays:(previous?.plays||0)+1,accuracy:Math.max(previous?.accuracy||0,finite(result.accuracy)?clamp(result.accuracy,0,100):0)};
  profile.stats.ordersServed++;profile.stats.totalCuts+=safeInt(result.cuts);if(finite(result.waste)&&result.waste<=.01+EPS)profile.stats.lowWasteOrders++;if(id==='order-19'&&result.tossBonus>0)profile.stats.tossOrders++;
  profile.selectedOrderId=nextOrderId(profile);profile.resume={...profile.resume,mode:'campaign',orderId:profile.selectedOrderId,streak:0};
  profile.achievements=[...new Set([...profile.achievements,...earnedAchievements(profile)])];return profile;
}
export function recordGeneratedResult(input,order,result,{streak=0}={}){
  const profile=sanitizeProfile(input),mode=order?.mode;
  if(!['practice','challenge'].includes(mode))return profile;
  const priorStreak=safeInt(streak,10000),nextStreak=result?.passed?priorStreak+1:0;
  if(result?.passed){profile[mode].completed++;profile[mode].bestScore=Math.max(profile[mode].bestScore,safeInt(result.score,1000));profile.stats.ordersServed++;profile.stats.totalCuts+=safeInt(result.cuts);if(finite(result.waste)&&result.waste<=.01+EPS)profile.stats.lowWasteOrders++;if(mode==='challenge')profile.challenge.bestStreak=Math.max(profile.challenge.bestStreak,nextStreak)}
  profile.resume={...profile.resume,mode,seed:String(order.seed??'1').slice(0,100),streak:mode==='challenge'?nextStreak:0};profile.achievements=[...new Set([...profile.achievements,...earnedAchievements(profile)])];return profile;
}

/** Exact signed line/arc integration; no sample grid or polygonized circle. */
export function polygonCircleArea(poly,center={x:0,z:0},radius=1){
  if(!Array.isArray(poly)||poly.length<3||!finite(radius)||radius<=0||!finite(center.x)||!finite(center.z))return 0;
  let sum=0;
  for(let i=0;i<poly.length;i++){
    const a={x:poly[i].x-center.x,z:poly[i].z-center.z},b={x:poly[(i+1)%poly.length].x-center.x,z:poly[(i+1)%poly.length].z-center.z};
    if(!finite(a.x)||!finite(a.z)||!finite(b.x)||!finite(b.z))return 0;
    const dx=b.x-a.x,dz=b.z-a.z,A=dx*dx+dz*dz,B=2*(a.x*dx+a.z*dz),C=a.x*a.x+a.z*a.z-radius*radius,ts=[0,1],discriminant=B*B-4*A*C;
    if(A>1e-20&&discriminant>=0){const d=Math.sqrt(discriminant);for(const t of [(-B-d)/(2*A),(-B+d)/(2*A)])if(t>0&&t<1)ts.push(t)}
    ts.sort((x,y)=>x-y);
    for(let j=0;j<ts.length-1;j++){
      const t0=ts[j],t1=ts[j+1],p={x:a.x+dx*t0,z:a.z+dz*t0},q={x:a.x+dx*t1,z:a.z+dz*t1},mx=a.x+dx*(t0+t1)/2,mz=a.z+dz*(t0+t1)/2,cross=p.x*q.z-p.z*q.x;
      sum+=mx*mx+mz*mz<=radius*radius+1e-12?cross/2:radius*radius*Math.atan2(cross,p.x*q.x+p.z*q.z)/2;
    }
  }
  return Math.abs(sum);
}
function polygonArea(poly){let sum=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];sum+=a.x*b.z-b.x*a.z}return Math.abs(sum)/2}

/** White pith and green/orange skin count as rind; grape has no rind.
 * Pass polygons in their original material coordinates. Set scale only if
 * those coordinates, including their original center, were scaled too.
 */
export function rindFraction(poly,flavor='melon',scale=1){
  if(flavor==='grape')return 0;
  if(!Array.isArray(poly)||poly.length<3||!finite(scale)||scale<=0)return 0;
  let normalized,radius;
  if(flavor==='melon'){normalized=poly.map(p=>({x:p.x/scale,z:p.z/scale+2.1}));radius=3.76}
  else if(flavor==='citrus'){normalized=poly.map(p=>({x:p.x/(3.05*scale),z:p.z/(2.66*scale)}));radius=.88}
  else return 0;
  const total=polygonArea(normalized);return total>EPS?clamp(1-polygonCircleArea(normalized,{x:0,z:0},radius)/total,0,1):0;
}
