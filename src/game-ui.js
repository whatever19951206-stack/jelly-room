const $ = (selector, root = document) => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fraction = value => typeof value === 'object' ? finite(value?.share ?? value?.target ?? value?.amount) : finite(value);
// Shares and accuracy are percentage points (0..100); rind/waste use 0..1.
const percent = value => `${Number(fraction(value).toFixed(1))}%`;
const ratioPercent = value => percent(finite(value)*100);
const clock = value => {const time = Math.max(0, Math.floor(finite(value))); return `${String(Math.floor(time / 60)).padStart(2,'0')}:${String(time % 60).padStart(2,'0')}`;};
const title = level => level?.title || level?.name || '今日的一份心意';
const starCount = value => Math.max(0, Math.min(3, Math.round(finite(typeof value === 'object' ? value?.stars : value))));
const stars = count => `<span class="game-stars" aria-label="${starCount(count)} 颗星"><span>${'★'.repeat(starCount(count))}</span>${'☆'.repeat(3 - starCount(count))}</span>`;
const icons = {
 arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>', home:'<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',
 undo:'<path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14"/>', retry:'<path d="M4 10a8 8 0 1 1 0 5M4 4v6h6"/>',
 hint:'<path d="M8 17c0-3-3-4-3-8a7 7 0 0 1 14 0c0 4-3 5-3 8ZM9 21h6M9 17h6"/>',
 check:'<path d="m5 12 4 4L20 5"/>', lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
 plate:'<ellipse cx="12" cy="14" rx="9" ry="5"/><path d="M4 14c3 3 13 3 16 0M8 8c-2-3 3-2 1-5m6 5c-2-3 3-2 1-5"/>',
 book:'<path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v16"/>',
 seed:'<path d="M12 2c-3 5-7 9-7 13a7 7 0 0 0 14 0c0-4-4-8-7-13Z"/>',
};
const icon = (name, className = '') => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.seed}</svg>`;
const fruitMergeEntry = `<button class="menu-fruit-entry" data-action="fruitMerge"><svg class="menu-fruit-art" viewBox="0 0 92 72" aria-hidden="true"><defs><radialGradient id="menu-melon"><stop stop-color="#9bbf55"/><stop offset="1" stop-color="#438557"/></radialGradient><radialGradient id="menu-orange"><stop stop-color="#ffd487"/><stop offset="1" stop-color="#ed9233"/></radialGradient></defs><ellipse cx="48" cy="64" rx="35" ry="5" fill="#677b49" opacity=".1"/><circle cx="57" cy="36" r="29" fill="url(#menu-melon)"/><path d="M42 11q-15 25 0 49M55 7q-14 29 0 58M69 11q-8 27 0 50" fill="none" stroke="#326b45" stroke-width="5" opacity=".6"/><path d="M57 9a27 27 0 0 1 23 41L57 37Z" fill="#e9edc2"/><path d="M59 13a23 23 0 0 1 18 32L59 35Z" fill="#e86b76"/><path d="m66 25 1 3m6 3 1 3m-7-14 1 3" stroke="#613735" stroke-width="2" stroke-linecap="round"/><circle cx="27" cy="42" r="18" fill="url(#menu-orange)"/><path d="M16 35q3-7 10-7" stroke="#fff0c9" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M27 24q4-9 12-6-2 9-12 6" fill="#70974e"/><circle cx="15" cy="59" r="8" fill="#cb5261"/><circle cx="28" cy="60" r="8" fill="#e47889"/><path d="M15 51q4-19 15-20M28 52q1-14 2-21" stroke="#638746" stroke-width="2" fill="none"/><path d="m49 17 7-3" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/></svg><span><b>果冻大西瓜 <em>NEW</em></b><small>软软碰一下，两颗长成一颗。</small></span>${icon('arrow')}</button>`;

/** DOM-only front end. The host owns physics, scoring, persistence and state transitions. */
export class GameUI {
 constructor(callbacks = {}) {
  this.callbacks = callbacks;
  this.app = $('#app');
  this.state = 'menu';
  this.level = null;
  this.menuData = {profile:{}, levels:[], chapters:[], achievements:[]};
  this.root = document.createElement('div');
  this.root.id = 'game-ui';
  this.root.innerHTML = `<section id="game-menu-screen" class="game-menu-screen" aria-label="果冻小店主菜单"></section>
   <section id="order-hud" class="order-hud" hidden aria-label="当前订单">
    <article class="order-ticket"><div class="order-ticket-top"><span id="order-number">ORDER 01 / 24</span><span id="order-chapter"></span></div><h2 id="order-title"></h2><p id="order-description"></p><div class="order-metrics"><span>已用 <b id="order-time">00:00</b></span><span>切了 <b id="order-cuts">0</b><small id="order-budget"></small> 刀</span><span id="order-piece" class="order-piece">切下合适的一块，再装盘</span></div></article>
    <nav class="order-actions" aria-label="订单操作"><button data-action="menu" title="回到订单册">${icon('book')}<span>订单册</span></button><button data-action="undo" id="order-undo" title="撤销上一次切割">${icon('undo')}<span>撤销</span></button><button data-action="hint" title="看看提示">${icon('hint')}<span>提示</span></button><button data-action="retry" title="重做这一单">${icon('retry')}<span>重做</span></button></nav>
    <div id="order-slots" class="order-slots" aria-label="装盘区"></div>
    <button id="order-submit" class="order-submit" data-action="submit" disabled>${icon('plate')}<span>先把果冻装盘<small id="submit-caption">把碎块拖到下方订单盘</small></span></button>
   </section>`;
  this.app.append(this.root);
  this.menu = $('#game-menu-screen',this.root);
  this.hud = $('#order-hud',this.root);
  this.dialog = document.createElement('dialog');
  this.dialog.id = 'game-dialog';this.dialog.className = 'game-dialog';
  this.dialog.setAttribute('aria-labelledby','game-dialog-title');
  document.body.append(this.dialog);
  this.root.addEventListener('click', event => this._handleClick(event));
  this.dialog.addEventListener('click', event => this._handleClick(event));
  this.dialog.addEventListener('cancel', event => {event.preventDefault();if(this.state !== 'result')this._closeDialog();});
  $('#sandbox-menu')?.addEventListener('click', () => this._call('onMenu'));
  this._setState('menu');
 }

 _call(name, ...args) {return this.callbacks[name]?.(...args);}
 _setState(state) {
  this.state = state;
  this.app.classList.toggle('main-menu', state === 'menu' || state === 'onboarding');
  this.app.classList.toggle('playing-order', state === 'order' || state === 'result' || state === 'hint');
  this.app.classList.toggle('sandbox', state === 'sandbox');
  this.app.classList.toggle('playing-blocks', state === 'blocks');
  this.app.classList.toggle('playing-fruit-merge', state === 'fruitMerge');
  $('#sandbox-menu').hidden = state !== 'sandbox';
  this._call('onStateChange', state);
 }
 _closeDialog() {
  if(this.dialog.open)this.dialog.close();
  const returnState = this.dialogReturnState || (this.level ? 'order' : 'menu');
  this._setState(returnState);
  if(returnState === 'order' || returnState === 'sandbox')this._call('onResume');
 }
 _handleClick(event) {
  const button = event.target.closest('button[data-action]');
  if(!button || button.disabled)return;
  const action = button.dataset.action;
  if(action === 'start')return this._requestStart(button.dataset.level);
  if(action === 'begin'){const id = this.pendingLevelId;this.dialog.close();this._setState('order');return this._call('onStart',id);}
  if(action === 'sandbox'){this.dialog.open && this.dialog.close();return this._call('onSandbox');}
  if(action === 'blocks'){this.dialog.open && this.dialog.close();return this._call('onBlocks');}
  if(action === 'fruitMerge'){this.dialog.open && this.dialog.close();return this._call('onFruitMerge');}
  if(action === 'practice')return this._call('onPractice',this._dailySeed());
  if(action === 'tab'){this.menuTab = button.dataset.tab;return this._renderMenu();}
  if(action === 'close')return this._closeDialog();
  if(action === 'slot'){const index=finite(button.dataset.slot);return this._call(this.lastSlots[index]?.filled && this.callbacks.onReturnSlot ? 'onReturnSlot':'onSlot',index);}
  if(action === 'menu'){this.dialog.open && this.dialog.close();return this._call('onMenu');}
  if(action === 'next'){this.dialog.open && this.dialog.close();return this._call('onNext',this.nextId);}
  if(action === 'retry'){this.dialog.open && this.dialog.close();return this._call('onRetry');}
  if(action === 'keep'){this.dialog.open && this.dialog.close();return this._call('onKeepWorking');}
  if(action === 'submit')return this._call('onSubmit');
  if(action === 'undo')return this._call('onUndo');
  if(action === 'hint')return this._call('onHint');
  if(action === 'settings')return this._call('onSettings');
 }

 _dailySeed(){const date = new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
 _record(id){const p = this.menuData.profile || {};return p.completed?.[id] ?? p.best?.[id] ?? p.levels?.[id] ?? p.records?.[id] ?? p.stars?.[id] ?? p.progress?.[id] ?? 0;}
 _stars(id){return starCount(this._record(id));}
 _unlocked(level,index){
  const p = this.menuData.profile || {};
  if(level.unlocked !== undefined)return !!level.unlocked;
  if(level.locked !== undefined)return !level.locked;
  if(Array.isArray(p.unlocked))return p.unlocked.includes(level.id) || index === 0;
  if(Number.isFinite(p.unlockedLevel))return index < p.unlockedLevel;
  return this.menuData.levels.slice(0,index).every(previous=>this._stars(previous.id)>0);
 }
 _requestStart(id){
  const {levels} = this.menuData;
  const level = levels.find(item => String(item.id) === String(id));
  if(!level)return;
  if(!this._unlocked(level,levels.indexOf(level)))return;
  this.pendingLevelId = level.id;
  const first = levels.indexOf(level) === 0 && this._stars(level.id) === 0;
  if(first || level.tutorial){return this.showBriefing(level);}
  this._call('onStart',level.id);
 }

 showMenu({profile = {},levels = [],chapters = [],achievements = []} = {}) {
  this.menuData = {profile,levels,chapters,achievements};
  this.menuTab ||= 'orders';
  this.hud.hidden = true;this.menu.hidden = false;
  this.dialog.open && this.dialog.close();
  this._setState('menu');
  this._renderMenu();
 }
 _renderMenu(){
  const {profile,levels,achievements} = this.menuData;
  let {chapters} = this.menuData;
  if(!chapters.length)chapters = [...new Set(levels.map(level => level.chapterId ?? level.chapter ?? 1))].map((id,index) => ({id,title:`第 ${index+1} 章`,description:'把每一份心意切得刚刚好。'}));
  const completed = levels.filter(level => this._stars(level.id) > 0).length;
  const totalStars = levels.reduce((sum,level) => sum + this._stars(level.id),0);
  const next = levels.find((level,index) => this._unlocked(level,index) && !this._stars(level.id)) || levels.filter((level,index) => this._unlocked(level,index)).at(-1) || levels[0];
  const stampIds = new Set(Array.isArray(profile.achievements) ? profile.achievements.map(item=>typeof item === 'object' ? item.id : item) : Object.keys(profile.achievements || {}).filter(id=>profile.achievements[id]));
  const stampCount = achievements.filter(item => item.unlocked || item.earned || stampIds.has(item.id)).length;
  const chapterHTML = chapters.map((chapter,chapterIndex) => {
   const group = levels.filter(level => String(level.chapterId ?? level.chapter ?? 1) === String(chapter.id ?? chapterIndex+1));
   const chapterStars = group.reduce((sum,level)=>sum+this._stars(level.id),0);
   const unlocked = group.some(level=>this._unlocked(level,levels.indexOf(level)));
   return `<article class="chapter-card ${unlocked?'':'chapter-locked'}" style="--chapter-color:${['#6f8b5e','#db9d45','#a081b1','#d88e87','#729d96','#b69959'][chapterIndex%6]}"><div class="chapter-card-head"><span class="chapter-symbol">${icon(['seed','plate','hint','check','book','home'][chapterIndex%6])}</span><div><span class="chapter-number">CHAPTER ${String(chapterIndex+1).padStart(2,'0')}</span><h3>${escape(chapter.title || chapter.name)}</h3></div><span class="chapter-progress">${chapterStars}<small> / ${group.length*3} ★</small></span></div><p>${escape(chapter.description || chapter.subtitle || chapter.theme || '每一份，都值得刚刚好。')}</p><div class="chapter-levels">${group.map(level=>{const index = levels.indexOf(level),available = this._unlocked(level,index),score = this._stars(level.id);return `<button class="level-button ${score?'level-complete':''} ${level.id===next?.id?'level-next':''}" data-action="start" data-level="${escape(level.id)}" ${available?'':'disabled'} aria-label="第 ${index+1} 单，${escape(title(level))}，${available?`${score} 星`:'完成上一单后解锁'}"><span class="level-number">${available?String(index+1).padStart(2,'0'):icon('lock')}</span><span class="level-name">${escape(title(level))}</span>${stars(score)}</button>`;}).join('')}</div></article>`;
  }).join('');
  const stampsHTML = achievements.map((achievement,index) => {const earned = achievement.unlocked || achievement.earned || stampIds.has(achievement.id);return `<article class="stamp-card ${earned?'stamp-earned':''}"><div class="stamp-mark">${icon(['seed','plate','check','hint','book','home'][index%6])}</div><h3>${escape(achievement.title || achievement.name)}</h3><p>${escape(achievement.description || achievement.desc || '')}</p><span>${earned?'已收入小店':'待点亮'}</span></article>`;}).join('');
  this.menu.innerHTML = `<div class="menu-content"><header class="menu-masthead"><span class="menu-logo"><i>j.</i> JELLY ROOM</span><span class="menu-edition">A SMALL SHOP FOR SLOW MOMENTS</span></header><section class="menu-hero"><div><div class="menu-kicker"><i></i> 今日营业中 · 慢一点也没关系</div><h1>慢慢切<span>果冻小店</span></h1><p class="menu-intro">把一块软乎乎的果冻，<br class="mobile-break">切成刚刚好的心意。</p><div class="menu-primary-actions"><button class="game-primary menu-continue" data-action="start" data-level="${escape(next?.id)}" ${next?'':'disabled'}><span>${completed?'继续接单':'开始接单'}<small>${next?`第 ${levels.indexOf(next)+1} 单 · ${escape(title(next))}`:'正在准备今日订单'}</small></span>${icon('arrow')}</button><button class="game-secondary" data-action="sandbox">自由玩<span>只管拽，随便切</span></button><button class="game-secondary" data-action="practice">今日练习<span>每天一份新手感</span></button></div>${fruitMergeEntry}<button class="menu-blocks-entry" data-action="blocks"><span class="blocks-mini" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="menu-blocks-copy"><b>果冻方块</b><small>旋转 · 下落 · 连消，把果冻叠得刚刚好。</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button></div><aside class="shop-ledger"><div class="ledger-top"><span>小店营业记录</span><i>since your first slice</i></div><div class="ledger-values"><div><strong>${String(completed).padStart(2,'0')}<small> / ${levels.length}</small></strong><span>完成订单</span></div><div><strong>${totalStars}<small> / ${levels.length*3}</small></strong><span>收获星星</span></div></div><div class="ledger-track"><span style="width:${levels.length?completed/levels.length*100:0}%"></span></div><p>${completed===levels.length&&levels.length?'小店的每一份心意，你都完成了。':'六段小小旅程，从第一刀到熟练店主。'}</p><span class="ledger-seal">慢<br>慢<br>来</span></aside></section><nav class="menu-tabs" aria-label="小店收藏"><button class="${this.menuTab==='orders'?'active':''}" data-action="tab" data-tab="orders">订单册 <span>${completed} / ${levels.length}</span></button><button class="${this.menuTab==='stamps'?'active':''}" data-action="tab" data-tab="stamps">小店印章 <span>${stampCount} / ${achievements.length}</span></button><span class="menu-save-note">进度自动保存在这台设备</span></nav>${this.menuTab==='stamps'?`<section class="stamp-grid" aria-label="小店印章">${stampsHTML || '<p class="empty-stamps">完成订单后，属于你的印章会在这里亮起来。</p>'}</section>`:`<section class="chapter-grid" aria-label="六章订单">${chapterHTML}</section>`}<footer class="menu-footer"><span>切一刀 · 拽一拽 · 装一盘</span><span>没有催促，手感会慢慢变好。</span></footer></div>`;
 }

 showBriefing(level){
  this.pendingLevelId = level.id;this.dialogReturnState = 'menu';this._setState('onboarding');
  const budget = level.cutBudget ?? level.maxCuts;
  const requirements = level.description || level.brief || level.objective || '照着订单切出合适的份量，把碎块轻轻拖进盘子里。';
  this.dialog.innerHTML = `<button class="game-dialog-close" data-action="close" aria-label="回到小店">×</button><span class="game-eyebrow">YOUR FIRST LITTLE ORDER</span><h2 id="game-dialog-title">${escape(title(level))}</h2><p class="game-dialog-intro">${escape(requirements)}</p><div class="onboarding-steps"><div><b>01</b><span><strong>先切一刀</strong>选「切一刀」，在果冻上划一条线，松手下刀。</span></div><div><b>02</b><span><strong>把合适的装盘</strong>选「拽一拽」，将碎块拖到对应订单盘，再松手。</span></div><div><b>03</b><span><strong>准备好，交给客人</strong>看一眼盘上的份量；不满意可以撤销，装好后提交。</span></div></div><div class="briefing-note">${budget?`这一单最多 ${escape(budget)} 刀。想好方向，再慢慢下刀。`:'第一刀不必完美，随时可以重做。'}<br>份量看的是果冻体积，拉长不会变多。</div><button class="game-primary dialog-primary" data-action="begin">准备好了，接下这一单 ${icon('arrow')}</button>`;
  this.dialog.showModal();
 }

 showHUD({level,index = 0,total = 24,profile = {}} = {}){
  this.level = level || {};this.profile = profile;this.dialog.open && this.dialog.close();
  this.menu.hidden = true;this.hud.hidden = false;this._setState('order');
  $('#settings-panel').open = false;
  $('#order-number').textContent = level?.mode === 'practice' ? 'DAILY PRACTICE · 今日练习' : `ORDER ${String(index+1).padStart(2,'0')} / ${total}`;
  const chapter = this.menuData.chapters.find(item=>String(item.id)===String(level?.chapterId ?? level?.chapter));
  $('#order-chapter').textContent = chapter?.title || chapter?.name || level?.chapterName || (level?.mode==='practice'?'自由练习':'慢慢营业');
  $('#order-title').textContent = title(level);
  $('#order-description').textContent = level?.description || level?.brief || level?.objective || '切出合适的份量，轻轻拖到订单盘。';
  const targets = level?.slots || level?.targets || level?.portions || [];
  this.lastSlots = [];
  this.slotKey = null;
  this.updateHUD({elapsed:0,cuts:0,cutBudget:level?.cutBudget ?? level?.maxCuts,slots:targets.map((slot,index)=>typeof slot==='object'?{...slot,filled:false,label:slot.label || slot.name || `第 ${index+1} 份`,target:slot.target ?? slot.share ?? slot.amount}:{filled:false,label:`第 ${index+1} 份`,target:slot})});
 }

 updateHUD({elapsed,cuts,cutBudget,slots,selectedPiece,ready,canUndo} = {}){
  if(elapsed !== undefined)$('#order-time').textContent = clock(elapsed);
  if(cuts !== undefined)$('#order-cuts').textContent = cuts;
  if(cutBudget !== undefined)$('#order-budget').textContent = Number.isFinite(cutBudget)?` / ${cutBudget}`:'';
  if(canUndo !== undefined)$('#order-undo').disabled = !canUndo;
  if(selectedPiece !== undefined){$('#order-piece').textContent = selectedPiece ? `${selectedPiece.flavor || '手里这块'} ${percent(selectedPiece.share)}${selectedPiece.rindFraction != null?` · 果皮 ${ratioPercent(selectedPiece.rindFraction)}`:''}`:'切下合适的一块，再装盘';}
  if(slots){
   this.lastSlots = slots;
   const key = JSON.stringify(slots);
   if(key !== this.slotKey){
    this.slotKey = key;
    $('#order-slots').innerHTML = slots.map((slot,index)=>{
     const definition = this.level?.slots?.[index] || {};
     const flavor = slot.flavor || definition.flavor || this.level?.flavor || 'melon';
     const flavorName = {melon:'西瓜',citrus:'蜜橙',grape:'葡萄'}[flavor] || flavor;
     const rule = definition.rindMax != null ? `果皮 ≤ ${ratioPercent(definition.rindMax)}` : definition.rindMin != null ? `果皮 ≥ ${ratioPercent(definition.rindMin)}` : definition.tossRequired ? '轻抛后落稳' : '';
     const label = slot.label || `第 ${index+1} 份`;
     const status = slot.filled ? `误差 ${percent(Math.abs(fraction(slot.actual)-fraction(slot.target)))} · 点按取回` : rule || '拖到这里，松手装盘';
     return `<button class="serving-slot ${slot.filled?'slot-filled':''}" data-action="slot" data-slot="${index}" aria-label="${escape(label)}，${escape(flavorName)}，目标 ${percent(slot.target)}，${slot.filled?`已装盘 ${percent(slot.actual)}，点按取回`:'把果冻拖到这里'}${rule?`，${escape(rule)}`:''}"><span class="slot-label"><i class="slot-flavor-${escape(flavor)}">${String.fromCharCode(65+index)}</i>${escape(label)}</span><span class="slot-amount">${slot.filled?percent(slot.actual):percent(slot.target)}<small>${slot.filled?`目标 ${percent(slot.target)}`:escape(flavorName)}</small></span><span class="slot-status">${icon(slot.filled?'check':'plate')}${escape(status)}</span></button>`;
    }).join('');
    $('#order-slots').style.setProperty('--slot-count',Math.max(1,slots.length));
    $('#order-slots').dataset.count = slots.length;
    this.app.classList.toggle('many-order-slots',slots.length>=5);
   }
  }
  const filled = this.lastSlots.filter(slot=>slot.filled).length;
  const isReady = ready ?? (this.lastSlots.length>0 && filled === this.lastSlots.length);
  const submit = $('#order-submit');submit.disabled = !isReady;submit.classList.toggle('ready',isReady);
  submit.innerHTML = `${icon('plate')}<span>${isReady?'交给客人':'先把果冻装盘'}<small id="submit-caption">${isReady?'看看这一单的成绩':`${filled} / ${this.lastSlots.length} 份已就位`}</small></span>`;
 }

 /** Screen-space targets for the host's drag/drop physics integration. */
 getDropTargets(){return [...this.root.querySelectorAll('.serving-slot')].map((element,index)=>({index,element,rect:element.getBoundingClientRect(),...this.lastSlots[index]}));}
 setDropHover(index){this.root.querySelectorAll('.serving-slot').forEach((element,i)=>element.classList.toggle('slot-hover',i===index));}

 showResult(result = {},{level = this.level,nextId = null,profile = {}} = {}){
  this.level = level;this.profile = profile;this.nextId = nextId;this.dialogReturnState = 'order';this._setState('result');
  const earnedStars = starCount(result.stars);
  const passed = result.passed ?? result.success ?? earnedStars>0;
  const score = result.score == null ? null : Math.round(finite(result.score));
  const details = [
   ['份量准确',result.accuracy == null ? null : percent(result.accuracy)],
   ['桌上剩余',result.waste == null ? null : `${ratioPercent(result.waste)} / 最多 ${ratioPercent(level?.maxWaste ?? .07)}`],
   ['本单用刀',result.cuts == null ? null : `${result.cuts} / ${level?.cutBudget ?? '—'} 刀`],
   ['从容用时',result.elapsed == null ? null : clock(result.elapsed)],
  ].filter(([,value])=>value != null).map(([name,value])=>`<div><span>${escape(name)}</span><b>${escape(value)}</b></div>`).join('');
  const reason = result.reason || result.message || result.feedback || (passed?'客人的心意收到啦。慢慢来，也能切得很好。':'看看份量与订单要求，换个位置下刀试试。');
  const failedChecks = [...new Set((result.checks || []).filter(check=>!check.passed && !check.optional && check.detail!==reason).map(check=>check.detail))].slice(0,3);
  const rewards = result.achievements || result.newAchievements || result.rewards || [];
  const primaryAction = !passed?'keep':nextId?'next':'retry';
  const primaryLabel = !passed?'继续调整':nextId?'接下一单':'再切一次，争取满星';
  const secondaryAction = passed && !nextId ? 'menu' : 'retry';
  const secondaryLabel = passed && !nextId ? '回到订单册' : passed ? '再做一遍' : '重新切这一单';
  this.dialog.innerHTML = `<span class="game-eyebrow">ORDER ${passed?'SERVED WITH CARE':'A LITTLE MORE PRACTICE'}</span><div class="result-stars">${stars(earnedStars)}</div><h2 id="game-dialog-title">${passed?'这一单，刚刚好。':'再调整一点点。'}</h2><p class="game-dialog-intro">${escape(reason)}</p>${score !== null?`<div class="result-score"><strong>${score}</strong><span>本单评分 / 1000</span></div>`:''}<div class="result-breakdown">${details || `<div><span>订单</span><b>${escape(title(level))}</b></div>`}</div>${failedChecks.length?`<ul class="result-fixes">${failedChecks.map(detail=>`<li>${escape(detail)}</li>`).join('')}</ul>`:''}${rewards.length?`<div class="result-rewards">${icon('seed')}新的小店印章 · ${escape(rewards.map(item=>typeof item==='object'?item.title || item.name || item.id:this.menuData.achievements.find(stamp=>stamp.id===item)?.title || item).join('、'))}</div>`:''}<div class="result-actions"><button class="game-primary" data-action="${primaryAction}">${primaryLabel} ${icon('arrow')}</button><button class="game-secondary" data-action="${secondaryAction}">${secondaryLabel}</button></div><button class="game-text-button" data-action="menu">先收工，回到订单册</button>`;
  if(!this.dialog.open)this.dialog.showModal();
 }

 showHint(text){
  this.dialogReturnState = this.state === 'sandbox'?'sandbox':'order';this._setState('hint');
  this.dialog.innerHTML = `<button class="game-dialog-close" data-action="close" aria-label="关闭提示">×</button><span class="game-eyebrow">A LITTLE HELP FROM THE SHOP</span><h2 id="game-dialog-title">下一刀，慢慢想。</h2><p class="hint-copy">${escape(text || this.level?.hint || '先观察目标份量。靠近中间切，两边接近；靠近边缘切，能分出更小的一块。拉长只改变形状，不改变份量。')}</p><div class="briefing-note">选「切一刀」划线，松手下刀。<br>切好后换「拽一拽」，把碎块拖到盘上。</div><button class="game-primary dialog-primary" data-action="close">知道了，继续营业 ${icon('arrow')}</button>`;
  if(!this.dialog.open)this.dialog.showModal();
 }
 showSandbox(){this.level=null;this.menu.hidden=true;this.hud.hidden=true;this.dialog.open&&this.dialog.close();this._setState('sandbox');}
 showBlocks(){this.level=null;this.menu.hidden=true;this.hud.hidden=true;this.dialog.open&&this.dialog.close();this._setState('blocks');}
 showFruitMerge(){this.level=null;this.menu.hidden=true;this.hud.hidden=true;this.dialog.open&&this.dialog.close();this._setState('fruitMerge');}
 toast(message){const element = $('#toast');element.textContent=message;element.classList.add('show');clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>element.classList.remove('show'),2600);}
}
